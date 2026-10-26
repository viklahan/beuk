import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StripeBillingProvider } from '../billing.js';
import { legalContactEmail, type Config } from '../config.js';
import { offsiteSettings } from '../housekeeping/offsite.js';
import { escapeHtml as esc, renderMarkdown } from '../warmth/markdown.js';
import { pageChrome, repoRoot } from '../warmth/pages.js';

/**
 * The legal pages: GET /privacy and GET /terms (Caddy proxies both to
 * the app). The text lives in content/legal/<name>.md, written from
 * what the code does (docs/privacy-inventory.md holds the evidence).
 *
 * Content file format:
 *   title: …            front matter, one "key: value" per line,
 *   updated: YYYY-MM-DD  ended by a line "==="
 *   note: …             (rendered as an HTML comment, never visible)
 *   ===
 *   Markdown (src/warmth/markdown.ts), plus:
 *   [[if <flag>]] … [[end]]   kept only when the flag is true — the
 *                             page never describes a feature this
 *                             server has switched off. Flags: billing,
 *                             kofi, offsite, stock, mail.
 *   {{slot}}                  filled from config after rendering.
 *
 * Operator slots (LEGAL_* in .env): a slot that is not set renders a
 * visible "being completed" notice in its place, and the page opens
 * with a box listing every unset slot. Nothing is ever invented.
 */

export type LegalPage = 'privacy' | 'terms';

export interface LegalDoc {
  title: string;
  updated: string | null;
  note: string;
  body: string;
}

export function legalContentDir(): string {
  return path.join(repoRoot(), 'content', 'legal');
}

/** Split "key: value" front matter (ended by ===) from the Markdown. */
export function parseLegalSource(source: string): LegalDoc {
  const text = source.replace(/\r\n/g, '\n');
  const end = text.indexOf('\n===\n');
  const head = end === -1 ? '' : text.slice(0, end);
  const body = end === -1 ? text : text.slice(end + 5);
  const meta: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2];
  }
  return {
    title: meta.title || 'Beuk',
    updated: /^\d{4}-\d{2}-\d{2}$/.test(meta.updated ?? '') ? meta.updated : null,
    note: meta.note ?? '',
    body,
  };
}

export interface LegalFlags {
  billing: boolean;
  kofi: boolean;
  offsite: boolean;
  stock: boolean;
  mail: boolean;
}

/** What this server actually has switched on. billing = live billing,
 *  the same rule GET /api/billing/status uses for `live` (configured
 *  for checkout with a live-mode key); test mode takes no real money. */
export function legalFlags(config: Config): LegalFlags {
  const billing = new StripeBillingProvider(config);
  return {
    billing: billing.checkoutConfigured && billing.mode === 'live' && !billing.misconfiguration,
    kofi: Boolean(config.kofiUrl),
    offsite: offsiteSettings(config) !== null,
    stock: Boolean(config.pexelsApiKey),
    mail: Boolean(config.smtpUrl && config.mailFrom),
  };
}

/** Keep or drop [[if flag]] … [[end]] blocks (not nested). An unknown
 *  flag counts as off. */
export function applyConditionals(markdown: string, flags: LegalFlags): string {
  return markdown.replace(/^\[\[if ([a-z]+)\]\]\n([\s\S]*?)^\[\[end\]\]\n?/gm, (_m, flag: string, inner: string) =>
    (flags as unknown as Record<string, boolean>)[flag] === true ? inner : '',
  );
}

/** The visible stand-in for an operator detail that is not set yet. */
export function pendingNotice(what: string): string {
  return `<span class="legal-pending" data-legal-pending>${esc(what)} has not been published yet — this part is being completed.</span>`;
}

interface Slot {
  label: string;
  value: string | null;
}

export function operatorSlots(config: Config): Record<'operator' | 'contact' | 'address' | 'jurisdiction' | 'hosting', Slot> {
  return {
    operator: { label: "The operator's name", value: config.legal.operatorName },
    contact: { label: 'The contact address for privacy and legal questions', value: legalContactEmail(config) },
    address: { label: 'A postal address', value: config.legal.postalAddress },
    jurisdiction: { label: 'The governing law', value: config.legal.jurisdiction },
    hosting: { label: 'Where the server is located', value: config.legal.hostingLocation },
  };
}

/** The slots each page uses (the "being completed" box lists these). */
const PAGE_SLOTS: Record<LegalPage, (keyof ReturnType<typeof operatorSlots>)[]> = {
  privacy: ['operator', 'address', 'contact', 'hosting'],
  terms: ['operator', 'address', 'contact', 'jurisdiction'],
};

function whoRuns(config: Config): string {
  const s = operatorSlots(config);
  const name = s.operator.value
    ? `<p>Beuk is run by <strong>${esc(s.operator.value)}</strong>, who decides how the data described here is used (the "operator", or data controller).</p>`
    : `<p>${pendingNotice(s.operator.label)}</p>`;
  const address = s.address.value
    ? `<p class="legal-address">Postal address: ${esc(s.address.value)}</p>`
    : `<p>${pendingNotice(s.address.label)}</p>`;
  return `<div class="legal-who">${name}${address}</div>`;
}

function contactHtml(config: Config): string {
  const email = legalContactEmail(config);
  if (!email) return pendingNotice(operatorSlots(config).contact.label);
  return `<a href="mailto:${esc(email)}">${esc(email)}</a>`;
}

function jurisdictionHtml(config: Config): string {
  const j = config.legal.jurisdiction;
  return j
    ? `These terms are governed by the law of ${esc(j)}, without taking away any protection the law where you live gives you as a consumer.`
    : pendingNotice(operatorSlots(config).jurisdiction.label);
}

function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function humanDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The page body (inside the warmth chrome). */
export function renderLegalBody(page: LegalPage, doc: LegalDoc, config: Config): string {
  const flags = legalFlags(config);
  let html = renderMarkdown(applyConditionals(doc.body, flags));
  // Anchors for every section heading (/privacy#your-rights-…).
  html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => `<h2 id="${slugify(inner)}">${inner}</h2>`);
  // Block slots sit alone in their paragraph.
  html = html
    .replace(/<p>\{\{whoruns\}\}<\/p>/g, () => whoRuns(config))
    .replace(/<p>\{\{jurisdiction\}\}<\/p>/g, () => `<p>${jurisdictionHtml(config)}</p>`);
  const o = config.offsite;
  const inline: Record<string, string> = {
    contact: contactHtml(config),
    hosting: config.legal.hostingLocation ? esc(config.legal.hostingLocation) : pendingNotice(operatorSlots(config).hosting.label),
    sessiondays: esc(String(config.sessionTtlDays)),
    backuphours: esc(String(config.backupIntervalHours)),
    keepdaily: esc(String(o.keepDaily)),
    keepweekly: esc(String(o.keepWeekly)),
    keepmonthly: esc(String(o.keepMonthly)),
  };
  html = html.replace(/\{\{([a-z]+)\}\}/g, (m, key: string) => inline[key] ?? m);

  const slots = operatorSlots(config);
  const missing = PAGE_SLOTS[page].filter((k) => !slots[k].value).map((k) => slots[k].label);
  const notice = missing.length
    ? `<aside class="legal-incomplete" role="note" data-legal-incomplete>
  <p><strong>This page is still being completed.</strong> These details have not been filled in yet:</p>
  <ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
  <p>Everything else on this page describes what Beuk does today.</p>
</aside>`
    : '';
  const date = config.legal.effectiveDate
    ? `<p class="legal-date">In effect from ${esc(humanDate(config.legal.effectiveDate))}.</p>`
    : doc.updated
      ? `<p class="legal-date">Last changed ${esc(humanDate(doc.updated))}.</p>`
      : '';
  const other =
    page === 'privacy'
      ? '<p class="legal-other">See also: <a href="/terms">the terms</a>.</p>'
      : '<p class="legal-other">See also: <a href="/privacy">how Beuk handles your data</a>.</p>';
  // The h1 comes first; the date and the notice sit right under it.
  const h1End = html.indexOf('</h1>');
  const head = h1End === -1 ? '' : html.slice(0, h1End + 5);
  const rest = h1End === -1 ? html : html.slice(h1End + 5);
  const comment = doc.note ? `<!-- ${doc.note.replace(/--/g, '—')} -->\n` : '';
  return `${comment}<article class="legal" data-legal="${page}">
${head}
${date}
${notice}
${rest}
${other}
</article>`;
}

export async function readLegalDoc(page: LegalPage): Promise<LegalDoc> {
  const source = await readFile(path.join(legalContentDir(), `${page}.md`), 'utf8');
  return parseLegalSource(source);
}

export async function renderLegalPage(page: LegalPage, config: Config): Promise<string> {
  const doc = await readLegalDoc(page);
  return pageChrome(config, doc.title, renderLegalBody(page, doc, config), { titleSuffix: 'Beuk' });
}
