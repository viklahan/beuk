import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer } from '../mailer.js';
import { tokenHash } from '../auth.js';
import { accountUrl, html, link as linkTo, para, renderEmail, type RenderedEmail } from './layout.js';
import type { BackgroundTasks } from '../routes/account.js';

/**
 * The security emails (account hardening): a new sign-in from a device
 * label no other live session of the account has, two-step turned on,
 * two-step turned off, a recovery code used (with how many are left),
 * and new recovery codes made.
 *
 * Each says what happened and when (whenWords, the server clock in
 * UTC). Every one is sent through BackgroundTasks after the response: a
 * failure is logged there and never reaches the writer. Each says "If
 * this wasn't you, change your password and sign out everywhere" and
 * links to /account. Nothing is sent while email isn't configured
 * (there is no link in these to log for an operator).
 */

export const IF_NOT_YOU = "If this wasn't you, change your password and sign out everywhere.";

function body(config: Config, subject: string, lines: string[], reason: string): RenderedEmail {
  const url = accountUrl(config);
  return renderEmail(config, {
    subject,
    text: [...lines.flatMap((l) => [l, '']), IF_NOT_YOU, `Your account page: ${url}`],
    html: html`${lines.map((l) => para(l))}
${para(IF_NOT_YOU)}
${para(html`${linkTo(url, 'Open your account page')}`)}`,
    reason,
  });
}

/** "9 November 2026, 12:00 UTC". */
export function whenWords(at: Date): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function newSignInEmail(config: Config, label: string, at: Date): RenderedEmail {
  return body(
    config,
    'New sign-in to your Beuk account',
    [
      `Your Beuk account was just signed in to from ${label}, on ${whenWords(at)}.`,
      "If that was you, there's nothing to do.",
    ],
    'your Beuk account was signed in to from a device it isn\'t signed in to anywhere else',
  );
}

export function twoStepOnEmail(config: Config, at: Date): RenderedEmail {
  return body(
    config,
    'Two-step sign-in is on for your Beuk account',
    [
      `Two-step sign-in was turned on for your Beuk account on ${whenWords(at)}. From now on, signing in asks for a code from your authenticator app after your password.`,
      'Keep your recovery codes somewhere safe: each one signs you in once if you lose your phone.',
    ],
    'two-step sign-in was turned on for your Beuk account',
  );
}

export function twoStepOffEmail(config: Config, at: Date): RenderedEmail {
  return body(
    config,
    'Two-step sign-in is off for your Beuk account',
    [`Two-step sign-in was turned off for your Beuk account on ${whenWords(at)}. Signing in now needs only your password.`],
    'two-step sign-in was turned off for your Beuk account',
  );
}

export function recoveryLeftWords(left: number): string {
  if (left <= 0) return 'No recovery codes are left. Get new ones on your account page.';
  if (left === 1) return '1 recovery code is left.';
  return `${left} recovery codes are left.`;
}

export function recoveryUsedEmail(config: Config, left: number, at: Date): RenderedEmail {
  return body(
    config,
    'A recovery code was used on your Beuk account',
    [`A recovery code was used on your Beuk account on ${whenWords(at)}. Each code works once.`, recoveryLeftWords(left)],
    'a recovery code was used on your Beuk account',
  );
}

export function recoveryNewEmail(config: Config, at: Date): RenderedEmail {
  return body(
    config,
    'New recovery codes for your Beuk account',
    [`New recovery codes were made for your Beuk account on ${whenWords(at)}. The old ones no longer work.`],
    'new recovery codes were made for your Beuk account',
  );
}

export interface SecurityEmailDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  tasks: BackgroundTasks;
  now?: () => Date;
}

type User = { id: string; email: string };

export interface SecurityEmails {
  /** After a sign-in: mails only when no OTHER live session of the account has this session's label. */
  signedIn(user: User, sessionToken: string): void;
  twoStepOn(user: User): void;
  twoStepOff(user: User): void;
  recoveryUsed(user: User, left: number): void;
  recoveryNew(user: User): void;
}

export function securityEmails(deps: SecurityEmailDeps): SecurityEmails {
  const { db, config, mailer, tasks } = deps;
  const now = deps.now ?? (() => new Date());
  const on = () => mailer.status().configured;
  const warn = (kind: string, result: { delivered: boolean; reason?: string }) => {
    if (!result.delivered) console.warn(`${kind} email not sent: ${result.reason ?? 'unknown'}`);
  };

  return {
    signedIn(user, sessionToken) {
      if (!on()) return;
      // Only the hash is used: the raw token is never logged, mailed or stored.
      const hash = tokenHash(sessionToken);
      const at = now();
      tasks.run(async () => {
        const mine = (
          await db.query<{ id: string; label: string | null }>('select id, label from sessions where token_hash = $1', [hash])
        ).rows[0];
        if (!mine || !mine.label) return;
        const seen = await db.query(
          `select 1 from sessions
           where user_id = $1 and id <> $2 and label = $3 and expires_at > now() limit 1`,
          [user.id, mine.id, mine.label],
        );
        if (seen.rows.length) return;
        // email-kind: security-new-sign-in
        const result = await mailer.send({ to: user.email, ...newSignInEmail(config, mine.label, at) });
        warn('security-new-sign-in', result);
      });
    },
    twoStepOn(user) {
      if (!on()) return;
      const at = now();
      tasks.run(async () => {
        // email-kind: security-two-step-on
        const result = await mailer.send({ to: user.email, ...twoStepOnEmail(config, at) });
        warn('security-two-step-on', result);
      });
    },
    twoStepOff(user) {
      if (!on()) return;
      const at = now();
      tasks.run(async () => {
        // email-kind: security-two-step-off
        const result = await mailer.send({ to: user.email, ...twoStepOffEmail(config, at) });
        warn('security-two-step-off', result);
      });
    },
    recoveryUsed(user, left) {
      if (!on()) return;
      const at = now();
      tasks.run(async () => {
        // email-kind: security-recovery-used
        const result = await mailer.send({ to: user.email, ...recoveryUsedEmail(config, left, at) });
        warn('security-recovery-used', result);
      });
    },
    recoveryNew(user) {
      if (!on()) return;
      const at = now();
      tasks.run(async () => {
        // email-kind: security-recovery-new
        const result = await mailer.send({ to: user.email, ...recoveryNewEmail(config, at) });
        warn('security-recovery-new', result);
      });
    },
  };
}
