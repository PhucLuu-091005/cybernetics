import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdSchema } from '../../../src/contracts';
import { trackerMembers, trackerProjects } from '../../../src/server/db/schema';
import {
  createEmptyProject,
  createProject,
  listProjects,
} from '../../../src/server/domain/projects';
import { getTrackerPayload } from '../../../src/server/tracker';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';

describe.skipIf(!process.env.TEST_DATABASE_URL)('tracker projects', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates a tracker project with the teams, the first milestone and an owner member linked to the user', async () => {
    const ctx = await testActor(t.db, { name: 'Ngọc Anh' });
    const project = await createEmptyProject(t.db, ctx, {
      title: 'Fund IV onboarding',
      clientName: 'Larkspur Capital',
      teams: ['Implementation', ' Engineering ', '', 'QA'],
      milestone: { name: 'Go-live', date: '2026-11-02' },
    });
    const payload = await getTrackerPayload(t.db, ctx, { projectId: project.id });
    expect(payload.project).toEqual({
      id: project.id,
      title: 'Fund IV onboarding',
      clientName: 'Larkspur Capital',
      timeZone: 'Asia/Ho_Chi_Minh',
      windowStart: null,
      asOf: null,
      demo: false,
      ownerMemberId: payload.members[0].id,
    });
    expect(payload.members).toEqual([
      {
        id: expect.any(String),
        name: 'Ngọc Anh',
        roleLabel: 'Project owner, owns Main',
        color: '#0f766e',
        userId: ctx.userId,
      },
    ]);
    expect(payload.me).toEqual(payload.members[0]);
    expect(payload.base.teams.map((team) => team.name)).toEqual([
      'Implementation',
      'Engineering',
      'QA',
    ]);
    for (const team of payload.base.teams) {
      expect(IdSchema.safeParse(team.id).success).toBe(true);
      expect(team.leadId).toBeNull();
    }
    expect(payload.base.milestones).toEqual([
      {
        id: expect.any(String),
        name: 'Go-live',
        planned: '2026-11-02',
        firstPlanned: '2026-11-02',
        moves: [],
      },
    ]);
    expect(payload.base.people).toEqual([{ id: payload.members[0].id, name: 'Ngọc Anh' }]);
    expect(payload.base.workItems).toEqual([]);
    expect(payload.base.events).toEqual([]);
    expect(payload.queue).toEqual({ events: [], items: [] });
    expect(payload.commits).toEqual([]);
    expect(payload.crs).toEqual([]);
    const [row] = await t.db
      .select()
      .from(trackerProjects)
      .where(eq(trackerProjects.projectId, project.id));
    expect(row.ownerMemberId).toBe(payload.members[0].id);
  });

  it('creates a project without teams or a milestone', async () => {
    const ctx = await testActor(t.db);
    const project = await createEmptyProject(t.db, ctx, { title: 'Bare', clientName: 'B' });
    const payload = await getTrackerPayload(t.db, ctx, { projectId: project.id });
    expect(payload.base.teams).toEqual([]);
    expect(payload.base.milestones).toEqual([]);
    expect(payload.me?.userId).toBe(ctx.userId);
  });

  it('rejects duplicate team names and creates nothing', async () => {
    const ctx = await testActor(t.db);
    await expect(
      createEmptyProject(t.db, ctx, {
        title: 'Twice',
        clientName: 'T',
        teams: ['QA', 'Engineering', 'qa'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await listProjects(t.db, ctx)).toEqual([]);
    const members = await t.db
      .select()
      .from(trackerMembers)
      .where(eq(trackerMembers.userId, ctx.userId));
    expect(members).toEqual([]);
  });

  it('rejects a milestone without a valid date', async () => {
    const ctx = await testActor(t.db);
    await expect(
      createEmptyProject(t.db, ctx, {
        title: 'Dates',
        clientName: 'D',
        milestone: { name: 'Go-live', date: '2 November' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('reads a project without a tracker as NOT_FOUND with a clear message', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'Old', clientName: 'O' });
    await expect(getTrackerPayload(t.db, ctx, { projectId: project.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This project has no tracker yet',
    });
  });

  it('hides another workspace tracker as NOT_FOUND', async () => {
    const owner = await testActor(t.db),
      stranger = await testActor(t.db);
    const project = await createEmptyProject(t.db, owner, {
      title: 'Private',
      clientName: 'X',
      teams: ['QA'],
    });
    await expect(
      getTrackerPayload(t.db, stranger, { projectId: project.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Project not found' });
  });
});
