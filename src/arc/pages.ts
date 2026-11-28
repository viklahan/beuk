import { html, raw, type SafeHtml } from '../email/layout.js';
import { ARC_CLAIM_RULES, type SignupView } from './claims.js';
import { arcDir, arcT, type ArcKey, type ArcLang } from './strings.js';

/**
 * ARC campaigns: the server-rendered pages a reader sees (slice 1, Task 6:
 * the claim page, the code page, the waiting page, and the calm 404/410
 * pages; Task 7: the copy page, the closed copy, and the Not me / Stop
 * pages with their done, used-link and unavailable pages). Strangers read
 * these, so:
 *   - every line comes from src/arc/strings.ts through t('…'), in the
 *     book's language (arcLang(snapshot.language)) and direction (arcDir);
 *   - every value is escaped by the `html` tag (src/email/layout.ts);
 *   - the routes send them with readerHeaders (noindex, a nonce'd CSP);
 *   - no Beuk marketing: the footer is Privacy and Terms only;
 *   - the one script fills the hidden tz field; the form works without it.
 * The look is the beta reader's Paper (client/help/warmth.css).
 */

const PAGE_CSS = `
.arc{max-width:34rem;margin:0 auto;padding:1.6rem 1.25rem 2rem}
.arc h1{font-size:1.6rem;line-height:1.25;margin:0 0 .6rem}
.arc .cover{display:block;max-width:12rem;max-height:18rem;height:auto;margin:0 0 1rem;border:1px solid var(--line)}
.arc .blurb p{margin:0 0 .7em}
.arc .note{color:var(--ink-soft);font-size:.95rem}
.arc .err{border:1px solid #c98a5a;background:#fdf1e6;border-radius:8px;padding:.6rem .9rem;margin:0 0 1rem}
.arc form{margin:1.2rem 0 0}
.arc label{display:block;margin:.8rem 0 .2rem;font-weight:600}
.arc input[type=text],.arc input[type=email],.arc input[type=url]{width:100%;box-sizing:border-box;padding:.5rem .6rem;border:1px solid var(--line);border-radius:6px;background:#fffdf8}
.arc input.code{max-width:9rem;letter-spacing:.2em;font-size:1.2rem}
.arc button{margin:1rem 0 .4rem;padding:.6rem 1.2rem;border:0;border-radius:6px;background:var(--amber);color:#fff;font-weight:600;cursor:pointer}
.arc .hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.arc .get{margin:1.2rem 0 1rem}
.arc a.btn{display:inline-block;padding:.6rem 1.2rem;border-radius:6px;background:var(--amber);color:#fff;font-weight:600;text-decoration:none}
`;

type T = ReturnType<typeof arcT>;

function shell(o: { nonce: string; lang: ArcLang; title: string; body: SafeHtml; script?: SafeHtml }): string {
  const t = arcT(o.lang);
  return html`<!doctype html>
<html lang="${o.lang}" dir="${arcDir(o.lang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <title>${o.title}</title>
    <link rel="stylesheet" href="/help/warmth.css" />
    <style nonce="${o.nonce}">${raw(PAGE_CSS)}</style>
  </head>
  <body>
    <main class="arc">
${o.body}
    </main>
    <footer class="site-foot"><p class="foot-links"><a href="/privacy" rel="noreferrer">${t('arc.foot.privacy')}</a> · <a href="/terms" rel="noreferrer">${t('arc.foot.terms')}</a></p></footer>
${o.script ?? ''}  </body>
</html>
`.value;
}

/** The launch date as the reader's language writes it (UTC, so the date
 *  is the one the author typed, whatever the server's zone). Marathi in
 *  Western digits, as the studio's Marathi pack writes every number
 *  (docs/ui-hi-mr-glossary.md; Intl's 'mr' default is Devanagari digits). */
export function launchDateText(lang: ArcLang, launchDate: string): string {
  const d = new Date(`${launchDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return launchDate;
  return new Intl.DateTimeFormat(lang === 'mr' ? 'mr-u-nu-latn' : lang, { dateStyle: 'long', timeZone: 'UTC' }).format(d);
}

function errorBox(message: string | null): SafeHtml | string {
  return message ? html`<p class="err" role="alert">${message}</p>` : '';
}

/** Why a claim or a code was refused, as the page says it. */
export type ClaimRefusal =
  | 'closed' | 'full' | 'blocked' | 'mail-off' | 'mail-failed' | 'signups-busy' | 'busy' | 'bad-name' | 'bad-email' | 'bad-profile' | 'answered';
export type CodeRefusal = 'wrong' | 'expired' | 'unknown' | 'closed' | 'full' | 'answered' | 'busy';

const CLAIM_ERR: Record<ClaimRefusal, ArcKey> = {
  closed: 'arc.claim.err.closed',
  full: 'arc.claim.err.full',
  blocked: 'arc.claim.err.blocked',
  'mail-off': 'arc.claim.err.mailOff',
  'mail-failed': 'arc.claim.err.mailFailed',
  'signups-busy': 'arc.claim.err.signupsBusy',
  busy: 'arc.claim.err.busy',
  'bad-name': 'arc.claim.err.badName',
  'bad-email': 'arc.claim.err.badEmail',
  'bad-profile': 'arc.claim.err.badProfile',
  answered: 'arc.claim.err.answered',
};

const CODE_ERR: Record<CodeRefusal, ArcKey> = {
  wrong: 'arc.code.err.wrong',
  expired: 'arc.code.err.expired',
  unknown: 'arc.code.err.unknown',
  closed: 'arc.claim.err.closed',
  full: 'arc.claim.err.full',
  answered: 'arc.claim.err.answered',
  busy: 'arc.claim.err.busy',
};

function claimError(t: T, view: Pick<SignupView, 'author'>, why: ClaimRefusal | CodeRefusal | undefined, table: Record<string, ArcKey>): string | null {
  if (!why) return null;
  return t(table[why], { author: view.author });
}

function heading(t: T, view: Pick<SignupView, 'title' | 'author'>): string {
  return t('arc.claim.title', { title: view.title, author: view.author });
}

/** The values a refused claim keeps in the form (never the honeypot). */
export interface ClaimValues {
  name?: string;
  email?: string;
  profile?: string;
}

/**
 * The claim page: who is giving the copy, the blurb, the review line (never
 * a condition: Amazon's rule), the form (approval mode adds the profile
 * link), and the stamp note. Exported for Task 9's language test (ruling
 * F12). `view` needs only what the page shows.
 */
export function renderClaimPage(
  view: Pick<SignupView, 'campaign' | 'title' | 'author' | 'lang' | 'blurb' | 'hasCover'>,
  opts: { nonce: string; signup: string; values?: ClaimValues; error?: ClaimRefusal },
): string {
  const t = arcT(view.lang);
  const approval = view.campaign.approval_mode === 'approval';
  const base = `/arc/${opts.signup}`;
  const blurb = view.blurb
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => html`<p>${p}</p>`);
  const body = html`      <h1>${heading(t, view)}</h1>
      ${errorBox(claimError(t, view, opts.error, CLAIM_ERR))}
      ${view.hasCover ? html`<img class="cover" src="${base}/cover" alt="${t('arc.claim.cover', { title: view.title })}" />` : ''}
      <p class="lede">${t('arc.claim.lede', { author: view.author, date: launchDateText(view.lang, view.campaign.launch_date) })}</p>
      ${blurb.length ? html`<div class="blurb">${blurb}</div>` : ''}
      <p>${t('arc.claim.review')}</p>
      ${approval ? html`<p class="note">${t('arc.claim.approvalNote', { author: view.author })}</p>` : ''}
      ${claimForm(t, view, base, opts.values ?? {})}
      <p class="note">${t('arc.claim.stampNote')}</p>`;
  return shell({ nonce: opts.nonce, lang: view.lang, title: heading(t, view), body, script: tzScript(opts.nonce) });
}

/** The claim form (name, email; approval mode: the profile link; the tz
 *  and honeypot fields), posting to the signup link. The claim page and
 *  the closed page's lost-link form share it. */
function claimForm(t: T, view: Pick<SignupView, 'campaign' | 'author'>, base: string, v: ClaimValues): SafeHtml {
  const profile =
    view.campaign.approval_mode === 'approval'
      ? html`
      <label for="arcProfile">${t('arc.claim.profile')}</label>
      <input type="url" id="arcProfile" name="profile" maxlength="300" required inputmode="url" value="${v.profile ?? ''}" />
      <p class="note">${t('arc.claim.profileNote', { author: view.author })}</p>`
      : '';
  return html`<form method="post" action="${base}" autocomplete="on">
      <label for="arcName">${t('arc.claim.name')}</label>
      <input type="text" id="arcName" name="name" maxlength="60" required autocomplete="name" value="${v.name ?? ''}" />
      <label for="arcEmail">${t('arc.claim.email')}</label>
      <input type="email" id="arcEmail" name="email" maxlength="254" required autocomplete="email" value="${v.email ?? ''}" />${profile}
      <input type="hidden" id="arcTz" name="tz" value="" />
      <div class="hp" aria-hidden="true"><label for="arcWebsite">${t('arc.claim.honeypot')}</label><input type="text" id="arcWebsite" name="website" tabindex="-1" autocomplete="off" /></div>
      <p class="note">${t('arc.claim.codeNote')}</p>
      <button type="submit">${t('arc.claim.submit')}</button>
      </form>`;
}

/** The reader's own zone, for later slices' reminders; the form works without it. */
function tzScript(nonce: string): SafeHtml {
  return html`    <script nonce="${nonce}">try{document.getElementById('arcTz').value=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}</script>
`;
}

/** The code page: where the code went, the code field, and a way back for
 *  a new one. `email` is shown when the ref names a row (never otherwise:
 *  the honeypot's page looks the same as any other). */
export function renderCodePage(
  view: Pick<SignupView, 'title' | 'author' | 'lang'>,
  opts: { nonce: string; signup: string; ref: string; email: string | null; error?: CodeRefusal },
): string {
  const t = arcT(view.lang);
  const minutes = Math.round(ARC_CLAIM_RULES.codeTtlMs / 60_000);
  const base = `/arc/${opts.signup}`;
  const sent = opts.email ? t('arc.code.sentTo', { email: opts.email, minutes }) : t('arc.code.sentAny', { minutes });
  const ended = opts.error === 'closed' || opts.error === 'full' || opts.error === 'answered';
  const form = ended
    ? ''
    : html`
      <form method="post" action="${base}/check" autocomplete="off">
      <input type="hidden" name="r" value="${opts.ref}" />
      <label for="arcCode">${t('arc.code.label')}</label>
      <input type="text" class="code" id="arcCode" name="code" inputmode="numeric" pattern="[0-9 ]{6,9}" maxlength="9" required autocomplete="one-time-code" />
      <button type="submit">${t('arc.code.submit')}</button>
      </form>
      <p class="note"><a href="${base}">${t('arc.code.again')}</a></p>`;
  const body = html`      <h1>${t('arc.code.title')}</h1>
      <p class="note">${heading(t, view)}</p>
      ${errorBox(claimError(t, view, opts.error, CODE_ERR))}
      ${ended ? '' : html`<p class="lede">${sent}</p>`}${form}`;
  return shell({ nonce: opts.nonce, lang: view.lang, title: t('arc.code.title'), body });
}

/** Approval mode: the address is confirmed and the request is waiting. */
export function renderWaitingPage(view: Pick<SignupView, 'title' | 'author' | 'lang'>, opts: { nonce: string; name: string }): string {
  const t = arcT(view.lang);
  const title = t('arc.wait.title', { author: view.author });
  const body = html`      <h1>${title}</h1>
      <p class="note">${heading(t, view)}</p>
      <p class="lede">${t('arc.wait.lead', { name: opts.name })}</p>
      <p>${t('arc.wait.body', { author: view.author })}</p>
      <p class="note">${t('arc.claim.stampNote')}</p>`;
  return shell({ nonce: opts.nonce, lang: view.lang, title, body });
}

/**
 * Sign-ups closed (by date, or by the author): the 410 page. With the
 * signup token it also offers the lost-link form (final review minor 1: a
 * reader who holds a copy can ask for its link again, as copies keep
 * working after a close), and shows why a request through it was refused.
 */
export function renderClosedPage(
  view: Pick<SignupView, 'campaign' | 'title' | 'author' | 'lang'>,
  opts: { nonce: string; signup?: string; values?: ClaimValues; error?: ClaimRefusal },
): string {
  const t = arcT(view.lang);
  const recover = opts.signup
    ? html`
      <p>${t('arc.page.closedRecover')}</p>
      ${claimForm(t, view, `/arc/${opts.signup}`, opts.values ?? {})}`
    : '';
  const why = opts.error && opts.error !== 'closed' ? claimError(t, view, opts.error, CLAIM_ERR) : null;
  const body = html`      <h1>${t('arc.page.closedTitle')}</h1>
      <p class="note">${heading(t, view)}</p>
      <p class="lede">${t('arc.claim.err.closed')}</p>${recover}
      ${errorBox(why)}`;
  return shell({ nonce: opts.nonce, lang: view.lang, title: t('arc.page.closedTitle'), body, script: opts.signup ? tzScript(opts.nonce) : undefined });
}

/* ---------------- Task 7: the reader's copy and the mail links ---------------- */

/** What the copy page shows of a reader (ReaderView, src/arc/readers.ts). */
export interface CopyPageView {
  name: string;
  title: string;
  author: string;
  lang: ArcLang;
}

/** Why a download did not happen, as the copy page says it. */
export type CopyRefusal = 'limit' | 'busy' | 'server-busy' | 'failed';

const COPY_ERR: Record<CopyRefusal, ArcKey> = {
  limit: 'arc.copy.err.limit',
  busy: 'arc.copy.err.busy',
  'server-busy': 'arc.copy.err.serverBusy',
  failed: 'arc.copy.err.failed',
};

/**
 * The reader's copy page (/arc/r/:token): Download EPUB first, today's web
 * reader (/read/:token, ruling R4a) as the fallback (spec: the copy goes to
 * the device first), the stamp note and "keep this page". A refused
 * download shows the same page with the reason on top.
 */
export function renderCopyPage(view: CopyPageView, opts: { nonce: string; token: string; error?: CopyRefusal }): string {
  const t = arcT(view.lang);
  const title = t('arc.copy.title', { title: view.title });
  const body = html`      <h1>${title}</h1>
      <p class="note">${heading(t, view)}</p>
      ${errorBox(opts.error ? t(COPY_ERR[opts.error]) : null)}
      <p class="lede">${t('arc.copy.for', { name: view.name })}</p>
      <p class="get"><a class="btn" href="/arc/r/${opts.token}/epub">${t('arc.copy.download')}</a></p>
      <p><a href="/read/${opts.token}">${t('arc.copy.read')}</a></p>
      <p class="note">${t('arc.copy.stampNote')}</p>
      <p class="note">${t('arc.copy.keep')}</p>`;
  return shell({ nonce: opts.nonce, lang: view.lang, title, body });
}

/** A closed copy: the 410 page. It never names the reader. */
export function renderCopyGonePage(view: Pick<CopyPageView, 'title' | 'author' | 'lang'>, opts: { nonce: string }): string {
  const t = arcT(view.lang);
  const body = html`      <h1>${t('arc.copy.goneTitle')}</h1>
      <p class="note">${heading(t, view)}</p>
      <p class="lede">${t('arc.copy.gone')}</p>`;
  return shell({ nonce: opts.nonce, lang: view.lang, title: t('arc.copy.goneTitle'), body });
}

export type MailAction = 'not-me' | 'stop';

/** What the mail pages show (MailReader, src/arc/readers.ts). */
export type MailPageView = Pick<CopyPageView, 'title' | 'author' | 'lang'>;

const MAIL_PAGE: Record<MailAction, { title: ArcKey; body: ArcKey; button: ArcKey; done: ArcKey }> = {
  'not-me': { title: 'arc.notMe.title', body: 'arc.notMe.body', button: 'arc.notMe.button', done: 'arc.notMe.done' },
  stop: { title: 'arc.stop.title', body: 'arc.stop.body', button: 'arc.stop.button', done: 'arc.stop.done' },
};

/**
 * A mail link's page (GET /arc/m/:mailToken/:action): what pressing does,
 * and one POST button. Opening it changes nothing (a mail scanner opens
 * every link; plan: "A GET never acts on a mail link").
 */
export function renderMailActionPage(view: MailPageView, opts: { nonce: string; mailToken: string; action: MailAction }): string {
  const t = arcT(view.lang);
  const words = MAIL_PAGE[opts.action];
  const vars = { title: view.title, author: view.author };
  const title = t(words.title, vars);
  const body = html`      <h1>${title}</h1>
      <p class="note">${heading(t, view)}</p>
      <p class="lede">${t(words.body, vars)}</p>
      <form method="post" action="/arc/m/${opts.mailToken}/${opts.action}">
      <input type="hidden" name="confirm" value="1" />
      <button type="submit">${t(words.button, vars)}</button>
      </form>`;
  return shell({ nonce: opts.nonce, lang: view.lang, title, body });
}

/** After the button: what was done. Not me adds what backups keep (the
 *  privacy page's words, no stronger); Stop says the copy keeps working
 *  only to a reader who holds a copy that still opens (ruling C7). */
export function renderMailDonePage(view: MailPageView & { copyOpen?: boolean }, opts: { nonce: string; action: MailAction }): string {
  const t = arcT(view.lang);
  const vars = { title: view.title, author: view.author };
  const extra =
    opts.action === 'not-me'
      ? html`<p class="note">${t('arc.notMe.backups')}</p>`
      : view.copyOpen
        ? html`<p>${t('arc.stop.doneCopy')}</p>`
        : '';
  const body = html`      <h1>${t('arc.mail.doneTitle')}</h1>
      <p class="note">${heading(t, view)}</p>
      <p class="lede">${t(MAIL_PAGE[opts.action].done, vars)}</p>
      ${extra}`;
  return shell({ nonce: opts.nonce, lang: view.lang, title: t('arc.mail.doneTitle'), body });
}

/** A used or unknown mail link: the 404 page, in English (a used Not me
 *  link names nobody any more). */
export function renderMailGonePage(opts: { nonce: string }): string {
  const t = arcT('en');
  const body = html`      <h1>${t('arc.mail.goneTitle')}</h1>
      <p class="lede">${t('arc.mail.gone')}</p>`;
  return shell({ nonce: opts.nonce, lang: 'en', title: t('arc.mail.goneTitle'), body });
}

/** The opt-out cannot be kept on this server right now: the 503 page. */
export function renderMailUnavailablePage(view: MailPageView, opts: { nonce: string; action: MailAction }): string {
  const t = arcT(view.lang);
  const title = t(MAIL_PAGE[opts.action].title, { title: view.title, author: view.author });
  const body = html`      <h1>${title}</h1>
      <p class="note">${heading(t, view)}</p>
      ${errorBox(t('arc.mail.unavailable'))}`;
  return shell({ nonce: opts.nonce, lang: view.lang, title, body });
}

/** A form body the server refused to read (too long, too many fields;
 *  ruling C7): a calm page, in English — the body is refused before the
 *  route reads its link, so no book and no language is known. */
export function renderBadFormPage(opts: { nonce: string }): string {
  const t = arcT('en');
  const body = html`      <h1>${t('arc.page.badFormTitle')}</h1>
      <p class="lede">${t('arc.page.badForm')}</p>`;
  return shell({ nonce: opts.nonce, lang: 'en', title: t('arc.page.badFormTitle'), body });
}

/** No campaign behind the link: the 404 page, in English (no book to take
 *  a language from). */
export function renderUnknownPage(opts: { nonce: string; lang?: ArcLang }): string {
  const lang = opts.lang ?? 'en';
  const t = arcT(lang);
  const body = html`      <h1>${t('arc.page.unknownTitle')}</h1>
      <p class="lede">${t('arc.page.unknown')}</p>`;
  return shell({ nonce: opts.nonce, lang, title: t('arc.page.unknownTitle'), body });
}
