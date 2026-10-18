import type { TrackerState } from './model';
import type { Op } from './ops';
import { itemStatus } from './status';

/** True opens a team, false collapses it. */
export type TeamToggles = ReadonlyMap<string, boolean>;

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

/**
 * A team with a late work item starts open so late work is never out of sight; a person's own
 * toggle wins. While search, filters or a focus narrow the graph every team opens, and toggles made
 * then (`activeToggles`) last only until the graph is whole again.
 */
export function collapsedTeams(
  state: Pick<TrackerState, 'teams' | 'workItems' | 'events'>,
  view: {
    asOf: string;
    timeZone: string;
    toggles: TeamToggles;
    active: boolean;
    activeToggles?: TeamToggles;
  },
): Set<string> {
  if (view.active)
    return new Set(
      state.teams.filter((t) => view.activeToggles?.get(t.id) === false).map((t) => t.id),
    );
  const late = lateTeams(state, view.asOf, view.timeZone);
  return new Set(
    state.teams.filter((t) => !(view.toggles.get(t.id) ?? late.has(t.id))).map((t) => t.id),
  );
}

/** A work item that lands in a collapsed team would vanish from sight, so its team opens. */
export function teamsGivenWork(ops: ReadonlyArray<Pick<Op, 'op' | 'a'>>): string[] {
  const teams = ops.flatMap((o) =>
    o.op === 'place' || o.op === 'fromEvent' || o.op === 'team'
      ? [(o.a as { teamId: string }).teamId]
      : [],
  );
  return [...new Set(teams)];
}
