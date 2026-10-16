import { describe, expect, it } from 'vitest';
import type { Clash, Commit } from '../../../src/tracker/clash';
import { clashLabel, describeOp, diffLines, FIELD } from '../../../src/tracker/describe';
import { applyOp, OpError, type Op } from '../../../src/tracker/ops';
import { OpSchema } from '../../../src/tracker/schemas';
import { at, larkspurState, makeOp } from '../../support/tracker-fixture';

const WHY = 'The country list needs a new field type.';

function described(op: Op): Op {
  return { ...op, d: describeOp(op, larkspurState()) };
}

describe('describeOp', () => {
  it('returns the entry fields of the op on the state before it', () => {
    const op = makeOp('rename', { workItemId: 'pg203', title: 'New name' });
    expect(describeOp(op, larkspurState())).toEqual(applyOp(larkspurState(), op).entry);
  });

  it('throws OpError when the op does not fit', () => {
    const op = makeOp('attach', { eventId: 'nope', workItemId: 'golive' });
    expect(() => describeOp(op, larkspurState())).toThrow(OpError);
  });
});

describe('diffLines', () => {
  it('place: from the queue to the team', () => {
    const op = described(makeOp('place', { itemId: 'q2', teamId: 'engineering' }));
    expect(diffLines(op)).toEqual([
      ['del', 'In the queue'],
      ['add', 'Team: Engineering'],
    ]);
  });

  it('attach: from the queue onto the work item', () => {
    const op = described(makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }));
    expect(diffLines(op)).toEqual([
      ['del', 'In the queue'],
      ['add', 'On: Go-live date, 7 Oct 08:30'],
    ]);
  });

  it('due: the old and the new planned finish', () => {
    const op = described(
      makeOp('due', {
        workItemId: 'pg203',
        date: '2026-10-14',
        why: WHY,
        by: 'quang',
        at: at('2026-10-09T17:00'),
      }),
    );
    expect(diffLines(op)).toEqual([
      ['del', 'Planned finish: 6 Oct'],
      ['add', 'Planned finish: 14 Oct'],
    ]);
  });

  it('rename: the old and the new name', () => {
    const op = described(
      makeOp('rename', { workItemId: 'pg203', title: 'PG-203 Country list field (multi-select)' }),
    );
    expect(diffLines(op)).toEqual([
      ['del', 'Name: PG-203 Country list field type'],
      ['add', 'Name: PG-203 Country list field (multi-select)'],
    ]);
  });

  it('msDate and hide drop the "planned " and "on " prefixes', () => {
    const msDate = described(
      makeOp('msDate', {
        milestoneId: 'golive',
        date: '2026-10-15',
        why: WHY,
        by: 'minh',
        at: at('2026-10-08T16:55'),
      }),
    );
    expect(diffLines(msDate)).toEqual([
      ['del', 'Planned date: 30 Sept'],
      ['add', 'Planned date: 15 Oct'],
    ]);
    expect(diffLines(described(makeOp('hide', { eventId: 'x2' })))).toEqual([
      ['del', 'Shown: Client secret renewal'],
      ['add', 'Shown: Hidden'],
    ]);
  });

  it('a new thing has only an added line', () => {
    const op = described(
      makeOp('newMs', { id: 'ms1', name: 'Statements', planned: '2026-10-20', members: ['pg201'] }),
    );
    expect(diffLines(op)).toEqual([['add', 'New milestone: 20 Oct, 1 work item']]);
  });

  it('an op without a description has no lines', () => {
    expect(diffLines(makeOp('hide', { eventId: 'x2' }))).toEqual([]);
  });

  it('FIELD names every op', () => {
    for (const option of OpSchema.options) {
      expect(FIELD[option.shape.op.value]).toEqual(expect.any(String));
    }
  });
});

describe('clashLabel', () => {
  const commit: Commit = {
    rev: 1,
    crId: 'cr2',
    crNum: 2,
    mergedBy: 'minh',
    mergedAt: at('2026-10-09T17:00'),
    ops: [],
    resolutions: [],
  };
  const clash = (key: string, x: Op): Clash => ({ key, index: 0, x, y: x, commit });
  const s = larkspurState();

  it('names the work item and the field', () => {
    const x = described(makeOp('rename', { workItemId: 'pg203', title: 'X' }));
    expect(clashLabel(clash('loop:pg203:title', x), s)).toBe(
      'PG-203 Country list field type · name',
    );
    expect(clashLabel(clash('loop:pg203:due', x), s)).toBe(
      'PG-203 Country list field type · planned finish',
    );
    expect(clashLabel(clash('loop:pg203:ms', x), s)).toBe(
      'PG-203 Country list field type · milestone',
    );
    expect(clashLabel(clash('loop:gone:title', x), s)).toBe('Work item · name');
  });

  it('names the milestone and the field', () => {
    const x = described(makeOp('msName', { milestoneId: 'golive', name: 'X' }));
    expect(clashLabel(clash('ms:golive:date', x), s)).toBe(
      'Go-live and first close · planned date',
    );
    expect(clashLabel(clash('ms:golive:name', x), s)).toBe('Go-live and first close · name');
  });

  it('names a queue event placement and other spots by the change item', () => {
    const attach = described(makeOp('attach', { eventId: 'qe3', workItemId: 'golive' }));
    expect(clashLabel(clash('event:qe3', attach), s)).toBe(
      'Message by Sarah Kim · which work item',
    );
    const place = described(makeOp('place', { itemId: 'q1', teamId: 'engineering' }));
    expect(clashLabel(clash('item:q1', place), s)).toBe('PG-204 Tax ID format check');
  });
});
