import type { Db } from '../db.js';
import {
  base32Decode,
  codesEqual,
  newRecoveryCodes,
  recoveryHash,
  TOTP_WINDOW,
  totpCode,
  totpStep,
} from './totp.js';

/**
 * Two-step sign-in, the database parts (migration 025).
 *
 * user_two_step holds one row per account that started setup; it is on
 * once enabled_at is set. Every code check goes through
 * verifySecondFactor, which spends the code inside one transaction:
 * the row is locked (select … for update) and last_step only ever moves
 * up through a conditional update, so the same 6-digit code sent twice
 * at once gives one success and one refusal; a recovery code is spent
 * by a conditional update of used_at, so it too works once.
 */

export interface TwoStepStatus {
  on: boolean;
  since: string | null;
  recoveryLeft: number;
}

const SIX_DIGITS = /^\d{6}$/;

export interface VerifyOptions {
  /** Check against a setup that is still pending (enable), TOTP only. */
  pending?: boolean;
}

/**
 * Check and spend one second factor for an account: a 6-digit
 * authenticator code (steps −1, 0 and +1 around nowMs, only above
 * last_step) or a recovery code in any shape (case, spaces and dashes
 * ignored). Returns which kind matched, or null. Only an account whose
 * two-step is on is checked, unless opts.pending (then only a pending
 * setup, and only TOTP). Runs in its own transaction: never call it
 * inside another db.tx (use verifySecondFactorIn there).
 */
export async function verifySecondFactor(
  db: Db,
  userId: string,
  code: string,
  nowMs: number,
  opts: VerifyOptions = {},
): Promise<'totp' | 'recovery' | null> {
  return (await db.tx((tx) => verifySecondFactorIn(tx, userId, code, nowMs, opts)))?.kind ?? null;
}

/**
 * The same check inside a transaction the caller already holds. Also
 * returns the base32 secret the code was checked against, so a caller
 * that acts on the row afterwards (enable) can insist it is unchanged.
 */
export async function verifySecondFactorIn(
  tx: Db,
  userId: string,
  code: string,
  nowMs: number,
  opts: VerifyOptions = {},
): Promise<{ kind: 'totp' | 'recovery'; secret: string } | null> {
  const input = String(code ?? '').trim();
  if (!input || input.length > 64) return null;
  const digits = input.replace(/\s/g, '');
  const row = (
    await tx.query<{ secret: string; last_step: string | number; enabled_at: string | Date | null }>(
      'select secret, last_step, enabled_at from user_two_step where user_id = $1 for update',
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  const isOn = row.enabled_at !== null;
  if (opts.pending ? isOn : !isOn) return null;

  if (SIX_DIGITS.test(digits)) {
    const secret = base32Decode(row.secret);
    const last = Number(row.last_step);
    const current = totpStep(nowMs);
    let matched: number | null = null;
    for (const offset of TOTP_WINDOW) {
      const step = current + offset;
      if (step <= last) continue;
      if (codesEqual(totpCode(secret, step), digits)) matched = step;
    }
    if (matched === null) return null;
    // Conditional: a racing request that already moved last_step to (or
    // past) this step wins, and this one is refused; so does a secret
    // replaced since it was read.
    const moved = await tx.query(
      'update user_two_step set last_step = $2 where user_id = $1 and last_step < $2 and secret = $3 returning user_id',
      [userId, matched, row.secret],
    );
    return moved.rows.length ? { kind: 'totp', secret: row.secret } : null;
  }

  if (opts.pending) return null;
  const spent = await tx.query(
    `update two_step_recovery_codes set used_at = $3
     where user_id = $1 and code_hash = $2 and used_at is null returning id`,
    [userId, recoveryHash(input), new Date(nowMs)],
  );
  return spent.rows.length ? { kind: 'recovery', secret: row.secret } : null;
}

/** Whether two-step is on, since when, and how many recovery codes are unused. */
export async function twoStepStatus(db: Db, userId: string): Promise<TwoStepStatus> {
  const row = (
    await db.query<{ enabled_at: string | Date | null; unused: number }>(
      `select t.enabled_at,
              (select count(*)::int from two_step_recovery_codes r where r.user_id = t.user_id and r.used_at is null) as unused
       from user_two_step t where t.user_id = $1`,
      [userId],
    )
  ).rows[0];
  if (!row || row.enabled_at === null) return { on: false, since: null, recoveryLeft: 0 };
  return { on: true, since: new Date(row.enabled_at).toISOString(), recoveryLeft: Number(row.unused) };
}

/** Is two-step on for this account? */
export async function twoStepOn(db: Db, userId: string): Promise<boolean> {
  const r = await db.query('select 1 from user_two_step where user_id = $1 and enabled_at is not null', [userId]);
  return r.rows.length > 0;
}

/** Replace the account's recovery codes with a fresh set (inside the given db/tx). Returns the codes, shown once. */
export async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.query('delete from two_step_recovery_codes where user_id = $1', [userId]);
  for (const c of codes) {
    await db.query('insert into two_step_recovery_codes (user_id, code_hash) values ($1, $2)', [userId, recoveryHash(c)]);
  }
  return codes;
}

/** Remove everything two-step for one account (row, codes, pending challenges). True when it was on. */
export async function clearTwoStep(db: Db, userId: string): Promise<boolean> {
  return db.tx(async (tx) => {
    const gone = await tx.query<{ enabled_at: string | Date | null }>(
      'delete from user_two_step where user_id = $1 returning enabled_at',
      [userId],
    );
    await tx.query('delete from two_step_recovery_codes where user_id = $1', [userId]);
    await tx.query('delete from sign_in_challenges where user_id = $1', [userId]);
    return gone.rows.some((r) => r.enabled_at !== null);
  });
}

/**
 * Support's way out when a writer has lost both the phone and the
 * recovery codes (admin-cli.js two-step-off <email>), after checking who
 * is asking by hand. A password reset never does this.
 */
export async function turnTwoStepOff(db: Db, email: string): Promise<'turned off' | 'was off' | 'no such user'> {
  const user = (
    await db.query<{ id: string }>('select id from users where email = $1', [email.trim().toLowerCase()])
  ).rows[0];
  if (!user) return 'no such user';
  return (await clearTwoStep(db, user.id)) ? 'turned off' : 'was off';
}
