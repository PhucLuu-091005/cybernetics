import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../../../src/server/db/tx';
import { createEmptyProject } from '../../../src/server/domain/projects';
import {
  actingMember,
  addQueueEntry,
  appendOp,
  createCr,
  crAction,
  dismissQueueEntry,
  getTrackerPayload,
  removeOp,
} from '../../../src/server/tracker';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, workspaceGuest, type Demo } from '../../support/tracker-db';

const rename = { op: 'rename', a: { workItemId: 'test', title: 'Test plan' } } as const;
const event = (by: string) => ({
  kind: 'message' as const,
  at: '2026-10-09T17:00:00+07:00',
  by,
  text: 'Sarah calls.',
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker permissions', () => {
  let t: TestDb;
  let demo: Demo;
  beforeAll(async () => {
    t = await createTestDatabase();
    demo = await seedDemo(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  const as = (key: string) => ({ projectId: demo.projectId, actAs: demo.ids[key] });
  const action = (key: string, num: number, body: Record<string, unknown>) =>
    crAction(t.db, demo.owner, { ...as(key), num, ...body } as Parameters<typeof crAction>[2]);
  const forbidden = { code: 'FORBIDDEN' };

  it('lets only the current editor append, undo, share or mark ready', async () => {
    for (const key of ['lan', 'khoa', 'minh']) {
      await expect(
        appendOp(t.db, demo.owner, { ...as(key), num: 4, expectedRevision: 0, op: rename }),
      ).rejects.toMatchObject(forbidden);
      await expect(
        removeOp(t.db, demo.owner, { ...as(key), num: 4, index: 'last', expectedRevision: 0 }),
      ).rejects.toMatchObject(forbidden);
      await expect(
        action(key, 4, { action: 'share', memberId: demo.ids.quang, permission: 'view' }),
      ).rejects.toMatchObject(forbidden);
      await expect(action(key, 4, { action: 'ready' })).rejects.toMatchObject(forbidden);
    }
    await expect(action('quang', 2, { action: 'unready' })).rejects.toMatchObject(forbidden);
    await expect(action('lan', 4, { action: 'handover', to: demo.ids.khoa })).rejects.toMatchObject(
      forbidden,
    );
    await expect(action('lan', 4, { action: 'decline', who: demo.ids.khoa })).rejects.toMatchObject(
      forbidden,
    );
  });

  it('lets only a member with edit right ask to edit, and not the editor', async () => {
    await expect(action('quang', 4, { action: 'ask' })).rejects.toMatchObject(forbidden);
    await expect(action('ha', 4, { action: 'ask' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('lets only the owner of Main merge, close or request changes', async () => {
    for (const key of ['lan', 'quang', 'ha']) {
      await expect(
        action(key, 2, { action: 'merge', picks: {}, expectedRevision: 0 }),
      ).rejects.toMatchObject(forbidden);
      await expect(action(key, 2, { action: 'close', expectedRevision: 0 })).rejects.toMatchObject(
        forbidden,
      );
      await expect(
        action(key, 2, {
          action: 'request-changes',
          note: 'Please change it.',
          expectedRevision: 0,
        }),
      ).rejects.toMatchObject(forbidden);
    }
    const payload = await getTrackerPayload(t.db, demo.owner, as('minh'));
    expect(payload.crs.find((cr) => cr.num === 2)?.status).toBe('ready');
  });

  it('needs expectedRevision to merge, close or request changes', async () => {
    for (const body of [
      { action: 'merge', picks: {} },
      { action: 'close' },
      { action: 'request-changes', note: 'Please change it.' },
    ])
      await expect(action('minh', 2, body)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('ignores act-as for a person without a member: reads show no member, writes are forbidden', async () => {
    const guest = await workspaceGuest(t.db, demo.owner);
    const asMinh = { projectId: demo.projectId, actAs: demo.ids.minh };
    expect((await getTrackerPayload(t.db, guest, asMinh)).me).toBeNull();
    await expect(createCr(t.db, guest, { ...asMinh, title: 'Not mine' })).rejects.toMatchObject(
      forbidden,
    );
    await expect(
      crAction(t.db, guest, { ...asMinh, num: 2, action: 'merge', picks: {}, expectedRevision: 0 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      appendOp(t.db, guest, {
        projectId: demo.projectId,
        actAs: demo.ids.ha,
        num: 4,
        expectedRevision: 0,
        op: rename,
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      addQueueEntry(t.db, guest, { ...asMinh, kind: 'event', fields: event('sarah') }),
    ).rejects.toMatchObject(forbidden);
    const after = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(after.crs).toHaveLength(4);
    expect(after.crs.find((cr) => cr.num === 2)?.status).toBe('ready');
  });

  it('acts as a member only in a demo project and only for its members', async () => {
    const lan = await getTrackerPayload(t.db, demo.owner, as('lan'));
    expect(lan.me).toMatchObject({ id: demo.ids.lan, name: 'Lan Phạm', userId: null });
    const plain = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(plain.me).toMatchObject({ id: demo.ids.minh, userId: demo.owner.userId });
    await expect(
      getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId, actAs: demo.ids.qe1 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId, actAs: 'not-a-member' }),
    ).rejects.toMatchObject(forbidden);
    const other = await seedDemo(t.db, demo.owner);
    await expect(
      getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId, actAs: other.ids.lan }),
    ).rejects.toMatchObject(forbidden);
    const real = await createEmptyProject(t.db, demo.owner, {
      title: 'Real',
      clientName: 'R',
      teams: ['QA'],
    });
    const realPayload = await getTrackerPayload(t.db, demo.owner, { projectId: real.id });
    await expect(
      getTrackerPayload(t.db, demo.owner, { projectId: real.id, actAs: realPayload.me!.id }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      withTransaction(t.db, (tx) => actingMember(tx, demo.owner, real.id, realPayload.me!.id)),
    ).rejects.toMatchObject(forbidden);
    expect(
      await withTransaction(t.db, (tx) => actingMember(tx, demo.owner, real.id)),
    ).toMatchObject({ id: realPayload.me!.id });
    expect(
      await withTransaction(t.db, (tx) =>
        actingMember(tx, demo.owner, demo.projectId, demo.ids.khoa),
      ),
    ).toMatchObject({ id: demo.ids.khoa, name: 'Khoa Lê' });
  });

  it('lets a person without a member read but not write', async () => {
    const guest = await workspaceGuest(t.db, demo.owner);
    const payload = await getTrackerPayload(t.db, guest, { projectId: demo.projectId });
    expect(payload.me).toBeNull();
    expect(payload.crs).toHaveLength(4);
    await expect(
      createCr(t.db, guest, { projectId: demo.projectId, title: 'Guest CR' }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      addQueueEntry(t.db, guest, {
        projectId: demo.projectId,
        kind: 'event',
        fields: event('sarah'),
      }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      dismissQueueEntry(t.db, guest, { projectId: demo.projectId, queueId: demo.ids.qe1 }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      crAction(t.db, guest, { projectId: demo.projectId, num: 4, action: 'comment', body: 'Hi' }),
    ).rejects.toMatchObject(forbidden);
  });

  it('lets an agent read and add to the Queue as its user member, and nothing else', async () => {
    const agent = agentActor(demo.owner, demo.projectId, ['project:read', 'queue:add']);
    const payload = await getTrackerPayload(t.db, agent, { projectId: demo.projectId });
    expect(payload.me?.id).toBe(demo.ids.minh);
    const added = await addQueueEntry(t.db, agent, {
      projectId: demo.projectId,
      kind: 'event',
      fields: event('sarah'),
    });
    expect(added.queue.events.at(-1)).toMatchObject({ agent: true, addedBy: demo.ids.minh });
    await expect(
      createCr(t.db, agent, { projectId: demo.projectId, title: 'Agent CR' }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      crAction(t.db, agent, { projectId: demo.projectId, num: 4, action: 'comment', body: 'Hi' }),
    ).rejects.toMatchObject(forbidden);
    await expect(
      getTrackerPayload(t.db, agent, { projectId: demo.projectId, actAs: demo.ids.lan }),
    ).rejects.toMatchObject(forbidden);
    const other = await seedDemo(t.db, demo.owner);
    await expect(
      getTrackerPayload(t.db, agent, { projectId: other.projectId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const writer = agentActor(demo.owner, demo.projectId, ['queue:add']);
    await expect(
      getTrackerPayload(t.db, writer, { projectId: demo.projectId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Scope project:read is required' });
  });

  it('hides the tracker of another workspace as NOT_FOUND', async () => {
    const stranger = await testActor(t.db);
    await expect(
      getTrackerPayload(t.db, stranger, { projectId: demo.projectId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createCr(t.db, stranger, { projectId: demo.projectId, title: 'Intruder' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
