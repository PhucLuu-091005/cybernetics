import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import {
  GetCommitInputSchema,
  ListHistoryInputSchema,
  utf8Bytes,
  type ActorContext,
  type GetCommitResult,
  type GraphSnapshot,
  type ListHistoryResult,
  type SnapshotDiff,
} from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { graphCommits } from '../../db/schema';
import { toIso, type Db } from '../../db/tx';
import { diffSnapshots } from '../../graph/diff';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { loadCommit } from './store';

type CommitSummary = ListHistoryResult['items'][number];
const c = graphCommits;
const summaryColumns = {
  id: c.id,
  projectId: c.projectId,
  sequence: c.sequence,
  parentId: c.parentId,
  snapshotHash: c.snapshotHash,
  actor: c.actor,
  message: c.message,
  createdAt: c.createdAt,
  kind: c.kind,
  proposalId: c.proposalId,
  targetCommitId: c.targetCommitId,
  reviewedEvidenceRevision: c.reviewedEvidenceRevision,
};
const MAX_PAGE_BYTES = 50_000;
const CursorSchema = z.strictObject({ f: z.string(), s: z.number().int().nonnegative() });

function toSummary(
  row: Omit<typeof graphCommits.$inferSelect, 'snapshot' | 'workspaceId'>,
): CommitSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    sequence: row.sequence,
    parentId: row.parentId,
    snapshotHash: row.snapshotHash,
    actor: row.actor,
    message: row.message,
    createdAt: toIso(row.createdAt),
    kind: row.kind,
    proposalId: row.proposalId,
    targetCommitId: row.targetCommitId,
    reviewedEvidenceRevision: row.reviewedEvidenceRevision,
  };
}
/** The initial commit has no parent, so its diff lists every entity it introduced against the same scalar context. */
function withoutEntities(snapshot: GraphSnapshot): GraphSnapshot {
  return {
    ...snapshot,
    context: { ...snapshot.context, people: [], departments: [], milestones: [] },
    acts: [],
    loops: [],
    annotations: [],
    recordDecisions: [],
  };
}

export async function listHistory(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ListHistoryInputSchema>,
): Promise<ListHistoryResult> {
  requireScope(ctx, 'project:read');
  const parsed = ListHistoryInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid history list', parsed.error);
  const input = parsed.data;
  return db.transaction(
    async (tx) => {
      const project = toProject(await requireProject(tx, ctx, input.projectId));
      const filters = canonicalHash({ projectId: project.id });
      let before: number | null = null;
      if (input.cursor != null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
        } catch {
          decoded = null;
        }
        const cursor = CursorSchema.safeParse(decoded);
        if (!cursor.success || cursor.data.f !== filters)
          throw new AppError('VALIDATION', 'Cursor does not belong to this history list');
        before = cursor.data.s;
      }
      const rows = await tx
        .select(summaryColumns)
        .from(graphCommits)
        .where(
          and(
            eq(graphCommits.projectId, project.id),
            before === null ? undefined : lt(graphCommits.sequence, before),
          ),
        )
        .orderBy(desc(graphCommits.sequence))
        .limit(input.limit + 1);
      const encodeCursor = (sequence: number) =>
        Buffer.from(JSON.stringify({ f: filters, s: sequence })).toString('base64url');
      const page: ListHistoryResult = {
        projectId: project.id,
        mainCommitId: project.mainCommitId,
        evidenceRevision: project.evidenceRevision,
        items: [],
        nextCursor: null,
        requestId: ctx.requestId,
      };
      for (const row of rows.slice(0, input.limit)) {
        const item = toSummary(row);
        // Measure with a cursor present so adding it afterwards cannot push the page over the limit.
        if (
          page.items.length &&
          utf8Bytes(
            JSON.stringify({
              ...page,
              items: [...page.items, item],
              nextCursor: encodeCursor(item.sequence),
            }),
          ) > MAX_PAGE_BYTES
        )
          break;
        page.items.push(item);
      }
      if (page.items.length < rows.length)
        page.nextCursor = encodeCursor(page.items[page.items.length - 1].sequence);
      return page;
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export async function getCommit(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetCommitInputSchema>,
): Promise<GetCommitResult & { diff: SnapshotDiff }> {
  requireScope(ctx, 'project:read');
  const parsed = GetCommitInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid commit read', parsed.error);
  const project = await requireProject(db, ctx, parsed.data.projectId);
  const { snapshot, ...commit } = await loadCommit(db, project.id, parsed.data.commitId);
  const before =
    commit.parentId === null
      ? withoutEntities(snapshot)
      : (await loadCommit(db, project.id, commit.parentId)).snapshot;
  return {
    projectId: project.id,
    commit,
    requestId: ctx.requestId,
    diff: diffSnapshots(before, snapshot),
  };
}
