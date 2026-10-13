import { describe, expect, it } from 'vitest';
import { formatCite, parseCite, segmentBody, selectionToCitation } from '../../../src/components/inbox/selection';

describe('selectionToCitation (record viewer, SRD 8.1)', () => {
  it('keeps UTF-16 offsets when astral emoji precede the selection', () => {
    const body = '🎉🎉 Hello world';
    expect(selectionToCitation(body, 5, 10, [])).toEqual({ start: 5, end: 10, quote: 'Hello' });
    expect(body.slice(5, 10)).toBe('Hello');
  });
  it('trims whitespace on both sides and accepts a reversed selection', () => {
    const body = 'Tom: \n  I will renew the secret on Monday.  \n';
    expect(selectionToCitation(body, body.length, 4, [])).toEqual({ start: 8, end: 42, quote: 'I will renew the secret on Monday.' });
  });
  it('refuses a selection of whitespace only', () => {
    expect(selectionToCitation('a   b', 1, 4, [])).toEqual({ error: 'Select some text to cite.' });
  });
  it('refuses a selection that overlaps a quoted range', () => {
    const body = 'New text.\n> On 25 Sep, Quang wrote: any update?';
    const quotedRanges = [{ start: 10, end: body.length }];
    expect(selectionToCitation(body, 4, 14, quotedRanges)).toEqual({ error: 'Quoted text from earlier messages cannot be cited.' });
    expect(selectionToCitation(body, 12, 20, quotedRanges)).toEqual({ error: 'Quoted text from earlier messages cannot be cited.' });
    expect(selectionToCitation(body, 0, 10, quotedRanges)).toEqual({ start: 0, end: 9, quote: 'New text.' });
  });
  it('refuses 401 characters and accepts 400', () => {
    const body = `${'x'.repeat(401)} tail`;
    expect(selectionToCitation(body, 0, 401, [])).toEqual({ error: 'A quote can be at most 400 characters. This selection has 401.' });
    expect(selectionToCitation(body, 0, 400, [])).toEqual({ start: 0, end: 400, quote: 'x'.repeat(400) });
  });
  it('keeps Vietnamese offsets and refuses a boundary between a letter and its combining mark', () => {
    const body = 'Anh Nguyễn ơi, x\u0303 đã gửi';
    expect(selectionToCitation(body, 4, 10, [])).toEqual({ start: 4, end: 10, quote: 'Nguyễn' });
    const mark = body.indexOf('\u0303');
    expect(selectionToCitation(body, mark - 1, mark, [])).toEqual({ error: 'The selection must not split a character.' });
    expect(selectionToCitation(body, mark, mark + 1, [])).toEqual({ error: 'The selection must not split a character.' });
    expect(selectionToCitation(body, mark - 1, mark + 1, [])).toEqual({ start: mark - 1, end: mark + 1, quote: 'x\u0303' });
    expect(selectionToCitation(body, mark + 2, body.length, [])).toEqual({ start: mark + 2, end: body.length, quote: 'đã gửi' });
  });
  it('refuses offsets that split a surrogate pair or fall outside the body', () => {
    expect(selectionToCitation('a🎉b', 2, 4, [])).toEqual({ error: 'The selection must not split a character.' });
    expect(selectionToCitation('abc', 1, 9, [])).toEqual({ error: 'The selection falls outside the record text.' });
  });
});

describe('segmentBody', () => {
  it('splits the body into plain and quoted segments that cover every offset once', () => {
    const body = 'abcdefghij';
    expect(segmentBody(body, [{ start: 6, end: 8 }, { start: 2, end: 4 }, { start: 3, end: 5 }])).toEqual([
      { start: 0, end: 2, quoted: false }, { start: 2, end: 5, quoted: true }, { start: 5, end: 6, quoted: false }, { start: 6, end: 8, quoted: true }, { start: 8, end: 10, quoted: false },
    ]);
    expect(segmentBody(body, [])).toEqual([{ start: 0, end: 10, quoted: false }]);
    expect(segmentBody('', [])).toEqual([]);
  });
});

describe('cite parameter', () => {
  it('round-trips a citation and rejects malformed values', () => {
    const citation = { recordVersionId: '0b8f0f3e-6c4b-4c1e-9d55-2f1f6c3a9b10', start: 5, end: 18, quote: 'Hello & “bye”' };
    expect(parseCite(formatCite(citation))).toEqual(citation);
    expect(parseCite('{"recordVersionId":"x","start":1,"end":2,"quote":"a"}')).toBeNull();
    expect(parseCite(formatCite({ ...citation, end: 10 }))).toBeNull();
    expect(parseCite('not json')).toBeNull();
    expect(parseCite(null)).toBeNull();
  });
});
