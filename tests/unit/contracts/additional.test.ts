import { expect, it } from 'vitest';
import { canonicalJson } from '../../../src/lib/canonical-json';
import { RecordVersionSchema } from '../../../src/contracts/records';
const id = '10000000-0000-4000-8000-000000000001';
const version = {
  id,
  recordId: id,
  projectId: id,
  source: 'paste',
  sourceLabel: 'Team email',
  externalId: null,
  threadExternalId: null,
  parentExternalId: null,
  title: 'Mapping',
  bodyText: 'Xin 😀 chào',
  digest: 'a'.repeat(64),
  occurredAt: '2026-10-12T02:00:00Z',
  occurredDate: null,
  occurredTimeZone: null,
  timePrecision: 'day',
  author: { name: 'Minh Trần' },
  recipients: [],
  quotedRanges: [],
  attachmentNames: [],
  permalink: null,
  provenance: { actor: { kind: 'user', userId: 'user_clerk' }, importedAt: '2026-10-12T02:00:00Z' },
  withdrawn: false,
};
it('serializes numeric object keys in lexical canonical order', () => {
  expect(canonicalJson({ '2': 'two', '10': 'ten' })).toBe('{"10":"ten","2":"two"}');
});
it('rejects a day-precision record version without its original date and zone', () => {
  expect(RecordVersionSchema.safeParse(version).success).toBe(false);
  expect(
    RecordVersionSchema.safeParse({
      ...version,
      occurredDate: '2026-10-12',
      occurredTimeZone: 'Asia/Ho_Chi_Minh',
    }).success,
  ).toBe(true);
});
it('rejects quoted ranges on immutable versions that cut through emoji', () => {
  expect(
    RecordVersionSchema.safeParse({
      ...version,
      timePrecision: 'instant',
      quotedRanges: [{ start: 5, end: 6 }],
    }).success,
  ).toBe(false);
});
