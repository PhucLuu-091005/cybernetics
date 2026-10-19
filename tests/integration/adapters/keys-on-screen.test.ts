import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configureApp, resetApp } from '../../../src/server/app';
import { POST as MCP } from '../../../src/app/mcp/route';
import {
  GET as LIST_TOKENS,
  POST as CREATE_TOKEN,
} from '../../../src/app/api/v1/projects/[projectId]/agent-tokens/route';
import { POST as CREATE_KEY } from '../../../src/app/api/v1/me/keys/route';
import { createEmptyProject } from '../../../src/server/domain/projects';
import { SESSION_COOKIE, signSession } from '../../../src/server/http/session';
import { getTrackerPayload, inviteMember, updateMember } from '../../../src/server/tracker';
import type { ActorContext, Scope } from '../../../src/contracts';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
const secret = 'keys-on-screen-test-secret-of-32-bytes!';
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Json };

describe.skipIf(!process.env.TEST_DATABASE_URL)('keys made by the person on screen', () => {
  let t: TestDb, alice: ActorContext, a: Demo, b: Demo;
  const cookies = (projectId: string, actAs?: string) =>
    [
      `${SESSION_COOKIE}=${signSession({ userId: alice.userId, expiresAt: Date.now() + 600_000 }, secret)}`,
      ...(actAs ? [`pg_act_${projectId}=${actAs}`] : []),
    ].join('; ');
  const post = (url: string, cookie: string, body: object) =>
    new Request(`${origin}${url}`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const projectKey = async (projectId: string, actAs: string | undefined, scopes: Scope[]) =>
    CREATE_TOKEN(
      post(`/api/v1/projects/${projectId}/agent-tokens`, cookies(projectId, actAs), {
        label: 'Agent',
        scopes,
        idempotencyKey: randomUUID(),
      }),
      { params: Promise.resolve({ projectId }) },
    );
  const personalKey = async (projectId: string, actAs: string, scopes: Scope[]) =>
    CREATE_KEY(
      post(`/api/v1/me/keys?project=${projectId}`, cookies(projectId, actAs), {
        label: 'Laptop',
        scopes,
        idempotencyKey: randomUUID(),
      }),
      { params: Promise.resolve({}) },
    );
  const connect = async (key: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${key}` } },
        fetch: async (input, init) => MCP(new Request(input, init)),
      }),
    );
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolReply;
  const newCr = (client: Client, args: Record<string, unknown> = {}) =>
    call(client, 'create_change_request', {
      title: 'Rename',
      ops: [{ op: 'rename', a: { workItemId: 'golive', title: 'Go-live, new date' } }],
      ...args,
    });

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
    const email = `${randomUUID()}@example.com`;
    alice = await testActor(t.db, { name: 'Alice', email });
    a = await seedDemo(t.db, alice);
    b = await seedDemo(t.db);
    await inviteMember(t.db, b.owner, { projectId: b.projectId, email });
  });

  it('gives a project key made while acting as Hà to Hà, with her live rights', async () => {
    const reply = await projectKey(a.projectId, a.ids.ha, ['project:read', 'crs:edit']);
    expect(reply.status).toBe(201);
    const created = (await reply.json()) as Json;
    expect(created.token.actsAs).toEqual({ memberId: a.ids.ha, name: 'Hà Đỗ' });
    const listed = (await (
      await LIST_TOKENS(
        new Request(`${origin}/api/v1/projects/${a.projectId}/agent-tokens`, {
          headers: { cookie: cookies(a.projectId) },
        }),
        { params: Promise.resolve({ projectId: a.projectId }) },
      )
    ).json()) as Json;
    expect(listed.items[0]).toMatchObject({ id: created.token.id, actsAs: { name: 'Hà Đỗ' } });

    const key = await connect(created.secret);
    const made = await newCr(key);
    expect(made.isError, JSON.stringify(made.structuredContent)).toBeFalsy();
    const payload = await getTrackerPayload(t.db, alice, { projectId: a.projectId });
    const cr = payload.crs.find((c) => c.num === made.structuredContent.changeRequest.num)!;
    expect(cr.author).toBe(a.ids.ha);

    await updateMember(t.db, alice, {
      projectId: a.projectId,
      memberId: a.ids.ha,
      grants: { viewMain: true, viewCrs: true, createCrs: false, mergeCrs: false },
    });
    expect(await newCr(key)).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN' },
    });
  });

  it('checks the scopes at creation against the rights of the person on screen', async () => {
    const lan = await projectKey(a.projectId, a.ids.lan, ['project:read', 'crs:merge']);
    expect(lan.status).toBe(400);
    const quang = await projectKey(a.projectId, a.ids.quang, ['project:read', 'crs:merge']);
    expect(quang.status).toBe(201);
    expect(((await quang.json()) as Json).token.actsAs.name).toBe('Quang Nguyễn');
  });

  it('keeps a personal key made while acting as Lan to that demo copy, as Lan', async () => {
    const reply = await personalKey(a.projectId, a.ids.lan, ['project:read', 'crs:edit']);
    expect(reply.status).toBe(201);
    const created = (await reply.json()) as Json;
    expect(created.token).toMatchObject({ kind: 'personal', actsAs: { name: 'Lan Phạm' } });
    const key = await connect(created.secret);
    const listed = (await call(key, 'list_projects')).structuredContent.projects;
    expect(listed.map((p: { id: string }) => p.id)).toEqual([a.projectId]);
    expect(await call(key, 'get_tracker', { projectId: b.projectId })).toMatchObject({
      isError: true,
      structuredContent: { code: 'NOT_FOUND' },
    });
    const made = await newCr(key, { projectId: a.projectId });
    expect(made.isError, JSON.stringify(made.structuredContent)).toBeFalsy();
    const payload = await getTrackerPayload(t.db, alice, { projectId: a.projectId });
    expect(
      payload.crs.find((c) => c.num === made.structuredContent.changeRequest.num)?.author,
    ).toBe(a.ids.lan);
  });

  it('makes no key as a pending invitee', async () => {
    const email = `${randomUUID()}@example.com`;
    const invited = await inviteMember(t.db, alice, { projectId: a.projectId, email });
    const pending = invited.members.find((m) => m.email === email)!.id;
    const reply = (await (await projectKey(a.projectId, pending, ['project:read'])).json()) as Json;
    expect(reply.token).not.toHaveProperty('actsAs');
  });

  it('changes nothing for a key made in the own name or outside a demo copy', async () => {
    const own = (await (await projectKey(a.projectId, undefined, ['project:read'])).json()) as Json;
    expect(own.token).not.toHaveProperty('actsAs');
    const real = await createEmptyProject(t.db, alice, {
      title: 'Fund IV onboarding',
      clientName: 'Larkspur Capital',
      teams: ['Ops'],
    });
    const cookie = (await projectKey(real.id, a.ids.lan, ['project:read'])).json();
    expect(((await cookie) as Json).token).not.toHaveProperty('actsAs');
  });
});
