import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp, resetApp } from '../../../src/server/app';
import { SESSION_COOKIE, signSession } from '../../../src/server/http/session';
import { createTestDatabase, type TestDb } from '../../support/db';
import { seedDemo, workspaceGuest, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
const secret = 'tracker-routes-test-secret-of-32-bytes';
const apiRoot = join(process.cwd(), 'src/app/api/v1');
type Method = 'GET' | 'POST' | 'DELETE';
type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Reply = { status: number; headers: Headers; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const rename = (title: string) => ({ op: 'rename', a: { workItemId: 'test', title } });
const event = (by: string) => ({
  kind: 'event',
  fields: { kind: 'message', at: '2026-10-09T17:00:00+07:00', by, text: 'Sarah calls.' },
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker REST routes', () => {
  let t: TestDb, demo: Demo, jar: Map<string, string>;

  /** `route` is the folder under /api/v1, with [param] segments filled from `params`. */
  async function call(
    method: Method,
    route: string,
    params: Record<string, string>,
    body?: unknown,
    opts: { noBody?: boolean } = {},
  ): Promise<Reply> {
    const loaded = (await import(join(apiRoot, route, 'route.ts'))) as Partial<
      Record<Method, Handler>
    >;
    const handler = loaded[method];
    if (!handler) throw new Error(`No ${method} handler for ${route}`);
    const path = route.replace(/\[(\w+)\]/g, (_, name: string) => params[name]);
    const headers: Record<string, string> = {
      cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    };
    if (method !== 'GET') {
      headers.origin = origin;
      headers['content-type'] = 'application/json';
    }
    const response = await handler(
      new Request(`${origin}/api/v1/${path}`, {
        method,
        headers,
        body: method === 'GET' || opts.noBody ? undefined : JSON.stringify(body ?? {}),
      }),
      { params: Promise.resolve(params) },
    );
    const set = response.headers.get('set-cookie');
    if (set) {
      const [pair] = set.split(';');
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const tracker = 'projects/[projectId]/tracker';
  const p = () => ({ projectId: demo.projectId });
  const crOf = (reply: Reply, num: number) =>
    reply.body.crs.find((cr: { num: number }) => cr.num === num);

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', secret);
    configureApp({ db: t.db });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetApp();
    await t?.close();
  });
  beforeEach(async () => {
    delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown }).promiseRateLimiter;
    demo = await seedDemo(t.db);
    jar = new Map([
      [
        SESSION_COOKIE,
        signSession({ userId: demo.owner.userId, expiresAt: Date.now() + 600_000 }, secret),
      ],
    ]);
  });

  it('reads the seeded sandbox payload as the owner of Main', async () => {
    const reply = await call('GET', tracker, p());
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).toBe('private, no-store');
    expect(reply.body.project).toMatchObject({
      id: demo.projectId,
      demo: true,
      ownerMemberId: demo.ids.minh,
    });
    expect(reply.body.me.id).toBe(demo.ids.minh);
    expect(reply.body.members).toHaveLength(5);
    expect(reply.body.crs.map((cr: { num: number }) => cr.num)).toEqual([1, 2, 3, 4]);
    expect(reply.body.queue.events).toHaveLength(4);
  });

  it('adds a queue event and dismisses a card with a DELETE that has no body', async () => {
    const added = await call('POST', `${tracker}/queue`, p(), event('sarah'));
    expect(added.status).toBe(201);
    const card = added.body.queue.events.at(-1);
    expect(card).toMatchObject({ by: 'sarah', text: 'Sarah calls.', addedBy: demo.ids.minh });
    expect(card.agent).toBe(false);
    const dismissed = await call(
      'DELETE',
      `${tracker}/queue/[queueId]`,
      { ...p(), queueId: card.id },
      undefined,
      { noBody: true },
    );
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.queue.events.map((e: { id: string }) => e.id)).not.toContain(card.id);
    expect(
      (await call('DELETE', `${tracker}/queue/[queueId]`, { ...p(), queueId: card.id })).status,
    ).toBe(404);
    expect(
      (await call('POST', `${tracker}/queue`, p(), { ...event('sarah'), kind: 'note' })).status,
    ).toBe(400);
  });

  it('creates a change request, appends and undoes changes, then marks it ready', async () => {
    const created = await call('POST', `${tracker}/crs`, p(), { title: 'Name the test plan' });
    expect(created.status).toBe(201);
    expect(created.body.num).toBe(5);
    expect(crOf(created, 5)).toMatchObject({
      author: demo.ids.minh,
      editor: demo.ids.minh,
      status: 'draft',
      revision: 0,
    });
    const target = { ...p(), num: '5' };
    const appended = await call('POST', `${tracker}/crs/[num]/ops`, target, {
      op: rename('Test plan'),
      expectedRevision: 0,
    });
    expect(appended.status).toBe(200);
    expect(crOf(appended, 5)).toMatchObject({ revision: 1, ops: [{ op: 'rename' }] });
    const stale = await call('POST', `${tracker}/crs/[num]/ops`, target, {
      op: rename('Stale'),
      expectedRevision: 0,
    });
    expect(stale).toMatchObject({ status: 409, body: { code: 'CONFLICT' } });
    const undone = await call(
      'DELETE',
      `${tracker}/crs/[num]/ops/[index]`,
      { ...target, index: 'last' },
      { expectedRevision: 1 },
    );
    expect(crOf(undone, 5)).toMatchObject({ revision: 2, ops: [] });
    await call('POST', `${tracker}/crs/[num]/ops`, target, {
      op: rename('Test plan v2'),
      expectedRevision: 2,
    });
    expect(
      (
        await call(
          'DELETE',
          `${tracker}/crs/[num]/ops/[index]`,
          { ...target, index: '7' },
          { expectedRevision: 3 },
        )
      ).status,
    ).toBe(400);
    const ready = await call('POST', `${tracker}/crs/[num]/actions`, target, { action: 'ready' });
    expect(ready.status).toBe(200);
    expect(crOf(ready, 5).status).toBe('ready');
    expect(
      (
        await call(
          'POST',
          `${tracker}/crs/[num]/actions`,
          { ...p(), num: '99' },
          { action: 'ready' },
        )
      ).status,
    ).toBe(404);
  });

  it('merges a ready CR through the actions route only at the revision the owner saw', async () => {
    const target = { ...p(), num: '2' };
    const { revision } = crOf(await call('GET', tracker, p()), 2);
    const unseen = await call('POST', `${tracker}/crs/[num]/actions`, target, {
      action: 'merge',
    });
    expect(unseen).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    const stale = await call('POST', `${tracker}/crs/[num]/actions`, target, {
      action: 'merge',
      expectedRevision: revision + 1,
    });
    expect(stale).toMatchObject({ status: 409, body: { code: 'CONFLICT' } });
    const merged = await call('POST', `${tracker}/crs/[num]/actions`, target, {
      action: 'merge',
      expectedRevision: revision,
    });
    expect(merged.status).toBe(200);
    expect(crOf(merged, 2)).toMatchObject({ status: 'merged', mergedRev: 2 });
    expect(merged.body.commits.map((commit: { rev: number }) => commit.rev)).toEqual([1, 2]);
  });

  it('works as Lan after act-as: the cookie is set, and Lan cannot append to the CR of Minh', async () => {
    await call('POST', `${tracker}/crs`, p(), { title: 'Owned by Minh' });
    const switched = await call('POST', `${tracker}/act-as`, p(), { memberId: demo.ids.lan });
    expect(switched.status).toBe(200);
    expect(switched.body.me.id).toBe(demo.ids.lan);
    expect(switched.headers.get('set-cookie')).toBe(
      `pg_act_${demo.projectId}=${demo.ids.lan}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
    );
    expect((await call('GET', tracker, p())).body.me.id).toBe(demo.ids.lan);
    const denied = await call(
      'POST',
      `${tracker}/crs/[num]/ops`,
      { ...p(), num: '5' },
      { op: rename('By Lan'), expectedRevision: 0 },
    );
    expect(denied).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    const own = await call('POST', `${tracker}/crs`, p(), { title: 'Owned by Lan' });
    expect(crOf(own, own.body.num).author).toBe(demo.ids.lan);
  });

  it('refuses act-as for someone who is not a member and sets no cookie', async () => {
    const refused = await call('POST', `${tracker}/act-as`, p(), { memberId: randomUUID() });
    expect(refused).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect((await call('POST', `${tracker}/act-as`, p(), {})).status).toBe(400);
    expect((await call('GET', tracker, p())).body.me.id).toBe(demo.ids.minh);
  });

  it('refuses act-as for a person without a member and sets no cookie', async () => {
    const guest = await workspaceGuest(t.db, demo.owner);
    jar.set(
      SESSION_COOKIE,
      signSession({ userId: guest.userId, expiresAt: Date.now() + 600_000 }, secret),
    );
    const refused = await call('POST', `${tracker}/act-as`, p(), { memberId: demo.ids.lan });
    expect(refused).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect((await call('GET', tracker, p())).body.me).toBeNull();
  });

  it('takes the acting member only from the cookie, never from the body', async () => {
    const smuggled = await call('POST', `${tracker}/crs`, p(), {
      title: 'Smuggled',
      actAs: demo.ids.lan,
    });
    expect(smuggled).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
  });

  it('creates a tracker project with teams and a first milestone, owned by its creator', async () => {
    const created = await call(
      'POST',
      'projects',
      {},
      {
        title: 'Brightwater KYC',
        clientName: 'Brightwater Bank',
        teams: ['Implementation', 'Engineering', 'QA'],
        milestone: { name: 'Go-live', date: '2026-12-01' },
      },
    );
    expect(created.status).toBe(201);
    const payload = await call('GET', tracker, { projectId: created.body.id });
    expect(payload.status).toBe(200);
    expect(payload.body.base.teams.map((team: { name: string }) => team.name)).toEqual([
      'Implementation',
      'Engineering',
      'QA',
    ]);
    expect(payload.body.base.milestones).toMatchObject([
      { name: 'Go-live', planned: '2026-12-01' },
    ]);
    expect(payload.body.project).toMatchObject({ demo: false, ownerMemberId: payload.body.me.id });
    expect(payload.body.me.userId).toBe(demo.owner.userId);
    const actAs = await call(
      'POST',
      `${tracker}/act-as`,
      { projectId: created.body.id },
      {
        memberId: payload.body.me.id,
      },
    );
    expect(actAs.status).toBe(403);
  });

  it('refuses a new project without a team', async () => {
    for (const teams of [undefined, [], ['  ', '']]) {
      const reply = await call(
        'POST',
        'projects',
        {},
        {
          title: 'No teams',
          clientName: 'Client',
          ...(teams ? { teams } : {}),
        },
      );
      expect(reply).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
    }
  });
});
