import { describe, expect, it } from 'vitest';
import { GraphOperationSchema, GraphSnapshotSchema } from '../../../src/contracts/graph';
import { ScopeSchema } from '../../../src/contracts/identity';
import { RecordInputSchema } from '../../../src/contracts/records';
import { MergeProposalInputSchema, ReviewSchema } from '../../../src/contracts/proposals';
import { canonicalHash } from '../../../src/lib/canonical-json';
import { businessDaysBetween } from '../../../src/lib/calendar';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const party = { kind: 'side', side: 'vendor' };
const act = {
  id,
  citation: { recordVersionId: id, start: 0, end: 3 },
  type: 'promise',
  actor: party,
  customer: { kind: 'side', side: 'client' },
  performer: party,
  action: 'Send mapping',
  due: null,
  hedged: false,
  loopId: null,
  hidden: false,
  origin: 'human',
  confidence: null,
};
const context = {
  timeZone: 'Asia/Ho_Chi_Minh',
  windowStart: '2026-06-15',
  windowEnd: '2026-11-15',
  asOfOverride: null,
  holidays: [],
  replyWindowDays: 2,
  acceptWindowDays: 5,
  hedgeWindowDays: 5,
  atRiskWindowDays: 2,
  people: [],
  departments: [],
  milestones: [],
};
const snapshot = {
  schemaVersion: 1,
  context,
  acts: [],
  loops: [],
  annotations: [],
  recordDecisions: [],
};
const record = {
  sourceLabel: 'Pasted email',
  occurredAt: '2026-10-12T09:00:00+07:00',
  author: { name: 'Minh Trần', email: null, slackUserId: null },
  recipients: [],
  title: 'Mapping',
  bodyText: 'Xin 😀 chào',
};

describe('foundation contracts', () => {
  it('rejects put-act without its submitted quote', () => {
    expect(
      GraphOperationSchema.safeParse({ op: 'put', collection: 'acts', value: act }).success,
    ).toBe(false);
    expect(
      GraphOperationSchema.safeParse({ op: 'put', collection: 'acts', value: act, quote: 'Yes' })
        .success,
    ).toBe(true);
  });
  it('rejects collection mismatches instead of accepting arbitrary JSON', () => {
    expect(
      GraphOperationSchema.safeParse({ op: 'put', collection: 'loops', value: act }).success,
    ).toBe(false);
    expect(
      GraphOperationSchema.safeParse({ op: 'set_context', field: 'replyWindowDays', value: 'two' })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate snapshot entity IDs', () => {
    expect(GraphSnapshotSchema.safeParse({ ...snapshot, acts: [act, act] }).success).toBe(false);
    expect(GraphSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
  it('rejects a foreign scope and absent expected review revisions', () => {
    expect(ScopeSchema.safeParse('graph:admin').success).toBe(false);
    expect(ReviewSchema.safeParse({ digest: 'abc', T: '2026-10-12T00:00:00Z' }).success).toBe(
      false,
    );
    expect(
      MergeProposalInputSchema.safeParse({ proposalId: id, idempotencyKey: 'retry' }).success,
    ).toBe(false);
  });
  it('requires exactly one occurred-time/date and enforces UTF-8 body limits', () => {
    expect(RecordInputSchema.safeParse(record).success).toBe(true);
    expect(RecordInputSchema.safeParse({ ...record, occurredDate: '2026-10-12' }).success).toBe(
      false,
    );
    expect(RecordInputSchema.safeParse({ ...record, bodyText: '😀'.repeat(16385) }).success).toBe(
      false,
    );
  });
  it('preserves UTF-16 ranges for Vietnamese and emoji without splitting a surrogate', () => {
    expect(
      RecordInputSchema.safeParse({ ...record, quotedRanges: [{ start: 4, end: 6 }] }).success,
    ).toBe(true);
    expect(
      RecordInputSchema.safeParse({ ...record, quotedRanges: [{ start: 5, end: 6 }] }).success,
    ).toBe(false);
    expect(record.bodyText.slice(4, 6)).toBe('😀');
  });
  it('hashes entity order canonically while retaining semantic array order', () => {
    const a = {
      ...snapshot,
      acts: [act, { ...act, id: other }],
      annotations: [{ id, text: 'Explanation', actIds: [id, other] }],
    };
    const b = { ...a, acts: [a.acts[1], a.acts[0]] };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
    expect(canonicalHash(a)).not.toBe(
      canonicalHash({ ...a, annotations: [{ id, text: 'Explanation', actIds: [other, id] }] }),
    );
    expect(canonicalHash({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });
  it('counts local business days after a through b including holidays and midnight', () => {
    const calendar = { timeZone: 'Asia/Ho_Chi_Minh', holidays: ['2026-10-12'] };
    expect(
      businessDaysBetween('2026-10-09T09:00:00+07:00', '2026-10-13T00:00:00+07:00', calendar),
    ).toBe(1);
    expect(
      businessDaysBetween('2026-10-11T16:59:59Z', '2026-10-11T17:00:00Z', {
        ...calendar,
        holidays: [],
      }),
    ).toBe(1);
    expect(
      businessDaysBetween('2026-10-13T00:00:00+07:00', '2026-10-09T09:00:00+07:00', calendar),
    ).toBe(-1);
  });
});
