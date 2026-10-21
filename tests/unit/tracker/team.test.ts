import { describe, expect, it } from 'vitest';
import { newTeamOp } from '../../../src/components/tracker/team';
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
