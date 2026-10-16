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
  it('makes an addTeam op with a trimmed name and the picked lead', () => {
    expect(newTeamOp(state(), { id: 't1', name: '  Design  ', leadId: 'lan' })).toEqual({
      ok: true,
      op: { op: 'addTeam', a: { id: 't1', name: 'Design', leadId: 'lan' } },
    });
  });

  it('leaves the lead empty when the person picks no lead or a person who is not in the project', () => {
    for (const leadId of ['', 'nobody'])
      expect(newTeamOp(state(), { id: 't1', name: 'Design', leadId })).toEqual({
        ok: true,
        op: { op: 'addTeam', a: { id: 't1', name: 'Design', leadId: null } },
      });
  });

  it('asks for a name, and refuses a name that another team has', () => {
    expect(newTeamOp(state(), { id: 't1', name: '   ', leadId: '' })).toEqual({
      ok: false,
      message: 'Give the team a name.',
    });
    expect(newTeamOp(state(), { id: 't1', name: ' engineering ', leadId: '' })).toEqual({
      ok: false,
      message: 'Engineering is already a team.',
    });
  });

  it('makes an op that applies and describes the new lane', () => {
    const made = newTeamOp(state(), { id: 't1', name: 'Design', leadId: 'lan' });
    if (!made.ok) throw new Error(made.message);
    const { state: next, entry } = applyOp(state(), { ...made.op, rev: 0, by: 'lan' } as Op);
    expect(next.teams.map((t) => t.name)).toEqual(['Engineering', 'Design']);
    expect(entry).toEqual({ item: 'Design', change: 'added', before: '', after: 'lead Lan Phạm' });
  });
});
