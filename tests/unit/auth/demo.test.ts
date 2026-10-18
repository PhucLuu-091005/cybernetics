import { describe, expect, it } from 'vitest';
import type { AuthEnvironment } from '../../../src/server/env';
import { clientAddress, enterDemo } from '../../../src/server/http/demo';
import { MemoryRateLimiter } from '../../../src/server/http/rate-limit';
import { memoryStore } from './test-store';

const env: AuthEnvironment = {
  mode: 'demo',
  appOrigin: 'https://pg.example',
  sessionSecret: 'ab'.repeat(32),
  google: null,
};
const page = (forwarded: string) =>
  new Request('https://pg.example/api/auth/demo', {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'x-forwarded-for': forwarded },
  });
const withFor = (forwarded: string | null) =>
  new Request('https://pg.example/', {
    headers: forwarded === null ? {} : { 'x-forwarded-for': forwarded },
  });

describe('demo client address', () => {
  it('takes the last value, which the front end appends, and skips trusted hops', () => {
    expect(clientAddress(withFor('1.1.1.1, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(withFor('203.0.113.9, 10.0.0.1'), 1)).toBe('203.0.113.9');
    expect(clientAddress(withFor('10.0.0.1'), 1)).toBe('unknown');
  });
  it('answers unknown for a missing or invalid address, so junk never grows the limiter', () => {
    for (const value of [null, '', 'x'.repeat(500), '1.1.1.1, not-an-ip', '999.1.1.1'])
      expect(clientAddress(withFor(value))).toBe('unknown');
  });
  it('counts one IPv6 /64 as one address', () => {
    expect(clientAddress(withFor('2001:db8:1:2:aaaa::1'))).toBe('2001:db8:1:2::/64');
    expect(clientAddress(withFor('2001:db8:1:2:bbbb:cccc:dddd:eeee'))).toBe('2001:db8:1:2::/64');
  });
});

describe('demo limits', () => {
  it('the per-address limit stops one address first; the cap for all names its own reason', async () => {
    const deps = {
      env,
      store: memoryStore(),
      limiter: new MemoryRateLimiter(),
      limits: { perAddress: 2, perHour: 3 },
    };
    const go = async (ip: string) => (await enterDemo(page(ip), deps)).location;
    expect(await go('203.0.113.1')).toBe('/api/auth/demo?check=1');
    expect(await go('203.0.113.1')).toBe('/api/auth/demo?check=1');
    expect(await go('203.0.113.1')).toBe('/welcome?reason=busy');
    expect(await go('203.0.113.2')).toBe('/api/auth/demo?check=1');
    expect(await go('203.0.113.3')).toBe('/welcome?reason=full');
    expect(deps.store.users.size).toBe(3);
  });
});

describe('MemoryRateLimiter.consumeAll', () => {
  it('counts nothing when any bucket is full, and names the full one', () => {
    const limiter = new MemoryRateLimiter();
    const take = () =>
      limiter.consumeAll(
        [
          { key: 'all', limit: 1 },
          { key: 'one', limit: 5 },
        ],
        1000,
        60_000,
      );
    expect(take()).toBeNull();
    expect(take()).toBe('all');
    expect(limiter.consumeAll([{ key: 'one', limit: 1 }], 1000, 60_000)).toBe('one');
  });
  it('keeps at most maxKeys buckets and drops the oldest', () => {
    const limiter = new MemoryRateLimiter(3);
    for (const key of ['a', 'b', 'c', 'd']) limiter.consume(key, 1, 1000);
    expect(() => limiter.consume('a', 1, 1000)).not.toThrow();
    expect(() => limiter.consume('d', 1, 1000)).toThrow();
  });
});
