/**
 * A small in-memory sliding-window limiter (per app instance — the
 * deployment is a single app process, the same proportionate choice
 * as the Founders' Shelf throttle).
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record a hit for `key`; true when the key is now over its limit. */
  hit(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      for (const [k, times] of this.hits) {
        if (!times.some((x) => t - x < this.windowMs)) this.hits.delete(k);
      }
    }
    return recent.length > this.max;
  }

  /** Without recording anything: would the next hit() for `key` be over the limit? */
  wouldLimit(key: string): boolean {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs).length >= this.max;
  }

  /** Seconds until the oldest hit in the window ages out. */
  retryAfterSeconds(key: string): number {
    const times = this.hits.get(key) ?? [];
    if (!times.length) return 0;
    return Math.max(1, Math.ceil((times[0] + this.windowMs - this.now()) / 1000));
  }
}
