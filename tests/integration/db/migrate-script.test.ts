import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
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
  const name = `pg_test_${randomUUID().replaceAll('-', '')}`,
    upgraded = `pg_test_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool, url: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.query(`CREATE DATABASE ${upgraded}`);
    url = testDatabaseUrl(process.env.TEST_DATABASE_URL!, name);
  });
  afterAll(async () => {
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.query(`DROP DATABASE IF EXISTS ${upgraded} WITH (FORCE)`);
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
      expect(await tablesOf(pool)).toEqual(TABLES);
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
  it('drops the promise tables and columns from a database that holds promise rows, and keeps the project and its token', async () => {
    const before = mkdtempSync(join(tmpdir(), 'pg-migrations-'));
    const upgradedUrl = testDatabaseUrl(process.env.TEST_DATABASE_URL!, upgraded);
    const pool = new Pool({ connectionString: upgradedUrl, max: 1 });
    try {
      cpSync(migrations, before, { recursive: true });
      const cut = journal.entries.findIndex((entry) => entry.tag === '0005_drop_promise');
      expect(cut).toBeGreaterThan(0);
      writeFileSync(
        join(before, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
      );
      await migrate(drizzle(pool), { migrationsFolder: before });
      const [user, workspace, project, commit, token] = Array.from({ length: 5 }, randomUUID);
      await pool.query(`
        insert into users (id, subject, name) values ('${user}', 'google:${user}', 'Old user');
        insert into workspaces (id, name) values ('${workspace}', 'Personal workspace');
        insert into workspace_members (workspace_id, user_id) values ('${workspace}', '${user}');
        insert into projects (id, workspace_id, title, client_name, evidence_revision)
          values ('${project}', '${workspace}', 'Old graph', 'Client', 3);
        insert into graph_commits (id, workspace_id, project_id, sequence, snapshot, snapshot_hash, actor, message, kind, reviewed_evidence_revision)
          values ('${commit}', '${workspace}', '${project}', 0, '{}', 'h', '{}', 'Initial graph', 'initial', 0);
        update projects set main_commit_id = '${commit}' where id = '${project}';
        insert into graph_proposals (workspace_id, project_id, base_commit_id, candidate, revision, author, title, rationale, evidence_revision, status)
          values ('${workspace}', '${project}', '${commit}', '{}', 0, '{}', 'Draft', '', 3, 'draft');
        insert into records (workspace_id, project_id, source) values ('${workspace}', '${project}', 'paste');
        insert into mutation_receipts (project_id, actor_key, operation, idempotency_key, request_hash, result)
          values ('${project}', 'user:${user}', 'merge', 'k', 'h', '{}');
        insert into agent_tokens (id, workspace_id, project_id, user_id, prefix, hash, label, scopes, idempotency_key, expires_at)
          values ('${token}', '${workspace}', '${project}', '${user}', 'inv_abcd', 'hash-${token}', 'Agent',
            '{project:read,records:import,graph:propose,graph:merge,queue:add}', 'k', now() + interval '1 day');
      `);
      const result = run(upgradedUrl);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(await tablesOf(pool)).toEqual(TABLES);
      for (const table of PROMISE_TABLES) expect(await tablesOf(pool)).not.toContain(table);
      expect(await columnsOf(pool, 'projects')).not.toContain('main_commit_id');
      const { rows } = await pool.query(
        `select p.title, t.scopes from projects p join agent_tokens t on t.project_id = p.id where p.id = '${project}'`,
      );
      expect(rows).toEqual([{ title: 'Old graph', scopes: ['project:read', 'queue:add'] }]);
    } finally {
      await pool.end();
      rmSync(before, { recursive: true, force: true });
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
