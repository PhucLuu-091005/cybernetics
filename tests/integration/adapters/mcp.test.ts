import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq } from 'drizzle-orm';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';
import {
  configureApp,
  createAgentToken,
  resetApp,
  revokeAgentToken,
} from '../../../src/server/app';
import { agentTokens } from '../../../src/server/db/schema';
import { AppError } from '../../../src/server/errors';
import { toolError, toolResult } from '../../../src/server/mcp/results';
import { DELETE, GET, POST } from '../../../src/app/mcp/route';
import type { ActorContext, Scope, TokenCreated } from '../../../src/contracts';

const origin = 'http://localhost:3000';
type Structured = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Structured; content?: unknown };

describe('MCP result envelopes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const ctx: ActorContext = {
    kind: 'agent',
    userId: randomUUID(),
    tokenId: randomUUID(),
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    scopes: ['project:read'],
    requestId: 'req-1',
  };
  it('adds projectId and requestId and mirrors structured content as JSON text', () => {
    const result = toolResult(ctx, { items: [1] });
    expect(result.structuredContent).toEqual({
      projectId: ctx.projectId,
      items: [1],
      requestId: 'req-1',
    });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent) },
    ]);
  });
  it('refuses a result over 50,000 characters instead of truncating it', () => {
    expect(() => toolResult(ctx, { text: 'x'.repeat(50_000) })).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
  });
  it('maps domain errors and hides internal error text', () => {
    const known = toolError(
      new AppError('CONFLICT', 'Main moved', { details: { actualRevision: 2 } }),
      'req-2',
    );
    expect(known).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'CONFLICT',
        message: 'Main moved',
        details: { actualRevision: 2 },
        requestId: 'req-2',
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hidden = toolError(new Error('relation "tracker_crs" password=hunter2'), 'req-3');
    expect(hidden.structuredContent).toEqual({
      code: 'INTERNAL',
      message: 'Internal error',
      requestId: 'req-3',
    });
    expect(JSON.stringify(hidden)).not.toContain('hunter2');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('MCP adapter', () => {
  let t: TestDb, demo: Demo, defaultToken: TokenCreated;
  const route = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.method === 'GET'
      ? GET()
      : request.method === 'DELETE'
        ? DELETE()
        : POST(request);
  };
  const connect = async (secret: string) => {
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
  const token = (scopes: Scope[], label = randomUUID()) =>
    createAgentToken(demo.owner, {
      projectId: demo.projectId,
      label,
      scopes,
      idempotencyKey: label,
    });

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', 'mcp-adapter-test-secret-of-32-bytes!');
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
    defaultToken = await createAgentToken(demo.owner, {
      projectId: demo.projectId,
      label: 'Claude',
      idempotencyKey: randomUUID(),
    });
  });

  it('lists every tool to every token, and none accepts a projectId argument', async () => {
    const { tools } = await (await connect(defaultToken.secret)).listTools();
    for (const tool of tools)
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain('projectId');
    expect(JSON.stringify({ tools }).length).toBeLessThanOrEqual(50_000);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_change',
      'add_queue_event',
      'add_queue_item',
      'add_team',
      'ask_to_edit',
      'cancel_ask_to_edit',
      'cancel_change_request',
      'comment_change_request',
      'create_change_request',
      'decline_ask_to_edit',
      'delete_team',
      'get_change_request',
      'get_project',
      'get_tracker',
      'hand_over_change_request',
      'invite_member',
      'list_change_requests',
      'list_members',
      'list_queue',
      'mark_draft',
      'mark_ready',
      'merge_change_request',
      'remove_change',
      'remove_member',
      'remove_queue_card',
      'request_changes',
      'set_member_grants',
      'share_change_request',
      'update_team',
    ]);
  });
  it('get_project reads the title, client name and time zone, and a projectId argument is VALIDATION', async () => {
    const client = await connect(defaultToken.secret);
    const project = await call(client, 'get_project', {});
    expect(project.structuredContent).toEqual({
      projectId: demo.projectId,
      project: {
        id: demo.projectId,
        workspaceId: demo.workspaceId,
        title: 'Larkspur Capital, Fund III onboarding',
        clientName: 'Larkspur Capital',
      },
      timeZone: 'Asia/Ho_Chi_Minh',
      requestId: expect.any(String),
    });
    const smuggled = await call(client, 'get_project', { projectId: randomUUID() });
    expect(smuggled).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'VALIDATION',
        errors: [expect.objectContaining({ path: expect.any(String) })],
      },
    });
  });
  it('checks the scope per tool: a queue:add token adds a card but cannot read the project', async () => {
    const writer = await connect((await token(['queue:add'])).secret);
    const added = await call(writer, 'add_queue_event', {
      kind: 'message',
      at: '2026-10-09T16:30:00+07:00',
      by: 'sarah',
      text: 'Only queue:add.',
    });
    expect(added.isError).toBeFalsy();
    expect(await call(writer, 'get_project', {})).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN' },
    });
  });
  it('a revoked token fails its next call and a new connection', async () => {
    const created = await token(['project:read']);
    const client = await connect(created.secret);
    expect((await call(client, 'get_project')).isError).toBeFalsy();
    await revokeAgentToken(demo.owner, {
      projectId: demo.projectId,
      tokenId: created.token.id,
      idempotencyKey: 'rv1',
    });
    await expect(call(client, 'get_project')).rejects.toThrow(/401|UNAUTHENTICATED/);
    await expect(
      connect(created.secret).then((c) => c.callTool({ name: 'get_project', arguments: {} })),
    ).rejects.toThrow(/401|UNAUTHENTICATED/);
  });
  it('a token of another project reads nothing of this one', async () => {
    const other = await seedDemo(t.db, await testActor(t.db));
    const { secret } = await createAgentToken(other.owner, {
      projectId: other.projectId,
      label: 'Other',
      idempotencyKey: randomUUID(),
    });
    const reply = await call(await connect(secret), 'get_project');
    expect(reply.structuredContent.project.id).toBe(other.projectId);
    expect(JSON.stringify(reply)).not.toContain(demo.projectId);
  });
  it('a token with no scope left authenticates and every tool refuses it', async () => {
    const created = await token(['project:read']);
    await t.db.update(agentTokens).set({ scopes: [] }).where(eq(agentTokens.id, created.token.id));
    const client = await connect(created.secret);
    const { tools } = await client.listTools();
    for (const { name } of tools) {
      const reply = await call(client, name);
      expect(reply).toMatchObject({ isError: true, structuredContent: { code: 'FORBIDDEN' } });
      expect(JSON.stringify(reply.content)).toMatch(/Scope \S+ is required/);
    }
  });
  it('marks successful responses private and uncacheable', async () => {
    const rpc = (id: number, method: string, params: Record<string, unknown>) =>
      POST(
        new Request(`${origin}/mcp`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${defaultToken.secret}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        }),
      );
    for (const response of [
      await rpc(1, 'tools/list', {}),
      await rpc(2, 'tools/call', { name: 'get_project', arguments: {} }),
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('vary')).toContain('Authorization');
      expect((await response.json()).result).toBeDefined();
    }
  });
  it('answers only POST and rejects an unknown token or foreign Host', async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
    await expect(connect(`inv_${'A'.repeat(43)}`)).rejects.toThrow(/401|UNAUTHENTICATED/);
    const response = await POST(
      new Request(`${origin}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${defaultToken.secret}`,
          host: 'evil.example',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: '{}',
      }),
    );
    expect(response.status).toBe(403);
  });
});
