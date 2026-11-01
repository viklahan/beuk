import * as Y from 'yjs';
import { exportBook, insertSections, setMetaValue, SECTIONS } from '@book/editor/index.js';
import { stateFromBook, structEnv, type Closure, type State } from '../closure/index';
import { writeFields } from '../chapters/chop';
import icons from '../generated/icons.json';
import type { IconName } from '../shell/Icon';

/* BEUK:structure (inventory B3) and the outline board's writes (B5): 1.0's
   own structure functions run on the open book.

   ONE SOURCE (constraint 17). Retyping a section (retypeSection), the
   matter library (insertMatter: MATTER_LIBRARY, SINGLETON_TYPES,
   MATTER_ORDER), Add Chapter (addChapter), Add Part (addPart) and the
   sidebar's move (moveSection, moveSectionTo: the tier law) are 1.0's OWN
   functions, run through the browser closure on a state that holds the
   book AS BOOK FORMAT (exportBook's book, a copy: these functions only read
   and write book fields, as the image library's do, wave 2b ruling 6). The
   outline board's edits (olSetField, olAddTag, olDeleteTag, olSaveFilter,
   the threads and custom fields, …) run the same way, with state.outline
   normalised as 1.0's applyBookDoc does on arrival (olNormalize).

   What 1.0's code leaves in that state is written back into the Y.Doc,
   only what changed, in ONE transaction (constraint 19: one Y transaction,
   one undo step):
   - a top-level value that differs, through setMetaValue;
   - the sections through writeOrdered: sections gone deleted, a moved
     section taken out and put in again at its new place, new ones inserted
     (insertSections), and in a section that stays only the keys whose value
     changed (chop.ts writeFields: its text through y-prosemirror's diffing
     update, so an open chapter editor stays bound).
   For the board, the stored form is 1.0's serializeBook's: `outline` only
   when olBookSet() (olBookPack), and an edited section's planning fields as
   olSectionFields gives them, last (1.0's normalizeSection).

   Every call reads the book at the moment it runs (the click): a remote
   change that landed in between is part of what 1.0's code sees.

   Around 1.0's code (scripts/extract-closure.mjs BROWSER_SUPPLIED): its
   redraws are no-ops (React re-renders from the Y.Doc), selectSection
   records the section 1.0 chose (the caller selects it once the change is
   written; 2.0 never writes activeId, wave 1a ruling 9) and toast is the
   caller's. */

type Rec = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 1.0's planning fields on a section (olSectionFields' keys). */
const PLAN_KEYS = ['synopsis', 'status', 'tags', 'pov', 'threads', 'custom'];

/** A toast as 1.0's code raises it: its message, its Lucide icon name (kebab case) and an optional action. */
export type StructToast = (msg: string, icon?: string, action?: { label: string; ms?: number; onClick: () => void }) => void;

/** 1.0's Lucide name (kebab case, as 1.0's toasts pass it) as the studio's icon; 1.0's vendored aliases mapped. */
const ALIAS: Record<string, string> = { 'alert-triangle': 'TriangleAlert' };
export function iconOf(name: string | undefined): IconName {
  if (!name) return 'Check';
  const pascal = ALIAS[name] ?? name.replace(/(^|-)([a-z0-9])/g, (_m, _d, ch: string) => ch.toUpperCase());
  return (Object.hasOwn(icons, pascal) ? pascal : 'Check') as IconName;
}

const idOf = (m: unknown): string | null => {
  const v = m instanceof Y.Map ? m.get('id') : isRec(m) ? m.id : undefined;
  return typeof v === 'string' ? v : null;
};

/** True when every section has its own, unique string id (the writer matches sections by id). */
export function idsOk(secs: unknown[]): boolean {
  const seen = new Set<string>();
  for (const s of secs) {
    const id = idOf(s);
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** Make the `sections` Y.Array hold `after` (book format), against `prev` (the sections as the Y.Doc held them, read
 *  in the same step). Handles a changed order (a move): where the section wanted at a place stands later, either it
 *  moved up (the sections in between follow it in `after`: it is taken out and put in again here) or the one standing
 *  here moved down (it is taken out, and put in again when its new place comes). Call inside a transaction. */
export function writeOrdered(ydoc: Y.Doc, after: Rec[], prev: Rec[]): void {
  const arr = ydoc.getArray<unknown>(SECTIONS);
  const prevById = new Map(prev.map((s) => [String(s.id), s]));
  const keep = new Set(after.map((s) => String(s.id)));
  for (let i = arr.length - 1; i >= 0; i--) {
    const id = idOf(arr.get(i));
    if (!id || !keep.has(id)) arr.delete(i, 1);
  }
  let i = 0;
  while (i < after.length) {
    const want = String(after[i]!.id);
    const m = i < arr.length ? arr.get(i) : undefined;
    if (m instanceof Y.Map && idOf(m) === want) {
      writeFields(m, after[i]!, prevById.get(want));
      i++;
      continue;
    }
    let j = -1;
    for (let k = i + 1; k < arr.length; k++) if (idOf(arr.get(k)) === want) { j = k; break; }
    if (j < 0) {
      insertSections(arr, i, [clone(after[i]!)]);
      i++;
      continue;
    }
    let follows = true;
    for (let k = i; k < j; k++) if (idOf(arr.get(k)) !== String(after[i + 1 + (k - i)]?.id)) { follows = false; break; }
    if (follows) {
      arr.delete(j, 1);
      insertSections(arr, i, [clone(after[i]!)]);
      i++;
    } else arr.delete(i, 1);
  }
}

/** Write what changed from `before` to `after` (book format). False when nothing did. One transaction. */
export function writeBook(ydoc: Y.Doc, before: Rec, after: Rec): boolean {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => k !== 'history' && k !== 'historyPool');
  const changed = keys.filter((k) => !same(before[k], after[k]));
  if (!changed.length) return false;
  ydoc.transact(() => {
    for (const k of changed) {
      if (k === 'sections') writeOrdered(ydoc, after.sections as Rec[], before.sections as Rec[]);
      else setMetaValue(ydoc, k, after[k]);
    }
  });
  return true;
}

/** What 1.0's code changed, laid over the book as stored. 1.0's functions run on 1.0's normalised state (ARRIVE:
 *  every section through normalizeSection, so a stored section lacking `kind`, `included`, … reads as 1.0 reads it);
 *  only the differences between that state before and after are carried onto the book-format copy:
 *  - a top-level value that changed takes 1.0's value (`outline`: 1.0's serializeBook rule, olBookSet / olBookPack);
 *  - the sections take 1.0's order; a section 1.0 made is taken whole; in one that stood, each key whose normalised
 *    value changed takes 1.0's value (a planning field as olSectionFields gives it, as serializeBook writes it), and a
 *    key 1.0 took away is removed. A section's keys 1.0 did not touch stay exactly as stored. */
function carry(c: Closure, book: Rec, pre: Rec, st: State, outline: boolean): Rec {
  const out = clone(book);
  for (const k of Object.keys(st)) {
    if (k === 'sections' || k === 'history' || k === 'historyPool' || k === 'outline') continue;
    if (!same(pre[k], st[k])) out[k] = clone(st[k]);
  }
  c.setState(st);
  if (outline) {
    if (c.api.olBookSet()) out.outline = c.api.olBookPack();
    else delete out.outline;
  }
  const stored = new Map(((book.sections as Rec[]) || []).map((s) => [String(s.id), s]));
  const was = new Map(((pre.sections as Rec[]) || []).map((s) => [String(s.id), s]));
  out.sections = st.sections.map((s) => {
    const id = String(s.id);
    const b = stored.get(id), w = was.get(id);
    if (!b || !w) return clone(s);
    if (same(w, s)) return b;
    const r = clone(b);
    const plan = c.api.olSectionFields(s);
    for (const k of new Set([...Object.keys(w), ...Object.keys(s)])) {
      if (same(w[k], s[k])) continue;
      const v = PLAN_KEYS.includes(k) ? plan[k] : s[k];
      if (v === undefined) delete r[k];
      else r[k] = clone(v);
    }
    return r;
  });
  return out;
}

/** `refused`: 2.0 did not run 1.0's function, or did not write its result, because the book's sections lack unique
 *  string ids (the writer matches sections by id). 1.0 never meets this (normalizeSection gives every section an id on
 *  load) and has no message for it, so the callers say nothing: the action is a quiet no-op, noted in the wave report. */
export type RunResult<R> = { value: R; wrote: boolean; selected: string | null; refused?: true };
export type RunOpts = { outline?: boolean; toast?: StructToast };

/** Run `fn` (1.0's own code, reading `state`) on 1.0's state of the open book, then write back what it changed. */
export function runOnBook<R>(c: Closure, ydoc: Y.Doc, fn: (st: State) => R, opts: RunOpts = {}): RunResult<R> {
  const book = exportBook(ydoc);
  if (!Array.isArray(book.sections) || !idsOk(book.sections as unknown[])) return { value: undefined as R, wrote: false, selected: null, refused: true };
  const st = stateFromBook(c, book);
  // 1.0's applyBookDoc: state.outline = olNormalize(doc.outline, state.sections)
  if (opts.outline) st.outline = c.api.olNormalize(book.outline, st.sections);
  const pre = clone(st) as Rec;
  const keep = { select: structEnv.select, toast: structEnv.toast };
  let selected: string | null = null;
  structEnv.select = (id) => {
    selected = id;
  };
  structEnv.toast = opts.toast ?? (() => undefined);
  let value: R;
  try {
    c.setState(st);
    value = fn(st);
  } finally {
    structEnv.select = keep.select;
    structEnv.toast = keep.toast;
  }
  const after = carry(c, book, pre, st, !!opts.outline);
  if (!idsOk(after.sections as unknown[])) return { value, wrote: false, selected, refused: true };
  const wrote = writeBook(ydoc, book, after);
  return { value, wrote, selected };
}

/** The index of the section with this id in the Y.Doc (null when gone). */
export function indexOfId(ydoc: Y.Doc, id: string | null): number | null {
  if (!id) return null;
  const i = ydoc.getArray<unknown>(SECTIONS).toArray().findIndex((m) => idOf(m) === id);
  return i < 0 ? null : i;
}
/** The id of the section at this index, read now. */
export function idAt(ydoc: Y.Doc, index: number | null): string | null {
  if (index === null) return null;
  const arr = ydoc.getArray<unknown>(SECTIONS);
  return index >= 0 && index < arr.length ? idOf(arr.get(index)) : null;
}

/* ---- B3: the section type, the matter library, Add Chapter / Add Part, move, the include eye ---- */

/** 1.0's #secTypeSel change: "kind:type" → retypeSection. */
export function retype(c: Closure, ydoc: Y.Doc, id: string, value: string): RunResult<boolean> {
  const parts = String(value).split(':');
  if (parts.length !== 2) return { value: false, wrote: false, selected: null };
  return runOnBook(c, ydoc, () => c.api.retypeSection(id, parts[1]!, parts[0]!));
}

/** 1.0's matter library button: insertMatter (a singleton that stands already is selected, not doubled). */
export const insertMatter = (c: Closure, ydoc: Y.Doc, type: string, toast: StructToast) => runOnBook(c, ydoc, () => c.api.insertMatter(type), { toast });
/** 1.0's Add Chapter. */
export const addChapter = (c: Closure, ydoc: Y.Doc, toast: StructToast) => runOnBook(c, ydoc, () => c.api.addChapter(), { toast });
/** 1.0's Add Part. */
export const addPart = (c: Closure, ydoc: Y.Doc, toast: StructToast) => runOnBook(c, ydoc, () => c.api.addPart(), { toast });
/** 1.0's row move up / down (moveSection: within the tier; across it nothing moves). */
export const moveStep = (c: Closure, ydoc: Y.Doc, id: string, dir: 'up' | 'down') => runOnBook(c, ydoc, () => c.api.moveSection(id, dir));
/** 1.0's sidebar drop (moveSectionTo: the same tier law). The caller says toast.moveTier when it is refused, as 1.0. */
export const moveTo = (c: Closure, ydoc: Y.Doc, dragId: string, targetId: string, after: boolean) =>
  runOnBook(c, ydoc, () => c.api.moveSectionTo(dragId, targetId, after));
/** 1.0's include eye (sectionAction "eye": s.included = !s.included). */
export const toggleIncluded = (c: Closure, ydoc: Y.Doc, id: string) =>
  runOnBook(c, ydoc, (st) => {
    const s = st.sections.find((x) => x.id === id);
    if (!s) return false;
    s.included = !s.included;
    return true;
  });
