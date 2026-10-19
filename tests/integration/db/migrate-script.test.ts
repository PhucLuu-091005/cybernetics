import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../support/db';

const script = join(process.cwd(), 'scripts/migrate.mjs');
const migrations = join(process.cwd(), 'src/server/db/migrations');
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string }[];
};
const TABLES = [
  'agent_tokens',
  'projects',
  'tracker_commits',
  'tracker_cr_asks',
  'tracker_cr_comments',
  'tracker_cr_shares',
  'tracker_crs',
  'tracker_event_offsets',
  'tracker_members',
  'tracker_projects',
  'tracker_queue',
  'tracker_team_members',
  'tracker_teams',
  'users',
  'workspace_members',
  'workspaces',
];
const PROMISE_TABLES = [
  'graph_commits',
  'graph_proposals',
  'mutation_receipts',
  'record_versions',
  'records',
];
const tablesOf = async (pool: Pool) =>
  (
    await pool.query<{ name: string }>(
      "select table_name as name from information_schema.tables where table_schema = 'public'",
    )
  ).rows
    .map((row) => row.name)
    .sort();
const columnsOf = async (pool: Pool, table: string) =>
  (
    await pool.query<{ name: string }>(
      "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = $1",
      [table],
    )
  ).rows
    .map((row) => row.name)
    .sort();
const scriptEnv = (databaseUrl: string | undefined, migrateUrl?: string) => {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'production' };
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  if (migrateUrl) env.MIGRATE_DATABASE_URL = migrateUrl;
  return env;
};
const run = (databaseUrl: string | undefined, migrateUrl?: string) =>
  spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: scriptEnv(databaseUrl, migrateUrl),
    timeout: 30_000,
  });
type Started = { status: Promise<number | null>; stdout: () => string; stderr: () => string };
const start = (databaseUrl: string): Started => {
  const child = spawn(process.execPath, [script], { env: scriptEnv(databaseUrl) });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return {
    status: new Promise((resolve) => child.on('close', resolve)),
    stdout: () => stdout,
    stderr: () => stderr,
  };
};
const LOCK = "hashtextextended('promise-graph:migrations', 0)";
const POOLED =
  'postgresql://neondb_owner:not-a-real-password@ep-quiet-lake-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full';
const freshDatabase = async (admin: Pool) => {
  const name = `pg_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  return { name, url: testDatabaseUrl(process.env.TEST_DATABASE_URL!, name) };
};
const appliedIn = async (url: string) => {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ applied: number }>(
      'select count(*)::int as applied from drizzle.__drizzle_migrations',
    );
    return rows[0].applied;
  } finally {
    await pool.end();
  }
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('container migration script', () => {
  const name = `pg_test_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool, url: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    url = testDatabaseUrl(process.env.TEST_DATABASE_URL!, name);
  });
  const extra: string[] = [];
  afterAll(async () => {
    for (const db of [name, ...extra])
      await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin?.end();
  });

  it('applies the baseline and the later migrations to an empty database, then a second start applies nothing and still succeeds', async () => {
    const first = run(url);
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('"event":"migrations_applied"');
    const second = run(url);
    expect(second.status).toBe(0);
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const { rows } = await pool.query<{ applied: number }>(
        'select count(*)::int as applied from drizzle.__drizzle_migrations',
      );
      expect(journal.entries.map((entry) => entry.tag)).toEqual([
        '0000_baseline',
        '0001_personal_keys_and_photos',
        '0002_member_photos',
        '0003_key_members',
      ]);
      expect(rows[0].applied).toBe(journal.entries.length);
      expect(await tablesOf(pool)).toEqual(TABLES);
      for (const table of PROMISE_TABLES) expect(await tablesOf(pool)).not.toContain(table);
      expect(await columnsOf(pool, 'projects')).toEqual([
        'client_name',
        'created_at',
        'id',
        'title',
        'workspace_id',
      ]);
    } finally {
      await pool.end();
    }
  });
  it('fails the start without DATABASE_URL or with an unreachable database, and never prints the password', () => {
    const missing = run(undefined);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('DATABASE_URL');
    const unreachable = run(
      testDatabaseUrl(process.env.TEST_DATABASE_URL!, `pg_test_${'0'.repeat(32)}`),
    );
    expect(unreachable.status).not.toBe(0);
    expect(unreachable.stderr).toContain('"event":"migrations_failed"');
    const password = new URL(process.env.TEST_DATABASE_URL!).password;
    if (password) expect(unreachable.stderr + unreachable.stdout).not.toContain(password);
  });

  it('lets two containers that start at once both succeed, and applies each migration once', async () => {
    const db = await freshDatabase(admin);
    extra.push(db.name);
    const [a, b] = [start(db.url), start(db.url)];
    expect([await a.status, await b.status]).toEqual([0, 0]);
    expect(a.stderr() + b.stderr()).toBe('');
    expect(a.stdout()).toContain('"event":"migrations_applied"');
    expect(b.stdout()).toContain('"event":"migrations_applied"');
    expect(await appliedIn(db.url)).toBe(journal.entries.length);
  });
  it('waits while another session holds the migration lock, then migrates', async () => {
    const db = await freshDatabase(admin);
    extra.push(db.name);
    const holder = new Pool({ connectionString: db.url, max: 1 });
    const session = await holder.connect();
    try {
      await session.query(`select pg_advisory_lock(${LOCK})`);
      const waiting = start(db.url);
      await expect
        .poll(waiting.stdout, { timeout: 10_000 })
        .toContain('"event":"migrations_waiting"');
      let done = false;
      void waiting.status.then(() => (done = true));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(done).toBe(false);
      await session.query(`select pg_advisory_unlock(${LOCK})`);
      expect(await waiting.status).toBe(0);
      expect(waiting.stdout()).toContain('"event":"migrations_applied"');
    } finally {
      session.release();
      await holder.end();
    }
    expect(await appliedIn(db.url)).toBe(journal.entries.length);
  });
  it('sets UTC as the default time zone of its role, since a pooled connection takes no startup options', async () => {
    expect(run(url).status).toBe(0);
    const { rows } = await admin.query<{ config: string[] | null }>(
      'select setconfig as config from pg_db_role_setting where setrole = (select oid from pg_roles where rolname = current_user) and setdatabase = 0',
    );
    expect(rows[0]?.config).toContain('TimeZone=UTC');
  });
  it('refuses a pooled DATABASE_URL without MIGRATE_DATABASE_URL and a pooled MIGRATE_DATABASE_URL, names the one it read, and migrates through MIGRATE_DATABASE_URL when it is set', () => {
    const pooled = run(POOLED);
    expect(pooled.status).not.toBe(0);
    expect(pooled.stderr).toContain('DATABASE_URL is a pooled');
    expect(pooled.stderr).toContain('set MIGRATE_DATABASE_URL');
    expect(pooled.stderr + pooled.stdout).not.toContain('not-a-real-password');
    const pooledMigrate = run(url, POOLED);
    expect(pooledMigrate.status).not.toBe(0);
    expect(pooledMigrate.stderr).toContain('MIGRATE_DATABASE_URL is a pooled');
    const direct = run(POOLED, url);
    expect(direct.stderr).toBe('');
    expect(direct.status).toBe(0);
    expect(direct.stdout).toContain('"event":"migrations_applied"');
  });
});
