import { z } from 'zod';
import type { Density, TeamToggles, TrackerState } from '../../tracker';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ViewState = { hiddenRows: string[]; hiddenTeams: string[] };

export const EMPTY_VIEW: ViewState = { hiddenRows: [], hiddenTeams: [] };

const MAX_IDS = 500;
const Ids = z.array(z.string().min(1).max(100)).max(MAX_IDS);
const StoredSchema = z.strictObject({ v: z.literal(1), rows: Ids, teams: Ids });

export const viewKey = (projectId: string) => `promise-graph:tracker-view:v1:${projectId}`;

/** Private windows and blocked site data make storage missing or throwing; the graph then shows every row. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readViewState(store: KeyValueStore | null, projectId: string): ViewState {
  try {
    const raw = store?.getItem(viewKey(projectId));
    if (!raw) return EMPTY_VIEW;
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return EMPTY_VIEW;
    return { hiddenRows: parsed.data.rows, hiddenTeams: parsed.data.teams };
  } catch {
    return EMPTY_VIEW;
  }
}

const newest = (ids: readonly string[]) => [...new Set(ids)].slice(-MAX_IDS);

export function writeViewState(
  store: KeyValueStore | null,
  projectId: string,
  view: ViewState,
): void {
  try {
    if (!view.hiddenRows.length && !view.hiddenTeams.length) {
      store?.removeItem(viewKey(projectId));
      return;
    }
    const value = { v: 1, rows: newest(view.hiddenRows), teams: newest(view.hiddenTeams) };
    store?.setItem(viewKey(projectId), JSON.stringify(value));
  } catch {
    // A full or blocked store keeps the hidden rows for this page view only.
  }
}

export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

export function revealRows(
  view: ViewState,
  ids: readonly string[],
  teamOf: (id: string) => string | null,
): ViewState {
  const teams = new Set(ids.map(teamOf).filter((t): t is string => t !== null));
  return {
    hiddenRows: view.hiddenRows.filter((id) => !ids.includes(id)),
    hiddenTeams: view.hiddenTeams.filter((id) => !teams.has(id)),
  };
}

export type HiddenList = {
  teams: Array<{ id: string; name: string; items: number }>;
  items: Array<{ id: string; title: string; team: string }>;
  count: number;
};

/** Ids of deleted teams or work items stay in storage, so the list and its count skip them. */
export function hiddenList(state: TrackerState, view: ViewState): HiddenList {
  const teams = state.teams
    .filter((t) => view.hiddenTeams.includes(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      items: state.workItems.filter((w) => w.teamId === t.id).length,
    }));
  const items = state.workItems
    .filter((w) => view.hiddenRows.includes(w.id))
    .map((w) => ({
      id: w.id,
      title: w.title,
      team: state.teams.find((t) => t.id === w.teamId)?.name ?? '',
    }));
  return { teams, items, count: teams.length + items.length };
}

export function keepFocus(
  focus: string | null,
  view: ViewState,
  teamOf: (id: string) => string | null,
): string | null {
  if (!focus || view.hiddenRows.includes(focus)) return null;
  const team = teamOf(focus);
  return team && view.hiddenTeams.includes(team) ? null : focus;
}

const noticeKey = (userId: string) => `promise-graph:main-notice-off:v1:${userId}`;

export function readNoticeOff(store: KeyValueStore | null, userId: string): boolean {
  try {
    return store?.getItem(noticeKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeNoticeOff(store: KeyValueStore | null, userId: string): void {
  try {
    store?.setItem(noticeKey(userId), '1');
  } catch {
    // Without storage the notice stays closed for this page view only.
  }
}

export const densityKey = (userId: string) => `promise-graph:row-height:v1:${userId}`;
const DENSITY_VALUES: readonly Density[] = ['comfortable', 'compact', 'dense'];

export function readDensity(store: KeyValueStore | null, userId: string): Density {
  try {
    const raw = store?.getItem(densityKey(userId));
    return DENSITY_VALUES.find((d) => d === raw) ?? 'compact';
  } catch {
    return 'compact';
  }
}

export function writeDensity(store: KeyValueStore | null, userId: string, density: Density): void {
  try {
    store?.setItem(densityKey(userId), density);
  } catch {
    // Without storage the row height holds for this page view only.
  }
}

export const legendKey = (userId: string) => `promise-graph:legend:v1:${userId}`;

/** The stored choice wins; without one the legend opens on a desktop, as it would cover a phone. */
export function readLegendOpen(
  store: KeyValueStore | null,
  userId: string,
  { phone }: { phone: boolean },
): boolean {
  try {
    const raw = store?.getItem(legendKey(userId));
    if (raw === 'open' || raw === 'closed') return raw === 'open';
  } catch {
    // Without storage the width decides.
  }
  return !phone;
}

export function writeLegendOpen(store: KeyValueStore | null, userId: string, open: boolean): void {
  try {
    store?.setItem(legendKey(userId), open ? 'open' : 'closed');
  } catch {
    // Without storage the legend holds its state for this page view only.
  }
}

export const teamOpenKey = (projectId: string) => `promise-graph:team-open:v1:${projectId}`;
const TeamsSchema = z.strictObject({ v: z.literal(1), open: Ids, closed: Ids });

export function readTeamOpen(store: KeyValueStore | null, projectId: string): Map<string, boolean> {
  try {
    const raw = store?.getItem(teamOpenKey(projectId));
    const parsed = raw ? TeamsSchema.safeParse(JSON.parse(raw)) : null;
    if (!parsed?.success) return new Map();
    return new Map([
      ...parsed.data.open.map((id) => [id, true] as const),
      ...parsed.data.closed.map((id) => [id, false] as const),
    ]);
  } catch {
    return new Map();
  }
}

export function writeTeamOpen(
  store: KeyValueStore | null,
  projectId: string,
  toggles: TeamToggles,
): void {
  const pick = (open: boolean) =>
    newest([...toggles].filter(([, v]) => v === open).map(([id]) => id));
  try {
    store?.setItem(
      teamOpenKey(projectId),
      JSON.stringify({ v: 1, open: pick(true), closed: pick(false) }),
    );
  } catch {
    // Without storage the toggles hold for this page view only.
  }
}
