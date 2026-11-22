/* The Meridian Ledger stress book through the import, measured in characters on 2026-11-22 (import-tally-meridian.test.ts
   reads this; re-measured the same day after the import stopped joining two lines of the file with a colon of its own). For each file: the characters in the file, in the book, set aside by row, unaccounted for; and EVERY
   character that still differs, by code point, with its count on its side. A character listed here is one the import
   still changes, drops or adds in this book. It is pinned so the list cannot move unseen. It is not a pass mark. */

export type Inventory = {
  file: number; book: number; aside: Record<string, number>; unaccounted: number;
  /** [code point, how many more the file holds than the book] */
  fileOnly: [string, number][];
  /** [code point, how many more the book holds than the file] */
  bookOnly: [string, number][];
  /** a PDF: the characters of its text pieces, what the reader took off where it joined them, and how many hyphens it took off at a line's end */
  pdf?: { raw: number; joins: Record<string, number>; rejoined: number };
};

export const MERIDIAN_INVENTORY: Record<string, Inventory> = {
  /* nothing differs ("Appendix A" and "Appendix B" are joined to the name on the line under each with a space: no colon of the import's, BEUK:joinsgiven) */
  docx: { file: 317142, book: 316856, aside: { titlePage: 208, headers: 78 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  rtf: { file: 318053, book: 316856, aside: { titlePage: 212, headers: 881, listMarks: 104 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  odt: { file: 317395, book: 316856, aside: { titlePage: 208, headers: 76, noteMarks: 255 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  html: { file: 318404, book: 316856, aside: { titlePage: 267, contents: 801, noteMarks: 376, listMarks: 104 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs */
  md: { file: 317465, book: 316998, aside: { titlePage: 135, noteMarks: 26, sceneBreaks: 48, headingMarks: 12, details: 246 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* 12 headings written "CHAPTER I — …": the book sets "Chapter I" itself, so the six capitals A E H P R T of CHAPTER are the book's small letters, and the dash after each number is not kept */
  txt: { file: 334324, book: 328326, aside: { titlePage: 354, noteMarks: 484, listMarks: 104, sceneBreaks: 1872, labels: 988, leftOut: 2184 }, unaccounted: 12, fileOnly: [['U+0041', 12], ['U+0045', 12], ['U+0048', 12], ['U+0050', 12], ['U+0052', 12], ['U+0054', 12], ['U+2014', 12]], bookOnly: [['U+0061', 12], ['U+0065', 12], ['U+0068', 12], ['U+0070', 12], ['U+0072', 12], ['U+0074', 12]] },
  /* nothing differs (a label element before a heading, "Front Matter", "Appendix A", "Appendix B", is joined to it with a space: no colon of the import's) */
  epub: { file: 317580, book: 316867, aside: { noteMarks: 376, listMarks: 104, pages: 233 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* 56 hyphens taken off at a line's end, each a hyphen the writer typed (the pdfRejoined row: "Cross-" + "checked" 24 times, "one-" + "time" 18, "ink-" + "plate" 9, and five once each); nothing else differs */
  'pdf-plain': { file: 319746, book: 318642, aside: { titlePage: 256, contents: 848 }, unaccounted: 0, fileOnly: [], bookOnly: [], pdf: { raw: 319802, joins: { pdfRejoined: 56 }, rejoined: 56 } },
  /* as the plain PDF, with its running heads and page numbers set aside */
  'pdf-heads': { file: 325398, book: 318642, aside: { pageNumbers: 756, titlePage: 256, contents: 848, headers: 4896 }, unaccounted: 0, fileOnly: [], bookOnly: [], pdf: { raw: 325454, joins: { pdfRejoined: 56 }, rejoined: 56 } },
};
