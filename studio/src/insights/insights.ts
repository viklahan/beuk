import type * as Y from 'yjs';
import { textOffsetToPos, toText } from '@book/editor/index.js';
import { bookState, type CastData, type CastRow, type Closure, type State } from '../closure/index';
import { activeEditor } from '../editor/active';
import { toBook } from '../editor/bridge';
import icons from '../generated/icons.json';
import { getMeta, setMeta } from '../book/hooks';

/* Story Insights and Names on stage (inventory C4, C5), the glue around
   1.0's own code. ONE SOURCE (constraint 9): every number and every piece
   of the room's markup is 1.0's, run through the browser closure —
   computeInsights (its per-revision cache included), insBuildHtml and its
   renderers (glance, words, rhythm, cadence, reading ease, dialogue,
   variety, words to look at, echoes: hand-built SVG, tables for screen
   readers, data-sec / data-lead / data-tip / aria-label on every mark),
   insVarietyInner, insFactValues, castCompute, castVisible, castGridHtml,
   castRateStr. 1.0's builders escape every book-derived string (esc), and
   their markup goes in by innerHTML exactly as 1.0's renderInsights does.

   Ported by hand, because 1.0's versions read uiLangState (which the
   closure may not lift) or reach into 1.0's DOM:
   - castData: its cache key is 1.0's (castHash over the language, title,
     each body section's id/type/number/title and text, plus the interface
     language); the computation is castCompute;
   - castInsightsSection: the section's frame, caption, the hidden list;
   - castHide / castUnhide: the hidden names are written to the book's
     `meta.castHidden` as 1.0's castSetHidden writes them (normalised by
     castNormalizeHidden; an emptied list removes the key), as a NEW meta
     value through Yjs;
   - castJump: the name selected in the chapter, through the text offset
     ↔ ProseMirror position map (positions.ts) instead of a textarea. */

type Rec = Record<string, unknown>;
type T = (key: string, params?: Record<string, unknown>) => string;

/** 1.0's state for the open book, set as the closure's global (every lifted function reads it). */
export function insightsState(c: Closure, ydoc: Y.Doc): State {
  const { state } = bookState(c, ydoc);
  c.setState(state);
  return state;
}

/** 1.0's insChartWidth. */
export function chartWidth(body: HTMLElement | null): number {
  const w = body ? Math.round(body.clientWidth) : 0;
  return w > 200 ? w : 720;
}

/* ---- Names on stage ---- */

const castCache: { key: string | null; val: CastData | null; ms: number } = { key: null, val: null, ms: 0 };
export const castCacheInfo = () => castCache;

/** 1.0's castData (same cache key; the interface language comes from the studio). */
export function castData(c: Closure, state: State, uiLang: string): CastData {
  const a = c.api;
  const lang = a.bookLang();
  let h = a.castHash(lang + '\u0001' + String(state.meta.title || ''), 2166136261);
  a.insBodySections(state.sections).forEach((s) => {
    h = a.castHash('\u0002' + s.id + '\u0003' + (s.type || '') + '\u0003' + (s.number || '') + '\u0003' + (s.title || '') + '\u0003', h);
    h = a.castHash(String(s.content || ''), h);
  });
  const key = h + ':' + uiLang;
  if (castCache.key === key && castCache.val) return castCache.val;
  const t0 = performance.now();
  const val = a.castCompute(state.sections, lang, state.meta.title);
  castCache.ms = performance.now() - t0;
  castCache.key = key;
  castCache.val = val;
  return val;
}

/** 1.0's castHiddenList. */
export const castHiddenList = (c: Closure, state: State): string[] => c.api.castNormalizeHidden(state.meta && state.meta.castHidden);

export type CastView = { html: string; rows: CastRow[]; data: CastData };

/** 1.0's castInsightsSection: the section's HTML (1.0's markup; every book string through esc). */
export function castSection(c: Closure, state: State, t: T, uiLang: string, openHidden: boolean): CastView {
  const a = c.api, esc = a.esc, fmt = a.fmtNum;
  const d = castData(c, state, uiLang);
  let inner = '';
  let rows: CastRow[] = [];
  const hidden = castHiddenList(c, state);
  if (d.caseless) inner = '<p class="ins-none">' + esc(t('insights.castCaseless')) + '</p>';
  else {
    const vis = a.castVisible(d, hidden);
    rows = vis.slice(0, a.CAST_MAX_ROWS);
    if (!rows.length) inner = '<p class="ins-none">' + esc(t('insights.castNone')) + '</p>';
    else {
      inner = a.castGridHtml(rows, d);
      let cap = esc(t('insights.castNote', { n: fmt(d.minCount) }));
      if (vis.length > rows.length) cap += ' ' + esc(t('insights.castTop', { n: fmt(rows.length), m: fmt(vis.length) }));
      if (String(a.bookLang()).split('-')[0] === 'de') cap += ' ' + esc(t('insights.castDeNote'));
      inner += '<p class="ins-caption">' + cap + '</p>';
    }
    if (hidden.length) {
      inner += '<details class="cast-hidden"' + (openHidden ? ' open' : '') + '><summary>' + esc(t('insights.castHidden', { n: fmt(hidden.length) })) + '</summary><ul class="cast-hidden-list">' +
        hidden.map((x) => '<li><span class="cast-hname">' + esc(x) + '</span><button type="button" class="tb-btn cast-show" data-cast-show="' + esc(x) + '">' + esc(t('insights.castShow')) + '</button></li>').join('') + '</ul></details>';
    }
  }
  const html = '<section class="ins-sec cast-sec" aria-labelledby="insCastH"><h3 class="ins-h" id="insCastH">' + esc(t('insights.castH')) + '</h3><p class="ins-sub">' + esc(t('insights.castSub')) + '</p>' + inner + '</section>';
  return { html, rows, data: d };
}

/** 1.0's castSetHidden on the book: meta.castHidden = the normalised list, or no key when it is empty. One new meta value. */
export function writeCastHidden(c: Closure, ydoc: Y.Doc, list: unknown[]): void {
  const n = c.api.castNormalizeHidden(list);
  const meta = { ...((getMeta(ydoc, 'meta') ?? {}) as Rec) };
  if (n.length) meta.castHidden = n;
  else delete meta.castHidden;
  setMeta(ydoc, 'meta', meta as never);
}

/** 1.0's castHide: the name joins the hidden list (case-insensitively once). */
export function castHide(c: Closure, ydoc: Y.Doc, state: State, name: string): void {
  const list = castHiddenList(c, state);
  if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) list.push(name);
  writeCastHidden(c, ydoc, list);
}

/** 1.0's castUnhide. */
export function castUnhide(c: Closure, ydoc: Y.Doc, state: State, name: string): void {
  writeCastHidden(c, ydoc, castHiddenList(c, state).filter((x) => x.toLowerCase() !== name.toLowerCase()));
}

/** 1.0's castJump, its second half: the first place the name stands in the open chapter (1.0's own pattern, on the
 *  chapter's text) is selected and scrolled into view. False when the open editor is not that section or the name is
 *  not found. */
export function selectNameIn(section: number, name: string): boolean {
  const a = activeEditor();
  if (!a || a.section !== section) return false;
  const parts = String(name).split(/\.?\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(^|[^\\p{L}\\p{M}])(' + parts.join('\\.?\\s+') + ')(?![\\p{L}\\p{M}])', 'u');
  const doc = toBook(a.editor.state.doc);
  const m = re.exec(toText(doc));
  if (!m) return false;
  const start = m.index + m[1]!.length, end = start + m[2]!.length;
  const from = textOffsetToPos(doc, start), to = textOffsetToPos(doc, end);
  a.editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
  return true;
}

/* ---- 1.0's <i data-lucide> placeholders, drawn as lucide's createIcons draws them ---- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const pascal = (k: string) => k.replace(/(^|-)([a-z0-9])/g, (_, __, ch: string) => ch.toUpperCase());

/** Every `<i data-lucide="name">` under root becomes the icon's SVG (built node by node from 1.0's lucide data). */
export function drawIcons(root: ParentNode): void {
  root.querySelectorAll('i[data-lucide]').forEach((i) => {
    const name = i.getAttribute('data-lucide') || '';
    const nodes = (icons as unknown as Record<string, [string, Record<string, string>][]>)[pascal(name)];
    if (!nodes) return;
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs: Record<string, string> = { xmlns: SVG_NS, width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const at of Array.from(i.attributes)) if (at.name !== 'data-lucide' && at.name !== 'class') svg.setAttribute(at.name, at.value);
    svg.setAttribute('class', ['lucide', 'lucide-' + name, i.getAttribute('class') || ''].join(' ').trim());
    if (!svg.hasAttribute('aria-hidden')) svg.setAttribute('aria-hidden', 'true');
    for (const [tag, a] of nodes) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, String(v));
      svg.appendChild(el);
    }
    i.replaceWith(svg);
  });
}
