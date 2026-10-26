import type { Config } from '../config.js';
import { escapeHtml as esc } from '../warmth/markdown.js';
import { BRAND_FOOTNOTE, BRAND_SUBLINE, billingGateHtml, kofiJarHtml, supportBlocks, supportNavHtml } from '../warmth/pages.js';
import { helpAssetUrl } from './assets.js';
import {
  ERROR_CATEGORIES,
  GUIDE_GROUPS,
  type Guide,
  type GuideBlock,
  type GuideSection,
  type HelpContent,
  type HelpError,
  type SaysLine,
} from './content.js';
import { humanDate, humanDateTimeUtc, sectionAnchor } from './render-util.js';
import type { SearchHit, SearchResult } from './search.js';
import type { ShelfStatus } from './status.js';

/**
 * Server-rendered Help pages (H1.4): /help/, /help/<slug>,
 * /help/errors, /help/errors/<code>, /help/search?q=. Everything a
 * reader needs is in the HTML — search, the error dictionary's rows
 * (native <details>) and the guide steps all work with JavaScript off;
 * client/help/help.js only adds the step ↔ pane highlighting, the
 * category filter, in-page search results and the theme toggle.
 *
 * Support contact (V, 2026-10-25): every line that names a person,
 * an address or a reply time renders ONLY when SUPPORT_EMAIL is
 * configured, and uses SUPPORT_NAME / SUPPORT_REPLY_PROMISE only when
 * those are set too. Unset means absent — no empty mailto, no promise.
 */

/* ==== BEUK:fonts ==== Self-hosted web fonts (client/assets/fonts/,
   served by Caddy's static handler at /assets/ for every path): no
   help page asks Google for anything. Literata, Karla and IBM Plex
   Mono in the weights this page always used; only the two faces on
   first paint (Literata headings, Karla text; Latin) are preloaded. */
export const FONTS_HREF = '/assets/fonts/fonts.css';
/** Literata 700 + italic 500: asked for by help and warmth pages, never by the studio. */
export const FONTS_HELP_HREF = '/assets/fonts/fonts-help.css';
export const HELP_FONT_PRELOADS = [
  '/assets/fonts/literata/literata-latin-normal-400_500_600_700.woff2',
  '/assets/fonts/karla/karla-latin-normal-400_500_600_700.woff2'
];
/* ==== /BEUK:fonts ==== */

export interface PageCtx {
  config: Config;
  content: HelpContent;
  status: ShelfStatus;
}

const categoryName = (id: string) => ERROR_CATEGORIES.find((c) => c.id === id)?.name ?? id;
const groupName = (id: string) => GUIDE_GROUPS.find((g) => g.id === id)?.name ?? id;

/* ------------------------------ support ------------------------------ */

export function supportConfigured(config: Config): boolean {
  return Boolean(config.supportEmail);
}

/** "write to <name> at" / "write to" — the name only when configured. */
function writeTo(config: Config): string {
  return config.supportName ? `write to ${esc(config.supportName)} at` : 'write to';
}

function supportBlock(config: Config): string {
  if (!config.supportEmail) return '';
  const email = esc(config.supportEmail);
  const promise = config.supportReplyPromise
    ? `<p>The promise: ${esc(config.supportReplyPromise)}. Email is the official support channel — it always reaches a human, even when everything else is quiet.</p>`
    : '<p>Email is the official support channel — it always reaches a human, even when everything else is quiet.</p>';
  return `<section class="h-support" id="support" aria-labelledby="support-h">
      <p class="kicker accent">Write to a human</p>
      <h2 id="support-h">When the guides run out</h2>
      <p>Support at Beuk is a person, not a ticket system. If you're stuck, curious, or something looks wrong, ${writeTo(config)}</p>
      <p class="support-email"><a href="mailto:${email}">${email}</a></p>
      ${promise}
      <p class="muted small">It helps to say what you were doing, what you saw, and the BEUK- code if the page gave you one. Never attach your manuscript unless you mean to.</p>
    </section>`;
}

/** The no-results contact line — only when SUPPORT_EMAIL is set. */
function supportNoHit(config: Config): string {
  if (!config.supportEmail) return '';
  return `<p>If it's something Beuk did, ${writeTo(config)} <a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a> and say what you were looking for.</p>`;
}

/** The in-page results region; carries the server's contact line (or none) for help.js. */
function searchOut(config: Config, inner = ''): string {
  const sup = supportNoHit(config);
  return `<div class="search-out" data-search-out aria-live="polite"${sup ? ` data-support="${esc(sup)}"` : ''}>${inner}</div>`;
}

/* ------------------------------ status ------------------------------ */

function statusHeadline(s: ShelfStatus): string {
  if (s.headline === 'down') return 'Something is down — the database did not answer';
  if (s.headline === 'tidy') return 'The last shelf-check found something to tidy';
  if (s.headline === 'partial') return `Up — ${s.gaps.join('; ')}`;
  return "All's well on the shelf";
}

function statusPill(s: ShelfStatus): string {
  return `<a class="pill status-pill is-${s.headline}" href="/help/#status" title="Live shelf status, read when this page was made"><span class="dot" aria-hidden="true"></span>${esc(statusHeadline(s))}</a>`;
}

function statusRows(s: ShelfStatus): string {
  const rows: [string, string, string][] = [];
  rows.push(['app', 'up', 'this page came from it']);
  rows.push(['db', s.db, s.db === 'up' ? 'answered just now' : 'did not answer']);
  if (s.queue) {
    const n = s.queue.queued + s.queue.running;
    rows.push(['jobs', `${n} waiting or running`, `${s.queue.running} running · ${s.queue.queued} queued`]);
  } else rows.push(['jobs', 'unknown', 'the job queue could not be read']);
  rows.push([
    'epubcheck',
    s.epubcheck === 'installed' ? 'installed' : 'not installed',
    s.epubcheck === 'installed' ? 'whether it runs is known when a job runs it' : 'server EPUBCheck jobs fail and say so',
  ]);
  if (s.selfChecks) {
    rows.push([
      'self-checks',
      s.selfChecks.overall === 'pass' ? 'last run passed' : `last run: ${s.selfChecks.overall}`,
      `${s.selfChecks.passed} passed · ${s.selfChecks.failed} failed · ${humanDateTimeUtc(s.selfChecks.at)}`,
    ]);
  } else if (s.selfChecksUnreadable) rows.push(['self-checks', 'unknown', 'the run history could not be read']);
  else if (s.db === 'up') rows.push(['self-checks', 'none yet', 'no Housekeeping self-check run is recorded']);
  else rows.push(['self-checks', 'unknown', 'the database did not answer']);
  return rows
    .map(
      ([k, v, note]) =>
        `<li><span class="k">${esc(k)}</span><span class="v${v === 'up' || v === 'last run passed' || v === 'installed' ? ' ok' : v === 'down' || v.startsWith('last run:') ? ' bad' : ''}">${esc(v)}</span><span class="note">${esc(note)}</span></li>`,
    )
    .join('');
}

function statusBlock(s: ShelfStatus): string {
  let line = statusHeadline(s) + '.';
  if (s.headline === 'well') line += ' Beuk is up and running.';
  if (s.selfChecks) {
    line +=
      s.selfChecks.overall === 'pass'
        ? ` The last shelf-check passed on ${humanDate(s.selfChecks.at)}.`
        : ` The last shelf-check, on ${humanDate(s.selfChecks.at)}, found something to tidy.`;
  }
  return `<section class="h-status" id="status" aria-labelledby="status-h">
      <p class="kicker" id="status-h">Shelf status</p>
      <p class="status-line" id="status-line">${esc(line)}</p>
      <ul class="status-rows">${statusRows(s)}</ul>
      <p class="muted small">Read live by the server at ${esc(humanDateTimeUtc(s.checkedAt))}. Reload for a fresh reading.</p>
    </section>`;
}

/* ------------------------------ chrome ------------------------------ */

export function chrome(
  ctx: PageCtx,
  opts: { title: string; description?: string; active?: 'guides' | 'errors' | 'search' | null; body: string; wide?: boolean; status?: number },
): string {
  const { config, status } = ctx;
  const nav = [
    ['guides', '/help/', 'Guides'],
    ['errors', '/help/errors', 'Error codes'],
    ['search', '/help/search', 'Search'],
  ]
    .map(([id, href, label]) => `<a href="${href}"${opts.active === id ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  const footLinks: string[] = [];
  if (config.supportEmail) footLinks.push(`<a href="mailto:${esc(config.supportEmail)}">${esc(config.supportEmail)}</a>`);
  footLinks.push('<a href="/help/#founders">Founders\' Shelf</a>');
  footLinks.push('<a href="/privacy">Privacy</a>', '<a href="/terms">Terms</a>');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${esc(opts.title)}</title>
    ${opts.description ? `<meta name="description" content="${esc(opts.description)}" />` : ''}
    <script src="${helpAssetUrl('theme.js')}"></script>
    <link rel="icon" href="/assets/logo.webp" />
    ${HELP_FONT_PRELOADS.map((u) => `<link rel="preload" href="${u}" as="font" type="font/woff2" crossorigin />`).join('\n    ')}
    <link rel="stylesheet" href="${FONTS_HREF}" />
    <link rel="stylesheet" href="${FONTS_HELP_HREF}" />
    <link rel="stylesheet" href="${helpAssetUrl('help.css')}" />
    ${billingGateHtml(config)}
  </head>
  <body class="help">
    <a class="skip" href="#main">Skip to the page</a>
    <header class="hh">
      <div class="hh-in">
        <a class="brand" href="/help/" aria-label="Beuk Help — home">
          <img src="/assets/logo.webp" alt="" width="30" height="36" />
          <span class="brand-txt"><span class="brand-name">beuk</span><span class="brand-sub"><span class="subbrand">${esc(BRAND_SUBLINE)}</span> · Help</span></span>
        </a>
        <span class="brand-div" aria-hidden="true"></span>
        <nav class="hh-nav" aria-label="Help">${nav}<a href="/changelog">Changelog</a><a href="/roadmap">Roadmap</a>${supportNavHtml(config)}</nav>
        <div class="hh-right">
          ${statusPill(status)}
          <button class="theme-btn" type="button" data-theme-toggle hidden>Candlelight</button>
          <a class="open-studio" href="/">Open the studio</a>
        </div>
      </div>
    </header>
    <main id="main" class="${opts.wide ? 'h-main wide' : 'h-main'}">
${opts.body}
    </main>
    <footer class="hf">
      <div class="hf-in">
        <p class="foot-note">${esc(BRAND_FOOTNOTE)}</p>
        <span class="hf-links">${footLinks.join('')}</span>
      </div>
      ${kofiJarHtml(config)}
    </footer>
    <script src="${helpAssetUrl('help.js')}" defer></script>
  </body>
</html>
`;
}

/* ------------------------------ search ------------------------------ */

export function searchForm(q = '', opts: { big?: boolean; autofocus?: boolean } = {}): string {
  return `<form class="h-search${opts.big ? ' big' : ''}" action="/help/search" method="post" role="search" data-help-search>
      <label class="sr" for="help-q">Search the guides and the error dictionary</label>
      <span class="prompt" aria-hidden="true">›</span>
      <textarea id="help-q" name="q" rows="1" maxlength="20000" spellcheck="false" placeholder="e.g. RSC-005 · cover too small · my streak restarted · or paste a store's message"${opts.autofocus ? ' autofocus' : ''}>${esc(q)}</textarea>
      <button type="button" class="clear" data-search-clear hidden>Clear</button>
      <button type="submit" class="go">Search</button>
    </form>`;
}

function suggestionChips(ctx: PageCtx): string {
  return `<div class="chips"><span class="muted">Try</span>${ctx.content.home.suggestions
    .map((s) => `<a class="chip${s.mono ? ' mono' : ''}" href="/help/search?q=${encodeURIComponent(s.label)}" data-q="${esc(s.label)}">${esc(s.label)}</a>`)
    .join('')}</div>`;
}

function snippetHtml(s: string): string {
  return esc(s).replace(/«/g, '<mark>').replace(/»/g, '</mark>');
}

function hitRow(h: SearchHit, logId: string | null): string {
  const data = `data-ref="${esc(h.kind === 'error' ? h.ref : h.ref)}"${logId ? ` data-log="${esc(logId)}"` : ''}`;
  const how = h.match === 'code' ? `matched ${h.matchedCode}` : h.match === 'similar' ? 'similar spelling' : '';
  if (h.kind === 'error') {
    return `<a class="hit err" href="${esc(h.url)}" ${data}><span class="code">${esc(h.code ?? '')}</span><span class="t">${esc(h.title)}</span>${how ? `<span class="how">${esc(how)}</span>` : ''}<span class="snip">${snippetHtml(h.snippet)}</span></a>`;
  }
  return `<a class="hit" href="${esc(h.url)}" ${data}><span class="t">${esc(h.title)}</span>${how ? `<span class="how">${esc(how)}</span>` : ''}<span class="snip">${snippetHtml(h.snippet)}</span></a>`;
}

export function resultsHtml(ctx: PageCtx, r: SearchResult): string {
  if (!r.q) return '';
  const parts: string[] = [];
  if (r.codes.length) parts.push(`<p class="muted small">Codes in what you searched: ${r.codes.map((c) => `<code>${esc(c)}</code>`).join(' ')}</p>`);
  const group = (label: string, hits: SearchHit[]) =>
    hits.length ? `<div class="hits"><p class="kicker">${label} · ${hits.length}</p><div class="hit-list">${hits.map((h) => hitRow(h, r.logId)).join('')}</div></div>` : '';
  parts.push(group('Error codes', r.errors), group('Guides', r.guides), group('Sections of guides', r.sections));
  if (!r.total) {
    parts.push(
      `<div class="no-hits"><p>Nothing in the guides or the error dictionary matches that yet.</p><p class="muted small">Searches are logged as the first 200 characters and the number of results — never who searched.</p>${supportNoHit(ctx.config)}</div>`,
    );
  }
  return `<div class="results" data-total="${r.total}">${parts.join('')}</div>`;
}

/* --------------------------- error dictionary --------------------------- */

const SAYS_FROM: Record<SaysLine['from'], string> = {
  epubcheck: 'EPUBCheck',
  validator: "Beuk's validator",
  server: "Beuk's server",
  studio: 'The studio',
  store: 'The store',
};

function youMightSee(e: HelpError): string {
  if (e.maps.epubcheck.length) return e.maps.epubcheck.slice(0, 2).join(' · ') + (e.maps.epubcheck.length > 2 ? ' …' : '');
  if (e.maps.http.length) return 'HTTP ' + e.maps.http.map((h) => h.status).join(' · ');
  if (e.maps.store.length) return e.maps.store.join(' · ');
  if (e.maps.validator.length) return 'Validator';
  if (e.says.length) return SAYS_FROM[e.says[0].from];
  return '—';
}

function saysBox(e: HelpError, limit = 99): string {
  if (!e.says.length) return '<p class="muted small">No exact wording is shown: none could be taken from a source (see Sources).</p>';
  return `<ul class="says-list">${e.says
    .slice(0, limit)
    .map((s) => `<li><span class="from">${esc(SAYS_FROM[s.from])}${s.code && s.from === 'epubcheck' ? ' ' + esc(s.code) : ''}</span><span class="says">${esc(s.text)}</span></li>`)
    .join('')}</ul>`;
}

function errorRows(ctx: PageCtx, open: string | null = null): string {
  return ctx.content.errors
    .map((e) => {
      const g = ctx.content.guideBySlug.get(e.guide);
      return `<details class="err-row" data-cat="${esc(e.category)}" id="${esc(e.code)}"${open === e.code ? ' open' : ''}>
        <summary><span class="c-code">${esc(e.code)}</span><span class="c-see">${esc(youMightSee(e))}</span><span class="c-title">${esc(e.title)}</span><span class="c-cat">${esc(categoryName(e.category))}</span></summary>
        <div class="err-body">
          <div class="eb-a">${saysBox(e, 3)}<p class="cause"><b>What happened.</b> ${esc(e.cause)}</p></div>
          <div class="eb-b"><p class="kicker">Work through it</p><ol>${e.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
            <p class="links">${g ? `<a href="/help/${esc(g.slug)}">Read: ${esc(g.title)} →</a>` : ''}<a href="/help/errors/${esc(e.code)}">The full entry →</a></p></div>
        </div>
      </details>`;
    })
    .join('');
}

function categoryChips(ctx: PageCtx): string {
  const used = new Set(ctx.content.errors.map((e) => e.category));
  return `<div class="cat-chips" data-cat-filter hidden role="group" aria-label="Filter by area"><button type="button" class="chip on" data-cat="all" aria-pressed="true">All</button>${ERROR_CATEGORIES.filter((c) => used.has(c.id))
    .map((c) => `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="false">${esc(c.name)}</button>`)
    .join('')}</div>`;
}

function errorTable(ctx: PageCtx): string {
  return `<div class="err-table">
        <div class="err-head" aria-hidden="true"><span class="c-code">Beuk</span><span class="c-see">You might see</span><span class="c-title">What it means</span><span class="c-cat">Area</span></div>
        ${errorRows(ctx)}
      </div>`;
}

const DICT_INTRO =
  'Every failure Beuk knows about has a <span class="mono">BEUK-</span> code, mapped to the EPUBCheck code, studio or server message, HTTP status or store rule you might actually see. Open one for the cause in plain terms and a checklist.';

/* ------------------------------ home ------------------------------ */

function guideIndex(ctx: PageCtx): string {
  return GUIDE_GROUPS.map(
    (grp) => `<div class="g-col"><p class="g-col-h">${esc(grp.name)}</p>${ctx.content.guides
      .filter((g) => g.group === grp.id)
      .map(
        (g) =>
          `<a class="g-item" href="/help/${esc(g.slug)}"><span class="g-t">${esc(g.title)}${g.isNew ? '<span class="new">New</span>' : ''}</span><span class="g-b">${esc(g.blurb)}</span></a>`,
      )
      .join('')}</div>`,
  ).join('');
}

const FOUNDERS = `<section class="h-founders" id="founders" aria-labelledby="founders-h">
      <h2 id="founders-h">The Founders' Shelf</h2>
      <p>Beuk is opening its first seats to a small shelf of founding writers — the people whose books and grumbles will shape what gets built next. There's no public community (yet, deliberately: a quiet room with twenty writers beats an empty hall), but the list is open. Leave your name and a line about what you write, and the invitation will come to you.</p>
      <form id="founders-form" class="founders-form">
        <label>Your name <input name="name" required maxlength="80" /></label>
        <label>Email <input name="email" type="email" required maxlength="254" /></label>
        <label class="wide">What do you write? <input name="about" required maxlength="500" placeholder="A line is plenty — a novel about…, poems, a family history…" /></label>
        <p><button type="submit">Put me on the shelf</button></p>
        <p id="founders-result" role="status"></p>
      </form>
      <noscript><p class="muted small">The form needs JavaScript to send.</p></noscript>
    </section>`;

export function renderHome(ctx: PageCtx): string {
  const paths = ctx.content.home.paths
    .map(
      (p) => `<div class="path-card"><span class="kicker gold mono">${esc(p.kicker)}</span><h3>${esc(p.title)}</h3><div class="path-links">${p.links
        .map((l) => `<a href="${esc(l.href)}"><span>${esc(l.label)}</span><span aria-hidden="true">→</span></a>`)
        .join('')}</div></div>`,
    )
    .join('');
  const body = `<div class="home">
    <section class="hero">
      <p class="kicker gold">The reading room</p>
      <h1>What are you trying to do?</h1>
      <p class="lede">Search in your own words, or paste the exact message a store or the studio gave you — every code in it is looked up in Beuk's guides and error dictionary.</p>
    </section>
    <section class="search-wrap" id="search" aria-label="Search">
      ${searchForm('', { big: true })}
      ${suggestionChips(ctx)}
      ${searchOut(ctx.config)}
    </section>
    <section class="h-sec">
      <h2>Start from where you are</h2>
      <p class="sub">Four ways in. Pick the one that sounds like you.</p>
      <div class="paths">${paths}</div>
    </section>
    <section class="h-sec" id="guides">
      <div class="sec-head"><h2>Guides</h2><span class="muted">Each one is about one task, with the steps first.</span></div>
      <div class="g-cols">${guideIndex(ctx)}</div>
    </section>
    <section class="h-sec" id="codes">
      <div class="sec-head"><div><h2>The error dictionary</h2><p class="sub">${DICT_INTRO}</p></div>${categoryChips(ctx)}</div>
      ${errorTable(ctx)}
    </section>
    <section class="h-sec duo">
      ${supportBlock(ctx.config)}
      ${statusBlock(ctx.status)}
    </section>
    ${FOUNDERS}
  </div>`;
  return chrome(ctx, { title: 'Help — Beuk', description: "Beuk's help shelf: task guides, the error dictionary, and search.", active: 'guides', body });
}

/* ------------------------------ guide ------------------------------ */

function codeChips(codes: string[]): string {
  return codes.length ? `<span class="code-chips">${codes.map((c) => `<a class="mono" href="/help/errors/${esc(c)}">${esc(c)}</a>`).join(' · ')}</span>` : '';
}

function blockHtml(b: GuideBlock, g: Guide): string {
  if (b.kind === 'p') return `<p>${b.html}</p>`;
  if (b.kind === 'says') return `<p class="says">${esc(b.text)}</p>`;
  const items = b.items
    .map((it) => {
      const paneAttrs = it.pane ? ` data-pane="${esc(it.pane)}" data-hl="${esc(it.highlight.join('|'))}"` : '';
      const label = it.pane ? g.panes.find((p) => p.id === it.pane)?.label : null;
      const inner = `<span class="li-t">${it.html}</span>${codeChips(it.codes)}`;
      return it.pane
        ? `<li class="pick"${paneAttrs}>${inner}<button type="button" class="see" data-pick>Show in “${esc(label ?? it.pane)}”</button></li>`
        : `<li>${inner}</li>`;
    })
    .join('');
  return `<${b.kind} class="${b.kind === 'ul' ? 'plain-list' : 'num-list'}">${items}</${b.kind}>`;
}

function sectionHtml(sec: GuideSection, g: Guide, level: 'h2' | 'h3' = 'h2'): string {
  const id = sectionAnchor(sec.heading);
  return `<section class="g-sec" id="${esc(id)}"><${level}>${esc(sec.heading)}</${level}>${sec.blocks.map((b) => blockHtml(b, g)).join('')}</section>`;
}

function paneHtml(g: Guide): string {
  if (!g.panes.length) return '';
  const tabs = g.panes
    .map((p, i) => `<button type="button" role="tab" id="tab-${esc(p.id)}" aria-controls="pane-${esc(p.id)}" aria-selected="${i === 0}" data-tab="${esc(p.id)}">${esc(p.label)}</button>`)
    .join('');
  const panes = g.panes
    .map(
      (p, i) => `<div class="pane" role="tabpanel" id="pane-${esc(p.id)}" aria-labelledby="tab-${esc(p.id)}" data-pane-id="${esc(p.id)}"${i === 0 ? '' : ' data-start-hidden'}>
          <p class="pane-cap"><span>${esc(p.caption)}</span></p>
          <div class="pane-lines" tabindex="0">${p.lines.map((l, n) => `<div class="ln" data-n="${n + 1}"><span class="n">${n + 1}</span><span class="t">${esc(l) || ' '}</span></div>`).join('')}</div>
          <p class="pane-foot"><b>Excerpt, not live:</b> ${esc(p.source)}</p>
        </div>`,
    )
    .join('');
  return `<aside class="g-pane" aria-label="The part of the file or result a step talks about">
      <div class="pane-box"><div class="pane-tabs" role="tablist" data-tabs hidden>${tabs}</div>${panes}</div>
    </aside>`;
}

function guideNav(ctx: PageCtx, current: string): string {
  return `<nav class="g-nav" aria-label="All guides"><a class="back" href="/help/">← All guides</a>${GUIDE_GROUPS.map(
    (grp) =>
      `<p class="g-nav-h">${esc(grp.name)}</p>${ctx.content.guides
        .filter((g) => g.group === grp.id)
        .map((g) => `<a href="/help/${esc(g.slug)}"${g.slug === current ? ' aria-current="page"' : ''}>${esc(g.title)}</a>`)
        .join('')}`,
  ).join('')}<p class="g-nav-h">Reference</p><a href="/help/errors">The error dictionary</a></nav>`;
}

export function renderGuide(ctx: PageCtx, g: Guide): string {
  const hasTech = g.steps.some((s) => s.tech);
  const steps = g.steps.length
    ? `<section class="g-sec" id="steps"><h2>Steps</h2><ol class="steps">${g.steps
        .map((s, i) => {
          const label = s.pane ? g.panes.find((p) => p.id === s.pane)?.label ?? s.pane : null;
          return `<li class="step${s.pane ? ' pick' : ''}"${s.pane ? ` data-pane="${esc(s.pane)}" data-hl="${esc(s.highlight.join('|'))}"` : ''}><span class="num" aria-hidden="true">${i + 1}</span><span class="st"><span class="st-t">${s.html}</span>${
            s.techHtml ? `<span class="tech">${s.techHtml}</span>` : ''
          }${s.pane ? `<button type="button" class="see" data-pick>Show in “${esc(label!)}” →</button>` : ''}</span></li>`;
        })
        .join('')}</ol></section>`
    : '';
  const trouble = g.troubleshooting.length
    ? `<div class="trouble">${g.troubleshooting.map((s) => sectionHtml(s, g)).join('')}</div>`
    : '';
  const related = g.related
    .map((r) => ctx.content.guideBySlug.get(r))
    .filter((x): x is Guide => Boolean(x));
  const relatedHtml = related.length
    ? `<div class="related"><p class="kicker">Related guides</p>${related.map((r) => `<a href="/help/${esc(r.slug)}">${esc(r.title)}</a>`).join('')}</div>`
    : '';
  const article = `<article class="g-art">
      <p class="kicker gold">${esc(groupName(g.group))} · guide${g.isNew ? ' <span class="new">New</span>' : ''}</p>
      <h1>${esc(g.title)}</h1>
      ${g.lede.map((l) => `<p class="lede">${l.html}</p>`).join('')}
      <div class="g-meta">${hasTech ? `<span class="muted">Detail</span><div class="seg" data-detail hidden role="group" aria-label="Detail"><button type="button" data-detail-set="plain" aria-pressed="false">Plain English</button><button type="button" data-detail-set="tech" aria-pressed="true">With the technical bits</button></div>` : ''}<span class="g-time">${g.readMinutes} min · updated ${esc(humanDate(g.updated))}</span></div>
      ${steps}
      ${g.explanation.map((s) => sectionHtml(s, g)).join('')}
      ${trouble}
      ${relatedHtml}
    </article>`;
  const body = `<div class="g-page${g.panes.length ? ' has-pane' : ''}">
    ${guideNav(ctx, g.slug)}
    ${supportBlocks(article, ctx.config)}
    ${paneHtml(g)}
  </div>`;
  return chrome(ctx, { title: `${g.title} — Beuk Help`, description: g.blurb, active: 'guides', body, wide: true });
}

/* ------------------------------ errors ------------------------------ */

export function renderErrorsIndex(ctx: PageCtx): string {
  const body = `<div class="errs">
    <section class="hero slim">
      <p class="kicker gold">Reference</p>
      <h1>The error dictionary</h1>
      <p class="lede">${DICT_INTRO}</p>
    </section>
    <section class="search-wrap">${searchForm('')}${searchOut(ctx.config)}</section>
    <section class="h-sec tight">${categoryChips(ctx)}${errorTable(ctx)}</section>
  </div>`;
  return chrome(ctx, { title: 'Error dictionary — Beuk Help', description: 'Every BEUK- code, with the EPUBCheck code, message or HTTP status it maps to.', active: 'errors', body });
}

export function renderErrorPage(ctx: PageCtx, e: HelpError): string {
  const g = ctx.content.guideBySlug.get(e.guide);
  const mapRows: string[] = [];
  if (e.maps.epubcheck.length) mapRows.push(`<tr><th>EPUBCheck</th><td>${e.maps.epubcheck.map((c) => `<code>${esc(c)}</code>`).join(' ')}</td></tr>`);
  if (e.maps.validator.length) mapRows.push(`<tr><th>Studio validator</th><td>${e.maps.validator.map((c) => `<code>${esc(c)}</code>`).join(' ')}</td></tr>`);
  if (e.maps.http.length) mapRows.push(`<tr><th>HTTP</th><td>${e.maps.http.map((h) => `<code>${h.status}</code> ${esc(h.route)}`).join('<br />')}</td></tr>`);
  if (e.maps.store.length) mapRows.push(`<tr><th>Store</th><td>${e.maps.store.map((s) => esc(s)).join(', ')}</td></tr>`);
  const body = `<div class="err-page">
    <p class="crumbs"><a href="/help/">Help</a> / <a href="/help/errors">Error dictionary</a> / <span>${esc(e.code)}</span></p>
    <p class="err-chips"><span class="code-chip">${esc(e.code)}</span><span class="chip ghost">${esc(categoryName(e.category))}</span><span class="chip ghost">${esc(e.severity)}</span></p>
    <h1>${esc(e.title)}</h1>
    <div class="err-cols">
      <div>
        <h2>You might see</h2>
        ${saysBox(e)}
        <h2>What happened</h2>
        <p class="cause big">${esc(e.cause)}</p>
      </div>
      <div>
        <h2>Work through it</h2>
        <ol class="num-list">${e.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${g ? `<p><a class="strong" href="/help/${esc(g.slug)}">Read: ${esc(g.title)} →</a></p>` : ''}
        ${mapRows.length ? `<h2>Maps to</h2><table class="maps">${mapRows.join('')}</table>` : ''}
        <h2>Sources</h2>
        <ul class="sources">${e.sources.map((s) => `<li>${/^https:\/\//.test(s) ? linkify(s) : esc(s)}</li>`).join('')}</ul>
      </div>
    </div>
    ${supportConfigured(ctx.config) ? `<p class="muted small">Still stuck? ${writeTo(ctx.config)} <a href="mailto:${esc(ctx.config.supportEmail!)}">${esc(ctx.config.supportEmail!)}</a> and mention ${esc(e.code)}.</p>` : ''}
  </div>`;
  return chrome(ctx, { title: `${e.code}: ${e.title} — Beuk Help`, description: e.cause, active: 'errors', body });
}

function linkify(s: string): string {
  const m = /^(https:\/\/\S+)(.*)$/.exec(s)!;
  return `<a href="${esc(m[1])}" rel="noopener noreferrer">${esc(m[1])}</a>${esc(m[2])}`;
}

export function renderSearchPage(ctx: PageCtx, r: SearchResult, limited: { retryAfterSec: number } | null): string {
  const out = limited
    ? `<p class="no-hits">That's a lot of searching in a short time — please wait ${limited.retryAfterSec} second${limited.retryAfterSec === 1 ? '' : 's'} and try again.</p>`
    : r.q
      ? resultsHtml(ctx, r)
      : '<p class="muted">Type a few words, a code like RSC-005, or paste the whole message.</p>';
  const body = `<div class="search-page">
    <section class="hero slim">
      <p class="kicker gold">Search</p>
      <h1>${r.q ? 'Search results' : 'Search the help shelf'}</h1>
    </section>
    <section class="search-wrap">${searchForm(r.q, { big: true })}${suggestionChips(ctx)}${searchOut(ctx.config, out)}</section>
  </div>`;
  return chrome(ctx, { title: r.q ? `“${r.q.slice(0, 60)}” — Beuk Help search` : 'Search — Beuk Help', active: 'search', body });
}

export function renderNotFound(ctx: PageCtx, what: string): string {
  const body = `<div class="err-page"><h1>Not on this shelf</h1><p class="lede">${esc(what)}</p><p><a href="/help/">All guides</a> · <a href="/help/errors">The error dictionary</a></p>${searchForm('')}</div>`;
  return chrome(ctx, { title: 'Not found — Beuk Help', body });
}
