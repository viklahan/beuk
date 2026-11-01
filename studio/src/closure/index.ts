import type * as Y from 'yjs';
import { exportBook } from '@book/editor/index.js';
import { epubState } from '@book/epub/state.js';
import type { BookV1 } from '@book/schema.js';
import meta from '../generated/strings-meta.json';

/* 1.0's own render/word-count/History code in the browser (step 5 design,
   decision 3): the generated module src/generated/closure.js
   (scripts/extract-closure.mjs, the server's closure selection reused),
   loaded on first use as its own chunk.

   One closure per studio. Its `state` is 1.0's global state, built from
   the open book on demand (bookState): exportBook(ydoc) gives book format
   v1 (exactly what readBook reads), the server's epubState renames
   `colour` → `bookColour` (as 1.0 holds it), and 1.0's own ARRIVE lines
   (the EPUB build's arrival step) normalise sections, fonts and the cover
   recipe as applyBookDoc does. Nothing here ever writes the book: a caller
   that changes something writes it through Yjs itself.

   Supplied names: t (the studio's current t(), swapped on a language change
   by setClosureT), a UI_STRINGS holding only every pack's
   "misc.untitledBook" (imIsPlaceholderTitle, the one reader the extractor
   allows), and toast / samplePicsRequire / JSZip stubs (no build in wave 1a
   calls them). */

export type Fn = (...args: never[]) => unknown;
/** The 1.0 functions 2.0 calls, typed loosely (their real types are 1.0's). */
export type ClosureApi = {
  countWords: (text: unknown, lang?: unknown) => number;
  buildBookCss: (scope: string) => string;
  bookWordTotal: () => number;
  sectionWords: (s: unknown) => number;
  normalizeSection: (s: unknown) => Record<string, unknown>;
  rightsLine: (meta?: unknown) => string;
  rightsModeOf: (meta?: unknown) => 'pd' | 'cc' | 'custom' | 'reserved';
  copyrightRightsParas: (meta: unknown) => string[];
  imRealTitle: () => string;
  uid: () => string;
  newBookId: () => string;
  normalizeHistory: (list: unknown, pool?: unknown) => HistoryEntry[];
  histPack: (list: unknown) => { history: unknown[]; pool: unknown };
  pruneAutoSnapshots: () => void;
  histSectionDiff: (snapDoc: unknown, liveDoc: unknown) => SectionDiff;
  histTextDiff: (before: unknown, after: unknown) => { rows: { kind: 'same' | 'changed' | 'removed' | 'added'; parts: DiffPart[] }[]; added: number; removed: number };
  histWordDiff: (a: unknown, b: unknown) => DiffPart[];
  snapshotSectionWords: (doc: unknown, s: unknown) => number;
  snapshotSectionName: (s: unknown) => string;
  isEmptyDesk: () => boolean;
  deskTrulyEmpty: () => boolean;
  stableJson: (v: unknown) => string;
  buildEmptyBook: () => Record<string, unknown> & { sections: Record<string, unknown>[] };
  mkSection: (kind: string, type: string, title: string, extra?: Record<string, unknown>) => Record<string, unknown> & { id: string };
  HISTORY_AUTO_CAP: number;
  CHOP_SNAP_CAP: number;
  // wave 1b: the sidebar's counts (C1)
  sectionChars: (s: unknown) => number;
  emptyOut: (s: unknown) => boolean;
  inBook: (s: unknown) => boolean;
  sectionComplete: (s: unknown) => boolean;
  READ_WPM: number;
  AUTO_TYPES: string[];
  // wave 1b: the chapter operations (B2) — 1.0's plans and rules, read against `state`
  chopSplitPlan: (s: unknown, pos: number) => { c1: string; c2: string; title: string; lifted: boolean; sc1: unknown[]; sc2: unknown[] } | null;
  chopMergePlan: (a: unknown, b: unknown) => { content: string; scenes: unknown[]; relabelled: number };
  chopMergeWhy: (s: unknown) => string;
  chopNumberStyle: () => ((n: number) => string) | null;
  chopStyleFits: (f: (n: number) => string) => boolean;
  chopName: (s: unknown) => string;
  chopSig: (s: unknown) => string;
  chopCanDelete: (s: unknown) => boolean;
  chopCanDuplicate: (s: unknown) => boolean;
  chopCanSplitKind: (s: unknown) => boolean;
  chopGenerated: (s: unknown) => boolean;
  chopChapters: () => Record<string, unknown>[];
  chopNumbers: () => Record<string, string>;
  normalizeScenes: (list: unknown) => Record<string, unknown>[];
  CHOP_TOAST_MS: number;
  // wave 1b: the sample book (I8)
  buildSampleBook: () => Record<string, unknown> & { sections: Record<string, unknown>[]; meta: Record<string, unknown> };
  SAMPLE_IMAGE_FILES: { id: string; name: string; mediaType: string; ext: string; file: string; bytes: number; sha256: string }[];
  SAMPLE_COVER_FILE: { name: string; mediaType: string; ext: string; file: string; bytes: number; sha256: string };
  SAMPLE_WORDS: number;
  SAMPLE_BOOK_ID: string;
  LEGACY_SAMPLE_BOOK_ID: string;
  isSampleBookId: (id: unknown) => boolean;
  SAMPLE_DRAFT_EDITS: { starts?: string; after?: string; then: string }[];
  SAMPLE_DRAFT_SNAP_ID: string;
  histCounted: (doc: unknown, s: unknown, flag: boolean) => { w: number };
  CC_LICENCES: Record<string, { name: string; short: string; url: string }>;
};
export type DiffPart = { t: '=' | '-' | '+'; s: string };
export type DiffRow = { id: string; name: string; before: number; after: number; delta: number; note: 'out' | null };
export type SectionDiff = { added: DiffRow[]; removed: DiffRow[]; leftout: DiffRow[]; broughtin: DiffRow[]; changed: DiffRow[] };
export type SnapDoc = { sections: Record<string, unknown>[]; meta?: Record<string, unknown>; [k: string]: unknown };
export type HistoryEntry = {
  id: string;
  name: string;
  auto: string | null;
  at: string;
  words: number;
  doc: SnapDoc;
  chop?: { op: string; a: string; b: string };
};
/** 1.0's global state, as far as these functions read it. */
export type State = Record<string, unknown> & { meta: Record<string, unknown>; sections: Record<string, unknown>[]; history?: HistoryEntry[] };

export type Closure = {
  api: ClosureApi;
  setState: (s: State) => void;
  getState: () => State;
  arrive: (s: Record<string, unknown>) => State;
  names: readonly string[];
};

type T = (key: string, params?: Record<string, unknown>) => string;
let currentT: T = (k) => k;
/** The studio's t(), for 1.0's code (the History labels, section names). */
export function setClosureT(t: T): void {
  currentT = t;
}

const UNTITLED: readonly string[] = (meta as { untitledBook?: string[] }).untitledBook ?? [];

let loading: Promise<Closure> | null = null;
let loaded: Closure | null = null;

/** The closure, once loaded (null before). */
export const closureIfLoaded = (): Closure | null => loaded;

/** Load the generated module (its own chunk) and create the studio's closure once. */
export function loadClosure(): Promise<Closure> {
  if (!loading) {
    loading = import('../generated/closure.js').then((m) => {
      const c = m.createClosure({
        state: null,
        toast: () => undefined,
        samplePicsRequire: async () => undefined,
        JSZip: undefined,
        t: (k, p) => currentT(k, p),
        UI_STRINGS: Object.fromEntries(UNTITLED.map((s, i) => [String(i), { 'misc.untitledBook': s }])),
      });
      loaded = { api: c.api as unknown as ClosureApi, setState: c.setState, getState: c.getState, arrive: c.arrive, names: m.CLOSURE_NAMES };
      return loaded;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** 1.0's state for a book-format v1 book (a copy: the book is never touched). */
export function stateFromBook(c: Closure, book: Record<string, unknown>): State {
  const s = epubState(structuredClone(book) as unknown as BookV1, String(book.exportPlatform ?? 'generic'));
  // as the EPUB worker does: the state is 1.0's global first, then arrives (ARRIVE's normalizers read the global state)
  c.setState(s as State);
  return c.arrive(s);
}

/** 1.0's state for the open book: exportBook, then 1.0's state shape. */
export function bookState(c: Closure, ydoc: Y.Doc): { book: Record<string, unknown>; state: State } {
  const book = exportBook(ydoc);
  return { book, state: stateFromBook(c, book) };
}
