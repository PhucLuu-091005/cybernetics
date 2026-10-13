import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { createProject } from '../../../src/server/domain/projects';
import { graphCommits, projects, records, recordVersions } from '../../../src/server/db/schema';

async function pgCode(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try { await promise; return undefined; }
  catch (error) {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      const code = (current as Error & { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    throw error;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('project-scoped references', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDatabase(); });
  afterAll(async () => { await t?.close(); });
  const setup = async () => {
    const ctx = await testActor(t.db);
    const a = await createProject(t.db, ctx, { title: 'A', clientName: 'A' }), b = await createProject(t.db, ctx, { title: 'B', clientName: 'B' });
    return { ctx, a, b };
  };
  const version = (workspaceId: string, projectId: string, recordId: string, userId: string) => ({
    workspaceId, projectId, recordId, versionNo: 1, digest: 'a'.repeat(64), source: 'paste' as const, sourceLabel: 'Paste', title: 'T', bodyText: 'Body', searchText: 't\nbody', searchTitle: 't',
    occurredAt: '2026-10-13T00:00:00.000Z', timePrecision: 'instant' as const, author: { name: 'Ada' }, recipients: [], quotedRanges: [], attachmentNames: [],
    provenance: { actor: { kind: 'user' as const, userId }, importedAt: '2026-10-13T00:00:00.000Z' }, evidenceRevision: 1,
  });

  it('rejects a record version whose record belongs to another project', async () => {
    const { ctx, a, b } = await setup();
    const [record] = await t.db.insert(records).values({ workspaceId: ctx.workspaceId, projectId: a.id, source: 'paste' }).returning();
    expect(await pgCode(t.db.insert(recordVersions).values(version(ctx.workspaceId, b.id, record.id, ctx.userId)))).toBe('23503');
    expect(await pgCode(t.db.insert(recordVersions).values(version(ctx.workspaceId, a.id, record.id, ctx.userId)))).toBeUndefined();
  });
  it('rejects a commit parent from another project', async () => {
    const { ctx, a, b } = await setup();
    const [base] = await t.db.select().from(graphCommits).where(eq(graphCommits.id, a.mainCommitId));
    const commit = (projectId: string) => ({ workspaceId: ctx.workspaceId, projectId, sequence: 1, parentId: a.mainCommitId, snapshot: base.snapshot, snapshotHash: base.snapshotHash, actor: base.actor, message: 'm', kind: 'merge' as const, reviewedEvidenceRevision: 0 });
    expect(await pgCode(t.db.insert(graphCommits).values(commit(b.id)))).toBe('23503');
    expect(await pgCode(t.db.insert(graphCommits).values(commit(a.id)))).toBeUndefined();
  });
  it('rejects a main commit pointer and a current version from another project', async () => {
    const { ctx, a, b } = await setup();
    expect(await pgCode(t.db.update(projects).set({ mainCommitId: a.mainCommitId }).where(eq(projects.id, b.id)))).toBe('23503');
    const [recordA] = await t.db.insert(records).values({ workspaceId: ctx.workspaceId, projectId: a.id, source: 'paste' }).returning();
    const [recordB] = await t.db.insert(records).values({ workspaceId: ctx.workspaceId, projectId: b.id, source: 'paste' }).returning();
    const [versionA] = await t.db.insert(recordVersions).values(version(ctx.workspaceId, a.id, recordA.id, ctx.userId)).returning();
    expect(await pgCode(t.db.update(records).set({ currentVersionId: versionA.id }).where(eq(records.id, recordB.id)))).toBe('23503');
  });
  it('rejects a tenant row whose workspace does not own the project', async () => {
    const { a } = await setup();
    const stranger = await testActor(t.db);
    expect(await pgCode(t.db.insert(records).values({ workspaceId: stranger.workspaceId, projectId: a.id, source: 'paste' }))).toBe('23503');
  });
});
