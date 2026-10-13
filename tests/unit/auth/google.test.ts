import { describe, expect, it } from 'vitest';
import { completeGoogleSignIn, startGoogleSignIn, type GoogleClient } from '../../../src/server/http/google';
import { memoryStore } from './test-store';
import type { AuthEnvironment } from '../../../src/server/env';

const env: AuthEnvironment = { mode: 'google', appOrigin: 'https://pg.example', sessionSecret: 's'.repeat(32), google: { clientId: 'id', clientSecret: 'secret' } };
const client = (claims: Record<string, unknown>): GoogleClient => ({
  createAuthorizationURL: (state, verifier) => new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&v=${verifier.length}`),
  exchange: async () => claims,
});

describe('google sign-in', () => {
  it('starts with state and PKCE verifier cookies and redirects to Google', async () => {
    const response = startGoogleSignIn(env, client({}));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//);
    const cookies = response.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/pg_oauth_state=[^;]+; HttpOnly; SameSite=Lax; Path=\/api\/auth; Max-Age=600; Secure/);
    expect(cookies).toMatch(/pg_oauth_verifier=/);
  });
  it('rejects a callback whose state does not match the cookie', async () => {
    const store = memoryStore();
    const request = new Request('https://pg.example/api/auth/google/callback?code=c&state=evil', { headers: { cookie: 'pg_oauth_state=good; pg_oauth_verifier=v' } });
    const response = await completeGoogleSignIn(request, env, store, client({ sub: '1', email: 'a@x.example', email_verified: true, name: 'A' }));
    expect(response.status).toBe(400);
    expect(store.users.size).toBe(0);
  });
  it('provisions a new user once, sets the session and redirects home', async () => {
    const store = memoryStore();
    const make = () => new Request('https://pg.example/api/auth/google/callback?code=c&state=good', { headers: { cookie: 'pg_oauth_state=good; pg_oauth_verifier=v' } });
    const claims = { sub: '42', email: 'a@x.example', email_verified: true, name: 'An' };
    const first = await completeGoogleSignIn(make(), env, store, client(claims));
    const second = await completeGoogleSignIn(make(), env, store, client(claims));
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe('/');
    expect(first.headers.getSetCookie().join('\n')).toMatch(/pg_session=/);
    expect(second.status).toBe(303);
    expect([...store.users.values()].filter(user => user.subject === 'google:42')).toHaveLength(1);
  });
  it('refuses an unverified email claim', async () => {
    const store = memoryStore();
    const request = new Request('https://pg.example/api/auth/google/callback?code=c&state=good', { headers: { cookie: 'pg_oauth_state=good; pg_oauth_verifier=v' } });
    const response = await completeGoogleSignIn(request, env, store, client({ sub: '7', email: 'b@x.example', email_verified: false, name: 'B' }));
    expect(response.status).toBe(403);
  });
});
