import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, testActor, type TestDb } from '../../support/db';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { createProject } from '../../../src/server/domain/projects';
import { users, workspaceMembers, workspaces } from '../../../src/server/db/schema';
import { AgentTokenSchema } from '../../../src/contracts';
import type { StoredToken } from '../../../src/server/http/identity-store';

describe.skipIf(!process.env.TEST_DATABASE_URL)('DbIdentityStore', () => {
  let t: TestDb, store: DbIdentityStore;
  beforeAll(async () => {
    t = await createTestDatabase();
    store = new DbIdentityStore(t.db);
  });
  afterAll(async () => {
    await t?.close();
  });
  const profile = () => ({
    subject: `google:${randomUUID()}`,
    email: 'ada@example.com',
    name: 'Ada',
  });
  const counts = async (subject: string) => {
    const rows = await t.db
      .select({ userId: users.id, workspaceId: workspaceMembers.workspaceId })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(users.subject, subject));
    const owned = rows.length
      ? await t.db
          .select({ count: sql<number>`count(*)::int` })
          .from(workspaces)
          .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
          .where(eq(workspaceMembers.userId, rows[0].userId))
      : [{ count: 0 }];
    return {
      users: new Set(rows.map((row) => row.userId)).size,
      memberships: rows.length,
      workspaces: owned[0].count,
    };
  };
  const token = (
    overrides: Partial<StoredToken> & Pick<StoredToken, 'userId' | 'projectId' | 'workspaceId'>,
  ): StoredToken => ({
    id: randomUUID(),
    prefix: 'inv_abcd',
    scopes: ['project:read', 'queue:add'],
    createdAt: '2026-10-13T10:00:00.000Z',
    expiresAt: '2026-11-12T10:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    hash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    label: 'Codex',
    idempotencyKey: randomUUID(),
    requestDigest: 'd'.repeat(64),
    ...overrides,
  });

  it('provisions a user once per subject with one personal workspace and membership', async () => {
    const input = profile();
    const first = await store.provisionUser(input),
      second = await store.provisionUser(input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ userId: first.userId, created: false });
    expect(await counts(input.subject)).toEqual({ users: 1, memberships: 1, workspaces: 1 });
    const session = await store.resolveSessionUser(first.userId);
    expect(session?.userId).toBe(first.userId);
    expect(await store.resolveMembership(first.userId, session!.defaultWorkspaceId)).toEqual({
      userId: first.userId,
      workspaceId: session!.defaultWorkspaceId,
    });
    const [row] = await t.db.select().from(users).where(eq(users.id, first.userId));
    expect(row).toMatchObject({ subject: input.subject, email: 'ada@example.com', name: 'Ada' });
  });
  it('provisions safely under two concurrent first sign-ins for the same subject', async () => {
    const input = profile();
    const results = await Promise.all([store.provisionUser(input), store.provisionUser(input)]);
    expect(new Set(results.map((result) => result.userId)).size).toBe(1);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await counts(input.subject)).toEqual({ users: 1, memberships: 1, workspaces: 1 });
  });
  it('provisions one user when a slow first sign-in overlaps a second one', async () => {
    const calls: string[] = [];
    const slow = new DbIdentityStore(t.db, {
      onUserCreated: async (_tx, ctx) => {
        calls.push(ctx.userId);
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    });
    const input = profile();
    const results = await Promise.all([slow.provisionUser(input), slow.provisionUser(input)]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.userId))).toEqual(new Set(calls));
    expect(await counts(input.subject)).toEqual({ users: 1, memberships: 1, workspaces: 1 });
  });
  it('runs the user-created hook once inside the provisioning transaction', async () => {
    const calls: { userId: string; workspaceId: string }[] = [];
    const hooked = new DbIdentityStore(t.db, {
      onUserCreated: async (_tx, ctx) => {
        calls.push(ctx);
      },
    });
    const input = profile();
    const { userId } = await hooked.provisionUser(input);
    await hooked.provisionUser(input);
    expect(calls).toEqual([
      { userId, workspaceId: (await hooked.resolveSessionUser(userId))!.defaultWorkspaceId },
    ]);
    const failing = new DbIdentityStore(t.db, {
      onUserCreated: async () => {
        throw new Error('seed failed');
      },
    });
    const rolledBack = profile();
    await expect(failing.provisionUser(rolledBack)).rejects.toThrow('seed failed');
    expect(await counts(rolledBack.subject)).toEqual({ users: 0, memberships: 0, workspaces: 0 });
  });
  it('returns null for unknown sessions and non-member lookups', async () => {
    expect(await store.resolveSessionUser(randomUUID())).toBeNull();
    const owner = await testActor(t.db),
      stranger = await testActor(t.db);
    const project = await createProject(t.db, owner, { title: 'P', clientName: 'C' });
    expect(await store.resolveProject(owner.userId, project.id)).toEqual({
      workspaceId: owner.workspaceId,
      projectId: project.id,
    });
    expect(await store.resolveProject(stranger.userId, project.id)).toBeNull();
    expect(await store.resolveProject(owner.userId, randomUUID())).toBeNull();
    expect(await store.resolveMembership(stranger.userId, owner.workspaceId)).toBeNull();
  });
  it('stores tokens by hash, conflicts on a reused creation key and keeps the first revocation time', async () => {
    const owner = await testActor(t.db);
    const project = await createProject(t.db, owner, { title: 'T', clientName: 'C' });
    const stored = token({
      userId: owner.userId,
      projectId: project.id,
      workspaceId: owner.workspaceId,
    });
    await store.insertToken(stored);
    const found = await store.getTokenByHash(stored.hash);
    expect(found).toEqual(stored);
    expect(found).toMatchObject({
      workspaceId: owner.workspaceId,
      scopes: ['project:read', 'queue:add'],
    });
    const contract = Object.fromEntries(
      Object.entries(found!).filter(([key]) => key in AgentTokenSchema.shape),
    );
    expect(AgentTokenSchema.parse(contract)).toEqual(contract);
    expect(await store.getTokenByHash('f'.repeat(64))).toBeNull();
    await expect(
      store.insertToken(
        token({
          userId: owner.userId,
          projectId: project.id,
          workspaceId: owner.workspaceId,
          idempotencyKey: stored.idempotencyKey,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const revoke = {
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: project.id,
      tokenId: stored.id,
      idempotencyKey: 'r1',
    };
    expect(await store.revokeToken({ ...revoke, revokedAt: '2026-10-14T00:00:00.000Z' })).toBe(
      '2026-10-14T00:00:00.000Z',
    );
    expect(await store.revokeToken({ ...revoke, revokedAt: '2026-10-15T00:00:00.000Z' })).toBe(
      '2026-10-14T00:00:00.000Z',
    );
    expect((await store.getTokenByHash(stored.hash))?.revokedAt).toBe('2026-10-14T00:00:00.000Z');
    const stranger = await testActor(t.db);
    expect(
      await store.revokeToken({
        ...revoke,
        userId: stranger.userId,
        revokedAt: '2026-10-16T00:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      await store.revokeToken({
        ...revoke,
        tokenId: randomUUID(),
        revokedAt: '2026-10-16T00:00:00.000Z',
      }),
    ).toBeNull();
  });
  it('touchToken sets lastUsedAt and listTokens returns it', async () => {
    const owner = await testActor(t.db);
    const project = await createProject(t.db, owner, { title: 'Touch', clientName: 'C' });
    const stored = token({
      userId: owner.userId,
      projectId: project.id,
      workspaceId: owner.workspaceId,
    });
    await store.insertToken(stored);
    expect((await store.getTokenByHash(stored.hash))!.lastUsedAt).toBeNull();
    const at = '2026-10-15T16:10:00.000Z';
    await store.touchToken(stored.id, at);
    expect((await store.getTokenByHash(stored.hash))!.lastUsedAt).toBe(at);
    const [listed] = await store.listTokens({
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      projectId: project.id,
      offset: 0,
      limit: 10,
    });
    expect(listed.lastUsedAt).toBe(at);
  });
  it('migration 0002 leaves no escalation table, and its SQL removes escalations:write from stored tokens', async () => {
    const { rows } = await t.db.execute(
      sql`SELECT tablename FROM pg_tables WHERE tablename LIKE 'escalation%'`,
    );
    expect(rows).toEqual([]);
    const migration = readFileSync(
      join(process.cwd(), 'src/server/db/migrations/0002_remove_escalations.sql'),
      'utf8',
    );
    expect(migration).toContain(`array_remove("scopes", 'escalations:write')`);
  });
  it('keeps the session default workspace stable after joining another workspace', async () => {
    const owner = await testActor(t.db),
      guest = await testActor(t.db);
    await t.db
      .insert(workspaceMembers)
      .values({ workspaceId: owner.workspaceId, userId: guest.userId });
    expect((await store.resolveSessionUser(guest.userId))?.defaultWorkspaceId).toBe(
      guest.workspaceId,
    );
    expect(await store.resolveMembership(guest.userId, owner.workspaceId)).toEqual({
      userId: guest.userId,
      workspaceId: owner.workspaceId,
    });
    const rows = await t.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, guest.userId));
    expect(rows).toHaveLength(2);
  });
});
