import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo } from '../../support/tracker-db';
import { configureApp, resetApp } from '../../../src/server/app';
import { SESSION_COOKIE, signSession } from '../../../src/server/http/session';
import type { ActorContext } from '../../../src/contracts';

const origin = 'http://localhost:3000';
const secret = 'rest-adapter-test-secret-of-32-bytes!';
const apiRoot = join(process.cwd(), 'src/app/api/v1');
type Handler = (
  request: Request,
  context: { params?: Promise<Record<string, string>> },
) => Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>> & {
  runtime?: string;
};
type Reply = { status: number; headers: Headers; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const expectedRoutes = [
  '/avatars/:userId/:hash',
  '/avatars/members/:memberId/:hash',
  '/me/avatar',
  '/me/keys',
  '/me/keys/:tokenId',
  '/projects',
  '/projects/:projectId',
  '/projects/:projectId/agent-tokens',
  '/projects/:projectId/agent-tokens/:tokenId',
  '/projects/:projectId/members',
  '/projects/:projectId/members/:memberId',
  '/projects/:projectId/teams',
  '/projects/:projectId/teams/:teamId',
  '/projects/:projectId/tracker',
  '/projects/:projectId/tracker/act-as',
  '/projects/:projectId/tracker/queue',
  '/projects/:projectId/tracker/queue/:queueId',
  '/projects/:projectId/tracker/crs',
  '/projects/:projectId/tracker/crs/:num/ops',
  '/projects/:projectId/tracker/crs/:num/ops/:index',
  '/projects/:projectId/tracker/crs/:num/actions',
  '/projects/:projectId/tracker/version',
];

function routeFiles(): string[] {
  try {
    return (readdirSync(apiRoot, { recursive: true }) as string[]).filter(
      (file) => file.endsWith(`${sep}route.ts`) || file === 'route.ts',
    );
  } catch {
    return [];
  }
}
const patternOf = (file: string) =>
  `/${relative(apiRoot, join(apiRoot, file)).split(sep).slice(0, -1).join('/')}`
    .replace(/\[(\w+)\]/g, ':$1')
    .replace(/\/$/, '');

describe.skipIf(!process.env.TEST_DATABASE_URL)('REST adapters', () => {
  let t: TestDb, ctx: ActorContext, projectId: string;
  const routes: { pattern: string; module: RouteModule }[] = [];
  const cookieFor = (userId: string) =>
    `${SESSION_COOKIE}=${signSession({ userId, expiresAt: Date.now() + 600_000 }, secret)}`;
  function resolve(path: string): { module: RouteModule; params: Record<string, string> } {
    const segments = path.split('/').filter(Boolean);
    const candidates = routes
      .flatMap(({ pattern, module }) => {
        const parts = pattern.split('/').filter(Boolean),
          params: Record<string, string> = {};
        if (parts.length !== segments.length) return [];
        for (const [index, part] of parts.entries()) {
          if (part.startsWith(':')) params[part.slice(1)] = segments[index];
          else if (part !== segments[index]) return [];
        }
        return [{ module, params, literals: parts.filter((part) => !part.startsWith(':')).length }];
      })
      .sort((a, b) => b.literals - a.literals);
    if (!candidates.length) throw new Error(`No route for ${path}`);
    return candidates[0];
  }
  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    opts: { origin?: string; cookie?: string | null; raw?: string } = {},
  ): Promise<Reply> {
    const { module, params } = resolve(path.split('?')[0]);
    const handler = module[method];
    if (!handler) throw new Error(`No ${method} handler for ${path}`);
    const headers: Record<string, string> = {};
    const cookie = opts.cookie === undefined ? cookieFor(ctx.userId) : opts.cookie;
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET') {
      headers.origin = opts.origin ?? origin;
      headers['content-type'] = 'application/json';
    }
    const request = new Request(`${origin}/api/v1${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : (opts.raw ?? JSON.stringify(body ?? {})),
    });
    const response = await handler(request, {
      params: Object.keys(params).length ? Promise.resolve(params) : undefined,
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', secret);
    configureApp({ db: t.db });
    for (const file of routeFiles())
      routes.push({
        pattern: patternOf(file),
        module: (await import(join(apiRoot, file))) as RouteModule,
      });
    ctx = await testActor(t.db);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetApp();
    await t?.close();
  });
  beforeEach(async () => {
    // Each test starts with a fresh per-user rate-limit window; limits are covered by the actor tests.
    delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown }).promiseRateLimiter;
    ({ projectId } = await seedDemo(t.db, ctx));
  });

  it('exposes every API route on the Node runtime', () => {
    expect(routes.map((route) => route.pattern).sort()).toEqual([...expectedRoutes].sort());
    for (const route of routes) expect(route.module.runtime, route.pattern).toBe('nodejs');
  });
  it('rejects a mutation without the app Origin', async () => {
    const response = await call(
      'POST',
      `/projects/${projectId}/agent-tokens`,
      { label: 'Claude', idempotencyKey: 'o1' },
      { origin: 'https://evil.example' },
    );
    expect(response.status).toBe(403);
    const named = await call(
      'PATCH',
      `/projects/${projectId}/teams/engineering`,
      { name: 'Platform' },
      { origin: 'https://evil.example' },
    );
    expect(named.status).toBe(403);
  });
  it('returns 404 for a project in another workspace', async () => {
    const foreign = await seedDemo(t.db, await testActor(t.db));
    expect((await call('GET', `/projects/${foreign.projectId}`)).status).toBe(404);
    expect((await call('GET', `/projects/${foreign.projectId}/tracker`)).status).toBe(404);
  });
  it('creates a token with default scopes and shows the secret once', async () => {
    const created = await call('POST', `/projects/${projectId}/agent-tokens`, {
      label: 'Claude',
      idempotencyKey: 't1',
    });
    expect(created.body.token.scopes).toEqual(['project:read', 'queue:add']);
    expect(created.body.secret).toMatch(/^inv_/);
    const list = await call('GET', `/projects/${projectId}/agent-tokens`);
    expect(JSON.stringify(list.body)).not.toContain(created.body.secret);
    expect(
      (
        await call('POST', `/projects/${projectId}/agent-tokens`, {
          label: 'Claude',
          idempotencyKey: 't1',
        })
      ).status,
    ).toBe(409);
  });
  it('every protected response is private, no-store', async () => {
    expect((await call('GET', `/projects/${projectId}`)).headers.get('cache-control')).toBe(
      'private, no-store',
    );
  });

  it('lists tokens without hashes, pages them and revokes idempotently', async () => {
    const first = await call('POST', `/projects/${projectId}/agent-tokens`, {
      label: 'A',
      scopes: ['project:read'],
      idempotencyKey: 'ta',
    });
    await call('POST', `/projects/${projectId}/agent-tokens`, { label: 'B', idempotencyKey: 'tb' });
    const page = await call('GET', `/projects/${projectId}/agent-tokens?limit=1`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      projectId,
      items: [expect.any(Object)],
      nextCursor: expect.any(String),
    });
    expect(Object.keys(page.body.items[0]).sort()).toEqual([
      'createdAt',
      'expiresAt',
      'id',
      'kind',
      'label',
      'lastUsedAt',
      'prefix',
      'projectId',
      'revokedAt',
      'scopes',
      'userId',
    ]);
    expect(page.body.items[0].lastUsedAt).toBeNull();
    const rest = await call(
      'GET',
      `/projects/${projectId}/agent-tokens?limit=1&cursor=${page.body.nextCursor}`,
    );
    expect(rest.body.nextCursor).toBeNull();
    expect(new Set([page.body.items[0].id, rest.body.items[0].id]).size).toBe(2);
    expect([page.body.items[0].id, rest.body.items[0].id]).toContain(first.body.token.id);
    const revoked = await call(
      'DELETE',
      `/projects/${projectId}/agent-tokens/${first.body.token.id}`,
      { idempotencyKey: 'r1' },
    );
    expect(revoked.status).toBe(200);
    expect(
      (
        await call('DELETE', `/projects/${projectId}/agent-tokens/${first.body.token.id}`, {
          idempotencyKey: 'r1',
        })
      ).body.revokedAt,
    ).toBe(revoked.body.revokedAt);
    const after = await call('GET', `/projects/${projectId}/agent-tokens`);
    expect(
      after.body.items.find((token: { id: string }) => token.id === first.body.token.id).revokedAt,
    ).toBe(revoked.body.revokedAt);
  });
  it('creates, lists and revokes personal keys apart from the project keys', async () => {
    const created = await call('POST', '/me/keys', {
      label: 'Laptop',
      scopes: ['project:read', 'crs:merge'],
      idempotencyKey: 'k1',
    });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatchObject({ kind: 'personal', projectId: null });
    expect(created.body.secret).toMatch(/^inv_/);
    await call('POST', `/projects/${projectId}/agent-tokens`, { label: 'P', idempotencyKey: 'k1' });
    const keys = await call('GET', '/me/keys');
    expect(keys.body).toMatchObject({ projectId: null });
    expect(keys.body.items.map((key: { label: string }) => key.label)).toEqual(['Laptop']);
    const tokens = await call('GET', `/projects/${projectId}/agent-tokens`);
    expect(tokens.body.items.map((key: { label: string }) => key.label)).toEqual(['P']);
    expect((await call('POST', '/me/keys', { label: 'Again', idempotencyKey: 'k1' })).status).toBe(
      409,
    );
    expect(
      (await call('POST', '/me/keys', { label: 'X', projectId, idempotencyKey: 'k2' })).status,
    ).toBe(400);
    const projectKey = tokens.body.items[0].id;
    expect((await call('DELETE', `/me/keys/${projectKey}`, { idempotencyKey: 'r0' })).status).toBe(
      404,
    );
    const revoked = await call('DELETE', `/me/keys/${created.body.token.id}`, {
      idempotencyKey: 'r1',
    });
    expect(revoked.body).toMatchObject({ projectId: null, revokedAt: expect.any(String) });
    const other = await testActor(t.db);
    expect(
      (
        await call(
          'DELETE',
          `/me/keys/${created.body.token.id}`,
          { idempotencyKey: 'r2' },
          {
            cookie: cookieFor(other.userId),
          },
        )
      ).status,
    ).toBe(404);
  });
  it('refuses a personal key with a right its person holds in no project', async () => {
    const person = await testActor(t.db);
    const reply = await call(
      'POST',
      '/me/keys',
      { label: 'L', scopes: ['crs:merge'], idempotencyKey: 'n1' },
      { cookie: cookieFor(person.userId) },
    );
    expect(reply).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
  });
  it('takes the project scope from the route and rejects a different body projectId', async () => {
    const other = (await seedDemo(t.db, ctx)).projectId;
    const response = await call('POST', `/projects/${projectId}/agent-tokens`, {
      projectId: other,
      label: 'Claude',
      idempotencyKey: 'p3',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION', requestId: expect.any(String) });
  });
  it('maps oversized and malformed bodies and missing sessions to error codes', async () => {
    const tokens = `/projects/${projectId}/agent-tokens`;
    const huge = await call('POST', tokens, undefined, {
      raw: JSON.stringify({
        label: 'Big',
        idempotencyKey: 'big',
        pad: 'x'.repeat(2 * 1024 * 1024),
      }),
    });
    expect(huge).toMatchObject({ status: 413, body: { code: 'LIMIT_EXCEEDED' } });
    expect(await call('POST', tokens, undefined, { raw: '{"label":' })).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION' },
    });
    expect(await call('POST', tokens, undefined, { raw: '[]' })).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION' },
    });
    expect(await call('GET', `${tokens}?limit=1&limit=2`)).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION' },
    });
    const anonymous = await call('GET', `/projects/${projectId}`, undefined, { cookie: null });
    expect(anonymous).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } });
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
  });
  it('reads the project title, client name and time zone', async () => {
    expect(await call('GET', `/projects/${projectId}`)).toMatchObject({
      status: 200,
      body: {
        project: { id: projectId, title: 'Larkspur Capital, Fund III onboarding' },
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });
  });
  it('lists and creates projects in the session workspace', async () => {
    const created = await call('POST', '/projects', {
      title: 'New via REST',
      clientName: 'Client',
      teams: ['Engineering'],
    });
    expect(created).toMatchObject({
      status: 201,
      body: { title: 'New via REST', workspaceId: ctx.workspaceId },
    });
    const list = await call('GET', '/projects');
    expect(list.body.items.map((project: { id: string }) => project.id)).toContain(created.body.id);
    expect((await call('GET', `/projects/${created.body.id}`)).body.project.id).toBe(
      created.body.id,
    );
  });
  it('rejects an unknown field in a REST project creation and creates nothing', async () => {
    const before = (await call('GET', '/projects')).body.items.length;
    const response = await call('POST', '/projects', {
      title: 'Smuggled graph',
      clientName: 'Client',
      teams: ['Engineering'],
      snapshot: { loops: [] },
    });
    expect(response).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION', errors: [expect.objectContaining({ path: expect.any(String) })] },
    });
    expect((await call('GET', '/projects')).body.items).toHaveLength(before);
  });
});
