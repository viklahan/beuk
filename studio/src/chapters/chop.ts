import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { BODY, escKey, insertSections, META, sectionPlain, SECTIONS, toDoc } from '@book/editor/index.js';
import type { Closure, HistoryEntry } from '../closure/index';
import { live, takeSnapshot, writeHistory } from '../history/history';

/* BEUK:chapterops — 1.0's structural edits on the section list (inventory
   B2; client/index.html chopRun / chopUndo / chopDelete / chopDuplicate /
   chopSplit / chopMerge), ported onto the Y.Doc.

   ONE SOURCE. What each operation may do, where a split cuts, how a merge
   joins and relabels notes, the names, the signatures and the chapter
   numbering styles are 1.0's own functions, run through the browser closure
   against 1.0's state built from the book (chopSplitPlan, chopMergePlan,
   chopMergeWhy, chopCanDelete / Duplicate / SplitKind, chopGenerated,
   chopName, chopSig, chopNumberStyle, chopStyleFits, normalizeScenes, uid).
   What is ported here is chopRun's flow and each operation's apply / undo:

   - chopRun: a History snapshot first ("Before deleting …", auto kind
     "chapterop", with its chop record; 1.0's pruning keeps five), then the
     change, then — when the chapters were numbered in a style 1.0 knows —
     the chapters renumbered in that style. The snapshot, the change and the
     renumbering are ONE Y transaction (one update, one step).
   - chopUndo: an inverse edit, not a restore: it puts back only what the
     operation took; a section the operation produced that has been edited
     since is left alone, and the caller says so (1.0's chop.undoChanged).
     The spent snapshot is removed; numbering as 1.0 does it. One Y
     transaction.

   How the change reaches the Y.Doc: each operation works on the book's
   sections as book format (exportBook's sections, a copy), exactly as 1.0's
   apply works on state.sections; then writeSections lays the result over the
   `sections` Y.Array — removed sections deleted, new ones inserted
   (insertSections), and in a section that stays only the keys whose value
   changed are set (its text through y-prosemirror's diffing update, so an
   open chapter editor stays bound to its fragment).

   Differences, each a consequence of 2.0's rules (see the wave report):
   - activeId is not written (wave 1a ruling 9: 2.0 never writes it on a
     selection); the caller selects the section 1.0 would make active;
   - a split cuts at a TEXT offset (the caret mapped through
     src/book/editor/positions.ts), so wherever the caret stands — inside
     emphasis, a note reference, a raw block — the halves are 1.0's
     chopSplitPlan texts exactly, written through toDoc. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export type ChopOp = 'delete' | 'duplicate' | 'split' | 'merge';
type T = (key: string, params?: Record<string, unknown>) => string;
type Style = (n: number) => string;

/** One operation's record (1.0's rec): what Undo needs. Lives in memory, as 1.0's does. */
export type ChopRec = {
  op: ChopOp;
  ydoc: Y.Doc;
  snapId: string;
  snap: HistoryEntry;
  pre: { activeId: string | null; numbers: Record<string, string>; style: Style | null };
  post: { numbers: Record<string, string>; activeId: string | null };
  data: Rec;
  undo: (d: Rec, secs: Rec[], w: Work) => true | string;
  done: boolean;
};
export type ChopEnv = { c: Closure; ydoc: Y.Doc; t: T; activeId: string | null };
export type ChopDone = { rec: ChopRec; activeId: string | null };
export type UndoResult = { ok: true; activeId: string | null } | { ok: false; changed: string | null };

/** The book's sections as book format, and 1.0's state for the closure (set as its global state). */
type Work = { c: Closure; t: T; ydoc: Y.Doc; meta: { audio?: unknown } };

const chaptersOf = (secs: Rec[]): Rec[] => secs.filter((s) => s.type === 'chapter');
/** 1.0's chopNumbers, over book-format sections. */
const numbersOf = (secs: Rec[]): Record<string, string> => {
  const m: Record<string, string> = {};
  chaptersOf(secs).forEach((c) => {
    m[String(c.id)] = String(c.number || '');
  });
  return m;
};

/* ---- writing the result into the Y.Doc ---- */

/** Lay `plain` (one section as book format) over the stored section `map`: only changed keys are set, keys gone are
 *  deleted, the text through a diffing update of its fragment. */
function writeFields(map: Y.Map<unknown>, plain: Rec, prev: Rec | undefined): void {
  if (prev && same(prev, plain)) return; // untouched (the common case: every section the operation did not change)
  for (const [k, v] of Object.entries(plain)) {
    if (k === 'content' && typeof v === 'string' && map.get(BODY) instanceof Y.XmlFragment) {
      const frag = map.get(BODY) as Y.XmlFragment;
      const was = prev ? prev.content : (sectionPlain(map) as Rec).content;
      if (was !== v) prosemirrorToYXmlFragment(toDoc(v), frag);
      continue;
    }
    const key = escKey(k);
    const cur = map.get(key);
    const curPlain = cur instanceof Y.AbstractType ? cur.toJSON() : cur;
    if (!map.has(key) || !same(curPlain, v)) map.set(key, clone(v));
  }
  for (const key of [...map.keys()]) {
    if (key === BODY) continue;
    const k = key.startsWith('~') ? key.slice(1) : key;
    if (!Object.hasOwn(plain, k)) map.delete(key);
  }
}

/** True when every section has its own, unique string id (the writer below matches sections by id). */
function idsOk(secs: unknown[]): boolean {
  const seen = new Set<string>();
  for (const s of secs) {
    if (!isRec(s) || typeof s.id !== 'string' || !s.id || seen.has(s.id)) return false;
    seen.add(s.id);
  }
  return true;
}

/** Make the `sections` Y.Array hold `after` (book format). Sections keep their relative order in every operation, so:
 *  delete the ones gone, then walk `after`, updating the one standing there or inserting the new one. `prev`: the
 *  sections as the Y.Doc holds them now (read in the same synchronous step). Call inside a transaction. */
export function writeSections(ydoc: Y.Doc, after: Rec[], prev: Rec[]): void {
  const prevById = new Map(prev.map((s) => [String(s.id), s]));
  const arr = ydoc.getArray<unknown>(SECTIONS);
  const keep = new Set(after.map((s) => String(s.id)));
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr.get(i);
    const id = m instanceof Y.Map ? m.get('id') : isRec(m) ? m.id : undefined;
    if (typeof id !== 'string' || !keep.has(id)) arr.delete(i, 1);
  }
  after.forEach((s, i) => {
    const m = i < arr.length ? arr.get(i) : undefined;
    if (m instanceof Y.Map && m.get('id') === s.id) writeFields(m, s, prevById.get(String(s.id)));
    else insertSections(arr, i, [clone(s)]);
  });
}

/** 1.0's state.audio.include rides along with a duplicate (a top-level `audio` value in 2.0's meta). */
function audioInclude(ydoc: Y.Doc): Rec | null {
  const a = ydoc.getMap<unknown>(META).get('audio');
  return isRec(a) && isRec(a.include) ? a : null;
}

/* ---- the shared path ---- */

type Spec = {
  op: ChopOp;
  a: string;
  b?: string;
  /** 1.0's apply, on the book-format sections (mutated in place). Null: nothing to do. */
  apply: (secs: Rec[], w: Work) => (Rec & { activeId: string | null }) | null;
  /** 1.0's settle: signatures of what the operation produced, read back from the book. */
  settle?: (d: Rec, now: Now) => void;
  undo: (d: Rec, secs: Rec[], w: Work) => true | string;
  /** Extra writes in the same transaction (the audio choice of a duplicate). */
  extra?: (d: Rec) => void;
};

/** The book's sections as they stand now: their ids, and one section as book format on demand (a whole-book read
 *  would convert every chapter's text). */
type Now = { ids: string[]; get: (id: unknown) => Rec | undefined; numbers: () => Record<string, string> };
function nowOf(ydoc: Y.Doc): Now {
  const list = ydoc.getArray<unknown>(SECTIONS).toArray();
  const idOf = (m: unknown): string => String(m instanceof Y.Map ? m.get('id') : isRec(m) ? m.id : '');
  const ids = list.map(idOf);
  return {
    ids,
    get: (id) => {
      const i = ids.indexOf(String(id));
      return i < 0 ? undefined : (sectionPlain(list[i], `sections[${i}]`) as Rec);
    },
    numbers: () => {
      const m: Record<string, string> = {};
      for (const x of list) if (x instanceof Y.Map && x.get('type') === 'chapter') m[idOf(x)] = String(x.get('number') || '');
      return m;
    },
  };
}

function chopRun(env: ChopEnv, spec: Spec): ChopDone | null {
  const { c, ydoc, t } = env;
  const L = live(c, ydoc);
  const before = clone(L.book.sections as Rec[]);
  if (!idsOk(before)) return null;
  c.setState(L.state);
  const pre = { activeId: env.activeId, numbers: numbersOf(before), style: c.api.chopNumberStyle() };
  const w: Work = { c, t, ydoc, meta: {} };
  const secs = clone(before);
  const data = spec.apply(secs, w);
  if (!data) return null;
  if (!idsOk(secs)) return null;
  const snap = takeSnapshot(c, L, '', 'chapterop');
  snap.chop = { op: spec.op, a: spec.a || '', b: spec.b || '' };
  if (pre.style) chaptersOf(secs).forEach((s, i) => { s.number = pre.style!(i + 1); });
  ydoc.transact(() => {
    writeSections(ydoc, secs, before);
    spec.extra?.(data);
    writeHistory(c, ydoc, L);
  });
  const now = nowOf(ydoc);
  spec.settle?.(data, now);
  const rec: ChopRec = {
    op: spec.op, ydoc, snapId: snap.id, snap,
    pre, post: { numbers: now.numbers(), activeId: null }, data, undo: spec.undo, done: false,
  };
  const has = (x: string | null): x is string => !!x && now.ids.includes(x);
  const activeId = has(data.activeId) ? data.activeId : has(env.activeId) ? env.activeId : now.ids[0] ?? null;
  rec.post.activeId = activeId;
  return { rec, activeId };
}

/** 1.0's chopUndo. `isLive`: the book this tab holds is still rec's (1.0's chopEpoch). */
export function chopUndo(env: ChopEnv, rec: ChopRec, isLive: (y: Y.Doc) => boolean): UndoResult {
  if (rec.done) return { ok: false, changed: null };
  if (rec.ydoc !== env.ydoc || !isLive(rec.ydoc)) {
    rec.done = true;
    return { ok: false, changed: null };
  }
  const { c, ydoc, t } = env;
  const L = live(c, ydoc);
  c.setState(L.state);
  const style = rec.pre.style ? (c.api.chopStyleFits(rec.pre.style) ? rec.pre.style : c.api.chopNumberStyle()) : null;
  const prev = L.book.sections as Rec[];
  const secs = clone(prev);
  const w: Work = { c, t, ydoc, meta: {} };
  const res = rec.undo(rec.data, secs, w);
  if (res !== true) return { ok: false, changed: res };
  rec.done = true;
  L.state.history = (L.state.history || []).filter((h) => h.id !== rec.snapId);
  if (style) chaptersOf(secs).forEach((s, i) => { s.number = style(i + 1); });
  else
    chaptersOf(secs).forEach((s) => {
      const id = String(s.id);
      if (Object.hasOwn(rec.pre.numbers, id) && rec.post.numbers[id] === String(s.number || '')) s.number = rec.pre.numbers[id];
    });
  if (!idsOk(secs)) return { ok: false, changed: null };
  ydoc.transact(() => {
    writeSections(ydoc, secs, prev);
    if (rec.op === 'duplicate') {
      const a = audioInclude(ydoc);
      const copyId = String(rec.data.copyId);
      if (a && Object.hasOwn(a.include as Rec, copyId)) {
        const inc = { ...(a.include as Rec) };
        delete inc[copyId];
        ydoc.getMap<unknown>(META).set('audio', { ...clone(a), include: inc });
      }
    }
    writeHistory(c, ydoc, L);
  });
  const now = nowOf(ydoc);
  const cur = env.activeId;
  const back = cur === rec.post.activeId || !cur || !now.ids.includes(cur) ? rec.pre.activeId : cur;
  return { ok: true, activeId: back && now.ids.includes(back) ? back : now.ids[0] ?? null };
}

/* ---- what each operation may do here (1.0's rules, through the closure) ---- */

const stateSection = (c: Closure, id: string): Rec | undefined => c.getState().sections.find((s) => s.id === id);

/** The row menu's items (1.0's chopMenuItems): act, label key, the reason it is refused ("" when allowed). */
export type MenuItem = { act: 'dup' | 'split' | 'merge' | 'del'; icon: 'CopyPlus' | 'Scissors' | 'Merge' | 'Trash2'; label: string; why: string; danger?: boolean };
export function chopMenuItems(c: Closure, ydoc: Y.Doc, id: string, t: T, splitWhy: (s: Rec) => string): MenuItem[] {
  const L = live(c, ydoc);
  c.setState(L.state);
  const s = stateSection(c, id);
  const items: MenuItem[] = [];
  if (!s || c.api.chopGenerated(s)) return items;
  if (c.api.chopCanDuplicate(s)) items.push({ act: 'dup', icon: 'CopyPlus', label: t('chop.duplicate'), why: '' });
  if (c.api.chopCanSplitKind(s)) items.push({ act: 'split', icon: 'Scissors', label: t('chop.split'), why: splitWhy(s) });
  items.push({ act: 'merge', icon: 'Merge', label: t('chop.merge'), why: c.api.chopMergeWhy(s) });
  if (c.api.chopCanDelete(s)) items.push({ act: 'del', icon: 'Trash2', label: t('chop.delete'), why: '', danger: true });
  return items;
}

/** 1.0's chopSplitWhy. `caret`: the text offset of the caret in the open chapter, or -1 when this section is not the
 *  one open (1.0's chopCaret). */
export function chopSplitWhy(c: Closure, s: Rec, activeId: string | null, caret: number, t: T): string {
  if (!c.api.chopCanSplitKind(s)) return t('chop.splitNeedsCaret');
  if (s.id !== activeId) return t('chop.splitNeedsActive');
  return c.api.chopSplitPlan(s, caret) ? '' : t('chop.splitNeedsCaret');
}

/* ---- the four operations ---- */

/** 1.0's chopDelete. 'keepOne': refused because a book keeps one body section (1.0 says chop.keepOne). */
export function chopDelete(env: ChopEnv, id: string): ChopDone | 'keepOne' | null {
  const { c, t } = env;
  const L = live(env.c, env.ydoc);
  c.setState(L.state);
  const s = stateSection(c, id);
  if (!s) return null;
  if (!c.api.chopCanDelete(s)) return s.kind === 'body' ? 'keepOne' : null;
  const name = c.api.chopName(s);
  return chopRun(env, {
    op: 'delete', a: name,
    apply(secs) {
      const i = secs.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const d: Rec & { activeId: string | null } = {
        sec: clone(secs[i]), anchor: { idx: i, prevId: i > 0 ? secs[i - 1]!.id : null, nextId: secs[i + 1] ? secs[i + 1]!.id : null }, activeId: env.activeId,
      };
      secs.splice(i, 1);
      if (env.activeId === id) {
        const next = secs[Math.min(i, secs.length - 1)];
        d.activeId = next ? String(next.id) : null;
      }
      return d;
    },
    undo(d, secs) {
      const sec = d.sec as Rec;
      if (!secs.some((x) => x.id === sec.id)) {
        // 1.0's chopInsertAt: after its old previous neighbour, else before its old next one, else at its old index
        const a = d.anchor as { idx: number; prevId: unknown; nextId: unknown };
        let at = -1;
        if (a.prevId) { const p = secs.findIndex((x) => x.id === a.prevId); if (p >= 0) at = p + 1; }
        if (at < 0 && a.nextId) { const p = secs.findIndex((x) => x.id === a.nextId); if (p >= 0) at = p; }
        if (at < 0) at = Math.min(Math.max(0, a.idx), secs.length);
        secs.splice(at, 0, clone(sec));
      }
      return true;
    },
  });
}

/** 1.0's chopDuplicate. */
export function chopDuplicate(env: ChopEnv, id: string): ChopDone | null {
  const { c, t, ydoc } = env;
  const L = live(c, ydoc);
  c.setState(L.state);
  const s = stateSection(c, id);
  if (!s || !c.api.chopCanDuplicate(s)) return null;
  const name = c.api.chopName(s);
  const sigOf = (x: Rec | undefined) => c.api.chopSig(x);
  return chopRun(env, {
    op: 'duplicate', a: name,
    apply(secs) {
      const i = secs.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const copy = clone(secs[i]!);
      copy.id = c.api.uid();
      copy.title = t('chop.copyTitle', { title: name });
      secs.splice(i + 1, 0, copy);
      return { copyId: copy.id, origId: id, activeId: String(copy.id) };
    },
    extra(d) {
      // the audio script's per-section choice rides along (reader comments stay with the original)
      const a = audioInclude(ydoc);
      if (a && Object.hasOwn(a.include as Rec, id)) ydoc.getMap<unknown>(META).set('audio', { ...clone(a), include: { ...(a.include as Rec), [String(d.copyId)]: clone((a.include as Rec)[id]) } });
    },
    settle(d, now) {
      d.copySig = sigOf(now.get(d.copyId));
    },
    undo(d, secs) {
      const i = secs.findIndex((x) => x.id === d.copyId);
      if (i < 0) return true;
      if (sigOf(secs[i]) !== d.copySig) return c.api.chopName(secs[i]);
      secs.splice(i, 1);
      return true;
    },
  });
}

/** 1.0's chopSplit at text offset `pos` of the section's content. */
export function chopSplit(env: ChopEnv, id: string, pos: number): ChopDone | null {
  const { c, ydoc } = env;
  const L = live(c, ydoc);
  c.setState(L.state);
  const s = stateSection(c, id);
  if (!s) return null;
  const plan = c.api.chopSplitPlan(s, pos);
  if (!plan) return null;
  const name = c.api.chopName(s);
  const sigOf = (x: Rec | undefined) => c.api.chopSig(x);
  return chopRun(env, {
    op: 'split', a: name,
    apply(secs) {
      const i = secs.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const a = secs[i]!;
      const d: Rec & { activeId: string | null } = { before: clone(a), aId: a.id, activeId: null };
      const b = Object.assign(clone(a), {
        id: c.api.uid(), title: plan.title, subtitle: '', content: plan.c2, scenes: plan.sc2,
        plateId: null, plateAlt: '', backdropId: null, htLine1: null, htLine2: '', tocHeading: null,
      });
      a.content = plan.c1;
      a.scenes = plan.sc1;
      secs.splice(i + 1, 0, b);
      d.bId = b.id;
      d.activeId = String(b.id);
      return d;
    },
    settle(d, now) {
      d.aSig = sigOf(now.get(d.aId));
      d.bSig = sigOf(now.get(d.bId));
    },
    undo(d, secs) {
      const ai = secs.findIndex((x) => x.id === d.aId), bi = secs.findIndex((x) => x.id === d.bId);
      if (ai < 0) return c.api.chopName(d.before);
      if (sigOf(secs[ai]) !== d.aSig) return c.api.chopName(secs[ai]);
      if (bi >= 0 && sigOf(secs[bi]) !== d.bSig) return c.api.chopName(secs[bi]);
      const restored = clone(d.before as Rec);
      restored.number = secs[ai]!.number;
      if (!Object.hasOwn(d.before as Rec, 'number') && restored.number === undefined) delete restored.number;
      secs[ai] = restored;
      if (bi >= 0) secs.splice(secs.findIndex((x) => x.id === d.bId), 1);
      return true;
    },
  });
}

/** 1.0's chopMerge: the section with the one after it. */
export function chopMerge(env: ChopEnv, id: string): ChopDone | null {
  const { c, t, ydoc } = env;
  const L = live(c, ydoc);
  c.setState(L.state);
  const a = stateSection(c, id);
  if (!a || c.api.chopMergeWhy(a)) return null;
  const all = c.getState().sections;
  const b = all[all.indexOf(a) + 1]!;
  const an = c.api.chopName(a), bn = c.api.chopName(b);
  const plan = c.api.chopMergePlan(a, b);
  const sigOf = (x: Rec | undefined) => c.api.chopSig(x);
  return chopRun(env, {
    op: 'merge', a: an, b: bn,
    apply(secs) {
      const i = secs.findIndex((x) => x.id === id);
      const A = secs[i], B = secs[i + 1];
      if (!A || !B || B.id !== b.id) return null;
      const d: Rec & { activeId: string | null } = { aBefore: clone(A), bSec: clone(B), aId: A.id, activeId: env.activeId === B.id ? String(A.id) : env.activeId };
      A.content = plan.content;
      A.scenes = plan.scenes;
      secs.splice(i + 1, 1);
      return d;
    },
    settle(d, now) {
      d.aSig = sigOf(now.get(d.aId));
    },
    undo(d, secs) {
      const ai = secs.findIndex((x) => x.id === d.aId);
      if (ai < 0) return c.api.chopName(d.aBefore);
      if (sigOf(secs[ai]) !== d.aSig) return c.api.chopName(secs[ai]);
      const restored = clone(d.aBefore as Rec);
      restored.number = secs[ai]!.number;
      if (!Object.hasOwn(d.aBefore as Rec, 'number') && restored.number === undefined) delete restored.number;
      secs[ai] = restored;
      const bSec = d.bSec as Rec;
      if (!secs.some((x) => x.id === bSec.id)) secs.splice(ai + 1, 0, clone(bSec));
      return true;
    },
  });
}

/** The toast text and icon of a finished operation (1.0's spec.msg / spec.icon). */
export function chopMessage(rec: ChopRec, t: T): string {
  const ch = rec.snap.chop!;
  if (rec.op === 'delete') return t('chop.deleted', { name: ch.a });
  if (rec.op === 'duplicate') return t('chop.duplicated', { name: ch.a });
  if (rec.op === 'split') return t('chop.splitDone', { name: ch.a });
  return t('chop.merged', { a: ch.a, b: ch.b });
}
