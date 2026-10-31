import { Router } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { checkPassword, dummyPasswordHash, hashPassword, verifyAgainstDummy } from '../password.js';
import { rateLimit, TokenBucketLimiter } from '../ratelimit.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
} from '../auth.js';
import { initStreakState } from '../streak.js';
import { accessSummary, accountAccess, type AccessDeps } from '../access.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export interface AuthHooks {
  /** Accounts portal: runs after a successful sign-up (sends the email
   *  confirmation after the response); its fields join the 201 body. */
  afterRegister?: (user: { id: string; email: string }) => Record<string, unknown> | void;
}

/** BEUK:login — the refusal log line (stdout, JSON, one line). */
export function logLoginRefusal(fields: {
  reason: 'no_account' | 'mismatch' | 'error';
  userId: string | null;
}): void {
  console.log(JSON.stringify({ event: 'auth.login.refused', at: new Date().toISOString(), ...fields }));
}

export function authRoutes(db: Db, config: Config, hooks: AuthHooks = {}, access?: Pick<AccessDeps, 'billing' | 'now'>): Router {
  const router = Router();
  // Warm the dummy hash so the first unknown-email login isn't the one
  // request that also pays for computing it.
  void dummyPasswordHash();
  // Per-client-IP buckets (req.ip is the real client: see `trust proxy`
  // in app.ts). Separate buckets so sign-ups can't starve sign-ins.
  const bucket = () =>
    new TokenBucketLimiter({ burst: config.authRateBurst, refillMs: config.authRateRefillMs });
  const loginLimit = rateLimit(bucket(), 'too many sign-in attempts — please wait and try again');
  const registerLimit = rateLimit(bucket(), 'too many sign-up attempts — please wait and try again');

  router.post('/register', registerLimit, async (req, res, next) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
      if (password.length < 8)
        return res.status(400).json({ error: 'password must be at least 8 characters' });

      const existing = await db.query('select id from users where email = $1', [email]);
      if (existing.rows.length) return res.status(409).json({ error: 'email already registered' });

      const passwordHash = await hashPassword(password);
      let created;
      try {
        created = await db.query<UserRow>(
          // The free trial starts at sign-up (TRIAL_DAYS; src/access.ts).
          `insert into users (email, password_hash, trial_ends_at)
           values ($1, $2, now() + make_interval(days => $3::int)) returning id, email`,
          [email, passwordHash, config.trialDays],
        );
      } catch (err) {
        // Two concurrent sign-ups for one email both pass the check
        // above; the unique index decides, and the loser gets the same
        // 409 as a sequential duplicate instead of a 500.
        if ((err as { code?: string })?.code === UNIQUE_VIOLATION) {
          return res.status(409).json({ error: 'email already registered' });
        }
        throw err;
      }
      const user = created.rows[0];
      await initStreakState(db, user.id);
      const session = await createSession(db, user.id, config.sessionTtlDays);
      setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
      const extra = hooks.afterRegister?.({ id: user.id, email: user.email }) ?? {};
      return res.status(201).json({ ...extra, user: { id: user.id, email: user.email } });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', loginLimit, async (req, res, next) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const found = await db.query<UserRow>(
        'select id, email, password_hash from users where email = $1',
        [email],
      );
      const user = found.rows[0];
      // Same response — and the same argon2 work — for unknown email
      // and wrong password (no timing oracle on which emails exist).
      let refusal: 'no_account' | 'mismatch' | 'error' | null = 'no_account';
      if (user) {
        const outcome = await checkPassword(user.password_hash, password);
        refusal = outcome === 'match' ? null : outcome;
      } else {
        await verifyAgainstDummy(password);
      }
      if (!user || refusal) {
        // One structured line per refusal with its precise reason, so an
        // unexplained 401 explains itself (no email, no password, no hash:
        // the user id only when the account exists). The response stays
        // the same for every reason (no oracle on which emails exist).
        logLoginRefusal({ reason: refusal ?? 'no_account', userId: user?.id ?? null });
        return res.status(401).json({ error: 'invalid email or password' });
      }
      const session = await createSession(db, user.id, config.sessionTtlDays);
      setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
      return res.json({ user: { id: user.id, email: user.email } });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await destroySession(db, req);
      clearSessionCookie(res, config.cookieSecure);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  // Who is signed in, and (when the server can decide it) what their access
  // is: { state, daysLeft, locked }. The studio shows copy from this; the
  // routes themselves are gated by src/access.ts, not by the client.
  router.get('/me', requireAuth(db), async (req, res, next) => {
    try {
      if (!access || !req.user) return res.json({ user: req.user });
      const found = await accountAccess({ db, config, billing: access.billing, now: access.now }, req.user.id);
      return res.json({ user: req.user, access: found ? accessSummary(found) : undefined });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
