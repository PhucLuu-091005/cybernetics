import { describe, expect, it, vi } from 'vitest';
import { readSession, signSession, startLocalSession } from '../../../src/server/http/session';
import { assertRequestOrigin } from '../../../src/server/http/origin';
import { MemoryRateLimiter } from '../../../src/server/http/rate-limit';
import type { AuthEnvironment } from '../../../src/server/env';
import { memoryStore } from './test-store';
const env: AuthEnvironment = {
  mode: 'local',
  appOrigin: 'http://localhost:3000',
  sessionSecret: 'ab'.repeat(32),
  google: null,
};
function request(cookie?: string, origin = env.appOrigin, url = env.appOrigin) {
  return new Request(url, {
    method: 'POST',
    headers: { origin, ...(cookie ? { cookie: `pg_session=${cookie}` } : {}) },
  });
}
describe('local signed-session mode', () => {
  it('rejects missing, malformed or differently signed cookies', () => {
    const session = { userId: '00000000-0000-4000-8000-000000000001', expiresAt: 2_000_000 };
    expect(() => readSession(request(), env, 1000)).toThrow(/Session required/);
    expect(() =>
      readSession(request(signSession(session, env.sessionSecret) + 'x'), env, 1000),
    ).toThrow(/Invalid session/);
    expect(() =>
      readSession(request(signSession(session, 'different'.repeat(8))), env, 1000),
    ).toThrow(/Invalid session/);
  });
  it('rejects foreign or absent browser mutation origins and nonloopback requests', () => {
    expect(() => assertRequestOrigin(request(undefined, 'https://evil.example'), env)).toThrow();
    expect(() =>
      assertRequestOrigin(new Request(env.appOrigin, { method: 'POST' }), env),
    ).toThrow();
    expect(() =>
      assertRequestOrigin(request(undefined, env.appOrigin, 'http://evil.example'), env),
    ).toThrow();
    expect(() =>
      assertRequestOrigin(request(undefined, env.appOrigin, 'http://localhost:4000'), env),
    ).toThrow();
  });
  it('reuses one local developer identity across repeated sign-ins', async () => {
    const store = memoryStore();
    const first = await startLocalSession(request(), env, store, 1000);
    const second = await startLocalSession(request(), env, store, 1000);
    expect(first).toMatch(/^pg_session=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=604800$/);
    expect(first).toEqual(second);
    expect(store.users.size).toBe(1);
    expect(store.memberships.size).toBe(1);
  });
  it('provisions one identity per sign-in label from a form or JSON body and rejects a malformed label', async () => {
    const store = memoryStore();
    const post = (body: string, type: string) =>
      new Request(env.appOrigin, {
        method: 'POST',
        headers: { origin: env.appOrigin, 'content-type': type },
        body,
      });
    const form = (label: string) =>
      post(new URLSearchParams({ label }).toString(), 'application/x-www-form-urlencoded');
    const json = (label: string) => post(JSON.stringify({ label }), 'application/json');
    const inbox = await startLocalSession(form('inbox'), env, store, 1000);
    expect(await startLocalSession(json('inbox'), env, store, 1000)).toEqual(inbox);
    await startLocalSession(form('graph-2'), env, store, 1000);
    await startLocalSession(post('', 'application/x-www-form-urlencoded'), env, store, 1000);
    await startLocalSession(request(), env, store, 1000);
    expect([...store.users.values()].map((user) => user.subject).sort()).toEqual([
      'local:dev',
      'local:graph-2',
      'local:inbox',
    ]);
    for (const label of ['Bad Label', 'a'.repeat(41), '', 'ünicode'])
      await expect(startLocalSession(form(label), env, store, 1000)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    await expect(
      startLocalSession(post('{"label":7}', 'application/json'), env, store, 1000),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(store.users.size).toBe(3);
  });
  it('refuses local sessions in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(startLocalSession(request(), env, memoryStore(), 1000)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(() =>
        readSession(
          request(
            signSession(
              { userId: '00000000-0000-4000-8000-000000000001', expiresAt: 2_000_000 },
              env.sessionSecret,
            ),
          ),
          env,
          1000,
        ),
      ).toThrow(/Local authentication unavailable/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
describe('per-actor minute rate limits', () => {
  it('blocks the next request at the limit and resets in the next minute', () => {
    const limiter = new MemoryRateLimiter();
    for (let i = 0; i < 20; i++) expect(limiter.consume('user:write', 20, 1000)).toBe(true);
    expect(limiter.consume('user:write', 20, 1000)).toBe(false);
    expect(limiter.consume('another:write', 20, 1000)).toBe(true);
    expect(limiter.consume('user:read', 60, 1000)).toBe(true);
    expect(limiter.consume('user:write', 20, 61_000)).toBe(true);
  });
  it('counts a longer window when one is given', () => {
    const limiter = new MemoryRateLimiter();
    const hour = 3_600_000;
    for (let i = 0; i < 3; i++) limiter.consume('demo:ip', 3, 1000 + i * 600_000, hour);
    expect(limiter.consume('demo:ip', 3, 2_000_000, hour)).toBe(false);
    expect(limiter.consume('demo:ip', 3, hour, hour)).toBe(true);
  });
});
