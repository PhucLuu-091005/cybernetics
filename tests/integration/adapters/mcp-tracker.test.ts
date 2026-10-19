import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configureApp, createAgentToken, resetApp } from '../../../src/server/app';
import { trackerQueue } from '../../../src/server/db/schema';
import { createCr, crAction, getTrackerPayload } from '../../../src/server/tracker';
import { DELETE, GET, POST } from '../../../src/app/mcp/route';
import type { Scope } from '../../../src/contracts';
import { createTestDatabase, type TestDb } from '../../support/db';
import { type Demo, HISTORY, seedDemo, storyCr } from '../../support/tracker-db';

const origin = 'http://localhost:3000';
type Structured = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type ToolReply = { isError?: boolean; structuredContent?: Structured };
type Card = { id: string; createdAt: string };

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
      plannedFinishTime: '17:00',
    });
    expect(added.isError).toBeFalsy();
    expect(added.structuredContent.item).toMatchObject({
      title: 'Check the FATCA wording',
      plannedFinishTime: '17:00',
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
      revision: HISTORY + 1,
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
      plannedFinishTime: null,
      firstPlannedFinishTime: null,
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
    expect(tracker.milestones[1]).toMatchObject({
      planned: '2026-10-15',
      plannedTime: '17:00',
      firstPlannedTime: null,
    });
    expect(
      tracker.openChangeRequests.map((cr: { num: number; status: string }) => [cr.num, cr.status]),
    ).toEqual([
      [storyCr(2), 'ready'],
      [storyCr(3), 'ready'],
      [storyCr(4), 'draft'],
    ]);
    expect(tracker.openChangeRequests[0]).toMatchObject({
      title: 'Place PG-204 in Engineering',
      author: { id: demo.ids.lan, name: 'Lan Phạm' },
      changeCount: expect.any(Number),
    });
  });

  it('lists change requests by status and reads one with its changes and comments', async () => {
    const agent = await connect();
    const all = await call(agent, 'list_change_requests');
    expect(all.structuredContent.items.map((cr: { num: number }) => cr.num)).toEqual(
      Array.from({ length: HISTORY + 4 }, (_, i) => HISTORY + 4 - i),
    );
    expect(all.structuredContent.nextBefore).toBeNull();
    const merged = await call(agent, 'list_change_requests', { status: 'merged' });
    expect(merged.structuredContent.items).toHaveLength(HISTORY + 1);
    expect(merged.structuredContent.items[0]).toMatchObject({
      num: storyCr(1),
      status: 'merged',
      author: { id: demo.ids.minh, name: 'Minh Trần' },
    });
    const one = await call(agent, 'get_change_request', { num: storyCr(1) });
    expect(one.isError).toBeFalsy();
    expect(one.structuredContent.changeRequest).toMatchObject({
      num: storyCr(1),
      title: 'Explain the go-live slip',
      status: 'merged',
      mergedRev: HISTORY + 1,
      mergedBy: { id: demo.ids.minh, name: 'Minh Trần' },
    });
    expect(one.structuredContent.changeRequest).toMatchObject({ changeCount: 2 });
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

  it('shows a milestone deadline time in get_tracker and in the changes of get_change_request', async () => {
    const as = { projectId: demo.projectId, actAs: demo.ids.minh };
    const { num } = await createCr(t.db, demo.owner, {
      ...as,
      title: 'Call at five',
      ops: [
        {
          op: 'msDate',
          a: { milestoneId: 'golive', date: '2026-10-15', time: '18:30', why: 'The client call.' },
        },
      ],
    });
    await crAction(t.db, demo.owner, { ...as, num, action: 'ready' });
    const ready = await getTrackerPayload(t.db, demo.owner, as);
    const revision = ready.crs.find((cr) => cr.num === num)!.revision;
    await crAction(t.db, demo.owner, { ...as, num, action: 'merge', expectedRevision: revision });
    const agent = await connect();
    const tracker = (await call(agent, 'get_tracker')).structuredContent;
    expect(tracker.milestones.find((m: { id: string }) => m.id === 'golive')).toMatchObject({
      planned: '2026-10-15',
      plannedTime: '18:30',
    });
    const one = (await call(agent, 'get_change_request', { num })).structuredContent;
    expect(one.changeRequest.changes[0]).toMatchObject({
      op: 'msDate',
      description: { before: 'planned 15 Oct 17:00', after: 'planned 15 Oct 18:30' },
    });
  });

  it('takes Idea, Cancelled and a finishing Handoff, and get_tracker shows cancelled and finished items', async () => {
    const agent = await connect();
    const idea = await call(agent, 'add_queue_event', {
      kind: 'idea',
      at: '2026-10-09T09:00+07:00',
      by: 'sarah',
      text: 'Sarah thinks of a CRS checklist.',
    });
    expect(idea.structuredContent.event).toMatchObject({ kind: 'idea' });
    const handoff = await call(agent, 'add_queue_event', {
      kind: 'handoff',
      at: '2026-10-09T10:00+07:00',
      by: 'sarah',
      text: 'Sarah hands the checklist over.',
      finishes: true,
    });
    expect(handoff.structuredContent.event).toMatchObject({ kind: 'handoff', finishes: true });
    expect(
      await call(agent, 'add_queue_event', {
        kind: 'cancelled',
        at: '2026-10-09T10:00+07:00',
        by: 'sarah',
        text: '   ',
      }),
    ).toMatchObject({ isError: true, structuredContent: { code: 'VALIDATION' } });

    const as = { projectId: demo.projectId, actAs: demo.ids.minh };
    const ev = (id: string, kind: string, text: string, finishes?: boolean) => ({
      id,
      kind,
      at: '2026-10-09T11:00:00+07:00',
      by: 'minh',
      text,
      ...(finishes ? { finishes } : {}),
    });
    const { num } = await createCr(t.db, demo.owner, {
      ...as,
      title: 'Finish two work items',
      ops: [
        {
          op: 'addEvent',
          a: {
            workItemId: 'pg203',
            ev: ev('cancel203', 'cancelled', 'The field stays free text.'),
          },
        },
        {
          op: 'addEvent',
          a: { workItemId: 'crs', ev: ev('handcrs', 'handoff', 'Minh hands it to QA.', true) },
        },
      ],
    });
    await crAction(t.db, demo.owner, { ...as, num, action: 'ready' });
    const ready = await getTrackerPayload(t.db, demo.owner, as);
    const revision = ready.crs.find((cr) => cr.num === num)!.revision;
    await crAction(t.db, demo.owner, { ...as, num, action: 'merge', expectedRevision: revision });
    const tracker = (await call(agent, 'get_tracker')).structuredContent;
    const item = (id: string) => tracker.workItems.find((w: { id: string }) => w.id === id);
    expect(item('pg203')).toMatchObject({
      status: 'cancelled',
      statusLabel: 'Cancelled',
      finishedAt: '2026-10-09T11:00:00+07:00',
    });
    expect(item('crs')).toMatchObject({ status: 'early', finishedAt: '2026-10-09T11:00:00+07:00' });
  });

  it('shows a planned finish time in get_tracker, and a late status from that time', async () => {
    const as = { projectId: demo.projectId, actAs: demo.ids.minh };
    const { num } = await createCr(t.db, demo.owner, {
      ...as,
      title: 'Test review at nine',
      ops: [
        {
          op: 'due',
          a: {
            workItemId: 'test',
            date: '2026-10-09',
            time: '09:00',
            why: 'The review is at nine.',
          },
        },
      ],
    });
    await crAction(t.db, demo.owner, { ...as, num, action: 'ready' });
    const ready = await getTrackerPayload(t.db, demo.owner, as);
    const revision = ready.crs.find((cr) => cr.num === num)!.revision;
    await crAction(t.db, demo.owner, { ...as, num, action: 'merge', expectedRevision: revision });
    const tracker = (await call(await connect(), 'get_tracker')).structuredContent;
    expect(tracker.workItems.find((w: { id: string }) => w.id === 'test')).toMatchObject({
      plannedFinish: '2026-10-09',
      plannedFinishTime: '09:00',
      firstPlannedFinishTime: null,
      status: 'late',
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

  const pageAll = async (client: Client, args: Record<string, unknown>) => {
    const pages: Card[][] = [];
    let before: string | null | undefined;
    do {
      const reply = await call(client, 'list_queue', { ...args, ...(before ? { before } : {}) });
      expect(reply.isError).toBeFalsy();
      expect(JSON.stringify(reply.structuredContent).length).toBeLessThan(50_000);
      pages.push([...reply.structuredContent.events, ...reply.structuredContent.items]);
      before = reply.structuredContent.nextBefore;
    } while (before && pages.length < 50);
    return pages;
  };
  const newest = (cards: Card[]) =>
    [...cards].sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );

  it('pages the Queue newest first without loss, also across cards that share a created time', async () => {
    await t.db.insert(trackerQueue).values(
      ['First', 'Second', 'Third'].map((text) => ({
        workspaceId: demo.workspaceId,
        projectId: demo.projectId,
        kind: 'event' as const,
        payload: { kind: 'message' as const, at: '2026-10-09T09:00:00+07:00', by: 'sarah', text },
        createdAt: '2026-10-09T02:00:00.000Z',
      })),
    );
    const agent = await connect(['project:read']);
    const whole = (await call(agent, 'list_queue', { limit: 200 })).structuredContent;
    expect(whole.nextBefore).toBeNull();
    const all = newest([...whole.events, ...whole.items]);
    expect(all).toHaveLength(8);
    const pages = await pageAll(agent, { limit: 2 });
    expect(pages.map((page) => page.length)).toEqual([2, 2, 2, 2]);
    expect(pages.flatMap((page) => newest(page).map((card) => card.id))).toEqual(
      all.map((card) => card.id),
    );
    expect(await pageAll(agent, { limit: 1 })).toHaveLength(8);
  });

  it('reads the Queue before a plain created time and rejects a bad cursor or limit', async () => {
    const agent = await connect(['project:read']);
    const whole = (await call(agent, 'list_queue')).structuredContent;
    const all = newest([...whole.events, ...whole.items]);
    const cut = all[2].createdAt;
    const older = (await call(agent, 'list_queue', { before: cut })).structuredContent;
    expect(newest([...older.events, ...older.items]).map((card) => card.id)).toEqual(
      all.filter((card) => Date.parse(card.createdAt) < Date.parse(cut)).map((card) => card.id),
    );
    for (const args of [{ before: 'yesterday' }, { before: `${cut}/not-an-id` }, { limit: 201 }])
      expect(await call(agent, 'list_queue', args)).toMatchObject({
        isError: true,
        structuredContent: { code: 'VALIDATION' },
      });
  });

  it('keeps each Queue page under the character budget', async () => {
    const agent = await connect();
    for (let n = 0; n < 15; n++) {
      const added = await call(agent, 'add_queue_event', {
        kind: 'message',
        at: '2026-10-09T16:30:00+07:00',
        by: 'sarah',
        text: `${n} ${'x'.repeat(3_900)}`,
      });
      expect(added.isError).toBeFalsy();
    }
    const first = await call(agent, 'list_queue', { limit: 200 });
    expect(first.structuredContent.events.length).toBeLessThan(15);
    expect(first.structuredContent.nextBefore).toEqual(expect.any(String));
    const pages = await pageAll(agent, { limit: 200 });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat()).toHaveLength(15 + 3 + 2);
  });

  it('pages change requests by number, newest first', async () => {
    const agent = await connect(['project:read']);
    const first = (await call(agent, 'list_change_requests', { limit: 2 })).structuredContent;
    expect(first.items.map((cr: { num: number }) => cr.num)).toEqual([storyCr(4), storyCr(3)]);
    expect(first.nextBefore).toBe(storyCr(3));
    const rest = (await call(agent, 'list_change_requests', { limit: 2, before: storyCr(3) }))
      .structuredContent;
    expect(rest.items.map((cr: { num: number }) => cr.num)).toEqual([storyCr(2), storyCr(1)]);
    expect(rest.nextBefore).toBe(storyCr(1));
    const ready = (
      await call(agent, 'list_change_requests', { status: 'ready', before: storyCr(3) })
    ).structuredContent;
    expect(ready.items.map((cr: { num: number }) => cr.num)).toEqual([storyCr(2)]);
  });
});
