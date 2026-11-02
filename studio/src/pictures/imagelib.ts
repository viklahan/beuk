import * as Y from 'yjs';
import { BLOB_ORIGIN, exportBook, setMetaValue } from '@book/editor/index.js';
import { pictureEnv, type BookImage, type Closure, type ImageUse, type ImglibRec, type State } from '../closure/index';
import { live, repackHistory, takeSnapshot, type Live } from '../history/history';
import { styleSettle } from '../style/session';
import { writeSections } from '../chapters/chop';
import { sampleLoaded, deskIsUntouchedSample } from '../sample/sample';

/* BEUK:imagelib — the image library (inventory A8): where a picture is used,
   taking it out of the book, the cleanup of unused pictures, and Undo.

   ONE SOURCE. The usage map, the unused list, the sample rule, the removal
   (every role cleared the way 1.0's own controls clear it, the History
   snapshot first, one snapshot serving a run of removals) and its Undo are
   1.0's OWN functions (imglibUsageMap, imglibUnused, imglibIsSample,
   imglibRemove, imglibUndo, imglibSnapshot), run through the browser
   closure on a state holding the book AS BOOK FORMAT (exportBook's book, a
   copy, with History unpacked: the fields these functions read and write
   are book fields, so nothing is reshaped on the way). What they leave in
   that state is then written back into the Y.Doc, only what changed:

   - each top-level value that differs (images, theme, customThemes, cover,
     coverRecipe, bible) through setMetaValue (pictures named in `blobs`);
   - sections through chop.ts writeSections (only changed keys; a changed
     text through y-prosemirror's diffing update, so an open chapter editor
     stays bound to its fragment);
   - all of it, and History repacked against the changed library
     (repackHistory, constraint 14), in ONE transaction.

   Around 1.0's code (scripts/extract-closure.mjs BROWSER_SUPPLIED):
   autoSnapshot is History's own (history.ts takeSnapshot on the same read
   of the book, written in the same transaction; nothing on an empty desk or
   the untouched sample, as 1.0's autoSnapshot), local.editSeq counts the
   book's changes other than this library's own and the picture store's
   housekeeping (1.0: noteBookEdited's counter), and 1.0's redraws
   (imglibRefresh, noteBookEdited) are React's re-render from the Y.Doc. */

type Rec = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The origin of the library's own writes (not counted as the writer's edits). */
export const IMGLIB_ORIGIN = 'beuk-imglib';

/* ---- 1.0's local.editSeq: every change to the book but the library's own and the store's housekeeping ---- */
const seqs = new WeakMap<Y.Doc, { n: number }>();
function editSeqOf(ydoc: Y.Doc): { n: number } {
  let s = seqs.get(ydoc);
  if (!s) {
    const rec = { n: 0 };
    s = rec;
    seqs.set(ydoc, s);
    ydoc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin !== IMGLIB_ORIGIN && tr.origin !== BLOB_ORIGIN && tr.changed.size) rec.n++;
    });
  }
  return s;
}
/** Start counting the book's edits (call when the library is first shown, so a run's "nothing changed since" holds). */
export const watchEdits = (ydoc: Y.Doc): void => void editSeqOf(ydoc);

/** 1.0's state for the library: the book as book format, History unpacked (a copy; the Y.Doc is never touched). */
function libraryState(book: Rec, history: unknown): State {
  const st = clone(book) as State;
  st.history = history as State['history'];
  return st;
}

/** Write what 1.0's code changed in `after` (against `before`, both book format) into the Y.Doc. In a transaction. */
function writeBack(ydoc: Y.Doc, before: Rec, after: Rec): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'sections' || k === 'history' || k === 'historyPool') continue;
    if (!same(before[k], after[k])) setMetaValue(ydoc, k, after[k]);
  }
  writeSections(ydoc, after.sections as Rec[], before.sections as Rec[]);
}

/** What the library shows: the pictures, where each is used, which are unused, which are the sample's. */
export type LibraryView = { images: BookImage[]; usage: Record<string, ImageUse[]>; unused: BookImage[]; sample: Set<string> };

/** 1.0's view of the library for the open book (imglibUsageMap, imglibUnused, imglibIsSample). Reads only. */
export function libraryView(c: Closure, ydoc: Y.Doc): LibraryView {
  const st = libraryState(exportBook(ydoc), []);
  c.setState(st);
  c.api.sampleState.loaded = sampleLoaded(ydoc);
  const images = ((st.images as BookImage[] | undefined) ?? []).slice();
  return {
    images,
    usage: c.api.imglibUsageMap(),
    unused: c.api.imglibUnused(),
    sample: new Set(images.filter((im) => c.api.imglibIsSample(im)).map((im) => im.id)),
  };
}

/** A removal's record: 1.0's own, with the book it belongs to. */
export type Removal = ImglibRec & { ydoc: Y.Doc };

/** 1.0's imglibRemove on the open book: History first ("Before removing a picture", shared by a run), every use
 *  cleared, the pictures out of the library; one transaction. Null when nothing was removed (an unknown or sample id). */
export function removePictures(c: Closure, ydoc: Y.Doc, ids: string[]): Removal | null {
  styleSettle(); // a Style edit held in its pause is written first: this write reads the book after it (wave 4a review)
  const seq = editSeqOf(ydoc);
  const L: Live = live(c, ydoc);
  const st = libraryState(L.book, L.state.history);
  const before = clone(L.book);
  const untouched = deskIsUntouchedSample(c, ydoc);
  pictureEnv.editSeq = () => seq.n;
  pictureEnv.autoSnapshot = () => {
    // 1.0's autoSnapshot: nothing on an empty desk or the untouched sample; else takeSnapshot on this very read
    c.setState(L.state);
    const skip = c.api.isEmptyDesk() || untouched;
    const snap = skip ? null : takeSnapshot(c, L, '', 'imgremove');
    st.history = L.state.history;
    c.setState(st);
    return snap;
  };
  let rec: ImglibRec | null;
  try {
    c.setState(st);
    c.api.sampleState.loaded = sampleLoaded(ydoc);
    rec = c.api.imglibRemove(ids);
  } finally {
    pictureEnv.autoSnapshot = () => null;
  }
  if (!rec) return null;
  ydoc.transact(() => repackHistory(c, ydoc, () => writeBack(ydoc, before, st as Rec), L.state.history), IMGLIB_ORIGIN);
  return Object.assign(rec, { ydoc });
}

/** 1.0's imglibUndo on the open book: the pictures back where they stood and every use whose place still stands empty;
 *  one transaction. False when the record is spent or belongs to another book (or another generation of it). */
export function undoRemoval(c: Closure, ydoc: Y.Doc, rec: Removal, isLive: (y: Y.Doc) => boolean): boolean {
  styleSettle();
  if (rec.undone || rec.ydoc !== ydoc || !isLive(ydoc)) return false;
  const L = live(c, ydoc);
  const st = libraryState(L.book, L.state.history);
  const before = clone(L.book);
  c.setState(st);
  if (!c.api.imglibUndo(rec)) return false;
  ydoc.transact(() => repackHistory(c, ydoc, () => writeBack(ydoc, before, st as Rec), L.state.history), IMGLIB_ORIGIN);
  return true;
}
