import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentActor, createTestDatabase, testActor, type TestDb } from '../../support/db';
import { createProject, listProjects } from '../../../src/server/domain/projects';
import { requireProject } from '../../../src/server/domain/access';
import { lockProject, toIso, withTransaction } from '../../../src/server/db/tx';
import { graphCommits, workspaceMembers } from '../../../src/server/db/schema';
import { canonicalHash } from '../../../src/lib/canonical-json';
import {
  CommitBaseSchema,
  CommitSchema,
  GraphSnapshotSchema,
  ProjectSchema,
} from '../../../src/contracts';
import { eq } from 'drizzle-orm';

describe.skipIf(!process.env.TEST_DATABASE_URL)('projects', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('creates a project with an initial commit as main head', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'Fund III', clientName: 'Larkspur' });
    const commits = await t.db
      .select()
      .from(graphCommits)
      .where(eq(graphCommits.projectId, project.id));
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      kind: 'initial',
      sequence: 0,
      parentId: null,
      id: project.mainCommitId,
    });
    expect(project.evidenceRevision).toBe(0);
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
  it('stores a valid empty snapshot with its canonical hash and returns contract-valid projects', async () => {
    const ctx = await testActor(t.db);
    const project = await createProject(t.db, ctx, { title: 'Hash', clientName: 'H' });
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(project).toMatchObject({
      workspaceId: ctx.workspaceId,
      title: 'Hash',
      clientName: 'H',
      sourceRouting: [],
    });
    const [commit] = await t.db
      .select()
      .from(graphCommits)
      .where(eq(graphCommits.id, project.mainCommitId));
    expect(GraphSnapshotSchema.safeParse(commit.snapshot).success).toBe(true);
    expect(commit.snapshot.context.timeZone).toBe('Asia/Ho_Chi_Minh');
    expect(commit.snapshotHash).toBe(canonicalHash(commit.snapshot));
    expect(commit.createdAt).toMatch(/\+00$/);
    const contract = Object.fromEntries(
      Object.entries({ ...commit, createdAt: toIso(commit.createdAt) }).filter(
        ([key]) => key in CommitBaseSchema.shape,
      ),
    );
    expect(CommitSchema.parse(contract)).toMatchObject({
      actor: { kind: 'user', userId: ctx.userId },
      reviewedEvidenceRevision: 0,
    });
    expect(await listProjects(t.db, ctx)).toEqual([project]);
  });
  it('creates the initial commit from a supplied snapshot', async () => {
    const ctx = await testActor(t.db);
    const base = await createProject(t.db, ctx, { title: 'Base', clientName: 'B' });
    const [baseCommit] = await t.db
      .select()
      .from(graphCommits)
      .where(eq(graphCommits.id, base.mainCommitId));
    const snapshot = {
      ...baseCommit.snapshot,
      context: { ...baseCommit.snapshot.context, timeZone: 'UTC', replyWindowDays: 3 },
    };
    const project = await createProject(t.db, ctx, { title: 'Seeded', clientName: 'S', snapshot });
    const [commit] = await t.db
      .select()
      .from(graphCommits)
      .where(eq(graphCommits.id, project.mainCommitId));
    expect(commit.snapshot).toEqual(snapshot);
    expect(commit.snapshotHash).toBe(canonicalHash(snapshot));
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
