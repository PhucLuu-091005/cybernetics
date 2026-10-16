import { describe, expect, it } from 'vitest';
import { pendingMisfit } from '../../../src/components/tracker/pending';
import { queueFromRows } from '../../../src/tracker/ops';
import type { Cr, TrackerPayload } from '../../../src/tracker/payload';
import {
  at,
  larkspurBase,
  larkspurQueueRows,
  makeOp,
  TIME_ZONE,
} from '../../support/tracker-fixture';

const draft: Cr = {
  id: 'cr4',
  num: 4,
  title: 'Test plan',
  author: 'ha',
  editor: 'ha',
  status: 'draft',
  ops: [makeOp('attach', { eventId: 'qe4', workItemId: 'test' }, 0, 'ha')],
  revision: 1,
  createdAt: at('2026-10-09T16:45'),
  updatedAt: at('2026-10-09T16:45'),
  mergedRev: null,
  mergedBy: null,
  mergedAt: null,
  closedBy: null,
  closedAt: null,
  closedRev: null,
  resolutions: [],
  shares: [],
  asks: [],
  comments: [],
};

const payload: TrackerPayload = {
  project: {
    id: 'p1',
    title: 'Larkspur',
    clientName: 'Larkspur Capital',
    timeZone: TIME_ZONE,
    windowStart: null,
    asOf: null,
    demo: true,
    ownerMemberId: 'minh',
  },
  members: [],
  me: null,
  base: larkspurBase(),
  queue: queueFromRows(larkspurQueueRows()),
  commits: [],
  crs: [draft],
};

const attachQe4 = { op: 'attach', a: { eventId: 'qe4', workItemId: 'pg203' } } as const;
const rename = { op: 'rename', a: { workItemId: 'pg203', title: 'PG-203 on staging' } } as const;

describe('pendingMisfit', () => {
  it('lets changes that fit the latest Main start a new change request', () => {
    expect(pendingMisfit(payload, 'main', [attachQe4, rename])).toBeNull();
  });

  it('says in plain words that a change no longer fits Main', () => {
    const gone = { op: 'attach', a: { eventId: 'gone', workItemId: 'pg203' } } as const;
    expect(pendingMisfit(payload, 'main', [rename, gone])).toBe(
      'That change no longer fits the latest Main, so no change request was made.',
    );
  });

  it('checks changes for Add to #N against that change request', () => {
    expect(pendingMisfit(payload, 4, [rename])).toBeNull();
    expect(pendingMisfit(payload, 4, [attachQe4])).toBe(
      'That change no longer fits #4, so nothing was added.',
    );
    expect(pendingMisfit(payload, 9, [rename])).toBe('#9 is gone, so nothing was added.');
  });
});
