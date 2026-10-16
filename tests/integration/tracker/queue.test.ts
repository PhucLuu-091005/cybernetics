import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { trackerQueue } from '../../../src/server/db/schema';
import { createEmptyProject } from '../../../src/server/domain/projects';
import { addQueueEntry, dismissQueueEntry, getTrackerPayload } from '../../../src/server/tracker';
import { mainState } from '../../../src/tracker';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, workspaceGuest } from '../../support/tracker-db';

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker queue', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });

  const project = async () => {
    const ctx = await testActor(t.db, { name: 'Owner' });
    const created = await createEmptyProject(t.db, ctx, {
      title: 'Queue',
      clientName: 'Q',
      teams: ['Engineering'],
      milestone: { name: 'Launch', date: '2026-11-02' },
    });
    const payload = await getTrackerPayload(t.db, ctx, { projectId: created.id });
    return { ctx, projectId: created.id, me: payload.me!, payload };
  };

  it('adds an event and a work item that wait in the payload queue', async () => {
    const { ctx, projectId, me, payload: before } = await project();
    const afterEvent = await addQueueEntry(t.db, ctx, {
      projectId,
      kind: 'event',
      fields: {
        kind: 'message',
        at: '2026-10-16T09:30:00+07:00',
        by: me.id,
        text: 'Sarah asks for the root cause report.',
      },
    });
    expect(afterEvent.queue.events).toEqual([
      {
        id: expect.any(String),
        kind: 'message',
        at: '2026-10-16T09:30:00+07:00',
        by: me.id,
        text: 'Sarah asks for the root cause report.',
        addedBy: me.id,
        agent: false,
        createdAt: expect.any(String),
      },
    ]);
    const afterItem = await addQueueEntry(t.db, ctx, {
      projectId,
      kind: 'item',
      fields: {
        title: 'Root cause report',
        doneBy: me.id,
        requestedBy: me.id,
        milestoneId: before.base.milestones[0].id,
        plannedFinish: '2026-10-20',
      },
    });
    expect(afterItem.queue.items).toEqual([
      {
        id: expect.any(String),
        title: 'Root cause report',
        note: '',
        doneBy: me.id,
        requestedBy: me.id,
        milestoneId: before.base.milestones[0].id,
        after: null,
        plannedFinish: '2026-10-20',
        addedBy: me.id,
        agent: false,
        createdAt: expect.any(String),
      },
    ]);
    expect(afterItem.queue.events).toHaveLength(1);
    const main = mainState(afterItem.base, afterItem.queue, afterItem.commits);
    expect(main.queue.items.map((item) => item.title)).toEqual(['Root cause report']);
  });

  it('dismiss hides the card from the payload queue', async () => {
    const { ctx, projectId, me } = await project();
    const added = await addQueueEntry(t.db, ctx, {
      projectId,
      kind: 'event',
      fields: { kind: 'task', at: '2026-10-16T10:00:00+07:00', by: me.id, text: 'Spam' },
    });
    const queueId = added.queue.events[0].id;
    const payload = await dismissQueueEntry(t.db, ctx, { projectId, queueId });
    expect(payload.queue.events).toEqual([]);
    const [row] = await t.db.select().from(trackerQueue).where(eq(trackerQueue.id, queueId));
    expect(row.dismissedAt).not.toBeNull();
    await expect(dismissQueueEntry(t.db, ctx, { projectId, queueId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('marks a card from an agent token with added_by_agent and the token user member', async () => {
    const { ctx, projectId, me } = await project();
    const reader = agentActor(ctx, projectId, ['project:read']);
    const fields = {
      kind: 'message' as const,
      at: '2026-10-16T11:00:00+07:00',
      by: me.id,
      text: 'From the agent.',
    };
    await expect(
      addQueueEntry(t.db, reader, { projectId, kind: 'event', fields }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Scope queue:add is required' });
    const agent = agentActor(ctx, projectId, ['project:read', 'queue:add']);
    const payload = await addQueueEntry(t.db, agent, {
      projectId,
      kind: 'event',
      fields: {
        kind: 'message',
        at: '2026-10-16T11:00:00+07:00',
        by: me.id,
        text: 'From the agent.',
      },
    });
    expect(payload.queue.events[0]).toMatchObject({ agent: true, addedBy: me.id });
    const [row] = await t.db
      .select()
      .from(trackerQueue)
      .where(eq(trackerQueue.id, payload.queue.events[0].id));
    expect(row).toMatchObject({ addedByAgent: true, addedByMember: me.id, kind: 'event' });
  });

  it('rejects fields that do not fit the project', async () => {
    const { ctx, projectId, me } = await project();
    const event = {
      kind: 'message' as const,
      at: '2026-10-16T11:00:00+07:00',
      by: me.id,
      text: 'Hi',
    };
    await expect(
      addQueueEntry(t.db, ctx, { projectId, kind: 'event', fields: { ...event, text: '  ' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      addQueueEntry(t.db, ctx, { projectId, kind: 'event', fields: { ...event, by: 'nobody' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      addQueueEntry(t.db, ctx, {
        projectId,
        kind: 'event',
        fields: { ...event, at: '2026-10-16 11:00' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const item = {
      title: 'X',
      doneBy: me.id,
      requestedBy: me.id,
      plannedFinish: '2026-10-20',
    };
    await expect(
      addQueueEntry(t.db, ctx, {
        projectId,
        kind: 'item',
        fields: { ...item, milestoneId: 'missing' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      addQueueEntry(t.db, ctx, { projectId, kind: 'item', fields: { ...item, after: 'missing' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      addQueueEntry(t.db, ctx, { projectId, kind: 'note', fields: item } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('keeps a card that merged Main used: dismiss is a CONFLICT and Main hides the card', async () => {
    const demo = await seedDemo(t.db);
    await expect(
      dismissQueueEntry(t.db, demo.owner, { projectId: demo.projectId, queueId: demo.ids.qe3 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const payload = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
    expect(payload.queue.events.map((event) => event.id)).toContain(demo.ids.qe3);
    const main = mainState(payload.base, payload.queue, payload.commits);
    expect(main.queue.events.map((event) => event.id)).not.toContain(demo.ids.qe3);
    expect(main.events.find((event) => event.id === demo.ids.qe3)?.workItemId).toBe('golive');
  });

  it('lets any member dismiss, and no one without a member or an agent', async () => {
    const demo = await seedDemo(t.db);
    const guest = await workspaceGuest(t.db, demo.owner);
    await expect(
      dismissQueueEntry(t.db, guest, { projectId: demo.projectId, queueId: demo.ids.qe1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const agent = agentActor(demo.owner, demo.projectId, ['project:read']);
    await expect(
      dismissQueueEntry(t.db, agent, { projectId: demo.projectId, queueId: demo.ids.qe1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const payload = await dismissQueueEntry(t.db, demo.owner, {
      projectId: demo.projectId,
      queueId: demo.ids.qe1,
      actAs: demo.ids.khoa,
    });
    expect(payload.queue.events.map((event) => event.id)).not.toContain(demo.ids.qe1);
  });
});
