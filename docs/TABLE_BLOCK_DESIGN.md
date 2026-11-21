# Table block: design

Status: approved by V on 2026-11-20 (the five decisions in section 8). Nothing
here is built yet. Statements about today's code were read from the code at
commit 70ce2bc and were not run; line numbers are from that commit and will
drift. `CI` means `client/index.html`.

## 1. Intent

A table in an imported manuscript is shown as a table in the book, the ebook
and the printed pages. Today every importer recognises tables and leaves them
out of the book, with a line in the import report. An interim change keeps a
table's words as plain rows; this design replaces that with a real block.

**Goals**

- One representation that the importer, the editor, the typesetter and every
  exporter agree on.
- The book's text stays readable as text and round-trips through Beuk's own
  EPUB, Word and Markdown exports.
- Nothing a writer wrote is dropped or changed without the import report
  saying so.

**Not in the first version**

- Merged cells, nested tables, multi-line cells, lists or pictures in cells.
- Column widths, alignment controls, sorting, spreadsheet paste.

**What would make it a failure**

- A table's words disappearing from word counts, search or narration.
- A change to the book file format that older builds cannot open.
- A table that imports differently from `.docx` and from `.html` of the same
  book.

## 2. Today

**Containers**

- Parser: `CONTAINER_OPEN_RE`, `CONTAINER_CLOSE_RE`, `parseContainers`
  (CI:29089-29106). Containers are read before block splitting and do not
  nest. An unknown kind renders as normal paragraphs (CI:29074-29088).
- Kinds: `CONTAINER_KINDS` (CI:29147-29367). Each kind has `html(seg, cx)`
  for preview, print and EPUB, `docx(seg, cx)` for Word, and the flags
  `keepLines`, `keepIndent`, `raw`, `lineNotes`.
- Typesetter: `contentBlocksToHtml` dispatches at CI:30362-30368.
- CSS: `buildBookCss` (CI:30549), container rules at CI:30588-30702,
  right-to-left overrides at CI:30860.
- EPUB: `buildEpubBlob` (CI:46713) uses the same renderer.
- Print: `buildPrintHtml` (CI:47722) feeds Chromium
  (`deploy/renderer/server.mjs:46`).
- Word export: `docxContentParas` calls each kind's `docx` (CI:49056-49072).
  Styles are declared in two builders (CI:49134, CI:49446).
- Markdown export: `contentToMarkdown` keeps the fences (CI:46767-46779).
  Kinds without `keepLines` have their lines joined with spaces (CI:46791).
- 2.0 editor: only `center` and `right` are `container` nodes
  (`src/book/editor/convert.ts:50`, 380-385). Every other kind is a verbatim
  `rawBlock` (`convert.ts:387`), as is any block that does not write back its
  exact source (`convert.ts:384`, 411).

**Tables**

- Every importer pushes `{ idx, rows: string[][], images, secId, prev }` and
  a `TBL` sentinel: RTF (CI:39591-39594), EPUB (CI:40945-40950), Word
  (CI:41537-41546), PDF (CI:43558-43561). OpenDocument and web pages are
  reduced to bare `<table><tr><td>` first (CI:39779-39782, 39898-39900) and
  then take the Word path.
- Report: kind `table`, group `dropped`, `data: { rows, prev, images }`
  (CI:41911-41917).
- Undo: `IR_UNDO.table` (CI:42096-42112) inserts each row as its own
  paragraph, cells joined with `" | "` after dropping empty cells, so column
  positions are lost.
- Likely defect, read and not run: cells are `textContent`, so marks and note
  references are lost; and `querySelectorAll("tr")` (CI:41539) descends into
  nested tables while the parent cell's text also includes them, so nested
  words would be recorded twice.

**The stress book** (`tools/Testbooks/The_Meridian_Ledger_TestSuite`)

- `.html` and `.epub`: 24 `<table>` (14 top-level, 10 nested inside a cell),
  24 `<thead>`, 14 `<caption>`, 13 `colspan`, 13 `rowspan`.
- `.docx`: 24 header-row marks, 12 `gridSpan`, 24 `vMerge`, 13 footnote
  references inside tables.
- `.md`: one pipe table and 23 HTML tables.
- Largest top-level table: 13 rows by 4 columns. Longest cell: 114
  characters. No paragraphs, lists or pictures in cells.

## 3. The representation

```
::: table header
Table 3. Tonnage by port, 1921
| Port | Ships | Tonnage |
| Leith | 14 | 9,200 |
| Hull | 22 | 15,750 |
:::
```

```
::: table header
| Witness | Statement |
| Marta Kováč | Confirmed the *chain-line* spacing[^8] |
| H. Lindholm | **Absent** \| on leave |
:::

[^8]: Foundry Sheet IV.
```

- **Kind and argument.** Kind `table`. The argument `header` makes the first
  row the header row, following `log dark` and `columns hanging`.
- **Rows.** A line starting with `|` is a row. Cells split on an unescaped
  `|`; the trailing `|` is optional; cells are trimmed; `\|` is a literal
  bar. Short rows are padded with empty cells at render.
- **Caption.** Non-row lines before the first row, one line, inline marks
  allowed.
- **Stray lines.** Non-row lines after the rows are typeset as ordinary
  blocks. Nothing is dropped.
- **Redactions.** A `||x||` span is read first, as `inlineMd` does
  (CI:29893). The canonical writer always spaces its bars, so it never
  writes `||`.
- **No Markdown rule row.** `beautifyText` turns a `---` line into a scene
  break (CI:29838, 29841).
- **Flag.** `keepLines: true`, or the Markdown export joins the rows.
- **A cell holds** one line of inline text: italic, bold, link, footnote
  reference, redaction.
- **Editor nodes (slice 4).** `table` (content `tableCaption? tableRow+`,
  with the `open`, `openEol`, `close` attrs of `container`), `tableRow`,
  `tableCell`. Source that is not in canonical form stays a `rawBlock`
  through the existing mismatch check.

## 4. Approaches considered

- **A. Fenced pipe rows (chosen).** Readable as text, one parser seam, no
  change to the book file. Older builds show the rows as visible text. The
  cost is no spans and no multi-line cells, which the first version excludes
  anyway.
- **B. A token plus a stored grid**, like pictures. Allows spans and rich
  cells later. But the text stops being readable; counts, search, narration
  and insights no longer see the words; it needs a format change.
- **C. A bare Markdown pipe table as an ordinary block.** Familiar, but its
  rule row collides with `beautifyText`, and it has no place for a caption
  or flags and no container seam.

## 5. Each surface

**Import**

- One reader, `irTableFromDom(table, ir)`, returning
  `{ grid, header, caption, flat }`. Cells go through the same inline-run
  code as list items (CI:41531), so marks, links and note references
  survive and unsupported formatting is counted as in prose.
- One writer, `tableFenceText(rec)`. The sentinel then emits the fence.
- Callers: Word, EPUB, HTML inside Markdown, and OpenDocument and web pages
  once their reducers pass through `th`, `thead`, `caption`, spans and
  nesting. RTF, PDF and Markdown pipe tables supply grids directly.
- The same book must give the same tables from every format.

**Flattening rule**

- A merged cell's words stand in its first cell (top, start side); the cells
  it covered are empty.
- A nested table is lifted out and placed as its own table directly after
  its parent, in order. The stress book becomes 24 tables.
- Paragraph breaks inside a cell become one space.
- Pictures in cells: keep today's "also held {n} image" line.

**Report**

- Kind `table` moves from "left out" to "notes": "kept as a table: R rows,
  C columns", with sub-lines counting un-merged cells, lifted tables and
  joined paragraphs. New strings in all 13 packs.

**Editor**

- Until slice 4, the 2.0 editor shows a table as an honest, lossless
  `rawBlock`.
- After: type in cells, Tab and Shift-Tab between them, a caption line, and
  one small menu (add or remove a row, add or remove a column, header row on
  or off).

**Preview and EPUB**

```html
<div class="tbl"><table><caption>…</caption>
<thead><tr><th scope="col">…</th></tr></thead>
<tbody><tr><td>…</td></tr></tbody></table></div>
```

- Collapsed borders, horizontal rules only, `text-align: start`, logical
  padding, no indent, rows that do not split, caption above. The preview
  wrapper scrolls sideways. Direction is inherited.
- Real HTML tables, as Amazon KDP's guidance asks; never images.

**Print**

- Rows never split; the caption and header stay with the first row.
- A repeated header row on a continued page relies on Chromium's
  table-header-group behaviour. Not established from the code: needs a
  render test.
- Wide tables: type steps down by column count. A turned table is later
  work.

**Word**

- A real `<w:tbl>`: header row marked to repeat, cells in a new `TableCell`
  style, caption as a `TableCaption` paragraph. Styles go in both builders.

**Markdown**

- The fence exports unchanged.

**Counts and narration**

- `countWordsRaw` does not strip `|` (CI:21289-21301), so bars would count
  as words. Add a row-line rule there and in `spokenContainerText`
  (CI:29489).

## 6. Limits

- Warn above 10 columns, 100 rows, or 250 characters in a cell. Past each,
  the table stays whole, with a line in the import report and in
  Store-ready, following the format's "over-limit values stay, with a
  warning" rule (`docs/book-format.md`).
- Above 20 columns, import keeps plain rows and says so.

## 7. Migration and build order

**Migration**

- No format change: the block is text.
- Books imported under the interim plain-rows behaviour: where the stored
  report item still holds its rows, offer "Make this a table". No automatic
  rewrite.
- The existing undo for "left out" tables inserts a fence instead of
  bar-joined paragraphs.

**Build order** (each slice ships and is tested on its own)

1. **Render.** The kind, the row parser, CSS, counts and narration.
   Hand-typed tables work on every surface; Markdown export falls out.
   Checks: parser and escaping, beautifier stability, every surface carries
   the block, a note reference in a cell resolves, right-to-left, the 2.0
   editor's `rawBlock` is lossless.
2. **Import.** Reader, writer, report, undo, strings; DOM formats first,
   then RTF, PDF and Markdown. Checks: stress-book counts (24 tables, 13
   note references, no duplicated words).
3. **Word export and round trips** for Word, EPUB and Markdown.
4. **2.0 editor nodes and menu.** Checks: text to document and back is
   identical, schema parity, a Yjs round trip.
5. **Print hardening**, Store-ready limits, and the migration action.
6. **Later:** turned tables, alignment controls, pictures lifted from cells.

## 8. Decisions (V, 2026-11-20)

1. **Tables taller than a page with footnotes.** The page-foot note engine
   treats a table as atomic (`deploy/renderer/footnotes.mjs`), so such a
   table may push the section's notes to its end. Accepted for the first
   version; fixed in slice 5.
2. **Nested tables** are lifted out after their parent.
3. **Header row** is set only when the source marks one. No guessing from a
   bold first row.
4. **Markdown export** keeps Beuk's fence.
5. **Number columns** are right-aligned automatically at render, with no
   syntax and no control.
