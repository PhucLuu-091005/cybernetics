import { describe, expect, it } from 'vitest';
import { clientAddress } from '../../../src/server/http/demo';
import { MemoryRateLimiter } from '../../../src/server/http/rate-limit';

const withFor = (forwarded: string | null) =>
  new Request('https://pg.example/', {
    headers: forwarded === null ? {} : { 'x-forwarded-for': forwarded },
  });

describe('demo client address', () => {
  it('takes the last X-Forwarded-For value, which Cloud Run appends', () => {
    expect(clientAddress(withFor('1.1.1.1, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(withFor('2001:db8::1'))).toBe('2001:db8::1');
  });
  it('answers unknown for a missing or invalid value, so junk never becomes a key', () => {
    for (const value of [null, '', 'x'.repeat(500), '203.0.113.9, not-an-ip', '999.1.1.1'])
      expect(clientAddress(withFor(value))).toBe('unknown');
  });
});

describe('MemoryRateLimiter', () => {
  it('keeps at most maxKeys buckets and drops the oldest', () => {
    const limiter = new MemoryRateLimiter(3);
    for (const key of ['a', 'b', 'c', 'd']) limiter.consume(key, 1, 1000);
    expect(limiter.consume('a', 1, 1000)).toBe(true);
    expect(limiter.consume('d', 1, 1000)).toBe(false);
  });
});
