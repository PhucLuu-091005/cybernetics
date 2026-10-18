import type { TrackerState, WorkItem } from './model';

export type FocusNode = { id: string; title: string; teamId: string; children: FocusNode[] };
export type FocusTree = { parent: WorkItem | null; root: FocusNode };

/** Children by parent and by "leads from", so a focus follows the work into other teams. */
function childrenOf(state: TrackerState): Map<string, WorkItem[]> {
  const team = new Map(state.teams.map((t, i) => [t.id, i]));
  const order = new Map(state.workItems.map((w, i) => [w.id, i]));
  const rank = (w: WorkItem) => [team.get(w.teamId) ?? Infinity, order.get(w.id)!];
  const sorted = [...state.workItems].sort((a, b) => {
    const [ta, oa] = rank(a);
    const [tb, ob] = rank(b);
    return ta - tb || oa - ob;
  });
  const map = new Map<string, WorkItem[]>();
  for (const w of sorted) {
    for (const up of new Set(w.parentId ? [w.parentId, ...w.after] : w.after))
      map.set(up, [...(map.get(up) ?? []), w]);
  }
  return map;
}

/** Breadth first, so each descendant sits under its nearest parent and shows once. */
export function focusTree(state: TrackerState, id: string): FocusTree | null {
  const item = state.workItems.find((w) => w.id === id);
  if (!item) return null;
  const children = childrenOf(state);
  const node = (w: WorkItem): FocusNode => ({
    id: w.id,
    title: w.title,
    teamId: w.teamId,
    children: [],
  });
  const root = node(item);
  const seen = new Set([id]);
  const todo = [root];
  while (todo.length) {
    const at = todo.shift()!;
    for (const w of children.get(at.id) ?? []) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      const next = node(w);
      at.children.push(next);
      todo.push(next);
    }
  }
  const parent = state.workItems.find((w) => w.id === item.parentId) ?? null;
  return { parent, root };
}

export function descendantsOf(state: TrackerState, id: string): Set<string> {
  const tree = focusTree(state, id);
  const ids = new Set<string>();
  const walk = (n: FocusNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  if (tree) walk(tree.root);
  return ids;
}
