import type { Team, TrackerState, WorkItem } from './model';

export type FocusNode = { id: string; title: string; teamId: string; children: FocusNode[] };
type FocusTree = { parent: WorkItem | null; root: FocusNode };

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

const node = (w: WorkItem): FocusNode => ({
  id: w.id,
  title: w.title,
  teamId: w.teamId,
  children: [],
});

/** Breadth first from all roots at once, so each descendant sits under its nearest parent and shows once. */
function grow(roots: FocusNode[], children: Map<string, WorkItem[]>, seen: Set<string>) {
  const todo = [...roots];
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
}

export function focusTree(state: TrackerState, id: string): FocusTree | null {
  const item = state.workItems.find((w) => w.id === id);
  if (!item) return null;
  const root = node(item);
  grow([root], childrenOf(state), new Set([id]));
  const parent = state.workItems.find((w) => w.id === item.parentId) ?? null;
  return { parent, root };
}

type TeamFocusTree = { team: Team; roots: FocusNode[] };

/** A team row that comes from another row of the same team sits under that row, not at the top. */
export function teamFocusTree(state: TrackerState, teamId: string): TeamFocusTree | null {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const children = childrenOf(state);
  const own = state.workItems.filter((w) => w.teamId === teamId);
  const below = new Set<string>();
  for (const w of own)
    for (const id of idsOf(focusTree(state, w.id)!.root)) if (id !== w.id) below.add(id);
  const roots: FocusNode[] = [];
  const seen = new Set<string>();
  const plant = (list: WorkItem[]) => {
    const fresh = list.filter((w) => !seen.has(w.id)).map(node);
    fresh.forEach((n) => seen.add(n.id));
    roots.push(...fresh);
    grow(fresh, children, seen);
  };
  plant(own.filter((w) => !below.has(w.id)));
  // Rows of a loop inside the team come from each other, so none of them is a root above.
  for (const w of own) if (!seen.has(w.id)) plant([w]);
  return { team, roots };
}

function idsOf(root: FocusNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: FocusNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  return ids;
}

export function descendantsOf(state: TrackerState, id: string): Set<string> {
  const tree = focusTree(state, id);
  return tree ? idsOf(tree.root) : new Set();
}

export function teamDescendants(state: TrackerState, teamId: string): Set<string> {
  const tree = teamFocusTree(state, teamId);
  return new Set(tree ? tree.roots.flatMap((r) => [...idsOf(r)]) : []);
}
