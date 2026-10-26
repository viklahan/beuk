import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { Mailer, MailResult } from '../mailer.js';
import { CONFIRM_TOKEN_TTL_HOURS, confirmLink, issueConfirmation, sendSignupConfirmation } from '../account/confirm.js';
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
 * Price: V has decided a 7-day free trial from sign-up, then one price
 * for complete access. The amount is not decided. The email names a
 * price only when BILLING_PRICE_LABEL is set (the billing work's
 * setting) and then says exactly that label; otherwise it says "one
 * price, announced before launch". It never invents an amount.
 */

export interface WelcomeOptions {
  /** Billing can take payments on this server (checkout configured). */
  billingOn: boolean;
  /** BILLING_PRICE_LABEL, or null while it is unset. */
  priceLabel: string | null;
}

/** BILLING_PRICE_LABEL: from config when the billing work has added it
 *  there, otherwise from the environment. Blank counts as unset. */
export function priceLabel(config: Config, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromConfig = (config as Config & { billingPriceLabel?: string | null }).billingPriceLabel;
  if (fromConfig !== undefined) return fromConfig?.trim() || null;
  return env.BILLING_PRICE_LABEL?.trim() || null;
}

/** The plan in plain words, for the welcome email. */
export function trialWords(opts: WelcomeOptions): string {
  const after = opts.priceLabel
    ? `then ${opts.priceLabel} for complete access`
    : 'then one price for complete access, announced before launch';
  if (opts.billingOn) {
    return `Your 7-day free trial starts today, with this account, ${after}. Exporting your book stays open whatever happens with a plan.`;
  }
  return `Plans aren't switched on on this server yet, so everything in the studio is open to you. When they are, Beuk is a 7-day free trial, ${after}. Exporting your book stays open whatever happens with a plan.`;
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
  const trial = trialWords(opts);
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
      'Writing never needs an account. The studio keeps your book on your',
      'device first, and it works without signing in.',
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
${para('Writing never needs an account. The studio keeps your book on your device first, and it works without signing in.')}
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
  billingOn: boolean;
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
    priceLabel: priceLabel(config),
  });
  // email-kind: welcome
  const result = await mailer.send({ to: user.email, ...message });
  if (!result.delivered) console.warn(`welcome email not sent: ${result.reason}`);
  return { kind: 'welcome', result };
}
