import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestDatabase, testActor, type TestDb } from '../support/db';
import { seedDemo } from '../support/tracker-db';
import { configureApp, resetApp, seedOnUserCreated, tokenActor } from '../../src/server/app';
import { DbIdentityStore } from '../../src/server/db/identity-store';
import { projects } from '../../src/server/db/schema';
import { browserScopes } from '../../src/server/http/identity-store';
import { route } from '../../src/server/http/route';
import { SESSION_COOKIE, signSession } from '../../src/server/http/session';
import { getTrackerPayload } from '../../src/server/tracker';
import { LARKSPUR_PROJECT } from '../../src/server/tracker/seed/larkspur';
import * as projectRoute from '../../src/app/api/v1/projects/[projectId]/route';
import * as trackerRoute from '../../src/app/api/v1/projects/[projectId]/tracker/route';
import * as queueRoute from '../../src/app/api/v1/projects/[projectId]/tracker/queue/route';
import * as queueCardRoute from '../../src/app/api/v1/projects/[projectId]/tracker/queue/[queueId]/route';
import * as crsRoute from '../../src/app/api/v1/projects/[projectId]/tracker/crs/route';
import * as tokensRoute from '../../src/app/api/v1/projects/[projectId]/agent-tokens/route';
import * as tokenRoute from '../../src/app/api/v1/projects/[projectId]/agent-tokens/[tokenId]/route';
import * as sessionRoute from '../../src/app/api/auth/session/route';
import { POST as mcpPost } from '../../src/app/mcp/route';
import type { ActorContext } from '../../src/contracts';

const origin = 'http://localhost:3000';
const secret = 'security-test-secret-of-32-bytes!!!';
type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Reply = { status: number; text: string; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const limiterState = globalThis as typeof globalThis & { promiseRateLimiter?: unknown };

describe.skipIf(!process.env.TEST_DATABASE_URL)('release security checks', () => {
  let t: TestDb,
    alice: ActorContext,
    bob: ActorContext,
    aliceProject: string,
    bobProject: string,
    aliceCard: string;
  let seededBodies: string[];
  const marker = `Confidential Larkspur escrow detail ${randomUUID()}`;
  const logs: string[] = [];
  const denied: string[] = [];

  const cookieFor = (ctx: ActorContext) =>
    `${SESSION_COOKIE}=${signSession({ userId: ctx.userId, expiresAt: Date.now() + 600_000 }, secret)}`;
  async function call(
    handler: Handler | undefined,
    method: string,
    path: string,
    params: Record<string, string>,
    as: ActorContext,
    opts: { body?: unknown; origin?: string | null } = {},
  ): Promise<Reply> {
    if (!handler) throw new Error(`No ${method} handler for ${path}`);
    const headers: Record<string, string> = { cookie: cookieFor(as) };
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      if (opts.origin !== null) headers.origin = opts.origin ?? origin;
    }
    const response = await handler(
      new Request(`${origin}/api/v1${path}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
      }),
      { params: Promise.resolve(params) },
    );
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) : null };
  }
  const mcpFetch =
    (extraHeaders: Record<string, string> = {}) =>
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      for (const [name, value] of Object.entries(extraHeaders)) request.headers.set(name, value);
      return mcpPost(request);
    };
  const connect = async (tokenSecret: string, extraHeaders: Record<string, string> = {}) => {
    const client = new Client({ name: 'security-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${tokenSecret}` } },
        fetch: mcpFetch(extraHeaders),
      }),
    );
    return client;
  };
  const tool = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolReply;
  const createToken = async (
    as: ActorContext,
    projectId: string,
    label: string,
    scopes?: string[],
  ) => {
    const created = await call(
      tokensRoute.POST,
      'POST',
      `/projects/${projectId}/agent-tokens`,
      { projectId },
      as,
      { body: { label, idempotencyKey: `token-${label}`, ...(scopes ? { scopes } : {}) } },
    );
    expect(created.status).toBe(201);
    return created.body as { token: { id: string }; secret: string };
  };
  const leaksMarker = (text: string) => text.includes(marker);
  const queueEvent = (text: string) => ({
    kind: 'event',
    fields: { kind: 'message', at: '2026-10-09T16:30:00+07:00', by: 'sarah', text },
  });

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', secret);
    configureApp({ db: t.db });
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(format(...args));
      });
    const { userId } = await new DbIdentityStore(t.db, {
      onUserCreated: seedOnUserCreated,
    }).provisionUser({
      subject: `google:${randomUUID()}`,
      email: 'alice@example.com',
      name: 'Alice',
    });
    const session = await new DbIdentityStore(t.db).resolveSessionUser(userId);
    alice = {
      kind: 'user',
      userId,
      workspaceId: session!.defaultWorkspaceId,
      projectId: null,
      scopes: [...browserScopes],
      requestId: randomUUID(),
    };
    [{ id: aliceProject }] = await t.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, alice.workspaceId),
          eq(projects.title, LARKSPUR_PROJECT.title),
        ),
      );
    const added = await call(
      queueRoute.POST,
      'POST',
      `/projects/${aliceProject}/tracker/queue`,
      { projectId: aliceProject },
      alice,
      { body: queueEvent(marker) },
    );
    expect(added.status).toBe(201);
    aliceCard = added.body.queue.events.find((event: { text: string }) => event.text === marker).id;
    const seeded = await getTrackerPayload(t.db, alice, { projectId: aliceProject });
    seededBodies = [...seeded.base.events, ...seeded.queue.events]
      .map((event) => event.text)
      .filter((text) => text.length >= 24 && text !== marker);
    bob = await testActor(t.db, { name: 'Bob' });
    ({ projectId: bobProject } = await seedDemo(t.db, bob));
  }, 120_000);
  beforeEach(() => {
    delete limiterState.promiseRateLimiter;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetApp();
    await t?.close();
  });

  it('seeds a real sandbox for the first browser user', () => {
    expect(seededBodies.length).toBeGreaterThan(20);
  });

  it('isolates two browser users on REST: every route into the other project is 404 and leaks no event text', async () => {
    const p = { projectId: aliceProject };
    const attempts = [
      await call(projectRoute.GET, 'GET', `/projects/${aliceProject}`, p, bob),
      await call(trackerRoute.GET, 'GET', `/projects/${aliceProject}/tracker`, p, bob),
      await call(tokensRoute.GET, 'GET', `/projects/${aliceProject}/agent-tokens`, p, bob),
      await call(queueRoute.POST, 'POST', `/projects/${aliceProject}/tracker/queue`, p, bob, {
        body: queueEvent('Intrusion attempt'),
      }),
      await call(crsRoute.POST, 'POST', `/projects/${aliceProject}/tracker/crs`, p, bob, {
        body: { title: 'Intrusion' },
      }),
      await call(tokensRoute.POST, 'POST', `/projects/${aliceProject}/agent-tokens`, p, bob, {
        body: { label: 'stolen', idempotencyKey: 'bob-2' },
      }),
      // Bob's own project route with Alice's card ID: the ID alone grants nothing.
      await call(
        queueCardRoute.DELETE,
        'DELETE',
        `/projects/${bobProject}/tracker/queue/${aliceCard}`,
        { projectId: bobProject, queueId: aliceCard },
        bob,
      ),
    ];
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({
        status: 404,
        body: { code: 'NOT_FOUND', requestId: expect.any(String) },
      });
      denied.push(attempt.text);
    }
    const own = await call(trackerRoute.GET, 'GET', `/projects/${aliceProject}/tracker`, p, alice);
    expect(own.status).toBe(200);
    expect(own.text).toContain(marker);
  });

  it('isolates two users on MCP: a token reads only its own project', async () => {
    const bobAgent = await connect((await createToken(bob, bobProject, 'bob-agent')).secret);
    const queue = await tool(bobAgent, 'list_queue');
    expect(queue.isError).toBeFalsy();
    expect(queue.structuredContent.projectId).toBe(bobProject);
    const project = await tool(bobAgent, 'get_project', {});
    expect(project.structuredContent.project.id).toBe(bobProject);
    // Bob's own demo holds the same story texts, so only the project read joins the leak check.
    expect(JSON.stringify(queue)).not.toContain(marker);
    denied.push(JSON.stringify(project));

    const aliceAgent = await connect(
      (await createToken(alice, aliceProject, 'alice-agent')).secret,
    );
    const aliceQueue = await tool(aliceAgent, 'list_queue');
    expect(aliceQueue.structuredContent.events.map((e: { id: string }) => e.id)).toContain(
      aliceCard,
    );
    // A token for one project cannot be pointed at another project's REST path.
    const bobToken = await createToken(bob, bobProject, 'bob-path');
    await expect(
      tokenActor(
        new Request(`${origin}/api/v1/projects/${aliceProject}/tracker`, {
          headers: { authorization: `Bearer ${bobToken.secret}` },
        }),
        'project:read',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revoking a token stops every later MCP call', async () => {
    const created = await createToken(alice, aliceProject, 'revoke-me', [
      'project:read',
      'queue:add',
    ]);
    const agent = await connect(created.secret);
    const args = queueEvent('Please send the revised fee schedule.').fields;
    expect((await tool(agent, 'add_queue_event', args)).isError).toBeFalsy();
    const revoked = await call(
      tokenRoute.DELETE,
      'DELETE',
      `/projects/${aliceProject}/agent-tokens/${created.token.id}`,
      { projectId: aliceProject, tokenId: created.token.id },
      alice,
      { body: { idempotencyKey: 'rev-1' } },
    );
    expect(revoked.status).toBe(200);
    await expect(tool(agent, 'add_queue_event', args)).rejects.toThrow(/401|UNAUTHENTICATED/);
    await expect(tool(agent, 'get_project', {})).rejects.toThrow(/401|UNAUTHENTICATED/);
    await expect(connect(created.secret)).rejects.toThrow(/401|UNAUTHENTICATED/);
  });

  it('rejects browser mutations with a foreign or missing Origin, and MCP calls with a foreign Origin', async () => {
    const p = { projectId: aliceProject };
    const body = queueEvent('Origin probe');
    for (const sent of ['https://evil.example', 'http://localhost:3001', null]) {
      const attempt = await call(
        queueRoute.POST,
        'POST',
        `/projects/${aliceProject}/tracker/queue`,
        p,
        alice,
        { body, origin: sent },
      );
      expect(attempt, String(sent)).toMatchObject({ status: 403, body: { code: 'FORBIDDEN' } });
    }
    const signOut = await sessionRoute.DELETE(
      new Request(`${origin}/api/auth/session`, {
        method: 'DELETE',
        headers: { origin: 'https://evil.example', cookie: cookieFor(alice) },
      }),
    );
    expect(signOut.status).toBe(403);
    expect(signOut.headers.get('set-cookie')).toBeNull();
    const created = await createToken(alice, aliceProject, 'origin-agent');
    await expect(connect(created.secret, { origin: 'https://evil.example' })).rejects.toThrow(
      /403|FORBIDDEN/,
    );
    expect(
      (await tool(await connect(created.secret, { origin }), 'get_project', {})).isError,
    ).toBeFalsy();
  });

  it('answers 429 on the 121st browser write in one minute while reads still work, and on the 61st token call', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / 60_000) * 60_000 + 1_000 });
    const p = { projectId: aliceProject };
    for (let write = 1; write <= 120; write++) {
      const opened = await call(
        tokensRoute.POST,
        'POST',
        `/projects/${aliceProject}/agent-tokens`,
        p,
        alice,
        { body: { label: `Write ${write}`, idempotencyKey: `rate-${write}` } },
      );
      expect(opened.status, `write ${write}`).toBe(201);
    }
    const limited = await call(
      tokensRoute.POST,
      'POST',
      `/projects/${aliceProject}/agent-tokens`,
      p,
      alice,
      { body: { label: 'Write 121', idempotencyKey: 'rate-121' } },
    );
    expect(limited).toMatchObject({
      status: 429,
      body: { code: 'RATE_LIMITED', requestId: expect.any(String) },
    });
    expect(
      (await call(trackerRoute.GET, 'GET', `/projects/${aliceProject}/tracker`, p, alice)).status,
    ).toBe(200);
    expect(
      (
        await call(
          tokensRoute.POST,
          'POST',
          `/projects/${bobProject}/agent-tokens`,
          { projectId: bobProject },
          bob,
          { body: { label: 'Other user', idempotencyKey: 'rate-bob' } },
        )
      ).status,
    ).toBe(201);

    const created = await createToken(bob, bobProject, 'rate-agent');
    const bearer = () =>
      new Request(`${origin}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${created.secret}` },
      });
    for (let call = 1; call <= 60; call++) await tokenActor(bearer(), 'project:read');
    await expect(tokenActor(bearer(), 'project:read')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('an unexpected failure returns INTERNAL without its message, and its log line holds only the request ID and error name', async () => {
    const failing = route(async () => {
      throw new Error(`Query failed near: ${seededBodies[0]} ${marker}`);
    });
    const reply = await call(
      failing,
      'GET',
      `/projects/${aliceProject}/tracker`,
      { projectId: aliceProject },
      alice,
    );
    expect(reply).toMatchObject({
      status: 500,
      body: { code: 'INTERNAL', message: 'Internal error', requestId: expect.any(String) },
    });
    denied.push(reply.text);
    const line = logs.find((entry) => entry.includes(reply.body.requestId));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toEqual({ requestId: reply.body.requestId, error: 'Error' });
  });

  it('no denied response and no log line contains a seeded event text, the confidential marker or a secret', () => {
    expect(denied.length).toBeGreaterThanOrEqual(9);
    for (const text of denied) {
      expect(leaksMarker(text), text.slice(0, 200)).toBe(false);
      for (const body of seededBodies)
        expect(
          text.includes(body),
          `denied response holds an event text: ${text.slice(0, 120)}`,
        ).toBe(false);
    }
    for (const line of logs) {
      expect(leaksMarker(line), line.slice(0, 200)).toBe(false);
      expect(line).not.toContain(secret);
      expect(line).not.toMatch(/inv_[A-Za-z0-9_-]{43}/);
      for (const body of seededBodies)
        expect(line.includes(body), `log line holds an event text: ${line.slice(0, 120)}`).toBe(
          false,
        );
    }
  });
});
