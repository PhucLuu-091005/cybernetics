import { describe, expect, it } from 'vitest';
import { larkspurState } from '../../support/tracker-fixture';
import {
  EMPTY_VIEW,
  hiddenList,
  keepFocus,
  densityKey,
  legendKey,
  readLegendOpen,
  readDensity,
  readIntroSeen,
  readNoticeOff,
  readTeamOpen,
  readViewState,
  teamOpenKey,
  writeDensity,
  writeLegendOpen,
  writeTeamOpen,
  revealRows,
  toggleId,
  viewKey,
  writeIntroSeen,
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

  it('shows the demo intro once per signed-in user, and never when storage is missing', () => {
    const store = memoryStore();
    expect(readIntroSeen(store, 'u1')).toBe(false);
    writeIntroSeen(store, 'u1');
    expect(readIntroSeen(store, 'u1')).toBe(true);
    expect(readIntroSeen(store, 'u2')).toBe(false);
    expect(() => writeIntroSeen(throwing, 'u1')).not.toThrow();
    expect(readIntroSeen(throwing, 'u1')).toBe(true);
    expect(readIntroSeen(null, 'u1')).toBe(true);
  });

  it('lists hidden teams and hidden work items that still exist, and counts both', () => {
    const list = hiddenList(larkspurState(), {
      hiddenRows: ['pg203', 'gone', 'analyse'],
      hiddenTeams: ['it', 'nope'],
    });
    expect(list).toEqual({
      teams: [{ id: 'it', name: 'IT', items: 2 }],
      items: [
        { id: 'analyse', title: 'Analyse the CRS and FATCA rules', team: 'Digitization' },
        { id: 'pg203', title: 'PG-203 Country list field type', team: 'Engineering' },
      ],
      count: 3,
    });
    expect(hiddenList(larkspurState(), EMPTY_VIEW).count).toBe(0);
  });

  it('ends a focus on a work item that the viewer hides, by row or by team', () => {
    const teamOf = (id: string) => ({ a: 't1', b: 't2' })[id] ?? null;
    expect(keepFocus('a', EMPTY_VIEW, teamOf)).toBe('a');
    expect(keepFocus('a', { hiddenRows: ['a'], hiddenTeams: [] }, teamOf)).toBeNull();
    expect(keepFocus('a', { hiddenRows: [], hiddenTeams: ['t1'] }, teamOf)).toBeNull();
    expect(keepFocus('a', { hiddenRows: ['b'], hiddenTeams: ['t2'] }, teamOf)).toBe('a');
    expect(keepFocus(null, { hiddenRows: ['a'], hiddenTeams: [] }, teamOf)).toBeNull();
  });
});

describe('row height and team toggles', () => {
  it('reads Comfortable when nothing is stored, and round-trips each level per person', () => {
    const store = memoryStore();
    expect(readDensity(store, 'u1')).toBe('comfortable');
    writeDensity(store, 'u1', 'dense');
    writeDensity(store, 'u2', 'compact');
    expect(readDensity(store, 'u1')).toBe('dense');
    expect(readDensity(store, 'u2')).toBe('compact');
    expect(densityKey('u1')).not.toBe(densityKey('u2'));
  });

  it('reads Comfortable from an unknown value or a missing or throwing store', () => {
    const store = memoryStore();
    store.setItem(densityKey('u1'), 'tiny');
    expect(readDensity(store, 'u1')).toBe('comfortable');
    expect(readDensity(null, 'u1')).toBe('comfortable');
    expect(readDensity(throwing, 'u1')).toBe('comfortable');
    expect(() => writeDensity(throwing, 'u1', 'dense')).not.toThrow();
  });

  it('round-trips the open and collapsed teams of one project', () => {
    const store = memoryStore();
    writeTeamOpen(
      store,
      'p1',
      new Map([
        ['it', false],
        ['implementation', true],
      ]),
    );
    expect(readTeamOpen(store, 'p1')).toEqual(
      new Map([
        ['implementation', true],
        ['it', false],
      ]),
    );
    expect(readTeamOpen(store, 'p2').size).toBe(0);
    expect(teamOpenKey('p1')).not.toBe(teamOpenKey('p2'));
  });

  it.each([
    ['text that is not JSON', 'nope'],
    ['a wrong version', JSON.stringify({ v: 2, open: [], closed: [] })],
    ['a wrong shape', JSON.stringify({ v: 1, open: 'it', closed: [] })],
  ])('reads no toggles from %s', (_label, raw) => {
    const store = memoryStore();
    store.setItem(teamOpenKey('p1'), raw);
    expect(readTeamOpen(store, 'p1').size).toBe(0);
  });

  it('survives a missing or throwing store for the team toggles', () => {
    expect(readTeamOpen(null, 'p1').size).toBe(0);
    expect(readTeamOpen(throwing, 'p1').size).toBe(0);
    expect(() => writeTeamOpen(throwing, 'p1', new Map([['it', true]]))).not.toThrow();
  });
});

describe('legend popover', () => {
  it('opens on a desktop and stays closed on a phone when nothing is stored', () => {
    const store = memoryStore();
    expect(readLegendOpen(store, 'u1', { phone: false })).toBe(true);
    expect(readLegendOpen(store, 'u1', { phone: true })).toBe(false);
  });

  it('remembers closed and open again per person, and the stored choice wins on both widths', () => {
    const store = memoryStore();
    writeLegendOpen(store, 'u1', false);
    expect(readLegendOpen(store, 'u1', { phone: false })).toBe(false);
    expect(readLegendOpen(store, 'u2', { phone: false })).toBe(true);
    writeLegendOpen(store, 'u1', true);
    expect(readLegendOpen(store, 'u1', { phone: false })).toBe(true);
    expect(readLegendOpen(store, 'u1', { phone: true })).toBe(true);
    expect(legendKey('u1')).not.toBe(legendKey('u2'));
  });

  it('falls back to the width default from an unknown value or a missing or throwing store', () => {
    const store = memoryStore();
    store.setItem(legendKey('u1'), 'maybe');
    expect(readLegendOpen(store, 'u1', { phone: false })).toBe(true);
    expect(readLegendOpen(store, 'u1', { phone: true })).toBe(false);
    expect(readLegendOpen(null, 'u1', { phone: false })).toBe(true);
    expect(readLegendOpen(throwing, 'u1', { phone: true })).toBe(false);
    expect(() => writeLegendOpen(throwing, 'u1', false)).not.toThrow();
    expect(() => writeLegendOpen(null, 'u1', false)).not.toThrow();
  });
});
