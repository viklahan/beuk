// @vitest-environment node
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, english, figures, importFile, pdf, pdfWidths, setupImport, written, type Got, type PdfLine } from './import-given';

/* A table in a PDF comes in with each cell's own text, whole and in its place (BEUK:pdftables, 2026-11-22).
   A PDF holds no table, only pieces of text at places on a page. The reader made a row of every LINE of the page
   (three or more lines of two or more cells, a cell being whatever stood 2.2 sizes from its neighbour), so:
     - a cell whose text turned onto a second line became two rows, each holding one line of every cell in the band;
     - a narrow column nearer than 2.2 sizes to the next was read into it ("VIE- Primary");
     - rows with much text in them were not taken for a table at all, and came in as lines of text;
     - a hyphen at the end of a cell's line was never settled, because a table's row was never joined;
     - a header row printed again at the top of the table's next page came in twice;
     - a page that is mostly a table was parted down the space between two of its columns and read as two columns.
   Measured on the Meridian test book against its Word file (24 tables, 94 rows, 322 cells, 298 of them with text):
   not one cell of either PDF came in whole and in its place.
   Now the table is read as a grid, from what the page shows: its columns from where the pieces stand row over row,
   its rows from the vertical bands (a row's lines stand at the table's leading, a row stands further from the row
   above), each cell its own lines joined as running text is joined. Where the page does not show whether two lines
   are two rows or one row's turned lines, they stay two rows and the report names the table.
   Every text here is made up. pdf(): a line with gap 0 keeps the baseline, so two entries with different x are two
   cells of one row. A cell's text is broken where a measure breaks it: the next word would run past the cell's
   width (pdfWidths). Helvetica 11: "VIE-" is 21.4 points wide, "GRZ-" 26.9. */

const SIZE = 11, LEAD = 14, ROW = 24;
const FILL = 'and the tide kept its own count of the days while the salt answered to no clerk on the quay';
const fill = (n: number): PdfLine[] => Array.from({ length: n }, (x, k) => ({ text: FILL + (k % 3 === 2 ? '.' : ','), size: SIZE, gap: k === n - 1 ? 30 : 15 }));
const chapter = (n: string, lines: PdfLine[]): PdfLine[] => [{ text: 'Chapter ' + n, size: 20, gap: 40 }, ...lines];
let widthOf: (s: string, size: number) => number;
/** one line of the page: its pieces' texts at their x; `gap` is the space under it */
type Piece = [text: string, x: number];
const line = (pieces: Piece[], gap: number): PdfLine[] => pieces.map(([text, x], k) => ({ text, x, size: SIZE, gap: k === pieces.length - 1 ? gap : 0 }));
/** a cell's lines: its text broken where the next word would run past the cell's width (a "|" in a word is where the word may break); or its lines as given */
function wrap(text: string | string[], width: number): string[] {
  if (Array.isArray(text)) return text;
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    word.split('|').forEach((part, k) => {
      const glue = k > 0 || !cur ? '' : ' ';
      if (cur && widthOf(cur + glue + part, SIZE) > width) { lines.push(cur); cur = part; } else cur += glue + part;
    });
  }
  if (cur) lines.push(cur);
  return lines;
}
/** a cell: its text (or its lines as they stand), where it starts, how wide it is */
type Cell = [text: string | string[], x: number, width: number];
/** a row's lines, top to bottom: the pieces of each (a cell whose text has ended has none) */
const rowLines = (cells: Cell[]): Piece[][] => {
  const ls = cells.map(([t, , w]) => wrap(t, w));
  return Array.from({ length: Math.max(...ls.map((l) => l.length)) }, (v, i) => cells.map(([, x], c) => [ls[c][i], x] as Piece).filter(([t]) => t !== undefined));
};
/** lines set on the page at the table's leading, `gap` under the last */
const set = (lines: Piece[][], gap = ROW): PdfLine[] => lines.flatMap((l, i) => line(l, i === lines.length - 1 ? gap : LEAD));
const row = (cells: Cell[], gap = ROW): PdfLine[] => set(rowLines(cells), gap);
/** a row's text as the book should hold it */
const whole = (cells: Cell[]): string[] => cells.map(([t]) => (Array.isArray(t) ? t.join(' ') : t).replace(/\|/g, ''));

/* three columns: a code, an office, a note */
const A = 60, B = 150, C = 330;
const cells = (a: string | string[], b: string | string[], c: string | string[]): Cell[] => [[a, A, 70], [b, B, 150], [c, C, 190]];
const HEAD = cells('Code', 'Office', 'Note');
const VIE = cells('VIE-04', 'Vienna harbour office', 'held over until the spring tides had run their course and the pans were dry again');
const GRZ = cells('GRZ-02', 'Graz siding office and its yard beyond the water tower', 'closed for the season');
const TRS = cells('TRS-07', 'Trieste free port', 'open to the coastal steamers all through the year and closed to the rest');
const VCE = cells('VCE-01', 'Venice bindery', 'open');

/* BEUK_TABLES_OUT names a file to write what a case gives into (vitest hides the console) */
const seen = (name: string, g: Got) => { if (process.env.BEUK_TABLES_OUT) appendFileSync(process.env.BEUK_TABLES_OUT, JSON.stringify({ name, blocks: blocksOf(chapters(g)[0].content).filter((b) => b.indexOf('and the tide kept') === -1) }) + String.fromCharCode(10)); };
const chapters = (g: Got) => written(g).filter((s) => s.type === 'chapter');
const tablesIn = (g: Got, n = 0): string[][][] => blocksOf(chapters(g)[n].content).filter((b) => /^::: table/.test(b))
  .map((b) => b.split('\n').filter((l) => /^\|/.test(l)).map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())));
const item = (g: Got, kind: string) => g.rep.items.filter((i) => i.kind === kind).map((i) => ({ n: (i.data || {}).n, before: i.before }));
const asked = (g: Got) => g.rep.items.filter((i) => i.kind === 'pdfHyphenAsk').map((i) => [(i.data || {}).kept, (i.data || {}).offered, (i.data || {}).why]);
const tableItems = (g: Got) => g.rep.items.filter((i) => i.kind === 'table').map((i) => { const d = (i.data || {}) as Record<string, unknown>; return { rows: (d.rows as unknown[]).length, cols: d.cols, merged: d.merged, lifted: d.lifted, nested: d.nested, from: d.from }; });

beforeAll(async () => { await setupImport('import-pdf-tables', ['irUndoItem']); widthOf = await pdfWidths(); }, 180_000);

describe('a table whose rows the page shows by its spacing is read as a grid', () => {
  it('a cell that turns onto a second line is one cell of one row (it was a row for every line, or no table at all)', async () => {
    const g = await importFile('turned.pdf', await pdf([
      ...chapter('One', [...fill(3), ...row(HEAD), ...row(VIE), ...row(GRZ), ...row(VCE, 30), ...fill(6)]),
    ]), '');
    // the page does turn them: the note of the first row and the office of the second stand on two lines or more
    expect(rowLines(VIE).length).toBeGreaterThan(1);
    expect(rowLines(GRZ).length).toBeGreaterThan(1);
    expect(tablesIn(g)).toEqual([[whole(HEAD), whole(VIE), whole(GRZ), whole(VCE)]]);
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    // nothing of the table is left in the text around it, and every character is where the tally says
    expect(blocksOf(chapters(g)[0].content).filter((b) => /pans were dry|water tower/.test(b)).length).toBe(1);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a wordy table is a table: its rows are shown by the spacing, however much text its cells hold (the 28-character average kept it out)', async () => {
    const wide = (a: string, b: string, c: string): Cell[] => [[a, A, 70], [b, B, 240], [c, 420, 110]];
    const rows = [wide('Station', 'What was found there', 'By whom'),
      wide('Vienna', 'The copperplate inventory was examined at the first district office and found complete, with one seal broken by the clerk who had opened it.', 'the senior cartographer of the bureau'),
      wide('Graz', 'Two freight bills carried conflicting tare weights and were set aside to be weighed again when the siding had been cleared.', 'the rail freight examiner')];
    const g = await importFile('wordy.pdf', await pdf([...chapter('One', [...fill(3), ...row(rows[0]), ...row(rows[1]), ...row(rows[2], 30), ...fill(6)])]), '');
    expect(tablesIn(g)).toEqual([rows.map(whole)]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a narrow column 18 points from its neighbour is a column of its own, and a code broken at the end of its cell\'s line is one code', async () => {
    // "VIE-" ends 18.6 points before the next column (under the 2.2 sizes that part two cells on one line); "GRZ-" 13.1
    const narrow = (a: string, b: string, c: string): Cell[] => [[a, A, 26], [b, 100, 160], [c, C, 60]];
    const rows = [narrow('Code', 'Event', 'Time'), narrow('VIE-|04-A', 'Primary inspection held at the first district office', '00:45'), narrow('GRZ-|02-B', 'Second inspection held at the siding office', '01:10')];
    const table = () => [...row(rows[0]), ...row(rows[1]), ...row(rows[2], 30)];
    expect(rowLines(rows[1]).map((l) => l[0][0])).toEqual(['VIE-', '04-A']);
    // the codes stand whole elsewhere in the PDF: the hyphen at the cell line's end is the writer's, and is kept
    const shown = await importFile('codes-shown.pdf', await pdf([
      ...chapter('One', [...fill(3), ...table(), ...fill(6)]),
      { page: true }, ...chapter('Two', [{ text: 'The sheet VIE-04-A was filed with GRZ-02-B that year.', size: SIZE, gap: 15 }, ...fill(8)]),
    ]), '');
    expect(tablesIn(shown)).toEqual([rows.map(whole)]);
    expect(asked(shown)).toEqual([]);
    expect(figures(shown)).toEqual(CLEAR);
    // they stand nowhere else: kept as the page has them, no space added, and each listed for the writer like any other
    const bare = await importFile('codes-bare.pdf', await pdf([
      ...chapter('One', [...fill(3), ...table(), ...fill(6)]),
      { page: true }, ...chapter('Two', fill(8)),
    ]), '');
    expect(tablesIn(bare)).toEqual([rows.map(whole)]);
    expect(asked(bare)).toEqual([['VIE-04-A', 'VIE04-A', 'neither'], ['GRZ-02-B', 'GRZ02-B', 'neither']]);
    expect(figures(bare)).toEqual(CLEAR);
    // "Join it" finds the word alone in its cell, by the cell's own bars
    const ask = bare.rep.items.find((i) => i.kind === 'pdfHyphenAsk') as unknown as { id: string };
    expect(bare.api.irUndoItem(ask.id)).toMatchObject({ ok: true });
    const after = (bare.api.snapshotBookDoc() as { sections: { type: string; content: string }[] }).sections.filter((s) => s.type === 'chapter')[0].content;
    expect(after).toContain('| VIE04-A | Primary inspection held at the first district office | 00:45 |');
    expect(after).toContain('| GRZ-02-B |');
  }, 240_000);

  it('a word the typesetter broke at the end of a cell\'s line is joined where the PDF writes it joined elsewhere, and the hyphen taken off is counted', async () => {
    const cut = cells('VIE-04', 'Vienna office', ['the ledgers were kept by the har-', 'bour master and his clerk']);
    const g = await importFile('cell-hyphen.pdf', await pdf([
      ...chapter('One', [...fill(3), ...row(HEAD), ...row(cut), ...row(GRZ), ...row(VCE, 30), ...fill(6)]),
      { page: true }, ...chapter('Two', [{ text: 'The harbour lay quiet that year.', size: SIZE, gap: 15 }, ...fill(8)]),
    ]), '');
    expect(tablesIn(g)[0][1]).toEqual(['VIE-04', 'Vienna office', 'the ledgers were kept by the harbour master and his clerk']);
    expect(g.rep.items.filter((i) => i.kind === 'pdfHyphens').map((i) => (i.data || {}).n)).toEqual([1]);
    expect(asked(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a cell set across two columns stands in the first of them and the place it covers is empty; a table set inside a cell follows as a table of its own', async () => {
    const across: Cell[] = [['GRZ-02', A, 70], ['Summary: the night freight ran south by the border and was held there for fifty-two minutes', B, 370]];
    const g = await importFile('merged-nested.pdf', await pdf([
      ...chapter('One', [...fill(3),
        ...row(HEAD), ...row(VIE),
        // a table of its own inside the third column's cell
        ...line([['Axis', 340], ['Delta', 420]], ROW), ...line([['Lat.', 340], ['+0.42', 420]], LEAD), ...line([['north', 340]], ROW), ...line([['Lon.', 340], ['-3.85', 420]], ROW),
        // a row whose second cell runs across the second and third columns
        ...row(across), ...row(TRS, 30),
        ...fill(6)]),
    ]), '');
    expect(rowLines(across).length).toBeGreaterThan(1);
    expect(tablesIn(g)).toEqual([
      [whole(HEAD), whole(VIE), ['GRZ-02', 'Summary: the night freight ran south by the border and was held there for fifty-two minutes', ''], whole(TRS)],
      [['Axis', 'Delta'], ['Lat. north', '+0.42'], ['Lon.', '-3.85']],
    ]);
    expect(tableItems(g)).toEqual([
      { rows: 4, cols: 3, merged: 1, lifted: 1, nested: false, from: null },
      { rows: 3, cols: 2, merged: 0, lifted: 0, nested: true, from: { row: 2, col: 3, apart: false } },
    ]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a page that is mostly a table is not read as two columns of text (it was parted down the space between two of the table\'s columns)', async () => {
    const rows = [
      cells('VIE-04', 'Vienna harbour office', 'the copperplate inventory was examined and found complete'), cells('GRZ-02', 'Graz siding office', 'two freight bills carried conflicting tare weights and were set aside'),
      cells('TRS-07', 'Trieste free port', 'the tide almanac had been hollowed out and bound again in buckram'), cells('VCE-01', 'Venice bindery annexe', 'a contact print was trimmed three points narrower than its guard'),
      cells('GTH-09', 'Chiasso rail corridor', 'a dining-car receipt was punched with four numerals of the rail zones'), cells('ZRH-03', 'Zurich vault annexe', 'the custodial log covered October and November of that year'),
    ];
    const g = await importFile('table-page.pdf', await pdf([
      ...chapter('One', fill(8)),
      { page: true },
      ...row(HEAD), ...rows.flatMap((r) => row(r)),
      { page: true }, ...chapter('Two', fill(8)),
    ]), '');
    expect(tablesIn(g)).toEqual([[whole(HEAD), ...rows.map(whole)]]);
    expect(item(g, 'pdfColumns')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('a table that runs over a page turn', () => {
  /* the first page ends on the table (its header, a row, and what `foot` gives); the next opens on the header again, `under` it what the case gives, then two rows more */
  const book = (foot: PdfLine[], under: PdfLine[], gapUnderHeader = ROW, rest?: PdfLine[]) => pdf([
    ...chapter('One', [...fill(3), ...row(HEAD), ...row(VIE), ...foot]),
    { page: true },
    ...row(HEAD, gapUnderHeader), ...under, ...(rest || [...row(TRS), ...row(VCE, 30)]), ...fill(6),
    { page: true }, ...chapter('Two', [{ text: 'The harbour lay quiet that year.', size: SIZE, gap: 15 }, ...fill(8)]),
  ]);
  /* a row whose note runs to three lines or more: all but the last at the foot of the first page, the last over the turn */
  const LONG = cells('GRZ-02', 'Graz siding office', 'kept shut through the whole of the winter months and opened again in the first week of the thaw');

  it('its header row printed again at the top of the next page is the typesetter\'s repeat: one table, the repeat set aside, counted and named', async () => {
    const g = await importFile('repeat.pdf', await book(row(GRZ), []), '');
    expect(tablesIn(g)).toEqual([[whole(HEAD), whole(VIE), whole(GRZ), whole(TRS), whole(VCE)]]);
    expect(item(g, 'pdfTableHeads')).toEqual([{ n: 1, before: '“Code | Office | Note” ×1' }]);
    expect(english('ir.k.pdfTableHeads', { n: 1 })).toBe('A table’s first row, printed again at the top of its next page, was left out 1 time: it is the typesetter’s repeat, and your table holds that row once');
    // "Code", "Office", "Note": 14 characters, in the tally's own row, and nothing unaccounted for
    expect(g.tally.aside.tableHeads).toBe(14);
    expect(english('ir.tally.b.tableHeads')).toBe('A table’s first row printed again on its next page');
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('the rows under the repeat are the table\'s even where that page shows no table of its own (rows of one line each)', async () => {
    const one = [cells('TRS-07', 'Trieste free port', 'open'), cells('VCE-01', 'Venice bindery', 'shut')];
    const g = await importFile('repeat-plain.pdf', await book(row(GRZ), [], ROW, [...row(one[0]), ...row(one[1], 30)]), '');
    expect(tablesIn(g)).toEqual([[whole(HEAD), whole(VIE), whole(GRZ), whole(one[0]), whole(one[1])]]);
    expect(item(g, 'pdfTableHeads')).toEqual([{ n: 1, before: '“Code | Office | Note” ×1' }]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a row the page turn cut goes on in its cells where a word broken by a hyphen runs over the turn', async () => {
    const cut = cells('GRZ-02', 'Graz siding office', ['kept shut through the winter by the har-', 'bour master and his clerk']);
    const ls = rowLines(cut);
    const g = await importFile('cut-hyphen.pdf', await book(set(ls.slice(0, 1)), set(ls.slice(1))), '');
    expect(tablesIn(g)).toEqual([[whole(HEAD), whole(VIE), ['GRZ-02', 'Graz siding office', 'kept shut through the winter by the harbour master and his clerk'], whole(TRS), whole(VCE)]]);
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('and where the page sets it nearer under the repeated header than a row stands, no cell of the row having stopped short', async () => {
    const ls = rowLines(LONG);
    expect(ls.length).toBeGreaterThan(2);
    const g = await importFile('cut-near.pdf', await book(set(ls.slice(0, -1)), set(ls.slice(-1)), ROW - 6), '');
    expect(tablesIn(g)).toEqual([[whole(HEAD), whole(VIE), whole(LONG), whole(TRS), whole(VCE)]]);
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('where the page does not show it, the band stays a row of its own, as the page has it, and the report names the table by that line', async () => {
    const ls = rowLines(LONG);
    const g = await importFile('cut-unknown.pdf', await book(set(ls.slice(0, -1)), set(ls.slice(-1))), '');
    const note = wrap(LONG[2][0], LONG[2][2]), last = note[note.length - 1];
    expect(tablesIn(g)).toEqual([[whole(HEAD), whole(VIE), ['GRZ-02', 'Graz siding office', note.slice(0, -1).join(' ')], ['', '', last], whole(TRS), whole(VCE)]]);
    expect(item(g, 'pdfTableUnsure')).toEqual([{ n: 1, before: '“' + last + '”' }]);
    expect(english('ir.k.pdfTableUnsure', { n: 1 })).toBe('1 table has a line the page does not settle: it may be a row of its own or the rest of the row above it. Your book keeps it as a row, as the page shows it.');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('a table whose rows the page does not show by its spacing stays a row to a line, its cells in their columns', () => {
  it('a narrow column 18 points from its neighbour is not read into it ("VIE Primary" was one cell)', async () => {
    const g = await importFile('narrow.pdf', await pdf([
      ...chapter('One', [...fill(3),
        ...line([['VIE', A], ['Primary', 96], ['Vienna', C]], 15), ...line([['GRZ', A], ['Second', 96], ['Graz', C]], 15), ...line([['TRS', A], ['Third', 96], ['Trieste', C]], 30),
        ...fill(6)]),
    ]), '');
    expect(tablesIn(g)).toEqual([[['VIE', 'Primary', 'Vienna'], ['GRZ', 'Second', 'Graz'], ['TRS', 'Third', 'Trieste']]]);
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a row with an empty cell keeps the cells after it in their columns (the cell after the gap stood in the empty one\'s place)', async () => {
    const g = await importFile('empty-cell.pdf', await pdf([
      ...chapter('One', [...fill(3),
        ...line([['Graz yard', A], ['open', 200], ['one clerk', C]], 15), ...line([['Trieste', A], ['two clerks at the gate', C]], 15), ...line([['Vienna harbour', A], ['closed', 200], ['none', C]], 30),
        ...fill(6)]),
    ]), '');
    expect(tablesIn(g)).toEqual([[['Graz yard', 'open', 'one clerk'], ['Trieste', '', 'two clerks at the gate'], ['Vienna harbour', 'closed', 'none']]]);
    expect(blocksOf(chapters(g)[0].content).some((b) => b.split('\n').includes('| Trieste | | two clerks at the gate |'))).toBe(true);
    // "one clerk" stops with room for "two" beside it ("two clerks at the gate" shows the cell holds more): the second line is a row, and the page shows it
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('codes turned onto a second line with no taller gap between the rows: the lines stay rows, as the page has them, and the report names the table by the line in question', async () => {
    const g = await importFile('even.pdf', await pdf([
      ...chapter('One', [...fill(3),
        ...line([['VIE-', A], ['Primary', 110], ['held', C]], 15), ...line([['04-A', A], ['Inspection', 110], ['over', C]], 15),
        ...line([['GRZ-', A], ['Second', 110], ['kept', C]], 15), ...line([['02-B', A], ['Inspection', 110], ['back', C]], 30),
        ...fill(6)]),
    ]), '');
    expect(tablesIn(g)).toEqual([[['VIE-', 'Primary', 'held'], ['04-A', 'Inspection', 'over'], ['GRZ-', 'Second', 'kept'], ['02-B', 'Inspection', 'back']]]);
    expect(item(g, 'pdfTableUnsure')).toEqual([{ n: 1, before: '“04-A | Inspection | over”' }]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a header set apart from rows that stand a line each under one another: the rows are rows, not one row turned', async () => {
    const g = await importFile('spaced-header.pdf', await pdf([
      ...chapter('One', [...fill(3),
        ...line([['Name', A], ['Qty', 200], ['Price', C]], ROW),
        ...line([['Salt', A], ['3', 200], ['1.20', C]], LEAD), ...line([['Rope and tar', A], ['5', 200], ['0.80', C]], LEAD), ...line([['Tar', A], ['2', 200]], 30),
        ...fill(6)]),
    ]), '');
    expect(tablesIn(g)).toEqual([[['Name', 'Qty', 'Price'], ['Salt', '3', '1.20'], ['Rope and tar', '5', '0.80'], ['Tar', '2', '']]]);
    // "5" stops with room for "2" beside it ("Qty" shows the cell holds more): the last line is a row for certain
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

/* what the page as it was before this change gives for the two cases below (run on the committed page, 2026-11-22): pinned so they are seen not to move */
const TWO_LINES = ['Old code filed Vienna harbour office in the first list and its annexe'];
const HANGING = ['7. Swan and tortoise, drawn in one line that runs to the edge of the card', '8. Tiger and panda, drawn in two colours and set against the light', '9. Owl and cat'];

describe('what is no table stays as it was', () => {
  it('two short columns of plain text side by side, two lines of them: lines of text, each as the page has it', async () => {
    const g = await importFile('two-lines.pdf', await pdf([
      ...chapter('One', [...fill(3),
        ...line([['Old code filed', A], ['Vienna harbour office', C]], 15), ...line([['in the first list', A], ['and its annexe', C]], 30),
        ...fill(6)]),
    ]), '');
    seen('two-lines', g);
    expect(tablesIn(g)).toEqual([]);
    expect(blocksOf(chapters(g)[0].content).filter((b) => /Old code|first list/.test(b))).toEqual(TWO_LINES);
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a list set with a hanging indent, its items apart and their lines turned: two columns whose first never turns are a list\'s, and it is no table', async () => {
    const items: Cell[][] = [[['7.', A, 20], ['Swan and tortoise, drawn in one line that runs to the edge of the card', 90, 230]], [['8.', A, 20], ['Tiger and panda, drawn in two colours and set against the light', 90, 230]], [['9.', A, 20], ['Owl and cat', 90, 230]]];
    const g = await importFile('hanging.pdf', await pdf([...chapter('One', [...fill(3), ...row(items[0]), ...row(items[1]), ...row(items[2], 30), ...fill(6)])]), '');
    seen('hanging', g);
    expect(rowLines(items[0]).length).toBeGreaterThan(1);
    expect(tablesIn(g)).toEqual([]);
    expect(blocksOf(chapters(g)[0].content).filter((b) => /Swan|Tiger|Owl|edge of the card|against the light/.test(b))).toEqual(HANGING);
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('two columns of running text side by side, four lines at one leading: no table (their cells are prose), and no line of them is moved', async () => {
    const left = ['The clerk kept the first ledger in the', 'harbour office and wrote in it each', 'evening before the lamps were lit and', 'the gates were shut for the night.'];
    const right = ['The second ledger was kept at the siding', 'by the examiner, who weighed each bill', 'again and set the heavy ones aside for', 'the morning train to the border.'];
    const g = await importFile('two-columns.pdf', await pdf([
      ...chapter('One', [...fill(3), ...left.flatMap((l, k) => line([[l, A], [right[k], C]], k === 3 ? 30 : 15)), ...fill(6)]),
    ]), '');
    seen('two-columns', g);
    expect(tablesIn(g)).toEqual([]);
    const text = blocksOf(chapters(g)[0].content).join('\n');
    left.forEach((l, k) => expect(text).toContain(l + ' ' + right[k]));
    expect(item(g, 'pdfTableUnsure')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
