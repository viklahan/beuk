// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, figures, importFile, setupImport, type Got } from './import-given';

/* The tally counts a list item the same way on both sides (BEUK:tallysaid).

   Measured on a real manuscript's plain-text file (private; counts only): "List items 159 in the file, 158 in the
   book: 1 in the book as lines of a paragraph, 1 in the file not explained, 1 in the book not explained". The file's
   side knows an item by its first line (the line that opens on the mark; the lines under it are counted as joined
   lines); the book's side knew it by its whole text. An item whose first line is short and that runs on to a second
   line matched nothing. The row gives reasons only where its two totals differ, so a file with equal totals hid it.
   The same defect as the paragraphs' (12cd0a1), mended the same way: the book's side counts an item by its first
   line and its later lines as joined lines.

   The totals here differ on purpose (two paragraphs that open on "- ", which the file's side counts as items and
   the book reads as the paragraphs they are), so the row must give its reasons. Before: 3 in the file and 3 in the
   book "not explained". Every text here is made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '.';
const BODY = ['Chapter 1', P(1), 'He packed:', '* a lantern\nthat he had trimmed himself', '* a chart\ncase', '* two letters', P(2), '1. first\nthe quay at dawn', '2. then the pans', P(3),
  '- Gone, said the pilot.', '- Gone where? said the clerk.', P(4), 'Chapter 2', P(5)].join('\n\n') + '\n';
type Row = { key: string; file: number; book: number; why?: { k: string; row?: string; n: number; side: number }[] };
const listRow = (g: Got) => (g.tally as unknown as { rows: Row[] }).rows.find((r) => r.key === 'listItems')!;

beforeAll(async () => { await setupImport('import-tally-list-items'); }, 180_000);

describe('the tally counts a list item of several lines the same way in the file and in the book', () => {
  for (const [name, text] of [['short.txt', BODY], ['short.md', BODY.replace(/^Chapter /gm, '# Chapter ')]] as [string, string][]) {
    it(name + ': items whose first line is short, in a book whose List items totals differ: nothing of the row is "not explained"', async () => {
      const g = await importFile(name, null, text);
      const row = listRow(g);
      expect([row.file, row.book], 'the totals differ, so the row gives its reasons').toEqual([7, 5]);
      expect(row.why, 'the two paragraphs that open on "- " are the whole difference').toEqual([{ k: 'book', row: 'paragraphs', n: 2, side: 1 }]);
      expect(figures(g)).toEqual(CLEAR);
    }, 120_000);
  }
});
