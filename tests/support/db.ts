import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/server/db/schema';
import { runMigrations } from '../../src/server/db/migrate';
import type { Db } from '../../src/server/db/tx';
import { DbIdentityStore } from '../../src/server/db/identity-store';
import { browserScopes } from '../../src/server/http/identity-store';
import type { ActorContext, Scope } from '../../src/contracts';

const utc = '-c TimeZone=UTC';
const pgCode = (error: unknown) => (error as { code?: string } | null)?.code;
export type TestDb = { db: Db; url: string; close(): Promise<void> };
export const testDatabaseUrl = (admin: string, name: string) =>
  Object.assign(new URL(admin), { pathname: `/${name}` }).toString();
export async function createTestDatabase(
  name = `pg_test_${randomUUID().replaceAll('-', '')}`,
): Promise<TestDb> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) throw new Error('TEST_DATABASE_URL is required for integration tests');
  if (!/^pg_(test|e2e)_[a-f0-9]{32}$/.test(name))
    throw new Error('Test database names must be throwaway pg_test_/pg_e2e_ names');
  const adminPool = new Pool({ connectionString: admin, max: 1, options: utc });
  await adminPool.query(`CREATE DATABASE ${name}`);
  const url = testDatabaseUrl(admin, name);
  const pool = new Pool({ connectionString: url, max: 10, options: utc });
  // The FORCE fallback below can terminate a socket that pool.end() is still closing; only that FATAL is teardown noise.
  pool.on('connect', (client) => {
    client.on('error', (error) => {
      if (pgCode(error) !== '57P01') throw error;
    });
  });
  const db = drizzle(pool, { schema });
  // pool.end() resolves before its sockets close, so wait for sessions to leave instead of killing them mid-close.
  const drop = async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await adminPool.query(`DROP DATABASE ${name}`);
        return;
      } catch (error) {
        if (pgCode(error) !== '55006') throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    await adminPool.query(`DROP DATABASE ${name} WITH (FORCE)`);
  };
  const close = async () => {
    try {
      await pool.end();
    } finally {
      try {
        await drop();
      } finally {
        await adminPool.end();
      }
    }
  };
  try {
    await runMigrations(db);
  } catch (error) {
    await close();
    throw error;
  }
  return { db, url, close };
}
export async function testActor(
  db: Db,
  opts: { subject?: string; name?: string; email?: string | null } = {},
): Promise<ActorContext> {
  const store = new DbIdentityStore(db);
  const { userId } = await store.provisionUser({
    subject: opts.subject ?? `google:${randomUUID()}`,
    email: opts.email ?? null,
    name: opts.name ?? 'Test User',
  });
  const session = await store.resolveSessionUser(userId);
  if (!session) throw new Error('Provisioned user has no workspace');
  return {
    kind: 'user',
    userId,
    workspaceId: session.defaultWorkspaceId,
    projectId: null,
    scopes: [...browserScopes],
    requestId: randomUUID(),
  };
}
export function agentActor(user: ActorContext, projectId: string, scopes: Scope[]): ActorContext {
  return {
    kind: 'agent',
    userId: user.userId,
    tokenId: randomUUID(),
    key: 'project',
    keyLabel: 'Agent',
    workspaceId: user.workspaceId,
    projectId,
    scopes: [...scopes],
    requestId: randomUUID(),
  };
}
