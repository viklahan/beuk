// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, epub, figures, importFile, page, rtfDoc, rtfEsc, rtfH, rtfP, rw, setupImport, written, xml, type Got } from './import-given';

/* The book's list holds the mark the writer typed (BEUK:listmarkstyped; the owner's rule: "KEEP WHAT THE WRITER GIVES
   US").

   Measured before, on made-up files with ten lists of three items each, typed "a." "b." "c.", "iv." "v." "vi.",
   "(1)" "(2)" "(3)", "2)" "3)" "4)", "+", "◆", "●", "A)" "B)" "D)", "5." "6." "9." and "-":
     - Markdown and plain text: the lettered, Roman and bracketed ones were five paragraphs each opening on its marks,
       "+" and "◆" were stored "-", "●" was a paragraph, "2) 3) 4)" was drawn 2. 3. 4.;
     - RTF (its marks written out): "a." "iv." "(1)" "A)" were stored 1. 2. 3., every bullet stored "-", and the
       tally counted 38 characters of marks as set aside;
     - a web page and an EPUB (the mark an element at the head of each item): "+", "◆", "●" were left out and counted
       as set aside, the lettered marks stood among the item's words under a "-" of Beuk's.
   Now every one is stored under the mark typed, read as a list wherever two or more such marks climb, and set under
   that mark on the page, in the EPUB, in the Word export and in the Markdown export. A list of "-", "*", "•" or of
   numbers closed with a full stop is set exactly as it was. A letter and a full stop also open a name: one such
   line alone, or lines whose letters do not climb ("Q." then "A."), stay the paragraph they are. Every text here is
   made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '.';
const LISTS = [['a.', 'b.', 'c.'], ['iv.', 'v.', 'vi.'], ['(1)', '(2)', '(3)'], ['2)', '3)', '4)'], ['+', '+', '+'], ['◆', '◆', '◆'], ['●', '●', '●'], ['A)', 'B)', 'D)'], ['5.', '6.', '9.'], ['-', '-', '-']];
const WORDS = ['a lantern', 'a chart case', 'two letters'];
const STORED = LISTS.map((L, i) => L.map((m, k) => m + ' ' + WORDS[k] + ' ' + i).join('\n'));
const mdText = (sep: string) => ['# Chapter 1', P(1), ...LISTS.flatMap((L, i) => [L.map((m, k) => m + ' ' + WORDS[k] + ' ' + i).join(sep), P(2 + i)]), '# Chapter 2', P(40)].join('\n\n') + '\n';
const htmlBody = () => '<h1>Chapter 1</h1><p>' + P(1) + '</p>' + LISTS.map((L, i) => '<ul>' + L.map((m, k) => '<li><span aria-hidden="true">' + xml(m) + '</span> ' + WORDS[k] + ' ' + i + '</li>').join('') + '</ul><p>' + P(2 + i) + '</p>').join('');
const rtfText = () => rtfDoc(rtfH('Chapter 1') + rtfP(P(1)) + LISTS.map((L, i) => L.map((m, k) => rw('pard') + rw('ls1') + '{' + rw('listtext') + ' ' + rtfEsc(m) + rw('tab') + '}' + rtfEsc(WORDS[k] + ' ' + i) + rw('par') + '\n').join('') + rtfP(P(2 + i))).join('') + rtfH('Chapter 2') + rtfP(P(40)));

type File = { path: string; content: string };
const one = (g: Got) => written(g).find((s) => s.type === 'chapter' && /lantern/.test(s.content))!.content;
const listBlocks = (g: Got) => one(g).split(/\n\s*\n/).filter((b) => /lantern|chart case|two letters/.test(b));
const pageOf = (g: Got, word: string) => (g.api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path) && f.content.indexOf(word) !== -1).map((f) => f.content).join('');
const lists = (html: string) => Array.from(html.matchAll(/<(ol|ul)[^>]*>.*?<\/\1>/g)).map((m) => m[0].replace(/ \d<\/li>/g, '</li>'));
const li = (marks: string[], vals: (string | null)[] = []) => marks.map((m, k) => '<li' + (vals[k] ? ' value="' + vals[k] + '"' : '') + '>' + (m ? '<span class="li-mark">' + m + ' </span>' : '') + WORDS[k] + '</li>').join('');
const PAGE = [
  '<ol class="book-list book-list-typed">' + li(['a.', 'b.', 'c.']) + '</ol>',
  '<ol class="book-list book-list-typed" start="4">' + li(['iv.', 'v.', 'vi.']) + '</ol>',
  '<ol class="book-list book-list-typed">' + li(['(1)', '(2)', '(3)']) + '</ol>',
  '<ol class="book-list book-list-typed" start="2">' + li(['2)', '3)', '4)']) + '</ol>',
  '<ul class="book-list book-list-typed">' + li(['+', '+', '+']) + '</ul>',
  '<ul class="book-list book-list-typed">' + li(['◆', '◆', '◆']) + '</ul>',
  '<ul class="book-list book-list-typed">' + li(['●', '●', '●']) + '</ul>',
  '<ol class="book-list book-list-typed">' + li(['A)', 'B)', 'D)'], [null, null, '4']) + '</ol>',
  /* and the two kinds the book's list always drew are written exactly as they were */
  '<ol class="book-list" start="5">' + li(['', '', ''], [null, null, '9']) + '</ol>',
  '<ul class="book-list">' + li(['', '', '']) + '</ul>',
];
const listRow = (g: Got) => { const r = g.tally.rows.find((x) => x.key === 'listItems') as { file: number; book: number; why?: unknown[] } | undefined; return r ? [r.file, r.book, r.why || []] : null; };

beforeAll(async () => { await setupImport('list-marks-as-typed', ['epubFiles', 'buildDocxFiles', 'buildMarkdown']); }, 180_000);

describe('a list is stored under the marks the writer typed, in every format that gives them', () => {
  const cases: [string, () => Promise<Got>][] = [
    ['Markdown', () => importFile('typed.md', null, mdText('\n'))],
    ['plain text', () => importFile('typed.txt', null, mdText('\n').replace(/^# /gm, ''))],
    ['RTF, its marks written out', () => importFile('typed.rtf', null, rtfText())],
    ['a web page, each item opening on its own mark', () => importFile('typed.html', null, page(htmlBody()))],
  ];
  for (const [what, read] of cases) {
    it(what + ': each of the ten lists is stored as typed, set under its marks on the page, and the tally is exact', async () => {
      const g = await read();
      expect(listBlocks(g)).toEqual(STORED);
      expect(lists(pageOf(g, 'lantern'))).toEqual(PAGE);
      expect(figures(g)).toEqual(CLEAR);
      expect(g.tally.aside.listMarks, 'no mark is set aside: each is in the book').toBeUndefined();
      expect(listRow(g), 'list items, in the file and in the book').toEqual([30, 30, []]);
    }, 120_000);
  }

  it('EPUB, each item opening on its own mark: stored as typed, and the tally is exact', async () => {
    const g = await importFile('typed.epub', await epub([{ title: 'Chapter 1', body: htmlBody() }, { title: 'Chapter 2', body: '<h1>Chapter 2</h1><p>' + P(40) + '</p>' }]), '');
    expect(listBlocks(g)).toEqual(STORED);
    expect(figures(g)).toEqual(CLEAR);
    expect(g.tally.aside.listMarks).toBeUndefined();
  }, 120_000);

  it('Markdown, the items parted by blank lines: the same lists, but for "- " (a line of dialogue is typed so)', async () => {
    const g = await importFile('loose.md', null, mdText('\n\n'));
    expect(listBlocks(g)).toEqual(STORED.flatMap((b) => b.split('\n')));
    expect(lists(pageOf(g, 'lantern'))).toEqual(PAGE.slice(0, 9));
    expect(figures(g)).toEqual(CLEAR);
    expect(listRow(g)).toEqual([30, 27, [{ k: 'book', row: 'paragraphs', n: 3, side: 1 }]]);
  }, 120_000);
});

describe('the Word and Markdown exports write the marks as typed', () => {
  it('Word: numbering of the mark\'s own kind wherever Word writes the mark as typed, the mark itself otherwise; the Markdown export writes the block as stored', async () => {
    const g = await importFile('typed.md', null, ['# Chapter 1', P(1), 'a. one\nb. two\nc. three', P(2), 'iv. one\nv. two\nvii. three', P(3), '(1) one\n(2) two', P(4), 'A) one\nB) two', P(5), '+ one\n+ two', P(6), '◆ one\n- two\n◆ three', P(7),
      '(01) one\n(02) two', P(8), '5. one\n6. two\n\n- one\n- two', '# Chapter 2', P(40)].join('\n\n') + '\n');
    const files = g.api.buildDocxFiles() as File[];
    const num = files.find((f) => f.path === 'word/numbering.xml')!.content;
    const abs = Array.from(num.matchAll(/<w:abstractNum w:abstractNumId="(\d+)">.*?<w:numFmt w:val="([^"]+)"\/><w:lvlText w:val="([^"]+)"\/>/g)).map((m) => m[1] + ' ' + m[2] + ' ' + m[3]);
    expect(abs).toEqual(['0 bullet •', '1 decimal %1.', '2 decimal %1)', '3 lowerLetter %1.', '4 lowerRoman %1.', '5 decimal (%1)', '6 upperLetter %1)', '7 bullet +', '8 bullet ◆', '9 bullet (01)', '10 bullet (02)']);
    const nums = Array.from(num.matchAll(/<w:num w:numId="(\d+)"><w:abstractNumId w:val="(\d+)"\/>(?:<w:lvlOverride w:ilvl="0"><w:startOverride w:val="(\d+)"\/>)?/g)).map((m) => m[2] + (m[3] ? '@' + m[3] : ''));
    /* a.b.c. one instance; iv. v. then vii. opens its own at 7; a bullet of the writer's own between two of the book's */
    expect(nums).toEqual(['3@1', '4@4', '4@7', '5@1', '6@1', '7', '8', '0', '8', '9', '10', '1@5', '0']);
    const md = g.api.buildMarkdown() as string;
    for (const b of ['a. one\nb. two\nc. three', 'iv. one\nv. two\nvii. three', '(1) one\n(2) two', 'A) one\nB) two', '+ one\n+ two', '◆ one\n- two\n◆ three', '(01) one\n(02) two']) expect(md).toContain('\n\n' + b + '\n\n');
  }, 120_000);
});

describe('a letter and a full stop also open a name: read as a list only on the text\'s own evidence', () => {
  it('one such line alone, letters that do not climb, a word, and marks of two shapes stay the paragraphs they are; nothing is taken from them', async () => {
    const g = await importFile('names.md', null, ['# Chapter 1', P(1), 'A. Conan Doyle wrote of a hound, and the pans lay white that year.', P(2), 'Q. What did the clerk see?\nA. Nothing at all.', P(3), 'Mix. Then pour the brine.\nStir. Then wait.', P(4),
      'a. the first of them\nB. the second of them', P(5), 'I. the quay\nII. the pans\nIV. the ledger', '# Chapter 2', P(40)].join('\n\n') + '\n');
    const html = pageOf(g, 'Conan');
    expect(html).toContain('<p>A. Conan Doyle wrote of a hound, and the pans lay white that year.</p>');
    expect(html).toContain('<p>Q. What did the clerk see? A. Nothing at all.</p>');
    expect(html).toContain('<p>Mix. Then pour the brine. Stir. Then wait.</p>');
    expect(html).toContain('<p>a. the first of them B. the second of them</p>');
    /* Roman numerals that climb are a list, each under its own */
    expect(html).toContain('<ol class="book-list book-list-typed"><li><span class="li-mark">I. </span>the quay</li><li><span class="li-mark">II. </span>the pans</li><li value="4"><span class="li-mark">IV. </span>the ledger</li></ol>');
    expect(written(g).find((s) => s.type === 'chapter' && /Conan/.test(s.content))!.content).toContain('Q. What did the clerk see?\nA. Nothing at all.');
    expect(figures(g)).toEqual(CLEAR);
    expect(listRow(g)).toEqual([3, 3, []]);
  }, 120_000);
});

describe('the book\'s own EPUB, read back', () => {
  it('a list exported under its typed marks comes back under the same marks', async () => {
    const g = await importFile('typed.md', null, mdText('\n'));
    const files = (g.api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path) && /lantern/.test(f.content));
    expect(files.length).toBe(1);
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(files[0].content)![1];
    const back = await importFile('back.epub', await epub([{ title: 'Chapter 1', body: '<h1>Chapter 1</h1>' + body }, { title: 'Chapter 2', body: '<h1>Chapter 2</h1><p>' + P(40) + '</p>' }]), '');
    /* all but the list numbered 5. 6. 9.: the EPUB carries its 9 as <li value>, which the EPUB reader does not read yet (the numbers a file's own markup gives are their own piece of work) */
    expect(listBlocks(back).filter((b, i) => i !== 8)).toEqual(STORED.filter((b, i) => i !== 8));
    expect(figures(back)).toEqual(CLEAR);
  }, 120_000);
});
