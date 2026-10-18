import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, HEAD, POST } from '../../../src/app/api/auth/demo/route';
import { configureApp, resetApp } from '../../../src/server/app';
import { projects, users, workspaceMembers } from '../../../src/server/db/schema';
import { LARKSPUR_PROJECT } from '../../../src/server/tracker/seed/larkspur';
import { createTestDatabase, type TestDb } from '../../support/db';

const origin = 'https://pg.example';
const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const limiterState = globalThis as typeof globalThis & { promiseRateLimiter?: unknown };

type Visit = { next?: string; cookie?: string; ua?: string; accept?: string; ip?: string };
const headersOf = ({ cookie, ua = BROWSER, accept = 'text/html,*/*;q=0.8', ip }: Visit) => ({
  host: 'pg.example',
  'user-agent': ua,
  accept,
  ...(cookie ? { cookie } : {}),
  ...(ip ? { 'x-forwarded-for': `${ip}, 10.0.0.1` } : {}),
});
const url = (next?: string) =>
  `${origin}/api/auth/demo${next ? `?next=${encodeURIComponent(next)}` : ''}`;
const visit = (v: Visit = {}) => GET(new Request(url(v.next), { headers: headersOf(v) }));
const cookieOf = (response: Response) => response.headers.get('set-cookie')?.split(';')[0] ?? '';

describe.skipIf(!process.env.TEST_DATABASE_URL)('demo mode: every visitor gets a sandbox', () => {
  let t: TestDb;
  const demoUsers = async () =>
    (
      await t.db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(like(users.subject, 'demo:%'))
    )[0].n;
  const sandboxOf = async (cookie: string) => {
    const payload = JSON.parse(
      Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url').toString('utf8'),
    ) as { userId: string };
    const [row] = await t.db
      .select({ projectId: projects.id, subject: users.subject, name: users.name })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .innerJoin(projects, eq(projects.workspaceId, workspaceMembers.workspaceId))
      .where(and(eq(users.id, payload.userId), eq(projects.title, LARKSPUR_PROJECT.title)));
    return { userId: payload.userId, ...row };
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'demo');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', 'demo-mode-test-secret-of-32-bytes!!!');
    configureApp({ db: t.db });
  });
  beforeEach(() => {
    delete limiterState.promiseRateLimiter;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetApp();
    await t?.close();
  });

  it('a first visit makes a person, a Larkspur sandbox and a 30-day cookie, and lands on the page', async () => {
    const response = await visit({ next: '/projects/x/graph?view=1' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/projects/x/graph?view=1');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const set = response.headers.get('set-cookie')!;
    expect(set).toMatch(
      /^pg_session=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/,
    );
    const sandbox = await sandboxOf(cookieOf(response));
    expect(sandbox.subject).toMatch(/^demo:[0-9a-f-]{36}$/);
    expect(sandbox.name).toBe('Demo visitor');
    expect(sandbox.projectId).toBeTruthy();
  });

  it('opens the home page when the asked page is missing or foreign', async () => {
    for (const next of [undefined, '//evil.example/x', 'https://evil.example'])
      expect((await visit({ next })).headers.get('location')).toBe('/');
  });

  it('a second visit with the cookie reuses the sandbox and makes nothing', async () => {
    const first = await visit();
    const before = await demoUsers();
    const again = await visit({ cookie: cookieOf(first), next: '/projects/y/settings' });
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toBe('/projects/y/settings');
    expect(again.headers.get('set-cookie')).toBeNull();
    expect(await demoUsers()).toBe(before);
  });

  it('two visitors get separate sandboxes', async () => {
    const [a, b] = [
      await sandboxOf(cookieOf(await visit())),
      await sandboxOf(cookieOf(await visit())),
    ];
    expect(a.userId).not.toBe(b.userId);
    expect(a.projectId).not.toBe(b.projectId);
  });

  it('Start over gives a new person and a fresh sandbox, for a same-origin form only', async () => {
    const first = cookieOf(await visit());
    const post = (from: string | null) =>
      POST(
        new Request(url(), {
          method: 'POST',
          headers: { ...headersOf({ cookie: first }), ...(from ? { origin: from } : {}) },
        }),
      );
    const fresh = await post(origin);
    expect(fresh.status).toBe(303);
    expect(fresh.headers.get('location')).toBe('/');
    const [old, now] = [await sandboxOf(first), await sandboxOf(cookieOf(fresh))];
    expect(now.userId).not.toBe(old.userId);
    expect(now.projectId).not.toBe(old.projectId);
    const before = await demoUsers();
    for (const from of ['https://evil.example', null]) {
      const refused = await post(from);
      expect(refused.status).toBe(403);
      expect(refused.headers.get('set-cookie')).toBeNull();
    }
    expect(await demoUsers()).toBe(before);
  });

  it('bots, link previews, HEAD and non-page requests get the welcome page and make nothing', async () => {
    const before = await demoUsers();
    const bots = [
      'Googlebot/2.1 (+http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'facebookexternalhit/1.1',
      'WhatsApp/2.23.20.0',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'curl/8.7.1',
      'SomeCrawler/1.0',
      'Spider 3',
      'Link Preview Fetcher',
      '',
    ];
    for (const ua of bots) {
      const response = await visit({ ua });
      expect(response.status, ua).toBe(303);
      expect(response.headers.get('location'), ua).toBe('/welcome');
      expect(response.headers.get('set-cookie'), ua).toBeNull();
    }
    const head = await HEAD(new Request(url(), { method: 'HEAD', headers: headersOf({}) }));
    expect(head.headers.get('location')).toBe('/welcome');
    expect((await visit({ accept: 'application/json' })).headers.get('location')).toBe('/welcome');
    const prefetch = await GET(
      new Request(url(), {
        headers: { ...headersOf({ accept: '*/*' }), rsc: '1', 'next-router-prefetch': '1' },
      }),
    );
    expect(prefetch.headers.get('location')).toBe('/welcome');
    expect(await demoUsers()).toBe(before);
  });

  it('limits new sandboxes to 20 an hour for one address, with a plain page past it', async () => {
    for (let i = 0; i < 20; i++)
      expect((await visit({ ip: '203.0.113.9' })).headers.get('set-cookie')).toBeTruthy();
    const before = await demoUsers();
    const refused = await visit({ ip: '203.0.113.9' });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe('/welcome?reason=busy');
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect(await demoUsers()).toBe(before);
    expect((await visit({ ip: '198.51.100.4' })).headers.get('set-cookie')).toBeTruthy();
  }, 60_000);

  it('answers 404 outside demo mode', async () => {
    vi.stubEnv('AUTH_MODE', 'google');
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    try {
      expect((await visit()).status).toBe(404);
    } finally {
      vi.stubEnv('AUTH_MODE', 'demo');
    }
  });
});
