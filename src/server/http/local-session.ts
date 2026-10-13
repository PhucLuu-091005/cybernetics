import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuthEnvironment } from '../env';
import type { HttpIdentityStore } from './identity-store';
import { HttpError } from './errors';
import { assertRequestOrigin } from './origin';
export const LOCAL_COOKIE = 'promise_local_session';
const SessionSchema = z.strictObject({ userId: z.uuid(), workspaceId: z.uuid(), expiresAt: z.number().int().positive() });
export type LocalSession = z.infer<typeof SessionSchema>;
function signature(payload: string, secret: string): string { return createHmac('sha256', secret).update(payload).digest('base64url'); }
export function signLocalSession(session: LocalSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(SessionSchema.parse(session))).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function readLocalSession(request: Request, env: AuthEnvironment, now = Date.now()): LocalSession {
  if (env.mode !== 'local' || !env.localSessionSecret || process.env.NODE_ENV === 'production') throw new HttpError('UNAUTHENTICATED', 'Local authentication unavailable', 401);
  assertRequestOrigin(request, env);
  const cookie = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${LOCAL_COOKIE}=`))?.slice(LOCAL_COOKIE.length + 1);
  if (!cookie || cookie.length > 1024) throw new HttpError('UNAUTHENTICATED', 'Session required', 401);
  const [payload, supplied, extra] = cookie.split('.');
  const expected = signature(payload, env.localSessionSecret);
  if (extra || !supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new HttpError('UNAUTHENTICATED', 'Invalid session', 401);
  let session: LocalSession;
  try { session = SessionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))); }
  catch { throw new HttpError('UNAUTHENTICATED', 'Invalid session', 401); }
  if (session.expiresAt <= now) throw new HttpError('UNAUTHENTICATED', 'Session expired', 401);
  return session;
}
export async function startLocalSession(request: Request, env: AuthEnvironment, store: HttpIdentityStore, now = Date.now()): Promise<string> {
  if (env.mode !== 'local' || !env.localSessionSecret || process.env.NODE_ENV === 'production') throw new HttpError('UNAUTHENTICATED', 'Local authentication unavailable', 401);
  if (request.method !== 'POST') throw new HttpError('FORBIDDEN', 'Session start requires POST', 405);
  assertRequestOrigin(request, env, true);
  const userId = randomUUID(), workspaceId = randomUUID();
  await store.bootstrapLocalIdentity({ userId, workspaceId, subject: `local:${userId}` });
  const value = signLocalSession({ userId, workspaceId, expiresAt: now + 86_400_000 }, env.localSessionSecret);
  return `${LOCAL_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${env.appOrigin.startsWith('https:') ? '; Secure' : ''}`;
}
export function clearLocalSession(): string { return `${LOCAL_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`; }
