import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer, MailResult } from '../mailer.js';
import { tokenHash } from '../auth.js';
import { html, link as linkTo, para, renderEmail } from '../email/layout.js';

/**
 * Email confirmation (sign-up) and change of email.
 *
 * Tokens are 32 random bytes, base64url, only ever in the emailed link;
 * the database keeps their SHA-256 (email_confirmations.token_hash),
 * exactly like password resets. Single-use, expiring.
 *
 * Following a link never requires being signed in: the token is the
 * proof. The confirm page (GET /account/confirm) shows a button that
 * POSTs the token, so a mail scanner that fetches every link in a
 * message does not use it up by looking.
 */

export const CONFIRM_TOKEN_TTL_HOURS = 48;

export function confirmLink(config: Config, token: string): string {
  return `${config.appBaseUrl}/account/confirm?token=${encodeURIComponent(token)}`;
}

/** The sign-up confirmation on its own: "Send the link again", and the
 *  sign-up email on a server without mail (where it is only logged). */
export function signupConfirmEmail(config: Config, link: string) {
  // email-layout: same words as before the shared layout; the "— Beuk
  // (<site>)" sign-off became the layout's footer.
  return renderEmail(config, {
    subject: 'Confirm your email address for Beuk',
    text: [
      'Welcome to Beuk. To confirm that this is your address, open this link',
      `(it works once, for ${CONFIRM_TOKEN_TTL_HOURS} hours):`,
      link,
      '',
      'Your shelf works whether or not you confirm. Confirming means a',
      'password-reset email can reach you if you ever need one.',
      "If you didn't create a Beuk account, ignore this email.",
    ],
    html: html`${para(html`Welcome to Beuk. To confirm that this is your address, ${linkTo(link, 'open this link')} — it works once, for ${CONFIRM_TOKEN_TTL_HOURS} hours.`)}
${para('Your shelf works whether or not you confirm. Confirming means a password-reset email can reach you if you ever need one.')}
${para("If you didn't create a Beuk account, ignore this email.")}`,
    reason: 'a Beuk account was created with this address',
  });
}

export function changeConfirmEmail(config: Config, link: string, oldEmail: string) {
  return renderEmail(config, {
    subject: 'Confirm your new email address for Beuk',
    text: [
      `Someone signed in to the Beuk account ${oldEmail} asked to move it to this address.`,
      `To make the change, open this link (it works once, for ${CONFIRM_TOKEN_TTL_HOURS} hours):`,
      link,
      '',
      'Until then the account keeps its old address.',
      "If you didn't ask for this, ignore this email and nothing changes.",
    ],
    html: html`${para(html`Someone signed in to the Beuk account ${oldEmail} asked to move it to this address.`)}
${para(html`${linkTo(link, 'Confirm the new address')} — the link works once, for ${CONFIRM_TOKEN_TTL_HOURS} hours. Until then the account keeps its old address.`)}
${para("If you didn't ask for this, ignore this email and nothing changes.")}`,
    reason: 'someone asked to move a Beuk account to this address',
  });
}

export function changeNoticeEmail(config: Config, newEmail: string) {
  return renderEmail(config, {
    subject: 'Your Beuk email address is about to change',
    text: [
      `Someone signed in to your Beuk account asked to move it to ${newEmail}.`,
      'The change happens only when a link sent to that new address is opened.',
      '',
      'If this was you, there is nothing to do here.',
      'If it was not you, sign in, change your password and use',
      '"Sign out everywhere" on your account page:',
      `${config.appBaseUrl}/account`,
      'A pending change can also be cancelled there.',
    ],
    html: html`${para(html`Someone signed in to your Beuk account asked to move it to ${newEmail}. The change happens only when a link sent to that new address is opened.`)}
${para(html`If this was you, there is nothing to do here. If it was not you, sign in, change your password and use “Sign out everywhere” on ${linkTo(`${config.appBaseUrl}/account`, 'your account page')}, where a pending change can also be cancelled.`)}`,
    reason: 'this is the address on a Beuk account, and a change of address was asked for',
  });
}

/** Make a token row and return the token (never stored). */
export async function issueConfirmation(
  db: Db,
  userId: string,
  purpose: 'signup' | 'change',
  email: string,
): Promise<string> {
  // Opportunistic tidy of long-dead links, as password resets do.
  await db.query(`delete from email_confirmations where expires_at < now() - interval '7 days'`);
  // One live link per purpose: a new one retires the old ones.
  await db.query(
    `update email_confirmations set used_at = now()
     where user_id = $1 and purpose = $2 and used_at is null`,
    [userId, purpose],
  );
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `insert into email_confirmations (user_id, purpose, email, token_hash, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [userId, purpose, email, tokenHash(token), CONFIRM_TOKEN_TTL_HOURS],
  );
  return token;
}

export async function sendSignupConfirmation(
  db: Db,
  config: Config,
  mailer: Mailer,
  user: { id: string; email: string },
): Promise<MailResult> {
  const token = await issueConfirmation(db, user.id, 'signup', user.email);
  // email-kind: signup-confirm
  const result = await mailer.send({ to: user.email, ...signupConfirmEmail(config, confirmLink(config, token)) });
  if (!result.delivered && !result.loggedToConsole) console.warn(`email confirmation not emailed: ${result.reason}`);
  return result;
}

export type ConfirmOutcome =
  | { ok: true; purpose: 'signup'; email: string }
  | { ok: true; purpose: 'change'; email: string; previousEmail: string }
  | { ok: false; reason: 'invalid' | 'taken' };

/** Consume a token. A change link re-checks the new address is still free. */
export async function consumeConfirmation(db: Db, token: string): Promise<ConfirmOutcome> {
  if (!token || token.length > 200) return { ok: false, reason: 'invalid' };
  return db.tx(async (tx) => {
    const row = (
      await tx.query<{ id: string; user_id: string; purpose: 'signup' | 'change'; email: string }>(
        `update email_confirmations set used_at = now()
         where token_hash = $1 and used_at is null and expires_at > now()
         returning id, user_id, purpose, email`,
        [tokenHash(token)],
      )
    ).rows[0];
    if (!row) return { ok: false as const, reason: 'invalid' as const };
    const user = (await tx.query<{ email: string }>('select email from users where id = $1', [row.user_id])).rows[0];
    if (!user) return { ok: false as const, reason: 'invalid' as const };
    if (row.purpose === 'signup') {
      // A sign-up link confirms the address it was sent to, and only
      // while the account still has that address.
      if (user.email !== row.email) return { ok: false as const, reason: 'invalid' as const };
      await tx.query('update users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1', [row.user_id]);
      return { ok: true as const, purpose: 'signup' as const, email: row.email };
    }
    const taken = await tx.query('select 1 from users where email = $1 and id <> $2', [row.email, row.user_id]);
    if (taken.rows.length) return { ok: false as const, reason: 'taken' as const };
    await tx.query('update users set email = $1, email_confirmed_at = now() where id = $2', [row.email, row.user_id]);
    // Any other outstanding links for this account die with the old address.
    await tx.query('update email_confirmations set used_at = now() where user_id = $1 and used_at is null', [row.user_id]);
    // A reset link sent to the old address must not outlive the move.
    await tx.query('update password_resets set used_at = now() where user_id = $1 and used_at is null', [row.user_id]);
    return { ok: true as const, purpose: 'change' as const, email: row.email, previousEmail: user.email };
  });
}
