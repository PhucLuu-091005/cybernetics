import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedOnUserCreated } from '../../../src/server/app';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { listProjects } from '../../../src/server/domain/projects';
import { crAction, getTrackerPayload, seedTrackerDemo } from '../../../src/server/tracker';
import {
  LARKSPUR_STORY_NOW,
  LARKSPUR_PROJECT,
  larkspurBase,
  larkspurQueueRows,
  LARKSPUR_TEAM_PEOPLE,
} from '../../../src/server/tracker/seed/larkspur';
import { browserScopes } from '../../../src/server/http/identity-store';
import {
  clashesOf,
  crState,
  mainState,
  queueFromRows,
  type TrackerPayload,
} from '../../../src/tracker';
import { withTransaction } from '../../../src/server/db/tx';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo, type Demo } from '../../support/tracker-db';

const crOf = (payload: TrackerPayload, num: number) => payload.crs.find((cr) => cr.num === num)!;
const sameInstant = (a: string | null, b: string) => a !== null && Date.parse(a) === Date.parse(b);

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker demo seed', () => {
  let t: TestDb;
  let demo: Demo;
  let payload: TrackerPayload;
  beforeAll(async () => {
    t = await createTestDatabase();
    demo = await seedDemo(t.db);
    payload = await getTrackerPayload(t.db, demo.owner, { projectId: demo.projectId });
  });
  afterAll(async () => {
    await t?.close();
  });
  const id = (key: string) => demo.ids[key] ?? key;

  it('stores the Larkspur base, the queue and the pinned clock of the tests', () => {
    expect(payload.project).toMatchObject({
      id: demo.projectId,
      demo: true,
      timeZone: 'Asia/Ho_Chi_Minh',
      windowStart: '2026-09-13',
      leadMemberId: demo.ids.minh,
    });
    expect(sameInstant(payload.project.asOf, LARKSPUR_STORY_NOW)).toBe(true);
    expect(payload.base.teams).toHaveLength(7);
    expect(payload.base.workItems).toHaveLength(15);
    expect(payload.base.milestones).toHaveLength(2);
    // The project's team list replaces the story leads with the members who lead each team.
    const base = larkspurBase(id);
    expect(payload.base).toEqual({
      ...base,
      teams: base.teams.map((team) => ({
        ...team,
        leadId: LARKSPUR_TEAM_PEOPLE[team.id]?.lead
          ? id(LARKSPUR_TEAM_PEOPLE[team.id].lead!)
          : null,
      })),
    });
    expect(payload.queue.events).toHaveLength(4);
    expect(payload.queue.items).toHaveLength(2);
    const expected = queueFromRows(larkspurQueueRows(id));
    const byId = <T extends { id: string; createdAt: string }>(list: T[]) =>
      [...list]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => ({ ...entry, createdAt: Date.parse(entry.createdAt) }));
    expect(byId(payload.queue.events)).toEqual(byId(expected.events));
    expect(byId(payload.queue.items)).toEqual(byId(expected.items));
  });

  it('has the five demo members, with Minh as the project lead linked to the user', () => {
    expect(
      payload.members.map(({ name, roleLabel, color }) => ({ name, roleLabel, color })),
    ).toEqual([
      { name: 'Minh Trần', roleLabel: 'Project lead', color: '#0f766e' },
      { name: 'Lan Phạm', roleLabel: 'Digitization lead', color: '#7c3aed' },
      { name: 'Quang Nguyễn', roleLabel: 'Engineering lead', color: '#2563eb' },
      { name: 'Hà Đỗ', roleLabel: 'QA analyst', color: '#db2777' },
      { name: 'Khoa Lê', roleLabel: 'Solutions engineer', color: '#d97706' },
    ]);
    expect(payload.members.map((member) => member.userId)).toEqual([
      demo.owner.userId,
      null,
      null,
      null,
      null,
    ]);
    expect(payload.me?.id).toBe(demo.ids.minh);
    for (const key of ['minh', 'lan', 'quang', 'ha', 'khoa'])
      expect(payload.base.people.find((person) => person.id === demo.ids[key])).toBeDefined();
  });

  it('has history rev 1 from #1 and a Main that replays without a skipped change', () => {
    expect(payload.commits).toHaveLength(1);
    const [commit] = payload.commits;
    expect(commit).toMatchObject({
      rev: 1,
      crNum: 1,
      crId: crOf(payload, 1).id,
      mergedBy: demo.ids.minh,
      resolutions: [],
    });
    expect(sameInstant(commit.mergedAt, '2026-10-08T17:30:00+07:00')).toBe(true);
    expect(commit.ops.map((op) => [op.op, op.rev, op.by])).toEqual([
      ['attach', 0, demo.ids.minh],
      ['msDate', 0, demo.ids.minh],
    ]);
    expect(commit.ops[1].d).toMatchObject({
      item: 'Go-live and first close',
      before: 'planned 30 Sept',
      after: 'planned 15 Oct',
      why: 'The CRS section is not ready. Sarah agreed on 26 September.',
    });
    const main = mainState(payload.base, payload.queue, payload.commits);
    expect(main.milestones.find((m) => m.id === 'golive')?.planned).toBe('2026-10-15');
    expect(main.events.find((e) => e.id === demo.ids.qe3)?.workItemId).toBe('golive');
    expect(main.queue.events).toHaveLength(3);
    expect(crOf(payload, 1)).toMatchObject({
      title: 'Explain the go-live slip',
      author: demo.ids.minh,
      status: 'merged',
      mergedRev: 1,
      mergedBy: demo.ids.minh,
    });
    expect(crOf(payload, 1).comments.map((c) => c.kind)).toEqual(['created', 'ready', 'merged']);
  });

  it('has #2 and #3 ready, which clash on the PG-203 name after #2 merges', async () => {
    expect(crOf(payload, 2)).toMatchObject({
      title: 'Place PG-204 in Engineering',
      author: demo.ids.lan,
      editor: demo.ids.lan,
      status: 'ready',
    });
    expect(crOf(payload, 3)).toMatchObject({
      title: 'PG-203 is on staging',
      author: demo.ids.quang,
      status: 'ready',
    });
    for (const num of [2, 3]) {
      const cr = crOf(payload, num);
      expect(cr.ops.every((op) => op.rev === 1 && op.by === cr.author && op.d)).toBe(true);
      expect(cr.comments.map((c) => c.kind)).toEqual(['created', 'ready']);
      expect(crState(payload.base, payload.queue, payload.commits, cr).entries).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ skipped: true })]),
      );
    }
    expect(clashesOf(crOf(payload, 3).ops, payload.commits)).toEqual([]);
    const merged = await crAction(t.db, demo.owner, {
      projectId: demo.projectId,
      num: 2,
      action: 'merge',
      picks: {},
      expectedRevision: crOf(payload, 2).revision,
    });
    expect(clashesOf(crOf(merged, 3).ops, merged.commits).map((clash) => clash.key)).toEqual([
      'loop:pg203:title',
    ]);
  });

  it('has #4 as a draft by Hà, shared with Khoa who can edit', () => {
    const four = crOf(payload, 4);
    expect(four).toMatchObject({
      title: 'Test plan for the CRS section',
      author: demo.ids.ha,
      editor: demo.ids.ha,
      status: 'draft',
      shares: [{ memberId: demo.ids.khoa, permission: 'edit' }],
      asks: [],
    });
    expect(four.ops).toEqual([
      expect.objectContaining({
        op: 'attach',
        a: { eventId: demo.ids.qe4, workItemId: 'test' },
        rev: 1,
        by: demo.ids.ha,
      }),
    ]);
    expect(four.comments.map(({ kind, body, memberId }) => ({ kind, body, memberId }))).toEqual([
      { kind: 'created', body: null, memberId: demo.ids.ha },
      { kind: 'shared', body: 'Khoa Lê can edit.', memberId: demo.ids.ha },
    ]);
  });

  it('moves a copy made at a later moment by whole days and gives it no fixed clock', async () => {
    const owner = await testActor(t.db, { name: 'Later User' });
    const made = new Date('2026-11-02T08:00:00+07:00');
    const { projectId, ids } = await withTransaction(t.db, (tx) =>
      seedTrackerDemo(tx, { workspaceId: owner.workspaceId, userId: owner.userId, now: made }),
    );
    const copy = await getTrackerPayload(t.db, owner, { projectId });
    // The story's now (9 Oct 18:00) lands on 1 Nov 18:00, the evening before the copy: 23 days later.
    expect(copy.project).toMatchObject({ asOf: null, windowStart: '2026-10-06' });
    const g2 = copy.base.events.find((e) => e.id === 'g2')!;
    expect(sameInstant(g2.at, '2026-10-08T10:45:00+07:00')).toBe(true);
    expect(g2.text).toBe('Go-live is set for 23 October.');
    expect(copy.base.workItems.find((w) => w.id === 'test')?.plannedFinish).toBe('2026-11-06');
    const merged = copy.commits[0];
    expect(sameInstant(merged.mergedAt, '2026-10-31T17:30:00+07:00')).toBe(true);
    expect(merged.ops[1].d).toMatchObject({ before: 'planned 23 Oct', after: 'planned 7 Nov' });
    const qe1 = copy.queue.events.find((e) => e.id === ids.qe1)!;
    expect(sameInstant(qe1.createdAt, '2026-11-01T14:20:00+07:00')).toBe(true);
  });

  it('seeds one sandbox project, the tracker demo, on first sign-in', async () => {
    const store = new DbIdentityStore(t.db, { onUserCreated: seedOnUserCreated });
    const { userId } = await store.provisionUser({
      subject: `google:seed-${Date.now()}`,
      email: null,
      name: 'Thảo Võ',
    });
    const session = await store.resolveSessionUser(userId);
    const ctx = {
      kind: 'user' as const,
      userId,
      workspaceId: session!.defaultWorkspaceId,
      projectId: null,
      scopes: [...browserScopes],
      requestId: 'seed-test',
    };
    const [sandbox, ...others] = await listProjects(t.db, ctx);
    expect(others).toEqual([]);
    expect(sandbox).toEqual({
      id: expect.any(String),
      workspaceId: ctx.workspaceId,
      ...LARKSPUR_PROJECT,
    });
    const seeded = await getTrackerPayload(t.db, ctx, { projectId: sandbox.id });
    expect(seeded.project).toMatchObject({ demo: true, title: sandbox.title, asOf: null });
    const latest = Math.max(...seeded.base.events.map((e) => Date.parse(e.at)));
    expect(latest).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - latest).toBeLessThan(10 * 86_400_000);
    expect(seeded.me).toMatchObject({ name: 'Minh Trần', userId });
    expect(seeded.crs.map((cr) => [cr.num, cr.status])).toEqual([
      [1, 'merged'],
      [2, 'ready'],
      [3, 'ready'],
      [4, 'draft'],
    ]);
  });
});
