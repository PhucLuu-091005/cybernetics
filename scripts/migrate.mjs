// Container start step: applies pending Drizzle migrations, then exits non-zero on any failure so the server never starts on an old schema.
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Drizzle's migrator takes no lock, so two instances that start at once would both apply the same migration.
const LOCK = "hashtextextended('promise-graph:migrations', 0)";

const log = (detail) => console.log(JSON.stringify(detail));
const fail = (detail) => {
  console.error(JSON.stringify({ event: 'migrations_failed', ...detail }));
  process.exitCode = 1;
};
const isPooled = (connectionString) => {
  try {
    return /-pooler\./.test(new URL(connectionString).hostname);
  } catch {
    return false;
  }
};

const connectionString = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) fail({ message: 'DATABASE_URL is required' });
// A session lock over PgBouncer in transaction mode can land on another server connection, so it would lock nothing.
else if (isPooled(connectionString))
  fail({
    message:
      'DATABASE_URL is a pooled (-pooler) host: set MIGRATE_DATABASE_URL to the direct host of the same database',
  });
else {
  const migrationsFolder = path.join(process.cwd(), 'src/server/db/migrations');
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    options: '-c TimeZone=UTC',
  });
  // Without a listener, a dropped connection during the wait crashes the process with no JSON line.
  client.on('error', () => {});
  try {
    await client.connect();
    const { rows } = await client.query(`select pg_try_advisory_lock(${LOCK}) as locked`);
    if (!rows[0].locked) {
      log({ event: 'migrations_waiting' });
      await client.query(`select pg_advisory_lock(${LOCK})`);
    }
    await migrate(drizzle(client), { migrationsFolder });
    await client.query(`alter role current_user set timezone to 'UTC'`);
    await client.query(`select pg_advisory_unlock(${LOCK})`);
    log({ event: 'migrations_applied', folder: migrationsFolder });
  } catch (error) {
    // PostgreSQL messages name the database or relation, never the password; the URL itself is never printed.
    fail({
      code: error?.code ?? error?.cause?.code ?? null,
      message: String(error?.cause?.message ?? error?.message ?? error).slice(0, 300),
    });
  } finally {
    await client.end().catch(() => {});
  }
}
