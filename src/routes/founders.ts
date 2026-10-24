import { Router } from 'express';
import type { Db } from '../db.js';

/**
 * M4 Founders' Shelf — POST /api/founders/apply (public).
 *
 * The Founders' Shelf is a private seed list of writers (Warmth Phase 0:
 * no public community). A visitor leaves their name, email, and one line
 * about what they write; the application is stored and read only through
 * Housekeeping's founders.list action. No email is sent in this milestone.
 *
 * Abuse control is deliberately lite: basic validation plus an in-memory
 * per-IP throttle (per app instance — the deployment is a single app
 * process, so this is proportional).
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function foundersRoutes(db: Db): Router {
  const router = Router();
  // Per-instance attempt log: ip → timestamps inside the window.
  const attempts = new Map<string, number[]>();

  /** Whole seconds until the oldest attempt in the window ages out. */
  function retryAfterSec(ip: string): number {
    const oldest = (attempts.get(ip) ?? [])[0];
    if (oldest === undefined) return 1;
    return Math.max(1, Math.ceil((WINDOW_MS - (Date.now() - oldest)) / 1000));
  }

  function throttled(ip: string): boolean {
    const nowMs = Date.now();
    const recent = (attempts.get(ip) ?? []).filter((t) => nowMs - t < WINDOW_MS);
    recent.push(nowMs);
    attempts.set(ip, recent);
    // Opportunistic tidy so the map can't grow without bound.
    if (attempts.size > 1000) {
      for (const [key, times] of attempts) {
        if (!times.some((t) => nowMs - t < WINDOW_MS)) attempts.delete(key);
      }
    }
    return recent.length > MAX_ATTEMPTS_PER_WINDOW;
  }

  router.post('/apply', async (req, res, next) => {
    try {
      // req.ip is the real client: app.ts trusts exactly the Caddy hop.
      const ip = req.ip ?? 'unknown';
      if (throttled(ip)) {
        res.setHeader('Retry-After', String(retryAfterSec(ip)));
        return res.status(429).json({
          error: 'too many applications from this connection — please wait a little and try again',
        });
      }
      const name = clean(req.body?.name);
      const email = clean(req.body?.email);
      const about = clean(req.body?.about);
      if (!name || name.length > 80) {
        return res.status(400).json({ error: 'please give your name (up to 80 characters)' });
      }
      if (!EMAIL_RE.test(email) || email.length > 254) {
        return res.status(400).json({ error: 'please give a valid email address' });
      }
      if (!about || about.length > 500) {
        return res
          .status(400)
          .json({ error: 'please add a line about what you write (up to 500 characters)' });
      }
      const inserted = await db.query<{ id: string }>(
        'insert into founders_applications (name, email, about) values ($1, $2, $3) returning id',
        [name, email, about],
      );
      return res.status(201).json({
        ok: true,
        id: inserted.rows[0].id,
        message:
          "You're on the Founders' Shelf list. When the first seats open, the invitation goes to this address.",
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
