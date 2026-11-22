/* The Meridian Ledger stress book through the import, measured in characters on 2026-11-22 (import-tally-meridian.test.ts
   reads this; re-measured the same day after the import stopped joining two lines of the file with a colon of its own, and
   again after a heading's own label was counted one way in every format). For each file: the characters in the file, in the book, set aside by row, unaccounted for; and EVERY
   character that still differs, by code point, with its count on its side. A character listed here is one the import
   still changes, drops or adds in this book. It is pinned so the list cannot move unseen. It is not a pass mark.

   The headingMarks row (a heading's own label and marks: the book sets its own). The book has 12 chapters. The Word,
   RTF, OpenDocument and web-page files, the EPUB and both PDFs write "Chapter I" … "Chapter XII" on a line of its own
   over each chapter's heading: the word "Chapter", 7 characters, 12 times, is 84. The Markdown file writes
   "## Chapter I: …" and the text file "CHAPTER I — …": the word and the mark after the number, 8 characters, 12 times,
   is 96. In every one of the nine the book's side holds the number as the file wrote it ("I") and the title, never the
   word: before this was so the word was counted on both sides where the file wrote "Chapter" as the book sets it (each
   book figure below was 84 more, and the row held only the Markdown file's 12 colons), and in the text file, which
   writes it in capitals, it was a difference. */

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
  /* nothing differs. The row: "Chapter" over each of the 12 headings, 84 (the book was 316856 with the word in it: 316856 - 84 = 316772).
     ("Appendix A" and "Appendix B" are joined to the name on the line under each with a space: no colon of the import's, BEUK:joinsgiven) */
  docx: { file: 317142, book: 316772, aside: { titlePage: 208, headers: 78, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file: the same 84, the same book) */
  rtf: { file: 318053, book: 316772, aside: { titlePage: 212, headers: 881, listMarks: 104, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  odt: { file: 317395, book: 316772, aside: { titlePage: 208, headers: 76, noteMarks: 255, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  html: { file: 318404, book: 316772, aside: { titlePage: 267, contents: 801, noteMarks: 376, listMarks: 104, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs. The row: "Chapter" and the colon of each of the 12 headings "## Chapter I: …", 96 (it was the 12 colons; the book was 316998: 316998 - 84 = 316914) */
  md: { file: 317465, book: 316914, aside: { titlePage: 135, noteMarks: 26, sceneBreaks: 48, headingMarks: 96, details: 246 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs. The row: "CHAPTER" and the dash of each of the 12 headings "CHAPTER I — …", 96, the same row and the same count as the Markdown file's "Chapter" and colon.
     (Before: the book's side counted Beuk's own "Chapter I", so the six capitals A E H P R T of CHAPTER stood against the book's small letters, 12 of each, and the 12 dashes were
     unaccounted for. The book was 328326: 328326 - 84 = 328242.) The titles are stored in the capitals the file wrote them in. */
  txt: { file: 334324, book: 328242, aside: { titlePage: 354, noteMarks: 484, listMarks: 104, sceneBreaks: 1872, headingMarks: 96, labels: 988, leftOut: 2184 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs. The row: the label element "Chapter I" before each of the 12 headings, the word's 84 (the book was 316867: 316867 - 84 = 316783).
     (a label element before a heading, "Front Matter", "Appendix A", "Appendix B", is joined to it with a space: no colon of the import's) */
  epub: { file: 317580, book: 316783, aside: { noteMarks: 376, listMarks: 104, headingMarks: 84, pages: 233 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* 56 hyphens taken off at a line's end, each a hyphen the writer typed (the pdfRejoined row: "Cross-" + "checked" 24 times, "one-" + "time" 18, "ink-" + "plate" 9, and five once each); nothing else differs.
     The row: the label line "Chapter I" over each of the 12 titles, the word's 84 (the book was 318642: 318642 - 84 = 318558) */
  'pdf-plain': { file: 319746, book: 318558, aside: { titlePage: 256, contents: 848, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [], pdf: { raw: 319802, joins: { pdfRejoined: 56 }, rejoined: 56 } },
  /* as the plain PDF, with its running heads and page numbers set aside */
  'pdf-heads': { file: 325398, book: 318558, aside: { pageNumbers: 756, titlePage: 256, contents: 848, headers: 4896, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [], pdf: { raw: 325454, joins: { pdfRejoined: 56 }, rejoined: 56 } },
};
