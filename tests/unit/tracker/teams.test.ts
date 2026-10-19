import { describe, expect, it } from 'vitest';
import { collapsedTeams, openTeams, teamsOfOps } from '../../../src/tracker/teams';
import { larkspurState } from '../../support/tracker-fixture';

describe('collapsedTeams', () => {
  const state = larkspurState();
  const base = { toggles: new Map(), active: false };

  it('opens every team by default', () => {
    expect(collapsedTeams(state, base).size).toBe(0);
  });

  it("lets the person's own toggle win over the default", () => {
    const toggles = new Map([
      ['engineering', false],
      ['implementation', true],
    ]);
    const collapsed = collapsedTeams(state, { ...base, toggles });
    expect([...collapsed]).toEqual(['engineering']);
  });

  it('opens every team while search, filters or a focus are active, and keeps the toggles', () => {
    const toggles = new Map([['engineering', false]]);
    expect(collapsedTeams(state, { ...base, toggles, active: true }).size).toBe(0);
    expect(collapsedTeams(state, { ...base, toggles }).has('engineering')).toBe(true);
  });

  it('collapses a team that the person collapses while the filters are active', () => {
    const collapsed = collapsedTeams(state, {
      ...base,
      active: true,
      activeToggles: new Map([
        ['it', false],
        ['engineering', true],
      ]),
    });
    expect([...collapsed]).toEqual(['it']);
  });
});

describe('teamsOfOps', () => {
  const state = larkspurState();

  it('names the team of every work item an op targets, or the team it lands in', () => {
    expect(
      teamsOfOps(state, [
        { op: 'place', a: { itemId: 'q1', teamId: 'digitization-qa' } },
        { op: 'team', a: { workItemId: 'pg203', teamId: 'it' } },
        { op: 'attach', a: { eventId: 'q-ev', workItemId: 'golive' } },
        { op: 'move', a: { eventId: 'p31', to: 'analyse' } },
        { op: 'rename', a: { workItemId: 'incident', title: 'New' } },
        {
          op: 'fromEvent',
          a: {
            id: 'w2',
            eventId: 'e1',
            teamId: 'digitization-qa',
            title: 'T',
            doneBy: 'p',
            requestedBy: 'p',
            after: [],
            plannedFinish: '2026-10-20',
          },
        },
      ]),
    ).toEqual(['digitization-qa', 'it', 'implementation', 'digitization', 'customer-success']);
  });

  it('takes the work item of an added event', () => {
    const ev = { ...state.events.find((e) => e.workItemId === 'crs')!, id: 'new' };
    expect(teamsOfOps(state, [{ op: 'addEvent', a: { workItemId: 'crs', ev } }])).toEqual([
      'implementation',
    ]);
  });
});

describe('openTeams', () => {
  const view = { toggles: new Map<string, boolean>() };

  it('stores an open toggle for a collapsed team when the graph is whole', () => {
    const collapsed = { toggles: new Map([['implementation', false]]) };
    expect(openTeams(larkspurState(), collapsed, ['implementation', 'engineering'], false)).toEqual(
      {
        toggles: new Map([['implementation', true]]),
        active: [],
      },
    );
  });

  it('opens a team only for the narrowed graph, so the stored toggles come back', () => {
    expect(openTeams(larkspurState(), view, ['implementation'], true)).toEqual({
      toggles: null,
      active: ['implementation'],
    });
  });

  it('stores nothing for a team that the state does not know yet, as a new team starts open', () => {
    expect(openTeams(larkspurState(), view, ['brand-new'], false).toggles).toBeNull();
  });

  it('changes nothing for a team that is open already', () => {
    expect(openTeams(larkspurState(), view, ['engineering'], false)).toEqual({
      toggles: null,
      active: [],
    });
  });
});
