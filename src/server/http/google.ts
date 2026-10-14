import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthEnvironment } from '../env';
import { AppError } from '../errors';
import type { HttpIdentityStore } from './identity-store';
import { SESSION_TTL_MS, cookieValue, sessionCookie, signSession } from './session';

export type GoogleClient = {
  createAuthorizationURL(state: string, verifier: string): URL;
  exchange(code: string, verifier: string): Promise<unknown>;
};
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const Claims = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  sub: z.string().min(1),
  email: z.email().nullable().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});
const TokenResponse = z.object({ id_token: z.string().min(1) });
const TEN_MINUTES = 600;
const randomToken = () => randomBytes(32).toString('base64url');

function idTokenPayload(token: string): unknown {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function googleClient(env: AuthEnvironment, fetcher: Fetcher = fetch): GoogleClient {
  if (!env.google) throw new Error('Google sign-in is not configured');
  const { clientId, clientSecret } = env.google,
    redirectUri = `${env.appOrigin}/api/auth/google/callback`;
  return {
    createAuthorizationURL(state, verifier) {
      const url = new URL(AUTHORIZATION_ENDPOINT);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      return url;
    },
    async exchange(code, verifier) {
      const response = await fetcher(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
          code_verifier: verifier,
        }).toString(),
      });
      if (!response.ok)
        throw new AppError('UNAUTHENTICATED', 'Google sign-in failed. Start again.');
      const body = TokenResponse.safeParse(await response.json().catch(() => null));
      // The ID token arrives directly from Google's token endpoint over TLS, so OIDC permits skipping signature verification here.
      return body.success ? idTokenPayload(body.data.id_token) : null;
    },
  };
}
const flowCookie = (name: string, value: string, env: AuthEnvironment, maxAge = TEN_MINUTES) =>
  `${name}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}${env.appOrigin.startsWith('https:') ? '; Secure' : ''}`;

export function startGoogleSignIn(env: AuthEnvironment, client: GoogleClient): Response {
  const state = randomToken(),
    verifier = randomToken();
  const headers = new Headers({
    Location: client.createAuthorizationURL(state, verifier).toString(),
    'Cache-Control': 'private, no-store',
  });
  headers.append('Set-Cookie', flowCookie('pg_oauth_state', state, env));
  headers.append('Set-Cookie', flowCookie('pg_oauth_verifier', verifier, env));
  return new Response(null, { status: 302, headers });
}

function finishCallback(
  env: AuthEnvironment,
  status: number,
  outcome: { message: string } | { session: string },
): Response {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  if ('session' in outcome) {
    headers.set('Location', '/');
    headers.append('Set-Cookie', outcome.session);
  } else headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.append('Set-Cookie', flowCookie('pg_oauth_state', '', env, 0));
  headers.append('Set-Cookie', flowCookie('pg_oauth_verifier', '', env, 0));
  return new Response('message' in outcome ? outcome.message : null, { status, headers });
}

export async function completeGoogleSignIn(
  request: Request,
  env: AuthEnvironment,
  store: HttpIdentityStore,
  client: GoogleClient,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(request.url),
    state = cookieValue(request, 'pg_oauth_state'),
    verifier = cookieValue(request, 'pg_oauth_verifier');
  const code = url.searchParams.get('code');
  if (!code || !state || !verifier || url.searchParams.get('state') !== state)
    return finishCallback(env, 400, { message: 'Sign-in expired. Start again.' });
  let payload: unknown;
  try {
    payload = await client.exchange(code, verifier);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
      return finishCallback(env, 401, { message: error.message });
    throw error;
  }
  const claims = Claims.safeParse(payload);
  if (!claims.success)
    return finishCallback(env, 400, { message: 'Google sign-in returned an unexpected response.' });
  const { iss, aud, exp, sub, email, email_verified, name } = claims.data;
  if (!ISSUERS.includes(iss) || aud !== env.google?.clientId || exp * 1000 <= now)
    return finishCallback(env, 401, { message: 'Google sign-in failed. Start again.' });
  if (email_verified === false)
    return finishCallback(env, 403, { message: 'Google account email is not verified.' });
  const { userId } = await store.provisionUser({
    subject: `google:${sub}`,
    email: email ?? null,
    name: name?.trim().slice(0, 200) || email || 'Google user',
  });
  return finishCallback(env, 303, {
    session: sessionCookie(
      signSession({ userId, expiresAt: now + SESSION_TTL_MS }, env.sessionSecret),
      env,
    ),
  });
}
