/* The Meridian Ledger stress book through the import, measured in characters on 2026-11-22 (import-tally-meridian.test.ts
   reads this; re-measured the same day after the import stopped joining two lines of the file with a colon of its own, and
   again after a heading's own label was counted one way in every format, and again after a PDF's hyphen at a line's end
   was settled by the book's own text, and again after that rule took a hyphen beside a digit: no figure moved, a space is
   not a character). For each file: the characters in the file, in the book, set aside by row, unaccounted for; and EVERY
   character that still differs, by code point, with its count on its side. A character listed here is one the import
   still changes, drops or adds in this book. It is pinned so the list cannot move unseen. It is not a pass mark.

   The headingMarks row (a heading's own label and marks: the book sets its own). The book has 12 chapters. The Word,
   RTF, OpenDocument and web-page files, the EPUB and both PDFs write "Chapter I" … "Chapter XII" on a line of its own
   over each chapter's heading: the word "Chapter", 7 characters, 12 times, is 84. The Markdown file writes
   "## Chapter I: …" and the text file "CHAPTER I — …": the word and the mark after the number, 8 characters, 12 times,
   is 96. In every one of the nine the book's side holds the number as the file wrote it ("I") and the title, never the
   word: before this was so the word was counted on both sides where the file wrote "Chapter" as the book sets it (each
   book figure below was 84 more, and the row held only the Markdown file's 12 colons), and in the text file, which
   writes it in capitals, it was a difference.

   The list marks (BEUK:listmarkstyped, re-measured 2026-11-22). The book's 104 list items are typed under bullets of the
   writer's own in the RTF, web-page and text files and the EPUB (four kinds, U+25C6, U+25C7, U+2767, U+25B8). The book's
   list read none of them, so each was stored "-" and the 104 characters stood in a row of their own (listMarks: 104).
   They are stored as typed now: those four files' book figures are 104 more each and the row is gone. The Word,
   OpenDocument and Markdown files, whose lists carry no such mark in the file's text, and both PDFs, did not move.

   The drawn marks (BEUK:listnumbersdrawn, re-measured the same day). In the Word and OpenDocument files the same 104
   bullets are not text: the file's numbering (word/numbering.xml, the list styles) says which character each list
   draws. Both readers stored "-" for every one. They store the character the document shows now, and the tally's file
   side counts it from the file's own numbering: those two files' file AND book figures are 104 more each (the Word
   file was 317142 and 316772, the OpenDocument file 317395 and 316772). The Word, RTF, OpenDocument and web-page
   files now give the same book figure, 316876. */

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
  docx: { file: 317246, book: 316876, aside: { titlePage: 208, headers: 78, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file: the same 84, the same book) */
  rtf: { file: 318053, book: 316876, aside: { titlePage: 212, headers: 881, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  odt: { file: 317499, book: 316876, aside: { titlePage: 208, headers: 76, noteMarks: 255, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs (as the Word file) */
  html: { file: 318404, book: 316876, aside: { titlePage: 267, contents: 801, noteMarks: 376, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs. The row: "Chapter" and the colon of each of the 12 headings "## Chapter I: …", 96 (it was the 12 colons; the book was 316998: 316998 - 84 = 316914) */
  md: { file: 317465, book: 316914, aside: { titlePage: 135, noteMarks: 26, sceneBreaks: 48, headingMarks: 96, details: 246 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs. The row: "CHAPTER" and the dash of each of the 12 headings "CHAPTER I — …", 96, the same row and the same count as the Markdown file's "Chapter" and colon.
     (Before: the book's side counted Beuk's own "Chapter I", so the six capitals A E H P R T of CHAPTER stood against the book's small letters, 12 of each, and the 12 dashes were
     unaccounted for. The book was 328326: 328326 - 84 = 328242.) The titles are stored in the capitals the file wrote them in. */
  txt: { file: 334324, book: 328346, aside: { titlePage: 354, noteMarks: 484, sceneBreaks: 1872, headingMarks: 96, labels: 988, leftOut: 2184 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs. The row: the label element "Chapter I" before each of the 12 headings, the word's 84 (the book was 316867: 316867 - 84 = 316783).
     (a label element before a heading, "Front Matter", "Appendix A", "Appendix B", is joined to it with a space: no colon of the import's) */
  epub: { file: 317580, book: 316887, aside: { noteMarks: 376, headingMarks: 84, pages: 233 }, unaccounted: 0, fileOnly: [], bookOnly: [] },
  /* nothing differs, and no hyphen is taken off at a line's end (BEUK:hyphensgiven). 135 lines end on a hyphen, straight after a
     letter or a digit, that the next line's word continues: 106 with a letter either side, 12 with a digit after ("VIE-" + "04-10")
     and 17 with a digit before ("5-" + "unit", "GRZ-02-" + "REF-17"). For 103 the hyphenated word stands whole elsewhere in the PDF
     and the joined word nowhere, so the hyphen is kept ("Cross-checked" 24 times, "old-style" 20, "one-time" 18, "multi-volume" 14,
     "ink-plate" 9, "ninety-minute" 6, "Mont-Blanc" 5, "sealing-wax" 2, "wax-sealed", "dual-key", "linen-backed", "UTF-16" and
     "11-point" once each). For 32 neither form stands elsewhere: the hyphen stays as the page shows it, no space is added, and the
     report lists 21 words for the writer ("fifty-thousand-plus-word", "ink-ledger", "vector-to-raster", "small-image", "twenty-two";
     "5-unit" 12 times; the codes "VIE-04-10", "VIE-04-43", "VIE-04-52", "VIE-04-61", "GVA-06-23", "GVA-06-32", "GVA-06-41" and
     "GVA-06-50"; the indices "GRZ-02-REF-17", "VCE-01-REF-17", "GTH-09-REF-17", "ZRH-03-REF-17", "BSL-08-REF-17", "INN-10-REF-17"
     and "BER-12-REF-17", once each). None is joined: the joined form of none of them stands in the PDF.
     (The 29 with a digit beside the hyphen were not the rule's at first: it asked for a letter either side, and those two lines were
     closed with a space of the import's own, "VIE- 04-10", "5- unit", "GRZ-02- REF-17", where the Word file's book has none. A space
     is whitespace and not a character of this tally, so no figure here moved when the 29 spaces went: measured before and after.)
     (Before, the reader looked for the two forms among each line's words less its first and its last, and took 56 of these hyphens off,
     each one the writer's: "Cross-" + "checked" 24 times, "one-" + "time" 18, "ink-" + "plate" 9, and the five above. The file was
     319746 and the book 318558: each is 56 more now.)
     The row: the label line "Chapter I" over each of the 12 titles, the word's 84.
     The tableHeads row (BEUK:pdftables, 2026-11-22): a table's first row printed again at the top of the table's next page, 13 times in
     this book, is the typesetter's repeat and is set aside: once for the table of operatives (64 characters), 8 times for the chapters'
     tables ("Index", "Operational Event & Location", "Verification Evidence & Nested Audit", "Time / Variance": 75 each, 600) and 4
     times for the appendix's (66 each, 264): 928. The book held those rows twice and was 318614: 318614 - 928 = 317686. The file's
     figure does not move. The tables themselves now hold what the Word file's hold: 24 tables, 94 rows, 322 cells, each of the 298
     cells with text whole and in its place (none was before), and a hyphen at the end of a cell's line is settled like any other
     (49 of them: 21 kept, their word standing whole elsewhere; 28 left for the writer: the tables' own 27 codes, "VIE-04-A" to
     "BER-12-B" and "CH-1A", "CH-5A", "CH-9A", and "Cross-checks"); none is taken off. */
  'pdf-plain': { file: 319802, book: 317686, aside: { titlePage: 256, contents: 848, tableHeads: 928, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [], pdf: { raw: 319802, joins: {}, rejoined: 0 } },
  /* as the plain PDF, with its running heads and page numbers set aside (the file was 325398 and the book 318558: each was 56 more after the hyphen rule;
     the book is 928 fewer since a table's repeated first row is set aside, as in the plain PDF) */
  'pdf-heads': { file: 325454, book: 317686, aside: { pageNumbers: 756, titlePage: 256, contents: 848, headers: 4896, tableHeads: 928, headingMarks: 84 }, unaccounted: 0, fileOnly: [], bookOnly: [], pdf: { raw: 325454, joins: {}, rejoined: 0 } },
};
