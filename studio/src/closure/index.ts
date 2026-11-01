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
   calls them). Wave 1c adds getUiLang (the studio's interface language, set
   by setClosureLang: 1.0's fmtNum and Insights' cache key read it, and the
   extractor may not lift uiLangState), and 1.0's reading desk as one that
   has measured nothing (deskState / deskSignature; the desk is wave 4).
   ClosureLocale keeps t and the language current. */

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
  // wave 1b: the sample book (I8) — its builder lives in the sample chunk (SampleApi, loadSample)
  SAMPLE_IMAGE_FILES: { id: string; name: string; mediaType: string; ext: string; file: string; bytes: number; sha256: string }[];
  SAMPLE_COVER_FILE: { name: string; mediaType: string; ext: string; file: string; bytes: number; sha256: string };
  SAMPLE_WORDS: number;
  SAMPLE_BOOK_ID: string;
  LEGACY_SAMPLE_BOOK_ID: string;
  isSampleBookId: (id: unknown) => boolean;
  SAMPLE_DRAFT_EDITS: { starts?: string; after?: string; then: string }[];
  SAMPLE_DRAFT_SNAP_ID: string;
  histCounted: (doc: unknown, s: unknown, flag: boolean) => { w: number };
  // wave 1c: the arrival sweep of old sample copies
  sampleIsPreRenameCopy: (meta: unknown) => boolean;
  sampleCoverIsStale: (cover: unknown) => boolean;
  sampleHasOldAuthor: () => boolean;
  sampleRenameAuthor: () => void;
  SAMPLE_COVER_STALE: { len: number; sha1: string }[];
  SAMPLE_OLD_AUTHOR: string;
  SAMPLE_AUTHOR: string;
  SAMPLE_PRE_RENAME_ID: string;
  bookIdsOf: (meta: unknown) => string[];
  bookIdMigrated: (id: string) => string;
  // wave 1c task 5: BEUK:localpics
  picSwap: (v: unknown, swap: (data: string) => string | null) => unknown;
  picIsRef: (s: unknown) => boolean;
  PIC_REF: string;
  CC_LICENCES: Record<string, { name: string; short: string; url: string }>;
  // wave 1c: the quick tour (I7)
  TOUR_STEPS: TourStep[];
  TOUR_KEY: string;
  TOUR_DESK_KEY: string;
  tourDecide: (d: { storage: boolean; stored: string | null; desk: string | null; empty: boolean }) => boolean;
  // wave 1c: Story Insights (C4) and Names on stage (C5)
  computeInsights: () => InsightsData;
  insComputeFor: (sections: unknown[], lang: string) => InsightsData;
  insBuildHtml: (d: InsightsData, ctx: { W: number }) => string;
  insFactValues: (f: InsightsFact) => { words: string; avg: string | null; dlg: string | null; ease: string | null };
  insFactAria: (id: string, lead: string) => string;
  insVarietyInner: (d: InsightsData, ctx: { W: number }) => string;
  insRenderReadability: (d: unknown, ctx: { W: number }) => string;
  insRtl: () => boolean;
  insFrequency: (sections: unknown[], lang: string) => { top: { word: string; count: number }[]; total: number };
  insRhythm: (sections: unknown[]) => { id: string; name: string; short: string; words: number }[];
  insCadence: (sections: unknown[]) => { points: { id: string; avg: number | null }[]; overall: number };
  insEchoes: (sections: unknown[], lang: string) => { phrase: string; count: number; firstId: string; names: string[] }[];
  insDialogueText: (text: string, lang: string) => { dialogue: number; total: number; share: number };
  insDialogue: (sections: unknown[], lang: string) => { rows: unknown[]; dialogue: number; total: number; share: number };
  insCrutch: (sections: unknown[], lang: string) => { rows: { label: string; suffix: boolean; count: number; rate: number }[]; total: number; suffix: string } | null;
  insHistogram: (lens: number[]) => { buckets: { lo: number; hi: number; count: number }[]; total: number; median: number; p90: number; mode: number };
  insVariety: (sections: unknown[]) => { secs: { id: string; lens: number[] }[]; all: number[] };
  insReadability: (sections: unknown[], lang: string) => { points: { score: number | null }[]; overall: number | null } | null;
  insSyllables: (w: string) => number;
  insFlesch: (w: number, s: number, y: number) => number | null;
  insTokens: (text: string) => string[];
  insSentences: (text: string) => number[];
  insBodySections: (sections: unknown[]) => Record<string, unknown>[];
  fmtNum: (n: number) => string;
  esc: (s: unknown) => string;
  castCompute: (sections: unknown[], lang: string, title: unknown) => CastData;
  castVisible: (d: CastData, hidden: unknown) => CastRow[];
  castGridHtml: (rows: CastRow[], d: CastData) => string;
  castNormalizeHidden: (v: unknown) => string[];
  castHash: (s: string, h: number) => number;
  castRateStr: (v: number, lang?: string) => string;
  CAST_MAX_ROWS: number;
  bookLang: () => string;
  // wave 1c: the notebook and research files (C7)
  nbNormalize: (doc: unknown, sections: unknown[], fileIds?: Set<string>) => { notes: Note[] };
  nbLine: (v: unknown, n: number) => string;
  nbPack: () => { notes: Note[] };
  nbHas: () => boolean;
  rsNormalize: (doc: unknown) => { files: ResearchFile[] };
  rsTypeOf: (name: unknown, type: unknown) => string | null;
  rsUrl: (v: unknown) => string;
  rsKinds: () => Record<string, string>;
  rsLimits: () => { file: number; total: number; files: number; perNote: number; textShown: number };
  rsAccept: () => string;
  rsIsRef: (data: unknown) => boolean;
  rsBytesOf: (data: unknown) => number;
  rsKind: (f: unknown) => string;
  rsIcon: (f: unknown) => string;
  rsSize: (b: number) => string;
  rsTabOk: (f: unknown) => boolean;
  rsPackFiles: () => ResearchFile[];
  rsHas: () => boolean;
  rsNamed: () => Set<string>;
  rsTotal: () => number;
  bibleAllEntries: () => { id: string; name?: string }[];
  bibleScan: (text: string, m: unknown) => { hits: { s: number; e: number; id: string }[] };
  bibleMatcherNow: () => unknown;
  bibleName: (e: unknown) => string;
  bibleNormalize: (doc: unknown) => Record<string, unknown>;
  // wave 2a: the insert toolbar's own text edits, run on a stand-in textarea (editor/insert.ts textArea)
  insertAtCursor: (ta: TextAreaLike, text: string, cursorBack?: number) => void;
  wrapSelection: (ta: TextAreaLike, marker: string) => void;
  redactSelection: (ta: TextAreaLike) => boolean;
  applyList: (ta: TextAreaLike, ordered: boolean) => void;
  applyContainer: (ta: TextAreaLike, kind: string) => void;
  applyBlockquote: (ta: TextAreaLike) => void;
  applyAttribution: (ta: TextAreaLike) => void;
  nextFootnoteNumber: (text: string) => number;
  normalizeLinkUrl: (raw: unknown) => string | null;
  MARGIN_OPEN_RE: RegExp;
  isContainerMarkLine: (line: string) => boolean;
  beautifyText: (text: string) => string;
  // wave 2b: pictures (A6-A8) — the marker, the pickers' list, the stock search, the image library
  imageTokensIn: (content: unknown) => ImageToken[];
  parseImageLine: (line: unknown) => ImageToken | null;
  imageTokenText: (t: ImageToken) => string;
  cleanCaption: (v: unknown) => string;
  cleanAlt: (v: unknown) => string;
  imageById: (id: unknown) => BookImage | null;
  sceneEntryAt: (section: unknown, idx: number) => SceneEntry | null;
  editorBlocks: (val: string) => { start: number; end: number; text: string }[];
  SCENE_BREAK_BLOCK_RE: RegExp;
  BACKDROP_STRENGTHS: string[];
  fmtBytes: (n: number) => string;
  pickerImages: () => BookImage[];
  isFlourishImage: (im: unknown) => boolean;
  cmStockGate: () => 'ok' | 'direct' | 'account';
  stockSearchUrl: (q: string, perPage?: number) => string;
  stockDirectUrl: (q: string, perPage?: number) => string;
  cmMapDirectResults: (json: unknown) => { photos: StockPhoto[] };
  imglibUsageMap: () => Record<string, ImageUse[]>;
  imageUsage: (id: string) => ImageUse[];
  imglibUnused: () => BookImage[];
  imglibIsSample: (im: unknown) => boolean;
  imglibBytes: (im: unknown) => number;
  imglibSize: (n: number) => string;
  imglibName: (im: unknown) => string;
  imglibUseText: (u: ImageUse) => string;
  imglibRemove: (ids: string[]) => ImglibRec | null;
  imglibUndo: (rec: ImglibRec) => boolean;
  IMGLIB_UNDO_MS: number;
  sampleState: { loaded: boolean; loadedJson: string | null };
};
/** A picture of the book's library (state.images[]). */
export type BookImage = { id: string; name: string; mediaType: string; data: string; ext?: string; credit?: { name: string; url: string }; flourish?: boolean };
/** One picture marker in a section's text (1.0's parseImageLine). */
export type ImageToken = { alt: string; id: string; full: boolean; caption: string };
/** A picture at a scene break (section.scenes[]). */
export type SceneEntry = { at: number; imageId: string; name: string; caption: string; alt: string };
/** One use of a picture (1.0's imglibUsageMap). */
export type ImageUse = { role: string; where: string; sectionId?: string; count?: number; themeId?: string };
/** 1.0's removal record (imglibRemove): what its Undo puts back. Held in memory, as 1.0 holds it. */
export type ImglibRec = Record<string, unknown> & { ids: string[]; bookId: string | null; snapId: string | null; used: boolean; bytes: number; undone?: boolean };
/** One stock search result, in the shelf contract shape (1.0's sceneRenderSuggestResults reads these). */
export type StockPhoto = { photographer?: string; photographerUrl?: string; pageUrl?: string; provider?: string; alt?: string; src?: { medium?: string; large?: string; original?: string } };
/** 1.0's textarea, as far as its toolbar functions use it (editor/insert.ts Area). */
export type TextAreaLike = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  scrollLeft: number;
  focus: (o?: unknown) => void;
  setSelectionRange: (a: number, b: number) => void;
  dispatchEvent: (e: unknown) => boolean;
};
export type TourStep = { id: string; title: string; body: string; anchor: number; beside?: boolean; last?: boolean; groups: string[][] };
export type InsightsFact = { name: string; short: string; words: number; avg: number | null; dlg: number | null; ease: number | null };
export type InsightsData = Record<string, unknown> & { totalWords: number; facts: Record<string, InsightsFact>; variety: { secs: { id: string; name: string; lens: number[] }[]; all: number[] }; frequency: { total: number }; lang: string };
export type CastRow = { key: string; name: string; total: number; sections: number; per: number[] };
export type CastData = { caseless: boolean; minCount: number; names: CastRow[]; cols: { id: string; label: string; col: string; words: number }[] };
export type Note = { id: string; title: string; body: string; folder?: string; secs?: string[]; files?: string[]; url?: string; at?: string };
export type ResearchFile = { id: string; name: string; mediaType: string; data: string; bytes: number; at?: string };
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

/** 1.0's top-level lets the studio reads or sets (scripts/extract-closure.mjs VARS). */
export type ClosureVars = { insVarPick: string; insCache: { key: string; d: InsightsData | null; ms: number; hit: boolean }; insFacts: Record<string, InsightsFact> };

/** The sample book's own code (src/generated/closure-sample.js, its own chunk: loadSample). */
export type SampleApi = {
  buildSampleBook: () => Record<string, unknown> & { sections: Record<string, unknown>[]; meta: Record<string, unknown> };
  sampleCoverDoc: () => Record<string, unknown>;
};

export type Closure = {
  api: ClosureApi;
  vars: ClosureVars;
  /** The sample's builder once loadSample() has loaded its chunk (null before). Each call runs against the main
   *  closure's current state. */
  sample: SampleApi | null;
  setState: (s: State) => void;
  getState: () => State;
  arrive: (s: Record<string, unknown>) => State;
  names: readonly string[];
};

type T = (key: string, params?: Record<string, unknown>) => string;
let currentT: T = (k) => k;
let currentLang = 'en';
/** The studio's t(), for 1.0's code (the History labels, section names). */
export function setClosureT(t: T): void {
  currentT = t;
}
/** The interface language 1.0's getUiLang() answers (its number formats, Insights' cache key). */
export function setClosureLang(lang: string): void {
  currentLang = lang;
}
/* 1.0's reading desk (deskState / deskSignature) is wave 4 (E1): until then it has measured nothing, so 1.0's
   insGlancePages shows no page number, its own "still measuring" state (see the wave 1c report). */
const NO_DESK = Object.freeze({ counts: Object.freeze({}), total: 0, sig: '', words: 0, run: null });

/** Wave 2b: what 1.0's image library calls around its own code (BROWSER_SUPPLIED), set by pictures/imagelib.ts for the
 *  call it makes: History's "Before removing a picture" snapshot (2.0's history.ts), and 1.0's local.editSeq (the
 *  counter a run of removals compares, so one snapshot serves a run with no other edit between). */
export const pictureEnv: { autoSnapshot: (kind: string) => unknown; editSeq: () => number } = {
  autoSnapshot: () => null,
  editSeq: () => 0,
};
/** 1.0's `cloud`, as far as cmStockGate reads it: is a shelf there, and who is signed in (pictures/stock.ts probes). */
export const cloudFacts: { available: boolean; user: unknown } = { available: false, user: null };

const UNTITLED: readonly string[] = (meta as { untitledBook?: string[] }).untitledBook ?? [];

let loading: Promise<Closure> | null = null;
let loaded: Closure | null = null;
let share: Record<string, unknown> | null = null;
let sampleLoading: Promise<SampleApi> | null = null;

/** The closure, once loaded (null before). */
export const closureIfLoaded = (): Closure | null => loaded;
/** The main closure's names, as the sub-modules take them (the tests' oracle module, closure-oracle.js). */
export const closureShare = (): Record<string, unknown> | null => share;

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
        getUiLang: () => currentLang,
        deskState: NO_DESK,
        deskSignature: () => '',
        // wave 2b: the image library's surroundings (see pictureEnv); 1.0's redraws after an edit are React's re-render here
        autoSnapshot: (kind: string) => pictureEnv.autoSnapshot(kind),
        local: {
          get editSeq() {
            return pictureEnv.editSeq();
          },
        },
        noteBookEdited: () => undefined,
        imglibRefresh: () => undefined,
        bibleSeriesTouched: () => undefined,
        cloud: cloudFacts,
      });
      share = c.share;
      loaded = { api: c.api as unknown as ClosureApi, vars: c.vars as ClosureVars, sample: null, setState: c.setState, getState: c.getState, arrive: c.arrive, names: m.CLOSURE_NAMES };
      return loaded;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The sample book's code: its own chunk (1.0's 145 kB of sample text), loaded only when the sample is built — Load
 *  sample, and the pre-rename sweep of an old sample copy. Its functions are created afresh for each call from the main
 *  closure's current names and state (closure-sample.js createSample(share)). */
export function loadSample(): Promise<SampleApi> {
  if (!sampleLoading) {
    sampleLoading = Promise.all([loadClosure(), import('../generated/closure-sample.js')]).then(([c, m]) => {
      const api: SampleApi = {
        buildSampleBook: () => m.createSample(share!).buildSampleBook(),
        sampleCoverDoc: () => m.createSample(share!).sampleCoverDoc(),
      };
      c.sample = api;
      return api;
    });
    sampleLoading.catch(() => {
      sampleLoading = null;
    });
  }
  return sampleLoading;
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

/** Keeps the closure's t() and interface language equal to the studio's (1.0's code reads both at call time). */
export function syncClosureLocale(t: T, lang: string): void {
  setClosureT(t);
  setClosureLang(lang);
}
