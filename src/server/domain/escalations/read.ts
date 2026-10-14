import { and, desc, eq, lt, max } from 'drizzle-orm';
import { z } from 'zod';
import {
  GetEscalationInputSchema,
  IdSchema,
  RevisionSchema,
  utf8Bytes,
  type ActorContext,
  type Escalation,
  type EscalationAnalysis,
  type GetEscalationResult,
} from '../../../contracts';
import { AppError } from '../../errors';
import { escalationAnalyses, escalations } from '../../db/schema';
import { isId, toIso, type Db, type ProjectRow, type Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { MAX_PAGE_BYTES, takePage, viewKey } from '../graph/paging';
import { READ_ONLY } from '../graph/read';
import { toProject } from '../projects';
import { invalid } from '../records/metadata';
import { assessClaims } from './verdict';

export type EscalationRow = typeof escalations.$inferSelect;
export type AnalysisRow = typeof escalationAnalyses.$inferSelect;
const ListEscalationsInputSchema = z.strictObject({ projectId: IdSchema });
export type ListEscalationsInput = z.input<typeof ListEscalationsInputSchema>;
const CursorSchema = z.strictObject({ v: z.string(), b: RevisionSchema });
// Covers a longer requestId and wider revision numbers on later reads than the save-time estimate saw.
const READ_SLACK_BYTES = 256;

export function toEscalation(
  row: EscalationRow,
  latestAnalysisRevision: number | null,
): Escalation {
  return {
    id: row.id,
    projectId: row.projectId,
    complaint: row.complaint,
    author: row.author,
    createdAt: toIso(row.createdAt),
    latestAnalysisRevision,
  };
}
export function toAnalysis(row: AnalysisRow): EscalationAnalysis {
  return {
    id: row.id,
    escalationId: row.escalationId,
    projectId: row.projectId,
    revision: row.revision,
    graphCommitId: row.graphCommitId,
    evidenceRevision: row.evidenceRevision,
    claims: assessClaims(row.claims),
    answerText: row.answerText,
    author: row.author,
    createdAt: toIso(row.createdAt),
    contentHash: row.contentHash,
    approval: row.approval ?? null,
  };
}
export async function findEscalation(
  db: Db | Tx,
  projectId: string,
  escalationId: string,
  lock: boolean,
): Promise<EscalationRow> {
  if (!isId(escalationId)) throw new AppError('NOT_FOUND', 'Escalation not found');
  const query = db
    .select()
    .from(escalations)
    .where(and(eq(escalations.projectId, projectId), eq(escalations.id, escalationId)))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new AppError('NOT_FOUND', 'Escalation not found');
  return row;
}
export async function latestAnalysis(
  db: Db | Tx,
  projectId: string,
  escalationId: string,
): Promise<AnalysisRow | null> {
  const [row] = await db
    .select()
    .from(escalationAnalyses)
    .where(
      and(
        eq(escalationAnalyses.projectId, projectId),
        eq(escalationAnalyses.escalationId, escalationId),
      ),
    )
    .orderBy(desc(escalationAnalyses.revision))
    .limit(1);
  return row ?? null;
}
export const isCurrent = (
  pins: { graphCommitId: string; evidenceRevision: number },
  project: ProjectRow,
) =>
  pins.graphCommitId === project.mainCommitId && pins.evidenceRevision === project.evidenceRevision;

const analysesView = (projectId: string, escalationId: string) =>
  viewKey({ list: 'escalation_analyses', projectId, escalationId });
const encodeCursor = (v: string, before: number) =>
  Buffer.from(JSON.stringify({ v, b: before })).toString('base64url');
function decodeCursor(raw: string | null | undefined, view: string): number | null {
  if (raw == null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    decoded = null;
  }
  const parsed = CursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.v !== view)
    throw new AppError('VALIDATION', 'Cursor does not belong to this escalation');
  return parsed.data.b;
}
/** The empty page with a worst-case cursor: the latest revision bounds every cursor this escalation can issue. */
function pageEnvelope(
  project: ProjectRow,
  escalation: Escalation,
  stale: boolean,
  requestId: string,
): GetEscalationResult {
  const { mainCommitId, evidenceRevision } = toProject(project);
  return {
    projectId: project.id,
    escalation,
    analyses: [],
    mainCommitId,
    evidenceRevision,
    stale,
    nextCursor: encodeCursor(
      analysesView(project.id, escalation.id),
      escalation.latestAnalysisRevision ?? 0,
    ),
    requestId,
  };
}
/** A row larger than one page would make the escalation history unreadable, because pages never split an analysis; saves refuse it. */
export function assertFitsPage(
  project: ProjectRow,
  escalation: Escalation,
  analysis: EscalationAnalysis,
  requestId: string,
): void {
  const page = { ...pageEnvelope(project, escalation, true, requestId), analyses: [analysis] };
  if (utf8Bytes(JSON.stringify(page)) + READ_SLACK_BYTES > MAX_PAGE_BYTES)
    throw new AppError(
      'LIMIT_EXCEEDED',
      'The analysis and complaint exceed the 50,000-character escalation page limit',
    );
}

export async function getEscalation(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetEscalationInputSchema>,
): Promise<GetEscalationResult> {
  requireScope(ctx, 'project:read');
  const parsed = GetEscalationInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid escalation read', parsed.error);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const project = await requireProject(tx, ctx, input.projectId);
    const row = await findEscalation(tx, project.id, input.escalationId, false);
    const view = analysesView(project.id, row.id);
    const before = decodeCursor(input.cursor, view);
    const latest = await latestAnalysis(tx, project.id, row.id);
    const rows = await tx
      .select()
      .from(escalationAnalyses)
      .where(
        and(
          eq(escalationAnalyses.projectId, project.id),
          eq(escalationAnalyses.escalationId, row.id),
          before === null ? undefined : lt(escalationAnalyses.revision, before),
        ),
      )
      .orderBy(desc(escalationAnalyses.revision))
      .limit(input.limit + 1);
    const page = pageEnvelope(
      project,
      toEscalation(row, latest?.revision ?? null),
      latest !== null && !isCurrent(latest, project),
      ctx.requestId,
    );
    const { taken, next } = takePage(rows.map(toAnalysis), 0, input.limit, page);
    return {
      ...page,
      analyses: taken,
      nextCursor: next === null ? null : encodeCursor(view, taken[taken.length - 1].revision),
    };
  }, READ_ONLY);
}

export async function listEscalations(
  db: Db,
  ctx: ActorContext,
  raw: ListEscalationsInput,
): Promise<Escalation[]> {
  requireScope(ctx, 'project:read');
  const parsed = ListEscalationsInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid escalation list', parsed.error);
  const project = await requireProject(db, ctx, parsed.data.projectId);
  const latest = db
    .select({
      escalationId: escalationAnalyses.escalationId,
      revision: max(escalationAnalyses.revision).as('latest_revision'),
    })
    .from(escalationAnalyses)
    .where(eq(escalationAnalyses.projectId, project.id))
    .groupBy(escalationAnalyses.escalationId)
    .as('latest');
  const rows = await db
    .select({ escalation: escalations, revision: latest.revision })
    .from(escalations)
    .leftJoin(latest, eq(latest.escalationId, escalations.id))
    .where(eq(escalations.projectId, project.id))
    .orderBy(desc(escalations.createdAt), desc(escalations.id));
  return rows.map(({ escalation, revision }) => toEscalation(escalation, revision ?? null));
}
