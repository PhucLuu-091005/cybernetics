import { randomUUID } from 'node:crypto';
import { isIP, isIPv4 } from 'node:net';
import type { AuthEnvironment } from '../env';
import { AppError } from '../errors';
import type { HttpIdentityStore } from './identity-store';
import { assertRequestOrigin } from './origin';
import type { MemoryRateLimiter } from './rate-limit';
import { returnPath } from './return-path';
import { DEMO_SESSION_TTL_MS, readSession, sessionCookie, signSession } from './session';

export const DEMO_ENTRY = '/api/auth/demo';
// One abuser behind one address hits the per-address limit long before the cap for all.
export const DEMO_LIMITS = { perAddress: 20, perHour: 300 };
const HOUR = 3_600_000;
const BOT =
  /bot|crawler|spider|preview|slackbot|facebookexternalhit|whatsapp|telegrambot|discordbot|curl/i;

export type DemoDeps = {
  env: AuthEnvironment;
  store: HttpIdentityStore;
  limiter: Pick<MemoryRateLimiter, 'consumeAll'>;
  limits?: typeof DEMO_LIMITS;
};
export type DemoAnswer = { location: string; cookie?: string };

export const demoEntryPath = (next: string | null) =>
  next ? `${DEMO_ENTRY}?next=${encodeURIComponent(next)}` : DEMO_ENTRY;

const checkPath = (next: string) =>
  `${DEMO_ENTRY}?check=1${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`;

export const isBot = (userAgent: string | null) => !userAgent || BOT.test(userAgent);

function isPageVisit(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return (
    request.method === 'GET' &&
    !isBot(request.headers.get('user-agent')) &&
    !request.headers.has('next-router-prefetch') &&
    !/prefetch/i.test(request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '') &&
    (accept.includes('text/html') || request.headers.get('rsc') === '1')
  );
}

function slash64(address: string): string {
  const [head, tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

/**
 * Cloud Run's front end appends the real client address as the last X-Forwarded-For value; the
 * values before it come from the client. TRUSTED_PROXY_HOPS counts more proxies of our own after it.
 */
export function clientAddress(
  request: Request,
  hops = Number(process.env.TRUSTED_PROXY_HOPS) || 0,
): string {
  const values = (request.headers.get('x-forwarded-for') ?? '').split(',').map((v) => v.trim());
  const value = values.length - 1 - hops >= 0 ? values[values.length - 1 - hops] : '';
  const v4 = value.slice(value.lastIndexOf(':') + 1);
  if (value.includes('.') && isIPv4(v4)) return v4;
  if (isIP(value) === 6) return slash64(value.toLowerCase());
  return 'unknown';
}

async function hasSession(request: Request, { env, store }: DemoDeps): Promise<boolean> {
  try {
    return (await store.resolveSessionUser(readSession(request, env).userId)) !== null;
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') return false;
    throw error;
  }
}

async function newSandbox(request: Request, deps: DemoDeps, next: string): Promise<DemoAnswer> {
  const { env, store, limiter, limits = DEMO_LIMITS } = deps;
  const now = Date.now();
  const address = clientAddress(request);
  const full = limiter.consumeAll(
    [
      { key: 'demo:all', limit: limits.perHour },
      { key: `demo:${address}`, limit: limits.perAddress },
    ],
    now,
    HOUR,
  );
  if (full) return { location: `/welcome?reason=${full === 'demo:all' ? 'full' : 'busy'}` };
  const { userId } = await store.provisionUser({
    subject: `demo:${randomUUID()}`,
    email: null,
    name: 'Demo visitor',
  });
  console.log(JSON.stringify({ event: 'demo_sandbox', address }));
  const cookie = sessionCookie(
    signSession({ userId, expiresAt: now + DEMO_SESSION_TTL_MS }, env.sessionSecret),
    env,
  );
  return { location: checkPath(next), cookie };
}

/**
 * A new sandbox goes through `?check=1`: when the cookie did not stick (cookies off, a cross-site
 * frame, a scanner), the check stops there instead of making a sandbox on every redirect.
 */
export async function enterDemo(request: Request, deps: DemoDeps): Promise<DemoAnswer> {
  if (deps.env.mode !== 'demo') throw new AppError('NOT_FOUND', 'Not found');
  const params = new URL(request.url).searchParams;
  const next = returnPath(params.get('next')) ?? '/';
  if (await hasSession(request, deps)) return { location: next };
  if (params.has('check')) return { location: '/welcome?reason=cookies' };
  if (!isPageVisit(request)) return { location: '/welcome' };
  // A link to a project is someone else's copy, so a new visitor opens their own graph instead.
  return newSandbox(request, deps, next.startsWith('/projects/') ? '/' : next);
}

/** Start over: a new anonymous person with a fresh sandbox; the old one waits for the cleanup script. */
export async function restartDemo(request: Request, deps: DemoDeps): Promise<DemoAnswer> {
  if (deps.env.mode !== 'demo') throw new AppError('NOT_FOUND', 'Not found');
  assertRequestOrigin(request, deps.env, true);
  return newSandbox(request, deps, '/');
}
