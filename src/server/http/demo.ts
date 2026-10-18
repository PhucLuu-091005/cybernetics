import { randomUUID } from 'node:crypto';
import type { AuthEnvironment } from '../env';
import { AppError } from '../errors';
import type { HttpIdentityStore } from './identity-store';
import { assertRequestOrigin } from './origin';
import type { RateLimiter } from './rate-limit';
import { returnPath } from './return-path';
import { DEMO_SESSION_TTL_MS, readSession, sessionCookie, signSession } from './session';

export const DEMO_ENTRY = '/api/auth/demo';
export const DEMO_PER_ADDRESS_PER_HOUR = 20;
// One process serves the demo, and a spoofed X-Forwarded-For passes the per-address limit, so this caps the database.
export const DEMO_PER_HOUR = 300;
const HOUR = 3_600_000;
const BOT =
  /bot|crawler|spider|preview|slackbot|facebookexternalhit|whatsapp|telegrambot|discordbot|curl/i;

export type DemoDeps = { env: AuthEnvironment; store: HttpIdentityStore; limiter: RateLimiter };
export type DemoAnswer = { location: string; cookie?: string };

export const demoEntryPath = (next: string | null) =>
  next ? `${DEMO_ENTRY}?next=${encodeURIComponent(next)}` : DEMO_ENTRY;

export const isBot = (userAgent: string | null) => !userAgent || BOT.test(userAgent);

/** Only a person's browser opening a page earns a sandbox; previews, HEAD and fetches do not. */
function isPageVisit(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return (
    request.method === 'GET' &&
    !isBot(request.headers.get('user-agent')) &&
    (accept.includes('text/html') || request.headers.get('rsc') === '1')
  );
}

const address = (request: Request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

async function hasSession(request: Request, { env, store }: DemoDeps): Promise<boolean> {
  try {
    return (await store.resolveSessionUser(readSession(request, env).userId)) !== null;
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') return false;
    throw error;
  }
}

async function newSandbox(
  request: Request,
  { env, store, limiter }: DemoDeps,
): Promise<DemoAnswer> {
  const now = Date.now();
  try {
    limiter.consume(`demo:${address(request)}`, DEMO_PER_ADDRESS_PER_HOUR, now, HOUR);
    limiter.consume('demo:all', DEMO_PER_HOUR, now, HOUR);
  } catch (error) {
    if (error instanceof AppError && error.code === 'RATE_LIMITED')
      return { location: '/welcome?reason=busy' };
    throw error;
  }
  const { userId } = await store.provisionUser({
    subject: `demo:${randomUUID()}`,
    email: null,
    name: 'Demo visitor',
  });
  const cookie = sessionCookie(
    signSession({ userId, expiresAt: now + DEMO_SESSION_TTL_MS }, env.sessionSecret),
    env,
  );
  return { location: '/', cookie };
}

export async function enterDemo(request: Request, deps: DemoDeps): Promise<DemoAnswer> {
  if (deps.env.mode !== 'demo') throw new AppError('NOT_FOUND', 'Not found');
  const next = returnPath(new URL(request.url).searchParams.get('next')) ?? '/';
  if (await hasSession(request, deps)) return { location: next };
  if (!isPageVisit(request)) return { location: '/welcome' };
  const made = await newSandbox(request, deps);
  return made.cookie ? { ...made, location: next } : made;
}

/** Start over: a new anonymous person with a fresh sandbox; the old one waits for the cleanup script. */
export async function restartDemo(request: Request, deps: DemoDeps): Promise<DemoAnswer> {
  if (deps.env.mode !== 'demo') throw new AppError('NOT_FOUND', 'Not found');
  assertRequestOrigin(request, deps.env, true);
  return newSandbox(request, deps);
}
