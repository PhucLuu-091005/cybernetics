import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedOnUserCreated } from '../../../src/server/app';
import { DbIdentityStore } from '../../../src/server/db/identity-store';
import { agentTokens, users, workspaceMembers } from '../../../src/server/db/schema';
import { createTestDatabase, type TestDb } from '../../support/db';

const script = join(process.cwd(), 'scripts/delete-demo-sandboxes.mjs');

describe.skipIf(!process.env.TEST_DATABASE_URL)('scripts/delete-demo-sandboxes.mjs', () => {
  let t: TestDb;
  const people: Record<'oldDemo' | 'newDemo' | 'oldGoogle', { userId: string; ws: string }> =
    {} as never;
  const photoDir = mkdtempSync(join(tmpdir(), 'pg-demo-photos-'));
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', DATABASE_URL: t.url, ...env },
    });
  const local = { AVATAR_STORE: 'local', AVATAR_DIR: photoDir };
  const photoKey = (userId: string) => `avatars/${userId}/${'a'.repeat(64)}.webp`;
  /** A demo visitor who set a photo and made a personal key in their own copy. */
  const usesProfile = async (person: { userId: string; ws: string }) => {
    const key = photoKey(person.userId);
    mkdirSync(join(photoDir, 'avatars', person.userId), { recursive: true });
    writeFileSync(join(photoDir, key), 'webp');
    await t.db.update(users).set({ avatarKey: key }).where(eq(users.id, person.userId));
    await new DbIdentityStore(t.db).insertToken({
      id: randomUUID(),
      userId: person.userId,
      workspaceId: person.ws,
      kind: 'personal',
      projectId: null,
      prefix: 'inv_abcd',
      hash: randomUUID(),
      label: 'Laptop',
      scopes: ['project:read'],
      idempotencyKey: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    });
  };
  const old = async (label: string) => {
    const { userId } = await new DbIdentityStore(t.db, {
      onUserCreated: seedOnUserCreated,
    }).provisionUser({ subject: `demo:${randomUUID()}`, email: null, name: label });
    const [{ ws }] = await t.db
      .select({ ws: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    await t.db
      .update(users)
      .set({ createdAt: sql`now() - interval '40 days'` })
      .where(eq(users.id, userId));
    return { userId, ws };
  };
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
    await usesProfile(people.oldDemo);
    await usesProfile(people.newDemo);
    for (const key of ['oldDemo', 'oldGoogle'] as const)
      await t.db
        .update(users)
        .set({ createdAt: sql`now() - interval '40 days'` })
        .where(eq(users.id, people[key].userId));
  }, 60_000);
  afterAll(async () => {
    rmSync(photoDir, { recursive: true, force: true });
    await t?.close();
  });

  it('counts without --apply and deletes nothing', async () => {
    const dry = run(['--days', '30'], local);
    expect(dry.stderr).toBe('');
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout)).toEqual({
      event: 'demo_sandboxes',
      days: 30,
      people: 1,
      workspaces: 1,
      photos: 1,
      deleted: false,
    });
    expect(existsSync(join(photoDir, photoKey(people.oldDemo.userId)))).toBe(true);
    expect(await tenantRows(people.oldDemo.ws)).toBeGreaterThan(30);
  });

  it('with --apply deletes only the old demo copies, every row of them', async () => {
    const applied = run(['--days', '30', '--apply'], local);
    expect(applied.stderr).toBe('');
    expect(applied.status).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({
      people: 1,
      workspaces: 1,
      photos: 1,
      photosDeleted: 1,
      deleted: true,
    });
    expect(existsSync(join(photoDir, photoKey(people.oldDemo.userId)))).toBe(false);
    expect(existsSync(join(photoDir, photoKey(people.newDemo.userId)))).toBe(true);
    const keys = await t.db.select({ userId: agentTokens.userId }).from(agentTokens);
    expect(keys.map((k) => k.userId)).toEqual([people.newDemo.userId]);
    expect(await tenantRows(people.oldDemo.ws)).toBe(0);
    const left = await t.db.select({ id: users.id }).from(users);
    expect(left.map((u) => u.id).sort()).toEqual(
      [people.newDemo.userId, people.oldGoogle.userId].sort(),
    );
    expect(await tenantRows(people.newDemo.ws)).toBeGreaterThan(30);
    expect(await tenantRows(people.oldGoogle.ws)).toBeGreaterThan(30);
  });

  it('deletes the photo objects from the bucket with gcloud, and names the ones it could not delete', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'pg-fake-gcloud-'));
    writeFileSync(
      join(bin, 'gcloud'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$FAKE_LOG"\n[ "$FAKE_FAIL" = 1 ] && exit 1\nexit 0\n',
    );
    chmodSync(join(bin, 'gcloud'), 0o755);
    const env = (extra: Record<string, string> = {}) => ({
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      AVATAR_BUCKET: 'promise-graph-avatars',
      FAKE_LOG: join(bin, 'calls.log'),
      ...extra,
    });
    const gone = await old('gone');
    await usesProfile(gone);
    const deleted = run(['--days', '30', '--apply'], env());
    expect(deleted.status).toBe(0);
    expect(JSON.parse(deleted.stdout)).toMatchObject({ photos: 1, photosDeleted: 1 });
    expect(readFileSync(join(bin, 'calls.log'), 'utf8').trim()).toBe(
      `storage rm --quiet gs://promise-graph-avatars/${photoKey(gone.userId)}`,
    );

    const stuck = await old('stuck');
    await usesProfile(stuck);
    const failed = run(['--days', '30', '--apply'], env({ FAKE_FAIL: '1' }));
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({ photos: 1, photosDeleted: 0, deleted: true });
    expect(failed.stderr).toContain('demo_photos_left');
    expect(failed.stderr).toContain(photoKey(stuck.userId));
    rmSync(bin, { recursive: true, force: true });
  });

  it('without a photo store lists the photo objects it leaves behind', async () => {
    const left = await old('left');
    await usesProfile(left);
    const run1 = run(['--days', '30', '--apply']);
    expect(run1.status).toBe(0);
    expect(JSON.parse(run1.stdout)).toMatchObject({ photos: 1, photosDeleted: 0 });
    expect(run1.stderr).toContain('demo_photos_left');
    expect(run1.stderr).toContain(photoKey(left.userId));
  });

  it('refuses a wrong --days', () => {
    for (const args of [['--days'], ['--days', '0'], ['--days', 'x']]) {
      const bad = run(args);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toContain('--days');
    }
  });
});
