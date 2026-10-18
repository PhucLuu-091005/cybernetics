import { AppError } from '../errors';
export interface RateLimiter {
  consume(key: string, limit: number, now?: number, windowMs?: number): void;
}
/** Process-local: deploy one web process until a shared limiter is configured. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  consume(key: string, limit: number, now = Date.now(), windowMs = 60_000): void {
    let entry = this.buckets.get(key);
    if (!entry || now >= entry.until) {
      entry = { count: 0, until: (Math.floor(now / windowMs) + 1) * windowMs };
      this.buckets.set(key, entry);
    }
    if (entry.count >= limit) throw new AppError('RATE_LIMITED', 'Rate limit exceeded');
    entry.count++;
    if (this.buckets.size > 10_000)
      for (const [id, value] of this.buckets) if (value.until <= now) this.buckets.delete(id);
  }
}
