import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { GetProposalInputSchema, IdSchema, PageInputSchema, ProposalSchema, utf8Bytes, type ActorContext, type Proposal } from '../../../contracts';
import { canonicalHash } from '../../../lib/canonical-json';
import { AppError } from '../../errors';
import { graphProposals } from '../../db/schema';
import { isId, toIso, type Db, type Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { requireProject } from '../access';
import { invalid } from '../records/metadata';

export type ProposalRow = typeof graphProposals.$inferSelect;
export type ProposalSummary = Omit<Proposal, 'candidate'>;
const ListProposalsInputSchema = PageInputSchema.extend({ projectId: IdSchema, status: ProposalSchema.shape.status.optional() });
export type ListProposalsInput = z.input<typeof ListProposalsInputSchema>;
const p = graphProposals;
const summaryColumns = { id: p.id, workspaceId: p.workspaceId, projectId: p.projectId, baseCommitId: p.baseCommitId, revision: p.revision, author: p.author, title: p.title, rationale: p.rationale, evidenceRevision: p.evidenceRevision, status: p.status, mergedCommitId: p.mergedCommitId, createdAt: p.createdAt, updatedAt: p.updatedAt };
const MAX_PAGE_BYTES = 50_000;
const CursorSchema = z.strictObject({ f: z.string(), o: z.number().int().nonnegative() });

function toSummary(row: Omit<ProposalRow, 'candidate'>): ProposalSummary {
  return { id: row.id, projectId: row.projectId, baseCommitId: row.baseCommitId, revision: row.revision, author: row.author, title: row.title, rationale: row.rationale, evidenceRevision: row.evidenceRevision, status: row.status, createdAt: toIso(row.createdAt), updatedAt: toIso(row.updatedAt), mergedCommitId: row.mergedCommitId };
}
export function toProposal(row: ProposalRow): Proposal { return { ...toSummary(row), candidate: row.candidate }; }
export async function findProposal(db: Db | Tx, projectId: string, proposalId: string, lock: boolean): Promise<ProposalRow> {
  if (!isId(proposalId)) throw new AppError('NOT_FOUND', 'Proposal not found');
  const query = db.select().from(graphProposals).where(and(eq(graphProposals.projectId, projectId), eq(graphProposals.id, proposalId))).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new AppError('NOT_FOUND', 'Proposal not found');
  return row;
}
export async function getProposal(db: Db, ctx: ActorContext, raw: z.input<typeof GetProposalInputSchema>): Promise<Proposal> {
  requireScope(ctx, 'project:read');
  const parsed = GetProposalInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal read', parsed.error);
  const project = await requireProject(db, ctx, parsed.data.projectId);
  return toProposal(await findProposal(db, project.id, parsed.data.proposalId, false));
}
export async function listProposals(db: Db, ctx: ActorContext, raw: ListProposalsInput): Promise<{ items: ProposalSummary[]; nextCursor: string | null }> {
  requireScope(ctx, 'project:read');
  const parsed = ListProposalsInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid proposal list', parsed.error);
  const input = parsed.data;
  const project = await requireProject(db, ctx, input.projectId);
  const filters = canonicalHash({ projectId: project.id, status: input.status ?? null });
  let offset = 0;
  if (input.cursor != null) {
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); }
    catch { decoded = null; }
    const cursor = CursorSchema.safeParse(decoded);
    if (!cursor.success || cursor.data.f !== filters) throw new AppError('VALIDATION', 'Cursor does not belong to this proposal list');
    offset = cursor.data.o;
  }
  const rows = await db.select(summaryColumns).from(graphProposals)
    .where(and(eq(graphProposals.projectId, project.id), input.status ? eq(graphProposals.status, input.status) : undefined))
    .orderBy(desc(graphProposals.createdAt), desc(graphProposals.id)).limit(input.limit + 1).offset(offset);
  const encodeCursor = (next: number) => Buffer.from(JSON.stringify({ f: filters, o: next })).toString('base64url');
  const page: { items: ProposalSummary[]; nextCursor: string | null } = { items: [], nextCursor: null };
  for (const row of rows.slice(0, input.limit)) {
    const item = toSummary(row);
    // Measure with a cursor present so adding it afterwards cannot push the page over the limit.
    if (page.items.length && utf8Bytes(JSON.stringify({ items: [...page.items, item], nextCursor: encodeCursor(offset + page.items.length + 1) })) > MAX_PAGE_BYTES) break;
    page.items.push(item);
  }
  if (page.items.length < rows.length) page.nextCursor = encodeCursor(offset + page.items.length);
  return page;
}
