import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
/** No eager connection during imports/build; callers own pool shutdown. UTC keeps timestamptz text at a "+00" offset. */
export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid PostgreSQL connection URL');
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: '-c TimeZone=UTC',
  });
  // Without a listener, an idle client's network error crashes the process.
  pool.on('error', (error) => {
    console.error(
      JSON.stringify({
        event: 'pg_pool_error',
        code: (error as Error & { code?: string }).code ?? null,
      }),
    );
  });
  return { pool, db: drizzle(pool, { schema }) };
}
