import { describe, expect, it } from 'vitest';
import {
  filterCount,
  isFiltering,
  matchRows,
  NO_FILTER,
  NO_MILESTONE,
  type RowFilter,
} from '../../../src/tracker/filter';
import {
  AS_OF,
  TIME_ZONE,
  at,
  buildState,
  event,
  larkspurState,
  workItem,
} from '../../support/tracker-fixture';

const filter = (over: Partial<RowFilter>): RowFilter => ({ ...NO_FILTER, ...over });
const ids = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort();

const state = buildState({
  people: [
    { id: 'ann', name: 'Ann Lê' },
    { id: 'bo', name: 'Bo Phạm' },
  ],
  teams: [
    { id: 't1', name: 'One', leadId: null },
    { id: 't2', name: 'Two', leadId: null },
  ],
  milestones: [
    { id: 'm', name: 'M', planned: '2026-10-20', firstPlanned: '2026-10-20', moves: [] },
  ],
  workItems: [
    workItem({
      id: 'root',
      title: 'Root plan',
      teamId: 't1',
      doneBy: 'ann',
      requestedBy: 'ann',
      plannedFinish: '2026-10-30',
    }),
    workItem({
      id: 'mid',
      title: 'Middle step',
      teamId: 't1',
      parentId: 'root',
      doneBy: 'ann',
      requestedBy: 'ann',
      plannedFinish: '2026-10-30',
    }),
    workItem({
      id: 'leaf',
      title: 'Phạm leaf work',
      teamId: 't2',
      parentId: 'mid',
      milestoneId: 'm',
      doneBy: 'bo',
      requestedBy: 'ann',
      plannedFinish: '2026-10-01',
    }),
    workItem({
      id: 'done',
      title: 'Finished thing',
      teamId: 't2',
      doneBy: 'ann',
      requestedBy: 'bo',
      plannedFinish: '2026-10-08',
    }),
  ],
  events: [
    event({ id: 'l1', workItemId: 'leaf', at: at('2026-09-20T09:00') }),
    event({ id: 'd1', workItemId: 'done', kind: 'done', at: at('2026-10-02T09:00') }),
  ],
});
const run = (f: RowFilter) => matchRows(state, f, AS_OF, TIME_ZONE);

describe('row filters', () => {
  it('filters nothing without a value or text', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering(filter({ text: '   ' }))).toBe(false);
    expect(run(NO_FILTER)).toBeNull();
    expect(run(filter({ text: '  ' }))).toBeNull();
  });

  it('counts the chosen values, not the text', () => {
    expect(filterCount(filter({ statuses: ['late', 'planned'], teams: ['t1'], text: 'x' }))).toBe(
      3,
    );
    expect(isFiltering(filter({ text: 'x' }))).toBe(true);
  });

  it('matches by status, by team, by milestone and by person', () => {
    expect(ids(run(filter({ statuses: ['late'] }))?.match)).toEqual(['leaf']);
    expect(ids(run(filter({ statuses: ['early', 'late'] }))?.match)).toEqual(['done', 'leaf']);
    expect(ids(run(filter({ teams: ['t2'] }))?.match)).toEqual(['done', 'leaf']);
    expect(ids(run(filter({ milestones: ['m'] }))?.match)).toEqual(['leaf']);
    expect(ids(run(filter({ milestones: [NO_MILESTONE] }))?.match)).toEqual([
      'done',
      'mid',
      'root',
    ]);
    expect(ids(run(filter({ people: ['bo'] }))?.match)).toEqual(['done', 'leaf']);
  });

  it('needs every kind of filter to match, and any value inside one kind', () => {
    expect(
      ids(run(filter({ teams: ['t2'], people: ['ann'], statuses: ['early'] }))?.match),
    ).toEqual(['done']);
    expect(ids(run(filter({ teams: ['t1'], milestones: ['m'] }))?.match)).toEqual([]);
  });

  it('matches the text against the title only, without case or Vietnamese marks', () => {
    expect(ids(run(filter({ text: 'pham' }))?.match)).toEqual(['leaf']);
    expect(ids(run(filter({ text: 'ROOT plan' }))?.match)).toEqual(['root']);
    expect(ids(run(filter({ text: 'ann' }))?.match)).toEqual([]);
  });

  it('keeps the parents of a match as context, up to the top', () => {
    const found = run(filter({ milestones: ['m'] }));
    expect(ids(found?.match)).toEqual(['leaf']);
    expect(ids(found?.context)).toEqual(['mid', 'root']);
    expect(ids(run(filter({ teams: ['t1'] }))?.context)).toEqual([]);
  });

  it('survives a parent loop', () => {
    const loop = buildState({
      ...state,
      workItems: [
        workItem({ id: 'a', teamId: 't1', parentId: 'b' }),
        workItem({ id: 'b', teamId: 't1', parentId: 'a', title: 'b match' }),
      ],
    });
    const found = matchRows(loop, filter({ text: 'match' }), AS_OF, TIME_ZONE);
    expect(ids(found?.match)).toEqual(['b']);
    expect(ids(found?.context)).toEqual(['a']);
  });

  it('works on the demo project', () => {
    const found = matchRows(larkspurState(), filter({ text: 'PG-203' }), AS_OF, TIME_ZONE);
    expect(ids(found?.match)).toEqual(['pg203']);
    expect(ids(found?.context)).toEqual(['crs']);
  });
});
