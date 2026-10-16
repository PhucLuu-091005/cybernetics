import { z } from 'zod';

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
