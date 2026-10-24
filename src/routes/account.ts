import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer } from '../mailer.js';
import { hashPassword, verifyPassword } from '../password.js';
import { SlidingWindowLimiter } from '../rate-limit.js';
import {
  clearSessionCookie,
  readCookie,
  requireAuth,
  SESSION_COOKIE,
  tokenHash,
} from '../auth.js';

/**
 * P0 #5 account basics, mounted next to the M1 auth routes at /api/auth:
 *
 *   POST /forgot {email}              always the same 200 body for any
 *                                     well-formed address (no account
 *                                     enumeration); the token + email
 *                                     work happens after the response.
 *   POST /reset {token, password}     consumes a single-use token, sets
 *                                     a new argon2id hash, revokes EVERY
 *                                     session of that user.
 *   POST /password                    signed in; requires the current
 *        {currentPassword, newPassword}  password; revokes the user's
 *                                     OTHER sessions (this one stays).
 *   POST /sessions/revoke-all         signed in; revokes every session,
 *                                     including this one.
 *
 * Email verification on signup is deliberately NOT part of this unit.
 */

export const RESET_TOKEN_TTL_MINUTES = 60;
export const FORGOT_MESSAGE = 'If an account exists for that address, a reset link is on its way.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
/** Upper bound so a giant body can't make argon2 do unbounded work. */
const MAX_PASSWORD = 1024;

export interface AccountLimits {
  forgotPerIp: { max: number; windowMs: number };
  forgotPerEmail: { max: number; windowMs: number };
  resetPerIp: { max: number; windowMs: number };
  passwordPerUser: { max: number; windowMs: number };
}

export const DEFAULT_ACCOUNT_LIMITS: AccountLimits = {
  forgotPerIp: { max: 10, windowMs: 15 * 60_000 },
  forgotPerEmail: { max: 3, windowMs: 60 * 60_000 },
  resetPerIp: { max: 20, windowMs: 15 * 60_000 },
  passwordPerUser: { max: 10, windowMs: 15 * 60_000 },
};

/** Background work started after a response (forgot-password mail).
 *  Tests await idle() instead of sleeping. */
export class BackgroundTasks {
  private pending = new Set<Promise<void>>();
  run(fn: () => Promise<void>): void {
    const p = fn()
      .catch((err) => console.error('account background task failed', err))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
}

function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `password must be at least ${MIN_PASSWORD} characters`;
  if (password.length > MAX_PASSWORD) return `password must be at most ${MAX_PASSWORD} characters`;
  return null;
}

function resetEmail(config: Config, link: string): { subject: string; text: string; html: string } {
  const subject = 'Reset your Beuk password';
  const text = [
    'Someone (hopefully you) asked to reset the password for the Beuk account at this address.',
    '',
    `Choose a new password here — the link works once, for ${RESET_TOKEN_TTL_MINUTES} minutes:`,
    link,
    '',
    'Setting a new password signs you out everywhere, so sign in again afterwards.',
    "If you didn't ask for this, ignore this email — your password stays as it is.",
    '',
    `— Beuk (${config.appBaseUrl})`,
  ].join('\n');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p>Someone (hopefully you) asked to reset the password for the Beuk account at this address.</p>
<p><a href="${esc(link)}">Choose a new password</a> — the link works once, for ${RESET_TOKEN_TTL_MINUTES} minutes.</p>
<p>Setting a new password signs you out everywhere, so sign in again afterwards.</p>
<p>If you didn't ask for this, ignore this email — your password stays as it is.</p>`;
  return { subject, text, html };
}

export function accountRoutes(
  db: Db,
  config: Config,
  mailer: Mailer,
  tasks: BackgroundTasks,
  limits: AccountLimits = DEFAULT_ACCOUNT_LIMITS,
): Router {
  const router = Router();
  const forgotIp = new SlidingWindowLimiter(limits.forgotPerIp.max, limits.forgotPerIp.windowMs);
  const forgotEmail = new SlidingWindowLimiter(limits.forgotPerEmail.max, limits.forgotPerEmail.windowMs);
  const resetIp = new SlidingWindowLimiter(limits.resetPerIp.max, limits.resetPerIp.windowMs);
  const passwordUser = new SlidingWindowLimiter(limits.passwordPerUser.max, limits.passwordPerUser.windowMs);

  const tooMany = (res: Response, limiter: SlidingWindowLimiter, key: string) => {
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    return res.status(429).json({ error: 'too many attempts — please wait a little and try again' });
  };
  const ipOf = (req: Request) => req.ip ?? 'unknown';

  /** Issue a token and send (or honestly not send) the reset email. */
  const issueReset = async (email: string): Promise<void> => {
    const found = await db.query<{ id: string; email: string }>(
      'select id, email from users where email = $1',
      [email],
    );
    const user = found.rows[0];
    if (!user) return; // Unknown address: nothing to do, nothing to say.
    // Opportunistic tidy of long-dead tokens.
    await db.query(`delete from password_resets where expires_at < now() - interval '1 day'`);
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `insert into password_resets (user_id, token_hash, expires_at)
       values ($1, $2, now() + make_interval(mins => $3))`,
      [user.id, tokenHash(token), RESET_TOKEN_TTL_MINUTES],
    );
    const link = `${config.appBaseUrl}/reset?token=${encodeURIComponent(token)}`;
    const message = resetEmail(config, link);
    const result = await mailer.send({ to: user.email, ...message });
    if (!result.delivered && !result.loggedToConsole) {
      console.warn(`password reset requested but not emailed: ${result.reason}`);
    }
  };

  router.post('/forgot', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'please give a valid email address' });
    }
    const ip = ipOf(req);
    if (forgotIp.hit(ip)) return tooMany(res, forgotIp, ip);
    // Per-address limit: counted per ADDRESS (not per account), and
    // answered with the same 200 — so it neither enumerates accounts
    // nor lets anyone mail-bomb an inbox. Over the limit, nothing is sent.
    const overForAddress = forgotEmail.hit(email);
    const status = mailer.status();
    res.status(200).json({
      ok: true,
      message: FORGOT_MESSAGE,
      // Server-wide, identical for every address: whether this server
      // can send email at all. Lets the studio say so honestly.
      emailDelivery: status.configured ? 'email' : 'not-configured',
    });
    if (!overForAddress) tasks.run(() => issueReset(email));
    return undefined;
  });

  router.post('/reset', async (req, res, next) => {
    try {
      const ip = ipOf(req);
      if (resetIp.hit(ip)) return tooMany(res, resetIp, ip);
      const token = String(req.body?.token ?? '');
      const password = String(req.body?.password ?? '');
      const problem = passwordProblem(password);
      // Validate the password BEFORE touching the token, so a too-short
      // password does not burn a good link.
      if (problem) return res.status(400).json({ error: problem });
      if (!token || token.length > 200) {
        return res.status(400).json({ error: 'this reset link is invalid, already used, or expired — request a new one' });
      }
      const passwordHash = await hashPassword(password);
      const outcome = await db.tx(async (tx) => {
        // Atomic single-use consume: only an unused, unexpired row matches.
        const consumed = await tx.query<{ user_id: string }>(
          `update password_resets set used_at = now()
           where token_hash = $1 and used_at is null and expires_at > now()
           returning user_id`,
          [tokenHash(token)],
        );
        const row = consumed.rows[0];
        if (!row) return null;
        await tx.query('update users set password_hash = $1 where id = $2', [passwordHash, row.user_id]);
        const revoked = await tx.query<{ id: string }>(
          'delete from sessions where user_id = $1 returning id',
          [row.user_id],
        );
        // Any other outstanding links for this account die with it.
        await tx.query(
          'update password_resets set used_at = now() where user_id = $1 and used_at is null',
          [row.user_id],
        );
        return { sessionsRevoked: revoked.rows.length };
      });
      if (!outcome) {
        return res.status(400).json({ error: 'this reset link is invalid, already used, or expired — request a new one' });
      }
      clearSessionCookie(res, config.cookieSecure);
      return res.json({ ok: true, sessionsRevoked: outcome.sessionsRevoked });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/password', requireAuth(db), async (req, res, next) => {
    try {
      const user = req.user!;
      if (passwordUser.hit(user.id)) return tooMany(res, passwordUser, user.id);
      const currentPassword = String(req.body?.currentPassword ?? '');
      const newPassword = String(req.body?.newPassword ?? '');
      const problem = passwordProblem(newPassword);
      if (problem) return res.status(400).json({ error: problem });
      const found = await db.query<{ password_hash: string }>(
        'select password_hash from users where id = $1',
        [user.id],
      );
      const row = found.rows[0];
      // 403, not 401: the session is fine, the current password is not.
      if (!row || !(await verifyPassword(row.password_hash, currentPassword))) {
        return res.status(403).json({ error: 'current password is incorrect' });
      }
      const passwordHash = await hashPassword(newPassword);
      const currentHash = tokenHash(readCookie(req, SESSION_COOKIE) ?? '');
      const revoked = await db.tx(async (tx) => {
        await tx.query('update users set password_hash = $1 where id = $2', [passwordHash, user.id]);
        const others = await tx.query<{ id: string }>(
          'delete from sessions where user_id = $1 and token_hash <> $2 returning id',
          [user.id, currentHash],
        );
        await tx.query(
          'update password_resets set used_at = now() where user_id = $1 and used_at is null',
          [user.id],
        );
        return others.rows.length;
      });
      return res.json({ ok: true, otherSessionsRevoked: revoked });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/sessions/revoke-all', requireAuth(db), async (req, res, next) => {
    try {
      const revoked = await db.query<{ id: string }>(
        'delete from sessions where user_id = $1 returning id',
        [req.user!.id],
      );
      clearSessionCookie(res, config.cookieSecure);
      return res.json({ ok: true, revoked: revoked.rows.length });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
