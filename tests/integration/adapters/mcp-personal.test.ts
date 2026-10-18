import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configureApp, createAgentToken, createUserKey, resetApp } from '../../../src/server/app';
import {
  getTrackerPayload,
  inviteMember,
  listProjectMembers,
  removeMember,
} from '../../../src/server/tracker';
import { MCP_TOOLS } from '../../../src/server/mcp/tools';
import { POST } from '../../../src/app/mcp/route';
import type { ActorContext, Scope } from '../../../src/contracts';
import { mainState } from '../../../src/tracker';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
type Structured = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Structured };
const WRITE: Scope[] = [
  'project:read',
  'queue:add',
  'crs:edit',
  'crs:ready',
  'crs:comment',
  'crs:merge',
];

describe.skipIf(!process.env.TEST_DATABASE_URL)('MCP personal keys', () => {
  let t: TestDb, alice: ActorContext, a: Demo, b: Demo, bobMemberOfAlice: string;
  const connect = async (secret: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
        fetch: async (input, init) => POST(new Request(input, init)),
      }),
    );
    return client;
  };
  const personal = async (scopes: Scope[] = WRITE, label = 'Laptop') =>
    connect((await createUserKey(alice, { label, scopes, idempotencyKey: randomUUID() })).secret);
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolReply;
  const fails = (code: string) => ({ isError: true, structuredContent: { code } });

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', 'mcp-personal-test-secret-of-32-bytes');
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
    const invited = await inviteMember(t.db, b.owner, { projectId: b.projectId, email });
    bobMemberOfAlice = invited.members.find((m) => m.email === email)!.id;
  });

  it('lists the projects of its person and needs projectId on every other tool', async () => {
    const key = await personal();
    expect(key.getInstructions()).toMatch(/personal key/);
    expect(key.getInstructions()).toContain('list_projects');
    const { tools } = await key.listTools();
    expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(50_000);
    expect(tools).toHaveLength(MCP_TOOLS.length);
    for (const tool of tools.filter((item) => item.name !== 'list_projects')) {
      expect(tool.inputSchema.required, tool.name).toContain('projectId');
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('actAs');
    }
    const listed = (await call(key, 'list_projects')).structuredContent.projects;
    expect(listed).toEqual(
      expect.arrayContaining([
        { id: a.projectId, name: expect.any(String) },
        { id: b.projectId, name: expect.any(String) },
      ]),
    );
    expect(listed).toHaveLength(2);
    const read = await call(key, 'get_project', { projectId: b.projectId });
    expect(read.structuredContent).toMatchObject({
      projectId: b.projectId,
      project: { id: b.projectId },
    });
  });

  it('keeps the projectId rules of both kinds and strict input', async () => {
    const key = await personal();
    expect(await call(key, 'get_tracker')).toMatchObject(fails('VALIDATION'));
    expect(
      await call(key, 'get_tracker', { projectId: a.projectId, actAs: a.ids.lan }),
    ).toMatchObject(fails('VALIDATION'));
    expect(await call(key, 'get_tracker', { projectId: a.projectId, extra: 1 })).toMatchObject(
      fails('VALIDATION'),
    );
    expect(await call(key, 'get_tracker', { projectId: randomUUID() })).toMatchObject(
      fails('NOT_FOUND'),
    );
    expect(await call(key, 'list_projects', { projectId: a.projectId })).toMatchObject(
      fails('VALIDATION'),
    );
    const foreign = await seedDemo(t.db);
    expect(await call(key, 'get_tracker', { projectId: foreign.projectId })).toMatchObject(
      fails('NOT_FOUND'),
    );

    const project = await connect(
      (
        await createAgentToken(alice, {
          projectId: a.projectId,
          label: 'Project key',
          scopes: WRITE,
          idempotencyKey: randomUUID(),
        })
      ).secret,
    );
    expect((await call(project, 'get_tracker')).isError).toBeFalsy();
    expect(await call(project, 'get_tracker', { projectId: a.projectId })).toMatchObject(
      fails('VALIDATION'),
    );
    expect(await call(project, 'get_tracker', { projectId: b.projectId })).toMatchObject(
      fails('VALIDATION'),
    );
    expect(await call(project, 'list_projects')).toMatchObject(fails('NOT_FOUND'));
    const names = (await project.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain('list_projects');
    expect(project.getInstructions()).toMatch(/project key/);
  });

  it('uses the live rights of its person in each project', async () => {
    const key = await personal();
    const flow = async (projectId: string) => {
      const created = await call(key, 'create_change_request', {
        projectId,
        title: 'Rename',
        ops: [{ op: 'rename', a: { workItemId: 'golive', title: 'Go-live, new date' } }],
      });
      expect(created.isError, JSON.stringify(created.structuredContent)).toBeFalsy();
      const { num } = created.structuredContent.changeRequest;
      const ready = await call(key, 'mark_ready', { projectId, num });
      return call(key, 'merge_change_request', {
        projectId,
        num,
        expectedRevision: ready.structuredContent.changeRequest.revision,
      });
    };
    const inA = await flow(a.projectId);
    expect(inA.structuredContent.changeRequest.status).toBe('merged');
    const inB = await flow(b.projectId);
    expect(inB).toMatchObject(fails('FORBIDDEN'));
    expect(inB.structuredContent.message).toBe('You cannot merge change requests in this project');
  });

  it('reaches a project its person joins later, and stops in a project they leave', async () => {
    const key = await personal(['project:read']);
    const later = await seedDemo(t.db);
    expect(await call(key, 'get_project', { projectId: later.projectId })).toMatchObject(
      fails('NOT_FOUND'),
    );
    const email = (
      await listProjectMembers(t.db, b.owner, { projectId: b.projectId })
    ).members.find((m) => m.id === bobMemberOfAlice)!.email!;
    await inviteMember(t.db, later.owner, { projectId: later.projectId, email });
    const ids = (await call(key, 'list_projects')).structuredContent.projects.map(
      (p: { id: string }) => p.id,
    );
    expect(ids).toContain(later.projectId);
    expect((await call(key, 'get_tracker', { projectId: later.projectId })).isError).toBeFalsy();

    await removeMember(t.db, b.owner, { projectId: b.projectId, memberId: bobMemberOfAlice });
    expect(await call(key, 'get_tracker', { projectId: b.projectId })).toMatchObject(
      fails('NOT_FOUND'),
    );
    expect((await call(key, 'get_tracker', { projectId: a.projectId })).isError).toBeFalsy();
    expect(
      (await call(key, 'list_projects')).structuredContent.projects.map(
        (p: { id: string }) => p.id,
      ),
    ).not.toContain(b.projectId);
  });

  it('writes as its person: the event, the change and the comment name the creator', async () => {
    const key = await personal(WRITE, 'Release bot');
    const projectId = a.projectId;
    const added = await call(key, 'add_queue_event', {
      projectId,
      kind: 'issue',
      at: '2026-10-09T16:30+07:00',
      text: 'Sync gap',
    });
    expect(added.structuredContent.event).toMatchObject({
      by: a.ids.minh,
      addedBy: a.ids.minh,
      agent: true,
    });
    const eventId = added.structuredContent.event.id;
    const created = await call(key, 'create_change_request', {
      projectId,
      title: 'Place the gap',
      ops: [{ op: 'attach', a: { eventId, workItemId: 'golive' } }],
    });
    const { num } = created.structuredContent.changeRequest;
    expect(created.structuredContent.changeRequest.author).toEqual({
      id: a.ids.minh,
      name: expect.any(String),
    });
    await call(key, 'comment_change_request', { projectId, num, body: 'Placed it.' });
    const ready = await call(key, 'mark_ready', { projectId, num });
    await call(key, 'merge_change_request', {
      projectId,
      num,
      expectedRevision: ready.structuredContent.changeRequest.revision,
    });
    const read = (await call(key, 'get_change_request', { projectId, num })).structuredContent;
    expect(read.changeRequest.changes).toEqual([
      expect.objectContaining({
        by: expect.objectContaining({ id: a.ids.minh }),
        agent: true,
        viaKey: 'Release bot',
      }),
    ]);
    for (const comment of read.changeRequest.comments)
      expect(comment).toMatchObject({
        by: expect.objectContaining({ id: a.ids.minh }),
        agent: true,
        viaKey: 'Release bot',
      });
    const payload = await getTrackerPayload(t.db, alice, { projectId });
    expect(payload.commits.at(-1)!.ops[0]).toMatchObject({ by: a.ids.minh, via: 'Release bot' });
    const main = mainState(payload.base, payload.queue, payload.commits);
    expect(main.events.find((event) => event.id === eventId)).toMatchObject({
      by: a.ids.minh,
      addedBy: a.ids.minh,
    });
  });
});
