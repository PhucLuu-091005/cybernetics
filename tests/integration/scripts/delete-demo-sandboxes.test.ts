import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedOnUserCreated } from '../../../src/server/app';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { users, workspaceMembers } from '../../../src/server/db/schema';
import { createTestDatabase, type TestDb } from '../../support/db';

const script = join(process.cwd(), 'scripts/delete-demo-sandboxes.mjs');

describe.skipIf(!process.env.TEST_DATABASE_URL)('scripts/delete-demo-sandboxes.mjs', () => {
  let t: TestDb;
  const people: Record<'oldDemo' | 'newDemo' | 'oldGoogle', { userId: string; ws: string }> =
    {} as never;
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DATABASE_URL: t.url },
    });
  const tenantRows = async (ws: string) => {
    const { rows } = await t.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id'`,
    );
    let total = 0;
    for (const { table_name } of rows)
      total += (
        await t.db.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table_name)} where workspace_id = ${ws}`,
        )
      ).rows[0].n;
    return total;
  };

  beforeAll(async () => {
    t = await createTestDatabase();
    const store = new DbIdentityStore(t.db, { onUserCreated: seedOnUserCreated });
    for (const [key, subject] of [
      ['oldDemo', `demo:${randomUUID()}`],
      ['newDemo', `demo:${randomUUID()}`],
      ['oldGoogle', `google:${randomUUID()}`],
    ] as const) {
      const { userId } = await store.provisionUser({ subject, email: null, name: key });
      const [{ ws }] = await t.db
        .select({ ws: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, userId));
      people[key] = { userId, ws };
    }
    for (const key of ['oldDemo', 'oldGoogle'] as const)
      await t.db
        .update(users)
        .set({ createdAt: sql`now() - interval '40 days'` })
        .where(eq(users.id, people[key].userId));
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  it('counts without --apply and deletes nothing', async () => {
    const dry = run('--days', '30');
    expect(dry.stderr).toBe('');
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout)).toEqual({
      event: 'demo_sandboxes',
      days: 30,
      people: 1,
      workspaces: 1,
      deleted: false,
    });
    expect(await tenantRows(people.oldDemo.ws)).toBeGreaterThan(30);
  });

  it('with --apply deletes only the old demo copies, every row of them', async () => {
    const applied = run('--days', '30', '--apply');
    expect(applied.status).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ people: 1, workspaces: 1, deleted: true });
    expect(await tenantRows(people.oldDemo.ws)).toBe(0);
    const left = await t.db.select({ id: users.id }).from(users);
    expect(left.map((u) => u.id).sort()).toEqual(
      [people.newDemo.userId, people.oldGoogle.userId].sort(),
    );
    expect(await tenantRows(people.newDemo.ws)).toBeGreaterThan(30);
    expect(await tenantRows(people.oldGoogle.ws)).toBeGreaterThan(30);
  });

  it('refuses a wrong --days', () => {
    for (const args of [['--days'], ['--days', '0'], ['--days', 'x']]) {
      const bad = run(...args);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain('--days');
    }
  });
});
