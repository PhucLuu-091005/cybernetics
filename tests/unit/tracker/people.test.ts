import { describe, expect, it } from 'vitest';
import { goneNamed, pickable } from '../../../src/tracker/people';
import { DEFAULT_GRANTS } from '../../../src/tracker/permissions';
import type { Member } from '../../../src/tracker';
import { buildState, makeOp, workItem } from '../../support/tracker-fixture';

const member = (id: string, removed = false): Member => ({
  id,
  name: id,
  roleLabel: '',
  color: '#2563eb',
  userId: null,
  active: !removed,
  removed,
  grants: DEFAULT_GRANTS,
});
const people = [
  { id: 'sarah', name: 'Sarah Kim' },
  { id: 'lan', name: 'Lan Phạm' },
  { id: 'old', name: 'Mai Vũ' },
  { id: 'again', name: 'Mai Vũ' },
];
const members = [member('lan'), member('old', true), member('again')];

describe('pickable people', () => {
  it('offers the story people and present members, never a removed member', () => {
    expect(pickable(people, members).map((p) => p.id)).toEqual(['sarah', 'lan', 'again']);
  });

  it('keeps a removed member who is the current value, so a select does not change person on its own', () => {
    expect(pickable(people, members, 'old').map((p) => p.id)).toEqual([
      'sarah',
      'lan',
      'old',
      'again',
    ]);
    expect(pickable(people, members, 'lan').map((p) => p.id)).toEqual(['sarah', 'lan', 'again']);
  });
});

describe('removed people that an op names for new work', () => {
  const state = () =>
    buildState({
      people,
      teams: [{ id: 'eng', name: 'Engineering', leadId: null }],
      workItems: [workItem({ id: 'w1', teamId: 'eng', doneBy: 'old', requestedBy: 'lan' })],
    });

  it('names a removed member that Done by, Requested by, a new work item or a new event takes', () => {
    expect(
      goneNamed(state(), members, makeOp('doneBy', { workItemId: 'w1', personId: 'old' })),
    ).toEqual([]);
    expect(
      goneNamed(state(), members, makeOp('requestedBy', { workItemId: 'w1', personId: 'old' })),
    ).toEqual(['old']);
    expect(
      goneNamed(
        state(),
        members,
        makeOp('fromEvent', {
          id: 'w2',
          eventId: 'e1',
          teamId: 'eng',
          title: 'New',
          doneBy: 'old',
          requestedBy: 'lan',
          after: null,
          plannedFinish: '2026-10-20',
        }),
      ),
    ).toEqual(['old']);
    expect(
      goneNamed(
        state(),
        members,
        makeOp('addEvent', {
          workItemId: 'w1',
          ev: { id: 'e9', kind: 'message', at: '2026-10-08T03:00:00.000Z', by: 'old', text: 'Hi' },
        }),
      ),
    ).toEqual(['old']);
    expect(
      goneNamed(state(), members, makeOp('doneBy', { workItemId: 'w1', personId: 'lan' })),
    ).toEqual([]);
  });
});
