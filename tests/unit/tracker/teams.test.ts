import { describe, expect, it } from 'vitest';
import { collapsedTeams, lateTeams, teamsGivenWork } from '../../../src/tracker/teams';
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

describe('teamsGivenWork', () => {
  it('names the teams that a placed, new or moved work item lands in', () => {
    expect(
      teamsGivenWork([
        { op: 'place', a: { itemId: 'q1', teamId: 'qa' } },
        { op: 'team', a: { workItemId: 'w1', teamId: 'it' } },
        { op: 'rename', a: { workItemId: 'w1', title: 'New' } },
        {
          op: 'fromEvent',
          a: {
            id: 'w2',
            eventId: 'e1',
            teamId: 'qa',
            title: 'T',
            doneBy: 'p',
            requestedBy: 'p',
            after: [],
            plannedFinish: '2026-10-20',
          },
        },
      ]),
    ).toEqual(['qa', 'it']);
  });
});
