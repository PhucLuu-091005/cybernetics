import type { RowMatch } from './layout';
import type { Status, TrackerState } from './model';
import { foldText, searchWorkItems } from './search';
import { itemStatus } from './status';

export const NO_MILESTONE = 'none';

/** A view choice only: it is never saved, and it leaves the hidden lists alone. */
export type RowFilter = {
  statuses: Status[];
  teams: string[];
  /** Milestone ids, and NO_MILESTONE for the work items without one. */
  milestones: string[];
  /** People who do the work item or asked for it. */
  people: string[];
  text: string;
};

export const NO_FILTER: RowFilter = {
  statuses: [],
  teams: [],
  milestones: [],
  people: [],
  text: '',
};

export const filterCount = (f: RowFilter): number =>
  f.statuses.length + f.teams.length + f.milestones.length + f.people.length;

const termsOf = (text: string) => foldText(text).split(/\s+/).filter(Boolean);

export const isFiltering = (f: RowFilter): boolean =>
  filterCount(f) > 0 || termsOf(f.text).length > 0;

const among = <T>(chosen: readonly T[], ...values: T[]) =>
  !chosen.length || values.some((v) => chosen.includes(v));

/** A team, milestone or person of one change request view can be missing in another view. */
export function pruneFilter(state: TrackerState, f: RowFilter): RowFilter {
  const teams = new Set(state.teams.map((t) => t.id));
  const milestones = new Set([...state.milestones.map((m) => m.id), NO_MILESTONE]);
  const people = new Set(state.people.map((p) => p.id));
  const next = {
    ...f,
    teams: f.teams.filter((id) => teams.has(id)),
    milestones: f.milestones.filter((id) => milestones.has(id)),
    people: f.people.filter((id) => people.has(id)),
  };
  return filterCount(next) === filterCount(f) ? f : next;
}

export function matchRows(
  state: TrackerState,
  chosen: RowFilter,
  asOf: string,
  timeZone: string,
): RowMatch | null {
  const f = pruneFilter(state, chosen);
  if (!isFiltering(f)) return null;
  const found = termsOf(f.text).length
    ? new Set(searchWorkItems(state, f.text).map((w) => w.id))
    : null;
  const match = new Set(
    state.workItems
      .filter(
        (w) =>
          among(f.teams, w.teamId) &&
          among(f.milestones, w.milestoneId ?? NO_MILESTONE) &&
          among(f.people, w.doneBy, w.requestedBy) &&
          (!found || found.has(w.id)) &&
          among(f.statuses, itemStatus(w, state.events, asOf, timeZone)),
      )
      .map((w) => w.id),
  );
  const parentOf = new Map(state.workItems.map((w) => [w.id, w.parentId]));
  const context = new Set<string>();
  for (const id of match) {
    const seen = new Set([id]);
    for (
      let up = parentOf.get(id);
      up && parentOf.has(up) && !seen.has(up);
      up = parentOf.get(up)
    ) {
      seen.add(up);
      if (!match.has(up)) context.add(up);
    }
  }
  return { match, context };
}
