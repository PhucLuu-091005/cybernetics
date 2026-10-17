import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp, resetApp } from '../../../src/server/app';
import { SESSION_COOKIE, signSession } from '../../../src/server/http/session';
import { and, eq } from 'drizzle-orm';
import { trackerEventOffsets } from '../../../src/server/db/schema';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, workspaceGuest, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
const secret = 'tracker-routes-test-secret-of-32-bytes';
const apiRoot = join(process.cwd(), 'src/app/api/v1');
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
      leadMemberId: demo.ids.minh,
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

  it('ignores an act-as cookie that names no member and works as the own member', async () => {
    const cookie = `pg_act_${demo.projectId}`;
    for (const stale of [randomUUID(), 'junk']) {
      jar.set(cookie, stale);
      const read = await call('GET', tracker, p());
      expect(read.status).toBe(200);
      expect(read.body.me.id).toBe(demo.ids.minh);
      const created = await call('POST', `${tracker}/crs`, p(), { title: `As Minh ${stale}` });
      expect(crOf(created, created.body.num).author).toBe(demo.ids.minh);
    }
    const real = await call(
      'POST',
      'projects',
      {},
      {
        title: 'Real',
        clientName: 'R',
        teams: ['QA'],
      },
    );
    jar.set(`pg_act_${real.body.id}`, demo.ids.lan);
    const own = await call('GET', tracker, { projectId: real.body.id });
    expect(own.status).toBe(200);
    expect(own.body.me.userId).toBe(demo.owner.userId);
  });

  it('needs a session', async () => {
    jar.delete(SESSION_COOKIE);
    expect(await call('GET', tracker, p())).toMatchObject({
      status: 401,
      body: { code: 'UNAUTHENTICATED' },
    });
  });

  it('refuses request changes and close through the route without the revision the owner saw', async () => {
    const target = { ...p(), num: '2' };
    for (const body of [
      { action: 'request-changes', note: 'Split it.' },
      { action: 'close', reason: 'Not needed.' },
    ])
      expect(await call('POST', `${tracker}/crs/[num]/actions`, target, body)).toMatchObject({
        status: 400,
        body: { code: 'VALIDATION' },
      });
    expect(crOf(await call('GET', tracker, p()), 2).status).toBe('ready');
  });

  it('refuses a NUL character in any text with 400', async () => {
    const nul = 'a\u0000b';
    const queued = await call('POST', `${tracker}/queue`, p(), {
      kind: 'event',
      fields: { ...event('sarah').fields, text: nul },
    });
    const item = await call('POST', `${tracker}/queue`, p(), {
      kind: 'item',
      fields: {
        title: 'Item',
        note: nul,
        doneBy: 'sarah',
        requestedBy: 'sarah',
        plannedFinish: '2026-10-20',
      },
    });
    const titled = await call('POST', `${tracker}/crs`, p(), { title: nul });
    const renamed = await call('POST', `${tracker}/crs`, p(), {
      title: 'Rename',
      ops: [rename(nul)],
    });
    const commented = await call(
      'POST',
      `${tracker}/crs/[num]/actions`,
      { ...p(), num: '4' },
      { action: 'comment', body: nul },
    );
    const project = (fields: Record<string, unknown>) =>
      call('POST', 'projects', {}, { title: 'P', clientName: 'C', teams: ['QA'], ...fields });
    const replies = [
      queued,
      item,
      titled,
      renamed,
      commented,
      await project({ teams: [nul] }),
      await project({ title: nul }),
      await project({ milestone: { name: nul, date: '2026-12-01' } }),
    ];
    for (const reply of replies)
      expect(reply).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
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
    expect(payload.body.project).toMatchObject({ demo: false, leadMemberId: payload.body.me.id });
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

  describe('day offsets of events', () => {
    const offsets = 'projects/[projectId]/tracker/offsets/[eventId]';
    const put = (eventId: string, body: unknown) => call('PUT', offsets, { ...p(), eventId }, body);
    const signInAs = (userId: string) =>
      jar.set(SESSION_COOKIE, signSession({ userId, expiresAt: Date.now() + 600_000 }, secret));
    const rowsOf = (userId: string) =>
      t.db
        .select()
        .from(trackerEventOffsets)
        .where(
          and(
            eq(trackerEventOffsets.projectId, demo.projectId),
            eq(trackerEventOffsets.userId, userId),
          ),
        );

    it('stores the offset of the signed-in person and returns it in the payload', async () => {
      expect((await call('GET', tracker, p())).body.offsets).toEqual({});
      const saved = await put('p31', { minutes: 120 });
      expect(saved.status).toBe(200);
      expect(saved.body.offsets).toEqual({ p31: 120 });
      expect((await put('p31', { minutes: -45 })).body.offsets).toEqual({ p31: -45 });
      expect((await call('GET', tracker, p())).body.offsets).toEqual({ p31: -45 });
      expect(await rowsOf(demo.owner.userId)).toMatchObject([
        {
          workspaceId: demo.workspaceId,
          projectId: demo.projectId,
          userId: demo.owner.userId,
          eventId: 'p31',
          offsetMinutes: -45,
        },
      ]);
    });

    it('deletes the row for 0', async () => {
      await put('p31', { minutes: 120 });
      const reset = await put('p31', { minutes: 0 });
      expect(reset.status).toBe(200);
      expect(reset.body.offsets).toEqual({});
      expect(await rowsOf(demo.owner.userId)).toEqual([]);
      expect((await put('p32', { minutes: 0 })).status).toBe(200);
    });

    it('keeps each person to their own rows', async () => {
      await put('p31', { minutes: 120 });
      const guest = await workspaceGuest(t.db, demo.owner);
      signInAs(guest.userId);
      expect((await call('GET', tracker, p())).body.offsets).toEqual({});
      expect((await put('p31', { minutes: 30 })).body.offsets).toEqual({ p31: 30 });
      expect((await put('p31', { minutes: 0 })).body.offsets).toEqual({});
      signInAs(demo.owner.userId);
      expect((await call('GET', tracker, p())).body.offsets).toEqual({ p31: 120 });
      expect(await rowsOf(demo.owner.userId)).toHaveLength(1);
      expect(await rowsOf(guest.userId)).toEqual([]);
    });

    it('keeps the offsets of the signed-in person while they act as another member', async () => {
      await put('p31', { minutes: 120 });
      await call('POST', `${tracker}/act-as`, p(), { memberId: demo.ids.lan });
      const read = await call('GET', tracker, p());
      expect(read.body.me.id).toBe(demo.ids.lan);
      expect(read.body.offsets).toEqual({ p31: 120 });
    });

    it('refuses an offset that leaves the day of the event, or is not a whole number', async () => {
      // p31 happens at 09:20 in Asia/Ho_Chi_Minh: 560 minutes after midnight, 879 before 23:59.
      for (const minutes of [880, -561, 1440, 1.5, '10', null])
        expect(await put('p31', { minutes })).toMatchObject({
          status: 400,
          body: { code: 'VALIDATION' },
        });
      expect((await put('p31', {})).status).toBe(400);
      expect((await put('p31', { minutes: 879 })).body.offsets).toEqual({ p31: 879 });
      expect((await put('p31', { minutes: -560 })).body.offsets).toEqual({ p31: -560 });
    });

    it('finds the event in the queue or in a change request, and answers 404 for no event', async () => {
      expect(await put('nope', { minutes: 10 })).toMatchObject({
        status: 404,
        body: { code: 'NOT_FOUND' },
      });
      expect((await put(demo.ids.qe1, { minutes: 10 })).body.offsets).toMatchObject({
        [demo.ids.qe1]: 10,
      });
      const created = await call('POST', `${tracker}/crs`, p(), { title: 'Add an event' });
      await call(
        'POST',
        `${tracker}/crs/[num]/ops`,
        { ...p(), num: String(created.body.num) },
        {
          op: {
            op: 'addEvent',
            a: {
              workItemId: 'pg203',
              ev: {
                id: 'added1',
                kind: 'message',
                at: '2026-10-08T23:00:00+07:00',
                by: 'lan',
                text: 'Late note.',
              },
            },
          },
          expectedRevision: 0,
        },
      );
      expect((await put('added1', { minutes: 59 })).body.offsets).toMatchObject({ added1: 59 });
      expect((await put('added1', { minutes: 60 })).status).toBe(400);
    });

    it('refuses a person outside the workspace and a route body that names another event', async () => {
      expect((await put('p31', { minutes: 10, eventId: 'p32' })).status).toBe(400);
      const stranger = await testActor(t.db, { name: 'Stranger' });
      signInAs(stranger.userId);
      expect(await put('p31', { minutes: 10 })).toMatchObject({
        status: 404,
        body: { code: 'NOT_FOUND' },
      });
    });
  });
  describe('members', () => {
    const members = 'projects/[projectId]/members';
    const one = 'projects/[projectId]/members/[memberId]';
    const of = (id: string) => ({ ...p(), memberId: id });
    const signInAs = (userId: string) =>
      jar.set(SESSION_COOKIE, signSession({ userId, expiresAt: Date.now() + 600_000 }, secret));

    const VIEW_MAIN = { viewMain: true, viewCrs: false, createCrs: false, mergeCrs: false };
    const teams = 'projects/[projectId]/teams';
    const team = 'projects/[projectId]/teams/[teamId]';

    it('lists, invites, grants and removes, each answering with the new list', async () => {
      const list = await call('GET', members, p());
      expect(list.status).toBe(200);
      expect(list.headers.get('cache-control')).toBe('private, no-store');
      expect(list.body.canManage).toBe(true);
      expect(list.body.members).toHaveLength(5);
      expect(list.body.teams).toHaveLength(7);

      const invited = await call('POST', members, p(), {
        email: 'New.Person@Example.com',
        grants: VIEW_MAIN,
      });
      expect(invited.status).toBe(201);
      const row = invited.body.members.find(
        (m: { email: string | null }) => m.email === 'new.person@example.com',
      );
      expect(row).toMatchObject({ grants: VIEW_MAIN, pending: true });

      const changed = await call('PATCH', one, of(row.id), {
        grants: { ...VIEW_MAIN, createCrs: true },
      });
      expect(changed.status).toBe(200);
      expect(
        changed.body.members.find((m: { id: string }) => m.id === row.id).grants,
      ).toMatchObject({ viewCrs: true, createCrs: true });
      const removed = await call('DELETE', one, of(row.id), undefined, { noBody: true });
      expect(removed.status).toBe(200);
      expect(removed.body.members).toHaveLength(5);
      expect((await call('DELETE', one, of(row.id))).status).toBe(404);
    });

    it('adds, changes and deletes a team', async () => {
      const added = await call('POST', teams, p(), { name: 'Legal' });
      expect(added.status).toBe(201);
      const legal = added.body.teams.find((item: { name: string }) => item.name === 'Legal');
      const changed = await call(
        'PATCH',
        team,
        { ...p(), teamId: legal.id },
        { leadId: demo.ids.khoa },
      );
      expect(changed.status).toBe(200);
      expect(changed.body.teams.find((item: { id: string }) => item.id === legal.id)).toMatchObject(
        { leadId: demo.ids.khoa, memberIds: [demo.ids.khoa] },
      );
      const gone = await call('DELETE', team, { ...p(), teamId: legal.id }, undefined, {
        noBody: true,
      });
      expect(gone.status).toBe(200);
      expect((await call('DELETE', team, { ...p(), teamId: 'engineering' })).status).toBe(400);
    });

    it('validates the body with the route schema', async () => {
      for (const body of [
        { email: 'nope' },
        { email: 'a@example.com', role: 'member' },
        { email: 'a@example.com', actAs: demo.ids.lan },
        { email: 'a@example.com', projectId: demo.ids.lan },
      ])
        expect((await call('POST', members, p(), body)).status).toBe(400);
      expect((await call('PATCH', one, of(demo.ids.lan), { role: 'boss' })).status).toBe(400);
      expect((await call('PATCH', one, of('not-a-uuid'), { grants: VIEW_MAIN })).status).toBe(400);
      expect((await call('POST', teams, p(), { name: '  ' })).status).toBe(400);
    });

    it('shows the list read-only to a member who is not the project lead and refuses their writes', async () => {
      expect(
        (await call('POST', `${tracker}/act-as`, p(), { memberId: demo.ids.lan })).status,
      ).toBe(200);
      const list = await call('GET', members, p());
      expect(list.body.canManage).toBe(false);
      expect((await call('POST', members, p(), { email: 'x@example.com' })).status).toBe(403);
      expect((await call('PATCH', one, of(demo.ids.khoa), { grants: VIEW_MAIN })).status).toBe(403);
      expect((await call('DELETE', one, of(demo.ids.khoa))).status).toBe(403);
      expect((await call('POST', teams, p(), { name: 'Legal' })).status).toBe(403);
    });

    it('hides the members of a project from a person outside it', async () => {
      const stranger = await testActor(t.db, { name: 'Stranger' });
      signInAs(stranger.userId);
      expect((await call('GET', members, p())).status).toBe(404);
    });
  });
});
