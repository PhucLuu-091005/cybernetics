// Container start step: applies pending Drizzle migrations, then exits non-zero on any failure so the server never starts on an old schema.
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const fail = (detail) => {
  console.error(JSON.stringify({ event: 'migrations_failed', ...detail }));
  process.exitCode = 1;
};
const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail({ message: 'DATABASE_URL is required' });
else {
  const migrationsFolder = path.join(process.cwd(), 'src/server/db/migrations');
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10_000,
    options: '-c TimeZone=UTC',
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(JSON.stringify({ event: 'migrations_applied', folder: migrationsFolder }));
  } catch (error) {
    // PostgreSQL messages name the database or relation, never the password; the URL itself is never printed.
    fail({
      code: error?.code ?? error?.cause?.code ?? null,
      message: String(error?.cause?.message ?? error?.message ?? error).slice(0, 300),
    });
  } finally {
    await pool.end();
  }
}
