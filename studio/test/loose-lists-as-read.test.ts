// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, figures, importFile, setupImport, written, type Got } from './import-given';

/* A list whose items the writer parted with blank lines (found on a real manuscript, by counts only: its Word file
   came in as lists, its Markdown file as paragraphs that each opened "* ", its plain-text file likewise).

   The stored text is right and stays exactly as typed, blank lines included: nothing here changes what the import
   stores. What was wrong is the READING. A block is what stands between two blank lines; a lone "* item" block is
   prose (it takes two items to make a bulleted list) and a lone "2. item" block a list of one. So the page set the
   writer's list as paragraphs opening on an asterisk, and a numbered one as so many one-item lists.

   Now (BEUK:looselists) the book reads a run of two or more blocks that open on a list's mark of one kind (a
   number; or "*" or "•") as one list, where it reads a list: the page (preview, print, EPUB), the Word export and
   the tally's count of list items. The Markdown export writes the stored blocks as typed.

   The plain-text shape, a block of text lines whose LAST line alone opens on a mark, with the next block opening on
   a mark of the same kind: that line is read as the first item of the list that goes on straight after it, and the
   lines over it as the paragraph they are. The evidence is in the text itself (the list continues); where no such
   block follows, the line stays a line of its paragraph. An item whose own text runs on to further lines keeps them.

   NOT read as a list, pinned here so it cannot move unseen: blocks that open on "- ". A hyphen and a space also
   open a line of dialogue in manuscripts typed so; whether a run of them is a list is not something the text
   settles. Every text here is made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '.';
const MD = ['# Chapter 1', P(1), 'He packed:', '* a lantern', '* a coil of rope', '* the ledger', P(2), '1. first the quay', '2. then the pans', '4. then home', P(3), '# Chapter 2', P(5)].join('\n\n') + '\n';
const MD_DASH = ['# Chapter 1', P(1), '- Gone, said the pilot.', '- Gone where? said the clerk.', P(2), '# Chapter 2', P(5)].join('\n\n') + '\n';
const TXT = ['Chapter 1', P(1), 'He packed, and the list was short\nand it ran so:\n * a lantern', ' * a coil of rope', ' * the ledger that he would\nnot leave behind', P(2), 'Then, in order:\n 1. first the quay', ' 2. then the pans', ' 3. then home', P(3),
  'A paragraph whose last line opens on a mark\n * and nothing follows it as a list', P(4), 'Chapter 2', P(5)].join('\n\n') + '\n';
type File = { path: string; content: string };
const pageOf = (g: Got, word: string) => (g.api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path) && f.content.indexOf(word) !== -1).map((f) => f.content).join('');
const one = (g: Got) => written(g).find((s) => s.type === 'chapter' && s.number === '1')!.content;
const listRow = (g: Got) => { const r = g.tally.rows.find((x) => x.key === 'listItems'); return r ? [r.file, r.book] : null; };
const wordItems = (g: Got) => { const doc = (g.api.buildDocxFiles() as File[]).find((f) => f.path === 'word/document.xml')!.content; return Array.from(doc.matchAll(/<w:numPr>.*?<\/w:numPr><\/w:pPr><w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:t[^>]*>([^<]*)<\/w:t>/g)).map((m) => m[1]); };

beforeAll(async () => { await setupImport('loose-lists-as-read', ['epubFiles', 'buildDocxFiles', 'buildMarkdown']); }, 180_000);

describe('a list whose items are parted by blank lines is read as the list it is; the stored text stays as typed', () => {
  it('Markdown: the stored text keeps every blank line; the page sets one bulleted list and one numbered list, each number as stored', async () => {
    const g = await importFile('loose.md', null, MD);
    expect(one(g)).toContain('He packed:\n\n* a lantern\n\n* a coil of rope\n\n* the ledger\n\n');
    expect(one(g)).toContain('1. first the quay\n\n2. then the pans\n\n4. then home');
    const page = pageOf(g, 'lantern');
    expect(page).toContain('<p>He packed:</p>\n<ul class="book-list"><li>a lantern</li><li>a coil of rope</li><li>the ledger</li></ul>');
    expect(page).toContain('<ol class="book-list"><li>first the quay</li><li>then the pans</li><li value="4">then home</li></ol>');
    expect(page).not.toContain('<p>* ');
    expect(figures(g)).toEqual(CLEAR);
    expect(listRow(g), 'list items, in the file and in the book').toEqual([6, 6]);
  }, 120_000);

  it('Markdown: the Word export sets them as list paragraphs, and the Markdown export writes the blocks as stored', async () => {
    const g = await importFile('loose.md', null, MD);
    expect(wordItems(g)).toEqual(['a lantern', 'a coil of rope', 'the ledger', 'first the quay', 'then the pans', 'then home']);
    expect(g.api.buildMarkdown() as string).toContain('He packed:\n\n* a lantern\n\n* a coil of rope\n\n* the ledger\n\n');
  }, 120_000);

  it('plain text: an item line that ends a block of text lines is the first item of the list that goes on after it; an item\'s own further lines stay its own', async () => {
    const g = await importFile('loose.txt', null, TXT);
    /* stored as typed: the text lines, the item line under them, the blank lines, the one-space indent.
       BEUK:textlines — this file's paragraphs stand on one long line each, so a short line of a paragraph that another
       line follows is a line the writer ended, and is stored marked as one (BS, a backslash straight before the
       newline) and set as a line break: "…the list was short" / "and it ran so:". Until that rule both pins below
       held a bare newline and one flowing line. No mark is written before a line that is a list's item, nor inside
       an item ("the ledger that he would" / "not leave behind" stays the item's own two lines). */
    const BS = String.fromCharCode(92);
    expect(one(g)).toContain('He packed, and the list was short' + BS + '\nand it ran so:\n * a lantern\n\n * a coil of rope\n\n * the ledger that he would\nnot leave behind');
    const page = pageOf(g, 'lantern');
    expect(page).toContain('<p>He packed, and the list was short<br/>and it ran so:</p>\n<ul class="book-list"><li>a lantern</li><li>a coil of rope</li><li>the ledger that he would not leave behind</li></ul>');
    expect(page).toContain('<p>Then, in order:</p>\n<ol class="book-list"><li>first the quay</li><li>then the pans</li><li>then home</li></ol>');
    /* no list follows: the line stays a line of its paragraph, and a line of its own, as the writer ended the one before it */
    expect(page).toContain('<p>A paragraph whose last line opens on a mark<br/> * and nothing follows it as a list</p>');
    expect(wordItems(g)).toEqual(['a lantern', 'a coil of rope', 'the ledger that he would not leave behind', 'first the quay', 'then the pans', 'then home']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('pinned, not read as a list: paragraphs that open on "- " (a line of dialogue is typed so) stay paragraphs', async () => {
    const g = await importFile('dashes.md', null, MD_DASH);
    const page = pageOf(g, 'pilot');
    expect(page).toContain('<p>- Gone, said the pilot.</p>\n<p>- Gone where? said the clerk.</p>');
    expect(page).not.toContain('<ul');
  }, 120_000);
});
