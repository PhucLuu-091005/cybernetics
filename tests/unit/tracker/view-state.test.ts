import { describe, expect, it } from 'vitest';
import {
  EMPTY_VIEW,
  readNoticeOff,
  readViewState,
  revealRows,
  toggleId,
  viewKey,
  writeNoticeOff,
  writeViewState,
  type KeyValueStore,
} from '../../../src/components/tracker/view-state';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('tracker view state', () => {
  it('reads the empty state when nothing is stored', () => {
    expect(readViewState(memoryStore(), 'p1')).toEqual(EMPTY_VIEW);
  });

  it('round-trips hidden rows and teams for one project', () => {
    const store = memoryStore();
    writeViewState(store, 'p1', { hiddenRows: ['pg203'], hiddenTeams: ['it', 'engineering'] });
    expect(readViewState(store, 'p1')).toEqual({
      hiddenRows: ['pg203'],
      hiddenTeams: ['it', 'engineering'],
    });
  });

  it('keeps each project apart', () => {
    const store = memoryStore();
    writeViewState(store, 'p1', { hiddenRows: ['a'], hiddenTeams: [] });
    writeViewState(store, 'p2', { hiddenRows: [], hiddenTeams: ['b'] });
    expect(readViewState(store, 'p1')).toEqual({ hiddenRows: ['a'], hiddenTeams: [] });
    expect(readViewState(store, 'p2')).toEqual({ hiddenRows: [], hiddenTeams: ['b'] });
    expect(viewKey('p1')).not.toBe(viewKey('p2'));
  });

  it('removes the key when nothing is hidden', () => {
    const store = memoryStore();
    writeViewState(store, 'p1', { hiddenRows: ['a'], hiddenTeams: [] });
    writeViewState(store, 'p1', EMPTY_VIEW);
    expect(store.data.has(viewKey('p1'))).toBe(false);
  });

  it('drops duplicates on write', () => {
    const store = memoryStore();
    writeViewState(store, 'p1', { hiddenRows: ['a', 'a', 'b'], hiddenTeams: ['t', 't'] });
    expect(readViewState(store, 'p1')).toEqual({ hiddenRows: ['a', 'b'], hiddenTeams: ['t'] });
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a wrong version', JSON.stringify({ v: 2, rows: [], teams: [] })],
    ['a wrong shape', JSON.stringify({ v: 1, rows: 'pg203', teams: [] })],
    ['an extra field', JSON.stringify({ v: 1, rows: [], teams: [], more: 1 })],
    ['a blank id', JSON.stringify({ v: 1, rows: [''], teams: [] })],
  ])('reads the empty state from %s', (_label, raw) => {
    const store = memoryStore();
    store.setItem(viewKey('p1'), raw);
    expect(readViewState(store, 'p1')).toEqual(EMPTY_VIEW);
  });

  it('survives a missing or throwing store', () => {
    expect(readViewState(null, 'p1')).toEqual(EMPTY_VIEW);
    expect(readViewState(throwing, 'p1')).toEqual(EMPTY_VIEW);
    expect(() =>
      writeViewState(throwing, 'p1', { hiddenRows: ['a'], hiddenTeams: [] }),
    ).not.toThrow();
    expect(() => writeViewState(throwing, 'p1', EMPTY_VIEW)).not.toThrow();
    expect(() => writeViewState(null, 'p1', EMPTY_VIEW)).not.toThrow();
  });

  it('keeps the newest 500 ids of each list', () => {
    const store = memoryStore();
    const ids = Array.from({ length: 600 }, (_, i) => `w${i}`);
    writeViewState(store, 'p1', { hiddenRows: ids, hiddenTeams: [] });
    const read = readViewState(store, 'p1');
    expect(read.hiddenRows).toHaveLength(500);
    expect(read.hiddenRows[0]).toBe('w100');
    expect(read.hiddenRows.at(-1)).toBe('w599');
  });

  it('toggles an id in and out of a list without changing the input', () => {
    const list = ['a'];
    expect(toggleId(list, 'b')).toEqual(['a', 'b']);
    expect(toggleId(list, 'a')).toEqual([]);
    expect(list).toEqual(['a']);
  });

  it('shows the given rows and the teams that hold them', () => {
    const view = { hiddenRows: ['a', 'b', 'c'], hiddenTeams: ['t1', 't2'] };
    const teamOf = (id: string) => ({ a: 't1', b: 't9' })[id] ?? null;
    expect(revealRows(view, ['a', 'b'], teamOf)).toEqual({
      hiddenRows: ['c'],
      hiddenTeams: ['t2'],
    });
  });

  it('remembers "Don\'t show again" for the Main notice per user, and works without storage', () => {
    const store = memoryStore();
    expect(readNoticeOff(store, 'u1')).toBe(false);
    writeNoticeOff(store, 'u1');
    expect(readNoticeOff(store, 'u1')).toBe(true);
    expect(readNoticeOff(store, 'u2')).toBe(false);
    expect(() => writeNoticeOff(throwing, 'u1')).not.toThrow();
    expect(readNoticeOff(throwing, 'u1')).toBe(false);
    expect(readNoticeOff(null, 'u1')).toBe(false);
  });
});
