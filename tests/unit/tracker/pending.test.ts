import { describe, expect, it } from 'vitest';
import { currentState, fits } from '../../../src/components/tracker/pending';
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
    leadMemberId: 'minh',
  },
  members: [],
  me: null,
  canActAs: true,
  base: larkspurBase(),
  queue: queueFromRows(larkspurQueueRows()),
  commits: [],
  crs: [draft],
  offsets: {},
};

const attachQe4 = { op: 'attach', a: { eventId: 'qe4', workItemId: 'pg203' } } as const;
const rename = { op: 'rename', a: { workItemId: 'pg203', title: 'PG-203 on staging' } } as const;

describe('fits', () => {
  const main = currentState(payload, null).state;
  const cr4 = currentState(payload, draft).state;

  it('lets changes that fit the view through', () => {
    expect(fits(main, [attachQe4, rename], TIME_ZONE)).toBe(true);
    expect(fits(cr4, [rename], TIME_ZONE)).toBe(true);
  });

  it('stops a change that no longer fits, so it never reaches the server as a 400', () => {
    const gone = { op: 'attach', a: { eventId: 'gone', workItemId: 'pg203' } } as const;
    expect(fits(main, [rename, gone], TIME_ZONE)).toBe(false);
    expect(fits(cr4, [attachQe4], TIME_ZONE)).toBe(false);
  });
});
