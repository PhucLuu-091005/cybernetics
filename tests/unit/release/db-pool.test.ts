import { describe, expect, it } from 'vitest';
import { poolConfig } from '../../../src/server/db/client';

const LOCAL = 'postgresql://promise_graph:local-development-only@127.0.0.1:55432/pg_et';
const NEON_POOLED =
  'postgresql://neondb_owner:secret@ep-quiet-lake-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full';
const NEON_DIRECT =
  'postgresql://neondb_owner:secret@ep-quiet-lake-a1b2c3d4.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full';

describe('poolConfig', () => {
  it('keeps the pool small, so the one Cloud Run instance (and a second one during a rollout) stays far under the Neon connection limit', () => {
    expect(poolConfig(LOCAL).max).toBe(5);
  });
  it('waits long enough for a Neon compute that wakes from scale to zero', () => {
    expect(poolConfig(NEON_POOLED).connectionTimeoutMillis).toBeGreaterThanOrEqual(10_000);
  });
  it('sends the UTC startup option on a direct host only: the Neon pooler refuses startup options', () => {
    expect(poolConfig(LOCAL).options).toBe('-c TimeZone=UTC');
    expect(poolConfig(NEON_DIRECT).options).toBe('-c TimeZone=UTC');
    expect(poolConfig(NEON_POOLED)).not.toHaveProperty('options');
  });
  it('passes the URL on unchanged, so pg reads sslmode from it', () => {
    expect(poolConfig(NEON_POOLED).connectionString).toBe(NEON_POOLED);
  });
});
