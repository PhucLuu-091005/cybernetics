import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configureApp, createAgentToken, resetApp } from '../../../src/server/app';
import { getTrackerPayload } from '../../../src/server/tracker';
import { DELETE, GET, POST } from '../../../src/app/mcp/route';
import type { Scope } from '../../../src/contracts';
import { createTestDatabase, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
type Structured = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Structured };

describe.skipIf(!process.env.TEST_DATABASE_URL)('MCP tracker tools', () => {
  let t: TestDb, demo: Demo;
  const route = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.method === 'GET'
      ? GET()
      : request.method === 'DELETE'
        ? DELETE()
        : POST(request);
  };
  const connect = async (scopes?: Scope[]) => {
    const { secret } = await createAgentToken(demo.owner, {
      projectId: demo.projectId,
      label: 'Tracker agent',
      ...(scopes ? { scopes } : {}),
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

  beforeAll(async () => {
    t = await createTestDatabase();
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('SESSION_SECRET', 'mcp-tracker-test-secret-of-32-bytes!');
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
  });

  it('adds a queue event with the default token, and list_queue shows it as an agent card', async () => {
    const agent = await connect();
    const added = await call(agent, 'add_queue_event', {
      kind: 'issue',
      at: '2026-10-09T16:30+07:00',
      by: 'sarah',
      text: 'Sarah reports a sync gap.',
    });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent).toMatchObject({
      projectId: demo.projectId,
      requestId: expect.any(String),
      event: {
        id: expect.any(String),
        kind: 'issue',
        at: '2026-10-09T16:30:00+07:00',
        by: 'sarah',
        agent: true,
        addedBy: demo.ids.minh,
      },
    });
    const queue = await call(agent, 'list_queue');
    expect(queue.isError).toBeFalsy();
    const card = queue.structuredContent.events.find(
      (item: { id: string }) => item.id === added.structuredContent.event.id,
    );
    expect(card).toMatchObject({ agent: true, text: 'Sarah reports a sync gap.' });
    expect(queue.structuredContent.events.map((item: { id: string }) => item.id)).not.toContain(
      demo.ids.qe3,
    );
    expect(queue.structuredContent.items).toHaveLength(2);
  });

  it('adds a queue work item and rejects a person that Main does not have', async () => {
    const agent = await connect();
    const added = await call(agent, 'add_queue_item', {
      title: 'Check the FATCA wording',
      doneBy: demo.ids.lan,
      requestedBy: 'sarah',
      milestoneId: 'golive',
      plannedFinish: '2026-10-14',
    });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent.item).toMatchObject({
      title: 'Check the FATCA wording',
      note: '',
      after: null,
      agent: true,
    });
    const payload = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(payload.queue.items.map((item) => item.id)).toContain(added.structuredContent.item.id);
    const unknown = await call(agent, 'add_queue_event', {
      kind: 'message',
      at: '2026-10-09T16:30:00+07:00',
      by: 'nobody',
      text: 'Who?',
    });
    expect(unknown).toMatchObject({ isError: true, structuredContent: { code: 'VALIDATION' } });
  });

  it('get_tracker gives people, teams, statuses at the demo clock and the open CRs', async () => {
    const reply = await call(await connect(), 'get_tracker');
    expect(reply.isError).toBeFalsy();
    const tracker = reply.structuredContent;
    expect(tracker).toMatchObject({
      projectId: demo.projectId,
      asOf: '2026-10-09T11:00:00.000Z',
      timeZone: 'Asia/Ho_Chi_Minh',
      revision: 1,
    });
    expect(tracker.people).toContainEqual({ id: 'sarah', name: 'Sarah Kim' });
    expect(tracker.people).toContainEqual({ id: demo.ids.lan, name: 'Lan Phạm' });
    expect(tracker.teams).toHaveLength(7);
    expect(tracker.teams[0]).toEqual({
      id: 'implementation',
      name: 'Implementation',
      leadId: demo.ids.minh,
    });
    const status = (id: string) =>
      tracker.workItems.find((item: { id: string }) => item.id === id)?.status;
    expect(
      ['pg203', 'pg202', 'pg201', 'rehearsal', 'test', 'legal'].map((id) => status(id)),
    ).toEqual(['late', 'flate', 'ontime', 'early', 'planned', 'ontime']);
    expect(tracker.workItems.find((item: { id: string }) => item.id === 'pg203')).toMatchObject({
      title: 'PG-203 Country list field type',
      teamId: 'engineering',
      plannedFinish: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(
      tracker.milestones.map((m: { id: string; status: string; planned: string }) => [
        m.id,
        m.status,
        m.planned,
      ]),
    ).toEqual([
      ['crm', 'late', '2026-09-18'],
      ['golive', 'planned', '2026-10-15'],
    ]);
    expect(
      tracker.openChangeRequests.map((cr: { num: number; status: string }) => [cr.num, cr.status]),
    ).toEqual([
      [2, 'ready'],
      [3, 'ready'],
      [4, 'draft'],
    ]);
    expect(tracker.openChangeRequests[0]).toMatchObject({
      title: 'Place PG-204 in Engineering',
      author: { id: demo.ids.lan, name: 'Lan Phạm' },
      changes: expect.any(Number),
    });
  });

  it('lists change requests by status and reads one with its changes and comments', async () => {
    const agent = await connect();
    const all = await call(agent, 'list_change_requests');
    expect(all.structuredContent.items.map((cr: { num: number }) => cr.num)).toEqual([1, 2, 3, 4]);
    const merged = await call(agent, 'list_change_requests', { status: 'merged' });
    expect(merged.structuredContent.items).toMatchObject([
      { num: 1, status: 'merged', author: { id: demo.ids.minh, name: 'Minh Trần' } },
    ]);
    const one = await call(agent, 'get_change_request', { num: 1 });
    expect(one.isError).toBeFalsy();
    expect(one.structuredContent.changeRequest).toMatchObject({
      num: 1,
      title: 'Explain the go-live slip',
      status: 'merged',
      mergedRev: 1,
      mergedBy: { id: demo.ids.minh, name: 'Minh Trần' },
    });
    expect(one.structuredContent.changeRequest.changes).toHaveLength(2);
    expect(one.structuredContent.changeRequest.changes[1]).toMatchObject({
      index: 1,
      op: 'msDate',
      by: { id: demo.ids.minh, name: 'Minh Trần' },
      description: { why: expect.stringContaining('CRS section') },
    });
    expect(
      one.structuredContent.changeRequest.comments.map((c: { kind: string }) => c.kind),
    ).toEqual(['created', 'ready', 'merged']);
    expect(await call(agent, 'get_change_request', { num: 99 })).toMatchObject({
      isError: true,
      structuredContent: { code: 'NOT_FOUND' },
    });
  });

  it('needs queue:add to add and project:read to read', async () => {
    const reader = await connect(['project:read']);
    expect(
      await call(reader, 'add_queue_event', {
        kind: 'message',
        at: '2026-10-09T16:30:00+07:00',
        by: 'sarah',
        text: 'Hi',
      }),
    ).toMatchObject({ isError: true, structuredContent: { code: 'FORBIDDEN' } });
    expect((await call(reader, 'list_queue')).isError).toBeFalsy();
    const writer = await connect(['queue:add']);
    expect(await call(writer, 'get_tracker')).toMatchObject({
      isError: true,
      structuredContent: { code: 'FORBIDDEN' },
    });
    const added = await call(writer, 'add_queue_event', {
      kind: 'message',
      at: '2026-10-09T16:30:00+07:00',
      by: 'sarah',
      text: 'Only queue:add.',
    });
    expect(added.isError).toBeFalsy();
    expect(Object.keys(added.structuredContent).sort()).toEqual([
      'event',
      'projectId',
      'requestId',
    ]);
  });

  it('gives a new token project:read and queue:add, and lists the tracker tools', async () => {
    const { token } = await createAgentToken(demo.owner, {
      projectId: demo.projectId,
      label: 'Defaults',
      idempotencyKey: randomUUID(),
    });
    expect(token.scopes).toEqual(['project:read', 'queue:add']);
    const { tools } = await (await connect()).listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      'get_tracker',
      'list_queue',
      'add_queue_event',
      'add_queue_item',
      'list_change_requests',
      'get_change_request',
    ])
      expect(names).toContain(name);
    const readOnly = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
    );
    expect(readOnly).toMatchObject({ get_tracker: true, add_queue_event: false });
  });
});
