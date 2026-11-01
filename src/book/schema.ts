import { z } from 'zod';

/* BEUK:book-schema — the book JSON, written down. Beuk 1.0 never had a
   spec: the studio's serializeBook writes the book and applyBookDoc reads
   it, and the server stores the result as an opaque object. This file is
   the contract for Beuk 2.0's reader, built from
   docs/superpowers/specs/2026-10-30-beuk-book-format-inventory.md. "CI:n"
   below is a line of client/index.html at main @ 03c1928.

   Three rules shape every line:

   - STRUCTURE only. A string is a string, an array is an array. 1.0's
     numeric caps (a 120-character series, 2000 bible entries) are in
     LIMITS, because the reader turns an over-limit value into a warning
     and keeps it; the schema must not refuse a writer's book over length.
   - Nothing is stripped. Every object is a looseObject, so a key this file
     does not know survives parse. Dropping a writer's data is the one
     failure this format must never have.
   - Enums only where 1.0 itself enforces the value on load. Where 1.0
     accepts any string (exportPlatform, printTrim, section kind/type, the
     meta enums), the schema takes a string and KNOWN holds 1.0's list so
     the reader can warn about the rest.

   Required versus optional follows serializeBook. The exception is
   BACKFILLED_TOP_LEVEL: real books written before those keys existed
   (tests/fixtures/books/real) lack them, and applyBookDoc fills them from
   defaults on read, so the schema has to accept their absence. */

const obj = z.looseObject;

/* ---- binary data: canonical base64, or a stored-picture ref ---- */

/** What the client swaps in for bytes on a shelf save: `beuk-pic:` plus a SHA-256 in hex (CI:49855, src/pictures.ts). */
const PIC_REF = /^beuk-pic:[0-9a-f]{64}$/;

/** Base64 that is not canonical stays inline in 1.0 (inventory section 4; CI:49855-49976), so this accepts any run of
 *  base64-alphabet characters, URL-safe `-` and `_`, `=` and whitespace. It is a plain char loop on purpose: a
 *  backtracking regex such as (?:[A-Za-z0-9+/]{4})* overflows the stack on a multi-megabyte payload (research files
 *  run to 10 MB). Linear time, no recursion. */
function isBase64ish(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ok =
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || // A-Z a-z 0-9
      c === 43 || c === 47 || c === 61 || c === 45 || c === 95 || // + / = - _
      c === 32 || c === 10 || c === 13 || c === 9; // space, LF, CR, tab
    if (!ok) return false;
  }
  return true;
}

export const binaryString = z
  .string()
  .refine((s) => PIC_REF.test(s) || isBase64ish(s), "expected base64 data or a beuk-pic:<sha256> ref");

/* ---- warn-only value lists, read from 1.0's code ---- */

export const KNOWN = {
  /** PLATFORM_PRESETS ids, CI:19927-19972. 1.0 accepts any truthy value (CI:50271). */
  exportPlatforms: ['generic', 'kdp', 'apple', 'kobo', 'nook', 'd2d', 'overdrive', 'smashwords', 'tolino', 'scribd', 'googleplay'],
  /** TRIM_SIZES ids, CI:44430-44454. 1.0 accepts any truthy value (CI:50272). */
  printTrims: [
    '4.25x7', '5x7', '5x8', '5.06x7.81', '5.25x8', '5.5x8.5', '5.83x8.27', '6x9', '6.14x9.21', '6.69x9.61', '7x10',
    '7.44x9.69', '7.5x9.25', '7x9', '6.63x10.25', '8x10', '8.27x11.69', '8.5x11', '8x8', '8.25x8.25', '8.5x8.5',
    '8.25x6', '10x8', '11x8.5',
  ],
  /** RETYPE_GROUPS kinds, CI:32734-32738. normalizeSection takes any string (CI:50102). */
  sectionKinds: ['front', 'body', 'back'],
  /** FRONT and BACK (CI:19864-19878) plus the extra types in RETYPE_GROUPS (CI:32735-32737) and "frontispiece" (CI:37595; it occurs in the real books but is in neither list). */
  sectionTypes: [
    'cover', 'halftitle', 'titlepage', 'copyright', 'epigraph', 'dedication', 'toc', 'foreword', 'preface', 'frontispiece',
    'prologue', 'chapter', 'epilogue', 'part',
    'acknowledgments', 'aboutauthor', 'alsoby', 'colophon', 'appendix', 'cta',
  ],
  /** The chapter header styles the Type panel offers, CI:3089-3092. 1.0 does not check the value on load, so the schema takes any string. */
  headerStyles: ['classic_centered', 'modern_stacked', 'editorial_left', 'ornate_framed'],
  /** meta.rightsMode / ccLicence / langSource are read when shown, not enforced on load (CI:20976-21004, CI:50231). */
  rightsModes: ['pd', 'cc'],
  ccLicences: ['by', 'by-sa', 'by-nc', 'by-nc-sa', 'by-nd', 'cc0'],
  langSources: ['auto', 'manual'],
  /** theme.paraMode and theme.headingFlourishPos are merged in on load without a check (CI:50236, CI:35173). */
  paraModes: ['indent', 'block'],
  flourishPositions: ['above', 'below'],
} as const;

/** 1.0's caps. The reader (not this schema) turns a value past one into a warning and keeps the value. */
export const LIMITS = {
  seriesMax: 120, // CI:27582, CI:24961
  seriesNumberMin: 1, seriesNumberMax: 999, // CI:20523-20531
  legacyBookIdsMax: 16, legacyBookIdMaxLength: 300, // CI:4435-4440
  castHiddenMax: 200, castHiddenItemMax: 80, // CI:22295
  synopsisMax: 4000, // CI:32939
  outlineTagsPerSection: 30, // CI:32939
  povMax: 80, // CI:32939
  outlineFiltersMax: 40, outlineThreadsMax: 30, outlineFieldsMax: 20, // CI:32974-33035
  bibleEntriesMax: 2000, // CI:24095 (BIBLE_MAX)
  bibleChangesPerEntryMax: 500, // CI:24177 (BIBLE_CHANGE_MAX)
  bibleNameMax: 120, bibleNotesMax: 20000, // CI:24110-24128
  bibleQuoteMax: 160, // CI:24131
  notebookNotesMax: 500, notebookTitleMax: 120, notebookBodyMax: 50000, // CI:26496-26513
  researchFileMax: 25 * 1024 * 1024, researchTotalMax: 100 * 1024 * 1024, researchFilesMax: 200, // CI:26533 (rsLimits)
  audioNarratorMax: 200, // CI:47267-47289
  historyChopNameMax: 300, // CI:32202
  dictationRecentMax: 4, // CI:68702-68715
  printCustomMarginMin: 0, printCustomMarginMax: 3, // CI:50288
} as const;

/* ---- small shared pieces ---- */

const str = z.string();
const bool = z.boolean();
const num = z.number();
const strOrNull = z.string().nullable();

/** A `{ref}` or `{ref, pool}` stand-in inside a packed history snapshot (CI:32117-32148). */
const PackedRef = obj({ ref: str, pool: num.optional() });

/* ---- meta (CI:20519, 20976-21004) ---- */

const Meta = obj({
  title: str, subtitle: str, author: str, publisher: str, isbn: str,
  language: str, // a LANG_PACKS key (CI:28198); the key list is large and 1.0 itself replaces an unknown code, so the reader handles it
  langSource: str, // KNOWN.langSources; warn-only
  langGuess: str, year: str, rights: str, description: str, a11ySummary: str,
  bookId: str, // `urn:uuid:<uuid>` (CI:4379); older ids are upgraded by the reader, so any string is structurally fine
  series: str.optional(), seriesNumber: num.optional(), legacyBookIds: z.array(str).optional(),
  titleSource: str.optional(), subtitleSource: str.optional(), authorSource: str.optional(), // "writer" | "import" (CI:38090)
  castHidden: z.array(str).optional(),
  rightsMode: str.optional(), ccLicence: str.optional(), // KNOWN.rightsModes / ccLicences; warn-only
  firstPublished: str.optional(), editionHolder: str.optional(),
});

/* ---- theme (CI:19226, 19620-19639, 35173) ---- */

const HeaderElement = obj({
  font: str, size: num, // 0.4-3.2 (CI:19620)
  align: z.enum(['left', 'center', 'right']),
  casing: z.enum(['asis', 'upper', 'small']),
  above: num, below: num, // 0-3
});

const Theme = obj({
  bodyFont: str, headFont: str, fontSize: num, lineHeight: num,
  paraMode: str, // "indent" | "block" (KNOWN.paraModes); applyBookDoc merges the theme over the defaults without checking it (CI:50236)
  indentDepth: str,
  headerStyle: str, // KNOWN.headerStyles (CI:3089-3092); 1.0 does not validate it on load
  dropDepth: num, smallCapsWords: num,
  ornament: str, // one of 13 built-in ids (CI:19133-19147) or the id of an uploaded flourish image (CI:3198), so it is open
  justify: bool, hyphens: bool,
  headingFlourish: str.optional(), // an images[].id (CI:19187)
  headingFlourishPos: str.optional(), // "above" | "below" (KNOWN.flourishPositions); not checked on load, readers just compare to "below" (CI:35173)
  header: obj({ number: HeaderElement, title: HeaderElement, subtitle: HeaderElement }).optional(),
});

const Colour = obj({ accent: str, tint: str, printBlack: bool.optional() }); // CI:19425

/* ---- sections (CI:50099-50116, 50122, 32939) ---- */

const Scene = obj({ at: num, imageId: str, name: str, caption: str, alt: str });

// enforced on load: normalizeSection -> olSectionFields keeps status only if OL_STATUSES.includes it (CI:50249, CI:32919, CI:32943)
const OUTLINE_STATUSES = ['todo', 'draft', 'revised', 'final'] as const;

const Section = obj({
  id: str, kind: str, type: str, // KNOWN.sectionKinds / sectionTypes; 1.0 does not validate them (CI:50102)
  title: str, subtitle: str, number: str, content: str,
  dropCap: bool, smallCaps: bool, included: bool,
  plateId: strOrNull, plateAlt: str,
  backdropId: strOrNull,
  // enforced on load: normalizeSection (CI:50249) replaces anything outside BACKDROP_STRENGTHS (CI:29412) with "whisper" (CI:50108)
  backdropStrength: z.enum(['whisper', 'soft', 'strong', 'spread']),
  htLine1: strOrNull, htLine2: str, tocHeading: strOrNull,
  // the print running head's short form; present only when set (BEUK:headfit)
  runHead: str.optional(),
  scenes: z.array(Scene),
  // outline fields: present only when set (CI:32939)
  synopsis: str.optional(),
  status: z.enum(OUTLINE_STATUSES).optional(),
  tags: z.array(str).optional(),
  pov: str.optional(),
  threads: z.record(str, str).optional(),
  custom: z.record(str, z.union([str, z.literal(true)])).optional(),
});

/* ---- pictures, fonts, research ---- */

// images[] has no normalizer (CI:34535, 35061-35066). Every push site builds {id, name, mediaType, data}; `ext` is
// missing from the bible-image import (CI:26294) and from one internal fixture (CI:63140), and `credit` appears only on
// stock photos (CI:35061). Anything else is kept by looseObject.
const Image = obj({
  id: str, name: str, mediaType: str, data: binaryString,
  ext: str.optional(),
  credit: obj({ name: str, url: str }).optional(),
});

const Cover = obj({ data: binaryString, mediaType: str, ext: str, name: str }); // CI:42195, 43563

const Font = obj({ id: str, name: str, family: str, ext: z.enum(['ttf', 'otf']), mediaType: str, data: binaryString }); // CI:19660-19669

const ResearchFile = obj({ id: str, name: str, mediaType: str, data: binaryString, bytes: num, at: str.optional() }); // CI:26557-26570

const Research = obj({ files: z.array(ResearchFile) });

/* ---- cover recipe (CI:42286-42348, 43006) ---- */

const CoverElement = obj({ font: str, size: num, color: str, pos: obj({ x: num, y: num }).optional() });

const Wrap = obj({
  trim: str, // a TRIM_SIZES id, or "" to follow the book's print trim (CI:43012)
  pages: num, paper: z.enum(['white', 'cream', 'custom']), customFactor: num,
  blurb: str, quote: str, imprint: str,
  binding: z.enum(['paperback', 'case', 'jacket']), hcSpine: num, hcSpineAllow: num,
  flapFront: str, flapBack: str, flapPhotoId: strOrNull,
  // BEUK:spineback — the spine's and back cover's own look. Optional (older books have none) and kept as written;
  // the studio's normalizeWrap owns every value inside.
  spine: obj({}).optional(), back: obj({}).optional(),
});

const CoverRecipe = obj({
  layout: z.enum(['classic', 'modern', 'editorial', 'banded', 'framed', 'minimal', 'free']),
  bgType: z.enum(['solid', 'gradient', 'texture', 'image', 'duotone', 'photo']),
  bgColor: str, bgColor2: str,
  texture: z.enum(['linen', 'speckle', 'vignette']),
  bgImageId: strOrNull,
  title: str, subtitle: str, author: str, tagline: str, series: str,
  wrap: Wrap,
  elements: obj({ series: CoverElement, title: CoverElement, subtitle: CoverElement, tagline: CoverElement, author: CoverElement }),
  bookText: obj({ title: str, subtitle: str, author: str, series: str }).optional(),
});

/* ---- custom themes ---- */

const CustomTheme = obj({ id: str, name: str, theme: Theme });

/* ---- outline (CI:32974-33035) ---- */

const Outline = obj({
  tags: z.array(obj({ name: str, colour: num })), // colour 0-7
  filters: z.array(obj({ id: str, name: str, status: z.array(z.enum(['none', ...OUTLINE_STATUSES])), tags: z.array(str) })),
  threads: z.array(obj({ id: str, name: str, colour: num })).optional(),
  fields: z.array(obj({ id: str, name: str, type: z.enum(['text', 'check', 'list', 'date']), options: z.array(str).optional() })).optional(),
});

/* ---- bible (CI:24095-24300) ---- */

const BIBLE_TYPES = ['character', 'place', 'thing', 'group', 'lore'] as const; // BIBLE_TYPES; an unknown type becomes "lore" on load (CI:24113)

const BibleAnchor = obj({ sec: str, quote: str, at: num, book: str.optional(), pos: z.array(num).optional() });

const BibleChange = obj({
  id: str, anchor: BibleAnchor, text: str,
  fact: obj({ field: str, value: str }).optional(),
});

const BibleEntry = obj({
  id: str, type: z.enum(BIBLE_TYPES), name: str,
  aliases: z.array(str), description: str, notes: str,
  imageId: strOrNull, tags: z.array(str), exactCase: bool, exclude: z.array(str),
  facts: z.record(str, str).optional(),
  links: z.array(obj({ to: str, label: str })).optional(),
  changes: z.array(BibleChange).optional(),
  ai: z.enum(['always', 'never']).optional(),
  scope: z.literal('book').optional(),
});

const Bible = obj({
  entries: z.array(BibleEntry),
  fields: z.partialRecord(z.enum(BIBLE_TYPES), z.array(obj({ id: str, label: str }))).optional(),
  counts: z.record(str, z.array(num)).optional(),
});

/* ---- notebook (CI:26496-26513) ---- */

const Notebook = obj({
  notes: z.array(obj({
    id: str, title: str, body: str,
    folder: str.optional(), secs: z.array(str).optional(), files: z.array(str).optional(), url: str.optional(), at: str.optional(),
  })),
});

/* ---- print and store ---- */

const StoreCheck = obj({
  // all of storeCheck is enforced on load: applyBookDoc -> normalizeStoreCheck (CI:50279, CI:49079-49086) replaces an
  // unknown store, binding or ink with the default
  store: z.enum(['kdp', 'ingramspark']),
  binding: z.enum(['paperback', 'hardcover']),
  // Ink ids are the union of STORE_RULES.kdp.inks (CI:48970-48973) and STORE_RULES.ingramspark.inks (CI:49008-49010).
  // normalizeStoreCheck blanks an id that is not valid for the chosen store (CI:49084), hence "".
  ink: z.enum(['', 'bw_white', 'bw_cream', 'bw_groundwood', 'std_color', 'premium_color', 'bw_white70', 'std_color70']),
  attestSpine: bool,
});

const PrintMargins = obj({ inside: num, outside: num, top: num, bottom: num }); // each 0-3 (CI:50288)

/* ---- goals, audio, manuscript, dictation ---- */

const Goals = obj({
  daily: num, project: num, deadline: str,
  days: z.array(num).optional(), dlDay: bool.optional(), auto: bool.optional(),
  start: obj({ day: str, w: num }).optional(),
});

const Audio = obj({
  narrator: str, format: z.enum(['both', 'docx', 'txt']), rightsInClosing: bool,
  include: z.record(str, bool),
  pron: z.array(obj({ word: str, soundsLike: str, ipa: str, manual: bool })),
  dismissed: z.array(str),
});

// enforced on load: applyBookDoc -> msNormalize (CI:50319, CI:46710-46724) replaces any other paper, font or italics value
const Manuscript = obj({
  legalName: str, address: str, phone: str, email: str, byline: str, surname: str,
  paper: z.enum(['letter', 'a4']), font: z.enum(['times', 'courier']), italics: z.enum(['italic', 'underline']),
});

const Dictation = obj({ lang: str, recent: z.array(str) }); // lang is a DICT_LANGS key (CI:68370); the reader checks it

/* ---- import report (CI:40252-40266) ---- */
// 1.0 drops a report that lacks `v === 1` or an items array, and deep-copies the rest unchecked. The lossless rule
// keeps such a report, so both stay optional here and the reader warns.
const ImportReport = obj({ v: num.optional(), items: z.array(z.unknown()).optional() });

/* ---- history (CI:32117-32202) ---- */

// A snapshot of the book: sections plus whichever of the other keys it carries. In the packed form (`chopDoc`) the
// binary items of images, fonts, research and cover are full objects or {ref} / {ref, pool} stand-ins.
const HistoryDoc = obj({
  sections: z.array(Section),
  images: z.array(z.union([PackedRef, Image])).optional(),
  fonts: z.array(z.union([PackedRef, Font])).optional(),
  cover: z.union([PackedRef, Cover]).nullable().optional(),
  research: obj({ files: z.array(z.union([PackedRef, ResearchFile])) }).optional(),
});

const HistoryEntry = obj({
  id: str, name: str, at: str, words: num,
  // enforced on load: applyBookDoc -> normalizeHistory (CI:50310, CI:32192) maps any value outside this list to null
  auto: z.enum(['import', 'sample', 'restore', 'conflict', 'bookid', 'backup', 'sampleupdate', 'chapterop', 'imgremove']).nullable().optional(),
  chop: obj({ op: z.enum(['delete', 'duplicate', 'split', 'merge']), a: str, b: str }).optional(),
  doc: HistoryDoc.optional(), // older form
  chopDoc: HistoryDoc.optional(), // packed form
}).refine((e) => e.doc !== undefined || e.chopDoc !== undefined, { message: 'a history entry needs doc or chopDoc', path: ['doc'] });

const HistoryPool = obj({
  images: z.array(Image), fonts: z.array(Font), covers: z.array(Cover),
  research: z.array(ResearchFile).optional(), // absent in older books (CI:32147)
});

/* ---- the book ---- */

/** Every key serializeBook can write (37, CI:50139-50189) plus `formatVersion`, which Beuk 2.0 adds. */
export const TOP_LEVEL_KEYS = [
  'formatVersion',
  'meta', 'theme', 'activePreset', 'colour', 'outline', 'sections', 'activeId', 'cover', 'coverRecipe', 'images', 'fonts',
  'customThemes', 'exportPlatform', 'printTrim', 'printRecto', 'printLargePrint', 'printPictureBook', 'printBleed',
  'printMarginMode', 'printCustomMargins', 'printHeadContent', 'printHeadPlace', 'printOmitChapterHead', 'printOmitBlankHead',
  'printFolio', 'printNotes', 'storeCheck', 'goals', 'history', 'historyPool', 'importReport', 'bible', 'notebook', 'research',
  'audio', 'manuscript', 'dictation',
] as const;

/** Keys serializeBook omits when empty (CI:50152-50182), plus the new `formatVersion`. */
export const OPTIONAL_TOP_LEVEL = ['colour', 'outline', 'bible', 'notebook', 'research', 'formatVersion'] as const;

/** Keys serializeBook always writes today but that real, older books lack; applyBookDoc backfills them (CI:50269-50295,
 *  inventory section 3). Found in tests/fixtures/books/real: printPictureBook, printBleed, printNotes and manuscript are
 *  absent from some of the 11 books. The schema accepts their absence; the reader fills them and records an upgrade step. */
export const BACKFILLED_TOP_LEVEL = ['printPictureBook', 'printBleed', 'printNotes', 'manuscript'] as const;

export const BookV1 = obj({
  formatVersion: z.number().optional(),
  meta: Meta,
  theme: Theme,
  activePreset: strOrNull,
  colour: Colour.optional(),
  outline: Outline.optional(),
  sections: z.array(Section),
  activeId: str,
  cover: Cover.nullable(),
  coverRecipe: CoverRecipe.nullable(),
  images: z.array(Image),
  fonts: z.array(Font),
  customThemes: z.array(CustomTheme),
  exportPlatform: str, // KNOWN.exportPlatforms; warn-only
  printTrim: str, // KNOWN.printTrims; warn-only
  printRecto: bool, printLargePrint: bool,
  printPictureBook: bool.optional(), printBleed: bool.optional(),
  printMarginMode: z.enum(['auto', 'custom']),
  printCustomMargins: PrintMargins,
  printHeadContent: z.enum(['titleauthor', 'title', 'author', 'chapter', 'none']),
  printHeadPlace: z.enum(['top', 'bottom']),
  printOmitChapterHead: bool, printOmitBlankHead: bool,
  printFolio: z.enum(['centre', 'outer', 'none']),
  printNotes: z.enum(['page', 'end']).optional(),
  storeCheck: StoreCheck,
  goals: Goals,
  history: z.array(HistoryEntry),
  historyPool: HistoryPool,
  importReport: ImportReport.nullable(),
  bible: Bible.optional(),
  notebook: Notebook.optional(),
  research: Research.optional(),
  audio: Audio,
  manuscript: Manuscript.optional(),
  dictation: Dictation,
});

export type BookV1 = z.infer<typeof BookV1>;
