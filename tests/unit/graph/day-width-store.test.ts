import { describe, expect, it } from 'vitest';
import {
  dayWidthKey,
  readDayWidths,
  withDayWidth,
  writeDayWidths,
} from '../../../src/components/graph/day-width-store';
import type { KeyValueStore } from '../../../src/components/graph/offset-store';

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

describe('day width store', () => {
  it('round-trips widths per project', () => {
    const { store } = memory();
    writeDayWidths(store, P, { '2026-09-01': 120 });
    expect(readDayWidths(store, P)).toEqual({ '2026-09-01': 120 });
    expect(readDayWidths(store, 'project-2')).toEqual({});
  });
  it('gives no widths for invalid JSON, a wrong version, a width out of range, a bad date or no store', () => {
    const { map, store } = memory();
    for (const raw of [
      '{',
      JSON.stringify({ v: 2, widths: {} }),
      JSON.stringify({ v: 1, widths: { '2026-09-01': 2000 } }),
      JSON.stringify({ v: 1, widths: { soon: 80 } }),
    ]) {
      map.set(dayWidthKey(P), raw);
      expect(readDayWidths(store, P)).toEqual({});
    }
    expect(readDayWidths(null, P)).toEqual({});
  });
  it('survives a store that throws and removes the key when no width is left', () => {
    expect(readDayWidths(broken, P)).toEqual({});
    expect(() => writeDayWidths(broken, P, { '2026-09-01': 90 })).not.toThrow();
    const { map, store } = memory();
    writeDayWidths(store, P, { '2026-09-01': 90 });
    writeDayWidths(store, P, {});
    expect(map.has(dayWidthKey(P))).toBe(false);
  });
  it('clamps a width to 24–480 px and drops a width that equals the default', () => {
    expect(withDayWidth({}, '2026-09-01', 5, 64)).toEqual({ '2026-09-01': 24 });
    expect(withDayWidth({}, '2026-09-01', 900, 64)).toEqual({ '2026-09-01': 480 });
    expect(withDayWidth({ '2026-09-01': 90 }, '2026-09-01', 64, 64)).toEqual({});
    expect(withDayWidth({ '2026-09-01': 90 }, '2026-09-01', null, 64)).toEqual({});
  });
});
