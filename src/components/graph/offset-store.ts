import { z } from 'zod';
import type { LayoutOffsets } from '../../lib/graph-layout';

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// The snapshot caps: 3,000 acts and 300 loops.
const MAX_ACTS = 3000,
  MAX_LOOPS = 300;
const StoredSchema = z.strictObject({
  v: z.literal(1),
  acts: z.record(z.string(), z.number().min(0).max(1)),
  loops: z.record(z.string(), z.number().finite()),
  cards: z
    .record(z.string(), z.strictObject({ dx: z.number().finite(), dy: z.number().finite() }))
    .optional(),
});
const empty = (): LayoutOffsets => ({ acts: {}, loops: {} });

export const offsetKey = (projectId: string) => `promise-graph:layout:v1:${projectId}`;

/** Private windows and blocked site data make storage missing or throwing; the graph then runs without saved positions. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readOffsets(store: KeyValueStore | null, projectId: string): LayoutOffsets {
  try {
    const raw = store?.getItem(offsetKey(projectId));
    if (!raw) return empty();
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return empty();
    const { acts, loops, cards } = parsed.data;
    return cards && Object.keys(cards).length ? { acts, loops, cards } : { acts, loops };
  } catch {
    return empty();
  }
}

// Object keys keep insertion order and withOffset re-inserts a dragged ID, so the tail is the newest.
const newest = (entries: Record<string, number>, max: number) =>
  Object.fromEntries(Object.entries(entries).slice(-max));

export function writeOffsets(
  store: KeyValueStore | null,
  projectId: string,
  offsets: LayoutOffsets,
): void {
  try {
    if (!hasOffsets(offsets)) {
      store?.removeItem(offsetKey(projectId));
      return;
    }
    const cards = Object.fromEntries(Object.entries(offsets.cards ?? {}).slice(-MAX_ACTS));
    const value = {
      v: 1,
      acts: newest(offsets.acts, MAX_ACTS),
      loops: newest(offsets.loops, MAX_LOOPS),
      ...(Object.keys(cards).length ? { cards } : {}),
    };
    store?.setItem(offsetKey(projectId), JSON.stringify(value));
  } catch {
    // A full or blocked store keeps the positions for this page view only.
  }
}

export function withOffset(
  offsets: LayoutOffsets,
  kind: 'acts' | 'loops',
  id: string,
  value: number,
): LayoutOffsets {
  const rest = { ...offsets[kind] };
  delete rest[id];
  return { ...offsets, [kind]: { ...rest, [id]: value } };
}

export const hasOffsets = (offsets: LayoutOffsets) =>
  Object.keys(offsets.acts).length > 0 ||
  Object.keys(offsets.loops).length > 0 ||
  Object.keys(offsets.cards ?? {}).length > 0;

/** A card moved on its own; the newest move goes last, like withOffset. */
export function withCardOffset(
  offsets: LayoutOffsets,
  id: string,
  value: { dx: number; dy: number },
): LayoutOffsets {
  const rest = { ...offsets.cards };
  delete rest[id];
  return { ...offsets, cards: { ...rest, [id]: value } };
}
