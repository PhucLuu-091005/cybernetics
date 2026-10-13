import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readLocalSession, signLocalSession, startLocalSession } from '../../../src/server/http/local-session';
import { assertRequestOrigin } from '../../../src/server/http/origin';
import { MemoryRateLimiter } from '../../../src/server/http/rate-limit';
import { TestIdentityStore } from './test-store';
const env = { mode: 'local' as const, appOrigin: 'http://localhost:3000', localSessionSecret: 'ab'.repeat(32) };
const session = { userId: randomUUID(), workspaceId: randomUUID(), expiresAt: 2_000_000 };
function request(cookie?: string, origin = env.appOrigin, url = env.appOrigin) { return new Request(url, { method: 'POST', headers: { origin, ...(cookie ? { cookie: `promise_local_session=${cookie}` } : {}) } }); }
describe('signed local browser identity', () => {
  it('verifies an authentic cookie with its original independent workspace', () => {
    expect(readLocalSession(request(signLocalSession(session, env.localSessionSecret)), env, 1000)).toEqual(session);
  });
  it('rejects missing, tampered, expired or differently signed cookies', () => {
    expect(() => readLocalSession(request(), env, 1000)).toThrow();
    expect(() => readLocalSession(request(signLocalSession(session, env.localSessionSecret) + 'x'), env, 1000)).toThrow();
    expect(() => readLocalSession(request(signLocalSession(session, 'different'.repeat(8))), env, 1000)).toThrow();
    expect(() => readLocalSession(request(signLocalSession(session, env.localSessionSecret)), env, 2_000_000)).toThrow();
  });
  it('rejects foreign or absent browser mutation origins and nonloopback requests', () => {
    expect(() => assertRequestOrigin(request(undefined, 'https://evil.example'), env)).toThrow();
    expect(() => assertRequestOrigin(new Request(env.appOrigin, { method: 'POST' }), env)).toThrow();
    expect(() => assertRequestOrigin(request(undefined, env.appOrigin, 'http://evil.example'), env)).toThrow();
    expect(() => assertRequestOrigin(request(undefined, env.appOrigin, 'http://localhost:4000'), env)).toThrow();
  });
  it('creates different identities and persisted memberships per session start', async () => {
    const store = new TestIdentityStore();
    const first = await startLocalSession(request(), env, store, 1000);
    const second = await startLocalSession(request(), env, store, 1000);
    expect(first).toContain('HttpOnly; SameSite=Strict');
    expect(first).not.toEqual(second);
    expect(store.identities.size).toBe(2);
    expect(store.memberships.size).toBe(2);
  });
});
describe('per-actor minute rate limits', () => {
  it('blocks the next request at the limit and resets in the next minute', () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 20; i++) limiter.consume('user:write', 20, 1000);
    expect(() => limiter.consume('user:write', 20, 1000)).toThrow();
    expect(() => limiter.consume('another:write', 20, 1000)).not.toThrow();
    expect(() => limiter.consume('user:read', 60, 1000)).not.toThrow();
    expect(() => limiter.consume('user:write', 20, 61_000)).not.toThrow();
  });
});
