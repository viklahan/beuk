// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { importFile, setupImport, written, type Got } from './import-given';

/* The owner's rule (2026-11-22): "We do not change anything from what the writer gives us." A list's number is a
   character the writer typed, and the book stores it (import-list-marks-as-given.test.ts). Until this test every
   surface but the Markdown export read only a list's FIRST number and counted on from it in steps of one
   (listItemsOf's `start`): a block stored 1. 2. 4. was shown 1. 2. 3., one stored 3. 7. 9. was shown 3. 4. 5.

   Now (BEUK:listmarksgiven) each surface sets each item's own stored number:
   - the page (preview, print, EPUB, web page): an item whose number is not the one before it plus one carries it
     as <li value="…">. That is plain HTML: every browser and e-reader numbers the item by it and asks no
     stylesheet, which is why it was chosen over a counter set in CSS. A list numbered on in steps of one is written
     exactly as it always was (no value), so no book whose lists run 1, 2, 3 changes by a byte;
   - the Word export: real Word numbering that starts and steps as stored. Word counts on from a list's start, so
     an item that breaks the count opens a numbering instance of its own, starting at its number; an item the
     writer closed with a bracket ("1)") is numbered from a definition that closes on a bracket ("%1)");
   - the Markdown export writes the block as stored, as it always did.

   Done since (BEUK:listmarkstyped): on the page a number closed with a bracket was shown closed with a full stop
   ("1)" shown "1."), and this file pinned that. Such a list is now set under its marks as typed (book-list-typed:
   each item's mark its own characters, the list's own marker off by a rule in the book's stylesheet). */

const LAST = 'The pans lay white.';
const MD = ['# Chapter 1', '1. gap one\n2. gap two\n4. gap four', 'Between the lists a line of text.', '3. from three\n7. then seven\n9. then nine', 'And another line of text.',
  '1) bracket one\n2) bracket two\n5) bracket five', 'A last line of text.', '1. plain one\n2. plain two\n3. plain three', 'The page goes on.', '# Chapter 2', LAST].join('\n\n') + '\n';
type File = { path: string; content: string };
let g: Got;

beforeAll(async () => {
  await setupImport('list-numbers-as-stored', ['epubFiles', 'buildDocxFiles', 'buildMarkdown']);
  g = await importFile('lists.md', null, MD);
}, 180_000);

describe('every surface sets a list\'s numbers as the book stores them', () => {
  it('the book stores the lists as typed', () => {
    const c = written(g).find((s) => s.type === 'chapter' && s.number === '1')!.content;
    for (const b of ['1. gap one\n2. gap two\n4. gap four', '3. from three\n7. then seven\n9. then nine', '1) bracket one\n2) bracket two\n5) bracket five']) expect(c).toContain(b);
  });

  it('the EPUB\'s page (the same markup the preview and the print interior set): each item that breaks the count carries its own number', () => {
    const files = g.api.epubFiles('generic') as File[];
    const page = files.filter((f) => /\.xhtml$/.test(f.path) && f.content.indexOf('gap one') !== -1).map((f) => f.content).join('');
    expect(page).toContain('<ol class="book-list"><li>gap one</li><li>gap two</li><li value="4">gap four</li></ol>');
    expect(page).toContain('<ol class="book-list" start="3"><li>from three</li><li value="7">then seven</li><li value="9">then nine</li></ol>');
    expect(page).toContain('<ol class="book-list book-list-typed"><li><span class="li-mark">1) </span>bracket one</li><li><span class="li-mark">2) </span>bracket two</li><li value="5"><span class="li-mark">5) </span>bracket five</li></ol>');
    /* a list numbered on in steps of one is written as it always was */
    expect(page).toContain('<ol class="book-list"><li>plain one</li><li>plain two</li><li>plain three</li></ol>');
  });

  it('the Word export: numbering that starts and steps as stored, closing on a bracket where the writer\'s number does', () => {
    const files = g.api.buildDocxFiles() as File[];
    const doc = files.find((f) => f.path === 'word/document.xml')!.content, num = files.find((f) => f.path === 'word/numbering.xml')!.content;
    /* each list item's numbering instance, in order, with what that instance is: its definition and where it starts */
    const inst = new Map<string, { abs: string; start: string }>();
    for (const m of num.matchAll(/<w:num w:numId="(\d+)"><w:abstractNumId w:val="(\d+)"\/>(?:<w:lvlOverride w:ilvl="0"><w:startOverride w:val="(\d+)"\/><\/w:lvlOverride>)?<\/w:num>/g)) inst.set(m[1], { abs: m[2], start: m[3] || '' });
    const items = Array.from(doc.matchAll(/<w:numId w:val="(\d+)"\/><\/w:numPr><\/w:pPr>(?:<w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:t[^>]*>([^<]*)<\/w:t><\/w:r>)/g)).map((m) => ({ text: m[2], id: m[1], ...inst.get(m[1])! }));
    const of = (t: string) => items.find((x) => x.text === t)!;
    /* 1. 2. 4.: one instance from 1 for the first two, one from 4 for the third */
    expect([of('gap one').start, of('gap two').id === of('gap one').id, of('gap four').start, of('gap four').id !== of('gap one').id]).toEqual(['1', true, '4', true]);
    /* 3. 7. 9.: three instances, from 3, 7 and 9 */
    expect([of('from three').start, of('then seven').start, of('then nine').start]).toEqual(['3', '7', '9']);
    /* 1) 2) 5): the definition that closes on a bracket; from 1 for two items, then from 5 */
    expect([of('bracket one').abs, of('bracket one').start, of('bracket two').id === of('bracket one').id, of('bracket five').abs, of('bracket five').start]).toEqual(['2', '1', true, '2', '5']);
    expect(num).toContain('<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/>');
    /* a plain list is one instance from 1, on the full-stop definition, as it always was */
    expect([of('plain one').abs, of('plain one').start, of('plain two').id === of('plain one').id, of('plain three').id === of('plain one').id]).toEqual(['1', '1', true, true]);
  });

  it('the Markdown export writes each block as stored', () => {
    const md = g.api.buildMarkdown() as string;
    for (const b of ['1. gap one\n2. gap two\n4. gap four', '3. from three\n7. then seven\n9. then nine', '1) bracket one\n2) bracket two\n5) bracket five']) expect(md).toContain(b);
  });
});
