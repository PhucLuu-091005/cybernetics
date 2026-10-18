import { AppError } from '../errors';
export interface RateLimiter {
  consume(key: string, limit: number, now?: number, windowMs?: number): void;
}
type Bucket = { count: number; until: number };
/** Process-local: deploy one web process until a shared limiter is configured. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly maxKeys = 10_000) {}
  private bucket(key: string, now: number, windowMs: number): Bucket {
    const entry = this.buckets.get(key);
    if (entry && now < entry.until) return entry;
    // Delete and set again, so the map's insertion order stays oldest first for the eviction.
    this.buckets.delete(key);
    if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    const fresh = { count: 0, until: (Math.floor(now / windowMs) + 1) * windowMs };
    this.buckets.set(key, fresh);
    return fresh;
  }
  consume(key: string, limit: number, now = Date.now(), windowMs = 60_000): void {
    const entry = this.bucket(key, now, windowMs);
    if (entry.count >= limit) throw new AppError('RATE_LIMITED', 'Rate limit exceeded');
    entry.count++;
  }
  /** Counts every bucket or none: the first full key comes back, and a refused request costs nothing. */
  consumeAll(
    entries: { key: string; limit: number }[],
    now = Date.now(),
    windowMs = 60_000,
  ): string | null {
    const buckets = entries.map(({ key, limit }) => ({ key, limit, ...this.peek(key, now) }));
    const full = buckets.find((b) => b.count >= b.limit);
    if (full) return full.key;
    for (const { key } of entries) this.bucket(key, now, windowMs).count++;
    return null;
  }
  private peek(key: string, now: number): { count: number } {
    const entry = this.buckets.get(key);
    return { count: entry && now < entry.until ? entry.count : 0 };
  }
}
