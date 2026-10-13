import { describe, expect, it } from 'vitest';
import { readSession, sessionCookie, signSession } from '../../../src/server/http/session';
import type { AuthEnvironment } from '../../../src/server/env';

const env: AuthEnvironment = { mode: 'google', appOrigin: 'https://pg.example', sessionSecret: 's'.repeat(32), google: { clientId: 'id', clientSecret: 'secret' } };
const userId = '00000000-0000-4000-8000-000000000001';
const request = (cookie: string) => new Request('https://pg.example/api/v1/projects', { headers: { cookie, host: 'pg.example' } });

describe('signed session', () => {
  it('round-trips a valid session', () => {
    const value = signSession({ userId, expiresAt: 2_000 }, env.sessionSecret);
    expect(readSession(request(`pg_session=${value}`), env, 1_000)).toEqual({ userId, expiresAt: 2_000 });
  });
  it('rejects a tampered payload, a wrong secret and an expired session', () => {
    const value = signSession({ userId, expiresAt: 2_000 }, env.sessionSecret);
    const [payload, mac] = value.split('.');
    const forged = Buffer.from(JSON.stringify({ userId: '00000000-0000-4000-8000-000000000002', expiresAt: 2_000 })).toString('base64url');
    expect(() => readSession(request(`pg_session=${forged}.${mac}`), env, 1_000)).toThrow(/Invalid session/);
    expect(() => readSession(request(`pg_session=${payload}.${mac}`), { ...env, sessionSecret: 't'.repeat(32) }, 1_000)).toThrow(/Invalid session/);
    expect(() => readSession(request(`pg_session=${value}`), env, 3_000)).toThrow(/expired/);
  });
  it('sets Secure on https and SameSite=Lax so the OAuth redirect lands signed in', () => {
    expect(sessionCookie('v', env)).toBe('pg_session=v; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800; Secure');
  });
  it('rejects a cookie with a trailing empty segment', () => {
    const value = signSession({ userId, expiresAt: 2_000 }, env.sessionSecret);
    expect(() => readSession(request(`pg_session=${value}.`), env, 1_000)).toThrow(/Invalid session/);
  });
});
