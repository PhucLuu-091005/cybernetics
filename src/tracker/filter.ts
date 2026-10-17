import type { RowMatch } from './layout';
import type { Status, TrackerState } from './model';
import { foldText } from './search';
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

export function matchRows(
  state: TrackerState,
  f: RowFilter,
  asOf: string,
  timeZone: string,
): RowMatch | null {
  if (!isFiltering(f)) return null;
  const terms = termsOf(f.text);
  const match = new Set(
    state.workItems
      .filter(
        (w) =>
          among(f.teams, w.teamId) &&
          among(f.milestones, w.milestoneId ?? NO_MILESTONE) &&
          among(f.people, w.doneBy, w.requestedBy) &&
          terms.every((t) => foldText(w.title).includes(t)) &&
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
