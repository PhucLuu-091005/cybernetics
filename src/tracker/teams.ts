import type { TrackerState } from './model';
import type { Marks, Op } from './ops';
import { itemStatus } from './status';

/** True opens a team, false collapses it. */
export type TeamToggles = ReadonlyMap<string, boolean>;

type TeamState = Pick<TrackerState, 'teams' | 'workItems' | 'events'>;
type DefaultView = {
  asOf: string;
  timeZone: string;
  toggles: TeamToggles;
  /** Teams that hold a change of the change request on screen. */
  changed?: ReadonlySet<string>;
};

export function lateTeams(
  state: Pick<TrackerState, 'workItems' | 'events'>,
  asOf: string,
  timeZone: string,
): Set<string> {
  return new Set(
    state.workItems
      .filter((w) => itemStatus(w, state.events, asOf, timeZone) === 'late')
      .map((w) => w.teamId),
  );
}

export function changedTeams(
  state: Pick<TrackerState, 'workItems' | 'events'>,
  marks: Marks | undefined,
): Set<string> {
  if (!marks) return new Set();
  const items = new Set([
    ...marks.workItems,
    ...[...marks.dates].filter((k) => !k.startsWith('ms:')),
  ]);
  for (const e of state.events) if (marks.events.has(e.id)) items.add(e.workItemId);
  return new Set(state.workItems.filter((w) => items.has(w.id)).map((w) => w.teamId));
}

/**
 * A team with a late work item or a change starts open, so neither is out of sight; a person's own
 * toggle wins. While search, filters or a focus narrow the graph every team opens, and toggles made
 * then (`activeToggles`) last only until the graph is whole again.
 */
export function collapsedTeams(
  state: TeamState,
  view: DefaultView & { active: boolean; activeToggles?: TeamToggles },
): Set<string> {
  if (view.active)
    return new Set(
      state.teams.filter((t) => view.activeToggles?.get(t.id) === false).map((t) => t.id),
    );
  const late = lateTeams(state, view.asOf, view.timeZone);
  const open = (id: string) => view.toggles.get(id) ?? (late.has(id) || !!view.changed?.has(id));
  return new Set(state.teams.filter((t) => !open(t.id)).map((t) => t.id));
}

/**
 * Opening a team for a row the person asked for. On a narrowed graph the opening is temporary, so
 * the stored toggles come back once the graph is whole; `toggles` is null when nothing is stored.
 */
export function openTeams(
  state: TeamState,
  view: DefaultView,
  teams: readonly string[],
  narrowed: boolean,
): { toggles: Map<string, boolean> | null; active: string[] } {
  if (narrowed) return { toggles: null, active: [...new Set(teams)] };
  const quiet = collapsedTeams(state, { ...view, active: false });
  const known = new Set(state.teams.map((t) => t.id));
  const shut = [...new Set(teams)].filter((t) => quiet.has(t) || !known.has(t));
  if (!shut.length) return { toggles: null, active: [] };
  return {
    toggles: new Map([...view.toggles, ...shut.map((t) => [t, true] as const)]),
    active: [],
  };
}

/** An op that lands work in a collapsed team would hide its own result, so its team opens. */
export function teamsOfOps(
  state: Pick<TrackerState, 'workItems'>,
  ops: ReadonlyArray<Pick<Op, 'op' | 'a'>>,
): string[] {
  const teamOf = (id: unknown) => state.workItems.find((w) => w.id === id)?.teamId;
  const teams = ops.map((o) => {
    const a = o.a as { teamId?: string; workItemId?: string; to?: string };
    return a.teamId ?? teamOf(a.workItemId) ?? teamOf(a.to);
  });
  return [...new Set(teams.filter((t): t is string => !!t))];
}
