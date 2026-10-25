import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

/**
 * M4 warmth pages. The guide pages live as plain static HTML files under
 * client/help/ (plus client/thanks/) — no build step. The dynamic slots
 * are filled HERE, at request time, by token substitution:
 *
 *   {{SUPPORT_EMAIL}}          the support address (mailto + text)
 *   {{SUPPORT_NAME}}           the named human on the Help page
 *   {{SUPPORT_REPLY_PROMISE}}  the reply-time promise wording
 *   <!--BEUK_KOFI_JAR-->       the Ko-fi tip jar block — rendered ONLY
 *                              when KOFI_URL is configured; when it is
 *                              not, the slot becomes nothing at all.
 *   <!--BEUK_SUPPORT_NAV-->    the header's "Support" link to /support —
 *                              likewise only when KOFI_URL is configured.
 *   {{KOFI_URL}}               the Ko-fi page itself (the /support page's
 *                              button; that page is only served when set).
 *   <!--BEUK_BILLING_GATE-->   the Ko-fi gate script (client/help/
 *                              billing-gate.js) — only when KOFI_URL is
 *                              configured. It hides every data-kofi
 *                              element once GET /api/billing/status says
 *                              { live: true } (V's D4: the tip jar stays
 *                              only until paid plans are live); any other
 *                              answer, or none, leaves the jar showing.
 *
 * The Changelog and Roadmap pages are rendered from their Markdown
 * sources (CHANGELOG.md at the repo root, docs/roadmap.md — the same
 * file Housekeeping's Reference pillar serves) inside the same chrome.
 */

/** The brand on every warmth page (V's D1/D6, 2026-10-25): the
 *  production domain is the sub-brand, so the line beside the wordmark
 *  matches the address writers type. The static pages under client/
 *  carry the same two strings; tests/branding.test.ts keeps them equal. */
export const BRAND_SUBLINE = 'beuk.studio';
export const BRAND_FOOTNOTE = 'Beuk — a typesetting studio for writers, at beuk.studio.';

export function repoRoot(): string {
  // src/warmth (tsx dev) and dist/warmth (compiled) both sit two levels
  // below the project root.
  return path.resolve(import.meta.dirname, '..', '..');
}

export function clientDir(): string {
  return path.join(repoRoot(), 'client');
}

/** The tip jar block. Framed as "support the maker" — support
 *  language only, never charity language — and rendered only when a
 *  Ko-fi URL is configured. */
export function kofiJarHtml(config: Config): string {
  if (!config.kofiUrl) return '';
  const url = escapeHtml(config.kofiUrl);
  return `<aside class="kofi-jar" data-kofi>
  <h2>Support the maker</h2>
  <p>Beuk is made and kept by an independent maker, not a company with a
  sales team. If Beuk helped your book onto the shelf and you'd like to
  help keep it there, you can leave a tip — it goes toward the servers,
  the tools, and the next round of features writers ask for.</p>
  <p><a class="kofi-button" href="${url}" target="_blank" rel="noopener noreferrer">Leave a tip on Ko-fi</a></p>
  <p class="kofi-note">Entirely optional, always. The studio is the point;
  the tip jar is just a thank-you tin by the door.</p>
</aside>`;
}

/** The header link to the support page — only when Ko-fi is configured,
 *  so the nav never points at a page that 404s. */
export function supportNavHtml(config: Config): string {
  return config.kofiUrl ? '<a href="/support" data-kofi>Support</a>' : '';
}

/** The billing gate (see the slot list above) — only on a server with a
 *  tip jar to gate, so a server without Ko-fi makes no extra request. */
export function billingGateHtml(config: Config): string {
  return config.kofiUrl ? '<script src="/help/billing-gate.js"></script>' : '';
}

/** Fill the dynamic slots of a static warmth page from config. */
export function fillSlots(html: string, config: Config): string {
  return html
    .split('{{KOFI_URL}}')
    .join(escapeHtml(config.kofiUrl ?? ''))
    .split('<!--BEUK_SUPPORT_NAV-->')
    .join(supportNavHtml(config))
    .split('{{SUPPORT_EMAIL}}')
    .join(escapeHtml(config.supportEmail))
    .split('{{SUPPORT_NAME}}')
    .join(escapeHtml(config.supportName))
    .split('{{SUPPORT_REPLY_PROMISE}}')
    .join(escapeHtml(config.supportReplyPromise))
    .split('<!--BEUK_KOFI_JAR-->')
    .join(kofiJarHtml(config))
    .split('<!--BEUK_BILLING_GATE-->')
    .join(billingGateHtml(config));
}

/** Read a static page from client/ (guarding against path escapes) and
 *  fill its slots. Returns null when the file does not exist. */
export async function readClientPage(
  config: Config,
  ...segments: string[]
): Promise<string | null> {
  const base = clientDir();
  const file = path.resolve(base, ...segments);
  if (!file.startsWith(base + path.sep)) return null;
  try {
    const html = await readFile(file, 'utf8');
    return fillSlots(html, config);
  } catch {
    return null;
  }
}

/** Wrap rendered document HTML in the warmth page chrome (Paper style,
 *  the same stylesheet the static guides use). */
export function pageChrome(config: Config, title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} — Beuk Help</title>
    <link rel="stylesheet" href="/help/warmth.css" />
    ${billingGateHtml(config)}
  </head>
  <body>
    <header class="site-head">
      <a class="wordmark" href="/help/">beuk</a>
      <span class="subbrand">${escapeHtml(BRAND_SUBLINE)}</span>
      <nav class="site-nav">
        <a href="/help/">Help</a>
        <a href="/changelog">Changelog</a>
        <a href="/roadmap">Roadmap</a>
        ${supportNavHtml(config)}
      </nav>
    </header>
    <main class="page">
${bodyHtml}
    </main>
    <footer class="site-foot">
${kofiJarHtml(config)}
      <p class="foot-note">${escapeHtml(BRAND_FOOTNOTE)}</p>
    </footer>
  </body>
</html>
`;
}

/** Render a Markdown document (Changelog / Roadmap) as a full page. */
export async function renderDocPage(
  config: Config,
  file: string,
  fallbackTitle: string,
): Promise<string> {
  const source = await readFile(file, 'utf8');
  const title = /^#\s+(.+)$/m.exec(source)?.[1] ?? fallbackTitle;
  return pageChrome(config, title, renderMarkdown(source));
}
