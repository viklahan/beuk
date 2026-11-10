import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { checkPassword, dummyPasswordHash, hashPassword, verifyAgainstDummy } from '../password.js';
import { rateLimit, TokenBucketLimiter } from '../ratelimit.js';
import { SlidingWindowLimiter } from '../rate-limit.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
  tokenHash,
} from '../auth.js';
import { initStreakState } from '../streak.js';
import { accessSummary, accountAccess, type AccessDeps } from '../access.js';
import { twoStepOn, twoStepStatus, verifySecondFactor } from '../twostep/store.js';

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
  /** Account hardening: runs after every successful sign-in (the plain
   *  password login and the /login/code step), once the session exists
   *  and the response is sent. `sessionToken` is the new session's raw
   *  token (only its hash is stored). */
  onSignedIn?: (user: { id: string; email: string }, req: Request, sessionToken: string) => void;
  /** Account hardening: a recovery code was spent at /login/code; `left` is how many stay unused. */
  onRecoveryUsed?: (user: { id: string; email: string }, left: number) => void;
}

/** The sign-in code step: a challenge lives 5 minutes and allows 5 codes. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** Per-account sign-in limit: failures (wrong password, wrong code) per
 *  lowercase address, whether or not the address has an account. */
export interface SignInLimits {
  perAccount: { max: number; windowMs: number };
}
export const DEFAULT_SIGN_IN_LIMITS: SignInLimits = {
  perAccount: { max: 10, windowMs: 15 * 60_000 },
};

export interface AuthOptions {
  /** Injectable clock (challenge expiry, TOTP steps, the per-account window). */
  now?: () => Date;
  signInLimits?: SignInLimits;
}

const TOO_MANY_SIGN_INS = 'too many sign-in attempts — please wait and try again';

/** BEUK:login — the refusal log line (stdout, JSON, one line). */
export function logLoginRefusal(fields: {
  reason: 'no_account' | 'mismatch' | 'error';
  userId: string | null;
}): void {
  console.log(JSON.stringify({ event: 'auth.login.refused', at: new Date().toISOString(), ...fields }));
}

export function authRoutes(
  db: Db,
  config: Config,
  hooks: AuthHooks = {},
  access?: Pick<AccessDeps, 'billing' | 'now'>,
  options: AuthOptions = {},
): Router {
  const router = Router();
  const now = options.now ?? access?.now ?? (() => new Date());
  const limits = options.signInLimits ?? DEFAULT_SIGN_IN_LIMITS;
  // Per ADDRESS, against password-guessing from many IPs. Every attempt
  // reserves its place BEFORE any work (check and record in one
  // synchronous step, so a parallel burst can't all slip past), and only
  // a failure (wrong password, wrong code) keeps it: anything else gives
  // it back. The 429 is the same whether the account exists or not.
  const perAccount = new SlidingWindowLimiter(limits.perAccount.max, limits.perAccount.windowMs, () => now().getTime());
  /** The reservation's time, or null after answering 429. */
  const reserveAttempt = (res: Response, key: string): number | null => {
    const at = perAccount.reserve(key);
    if (at !== null) return at;
    const retryAfterSeconds = perAccount.retryAfterSeconds(key);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: TOO_MANY_SIGN_INS, retryAfterSeconds });
    return null;
  };
  /** A hook runs after the response: a throw or a rejection is logged, never surfaced. */
  const runHook = (name: string, fn: () => unknown | Promise<unknown>): void => {
    const fail = (err: unknown) =>
      console.error(JSON.stringify({ event: 'auth.hook_failed', hook: name, at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) }));
    try {
      const out = fn();
      if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).then(undefined, fail);
    } catch (err) {
      fail(err);
    }
  };
  /** The session, its cookie and the sign-in hook: one path for both ways in. */
  const signIn = async (req: Request, res: Response, user: { id: string; email: string }) => {
    const session = await createSession(db, user.id, config.sessionTtlDays);
    setSessionCookie(res, session.token, session.expiresAt, config.cookieSecure);
    res.json({ user: { id: user.id, email: user.email } });
    if (hooks.onSignedIn) runHook('onSignedIn', () => hooks.onSignedIn!({ id: user.id, email: user.email }, req, session.token));
  };
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
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const reserved = reserveAttempt(res, email);
    if (reserved === null) return undefined;
    let failed = false;
    try {
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
        failed = true;
        return res.status(401).json({ error: 'invalid email or password' });
      }
      if (await twoStepOn(db, user.id)) {
        // The right password, and two-step is on: no session yet, only a
        // short-lived challenge for POST /login/code.
        const at = now();
        await db.query('delete from sign_in_challenges where expires_at < $1', [new Date(at.getTime() - 86_400_000)]);
        const challenge = randomBytes(32).toString('base64url');
        await db.query(
          'insert into sign_in_challenges (user_id, token_hash, expires_at, created_at) values ($1, $2, $3, $4)',
          [user.id, tokenHash(challenge), new Date(at.getTime() + CHALLENGE_TTL_MS), at],
        );
        return res.json({ twoStep: true, challenge });
      }
      await signIn(req, res, user);
      return undefined;
    } catch (err) {
      return next(err);
    } finally {
      if (!failed) perAccount.release(email, reserved);
    }
  });

  // The code step: an authenticator code or a recovery code for a live
  // challenge. A wrong code is 401 (and counts for the account); an
  // unknown, expired, used or 5-times-wrong challenge is 410.
  router.post('/login/code', loginLimit, async (req, res, next) => {
    let reservation: { key: string; at: number } | null = null;
    let failed = false;
    try {
      const gone = () => res.status(410).json({ error: 'sign in again' });
      const challenge = String(req.body?.challenge ?? '');
      const code = String(req.body?.code ?? '');
      if (!challenge || challenge.length > 200) return gone();
      const at = now();
      const found = (
        await db.query<{ id: string; user_id: string; email: string; expires_at: string | Date; attempts: number }>(
          `select c.id, c.user_id, u.email, c.expires_at, c.attempts
           from sign_in_challenges c join users u on u.id = c.user_id
           where c.token_hash = $1`,
          [tokenHash(challenge)],
        )
      ).rows[0];
      if (!found) return gone();
      if (new Date(found.expires_at).getTime() <= at.getTime() || found.attempts >= CHALLENGE_MAX_ATTEMPTS) {
        await db.query('delete from sign_in_challenges where id = $1', [found.id]);
        return gone();
      }
      const key = found.email.toLowerCase();
      const reservedAt = reserveAttempt(res, key);
      if (reservedAt === null) return undefined;
      reservation = { key, at: reservedAt };
      // Claim the challenge itself, atomically, BEFORE the code is spent:
      // one conditional delete, so a racing second request finds nothing
      // and gets 410 with its code untouched. A wrong code puts the
      // challenge back with one more attempt counted (until the fifth).
      const claimed = (
        await db.query<{ token_hash: string; expires_at: string | Date; attempts: number; created_at: string | Date }>(
          `delete from sign_in_challenges
           where id = $1 and attempts < $2 and expires_at > $3
           returning token_hash, expires_at, attempts, created_at`,
          [found.id, CHALLENGE_MAX_ATTEMPTS, at],
        )
      ).rows[0];
      if (!claimed) return gone();
      const kind = await verifySecondFactor(db, found.user_id, code, at.getTime());
      if (!kind) {
        failed = true;
        const attempts = Number(claimed.attempts) + 1;
        if (attempts < CHALLENGE_MAX_ATTEMPTS) {
          await db.query(
            `insert into sign_in_challenges (id, user_id, token_hash, expires_at, attempts, created_at)
             values ($1, $2, $3, $4, $5, $6)`,
            [found.id, found.user_id, claimed.token_hash, claimed.expires_at, attempts, claimed.created_at],
          );
        }
        return res.status(401).json({ error: "that code didn't work" });
      }
      const user = { id: found.user_id, email: found.email };
      await signIn(req, res, user);
      if (kind === 'recovery' && hooks.onRecoveryUsed) {
        const onRecoveryUsed = hooks.onRecoveryUsed;
        runHook('onRecoveryUsed', async () => onRecoveryUsed(user, (await twoStepStatus(db, user.id)).recoveryLeft));
      }
      return undefined;
    } catch (err) {
      return next(err);
    } finally {
      if (reservation && !failed) perAccount.release(reservation.key, reservation.at);
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
      // A failed access lookup must never sign the writer out: the studio
      // boots on this answer. Say who they are, leave `access` out, log it.
      try {
        const found = await accountAccess({ db, config, billing: access.billing, now: access.now }, req.user.id);
        return res.json({ user: req.user, access: found ? accessSummary(found) : undefined });
      } catch (err) {
        console.log(JSON.stringify({ event: 'auth.me.access_failed', at: new Date().toISOString(), userId: req.user.id, error: err instanceof Error ? err.message : String(err) }));
        return res.json({ user: req.user });
      }
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
