import {
  ACTIVE_PRESET_DEFAULT, AUDIO_DEFAULT, DICTATION_DEFAULT, GOALS_DEFAULT, MANUSCRIPT_DEFAULT, META_DEFAULTS,
  PRINT_BLEED_DEFAULT, PRINT_DEFAULTS, PRINT_MARGINS_DEFAULT, PRINT_NOTES_DEFAULT, PRINT_PICTURE_BOOK_DEFAULT,
  STORE_DEFAULT, THEME_DEFAULT, scaffoldSections,
} from './defaults.js';
import { BookV1, LIMITS, TOP_LEVEL_KEYS } from './schema.js';
import { STEPS } from './upgrade.js';

/* BEUK:book-read — readBook, the reader Beuk 2.0's studio and the server
   use to open any book 1.0 wrote.

   - PURE. A function of the doc alone: no clock, no randomness, no desk. It
     works on its own deep copy and never touches the input.
   - NEVER THROWS. Anything that is not a book becomes the scaffold, with a
     warning.
   - LOSSLESS. A value beyond 1.0's limits (LIMITS) stays, with a warning.
     A value 1.0 would replace (the wrong type, or outside an enum 1.0
     enforces on load) is replaced with 1.0's value, the original goes to
     preserved[], and a warning is recorded. Unknown keys stay and are
     reported.

   Order: version -> named steps (upgrade.ts) -> defaults and coercion ->
   limits -> the schema, whose findings are warnings, never a refusal. */

export type Warning = { code: string; path: string; detail: string };
export type Preserved = { path: string; raw: unknown; used: unknown };
export type ReadResult = {
  status: 'ok' | 'newer';
  book: BookV1;
  upgrades: string[];
  warnings: Warning[];
  preserved: Preserved[];
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Rec, k: string): boolean => Object.hasOwn(o, k);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
/** Own data property, so a key such as "__proto__" is set as data, never as the prototype. */
const setOwn = (o: Rec, k: string, v: unknown): void => {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
};

/* ---- the value specs ---- */

type Kind = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'objectOrNull' | 'stringOrNull';
/** `t` is a type, or the list of values 1.0 accepts. `def` is what 1.0 uses when the key is missing or unusable; with no `def`, a missing key stays missing and an unusable one is dropped (1.0 treats both as "none"). */
type Spec = { t: Kind | readonly string[]; def?: unknown };

function fits(v: unknown, t: Spec['t']): boolean {
  if (Array.isArray(t)) return typeof v === 'string' && t.includes(v);
  switch (t as Kind) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'object': return isRec(v);
    case 'array': return Array.isArray(v);
    case 'objectOrNull': return v === null || isRec(v);
    case 'stringOrNull': return v === null || typeof v === 'string';
  }
}

const kindOf = (v: unknown): Kind => (typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : 'boolean');
/** Specs for every key of a flat defaults object: the default's own type, the default itself. */
const flat = (d: Rec): Record<string, Spec> =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { t: kindOf(v), def: v } satisfies Spec]));

/* Enums 1.0 enforces on load. */
const BACKDROP_STRENGTHS = ['whisper', 'soft', 'strong', 'spread'] as const; // BACKDROP_STRENGTHS, CI:29412; normalizeSection, CI:50109
const OL_STATUSES = ['todo', 'draft', 'revised', 'final'] as const; // OL_STATUSES, CI:32919; olSectionFields keeps status only from this list
const HISTORY_AUTO = ['import', 'sample', 'restore', 'conflict', 'bookid', 'backup', 'sampleupdate', 'chapterop', 'imgremove'] as const; // normalizeHistory, CI:32192
const STORE_IDS = ['kdp', 'ingramspark'] as const; // STORE_IDS, CI:49074
/** Every ink id of STORE_RULES.kdp.inks and .ingramspark.inks, or "" (CI:48970-48973, CI:49008-49010; normalizeStoreCheck blanks the rest). */
const STORE_INKS = ['', 'bw_white', 'bw_cream', 'bw_groundwood', 'std_color', 'premium_color', 'bw_white70', 'std_color70'] as const;

/** Top-level keys, in TOP_LEVEL_KEYS order. Keys with no `def` are the ones 1.0 cannot default from the doc alone (see defaults.ts and the specials in fillTop). */
const TOP: Record<string, Spec> = {
  meta: { t: 'object', def: {} },
  theme: { t: 'object' }, // the default is PRESETS[0].theme, tied to activePreset (fillTop)
  activePreset: { t: 'stringOrNull' }, // fillTop
  colour: { t: 'object' }, outline: { t: 'object' },
  sections: { t: 'array' }, // missing: the scaffold, which is an upgrade step (the next task)
  activeId: { t: 'string' }, // fillTop
  cover: { t: 'objectOrNull', def: null }, coverRecipe: { t: 'objectOrNull', def: null },
  images: { t: 'array', def: [] }, fonts: { t: 'array', def: [] }, customThemes: { t: 'array', def: [] },
  exportPlatform: { t: 'string', def: PRINT_DEFAULTS.exportPlatform },
  printTrim: { t: 'string', def: PRINT_DEFAULTS.printTrim },
  printRecto: { t: 'boolean', def: PRINT_DEFAULTS.printRecto },
  printLargePrint: { t: 'boolean', def: PRINT_DEFAULTS.printLargePrint },
  printPictureBook: { t: 'boolean', def: PRINT_PICTURE_BOOK_DEFAULT },
  printBleed: { t: 'boolean', def: PRINT_BLEED_DEFAULT },
  printMarginMode: { t: ['auto', 'custom'], def: PRINT_DEFAULTS.printMarginMode },
  printCustomMargins: { t: 'object', def: PRINT_MARGINS_DEFAULT },
  printHeadContent: { t: ['titleauthor', 'title', 'author', 'chapter', 'none'], def: PRINT_DEFAULTS.printHeadContent },
  printHeadPlace: { t: ['top', 'bottom'], def: PRINT_DEFAULTS.printHeadPlace },
  printOmitChapterHead: { t: 'boolean', def: PRINT_DEFAULTS.printOmitChapterHead },
  printOmitBlankHead: { t: 'boolean', def: PRINT_DEFAULTS.printOmitBlankHead },
  printFolio: { t: ['centre', 'outer', 'none'], def: PRINT_DEFAULTS.printFolio },
  printNotes: { t: ['page', 'end'], def: PRINT_NOTES_DEFAULT },
  storeCheck: { t: 'object', def: STORE_DEFAULT },
  goals: { t: 'object', def: GOALS_DEFAULT },
  history: { t: 'array', def: [] },
  historyPool: { t: 'object', def: { images: [], fonts: [], covers: [] } },
  importReport: { t: 'objectOrNull', def: null },
  bible: { t: 'object' }, notebook: { t: 'object' }, research: { t: 'object' },
  audio: { t: 'object', def: { ...AUDIO_DEFAULT, include: {}, pron: [], dismissed: [] } },
  manuscript: { t: 'object', def: MANUSCRIPT_DEFAULT },
  dictation: { t: 'object', def: { ...DICTATION_DEFAULT, recent: [] } },
};

/** Specs for the inside of the nested objects whose shape 1.0 normalizes on load. Only keys 1.0 defaults are listed. */
const NESTED: Record<string, Record<string, Spec>> = {
  meta: flat(META_DEFAULTS),
  theme: flat(THEME_DEFAULT),
  printCustomMargins: flat(PRINT_MARGINS_DEFAULT),
  storeCheck: {
    store: { t: STORE_IDS, def: STORE_DEFAULT.store },
    binding: { t: ['paperback', 'hardcover'], def: STORE_DEFAULT.binding },
    ink: { t: STORE_INKS, def: STORE_DEFAULT.ink },
    attestSpine: { t: 'boolean', def: STORE_DEFAULT.attestSpine },
  },
  goals: {
    daily: { t: 'number', def: GOALS_DEFAULT.daily }, project: { t: 'number', def: GOALS_DEFAULT.project },
    deadline: { t: 'string', def: GOALS_DEFAULT.deadline },
    days: { t: 'array' }, dlDay: { t: 'boolean' }, auto: { t: 'boolean' }, start: { t: 'object' }, // written only when set
  },
  audio: {
    narrator: { t: 'string', def: AUDIO_DEFAULT.narrator },
    format: { t: ['both', 'docx', 'txt'], def: AUDIO_DEFAULT.format },
    rightsInClosing: { t: 'boolean', def: AUDIO_DEFAULT.rightsInClosing },
    include: { t: 'object', def: {} }, pron: { t: 'array', def: [] }, dismissed: { t: 'array', def: [] },
  },
  manuscript: {
    ...flat({ legalName: '', address: '', phone: '', email: '', byline: '', surname: '' }),
    paper: { t: ['letter', 'a4'], def: MANUSCRIPT_DEFAULT.paper },
    font: { t: ['times', 'courier'], def: MANUSCRIPT_DEFAULT.font },
    italics: { t: ['italic', 'underline'], def: MANUSCRIPT_DEFAULT.italics },
  },
  dictation: { lang: { t: 'string', def: DICTATION_DEFAULT.lang }, recent: { t: 'array', def: [] } },
  historyPool: { images: { t: 'array', def: [] }, fonts: { t: 'array', def: [] }, covers: { t: 'array', def: [] }, research: { t: 'array' } },
  meta_optional: {
    series: { t: 'string' }, legacyBookIds: { t: 'array' }, castHidden: { t: 'array' },
    titleSource: { t: 'string' }, subtitleSource: { t: 'string' }, authorSource: { t: 'string' },
    rightsMode: { t: 'string' }, ccLicence: { t: 'string' }, firstPublished: { t: 'string' }, editionHolder: { t: 'string' },
  },
};

type Out = {
  warnings: Warning[];
  preserved: Preserved[];
  warn(code: string, path: string, detail: string): void;
};

const show = (v: unknown): string => {
  const s = typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + '...' : v) : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'object' ? 'object' : String(v);
  return s;
};

/** Fill what is missing from `specs`, and replace what is unusable. Returns true when it filled anything. */
function normalize(parent: Rec, path: string, specs: Record<string, Spec>, out: Out): boolean {
  let filled = false;
  for (const [k, spec] of Object.entries(specs)) {
    const p = path ? `${path}.${k}` : k;
    if (!has(parent, k)) {
      if (spec.def !== undefined) { setOwn(parent, k, clone(spec.def)); filled = true; }
      continue;
    }
    const v = parent[k];
    if (fits(v, spec.t)) continue;
    const used = clone(spec.def);
    if (used === undefined) delete parent[k]; else setOwn(parent, k, used);
    out.preserved.push({ path: p, raw: v, used });
    const isEnum = Array.isArray(spec.t);
    out.warn(isEnum ? 'bad-enum' : 'bad-type', p, isEnum
      ? `${show(v)} is not one of ${(spec.t as readonly string[]).map((x) => JSON.stringify(x)).join(', ')}; read as ${show(used)}`
      : `expected ${spec.t as string}, got ${show(v)}; read as ${used === undefined ? 'absent' : show(used)}`);
  }
  return filled;
}

/* ---- limits ---- */

function over(out: Out, path: string, what: string, actual: number, max: number): void {
  if (actual > max) out.warn('over-limit', path, `${what} is ${actual}; 1.0 keeps at most ${max}, this book keeps all of it`);
}
const len = (v: unknown): number => (typeof v === 'string' ? v.length : 0);
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function checkLimits(b: Rec, out: Out): void {
  const meta = isRec(b.meta) ? b.meta : {};
  over(out, 'meta.series', 'series', len(meta.series), LIMITS.seriesMax);
  if (typeof meta.seriesNumber === 'number' && !(Number.isInteger(meta.seriesNumber) && meta.seriesNumber >= LIMITS.seriesNumberMin && meta.seriesNumber <= LIMITS.seriesNumberMax))
    out.warn('over-limit', 'meta.seriesNumber', `${meta.seriesNumber} is not a whole number from ${LIMITS.seriesNumberMin} to ${LIMITS.seriesNumberMax}; 1.0 would read the book as having none, this book keeps it`);
  const ids = items(meta.legacyBookIds);
  over(out, 'meta.legacyBookIds', 'legacyBookIds', ids.length, LIMITS.legacyBookIdsMax);
  ids.forEach((x, i) => over(out, `meta.legacyBookIds[${i}]`, 'legacy id', len(x), LIMITS.legacyBookIdMaxLength));
  const hidden = items(meta.castHidden);
  over(out, 'meta.castHidden', 'castHidden', hidden.length, LIMITS.castHiddenMax);
  hidden.forEach((x, i) => over(out, `meta.castHidden[${i}]`, 'hidden name', len(x), LIMITS.castHiddenItemMax));

  items(b.sections).forEach((s, i) => {
    if (!isRec(s)) return;
    over(out, `sections[${i}].synopsis`, 'synopsis', len(s.synopsis), LIMITS.synopsisMax);
    over(out, `sections[${i}].tags`, 'tags', items(s.tags).length, LIMITS.outlineTagsPerSection);
    over(out, `sections[${i}].pov`, 'pov', len(s.pov), LIMITS.povMax);
  });

  if (isRec(b.outline)) {
    over(out, 'outline.filters', 'filters', items(b.outline.filters).length, LIMITS.outlineFiltersMax);
    over(out, 'outline.threads', 'threads', items(b.outline.threads).length, LIMITS.outlineThreadsMax);
    over(out, 'outline.fields', 'fields', items(b.outline.fields).length, LIMITS.outlineFieldsMax);
  }

  if (isRec(b.bible)) {
    const entries = items(b.bible.entries);
    over(out, 'bible.entries', 'entries', entries.length, LIMITS.bibleEntriesMax);
    entries.forEach((e, i) => {
      if (!isRec(e)) return;
      over(out, `bible.entries[${i}].name`, 'name', len(e.name), LIMITS.bibleNameMax);
      over(out, `bible.entries[${i}].notes`, 'notes', len(e.notes), LIMITS.bibleNotesMax);
      const ch = items(e.changes);
      over(out, `bible.entries[${i}].changes`, 'changes', ch.length, LIMITS.bibleChangesPerEntryMax);
      ch.forEach((c, j) => { if (isRec(c) && isRec(c.anchor)) over(out, `bible.entries[${i}].changes[${j}].anchor.quote`, 'quote', len(c.anchor.quote), LIMITS.bibleQuoteMax); });
    });
  }

  if (isRec(b.notebook)) {
    const notes = items(b.notebook.notes);
    over(out, 'notebook.notes', 'notes', notes.length, LIMITS.notebookNotesMax);
    notes.forEach((n, i) => {
      if (!isRec(n)) return;
      over(out, `notebook.notes[${i}].title`, 'title', len(n.title), LIMITS.notebookTitleMax);
      over(out, `notebook.notes[${i}].body`, 'body', len(n.body), LIMITS.notebookBodyMax);
    });
  }

  if (isRec(b.research)) {
    const files = items(b.research.files);
    over(out, 'research.files', 'files', files.length, LIMITS.researchFilesMax);
    let total = 0;
    files.forEach((f, i) => {
      if (!isRec(f) || typeof f.bytes !== 'number') return;
      total += f.bytes;
      over(out, `research.files[${i}].bytes`, 'file', f.bytes, LIMITS.researchFileMax);
    });
    over(out, 'research.files', 'total size', total, LIMITS.researchTotalMax);
  }

  if (isRec(b.audio)) over(out, 'audio.narrator', 'narrator', len(b.audio.narrator), LIMITS.audioNarratorMax);
  if (isRec(b.dictation)) over(out, 'dictation.recent', 'recent languages', items(b.dictation.recent).length, LIMITS.dictationRecentMax);
  if (isRec(b.printCustomMargins))
    for (const [k, v] of Object.entries(b.printCustomMargins))
      if (typeof v === 'number' && (v < LIMITS.printCustomMarginMin || v > LIMITS.printCustomMarginMax))
        out.warn('over-limit', `printCustomMargins.${k}`, `${v} is outside ${LIMITS.printCustomMarginMin}-${LIMITS.printCustomMarginMax}; 1.0 would use its default, this book keeps it`);
  items(b.history).forEach((e, i) => {
    if (!isRec(e) || !isRec(e.chop)) return;
    over(out, `history[${i}].chop.a`, 'chapter name', len(e.chop.a), LIMITS.historyChopNameMax);
    over(out, `history[${i}].chop.b`, 'chapter name', len(e.chop.b), LIMITS.historyChopNameMax);
  });
}

/* ---- the pieces of readBook ---- */

/** meta.seriesNumber: 1.0 reads a whole number from 1 to 999, as a number or its digits (bookSeriesNumber, CI:20523-20531); anything else is "none". A number past the range is a limit (checkLimits), not a type error. */
function coerceSeriesNumber(meta: Rec, out: Out): void {
  if (!has(meta, 'seriesNumber')) return;
  const v = meta.seriesNumber;
  if (typeof v === 'number') return;
  const s = typeof v === 'string' ? v.trim() : '';
  const n = /^\d{1,3}$/.test(s) ? Number(s) : NaN;
  const used = n >= LIMITS.seriesNumberMin && n <= LIMITS.seriesNumberMax ? n : undefined;
  if (used === undefined) delete meta.seriesNumber; else setOwn(meta, 'seriesNumber', used);
  out.preserved.push({ path: 'meta.seriesNumber', raw: v, used });
  out.warn('bad-type', 'meta.seriesNumber', `expected a whole number, got ${show(v)}; read as ${used === undefined ? 'absent' : used}`);
}

/** Strict enums inside sections and history: the values 1.0 replaces on load. */
function coerceEnums(b: Rec, out: Out): void {
  items(b.sections).forEach((s, i) => {
    if (!isRec(s)) return;
    // normalizeSection, CI:50109: backdropStrength outside BACKDROP_STRENGTHS -> "whisper"
    if (has(s, 'backdropStrength')) normalize(s, `sections[${i}]`, { backdropStrength: { t: BACKDROP_STRENGTHS, def: 'whisper' } }, out);
    // olSectionFields: status kept only if in OL_STATUSES, else dropped
    if (has(s, 'status')) normalize(s, `sections[${i}]`, { status: { t: OL_STATUSES } }, out);
  });
  items(b.history).forEach((e, i) => {
    if (!isRec(e) || !has(e, 'auto') || e.auto === null) return;
    normalize(e, `history[${i}]`, { auto: { t: HISTORY_AUTO, def: null } }, out); // normalizeHistory, CI:32192: outside the list -> null
  });
}

/** Missing and unusable top-level values. Returns the top-level keys that were filled, in key order. */
function fillAndCoerce(b: Rec, out: Out): string[] {
  const hadTheme = has(b, 'theme');
  const filled = new Set<string>();
  const top = (k: string, spec: Spec) => { if (normalize(b, '', { [k]: spec }, out)) filled.add(k); };
  const nested = (k: string, specs: Record<string, Spec>) => {
    if (isRec(b[k]) && normalize(b[k] as Rec, k, specs, out)) filled.add(k);
  };

  for (const [k, spec] of Object.entries(TOP)) {
    if (k === 'theme' || k === 'activePreset' || k === 'activeId') continue;
    top(k, spec);
  }
  // theme: the classic preset when missing, with activePreset (applyBookDoc, CI:50234, CI:50244)
  if (!has(b, 'theme')) { setOwn(b, 'theme', clone(THEME_DEFAULT)); filled.add('theme'); } else top('theme', TOP.theme!);
  if (!has(b, 'activePreset')) { setOwn(b, 'activePreset', hadTheme ? null : ACTIVE_PRESET_DEFAULT); filled.add('activePreset'); } else top('activePreset', TOP.activePreset!);
  // activeId: the first chapter, else the first section (CI:50250-50252)
  const secs = items(b.sections).filter(isRec);
  if (!has(b, 'activeId') && secs.length) {
    const pick = secs.find((s) => s.type === 'chapter') ?? secs[0]!;
    if (typeof pick.id === 'string') { setOwn(b, 'activeId', pick.id); filled.add('activeId'); }
  } else if (has(b, 'activeId')) top('activeId', TOP.activeId!);

  for (const k of ['meta', 'theme', 'printCustomMargins', 'storeCheck', 'goals', 'audio', 'manuscript', 'dictation', 'historyPool'])
    nested(k, NESTED[k]!);
  if (isRec(b.meta)) {
    if (normalize(b.meta, 'meta', NESTED.meta_optional!, out)) filled.add('meta');
    coerceSeriesNumber(b.meta, out);
  }
  coerceEnums(b, out);
  return TOP_LEVEL_KEYS.filter((k) => filled.has(k));
}

/** A bare book: the scaffold sections, and everything else defaulted. */
function scaffoldBook(out: Out): Rec {
  const b: Rec = { sections: scaffoldSections() };
  fillAndCoerce(b, out);
  return b;
}

function zodWarnings(b: Rec, out: Out): void {
  const r = BookV1.safeParse(b);
  if (r.success) return;
  const MAX = 50;
  r.error.issues.slice(0, MAX).forEach((iss) => {
    const path = iss.path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '');
    out.warn('schema', path, iss.message);
  });
  if (r.error.issues.length > MAX) out.warn('schema', '', `${r.error.issues.length - MAX} more schema findings not listed`);
}

function readInner(input: unknown, out: Out): ReadResult {
  const upgrades: string[] = [];
  const result = (book: Rec, status: 'ok' | 'newer' = 'ok'): ReadResult =>
    ({ status, book: book as unknown as BookV1, upgrades, warnings: out.warnings, preserved: out.preserved });

  if (!isRec(input)) {
    let raw: unknown = input;
    try { raw = structuredClone(input); } catch { /* not cloneable (a function): keep the reference */ }
    const book = scaffoldBook(out);
    upgrades.push('scaffold');
    out.warn('not-an-object', '', `a book is an object; got ${Array.isArray(input) ? 'an array' : input === null ? 'null' : typeof input}. Read as an empty book.`);
    out.preserved.push({ path: '', raw, used: clone(book) });
    checkLimits(book, out);
    zodWarnings(book, out);
    return result(book);
  }

  const book = structuredClone(input) as Rec;

  // version (design doc, Goals 2)
  if (has(book, 'formatVersion')) {
    const fv = book.formatVersion;
    if (typeof fv === 'number' && Number.isInteger(fv) && fv > 1) {
      out.warn('format-newer', 'formatVersion', `this book is format ${fv}; this reader knows 1. It is passed through untouched.`);
      return result(book, 'newer');
    }
    if (fv !== 1) {
      out.warn('format-invalid', 'formatVersion', `${show(fv)} is not a format version; read as a book without one`);
      out.preserved.push({ path: 'formatVersion', raw: fv, used: undefined });
      delete book.formatVersion;
    }
  }

  const ctx = { warn: (w: Warning) => { out.warnings.push(w); }, preserve: (p: Preserved) => { out.preserved.push(p); } };
  for (const step of STEPS) if (step.apply(book, ctx)) upgrades.push(step.name);

  for (const k of fillAndCoerce(book, out)) upgrades.push(`defaults:${k}`);

  for (const k of Object.keys(book))
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(k)) out.warn('unknown-key', k, `${k} is not a key of book format 1; kept as written`);

  checkLimits(book, out);
  zodWarnings(book, out);
  return result(book);
}

/** Open a book. Never throws, never changes `input`. */
export function readBook(input: unknown): ReadResult {
  const warnings: Warning[] = [];
  const preserved: Preserved[] = [];
  const out: Out = { warnings, preserved, warn: (code, path, detail) => { warnings.push({ code, path, detail }); } };
  try {
    return readInner(input, out);
  } catch (e) {
    // Only reachable for input structuredClone refuses (a function inside the doc) or a bug here. A reader that throws loses the book.
    const w: Warning[] = [{ code: 'read-failed', path: '', detail: `could not read this book: ${e instanceof Error ? e.message : String(e)}. Read as an empty book.` }];
    const p: Preserved[] = [];
    const o: Out = { warnings: w, preserved: p, warn: (code, path, detail) => { w.push({ code, path, detail }); } };
    const book = scaffoldBook(o);
    return { status: 'ok', book: book as unknown as BookV1, upgrades: ['scaffold'], warnings: w, preserved: p };
  }
}
