import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/server/db/migrate';
import * as schema from '../../../src/server/db/schema';
import { testDatabaseUrl } from '../../support/db';

const source = join(process.cwd(), 'src/server/db/migrations');

/** A database that stopped at the baseline, as a deployed one would be before round 17. */
function baselineOnly(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pg-baseline-'));
  mkdirSync(join(dir, 'meta'));
  copyFileSync(join(source, '0000_baseline.sql'), join(dir, '0000_baseline.sql'));
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter(
    (entry: { tag: string }) => entry.tag === '0000_baseline',
  );
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
  return dir;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'migration 0001 on a baseline database with tokens',
  () => {
    const name = `pg_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    let pool: Pool | undefined;
    const dirs: string[] = [];
    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    });

    it('keeps every older token a project key with its project, and the new check holds', async () => {
      await admin.query(`CREATE DATABASE ${name}`);
      pool = new Pool({ connectionString: testDatabaseUrl(process.env.TEST_DATABASE_URL!, name) });
      const db = drizzle(pool, { schema });
      const dir = baselineOnly();
      dirs.push(dir);
      await migrate(db, { migrationsFolder: dir });
      const [user, workspace, project, token] = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ];
      await pool.query(`insert into users (id, subject, name) values ($1, 'google:old', 'Old')`, [
        user,
      ]);
      await pool.query(`insert into workspaces (id, name) values ($1, 'W')`, [workspace]);
      await pool.query(
        `insert into projects (id, workspace_id, title, client_name) values ($1, $2, 'P', 'C')`,
        [project, workspace],
      );
      await pool.query(
        `insert into agent_tokens (id, workspace_id, project_id, user_id, prefix, hash, label, scopes, idempotency_key, expires_at)
       values ($1, $2, $3, $4, 'inv_abcd', 'h1', 'Old key', '{project:read}', 'k1', now() + interval '1 day')`,
        [token, workspace, project, user],
      );

      await runMigrations(db);

      const { rows } = await pool.query(`select kind, project_id from agent_tokens where id = $1`, [
        token,
      ]);
      expect(rows).toEqual([{ kind: 'project', project_id: project }]);
      const { rows: users } = await pool.query(`select avatar_key from users where id = $1`, [
        user,
      ]);
      expect(users).toEqual([{ avatar_key: null }]);
      const insert = (kind: string, projectId: string | null, key: string) =>
        pool!.query(
          `insert into agent_tokens (workspace_id, project_id, kind, user_id, prefix, hash, label, scopes, idempotency_key, expires_at)
         values ($1, $2, $3, $4, 'inv_abcd', $5, 'L', '{project:read}', $6, now() + interval '1 day')`,
          [workspace, projectId, kind, user, randomUUID(), key],
        );
      await expect(insert('personal', null, 'k2')).resolves.toBeDefined();
      await expect(insert('personal', null, 'k2')).rejects.toMatchObject({ code: '23505' });
      await expect(insert('project', null, 'k3')).rejects.toMatchObject({ code: '23514' });
      await expect(insert('personal', project, 'k4')).rejects.toMatchObject({ code: '23514' });
    });
  },
);
