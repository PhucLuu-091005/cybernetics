import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestDatabase, testActor, type TestDb } from '../support/db';
import { record } from '../support/evidence';
import { ingestText, seedProject } from '../support/proposals';
import { configureApp, resetApp, seedOnUserCreated, tokenActor } from '../../src/server/app';
import { DbIdentityStore } from '../../src/server/db/identity-store';
import { SANDBOX_TITLE } from '../../src/server/domain/seed';
import { projects, recordVersions } from '../../src/server/db/schema';
import { browserScopes } from '../../src/server/http/identity-store';
import { route } from '../../src/server/http/route';
import { SESSION_COOKIE, signSession } from '../../src/server/http/session';
import * as graphRoute from '../../src/app/api/v1/projects/[projectId]/graph/route';
import * as inboxRoute from '../../src/app/api/v1/projects/[projectId]/inbox/route';
import * as recordsRoute from '../../src/app/api/v1/projects/[projectId]/records/route';
import * as versionRoute from '../../src/app/api/v1/projects/[projectId]/record-versions/[versionId]/route';
import * as proposalsRoute from '../../src/app/api/v1/projects/[projectId]/proposals/route';
import * as commitsRoute from '../../src/app/api/v1/projects/[projectId]/commits/route';
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
    bobVersion: string,
    aliceVersion: string;
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
  const createToken = async (as: ActorContext, projectId: string, label: string) => {
    const created = await call(
      tokensRoute.POST,
      'POST',
      `/projects/${projectId}/agent-tokens`,
      { projectId },
      as,
      { body: { label, idempotencyKey: `token-${label}` } },
    );
    expect(created.status).toBe(201);
    return created.body as { token: { id: string }; secret: string };
  };
  const leaksMarker = (text: string) => text.includes(marker);

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
      .where(and(eq(projects.workspaceId, alice.workspaceId), eq(projects.title, SANDBOX_TITLE)));
    aliceVersion = await ingestText(t.db, alice, aliceProject, marker);
    seededBodies = (
      await t.db
        .select({ body: recordVersions.bodyText })
        .from(recordVersions)
        .where(eq(recordVersions.projectId, aliceProject))
    )
      .map((row) => row.body)
      .filter((body) => body.length >= 24);
    bob = await testActor(t.db, { name: 'Bob' });
    ({ projectId: bobProject, versionId: bobVersion } = await seedProject(t.db, bob));
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
    expect(seededBodies.length).toBeGreaterThan(50);
  });

  it('isolates two browser users on REST: every route into the other project is 404 and leaks no record text', async () => {
    const p = { projectId: aliceProject };
    const attempts = [
      await call(graphRoute.GET, 'GET', `/projects/${aliceProject}/graph`, p, bob),
      await call(inboxRoute.GET, 'GET', `/projects/${aliceProject}/inbox`, p, bob),
      await call(
        versionRoute.GET,
        'GET',
        `/projects/${aliceProject}/record-versions/${aliceVersion}`,
        { ...p, versionId: aliceVersion },
        bob,
      ),
      await call(proposalsRoute.GET, 'GET', `/projects/${aliceProject}/proposals`, p, bob),
      await call(commitsRoute.GET, 'GET', `/projects/${aliceProject}/commits`, p, bob),
      await call(tokensRoute.GET, 'GET', `/projects/${aliceProject}/agent-tokens`, p, bob),
      await call(recordsRoute.POST, 'POST', `/projects/${aliceProject}/records`, p, bob, {
        body: {
          source: 'paste',
          sourceLabel: 'paste',
          records: [record('x', 'Intrusion attempt')],
          idempotencyKey: 'bob-1',
        },
      }),
      await call(tokensRoute.POST, 'POST', `/projects/${aliceProject}/agent-tokens`, p, bob, {
        body: { label: 'stolen', idempotencyKey: 'bob-2' },
      }),
      // Bob's own project route with Alice's version ID: the ID alone grants nothing.
      await call(
        versionRoute.GET,
        'GET',
        `/projects/${bobProject}/record-versions/${aliceVersion}`,
        { projectId: bobProject, versionId: aliceVersion },
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
    const own = await call(
      versionRoute.GET,
      'GET',
      `/projects/${aliceProject}/record-versions/${aliceVersion}`,
      { ...p, versionId: aliceVersion },
      alice,
    );
    expect(own.status).toBe(200);
    expect(own.text).toContain(marker);
  });

  it('isolates two users on MCP: a token reads only its own project and a foreign ID is NOT_FOUND', async () => {
    const bobAgent = await connect((await createToken(bob, bobProject, 'bob-agent')).secret);
    const foreign = await tool(bobAgent, 'get_record', { recordVersionId: aliceVersion });
    expect(foreign).toMatchObject({ isError: true, structuredContent: { code: 'NOT_FOUND' } });
    const search = await tool(bobAgent, 'search_records', { query: 'escrow' });
    expect(search.isError).toBeFalsy();
    expect(search.structuredContent.projectId).toBe(bobProject);
    const project = await tool(bobAgent, 'get_project', {});
    expect(project.structuredContent.project.id).toBe(bobProject);
    denied.push(JSON.stringify(foreign), JSON.stringify(search), JSON.stringify(project));

    const aliceAgent = await connect(
      (await createToken(alice, aliceProject, 'alice-agent')).secret,
    );
    expect(await tool(aliceAgent, 'get_record', { recordVersionId: bobVersion })).toMatchObject({
      isError: true,
      structuredContent: { code: 'NOT_FOUND' },
    });
    expect(
      (await tool(aliceAgent, 'get_record', { recordVersionId: aliceVersion })).structuredContent
        .text,
    ).toBe(marker);
    // A token for one project cannot be pointed at another project's REST path.
    const bobToken = await createToken(bob, bobProject, 'bob-path');
    await expect(
      tokenActor(
        new Request(`${origin}/api/v1/projects/${aliceProject}/graph`, {
          headers: { authorization: `Bearer ${bobToken.secret}` },
        }),
        'project:read',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revoking a token stops every later MCP call, including a replay of an earlier receipt', async () => {
    const created = await createToken(alice, aliceProject, 'revoke-me');
    const agent = await connect(created.secret);
    const args = {
      source: 'agent',
      sourceLabel: 'notion',
      records: [record('revocation', 'Please send the revised fee schedule.')],
      idempotencyKey: 'rev-import',
    };
    expect((await tool(agent, 'import_records', args)).isError).toBeFalsy();
    const revoked = await call(
      tokenRoute.DELETE,
      'DELETE',
      `/projects/${aliceProject}/agent-tokens/${created.token.id}`,
      { projectId: aliceProject, tokenId: created.token.id },
      alice,
      { body: { idempotencyKey: 'rev-1' } },
    );
    expect(revoked.status).toBe(200);
    await expect(tool(agent, 'import_records', args)).rejects.toThrow(/401|UNAUTHENTICATED/);
    await expect(tool(agent, 'get_project', {})).rejects.toThrow(/401|UNAUTHENTICATED/);
    await expect(connect(created.secret)).rejects.toThrow(/401|UNAUTHENTICATED/);
  });

  it('rejects browser mutations with a foreign or missing Origin, and MCP calls with a foreign Origin', async () => {
    const p = { projectId: aliceProject };
    const body = {
      source: 'paste',
      sourceLabel: 'paste',
      records: [record('origin', 'Origin probe')],
      idempotencyKey: 'origin-1',
    };
    for (const sent of ['https://evil.example', 'http://localhost:3001', null]) {
      const attempt = await call(
        recordsRoute.POST,
        'POST',
        `/projects/${aliceProject}/records`,
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

  it('answers 429 on the 21st browser write in one minute while reads still work, and on the 61st token call', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / 60_000) * 60_000 + 1_000 });
    const p = { projectId: aliceProject };
    for (let write = 1; write <= 20; write++) {
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
      { body: { label: 'Write 21', idempotencyKey: 'rate-21' } },
    );
    expect(limited).toMatchObject({
      status: 429,
      body: { code: 'RATE_LIMITED', requestId: expect.any(String) },
    });
    expect(
      (await call(graphRoute.GET, 'GET', `/projects/${aliceProject}/graph`, p, alice)).status,
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
      `/projects/${aliceProject}/graph`,
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

  it('no denied response and no log line contains a seeded record body, the confidential marker or a secret', () => {
    expect(denied.length).toBeGreaterThanOrEqual(12);
    for (const text of denied) {
      expect(leaksMarker(text), text.slice(0, 200)).toBe(false);
      for (const body of seededBodies)
        expect(
          text.includes(body),
          `denied response holds a record body: ${text.slice(0, 120)}`,
        ).toBe(false);
    }
    for (const line of logs) {
      expect(leaksMarker(line), line.slice(0, 200)).toBe(false);
      expect(line).not.toContain(secret);
      expect(line).not.toMatch(/inv_[A-Za-z0-9_-]{43}/);
      for (const body of seededBodies)
        expect(line.includes(body), `log line holds a record body: ${line.slice(0, 120)}`).toBe(
          false,
        );
    }
  });
});
