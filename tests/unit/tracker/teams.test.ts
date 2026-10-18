import { describe, expect, it } from 'vitest';
import {
  changedTeams,
  collapsedTeams,
  lateTeams,
  openTeams,
  teamsOfOps,
} from '../../../src/tracker/teams';
import {
  AS_OF,
  TIME_ZONE,
  at,
  buildState,
  event,
  larkspurState,
  workItem,
} from '../../support/tracker-fixture';

const TEAMS = [
  'implementation',
  'digitization',
  'solutions-engineering',
  'engineering',
  'digitization-qa',
  'customer-success',
  'it',
];

describe('lateTeams', () => {
  it('lists the teams with an open work item past its planned finish', () => {
    const late = lateTeams(larkspurState(), AS_OF, TIME_ZONE);
    expect([...late].sort()).toEqual(['customer-success', 'engineering', 'it']);
  });

  it('does not count a work item that finished late', () => {
    const s = buildState({
      teams: [{ id: 't', name: 'Team', leadId: null }],
      workItems: [workItem({ id: 'a', teamId: 't', plannedFinish: '2026-10-01' })],
      events: [event({ id: 'd', workItemId: 'a', kind: 'done', at: at('2026-10-05T09:00') })],
    });
    expect(lateTeams(s, AS_OF, TIME_ZONE).size).toBe(0);
  });
});

describe('collapsedTeams', () => {
  const state = larkspurState();
  const base = { asOf: AS_OF, timeZone: TIME_ZONE, toggles: new Map(), active: false };

  it('opens a team with a late work item and collapses the others by default', () => {
    const collapsed = collapsedTeams(state, base);
    expect(TEAMS.filter((t) => !collapsed.has(t))).toEqual([
      'engineering',
      'customer-success',
      'it',
    ]);
  });

  it("lets the person's own toggle win over the default", () => {
    const toggles = new Map([
      ['engineering', false],
      ['implementation', true],
    ]);
    const collapsed = collapsedTeams(state, { ...base, toggles });
    expect(collapsed.has('engineering')).toBe(true);
    expect(collapsed.has('implementation')).toBe(false);
    expect(collapsed.has('digitization')).toBe(true);
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

describe('changedTeams', () => {
  it('lists the teams that hold a changed row, event or planned finish', () => {
    const marks = {
      workItems: new Set(['golive']),
      events: new Set(['p31']),
      milestones: new Set(['golive']),
      dates: new Set(['secret', 'ms:golive']),
    };
    expect([...changedTeams(larkspurState(), marks)].sort()).toEqual([
      'engineering',
      'implementation',
      'it',
    ]);
    expect(changedTeams(larkspurState(), undefined).size).toBe(0);
  });
});

describe('collapsedTeams with changes', () => {
  it('opens a team with changes by default, and the toggle still wins', () => {
    const base = { asOf: AS_OF, timeZone: TIME_ZONE, toggles: new Map(), active: false };
    const changed = new Set(['digitization']);
    expect(collapsedTeams(larkspurState(), { ...base, changed }).has('digitization')).toBe(false);
    expect(
      collapsedTeams(larkspurState(), {
        ...base,
        changed,
        toggles: new Map([['digitization', false]]),
      }).has('digitization'),
    ).toBe(true);
  });
});

describe('openTeams', () => {
  const view = { asOf: AS_OF, timeZone: TIME_ZONE, toggles: new Map<string, boolean>() };

  it('stores an open toggle for a collapsed team when the graph is whole', () => {
    expect(openTeams(larkspurState(), view, ['implementation', 'engineering'], false)).toEqual({
      toggles: new Map([['implementation', true]]),
      active: [],
    });
  });

  it('opens a team only for the narrowed graph, so the stored toggles come back', () => {
    expect(openTeams(larkspurState(), view, ['implementation'], true)).toEqual({
      toggles: null,
      active: ['implementation'],
    });
  });

  it('stores a team that the state does not know yet, as a new team gets its first row', () => {
    expect(openTeams(larkspurState(), view, ['brand-new'], false).toggles).toEqual(
      new Map([['brand-new', true]]),
    );
  });

  it('changes nothing for a team that is open already', () => {
    expect(openTeams(larkspurState(), view, ['engineering'], false)).toEqual({
      toggles: null,
      active: [],
    });
  });
});
