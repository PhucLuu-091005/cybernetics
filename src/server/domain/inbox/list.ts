import { and, count, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema, InboxStateSchema, ListInboxInputSchema, PageInputSchema, type ActorContext, type GraphSnapshot, type InboxState, type ListInboxResult, type RecordDecision, type ViewSelection } from '../../../contracts';
import { buildRecordHeader } from '../../../lib/record-header';
import { AppError } from '../../errors';
import { recordVersions, records } from '../../db/schema';
import type { Db, Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { resolveView, type ResolvedView } from '../graph/hydrate';
import { toProject } from '../projects';
import { findProposal, toProposal, type ProposalSummary } from '../proposals/read';
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

type InboxItem = ListInboxResult['items'][number];
export type InboxViewItem = InboxItem & { withdrawn: boolean };
type PageInput = { state?: InboxState; cursor?: string | null; limit: number };

/** One page of the resolved view; the caller shapes the items and applies the byte budget. */
async function readRows(tx: Tx, resolved: ResolvedView, input: PageInput, staleCursor: 'throw' | 'restart') {
  const { project, snapshot } = resolved;
  // Offsets shift when evidence arrives, so the evidence revision binds the cursor as well.
  const key = viewKey({ list: 'inbox', projectId: project.id, commitId: resolved.commitId, proposalId: resolved.proposalId, proposalRevision: resolved.proposalRevision, evidenceRevision: project.evidenceRevision, state: input.state ?? null });
  let offset = 0;
  try { offset = decodeCursor(input.cursor, key)?.o ?? 0; }
  catch (error) { if (staleCursor === 'throw') throw error; }
  const state = await inboxState(tx, project.id, snapshot);
  const rows = await tx.select({ version: listColumns, withdrawnAt: r.withdrawnAt, state }).from(v)
    .innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.id, v.recordId)))
    .where(and(eq(v.projectId, project.id), input.state ? sql`${state} = ${input.state}` : undefined))
    .orderBy(desc(v.occurredAt), desc(v.createdAt), desc(v.id)).limit(input.limit + 1).offset(offset);
  const dispositions = new Map(snapshot.recordDecisions.map(decision => [decision.recordVersionId, decision.disposition]));
  const items = rows.map(({ version, withdrawnAt, state }): InboxViewItem => {
    const withdrawn = withdrawnAt !== null, full = toRecordVersion({ ...version, bodyText: '', searchText: '', searchTitle: '' }, withdrawn);
    return {
      recordVersionId: full.id, recordId: full.recordId, state, header: buildRecordHeader(full, snapshot.context), title: full.title, occurredAt: full.occurredAt, author: full.author,
      source: full.source, sourceLabel: full.sourceLabel, threadExternalId: full.threadExternalId, parentExternalId: full.parentExternalId, proposedDisposition: dispositions.get(full.id) ?? null, withdrawn,
    };
  });
  return { items, key, offset, state };
}
function pageOf<I>(items: I[], key: string, offset: number, limit: number, envelope: object): { items: I[]; nextCursor: string | null } {
  const { taken } = takePage(items, 0, limit, { ...envelope, items: [], nextCursor: encodeCursor({ view: key, o: offset + items.length }) });
  return { items: taken, nextCursor: taken.length < items.length ? encodeCursor({ view: key, o: offset + taken.length }) : null };
}

export async function listInbox(db: Db, ctx: ActorContext, raw: z.input<typeof ListInboxInputSchema>): Promise<ListInboxResult> {
  requireScope(ctx, 'project:read');
  const parsed = ListInboxInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inbox read', parsed.error);
  const input = parsed.data, view = viewOf(input);
  return db.transaction(async tx => {
    const resolved = await resolveView(tx, ctx, input.projectId, view), { project } = resolved;
    const { items, key, offset } = await readRows(tx, resolved, input, 'throw');
    const envelope = { projectId: project.id, mainCommitId: project.mainCommitId, evidenceRevision: project.evidenceRevision, requestId: ctx.requestId };
    return { ...envelope, ...pageOf(items.map((item): InboxItem => { const { withdrawn, ...rest } = item; void withdrawn; return rest; }), key, offset, input.limit, envelope) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

const CountInboxInputSchema = ListInboxInputSchema.pick({ projectId: true, commitId: true, proposalId: true, proposalRevision: true });
export type InboxCounts = Record<InboxState, number>;

async function countStates(tx: Tx, resolved: ResolvedView): Promise<InboxCounts> {
  const state = await inboxState(tx, resolved.project.id, resolved.snapshot);
  const rows = await tx.select({ state, n: count() }).from(v)
    .innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.id, v.recordId)))
    .where(eq(v.projectId, resolved.project.id))
    // Ordinal grouping: the state expression binds its arrays as parameters, so repeating it would not match the select list.
    .groupBy(sql`1`);
  const counts = Object.fromEntries(InboxStateSchema.options.map(name => [name, 0])) as InboxCounts;
  for (const row of rows) counts[row.state] = row.n;
  return counts;
}

export async function countInbox(db: Db, ctx: ActorContext, raw: z.input<typeof CountInboxInputSchema>): Promise<InboxCounts> {
  requireScope(ctx, 'project:read');
  const parsed = CountInboxInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inbox count', parsed.error);
  const input = parsed.data, view = viewOf(input);
  return db.transaction(async tx => countStates(tx, await resolveView(tx, ctx, input.projectId, view)), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

const ReadInboxViewInputSchema = z.strictObject({
  projectId: IdSchema,
  view: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('main') }), z.strictObject({ kind: z.literal('proposal'), proposalId: IdSchema })]),
  state: InboxStateSchema.optional(), cursor: PageInputSchema.shape.cursor, limit: PageInputSchema.shape.limit, recordVersionId: IdSchema.optional(), selectFirst: z.boolean().default(false),
});
export type ReadInboxViewInput = z.input<typeof ReadInboxViewInputSchema>;
export type InboxView = {
  projectId: string; mainCommitId: string; evidenceRevision: number; timeZone: string;
  proposal: ProposalSummary | null; counts: InboxCounts;
  page: { items: InboxViewItem[]; nextCursor: string | null };
  selected: { recordVersionId: string; state: InboxState; decision: RecordDecision | null; citedByVisibleAct: boolean } | null;
};

/** Browser inbox page: the list, the counts, the proposal and the selected record all come from one snapshot in one read transaction. */
export async function readInboxView(db: Db, ctx: ActorContext, raw: ReadInboxViewInput): Promise<InboxView> {
  requireScope(ctx, 'project:read');
  const parsed = ReadInboxViewInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid inbox view read', parsed.error);
  const input = parsed.data;
  return db.transaction(async tx => {
    let resolved: ResolvedView, proposal: ProposalSummary | null = null;
    if (input.view.kind === 'proposal') {
      const project = toProject(await requireProject(tx, ctx, input.projectId));
      const { candidate, ...summary } = toProposal(await findProposal(tx, project.id, input.view.proposalId, false));
      proposal = summary;
      resolved = { project, snapshot: candidate, commitId: null, proposalId: summary.id, proposalRevision: summary.revision };
    } else resolved = await resolveView(tx, ctx, input.projectId, { kind: 'main' });
    const { project, snapshot } = resolved;
    const { items, key, offset, state } = await readRows(tx, resolved, input, 'restart');
    const envelope = { projectId: project.id, mainCommitId: project.mainCommitId, evidenceRevision: project.evidenceRevision, requestId: ctx.requestId };
    const page = pageOf(items, key, offset, input.limit, envelope);
    let selected: InboxView['selected'] = null;
    const id = input.recordVersionId ?? (input.selectFirst ? page.items[0]?.recordVersionId : undefined);
    if (id) {
      const [row] = await tx.select({ state }).from(v).innerJoin(r, and(eq(r.projectId, v.projectId), eq(r.id, v.recordId))).where(and(eq(v.projectId, project.id), eq(v.id, id))).limit(1);
      if (row) selected = { recordVersionId: id, state: row.state, decision: snapshot.recordDecisions.find(item => item.recordVersionId === id) ?? null, citedByVisibleAct: snapshot.acts.some(act => !act.hidden && act.citation.recordVersionId === id) };
    }
    return {
      projectId: project.id, mainCommitId: project.mainCommitId, evidenceRevision: project.evidenceRevision, timeZone: snapshot.context.timeZone,
      proposal, counts: await countStates(tx, resolved), page, selected,
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
