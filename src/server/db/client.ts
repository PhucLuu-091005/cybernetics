import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
/**
 * UTC keeps timestamptz text at a "+00" offset. The Neon pooler (PgBouncer) refuses the `options`
 * startup parameter, so pooled sessions take UTC from the role default that scripts/migrate.mjs sets.
 * The timeout covers a Neon compute that wakes from scale to zero.
 */
export function poolConfig(connectionString: string): PoolConfig {
  const pooled = /-pooler\./.test(new URL(connectionString).hostname);
  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(pooled ? {} : { options: '-c TimeZone=UTC' }),
  };
}
/** No eager connection during imports/build; callers own pool shutdown. */
export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Invalid PostgreSQL connection URL');
  const pool = new Pool(poolConfig(connectionString));
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
