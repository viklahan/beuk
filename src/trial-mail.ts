import { accountAccess, billingSwitchedOn, PAUSABLE_FEATURES } from './access.js';
import type { BillingProvider } from './billing.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { humanDateTimeUtc } from './help/render-util.js';
import type { Mailer } from './mailer.js';
import { escapeHtml as esc } from './warmth/markdown.js';

/**
 * The trial-ending email: ONE message per account, TRIAL_REMINDER_DAYS
 * (default 3) before its trial ends. Sent from a timer in index.ts, and
 * only while BOTH email is configured (SMTP_URL + MAIL_FROM) and billing
 * is switched on; otherwise the tick does nothing and says why.
 *
 * Once means once: the account is claimed first (users.trial_reminder_
 * sent_at set where it is still null), then the message is sent. When the
 * mail server does not accept it, the claim is released, so a later tick
 * tries again; a delivered message is never sent twice. Accounts that
 * already have a plan (active, trialing or past_due in grace) get nothing.
 *
 * Self-contained on purpose (plain text + a small HTML body): the email
 * layout helper being built in parallel can take it over later.
 */

export interface TrialReminderDeps {
  db: Db;
  config: Config;
  billing: BillingProvider;
  mailer: Mailer;
  now: () => Date;
}

export interface TrialTickResult {
  ran: boolean;
  /** Why the tick did nothing (email off, billing off, reminders off). */
  skipped: string | null;
  sent: number;
  failed: number;
}

const BATCH = 200;
const DAY_MS = 86_400_000;

export function trialEndingMessage(
  config: Config,
  to: string,
  endsAt: string,
): { to: string; subject: string; text: string; html: string } {
  const when = humanDateTimeUtc(endsAt);
  const account = `${config.appBaseUrl}/account`;
  const price = config.billingPriceLabel ? ` One plan, ${config.billingPriceLabel}, opens everything.` : '';
  const paused = Object.values(PAUSABLE_FEATURES).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const open =
    'Writing in the studio, the books already on your shelf (they keep saving), every export, your archive downloads and the reading links you already have all stay open.';
  const text = [
    'Hello,',
    '',
    `Your free trial of Beuk ends on ${when}.`,
    '',
    `To keep everything your account does, you can choose a plan on your account page: ${account}${price}`,
    '',
    `If you don't, nothing you wrote goes anywhere. ${open} What pauses is ${paused}.`,
    '',
    'Beuk',
    '',
    'This message is sent once, because your trial is ending.',
  ].join('\n');
  const html = `<p>Hello,</p>
<p>Your free trial of Beuk ends on ${esc(when)}.</p>
<p>To keep everything your account does, you can choose a plan on <a href="${esc(account)}">your account page</a>.${esc(price)}</p>
<p>If you don’t, nothing you wrote goes anywhere. ${esc(open)} What pauses is ${esc(paused)}.</p>
<p>Beuk</p>
<p style="color:#666;font-size:90%">This message is sent once, because your trial is ending.</p>`;
  return { to, subject: `Your Beuk trial ends on ${when}`, text, html };
}

export class TrialReminders {
  constructor(private deps: TrialReminderDeps) {}

  /** Why reminders cannot go out now, or null when they can. */
  blockedReason(): string | null {
    if (this.deps.config.trialReminderDays === 0) return 'trial reminders are off (TRIAL_REMINDER_DAYS=0)';
    if (!billingSwitchedOn(this.deps.config, this.deps.billing)) return 'billing is not switched on';
    if (!this.deps.mailer.status().configured) return "email isn't set up on this server";
    return null;
  }

  async tick(): Promise<TrialTickResult> {
    const skipped = this.blockedReason();
    if (skipped) return { ran: false, skipped, sent: 0, failed: 0 };
    const { db, config } = this.deps;
    const now = this.deps.now();
    const until = new Date(now.getTime() + config.trialReminderDays * DAY_MS);
    const due = await db.query<{ id: string; email: string }>(
      `select id, email from users
       where trial_reminder_sent_at is null
         and coalesce(trial_ends_at, created_at + make_interval(days => $3::int)) > $1
         and coalesce(trial_ends_at, created_at + make_interval(days => $3::int)) <= $2
       order by created_at limit ${BATCH}`,
      [now, until, config.trialDays],
    );
    let sent = 0;
    let failed = 0;
    for (const u of due.rows) {
      const access = await accountAccess(this.deps, u.id);
      if (!access || access.state !== 'trial') continue; // a plan already, or not in a trial
      const claim = await db.query<{ id: string }>(
        'update users set trial_reminder_sent_at = $2 where id = $1 and trial_reminder_sent_at is null returning id',
        [u.id, now],
      );
      if (!claim.rows.length) continue;
      const result = await this.deps.mailer.send(trialEndingMessage(config, u.email, access.trial.endsAt));
      if (result.delivered) {
        sent++;
        continue;
      }
      failed++;
      await db.query('update users set trial_reminder_sent_at = null where id = $1', [u.id]);
      // The mail server is refusing: stop here and try again next tick.
      console.warn(`trial reminder not sent: ${result.reason}`);
      break;
    }
    return { ran: true, skipped: null, sent, failed };
  }
}
