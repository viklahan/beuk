import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { escapeHtml, renderInline } from '../warmth/markdown.js';
import { repoRoot } from '../warmth/pages.js';

/**
 * H1 — the Help content model. Guides are Markdown files under
 * content/help/guides/<slug>.md, the error dictionary is
 * content/help/errors.json, and the home page's "start from where you
 * are" cards and search suggestions are content/help/home.json. Nothing
 * here is generated: the files ARE the content, and the pages, the
 * search index (src/help/search.ts) and the EPUBCheck code mapping
 * (src/help/codes.ts) all read them through this module.
 *
 * Guide file format (a deliberately small Markdown subset — the same
 * inline rules as src/warmth/markdown.ts; raw HTML is always escaped):
 *
 *   ---
 *   slug: check-your-book            front matter: one `key: value` per
 *   title: …                         line; arrays as [a, b]; booleans
 *   blurb: …                         true/false; numbers as numbers
 *   group: write | ship | keep
 *   audience: [new, shipping, hand-edit, reader]
 *   updated: YYYY-MM-DD
 *   readMinutes: 3                   = ceil(words / 200), checked by tests
 *   related: [slug, …]
 *   new: true                        optional: shows the "New" mark
 *   ---
 *   <lede paragraph(s)>
 *   ## Steps                         an ordered list; indented lines under
 *   1. Step text                     an item are hints:
 *      tech: the technical detail      shown in "With the technical bits"
 *      pane: <pane id>                 which right-hand pane it refers to
 *      highlight: text; other text     pane lines containing any of these
 *   ## Explanation                   ### sub-headings, paragraphs, lists,
 *   ### Heading                      and "> says: …" message boxes; a list
 *   - item {code: BEUK-P101; pane: package; highlight: mimetype}
 *   ## Troubleshooting               ### sub-headings + paragraphs
 *   ## Panes                         ### <id> | <tab label> | <caption>
 *   ### package | Inside the file | …   source: <where the excerpt is from>
 *   source: …                           then one fenced block: the excerpt
 *   ```                                 (shown exactly as written)
 *   ```
 *
 * The panes hold REAL excerpts (captured output, real package files),
 * each with its provenance in `source:` — they are shown as examples
 * taken from that source, never as live product output.
 */

export type GuideGroup = 'write' | 'ship' | 'keep';
export const GUIDE_GROUPS: { id: GuideGroup; name: string }[] = [
  { id: 'write', name: 'Write' },
  { id: 'ship', name: 'Ship' },
  { id: 'keep', name: 'Keep' },
];
export const AUDIENCES = ['new', 'shipping', 'hand-edit', 'reader'] as const;

export interface PaneRef {
  pane: string | null;
  highlight: string[];
}
export interface GuideStep extends PaneRef {
  html: string;
  text: string;
  tech: string | null;
  techHtml: string | null;
}
export interface ListItem extends PaneRef {
  html: string;
  text: string;
  codes: string[];
}
export type GuideBlock =
  | { kind: 'p'; html: string; text: string }
  | { kind: 'says'; text: string }
  | { kind: 'ul' | 'ol'; items: ListItem[] };
export interface GuideSection {
  heading: string;
  blocks: GuideBlock[];
}
export interface GuidePane {
  id: string;
  label: string;
  caption: string;
  source: string;
  lines: string[];
}
export interface Guide {
  slug: string;
  title: string;
  blurb: string;
  group: GuideGroup;
  audience: string[];
  updated: string;
  readMinutes: number;
  related: string[];
  isNew: boolean;
  lede: { html: string; text: string }[];
  steps: GuideStep[];
  explanation: GuideSection[];
  troubleshooting: GuideSection[];
  panes: GuidePane[];
  /** Every visible word of the guide body (title, lede, steps, sections). */
  plainText: string;
  wordCount: number;
  file: string;
}

export interface SaysLine {
  from: 'epubcheck' | 'validator' | 'server' | 'studio' | 'store';
  code?: string;
  text: string;
}
export interface HelpError {
  code: string;
  category: string;
  title: string;
  severity: 'error' | 'warning' | 'info';
  says: SaysLine[];
  cause: string;
  steps: string[];
  guide: string;
  maps: {
    epubcheck: string[];
    validator: string[];
    http: { status: number; route: string }[];
    store: string[];
  };
  sources: string[];
}

export interface HomePathCard {
  kicker: string;
  title: string;
  links: { label: string; href: string }[];
}
export interface HelpHome {
  suggestions: { label: string; mono?: boolean }[];
  paths: HomePathCard[];
}

export interface HelpContent {
  guides: Guide[];
  guideBySlug: Map<string, Guide>;
  errors: HelpError[];
  errorByCode: Map<string, HelpError>;
  home: HelpHome;
  /** Fingerprint of the files this was loaded from (dev reload). */
  stamp: string;
}

export const ERROR_CATEGORIES: { id: string; name: string }[] = [
  { id: 'package', name: 'Package' },
  { id: 'content', name: 'Content' },
  { id: 'store', name: 'Store' },
  { id: 'jobs', name: 'Jobs' },
  { id: 'saving', name: 'Saving' },
  { id: 'sharing', name: 'Sharing' },
];

export function contentDir(): string {
  return path.join(repoRoot(), 'content', 'help');
}

/**
 * `[[if-support]]…[[/if-support]]` in guide copy marks words that promise
 * a reply (V's decision 2): they render only when SUPPORT_EMAIL is set.
 * The HTML keeps them inside <!--BEUK_IF_SUPPORT--> markers, which the
 * page renderer resolves per request (supportBlocks); the indexed/plain
 * text drops them, so search never surfaces a promise either way.
 */
const IF_SUPPORT_BLOCK = /\[\[if-support\]\][\s\S]*?\[\[\/if-support\]\]/g;

/** Visible text of an inline-Markdown string (what a reader sees). */
export function inlineText(md: string): string {
  return md
    .replace(IF_SUPPORT_BLOCK, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
}

export function inlineHtml(md: string): string {
  return renderInline(escapeHtml(md))
    .split('[[if-support]]')
    .join('<!--BEUK_IF_SUPPORT-->')
    .split('[[/if-support]]')
    .join('<!--/BEUK_IF_SUPPORT-->');
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  return v;
}

const ANNOTATION = /\s*\{([a-z]+:[^{}]*)\}\s*$/;

function parseAnnotation(text: string): { rest: string; codes: string[]; pane: string | null; highlight: string[] } {
  const m = ANNOTATION.exec(text);
  const out = { rest: text, codes: [] as string[], pane: null as string | null, highlight: [] as string[] };
  if (!m) return out;
  out.rest = text.slice(0, m.index);
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (key === 'code') out.codes = val.split(/[,\s]+/).filter(Boolean);
    else if (key === 'pane') out.pane = val;
    else if (key === 'highlight') out.highlight = val.split('|').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

/** Parse one guide file. Throws with the file name on malformed input. */
export function parseGuide(source: string, file: string): Guide {
  const text = source.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, unknown> = {};
  for (const line of fm[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`${file}: bad front-matter line "${line}"`);
    meta[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  const body = text.slice(fm[0].length);
  const lines = body.split('\n');

  const lede: Guide['lede'] = [];
  const steps: GuideStep[] = [];
  const explanation: GuideSection[] = [];
  const troubleshooting: GuideSection[] = [];
  const panes: GuidePane[] = [];
  let part: 'lede' | 'steps' | 'explanation' | 'troubleshooting' | 'panes' = 'lede';
  let section: GuideSection | null = null;
  let pane: GuidePane | null = null;
  let inFence = false;
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: ListItem[] } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const md = para.join(' ');
    para = [];
    if (part === 'lede') {
      lede.push({ html: inlineHtml(md), text: inlineText(md) });
      return;
    }
    if (!section) throw new Error(`${file}: text outside a ### section in ${part}`);
    section.blocks.push({ kind: 'p', html: inlineHtml(md), text: inlineText(md) });
  };
  const flushList = () => {
    if (!list) return;
    if (!section) throw new Error(`${file}: list outside a ### section in ${part}`);
    section.blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    if (part === 'panes') {
      if (inFence) {
        if (/^```\s*$/.test(raw)) inFence = false;
        else pane!.lines.push(raw);
        continue;
      }
      const ph = /^###\s+([a-z0-9-]+)\s*\|\s*([^|]+?)\s*\|\s*(.+)$/.exec(raw);
      if (ph) {
        pane = { id: ph[1], label: ph[2], caption: ph[3].trim(), source: '', lines: [] };
        panes.push(pane);
        continue;
      }
      if (/^##\s/.test(raw)) throw new Error(`${file}: "## Panes" must be the last section`);
      const src = /^source:\s*(.+)$/.exec(raw);
      if (src && pane) {
        pane.source = src[1].trim();
        continue;
      }
      if (/^```/.test(raw) && pane) {
        inFence = true;
        continue;
      }
      if (raw.trim()) throw new Error(`${file}: unexpected line in Panes: ${raw}`);
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(raw);
    if (h2) {
      flushPara();
      flushList();
      section = null;
      const name = h2[1].trim();
      if (name === 'Steps') part = 'steps';
      else if (name === 'Explanation') part = 'explanation';
      else if (name === 'Troubleshooting') part = 'troubleshooting';
      else if (name === 'Panes') part = 'panes';
      else throw new Error(`${file}: unknown section "## ${name}"`);
      continue;
    }

    if (part === 'steps') {
      const item = /^\d+\.\s+(.*)$/.exec(raw);
      if (item) {
        steps.push({ html: inlineHtml(item[1]), text: inlineText(item[1]), tech: null, techHtml: null, pane: null, highlight: [] });
        continue;
      }
      const hint = /^\s{2,}(tech|pane|highlight):\s*(.*)$/.exec(raw);
      if (hint && steps.length) {
        const step = steps[steps.length - 1];
        if (hint[1] === 'tech') {
          step.tech = inlineText(hint[2]);
          step.techHtml = inlineHtml(hint[2]);
        } else if (hint[1] === 'pane') step.pane = hint[2].trim();
        else step.highlight = hint[2].split('|').map((s) => s.trim()).filter(Boolean);
        continue;
      }
      if (raw.trim()) throw new Error(`${file}: unexpected line in Steps: ${raw}`);
      continue;
    }

    if (part === 'explanation' || part === 'troubleshooting') {
      const h3 = /^###\s+(.+)$/.exec(raw);
      if (h3) {
        flushPara();
        flushList();
        section = { heading: h3[1].trim(), blocks: [] };
        (part === 'explanation' ? explanation : troubleshooting).push(section);
        continue;
      }
      const says = /^>\s*says:\s*(.*)$/.exec(raw);
      if (says) {
        flushPara();
        flushList();
        if (!section) throw new Error(`${file}: says outside a section`);
        section.blocks.push({ kind: 'says', text: says[1] });
        continue;
      }
      const ul = /^-\s+(.*)$/.exec(raw);
      const ol = /^\d+\.\s+(.*)$/.exec(raw);
      if (ul || ol) {
        flushPara();
        const kind = ul ? 'ul' : 'ol';
        if (list && list.kind !== kind) flushList();
        if (!list) list = { kind, items: [] };
        const a = parseAnnotation((ul ?? ol)![1]);
        list.items.push({ html: inlineHtml(a.rest), text: inlineText(a.rest), codes: a.codes, pane: a.pane, highlight: a.highlight });
        continue;
      }
      if (!raw.trim()) {
        flushPara();
        flushList();
        continue;
      }
      flushList();
      para.push(raw.trim());
      continue;
    }

    // lede
    if (!raw.trim()) flushPara();
    else para.push(raw.trim());
  }
  flushPara();
  flushList();
  if (inFence) throw new Error(`${file}: unclosed fence in Panes`);

  const str = (k: string): string => {
    const v = meta[k];
    if (typeof v !== 'string' || !v) throw new Error(`${file}: front matter "${k}" is required`);
    return v;
  };
  const arr = (k: string): string[] => {
    const v = meta[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new Error(`${file}: front matter "${k}" must be a list`);
    return v as string[];
  };
  const group = str('group') as GuideGroup;
  if (!GUIDE_GROUPS.some((g) => g.id === group)) throw new Error(`${file}: unknown group "${group}"`);

  const title = str('title');
  const visible: string[] = [title, ...lede.map((l) => l.text)];
  for (const s of steps) visible.push(s.text);
  for (const sec of [...explanation, ...troubleshooting]) {
    visible.push(sec.heading);
    for (const b of sec.blocks) {
      if (b.kind === 'p') visible.push(b.text);
      else if (b.kind === 'says') visible.push(b.text);
      else for (const it of b.items) visible.push(it.text);
    }
  }
  const plainText = visible.join('\n');
  return {
    slug: str('slug'),
    title,
    blurb: str('blurb'),
    group,
    audience: arr('audience'),
    updated: str('updated'),
    readMinutes: typeof meta.readMinutes === 'number' ? meta.readMinutes : 0,
    related: arr('related'),
    isNew: meta.new === true,
    lede,
    steps,
    explanation,
    troubleshooting,
    panes,
    plainText,
    wordCount: countWords(plainText),
    file,
  };
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
}

/** Reading time the front matter must state: 200 words a minute, at least 1. */
export function expectedReadMinutes(guide: Pick<Guide, 'wordCount'>): number {
  return Math.max(1, Math.ceil(guide.wordCount / 200));
}

function listFiles(dir: string): string[] {
  const guidesDir = path.join(dir, 'guides');
  return [
    path.join(dir, 'errors.json'),
    path.join(dir, 'home.json'),
    ...readdirSync(guidesDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => path.join(guidesDir, f)),
  ];
}

function stampOf(files: string[]): string {
  return files.map((f) => `${path.basename(f)}:${statSync(f).mtimeMs}:${statSync(f).size}`).join('|');
}

export function loadHelpContent(dir: string = contentDir()): HelpContent {
  const files = listFiles(dir);
  const guides = files
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseGuide(readFileSync(f, 'utf8'), path.relative(repoRoot(), f).split(path.sep).join('/')));
  const order = new Map(GUIDE_GROUPS.map((g, i) => [g.id, i]));
  const guideOrder = JSON.parse(readFileSync(path.join(dir, 'home.json'), 'utf8')) as HelpHome & { guideOrder?: string[] };
  const pos = new Map((guideOrder.guideOrder ?? []).map((s, i) => [s, i]));
  guides.sort(
    (a, b) =>
      (order.get(a.group)! - order.get(b.group)!) ||
      ((pos.get(a.slug) ?? 999) - (pos.get(b.slug) ?? 999)) ||
      a.title.localeCompare(b.title),
  );
  const errorsDoc = JSON.parse(readFileSync(path.join(dir, 'errors.json'), 'utf8')) as { errors: HelpError[] };
  const errors = errorsDoc.errors;
  return {
    guides,
    guideBySlug: new Map(guides.map((g) => [g.slug, g])),
    errors,
    errorByCode: new Map(errors.map((e) => [e.code, e])),
    home: { suggestions: guideOrder.suggestions, paths: guideOrder.paths },
    stamp: stampOf(files),
  };
}

/**
 * Problems with the content as a list of sentences (empty = sound).
 * Run by tests and logged at boot; a page never renders half-checked
 * content silently.
 */
export function checkHelpContent(c: HelpContent): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();
  for (const g of c.guides) {
    if (slugs.has(g.slug)) problems.push(`duplicate guide slug ${g.slug}`);
    slugs.add(g.slug);
    if (!g.file.endsWith(`/${g.slug}.md`)) problems.push(`${g.file}: slug "${g.slug}" does not match the file name`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.updated)) problems.push(`${g.slug}: updated must be YYYY-MM-DD`);
    for (const a of g.audience) if (!(AUDIENCES as readonly string[]).includes(a)) problems.push(`${g.slug}: unknown audience ${a}`);
    if (g.readMinutes !== expectedReadMinutes(g)) problems.push(`${g.slug}: readMinutes ${g.readMinutes} but ${g.wordCount} words → ${expectedReadMinutes(g)}`);
    const paneIds = new Set(g.panes.map((p) => p.id));
    for (const p of g.panes) if (!p.source) problems.push(`${g.slug}: pane ${p.id} has no source:`);
    const refs: PaneRef[] = [...g.steps];
    for (const sec of g.explanation) for (const b of sec.blocks) if (b.kind === 'ul' || b.kind === 'ol') refs.push(...b.items);
    for (const r of refs) {
      if (r.pane && !paneIds.has(r.pane)) problems.push(`${g.slug}: refers to unknown pane ${r.pane}`);
      if (r.pane) {
        const p = g.panes.find((x) => x.id === r.pane);
        for (const h of r.highlight) {
          if (p && !p.lines.some((l) => l.includes(h))) problems.push(`${g.slug}: highlight "${h}" matches no line of pane ${r.pane}`);
        }
      }
    }
    for (const sec of g.explanation) {
      for (const b of sec.blocks) {
        if (b.kind !== 'ul' && b.kind !== 'ol') continue;
        for (const it of b.items) for (const code of it.codes) if (!c.errorByCode.has(code)) problems.push(`${g.slug}: unknown code ${code}`);
      }
    }
  }
  for (const g of c.guides) for (const r of g.related) if (!slugs.has(r)) problems.push(`${g.slug}: related guide ${r} does not exist`);
  const codes = new Set<string>();
  for (const e of c.errors) {
    if (!/^BEUK-[A-Z]\d{3}$/.test(e.code)) problems.push(`bad error code ${e.code}`);
    if (codes.has(e.code)) problems.push(`duplicate error code ${e.code}`);
    codes.add(e.code);
    if (!slugs.has(e.guide)) problems.push(`${e.code}: guide ${e.guide} does not exist`);
    if (!ERROR_CATEGORIES.some((k) => k.id === e.category)) problems.push(`${e.code}: unknown category ${e.category}`);
    if (!e.steps.length) problems.push(`${e.code}: no steps`);
    if (!e.sources.length) problems.push(`${e.code}: no sources`);
    for (const s of e.says) if (s.from === 'store' && !e.sources.some((u) => /^https:\/\//.test(u))) problems.push(`${e.code}: store wording without a store URL in sources`);
  }
  const seenEpub = new Map<string, string>();
  const seenValidator = new Map<string, string>();
  for (const e of c.errors) {
    for (const k of e.maps.epubcheck) {
      if (seenEpub.has(k)) problems.push(`EPUBCheck ${k} is mapped by both ${seenEpub.get(k)} and ${e.code}`);
      seenEpub.set(k, e.code);
    }
    for (const k of e.maps.validator) {
      if (seenValidator.has(k)) problems.push(`validator ${k} is mapped by both ${seenValidator.get(k)} and ${e.code}`);
      seenValidator.set(k, e.code);
    }
  }
  for (const card of c.home.paths) {
    for (const l of card.links) {
      const m = /^\/help\/(?:errors\/(BEUK-[A-Z]\d{3})|errors|([a-z0-9-]+))?(?:#[a-z0-9-]+)?$/.exec(l.href);
      if (!m) problems.push(`home link ${l.href} is not a help page`);
      else if (m[1] && !codes.has(m[1])) problems.push(`home link ${l.href}: no such code`);
      else if (m[2] && !slugs.has(m[2])) problems.push(`home link ${l.href}: no such guide`);
    }
  }
  return problems;
}

let cached: HelpContent | null = null;
let checkedAt = 0;

/**
 * The content, cached in memory. In production it is read once; in
 * development (NODE_ENV !== 'production') the files' mtimes are
 * re-checked at most once a second and a change reloads everything,
 * so editing a guide shows up on the next request.
 */
export function getHelpContent(): HelpContent {
  const prod = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  if (cached && (prod || Date.now() - checkedAt < 1000)) return cached;
  checkedAt = Date.now();
  if (cached) {
    try {
      if (stampOf(listFiles(contentDir())) === cached.stamp) return cached;
    } catch {
      return cached;
    }
  }
  cached = loadHelpContent();
  return cached;
}
