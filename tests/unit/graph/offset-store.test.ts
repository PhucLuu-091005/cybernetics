import { describe, expect, it } from 'vitest';
import {
  hasOffsets,
  withCardOffset,
  offsetKey,
  readOffsets,
  withOffset,
  writeOffsets,
  type KeyValueStore,
} from '../../../src/components/graph/offset-store';

const memory = () => {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { map, store };
};
const broken: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};
const P = 'project-1';

describe('offset store', () => {
  it('round-trips offsets per project', () => {
    const { store } = memory();
    const offsets = { acts: { a: 0.25 }, loops: { l: -12 } };
    writeOffsets(store, P, offsets);
    expect(readOffsets(store, P)).toEqual(offsets);
    expect(readOffsets(store, 'project-2')).toEqual({ acts: {}, loops: {} });
  });
  it('round-trips card moves and counts them as offsets', () => {
    const { store } = memory();
    const offsets = withCardOffset({ acts: {}, loops: {} }, 'a', { dx: 12, dy: -30 });
    expect(hasOffsets(offsets)).toBe(true);
    writeOffsets(store, P, offsets);
    expect(readOffsets(store, P)).toEqual({
      acts: {},
      loops: {},
      cards: { a: { dx: 12, dy: -30 } },
    });
  });
  it('keeps entries for IDs outside the current layout, so a filtered loop gets its place back', () => {
    const { store } = memory();
    writeOffsets(store, P, { acts: {}, loops: { hidden: 20 } });
    expect(readOffsets(store, P).loops.hidden).toBe(20);
  });
  it('gives empty offsets for invalid JSON, a wrong version, an out-of-range fraction or no store', () => {
    const { map, store } = memory();
    for (const raw of [
      '{',
      JSON.stringify({ v: 2, acts: {}, loops: {} }),
      JSON.stringify({ v: 1, acts: { a: 1.5 }, loops: {} }),
    ]) {
      map.set(offsetKey(P), raw);
      expect(readOffsets(store, P)).toEqual({ acts: {}, loops: {} });
    }
    expect(readOffsets(null, P)).toEqual({ acts: {}, loops: {} });
  });
  it('survives a store that throws', () => {
    expect(readOffsets(broken, P)).toEqual({ acts: {}, loops: {} });
    expect(() => writeOffsets(broken, P, { acts: { a: 0.5 }, loops: {} })).not.toThrow();
  });
  it('removes the key when the offsets are empty', () => {
    const { map, store } = memory();
    writeOffsets(store, P, { acts: { a: 0.5 }, loops: {} });
    writeOffsets(store, P, { acts: {}, loops: {} });
    expect(map.has(offsetKey(P))).toBe(false);
  });
  it('keeps the newest 3,000 acts and 300 loops', () => {
    const { store } = memory();
    let offsets = { acts: {}, loops: {} } as Parameters<typeof withOffset>[0];
    for (let i = 0; i < 3005; i++) offsets = withOffset(offsets, 'acts', `a${i}`, 0.5);
    for (let i = 0; i < 305; i++) offsets = withOffset(offsets, 'loops', `l${i}`, 1);
    writeOffsets(store, P, offsets);
    const read = readOffsets(store, P);
    expect(Object.keys(read.acts)).toHaveLength(3000);
    expect(read.acts.a0).toBeUndefined();
    expect(read.acts.a3004).toBe(0.5);
    expect(Object.keys(read.loops)).toHaveLength(300);
    expect(read.loops.l0).toBeUndefined();
  });
  it('moves a re-dragged ID to the newest position', () => {
    const offsets = withOffset({ acts: { a: 0.1, b: 0.2 }, loops: {} }, 'acts', 'a', 0.3);
    expect(Object.keys(offsets.acts)).toEqual(['b', 'a']);
    expect(hasOffsets(offsets)).toBe(true);
    expect(hasOffsets({ acts: {}, loops: {} })).toBe(false);
  });
});
