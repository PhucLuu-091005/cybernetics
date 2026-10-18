import { spawnSync } from 'node:child_process';
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
const run = (databaseUrl: string | undefined) => {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'production' };
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  return spawnSync(process.execPath, [script], { encoding: 'utf8', env, timeout: 30_000 });
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('container migration script', () => {
  const name = `pg_test_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool, url: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    url = testDatabaseUrl(process.env.TEST_DATABASE_URL!, name);
  });
  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('applies the one baseline migration to an empty database, then a second start applies nothing and still succeeds', async () => {
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
      expect(journal.entries.map((entry) => entry.tag)).toEqual(['0000_baseline']);
      expect(rows[0].applied).toBe(1);
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
});
