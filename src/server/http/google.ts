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
const TEN_MINUTES = 600,
  TOKEN_TIMEOUT_MS = 10_000;
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
      const signal = AbortSignal.timeout(TOKEN_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetcher(TOKEN_ENDPOINT, {
          method: 'POST',
          signal,
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
      } catch {
        throw new AppError('UNAUTHENTICATED', 'Google could not be reached in time.');
      }
      if (!response.ok) throw new AppError('UNAUTHENTICATED', 'Google sign-in failed.');
      const json: unknown = await response.json().catch(() => null);
      if (signal.aborted)
        throw new AppError('UNAUTHENTICATED', 'Google could not be reached in time.');
      const body = TokenResponse.safeParse(json);
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

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
/** The callback answers outside the app shell, so the page carries its own copy of the palette. A used or expired code can only be retried from the start. */
function failurePage(message: string, expired: boolean): string {
  const link = expired ? 'Sign-in expired — start again' : 'Start again';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in · Promise Graph</title><style>
:root { --panel: #E7ECE7; --surface: #F5F7F4; --ink: #17212D; --ink-2: #4B5663; --route: #2C5AA2; --rule: #C9D1CB; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --panel: #11191F; --surface: #18222A; --ink: #E2E8E3; --ink-2: #A3AEB5; --route: #73A0EA; --rule: #2A363F; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: var(--panel); color: var(--ink); font: 400 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 380px; width: 100%; background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 28px; }
h1 { font-size: 20px; margin: 0 0 8px; } p { color: var(--ink-2); margin: 0 0 20px; }
.restart { display: inline-block; background: var(--route); color: #fff; font-weight: 600; text-decoration: none; padding: 10px 16px; border-radius: 6px; }
.restart:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
</style></head><body><main><h1>${expired ? 'Sign-in expired' : 'Sign-in failed'}</h1><p>${escapeHtml(message)}</p><a class="restart" href="/signin">${link}</a></main></body></html>`;
}

function finishCallback(
  env: AuthEnvironment,
  status: number,
  outcome: { message: string; expired?: boolean } | { session: string },
): Response {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  if ('session' in outcome) {
    headers.set('Location', '/');
    headers.append('Set-Cookie', outcome.session);
  } else headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.append('Set-Cookie', flowCookie('pg_oauth_state', '', env, 0));
  headers.append('Set-Cookie', flowCookie('pg_oauth_verifier', '', env, 0));
  return new Response(
    'message' in outcome ? failurePage(outcome.message, outcome.expired ?? false) : null,
    { status, headers },
  );
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
    return finishCallback(env, 400, {
      message: 'This sign-in link was already used or is too old.',
      expired: true,
    });
  let payload: unknown;
  try {
    payload = await client.exchange(code, verifier);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
      return finishCallback(env, 401, { message: error.message, expired: true });
    throw error;
  }
  const claims = Claims.safeParse(payload);
  if (!claims.success)
    return finishCallback(env, 400, { message: 'Google sign-in returned an unexpected response.' });
  const { iss, aud, exp, sub, email, email_verified, name } = claims.data;
  if (!ISSUERS.includes(iss) || aud !== env.google?.clientId || exp * 1000 <= now)
    return finishCallback(env, 401, { message: 'Google sign-in failed.', expired: true });
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
