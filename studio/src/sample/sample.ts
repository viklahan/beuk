import * as Y from 'yjs';
import { exportBook, importBook, META, setMetaValue } from '@book/editor/index.js';
import { TOP_LEVEL_KEYS } from '@book/schema.js';
import { bookState, stateFromBook, type Closure, type HistoryEntry, type State } from '../closure/index';
import { live, repackHistory, snapshotDoc, takeSnapshot, writeHistory, type Live } from '../history/history';
import { writeSections } from '../chapters/chop';

/* The sample book and New book (inventory I8; client/index.html
   BEUK:slim / BEUK:compare / BEUK:remnants / BEUK:newbook:
   applySampleBookSync, clearDeskToEmpty, startNewBookNow,
   sampleComparableJson, deskIsUntouchedSample, sampleDraftSnapshot,
   samplePicsFetch / samplePicsFill).

   ONE SOURCE. The sample is 1.0's own: buildSampleBook (and its
   SAMPLE_SECTIONS, image list, cover, Covenant, notebook, research, cover
   recipe) is lifted from client/index.html at build time into the browser
   closure, never copied. Its pictures are 1.0's static files under
   /assets/sample/, fetched and checked against 1.0's listed byte length and
   SHA-256 (SAMPLE_IMAGE_FILES, SAMPLE_COVER_FILE), never inlined. The empty
   book is 1.0's buildEmptyBook.

   Every function here BUILDS a book document; the studio opens it through
   the replace path (confirm → snapshot → a new generation, with the live
   check), exactly like opening a backup.

   Where 1.0 keeps "the sample is loaded" (sampleState: loaded and the
   loaded fingerprint, saved beside its local book record), 2.0 keeps the
   record INSIDE the book's own Y.Doc, in a map exportBook never reads
   (SAMPLE_MAP): it is stored in the book's own generation (y-indexeddb), so
   it lives and dies with the book — never in localStorage, where it could be
   lost while the book stays (fix round 1). A new generation (a backup, a
   restore) starts without it, as 1.0's localApplyBackup clears the flag.
   Fail safe: a record whose fingerprint is missing or unreadable reads as
   an EDITED sample, so Remove asks first. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The Y map (beside meta / sections / layout) holding this device's notes about the book; exportBook never writes it. */
export const SAMPLE_MAP = 'next.device';
/** Where 1.0's sample pictures are served (1.0: assets/sample/ beside /studio). */
export const SAMPLE_PIC_DIR = '/assets/sample/';

/* ---- the "sample is loaded" record ---- */

/** The record: absent = not the sample; present = loaded, with the fingerprint's hash (null: unknown → edited). */
export function sampleRecord(ydoc: Y.Doc | null): { sig: string | null } | null {
  if (!ydoc) return null;
  const v = ydoc.getMap<unknown>(SAMPLE_MAP).get('sample');
  if (v === undefined) return null;
  return { sig: isRec(v) && typeof v.sig === 'string' && v.sig ? v.sig : null };
}
/** Mark the book as the loaded sample. `sig` null (the fingerprint could not be taken) reads as edited. */
export function setSampleRecord(ydoc: Y.Doc, sig: string | null): void {
  ydoc.getMap<unknown>(SAMPLE_MAP).set('sample', { sig });
}

/** A 106-bit string hash (two 53-bit lanes): the fingerprint is compared, never stored whole. */
export function hashText(s: string): string {
  const lane = (seed: number): number => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  };
  return lane(1).toString(36) + '.' + lane(2).toString(36) + '.' + s.length.toString(36);
}

/* ---- 1.0's fingerprint ---- */

/** 1.0's samplePicsStrip: a sample picture's data reads "~sample" whether or not it has arrived (empty, or exactly its
 *  listed size), so the fingerprint never depends on the pictures. */
export function samplePicsStrip(c: Closure, d: Rec): Rec {
  const byId = new Map(c.api.SAMPLE_IMAGE_FILES.map((m) => [m.id, m]));
  const b64Len = (bytes: number) => 4 * Math.ceil(bytes / 3);
  for (const im of Array.isArray(d.images) ? d.images : []) {
    const m = isRec(im) ? byId.get(String(im.id)) : undefined;
    if (m && isRec(im) && typeof im.data === 'string' && (im.data === '' || im.data.length === b64Len(m.bytes))) im.data = '~sample';
  }
  const cf = c.api.SAMPLE_COVER_FILE;
  const cov = d.cover;
  if (isRec(cov) && cov.name === cf.name && cov.mediaType === cf.mediaType && typeof cov.data === 'string' && (cov.data === '' || cov.data.length === b64Len(cf.bytes))) cov.data = '~sample';
  return d;
}

/** 1.0's sampleComparableJson, over a book document: less activeId, History and formatVersion, pictures stripped. */
export function sampleComparable(c: Closure, book: Rec): string {
  const d = clone(book);
  delete d.activeId;
  delete d.history;
  delete d.historyPool;
  delete d.formatVersion;
  return c.api.stableJson(samplePicsStrip(c, d));
}
export const sampleSigOf = (c: Closure, ydoc: Y.Doc): string => hashText(sampleComparable(c, exportBook(ydoc)));

/** 1.0's sampleState.loaded for the open book. */
export const sampleLoaded = (ydoc: Y.Doc | null): boolean => !!sampleRecord(ydoc);
/** 1.0's deskIsUntouchedSample: loaded, and the fingerprint known and unchanged (anything else reads as edited). */
export function deskIsUntouchedSample(c: Closure, ydoc: Y.Doc | null): boolean {
  const r = sampleRecord(ydoc);
  if (!r || !r.sig) return false;
  try {
    return sampleSigOf(c, ydoc!) === r.sig;
  } catch {
    return false;
  }
}
/** 1.0's isEmptyDesk for the open book (no book open: an empty desk). */
export function deskEmpty(c: Closure, ydoc: Y.Doc | null): boolean {
  if (!ydoc) return true;
  c.setState(bookState(c, ydoc).state);
  return c.api.isEmptyDesk();
}

/* ---- building the books ---- */

/** The book's keys in serializeBook's order (TOP_LEVEL_KEYS), any others after: how 1.0 writes the book it holds. */
function canonicalOrder(doc: Rec): Rec {
  const canon = TOP_LEVEL_KEYS as readonly string[];
  const keys = Object.keys(doc).sort((a, b) => {
    const ia = canon.indexOf(a), ib = canon.indexOf(b);
    return (ia < 0 ? canon.length : ia) - (ib < 0 ? canon.length : ib);
  });
  const out: Rec = {};
  for (const k of keys) out[k] = doc[k];
  return out;
}

/** A book document as 2.0 holds it once opened (readBook's reading, exported): what the History of the arriving book is
 *  packed against and what a snapshot of it holds. */
function asOpened(doc: Rec): Rec {
  const y = new Y.Doc();
  importBook(doc, y);
  const out = exportBook(y);
  y.destroy();
  return out;
}

/** History `list` packed against `book` (1.0 histPack, with `book` as the desk), set on it. */
function withHistory(c: Closure, book: Rec, list: HistoryEntry[]): Rec {
  const state = stateFromBook(c, book);
  c.setState(state);
  const p = c.api.histPack(list);
  return { ...book, history: p.history, historyPool: p.pool };
}

/** 1.0's sampleDraftSnapshot: Chapter One as an earlier draft, from the sample as it arrived; null when the sample no
 *  longer has a paragraph an edit names. */
export function sampleDraftSnapshot(c: Closure, sampleBook: Rec): HistoryEntry | null {
  const doc = snapshotDoc(sampleBook);
  const sec = doc.sections.find((s) => s.title === 'The Ferry Crossing');
  if (!sec) return null;
  const paras = String(sec.content || '').split('\n\n');
  for (const e of c.api.SAMPLE_DRAFT_EDITS) {
    const i = paras.findIndex((p) => p.startsWith((e.starts || e.after)!));
    if (i < 0) return null;
    if (e.starts) paras[i] = e.then;
    else paras.splice(i + 1, 0, e.then);
  }
  sec.content = paras.join('\n\n');
  c.setState(stateFromBook(c, sampleBook));
  return {
    id: c.api.SAMPLE_DRAFT_SNAP_ID, name: 'Chapter One, an earlier draft', auto: null, at: new Date().toISOString(),
    words: doc.sections.reduce((n, s) => n + c.api.histCounted(doc, s, false).w, 0), doc,
  };
}

/** 1.0's buildSampleBook, run against the desk it would run against: 1.0's normalizeCoverRecipe fills the recipe's
 *  missing defaults from the desk's theme (state.theme), so the open book's state is set first — or, with no book open,
 *  1.0's empty desk (buildEmptyBook), the state 1.0 starts with. */
export function buildSample(c: Closure, ydoc: Y.Doc | null): Rec & { sections: Rec[]; meta: Rec } {
  if (!c.sample) throw new Error('the sample chunk is not loaded (closure/index.ts loadSample)');
  if (ydoc) c.setState(bookState(c, ydoc).state);
  else stateFromBook(c, c.api.buildEmptyBook());
  return c.sample.buildSampleBook();
}

/** 1.0's sampleShippedWords: the bundled sample counted the way the stats count the desk. */
export function sampleShippedWords(c: Closure): number {
  c.setState(stateFromBook(c, buildSample(c, null)));
  return c.api.bookWordTotal();
}

/* ---- the arrival sweep of old sample copies (1.0's BEUK:sidebar sampleSweepPreRename / sampleSweepStaleCover) ---- */

export type Sweep = { kind: 'prerename'; oldTitle: string } | { kind: 'stale'; staleCover: boolean; oldAuthor: boolean };

/** What 1.0's sweep would do to this book, decided by 1.0's own tests on it: a copy of the sample saved before its
 *  rename (sampleIsPreRenameCopy: its old id or its UUIDv5, or the sample's id with the old title), else the sample
 *  under a stale packaged cover (exact length and SHA-1) or its old author, carrying a sample id. FAIL-SAFE: anything
 *  that cannot be read, or that does not positively identify as the sample, is left alone (null). */
export function sweepFor(c: Closure, ydoc: Y.Doc, untitled: string): Sweep | null {
  try {
    const book = exportBook(ydoc);
    const meta = isRec(book.meta) ? book.meta : null;
    if (!meta) return null;
    if (c.api.sampleIsPreRenameCopy(meta)) return { kind: 'prerename', oldTitle: String(meta.title || '').trim() || untitled };
    c.setState({ meta, coverRecipe: book.coverRecipe ?? null, sections: [] } as unknown as State);
    const staleCover = !!c.api.sampleCoverIsStale(book.cover);
    const oldAuthor = !!c.api.sampleHasOldAuthor();
    if (!staleCover && !oldAuthor) return null;
    if (!c.api.bookIdsOf(meta).some((x) => c.api.isSampleBookId(x) || x === c.api.LEGACY_SAMPLE_BOOK_ID)) return null;
    return { kind: 'stale', staleCover, oldAuthor };
  } catch {
    return null;
  }
}

/** 1.0's sampleSweepPreRename, as a book document: the copy goes into History first ("Before sample update"), then the
 *  current sample takes the desk with the desk's History (BEUK:metaleak keepHistory), the snapshot first. Needs the
 *  sample chunk loaded. */
export function preRenameArrival(c: Closure, ydoc: Y.Doc): Rec {
  const L = live(c, ydoc);
  const snap = takeSnapshot(c, L, '', 'sampleupdate');
  const sample = asOpened(canonicalOrder(buildSample(c, ydoc)));
  return withHistory(c, sample, [snap, ...L.state.history.filter((h) => h.id !== snap.id)]);
}

/** 1.0's sampleSweepStaleCover, on the book in place, in ONE transaction: an edited sample (anything but the untouched
 *  sample) is snapshotted first ("Before sample update"); a stale cover becomes the packaged one (sampleCoverDoc, its
 *  picture then filled from /assets/sample/ like every sample picture); the old author becomes the current one
 *  wherever 1.0's sampleRenameAuthor puts it (the author, the cover recipe, the About the Author text, the portrait's
 *  name). History is repacked against the result (the cover and a picture's name change). Returns whether a snapshot
 *  was taken. Needs the sample chunk when the cover is stale. */
export function staleSweep(c: Closure, ydoc: Y.Doc, sw: { staleCover: boolean; oldAuthor: boolean }, untouched: boolean): boolean {
  const L = live(c, ydoc);
  const snapped = !untouched;
  if (snapped) takeSnapshot(c, L, '', 'sampleupdate');
  const book = exportBook(ydoc);
  const prevSections = clone(book.sections) as Rec[];
  const s = { meta: clone(book.meta), coverRecipe: book.coverRecipe ? clone(book.coverRecipe) : null, sections: clone(book.sections) as Rec[], images: clone(book.images ?? []) } as unknown as State;
  if (sw.oldAuthor) {
    c.setState(s);
    c.api.sampleRenameAuthor();
  }
  const cover = sw.staleCover ? c.sample!.sampleCoverDoc() : undefined;
  repackHistory(
    c,
    ydoc,
    () => {
      const m = ydoc.getMap<unknown>('meta');
      const put = (k: string, v: unknown) => {
        if (JSON.stringify(exportBook(ydoc)[k] ?? null) !== JSON.stringify(v ?? null)) setMetaValue(ydoc, k, v);
      };
      void m;
      if (cover) setMetaValue(ydoc, 'cover', cover);
      if (sw.oldAuthor) {
        put('meta', s.meta);
        put('coverRecipe', (s as Rec).coverRecipe);
        put('images', (s as Rec).images);
        writeSections(ydoc, s.sections, prevSections);
      }
    },
    L.state.history,
  );
  return snapped;
}

/** 1.0's applySampleBookSync, as a book document: an automatic "sample" snapshot of the open book (none on an empty desk
 *  or the untouched sample), the sample with the desk's History kept (BEUK:metaleak), and the sample's draft snapshot
 *  first (BEUK:compare). */
export function sampleArrival(c: Closure, ydoc: Y.Doc | null, untouchedSample: boolean): Rec {
  let history: HistoryEntry[] = [];
  if (ydoc) {
    const L = live(c, ydoc);
    if (!c.api.isEmptyDesk() && !untouchedSample) takeSnapshot(c, L, '', 'sample');
    history = L.state.history;
  }
  const sample = asOpened(canonicalOrder(buildSample(c, ydoc)));
  const draft = sampleDraftSnapshot(c, sample);
  const hist = history.filter((s) => s.id !== c.api.SAMPLE_DRAFT_SNAP_ID);
  return withHistory(c, sample, draft ? [draft, ...hist] : hist);
}

/** 1.0's clearDeskToEmpty, as a book document: the empty book, the desk's History kept but not the sample's own draft
 *  snapshot nor any snapshot of the sample itself (BEUK:remnants). No snapshot is taken.
 *  Fix round 1: a "sample" snapshot (auto kind `sample`: the desk as it stood before the sample was loaded over it) is
 *  ALWAYS kept, whatever book id it carries — it may be the writer's only copy of a book that carried the sample's id. */
export function emptyAfterSample(c: Closure, ydoc: Y.Doc): Rec {
  const L = live(c, ydoc);
  const isSample = (s: HistoryEntry): boolean => {
    if (s.auto === 'sample') return false;
    const id = isRec(s.doc?.meta) ? s.doc.meta.bookId : null;
    return !!id && (c.api.isSampleBookId(id) || id === c.api.LEGACY_SAMPLE_BOOK_ID);
  };
  const history = L.state.history.filter((s) => s.id !== c.api.SAMPLE_DRAFT_SNAP_ID && !isSample(s));
  return withHistory(c, asOpened(canonicalOrder(c.api.buildEmptyBook())), history);
}

/** 1.0's startNewBookNow, as a book document: a NAMED snapshot "Before starting a new book" (newbook.snap), then the empty
 *  book with the History kept. */
export function newBookArrival(c: Closure, ydoc: Y.Doc, snapName: string): { doc: Rec; snap: HistoryEntry } {
  const L = live(c, ydoc);
  const snap = takeSnapshot(c, L, snapName, null);
  return { doc: withHistory(c, asOpened(canonicalOrder(c.api.buildEmptyBook())), L.state.history), snap };
}

/* ---- the pictures (BEUK:slim) ---- */

type PicFile = { id?: string; file: string; bytes: number; sha256: string };
const pics = { data: new Map<string, string>(), cover: '', promise: null as Promise<boolean> | null };

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (x) => (x + 256).toString(16).slice(1)).join('');
function b64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
/** One picture: only bytes of the listed length and SHA-256 are accepted (1.0's samplePicFetch). */
async function fetchPic(m: PicFile, fetcher: typeof fetch): Promise<string> {
  const url = SAMPLE_PIC_DIR + m.file;
  const accept = async (res: Response | null): Promise<ArrayBuffer | null> => {
    if (!res || !res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== m.bytes) return null;
    if (globalThis.crypto?.subtle && hex(await crypto.subtle.digest('SHA-256', buf)) !== m.sha256) return null;
    return buf;
  };
  let buf = await accept(await fetcher(url, { credentials: 'same-origin' }).catch(() => null));
  if (!buf) buf = await accept(await fetcher(url, { credentials: 'same-origin', cache: 'reload' }).catch(() => null));
  if (!buf) throw new Error('sample picture ' + m.file + ' did not match its manifest');
  return b64(buf);
}
const picsComplete = (c: Closure): boolean => !!pics.cover && c.api.SAMPLE_IMAGE_FILES.every((m) => pics.data.has(m.id));

/** Fetch every sample picture not yet here (1.0's samplePicsEnsure). True when all are here. */
export function ensureSamplePictures(c: Closure, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<boolean> {
  if (picsComplete(c)) return Promise.resolve(true);
  if (pics.promise) return pics.promise;
  const jobs = c.api.SAMPLE_IMAGE_FILES.filter((m) => !pics.data.has(m.id)).map((m) => fetchPic(m, fetcher).then((d) => void pics.data.set(m.id, d), () => undefined));
  if (!pics.cover) jobs.push(fetchPic(c.api.SAMPLE_COVER_FILE, fetcher).then((d) => void (pics.cover = d), () => undefined));
  pics.promise = Promise.all(jobs).then(() => {
    pics.promise = null;
    return picsComplete(c);
  });
  return pics.promise;
}
/** Tests: forget fetched pictures. */
export function resetSamplePictures(): void {
  pics.data.clear();
  pics.cover = '';
  pics.promise = null;
}

/** Sample pictures in a book document (or a snapshot's doc) still waiting for their data (1.0's samplePicsMissingInState). */
export function samplePicsMissing(c: Closure, d: Rec): number {
  const ids = new Set(c.api.SAMPLE_IMAGE_FILES.map((m) => m.id));
  let n = 0;
  for (const im of Array.isArray(d.images) ? d.images : []) if (isRec(im) && ids.has(String(im.id)) && !im.data) n++;
  const cf = c.api.SAMPLE_COVER_FILE;
  if (isRec(d.cover) && d.cover.name === cf.name && d.cover.mediaType === cf.mediaType && !d.cover.data) n++;
  return n;
}

/** Fill, in `d`, every waiting sample picture that has arrived (1.0's samplePicsFill, one book or snapshot doc). */
function fillDoc(c: Closure, d: Rec): { filled: number; missing: number } {
  let filled = 0, missing = 0;
  const ids = new Set(c.api.SAMPLE_IMAGE_FILES.map((m) => m.id));
  for (const im of Array.isArray(d.images) ? d.images : []) {
    if (!isRec(im) || !ids.has(String(im.id)) || im.data) continue;
    const v = pics.data.get(String(im.id));
    if (v) { im.data = v; filled++; } else missing++;
  }
  const cf = c.api.SAMPLE_COVER_FILE;
  if (isRec(d.cover) && d.cover.name === cf.name && d.cover.mediaType === cf.mediaType && !d.cover.data) {
    if (pics.cover) { d.cover.data = pics.cover; filled++; } else missing++;
  }
  return { filled, missing };
}

/** 1.0's samplePicsArrived on the open book: every waiting sample picture that has arrived is filled in place — in the
 *  book's images and cover, and in its History's snapshots — and History is packed again against the filled book, in ONE
 *  transaction (wave 1a ruling 2: whatever changes pictures repacks History). Nothing is written when nothing waits.
 *  Returns what is still missing. */
export function fillSamplePictures(c: Closure, ydoc: Y.Doc): { filled: number; missing: number } {
  const L: Live = live(c, ydoc);
  const book = clone(L.book);
  const r = fillDoc(c, book);
  let hFilled = 0;
  for (const h of L.state.history) if (h.doc && typeof h.doc === 'object') hFilled += fillDoc(c, h.doc as Rec).filled;
  if (!r.filled && !hFilled) return r;
  fillDoc(c, L.state as unknown as Rec); // the state History is packed against holds the same pictures
  const meta = ydoc.getMap<unknown>(META);
  ydoc.transact(() => {
    if (r.filled) {
      // the pictures go into the book's picture store once, named in images / cover (model.ts BLOBS)
      if (Array.isArray(book.images)) setMetaValue(ydoc, 'images', book.images);
      if (isRec(book.cover)) setMetaValue(ydoc, 'cover', book.cover);
    }
    writeHistory(c, ydoc, L);
  });
  return r;
}
