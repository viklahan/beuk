import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory per-key token bucket. The deployment is a single app
 * process behind one Caddy hop (see docker-compose.yml), so an
 * in-process bucket is proportional; it resets when the process
 * restarts and is NOT shared across replicas.
 *
 * Each key starts with `burst` tokens; one token comes back every
 * `refillMs`, never above `burst`. A request that finds the bucket
 * empty is refused with the whole seconds until the next token.
 */
export interface TokenBucketOptions {
  burst: number;
  refillMs: number;
  now?: () => number;
  /** Cap on tracked keys; full buckets are swept when exceeded. */
  maxKeys?: number;
}

export interface TakeResult {
  ok: boolean;
  /** Seconds until a token is available (0 when ok). */
  retryAfterSec: number;
}

export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(private readonly opts: TokenBucketOptions) {
    this.now = opts.now ?? Date.now;
    this.maxKeys = opts.maxKeys ?? 10_000;
  }

  take(key: string): TakeResult {
    const t = this.now();
    const { burst, refillMs } = this.opts;
    const bucket = this.buckets.get(key) ?? { tokens: burst, updated: t };
    const refilled = Math.min(burst, bucket.tokens + (t - bucket.updated) / refillMs);
    bucket.updated = t;
    if (refilled >= 1) {
      bucket.tokens = refilled - 1;
      this.buckets.set(key, bucket);
      this.sweep(t);
      return { ok: true, retryAfterSec: 0 };
    }
    bucket.tokens = refilled;
    this.buckets.set(key, bucket);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((1 - refilled) * refillMs) / 1000)) };
  }

  /** Number of keys currently tracked (diagnostics / tests). */
  get size(): number {
    return this.buckets.size;
  }

  private sweep(t: number): void {
    if (this.buckets.size <= this.maxKeys) return;
    const { burst, refillMs } = this.opts;
    for (const [key, b] of this.buckets) {
      if (b.tokens + (t - b.updated) / refillMs >= burst) this.buckets.delete(key);
    }
  }
}

/** Express middleware: one token per request, keyed by req.ip (which
 *  is the real client address once `trust proxy` is set to the single
 *  Caddy hop — see app.ts). Over the limit → 429 + Retry-After. */
export function rateLimit(limiter: TokenBucketLimiter, message: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const outcome = limiter.take(req.ip ?? 'unknown');
    if (outcome.ok) return next();
    res.setHeader('Retry-After', String(outcome.retryAfterSec));
    res.status(429).json({ error: message, retryAfterSeconds: outcome.retryAfterSec });
  };
}
