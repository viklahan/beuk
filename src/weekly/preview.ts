import type { Config } from '../config.js';
import { schoolPage } from '../school/render.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import type { DraftRow } from './drafts.js';

/**
 * The Beuk Weekly press's preview page (/school/weekly/draft/<id>): the
 * draft rendered by the same renderer as the live paper, with the press
 * bar above it. The bar's buttons post JSON to the page's own actions
 * (/site/weekly-press.js); Withdraw asks again in an inline row, never a
 * browser dialog. Signed out, the page is only a sign-in box: the draft
 * itself is never shown to anyone but a signed-in admin.
 */

export const PRESS_CSS = ['/assets/fonts/fonts-weekly.css', '/site/weekly.css'];
export const PRESS_SCRIPTS = ['/site/weekly-press.js'];
export const PRESS_ROBOTS = 'noindex, nofollow';

const STATUS_WORDS: Record<string, string> = {
  drafted: 'Waiting for you',
  sent_back: 'Sent back: waiting for the drafter’s rewrite',
  approved: 'Being published',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

export function pressBar(d: DraftRow): string {
  const facts = [
    `<span><b>Status</b> ${esc(STATUS_WORDS[d.status] ?? d.status)}</span>`,
    `<span><b>Written from</b> <code>${esc(d.sourceCommit)}</code></span>`,
    `<span><b>Outlets read</b> ${d.outlets.length ? d.outlets.map((o) => esc(o)).join(', ') : 'none'}</span>`,
  ].join('');
  const dropped = d.dropped.length
    ? `<p class="press-dropped"><b>Dropped</b> ${d.dropped.map((x) => `${esc(x.title)} (${esc(x.why)})`).join('; ')}</p>`
    : '';
  const notes = d.notes ? `<p class="press-notes"><b>Your notes</b> ${esc(d.notes)}</p>` : '';
  let actions = '';
  if (d.status === 'drafted') {
    actions = `<div class="press-actions">
        <button type="button" class="press-approve" data-act="approve">Approve and publish</button>
        <details class="press-send"><summary>Send back</summary>
          <label for="press-notes">What should change</label>
          <textarea id="press-notes" maxlength="4000" rows="4"></textarea>
          <button type="button" data-act="send-back">Send back with these notes</button>
        </details>
        <button type="button" class="press-withdraw" data-act="withdraw-ask">Withdraw</button>
        <span class="press-confirm" hidden>Discard this draft? <button type="button" data-act="withdraw">Yes, withdraw it</button> <button type="button" data-act="withdraw-cancel">Keep it</button></span>
      </div>`;
  } else if (d.status === 'sent_back') {
    actions = `<div class="press-actions">
        <button type="button" class="press-withdraw" data-act="withdraw-ask">Withdraw</button>
        <span class="press-confirm" hidden>Discard this draft? <button type="button" data-act="withdraw">Yes, withdraw it</button> <button type="button" data-act="withdraw-cancel">Keep it</button></span>
      </div>`;
  } else if (d.status === 'published' && d.issueNumber != null) {
    actions = `<p class="press-done">Published as No. ${d.issueNumber}: <a href="/school/weekly/${d.issueNumber}">read it on the live paper</a>.</p>`;
  }
  return `        <section class="press-bar" aria-label="Beuk Weekly press" data-draft="${esc(d.id)}">
      <p class="kick">Beuk Weekly press · draft preview, not public</p>
      <div class="press-facts">${facts}</div>
      ${dropped}${notes}${actions}
      <p class="press-msg" role="status" aria-live="polite"></p>
    </section>
`;
}

/** The bar alone, for a draft whose folder is gone (published or withdrawn). */
export function renderPressStatus(config: Config, d: DraftRow): string {
  return schoolPage(config, {
    title: 'Beuk Weekly press',
    description: 'A Beuk Weekly draft.',
    path: `/school/weekly/draft/${d.id}`,
    body: pressBar(d),
    tab: 'weekly',
    css: PRESS_CSS,
    bodyClass: 'weekly',
    robots: PRESS_ROBOTS,
  });
}

/** Signed out: a sign-in box, nothing of the draft. */
export function renderPressSignIn(config: Config, id: string): string {
  return schoolPage(config, {
    title: 'Sign in — Beuk Weekly press',
    description: 'Sign in to see this draft.',
    path: `/school/weekly/draft/${id}`,
    body: `        <section class="press-bar press-signin" aria-label="Sign in">
      <p class="kick">Beuk Weekly press</p>
      <h2>Sign in to see this draft</h2>
      <form class="press-login" novalidate>
        <label for="press-email">Email</label>
        <input id="press-email" name="email" type="email" autocomplete="username" required />
        <label for="press-password">Password</label>
        <input id="press-password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
      <p class="press-msg" role="status" aria-live="polite"></p>
    </section>
`,
    tab: 'weekly',
    css: PRESS_CSS,
    bodyClass: 'weekly',
    robots: PRESS_ROBOTS,
    scripts: PRESS_SCRIPTS,
  });
}
