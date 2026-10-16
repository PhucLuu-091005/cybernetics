import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { createProject, getProject, listProjects } from '../../../src/server/domain/projects';
import {
  findProjectForActor,
  lockProject,
  withTransaction,
  type Db,
} from '../../../src/server/db/tx';
import { projects, workspaceMembers } from '../../../src/server/db/schema';
import { ProjectSchema, type ActorContext } from '../../../src/contracts';
import { eq } from 'drizzle-orm';

const requireProject = (db: Db, ctx: ActorContext, projectId: string) =>
  findProjectForActor(db, ctx, projectId, false);

describe.skipIf(!process.env.TEST_DATABASE_URL)('projects', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates only the project row, with no commit or evidence columns', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'Fund III', clientName: 'Larkspur' });
    const [row] = await t.db.select().from(projects).where(eq(projects.id, project.id));
    expect(Object.keys(row).sort()).toEqual([
      'clientName',
      'createdAt',
      'id',
      'title',
      'workspaceId',
    ]);
    expect(row.createdAt).toMatch(/\+00$/);
  });
  it('hides another workspace project as NOT_FOUND', async () => {
    const owner = await testActor(t.db),
      stranger = await testActor(t.db);
    const project = await createProject(t.db, owner, { title: 'Private', clientName: 'X' });
    await expect(requireProject(t.db, stranger, project.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listProjects(t.db, stranger)).map((item) => item.id)).not.toContain(project.id);
  });
  it('returns contract-valid projects, and reads the default time zone for a project without a tracker', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'Hash', clientName: 'H' });
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(project).toMatchObject({ workspaceId: ctx.workspaceId, title: 'Hash', clientName: 'H' });
    expect(await listProjects(t.db, ctx)).toEqual([project]);
    expect(await getProject(t.db, ctx, { projectId: project.id })).toEqual({
      project,
      timeZone: 'Asia/Ho_Chi_Minh',
      requestId: ctx.requestId,
    });
  });
  it('rejects invalid input and agent callers without writing', async () => {
    const ctx = await testActor(t.db);
    await expect(createProject(t.db, ctx, { title: '', clientName: 'X' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const project = await createProject(t.db, ctx, { title: 'Agent', clientName: 'A' });
    await expect(
      createProject(t.db, agentActor(ctx, project.id, ['project:read']), {
        title: 'No',
        clientName: 'N',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listProjects(t.db, ctx)).map((item) => item.title)).toEqual(['Agent']);
  });
  it('scopes agents to their own project', async () => {
    const ctx = await testActor(t.db);
    const mine = await createProject(t.db, ctx, { title: 'Mine', clientName: 'M' });
    const other = await createProject(t.db, ctx, { title: 'Other', clientName: 'O' });
    const agent = agentActor(ctx, mine.id, ['project:read']);
    expect((await requireProject(t.db, agent, mine.id)).id).toBe(mine.id);
    await expect(requireProject(t.db, agent, other.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listProjects(t.db, agent)).map((item) => item.id)).toEqual([mine.id]);
  });
  it('locks a project only inside the actor workspace', async () => {
    const owner = await testActor(t.db),
      stranger = await testActor(t.db);
    const project = await createProject(t.db, owner, { title: 'Lock', clientName: 'L' });
    expect((await withTransaction(t.db, (tx) => lockProject(tx, owner, project.id))).id).toBe(
      project.id,
    );
    await expect(
      withTransaction(t.db, (tx) => lockProject(tx, stranger, project.id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('lists and resolves projects across every workspace the user belongs to', async () => {
    const owner = await testActor(t.db),
      guest = await testActor(t.db);
    const shared = await createProject(t.db, owner, { title: 'Shared', clientName: 'S' });
    const own = await createProject(t.db, guest, { title: 'Own', clientName: 'O' });
    await t.db
      .insert(workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: guest.userId });
    expect((await listProjects(t.db, guest)).map((item) => item.id).sort()).toEqual(
      [shared.id, own.id].sort(),
    );
    expect(await requireProject(t.db, guest, shared.id)).toMatchObject({
      id: shared.id,
      workspaceId: owner.workspaceId,
    });
    expect(await withTransaction(t.db, (tx) => lockProject(tx, guest, shared.id))).toMatchObject({
      id: shared.id,
      workspaceId: owner.workspaceId,
    });
  });
  it('rejects an agent whose workspace differs from the project workspace', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'W', clientName: 'W' });
    const agent = { ...agentActor(ctx, project.id, ['project:read']), workspaceId: randomUUID() };
    await expect(requireProject(t.db, agent, project.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
