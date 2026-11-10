import { Router, type Response } from 'express';
import QRCode from 'qrcode';
import { requireAuth } from '../auth.js';
import type { Db } from '../db.js';
import { verifyPassword } from '../password.js';
import { SlidingWindowLimiter } from '../rate-limit.js';
import { clearTwoStep, replaceRecoveryCodes, twoStepOn, verifySecondFactor, verifySecondFactorIn } from '../twostep/store.js';
import { newTotpSecret, otpauthUri } from '../twostep/totp.js';

/**
 * Two-step sign-in, turning it on and off (account hardening, migration
 * 025). Signed in, mounted at /api/account/two-step:
 *
 *   POST /start {currentPassword}           → {secret, otpauthUri, qrSvg}; replaces any pending
 *                                             setup; 409 when already on (pausable: twoStep.setup)
 *   POST /enable {code}                     → {recoveryCodes:[10]}; 400 wrong code, 409 no pending
 *                                             setup (pausable: twoStep.setup)
 *   POST /disable {currentPassword, code}   → {ok:true}; deletes the row and the codes (never paused)
 *   POST /recovery-codes {currentPassword, code}
 *                                           → {recoveryCodes}; the old set dies (never paused)
 *
 * The password check answers 403 "current password is incorrect", as
 * /api/auth/password does. Each route allows 10 calls per account per
 * 15 minutes. Turning two-step on does not sign other devices out.
 * The QR code is an inline <svg> string made here (no script, no data:
 * image, so no CSP change).
 */

export interface TwoStepLimits {
  perUser: { max: number; windowMs: number };
}

export const DEFAULT_TWO_STEP_LIMITS: TwoStepLimits = {
  perUser: { max: 10, windowMs: 15 * 60_000 },
};

export interface TwoStepDeps {
  db: Db;
  now?: () => Date;
  limits?: TwoStepLimits;
}

const WRONG_CODE = "that code didn't work";
const MAX_PASSWORD = 1024;

export function twoStepRoutes(deps: TwoStepDeps): Router {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const limits = deps.limits ?? DEFAULT_TWO_STEP_LIMITS;
  const limiter = () => new SlidingWindowLimiter(limits.perUser.max, limits.perUser.windowMs, () => now().getTime());
  const startLimit = limiter();
  const enableLimit = limiter();
  const disableLimit = limiter();
  const codesLimit = limiter();

  const router = Router();
  router.use(requireAuth(db));

  const tooMany = (res: Response, l: SlidingWindowLimiter, key: string) => {
    res.setHeader('Retry-After', String(l.retryAfterSeconds(key)));
    return res.status(429).json({ error: 'too many attempts — please wait a little and try again' });
  };

  /** The account's current password, checked; false answers 403. */
  const passwordOk = async (userId: string, given: unknown): Promise<boolean> => {
    const password = String(given ?? '');
    if (!password || password.length > MAX_PASSWORD) return false;
    const row = (await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId])).rows[0];
    return Boolean(row) && (await verifyPassword(row.password_hash, password));
  };
  const badPassword = (res: Response) => res.status(403).json({ error: 'current password is incorrect' });

  router.post('/start', async (req, res, next) => {
    try {
      const user = req.user!;
      if (startLimit.hit(user.id)) return tooMany(res, startLimit, user.id);
      if (!(await passwordOk(user.id, req.body?.currentPassword))) return badPassword(res);
      if (await twoStepOn(db, user.id)) return res.status(409).json({ error: 'two-step sign-in is already on' });
      const secret = newTotpSecret();
      // A new start replaces a pending setup (and its last_step).
      await db.query(
        `insert into user_two_step (user_id, secret, enabled_at, last_step, created_at)
         values ($1, $2, null, 0, $3)
         on conflict (user_id) do update set secret = excluded.secret, last_step = 0, created_at = excluded.created_at
         where user_two_step.enabled_at is null`,
        [user.id, secret, now()],
      );
      const uri = otpauthUri(user.email, secret);
      const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return res.json({ secret, otpauthUri: uri, qrSvg });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/enable', async (req, res, next) => {
    try {
      const user = req.user!;
      if (enableLimit.hit(user.id)) return tooMany(res, enableLimit, user.id);
      const row = (
        await db.query<{ enabled_at: string | Date | null }>('select enabled_at from user_two_step where user_id = $1', [user.id])
      ).rows[0];
      if (!row) return res.status(409).json({ error: 'start turning on two-step sign-in first' });
      if (row.enabled_at !== null) return res.status(409).json({ error: 'two-step sign-in is already on' });
      const at = now();
      // One transaction: check the code against the pending secret and
      // switch on exactly that secret. A /start from another tab that
      // replaced it in between makes the switch match nothing.
      const outcome = await db.tx(async (tx) => {
        const checked = await verifySecondFactorIn(tx, user.id, String(req.body?.code ?? ''), at.getTime(), { pending: true });
        if (!checked) return { wrong: true as const };
        const turned = await tx.query(
          'update user_two_step set enabled_at = $2 where user_id = $1 and enabled_at is null and secret = $3 returning user_id',
          [user.id, at, checked.secret],
        );
        if (!turned.rows.length) return { conflict: true as const };
        return { codes: await replaceRecoveryCodes(tx, user.id) };
      });
      if ('wrong' in outcome) return res.status(400).json({ error: WRONG_CODE });
      if ('conflict' in outcome) return res.status(409).json({ error: 'two-step sign-in changed in another tab — start again' });
      return res.json({ recoveryCodes: outcome.codes });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/disable', async (req, res, next) => {
    try {
      const user = req.user!;
      if (disableLimit.hit(user.id)) return tooMany(res, disableLimit, user.id);
      if (!(await passwordOk(user.id, req.body?.currentPassword))) return badPassword(res);
      if (!(await twoStepOn(db, user.id))) return res.status(409).json({ error: 'two-step sign-in is off' });
      const kind = await verifySecondFactor(db, user.id, String(req.body?.code ?? ''), now().getTime());
      if (!kind) return res.status(400).json({ error: WRONG_CODE });
      await clearTwoStep(db, user.id);
      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/recovery-codes', async (req, res, next) => {
    try {
      const user = req.user!;
      if (codesLimit.hit(user.id)) return tooMany(res, codesLimit, user.id);
      if (!(await passwordOk(user.id, req.body?.currentPassword))) return badPassword(res);
      if (!(await twoStepOn(db, user.id))) return res.status(409).json({ error: 'two-step sign-in is off' });
      const kind = await verifySecondFactor(db, user.id, String(req.body?.code ?? ''), now().getTime());
      if (!kind) return res.status(400).json({ error: WRONG_CODE });
      const codes = await db.tx((tx) => replaceRecoveryCodes(tx, user.id));
      return res.json({ recoveryCodes: codes });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
