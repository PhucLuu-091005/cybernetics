import { BreakdownTypeSchema, LoopStateSchema, type BreakdownType, type EngineOutput, type LoopState } from '../../contracts/engine';
import type { Department } from '../../contracts/graph';
import { IdSchema, SideSchema } from '../../contracts/primitives';
import { foldForSearch } from '../../lib/search';

export type GraphFilters = {
  side: Department['side'] | null;
  departmentIds: string[];
  state: LoopState | null;
  breakdown: BreakdownType | null;
  milestoneId: string | null;
  q: string;
  view: 'graph' | 'list';
  loopId: string | null;
  escalationId: string | null;
};

const id = (value: string | null) => IdSchema.safeParse(value).data ?? null;

export function parseFilters(search: URLSearchParams): GraphFilters {
  return {
    side: SideSchema.safeParse(search.get('side')).data ?? null,
    departmentIds: [...new Set(search.getAll('dept').filter(value => id(value) !== null))],
    state: LoopStateSchema.safeParse(search.get('state')).data ?? null,
    breakdown: BreakdownTypeSchema.safeParse(search.get('breakdown')).data ?? null,
    milestoneId: id(search.get('milestone')),
    q: (search.get('q') ?? '').trim().slice(0, 200),
    view: search.get('view') === 'list' ? 'list' : 'graph',
    loopId: id(search.get('loop')),
    escalationId: id(search.get('escalation')),
  };
}

export function filtersToSearch(filters: GraphFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const search = new URLSearchParams(base);
  for (const key of ['side', 'dept', 'state', 'breakdown', 'milestone', 'q', 'view', 'loop', 'escalation']) search.delete(key);
  if (filters.side) search.set('side', filters.side);
  for (const departmentId of filters.departmentIds) search.append('dept', departmentId);
  if (filters.state) search.set('state', filters.state);
  if (filters.breakdown) search.set('breakdown', filters.breakdown);
  if (filters.milestoneId) search.set('milestone', filters.milestoneId);
  if (filters.q) search.set('q', filters.q);
  if (filters.view === 'list') search.set('view', 'list');
  if (filters.loopId) search.set('loop', filters.loopId);
  if (filters.escalationId) search.set('escalation', filters.escalationId);
  return search;
}

/** Visible loop IDs. Escalation focus never hides a loop; `citedLoops` gives the set the graph keeps at full opacity. */
export function applyFilters(engine: EngineOutput, filters: GraphFilters, departments: readonly Department[] = []): Set<string> {
  const sideOf = new Map(departments.map(department => [department.id, department.side]));
  const departmentIds = filters.departmentIds.length ? new Set(filters.departmentIds) : null;
  const q = filters.q ? foldForSearch(filters.q) : null;
  const visible = new Set<string>();
  for (const derived of engine.loops) {
    const { loop } = derived;
    if (filters.side && sideOf.get(loop.performerDepartmentId) !== filters.side) continue;
    if (departmentIds && !departmentIds.has(loop.performerDepartmentId)) continue;
    if (filters.state && derived.state !== filters.state) continue;
    if (filters.breakdown && !derived.breakdowns.some(item => item.type === filters.breakdown)) continue;
    if (filters.milestoneId && loop.milestoneId !== filters.milestoneId) continue;
    if (q !== null && !foldForSearch(loop.title).includes(q) && !derived.acts.some(act => act.quote !== null && foldForSearch(act.quote).includes(q))) continue;
    visible.add(loop.id);
  }
  return visible;
}

export function citedLoops(engine: EngineOutput, actIds: Iterable<string>): Set<string> {
  const cited = new Set(actIds);
  return new Set(engine.loops.filter(derived => derived.acts.some(act => cited.has(act.id))).map(derived => derived.loop.id));
}
