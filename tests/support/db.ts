import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/server/db/schema';
import { runMigrations } from '../../src/server/db/migrate';
import type { Db } from '../../src/server/db/tx';
import { DbIdentityStore } from '../../src/server/db/identity-store';
import { browserScopes } from '../../src/server/http/identity-store';
import type { ActorContext, Scope } from '../../src/contracts';

export type TestDb = { db: Db; url: string; close(): Promise<void> };
export async function createTestDatabase(): Promise<TestDb> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) throw new Error('TEST_DATABASE_URL is required for integration tests');
  const name = `pg_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = new Pool({ connectionString: admin, max: 1 });
  await adminPool.query(`CREATE DATABASE ${name}`);
  const url = Object.assign(new URL(admin), { pathname: `/${name}` }).toString();
  const pool = new Pool({ connectionString: url, max: 10 });
  // DROP ... WITH (FORCE) can terminate a socket that pool.end() is still closing; that FATAL is expected teardown noise.
  pool.on('connect', client => { client.on('error', () => {}); });
  const db = drizzle(pool, { schema });
  await runMigrations(db);
  return { db, url, async close() { await pool.end(); await adminPool.query(`DROP DATABASE ${name} WITH (FORCE)`); await adminPool.end(); } };
}
export async function testActor(db: Db, opts: { subject?: string; name?: string; email?: string | null } = {}): Promise<ActorContext> {
  const store = new DbIdentityStore(db);
  const { userId } = await store.provisionUser({ subject: opts.subject ?? `google:${randomUUID()}`, email: opts.email ?? null, name: opts.name ?? 'Test User' });
  const session = await store.resolveSessionUser(userId);
  if (!session) throw new Error('Provisioned user has no workspace');
  return { kind: 'user', userId, workspaceId: session.defaultWorkspaceId, projectId: null, scopes: [...browserScopes], requestId: randomUUID() };
}
export function agentActor(user: ActorContext, projectId: string, scopes: Scope[]): ActorContext {
  return { kind: 'agent', userId: user.userId, tokenId: randomUUID(), workspaceId: user.workspaceId, projectId, scopes: [...scopes], requestId: randomUUID() };
}
