import { describe, expect, it } from 'vitest';
import { quoteContext } from '../../../src/lib/quote-context';

describe('quoteContext (loop panel, SRD 7.4)', () => {
  const body = `${'a'.repeat(400)}QUOTE${'b'.repeat(400)}`;
  const start = 400, end = 405;
  it('splits 300 characters evenly when both sides have room', () => {
    expect(quoteContext(body, start, end)).toEqual({ before: 'a'.repeat(150), after: 'b'.repeat(150) });
  });
  it('gives the unused budget of a short side to the other side', () => {
    const short = `xy${body.slice(start)}`;
    expect(quoteContext(short, 2, 7)).toEqual({ before: 'xy', after: 'b'.repeat(298) });
    const tail = `${body.slice(0, end)}z`;
    expect(quoteContext(tail, start, end)).toEqual({ before: 'a'.repeat(299), after: 'z' });
  });
  it('never cuts a surrogate pair', () => {
    const emoji = '🙏';
    const leading = `${'a'.repeat(10)}${emoji}${'c'.repeat(149)}Q${'d'.repeat(400)}`;
    expect(quoteContext(leading, 161, 162).before).toBe('c'.repeat(149));
    const trailing = `${'c'.repeat(200)}Q${'d'.repeat(149)}${emoji}e`;
    expect(quoteContext(trailing, 200, 201)).toEqual({ before: 'c'.repeat(150), after: 'd'.repeat(149) });
  });
  it('returns empty sides for a quote that is the whole body', () => {
    expect(quoteContext('QUOTE', 0, 5)).toEqual({ before: '', after: '' });
  });
});
