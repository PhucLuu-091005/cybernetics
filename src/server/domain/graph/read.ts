import type { z } from 'zod';
import {
  GetGraphInputSchema,
  GetLoopInputSchema,
  GraphReadInputSchema,
  ListLoopsInputSchema,
  ListMilestonesInputSchema,
  type ActorContext,
  type DerivedLoop,
  type DerivedMilestone,
  type EngineOutput,
  type GetGraphResult,
  type GetLoopResult,
  type GraphView,
  type ListLoopsResult,
  type ListMilestonesResult,
} from '../../../contracts';
import { AppError } from '../../errors';
import type { Db, Tx } from '../../db/tx';
import { requireScope } from '../../http/scopes';
import { deriveProject } from '../../loops/engine';
import { countPending } from '../inbox/list';
import { invalid } from '../records/metadata';
import { foldForSearch } from '../records/normalize';
import { evaluationTime, hydrateEngineInput, resolveView, type ResolvedView } from './hydrate';
import { decodeCursor, encodeCursor, takePage, viewKey } from './paging';

export const READ_ONLY = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
type PageFields = Pick<
  GetGraphResult,
  | 'projectId'
  | 'commitId'
  | 'proposalId'
  | 'proposalRevision'
  | 'evidenceRevision'
  | 'nextCursor'
  | 'requestId'
>;

export function pageFields(resolved: ResolvedView, ctx: ActorContext): PageFields {
  return {
    projectId: resolved.project.id,
    commitId: resolved.commitId,
    proposalId: resolved.proposalId,
    proposalRevision: resolved.proposalRevision,
    evidenceRevision: resolved.project.evidenceRevision,
    nextCursor: null,
    requestId: ctx.requestId,
  };
}
export function bindView(
  list: string,
  resolved: ResolvedView,
  filters: Record<string, unknown> = {},
): string {
  return viewKey({
    list,
    projectId: resolved.project.id,
    commitId: resolved.commitId,
    proposalId: resolved.proposalId,
    proposalRevision: resolved.proposalRevision,
    filters,
  });
}
async function evaluate(db: Db | Tx, resolved: ResolvedView, T: string): Promise<EngineOutput> {
  return deriveProject(await hydrateEngineInput(db, resolved.project.id, resolved.snapshot, T));
}
/** Later pages reuse the cursor's T, so a read without an explicit T keeps one evaluation time across pages. */
async function evaluatePage(
  db: Db | Tx,
  resolved: ResolvedView,
  input: { T?: string; cursor?: string | null },
  key: string,
): Promise<{ T: string; offset: number; engine: EngineOutput }> {
  const cursor = decodeCursor(input.cursor, key);
  const T = evaluationTime(resolved.snapshot, input.T ?? cursor?.T);
  if (cursor && cursor.T !== T)
    throw new AppError('VALIDATION', 'Cursor was issued for another evaluation time');
  return { T, offset: cursor?.o ?? 0, engine: await evaluate(db, resolved, T) };
}

export async function getGraphView(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GraphReadInputSchema>,
): Promise<GraphView> {
  requireScope(ctx, 'project:read');
  const parsed = GraphReadInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid graph read', parsed.error);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const resolved = await resolveView(tx, ctx, input.projectId, input.view),
      { project, snapshot } = resolved;
    const T = evaluationTime(snapshot, input.T);
    return {
      projectId: project.id,
      view: input.view,
      commitId: resolved.commitId,
      proposalId: resolved.proposalId,
      proposalRevision: resolved.proposalRevision,
      mainCommitId: project.mainCommitId,
      evidenceRevision: project.evidenceRevision,
      pendingEvidenceCount: await countPending(tx, project.id, snapshot),
      T,
      snapshot,
      engine: await evaluate(tx, resolved, T),
      people: snapshot.context.people,
      departments: snapshot.context.departments,
    };
  }, READ_ONLY);
}

type GraphEntry = DerivedMilestone | DerivedLoop;
async function loopPage(
  db: Db,
  ctx: ActorContext,
  input: z.infer<typeof GetGraphInputSchema>,
  list: string,
  filters: Record<string, unknown>,
  select: (engine: EngineOutput) => GraphEntry[],
): Promise<GetGraphResult> {
  return db.transaction(async (tx) => {
    const resolved = await resolveView(tx, ctx, input.projectId, input.view);
    const key = bindView(list, resolved, filters);
    const { T, offset, engine } = await evaluatePage(tx, resolved, input, key);
    const entries = select(engine);
    const page: GetGraphResult = {
      ...pageFields(resolved, ctx),
      T,
      loops: [],
      milestones: [],
      counts: engine.counts,
    };
    const { taken, next } = takePage(entries, offset, input.limit, {
      ...page,
      nextCursor: encodeCursor({ view: key, T, o: entries.length }),
    });
    for (const entry of taken)
      if ('milestone' in entry) page.milestones.push(entry);
      else page.loops.push(entry);
    page.nextCursor = next === null ? null : encodeCursor({ view: key, T, o: next });
    return page;
  }, READ_ONLY);
}

/** One page sequence: milestones first, then loops, so neither collection is truncated. */
export async function getGraph(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetGraphInputSchema>,
): Promise<GetGraphResult> {
  requireScope(ctx, 'project:read');
  const parsed = GetGraphInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid graph read', parsed.error);
  return loopPage(db, ctx, parsed.data, 'graph', {}, (engine) => [
    ...engine.milestones,
    ...engine.loops,
  ]);
}

export async function listLoops(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ListLoopsInputSchema>,
): Promise<ListLoopsResult> {
  requireScope(ctx, 'project:read');
  const parsed = ListLoopsInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid loop list', parsed.error);
  const { states, departmentIds, milestoneId, query, ...input } = parsed.data;
  const folded = query ? foldForSearch(query) : null;
  const matches = (loop: DerivedLoop) =>
    (!states || (loop.state !== null && states.includes(loop.state))) &&
    (!departmentIds || departmentIds.includes(loop.loop.performerDepartmentId)) &&
    (milestoneId === undefined || loop.loop.milestoneId === milestoneId) &&
    (folded === null ||
      foldForSearch(loop.loop.title).includes(folded) ||
      loop.acts.some((act) => act.quote !== null && foldForSearch(act.quote).includes(folded)));
  const filters = {
    states: states ? [...states].sort() : null,
    departmentIds: departmentIds ? [...departmentIds].sort() : null,
    milestoneId: milestoneId ?? null,
    query: query ?? null,
  };
  return loopPage(db, ctx, input, 'loops', filters, (engine) => engine.loops.filter(matches));
}

export async function getLoop(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof GetLoopInputSchema>,
): Promise<GetLoopResult> {
  requireScope(ctx, 'project:read');
  const parsed = GetLoopInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid loop read', parsed.error);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const resolved = await resolveView(tx, ctx, input.projectId, input.view);
    const T = evaluationTime(resolved.snapshot, input.T);
    const loop = (await evaluate(tx, resolved, T)).loops.find(
      (item) => item.loop.id === input.loopId,
    );
    if (!loop) throw new AppError('NOT_FOUND', 'Loop not found');
    return { ...pageFields(resolved, ctx), T, loop };
  }, READ_ONLY);
}

export async function listMilestones(
  db: Db,
  ctx: ActorContext,
  raw: z.input<typeof ListMilestonesInputSchema>,
): Promise<ListMilestonesResult> {
  requireScope(ctx, 'project:read');
  const parsed = ListMilestonesInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid milestone list', parsed.error);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const resolved = await resolveView(tx, ctx, input.projectId, input.view);
    const key = bindView('milestones', resolved);
    const { T, offset, engine } = await evaluatePage(tx, resolved, input, key);
    const page: ListMilestonesResult = { ...pageFields(resolved, ctx), T, items: [] };
    const { taken, next } = takePage(engine.milestones, offset, input.limit, {
      ...page,
      nextCursor: encodeCursor({ view: key, T, o: engine.milestones.length }),
    });
    page.items = taken;
    page.nextCursor = next === null ? null : encodeCursor({ view: key, T, o: next });
    return page;
  }, READ_ONLY);
}
