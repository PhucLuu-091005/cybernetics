import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configureApp, createAgentToken, resetApp } from '../../../src/server/app';
import {
  getTrackerPayload,
  inviteMember,
  listProjectMembers,
  updateMember,
} from '../../../src/server/tracker';
import { MCP_TOOLS } from '../../../src/server/mcp/tools';
import { DELETE, GET, POST } from '../../../src/app/mcp/route';
import { ScopeSchema, type ActorContext, type Scope } from '../../../src/contracts';
import { DEFAULT_GRANTS } from '../../../src/tracker';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
type Structured = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Structured };
const ALL = [...ScopeSchema.options];

describe.skipIf(!process.env.TEST_DATABASE_URL)('MCP scopes and write tools', () => {
  let t: TestDb, demo: Demo;
  const route = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.method === 'GET'
      ? GET()
      : request.method === 'DELETE'
        ? DELETE()
        : POST(request);
  };
  const connect = async (scopes: Scope[], owner: ActorContext = demo.owner) => {
    const { secret } = await createAgentToken(owner, {
      projectId: demo.projectId,
      label: 'Agent',
      scopes,
      idempotencyKey: randomUUID(),
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
        fetch: route,
      }),
    );
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolReply;
  const own = () => ({ projectId: demo.projectId });
  /** A signed-in person who joins the demo as a member with the default grants. */
  const member = async () => {
    const email = `${randomUUID()}@example.com`;
    const person = await testActor(t.db, { subject: `google:${randomUUID()}`, email });
    const list = await inviteMember(t.db, demo.owner, { ...own(), email });
    const id = list.members.find((m) => m.email === email)!.id;
    return { person: { ...person, workspaceId: demo.workspaceId }, id };
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', 'mcp-scopes-test-secret-of-32-bytes!!');
    configureApp({ db: t.db });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    resetApp();
    await t?.close();
  });
  beforeEach(async () => {
    delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown }).promiseRateLimiter;
    demo = await seedDemo(t.db, await testActor(t.db));
  });

  it('ties every tool to one scope, names it, and offers no tool for tokens or deleting the project', async () => {
    const { tools } = await (await connect(ALL)).listTools();
    expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(50_000);
    expect(tools).toHaveLength(MCP_TOOLS.length);
    for (const tool of tools) {
      const scope = MCP_TOOLS.find((item) => item.name === tool.name)!.scope;
      expect(tool.description).toContain(`Scope: ${scope}.`);
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('projectId');
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('actAs');
      expect(tool.name).not.toMatch(/token|delete_project/);
    }
    expect(new Set(MCP_TOOLS.map((tool) => tool.scope))).toEqual(new Set(ALL));
  });

  it('explains the app in the server instructions, so an agent with no other context can work', async () => {
    const text = (await connect(['project:read'])).getInstructions() ?? '';
    for (const term of [
      'Main',
      'Queue',
      'change request',
      'op',
      'work item',
      'event',
      'milestone',
      'get_tracker',
      'mark_ready',
      'merge_change_request',
      'untrusted',
      'expectedRevision',
    ])
      expect(text).toContain(term);
    for (const kind of ['idea', 'message', 'issue', 'task', 'meeting', 'decision', 'delivery'])
      expect(text).toContain(kind);
    for (const status of ['planned', 'early', 'ontime', 'late', 'flate', 'cancelled'])
      expect(text).toContain(status);
    for (const scope of ALL) expect(text).toContain(scope);
    expect(text).toMatch(/no scope .*token/i);
    expect(text.length).toBeLessThan(8_000);
  });

  it('refuses each tool to a token that holds every scope but its own', async () => {
    for (const scope of ALL) {
      const client = await connect(ALL.filter((item) => item !== scope));
      for (const tool of MCP_TOOLS.filter((item) => item.scope === scope)) {
        const reply = await call(client, tool.name, {});
        expect(reply).toMatchObject({ isError: true, structuredContent: { code: 'FORBIDDEN' } });
        expect(reply.structuredContent.message).toBe(`Scope ${scope} is required`);
      }
      delete (globalThis as typeof globalThis & { promiseRateLimiter?: unknown })
        .promiseRateLimiter;
    }
  });

  it('opens, fills, readies and merges a change request as the agent of the project lead', async () => {
    const agent = await connect([
      'project:read',
      'crs:edit',
      'crs:ready',
      'crs:comment',
      'crs:merge',
    ]);
    const created = await call(agent, 'create_change_request', { title: 'Agent places qe1' });
    expect(created.isError).toBeFalsy();
    const { num, revision } = created.structuredContent.changeRequest;
    const added = await call(agent, 'add_change', {
      num,
      expectedRevision: revision,
      op: { op: 'attach', a: { eventId: demo.ids.qe1, workItemId: 'golive' } },
    });
    expect(added.structuredContent.changeRequest).toMatchObject({ changeCount: 1 });
    const commented = await call(agent, 'comment_change_request', { num, body: 'Placed qe1.' });
    expect(commented.isError).toBeFalsy();
    const ready = await call(agent, 'mark_ready', { num });
    expect(ready.structuredContent.changeRequest.status).toBe('ready');
    const merged = await call(agent, 'merge_change_request', {
      num,
      expectedRevision: ready.structuredContent.changeRequest.revision,
    });
    expect(merged.structuredContent.changeRequest.status).toBe('merged');
    const read = (await call(agent, 'get_change_request', { num })).structuredContent;
    expect(read.changeRequest.changes).toEqual([
      expect.objectContaining({
        op: 'attach',
        agent: true,
        by: expect.objectContaining({ id: demo.ids.minh }),
      }),
    ]);
    expect(
      read.changeRequest.comments.map((c: { kind: string; agent: boolean }) => [c.kind, c.agent]),
    ).toEqual([
      ['created', true],
      ['comment', true],
      ['ready', true],
      ['merged', true],
    ]);
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.commits.at(-1)!.ops[0]).toMatchObject({ agent: true, by: demo.ids.minh });
  });

  it('checks the right of the creator at each call, so a lost right is lost for the token too', async () => {
    const { person, id } = await member();
    const agent = await connect(['crs:edit', 'crs:merge'], person);
    const first = await call(agent, 'create_change_request', { title: 'While I may' });
    expect(first.isError).toBeFalsy();
    expect(
      await call(agent, 'merge_change_request', {
        num: first.structuredContent.changeRequest.num,
        expectedRevision: 0,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'FORBIDDEN',
        message: 'You cannot merge change requests in this project',
      },
    });
    await updateMember(t.db, demo.owner, {
      ...own(),
      memberId: id,
      grants: { ...DEFAULT_GRANTS, createCrs: false },
    });
    expect(await call(agent, 'create_change_request', { title: 'Not any more' })).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN' },
    });
  });

  it('lets the agent of the project lead manage members and teams, and nobody else', async () => {
    const lead = await connect(['members:manage', 'teams:manage', 'project:lead']);
    const email = `${randomUUID()}@example.com`;
    const invited = await call(lead, 'invite_member', { email });
    expect(invited.isError).toBeFalsy();
    const id = invited.structuredContent.members.find(
      (m: { email: string }) => m.email === email,
    ).id;
    const granted = await call(lead, 'set_member_grants', {
      memberId: id,
      grants: { viewMain: true, viewCrs: true, createCrs: true, mergeCrs: true },
    });
    expect(
      granted.structuredContent.members.find((m: { id: string }) => m.id === id).rights.merge,
    ).toBe(true);
    const team = await call(lead, 'add_team', { name: 'Agents' });
    const teamId = team.structuredContent.teams.find(
      (x: { name: string }) => x.name === 'Agents',
    ).id;
    expect((await call(lead, 'update_team', { teamId, name: 'Bots' })).isError).toBeFalsy();
    expect((await call(lead, 'delete_team', { teamId })).isError).toBeFalsy();
    expect((await call(lead, 'remove_member', { memberId: id })).isError).toBeFalsy();

    const { person } = await member();
    const other = await connect(['members:manage'], person);
    expect(
      await call(other, 'invite_member', { email: `${randomUUID()}@example.com` }),
    ).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN', message: 'Only the project lead can do this' },
    });
  });

  it('hands over the project lead, and the token then loses the rights of the lead', async () => {
    const { id } = await member();
    const lead = await connect(['project:lead', 'members:manage']);
    expect((await call(lead, 'make_project_lead', { memberId: id })).isError).toBeFalsy();
    const list = await listProjectMembers(t.db, demo.owner, own());
    expect(list.leadId).toBe(id);
    expect(
      await call(lead, 'invite_member', { email: `${randomUUID()}@example.com` }),
    ).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN' },
    });
  });

  it('removes a Queue card with queue:dismiss and answers only the removed id', async () => {
    const agent = await connect(['queue:dismiss']);
    const reply = await call(agent, 'remove_queue_card', { queueId: demo.ids.qe1 });
    expect(reply.structuredContent).toEqual({
      projectId: demo.projectId,
      removed: demo.ids.qe1,
      requestId: expect.any(String),
    });
    const payload = await getTrackerPayload(t.db, demo.owner, own());
    expect(payload.queue.events.map((event) => event.id)).not.toContain(demo.ids.qe1);
  });

  it('parses every tool input strictly', async () => {
    const agent = await connect(ALL);
    const bad: Array<[string, Record<string, unknown>]> = [
      ['create_change_request', { title: 'X', actAs: demo.ids.lan }],
      ['create_change_request', { title: 'X', ops: [{ op: 'explode', a: {} }] }],
      ['add_change', { num: 2, op: { op: 'hide', a: { eventId: 'e1' } } }],
      ['add_change', { num: 2, expectedRevision: 0, op: { op: 'hide', a: {}, by: 'lan' } }],
      ['merge_change_request', { num: 2 }],
      ['mark_ready', { num: 2, extra: true }],
      ['set_member_grants', { memberId: demo.ids.lan, grants: { viewMain: true } }],
      ['make_project_lead', { memberId: demo.ids.lan, projectLead: true }],
      ['remove_queue_card', { queueId: demo.ids.qe1, projectId: demo.projectId }],
    ];
    for (const [name, args] of bad)
      expect(await call(agent, name, args), name).toMatchObject({
        isError: true,
        structuredContent: { code: 'VALIDATION' },
      });
  });

  it('never lets a token manage tokens', async () => {
    const agent = await connect(ALL);
    for (const name of ['create_token', 'list_tokens', 'revoke_token', 'delete_project'])
      expect(await call(agent, name)).toMatchObject({
        isError: true,
        structuredContent: { code: 'NOT_FOUND' },
      });
    const asAgent: ActorContext = {
      kind: 'agent',
      userId: demo.owner.userId,
      tokenId: randomUUID(),
      workspaceId: demo.workspaceId,
      projectId: demo.projectId,
      scopes: ALL,
      requestId: randomUUID(),
    };
    await expect(
      createAgentToken(asAgent, { ...own(), label: 'Child', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
