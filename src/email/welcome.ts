import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer, MailResult } from '../mailer.js';
import { CONFIRM_TOKEN_TTL_HOURS, confirmLink, issueConfirmation, sendSignupConfirmation } from '../account/confirm.js';
import type { AccountTrial } from '../account/plan.js';
import { humanDate } from '../help/render-util.js';
import { html, link, para, renderEmail, type RenderedEmail } from './layout.js';

/**
 * The welcome email, sent once, right after sign-up.
 *
 * Decision: the welcome and the confirmation link are ONE email. A new
 * writer gets a single message that says what the account adds and
 * carries the link, instead of two messages in the same second. "Send
 * the link again" on the account page sends the plain confirmation
 * (src/account/confirm.ts), never a second welcome.
 *
 * Only when mail is configured. On a server without SMTP_URL /
 * MAIL_FROM nothing is sent at all; the sign-up confirmation is written
 * to the server console as before (MAIL_LOG_LINKS) so a local operator
 * can still finish the flow, and the register response says
 * emailDelivery: "not-configured".
 *
 * Price: V has decided a 21-day free trial from sign-up, then one price
 * for complete access. The amount is not decided. The email names a
 * price only when BILLING_PRICE_LABEL is set (the billing work's
 * setting) and then says exactly that label; otherwise it says "one
 * price for complete access". It never invents an amount.
 *
 * Plan state comes from the SAME place as the account page's Plan
 * section: accountPlan() in src/account/plan.ts. `billingOn` is its
 * `billingConfigured` (checkout configured AND the entitlements file
 * loads), and `trial` is its `trial`. The email says a trial has started
 * only when the server tracks one (plan.trial non-null, active); until
 * the billing work adds that clock, plan.trial is null and the email
 * does not mention a trial at all while plans are on, so it can never
 * promise something the account page does not show.
 */

export interface WelcomeOptions {
  /** AccountPlan.billingConfigured: the account page's "plans are on". */
  billingOn: boolean;
  /** AccountPlan.trial: the sign-up trial as this server tracks it; null
   *  while the server does not track one. */
  trial: AccountTrial | null;
  /** BILLING_PRICE_LABEL, or null while it is unset. */
  priceLabel: string | null;
}

/** BILLING_PRICE_LABEL, as Config read it (src/config.ts). Blank counts as
 *  unset. The second argument is kept for callers and tests; Config wins. */
export function priceLabel(config: Config, _env: NodeJS.ProcessEnv = process.env): string | null {
  return config.billingPriceLabel?.trim() || null;
}

/** The plan in plain words, for the welcome email. */
export function trialWords(opts: WelcomeOptions, trialDays: number): string {
  const after = opts.priceLabel
    ? `then ${opts.priceLabel} for complete access`
    : 'then one price for complete access';
  const ownWords = 'Whatever happens with a plan, your own words stay yours: the backup file, Word and Markdown stay open.';
  if (opts.billingOn && opts.trial?.active) {
    // The trial's own length (TRIAL_DAYS when it started), never a literal.
    const days = Math.max(1, Math.round((Date.parse(opts.trial.endsAt) - Date.parse(opts.trial.startedAt)) / 86_400_000));
    return `Your ${days}-day free trial started with this account and runs until ${humanDate(opts.trial.endsAt)}, ${after}. ${ownWords}`;
  }
  if (opts.billingOn) {
    // Plans are on but this server does not track a trial: say nothing
    // about one. The account page then says "no subscription" too.
    const price = opts.priceLabel ? `${opts.priceLabel} for complete access` : 'one price for complete access';
    return `Beuk is ${price}. Your account page shows your plan. ${ownWords}`;
  }
  return `Plans aren't switched on on this server yet, so everything in the studio is open to you. When they are, Beuk is a ${trialDays}-day free trial, ${after}. ${ownWords}`;
}

export function welcomeEmail(config: Config, confirmUrl: string, opts: WelcomeOptions): RenderedEmail {
  const help = `${config.appBaseUrl}/help/`;
  const account = `${config.appBaseUrl}/account`;
  const adds = [
    'a shelf, so your books follow you to any device you sign in on',
    'an archive for your finished EPUB and print files',
    'links for beta readers, who read and comment without an account',
    "the server's checks: EPUBCheck for an EPUB, and a PDF/X file for print",
  ];
  const trial = trialWords(opts, config.trialDays);
  return renderEmail(config, {
    subject: 'Confirm your email address, and welcome to Beuk',
    text: [
      'Welcome to Beuk. Your account is ready.',
      '',
      'To confirm that this is your address, open this link',
      `(it works once, for ${CONFIRM_TOKEN_TTL_HOURS} hours):`,
      confirmUrl,
      'Your shelf works whether or not you confirm. Confirming means a',
      'password-reset email can reach you if you ever need one.',
      '',
      'What the account adds:',
      ...adds.map((a) => `- ${a}`),
      '',
      'The studio keeps your book on your device first, and your shelf',
      'follows you to any device you sign in on.',
      '',
      trial,
      '',
      `Help, with a guide for each part of the studio: ${help}`,
      `Your account page: ${account}`,
      '',
      "If you didn't create a Beuk account, ignore this email.",
    ],
    html: html`${para('Welcome to Beuk. Your account is ready.')}
${para(html`To confirm that this is your address, ${link(confirmUrl, 'open this link')} — it works once, for ${CONFIRM_TOKEN_TTL_HOURS} hours. Your shelf works whether or not you confirm. Confirming means a password-reset email can reach you if you ever need one.`)}
${para('What the account adds:')}
<ul style="margin:0 0 14px;padding-left:22px;">${adds.map((a) => html`<li>${a}</li>`)}</ul>
${para('The studio keeps your book on your device first, and your shelf follows you to any device you sign in on.')}
${para(trial)}
${para(html`${link(help, 'Help')} has a guide for each part of the studio, and ${link(account, 'your account page')} shows your shelf, archive and reading links in one place.`)}
${para("If you didn't create a Beuk account, ignore this email.")}`,
    reason: 'a Beuk account was created with this address',
  });
}

export interface SignupEmailDeps {
  db: Db;
  config: Config;
  mailer: Mailer;
  /** From accountPlan(): see WelcomeOptions. */
  billingOn: boolean;
  trial: AccountTrial | null;
}

/**
 * The one email a sign-up causes. Called once, from the register hook.
 * Mail configured: the welcome (with the confirmation link inside).
 * Not configured: the plain confirmation, which the console mailer logs
 * or drops and never reports as sent.
 */
export async function sendSignupEmail(
  deps: SignupEmailDeps,
  user: { id: string; email: string },
): Promise<{ kind: 'welcome' | 'signup-confirm'; result: MailResult }> {
  const { db, config, mailer } = deps;
  if (!mailer.status().configured) {
    return { kind: 'signup-confirm', result: await sendSignupConfirmation(db, config, mailer, user) };
  }
  const token = await issueConfirmation(db, user.id, 'signup', user.email);
  const message = welcomeEmail(config, confirmLink(config, token), {
    billingOn: deps.billingOn,
    trial: deps.trial,
    priceLabel: priceLabel(config),
  });
  // email-kind: welcome
  const result = await mailer.send({ to: user.email, ...message });
  if (!result.delivered) console.warn(`welcome email not sent: ${result.reason}`);
  return { kind: 'welcome', result };
}
