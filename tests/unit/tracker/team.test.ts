import { describe, expect, it } from 'vitest';
import { focusAction, newTeamOp, teamMenuItems } from '../../../src/components/tracker/team';
import { applyOp, type Op } from '../../../src/tracker/ops';
import { buildState } from '../../support/tracker-fixture';

const state = () =>
  buildState({
    people: [
      { id: 'lan', name: 'Lan Phạm' },
      { id: 'quang', name: 'Quang Nguyễn' },
    ],
    teams: [{ id: 'eng', name: 'Engineering', leadId: 'quang' }],
  });

describe('newTeamOp', () => {
  it('makes an addTeam op with a trimmed name and no lead: only the project lead picks team leads', () => {
    expect(newTeamOp(state(), { id: 't1', name: '  Design  ' })).toEqual({
      ok: true,
      op: { op: 'addTeam', a: { id: 't1', name: 'Design', leadId: null } },
    });
  });

  it('asks for a name, and refuses a name that another team has', () => {
    expect(newTeamOp(state(), { id: 't1', name: '   ' })).toEqual({
      ok: false,
      message: 'Give the team a name.',
    });
    expect(newTeamOp(state(), { id: 't1', name: ' engineering ' })).toEqual({
      ok: false,
      message: 'Engineering is already a team.',
    });
  });

  it('makes an op that applies and describes the new lane', () => {
    const made = newTeamOp(state(), { id: 't1', name: 'Design' });
    if (!made.ok) throw new Error(made.message);
    const { state: next, entry } = applyOp(state(), { ...made.op, rev: 0, by: 'lan' } as Op);
    expect(next.teams.map((t) => t.name)).toEqual(['Engineering', 'Design']);
    expect(entry).toMatchObject({ item: 'Design', change: 'added', before: '' });
  });
});

describe('focusAction', () => {
  it('names the work item or team in the accessible name and keeps the short word on the button', () => {
    expect(focusAction('PG-201 CRS form logic', false)).toEqual({
      text: 'Focus',
      label: 'Focus on PG-201 CRS form logic',
    });
    expect(focusAction('Engineering', true)).toEqual({
      text: 'Leave focus',
      label: 'Leave focus on Engineering',
    });
  });
});

describe('teamMenuItems', () => {
  const team = { name: 'Engineering', count: 4, collapsed: false, focused: false };
  it('gives a team row on a phone the desktop row actions: collapse, focus and hide', () => {
    expect(teamMenuItems(team)).toEqual([
      { action: 'collapse', text: 'Collapse', label: 'Collapse Engineering' },
      { action: 'focus', text: 'Focus', label: 'Focus on Engineering' },
      { action: 'hide', text: 'Hide', label: 'Hide Engineering' },
    ]);
  });
  it('offers Expand for a collapsed team and Leave focus for the focused one', () => {
    expect(teamMenuItems({ ...team, collapsed: true, focused: true })).toEqual([
      { action: 'collapse', text: 'Expand', label: 'Expand Engineering' },
      { action: 'focus', text: 'Leave focus', label: 'Leave focus on Engineering' },
      { action: 'hide', text: 'Hide', label: 'Hide Engineering' },
    ]);
  });
  it('leaves out Collapse for an empty team, which has nothing to open', () => {
    expect(teamMenuItems({ ...team, count: 0 }).map((i) => i.action)).toEqual(['focus', 'hide']);
  });
});
