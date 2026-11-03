import { META, exportBook, getMetaValue } from '@book/editor/index.js';
import type * as Y from 'yjs';
import { closureIfLoaded, closureShare, covEnv, exportEnv, loadClosure, structEnv, type Closure, type State } from '../closure/index';
import { setMeta } from '../book/hooks';
import { desk } from '../environment/page';
import { placeKey } from '../notebook/notebook';
import { styleSettle } from '../style/session';
import { exportSafe } from './safe';

/* Step 5 wave 5a (inventory F1, F7, F8): the export's data side — 1.0's state of the open book, as the export reads it.

   Everything the export modal runs is 1.0's own code, lifted into the browser closure (scripts/extract-closure.mjs):
   the presets and the package tree, epubFiles (the package the inspector shows, the validator checks and the audit
   reads), buildEpub (the store-ready download: POST /api/epub with 1.0's own serializeBook of the book), Markdown and
   standalone HTML. It runs on 1.0's state of the open book, built here from exportBook (book format v1, what readBook
   reads) by the lines of 1.0's applyBookDoc that fill the keys serializeBook writes — in applyBookDoc's order, with
   1.0's own normalizers — so 1.0's serializeBook (closure-serialize.js) writes, for the same book, the body 1.0 sends
   (constraint 51: the e2e compares the two bodies byte for byte for every fixture). The server's EPUB arrival
   (src/book/epub/closure.ts ARRIVE) is the same kind of re-typed applyBookDoc subset, held to 1.0 by its parity test.

   Then the corrections (constraint 53, src/export/safe.ts): the book values 1.0's export code writes unescaped are
   corrected or hidden in this state only — the preview's corrections (the Style session's sourceSafe) and the ones the
   export alone needs — so the package the modal builds, the files it downloads and the book it sends carry no script,
   handler or remote request. The book itself is never changed by them.

   One state per session (as the Style session's): while the book does not change and nothing else set a state into the
   shared closure, the next call runs on the very same state. A call writes back one key only — exportPlatform, the
   preset chosen (1.0's renderPlatformPresets sets state.exportPlatform; serializeBook writes it) — and only when its
   value changed in the call (constraint 54). */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 1.0's applyBookDoc, the lines that fill what serializeBook and the export read, on a fresh state (a book arriving on
 *  an empty desk: no History, box set or import of the desk's carries over). `book` is book format v1 and is not
 *  touched. The state is the closure's global while the lines run (1.0's imSetSource, castSetHidden and
 *  normalizeCoverRecipe read it). */
export function arriveForExport(c: Closure, book: Rec): State {
  const a = c.api;
  const doc = structuredClone(book) as Rec;
  const s = {} as State & Rec;
  c.setState(s);
  const arrMeta: Rec = isRec(doc.meta) ? (doc.meta as Rec) : {};
  const baseMeta = a.bookMetaDefaults();
  delete baseMeta.langSource;
  delete baseMeta.langGuess;
  s.meta = Object.assign(baseMeta, arrMeta);
  if (!s.meta.bookId) s.meta.bookId = a.newBookId();
  a.bookSeriesNumberInto(s.meta, arrMeta.seriesNumber);
  {
    const lg = a.bookIdNormalizeLegacyList(arrMeta.legacyBookIds);
    if (lg.length) s.meta.legacyBookIds = lg;
    else delete s.meta.legacyBookIds;
  }
  for (const f of ['title', 'subtitle', 'author']) a.imSetSource(f, arrMeta[f + 'Source']);
  a.castSetHidden(arrMeta.castHidden);
  a.rightsNormalizeInto(s.meta, arrMeta);
  if (!a.LANG_PACKS[s.meta.language as string]) s.meta.language = 'en';
  if (s.meta.langSource !== 'manual' && s.meta.langSource !== 'auto') s.meta.langSource = s.meta.language !== 'en' ? 'manual' : 'auto';
  if (typeof s.meta.langGuess !== 'string') s.meta.langGuess = '';
  const preset0 = a.PRESETS[0]!;
  if (!doc.theme) s.theme = Object.assign({}, preset0.theme);
  else {
    const th = doc.theme as Rec;
    const theme = Object.assign({}, preset0.theme, th) as Rec;
    theme.header = th.header ? a.normalizeHeaderDesign(th.header, theme) : null;
    if (!theme.header) delete theme.header;
    theme.bodyFont = a.bodyFaceOf(theme.bodyFont);
    s.theme = theme;
  }
  s.activePreset = doc.activePreset || (doc.theme ? null : preset0.id);
  s.bookColour = a.bookColourNormalize(doc.colour);
  const bc = s.bookColour as Rec;
  if (!bc.accent && !bc.tint) s.bookColour = undefined;
  if (Array.isArray(doc.sections) && doc.sections.length) {
    s.sections = doc.sections.map((x) => a.normalizeSection(x));
    s.activeId = s.sections.some((x) => x.id === doc.activeId) ? doc.activeId : (s.sections.find((x) => x.type === 'chapter') || s.sections[0])!.id;
  } else {
    const e = a.buildEmptyBook();
    s.sections = e.sections;
    s.activeId = e.activeId;
  }
  s.cover = doc.cover || null;
  s.fonts = Array.isArray(doc.fonts) ? doc.fonts.map((f) => a.normalizeCustomFont(f)).filter(Boolean) : [];
  s.coverRecipe = doc.coverRecipe ? a.normalizeCoverRecipe(doc.coverRecipe) : null;
  s.outline = a.olNormalize(doc.outline, s.sections);
  s.images = Array.isArray(doc.images) ? doc.images : [];
  s.research = a.rsNormalize(doc.research);
  s.customThemes = Array.isArray(doc.customThemes) ? doc.customThemes.map((x) => a.normalizeCustomTheme(x)).filter(Boolean) : [];
  arrivePrint(c, doc, s);
  if (doc.exportPlatform) s.exportPlatform = doc.exportPlatform;
  s.storeCheck = a.normalizeStoreCheck(doc.storeCheck);
  s.goals = a.normalizeGoals(doc.goals);
  // History: 1.0's buildEpub deletes history and historyPool from the body it sends (and the package never reads it),
  // so the export's state holds none — no unpacking of a large History per session
  s.history = [];
  s.importReport = a.normalizeImportReport(doc.importReport);
  s.audio = a.acxNormalize(doc.audio);
  s.manuscript = a.msNormalize(doc.manuscript);
  s.dictation = a.dictNormalize(doc.dictation);
  s.bible = a.bibleNormalize(doc.bible);
  s.notebook = a.nbNormalize(doc.notebook, s.sections, new Set(((s.research as Rec).files as { id: string }[]).map((f) => f.id)));
  // 1.0's session-only fields the export code reads
  s.boxSetVolumes = [];
  s.page = 1;
  return s;
}

/** Wave 5b (constraint 58): the print settings as 1.0's serializeBook writes them, in its order. */
export const PRINT_KEYS = ['printTrim', 'printRecto', 'printLargePrint', 'printPictureBook', 'printBleed', 'printMarginMode', 'printCustomMargins', 'printHeadContent', 'printHeadPlace',
  'printOmitChapterHead', 'printOmitBlankHead', 'printFolio', 'printNotes'] as const;
/** serializeBook's own lines for the print keys (client/index.html serializeBook: printPictureBook and printBleed as
 *  booleans, the custom margins copied). */
export function printSerialized(st: Rec): Rec {
  return {
    printTrim: st.printTrim,
    printRecto: st.printRecto,
    printLargePrint: st.printLargePrint,
    printPictureBook: !!st.printPictureBook,
    printBleed: !!st.printBleed,
    printMarginMode: st.printMarginMode,
    printCustomMargins: Object.assign({}, st.printCustomMargins),
    printHeadContent: st.printHeadContent,
    printHeadPlace: st.printHeadPlace,
    printOmitChapterHead: st.printOmitChapterHead,
    printOmitBlankHead: st.printOmitBlankHead,
    printFolio: st.printFolio,
    printNotes: st.printNotes,
  };
}
/** 1.0's applyBookDoc, its print lines (bookPrintDefaults, then each stored value it takes, with its clamps: a custom
 *  margin 0–3 in, picture book never beside large print, notes "page" or "end"), into `s`. */
export function arrivePrint(c: Closure, doc: Rec, s: Rec): Rec {
  const a = c.api;
  const pd = a.bookPrintDefaults();
  for (const k of Object.keys(pd)) s[k] = pd[k];
  if (doc.printTrim) s.printTrim = doc.printTrim;
  if (typeof doc.printRecto === 'boolean') s.printRecto = doc.printRecto;
  if (typeof doc.printLargePrint === 'boolean') s.printLargePrint = doc.printLargePrint;
  s.printPictureBook = doc.printPictureBook === true && !s.printLargePrint;
  s.printBleed = doc.printBleed === true;
  if (doc.printMarginMode === 'custom' || doc.printMarginMode === 'auto') s.printMarginMode = doc.printMarginMode;
  if (isRec(doc.printCustomMargins)) {
    const m = doc.printCustomMargins, cur = Object.assign({}, s.printCustomMargins) as Rec;
    for (const k of ['inside', 'outside', 'top', 'bottom']) if (typeof m[k] === 'number' && isFinite(m[k] as number) && (m[k] as number) >= 0 && (m[k] as number) <= 3) cur[k] = m[k];
    s.printCustomMargins = cur;
  }
  if (['titleauthor', 'title', 'author', 'chapter', 'none'].includes(doc.printHeadContent as string)) s.printHeadContent = doc.printHeadContent;
  if (doc.printHeadPlace === 'top' || doc.printHeadPlace === 'bottom') s.printHeadPlace = doc.printHeadPlace;
  if (typeof doc.printOmitChapterHead === 'boolean') s.printOmitChapterHead = doc.printOmitChapterHead;
  if (typeof doc.printOmitBlankHead === 'boolean') s.printOmitBlankHead = doc.printOmitBlankHead;
  if (['centre', 'outer', 'none'].includes(doc.printFolio as string)) s.printFolio = doc.printFolio;
  s.printNotes = doc.printNotes === 'page' || doc.printNotes === 'end' ? doc.printNotes : 'end';
  return s;
}

/* ---- the session ---- */

type Session = { ydoc: Y.Doc; state: State; ver: number; platform: unknown; print: Rec; plans: Rec; store: Rec };

/* ---- wave 5c (constraints 65, 66) ----
   The submission manuscript's block (state.manuscript: msInit's fields) and the ACX audio plan (state.audio: acxInit's
   narrator, format, rights line, sections switched on or off, pronunciation guide) are written back where serializeBook
   writes them, as it writes them (msNormalize, acxNormalize), only when a call changed them; put back where they were,
   the book is as it was (the print keys' rule, flushPrint). The box set's volumes (state.boxSetVolumes) are 1.0's
   session-only list: never written into the book, kept for the open book (its Y.Doc) across the session's rebuilds, and
   gone with another book (1.0's applyBookDoc: BEUK:metaleak). */
export const PLAN_KEYS = ['audio', 'manuscript'] as const;
export function planSerialized(c: Closure, st: Rec): Rec {
  return { audio: c.api.acxNormalize(st.audio), manuscript: c.api.msNormalize(st.manuscript) };
}
const volumes = new WeakMap<Y.Doc, unknown[]>();
let session: Session | null = null;
/** Wave 5b: told of the export's state each time a call enters the session (print's own module runs on that state). */
export const exportStateListeners = new Set<(st: State) => void>();
const versions = new WeakMap<Y.Doc, { n: number }>();
function verOf(ydoc: Y.Doc): { n: number } {
  let v = versions.get(ydoc);
  if (!v) {
    v = { n: 0 };
    const box = v;
    ydoc.on('afterTransaction', () => {
      box.n++;
    });
    versions.set(ydoc, v);
  }
  return v;
}

/** 1.0's state of the open book for the export, corrected (safe.ts): built, set into the closure. */
export function exportStateOf(c: Closure, ydoc: Y.Doc): State {
  const book = exportBook(ydoc) as Rec;
  const st = arriveForExport(c, book);
  exportSafe(c, st as State & Rec, book);
  c.setState(st);
  return st;
}

/** 1.0's state of the open book, current, for the export. Null without a book or a closure. */
export function exportEnter(): Closure | null {
  const c = closureIfLoaded();
  const ydoc = desk.ydoc;
  if (!c || !ydoc) return null;
  const s = session;
  if (s && s.ydoc === ydoc && s.ver === verOf(ydoc).n) {
    // the book is unchanged: another session only set its own state into the closure; ours stands again (a rebuild
    // would drop a preset an open call chose, and costs a whole exportBook)
    if (c.getState() !== s.state) c.setState(s.state);
    for (const f of exportStateListeners) f(s.state);
    return c;
  }
  if (s && depth > 0) exportFlush(); // an open call's preset is written before the state is built again
  styleSettle(); // a held Style edit is in the book before the export reads it
  const st = exportStateOf(c, ydoc);
  // wave 5c: the open book's box-set volumes, as this session left them (1.0 keeps them while the book stands)
  let vols = volumes.get(ydoc);
  if (!vols) volumes.set(ydoc, (vols = []));
  (st as Rec).boxSetVolumes = vols;
  session = { ydoc, state: st, ver: verOf(ydoc).n, platform: (st as Rec).exportPlatform, print: printSerialized(st as Rec), plans: planSerialized(c, st as Rec),
    store: storeSerialized(c, st as Rec) };
  for (const f of exportStateListeners) f(st);
  return c;
}

/** Write what the export changed: exportPlatform, and (wave 5b) the print settings, each as serializeBook writes it,
 *  only when the call changed it. */
export function exportFlush(): void {
  const c = closureIfLoaded();
  const s = session;
  if (!c || !s) return;
  const now = (s.state as Rec).exportPlatform;
  const y = s.ydoc;
  let wrote = false;
  if (now !== s.platform) {
    y.transact(() => {
      placeKey(y, 'exportPlatform');
      setMeta(y, 'exportPlatform', now as never);
    });
    s.platform = now;
    wrote = true;
  }
  if (flushPrint(c, s)) wrote = true;
  if (flushPlans(c, s)) wrote = true;
  if (flushStore(c, s)) wrote = true;
  // wave 5c: 1.0's Remove makes a new list (state.boxSetVolumes = …filter…): the open book keeps the one it made
  const vols = (s.state as Rec).boxSetVolumes;
  if (Array.isArray(vols)) volumes.set(y, vols);
  if (wrote) s.ver = verOf(y).n;
}

/** Wave 5c: the manuscript block and the audio plan, written back (flushPrint's rule: a key put back to what 1.0 makes of
 *  the value the book stored is that stored value again, absent if it had none). */
const planBases = new WeakMap<Y.Doc, { raw: Stored; written: string }>();
function storedPlans(y: Y.Doc): Stored {
  const m = y.getMap<unknown>(META);
  const out: Stored = {};
  for (const k of PLAN_KEYS) out[k] = m.has(k) ? { has: true, v: getMetaValue(y, k) } : { has: false, v: undefined };
  return out;
}
function flushPlans(c: Closure, s: Session): boolean {
  const now = planSerialized(c, s.state as Rec);
  const changed = PLAN_KEYS.filter((k) => !same(now[k], s.plans[k]));
  if (!changed.length) return false;
  const y = s.ydoc;
  const cur = storedPlans(y);
  let base = planBases.get(y);
  if (!base || base.written !== JSON.stringify(cur)) planBases.set(y, (base = { raw: cur, written: '' }));
  const was = planSerialized(c, { audio: base.raw.audio!.v, manuscript: base.raw.manuscript!.v });
  const m = y.getMap<unknown>(META);
  y.transact(() => {
    for (const k of changed) {
      const want = same(now[k], was[k]) ? base.raw[k]! : { has: true, v: now[k] };
      if (want.has) {
        placeKey(y, k);
        setMeta(y, k as never, structuredClone(want.v) as never);
      } else if (m.has(k)) m.delete(k);
    }
  });
  base.written = JSON.stringify(storedPlans(y));
  s.plans = now;
  return true;
}

/* ---- wave 5d (constraint 72): what the store check's actions and selects change, written back ----
   1.0's storeAct and initStoreReady's listeners change state.storeCheck (the store, binding and paper chosen, the
   attested spine), state.coverRecipe.wrap (Follow the book's trim, Follow the interior's page count, Use <factor> in per
   page) and state.bookColour.printBlack (Print the accent in black ink); state.printTrim (a trim fix) is a print key
   (flushPrint). Each is written as serializeBook writes it — storeCheck: normalizeStoreCheck(state.storeCheck); coverRecipe:
   normalizeCoverRecipe(state.coverRecipe), or null; colour: bookColour() when bookColourSet(), else no key — in its
   place, only when a call changed it, with flushPrint's rule for a value put back (the stored value again, absent if the
   book had none).
   Second review of 5d (Important): the write is minimal. The session's state is corrected (exportSafe: stripXmlIllegal,
   coverSafe, the hidden fonts), so its whole value is never written: only the fields the call changed (the session's
   value before against after) are applied to 1.0's state of the book AS STORED (applyBookDoc's lines, no correction),
   which is then serialized as serializeBook does. A wrap fix changes the stored recipe in its wrap alone; a tagline's
   control character, a face named "Author's Hand", a hostile recipe's values stay as the book holds them (the safe path
   corrects them again on every read). */
export const STORE_KEYS = ['storeCheck', 'coverRecipe', 'colour'] as const;
/** serializeBook's lines for the three keys, on `st` (1.0's bookColour helpers read the closure's state: set to `st` for
 *  the call). */
export function storeSerialized(c: Closure, st: Rec): Rec {
  const a = c.api;
  const was = c.getState();
  if (was !== (st as unknown)) c.setState(st as never);
  try {
    return {
      storeCheck: a.normalizeStoreCheck(st.storeCheck),
      coverRecipe: st.coverRecipe ? a.normalizeCoverRecipe(st.coverRecipe) : null,
      colour: a.bookColourSet() ? a.bookColour() : undefined,
    };
  } finally {
    if (was !== (st as unknown)) c.setState(was as never);
  }
}
/** What 1.0's applyBookDoc makes of the stored values (its lines for the three, on the session's state otherwise: 1.0's
 *  normalizeCoverRecipe reads the theme), as serializeBook would write them again. */
function storeArrived(c: Closure, raw: Stored, st: Rec): Rec {
  const v = (k: string) => (raw[k]!.has ? raw[k]!.v : undefined);
  const tmp: Rec = Object.assign({}, st);
  const was = c.getState();
  c.setState(tmp as never);
  try {
    const colour = c.api.bookColourNormalize(v('colour'));
    tmp.storeCheck = c.api.normalizeStoreCheck(v('storeCheck'));
    tmp.bookColour = colour.accent || colour.tint ? colour : undefined;
    tmp.coverRecipe = v('coverRecipe') ? c.api.normalizeCoverRecipe(structuredClone(v('coverRecipe'))) : null;
    return storeSerialized(c, tmp);
  } finally {
    c.setState(was as never);
  }
}
/** `base` with only what changed from `before` to `after` applied, field by field (objects walked; anything else
 *  replaced; undefined: no key). */
function patchInto(base: unknown, before: unknown, after: unknown): unknown {
  if (same(before, after)) return base;
  if (isRec(before) && isRec(after) && isRec(base)) {
    const out = structuredClone(base);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const v = patchInto(out[k], before[k], after[k]);
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  }
  return after === undefined ? undefined : structuredClone(after);
}
/** The state key each written key is held in (serializeBook's colour is state.bookColour). */
const STORE_STATE: Record<(typeof STORE_KEYS)[number], string> = { storeCheck: 'storeCheck', coverRecipe: 'coverRecipe', colour: 'bookColour' };
const storeBases = new WeakMap<Y.Doc, { raw: Stored; written: string }>();
function storedStore(y: Y.Doc): Stored {
  const m = y.getMap<unknown>(META);
  const out: Stored = {};
  for (const k of STORE_KEYS) out[k] = m.has(k) ? { has: true, v: getMetaValue(y, k) } : { has: false, v: undefined };
  return out;
}
function flushStore(c: Closure, s: Session): boolean {
  const now = storeSerialized(c, s.state as Rec);
  const changed = STORE_KEYS.filter((k) => !same(now[k], s.store[k]));
  if (!changed.length) return false;
  const y = s.ydoc;
  const cur = storedStore(y);
  let base = storeBases.get(y);
  if (!base || base.written !== JSON.stringify(cur)) storeBases.set(y, (base = { raw: cur, written: '' }));
  // 1.0's state of the book as it stands, uncorrected; the call's own changes applied to it, field by field
  const prev = c.getState();
  const stored = arriveForExport(c, exportBook(y) as Rec) as unknown as Rec;
  c.setState(prev as never);
  for (const k of changed) stored[STORE_STATE[k]] = patchInto(stored[STORE_STATE[k]], s.store[k], now[k]);
  const out = storeSerialized(c, stored);
  const was = storeArrived(c, base.raw, stored);
  const m = y.getMap<unknown>(META);
  y.transact(() => {
    for (const k of changed) {
      const want = same(out[k], was[k]) ? base.raw[k]! : out[k] === undefined ? { has: false, v: undefined } : { has: true, v: out[k] };
      if (want.has) {
        placeKey(y, k);
        setMeta(y, k as never, structuredClone(want.v) as never);
      } else if (m.has(k)) m.delete(k);
    }
  });
  base.written = JSON.stringify(storedStore(y));
  s.store = now;
  return true;
}

/** Wave 5c: Add a Book's volume from a file (1.0's manuscriptFileToVolume, its Beuk-backup half): 1.0's own
 *  localParseBackup and bookDocToVolume, on the open book's state (the volume's defaults are the open book's), the
 *  volume's values then corrected as the open book's are (exportSafe: a hostile volume is a hostile book). A
 *  manuscript or a zip of books is 1.0's import (wave 6). The continuation 1.0's listener runs after it is in the
 *  export session (exportResume). */
export function volumeFromFile(file: unknown): Promise<unknown> {
  const f = file as File;
  const read = (async () => {
    const name = String(f && f.name);
    if (!/\.json$/i.test(name)) throw new Error('Beuk 2.0 adds Beuk backups (.json) here for now; manuscripts and zips of books come with the import');
    const text = await f.text();
    const vol = exportRun((cc) => {
      const book = cc.api.localParseBackup(text);
      if (!book) throw new Error('this is not a Beuk backup file');
      const v = cc.api.bookDocToVolume(book, name);
      exportSafe(cc, v as unknown as State & Rec, v);
      return v;
    });
    if (!vol) throw new Error('unknown error');
    return vol;
  })();
  return exportResume(read);
}
/** Wave 5c: Add a Book's pick (1.0's boxSetExpandPick): the files as picked; a zip is not opened here (1.0's import,
 *  wave 6) — volumeFromFile names it. */
export function expandPick(files: unknown[]): Promise<{ files: unknown[]; skipped: unknown[] }> {
  return exportResume(Promise.resolve({ files: Array.isArray(files) ? files.slice() : [], skipped: [] }));
}
exportEnv.volumeFromFile = volumeFromFile;
exportEnv.expandPick = expandPick;
/** Wave 5c: inside an export call, what 1.0's code waits on resumes in the session (exportResume); else as it is. */
exportEnv.resume = <T,>(v: T): T => (depth > 0 || lingering > 0 ? exportResume(v) : v);
exportEnv.resuming = (): boolean => depth > 0 || lingering > 0;

/* ---- wave 5b (constraint 58): the print settings, written back ----
   A print control changes 1.0's state.print* (initPrint's and initPrintView's listeners); the key it changed is
   written as serializeBook writes it, where serializeBook puts it (placeKey). A setting put back where it was is the
   book as it was (constraint 60): when a key's new value is what 1.0 makes of the value the book stored before the
   print controls first touched it (applyBookDoc's print lines: arrivePrint), the stored value comes back — absent if
   the book had none (a legacy book without print keys stays without them). The stored values are remembered per book
   from the first write; when the book's print keys are no longer what the last write left (another tab, History, an
   import), they are taken afresh. */
type Stored = Record<string, { has: boolean; v: unknown }>;
const printBases = new WeakMap<Y.Doc, { raw: Stored; written: string }>();
function storedPrint(y: Y.Doc): Stored {
  const m = y.getMap<unknown>(META);
  const out: Stored = {};
  for (const k of PRINT_KEYS) out[k] = m.has(k) ? { has: true, v: getMetaValue(y, k) } : { has: false, v: undefined };
  return out;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function flushPrint(c: Closure, s: Session): boolean {
  const now = printSerialized(s.state as Rec);
  const changed = PRINT_KEYS.filter((k) => !same(now[k], s.print[k]));
  if (!changed.length) return false;
  const y = s.ydoc;
  const cur = storedPrint(y);
  let base = printBases.get(y);
  if (!base || base.written !== JSON.stringify(cur)) printBases.set(y, (base = { raw: cur, written: '' }));
  const doc: Rec = {};
  for (const k of PRINT_KEYS) if (base.raw[k]!.has) doc[k] = base.raw[k]!.v;
  const was = printSerialized(arrivePrint(c, doc, {}));
  const m = y.getMap<unknown>(META);
  y.transact(() => {
    for (const k of changed) {
      const want = same(now[k], was[k]) ? base.raw[k]! : { has: true, v: now[k] };
      if (want.has) {
        placeKey(y, k);
        setMeta(y, k as never, structuredClone(want.v) as never);
      } else if (m.has(k)) m.delete(k);
    }
  });
  base.written = JSON.stringify(storedPrint(y));
  s.print = now;
  return true;
}

/** Where the export's toasts go (ExportModal sets the page's toaster). */
export const exportUi: { toast: (msg: string, icon?: string) => void } = { toast: (msg, icon) => structEnv.toast(msg, icon) };

let depth = 0;
let kept: { toast: typeof structEnv.toast; apiFetch: typeof covEnv.apiFetch } | null = null;
/** The first half of exportRun, for 1.0's own listeners: the book's state stands; 1.0's toast goes to the export's
 *  toaster, its serializeBook is 1.0's own (on this state), and an answer it waits on from the server resumes this
 *  state (exportResume). The returned function (once) writes what changed. Null without a book or a closure. */
export function exportBegin(): (() => void) | null {
  const c = exportEnter();
  if (!c) return null;
  depth++;
  if (depth === 1) {
    kept = { toast: structEnv.toast, apiFetch: covEnv.apiFetch };
    structEnv.toast = (msg, icon) => exportUi.toast(msg, icon);
    const fetch0 = covEnv.apiFetch;
    covEnv.apiFetch = (path, opts) => exportResume(fetch0(path, opts));
    const ser = serializeLoaded;
    exportEnv.serialize = ser ? () => ser(c) : null;
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    depth--;
    if (depth === 0) {
      if (kept) {
        structEnv.toast = kept.toast;
        covEnv.apiFetch = kept.apiFetch;
        kept = null;
      }
      exportEnv.serialize = null;
      exportFlush();
    }
  };
}

/** Wave 5c: until the next task after an event on the export's dialogs, what 1.0's listener waits on resumes in the
 *  session (exportEnv.resume) — an async function's next step, straight after its event, has no wrapped value of its own
 *  yet. The session itself has ended (what the event changed is written); the closure still holds its state. */
let lingering = 0;
export function exportLinger(): void {
  lingering++;
  setTimeout(() => {
    lingering--;
  }, 0);
}

/** 1.0's export code on the open book: `fn` runs on 1.0's (corrected) state of it; a preset changed is written when it
 *  returns. Undefined without a book or a closure. */
export function exportRun<T>(fn: (c: Closure) => T): T | undefined {
  const end = exportBegin();
  if (!end) return undefined;
  try {
    return fn(closureIfLoaded()!);
  } finally {
    end();
  }
}

/** A value 1.0's export code waits on (the server's answer): its continuation runs on the export's state again (another
 *  part of the studio may have set its own into the closure meanwhile). */
export function exportResume<T>(v: T): T {
  if (v && typeof (v as { then?: unknown }).then === 'function') {
    const p = v as unknown as Promise<unknown>;
    const wrapped = {
      then(ok?: ((x: unknown) => unknown) | null, bad?: ((e: unknown) => unknown) | null) {
        return p.then(
          ok ? (x: unknown) => {
            const end = exportBegin();
            try {
              return ok(x);
            } finally {
              setTimeout(() => end?.(), 0);
            }
          } : undefined,
          bad ? (e: unknown) => {
            const end = exportBegin();
            try {
              return bad(e);
            } finally {
              setTimeout(() => end?.(), 0);
            }
          } : undefined,
        );
      },
    };
    // review of 5c (Minor 3): a real Promise (catch, finally), adopting the wrapped thenable — its resolution still runs
    // in the session, and the caller's continuation in the same microtask run, before the session's deferred end
    return Promise.resolve(wrapped) as unknown as T;
  }
  return v;
}

/** Forget the session (a test, or the book went). */
export function exportReset(): void {
  session = null;
}
/** The session's state, for the tests. */
export const exportState = (): State | null => session?.state ?? null;

/** The body 1.0's buildEpub posts, for this state: 1.0's own serializeBook (closure-serialize.js) less what buildEpub
 *  leaves home, as 1.0 writes it ({ book, platform, lang }). For the tests and the e2e; the app sends it through 1.0's
 *  buildEpub itself. */
export async function exportBody(lang: string): Promise<string | null> {
  await loadClosure();
  const ser = await loadSerialize();
  return (
    exportRun((cc) => {
      const book = ser(cc);
      for (const k of ['history', 'historyPool', 'notebook', 'research', 'audio', 'importReport']) delete book[k];
      return JSON.stringify({ book, platform: (cc.getState() as Rec).exportPlatform, lang });
    }) ?? null
  );
}

/* ---- 1.0's serializeBook, its own chunk ---- */
type Serialize = (c: Closure) => Rec;
let serializeLoading: Promise<Serialize> | null = null;
let serializeLoaded: Serialize | null = null;
/** 1.0's serializeBook on the closure's current state (null until loadSerialize has loaded its chunk). */
export const serializeIfLoaded = (): Serialize | null => serializeLoaded;
export function loadSerialize(): Promise<Serialize> {
  if (!serializeLoading) {
    serializeLoading = Promise.all([loadClosure(), import('../generated/closure-serialize.js')]).then(([, m]) => {
      serializeLoaded = () => m.createSerialize(closureShare()!).serializeBook();
      return serializeLoaded;
    });
    serializeLoading.catch(() => {
      serializeLoading = null;
    });
  }
  return serializeLoading;
}

/** Where 1.0's export code raises a toast (structEnv.toast stands at the page's toaster between calls). */
export const exportToast = (msg: string, icon?: string): void => structEnv.toast(msg, icon);
