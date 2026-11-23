// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, W_NS, docx, epub, figures, importFile, odt, oh, op, page, setupImport, wp, written, xml, type Got } from './import-given';

/* The numbers and letters a file's own application draws are the ones stored (BEUK:listnumbersdrawn).

   None of them is text of the file: a web page's or an EPUB's <ol> says them in its markup (start, type, reversed,
   an item's value), a Word file in word/numbering.xml (each level's format, text and start; an instance's
   startOverride), an OpenDocument file in its list styles. Measured before, on made-up files: a web page's and an
   EPUB's list read only `start`, so type="a" start="3" came in "3. 4. 5.", type="I" came in "1. 2. 3.", an item
   given value="7" was numbered 2, a reversed list counted up; a Word and an OpenDocument list came in "1. 2. 3."
   whatever the document showed ("5. 6. 7.", "c. d. e.", "I. II. III.", "(1) (2) (3)") and a bullet that is a
   character of its own ("◆") came in "-".

   Now each item is stored under the mark the writer's document shows, and the tally's file side works the same
   marks out from the file itself and counts them: the two sides agree only where the import stored what the
   document shows. A bullet set from a symbol font has no character of its own to keep and stays the book's "-".
   Every text here is made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '.';
const W3 = ['the quay', 'the pans', 'the ledger'];
const one = (g: Got) => written(g).find((s) => s.type === 'chapter' && /the quay/.test(s.content))!.content;
/** the chapter's list blocks, each item as its mark and its last word */
const lists = (g: Got) => one(g).split(/\n\s*\n/).filter((b) => !/^The pans/.test(b)).map((b) => b.split('\n').map((l) => l.replace(/ (the quay|the pans|the ledger)/, '')).join(' | '));
const listRow = (g: Got) => { const r = g.tally.rows.find((x) => x.key === 'listItems'); return r ? [r.file, r.book] : null; };

const li = (a: [string, number?][]) => a.map((x) => '<li' + (x[1] ? ' value="' + x[1] + '"' : '') + '>' + x[0] + '</li>').join('');
const all = (word: string): [string, number?][] => W3.map((w) => [w + ' ' + word]);
const htmlBody = (reversed: string) => '<h1>Chapter 1</h1><p>' + P(1) + '</p>'
  + '<ol start="5">' + li(all('five')) + '</ol><p>' + P(2) + '</p>'
  + '<ol type="a" start="3">' + li(all('letter')) + '</ol><p>' + P(3) + '</p>'
  + '<ol type="I">' + li(all('roman')) + '</ol><p>' + P(4) + '</p>'
  + '<ol>' + li([[W3[0] + ' value'], [W3[1] + ' value', 7], [W3[2] + ' value']]) + '</ol><p>' + P(5) + '</p>'
  + '<ol ' + reversed + '>' + li(all('back')) + '</ol><p>' + P(6) + '</p>'
  + '<ol style="list-style-type: lower-roman">' + li(all('styled')) + '</ol><p>' + P(7) + '</p>'
  + '<ol>' + li(all('plain')) + '</ol><p>' + P(8) + '</p>';
const WEB = ['5. five | 6. five | 7. five', 'c. letter | d. letter | e. letter', 'I. roman | II. roman | III. roman', '1. value | 7. value | 8. value', '3. back | 2. back | 1. back', 'i. styled | ii. styled | iii. styled', '1. plain | 2. plain | 3. plain'];

const DEFS: [string, string, number][] = [['decimal', '%1.', 5], ['lowerLetter', '%1.', 3], ['upperRoman', '%1.', 1], ['decimal', '(%1)', 1], ['bullet', '◆', 1], ['bullet', '', 1], ['lowerLetter', '%1)', 1], ['decimal', '%1.', 1]];
const NUMBERING = '<?xml version="1.0" encoding="UTF-8"?><w:numbering ' + W_NS + '>'
  + DEFS.map((d, i) => '<w:abstractNum w:abstractNumId="' + i + '"><w:lvl w:ilvl="0"><w:start w:val="' + d[2] + '"/><w:numFmt w:val="' + d[0] + '"/><w:lvlText w:val="' + d[1] + '"/></w:lvl></w:abstractNum>').join('')
  + DEFS.map((d, i) => '<w:num w:numId="' + (i + 1) + '"><w:abstractNumId w:val="' + i + '"/></w:num>').join('')
  /* a second list from the last definition that says where it starts (startOverride), and a third that does not. The
     reader counts the third on from the second: lists of one definition share its count unless an instance says
     where it starts. That is the rule as the reader follows it, held here so it cannot move unseen; it was not
     checked against Word itself. */
  + '<w:num w:numId="9"><w:abstractNumId w:val="7"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="12"/></w:lvlOverride></w:num><w:num w:numId="10"><w:abstractNumId w:val="7"/></w:num></w:numbering>';
const wli = (s: string, id: number) => '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + id + '"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>';
const WNAMES = ['five', 'letter', 'roman', 'bracket', 'diamond', 'symbol', 'closed', 'plain', 'restart', 'on'];
const WORD = ['5. five | 6. five | 7. five', 'c. letter | d. letter | e. letter', 'I. roman | II. roman | III. roman', '(1) bracket | (2) bracket | (3) bracket', '◆ diamond | ◆ diamond | ◆ diamond', '- symbol | - symbol | - symbol',
  'a) closed | b) closed | c) closed', '1. plain | 2. plain | 3. plain', '12. restart | 13. restart | 14. restart', '15. on | 16. on | 17. on'];

const OSTYLES: [string, string][] = [['L1', '<text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="." text:start-value="5"/>'], ['L2', '<text:list-level-style-number text:level="1" style:num-format="a" style:num-suffix="." text:start-value="3"/>'],
  ['L3', '<text:list-level-style-number text:level="1" style:num-format="I" style:num-suffix="."/>'], ['L4', '<text:list-level-style-number text:level="1" style:num-format="1" style:num-prefix="(" style:num-suffix=")"/>'],
  ['L5', '<text:list-level-style-bullet text:level="1" text:bullet-char="◆"/>'], ['L6', '<text:list-level-style-bullet text:level="1" text:bullet-char=""/>'], ['L7', '<text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."/>']];
const ONAMES = ['five', 'letter', 'roman', 'bracket', 'diamond', 'symbol', 'value'];
const OPEN = ['5. five | 6. five | 7. five', 'c. letter | d. letter | e. letter', 'I. roman | II. roman | III. roman', '(1) bracket | (2) bracket | (3) bracket', '◆ diamond | ◆ diamond | ◆ diamond', '- symbol | - symbol | - symbol', '1. value | 7. value | 8. value'];

beforeAll(async () => { await setupImport('list-numbers-drawn', ['epubFiles']); }, 180_000);

describe('a list comes in under the numbers and letters the writer\'s document shows', () => {
  it('a web page: start, type, an item\'s value, reversed, and a list-style-type of its own', async () => {
    const g = await importFile('drawn.html', null, page(htmlBody('reversed') + '<h1>Chapter 2</h1><p>' + P(40) + '</p>'));
    expect(lists(g)).toEqual(WEB);
    expect(figures(g)).toEqual(CLEAR);
    expect(listRow(g)).toEqual([21, 21]);
  }, 120_000);

  it('an EPUB: the same markup, the same lists', async () => {
    const g = await importFile('drawn.epub', await epub([{ title: 'Chapter 1', body: htmlBody('reversed="reversed"') }, { title: 'Chapter 2', body: '<h1>Chapter 2</h1><p>' + P(40) + '</p>' }]), '');
    expect(lists(g)).toEqual(WEB);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a Word file: each level\'s format, text and start from word/numbering.xml; an instance that says where it starts, and one that counts on', async () => {
    const body = wp('Chapter 1', true) + wp(P(1)) + WNAMES.map((n, i) => W3.map((w) => wli(w + ' ' + n, i + 1)).join('') + wp(P(2 + i))).join('') + wp('Chapter 2', true) + wp(P(40));
    const g = await importFile('drawn.docx', await docx(body, { 'word/numbering.xml': NUMBERING }), '');
    expect(lists(g)).toEqual(WORD);
    expect(figures(g)).toEqual(CLEAR);
    expect(listRow(g)).toEqual([30, 30]);
  }, 120_000);

  it('an OpenDocument file: each list style\'s format, the characters around the number, where it starts, an item\'s own number, a bullet of its own', async () => {
    const body = oh('Chapter 1') + op(P(1)) + ONAMES.map((n, i) => '<text:list text:style-name="L' + (i + 1) + '">' + W3.map((w, k) => '<text:list-item' + (n === 'value' && k === 1 ? ' text:start-value="7"' : '') + '><text:p>' + w + ' ' + n + '</text:p></text:list-item>').join('') + '</text:list>' + op(P(2 + i))).join('')
      + oh('Chapter 2') + op(P(40));
    const g = await importFile('drawn.odt', await odt(body, OSTYLES.map((s) => '<text:list-style style:name="' + s[0] + '">' + s[1] + '</text:list-style>').join('')), '');
    expect(lists(g)).toEqual(OPEN);
    expect(figures(g)).toEqual(CLEAR);
    expect(listRow(g)).toEqual([21, 21]);
  }, 120_000);
});

describe('what is then set', () => {
  it('the page sets each item under the stored mark: a lettered list from a Word file is lettered in the EPUB', async () => {
    const body = wp('Chapter 1', true) + wp(P(1)) + W3.map((w) => wli(w + ' letter', 2)).join('') + wp(P(2)) + wp('Chapter 2', true) + wp(P(40));
    const g = await importFile('drawn.docx', await docx(body, { 'word/numbering.xml': NUMBERING }), '');
    const html = (g.api.epubFiles('generic') as { path: string; content: string }[]).filter((f) => /\.xhtml$/.test(f.path) && f.content.indexOf('the quay') !== -1).map((f) => f.content).join('');
    expect(html).toContain('<ol class="book-list book-list-typed" start="3"><li><span class="li-mark">c. </span>the quay letter</li><li><span class="li-mark">d. </span>the pans letter</li><li><span class="li-mark">e. </span>the ledger letter</li></ol>');
  }, 120_000);
});
