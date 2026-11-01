import * as Y from 'yjs';
import { insertSections, SECTIONS } from '@book/editor/index.js';
import { TOP_LEVEL_KEYS } from '@book/schema.js';
import { bookState, stateFromBook, type Closure, type HistoryEntry, type SnapDoc, type State } from '../closure/index';
import { setMetaMany } from '../book/hooks';

/* Version history (1.0: "Version history & snapshots", client/index.html
   BEUK:chapterops / BEUK:goalshist / BEUK:bugs), ported onto the Y.Doc.

   WHERE IT LIVES — exactly where 1.0 keeps it: the book's own `history`
   and `historyPool` keys (book format v1 carries both: src/book/schema.ts
   HistoryEntry / HistoryPool; readBook defaults them). 2.0 holds every
   top-level key in the Y `meta` map, so History is two `meta` values,
   stored in 1.0's SAVED form: every snapshot packed (`chopDoc`, pictures,
   fonts, cover and research files named by {ref} or written once in
   historyPool) — the form 1.0's serializeBook writes and its
   applyBookDoc → normalizeHistory reads back.

   ONE SOURCE. The packing, unpacking, pruning, section diff, word diff and
   word counts are 1.0's own functions, run through the browser closure
   (histPack, normalizeHistory, pruneAutoSnapshots, histSectionDiff,
   histTextDiff, histWordDiff, snapshotSectionWords, bookWordTotal,
   isEmptyDesk, deskTrulyEmpty), against 1.0's `state` built from the open
   book. What is ported here is the glue 1.0 runs around them: takeSnapshot,
   restoreSnapshot / restoreSnapshotSection, deleteSnapshot, and
   localApplyBackup's snapshot. Each write is one Yjs transaction.

   Differences, each a consequence of the Y.Doc (see the wave report):
   - a snapshot's `doc` is the book as exportBook writes it (1.0:
     serializeBook), less history, historyPool, importReport (as 1.0) and
     formatVersion (a 2.0 key serializeBook never writes);
   - a whole-book restore returns a new book document; the studio opens it
     as a NEW generation, exactly like opening a backup (store.ts
     importToDevice), instead of 1.0's applyBookDoc on the same desk;
   - the History list is unpacked against the book on every read, never
     held: so a later picture change can never leave a stored {ref} pointing
     at the wrong picture, as long as the code that changes pictures, fonts,
   the cover or research files repacks History (`repackHistory`) in the
     same transaction (wave 2+: see the report). */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The open book as 1.0's state, with History unpacked (1.0's applyBookDoc: normalizeHistory(doc.history, doc.historyPool)). */
export type Live = { book: Rec; state: State & { history: HistoryEntry[] } };

/** Book history entries as normalizeHistory should see them: an entry without an id gets one from its place in the
 *  stored list ("hist-<n>"), so the same entry has the same id on every read (1.0 mints a random uid() on each load,
 *  which 2.0 cannot keep between reads without writing). Nothing is written: the id reaches the book only with the
 *  next History write, as 1.0's minted id reaches it with its next save. */
export function withStableIds(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  const used = new Set(list.flatMap((e) => (isRec(e) && typeof e.id === 'string' && e.id ? [e.id] : [])));
  return list.map((e, i) => {
    if (!isRec(e) || (typeof e.id === 'string' && e.id)) return e;
    let id = 'hist-' + i;
    while (used.has(id)) id += '-';
    used.add(id);
    return { ...e, id };
  });
}

export function live(c: Closure, ydoc: Y.Doc): Live {
  const { book, state } = bookState(c, ydoc);
  c.setState(state);
  state.history = c.api.normalizeHistory(withStableIds(book.history), book.historyPool);
  return { book, state: state as Live['state'] };
}

/** 1.0's chopSnapDoc, over the exported book: the book less its History and import report; pictures, fonts, cover and
 *  research files kept as the book holds them (1.0 shares them in memory; histPack names them when saving). */
export function snapshotDoc(book: Rec): SnapDoc {
  const d = clone(book);
  delete d.history;
  delete d.historyPool;
  delete d.importReport;
  delete d.formatVersion;
  const imgs = (d.images as unknown[]) || [], fonts = (d.fonts as unknown[]) || [], cover = d.cover;
  const rsf = isRec(d.research) ? (d.research.files as unknown[] | undefined) : null;
  d.images = [];
  d.fonts = [];
  d.cover = null;
  delete d.research;
  const c = clone(d);
  c.images = clone(imgs);
  c.fonts = clone(fonts);
  c.cover = cover ? clone(cover) : null;
  if (rsf) c.research = { files: clone(rsf) };
  return c as SnapDoc;
}

/** 1.0's takeSnapshot: newest first, then pruneAutoSnapshots (ten automatic, five chapter-op; named never pruned). */
export function takeSnapshot(c: Closure, L: Live, name: string, autoKind: string | null): HistoryEntry {
  c.setState(L.state);
  const snap: HistoryEntry = {
    id: c.api.uid(),
    name: String(name || '').trim(),
    auto: autoKind || null,
    at: new Date().toISOString(),
    words: c.api.bookWordTotal(),
    doc: snapshotDoc(L.book),
  };
  L.state.history = [snap].concat(L.state.history || []);
  c.api.pruneAutoSnapshots();
  return snap;
}

/** History in 1.0's saved form against `state`'s pictures, fonts, cover and research (histPack). */
function packed(c: Closure, state: State, history: HistoryEntry[]): { history: unknown[]; historyPool: unknown } {
  c.setState(state);
  const p = c.api.histPack(history);
  return { history: p.history, historyPool: p.pool };
}

/** Write L's History into the book (one transaction). */
export function writeHistory(c: Closure, ydoc: Y.Doc, L: Live): void {
  const p = packed(c, L.state, L.state.history);
  setMetaMany(ydoc, { history: p.history as never, historyPool: p.historyPool as never });
}

/** Unpack History against the book as it stands, let `change` alter the book (inside the same transaction), then pack
 *  it again against the changed book. For any future code that changes pictures, fonts, the cover or research files. */
export function repackHistory(c: Closure, ydoc: Y.Doc, change: () => void): void {
  const before = live(c, ydoc);
  ydoc.transact(() => {
    change();
    const { state } = bookState(c, ydoc);
    const p = packed(c, state, before.state.history);
    setMetaMany(ydoc, { history: p.history as never, historyPool: p.historyPool as never });
  });
}

/** "Save a snapshot" (1.0 saveSnapshotNamed). */
export function saveNamed(c: Closure, ydoc: Y.Doc, name: string): HistoryEntry {
  const L = live(c, ydoc);
  const snap = takeSnapshot(c, L, name, null);
  writeHistory(c, ydoc, L);
  return snap;
}

/** 1.0 autoSnapshot: nothing on an empty desk, nothing on the untouched sample (`untouchedSample`: the caller's
 *  sample/sample.ts deskIsUntouchedSample, read before). */
export function autoSnapshot(c: Closure, ydoc: Y.Doc, kind: string, untouchedSample = false): HistoryEntry | null {
  const L = live(c, ydoc);
  if (c.api.isEmptyDesk() || untouchedSample) return null;
  const snap = takeSnapshot(c, L, '', kind);
  writeHistory(c, ydoc, L);
  return snap;
}

/** 1.0 deleteSnapshot. */
export function deleteSnapshot(c: Closure, ydoc: Y.Doc, id: string): boolean {
  const L = live(c, ydoc);
  const before = L.state.history.length;
  L.state.history = L.state.history.filter((s) => s.id !== id);
  if (L.state.history.length === before) return false;
  writeHistory(c, ydoc, L);
  return true;
}

/** The key order of a book rebuilt from a snapshot: the snapshot's own order (the book's order when it was taken), with
 *  the keys a snapshot leaves out (history, historyPool, importReport) and the one it moves to its end (research) put
 *  back where serializeBook writes them (TOP_LEVEL_KEYS): right after the key written closest before them. */
function restoredOrder(doc: Rec): Rec {
  const order = Object.keys(doc).filter((k) => k !== 'research');
  const canon = TOP_LEVEL_KEYS as readonly string[];
  for (const k of ['research', 'history', 'historyPool', 'importReport']) {
    if (!Object.hasOwn(doc, k)) continue;
    const ci = canon.indexOf(k);
    // after the key serializeBook writes closest before it (wherever the book holds that key), else first
    let at = 0, best = -1;
    for (let i = 0; i < order.length; i++) {
      const p = canon.indexOf(order[i]!);
      if (p !== -1 && p < ci && p > best) {
        best = p;
        at = i + 1;
      }
    }
    order.splice(at, 0, k);
  }
  const out: Rec = {};
  for (const k of order) out[k] = doc[k];
  return out;
}

/** 1.0 restoreSnapshot, as a new book document: a "Before restore" snapshot first (except over a truly empty desk), then
 *  the snapshot's book with the CURRENT History (1.0: applyBookDoc(doc, { keepHistory: true })), packed against the
 *  restored book's own pictures. The caller opens it as a new generation. Null when there is no such snapshot. */
export function restoreDoc(c: Closure, ydoc: Y.Doc, id: string): Rec | null {
  const L = live(c, ydoc);
  const snap = L.state.history.find((s) => s.id === id);
  if (!snap) return null;
  if (!c.api.deskTrulyEmpty()) takeSnapshot(c, L, '', 'restore');
  const doc = clone(snap.doc) as Rec;
  delete doc.history;
  delete doc.historyPool; // restoring a book never restores its history list
  // BEUK:sidebar — the pre-rename sample chosen back becomes a book of the writer's own (fresh id, no sample ids)
  if (snap.auto === 'sampleupdate' && isRec(doc.meta)) {
    const m: Rec = { ...doc.meta, bookId: c.api.newBookId() };
    delete m.legacyBookIds;
    doc.meta = m;
  }
  const state = stateFromBook(c, doc);
  const p = packed(c, state, L.state.history);
  return restoredOrder({ ...doc, importReport: null, history: p.history, historyPool: p.historyPool });
}

/** 1.0 restoreSnapshotSection: a "Before restore" snapshot (autoSnapshot), then the section, normalised by 1.0's
 *  normalizeSection, replaces its namesake or returns at its snapshot place. One transaction. Returns its index. */
export function restoreSection(c: Closure, ydoc: Y.Doc, snapId: string, secId: string, untouchedSample = false): number | null {
  const L = live(c, ydoc);
  const snap = L.state.history.find((s) => s.id === snapId);
  if (!snap) return null;
  const sIdx = snap.doc.sections.findIndex((s) => s.id === secId);
  if (sIdx < 0) return null;
  if (!c.api.isEmptyDesk() && !untouchedSample) takeSnapshot(c, L, '', 'restore'); // 1.0's autoSnapshot("restore")
  const restored = c.api.normalizeSection(clone(snap.doc.sections[sIdx]));
  const now = L.state.sections;
  const cur = now.findIndex((s) => s.id === secId);
  let at = cur;
  if (cur < 0) {
    /* Gone from the book: it returns at its snapshot place — after the nearest snapshot neighbour still standing
       before it, else before the nearest one after it. */
    at = -1;
    for (let i = sIdx - 1; i >= 0; i--) {
      const p = now.findIndex((s) => s.id === snap.doc.sections[i]!.id);
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    if (at < 0)
      for (let i = sIdx + 1; i < snap.doc.sections.length; i++) {
        const p = now.findIndex((s) => s.id === snap.doc.sections[i]!.id);
        if (p >= 0) {
          at = p;
          break;
        }
      }
    if (at < 0) at = Math.min(sIdx, now.length);
  }
  const p = packed(c, L.state, L.state.history);
  const arr = ydoc.getArray<unknown>(SECTIONS);
  ydoc.transact(() => {
    setMetaMany(ydoc, { history: p.history as never, historyPool: p.historyPool as never });
    if (cur >= 0) arr.delete(cur, 1);
    insertSections(arr, at, [restored]);
  });
  return at;
}

/** 1.0 localApplyBackup's History: a "Before opening a backup" snapshot of the open book (autoSnapshot), then the
 *  arriving book's own History (1.0 applyBookDoc: a book carrying a History list brings it; one carrying none keeps the
 *  desk's only when it is the same book), the snapshot first, pruned, packed against the arriving book. `raw` is the
 *  backup's book as the file holds it (1.0 decides "carries a History" on it); `read` is that book after readBook. The
 *  open book is not written. Returns the book to open. */
export function backupArrival(c: Closure, ydoc: Y.Doc | null, raw: Rec, read: Rec, untouchedSample = false): Rec {
  let snap: HistoryEntry | null = null;
  let deskHistory: HistoryEntry[] = [];
  let deskBookId: unknown = null;
  if (ydoc) {
    const L = live(c, ydoc);
    deskBookId = isRec(L.state.meta) ? L.state.meta.bookId : null;
    deskHistory = L.state.history;
    if (!c.api.isEmptyDesk() && !untouchedSample) { // 1.0's autoSnapshot("backup")
      snap = takeSnapshot(c, L, '', 'backup');
      deskHistory = L.state.history;
    }
  }
  const arrMeta = isRec(raw.meta) ? raw.meta : {};
  const sameBook = !!arrMeta.bookId && arrMeta.bookId === deskBookId;
  const carries = Array.isArray(raw.history);
  /* Nothing to add: the arriving book keeps its History exactly as stored (2.0's no-edit rule; 1.0 would re-save it in
     its own form, which reads back the same). Only a same-book backup without a History list takes the desk's. */
  if (!snap && (carries || !sameBook || !deskHistory.length)) return read;
  const state = stateFromBook(c, read) as Live['state'];
  c.setState(state);
  let history: HistoryEntry[] = carries ? c.api.normalizeHistory(withStableIds(read.history), read.historyPool) : sameBook ? deskHistory : [];
  if (snap) {
    state.history = [snap].concat(history.filter((s) => s.id !== snap!.id));
    c.api.pruneAutoSnapshots();
    history = state.history;
  }
  const p = packed(c, state, history);
  return { ...read, history: p.history, historyPool: p.historyPool };
}

/** The live book's sections and meta, for the section diff (1.0 histLiveDoc). */
export const liveDoc = (L: Live) => ({ meta: L.state.meta, sections: L.state.sections });
