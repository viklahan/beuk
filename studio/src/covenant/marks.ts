import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { blockText, bookSchema, posToTextOffset, toText } from '@book/editor/index.js';
import { closureT, covEnv, type BibleMatcher, type Closure } from '../closure/index';
import { toBook } from '../editor/bridge';
import { activeEditor } from '../editor/active';
import { drawIcons } from '../insights/insights';
import { covBegin, covEnter, covRun, guardHosts } from './covenant';

/* Step 5 wave 3b, task 2 (inventory C6): the Covenant's marks on the page.

   1.0 underlines the names the Covenant knows on a mirror laid over its textarea (bibleDesk*). 2.0's page is
   ProseMirror, so the marks are DECORATIONS from one plugin (constraint 26): never stored marks, so the book's text,
   and so its export, never changes because of the Covenant. Which spans are marked is 1.0's own: its matcher
   (bibleMatcherNow: every entry in scope, the book's language) and its scan (bibleScan) on the text 1.0 holds for the
   section (`content`, convert.ts toText), mapped to positions through the wave 2 text↔PM table (positions.ts).

   Incremental (constraint 27): a transaction's decorations are mapped through it, and only the RUNS it touched are
   scanned again. A run is a stretch of top-level blocks with no blank line between them: 1.0's names match across
   one line break (BIBLE_GAP) but never across a blank line, and every rule of bibleScan (whole word, the exclusion
   phrases, image tokens and link addresses, the ambiguous phrases) reads only inside such a stretch, so scanning run
   by run gives 1.0's hits exactly (test: covenant-marks.test.ts, every fixture). Each block's text and offset table
   is kept per node, so a whole-document replace (a remote change, an undo) re-reads only the blocks that changed.

   Around the marks, 1.0's behaviour: the hover card (380 ms in, 260 ms out), a click or Alt+Enter with the caret on a
   name opens the card, Escape closes it, any other key closes it; a selection near names offers "Mark a change for…"
   (the menu, while the underlines are on), Alt+M marks a change at the selection (also with the underlines off); a
   margin dot stands at each change pinned in this chapter, and opens its entry. The card, the menu and the popover
   are 1.0's own (bibleCardEl / bibleCardHtml, bibleMarkMenuEl, bibleMarkOpen / bibleMarkSave). */

type Hit = { s: number; e: number; id: string };
type Info = { text: string; off: Int32Array; size: number };
type MarkState = { set: DecorationSet; dots: DecorationSet; ver: number };

export const covKey = new PluginKey<MarkState>('beukCovenant');

/* ---- the matcher the page draws with (1.0: bibleDeskLive / bibleMatcherNow) ---- */
const cur: { m: BibleMatcher | null; any: BibleMatcher | null; on: boolean; ver: number; changes: boolean } = { m: null, any: null, on: true, ver: 0, changes: false };
const views = new Set<EditorView>();
let scheduled = 0;

function readMatcher(): boolean {
  const c = covEnter();
  if (!c) {
    const changed = cur.m !== null || cur.any !== null;
    cur.m = cur.any = null;
    return changed;
  }
  const a = c.api;
  const entries = a.bibleAllEntries();
  const any = entries.length ? (a.bibleMatcherNow() as BibleMatcher | null) : null;
  const on = a.bibleMarksOn();
  cur.changes = entries.some((e) => !!(e.changes && e.changes.length));
  const m = on ? any : null;
  const changed = m !== cur.m || any !== cur.any || on !== cur.on;
  cur.m = m;
  cur.any = any;
  cur.on = on;
  return changed;
}

export const covenantDesk = {
  /** The Covenant changed (its entries, the marks switch, the series): the open editor redraws its marks, now. */
  refresh(force = false): void {
    if (scheduled) {
      cancelAnimationFrame(scheduled);
      scheduled = 0;
    }
    const changed = readMatcher();
    if (changed) cur.ver++;
    if (!changed && !force) {
      views.forEach((v) => scheduleDots(v));
      return;
    }
    if (!changed) cur.ver++;
    views.forEach((v) => {
      if (v.isDestroyed) return;
      v.dispatch(v.state.tr.setMeta(covKey, { refresh: true }).setMeta('addToHistory', false));
      scheduleDots(v, 0);
    });
  },
  /** The same, on the next frame (1.0's bibleDeskSchedule). */
  schedule(): void {
    if (scheduled || typeof requestAnimationFrame === 'undefined') return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      covenantDesk.refresh();
    });
  },
  /** The marks the open editor draws now, as text offsets of its section (1.0's bibleDesk.hits): for the e2e. */
  hits(view?: EditorView): Hit[] {
    const v = view ?? activeEditor()?.editor.view;
    return v ? (rangesOf(v.state) as unknown as Hit[]) : [];
  },
};
/** The marks a state holds, as ProseMirror ranges (a name split over a line break is one range: its pieces share a
 *  key), in document order. */
export function rangesOf(state: EditorState): { from: number; to: number; id: string }[] {
  const st = covKey.getState(state);
  if (!st) return [];
  const out: { from: number; to: number; id: string; k: number }[] = [];
  st.set.find().forEach((x) => {
    const spec = x.spec as { id: string; k: number };
    const last = out[out.length - 1];
    if (last && last.k === spec.k) last.to = x.to;
    else out.push({ from: x.from, to: x.to, id: spec.id, k: spec.k });
  });
  return out.map(({ from, to, id }) => ({ from, to, id }));
}
/** 1.0's hits (text offsets of the document's text) as the ranges a mark covers: from the position where character s
 *  starts (the greatest with offset <= s) to the one where character e - 1 ends (the smallest with offset >= e). */
export function rangesFor(doc: PMNode, hits: Hit[]): { from: number; to: number; id: string }[] {
  const d = toBook(doc);
  const size = d.content.size;
  const off = new Int32Array(size + 1);
  for (let p = 0; p <= size; p++) off[p] = posToTextOffset(d, p);
  const inf: Info = { text: '', off, size };
  return hits.map((h) => ({ from: startPos(inf, h.s), to: endPos(inf, h.e), id: h.id }));
}

covEnv.deskRender = (force?: boolean) => covenantDesk.refresh(!!force);
covEnv.deskSchedule = () => covenantDesk.schedule();

/* ---- one block: its text as 1.0 holds it, and its offset table ---- */
const infos = new WeakMap<PMNode, Info>();
function infoOf(block: PMNode): Info {
  let inf = infos.get(block);
  if (inf) return inf;
  const bb = toBook(block);
  // the block alone, its pre and post set aside (they are the run's separators): its text is convert.ts blockText
  const solo = bookSchema.topNodeType.create(null, [bb.type.create({ ...bb.attrs, pre: '', post: '' }, bb.content, bb.marks)]);
  const size = solo.content.size;
  const off = new Int32Array(size + 1);
  for (let p = 0; p <= size; p++) off[p] = posToTextOffset(solo, p);
  inf = { text: blockText(bb), off, size };
  infos.set(block, inf);
  return inf;
}
/** The text in front of top-level block i (convert.ts preOf), and whether a blank line is in it (a run ends there). */
const preOf = (b: PMNode, i: number): string => {
  const pre = b.attrs.pre as string | null | undefined;
  return pre === null || pre === undefined ? (i === 0 ? '' : '\n\n') : String(pre);
};
const BLANK = /\n[ \t ]*\n/;
const breaksRun = (doc: PMNode, i: number): boolean => i === 0 || BLANK.test(preOf(doc.child(i), i));

/** The greatest position with offset <= s (the start of character s), and the smallest with offset >= e. */
function startPos(inf: Info, s: number): number {
  let lo = 0, hi = inf.size;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (inf.off[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function endPos(inf: Info, e: number): number {
  let lo = 0, hi = inf.size;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (inf.off[mid]! >= e) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

let keySeq = 0;
/** 1.0's hits in the run of blocks [first, last], as decorations. */
function scanRun(doc: PMNode, first: number, last: number, m: BibleMatcher, a: Closure['api'], out: Decoration[]): void {
  const starts: number[] = [], pos: number[] = [], inf: Info[] = [];
  let text = '';
  let p = 0;
  for (let i = 0; i < first; i++) p += doc.child(i).nodeSize;
  for (let i = first; i <= last; i++) {
    const b = doc.child(i);
    if (i > first) text += preOf(b, i);
    const f = infoOf(b);
    starts.push(text.length);
    pos.push(p);
    inf.push(f);
    text += f.text;
    p += b.nodeSize;
  }
  const r = a.bibleScan(text, m);
  for (const h of r.hits) {
    const k = ++keySeq;
    for (let j = 0; j < inf.length; j++) {
      const bs = starts[j]!, be = bs + inf[j]!.text.length;
      if (h.e <= bs || h.s >= be) continue;
      const from = pos[j]! + startPos(inf[j]!, Math.max(h.s, bs) - bs);
      const to = pos[j]! + endPos(inf[j]!, Math.min(h.e, be) - bs);
      if (to > from) out.push(Decoration.inline(from, to, { class: 'bm', 'data-bib-id': h.id, 'data-bm': String(k) }, { id: h.id, k, bm: true }));
    }
  }
}

/** Every run's decorations (the per-block cache keeps unchanged blocks cheap). */
function fullSet(doc: PMNode): DecorationSet {
  const m = cur.m;
  const c = closure();
  if (!m || !c || !doc.childCount) return DecorationSet.empty;
  const out: Decoration[] = [];
  let first = 0;
  for (let i = 1; i <= doc.childCount; i++) {
    if (i === doc.childCount || breaksRun(doc, i)) {
      scanRun(doc, first, i - 1, m, c.api, out);
      first = i;
    }
  }
  return DecorationSet.create(doc, out);
}
let closureRef: Closure | null = null;
const closure = (): Closure | null => closureRef;

/** The range of the new document a transaction changed, or null. */
function changedRange(tr: Transaction): { from: number; to: number; attr: boolean } | null {
  let from = Infinity, to = -Infinity, attr = false;
  const maps = tr.mapping.maps;
  maps.forEach((map, i) => {
    map.forEach((_os, _oe, ns, ne) => {
      const rest = tr.mapping.slice(i + 1);
      from = Math.min(from, rest.map(ns, -1));
      to = Math.max(to, rest.map(ne, 1));
    });
  });
  // a step that changes a node's attributes in place (its `pre`: the spacing in front of a block) maps no position
  tr.steps.forEach((step, i) => {
    const pos = (step as { pos?: unknown }).pos;
    if (typeof pos !== 'number') return;
    attr = true;
    const p = tr.mapping.slice(i + 1).map(pos, 1);
    from = Math.min(from, p);
    to = Math.max(to, p + 1);
  });
  return from === Infinity ? null : { from: Math.max(0, from), to: Math.min(tr.doc.content.size, to), attr };
}

function incremental(prev: DecorationSet, tr: Transaction): DecorationSet {
  const doc = tr.doc;
  const m = cur.m;
  const c = closure();
  let set = prev.map(tr.mapping, doc);
  if (!m || !c || !doc.childCount) return DecorationSet.empty;
  const r = changedRange(tr);
  if (!r) return set;
  if (r.to - r.from > doc.content.size * 0.5) return fullSet(doc);
  // the top-level blocks the change touched, widened to whole runs
  let first = doc.resolve(Math.min(r.from, doc.content.size)).index(0);
  let last = doc.resolve(Math.min(r.to, doc.content.size)).index(0);
  first = Math.min(first, doc.childCount - 1);
  last = Math.min(Math.max(last, first), doc.childCount - 1);
  while (first > 0 && !breaksRun(doc, first)) first--;
  /* the run before too: a change to a block's own spacing (its `pre` gaining a blank line) makes it a run start, and a
     name that ran across the old join keeps its mark in the run before; re-scanning that run takes it off (only
     then: typing never pays for it) */
  if (r.attr && first > 0) {
    first--;
    while (first > 0 && !breaksRun(doc, first)) first--;
  }
  while (last + 1 < doc.childCount && !breaksRun(doc, last + 1)) last++;
  let start = 0;
  for (let i = 0; i < first; i++) start += doc.child(i).nodeSize;
  let end = start;
  for (let i = first; i <= last; i++) end += doc.child(i).nodeSize;
  set = set.remove(set.find(start, end, (spec) => !!(spec as { bm?: boolean }).bm));
  const out: Decoration[] = [];
  scanRun(doc, first, last, m, c.api, out);
  return out.length ? set.add(doc, out) : set;
}

/* ---- the margin dots (1.0: bibleDotsCompute, bibleDeskPlaceDots) ---- */
const dotTimers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();
function scheduleDots(view: EditorView, ms = 200): void {
  const t = dotTimers.get(view);
  if (t) clearTimeout(t);
  dotTimers.set(
    view,
    setTimeout(() => {
      dotTimers.delete(view);
      if (view.isDestroyed) return;
      view.dispatch(view.state.tr.setMeta(covKey, { dots: computeDots(view) }).setMeta('addToHistory', false));
    }, ms),
  );
}
function computeDots(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const a = activeEditor();
  if (!a || a.editor.view !== view) return DecorationSet.empty;
  // no entry holds a change: nothing to place, and the book's state is not built (a typing pause on Dumas costs nothing)
  if (!cur.changes || !cur.on) return DecorationSet.empty;
  const c = covEnter();
  if (!c) return DecorationSet.empty;
  if (!c.api.bibleAllEntries().some((e) => e.changes && e.changes.length)) return DecorationSet.empty;
  if (!c.api.bibleMarksOn()) return DecorationSet.empty; // 1.0: the mirror (and its dots) is off with the underlines
  const d = toBook(doc);
  const val = toText(d);
  const dots = c.api.bibleDotsCompute(val);
  if (!dots.length) return DecorationSet.empty;
  const out = dots.map((x) => {
    // the passage's place as a cursor position (1.0: an empty marker in the mirror's text at x.at)
    let p = 0;
    for (let lo = 0, hi = doc.content.size; lo <= hi; ) {
      const mid = (lo + hi) >> 1;
      if (posToTextOffset(d, mid) <= x.at) {
        p = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return Decoration.widget(
      p,
      () => {
        const el = document.createElement('span');
        el.className = 'bm-dotmark';
        el.setAttribute('data-bib-entry', x.eid);
        el.title = x.title;
        el.contentEditable = 'false';
        return el;
      },
      { side: -1, key: 'dot:' + x.cid + ':' + x.at + ':' + x.title, dot: true, ignoreSelection: true },
    );
  });
  return DecorationSet.create(doc, out);
}

/* ---- the card (1.0: bibleCardShowHit / bibleCardHide) ---- */
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hot: string | null = null;
const $ = (id: string) => document.getElementById(id);
function setHot(k: string | null): void {
  if (hot === k) return;
  if (hot) document.querySelectorAll('.bm[data-bm="' + hot + '"]').forEach((x) => x.classList.remove('is-hot'));
  hot = k;
  if (k) document.querySelectorAll('.bm[data-bm="' + k + '"]').forEach((x) => x.classList.add('is-hot'));
}
export function cardHide(): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (hideTimer) clearTimeout(hideTimer);
  hoverTimer = hideTimer = null;
  const el = $('bibleCard');
  if (el && !el.hidden) {
    el.hidden = true;
    el.innerHTML = '';
  }
  setHot(null);
}
covEnv.cardHide = cardHide;

/** 1.0's bibleCardShowHit: the entry's card under the name (above it at the screen's end), start-aligned. */
function cardShow(span: Element, byCaret: boolean): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  if (hideTimer) clearTimeout(hideTimer);
  hoverTimer = hideTimer = null;
  const id = span.getAttribute('data-bib-id') || '';
  const k = span.getAttribute('data-bm') || '';
  const end = covBegin();
  if (!end) return;
  try {
    const c = closureRef!;
    const a = c.api;
    const e = a.bibleById(id);
    if (!e) return;
    const rs = span.getClientRects();
    const r = rs.length ? rs[0]! : span.getBoundingClientRect();
    const el = a.bibleCardEl();
    el.innerHTML = a.bibleCardHtml(e);
    // 1.0 draws the card's two icons itself with window.lucide (bibleIconSvg), which 2.0's page does not have: the same
    // two icons, drawn by 2.0's icon pass on the card alone
    const ty = el.querySelector('.bib-card-type');
    if (ty && !ty.querySelector('svg')) ty.insertAdjacentHTML('afterbegin', '<i data-lucide="' + iconOf(a, e.type) + '"></i>');
    const ob = el.querySelector('[data-bib-open]');
    if (ob && !ob.querySelector('svg')) ob.insertAdjacentHTML('afterbegin', '<i data-lucide="book-marked"></i>');
    drawIcons(el);
    el.setAttribute('aria-label', globalT('bible.cardAria') + ': ' + a.bibleName(e));
    el.setAttribute('data-i', k);
    el.setAttribute('data-how', byCaret ? 'caret' : 'hover');
    el.hidden = false;
    setHot(k);
    const cw = el.offsetWidth, ch = el.offsetHeight;
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    let left = rtl ? r.right - cw : r.left;
    left = Math.max(12, Math.min(window.innerWidth - cw - 12, left));
    let top = r.bottom + 8;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 8);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  } finally {
    end();
  }
}
const ICONS: Record<string, string> = { character: 'user-round', place: 'map-pin', thing: 'gem', group: 'users', lore: 'scroll-text' };
const iconOf = (_a: Closure['api'], type: string) => ICONS[type] || 'scroll-text';
const globalT = (k: string, p?: Record<string, unknown>) => closureT()(k, p);

/** The mark under the caret (1.0: bibleDeskHitAtCaret, both ends inclusive), as its first span in the page. */
function spanAtCaret(view: EditorView): Element | null {
  const st = covKey.getState(view.state);
  if (!st) return null;
  const { from, to } = view.state.selection;
  if (from !== to) return null;
  const hit = st.set.find(from, from, (spec) => !!(spec as { bm?: boolean }).bm)[0];
  if (!hit) return null;
  return view.dom.querySelector('.bm[data-bm="' + (hit.spec as { k: number }).k + '"]');
}

/* ---- marking a change (1.0: bibleMarkNames, bibleMarkShowMenu, the Alt+M handler) ---- */
function selectionOffsets(view: EditorView): { s: number; e: number; text: string } {
  const d = toBook(view.state.doc);
  const { from, to } = view.state.selection;
  return { s: posToTextOffset(d, from), e: posToTextOffset(d, to), text: toText(d) };
}
/** The entries a selection can mark a change for (1.0's bibleMarkNames; the underlines may be off: Alt+M still works). */
function markNames(view: EditorView, c: Closure): { s: number; e: number; names: { id: string; name: string }[] } | null {
  const a = c.api;
  const st = c.getState() as { activeId?: unknown };
  if (view.state.selection.empty || !a.bibleAllEntries().length || c.vars.editorSyncedSectionId !== st.activeId) return null;
  const { s, e, text } = selectionOffsets(view);
  const m = a.bibleMatcherNow();
  const hits = a.bibleScan(text, m).hits;
  return { s, e, names: a.bibleMarkOffered(hits, s, e).map((x) => ({ id: x.id, name: a.bibleName(x) })) };
}
/** The point 1.0 places the menu or the popover at, with no pointer: the page's start edge + 24, the selection's end
 *  line + 34 (1.0: area left + 24, its line's top in the textarea + 34). */
function placePoint(view: EditorView): { x: number; y: number } {
  const r = view.dom.getBoundingClientRect();
  const at = view.coordsAtPos(view.state.selection.to);
  const rtl = document.documentElement.getAttribute('dir') === 'rtl';
  return { x: rtl ? r.right - 24 : r.left + 24, y: at.top + 34 };
}
function showMenu(view: EditorView, pt: { x: number; y: number } | null, focus: boolean): boolean {
  const end = covBegin();
  if (!end) return false;
  try {
    const c = closureRef!;
    const a = c.api;
    const got = markNames(view, c);
    if (!got || !got.names.length) {
      a.bibleMarkHideMenu();
      return false;
    }
    const mk = a.bibleMark;
    mk.sec = (c.getState() as { activeId?: string }).activeId ?? null;
    mk.start = got.s;
    mk.end = got.e;
    mk.names = got.names.map((x) => x.id);
    mk.pt = pt;
    const el = a.bibleMarkMenuEl();
    el.setAttribute('aria-label', globalT('bible.markTip'));
    el.innerHTML = got.names.map((x) => '<button type="button" role="menuitem" data-mark-for="' + a.esc(x.id) + '">' + a.esc(markFor(x.name)) + '</button>').join('');
    el.hidden = false;
    a.bibleMarkPlace(el, pt ?? placePoint(view));
    if (focus) el.querySelector<HTMLElement>('button')?.focus();
    return true;
  } finally {
    end();
  }
}
const markFor = (name: string) => globalT('bible.markFor', { name });
function hideMenu(): void {
  const el = $('bibleMarkMenu');
  if (el && !el.hidden) {
    el.hidden = true;
    el.innerHTML = '';
  }
}
/** Alt+M: one name opens the popover at once, several the menu (focused). */
function altM(view: EditorView): boolean {
  const end = covBegin();
  if (!end) return false;
  try {
    const c = closureRef!;
    const got = markNames(view, c);
    if (!got || !got.names.length) return false;
    const mk = c.api.bibleMark;
    mk.sec = (c.getState() as { activeId?: string }).activeId ?? null;
    mk.start = got.s;
    mk.end = got.e;
    mk.pt = null;
    if (got.names.length === 1) c.api.bibleMarkOpen(got.names[0]!.id, placePoint(view));
    else {
      end();
      return showMenu(view, null, true);
    }
    return true;
  } finally {
    end();
  }
}

/* ---- the plugin ---- */
export function covenantPlugin(): Plugin<MarkState> {
  return new Plugin<MarkState>({
    key: covKey,
    state: {
      init: (_cfg, state: EditorState) => {
        // a chapter opened (or remounted after a move) draws with the Covenant as it is now
        if (closureRef && readMatcher()) cur.ver++;
        return { set: fullSet(state.doc), dots: DecorationSet.empty, ver: cur.ver };
      },
      apply(tr, value) {
        const meta = tr.getMeta(covKey) as { refresh?: boolean; dots?: DecorationSet } | undefined;
        let { set, dots } = value;
        if (meta?.refresh || value.ver !== cur.ver) set = fullSet(tr.doc);
        else if (tr.docChanged) set = incremental(set, tr);
        if (meta?.dots) dots = meta.dots;
        else if (tr.docChanged) dots = dots.map(tr.mapping, tr.doc);
        if (meta?.refresh) dots = DecorationSet.empty;
        return { set, dots, ver: cur.ver };
      },
    },
    props: {
      decorations(state) {
        const st = covKey.getState(state);
        if (!st) return null;
        if (st.dots === DecorationSet.empty) return st.set;
        return st.set.add(state.doc, st.dots.find());
      },
      handleKeyDown(view, e) {
        if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          const sp = spanAtCaret(view);
          if (sp) {
            cardShow(sp, true);
            return true;
          }
          return false;
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM') {
          if (altM(view)) {
            e.preventDefault();
            return true;
          }
          return false;
        }
        if (e.key === 'Escape') {
          const card = $('bibleCard');
          if (card && !card.hidden) {
            e.preventDefault();
            e.stopPropagation();
            cardHide();
            return true;
          }
          const menu = $('bibleMarkMenu');
          if (menu && !menu.hidden) {
            e.preventDefault();
            e.stopPropagation();
            hideMenu();
            return true;
          }
          return false;
        }
        if (e.key !== 'Shift' && e.key !== 'Alt' && e.key !== 'Control' && e.key !== 'Meta') {
          cardHide();
          if (!(e.shiftKey && /^Arrow/.test(e.key))) hideMenu();
        }
        return false;
      },
      handleDOMEvents: {
        mousemove(view, e) {
          const target = e.target as Element | null;
          const sp = target && target.closest ? target.closest('.bm') : null;
          const card = $('bibleCard');
          if (sp && view.dom.contains(sp)) {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = null;
            if (card && !card.hidden && card.getAttribute('data-i') === sp.getAttribute('data-bm')) return false;
            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => cardShow(sp, false), 380);
          } else {
            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = null;
            if (card && !card.hidden && card.getAttribute('data-how') === 'hover') {
              if (hideTimer) clearTimeout(hideTimer);
              hideTimer = setTimeout(cardHide, 260);
            } else setHot(null);
          }
          return false;
        },
        mouseleave() {
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          const card = $('bibleCard');
          if (card && !card.hidden && card.getAttribute('data-how') === 'hover') {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(cardHide, 260);
          }
          return false;
        },
        mousedown(_view, e) {
          hideMenu();
          const d = (e.target as Element | null)?.closest?.('.bm-dotmark');
          if (d) {
            e.preventDefault();
            covEnv.openBible(d.getAttribute('data-bib-entry') || undefined);
            return true;
          }
          return false;
        },
        mouseup(view, e) {
          const pt = { x: e.clientX + 6, y: e.clientY + 18 };
          setTimeout(() => {
            if (view.isDestroyed) return;
            if (!view.state.selection.empty) {
              cardHide();
              // R25: the menu comes up only while "Underline mentions" is on (Alt+M always works)
              if (cur.on) showMenu(view, pt, false);
              else hideMenu();
              return;
            }
            hideMenu();
            const sp = spanAtCaret(view);
            if (sp) cardShow(sp, true);
            else cardHide();
          }, 0);
          return false;
        },
        keyup(view, e) {
          if (e.shiftKey && !view.state.selection.empty && /^(Arrow|Home$|End$|Page)/.test(e.key) && cur.on) showMenu(view, null, false);
          return false;
        },
        blur() {
          setTimeout(() => {
            const c = $('bibleCard');
            if (c && !c.hidden && c.getAttribute('data-how') === 'caret' && !c.contains(document.activeElement)) cardHide();
          }, 120);
          return false;
        },
      },
    },
    view(view) {
      views.add(view);
      guardHosts();
      // the outside mousedown closes the popover and the menu (1.0's document capture listener)
      const outside = (e: MouseEvent) => {
        const pop = $('bibleMarkPop'), menu = $('bibleMarkMenu');
        const t = e.target as Node;
        if (pop && !pop.hidden && !pop.contains(t)) covRun((c) => c.api.bibleMarkClose(false));
        if (menu && !menu.hidden && !menu.contains(t) && !view.dom.contains(t)) hideMenu();
      };
      const onScroll = () => {
        cardHide();
        hideMenu();
      };
      document.addEventListener('mousedown', outside, true);
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      scheduleDots(view, 0);
      return {
        update(v, prev) {
          if (v.state.doc !== prev.doc) scheduleDots(v);
        },
        destroy() {
          views.delete(view);
          document.removeEventListener('mousedown', outside, true);
          window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
          const t = dotTimers.get(view);
          if (t) clearTimeout(t);
          cardHide();
          hideMenu();
        },
      };
    },
  });
}

/** The editor extension: the Covenant's marks on this chapter. The matcher is read when it is created, so a chapter
 *  opened (or remounted after a move) draws 1.0's marks at once. */
export const CovenantMarks = Extension.create({
  name: 'beukCovenant',
  addProseMirrorPlugins() {
    return [covenantPlugin()];
  },
});

/** The closure the plugin scans with (set once it has loaded). */
export function setMarksClosure(c: Closure): void {
  closureRef = c;
}

/* The page's seam for the e2e (as 1.0 publishes window.beukBible): the open editor's marks as ranges, and 1.0's desk
   hits (text offsets) as the ranges they cover on the same page, so the two apps' marks are compared span for span. */
if (typeof window !== 'undefined') {
  (window as unknown as { beukCovenant?: unknown }).beukCovenant = {
    ranges: () => {
      const v = activeEditor()?.editor.view;
      return v ? rangesOf(v.state) : [];
    },
    expected: (hits: Hit[]) => {
      const v = activeEditor()?.editor.view;
      return v ? rangesFor(v.state.doc, hits) : [];
    },
    text: () => {
      const v = activeEditor()?.editor.view;
      return v ? toText(toBook(v.state.doc)) : '';
    },
    refresh: () => covenantDesk.refresh(true),
  };
}
