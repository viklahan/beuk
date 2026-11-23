// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, docx, epub, figures, importFile, odt, oh, op, page, pdf, pdfPara, rtfDoc, rtfH, rtfP, setupImport, written, wp, xml, type Got, type PdfLine } from './import-given';

/* The owner's rule (2026-11-22): "We do not change anything from what the writer gives us." A heading's number and
   its title are the writer's letters: the import stores them in the case the file wrote them in (BEUK:casegiven).

   Three places changed letters on the way in, and are held here:
   - a chapter's number on a line of its own over the chapter's title ("CHAPTER TWENTY-ONE" over "THE LEDGER"), in
     every format that reads two heading lines as one chapter: the number was stored "Twenty-One";
   - a PDF's label line over a title ("CHAPTER IV", "PART ONE"): the reader re-set the whole line before it was read,
     so the number was stored "Iv", "One";
   - a PDF's opening words set in small capitals. Such an opening reaches the reader as CAPITAL letters set smaller
     than the text (measured: the reader's own test is a run that is its own upper case, set under nine tenths of
     the text's size). Those capitals are the characters the PDF holds. They were stored in small letters, a word
     that stood capitalised elsewhere taken for a name; they are stored as the PDF has them, and the report says how
     many openings there are, with their words.

   Beuk's own label word ("Chapter", "Part") is the book's presentation: it is not stored, and the file's own label is
   counted in the tally's heading-marks row (import-heading-labels.test.ts). Every text here is made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '. The tide kept its own count of the days and the salt answered to no clerk.';
type Block = { h?: string; p?: string };
/* a label on a line of its own over the title, twice; then a heading that holds its label, its number and its title on one line, twice */
const BLOCKS: Block[] = [
  { h: 'CHAPTER IV' }, { h: 'THE MUSTER' }, { p: P(1) }, { p: P(2) },
  { h: 'CHAPTER TWENTY-ONE' }, { h: 'THE LEDGER' }, { p: P(3) }, { p: P(4) },
  { h: 'CHAPTER XXII: THE TIDE' }, { p: P(5) }, { p: P(6) },
  { h: 'Chapter twenty-three: the salt' }, { p: P(7) }, { p: P(8) },
];
const STORED = [
  { number: 'IV', title: 'THE MUSTER' }, { number: 'TWENTY-ONE', title: 'THE LEDGER' },
  { number: 'XXII', title: 'THE TIDE' }, { number: 'twenty-three', title: 'the salt' },
];
const chapters = (g: Got) => written(g).filter((s) => s.type === 'chapter').map((s) => ({ number: s.number, title: s.title }));

const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
  ['case.docx', async () => ({ bytes: await docx(BLOCKS.map((b) => (b.h != null ? wp(b.h, true) : wp(b.p!))).join('')), text: '' })],
  ['case.odt', async () => ({ bytes: await odt(BLOCKS.map((b) => (b.h != null ? oh(b.h) : op(b.p!))).join('')), text: '' })],
  ['case.html', async () => ({ bytes: null, text: page(BLOCKS.map((b) => (b.h != null ? '<h1>' + xml(b.h) + '</h1>' : '<p>' + xml(b.p!) + '</p>')).join('')) })],
  ['case.rtf', async () => ({ bytes: null, text: rtfDoc(BLOCKS.map((b) => (b.h != null ? rtfH(b.h) : rtfP(b.p!))).join('')) })],
  ['case.md', async () => ({ bytes: null, text: BLOCKS.map((b) => (b.h != null ? '# ' + b.h : b.p!)).join('\n\n') + '\n' })],
];

beforeAll(async () => { await setupImport('import-case-as-given'); }, 180_000);

describe('a heading\'s number and title are stored in the letters the file wrote them in', () => {
  it.each(FILES)('%s: "CHAPTER IV" over "THE MUSTER" is chapter IV, "CHAPTER TWENTY-ONE" over "THE LEDGER" chapter TWENTY-ONE; a heading on one line keeps its number and title as typed; nothing differs', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    expect(chapters(g), name + ': what the book stores').toEqual(STORED);
    expect(figures(g), name + ': the tally').toEqual(CLEAR);
  }, 120_000);

  it('a text file, where a heading is a line that reads as one: "CHAPTER XXII: THE TIDE" and "Chapter twenty-three: the salt" keep their number and title as typed', async () => {
    const g = await importFile('case.txt', null, ['CHAPTER XXII: THE TIDE', P(5), P(6), 'Chapter twenty-three: the salt', P(7), P(8)].join('\n\n') + '\n');
    expect(chapters(g)).toEqual(STORED.slice(2));
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('an EPUB whose chapter pages set the label in a line of its own over the heading: the number is the label\'s, as its page wrote it', async () => {
    const g = await importFile('case.epub', await epub([
      { title: 'IV', body: '<header class="chapter-opening"><p class="chapter-number">CHAPTER IV</p><h1 class="chapter-title">THE MUSTER</h1></header><p>' + P(1) + '</p>' },
      { title: 'XXI', body: '<header class="chapter-opening"><p class="chapter-number">CHAPTER TWENTY-ONE</p><h1 class="chapter-title">THE LEDGER</h1></header><p>' + P(3) + '</p>' },
      { title: 'XXII', body: '<section epub:type="chapter"><h1>CHAPTER XXII: THE TIDE</h1><p>' + P(5) + '</p></section>' },
    ]), '');
    expect(chapters(g)).toEqual(STORED.slice(0, 3));
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a PDF: the label line over each title is read as the page has it ("CHAPTER IV" was re-set "Chapter Iv", "PART ONE" "Part One")', async () => {
    const lines: PdfLine[] = [
      { text: 'PART ONE', size: 24, gap: 36 }, { text: 'FLOOD', size: 24, gap: 36 }, { page: true },
      { text: 'CHAPTER IV', size: 14, gap: 26 }, { text: 'THE MUSTER', size: 20, gap: 34 }, ...pdfPara(P(1)), ...pdfPara(P(2)), { page: true },
      { text: 'CHAPTER TWENTY-ONE', size: 14, gap: 26 }, { text: 'THE LEDGER', size: 20, gap: 34 }, ...pdfPara(P(3)), ...pdfPara(P(4)), { page: true },
      { text: 'CHAPTER XXII', size: 14, gap: 26 }, { text: 'THE TIDE', size: 20, gap: 34 }, ...pdfPara(P(5)), ...pdfPara(P(6)),
    ];
    const g = await importFile('case.pdf', await pdf(lines), '');
    expect(written(g).filter((s) => s.type === 'part').map((s) => ({ number: s.number, title: s.title }))).toEqual([{ number: 'ONE', title: 'FLOOD' }]);
    expect(chapters(g)).toEqual(STORED.slice(0, 3));
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('a PDF\'s opening words set in small capitals are kept as the PDF holds them, and the report names them', () => {
  const TAIL = 'and the tide kept its own count of the days while the salt answered to no clerk on the quay that year';
  /* each chapter opens on capitals set at 8.2pt in a line of 11pt text: after a capital of the text's own size, twice, and from the line's first letter, once */
  const OPENINGS: [string, string, string, string][] = [['One', 'T', 'HE PANS LAY', ' white under the low sun'], ['Two', 'A', 'DA WREN CAME', ' down to the quay at nine'], ['Three', '', 'NOBODY SPOKE', ' of the ledger that year']];
  const build = async () => {
    const lines: PdfLine[] = [];
    OPENINGS.forEach(([n, cap, small, rest], k) => {
      if (k) lines.push({ page: true });
      lines.push({ text: 'Chapter ' + n, size: 20, gap: 40 });
      lines.push({ runs: [...(cap ? [{ text: cap, size: 11 }] : []), { text: small, size: 8.2 }, { text: rest, size: 11 }], size: 11, gap: 15 });
      for (let q = 0; q < 14; q++) lines.push({ text: TAIL + (q % 3 === 2 ? '.' : ','), size: 11, gap: 15 });
    });
    return pdf(lines);
  };

  it('each opening is stored in the capitals the PDF sets it in (they were stored "The pans lay", "Ada Wren came", "Nobody spoke"), and nothing differs', async () => {
    const g = await importFile('smallcaps.pdf', await build(), '');
    const WANT = ['THE PANS LAY white under the low sun', 'ADA WREN CAME down to the quay at nine', 'NOBODY SPOKE of the ledger that year'];
    const opens = written(g).filter((s) => s.type === 'chapter').map((s, k) => String(s.content).slice(0, WANT[k].length));
    expect(opens).toEqual(WANT);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('the report says how many openings came in small capitals, with the words of each as the PDF has them', async () => {
    const g = await importFile('smallcaps.pdf', await build(), '');
    const items = g.rep.items.filter((i) => i.kind === 'pdfSmallCaps');
    expect(items.map((i) => i.data)).toEqual([{ n: 3, words: ['THE PANS LAY', 'ADA WREN CAME', 'NOBODY SPOKE'] }]);
    expect(items[0].before).toBe('“THE PANS LAY” · “ADA WREN CAME” · “NOBODY SPOKE”');
  }, 120_000);
});
