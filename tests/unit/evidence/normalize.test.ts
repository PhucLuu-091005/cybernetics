import { describe, expect, it } from 'vitest';
import { foldForSearch, normalizeRecord, recordDigest } from '../../../src/server/domain/records/normalize';

const base = { sourceLabel: 'paste', author: { name: 'Sarah Kim' }, recipients: [], title: 'Re: mapping', bodyText: 'Line one\r\nLine two', occurredAt: '2026-10-01T09:00:00+07:00' };

describe('normalizeRecord', () => {
  it('converts CRLF to LF and composes Unicode NFC', () => {
    const n = normalizeRecord({ ...base, bodyText: 'Tràn\r\nok' }, 'Asia/Ho_Chi_Minh');
    expect(n.bodyText).toBe('Tràn\nok');
  });
  it('resolves a date-only record to local start of day with day precision', () => {
    const { occurredAt: _ignored, ...dateOnly } = base;
    void _ignored;
    const n = normalizeRecord({ ...dateOnly, occurredDate: '2026-10-01' }, 'Asia/Ho_Chi_Minh');
    expect(n).toMatchObject({ occurredAt: '2026-09-30T17:00:00.000Z', occurredDate: '2026-10-01', occurredTimeZone: 'Asia/Ho_Chi_Minh', timePrecision: 'day' });
  });
  it('changes the digest when only metadata changes', () => {
    const a = normalizeRecord(base, 'UTC'), b = normalizeRecord({ ...base, title: 'Re: mapping v2' }, 'UTC');
    expect(recordDigest(a)).not.toBe(recordDigest(b));
    expect(recordDigest(a)).toBe(recordDigest(normalizeRecord({ ...base }, 'UTC')));
  });
  it('composes NFC in title and alias names and keeps an instant record at instant precision', () => {
    const n = normalizeRecord({ ...base, title: 'Tràn', author: { name: 'Minh Tràn' }, recipients: [{ name: 'Đào' }] }, 'UTC');
    expect(n).toMatchObject({ title: 'Tràn', author: { name: 'Minh Tràn' }, recipients: [{ name: 'Đào' }], occurredAt: '2026-10-01T02:00:00.000Z', occurredDate: null, occurredTimeZone: null, timePrecision: 'instant' });
  });
  it('treats an omitted optional alias field the same as null in the digest', () => {
    const omitted = normalizeRecord(base, 'UTC'), explicit = normalizeRecord({ ...base, author: { name: 'Sarah Kim', email: null, slackUserId: null } }, 'UTC');
    expect(recordDigest(omitted)).toBe(recordDigest(explicit));
  });
  it('rejects a quoted range that no longer fits the body after CRLF normalization', () => {
    expect(() => normalizeRecord({ ...base, quotedRanges: [{ start: 0, end: 18 }] }, 'UTC')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(normalizeRecord({ ...base, quotedRanges: [{ start: 0, end: 17 }] }, 'UTC').quotedRanges).toEqual([{ start: 0, end: 17 }]);
  });
});

describe('foldForSearch', () => {
  it('strips Vietnamese diacritics and keeps the UTF-16 length', () => {
    const text = 'Bản đồ trường dữ liệu cho Larkspur — ĐÃ GỬI';
    expect(foldForSearch(text)).toBe('ban do truong du lieu cho larkspur — da gui');
    expect(foldForSearch(text).length).toBe(text.length);
  });
});
