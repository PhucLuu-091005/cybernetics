import { Google, OAuth2RequestError, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import { z } from 'zod';
import type { AuthEnvironment } from '../env';
import { AppError } from '../errors';
import type { HttpIdentityStore } from './identity-store';
import { SESSION_TTL_MS, cookieValue, sessionCookie, signSession } from './session';

export type GoogleClient = { createAuthorizationURL(state: string, verifier: string): URL; exchange(code: string, verifier: string): Promise<unknown> };
const Claims = z.object({ sub: z.string().min(1), email: z.email().nullable().optional(), email_verified: z.boolean().optional(), name: z.string().min(1).max(200).optional() });
const TEN_MINUTES = 600;

export function googleClient(env: AuthEnvironment): GoogleClient {
  if (!env.google) throw new Error('Google sign-in is not configured');
  const google = new Google(env.google.clientId, env.google.clientSecret, `${env.appOrigin}/api/auth/google/callback`);
  return {
    createAuthorizationURL: (state, verifier) => google.createAuthorizationURL(state, verifier, ['openid', 'profile', 'email']),
    // The ID token arrives directly from Google's token endpoint over TLS, so OIDC permits skipping signature verification here.
    exchange: async (code, verifier) => {
      try { return decodeIdToken((await google.validateAuthorizationCode(code, verifier)).idToken()); }
      catch (error) { if (error instanceof OAuth2RequestError) throw new AppError('UNAUTHENTICATED', 'Sign-in expired. Start again.'); throw error; }
    },
  };
}
const flowCookie = (name: string, value: string, env: AuthEnvironment, maxAge = TEN_MINUTES) =>
  `${name}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}${env.appOrigin.startsWith('https:') ? '; Secure' : ''}`;

export function startGoogleSignIn(env: AuthEnvironment, client: GoogleClient): Response {
  const state = generateState(), verifier = generateCodeVerifier();
  const headers = new Headers({ Location: client.createAuthorizationURL(state, verifier).toString(), 'Cache-Control': 'private, no-store' });
  headers.append('Set-Cookie', flowCookie('pg_oauth_state', state, env));
  headers.append('Set-Cookie', flowCookie('pg_oauth_verifier', verifier, env));
  return new Response(null, { status: 302, headers });
}

export async function completeGoogleSignIn(request: Request, env: AuthEnvironment, store: HttpIdentityStore, client: GoogleClient, now = Date.now()): Promise<Response> {
  const url = new URL(request.url), state = cookieValue(request, 'pg_oauth_state'), verifier = cookieValue(request, 'pg_oauth_verifier');
  const code = url.searchParams.get('code');
  if (!code || !state || !verifier || url.searchParams.get('state') !== state) return new Response('Sign-in expired. Start again.', { status: 400 });
  const claims = Claims.safeParse(await client.exchange(code, verifier));
  if (!claims.success || claims.data.email_verified === false) return new Response('Google account email is not verified.', { status: 403 });
  const { userId } = await store.provisionUser({ subject: `google:${claims.data.sub}`, email: claims.data.email ?? null, name: claims.data.name ?? claims.data.email ?? 'Google user' });
  const headers = new Headers({ Location: '/', 'Cache-Control': 'private, no-store' });
  headers.append('Set-Cookie', sessionCookie(signSession({ userId, expiresAt: now + SESSION_TTL_MS }, env.sessionSecret), env));
  headers.append('Set-Cookie', flowCookie('pg_oauth_state', '', env, 0));
  headers.append('Set-Cookie', flowCookie('pg_oauth_verifier', '', env, 0));
  return new Response(null, { status: 303, headers });
}
