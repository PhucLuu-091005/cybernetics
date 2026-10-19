import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuthEnvironment } from '../env';
import { AppError } from '../errors';
import type { HttpIdentityStore } from './identity-store';
import { assertRequestOrigin } from './origin';
export const SESSION_COOKIE = 'pg_session';
export const SESSION_TTL_MS = 604_800_000;
// A demo visitor has no way to sign in again, so the cookie is their only key to the sandbox.
export const DEMO_SESSION_TTL_MS = 2_592_000_000;
const sessionTtl = (env: AuthEnvironment) =>
  env.mode === 'demo' ? DEMO_SESSION_TTL_MS : SESSION_TTL_MS;
const SessionSchema = z.strictObject({ userId: z.uuid(), expiresAt: z.number().int().positive() });
type Session = z.infer<typeof SessionSchema>;
const secure = (env: AuthEnvironment) => (env.appOrigin.startsWith('https:') ? '; Secure' : '');
function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
export function cookieValue(request: Request, name: string): string | null {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}
export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(SessionSchema.parse(session))).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function readSession(request: Request, env: AuthEnvironment, now = Date.now()): Session {
  if (env.mode === 'local' && process.env.NODE_ENV === 'production')
    throw new AppError('UNAUTHENTICATED', 'Local authentication unavailable');
  assertRequestOrigin(request, env);
  const cookie = cookieValue(request, SESSION_COOKIE);
  if (!cookie || cookie.length > 1024) throw new AppError('UNAUTHENTICATED', 'Session required');
  const [payload, supplied, extra] = cookie.split('.');
  const expected = signature(payload, env.sessionSecret);
  if (
    extra !== undefined ||
    !supplied ||
    !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    throw new AppError('UNAUTHENTICATED', 'Invalid session');
  let session: Session;
  try {
    session = SessionSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Invalid session');
  }
  if (session.expiresAt <= now) throw new AppError('UNAUTHENTICATED', 'Session expired');
  return session;
}
export function sessionCookie(value: string, env: AuthEnvironment): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionTtl(env) / 1000}${secure(env)}`;
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
const LabelSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/, 'Label must be 1 to 40 lowercase letters, digits or hyphens');
/** A label gives each e2e spec its own local user, so specs do not share the per-user rate limit or sandbox state. */
async function localLabel(request: Request): Promise<string | undefined> {
  const type = request.headers.get('content-type') ?? '';
  let raw: unknown;
  try {
    if (type.startsWith('application/json'))
      raw = ((await request.json()) as { label?: unknown } | null)?.label;
    else if (
      type.startsWith('application/x-www-form-urlencoded') ||
      type.startsWith('multipart/form-data')
    )
      raw = (await request.formData()).get('label') ?? undefined;
  } catch {
    throw new AppError('VALIDATION', 'Sign-in body must be a form or a JSON object');
  }
  if (raw === undefined) return undefined;
  const parsed = LabelSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError('VALIDATION', 'Invalid local sign-in label', {
      errors: [{ path: 'label', message: parsed.error.issues[0].message }],
    });
  return parsed.data;
}
export async function startLocalSession(
  request: Request,
  env: AuthEnvironment,
  store: HttpIdentityStore,
  now = Date.now(),
): Promise<string> {
  if (env.mode !== 'local' || process.env.NODE_ENV === 'production')
    throw new AppError('UNAUTHENTICATED', 'Local authentication unavailable');
  assertRequestOrigin(request, env, true);
  const label = await localLabel(request);
  const { userId } = await store.provisionUser({
    subject: `local:${label ?? 'dev'}`,
    // A local address lets an invite by email reach a local user, as a Google sign-in does.
    email: `${label ?? 'dev'}@local.test`,
    name: label ? `Local developer (${label})` : 'Local developer',
  });
  return sessionCookie(
    signSession({ userId, expiresAt: now + SESSION_TTL_MS }, env.sessionSecret),
    env,
  );
}
