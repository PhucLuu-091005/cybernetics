import { describe, expect, it } from 'vitest';
import { clashLabel, diffLines } from '../../../src/tracker/describe';
import { applyOp, keysOf, OpError, replayOps, type Op } from '../../../src/tracker/ops';
import { OpSchema } from '../../../src/tracker/schemas';
import { larkspurState, makeOp } from '../../support/tracker-fixture';

const item = (op: Op) =>
  applyOp(larkspurState(), op).state.workItems.find((w) => w.id === 'pg203')!;

describe('work item field changes from the detail panel', () => {
  it('doneBy and requestedBy set a person and name both sides', () => {
    const op = makeOp('doneBy', { workItemId: 'pg203', personId: 'lan' });
    expect(item(op).doneBy).toBe('lan');
    expect(applyOp(larkspurState(), op).entry).toEqual({
      item: 'PG-203 Country list field type',
      change: 'done by changed',
      before: 'Quang Nguyễn',
      after: 'Lan Phạm',
    });
    const asked = makeOp('requestedBy', { workItemId: 'pg203', personId: 'sarah' });
    expect(item(asked).requestedBy).toBe('sarah');
    expect(applyOp(larkspurState(), asked).entry).toMatchObject({
      change: 'requested by changed',
      after: 'Sarah Kim',
    });
  });

  it('team moves the work item to another lane', () => {
    const op = makeOp('team', { workItemId: 'pg203', teamId: 'it' });
    expect(item(op).teamId).toBe('it');
    expect(applyOp(larkspurState(), op).entry).toMatchObject({
      change: 'team changed',
      before: 'Engineering',
      after: 'IT',
    });
  });

  it('parent sets or clears the parent', () => {
    const cleared = makeOp('parent', { workItemId: 'pg203', parentId: null });
    expect(item(cleared).parentId).toBeNull();
    expect(applyOp(larkspurState(), cleared).entry).toMatchObject({
      before: 'CRS tax residency section with DealCloud sync',
      after: 'No parent',
    });
    expect(item(makeOp('parent', { workItemId: 'pg203', parentId: 'golive' })).parentId).toBe(
      'golive',
    );
  });

  it('after sets the work items it leads from, once each', () => {
    const op = makeOp('after', { workItemId: 'pg203', after: ['pg201', 'pg201', 'analyse'] });
    expect(item(op).after).toEqual(['pg201', 'analyse']);
    expect(applyOp(larkspurState(), op).entry).toMatchObject({
      change: 'leads from changed',
      before: 'Analyse the CRS and FATCA rules',
      after: 'PG-201 CRS form logic, Analyse the CRS and FATCA rules',
    });
    expect(
      applyOp(larkspurState(), makeOp('after', { workItemId: 'pg203', after: [] })).entry.after,
    ).toBe('Nothing');
  });

  it.each<[string, Op]>([
    ['an unknown person', makeOp('doneBy', { workItemId: 'pg203', personId: 'nobody' })],
    ['an unknown team', makeOp('team', { workItemId: 'pg203', teamId: 'nope' })],
    ['its own parent', makeOp('parent', { workItemId: 'pg203', parentId: 'pg203' })],
    ['leading from itself', makeOp('after', { workItemId: 'pg203', after: ['pg203'] })],
    ['an unknown work item', makeOp('requestedBy', { workItemId: 'nope', personId: 'lan' })],
  ])('refuses %s', (_, op) => {
    expect(() => applyOp(larkspurState(), op)).toThrow(OpError);
  });

  it('marks the row, keys each field for clashes and labels the review lines', () => {
    const ops = [
      makeOp('doneBy', { workItemId: 'pg203', personId: 'lan' }),
      makeOp('team', { workItemId: 'pg201', teamId: 'it' }),
    ];
    expect([...replayOps(larkspurState(), ops).marks.workItems].sort()).toEqual(['pg201', 'pg203']);
    expect(keysOf(ops[0])).toEqual(['loop:pg203:doneBy']);
    expect(keysOf(makeOp('after', { workItemId: 'x', after: [] }))).toEqual(['loop:x:after']);
    const d = applyOp(larkspurState(), ops[0]).entry;
    expect(diffLines({ op: 'doneBy', d })).toEqual([
      ['del', 'Done by: Quang Nguyễn'],
      ['add', 'Done by: Lan Phạm'],
    ]);
    expect(clashLabel({ key: 'loop:pg203:after', x: ops[0] }, larkspurState())).toBe(
      'PG-203 Country list field type · leads from',
    );
  });

  it('validates the arguments', () => {
    expect(OpSchema.safeParse(makeOp('parent', { workItemId: 'a', parentId: null })).success).toBe(
      true,
    );
    expect(
      OpSchema.safeParse({
        ...makeOp('team', { workItemId: 'a', teamId: 'b' }),
        a: { workItemId: 'a' },
      }).success,
    ).toBe(false);
  });
});
