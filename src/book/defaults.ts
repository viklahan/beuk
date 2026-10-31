/* BEUK:book-defaults — what 1.0 puts in a book field that is missing on
   read. One constant per default, each copied from client/index.html and
   cited. "CI:n" is a line of client/index.html as committed at 03c1928
   and still at HEAD of feat/book-format, the same numbering the inventory
   (docs/superpowers/specs/2026-10-30-beuk-book-format-inventory.md) uses.

   Nothing here is invented. Where 1.0's default is not a pure function of
   the book (the current year, a new random id), the reader cannot copy it:
   the year is "" (below) and the id comes from the bookid-missing step. */

/** bookMetaDefaults, CI:20519-20521, without `bookId` (newBookId(): random; the bookid-missing step). `year` is "" where 1.0 uses String(new Date().getFullYear()): the reader is pure and has no clock. That is a deliberate difference from 1.0. */
export const META_DEFAULTS = Object.freeze({
  title: '', subtitle: '', author: '', publisher: '', isbn: '',
  language: 'en', langSource: 'auto', langGuess: '', year: '',
  rights: '', description: '', a11ySummary: '',
});

/** PRESETS[0].theme (the "classic" preset), CI:19224-19226. applyBookDoc lays a book's theme over it, CI:50234-50244. */
export const THEME_DEFAULT = Object.freeze({
  bodyFont: 'EB Garamond', headFont: 'Libre Baskerville', fontSize: 17, lineHeight: 1.55,
  paraMode: 'indent', indentDepth: '1.5em', headerStyle: 'classic_centered',
  dropDepth: 3, smallCapsWords: 3, ornament: 'fleuron', justify: true, hyphens: true,
});

/** PRESETS[0].id, used as activePreset when a book has no theme, CI:50244. */
export const ACTIVE_PRESET_DEFAULT = 'classic';

/** bookPrintDefaults, CI:20533-20538 (exportPlatform, printTrim, printRecto, printLargePrint, printMarginMode, printCustomMargins, printHeadContent, printHeadPlace, printOmitChapterHead, printOmitBlankHead, printFolio). */
export const PRINT_DEFAULTS = Object.freeze({
  exportPlatform: 'generic', printTrim: '6x9', printRecto: true, printLargePrint: false,
  printMarginMode: 'auto',
  printHeadContent: 'titleauthor', printHeadPlace: 'top', printOmitChapterHead: false, printOmitBlankHead: true, printFolio: 'centre',
});

/** bookPrintDefaults().printCustomMargins, CI:20535. */
export const PRINT_MARGINS_DEFAULT = Object.freeze({ inside: 0.625, outside: 0.5, top: 0.6, bottom: 0.75 });

/** printPictureBook: `doc.printPictureBook === true && !printLargePrint`, so false when missing, CI:50275. */
export const PRINT_PICTURE_BOOK_DEFAULT = false;

/** printBleed: `doc.printBleed === true`, so false when missing, CI:50278. */
export const PRINT_BLEED_DEFAULT = false;

/** printNotes on READ: anything but "page" or "end" becomes "end", CI:50300. (A NEW book gets "page", CI:20561; that is buildEmptyBook, not a read.) */
export const PRINT_NOTES_DEFAULT = 'end';

/** storeDefaults, CI:49076-49078 (normalizeStoreCheck starts from it, CI:49079). */
export const STORE_DEFAULT = Object.freeze({ store: 'kdp', binding: 'paperback', ink: '', attestSpine: false });

/** normalizeGoals(undefined), CI:31136-31140: daily and project 0, deadline "". The optional days/dlDay/auto/start are written only when set. */
export const GOALS_DEFAULT = Object.freeze({ daily: 0, project: 0, deadline: '' });

/** acxNormalize(null), CI:47267-47290. */
export const AUDIO_DEFAULT = Object.freeze({ narrator: '', format: 'both', rightsInClosing: false });

/** msNormalize(null), CI:46710-46725. */
export const MANUSCRIPT_DEFAULT = Object.freeze({
  legalName: '', address: '', phone: '', email: '', byline: '', surname: '',
  paper: 'letter', font: 'times', italics: 'italic',
});

/** dictNormalize(null), CI:68706-68714: lang "", recent []. */
export const DICTATION_DEFAULT = Object.freeze({ lang: '' });

/** Section fields 1.0 gives a new section (mkSection, CI:19976-19978), plus the three normalizeSection adds (htLine1, htLine2, tocHeading, CI:50110-50112) so the scaffold is a complete v1 section. */
const SECTION_BASE = {
  subtitle: '', number: '', content: '', dropCap: true, smallCaps: true, included: true,
  plateId: null, plateAlt: '', backdropId: null, backdropStrength: 'whisper', scenes: [],
  htLine1: null, htLine2: '', tocHeading: null,
};

/** FRONT, CI:19864-19872, and BACK, CI:19873-19878. */
const FRONT: [string, string][] = [
  ['cover', 'Cover'], ['halftitle', 'Half Title'], ['titlepage', 'Title Page'], ['copyright', 'Copyright'],
  ['epigraph', 'Epigraph'], ['dedication', 'Dedication'], ['toc', 'Table of Contents'],
];
const BACK: [string, string][] = [
  ['acknowledgments', 'Acknowledgments'], ['aboutauthor', 'About the Author'], ['alsoby', 'Also by the Author'], ['colophon', 'Colophon'],
];

/** buildEmptyBook's sections, CI:20541-20547: FRONT, one body chapter numbered "One", BACK. 1.0 gives each a random id (uid(), CI:4337: "s" + 7 base36 characters); a pure reader cannot, so these take the same shape from the position instead. Returns fresh objects. */
export function scaffoldSections(): Record<string, unknown>[] {
  const id = (i: number) => 's' + i.toString(36).padStart(7, '0');
  const out: Record<string, unknown>[] = [];
  const add = (kind: string, type: string, title: string, extra?: Record<string, unknown>) =>
    out.push({ id: id(out.length), kind, type, title, ...structuredClone(SECTION_BASE), ...extra });
  FRONT.forEach(([type, label]) => add('front', type, label));
  add('body', 'chapter', '', { number: 'One', content: '' });
  BACK.forEach(([type, label]) => add('back', type, label));
  return out;
}
