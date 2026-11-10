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
    this.prune(t);
    return recent.length > this.max;
  }

  /** Without recording anything: would the next hit() for `key` be over the limit? */
  wouldLimit(key: string): boolean {
    const t = this.now();
    return (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs).length >= this.max;
  }

  /**
   * Check-and-record in one synchronous step: null (nothing recorded)
   * when the key is already at its limit, else the recorded hit's time.
   * Concurrent callers can't all slip past a check that only records
   * later; hand the time to release() to give the hit back.
   */
  reserve(key: string): number | null {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) return null;
    recent.push(t);
    this.hits.set(key, recent);
    this.prune(t);
    return t;
  }

  /** Past 5000 tracked keys, drop every key with no hit left in the window. */
  private prune(t: number): void {
    if (this.hits.size <= 5000) return;
    for (const [k, times] of this.hits) {
      if (!times.some((x) => t - x < this.windowMs)) this.hits.delete(k);
    }
  }

  /** Give back one hit recorded by reserve() (an attempt that turned out not to count). */
  release(key: string, at: number): void {
    const times = this.hits.get(key);
    if (!times) return;
    const i = times.lastIndexOf(at);
    if (i >= 0) times.splice(i, 1);
    if (!times.length) this.hits.delete(key);
  }

  /** Seconds until the oldest hit in the window ages out. */
  retryAfterSeconds(key: string): number {
    const times = this.hits.get(key) ?? [];
    if (!times.length) return 0;
    return Math.max(1, Math.ceil((times[0] + this.windowMs - this.now()) / 1000));
  }
}
