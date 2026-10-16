import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { seedDemo } from '../../support/tracker-db';
import {
  trackerCrShares,
  trackerCrs,
  trackerMembers,
  trackerQueue,
} from '../../../src/server/db/schema';

async function pgCode(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      const code = (current as Error & { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    throw error;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('project-scoped references', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.close();
  });
  const setup = async () => {
    const ctx = await testActor(t.db);
    return { ctx, a: await seedDemo(t.db, ctx), b: await seedDemo(t.db, ctx) };
  };
  const queueRow = (workspaceId: string, projectId: string, addedByMember: string | null) => ({
    workspaceId,
    projectId,
    kind: 'event' as const,
    payload: { kind: 'message' as const, at: '2026-10-09T10:00:00+07:00', by: 'sarah', text: 'Hi' },
    addedByMember,
  });

  it('rejects a queue card added by a member of another project', async () => {
    const { ctx, a, b } = await setup();
    expect(
      await pgCode(
        t.db.insert(trackerQueue).values(queueRow(ctx.workspaceId, b.projectId, a.ids.lan)),
      ),
    ).toBe('23503');
    expect(
      await pgCode(
        t.db.insert(trackerQueue).values(queueRow(ctx.workspaceId, a.projectId, a.ids.lan)),
      ),
    ).toBeUndefined();
  });
  it('rejects a share of a change request from another project', async () => {
    const { ctx, a, b } = await setup();
    const [cr] = await t.db
      .select({ id: trackerCrs.id })
      .from(trackerCrs)
      .where(and(eq(trackerCrs.projectId, a.projectId), eq(trackerCrs.num, 4)));
    const share = (projectId: string, memberId: string) => ({
      workspaceId: ctx.workspaceId,
      projectId,
      crId: cr.id,
      memberId,
      permission: 'view' as const,
    });
    expect(await pgCode(t.db.insert(trackerCrShares).values(share(b.projectId, b.ids.lan)))).toBe(
      '23503',
    );
    expect(
      await pgCode(t.db.insert(trackerCrShares).values(share(a.projectId, a.ids.lan))),
    ).toBeUndefined();
  });
  it('rejects a tenant row whose workspace does not own the project', async () => {
    const { a } = await setup();
    const stranger = await testActor(t.db);
    expect(
      await pgCode(
        t.db.insert(trackerMembers).values({
          workspaceId: stranger.workspaceId,
          projectId: a.projectId,
          name: 'Intruder',
          roleLabel: 'None',
          color: '#000000',
        }),
      ),
    ).toBe('23503');
  });
});
