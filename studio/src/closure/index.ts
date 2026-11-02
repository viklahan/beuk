import type * as Y from 'yjs';
import { exportBook } from '@book/editor/index.js';
import { epubState } from '@book/epub/state.js';
import type { BookV1 } from '@book/schema.js';
import meta from '../generated/strings-meta.json';
import { drawIcons } from '../insights/insights';

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
  bibleAllEntries: () => BibleEntry[];
  bibleScan: (text: string, m: unknown) => { hits: { s: number; e: number; id: string }[]; ambiguous: { s: number; e: number; ids: string[] }[] };
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
  // wave 2c (B3): section types, the matter library, Add Chapter / Add Part, move — 1.0's own, on a book-format state
  retypeSection: (id: string, newType: string, newKind: string) => boolean;
  RETYPE_GROUPS: { kind: string; types: string[] }[];
  TYPE_TITLES: Record<string, string>;
  insertMatter: (type: string) => Record<string, unknown> | null;
  MATTER_LIBRARY: { kind: string; types: string[] }[];
  MATTER_ORDER: Record<string, Record<string, number>>;
  SINGLETON_TYPES: string[];
  moveSection: (id: string, dir: 'up' | 'down') => boolean;
  moveSectionTo: (dragId: string, targetId: string, after: boolean) => boolean;
  addPart: () => Record<string, unknown>;
  addChapter: () => void;
  partGroups: (sections: unknown[]) => { part: Record<string, unknown> | null; items: Record<string, unknown>[] }[];
  // wave 2c (B4): the back-matter starters
  starterText: (id: string, lang: string) => string;
  starterIds: (s: unknown) => string[];
  starterBlanks: (text: unknown) => string[];
  STARTER_TEXT: Record<string, Record<string, string>>;
  STARTER_BLANK_RE: RegExp;
  STARTERS_FOR: Record<string, string[]>;
  starterBlanksInBook: () => { s: Record<string, unknown>; blanks: string[] }[];
  isRtlLang: (code: string) => boolean;
  // wave 2c (B5): the outline board
  OL_STATUSES: string[];
  OL_TAG_COLOURS: number;
  OL_PREFS_KEY: string;
  OL_THREADS_MAX: number;
  OL_FIELDS_MAX: number;
  OL_FIELD_TYPES: string[];
  olFieldValueOk: (f: unknown, v: unknown) => boolean;
  olCleanThread: (n: unknown) => string;
  olTagKey: (n: unknown) => string;
  olCleanTag: (n: unknown) => string;
  olSectionFields: (s: unknown) => Record<string, unknown>;
  olNormalize: (o: unknown, sections: unknown[]) => OlBook;
  olBook: () => OlBook;
  olBookSet: () => boolean;
  olBookPack: () => Record<string, unknown>;
  olTagOf: (name: string) => { name: string; colour: number } | null;
  olUi: OlUi;
  olFilterOn: () => boolean;
  olMatches: (s: unknown) => boolean;
  olItems: () => Record<string, unknown>[];
  olNumLabel: (s: unknown) => string;
  olName: (s: unknown) => string;
  olScenes: (s: unknown) => number;
  olStatusLabel: (st: unknown) => string;
  olKindBounds: (s: unknown) => { first: boolean; last: boolean; pos: number; total: number };
  olSavedMatches: (f: unknown) => boolean;
  olGridSecs: () => Record<string, unknown>[];
  olGridEntries: (per: Record<string, unknown>) => Record<string, unknown>[];
  olSetField: (s: unknown, field: string, value: unknown) => void;
  olAddTag: (s: unknown, raw: unknown) => boolean;
  olRemoveTag: (s: unknown, n: unknown) => boolean;
  olDeleteTag: (name: string) => void;
  olSaveFilter: (name: unknown) => { id: string; name: string } | null;
  olAddThread: (raw: unknown) => { id: string; name: string; colour: number } | null;
  olRenameThread: (id: string, raw: unknown) => boolean;
  olSetThreadNote: (s: unknown, id: string, value: unknown) => void;
  olDeleteThread: (id: string) => void;
  olAddField: (raw: unknown, type: string) => { id: string; name: string; type: string } | null;
  olRenameField: (id: string, raw: unknown) => boolean;
  olSetFieldOptions: (id: string, raw: unknown) => boolean;
  olSetCustom: (s: unknown, id: string, value: unknown) => void;
  olDeleteField: (id: string) => void;
  olApplySaved: (id: string) => boolean;
  bibleMentionsCompute: (sections: unknown[], entries: unknown[], lang: string) => { cols: { id: string; label: string; col: string }[]; per: Record<string, { total: number; counts: number[]; hits: { sec: string; ci: number; s: number; e: number }[] }> };
  bibleTypeLabel: (type: string, plural?: boolean) => string;
  castSecLabel: (s: unknown) => string;
  CAST_STEPS: number[];
  // wave 3a (C2): goals, the streak, the writing log, the Road so far, just-write — 1.0's own, its renderers writing into
  // the room's and the sidebar's ids (src/goals)
  normalizeGoals: (g: unknown) => Goals;
  parseDayStr: (ds: unknown) => Date | null;
  dayStr: (d: Date) => string;
  goalMath: (goals: unknown, total: number, todayWords: number, now: Date) => GoalMathOut;
  goalPlan: (goals: unknown, total: number, todayDone: number, now: Date) => Record<string, unknown> & { state: string };
  goalOnPace: (goals: unknown, total: number, now: Date) => (Record<string, unknown> & { state: string; n: number }) | null;
  goalKept: (book: unknown, fromDs: string, toDs: string) => { a: number; r: number; net: number; from: string | null; partial: boolean; none: boolean; notYet?: boolean };
  goalKeptRange: (period: string, now: Date) => { from: string; to: string };
  goalStreakBridges: (lastDay: string, today: Date, goals: unknown) => boolean;
  goalWritingDaysBetween: (g: unknown, from: Date, to: Date, incl: boolean) => number;
  goalDays: (g: unknown) => number[];
  goalIsWritingDay: (g: unknown, d: Date) => boolean;
  goalPlanLine: (plan: unknown) => string;
  goalPaceLine: (p: unknown) => string;
  goalDailyLine: (d: unknown) => string;
  goalProjectLine: (p: unknown) => string;
  goalDeadlineLine: (dl: unknown, total: number) => string;
  roadPoints: (lenMap: unknown) => { ds: string; day: number; w: number }[];
  roadSegments: (points: unknown[]) => unknown[][];
  roadModel: (points: unknown[], goals: unknown, total: number, now?: Date) => Record<string, unknown> & { points: { ds: string; day: number; w: number }[]; segments: unknown[][]; target: number | null; pace: Record<string, number> | null; ticks: number[] };
  roadGeom: (model: unknown, width: number) => Record<string, unknown>;
  roadSvg: (model: unknown, geom: unknown) => string;
  roadKeyHtml: (model: unknown, m: unknown) => string;
  roadPointLabel: (p: unknown) => string;
  roadLongDate: (day: number) => string;
  wlogObserve: (total: number) => void;
  wlogTick: (now?: number) => void;
  wlogFlush: () => void;
  wlogLoad: () => WriteLog;
  wlogSave: () => void;
  wlogTodayWords: () => number;
  wlogTodayMinutes: () => number;
  wlogBookKey: () => string;
  bookTotalWords: () => number;
  markWritingActivity: () => void;
  renderStreak: () => void;
  saveStreak: () => void;
  loadStreak: () => { streak: number; lastDay: string };
  streakState: { streak: number; lastDay: string };
  STREAK_KEY: string;
  WLOG_KEY: string;
  goalStreakNow: () => number;
  goalJustWrite: () => boolean;
  goalSetJustWrite: (on: boolean) => void;
  goalClearTracking: () => void;
  goalAskClearTracking: () => Promise<boolean>;
  goalEnsureStart: () => void;
  goalsApply: (next: Record<string, unknown>) => void;
  commitGoals: () => void;
  renderGoalLines: () => void;
  renderGoalsProgress: () => void;
  renderGoalKept: () => void;
  renderGoalCalendar: () => void;
  renderGoalRoad: () => void;
  roadShow: (idx: number, announce: boolean) => void;
  roadHide: () => void;
  roadNearest: (clientX: number) => number;
  syncGoalInputs: () => void;
  goalsRenderRoom: () => void;
  // wave 3a (A11): Zen — 1.0's own, building its layers in the page (src/environment)
  setZenMode: (on: boolean) => void;
  zenSettle: () => void;
  zenSoundStart: () => Promise<unknown>;
  zenSoundStop: () => void;
  zenSoundSetScene: (name: string) => void;
  zenSoundPref: () => boolean;
  zenScenePref: () => string;
  zenSoundGraph: () => Record<string, unknown> | null;
  zenSoundUrl: (scene: string) => string;
  zenSceneMigrate: (v: unknown) => string;
  zenSound: Record<string, unknown> & { status: string; playing: boolean; ctx: unknown; settle: Promise<unknown> | null };
  zenStep: (d: number) => void;
  zenGoTo: (id: string) => void;
  zenIndexClose: () => void;
  zenRenderSurface: () => void;
  zdPhase: () => number;
  zdSetPhase: (p: number) => void;
  zdSetClock: (fn: (() => number) | null) => void;
  zdTick: () => void;
  zdLight: (theme: string, p: number) => Record<string, unknown>;
  zdBody: (night: boolean, p: number) => { x: number; y: number; op: number; glint: number };
  zdVisibility: () => void;
  ZEN_PAINTINGS: { id: string; name: string }[];
  zenPaintPref: () => string;
  ZEN_SCENES: string[];
  ZEN_SOUND_FILES: Record<string, { file: string; pad: number; loop: number }>;
  // wave 3a (A10, A9): Read Aloud, dictation and the language bar
  raTogglePop: () => void;
  raClosePop: () => void;
  raPlay: () => void;
  raPause: () => void;
  raStop: () => void;
  raRefresh: () => void;
  raLangVoices: () => { name: string; lang: string; voiceURI: string }[];
  raSuggested: (voices?: unknown[]) => { female: unknown; male: unknown };
  raLang: () => string;
  raSupported: () => boolean;
  ra: { status: string; chunks: string[]; idx: number; sectionId: unknown; session: number; voiceSel: string; langFor: Record<string, string>; sugDismissed: Record<string, boolean> };
  raBuildChunks: () => { id: unknown; chunks: string[] };
  raCleanText: (raw: unknown) => string;
  raChosenVoice: () => unknown;
  raSyncUi: () => void;
  tbPlaceRaPop: () => void;
  dictToggle: (anchor?: unknown) => void;
  dictBegin: () => void;
  dictStop: () => void;
  dictDiscard: () => void;
  dictOpenLangPicker: (anchor?: unknown) => void;
  dictPopClose: () => void;
  dictSyncUi: () => void;
  dictLangInfo: () => { lang: string; fallback: boolean; book: string; code: string; chosen: boolean };
  dictSetLang: (code: string) => boolean;
  dictSupported: () => boolean;
  dict: Record<string, unknown> & { want: boolean; seen: boolean; applying: boolean; spanStart: number; gen: number; rec: unknown };
  DICT_SEEN_KEY: string;
  dictOnLangChange: () => void;
  dictNormalize: (d: unknown) => { lang: string; recent: string[] };
  langBarRefresh: () => void;
  langBarLater: () => void;
  langSugReset: () => void;
  raLangSugRender: () => void;
  langSetBookLanguage: (code: string) => boolean;
  langSuggestion: () => { kind: string; code: string; sectionId?: string } | null;
  langSug: { dismissed: Record<string, boolean>; timer: unknown; last: { kind: string; code: string; sectionId?: string } | null };
  detectLanguageInText: (text: string) => { code: string; strong: boolean } | null;
  langDisplayName: (code: string) => string;
  dictLangChoices: () => string[];
  DICT_LANGS: Record<string, string>;
  zenFoldSync: (s: unknown) => void;
  // wave 3b (C6): the Covenant — 1.0's own model, room, card, change marking and series (src/covenant)
  BIBLE_TYPES: string[];
  BIBLE_MAX: number;
  BIBLE_FORMAT: string;
  BIBLE_CHANGE_MAX: number;
  BIBLE_MARKS_KEY: string;
  BIBLE_NEAR: number;
  bibleKey: (s: unknown) => string;
  bibleBuildMatcher: (entries: unknown[], lang: string) => BibleMatcher | null;
  bibleNormalizeEntry: (e: unknown) => BibleEntry | null;
  bibleNormalizeAnchor: (a: unknown) => Record<string, unknown> | null;
  bibleAnchorMake: (secId: string, start: number, end: number) => { sec: string; quote: string; at: number } | null;
  bibleAnchorFind: (anchor: unknown, sections: unknown[]) => { sec: string; at: number } | null;
  bibleStateAt: (entry: unknown, pos: unknown, resolve: (c: unknown) => unknown) => { now: unknown; facts: Record<string, string>; past: unknown[]; later: unknown[]; unordered: unknown[]; orphans: unknown[] };
  bibleResolveChange: (c: unknown) => unknown;
  bibleCursorPos: () => number[] | null;
  biblePos: (book: number, sec: number, at: number) => number[];
  bibleEntries: () => BibleEntry[];
  bibleHas: () => boolean;
  bibleById: (id: unknown) => BibleEntry | null;
  bibleListOf: (id: string) => BibleEntry[];
  bibleHomeDoc: () => { entries: BibleEntry[]; fields?: Record<string, unknown> };
  bibleFieldDefs: (type: string) => { id: string; label: string }[];
  bibleMentions: () => { cols: { id: string; label: string; col: string }[]; per: Record<string, { total: number; counts: number[]; hits: { sec: string; ci: number; s: number; e: number }[]; ambiguous: number }>; ambiguous: number };
  bibleUi: { sel: string | null; mode: string; query: string; detail: boolean; menTimer: unknown; saveTimer: unknown; filter: string; merge: unknown };
  bibleTouched: (matching: boolean) => void;
  bibleBookArrived: () => void;
  bibleOnLangChange: () => void;
  bibleRender: () => void;
  bibleRenderList: () => void;
  bibleRenderEntry: () => void;
  bibleRenderMentions: () => void;
  bibleRenderSeed: () => void;
  bibleRenderFields: () => void;
  bibleRenderMerge: () => void;
  bibleRenderSeriesLine: () => void;
  bibleStatus: (msg: string) => void;
  bibleNewEntry: () => BibleEntry | null;
  bibleDelete: (id: string | null) => void;
  bibleOnField: (el: Element) => void;
  bibleOnFact: (el: Element) => void;
  bibleRenameField: (type: string | null, id: string | null, label: string) => boolean;
  bibleAddField: (type: string, label: string) => string | null;
  bibleAddLink: (id: string, to: string, label: string) => boolean;
  bibleRemoveLink: (id: string, i: number) => boolean;
  bibleRemoveChange: (entryId: string | null, cid: string | null) => boolean;
  bibleRemoveFieldUndoable: (type: string | null, id: string | null) => boolean;
  bibleApplyTemplate: (name: string | null) => void;
  bibleRefreshMore: (e: unknown, focusSel?: string) => void;
  bibleRefreshCard: (e: unknown) => void;
  bibleSetFact: (id: string, field: string | null, value: string) => void;
  bibleSeedAdd: () => BibleEntry[];
  bibleSeedSync: () => void;
  bibleSeedCandidates: () => { caseless: boolean; hidden: number; list: { key: string; name: string; total: number; taken: boolean }[] };
  bibleSetMarks: (on: boolean) => void;
  bibleMarksOn: () => boolean;
  bibleExportDoc: () => Record<string, unknown> & { entries: BibleEntry[] };
  bibleExportName: () => string;
  bibleExport: () => void;
  bibleImportDoc: (doc: unknown) => { ok: boolean; added: BibleEntry[]; skipped: string[]; pics: number };
  bibleImportReport: (r: unknown) => string;
  bibleCardEl: () => HTMLElement;
  bibleCardHtml: (e: unknown) => string;
  bibleMarkOffered: (hits: { s: number; e: number; id: string }[], start: number, end: number) => BibleEntry[];
  bibleMarkChange: (entryId: string, secId: string, start: number, end: number, text: string, fact?: unknown) => Record<string, unknown> | null;
  bibleMarkOpen: (entryId: string | null, pt: { x: number; y: number } | null) => void;
  bibleMarkSave: () => void;
  bibleMarkClose: (refocus: boolean) => void;
  bibleMarkMenuEl: () => HTMLElement;
  bibleMarkHideMenu: () => void;
  bibleMarkPlace: (el: HTMLElement, pt: { x: number; y: number } | null) => void;
  bibleMark: { sec: string | null; start: number; end: number; id: string | null; names: string[]; pt: { x: number; y: number } | null; top: number; scroll: number };
  bibleDotsCompute: (val: string) => { at: number; eid: string; cid: string; title: string }[];
  bibleCountsNow: () => void;
  bibleCountsHeld: () => boolean;
  bibleInSeries: () => boolean;
  bibleSeriesKey: (name: unknown) => string;
  bibleShelfScan: () => unknown;
  bibleSeriesRefresh: (force: boolean) => unknown;
  bibleSeriesSet: (s: unknown, userId?: unknown, dirty?: boolean, kept?: unknown) => void;
  bibleSeriesSync: Record<string, unknown> & { userId: unknown; dirty: boolean; pending: number; conflict: unknown; timer: unknown; stepTimer: unknown; syncedJson: string | null; refused: number; running: boolean };
  bibleSeriesNet: { fetch: (path: string, opts: Record<string, unknown>) => unknown; store: (rec: unknown) => unknown; load: (userId: unknown, key: string) => unknown; pref: (uid: unknown, v?: unknown) => unknown; ask: (spec: unknown) => unknown };
  bibleSeriesMem: Record<string, unknown> & { user: unknown; gone: string[]; dismissed: string[]; shelf: Record<string, unknown>; absent: string | null };
  bibleSeriesTouched: () => void;
  bibleSeriesStep: () => void;
  bibleSeriesSaveNow: () => unknown;
  bibleSeriesFlush: () => void;
  bibleSeriesSignOut: () => void;
  bibleSeriesForget: (uid: unknown) => void;
  bibleAuthSignedOut: (me: unknown) => boolean;
  bibleSeriesResolve: (choice: string) => boolean;
  bibleSeriesRaise: () => void;
  bibleSeriesFlushOnHide: () => void;
  bibleJoinStart: () => unknown;
  bibleJoinDismiss: () => void;
  bibleJoinOffered: () => number;
  bibleJoinMembers: () => Record<string, unknown>[];
  bibleMergePlan: (books: unknown[]) => unknown;
  bibleMergeSave: () => unknown;
  bibleSetOnlyBook: (id: string, on: boolean) => unknown;
  bibleSeriesLeave: (next: string) => unknown;
  bibleSeriesRename: (name: string) => unknown;
  bibleSeriesChangeAsk: (name: string) => boolean;
  bibleSeriesSettingsNote: () => void;
  bibleSeriesFree: () => unknown;
  // wave 4a (D1, D2): the Style tab and the theme creator — 1.0's own, drawing into the tab's ids (src/style)
  PRESETS: Preset[];
  ORNAMENTS: { id: string; name: string; body: string }[];
  ornamentSvg: (id: string, cls?: string) => string;
  renderStudio: () => void;
  syncStudioControls: () => void;
  initStudio: () => void;
  customTheme: () => void;
  renderFlourishes: () => void;
  flourishImages: () => BookImage[];
  handleFlourishFile: (file: Blob | null | undefined) => void;
  removeFlourishImage: (id: string) => void;
  renderMyThemes: () => void;
  applyCustomTheme: (id: string) => void;
  duplicateCustomTheme: (id: string) => void;
  deleteCustomTheme: (id: string) => void;
  tcBaseOptions: () => string;
  openThemeCreator: (id: string | null) => void;
  closeThemeCreator: () => void;
  tcReseedFromBase: () => void;
  buildCreatorControls: () => void;
  fillCreatorControls: () => void;
  tcSet: (key: string, prop: string, val: unknown) => void;
  renderTcPreview: () => void;
  saveThemeCreator: () => void;
  renderFonts: () => void;
  fontFamilyFromFile: (name: string) => string;
  handleFontFile: (file: Blob | null | undefined) => void;
  removeUploadedFont: (id: string) => void;
  fillFontSelects: () => void;
  refreshFontPickers: () => void;
  registerUploadedFont: (f: unknown) => Promise<boolean>;
  registerAllFonts: () => void;
  fontOptionsHtml: (list: string[]) => string;
  uploadedFonts: () => BookFont[];
  normalizeCustomTheme: (ct: unknown) => CustomTheme | null;
  normalizeCustomFont: (f: unknown) => BookFont | null;
  normalizeCoverRecipe: (r: unknown) => Record<string, unknown>;
  normalizeHeaderDesign: (hd: unknown, theme?: unknown) => Record<string, unknown> | null;
  defaultHeaderDesign: (theme: unknown) => Record<string, unknown>;
  COLOUR_ACCENTS: { id: string; hex: string }[];
  COLOUR_TINTS: { id: string; hex: string }[];
  bookColour: () => { accent: string; tint: string; printBlack?: boolean };
  bookColourSet: () => boolean;
  bookColourNormalize: (c: unknown) => { accent: string; tint: string; printBlack?: boolean };
  bookColourCheck: (kind: string, hex: string, base?: unknown) => { ok: boolean; key: string; params: Record<string, unknown>; next?: Record<string, unknown> };
  setBookColour: (kind: string, hex: string) => { ok: boolean; key: string };
  setBookPrintBlack: (on: boolean) => boolean;
  renderBookColour: () => void;
  initBookColour: () => void;
  BODY_FONTS: string[];
  HEAD_FONTS: string[];
  ALL_LIBRARY_FONTS: string[];
  TEXT_HEAD_FONTS: string[];
  DISPLAY_FONTS: { family: string; dir: string; file: string; sha256: string; script: boolean }[];
  HD_KEYS: string[];
  FLOURISH_PREFIX: string;
};
/** One of 1.0's built-in themes (PRESETS). */
export type Preset = { id: string; genre: string; name: string; desc: string; sampleHead: string; sampleBody: string; theme: Record<string, unknown> };
/** A theme the writer saved (state.customThemes[], normalizeCustomTheme). */
export type CustomTheme = { id: string; name: string; theme: Record<string, unknown> };
/** A face the writer uploaded (state.fonts[], normalizeCustomFont). */
export type BookFont = { id: string; name: string; family: string; ext: 'ttf' | 'otf'; mediaType: string; data: string };
/** 1.0's Covenant entry, normalised (bibleNormalizeEntry). */
export type BibleEntry = { id: string; type: string; name: string; aliases: string[]; description: string; notes: string; imageId: string | null; tags: string[]; exactCase: boolean; exclude: string[]; facts?: Record<string, string>; links?: { to: string; label: string }[]; changes?: { id: string; anchor: { sec: string; quote: string; at: number; book?: string; pos?: number[] }; text: string; fact?: { field: string; value: string } }[]; ai?: string; scope?: string };
/** 1.0's matcher (bibleBuildMatcher): the names' regex, the exclusions' regex and their tables. */
export type BibleMatcher = { re: RegExp; exRe: RegExp | null; terms: Map<string, unknown>; ex: Map<string, unknown> };
/** 1.0's state.goals, normalised (normalizeGoals). */
export type Goals = { daily: number; project: number; deadline: string; days?: number[]; dlDay?: boolean; auto?: boolean; start?: { day: string; w: number } };
export type GoalMathOut = { has: boolean; daily: Record<string, unknown> | null; project: Record<string, unknown> | null; deadline: (Record<string, unknown> & { pace: number | null }) | null; plan: Record<string, unknown> | null; pace: Record<string, unknown> | null };
/** 1.0's writing log (beuk.writelog.v1). */
export type WriteLog = { days: Record<string, { w: number | null; s: number; seed?: number }>; base: number | null; baseDay: string; len: Record<string, Record<string, number>>; ar: Record<string, { from: string; days: Record<string, { a: number; r: number }> }> };
/** 1.0's state.outline, normalised (olNormalize). */
export type OlTag = { name: string; colour: number };
export type OlFilter = { id: string; name: string; status: string[]; tags: string[] };
export type OlThread = { id: string; name: string; colour: number };
export type OlField = { id: string; name: string; type: 'text' | 'check' | 'list' | 'date'; options?: string[] };
export type OlBook = { tags: OlTag[]; filters: OlFilter[]; threads: OlThread[]; fields: OlField[] };
/** 1.0's olUi: the board's view state (per device, never in the book). */
export type OlUi = { view: 'cards' | 'list' | 'grid'; matter: boolean; status: string[]; tags: string[]; savedId: string | null; focus: unknown; tagsOpen: boolean; fieldsOpen: boolean; renderQueued: boolean };
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
export type ClosureVars = {
  insVarPick: string;
  insCache: { key: string; d: InsightsData | null; ms: number; hit: boolean };
  insFacts: Record<string, InsightsFact>;
  // wave 3a: the writing log, its clock and the Goals room's view state
  wlog: WriteLog;
  wlogRebase: boolean;
  wlogLastTick: number | null;
  wlogFgOverride: boolean | null;
  goalJustWriteCache: boolean | undefined;
  goalKeptPeriod: string;
  goalCalCursor: Date | null;
  roadState: { model: unknown; geom: unknown; px: number[]; idx: number; width: number };
  zenTransitioning: boolean;
  zenReducedOverride: boolean | null;
  zdHiddenOv: boolean | null;
  dictCtorOverride: unknown;
  currentCenterTab: string;
  zdTimer: unknown;
  zdStart: number | null;
  // wave 3b: the section 1.0's editor shows, the series Covenant in hand and the entries' version counter
  editorSyncedSectionId: string | null;
  bibleSeries: (Record<string, unknown> & { key: string; name: string; doc: { entries: BibleEntry[]; fields?: Record<string, unknown> }; revision: number | null }) | null;
  bibleAllVer: number;
  bibleSeriesArriveTimer: unknown;
  // wave 4a: the theme creator's draft (null: closed) and the font pickers' signature
  tcDraft: { id: string | null; name: string; theme: Record<string, unknown>; header: Record<string, unknown> } | null;
  fontPickerSig: string | null;
};

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
/** The studio's t() as 1.0's code reads it now. */
export const closureT = (): T => currentT;
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
/** Wave 2c: what 1.0's structure and outline functions call around their own code (BROWSER_SUPPLIED): selectSection
 *  (2.0 selects the section once the change is written) and toast (with 1.0's action: an outline Undo). Set by
 *  src/structure/structure.ts for the call it makes. */
export const structEnv: { select: (id: string) => void; toast: (msg: string, icon?: string, action?: { label: string; ms?: number; onClick: () => void }) => void } = {
  select: () => undefined,
  toast: () => undefined,
};
/** Wave 3a adds what 1.0's streak reads of `cloud`: the server's streak (signed in) and when the last heartbeat went. */
/** Wave 3a: 1.0's page as Zen, Read Aloud and dictation reach it (BROWSER_SUPPLIED `$`, activeSection, setCenterTab,
 *  closeUiLangMenu), filled in by src/environment/page.ts; before that, `$` is plain getElementById. */
export const pageEnv: { $: (id: string) => unknown; activeSection: () => unknown; setCenterTab: (tab: string) => void; closeUiLangMenu: () => void } = {
  $: (id) => (typeof document === 'undefined' ? null : document.getElementById(id)),
  activeSection: () => null,
  setCenterTab: () => undefined,
  closeUiLangMenu: () => undefined,
};
export const cloudFacts: { available: boolean; user: unknown; serverStreak: unknown; lastHeartbeatAt: number } = { available: false, user: null, serverStreak: null, lastHeartbeatAt: 0 };
/** Wave 3b (C6): what 1.0's Covenant code reaches around its own (BROWSER_SUPPLIED), filled in by src/covenant: the
 *  shelf's transport (1.0's apiFetch), the room's open (2.0's Dialog), and the desk mirror's entry points — 2.0 draws
 *  the marks as ProseMirror decorations, so a redraw, the card's hide and a line's height are 2.0's own. */
export const covEnv: {
  apiFetch: (path: string, opts?: Record<string, unknown>) => unknown;
  openBible: (id?: string) => void;
  deskRender: (force?: boolean) => void;
  deskSchedule: () => void;
  cardHide: () => void;
  offsetY: (area: unknown, offset: number) => number;
} = {
  apiFetch: () => null,
  openBible: () => undefined,
  deskRender: () => undefined,
  deskSchedule: () => undefined,
  cardHide: () => undefined,
  offsetY: () => 0,
};
/** 1.0's `net` (net.online), as the series Covenant reads it. */
const netFacts = {
  get online() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  },
};
/** 1.0's uiLangState as its caches key on it (`h + ":" + uiLangState`): read live, so a language change is a new key. */
const uiLangLive = {
  toString: () => currentLang,
  valueOf: () => currentLang,
};
/** Wave 3a: what 1.0's goals and streak code call around their own code (BROWSER_SUPPLIED), set by src/goals/goals.ts:
 *  noteBookEdited (1.0 saves the book: 2.0 writes 1.0's state.goals to the Y meta map, goals.ts goalsRun), the shelf's
 *  heartbeat (streak.ts) and the calm confirm (2.0's useConfirm, for Clear tracking data). */
export const writeEnv: { noteBookEdited: () => void; heartbeat: () => void; confirm: (o: Record<string, unknown>) => Promise<unknown> } = {
  noteBookEdited: () => undefined,
  heartbeat: () => undefined,
  confirm: async () => false,
};
/** 1.0's fmtDateIntl (it reads uiLangState, which the browser studio never lifts): the same call, with the studio's
 *  interface language. */
export function fmtDateIntl(d: Date): string {
  try {
    return new Intl.DateTimeFormat(currentLang, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** Wave 4a (D1): what 1.0's Style tab code reaches around its own: `run` puts a callback of the page's FileReader (1.0's
 *  flourish and font uploads read their file, then edit the book's state) inside the Style tab's session; set by
 *  src/style/session.ts. */
export const styleEnv: { run: (fn: () => void) => void } = { run: (fn) => fn() };
/** The browser's FileReader, its load / error callbacks run through styleEnv.run (undefined where there is none). */
function sessionFileReader(): unknown {
  const Base = (globalThis as { FileReader?: typeof FileReader }).FileReader;
  if (!Base) return undefined;
  const wrap = (fn: unknown, self: FileReader) =>
    typeof fn === 'function' ? (e: ProgressEvent<FileReader>) => styleEnv.run(() => (fn as (e: ProgressEvent<FileReader>) => void).call(self, e)) : fn;
  const desc = (k: string) => Object.getOwnPropertyDescriptor(Base.prototype, k);
  const onload = desc('onload'), onerror = desc('onerror');
  class SessionFileReader extends Base {
    set onload(fn: ((this: FileReader, e: ProgressEvent<FileReader>) => unknown) | null) {
      onload?.set?.call(this, wrap(fn, this) as never);
    }
    get onload() {
      return (onload?.get?.call(this) ?? null) as never;
    }
    set onerror(fn: ((this: FileReader, e: ProgressEvent<FileReader>) => unknown) | null) {
      onerror?.set?.call(this, wrap(fn, this) as never);
    }
    get onerror() {
      return (onerror?.get?.call(this) ?? null) as never;
    }
  }
  return SessionFileReader;
}

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
        toast: (msg: string, icon?: string, action?: { label: string; ms?: number; onClick: () => void }) => structEnv.toast(msg, icon, action),
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
        noteBookEdited: () => writeEnv.noteBookEdited(),
        imglibRefresh: () => undefined,
        cloud: cloudFacts,
        // wave 2c: 1.0's redraws after a structural edit are React's re-render from the Y.Doc; selectSection see structEnv
        renderSidebar: () => undefined,
        syncEditor: () => undefined,
        renderPreview: () => undefined,
        updateStats: () => undefined,
        refreshExportTree: () => undefined,
        selectSection: (id: string) => structEnv.select(id),
        olRender: () => undefined,
        // wave 3a: the streak's heartbeat, the calm confirm, 1.0's icons() and fmtDateIntl
        cloudHeartbeat: () => writeEnv.heartbeat(),
        cloudConfirm: (o: Record<string, unknown>) => writeEnv.confirm(o),
        icons: () => drawIcons(document),
        fmtDateIntl,
        // wave 3a (A9-A11): the page 1.0's Zen, Read Aloud and dictation code reaches (src/environment/page.ts)
        $: (id: string) => pageEnv.$(id),
        activeSection: () => pageEnv.activeSection(),
        setCenterTab: (tab: string) => pageEnv.setCenterTab(tab),
        closeUiLangMenu: () => pageEnv.closeUiLangMenu(),
        // wave 3b (C6): the Covenant's surroundings (covEnv, src/covenant)
        apiFetch: (path: string, opts?: Record<string, unknown>) => covEnv.apiFetch(path, opts),
        net: netFacts,
        cloudDirty: false,
        uiLangState: uiLangLive,
        openBible: (id?: string) => covEnv.openBible(id),
        olOnStructure: () => undefined,
        bibleDeskRender: (force?: boolean) => covEnv.deskRender(force),
        bibleDeskSchedule: () => covEnv.deskSchedule(),
        bibleCardHide: () => covEnv.cardHide(),
        bibleOffsetY: (area: unknown, offset: number) => covEnv.offsetY(area, offset),
        // wave 4a (D1): the chapter-art pickers' redraw (React's re-render) and the page's FileReader, whose callbacks run
        // in the Style tab's session (styleEnv.run, src/style/session.ts)
        refreshImagePickers: () => undefined,
        FileReader: sessionFileReader(),
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
