import { PAUSABLE_FEATURES } from '../access.js';
import type { Config } from '../config.js';
import type { TwoStepStatus } from '../twostep/store.js';
import { humanDate, humanDateTimeUtc } from '../help/render-util.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import { BRAND_FOOTNOTE, BRAND_SUBLINE, LEGAL_LINKS_HTML } from '../warmth/pages.js';
import type { AccountOverview } from './data.js';
import type { AccountPlan } from './plan.js';

/**
 * The account page, /account — "your typesetting portal". Server-
 * rendered in the Paper style of the Help and warmth pages
 * (client/help/warmth.css) plus client/account/account.css. Everything
 * is readable with JavaScript off; client/account/account.js only sends
 * the forms (change email/password, sign out everywhere, resend the
 * confirmation link, delete) to the JSON API and says what happened.
 */

export const DELETE_PHRASE = 'delete my account';

const FORMAT_NAMES: Record<string, string> = {
  epub: 'EPUB',
  markdown: 'Markdown',
  html: 'HTML',
  'print-html': 'Print HTML',
  docx: 'Word',
  pdfx: 'PDF/X',
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const num = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

export function portalChrome(config: Config, title: string, body: string, opts: { signedIn: boolean; script?: boolean }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <meta name="referrer" content="no-referrer" />
    <title>${esc(title)} — Beuk</title>
    <link rel="preload" href="/assets/fonts/literata/literata-latin-normal-400_500_600_700.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/assets/fonts/fonts.css" />
    <link rel="stylesheet" href="/assets/fonts/fonts-help.css" />
    <link rel="stylesheet" href="/help/warmth.css" />
    <link rel="stylesheet" href="/account/account.css" />
  </head>
  <body>
    <header class="site-head">
      <a class="wordmark" href="/">beuk</a>
      <span class="subbrand">${esc(BRAND_SUBLINE)}</span>
      <nav class="site-nav">
        <a href="/studio">Studio</a>
        <a href="/help/">Help</a>
        ${opts.signedIn ? '<a href="/account">Your account</a>' : ''}
      </nav>
    </header>
    <main class="page portal">
${body}
    </main>
    <footer class="site-foot">
      <p class="foot-note">${esc(BRAND_FOOTNOTE)}</p>
      <p class="foot-links">${supportFootLink(config)}${LEGAL_LINKS_HTML}</p>
    </footer>
    ${opts.script ? '<script src="/account/account.js" defer></script>' : ''}
  </body>
</html>
`;
}

/** The support address in the footer, as Help's footer has it. Nothing
 *  at all while SUPPORT_EMAIL is unset: no empty mailto, no promise. */
function supportFootLink(config: Config): string {
  if (!config.supportEmail) return '';
  return `<a href="mailto:${esc(config.supportEmail)}" data-support-email>${esc(config.supportEmail)}</a> · `;
}

/** The account page's Help card: Help always; the address only when set. */
export function helpSection(config: Config): string {
  const write = config.supportEmail
    ? ` If something on this page looks wrong, or you are stuck, write to <a href="mailto:${esc(config.supportEmail)}" data-support-email>${esc(config.supportEmail)}</a>.`
    : '';
  return `<section class="portal-card" id="help" aria-labelledby="help-h">
        <h2 id="help-h">Help</h2>
        <p><a href="/help/">Help</a> has a guide for each part of the studio and the account.${write}</p>
      </section>`;
}

export function signedOutPage(config: Config): string {
  const body = `      <p class="kicker">Your typesetting portal</p>
      <h1>Your account</h1>
      <p class="lede">Sign in to see your shelf, your export archive and your account settings in one place.</p>
      <p class="portal-actions">
        <a class="portal-button" href="/studio?signin">Sign in</a>
        <a class="portal-button quiet" href="/studio?signup">Create an account</a>
      </p>
      <p class="muted">An account gives you a shelf that follows you to any device, an archive for your finished files, and links for beta readers.</p>`;
  return portalChrome(config, 'Your account', body, { signedIn: false });
}

/** What pauses after the trial, and what never does (src/access.ts). */
const PAUSED_LIST = 'the store-ready EPUB, the print PDF, the cover wrap, adding new books to your shelf, new beta-reader links, server EPUBCheck and PDF/X checks, and saving new files to your archive';
const ALWAYS_OPEN = 'Writing, typesetting and preview, the books already on your shelf (they keep saving), the backup file, Word and Markdown, your archive downloads, the reading links you already have, Download all my data, and deleting your account';

function planSection(plan: AccountPlan, billingReturn: 'success' | 'cancelled' | null): string {
  const s = plan.subscription;
  const lines: string[] = [];
  const upgrade = '<button class="portal-button" type="button" data-action="upgrade">Choose a plan</button>';
  const manage = '<button class="portal-button quiet" type="button" data-action="manage">Manage billing</button>';
  const buttons: string[] = [];
  const price = plan.priceLabel ? ` One plan, ${esc(plan.priceLabel)}, opens everything.` : '';

  if (!plan.billingConfigured) {
    // Billing off: no trial, no price, nothing paused (as before).
    if (s.status !== 'none') {
      lines.push(`<p><b>${s.label ? esc(s.label) : 'Your subscription'}</b>: Stripe says “${esc(s.status)}”.</p>`);
    }
    lines.push('<p>Plans are not switched on on this server yet. Everything in the studio is open to you.</p>');
  } else {
    if (billingReturn === 'success') {
      lines.push('<p class="note-line" data-billing-return="success">Thank you. Stripe is confirming the payment; this section shows your plan as soon as it has. Reload the page in a moment.</p>');
    } else if (billingReturn === 'cancelled') {
      lines.push('<p class="muted" data-billing-return="cancelled">No plan was chosen and nothing was charged.</p>');
    }
    switch (plan.access) {
      case 'subscribed': {
        const label = s.label ? esc(s.label) : 'Your plan';
        lines.push(`<p><b>${label}</b>: active${s.status === 'trialing' ? ' (the first payment is taken when your trial ends)' : ''}. Everything is open to you.</p>`);
        if (s.renewsAt) {
          lines.push(`<p class="muted">${s.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on ${esc(humanDate(s.renewsAt))}.</p>`);
        }
        break;
      }
      case 'grace':
        lines.push(
          `<p class="note-line" data-plan-notice="past-due">The last payment didn’t go through. Stripe will try the card again, and everything stays open until ${esc(humanDate(s.graceEndsAt!))}. You can change the card under Manage billing.</p>`,
        );
        break;
      case 'trial':
        if (plan.trial) {
          const left = plan.trial.daysLeft;
          lines.push(
            `<p>Your free trial runs until ${esc(humanDate(plan.trial.endsAt))}: ${left} ${left === 1 ? 'day' : 'days'} left. Everything is open to you.${price}</p>`,
          );
          lines.push(
            `<p class="muted">After the trial, without a plan, ${PAUSED_LIST} pause. ${ALWAYS_OPEN} stay open.${plan.firstChargeWaits ? ' If you choose a plan now, the first payment waits until your trial ends.' : ''}</p>`,
          );
        }
        break;
      case 'paused':
        lines.push(
          `<p class="note-line" data-plan-notice="paused">${plan.trial ? `Your free trial ended on ${esc(humanDate(plan.trial.endsAt))}.` : 'There is no plan on this account.'}${s.status !== 'none' ? ` Stripe says your subscription is “${esc(s.status)}”.` : ''} Until you choose a plan, ${PAUSED_LIST} are paused.${price}</p>`,
        );
        lines.push(`<p>${ALWAYS_OPEN} stay open.</p>`);
        break;
      default:
        break;
    }
    // Choose a plan only when no subscription is still running (a
    // past_due or unpaid one needs the card fixed, not a second plan).
    const running = plan.liveSubscriptions > 0;
    if (!running && plan.access !== 'subscribed') buttons.push(upgrade);
    if (plan.hasBillingAccount) buttons.push(manage);
    if (plan.mode === 'test') lines.push('<p class="muted">This server takes test payments only (Stripe test mode).</p>');
  }
  if (buttons.length) lines.push(`<p class="portal-actions">${buttons.join(' ')}</p>`);
  lines.push('<p class="muted">Whatever happens with a plan, your words stay yours: the backup file, Word and Markdown are always open, and so is everything on this page.</p>');
  return `<section class="portal-card" id="plan" aria-labelledby="plan-h" data-plan-status="${esc(s.status)}" data-plan-access="${esc(plan.access)}">
        <h2 id="plan-h">Plan</h2>
        ${lines.join('\n        ')}
      </section>`;
}

export interface PortalPageOpts {
  emailConfigured: boolean;
  /** /account?billing=success|cancelled, back from Stripe Checkout. */
  billingReturn?: 'success' | 'cancelled' | null;
  /** Two-step sign-in for this account (twoStepStatus); off when absent. */
  twoStep?: TwoStepStatus;
}

/** The recovery codes, shown once: after turning two-step on, and after
 *  "Get new recovery codes". client/account/account.js fills the list. */
const RECOVERY_CODES_STEP = `<div class="twostep-step" data-twostep-codes hidden>
            <p><b>Your recovery codes.</b> Each one signs you in once, in place of the code from your phone. Keep them somewhere safe, away from this device. This is the only time they are shown.</p>
            <ol class="recovery-codes" data-recovery-list></ol>
            <p class="portal-actions">
              <button class="portal-button quiet" type="button" data-recovery-copy>Copy</button>
              <button class="portal-button quiet" type="button" data-recovery-download>Download as a text file</button>
            </p>
            <p><button class="portal-button" type="button" data-recovery-done>I’ve saved them</button></p>
          </div>`;

/** The second-factor fields the off and new-codes forms share. */
const PASSWORD_AND_CODE = `<label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
              <label>A code from your authenticator app, or a recovery code <input name="code" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required /></label>`;

/**
 * "Two-step sign-in" inside the Password and sign-in card. Off: the start
 * button and the steps account.js walks through (password, then the QR
 * code, the key and the 6-digit code, then the recovery codes). Day 22
 * unpaid: the pause note instead (twoStep.setup, src/access.ts), the
 * data-plan-access pattern of the Plan card. On: since when, the codes
 * left, and turning it off / new codes, which are never paused.
 */
function twoStepSection(config: Config, plan: AccountPlan, t: TwoStepStatus): string {
  const head = '<h3 id="twostep-h">Two-step sign-in</h3>';
  if (t.on) {
    const lost = config.supportEmail
      ? `Lost your phone and your recovery codes? Write to support at <a href="mailto:${esc(config.supportEmail)}" data-support-email>${esc(config.supportEmail)}</a>. Support can turn two-step sign-in off once they have checked it’s you.`
      : 'Lost your phone and your recovery codes? Ask the person who runs this server: they can turn two-step sign-in off once they have checked it’s you.';
    return `<div class="portal-sub twostep" id="two-step" aria-labelledby="twostep-h" data-twostep="on">
          ${head}
          <p class="ok-line">On since ${esc(humanDate(t.since ?? ''))}. ${plural(t.recoveryLeft, 'recovery code', 'recovery codes')} left.</p>
          <p>Signing in asks for your password and a 6-digit code from your authenticator app.</p>
          <details class="portal-more" data-twostep-codes-more>
            <summary>Get new recovery codes</summary>
            <form class="portal-form" data-form="twostep-codes" novalidate>
              ${PASSWORD_AND_CODE}
              <button type="submit">Get new recovery codes</button>
              <p class="muted small">The recovery codes you have now stop working.</p>
            </form>
          </details>
          ${RECOVERY_CODES_STEP}
          <details class="portal-more">
            <summary>Turn off two-step sign-in</summary>
            <form class="portal-form" data-form="twostep-off" novalidate>
              ${PASSWORD_AND_CODE}
              <button type="submit">Turn off two-step sign-in</button>
              <p class="muted small">Signing in then asks for your password only. Your recovery codes stop working.</p>
            </form>
          </details>
          <p class="muted small" data-twostep-lost>${lost}</p>
        </div>`;
  }
  const intro = '<p>Two-step sign-in asks for a 6-digit code from an authenticator app on your phone each time you sign in, as well as your password. Devices already signed in stay signed in.</p>';
  if (plan.access === 'paused') {
    return `<div class="portal-sub twostep" id="two-step" aria-labelledby="twostep-h" data-twostep="paused" data-plan-access="paused">
          ${head}
          ${intro}
          <p class="note-line" data-twostep-paused>Your free trial has ended, so ${esc(PAUSABLE_FEATURES['twoStep.setup'])} is paused until you choose a plan. Everything else in this card still works.</p>
        </div>`;
  }
  return `<div class="portal-sub twostep" id="two-step" aria-labelledby="twostep-h" data-twostep="off">
          ${head}
          ${intro}
          <p data-twostep-begin><button class="portal-button" type="button" data-action="twostep-start">Turn on two-step sign-in</button></p>
          <form class="portal-form twostep-step" data-form="twostep-start" novalidate hidden>
            <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
            <p class="portal-actions"><button type="submit">Continue</button> <button class="linkish" type="button" data-twostep-cancel>Cancel</button></p>
          </form>
          <div class="twostep-step" data-twostep-scan hidden>
            <p>Scan this with your authenticator app, or type the key into it.</p>
            <div class="twostep-qr" data-twostep-qr></div>
            <p>Key: <code class="twostep-key" data-twostep-key></code></p>
            <form class="portal-form" data-form="twostep-enable" novalidate>
              <label>The 6-digit code from the app <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false" required /></label>
              <p class="portal-actions"><button type="submit">Turn on</button> <button class="linkish" type="button" data-twostep-cancel>Cancel</button></p>
            </form>
          </div>
          ${RECOVERY_CODES_STEP}
        </div>`;
}

/** "Where you're signed in": account.js fills the list from
 *  /api/account/sessions, with a Sign out on every row but this one. */
const SESSIONS_SECTION = `<div class="portal-sub" id="devices" aria-labelledby="devices-h">
          <h3 id="devices-h">Where you’re signed in</h3>
          <ul class="portal-list sessions" data-sessions aria-live="polite"></ul>
          <noscript><p class="muted">This list needs JavaScript in your browser.</p></noscript>
        </div>`;

export function accountPage(config: Config, o: AccountOverview, plan: AccountPlan, opts: PortalPageOpts): string {
  const u = o.user;
  const confirmed = Boolean(u.emailConfirmedAt);

  const emailState = confirmed
    ? `<p class="ok-line">Confirmed on ${esc(humanDate(u.emailConfirmedAt!))}.</p>`
    : `<div class="note-line" id="unconfirmed" data-unconfirmed>
          <p>This address is not confirmed yet. Your shelf works all the same; confirming means a password-reset email can reach you if you ever need one.</p>
          ${
            opts.emailConfigured
              ? '<p><button class="linkish" type="button" data-action="resend">Send the confirmation link again</button></p>'
              : '<p class="muted" data-mail-off>Email isn’t set up on this server yet, so no confirmation link can be sent. Nothing on your shelf depends on it.</p>'
          }
        </div>`;

  const pending = o.pendingEmail
    ? `<div class="note-line" data-pending>
          <p>Waiting for you to open the link sent to <b>${esc(o.pendingEmail)}</b>. Until then the account keeps ${esc(u.email)}.</p>
          <p><button class="linkish" type="button" data-action="cancel-email">Cancel this change</button></p>
        </div>`
    : '';

  const changeEmail = opts.emailConfigured
    ? `<details class="portal-more">
          <summary>Change email address</summary>
          <form class="portal-form" data-form="email" novalidate>
            <label>New email address <input name="newEmail" type="email" autocomplete="email" required /></label>
            <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
            <button type="submit">Send a confirmation link</button>
            <p class="muted small">The link goes to the new address, and a short notice to this one. The address changes only when the link is opened.</p>
          </form>
        </details>`
    : '<p class="muted small" data-mail-off>Changing the email address needs a confirmation link sent to the new address, and email isn’t set up on this server yet. Until it is, the address stays as it is.</p>';

  const books = o.books.length
    ? `<ul class="portal-list">
${o.books
  .map(
    (b) => `          <li><div><span class="item-title">${esc(b.title || 'Untitled')}</span>
            <span class="item-meta">about ${plural(b.words, 'word', 'words')} · last saved ${esc(humanDateTimeUtc(b.updatedAt))}</span></div>
            <a class="item-link" href="/studio?book=${encodeURIComponent(b.id)}">Open in the studio</a></li>`,
  )
  .join('\n')}
        </ul>`
    : '<p class="muted">No books on your shelf yet. Open the studio, write, and choose “Bring it to my shelf”.</p>';

  const archive = o.archive.length
    ? `<ul class="portal-list">
${o.archive
  .map(
    (x) => `          <li><div><span class="item-title">${esc(x.filename)}</span>
            <span class="item-meta">${esc(FORMAT_NAMES[x.format] ?? x.format)}${x.preset ? ` · ${esc(x.preset)}` : ''} · ${bytes(x.byteSize)} · ${esc(humanDate(x.createdAt))}</span></div>
            <a class="item-link" href="/api/exports/${encodeURIComponent(x.id)}/download">Download</a></li>`,
  )
  .join('\n')}
        </ul>`
    : '<p class="muted">Nothing archived yet. Files you save to your archive from the studio wait here, on any device.</p>';

  const sh = o.shares;
  const shares = sh.total
    ? `<p>${plural(sh.total, 'reading link', 'reading links')}, ${num(sh.active)} open. Readers have left ${plural(sh.comments, 'comment', 'comments')}${sh.comments ? `, ${num(sh.openComments)} not yet marked done` : ''}.</p>
        <p class="muted">Make, close and read them in the studio, under Share with beta readers.</p>`
    : '<p class="muted">No reading links yet. In the studio, Share with beta readers makes a read-only copy that readers can comment on without an account.</p>';

  const st = o.streak;
  const streak = `<p>${st.current ? `${plural(st.current, 'day', 'days')} in a row${st.todayCovered ? ', today included' : ''}.` : 'No streak running just now.'} Longest: ${plural(st.longest, 'day', 'days')}.</p>
        <p class="muted">${plural(st.freezesAvailable, 'freeze', 'freezes')} in hand for a missed day.${st.pausedToday ? ' You are on a planned pause today.' : ''}</p>`;

  const body = `      <p class="kicker">Your typesetting portal</p>
      <h1>Your account</h1>
      <p class="lede">Signed in as <b data-email>${esc(u.email)}</b>. Your shelf since ${esc(humanDate(u.createdAt))}.</p>
      <p class="portal-msg" role="status" aria-live="polite" data-msg hidden></p>

      <section class="portal-card" id="email" aria-labelledby="email-h">
        <h2 id="email-h">Email address</h2>
        <p>${esc(u.email)}</p>
        ${emailState}
        ${pending}
        ${changeEmail}
      </section>

      <section class="portal-card" id="shelf" aria-labelledby="shelf-h">
        <h2 id="shelf-h">Your shelf</h2>
        ${books}
      </section>

      <section class="portal-card" id="archive" aria-labelledby="archive-h">
        <h2 id="archive-h">Export archive</h2>
        ${archive}
      </section>

      <section class="portal-card" id="readers" aria-labelledby="readers-h">
        <h2 id="readers-h">Beta readers</h2>
        ${shares}
      </section>

      <section class="portal-card" id="streak" aria-labelledby="streak-h">
        <h2 id="streak-h">Writing streak</h2>
        ${streak}
      </section>

      ${planSection(plan, opts.billingReturn ?? null)}

      <section class="portal-card" id="security" aria-labelledby="security-h">
        <h2 id="security-h">Password and sign-in</h2>
        <details class="portal-more">
          <summary>Change password</summary>
          <form class="portal-form" data-form="password" novalidate>
            <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
            <label>New password <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters" /></label>
            <button type="submit">Change password</button>
            <p class="muted small">Every other device is signed out; this one stays signed in.</p>
          </form>
        </details>
        <p>Signed in somewhere you no longer use? Sign out every device, this one included. Your books stay on your shelf.</p>
        <p><button class="portal-button quiet" type="button" data-action="everywhere">Sign out everywhere</button></p>
        ${SESSIONS_SECTION}
        ${twoStepSection(config, plan, opts.twoStep ?? { on: false, since: null, recoveryLeft: 0 })}
      </section>

      <section class="portal-card" id="data" aria-labelledby="data-h">
        <h2 id="data-h">Your data</h2>
        <p>One ZIP file with everything this server keeps for you: every book on your shelf, every file in your archive, your reading links and their comments, your streak, and a README saying what is where.</p>
        <p><a class="portal-button" href="/api/account/export" download data-export>Download all my data</a></p>
      </section>

      ${helpSection(config)}

      <section class="portal-card danger" id="delete" aria-labelledby="delete-h">
        <h2 id="delete-h">Delete my account</h2>
        <p>This removes your account and everything on it from this server: your shelf, your archive and its files, your reading links and their comments, your streak, and your sign-ins. It cannot be undone. Books on your devices are not touched.</p>
        <p><a href="/api/account/export" download data-export>Download all my data first</a></p>${subscriptionNote(plan, config)}
        <details class="portal-more">
          <summary>Delete my account</summary>
          <form class="portal-form" data-form="delete" novalidate>
            <label>Current password <input name="currentPassword" type="password" autocomplete="current-password" required /></label>
            <label>Type <b>${DELETE_PHRASE}</b> to confirm <input name="confirmPhrase" type="text" autocomplete="off" spellcheck="false" required /></label>
            <button type="submit" class="danger-button">Delete my account and everything on it</button>
            <p class="muted small">Copies can stay in the server's backups for the time the privacy page describes.</p>
          </form>
        </details>
      </section>`;
  return portalChrome(config, 'Your account', body, { signedIn: true, script: true });
}

/** Before the delete form: a live subscription is not cancelled by
 *  deleting the account yet (see cancelBillingForDeletedAccount). */
function subscriptionNote(plan: AccountPlan, config: Config): string {
  if (!plan.liveSubscriptions) return '';
  if (plan.canCancel) {
    return `
        <p class="note-line" data-subscription-cancels>This account has a subscription that is still running. Deleting the account cancels it at Stripe straight away, so nothing more is charged.</p>`;
  }
  const who = config.supportEmail
    ? `write to <a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a> to have it cancelled`
    : 'ask the person who runs this server to cancel it';
  return `
        <p class="note-line" data-subscription-warning>This account has a subscription that is still running at Stripe. Deleting the account does not cancel it: this server has no Stripe key, so it can’t reach Stripe to cancel it. Before you delete, ${who}.</p>`;
}

/** The confirm page: a button that POSTs the token (prefetch-safe). */
export function confirmPage(config: Config, token: string | null): string {
  const body = token
    ? `      <p class="kicker">Your typesetting portal</p>
      <h1>Confirm your email address</h1>
      <p class="lede">One click, and this address is confirmed for your Beuk account.</p>
      <form method="post" action="/account/confirm" class="portal-form">
        <input type="hidden" name="token" value="${esc(token)}" />
        <button type="submit">Confirm this address</button>
      </form>`
    : `      <h1>Confirm your email address</h1>
      <p class="lede">This page needs the link from your confirmation email. You can ask for a new one on <a href="/account">your account page</a>.</p>`;
  return portalChrome(config, 'Confirm your email address', body, { signedIn: false });
}

export function confirmResultPage(
  config: Config,
  outcome: { ok: true; purpose: 'signup' | 'change'; email: string } | { ok: false; reason: 'invalid' | 'taken' | 'busy' },
): string {
  let body: string;
  if (outcome.ok && outcome.purpose === 'signup') {
    body = `      <h1>Your address is confirmed</h1>
      <p class="lede">${esc(outcome.email)} is confirmed for your Beuk account. Thank you.</p>
      <p><a class="portal-button" href="/account">Your account</a> <a class="portal-button quiet" href="/studio">Back to the studio</a></p>`;
  } else if (outcome.ok) {
    body = `      <h1>Your email address has changed</h1>
      <p class="lede">Your Beuk account now uses ${esc(outcome.email)}. Sign in with it from now on.</p>
      <p><a class="portal-button" href="/account">Your account</a> <a class="portal-button quiet" href="/studio">Back to the studio</a></p>`;
  } else if (outcome.reason === 'busy') {
    body = `      <h1>Too many tries from here just now</h1>
      <p class="lede" data-confirm-busy>Your link still works. Nothing has changed; open it again in a few minutes.</p>`;
  } else if (outcome.reason === 'taken') {
    body = `      <h1>That address is already in use</h1>
      <p class="lede">Another Beuk account uses this address now, so this one keeps its old address. You can choose a different one on your account page.</p>
      <p><a class="portal-button" href="/account">Your account</a></p>`;
  } else {
    body = `      <h1>This link can’t be used</h1>
      <p class="lede">It has already been used, has expired, or was replaced by a newer one. Nothing has changed.</p>
      <p>You can ask for a new link on <a href="/account">your account page</a>.</p>`;
  }
  return portalChrome(config, 'Confirm your email address', body, { signedIn: false });
}

/** After deletion: a calm last page. */
export function deletedPage(config: Config, opts: { subscriptionLeft?: boolean } = {}): string {
  const contact = config.supportEmail
    ? ` To make sure, write to <a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>.`
    : '';
  const sub = opts.subscriptionLeft
    ? `
      <p class="note-line" data-subscription-left>The subscription that was on this account couldn’t be cancelled from here, so it is still running at Stripe. The person who runs this server can see it and cancel it by hand.${contact}</p>`
    : '';
  const body = `      <h1>Your account is deleted</h1>
      <p class="lede">Your account and everything on it are gone from this server. Books on your devices are still there in the studio.</p>${sub}
      <p><a class="portal-button" href="/studio">Open the studio</a></p>`;
  return portalChrome(config, 'Account deleted', body, { signedIn: false });
}
