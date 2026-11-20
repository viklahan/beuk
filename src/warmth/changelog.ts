import { escapeHtml, renderInline } from './markdown.js';
import { splitLead } from './roadmap.js';

/**
 * /changelog as a release table (after docs.stripe.com/changelog), not an
 * essay. CHANGELOG.md stays the one source, written for people: a `# title`,
 * an intro, then one `## <YYYY-MM-DD> — <release title>` per release, each a
 * list of `- **Change.** detail` items, optionally split by a bold `**Group**`
 * line. Every item becomes one row — its bold lead (or first sentence) as the
 * row, an area tag on the right, the rest folded under the row — so a reader
 * can scan a release in seconds, search, and filter by area. Every word of
 * the source is still in the page (the folded detail is real HTML, so it
 * prints, searches and works without JavaScript).
 */

export interface ChangelogItem {
  /** The row: inline Markdown, unrendered. */
  title: string;
  /** The folded detail (inline Markdown, unrendered; "" when the row says it all). */
  body: string;
  /** One of AREAS. */
  area: string;
}

export interface ChangelogGroup {
  /** The bold group line ("Two-step sign-in"), or null for items before any group. */
  name: string | null;
  items: ChangelogItem[];
}

export interface ChangelogRelease {
  date: string;
  title: string;
  /** Unique anchor: several releases can share a date. */
  id: string;
  /** Prose paragraphs in the release that are not list items. */
  notes: string[];
  groups: ChangelogGroup[];
}

export interface Changelog {
  title: string;
  intro: string[];
  releases: ChangelogRelease[];
}

/**
 * Areas, checked in order against the row (and its group name). Words, not
 * guesses about intent: a row names what it touches. Anything unmatched is
 * "Studio", the writing desk itself.
 */
export const AREAS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Fixes', /^\s*(fix(ed|es)?\b|no longer\b)|\bfix(es|ed)?\b\s*$/i],
  ['Import', /\bimport|\barriv|\bbring(ing)? books|locked manuscript|manuscript with a password/i],
  ['Sharing', /\bshar(e|ing)\b|\breader|\bbeta\b|review cop|reading link|\bcomments?\b/i],
  ['Account', /sign[- ]?in|signed in|\baccount|two-step|recovery code|\bbackup|\bemail|\btrial|free week|21 days|authorship|\bstamp|\bprivacy|what beuk keeps|your data|your address/i],
  ['Export & print', /\bexport|\bbuild|\bprint|\bpdf|\bepub|\bbleed|cover|\bspine|\bwrap\b|store-ready|\bstore\b|submission|running head|hardback|typeface|\bfont|\btheme|box set|\bword (file|export)|\bvalidator|epubcheck/i],
  ['Site & help', /\bhelp\b|\bsite\b|\bramp\b|front (page|door)|\btour\b|changelog|roadmap|\bcompar|lighthouse|showcase|caife|ko-fi|error codes|road so far/i],
];

/** The first area whose words appear, or null. */
function matchArea(text: string, fixesText: string): string | null {
  for (const [area, re] of AREAS) if (re.test(area === 'Fixes' ? fixesText : text)) return area;
  return null;
}

/**
 * A row's area: its own words (with its group's name) first, then the
 * release's title ("Locked manuscripts open" makes its "Cancel changes
 * nothing" an Import row), then Studio.
 */
export function areaOf(title: string, group: string | null, release = ''): string {
  if (group && /^fix/i.test(group)) return 'Fixes';
  return matchArea(`${group ?? ''} ${title}`, title) ?? matchArea(release, '') ?? 'Studio';
}

export const AREA_ORDER = ['Studio', 'Import', 'Export & print', 'Sharing', 'Account', 'Site & help', 'Fixes'];

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
}

const RELEASE = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+?)\s*$/;
const GROUP = /^\*\*([^*]+?)\*\*\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const BOLD_LEAD = /^\*\*(.+?)\*\*\s*(.*)$/s;

/** One list item's text → a row and its folded detail. */
export function itemOf(text: string, group: string | null, release = ''): ChangelogItem {
  const m = BOLD_LEAD.exec(text);
  let title: string;
  let body: string;
  if (m && m[1].trim().length > 0) {
    title = m[1].trim().replace(/[.:]$/, '');
    body = m[2].trim();
    // "**Fixed:** with the interface in Arabic…" — the label alone is no row.
    if (/^fix(ed|es)?$/i.test(title) && body) {
      const { lead, more } = splitLead(body);
      title = `Fixed: ${lead.replace(/\.$/, '')}`;
      body = more;
    }
  } else {
    const { lead, more } = splitLead(text.trim());
    title = lead.replace(/\.$/, '');
    body = more;
  }
  return { title, body, area: areaOf(title, group, release) };
}

export function parseChangelog(source: string): Changelog {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let title = 'Changelog';
  const intro: string[] = [];
  const releases: ChangelogRelease[] = [];
  const used = new Set<string>();
  let rel: ChangelogRelease | null = null;
  let group: ChangelogGroup | null = null;
  let item: string[] | null = null; // the current bullet's lines
  let para: string[] = [];

  const flushItem = () => {
    if (item && rel) {
      if (!group) { group = { name: null, items: [] }; rel.groups.push(group); }
      group.items.push(itemOf(item.join(' ').replace(/\s+/g, ' ').trim(), group.name, rel.title));
    }
    item = null;
  };
  const flushPara = () => {
    const text = para.join(' ').replace(/\s+/g, ' ').trim();
    if (text) (rel ? rel.notes : intro).push(text);
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !rel) { title = h1[1].trim(); continue; }
    const r = RELEASE.exec(line);
    if (r) {
      flushItem(); flushPara();
      let id = `${r[1]}-${slug(r[2])}`;
      while (used.has(id)) id += '-x';
      used.add(id);
      rel = { date: r[1], title: r[2], id, notes: [], groups: [] };
      group = null;
      releases.push(rel);
      continue;
    }
    if (!line.trim()) { flushItem(); flushPara(); continue; }
    const g = GROUP.exec(line.trim());
    if (g && rel && !/^\s/.test(raw)) {
      flushItem(); flushPara();
      group = { name: g[1].trim().replace(/[.:]$/, ''), items: [] };
      rel.groups.push(group);
      continue;
    }
    const b = BULLET.exec(line);
    if (b && rel) { flushItem(); flushPara(); item = [b[1]]; continue; }
    if (item && /^\s+\S/.test(raw)) { item.push(line.trim()); continue; }
    flushItem();
    para.push(line.trim());
  }
  flushItem(); flushPara();
  return { title, intro, releases };
}

const inline = (md: string) => renderInline(escapeHtml(md));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthOf(date: string): string {
  const [y, m] = date.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function rowHtml(it: ChangelogItem): string {
  const tag = `<span class="cl-tag" data-area="${escapeHtml(it.area)}">${escapeHtml(it.area)}</span>`;
  if (!it.body) {
    return `<div class="cl-row cl-plain" data-area="${escapeHtml(it.area)}"><span class="cl-t">${inline(it.title)}</span>${tag}</div>`;
  }
  return `<details class="cl-row" data-area="${escapeHtml(it.area)}"><summary><span class="cl-t">${inline(it.title)}</span>${tag}</summary><p class="cl-body">${inline(it.body)}</p></details>`;
}

function releaseHtml(r: ChangelogRelease): string {
  const notes = r.notes.map((n) => `<p class="cl-note">${inline(n)}</p>`).join('');
  const groups = r.groups
    .map((g) => `${g.name ? `<h3 class="cl-group">${escapeHtml(g.name)}</h3>` : ''}<div class="cl-table">${g.items.map(rowHtml).join('')}</div>`)
    .join('');
  return `<section class="cl-rel" id="${r.id}" data-month="${escapeHtml(monthOf(r.date))}">
        <h2 class="cl-h"><time datetime="${r.date}">${r.date}</time><span class="cl-title">${escapeHtml(r.title)}</span></h2>
        ${notes}${groups}
      </section>`;
}

export function renderChangelogBody(c: Changelog): string {
  const count = c.releases.reduce((n, r) => n + r.groups.reduce((k, g) => k + g.items.length, 0), 0);
  const areas = new Map<string, number>();
  for (const r of c.releases) for (const g of r.groups) for (const it of g.items) areas.set(it.area, (areas.get(it.area) ?? 0) + 1);
  const chips = AREA_ORDER.filter((a) => areas.has(a))
    .map((a) => `<button type="button" class="cl-chip" data-area="${escapeHtml(a)}" aria-pressed="false">${escapeHtml(a)} <b>${areas.get(a)}</b></button>`)
    .join('');
  const months: Array<[string, string]> = [];
  for (const r of c.releases) {
    const m = monthOf(r.date);
    if (!months.some(([name]) => name === m)) months.push([m, r.id]);
  }
  const side = c.releases.slice(0, 12)
    .map((r) => `<a href="#${r.id}"><time datetime="${r.date}">${r.date}</time><span>${escapeHtml(r.title)}</span></a>`)
    .join('');
  const monthLinks = months.map(([m, id]) => `<a class="cl-month" href="#${id}">${escapeHtml(m)}</a>`).join('');
  const latest = c.releases[0];
  return `<div class="cl" id="cl">
      <div class="cl-top">
        <div>
          <h1>${escapeHtml(c.title.replace(/^Beuk\s*[—–-]\s*/, ''))}</h1>
          ${c.intro[0] ? `<p class="cl-intro">${inline(c.intro[0])}</p>` : ''}
        </div>
        <aside class="cl-card">
          ${latest ? `<p>Latest release <a href="#${latest.id}"><time datetime="${latest.date}">${latest.date}</time></a></p>` : ''}
          <p>Wondering what comes next? <a href="/roadmap">See the roadmap.</a></p>
        </aside>
      </div>
      <div class="cl-tools" role="search">
        <label class="cl-search"><span class="sr-only">Search changes</span><input type="search" id="cl-q" placeholder="Search changes…" autocomplete="off" /></label>
        <div class="cl-chips" role="group" aria-label="Filter by area">${chips}</div>
        <p class="cl-count" aria-live="polite"><span id="cl-n">${count}</span> changes</p>
      </div>
      <div class="cl-layout">
        <nav class="cl-side" aria-label="Releases">
          <p class="cl-side-h">Recent releases</p>
          ${side}
          <p class="cl-side-h">By month</p>
          ${monthLinks}
        </nav>
        <div class="cl-main">
      ${c.releases.map(releaseHtml).join('\n      ')}
          <p class="cl-empty" id="cl-empty" hidden>No change matches that. Try fewer words, or another area.</p>
        </div>
      </div>
    </div>`;
}
