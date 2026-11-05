import type * as Y from 'yjs';
import { exportBook } from '@book/editor/index.js';
import { closureIfLoaded, closureT, exportEnv, importEnv, loadClosure, loadSample, pageEnv, structEnv, writeEnv, type Closure, type HistoryEntry, type State } from '../closure/index';
import { desk } from '../environment/page';
import { arriveForExport, loadSerialize, serializeIfLoaded } from '../export/state';
import { exportSafe } from '../export/safe';
import { restoreDoc, withStableIds } from '../history/history';
import { deskIsUntouchedSample, sampleArrival, sampleLoaded } from '../sample/sample';
import { carry, idsOk, writeBook } from '../structure/structure';
import { styleSettle } from '../style/session';
import markup from '../generated/import-markup.json';

/* Step 5 wave 6 (inventory G1, G2): the import — 1.0's own code, on 1.0's state of the open book.

   Everything the Import button, the import report and Add a Book's manuscripts run is 1.0's, lifted into the browser
   closure (scripts/extract-closure.mjs): readImportFile (BEUK:onereader, every format), handleImportFile, the whole-book
   replace (replaceBodyChapters), the report (irBegin / irFinish, irRenderReport, the per-item undo, Undo the whole
   import, Dismiss), importSandboxed (a file made a book on a desk of its own) and the summary. Nothing is re-implemented.

   THE IMPORT SESSION. 1.0's code runs on 1.0's state of the open book as applyBookDoc holds it — built from exportBook
   by applyBookDoc's own data lines (src/export/state.ts arriveForExport, the export session's, here uncorrected: the
   import reads the desk as it stands, and what it writes is the new book), with History unpacked (normalizeHistory),
   so irBegin sees the real desk: empty, the untouched sample, History's head. Inside the session 1.0's autoSnapshot and
   noteBookEdited act on that state, and a book arriving on it (applyBookDoc) is 2.0's arrival lines on a fresh state.
   When the session ends, what it changed is written:
   - a book arrived (the import, Undo the whole import): the session's book WHOLE — 1.0's serializeBook of its state
     (History with the import's snapshot, the report) or History's own restore — through the backup-open path (a new
     generation: replaceWith), so the editor, the sidebar, the preview and the Style session all rebuild;
   - otherwise (a per-item undo, Keep all, Dismiss) only what changed (structure.ts carry / writeBook: the touched
     sections' keys, the meta fields, the pictures, importReport), in one transaction.
   1.0's waits (a confirm) resume in a session (importEnv.resume). */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Whole = { doc: Rec | null; sample?: boolean };
/** `ydoc` null: no book on this device yet (the empty desk: 1.0's empty book, buildEmptyBook). */
type Sess = { c: Closure; ydoc: Y.Doc | null; book: Rec; state: State & Rec; pre: Rec; whole: Whole | null; untouched: boolean };

/** Where a whole book goes (ImportHost: the BookProvider's replaceWith), and where the page's toasts go. */
export const importUi: {
  replace: (doc: Rec, from: Y.Doc | null) => Promise<Y.Doc | null>;
  /** The new generation an import (or Undo the whole import) opened: not "another book opening" (the summary stays). */
  ownArrival: Y.Doc | null;
  /** The sample record of a generation the sample's Undo opened (sample.ts setSampleRecord after its fingerprint). */
  sampleArrived: (ydoc: Y.Doc) => void;
  /** The calm confirm 1.0's import asks (ImportHost: the studio's useConfirm); before that, writeEnv's. */
  confirm: (o: Rec) => Promise<unknown>;
  /** 1.0's vendored JSZip loaded (src/export/ExportModal.tsx loadJszip, set there). */
  jszip: () => Promise<void>;
} = {
  confirm: (o) => writeEnv.confirm(o),
  jszip: async () => undefined,
  replace: async () => null,
  ownArrival: null,
  sampleArrived: () => undefined,
};

let sess: Sess | null = null;
let depth = 0;
let sandbox = 0;
/** A whole-book write in flight (the report's buttons wait for the new generation). */
let pending: Promise<void> | null = null;
export const importPending = (): Promise<void> | null => pending;

/** 1.0's state of the open book for the import: applyBookDoc's lines (arriveForExport), History unpacked. */
export function importStateOf(c: Closure, ydoc: Y.Doc): { book: Rec; state: State & Rec } {
  const book = exportBook(ydoc) as Rec;
  const st = arriveForExport(c, book) as State & Rec;
  st.history = c.api.normalizeHistory(withStableIds(book.history), book.historyPool);
  return { book, state: st };
}

/** 1.0's empty desk (no book on the device): its empty book arrived on a fresh state. */
function emptyDesk(c: Closure): { book: Rec; state: State & Rec } {
  const book = c.api.buildEmptyBook() as Rec;
  const st = arriveForExport(c, book) as State & Rec;
  st.history = [];
  return { book, state: st };
}
/** 1.0's chopSnapDoc, over its serializeBook of the session's state: the book less History and the report, the pictures,
 *  fonts, cover and research files last (formatVersion stays, as in 1.0's snapshots; wave 1a's snapshotDoc leaves it out
 *  of the snapshots 2.0's History takes itself). */
function chopSnapDoc(book: Rec): HistoryEntry['doc'] {
  const d = clone(book);
  delete d.history;
  delete d.historyPool;
  delete d.importReport;
  const imgs = (d.images as unknown[]) || [], fonts = (d.fonts as unknown[]) || [], cover = d.cover;
  const rsf = isRec(d.research) ? (d.research.files as unknown[] | undefined) : null;
  d.images = [];
  d.fonts = [];
  d.cover = null;
  delete d.research;
  const out = clone(d);
  out.images = clone(imgs);
  out.fonts = clone(fonts);
  out.cover = cover ? clone(cover) : null;
  if (rsf) out.research = { files: clone(rsf) };
  return out as HistoryEntry['doc'];
}
/** 1.0's autoSnapshot on the session's state (takeSnapshot: newest first, then pruneAutoSnapshots). */
function sessionSnapshot(kind: string): HistoryEntry | null {
  const s = sess;
  const ser = serializeIfLoaded();
  if (!s || !ser) return null;
  const c = s.c;
  if (c.api.isEmptyDesk() || importEnv.untouched()) return null;
  const st = c.getState() as State & Rec;
  const snap: HistoryEntry = { id: c.api.uid(), name: '', auto: kind || null, at: new Date().toISOString(), words: c.api.bookWordTotal(), doc: chopSnapDoc(ser(c)) };
  st.history = [snap].concat((st.history as HistoryEntry[]) || []);
  c.api.pruneAutoSnapshots();
  return snap;
}

/** 1.0's applyBookDoc on the session's desk: its data lines on a fresh state (arriveForExport), then what it does
 *  around them that the import reads — History (a book carrying it brings it; otherwise the desk's stays with
 *  keepHistory or the same book), the box set's volumes (the same book keeps them), the writing log's rebase, the
 *  Covenant's caches, the summary hidden, the report's reopen button. */
function applyBookDoc(doc: unknown, opts?: unknown): boolean {
  const c = closureIfLoaded();
  if (!c || !isRec(doc)) return false;
  const o = isRec(opts) ? opts : {};
  const prev = (c.getState() || {}) as Rec;
  const arr = isRec(doc.meta) ? doc.meta : {};
  const sameBook = !!arr.bookId && isRec(prev.meta) && arr.bookId === prev.meta.bookId;
  c.vars.wlogRebase = true;
  const s = arriveForExport(c, doc) as State & Rec;
  if (Array.isArray(doc.history)) s.history = c.api.normalizeHistory(doc.history, doc.historyPool);
  else s.history = !o.keepHistory && !sameBook ? [] : ((prev.history as HistoryEntry[]) || []);
  s.boxSetVolumes = sameBook && Array.isArray(prev.boxSetVolumes) ? prev.boxSetVolumes : [];
  c.setState(s);
  c.api.bibleBookArrived();
  const box = pageEnv.$('importSummary') as HTMLElement | null;
  if (box) box.style.display = 'none';
  c.api.irSyncReopen();
  if (sess && sandbox === 0) {
    sess.state = s;
    if (!importEnv.quiet && !sess.whole) sess.whole = { doc: null };
  }
  return true;
}

/** 1.0's restoreSnapshot (Undo the whole import, by its snapshot): History's own restore (history.ts restoreDoc: a
 *  "Before restore" snapshot unless the desk is truly empty, the snapshot's book, the current History), arriving on the
 *  session's desk so 1.0's next lines read it; that book is what the session writes. */
function restoreSnapshot(id: string): boolean {
  const s = sess;
  if (!s || !s.ydoc) return false;
  const doc = restoreDoc(s.c, s.ydoc, id);
  if (!doc) return false;
  applyBookDoc(clone(doc), { keepHistory: true });
  s.whole = { doc };
  return true;
}

/** 1.0's applySampleBookSync (Undo the whole import of the untouched sample): wave 1c's sample arrival. */
function applySampleBookSync(): void {
  const s = sess;
  // review of wave 6 (Critical 1): without the sample's own chunk (a reload since the sample was loaded) the sample cannot
  // arrive now. 1.0's irUndoAll would go on to clear the report while the book keeps the import: stop it here instead
  // (the book and its report stay; the chunk is on its way, sampleAhead, so the next try works)
  if (!s || !s.ydoc) return;
  if (!s.c.sample) {
    sampleAhead();
    throw new Error('the sample is still loading — try Undo the whole import again in a moment');
  }
  const doc = sampleArrival(s.c, s.ydoc, s.untouched);
  applyBookDoc(clone(doc), { keepHistory: true });
  s.whole = { doc, sample: true };
  // 1.0's applySampleBookSync's own toast, on the sample as it arrived (V's ruling 2026-11-04)
  const st = s.c.getState();
  structEnv.toast(closureT()('toast.sampleLoaded', { words: s.c.api.fmtNum(s.c.api.bookWordTotal()), chapters: st.sections.filter((x) => x.type === 'chapter').length }), 'book-open');
}

importEnv.applyBookDoc = applyBookDoc;
importEnv.restoreSnapshot = restoreSnapshot;
importEnv.applySampleBookSync = applySampleBookSync;
importEnv.untouched = () => {
  const c = closureIfLoaded();
  return !!sess && sess.untouched && !!c && !!c.api.sampleState.loaded;
};

/** Open an import session on the open book (re-entrant: inside one, the same session). Null without a book, a closure
 *  or 1.0's serializeBook. The returned function (once) ends it and writes what changed. */
export function importBegin(): (() => void) | null {
  const c = closureIfLoaded();
  const ydoc = desk.ydoc;
  const ser = serializeIfLoaded();
  if (!c || !ser) return null;
  if (sess && depth > 0) {
    // inside a session: the same one; whichever end comes last ends it (finish)
    depth++;
    c.setState(sess.state);
    return once(endOne);
  }
  styleSettle(); // a held Style edit is in the book before the import reads it
  const untouched = ydoc ? deskIsUntouchedSample(c, ydoc) : false;
  // no book on this device yet: the desk is 1.0's empty book (an import onto it opens the first book)
  const { book, state } = ydoc ? importStateOf(c, ydoc) : emptyDesk(c);
  c.setState(state);
  const sampleWas = c.api.sampleState.loaded;
  c.api.sampleState.loaded = ydoc ? sampleLoaded(ydoc) : false;
  sess = { c, ydoc, book, state, pre: clone(state) as Rec, whole: null, untouched };
  const rep = state.importReport as { undo?: { sample?: unknown } } | null;
  if (rep && rep.undo && rep.undo.sample && !c.sample) sampleAhead();
  depth = 1;
  const keep = { snapshot: importEnv.snapshot, edited: importEnv.edited, serialize: exportEnv.serialize, confirm: importEnv.confirm };
  importEnv.snapshot = sessionSnapshot;
  importEnv.edited = () => undefined;
  importEnv.confirm = (o) => importUi.confirm(o);
  exportEnv.serialize = () => ser(c);
  finish = () => {
    const s = sess!;
    sess = null;
    finish = null;
    try {
      importFlush(s, ser);
    } finally {
      importEnv.snapshot = keep.snapshot;
      importEnv.edited = keep.edited;
      importEnv.confirm = keep.confirm;
      exportEnv.serialize = keep.serialize;
      c.api.sampleState.loaded = sampleWas;
    }
  };
  return once(endOne);
}
/** What ends the open session (its flush and its hooks put back), run by the last end of the session's depth. */
let finish: (() => void) | null = null;
function endOne(): void {
  depth--;
  if (depth === 0 && finish) finish();
}
const once = (f: () => void): (() => void) => {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    f();
  };
};

/** `fn` (1.0's code) in an import session; the session ends (and writes) when it returns. */
export function importRun<T>(fn: (c: Closure) => T): T | undefined {
  if (sandbox > 0) return fn(closureIfLoaded()!); // inside importSandboxed: its own desk, nothing is written
  const end = importBegin();
  if (!end) return undefined;
  try {
    return fn(closureIfLoaded()!);
  } finally {
    end();
  }
}

/** A value 1.0's import waits on (a confirm): its continuation runs in an import session, ended in the next task (the
 *  caller's own continuation, a microtask later, still runs in it). Outside a session, as it is. */
export function importResume<T>(v: T): T {
  if (!v || typeof (v as { then?: unknown }).then !== 'function' || !sess) return v;
  const p = v as unknown as Promise<unknown>;
  const step = (f: (x: unknown) => unknown) => (x: unknown) => {
    const end = importBegin();
    try {
      return f(x);
    } finally {
      setTimeout(() => end?.(), 0);
    }
  };
  const wrapped = { then: (ok?: ((x: unknown) => unknown) | null, bad?: ((e: unknown) => unknown) | null) => p.then(ok ? step(ok) : undefined, bad ? step(bad) : undefined) };
  return Promise.resolve(wrapped) as unknown as T;
}
importEnv.resume = (v) => importResume(v);

/** What the session changed, written. */
function importFlush(s: Sess, ser: (c: Closure) => Rec): void {
  const c = s.c;
  if (s.whole) {
    let doc = s.whole.doc;
    if (!doc) {
      c.setState(s.state);
      doc = ser(c);
    }
    startReplace(s, doc, !!s.whole.sample);
    return;
  }
  const st = s.state;
  const keys = ['sections', 'meta', 'images', 'importReport'];
  if (keys.every((k) => same(s.pre[k], st[k]))) return;
  // only what 1.0's code changed, laid over the book as stored (structure.ts carry), in the keys an undo touches
  const after = carry(c, s.book, s.pre, st as State, false);
  const out: Rec = clone(s.book);
  for (const k of keys) {
    if (same(s.pre[k], st[k])) continue;
    if (k === 'sections') out.sections = after.sections;
    else if (k === 'meta') out.meta = patchInto(s.book.meta, s.pre.meta, st.meta);
    else out[k] = clone(st[k] ?? null);
  }
  if (!s.ydoc || !idsOk(out.sections as unknown[])) return;
  writeBook(s.ydoc, s.book, out);
}

/** `base` with only what changed from `before` to `after` applied, field by field (5d's rule). */
function patchInto(base: unknown, before: unknown, after: unknown): unknown {
  if (same(before, after)) return base;
  if (isRec(before) && isRec(after) && isRec(base)) {
    const out = clone(base);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const v = patchInto(out[k], before[k], after[k]);
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  }
  return after === undefined ? undefined : clone(after);
}

/** The whole book, opened as a new generation in place of the open one (the backup-open path). The report stays open
 *  over it; its reopen button and the summary are 1.0's own DOM, outside the generation. */
function startReplace(s: Sess, doc: Rec, sample: boolean): void {
  const c = s.c;
  // (1.0's serializeBook output, or History's restore: the book format's own keys, as a backup carries them)
  const book = doc;
  pending = (async () => {
    const y = await importUi.replace(book, s.ydoc);
    if (!y) {
      // the device would not store it (its toast said why): nothing changed, so nothing of the import stays shown
      importRun((cc) => {
        cc.api.irCloseReport();
        cc.vars.renderImportSummary([]);
      });
      return;
    }
    importUi.ownArrival = y;
    if (sample) importUi.sampleArrived(y);
    if (desk.ydoc === y) importRun((cc) => cc.api.irSyncReopen());
  })().finally(() => {
    pending = null;
  });
  void c;
}

/* ---- the libraries (decision 3): 1.0's vendored files, 1.0's integrity, loaded on first use ---- */

let mammothLoad: Promise<void> | null = null;
/** 1.0's mammoth.browser.min.js (client/index.html line 50: the same file, the same integrity), once, on the first .docx. */
export function loadMammoth(): Promise<void> {
  if ((globalThis as { mammoth?: unknown }).mammoth) return Promise.resolve();
  if (!mammothLoad) mammothLoad = scriptOnce('/assets/vendor/mammoth.browser.min.js', markup.mammothSri, false, () => !!(globalThis as { mammoth?: unknown }).mammoth);
  return mammothLoad;
}
let pdfLoad: Promise<void> | null = null;
/** pdf.js 6.4.299 (1.0's PDFJS_DIR and PDFJS_FILES: the worker build first, each under 1.0's SRI, as module scripts), on
 *  the first .pdf. 1.0's own pdfLoadLib then finds both globals and hands the library over. 1.0's PDFJS_DIR is relative
 *  to its page (/studio); on 2.0's page (/next/) it is taken from the site's root. */
export function loadPdfjs(c: Closure): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (g.pdfjsLib && g.pdfjsWorker) return Promise.resolve();
  if (!pdfLoad)
    pdfLoad = c.api.PDFJS_FILES.reduce<Promise<void>>((p, f) => p.then(() => scriptOnce('/' + c.api.PDFJS_DIR + f.file, f.sri, true, () => !!g[f.global])), Promise.resolve());
  return pdfLoad;
}
function scriptOnce(src: string, sri: string, module: boolean, ok: () => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const s = document.createElement('script');
    if (module) s.type = 'module';
    s.src = src;
    s.setAttribute('integrity', sri);
    const done = () => {
      // a failed load is retried next time; 1.0's own check then says what it says (mammoth "still loading", pdf.js
      // pdf.loadFailed)
      if (!ok()) {
        if (src.includes('mammoth')) mammothLoad = null;
        else pdfLoad = null;
      }
      resolve();
    };
    s.onload = done;
    s.onerror = done;
    document.head.appendChild(s);
  });
}

/* ---- the wiring: 2.0 around 1.0's import (once per closure) ---- */

const wired = new WeakSet<object>();
/** A File whose readers resume in the export session when an export call asked for it (Add a Book's volumes). */
function resumable(f: unknown): unknown {
  if (!(f instanceof Blob)) return f;
  for (const k of ['text', 'arrayBuffer'] as const) {
    const real = Blob.prototype[k] as (this: Blob) => Promise<unknown>;
    Object.defineProperty(f, k, { value: () => exportEnv.resume(real.call(f)), configurable: true });
  }
  return f;
}
export async function importWire(): Promise<Closure> {
  await loadSerialize();
  const c = await loadClosure();
  if (wired.has(c.vars)) return c;
  wired.add(c.vars);
  const v = c.vars;
  const read = v.readImportFile, confirmReplace = v.importConfirmReplace, sandboxed = v.importSandboxed;
  const toVolume = v.manuscriptFileToVolume, expand = v.boxSetExpandPick;
  // the libraries first; then 1.0's synchronous step, run in an import session (the book is written whole after it)
  v.readImportFile = (file: unknown) =>
    exportEnv.resume(
      (async () => {
        const name = String((file as { name?: unknown } | null)?.name ?? '').toLowerCase();
        if (name.endsWith('.docx')) await loadMammoth();
        else if (name.endsWith('.pdf')) await loadPdfjs(c);
        if (name.endsWith('.epub') || name.endsWith('.docx') || name.endsWith('.zip')) await jszip();
        const run = await read(file);
        // a whole-book write still in flight (an import before this one): this import waits for its new book, and its
        // confirm then asks over that book (V's ruling 2026-11-04: nothing of the first is lost)
        while (importPending()) await importPending();
        const wrapped = Object.assign(() => importRun(() => run()), run.raw !== undefined ? { raw: run.raw } : {});
        return wrapped;
      })(),
    );
  // read on the open book's state (an empty desk or the untouched sample is replaced without asking)
  v.importConfirmReplace = (name: string) => {
    const r = importRun(() => confirmReplace(name));
    return r === undefined ? Promise.resolve(false) : (r as Promise<unknown>);
  };
  // decision 6: a desk of its own. 1.0's own code swaps the desk's book out and back; every book it arrives is a fresh
  // state (applyBookDoc above), so the open session's state is never the one swapped, and it stands again after. 1.0's
  // quiet hooks: the supplied ones through importEnv.quiet, 1.0's own functions through their setters
  v.importSandboxed = (run: () => unknown) => {
    const ser = serializeIfLoaded();
    const prev = c.getState();
    const keep = { mwa: v.markWritingActivity, odl: v.offerDetectedLanguage, ris: v.renderImportSummary, ior: v.irOpenReport, quiet: importEnv.quiet, serialize: exportEnv.serialize, rebase: v.wlogRebase };
    const noop = () => undefined;
    importEnv.quiet = true;
    v.markWritingActivity = noop;
    v.offerDetectedLanguage = noop;
    v.renderImportSummary = noop;
    v.irOpenReport = noop; // V's ruling 2026-11-04: a sandboxed import opens no report (1.0's importSandboxed quiets it too)
    if (ser) exportEnv.serialize = () => ser(c);
    sandbox++;
    try {
      return sandboxed(run);
    } finally {
      sandbox--;
      importEnv.quiet = keep.quiet;
      v.markWritingActivity = keep.mwa;
      v.offerDetectedLanguage = keep.odl;
      v.renderImportSummary = keep.ris;
      v.irOpenReport = keep.ior;
      exportEnv.serialize = keep.serialize;
      v.wlogRebase = keep.rebase;
      c.setState(prev);
    }
  };
  // Add a Book (5c's seam closed): 1.0's own boxSetExpandPick and manuscriptFileToVolume. 1.0's listener awaits them and
  // then adds the volume to the open book's list, so their answers (and the file reads inside them) resume in the
  // export session (5c's exportEnv.resume)
  // 5c's correction stays: a volume is any file a writer picks, and 1.0's box set writes its values unescaped (5c's 1.0
  // finding), so each volume is corrected as the open book is (exportSafe), in the session, before 1.0's listener takes it
  v.manuscriptFileToVolume = (f: unknown) => {
    const read = exportEnv.resume(toVolume(resumable(f)));
    return exportEnv.resume(
      read.then((vol) => {
        const st = c.getState();
        exportSafe(c, vol as never, vol);
        if (c.getState() !== st) c.setState(st);
        return vol;
      }),
    );
  };
  v.boxSetExpandPick = (files: unknown[]) => exportEnv.resume(expand((Array.isArray(files) ? files : []).map(resumable)));
  // wave 7b (G3, decision 2): 1.0's bulkBuildBook makes each file a book through importSandboxed, which reads the open
  // book's state to put it back after: it runs in an import session on the open book, and that session writes nothing
  // (importSandboxed's arrivals are its own; the session's state stands as it was)
  const build = v.bulkBuildBook;
  v.bulkBuildBook = (item: unknown, ctx: unknown) => {
    let out: Record<string, unknown> = {};
    let ran = false;
    importRun(() => {
      ran = true;
      out = build(item, ctx);
    });
    if (!ran) throw new Error('unreadable'); // no closure, no serializeBook: 1.0's queue reports the file and goes on
    return out;
  };

  exportEnv.volume = (f: unknown) => v.manuscriptFileToVolume(f);
  return c;
}
async function jszip(): Promise<void> {
  await importUi.jszip();
}

/** For Undo the whole import of the untouched sample: the sample's own chunk is fetched ahead (irUndoAll is synchronous). */
export const loadSampleHook: { fn: (() => void) | null } = { fn: null };
export function sampleAhead(): void {
  if (loadSampleHook.fn) return loadSampleHook.fn();
  void loadSample().catch(() => undefined);
}
