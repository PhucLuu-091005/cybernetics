export interface RateLimiter {
  /** True when the call fits the limit; each caller throws its own error, so a shared limiter never throws another route's class. */
  consume(key: string, limit: number, now?: number, windowMs?: number): boolean;
}
/** Process-local: deploy one web process until a shared limiter is configured. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  constructor(private readonly maxKeys = 10_000) {}
  consume(key: string, limit: number, now = Date.now(), windowMs = 60_000): boolean {
    let entry = this.buckets.get(key);
    if (!entry || now >= entry.until) {
      // Deleted and set again, so the map's order stays oldest first and the oldest key goes at the cap.
      this.buckets.delete(key);
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
      entry = { count: 0, until: (Math.floor(now / windowMs) + 1) * windowMs };
      this.buckets.set(key, entry);
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  }
}
