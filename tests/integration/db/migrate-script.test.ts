import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../../support/db';

const script = join(process.cwd(), 'scripts/migrate.mjs');
const journal = JSON.parse(
  readFileSync(join(process.cwd(), 'src/server/db/migrations/meta/_journal.json'), 'utf8'),
) as { entries: unknown[] };
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

  it('applies every migration to an empty database, then a second start applies nothing and still succeeds', async () => {
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
      expect(journal.entries.length).toBeGreaterThan(0);
      expect(rows[0].applied).toBe(journal.entries.length);
      const tables = await pool.query<{ name: string }>(
        "select table_name as name from information_schema.tables where table_schema = 'public'",
      );
      expect(tables.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining(['projects', 'record_versions', 'graph_commits', 'agent_tokens']),
      );
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
