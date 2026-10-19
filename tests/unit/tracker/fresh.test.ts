import { describe, expect, it } from 'vitest';
import { freshLabel, onlyAppended } from '../../../src/components/tracker/fresh';
import type { Cr } from '../../../src/tracker';
import { makeOp } from '../../support/tracker-fixture';

const shown = { version: 'm1.q1.c1.p1', crCount: 4 };

describe('freshLabel', () => {
  it('says nothing while the screen shows the latest version', () => {
    expect(freshLabel(shown, { version: 'm1.q1.c1.p1', crCount: 4 })).toBeNull();
  });

  it('counts the new change requests when only the change requests changed', () => {
    expect(freshLabel(shown, { version: 'm1.q1.c2.p1', crCount: 5 })).toBe('1 new change request');
    expect(freshLabel(shown, { version: 'm1.q1.c2.p1', crCount: 6 })).toBe('2 new change requests');
    expect(freshLabel(shown, { version: 'm1.q1.c2.p1', crCount: 4 })).toBe(
      'Change requests changed',
    );
  });

  it('names Main first, then the Queue, and says New changes for anything else', () => {
    expect(freshLabel(shown, { version: 'm2.q1.c2.p1', crCount: 4 })).toBe('Main changed');
    expect(freshLabel(shown, { version: 'm1.q2.c1.p1', crCount: 4 })).toBe('The Queue changed');
    expect(freshLabel(shown, { version: 'm1.q1.c1.p2', crCount: 4 })).toBe('New changes');
    expect(freshLabel(shown, { version: 'm1.q2.c2.p1', crCount: 5 })).toBe('New changes');
  });
});

describe('freshLabel on a change request page', () => {
  const mark = { num: 4, revision: 2, updatedAt: '2026-10-19T08:00:00.000Z' };
  const page = { ...shown, cr: mark };

  it('says This change request changed when its revision or its time moved', () => {
    expect(
      freshLabel(page, { version: 'm1.q1.c2.p1', crCount: 4, cr: { ...mark, revision: 3 } }),
    ).toBe('This change request changed');
    expect(
      freshLabel(page, {
        version: 'm1.q1.c2.p1',
        crCount: 5,
        cr: { ...mark, updatedAt: '2026-10-19T08:05:00.000Z' },
      }),
    ).toBe('This change request changed');
  });

  it('counts other new change requests when this one stayed the same, and names Main first', () => {
    expect(freshLabel(page, { version: 'm1.q1.c2.p1', crCount: 5, cr: mark })).toBe(
      '1 new change request',
    );
    expect(
      freshLabel(page, { version: 'm2.q1.c2.p1', crCount: 4, cr: { ...mark, revision: 3 } }),
    ).toBe('Main changed');
  });
});

describe('onlyAppended', () => {
  const one = makeOp('rename', { workItemId: 'pg203', title: 'A' }, 0, 'ha');
  const two = makeOp('rename', { workItemId: 'pg203', title: 'B' }, 0, 'ha');
  const cr = (ops: Cr['ops'], more: Partial<Cr> = {}) =>
    ({ num: 4, status: 'draft', editor: 'ha', ops, revision: ops.length, ...more }) as Cr;

  it('is true when the draft only got changes after the ones on screen', () => {
    expect(onlyAppended(cr([one]), cr([one, two]))).toBe(true);
  });

  it('is false when a change on screen went away, changed, or nothing was added', () => {
    expect(onlyAppended(cr([one, two]), cr([one]))).toBe(false);
    expect(onlyAppended(cr([one]), cr([two, two]))).toBe(false);
    expect(onlyAppended(cr([one]), cr([one], { revision: 3 }))).toBe(false);
  });

  it('is false when the draft is ready, closed or has another editor now', () => {
    expect(onlyAppended(cr([one]), cr([one, two], { status: 'ready' }))).toBe(false);
    expect(onlyAppended(cr([one]), cr([one, two], { editor: 'lan' }))).toBe(false);
    expect(onlyAppended(cr([one]), undefined)).toBe(false);
  });
});
