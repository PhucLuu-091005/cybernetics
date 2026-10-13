import { and, count, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { InboxStateSchema, ListInboxInputSchema, type ActorContext, type GraphSnapshot, type InboxState, type ListInboxResult, type ViewSelection } from '../../../contracts';
import { buildRecordHeader } from '../../../lib/record-header';
import { AppError } from '../../errors';
import { recordVersions, records } from '../../db/schema';
import type { Db, Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { resolveView } from '../graph/hydrate';
import { decodeCursor, encodeCursor, takePage, viewKey } from '../graph/paging';
import { invalid, toRecordVersion } from '../records/metadata';

const v = recordVersions, r = records;
const uuids = (ids: string[]) => sql`${sql.param(ids)}::uuid[]`;
const heavy = new Set(['bodyText', 'searchText', 'searchTitle']);
// Inbox rows never show the body, so up to 64 KiB per version stays in the database.
const listColumns = Object.fromEntries(Object.entries(getTableColumns(recordVersions)).filter(([name]) => !heavy.has(name))) as Omit<typeof recordVersions._.columns, 'bodyText' | 'searchText' | 'searchTitle'>;

/** SRD 8.1: a withdrawal needs reconciliation while visible acts cite any version of the record, or while the version has no decision. */
async function inboxState(db: Db | Tx, projectId: string, snapshot: GraphSnapshot): Promise<SQL<InboxState>> {
  const visible = [...new Set(snapshot.acts.filter(act => !act.hidden).map(act => act.citation.recordVersionId))];
  const cited = visible.length ? await db.selectDistinct({ recordId: v.recordId }).from(v).where(and(eq(v.projectId, projectId), inArray(v.id, visible))) : [];
  const decisions = snapshot.recordDecisions;
  const decided = uuids(decisions.map(decision => decision.recordVersionId));
  const included = uuids(decisions.filter(decision => decision.disposition === 'included').map(decision => decision.recordVersionId));
  return sql<InboxState>`case
    when ${r.withdrawnAt} is not null and (${r.id} = any(${uuids(cited.map(row => row.recordId))}) or not ${v.id} = any(${decided})) then 'withdrawn'
    when not ${v.id} = any(${decided}) and ${r.currentVersionId} is distinct from ${v.id} then 'superseded'
    when ${v.id} = any(${included}) then 'included'
    when ${v.id} = any(${decided}) then 'ignored'
    else 'pending' end`;
}

/** Pending means a current version of a record that is not withdrawn, with no decision in the snapshot. */
export async function countPending(db: Db | Tx, projectId: string, snapshot: GraphSnapshot): Promise<number> {
  const decided = uuids(snapshot.recordDecisions.map(decision => decision.recordVersionId));
  const [row] = await db.select({ n: count() }).from(v)
    .innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.currentVersionId, v.id)))
    .where(and(eq(v.projectId, projectId), isNull(r.withdrawnAt), sql`not ${v.id} = any(${decided})`));
  return row.n;
}

function viewOf(input: Pick<z.infer<typeof ListInboxInputSchema>, 'commitId' | 'proposalId' | 'proposalRevision'>): ViewSelection {
  if (input.proposalId !== undefined) {
    if (input.commitId !== undefined || input.proposalRevision === undefined) throw new AppError('VALIDATION', 'Select one view: a proposal with its revision, or a commit', { errors: [{ path: 'proposalRevision', message: 'A proposal view needs proposalRevision and no commitId' }] });
    return { kind: 'proposal', proposalId: input.proposalId, proposalRevision: input.proposalRevision };
  }
  if (input.proposalRevision !== undefined) throw new AppError('VALIDATION', 'proposalRevision needs proposalId', { errors: [{ path: 'proposalId', message: 'Required with proposalRevision' }] });
  return input.commitId !== undefined ? { kind: 'commit', commitId: input.commitId } : { kind: 'main' };
}

export async function listInbox(db: Db, ctx: ActorContext, raw: z.input<typeof ListInboxInputSchema>): Promise<ListInboxResult> {
  requireScope(ctx, 'project:read');
  const parsed = ListInboxInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inbox read', parsed.error);
  const input = parsed.data, view = viewOf(input);
  return db.transaction(async tx => {
    const resolved = await resolveView(tx, ctx, input.projectId, view), { project, snapshot } = resolved;
    // Offsets shift when evidence arrives, so the evidence revision binds the cursor as well.
    const key = viewKey({ list: 'inbox', projectId: project.id, commitId: resolved.commitId, proposalId: resolved.proposalId, proposalRevision: resolved.proposalRevision, evidenceRevision: project.evidenceRevision, state: input.state ?? null });
    const offset = decodeCursor(input.cursor, key)?.o ?? 0;
    const state = await inboxState(tx, project.id, snapshot);
    const rows = await tx.select({ version: listColumns, withdrawnAt: r.withdrawnAt, state }).from(v)
      .innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.id, v.recordId)))
      .where(and(eq(v.projectId, project.id), input.state ? sql`${state} = ${input.state}` : undefined))
      .orderBy(desc(v.occurredAt), desc(v.createdAt), desc(v.id)).limit(input.limit + 1).offset(offset);
    const dispositions = new Map(snapshot.recordDecisions.map(decision => [decision.recordVersionId, decision.disposition]));
    const items = rows.map(({ version, withdrawnAt, state }) => {
      const withdrawn = withdrawnAt !== null, full = toRecordVersion({ ...version, bodyText: '', searchText: '', searchTitle: '' }, withdrawn);
      return {
        recordVersionId: full.id, recordId: full.recordId, state, header: buildRecordHeader(full, snapshot.context), title: full.title, occurredAt: full.occurredAt, author: full.author,
        source: full.source, sourceLabel: full.sourceLabel, threadExternalId: full.threadExternalId, parentExternalId: full.parentExternalId, proposedDisposition: dispositions.get(full.id) ?? null,
      };
    });
    const page: ListInboxResult = { projectId: project.id, mainCommitId: project.mainCommitId, evidenceRevision: project.evidenceRevision, items: [], nextCursor: null, requestId: ctx.requestId };
    const { taken } = takePage(items, 0, input.limit, { ...page, nextCursor: encodeCursor({ view: key, o: offset + items.length }) });
    page.items = taken;
    if (taken.length < items.length) page.nextCursor = encodeCursor({ view: key, o: offset + taken.length });
    return page;
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

const CountInboxInputSchema = ListInboxInputSchema.pick({ projectId: true, commitId: true, proposalId: true, proposalRevision: true });
export type InboxCounts = Record<InboxState, number>;

export async function countInbox(db: Db, ctx: ActorContext, raw: z.input<typeof CountInboxInputSchema>): Promise<InboxCounts> {
  requireScope(ctx, 'project:read');
  const parsed = CountInboxInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inbox count', parsed.error);
  const input = parsed.data, view = viewOf(input);
  return db.transaction(async tx => {
    const { project, snapshot } = await resolveView(tx, ctx, input.projectId, view);
    const state = await inboxState(tx, project.id, snapshot);
    const rows = await tx.select({ state, n: count() }).from(v)
      .innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.id, v.recordId)))
      .where(eq(v.projectId, project.id))
      // Ordinal grouping: the state expression binds its arrays as parameters, so repeating it would not match the select list.
      .groupBy(sql`1`);
    const counts = Object.fromEntries(InboxStateSchema.options.map(name => [name, 0])) as InboxCounts;
    for (const row of rows) counts[row.state] = row.n;
    return counts;
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
