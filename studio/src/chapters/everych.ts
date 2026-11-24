import * as Y from 'yjs';
import { escKey, sectionList } from '@book/editor/index.js';
import type { Closure } from '../closure/index';
import { live, takeSnapshot, writeHistory } from '../history/history';
import type { UiKey } from '../i18n/strings';
import { storedImages } from '../pictures/pictures';

/* "Use on every chapter" (2026-11-24): one chapter's settings copied to every chapter at once. V asked for "the
   backdrop on every chapter option" and for bulk application "wherever necessary or helpful"; every choice below is the
   building session's, his to overturn.

   WHAT A ROW IS. Each setting that may be shared is one entry of ROWS: the section keys it reads and writes, whether
   it is offered for the chapter it is copied from, which chapters it can reach, and the keys to set on one chapter so
   it holds what the first holds. The dialog, the counts, the write and the Undo are all driven from that list, so one
   more shared setting is one more entry (a per-chapter Poem Mode switch would be an entry shaped like `dropCap`).

   EVERY CHAPTER is every section the chapter settings show these rows for (src/editor/EditorMeta.tsx, 1.0's
   syncEditor): a body section that is not a Part. A prologue, an epilogue or an interlude is one; a chapter left out
   of the export is one (it is still a chapter of the book); front and back matter and Part dividers never are.

   WHAT IS COMPARED is what the chapter settings SHOW, as 1.0 reads a section (normalizeSection, plateFitOf,
   backdropImage): the drop cap and the lead-in are on unless the section says false; a fit that is not "whole" is
   "fill"; a strength that is none of 1.0's four is "whisper"; a picture id that is not in the book's library is no
   picture. A chapter is changed only when what it shows differs, and then only the keys that differ are set.

   NOT OFFERED, on purpose: the chapter's number, title, subtitle and running head, the plate picture and its alt
   text (each describes one chapter), and scene pictures (each belongs to one break in one chapter's text).

   THE WAY BACK is real in two places and nowhere else (the editor's own undo covers a chapter's text only):
   - a History snapshot of the book as it stood is taken first, in the same Y transaction as the change (auto kind
     "chapterop", as 1.0's chopRun takes before a delete or a merge; it carries no chop record, so History names it
     "Before a chapter change", and it counts among the five such snapshots 1.0 keeps);
   - the record returned here holds, in memory, the exact value every changed key had; `undoEvery` puts those back
     (one Y transaction) and removes the spent snapshot. A chapter where a written key was changed again since is
     left as it is, whole, and counted, and the snapshot is then kept. The record is gone with the page. */

type Rec = Record<string, unknown>;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export type RowId = 'backdrop' | 'dropCap' | 'smallCaps' | 'plateFit';
/** What the rows need to know of the book besides a chapter's own keys. */
export type Ctx = {
  /** 1.0's BACKDROP_STRENGTHS. */
  strengths: readonly string[];
  /** The library's pictures: id to the name a picker shows. */
  pictures: ReadonlyMap<string, string>;
};
/** A value said in words: an interface string, or a writer's own text (a picture's name). */
export type Said = { key: UiKey } | { text: string };

export type RowDef = {
  id: RowId;
  /** The row's name (the chapter settings' own label for it, where that says enough by itself). */
  label: UiKey;
  /** The section keys this row reads and may write; nothing else of a section is ever touched. */
  keys: readonly string[];
  /** Whether the row is offered at all for the chapter the settings are copied from. */
  offered: (src: Rec, x: Ctx) => boolean;
  /** Whether the row can change `target` at all. */
  reaches: (target: Rec, x: Ctx) => boolean;
  /** The keys to set on `target` so that it shows what `src` shows; empty when it already does. */
  patch: (src: Rec, target: Rec, x: Ctx) => Rec;
  /** What `src` holds, in words. */
  said: (src: Rec, x: Ctx) => Said[];
  /** The count line's words, for a row that does not reach every chapter: how many of those it reaches would change
   *  ({n} of {total}), that all of them already hold the value, and that there is none to reach. A row without
   *  these says everych.count / everych.same. */
  counted?: { count: UiKey; same: UiKey; none: UiKey };
  /** One more line under the count, when the row's own changes call for it (a string with one {n}); else null. */
  note?: (changes: readonly Change[], x: Ctx) => { key: UiKey; n: number } | null;
};

/** One key of a stored section, as stored. */
const raw = (m: Y.Map<unknown>, k: string): unknown => {
  const v = m.get(escKey(k));
  return v instanceof Y.AbstractType ? v.toJSON() : v;
};
const pictureIn = (v: unknown, x: Ctx): string | null => (typeof v === 'string' && v && x.pictures.has(v) ? v : null);
const strengthOf = (v: unknown, x: Ctx): string => (typeof v === 'string' && x.strengths.includes(v) ? v : 'whisper');
const fitOf = (v: unknown): 'fill' | 'whole' => (v === 'whole' ? 'whole' : 'fill');
const STRENGTH_KEYS: Record<string, UiKey> = { whisper: 'editor.bdWhisper', soft: 'editor.bdSoft', strong: 'editor.bdStrong', spread: 'editor.bdSpread' };

/** An on/off switch of a chapter that reads as on unless the section says false. */
const switchRow = (id: RowId, key: string, label: UiKey): RowDef => ({
  id,
  label,
  keys: [key],
  offered: () => true,
  reaches: () => true,
  patch: (src, target) => ((src[key] !== false) === (target[key] !== false) ? {} : { [key]: src[key] !== false }),
  said: (src) => [{ key: src[key] !== false ? 'everych.on' : 'everych.off' }],
});

export const ROWS: readonly RowDef[] = [
  {
    /* The picture and its strength go together: a strength without its picture means nothing. With no backdrop on
       the first chapter the others lose theirs and keep the strength they stored (it shows again with the next
       picture chosen there, as it does after "No backdrop" in the chapter's own settings). */
    id: 'backdrop',
    label: 'editor.backdrop',
    keys: ['backdropId', 'backdropStrength'],
    offered: () => true,
    reaches: () => true,
    patch: (src, target, x) => {
      const want = pictureIn(src.backdropId, x);
      const p: Rec = {};
      if (pictureIn(target.backdropId, x) !== want) p.backdropId = want;
      if (want && strengthOf(target.backdropStrength, x) !== strengthOf(src.backdropStrength, x)) p.backdropStrength = strengthOf(src.backdropStrength, x);
      return p;
    },
    said: (src, x) => {
      const id = pictureIn(src.backdropId, x);
      if (!id) return [{ key: 'editor.backdropNone' }];
      return [{ text: x.pictures.get(id) || id }, { key: STRENGTH_KEYS[strengthOf(src.backdropStrength, x)] ?? 'editor.bdWhisper' }];
    },
    /* A plate faces its chapter's opening page in print (1.0's isPairedSpread), so a chapter that has a plate and
       gets a picture it did not show before will show the two side by side: said, with the exact number. */
    note: (changes, x) => {
      const n = changes.filter((ch) => ch.key === 'backdropId' && ch.after !== null && pictureIn(raw(ch.map, 'plateId'), x) !== null).length;
      return n ? { key: 'everych.platePair', n } : null;
    },
  },
  switchRow('dropCap', 'dropCap', 'editor.dropCap'),
  switchRow('smallCaps', 'smallCaps', 'editor.smallCaps'),
  {
    /* The fit of a plate, onto chapters that have a plate only: a chapter without one has nothing to fit. */
    id: 'plateFit',
    label: 'everych.plateFit', // "Plate fit": the settings' own label is "Fit", which says enough only under the plate row
    keys: ['plateId', 'plateFit'],
    offered: (src, x) => pictureIn(src.plateId, x) !== null,
    reaches: (target, x) => pictureIn(target.plateId, x) !== null,
    patch: (src, target) => (fitOf(src.plateFit) === fitOf(target.plateFit) ? {} : { plateFit: fitOf(src.plateFit) }),
    said: (src) => [{ key: fitOf(src.plateFit) === 'whole' ? 'editor.plateFitWhole' : 'editor.plateFitFill' }],
    counted: { count: 'everych.plateCount', same: 'everych.plateSame', none: 'everych.plateNone' },
  },
];

/* ---- reading ---- */

/** What the rows need of the book: 1.0's strengths (from the closure), and the library's pictures by id. */
export function ctxOf(c: Closure, ydoc: Y.Doc): Ctx {
  const pictures = new Map<string, string>();
  for (const im of storedImages(ydoc)) if (im && typeof im.id === 'string' && im.id) pictures.set(im.id, String(im.name || im.id));
  return { strengths: c.api.BACKDROP_STRENGTHS, pictures };
}

/** The count line a row shows: the key and its numbers. */
export function countWords(row: RowDef, p: { reach: number; changes: number }): { key: UiKey; n?: number; total?: number } {
  const w = row.counted;
  if (w && p.reach === 0) return { key: w.none };
  if (p.changes === 0) return { key: w ? w.same : 'everych.same' };
  return { key: w ? w.count : 'everych.count', n: p.changes, total: p.reach };
}
/** Whether a stored section is a chapter in this feature's sense (see EVERY CHAPTER above). */
export const isChapter = (m: Y.Map<unknown>): boolean => (raw(m, 'kind') || 'body') === 'body' && (raw(m, 'type') || 'chapter') !== 'part';
/** Every chapter of the book, in the book's order (their Y maps: no chapter's text is read). */
export function chaptersOf(ydoc: Y.Doc): Y.Map<unknown>[] {
  return sectionList(ydoc).filter((m): m is Y.Map<unknown> => m instanceof Y.Map && isChapter(m));
}
const ALL_KEYS = [...new Set(ROWS.flatMap((r) => r.keys))];
/** The keys the rows name, as one chapter stores them. */
const read = (m: Y.Map<unknown>): Rec => Object.fromEntries(ALL_KEYS.map((k) => [k, raw(m, k)]));

export type RowPlan = {
  id: RowId;
  /** The first chapter's value, in words. */
  said: Said[];
  /** How many other chapters this row can reach at all (every other chapter; for the fit, those with a plate). */
  reach: number;
  /** How many of them would change. */
  changes: number;
  /** The row's own extra line (RowDef.note), when it has one to say. */
  note: { key: UiKey; n: number } | null;
};
export type Plan = {
  /** How many chapters the book has besides this one. */
  others: number;
  /** The rows offered for this chapter, in ROWS' order. */
  rows: RowPlan[];
};

/** One key of one chapter, as a write changes it. The chapter is held by its own Y map, not by an id: a book whose
 *  sections share an id, or lack one, is written and undone correctly all the same. */
export type Change = { map: Y.Map<unknown>; row: RowId; key: string; had: boolean; before: unknown; after: unknown };

function changesFor(ydoc: Y.Doc, sourceId: string, x: Ctx, rows: readonly RowDef[]): { src: Rec; others: Y.Map<unknown>[]; changes: Change[] } | null {
  const all = chaptersOf(ydoc);
  const srcMap = all.find((m) => m.get('id') === sourceId);
  if (!srcMap) return null;
  const src = read(srcMap);
  const others = all.filter((m) => m !== srcMap);
  const changes: Change[] = [];
  for (const map of others) {
    const target = read(map);
    for (const r of rows) {
      if (!r.offered(src, x) || !r.reaches(target, x)) continue;
      for (const [key, after] of Object.entries(r.patch(src, target, x))) {
        changes.push({ map, row: r.id, key, had: map.has(escKey(key)), before: structuredClone(raw(map, key)), after });
      }
    }
  }
  return { src, others, changes };
}
const chaptersIn = (changes: readonly Change[], row: RowId): Set<Y.Map<unknown>> => new Set(changes.filter((ch) => ch.row === row).map((ch) => ch.map));

/** What the dialog shows for the chapter `sourceId`: exact, from the book as it stands. Null when that section is not
 *  a chapter of the book. */
export function planFor(ydoc: Y.Doc, sourceId: string, x: Ctx): Plan | null {
  const got = changesFor(ydoc, sourceId, x, ROWS);
  if (!got) return null;
  const { src, others, changes } = got;
  const targets = others.map(read);
  const rows = ROWS.filter((r) => r.offered(src, x)).map((r): RowPlan => {
    const mine = changes.filter((ch) => ch.row === r.id);
    return { id: r.id, said: r.said(src, x), reach: targets.filter((t) => r.reaches(t, x)).length, changes: chaptersIn(changes, r.id).size, note: r.note ? r.note(mine, x) : null };
  });
  return { others: others.length, rows };
}

/* ---- writing ---- */

/** What one use wrote, held in memory for its Undo. */
export type Applied = {
  ydoc: Y.Doc;
  /** Chapters changed, per row picked (a row that changed nothing is 0). */
  counts: Partial<Record<RowId, number>>;
  /** Every key written, with the value it had. */
  changes: Change[];
  /** The History snapshot taken before the write; null when nothing was written. */
  snapId: string | null;
  done: boolean;
};

/** Copy the picked rows from the chapter `sourceId` to every other chapter: a History snapshot first, then only the
 *  keys that differ, all in ONE Y transaction. When nothing differs nothing is written and no snapshot is taken.
 *  Null when the section is not a chapter of the book. */
export function applyToEvery(c: Closure, ydoc: Y.Doc, sourceId: string, picked: readonly RowId[]): Applied | null {
  const x = ctxOf(c, ydoc);
  const rows = ROWS.filter((r) => picked.includes(r.id));
  const got = changesFor(ydoc, sourceId, x, rows);
  if (!got) return null;
  const { changes } = got;
  const counts: Partial<Record<RowId, number>> = {};
  for (const r of rows) counts[r.id] = chaptersIn(changes, r.id).size;
  if (!changes.length) return { ydoc, counts, changes, snapId: null, done: true };
  const L = live(c, ydoc);
  const snap = takeSnapshot(c, L, '', 'chapterop');
  ydoc.transact(() => {
    // History first: packing it is the one step here that can fail, and it fails before anything is written
    writeHistory(c, ydoc, L);
    for (const ch of changes) ch.map.set(escKey(ch.key), structuredClone(ch.after));
  });
  return { ydoc, counts, changes, snapId: snap.id, done: false };
}

export type Undone = {
  /** Chapters given back every setting they had. */
  restored: number;
  /** Chapters where a setting was changed again since (or the chapter is gone): left as they are. */
  skipped: number;
};

/** Put back what `rec` wrote: each key returns to the exact value it had (a key the chapter did not store is removed
 *  again), in one Y transaction. A chapter where a written key no longer holds what was written, or that is no longer
 *  in the book, is left alone whole. When every chapter went back the spent snapshot is removed from History;
 *  otherwise it is kept. Null when there is nothing to undo (already undone, nothing was written, or the book is no
 *  longer this one). */
export function undoEvery(c: Closure, rec: Applied): Undone | null {
  if (rec.done || rec.ydoc.isDestroyed) return null;
  const { ydoc } = rec;
  const inBook = new Set(sectionList(ydoc));
  const touched = new Set(rec.changes.map((ch) => ch.map));
  const left = new Set<Y.Map<unknown>>();
  for (const ch of rec.changes) {
    if (!inBook.has(ch.map) || !ch.map.has(escKey(ch.key)) || !same(raw(ch.map, ch.key), ch.after)) left.add(ch.map);
  }
  const back = rec.changes.filter((ch) => !left.has(ch.map));
  const L = left.size === 0 && rec.snapId ? live(c, ydoc) : null;
  if (L) L.state.history = (L.state.history || []).filter((h) => h.id !== rec.snapId);
  if (back.length || L) {
    ydoc.transact(() => {
      if (L) writeHistory(c, ydoc, L); // first, as in the write: if it fails nothing has been put back
      for (const ch of back) {
        if (ch.had) ch.map.set(escKey(ch.key), structuredClone(ch.before));
        else ch.map.delete(escKey(ch.key));
      }
    });
  }
  rec.done = true;
  return { restored: touched.size - left.size, skipped: left.size };
}
