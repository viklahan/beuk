import { escapeHtml, renderInline } from './markdown.js';

/**
 * /roadmap as a board, not an essay. docs/roadmap.md stays the one source
 * (Housekeeping's Reference pillar reads it as written); this reads its
 * shape — an intro, then one `## <status>` per column, each a list of
 * `- **Title.** text` items (Shipped: `- **<date> — Title.** text`) — and
 * shows every item as its title and first sentence, the rest folded under
 * "More". Planned keeps its numbers because it is the build order; Shipped
 * is a dated list, its newest six open and the rest folded.
 */

export interface RoadmapItem {
  title: string;
  /** Shipped only: the date or era before the em dash ("2026-10-31", "Before launch"). */
  when: string | null;
  /** The first sentence of the text (inline Markdown, unrendered). */
  lead: string;
  /** Everything after it ("" when the item is one sentence). */
  more: string;
}

export interface RoadmapSection {
  status: string;
  /** Paragraphs between the heading and the list ("In the order…", "Newest first."). */
  intro: string[];
  items: RoadmapItem[];
}

export interface Roadmap {
  title: string;
  updated: string | null;
  intro: string[];
  sections: RoadmapSection[];
}

const SHIPPED_OPEN = 6;

/** The first sentence: up to the first ". ", "! " or "? " that is not inside brackets. */
export function splitLead(text: string): { lead: string; more: string } {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (depth === 0 && (c === '.' || c === '!' || c === '?') && text[i + 1] === ' ') {
      return { lead: text.slice(0, i + 1), more: text.slice(i + 2).trim() };
    }
  }
  return { lead: text, more: '' };
}

function paragraphs(lines: string[]): string[] {
  return lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

export function parseRoadmap(source: string): Roadmap {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const title = /^#\s+(.+)$/m.exec(source)?.[1]?.replace(/^Beuk\s+—\s+/, '') ?? 'Roadmap';
  const updated = /^Last updated:\s*(.+?)\.?\s*$/m.exec(source)?.[1] ?? null;
  const intro: string[] = [];
  const sections: RoadmapSection[] = [];
  let sec: RoadmapSection | null = null;
  let buf: string[] = [];
  let item: string[] | null = null;
  const closeItem = () => {
    if (!sec || !item) return;
    const raw = item.join(' ').replace(/\s+/g, ' ').trim();
    item = null;
    const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(raw);
    const head = m ? m[1]!.trim() : '';
    const rest = m ? m[2]!.trim() : raw;
    const dated = /^(.+?)\s+—\s+(.+)$/.exec(head);
    const when = sec.status === 'Shipped' && dated ? dated[1]!.trim() : null;
    const name = (when ? dated![2]! : head).replace(/[.:]$/, '').trim();
    if (!name) {
      const s = splitLead(rest);
      sec.items.push({ title: s.lead.replace(/\.$/, ''), when, lead: '', more: s.more });
      return;
    }
    const s = splitLead(rest);
    sec.items.push({ title: name, when, lead: s.lead, more: s.more });
  };
  const flushText = () => {
    const ps = paragraphs(buf);
    buf = [];
    if (sec) sec.intro.push(...ps);
    else intro.push(...ps.filter((p) => !/^Last updated:/.test(p)));
  };
  for (const line of lines) {
    if (/^#\s/.test(line)) continue;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      closeItem();
      flushText();
      sec = { status: h2[1]!.trim(), intro: [], items: [] };
      sections.push(sec);
      continue;
    }
    if (/^-\s+/.test(line)) {
      closeItem();
      flushText();
      item = [line.replace(/^-\s+/, '')];
      continue;
    }
    if (item && /^\s+\S/.test(line)) {
      item.push(line.trim());
      continue;
    }
    closeItem();
    buf.push(line);
  }
  closeItem();
  flushText();
  return { title, updated, intro, sections };
}

const inline = (s: string) => renderInline(escapeHtml(s));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function itemHtml(it: RoadmapItem, n: number | null): string {
  const num = n === null ? '' : `<span class="rm-n" aria-hidden="true">${n}</span>`;
  const when = it.when ? `<time class="rm-when"${/^\d{4}-\d{2}-\d{2}$/.test(it.when) ? ` datetime="${escapeHtml(it.when)}"` : ''}>${escapeHtml(it.when)}</time>` : '';
  const more = it.more
    ? `<details class="rm-more"><summary>More</summary><p>${inline(it.more)}</p></details>`
    : '';
  return `<li class="rm-item">${when}${num}<div class="rm-body"><h3 class="rm-t">${inline(it.title)}</h3>${it.lead ? `<p class="rm-lead">${inline(it.lead)}</p>` : ''}${more}</div></li>`;
}

function sectionHtml(sec: RoadmapSection): string {
  const id = slug(sec.status);
  const kind = ['in-progress', 'planned', 'exploring', 'shipped'].includes(id) ? id : 'other';
  const note = sec.intro.length ? `<p class="rm-note">${sec.intro.map(inline).join(' ')}</p>` : '';
  let list: string;
  if (kind === 'planned') {
    list = `<ol class="rm-list">${sec.items.map((it, i) => itemHtml(it, i + 1)).join('')}</ol>`;
  } else if (kind === 'shipped' && sec.items.length > SHIPPED_OPEN) {
    const older = sec.items.slice(SHIPPED_OPEN);
    list = `<ul class="rm-list">${sec.items.slice(0, SHIPPED_OPEN).map((it) => itemHtml(it, null)).join('')}</ul>` +
      `<details class="rm-older"><summary>${older.length} earlier releases</summary><ul class="rm-list">${older.map((it) => itemHtml(it, null)).join('')}</ul></details>`;
  } else {
    list = `<ul class="rm-list">${sec.items.map((it) => itemHtml(it, null)).join('')}</ul>`;
  }
  return `<section class="rm-col rm-${kind}" id="${id}" aria-labelledby="${id}-h">
        <header class="rm-head"><h2 id="${id}-h">${escapeHtml(sec.status)}</h2><span class="rm-count">${sec.items.length}</span></header>
        ${note}${list}
      </section>`;
}

export function renderRoadmapBody(r: Roadmap): string {
  const jump = r.sections
    .map((s) => `<a class="rm-jump" href="#${slug(s.status)}"><span>${escapeHtml(s.status)}</span><b>${s.items.length}</b></a>`)
    .join('');
  const updated = r.updated ? `<p class="rm-updated">Updated <time${/^\d{4}-\d{2}-\d{2}$/.test(r.updated) ? ` datetime="${escapeHtml(r.updated)}"` : ''}>${escapeHtml(r.updated)}</time></p>` : '';
  const lead = r.intro[0] ? `<p class="rm-intro">${inline(r.intro[0])}</p>` : '';
  const key = r.intro.slice(1).map((p) => `<p>${inline(p)}</p>`).join('');
  return `<div class="rm">
      <div class="rm-top">
        <div><h1>${escapeHtml(r.title)}</h1>${lead}</div>
        ${updated}
      </div>
      <nav class="rm-jumps" aria-label="Roadmap columns">${jump}</nav>
      ${key ? `<details class="rm-key"><summary>What the columns mean</summary>${key}</details>` : ''}
      <div class="rm-board">
      ${r.sections.map(sectionHtml).join('\n      ')}
      </div>
    </div>`;
}
