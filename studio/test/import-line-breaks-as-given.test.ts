// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, docx, epub, figures, importFile, odt, oh, op, page, rtfDoc, rtfEsc, rtfH, rtfP, rw, setupImport, written, wp, xml, type Got } from './import-given';

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." The stored book holds the line breaks the file gave.
   A line break the writer typed inside a paragraph (Word's Shift+Enter, a web page's or an EPUB's <br>, RTF's \line,
   OpenDocument's text:line-break) used to come in as a space: three lines of an address were one line in the book.
   The book's text holds a line break inside a block as a line break, so the break is stored as one (BEUK:breaksgiven).

   Held here, each file read by 1.0's own readImportFile (the text 2.0 lifts):
   - one break: a new line of the same paragraph; emphasis is closed before it and opened again after it;
   - two breaks together (an empty line on the writer's page): a blank line, which in the book's text parts two
     paragraphs. The tally counts that paragraph as two on the file's side too, so its rows agree;
   - a quotation's paragraph: each line a line of the quotation;
   - a paragraph one of whose lines would be read as a heading by its words ("Chapter 4" in "See also / Chapter 4 /
     Appendix B") stays one paragraph with its lines: no chapter is opened in the middle of it;
   - Markdown and plain text, which have their own rule for a line break, keep what they kept (pinned below as measured).

   What is NOT kept as a break, pinned so that it cannot move unseen (each is still a space, as before): a break in a
   heading, in a list's item, in a table's cell. The tally cannot see any of this (it does not count white space),
   which is why it is held here directly.

   BEUK:breaksshown — the break is stored MARKED as one the writer made: a backslash straight before the newline
   (Markdown's own spelling), BR below. A bare newline inside a paragraph is what the book has always held for a
   paragraph merely typed on several lines, and every surface sets that as a space; a marked one is set as a line
   break (line-breaks-shown.test.ts holds the surfaces). The pins below were the bare newline until that change.
   The mark is the book's markup: the tally counts it on neither side (its figures stay CLEAR). */

const LINES = ['12 Salt Road', 'Harbour Town', 'HT1 2AB'];
const QUOTE = ['The tide keeps', 'its own count'];
const REFS = ['See also', 'Chapter 4', 'Appendix B'];
const BS = String.fromCharCode(92);
/* the book's mark of a line break the writer made, and the newline it marks */
const BR = BS + '\n';
const BODY = 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year.';
const LAST = 'The second chapter stands here so that the book has two.';
const wr = (s: string, pr = '') => '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xml(s) + '</w:t></w:r>';
const WBR = '<w:r><w:br/></w:r>';

/* the same book in each format: an address of three lines, a paragraph parted by an empty line, an italic passage over a break,
   a quotation of two lines, a paragraph with a line that reads as a chapter's heading */
const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
  ['breaks.docx', async () => ({ bytes: await docx(wp('Chapter 1', true) + wp(BODY)
    + '<w:p>' + LINES.map((l) => wr(l)).join(WBR) + '</w:p>'
    + '<w:p>' + wr('First of two.') + WBR + WBR + wr('Second of two.') + '</w:p>'
    + '<w:p>' + wr('Slowly', '<w:i/>') + '<w:r><w:rPr><w:i/></w:rPr><w:br/></w:r>' + wr('the tide', '<w:i/>') + wr(' came in.') + '</w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>' + QUOTE.map((l) => wr(l)).join(WBR) + '</w:p>'
    + '<w:p>' + REFS.map((l) => wr(l)).join(WBR) + '</w:p>'
    + wp('Chapter 2', true) + wp(LAST)), text: '' })],
  ['breaks.odt', async () => ({ bytes: await odt(oh('Chapter 1') + op(BODY)
    + '<text:p>' + LINES.map(xml).join('<text:line-break/>') + '</text:p>'
    + '<text:p>First of two.<text:line-break/><text:line-break/>Second of two.</text:p>'
    + '<text:p><text:span text:style-name="T1">Slowly<text:line-break/>the tide</text:span> came in.</text:p>'
    + '<text:p text:style-name="Quotations">' + QUOTE.join('<text:line-break/>') + '</text:p>'
    + '<text:p>' + REFS.join('<text:line-break/>') + '</text:p>'
    + oh('Chapter 2') + op(LAST), '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>'), text: '' })],
  ['breaks.html', async () => ({ bytes: null, text: page('<h1>Chapter 1</h1><p>' + BODY + '</p>'
    + '<p>' + LINES.join('<br>') + '</p><p>First of two.<br><br>Second of two.</p><p><em>Slowly<br>the tide</em> came in.</p>'
    + '<blockquote><p>' + QUOTE.join('<br>') + '</p></blockquote><p>' + REFS.join('<br>') + '</p><h1>Chapter 2</h1><p>' + LAST + '</p>') })],
  ['breaks.rtf', async () => ({ bytes: null, text: rtfDoc(rtfH('Chapter 1') + rtfP(BODY)
    + rw('pard') + rw('s0') + ' ' + LINES.map(rtfEsc).join(rw('line') + ' ') + rw('par') + '\n'
    + rw('pard') + rw('s0') + ' First of two.' + rw('line') + rw('line') + ' Second of two.' + rw('par') + '\n'
    + rw('pard') + rw('s0') + ' {' + rw('i') + ' Slowly' + rw('line') + ' the tide}' + ' came in.' + rw('par') + '\n'
    + rw('pard') + rw('s0') + ' ' + REFS.join(rw('line') + ' ') + rw('par') + '\n'
    + rtfH('Chapter 2') + rtfP(LAST)) })],
  ['breaks.epub', async () => ({ bytes: await epub([
    { title: 'One', body: '<h1>Chapter 1</h1><p>' + BODY + '</p><p>' + LINES.join('<br/>') + '</p><p>First of two.<br/><br/>Second of two.</p><p><em>Slowly<br/>the tide</em> came in.</p><blockquote><p>' + QUOTE.join('<br/>') + '</p></blockquote><p>' + REFS.join('<br/>') + '</p>' },
    { title: 'Two', body: '<h1>Chapter 2</h1><p>' + LAST + '</p>' },
  ]), text: '' })],
];
const one = (g: Got) => blocksOf((written(g).find((s) => s.type === 'chapter' && s.number === '1') || { content: '' }).content);
const chapters = (g: Got) => written(g).filter((s) => s.type === 'chapter').map((s) => s.number);

beforeAll(async () => { await setupImport('import-line-breaks-as-given'); }, 180_000);

describe('a line break the writer typed inside a paragraph is stored as a line break', () => {
  it.each(FILES)('%s: an address of three lines is three lines; an empty line parts two paragraphs; emphasis closes at the break; a line that reads as a heading opens no chapter', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    const blocks = one(g);
    expect(chapters(g), name + ': the book has its two chapters and no third').toEqual(['1', '2']);
    expect(blocks, name).toContain(LINES.join(BR));
    expect(blocks, name).toContain('First of two.');
    expect(blocks, name).toContain('Second of two.');
    expect(blocks, name).toContain('*Slowly*' + BR + '*the tide* came in.');
    expect(blocks, name).toContain(REFS.join(BR));
    expect(blocks.some((b) => b.indexOf(LINES.join(' ')) !== -1 || b.indexOf('First of two. Second of two.') !== -1), name + ': no break is closed up as a space').toBe(false);
    expect(figures(g), name + ': the tally').toEqual(CLEAR);
    /* the paragraph parted by an empty line is two paragraphs in the file's count too: the tally's rows agree.
       (The OpenDocument file's count is one more than the book's, as it was before this change: the tally reads its
       quotation as a paragraph, and the row says that one is in the book as a quotation.) */
    expect(g.tally.rows.filter((r) => r.key === 'paragraphs').map((r) => r.file - r.book), name + ': paragraphs, in the file less in the book').toEqual([/odt$/.test(name) ? 1 : 0]);
  }, 120_000);

  it.each(FILES)('%s: each line of a quotation\'s paragraph is a line of the quotation, its break marked as the writer\'s', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    if (/rtf$/.test(name)) return; /* the RTF made here marks no quotation: its lines are held by the case above */
    expect(one(g), name).toContain(QUOTE.map((l) => '> ' + l).join(BR));
  }, 120_000);
});

describe('what a line break is in Markdown and in plain text, as measured: each keeps its own rule', () => {
  it('Markdown: a hard break in each of its three spellings (two trailing spaces, a backslash, <br>) is stored as the marked break; a plain newline stays the bare newline it is', async () => {
    const g = await importFile('breaks.md', null, ['# Chapter 1', BODY, LINES[0] + '  \n' + LINES[1] + BS + '\n' + LINES[2], 'A line<br>and its next.', 'Wrapped here\nby the writer.', '# Chapter 2', LAST].join('\n\n') + '\n');
    const blocks = one(g);
    expect(blocks).toContain('A line' + BR + 'and its next.');
    expect(blocks).toContain('Wrapped here\nby the writer.');
    /* the three lines stay three lines, and each line end is the mark: the two spaces are gone (white space at a line's end is not stored), the backslash the writer typed stays as typed */
    expect(blocks).toContain(LINES.join(BR));
    expect(figures(g), 'the tally: the backslash is markup on both sides').toEqual(CLEAR);
  }, 120_000);

  it('plain text: an address typed on three lines, in a file whose paragraphs run long on one line each, keeps its three lines (import-text-lines.test.ts holds the rule)', async () => {
    const g = await importFile('breaks.txt', null, ['Chapter 1', BODY, LINES.join('\n'), 'Chapter 2', LAST].join('\n\n') + '\n');
    expect(one(g)).toContain(LINES.join(BR));
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('pinned, not kept: a line break in a heading, a list\'s item and a table\'s cell is still a space', () => {
  it('a web page: "Chapter 1<br>The Muster" is one heading; an item and a cell hold their two lines as one', async () => {
    const g = await importFile('breaks-not-kept.html', null, page('<h1>Chapter 1<br>The Muster</h1><p>' + BODY + '</p><ul><li>item one<br>goes on</li><li>item two</li></ul>'
      + '<table><tr><td>cell one<br>line two</td><td>cell b</td></tr><tr><td>c</td><td>d</td></tr></table><h1>Chapter 2</h1><p>' + LAST + '</p>'));
    const ch = written(g).find((s) => s.type === 'chapter' && s.number === '1')!;
    expect(ch.title).toBe('The Muster');
    expect(ch.content).toContain('- item one goes on\n- item two');
    expect(ch.content).toContain('cell one line two');
  }, 120_000);
});

/* Found on a real manuscript (private; counts only), 2026-11-22: 68 of its paragraphs hold line breaks, and its
   Paragraphs row said "24 in the file not explained, 23 in the book not explained" of paragraphs that are in both.
   The book's side knows a paragraph of several lines by its first line; the file's side knew it by its first six
   words, across its lines. Where the first line has fewer than six words the two never met. The row only says so
   where its totals differ (here: a title page's lines, set aside), which is why no book with equal totals showed it. */
describe('the tally counts a paragraph of several lines the same way on both sides', () => {
  type Row = { key: string; file: number; book: number; why?: { k: string; n: number }[] };
  const para = (...lines: string[]) => '<w:p>' + lines.map((l) => wr(l)).join(WBR) + '</w:p>';
  it('Word: paragraphs whose first line is short, in a book whose Paragraphs totals differ: no line of the row is "not explained"', async () => {
    const g = await importFile('salt.docx', await docx(wp('The Salt Road') + wp('by Ada Wren') + wp('Chapter 1', true) + wp(BODY)
      + para('The rule:', 'Nobody on the quay spoke of the ledger that year.')
      + para('Listen.', 'The tide came in slowly.', 'The lamps came on along the wall.')
      + para('She said it once, and plainly enough for the whole quay to hear it.', 'Nobody answered.')
      + wp('Chapter 2', true) + wp(LAST)), '');
    const row = ((g.tally as unknown as { rows: Row[] }).rows).find((r) => r.key === 'paragraphs')!;
    expect(row.file, 'the totals differ, so the row gives its reasons').not.toBe(row.book);
    expect((row.why || []).filter((y) => y.k === 'none'), 'nothing unexplained on either side').toEqual([]);
    expect(blocksOf(written(g).filter((s) => s.type === 'chapter')[0].content)).toEqual([BODY, 'The rule:' + BR + 'Nobody on the quay spoke of the ledger that year.',
      'Listen.' + BR + 'The tide came in slowly.' + BR + 'The lamps came on along the wall.', 'She said it once, and plainly enough for the whole quay to hear it.' + BR + 'Nobody answered.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
