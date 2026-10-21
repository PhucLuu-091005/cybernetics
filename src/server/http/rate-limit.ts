import { AppError } from '../errors';
export interface RateLimiter {
  consume(key: string, limit: number, now?: number): void;
}
/** Process-local: deploy one web process until a shared limiter is configured. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; window: number }>();
  consume(key: string, limit: number, now = Date.now()): void {
    const window = Math.floor(now / 60_000);
    let entry = this.buckets.get(key);
    if (!entry || entry.window !== window) {
      entry = { count: 0, window };
      this.buckets.set(key, entry);
    }
    if (entry.count >= limit) throw new AppError('RATE_LIMITED', 'Rate limit exceeded');
    entry.count++;
    if (this.buckets.size > 10_000)
      for (const [id, value] of this.buckets) if (value.window < window) this.buckets.delete(id);
  }
}
