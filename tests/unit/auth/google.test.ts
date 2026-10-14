import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  completeGoogleSignIn,
  googleClient,
  startGoogleSignIn,
  type GoogleClient,
} from '../../../src/server/http/google';
import { memoryStore } from './test-store';
import type { AuthEnvironment } from '../../../src/server/env';

const env: AuthEnvironment = {
  mode: 'google',
  appOrigin: 'https://pg.example',
  sessionSecret: 's'.repeat(32),
  google: { clientId: 'id', clientSecret: 'secret' },
};
const now = 1_800_000_000_000;
const valid = (extra: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: 'id',
  exp: now / 1000 + 3600,
  sub: '1',
  email: 'a@x.example',
  email_verified: true,
  name: 'A',
  ...extra,
});
const client = (claims: unknown): GoogleClient => ({
  createAuthorizationURL: (state, verifier) =>
    new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&v=${verifier.length}`),
  exchange: async () => claims,
});
const callback = (
  query = 'code=c&state=good',
  cookie = 'pg_oauth_state=good; pg_oauth_verifier=v',
) =>
  new Request(`https://pg.example/api/auth/google/callback?${query}`, {
    headers: cookie ? { cookie } : {},
  });
const clearsFlowCookies = (response: Response) => {
  const cookies = response.headers.getSetCookie().join('\n');
  expect(cookies).toMatch(
    /pg_oauth_state=; HttpOnly; SameSite=Lax; Path=\/api\/auth; Max-Age=0; Secure/,
  );
  expect(cookies).toMatch(
    /pg_oauth_verifier=; HttpOnly; SameSite=Lax; Path=\/api\/auth; Max-Age=0; Secure/,
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
};
const jwt = (payload: object) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('google sign-in', () => {
  it('starts with state and PKCE verifier cookies and redirects to Google', async () => {
    const response = startGoogleSignIn(env, client({}));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//);
    const cookies = response.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(
      /pg_oauth_state=[^;]+; HttpOnly; SameSite=Lax; Path=\/api\/auth; Max-Age=600; Secure/,
    );
    expect(cookies).toMatch(/pg_oauth_verifier=/);
  });
  it('rejects a callback whose state does not match the cookie', async () => {
    const store = memoryStore();
    const response = await completeGoogleSignIn(
      callback('code=c&state=evil'),
      env,
      store,
      client(valid()),
      now,
    );
    expect(response.status).toBe(400);
    expect(store.users.size).toBe(0);
    clearsFlowCookies(response);
  });
  it('rejects a callback without a state cookie, a verifier cookie or a code', async () => {
    const store = memoryStore();
    for (const request of [
      callback(undefined, 'pg_oauth_verifier=v'),
      callback(undefined, 'pg_oauth_state=good'),
      callback('state=good'),
    ]) {
      const response = await completeGoogleSignIn(request, env, store, client(valid()), now);
      expect(response.status).toBe(400);
      clearsFlowCookies(response);
    }
    expect(store.users.size).toBe(0);
  });
  it('provisions a new user once, sets the session and redirects home', async () => {
    const store = memoryStore();
    const claims = valid({ sub: '42', name: 'An' });
    const first = await completeGoogleSignIn(callback(), env, store, client(claims), now);
    const second = await completeGoogleSignIn(callback(), env, store, client(claims), now);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe('/');
    expect(first.headers.getSetCookie().join('\n')).toMatch(/pg_session=/);
    clearsFlowCookies(first);
    expect(second.status).toBe(303);
    expect([...store.users.values()].filter((user) => user.subject === 'google:42')).toHaveLength(
      1,
    );
  });
  it('refuses an unverified email claim', async () => {
    const store = memoryStore();
    const response = await completeGoogleSignIn(
      callback(),
      env,
      store,
      client(valid({ email_verified: false })),
      now,
    );
    expect(response.status).toBe(403);
    expect(store.users.size).toBe(0);
    clearsFlowCookies(response);
  });
  it.each([
    ['a foreign issuer', { iss: 'https://evil.example' }],
    ['another audience', { aud: 'other-client' }],
    ['an expired token', { exp: now / 1000 - 1 }],
  ])('refuses an ID token with %s', async (_label, extra) => {
    const store = memoryStore();
    const response = await completeGoogleSignIn(callback(), env, store, client(valid(extra)), now);
    expect(response.status).toBe(401);
    expect(store.users.size).toBe(0);
    clearsFlowCookies(response);
  });
  it('accepts the bare accounts.google.com issuer', async () => {
    const response = await completeGoogleSignIn(
      callback(),
      env,
      memoryStore(),
      client(valid({ iss: 'accounts.google.com' })),
      now,
    );
    expect(response.status).toBe(303);
  });
  it('answers malformed claims with 400 and truncates long names', async () => {
    const store = memoryStore();
    for (const claims of [null, { ...valid(), sub: undefined }, { ...valid(), exp: 'soon' }]) {
      const response = await completeGoogleSignIn(callback(), env, store, client(claims), now);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Google sign-in returned an unexpected response.');
      clearsFlowCookies(response);
    }
    expect(store.users.size).toBe(0);
    const names: string[] = [];
    const recording = {
      ...store,
      provisionUser: async (profile: { subject: string; email: string | null; name: string }) => {
        names.push(profile.name);
        return store.provisionUser(profile);
      },
    };
    expect(
      (
        await completeGoogleSignIn(
          callback(),
          env,
          recording,
          client(valid({ name: 'n'.repeat(300) })),
          now,
        )
      ).status,
    ).toBe(303);
    expect(names).toEqual(['n'.repeat(200)]);
  });
});

describe('google OAuth client', () => {
  it('builds an S256 PKCE authorization URL', () => {
    const url = googleClient(env, async () => new Response()).createAuthorizationURL(
      'st',
      'verifier-value',
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'id',
      redirect_uri: 'https://pg.example/api/auth/google/callback',
      scope: 'openid profile email',
      state: 'st',
      code_challenge: createHash('sha256').update('verifier-value').digest('base64url'),
      code_challenge_method: 'S256',
    });
  });
  it('posts the form-encoded code exchange and decodes the ID token payload', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ id_token: jwt(valid()) });
    };
    await expect(googleClient(env, fetcher).exchange('the-code', 'the-verifier')).resolves.toEqual(
      valid(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0].init?.method).toBe('POST');
    expect(new Headers(calls[0].init?.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://pg.example/api/auth/google/callback',
      client_id: 'id',
      client_secret: 'secret',
      code_verifier: 'the-verifier',
    });
  });
  it('maps a non-2xx token response to a 401 sign-in failure', async () => {
    const real = googleClient(env, async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    await expect(real.exchange('c', 'v')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const store = memoryStore();
    const response = await completeGoogleSignIn(callback(), env, store, real, now);
    expect(response.status).toBe(401);
    expect(store.users.size).toBe(0);
    clearsFlowCookies(response);
  });
  it('treats a token response without a decodable ID token as malformed', async () => {
    for (const body of [{}, { id_token: 'not-a-jwt' }]) {
      const response = await completeGoogleSignIn(
        callback(),
        env,
        memoryStore(),
        googleClient(env, async () => Response.json(body)),
        now,
      );
      expect(response.status).toBe(400);
    }
  });
});
