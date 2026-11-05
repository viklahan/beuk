import * as Y from 'yjs';
import { exportBook } from '@book/editor/index.js';
import { readBook } from '@book/read.js';
import {
  closureIfLoaded,
  closureLang,
  closureT,
  cloudBootHook,
  cloudFacts,
  fmtDateIntl,
  loadClosure,
  pageEnv,
  pageToast,
  shelfEnv,
  stateFromBook,
  untitledStrings,
  type Closure,
  type HistoryEntry,
  type State,
} from '../closure/index';
import { arriveForExport } from '../export/state';
import { loadSerialize, serializeIfLoaded } from '../export/state';
import { live, takeSnapshot as histTakeSnapshot, withStableIds, writeHistory } from '../history/history';
import { drawIcons } from '../insights/insights';
import { deskIsUntouchedSample } from '../sample/sample';
import { covRun } from '../covenant/covenant';
import { printRun, loadPrint } from '../print/print';
import { bookMeta } from '../book/store';

/* Step 5 wave 7a (inventory H1-H4): the shelf. 1.0's own cloud code (client/index.html, lifted into its own module by
   scripts/extract-closure.mjs: src/generated/closure-cloud.js) runs here — the transport and its guards, the shelf
   pictures, the probe, the dirty flag and the autosave, the single-flight save with If-Match, the sync line, the account
   button, the shelf list and its guard, the sign-in dialog, the account box, the portal and plan lines, the reconnect
   flush and the three-way conflict. React only puts 1.0's markup in place (src/cloud/CloudHost.tsx).

   What 1.0's code reaches outside it is 2.0's:
   - `state`: 1.0's state of the open book as far as this code reads it (state.meta: the desk's meta; state.history, which
     resolveConflict re-seats after an arrival: the arrival has done it already, see applyBookDoc);
   - serializeBook: 1.0's own serializeBook (closure-serialize.js) of 1.0's state of the desk (applyBookDoc's lines over
     the open book's exportBook, History unpacked) — the body 1.0 sends for the same book; a book still arriving (an
     applyBookDoc whose new generation is not open yet) is serialized as it will open;
   - applyBookDoc: a whole book arriving on the desk is a new generation (the backup-open path: replaceWith), its History
     led by the desk's snapshot when 1.0 took one just before (resolveConflict's "Use the shelf copy");
   - takeSnapshot / snapshotForeignDoc / pruneAutoSnapshots: History's (wave 1a) and 1.0's snapshotForeignDoc on History's
     state of the open book, written into it;
   - the device record (1.0's BEUK:local link beside the book): a per-device link store, one entry per book id, in
     localStorage `beuk.next.shelfLinks.v1` — never in the book (decision 2);
   - one writer per book on a device (decision 3): the tab holding the Web Lock `beuk-next-shelf-<bookId>` is the only
     one whose edits reach 1.0's noteBookEdited and that saves; the other tabs take the link it writes (a storage event)
     and never raise a conflict against their own device. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
type Fn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type CloudClosure = { api: Record<string, Fn> & Record<string, any>; vars: Record<string, any>; setState(s: unknown): void; getState(): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What the studio around the shelf gives it (src/cloud/CloudHost.tsx sets these). */
export const cloudUi: {
  /** The book on the desk (null: none open). */
  ydoc: () => Y.Doc | null;
  /** Open `doc` as a new generation in place of `from` (BookProvider.replaceWith); the new Y.Doc, or null. */
  replace: (doc: Rec, from: Y.Doc | null) => Promise<Y.Doc | null>;
  focusEditor: () => void;
  localFailed: () => boolean;
  /** 1.0's cloudConfirm: the studio's calm confirm (src/shell/Dialog.tsx useConfirm). */
  confirm: (o: Rec) => Promise<unknown>;
  /** Where 1.0's shelf code puts icons (its icons() draws them there). */
  iconRoots: () => ParentNode[];
  /** Where a redirect goes (billing's checkout and portal): the page's own location by default. */
  go: (url: string) => void;
} = {
  ydoc: () => null,
  replace: async () => null,
  focusEditor: () => undefined,
  localFailed: () => false,
  confirm: async () => false,
  go: (url) => window.location.assign(url),
  iconRoots: () => (typeof document === 'undefined' ? [] : [document]),
};

/* ---- the desk as the shelf code sees it ---- */

/** A whole book on its way to the desk (applyBookDoc's new generation, not open yet). */
let arriving: { doc: Rec; bookId: string | null; from: Y.Doc | null } | null = null;
/** History's snapshot of the desk 1.0's resolveConflict took just before its applyBookDoc: the arrival leads with it. */
let headSnap: { snap: HistoryEntry; ydoc: Y.Doc } | null = null;

const metaOf = (ydoc: Y.Doc): Rec => bookMeta(ydoc);
/** The desk's meta, as 1.0's state.meta reads (the arriving book's while one is on its way). */
function deskMeta(): Rec {
  if (arriving) return isRec(arriving.doc.meta) ? (arriving.doc.meta as Rec) : {};
  const y = cloudUi.ydoc();
  return y ? metaOf(y) : {};
}
export function deskBookId(): string | null {
  const id = deskMeta().bookId;
  return typeof id === 'string' && id ? id : null;
}
/** 1.0's `state`, as far as the shelf code reads it: meta (live), history (a list nothing here writes into the book). */
const stateProxy = new Proxy({} as Rec, {
  get(_t, k) {
    if (k === 'meta') return deskMeta();
    if (k === 'history') return [];
    return undefined;
  },
  set() {
    return true; // resolveConflict's re-seat of History: the arrival already leads with the snapshot (applyBookDoc)
  },
});

/** The book format v1 of the desk: the arriving book, else the open book's exportBook. */
function deskBook(): Rec | null {
  if (arriving) return arriving.doc;
  const y = cloudUi.ydoc();
  return y ? (exportBook(y) as Rec) : null;
}

/** 1.0's state of `book` (book format v1): applyBookDoc's lines, History unpacked. Sets it into the main closure. */
function stateOfBook(c: Closure, book: Rec): State {
  const st = arriveForExport(c, book) as State & Rec;
  st.history = c.api.normalizeHistory(withStableIds(book.history), book.historyPool);
  c.setState(st);
  return st;
}
/** Run `fn` on the main closure with 1.0's state of the desk; the main closure's state is put back after. */
function onDesk<T>(fn: (c: Closure, st: State) => T, fallback: T): T {
  const c = closureIfLoaded();
  const book = deskBook();
  if (!c || !book) return fallback;
  const prev = c.getState();
  try {
    return fn(c, stateOfBook(c, book));
  } finally {
    c.setState(prev);
  }
}

/** 1.0's serializeBook of the desk (cached for an unchanged book). */
let serCache: { key: unknown; ver: number; out: Rec } | null = null;
const versions = new WeakMap<Y.Doc, number>();
const verOf = (y: Y.Doc) => versions.get(y) ?? 0;
export function deskSerialize(): Rec {
  const ser = serializeIfLoaded();
  const key = arriving ? arriving.doc : cloudUi.ydoc();
  const ver = arriving ? -1 : key ? verOf(key as Y.Doc) : 0;
  if (serCache && serCache.key === key && serCache.ver === ver) return structuredClone(serCache.out);
  const out = onDesk((c) => (ser ? ser(c) : {}), {} as Rec);
  serCache = { key, ver, out };
  return structuredClone(out);
}

/** 1.0's applyBookDoc on the desk: the shelf's book arrives as a new generation (History first, when 1.0 took a
 *  snapshot of the desk just before). Synchronous as 1.0's: what 1.0 reads next (the title, a save of the book) is the
 *  arriving book's while its generation opens. */
function applyBookDoc(doc: unknown): boolean {
  if (!isRec(doc)) {
    headSnap = null; // review M1: a snapshot taken for an arrival that never comes leads no later book
    return false;
  }
  const read = readBook(structuredClone(doc));
  if (read.status !== 'ok') {
    headSnap = null;
    return false;
  }
  let book = read.book as unknown as Rec;
  const from = cloudUi.ydoc();
  const c = closureIfLoaded();
  if (headSnap && c && headSnap.ydoc === from) {
    const snap = headSnap.snap;
    const prev = c.getState();
    try {
      const st = stateFromBook(c, book) as State & Rec;
      c.setState(st);
      const own = c.api.normalizeHistory(withStableIds(book.history), book.historyPool) as HistoryEntry[];
      st.history = [snap].concat(own.filter((s) => s.id !== snap.id));
      c.api.pruneAutoSnapshots();
      const p = c.api.histPack(st.history);
      book = { ...book, history: p.history, historyPool: p.pool };
    } finally {
      c.setState(prev);
    }
  }
  headSnap = null;
  const m = isRec(book.meta) ? (book.meta as Rec) : {};
  const mine = { doc: book, bookId: typeof m.bookId === 'string' ? m.bookId : null, from };
  arriving = mine;
  serCache = null;
  void (async () => {
    // review I4: a book another tab of this device is writing is not opened here (its generation would replace that
    // tab's, with writing the shelf has not seen): 1.0's own "could not open" words
    const free = mine.bookId === leader.book || (await lockFree(mine.bookId));
    if (!free) {
      pageToast.fn(closureT()('toast.bookOpenFail'), 'alert-triangle');
      return null;
    }
    return cloudUi.replace(book, from);
  })()
    .catch(() => null)
    .then((y) => {
      if (arriving !== mine) return;
      arriving = null;
      serCache = null;
      if (y) deskChanged(y, true);
      else {
        // review C1: the new generation did not open — the desk is still the book it was, so its link is put back as this
        // device stored it (1.0's code had already set the arriving book's link; a write of that is dropped)
        clearTimeout(linkTimer);
        headSnap = null;
        if (loadedCloud && cloudFacts.user) {
          cloudFacts.conflict = null;
          takeLink(storedLink(linkBook));
        }
      }
    });
  return true;
}

/** 1.0's takeSnapshot on the desk (History's, wave 1a), written into the open book; resolveConflict's arrival leads with it. */
function takeSnapshot(name: string, autoKind: string | null): HistoryEntry | null {
  const c = closureIfLoaded();
  const y = cloudUi.ydoc();
  if (!c || !y) return null;
  const prev = c.getState();
  try {
    const L = live(c, y);
    const snap = histTakeSnapshot(c, L, name, autoKind);
    headSnap = { snap, ydoc: y };
    return snap;
  } finally {
    c.setState(prev);
  }
}
/** 1.0's snapshotForeignDoc (Keep both: the shelf copy kept as a snapshot), on History's state of the open book. */
function snapshotForeignDoc(doc: unknown, name: string): unknown {
  const c = closureIfLoaded();
  const y = cloudUi.ydoc();
  if (!c || !y) return null;
  const prev = c.getState();
  try {
    const L = live(c, y);
    const snap = c.api.snapshotForeignDoc(doc, name);
    writeHistory(c, y, L);
    return snap;
  } finally {
    c.setState(prev);
  }
}

/* ---- the device's link (1.0's BEUK:local link record, per book) ---- */

export const LINKS_KEY = 'beuk.next.shelfLinks.v1';
type Link = { userId: string | null; linkedId: string | null; linkState: string; baseUpdatedAt: string | null; baseRevision: number | null; shelfDirty: boolean };
function readLinks(): Record<string, { savedAt: string; link: Link }> {
  try {
    const v = JSON.parse(localStorage.getItem(LINKS_KEY) || '{}');
    return isRec(v) ? (v as Record<string, { savedAt: string; link: Link }>) : {};
  } catch {
    return {};
  }
}
export function storedLink(bookId: string | null): Link | null {
  if (!bookId) return null;
  const e = readLinks()[bookId];
  return e && isRec(e.link) ? e.link : null;
}
/** The book id the cloud's link fields describe (the desk's, once it changes). */
let linkBook: string | null = null;
/** 1.0's `local` as the lifted code reads it: signed out on this device, and the link this device last stored. */
const local: { signedOut: boolean; restoredLink: Link | null } = { signedOut: false, restoredLink: null };
function writeLink(): void {
  linkTimer = undefined;
  const cm = loadedCloud;
  // the book the link fields describe: the arriving one while its generation opens (1.0 sets the link right after
  // its applyBookDoc), else the desk's
  const id = arriving ? arriving.bookId : linkBook;
  if (!cm || !id || !leader.is) return;
  const snap = cm.api.localLinkSnapshot() as Link | null;
  const all = readLinks();
  if (snap) all[id] = { savedAt: new Date().toISOString(), link: snap };
  else delete all[id];
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(all));
  } catch {
    /* storage refused: the link is this session's only */
  }
}
/** A follower tab takes the link the leader wrote: no save, no conflict of its own. */
function takeLink(l: Link | null): void {
  const cm = loadedCloud;
  if (!cm) return;
  const u = cloudFacts.user as { id?: string } | null;
  if (l && u && l.userId === u.id && l.linkedId) {
    cloudFacts.linkedId = l.linkedId;
    cloudFacts.linkState = 'linked';
    cloudFacts.baseRevision = typeof l.baseRevision === 'number' ? l.baseRevision : null;
    cloudFacts.baseUpdatedAt = l.baseUpdatedAt || null;
    cloudFacts.shelfUpdatedAt = cloudFacts.baseUpdatedAt;
    cm.vars.cloudDirty = false;
    cloudFacts.syncStatus = l.shelfDirty ? 'saving' : 'saved';
  } else {
    cloudFacts.linkedId = null;
    cloudFacts.linkState = l && l.linkState === 'declined' ? 'declined' : 'unlinked';
    cloudFacts.baseRevision = null;
    cloudFacts.baseUpdatedAt = null;
    cloudFacts.shelfUpdatedAt = null;
    cm.vars.cloudDirty = false;
    cloudFacts.syncStatus = 'local';
  }
  cm.api.renderSyncLine();
  cm.api.renderAccountButton();
}

/* ---- one writer per book on this device (decision 3) ---- */

const leader: { is: boolean; book: string | null; release: (() => void) | null; pending: boolean; edited: boolean } = { is: true, book: null, release: null, pending: false, edited: false };
function lead(bookId: string | null): void {
  if (leader.book === bookId) return;
  leader.release?.();
  leader.release = null;
  leader.book = bookId;
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!bookId || !locks || typeof locks.request !== 'function') {
    leader.is = true;
    return;
  }
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  let gone = false;
  // review M3: a queued request (this tab following) is withdrawn when the desk moves to another book
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  leader.release = () => {
    gone = true;
    release();
    abort?.abort();
  };
  // review I4: not the writer of this book until the lock answers (the link of a book another tab writes is not ours)
  leader.is = false;
  leader.pending = true; // an edit made before the lock answers is kept and noted once this tab is the writer
  leader.edited = false;
  const name = 'beuk-next-shelf-' + bookId;
  // first, without waiting: free, this tab is the writer at once and keeps the link it holds (the book it just opened,
  // or the one it had); taken, another tab of this device writes the book, and this one follows it
  void locks
    .request(name, { ifAvailable: true }, (lock) => {
      if (gone) return undefined;
      leader.pending = false;
      if (lock) {
        leader.is = true;
        writeLink();
        if (leader.edited && loadedCloud) loadedCloud.api.noteBookEdited();
        leader.edited = false;
        return held;
      }
      leader.is = false;
      takeLink(storedLink(bookId));
      // queued: when the writer tab goes, this one becomes the writer, and what it left unsaved comes due here
      void locks
        .request(name, abort ? { signal: abort.signal } : {}, () => {
          if (gone) return undefined;
          leader.is = true;
          const l = storedLink(bookId);
          const cm = loadedCloud;
          if (cm && !cloudFacts.user && leader.edited) cm.api.noteBookEdited();
          if (cm && cloudFacts.user) {
            const wasDirty = !!cm.vars.cloudDirty || leader.edited; // a save asked for, or writing typed here, while following
            takeLink(l);
            if (((l && l.shelfDirty) || wasDirty) && (cloudFacts.linkedId || wasDirty)) {
              cm.vars.cloudDirty = true;
              cm.api.cloudAutosaveTick();
            }
          }
          leader.edited = false;
          return held;
        })
        .catch(() => undefined);
      return undefined;
    })
    .catch(() => undefined);
}
export const shelfLeader = (): boolean => leader.is;
/** Review I4: is the book's writer lock free on this device (no other tab writes it)? Without Web Locks: yes. */
function lockFree(bookId: string | null): Promise<boolean> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!bookId || !locks || typeof locks.request !== 'function') return Promise.resolve(true);
  return locks.request('beuk-next-shelf-' + bookId, { ifAvailable: true }, (l) => !!l).then((v) => !!v, () => true);
}
/** Review C2, I5: a shelf save waits while there is no book to send (between generations) or another tab writes it;
 *  1.0's cloudSaveRun asks this through its samplePicsMissingInState / samplePicsEnsure seam and comes due again after. */
const saveMustWait = (): boolean => (!arriving && !cloudUi.ydoc()) || !leader.is;
function saveCanGo(): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => {
      if (!saveMustWait()) return resolve(true);
      if (Date.now() - t0 > 30 * 60_000) return resolve(false);
      setTimeout(poll, 200);
    };
    poll();
  });
}

/* ---- the desk changes (another book, or a new generation) ---- */

let watched: { ydoc: Y.Doc; off: () => void } | null = null;
/** The book on the desk is now `ydoc`. `own`: it is the arrival 1.0's code made (its link fields are already its own). */
export function deskChanged(ydoc: Y.Doc | null, own = false): void {
  if (watched && watched.ydoc === ydoc) return;
  watched?.off();
  watched = null;
  serCache = null;
  const id = ydoc ? (typeof metaOf(ydoc).bookId === 'string' ? (metaOf(ydoc).bookId as string) : null) : null;
  // the shelf's own arrival, seen by the studio before its promise settles (React's effect runs first): still its own
  if (arriving && ydoc && arriving.bookId === id) own = true;
  if (id !== linkBook) {
    const before = linkBook;
    const cm = loadedCloud;
    if (cm && before !== null) {
      // review I2, I6: the outgoing book's link is written now (a write still in its pause belongs to it), and what was
      // edited this session belongs to it alone
      if (linkTimer !== undefined) {
        clearTimeout(linkTimer);
        linkTimer = undefined;
        writeLink();
      }
      cloudFacts.sessionEdited = false;
      cloudFacts.editedBeforeSignIn = false;
      // review I1: "signed out on this device" was said of the book on the desk; another book keeps the link stored for it
      local.signedOut = false;
    }
    linkBook = id;
    // review M2: signed in, a book reaching an empty desk mid-session takes its stored link as another book would
    if (cm && !own && (before !== null || (!!cloudFacts.user && !!id))) {
      // another book: its own link, as this device last stored it (1.0 keeps one desk; 2.0 one link per book)
      const l = storedLink(id);
      local.restoredLink = l;
      if (cloudFacts.user) {
        cloudFacts.conflict = null;
        takeLink(l && l.userId === (cloudFacts.user as { id?: string }).id ? l : null);
        if (l && l.shelfDirty && cloudFacts.linkedId) {
          cm.vars.cloudDirty = true;
          cm.api.cloudAutosaveTick();
        }
      }
    } else if (!cm || before === null) local.restoredLink = storedLink(id);
  }
  lead(id);
  // the shelf's own arrival: its link is the opened book's, on this device too
  if (own) writeLink();
  if (!ydoc) return;
  const onUpdate = (_u: Uint8Array, origin: unknown, _d: Y.Doc, tr: Y.Transaction) => {
    versions.set(ydoc, verOf(ydoc) + 1);
    serCache = null;
    // a real edit: typed here, or in another tab of this generation (BroadcastChannel) when this tab is the writer
    const fromTab = typeof BroadcastChannel === 'function' && origin instanceof BroadcastChannel;
    if (!(tr.local || fromTab)) return;
    // not (yet) the writer: an edit typed HERE is kept and noted if this tab becomes the writer (its own lock may still be
    // letting go: X → Y → X); a redundant save at most when another tab really was writing
    if (!leader.is && tr.local) leader.edited = true;
    if (!leader.is || !loadedCloud) return;
    loadedCloud.api.noteBookEdited();
  };
  ydoc.on('update', onUpdate);
  watched = { ydoc, off: () => ydoc.off('update', onUpdate) };
}

/* ---- the module ---- */

let loadedCloud: CloudClosure | null = null;
let loadingCloud: Promise<CloudClosure> | null = null;
export const cloudIfLoaded = (): CloudClosure | null => loadedCloud;

const printReadyUi = {
  set pending(v: unknown) {
    const pc = printLoaded();
    if (pc) (pc.api.printReadyUi as Rec).pending = v;
  },
  set sig(v: unknown) {
    const pc = printLoaded();
    if (pc) (pc.api.printReadyUi as Rec).sig = v;
  },
};
let printMod: { api: Rec } | null = null;
const printLoaded = () => printMod;

/** 1.0's page-relative worker (assets/pichash.js) from the site's root, where 1.0's own is. */
const PageWorker =
  typeof Worker === 'function'
    ? class extends Worker {
        constructor(url: string | URL, opts?: WorkerOptions) {
          super(url === 'assets/pichash.js' ? '/assets/pichash.js' : url, opts);
        }
      }
    : undefined;

let linkTimer: ReturnType<typeof setTimeout> | undefined;
let iconsQueued = false;
function iconsOnce(): void {
  if (iconsQueued) return;
  iconsQueued = true;
  const go = () => {
    iconsQueued = false;
    // only where 1.0's shelf code draws (the account button, the shelf line, the two dialogs): a scan of the whole page
    // on every edit's frame cost the typing measure ~5 ms at p95 on Dumas (the preview's pages are in the page)
    for (const r of cloudUi.iconRoots()) drawIcons(r);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  else setTimeout(go, 0);
}

export function loadCloud(): Promise<CloudClosure> {
  if (!loadingCloud) {
    loadingCloud = Promise.all([loadClosure(), loadSerialize(), import('../generated/closure-cloud.js')]).then(([, , m]) => {
      void loadPrint().then((pc) => (printMod = pc as unknown as { api: Rec }));
      const cm = m.createCloudClosure({
        state: stateProxy,
        toast: (msg: string, icon?: string) => pageToast.fn(msg, icon),
        samplePicsRequire: async () => undefined,
        JSZip: undefined,
        t: (k: string, p?: Rec) => closureT()(k, p),
        UI_STRINGS: untitledStrings(),
        uiLangState: closureLang(),
        $: (id: string) => pageEnv.$(id),
        // 1.0's icons() after its redraws (the account button and sync line on every edit): once a frame here
        icons: iconsOnce,
        fmtDateIntl,
        location: {
          set href(u: string) {
            cloudUi.go(u);
          },
          get href() {
            return window.location.href;
          },
        },
        setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
        setInterval: (fn: () => void, ms?: number) => globalThis.setInterval(fn, ms),
        cloud: cloudFacts,
        serializeBook: deskSerialize,
        applyBookDoc,
        takeSnapshot,
        snapshotForeignDoc,
        // resolveConflict prunes its re-seated History: the arrival has (applyBookDoc)
        pruneAutoSnapshots: () => undefined,
        isEmptyDesk: () => onDesk((c) => !!c.api.isEmptyDesk(), true),
        deskIsUntouchedSample: () => {
          const c = closureIfLoaded();
          return !!c && !arriving && deskIsUntouchedSample(c, cloudUi.ydoc());
        },
        // the sample's pictures are always on 2.0's desk (4c); its record is per generation (wave 1c)
        // (and, review C2/I5: a save waits while there is no desk to send or another tab writes the book — 1.0's own wait)
        samplePicsMissingInState: () => saveMustWait(),
        samplePicsEnsure: () => saveCanGo(),
        sampleSweepPreRename: () => undefined,
        sampleState: { loaded: false, loadedJson: null },
        renderSampleButton: () => undefined,
        local,
        localRestorePromise: null,
        // review C3: 1.0's device save writes the link with the edit (shelfDirty), signed out too: the link, after its pause
        localMarkDirty: () => {
          clearTimeout(linkTimer);
          linkTimer = setTimeout(writeLink, 120);
        },
        localWriteLinkNow: () => {
          clearTimeout(linkTimer);
          writeLink();
        },
        // 1.0's localNoteLinkChanged: the link written after a 120 ms pause (localWriteLinkNow writes at once)
        localNoteLinkChanged: () => {
          clearTimeout(linkTimer);
          linkTimer = setTimeout(writeLink, 120);
        },
        localNoteSignedOut: () => {
          local.signedOut = true;
          local.restoredLink = null;
          writeLink();
        },
        localFailed: () => cloudUi.localFailed(),
        focusEditor: () => cloudUi.focusEditor(),
        renderStreak: () => closureIfLoaded()?.api.renderStreak(),
        bibleSeriesFlush: () => covRun((c) => c.api.bibleSeriesFlush()),
        bibleSeriesRefresh: (force?: boolean) => covRun((c) => c.api.bibleSeriesRefresh(!!force)),
        bibleSeriesSignOut: () => covRun((c) => c.api.bibleSeriesSignOut()),
        bibleSeriesModalReset: () => covRun((c) => c.api.bibleSeriesModalReset()),
        bibleSeriesResolve: (choice: string) => !!covRun((c) => c.api.bibleSeriesResolve(choice)),
        // wave 7b: bulk import, beta links and the archive list
        renderBulkChrome: () => undefined,
        betaRenderChrome: () => undefined,
        renderArchiveList: () => undefined,
        printReadyUi,
        cloudConfirm: (o: Rec) => cloudUi.confirm(o),
        // the print file storeMakePrintJob uploads: print's own code, on the open book's export state
        buildPrintHtml: () => printRun((pc) => (pc.vars.buildPrintHtml as () => string)()),
        preparePrintPress: () => printRun((pc) => pc.api.preparePrintPress()),
        printFilename: () => printRun((pc) => pc.api.printFilename()),
        Worker: PageWorker,
      }) as CloudClosure;
      loadedCloud = cm;
      // the seams the earlier waves left (5b's print-ready panel, 5d's store check): 1.0's own four, here
      shelfEnv.makePrintJob = (o) => cm.api.storeMakePrintJob(o);
      shelfEnv.upload = (...a) => cm.api.storeUpload(...a);
      shelfEnv.createJob = (...a) => cm.api.storeCreateJob(...a);
      shelfEnv.refreshJobs = (out) => cm.api.storeRefreshJobs(out);
      if (typeof window !== 'undefined') (window as unknown as { beukCloud?: unknown }).beukCloud = cloudSeam;
      return cm;
    });
    loadingCloud.catch(() => {
      loadingCloud = null;
    });
  }
  return loadingCloud;
}

/** The interface language as 1.0's billingDate reads it (uiLangState). */
export function cloudLang(lang: string): void {
  if (loadedCloud) loadedCloud.vars.uiLangState = lang;
}

/* ---- boot: 1.0's initCloud, less its wiring (CloudHost wires 1.0's markup) ---- */

let booting: Promise<void> | null = null;
/** 1.0's initCloud: probe quietly; with a shelf, who is signed in; then 1.0's cloudAfterSignIn (the leader only). */
export function bootCloud(): Promise<void> {
  if (!booting) {
    booting = (async () => {
      const cm = await loadCloud();
      cm.api.renderCloudChrome();
      const up = await cm.api.cloudProbe();
      if (!up) {
        cm.api.cloudGoLocal();
        return;
      }
      cloudFacts.available = true;
      cm.api.renderCloudChrome();
      const me = (await cm.api.apiFetch('/api/auth/me', { auth: false })) as Rec | null;
      if (me && me.user) {
        cloudFacts.user = me.user;
        knownUser = userId();
        cm.api.renderCloudChrome();
        if (leader.is) await cm.api.cloudAfterSignIn();
        else {
          takeLink(storedLink(linkBook));
          void cm.api.cloudLoadShelf();
        }
      } else covRun((c) => {
        if (c.api.bibleAuthSignedOut(me)) c.api.bibleSeriesForget('*');
        c.api.bibleSeriesRefresh(true);
      });
    })();
    cloudBootHook.p = booting;
  }
  return booting;
}

/** The leader's link, read in another tab (the storage event). */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LINKS_KEY || leader.is || !loadedCloud || !cloudFacts.user) return;
    takeLink(storedLink(linkBook));
  });
  // review I6: 1.0's localFlushOnHide — a link write still in its pause is written as the page goes (BEUK:bugs)
  const flushLink = () => {
    if (linkTimer === undefined) return;
    clearTimeout(linkTimer);
    linkTimer = undefined;
    writeLink();
  };
  window.addEventListener('pagehide', flushLink);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLink();
  });
}

/* ---- review I5: a sign-in or sign-out in one tab reaches the others (the session cookie is the device's) ---- */
const AUTH_CHANNEL = 'beuk-next-shelf-auth';
let authChannel: BroadcastChannel | null = null;
let knownUser: string | null = null;
let hearing = false;
const userId = (): string | null => ((cloudFacts.user as { id?: string } | null)?.id ?? null);
/** After 1.0's sign-in, sign-out or sign-out-everywhere in this tab: tell the other tabs when the account changed. */
export function authAnnounce(): void {
  const now = userId();
  if (now === knownUser) return;
  knownUser = now;
  if (hearing || !authChannel) return;
  authChannel.postMessage({ auth: now ? 'in' : 'out' });
}
async function authHeard(kind: unknown): Promise<void> {
  const cm = loadedCloud;
  if (!cm || !cloudFacts.available) return;
  hearing = true;
  try {
    if (kind === 'out') {
      if (cloudFacts.user) await cm.api.cloudSignOut();
    } else if (kind === 'in') {
      const me = (await cm.api.apiFetch('/api/auth/me', { auth: false })) as Rec | null;
      if (!me || !me.user || userId() === (me.user as { id?: string }).id) return;
      cloudFacts.user = me.user;
      cloudFacts.lastHeartbeatAt = 0;
      cm.api.renderCloudChrome();
      // the writer tab runs 1.0's after-sign-in work for its book; a follower takes the writer's link
      if (leader.is) await cm.api.cloudAfterSignIn();
      else takeLink(storedLink(linkBook));
    }
  } finally {
    knownUser = userId();
    hearing = false;
  }
}
if (typeof BroadcastChannel === 'function') {
  authChannel = new BroadcastChannel(AUTH_CHANNEL);
  authChannel.onmessage = (e: MessageEvent) => void authHeard((e.data as { auth?: unknown } | null)?.auth);
}

/* ---- the test seam (vitest, e2e) ---- */
export const cloudSeam = {
  get cloud() {
    return cloudFacts;
  },
  get api() {
    return loadedCloud?.api ?? null;
  },
  get dirty() {
    return loadedCloud?.vars.cloudDirty ?? false;
  },
  leader: () => leader.is,
  link: (id?: string) => storedLink(id ?? linkBook),
  serialize: () => deskSerialize(),
  arriving: () => !!arriving,
  ready: true,
};

/** Tests only: a fresh shelf module and page. */
export function cloudReset(): void {
  watched?.off();
  watched = null;
  arriving = null;
  headSnap = null;
  serCache = null;
  linkBook = null;
  local.signedOut = false;
  local.restoredLink = null;
  leader.release?.();
  leader.is = true;
  leader.book = null;
  leader.release = null;
  booting = null;
  cloudBootHook.p = null;
  clearTimeout(linkTimer); // review M4
  knownUser = null;
  linkTimer = undefined;
  if (loadedCloud) {
    clearTimeout(loadedCloud.vars.cloudSaveTimer);
    clearInterval(loadedCloud.vars.cloudRetryTimer);
    loadedCloud.vars.cloudSaveTimer = null;
    loadedCloud.vars.cloudRetryTimer = null;
    loadedCloud.vars.cloudDirty = false;
  }
}
