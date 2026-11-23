// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { figures, importFile, pdf, pdfPara, setupImport, written, type Got, type PdfLine } from './import-given';

/* A PDF's list on a mark the reader did not know (BEUK:listmarkstyped, read by looseListBlocks).

   Found on a real manuscript, by counts only: its PDF's list items each stood as a paragraph that opened on "●"
   (U+25CF), 155 of them, where the same book's Word file gave 40 list blocks holding 159 items. The PDF's lines were
   read rightly (the paragraph builder starts an item at a line that opens on a bullet and hangs its turned lines
   under its mark); what was missing is that the book's list read only "*" and "•", so a run of such paragraphs was
   no list to it.

   Reproduced here with a made-up PDF (its "●" and "■" set from a font of the PDF's own, as a real one's are).
   Before: five paragraphs opening on a bullet and no list. Now each run of paragraphs that open on a bullet the
   book's list reads is one list, every item under the mark the PDF gave; the stored text is as it was, paragraph by
   paragraph, and no figure of the tally moves. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '. The tide kept its own count of the days and the salt answered to no clerk.';
const item = (mark: string, text: string, cont?: string): PdfLine[] => [{ runs: [{ text: mark, mark: true }, { text: ' ' + text }], size: 11, gap: 15 }, ...(cont ? [{ text: cont, size: 11, gap: 15, x: 70 } as PdfLine] : [])];
const LINES: PdfLine[] = [{ text: 'Chapter 1', size: 20, gap: 34 }, ...pdfPara(P(1)), ...pdfPara(P(2)),
  ...item('●', 'a lantern'), ...item('●', 'a chart case that he had carried from the first quay to the', 'last and would not leave behind'), ...item('●', 'two letters'), { text: '', gap: 9 },
  ...pdfPara(P(3)), ...item('■', 'the quay'), ...item('■', 'the pans'), { text: '', gap: 9 }, ...pdfPara(P(4)),
  { page: true }, { text: 'Chapter 2', size: 20, gap: 34 }, ...pdfPara(P(5)), ...pdfPara(P(6))];

type File = { path: string; content: string };
const one = (g: Got) => written(g).find((s) => s.type === 'chapter' && /lantern/.test(s.content))!.content;
const pageOf = (g: Got) => (g.api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path) && f.content.indexOf('lantern') !== -1).map((f) => f.content).join('');

beforeAll(async () => { await setupImport('import-pdf-lists', ['epubFiles', 'buildDocxFiles']); }, 180_000);

describe('a PDF\'s paragraphs that each open on the same list mark are one list', () => {
  it('"●" and "■": the stored text keeps each item a paragraph of its own under its mark; the page sets two lists, each item under the mark the PDF gave', async () => {
    const g = await importFile('lists.pdf', await pdf(LINES), '');
    const blocks = one(g).split(/\n\s*\n/);
    expect(blocks.slice(2, 5)).toEqual(['● a lantern', '● a chart case that he had carried from the first quay to the last and would not leave behind', '● two letters']);
    expect(blocks.slice(6, 8)).toEqual(['■ the quay', '■ the pans']);
    const html = pageOf(g);
    expect(html).toContain('<ul class="book-list book-list-typed"><li><span class="li-mark">● </span>a lantern</li><li><span class="li-mark">● </span>a chart case that he had carried from the first quay to the last and would not leave behind</li><li><span class="li-mark">● </span>two letters</li></ul>');
    expect(html).toContain('<ul class="book-list book-list-typed"><li><span class="li-mark">■ </span>the quay</li><li><span class="li-mark">■ </span>the pans</li></ul>');
    expect(html.match(/<p[^>]*>[●■] /g), 'no paragraph opens on a bullet').toBeNull();
    /* the Word export: list paragraphs, under the PDF's own marks */
    const files = g.api.buildDocxFiles() as File[];
    expect(files.find((f) => f.path === 'word/numbering.xml')!.content).toMatch(/<w:numFmt w:val="bullet"\/><w:lvlText w:val="●"\/>.*<w:numFmt w:val="bullet"\/><w:lvlText w:val="■"\/>/);
    expect((files.find((f) => f.path === 'word/document.xml')!.content.match(/<w:pStyle w:val="ListParagraph"\/>/g) || []).length).toBe(5);
    /* the tally: every character of the file in the book, the marks among them (a PDF marks no lists of its own: no row) */
    expect(figures(g)).toEqual({ counted: true, unaccounted: 0, same: true, fileOnly: [], bookOnly: [] });
    expect(g.tally.aside.listMarks).toBeUndefined();
    expect(g.tally.rows.find((r) => r.key === 'listItems')).toBeUndefined();
  }, 120_000);
});
