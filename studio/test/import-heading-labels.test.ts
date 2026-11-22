// @vitest-environment node
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
// @ts-expect-error — a plain .mjs build script, no types
import { buildTestModule } from '../scripts/extract-closure.mjs';
import { ORACLE_STUBS } from './import-oracle';
import { loadMammoth } from './vendor';
import markup from '../src/generated/import-markup.json';

/* A heading's own label, counted one way in every format (the import tally, BEUK:importtally).

   A file writes "Chapter 1: Dawn" (Word, Markdown, a web page) or "CHAPTER 1 — DAWN" (plain text). The book stores
   the chapter's number ("1") and its title ("Dawn", "DAWN"), each as the file wrote it; the word before the number
   and the mark after it are not stored: the book sets its own label when it draws the page. The tally says so the
   same way whatever the file: the book's side counts what the book stores (the number where the file gave one, and
   the title), and the label word and the mark are counted in ONE named row (headingMarks), measured from the heading
   as the file gave it against the heading as stored. It is never a "difference" in one format and a row in another.

   The row takes a label and marks, nothing else. Where storing a heading changes a character that IS stored, that
   change is in no row: it stays in the comparison, both sides. (A number written in capitals was once stored in
   title case, and a named page under the book's own name for it: both are stored as the file wrote them now,
   BEUK:casegiven and BEUK:namesgiven, and the cases below hold that nothing differs.) And a number Beuk gives a
   heading that had none is Beuk's: counted on neither side.

   Every figure is characters (a code point that is not whitespace), counted by hand in the comment beside it.
   BEUK_LABELS_OUT names a folder to write each import's sections, records and tally into (made-up text only). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const VENDOR = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
const OUT = process.env.BEUK_LABELS_OUT || '';
type Api = Record<string, (...a: unknown[]) => unknown>;
let make: (env: Rec) => { api: Api };
const noop = () => undefined;
function env(): Rec {
  const e: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis,
    mammoth: (globalThis as Rec).mammoth, pdfLoadLib: async () => (globalThis as Rec).pdfjsLib };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}
type PdfLib = { PDFDocument: { create: () => Promise<{ addPage: (s: [number, number]) => { drawText: (s: string, o: Rec) => void }; embedFont: (f: string) => Promise<unknown>; save: () => Promise<Uint8Array> }> }; StandardFonts: Record<string, string> };
let pdfLib: PdfLib;
type Zip = new () => { file: (p: string, s: string, o?: Rec) => void; generateAsync: (o: Rec) => Promise<Uint8Array> };

type Sec = { type: string; kind?: string; title: string; subtitle?: string; content: string; number?: string };
type Diff = [string, number, string[]][];
type Tally = { v: number; counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; chars: { same: boolean; fileOnly: Diff; bookOnly: Diff } };
type Item = { kind: string; data?: Rec };
type Rep = { tally?: Tally; items?: Item[] };
type Got = { written: Sec[]; tally: Tally };
async function importFile(name: string, bytes: Uint8Array | null, text: string): Promise<Got> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const b = bytes || new TextEncoder().encode(text); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Rep)();
  const doc = m.api.snapshotBookDoc() as { sections: Sec[] };
  /* the pages the import wrote: every page with text, every chapter and every Part */
  const written = doc.sections.filter((s) => /\S/.test(s.content || '') || s.type === 'chapter' || s.type === 'part');
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({ written: written.map((s) => ({ kind: s.kind, type: s.type, number: s.number, title: s.title, subtitle: s.subtitle, content: s.content })),
      records: (rep.items || []).filter((it) => it.kind === 'chapter' || it.kind === 'matter').map((it) => ({ kind: it.kind, data: { ...it.data, content: undefined } })),
      tally: rep.tally ? { file: rep.tally.file, book: rep.tally.book, aside: rep.tally.aside, unaccounted: rep.tally.unaccounted, same: rep.tally.chars && rep.tally.chars.same, fileOnly: rep.tally.chars && rep.tally.chars.fileOnly, bookOnly: rep.tally.chars && rep.tally.chars.bookOnly } : null }, null, 1));
  }
  return { written, tally: rep.tally! };
}

const ONE = 'The caravan left at dawn.'; // 21 characters: The 3, caravan 7, left 4, at 2, dawn. 5
const TWO = 'The pans lay white.'; // 16: The 3, pans 4, lay 3, white. 6
const GLOSS = 'A pan is a flat of dried brine.'; // 24: A 1, pan 3, is 2, a 1, flat 4, of 2, dried 5, brine. 6
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** a Word file: [text, true] is a Heading 1 paragraph, [text] a plain one */
async function docx(paras: [string, boolean?][]): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>');
  const p = ([s, h]: [string, boolean?]) => '<w:p>' + (h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>';
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>' + paras.map(p).join('') + '</w:body></w:document>');
  return z.generateAsync({ type: 'uint8array' });
}
const page = (heads: [string, string][]) => '<!doctype html><html><head><title>Labels</title></head><body>' + heads.map(([h, text]) => '<h1>' + xml(h) + '</h1><p>' + text + '</p>').join('') + '</body></html>';
/** an EPUB: [id, body markup] a page, in reading order */
async function epub(pages: [string, string][]): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:0</dc:identifier><dc:title>Labels</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>'
    + '<manifest>' + pages.map(([id]) => '<item id="' + id + '" href="' + id + '.xhtml" media-type="application/xhtml+xml"/>').join('') + '</manifest><spine>' + pages.map(([id]) => '<itemref idref="' + id + '"/>').join('') + '</spine></package>');
  for (const [id, body] of pages) z.file('OEBPS/' + id + '.xhtml', '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>' + id + '</title></head><body>' + body + '</body></html>');
  return z.generateAsync({ type: 'uint8array' });
}
type Line = [string, number];
async function pdf(pages: Line[][]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const lines of pages) {
    const pg = doc.addPage([420, 595]);
    let y = 500;
    for (const [s, size] of lines) { pg.drawText(s, { x: 60, y, size, font }); y -= size > 11 ? size + 12 : 16; }
  }
  return doc.save();
}

const chapters = (g: Got) => g.written.filter((s) => s.type === 'chapter').map((s) => ({ number: s.number, title: s.title }));
const parts = (g: Got) => g.written.filter((s) => s.type === 'part').map((s) => ({ number: s.number, title: s.title }));
const pages = (g: Got) => g.written.filter((s) => s.type !== 'chapter' && s.type !== 'part').map((s) => ({ type: s.type, title: s.title }));
const figures = (g: Got) => ({ file: g.tally.file, book: g.tally.book, aside: g.tally.aside, unaccounted: g.tally.unaccounted, same: g.tally.chars.same, fileOnly: g.tally.chars.fileOnly.map(([c, n]) => [c, n]), bookOnly: g.tally.chars.bookOnly.map(([c, n]) => [c, n]) });
const clean = (file: number, book: number, aside: Record<string, number>) => ({ file, book, aside, unaccounted: 0, same: true, fileOnly: [], bookOnly: [] });

beforeAll(async () => {
  loadMammoth();
  pdfLib = (await import(/* @vite-ignore */ pathToFileURL(path.join(import.meta.dirname, '..', '..', 'node_modules', 'pdf-lib', 'cjs', 'index.js')).href)) as unknown as PdfLib;
  const g = globalThis as Rec;
  const jsdomModule = 'jsdom'; /* a computed specifier: jsdom ships no types, and the test needs none */
  const { JSDOM } = (await import(/* @vite-ignore */ jsdomModule)) as unknown as { JSDOM: new (h: string, o?: Rec) => { window: Rec & { document: Document } } };
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
  for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = dom.window[k]; } catch (e) { /* read-only */ } }
  g.document = dom.window.document;
  g.pdfjsWorker = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')).href);
  g.pdfjsLib = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href);
  const epubClosure = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
  const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited', 'pdfLoadLib'].includes(n));
  const out = await buildTestModule(HTML, epubClosure, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irTallyLast'], supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-heading-labels', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_LABELS', fn: 'createImportLabels', title: "1.0's import with its tally: a heading's own label (tests only)" });
  const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportLabels(env);';
  make = (e: Rec) => new Function('env', code)(e) as { api: Api };
}, 180_000);

describe('a chapter\'s own label ("Chapter", "CHAPTER") and the mark after its number are counted in one row, the same in every format', () => {
  /* "Chapter 1: Dawn" and "Chapter 2: Dusk", each with its text.
     In the file: Chapter 7 + 1 + ":" 1 + Dawn 4 = 13, twice (Dusk is 4 too) = 26, and the text 21 + 16 = 37: 63.
     In the book: the number and the title, "1" + "Dawn" = 5, twice = 10, and the text 37: 47.
     The row: the label word 7 and the colon 1, twice: 16. 47 + 16 = 63. */
  const WANT = clean(63, 47, { headingMarks: 16 });
  const MIXED: [string, string][] = [['Chapter 1: Dawn', ONE], ['Chapter 2: Dusk', TWO]];
  const STORED = [{ number: '1', title: 'Dawn' }, { number: '2', title: 'Dusk' }];
  const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
    ['labels.docx', async () => ({ bytes: await docx(MIXED.flatMap(([h, text]): [string, boolean?][] => [[h, true], [text]])), text: '' })],
    ['labels.md', async () => ({ bytes: null, text: MIXED.map(([h, text]) => '# ' + h + '\n\n' + text + '\n').join('\n') })],
    ['labels.html', async () => ({ bytes: null, text: page(MIXED) })],
  ];
  it.each(FILES)('%s: "Chapter 1: Dawn" is chapter 1, titled Dawn; the word "Chapter" and the colon are the row\'s 8 characters a heading', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    expect(chapters(g), name + ': what the book stores').toEqual(STORED);
    expect(figures(g), name + ': the tally').toEqual(WANT);
  }, 120_000);

  it('a text file: "CHAPTER 1 — DAWN" is chapter 1, titled DAWN as the file wrote it; "CHAPTER" and the dash are the same row\'s 8 characters a heading, and nothing differs', async () => {
    /* in the file: CHAPTER 7 + 1 + "—" 1 + DAWN 4 = 13, twice = 26, and 37: 63. In the book: "1" + "DAWN", "2" + "DUSK" = 10, and 37: 47. The row: 7 + 1, twice: 16. */
    const g = await importFile('labels.txt', null, 'CHAPTER 1 — DAWN\n\n' + ONE + '\n\nCHAPTER 2 — DUSK\n\n' + TWO + '\n');
    expect(chapters(g)).toEqual([{ number: '1', title: 'DAWN' }, { number: '2', title: 'DUSK' }]);
    expect(figures(g)).toEqual(WANT);
  }, 120_000);

  it('a Word file whose label stands on a line of its own over the heading ("Chapter 1" over "Dawn"): the same chapter, the same row — the word "Chapter" only, there being no mark', async () => {
    /* in the file: Chapter 7 + 1 = 8, Dawn 4, 21; Chapter 7 + 2 = 8, Dusk 4, 16: 61. In the book: 47 as above. The row: 7, twice: 14. */
    const g = await importFile('labels-lines.docx', await docx([['Chapter 1'], ['Dawn', true], [ONE], ['Chapter 2'], ['Dusk', true], [TWO]]), '');
    expect(chapters(g)).toEqual(STORED);
    expect(figures(g)).toEqual(clean(61, 47, { headingMarks: 14 }));
  }, 120_000);

  it('an EPUB whose pages set the number on a line of its own, as Beuk\'s own EPUB does ("Chapter 1" over "Dawn", "Part One" over "Ebb"), and a chapter page whose heading holds its label ("Chapter 3: Noon"): the same row', async () => {
    /* in the file: PartOne 7 + Ebb 3 = 10; Chapter1 8 + Dawn 4 + 21 = 33; Chapter2 8 + Dusk 4 + 16 = 28; Chapter3:Noon 13 + 24 = 37: 108.
       In the book: One 3 + Ebb 3 = 6; 1 + Dawn 4 + 21 = 26; 2 + Dusk 4 + 16 = 21; 3 + Noon 4 + 24 = 29: 82.
       The row: Part 4; Chapter 7; Chapter 7; Chapter 7 and the colon 1: 26. 82 + 26 = 108. */
    const g = await importFile('labels.epub', await epub([
      ['p1', '<div class="part-divider"><p class="part-kicker">Part One</p><h1 class="part-title">Ebb</h1></div>'],
      ['c1', '<header class="chapter-opening"><p class="chapter-number">Chapter 1</p><h1 class="chapter-title">Dawn</h1></header><p>' + ONE + '</p>'],
      ['c2', '<header class="chapter-opening"><p class="chapter-number">Chapter 2</p><h1 class="chapter-title">Dusk</h1></header><p>' + TWO + '</p>'],
      ['c3', '<section epub:type="chapter"><h1>Chapter 3: Noon</h1><p>' + GLOSS + '</p></section>'],
    ]), '');
    expect(parts(g)).toEqual([{ number: 'One', title: 'Ebb' }]);
    expect(chapters(g)).toEqual([{ number: '1', title: 'Dawn' }, { number: '2', title: 'Dusk' }, { number: '3', title: 'Noon' }]);
    expect(figures(g)).toEqual(clean(108, 82, { headingMarks: 26 }));
  }, 120_000);

  it('a heading that is the label and nothing else ("Chapter One", "CHAPTER ONE"): the number is stored as written, the label word is the row\'s, in a Markdown file and a text file alike', async () => {
    /* in the file: Chapter 7 + One 3 = 10, Chapter 7 + Two 3 = 10, and 37: 57. In the book: the numbers, 3 + 3, and 37: 43
       (the title "Chapter One" the import gives such a chapter is its own label and the number again: the import's, not counted). The row: 7, twice: 14. */
    const md = await importFile('labels-alone.md', null, '# Chapter One\n\n' + ONE + '\n\n# Chapter Two\n\n' + TWO + '\n');
    expect(md.written.filter((s) => s.type === 'chapter').map((s) => s.number)).toEqual(['One', 'Two']);
    expect(figures(md)).toEqual(clean(57, 43, { headingMarks: 14 }));
    const txt = await importFile('labels-alone.txt', null, 'CHAPTER ONE\n\n' + ONE + '\n\nCHAPTER TWO\n\n' + TWO + '\n');
    expect(txt.written.filter((s) => s.type === 'chapter').map((s) => s.number)).toEqual(['ONE', 'TWO']);
    expect(figures(txt)).toEqual(clean(57, 43, { headingMarks: 14 }));
  }, 120_000);
});

describe('a label the import does not part is stored whole, as the file wrote it: nothing is set aside, and Beuk\'s own number is counted on neither side', () => {
  it('Markdown, "# Chapitre 1 : L\'aube": the whole line is the chapter\'s title, character for character; the number Beuk gives it is Beuk\'s', async () => {
    /* in the file and in the book alike: Chapitre 8 + 1 + ":" 1 + L'aube 6 = 16; Chapitre 8 + 2 + ":" 1 + Lesoir 6 = 16; and 37: 69. No row. */
    const g = await importFile('labels-fr.md', null, '# Chapitre 1 : L\'aube\n\n' + ONE + '\n\n# Chapitre 2 : Le soir\n\n' + TWO + '\n');
    expect(chapters(g)).toEqual([{ number: '1', title: 'Chapitre 1 : L\'aube' }, { number: '2', title: 'Chapitre 2 : Le soir' }]);
    expect(figures(g)).toEqual(clean(69, 69, {}));
  }, 120_000);

  it('a Word file whose headings are "Chapitre 1" and "Chapitre 2": each is its chapter\'s title; Beuk\'s "Chapter 1" beside it is not counted (it was: 16 characters more in the book than in the file)', async () => {
    /* in the file and in the book alike: Chapitre 8 + 1 = 9, twice = 18, and 37: 55. No row. */
    const g = await importFile('labels-fr.docx', await docx([['Chapitre 1', true], [ONE], ['Chapitre 2', true], [TWO]]), '');
    expect(chapters(g)).toEqual([{ number: '1', title: 'Chapitre 1' }, { number: '2', title: 'Chapitre 2' }]);
    expect(figures(g)).toEqual(clean(55, 55, {}));
  }, 120_000);
});

describe('a Part\'s own label follows the same rule', () => {
  it('Markdown, "# PART ONE — EBB": Part ONE, titled EBB, as the file wrote them; "PART" and the dash are the row\'s', async () => {
    /* in the file: PART 4 + ONE 3 + "—" 1 + EBB 3 = 11, and the two chapters' 63: 74. In the book: ONE 3 + EBB 3 = 6, and 47: 53. The row: 4 + 1 = 5, and 16: 21.
       (A heading: in a plain text file a line "PART ONE — EBB" is not read as a Part at all. The parser knows a Part by its heading mark.) */
    const g = await importFile('labels-part-caps.md', null, '# PART ONE — EBB\n\n# Chapter 1: Dawn\n\n' + ONE + '\n\n# Chapter 2: Dusk\n\n' + TWO + '\n');
    expect(parts(g)).toEqual([{ number: 'ONE', title: 'EBB' }]);
    expect(figures(g)).toEqual(clean(74, 53, { headingMarks: 21 }));
  }, 120_000);

  it('Markdown, "# Part One: Ebb": Part One, titled Ebb; "Part" and the colon are the row\'s', async () => {
    /* in the file: Part 4 + One 3 + ":" 1 + Ebb 3 = 11, and 63: 74. In the book: 6 and 47: 53. The row: 5 and 16: 21. */
    const g = await importFile('labels-part.md', null, '# Part One: Ebb\n\n# Chapter 1: Dawn\n\n' + ONE + '\n\n# Chapter 2: Dusk\n\n' + TWO + '\n');
    expect(parts(g)).toEqual([{ number: 'One', title: 'Ebb' }]);
    expect(figures(g)).toEqual(clean(74, 53, { headingMarks: 21 }));
  }, 120_000);
});

describe('a heading\'s number is stored in the letters the file wrote it in (BEUK:casegiven): nothing of it is re-set, so nothing differs', () => {
  it('Markdown, "CHAPTER TWENTY-ONE" on a line of its own over "# No Quarter": the number is stored "TWENTY-ONE" as typed (it was re-set "Twenty-One") — the label word is the row\'s and no character differs', async () => {
    /* in the file: CHAPTER 7 + TWENTY-ONE 10 = 17, NoQuarter 9, 21; CHAPTER 7 + TWENTY-TWO 10 = 17, TheCreek 8, 16: 88.
       In the book: TWENTY-ONE 10 + 9 + 21, TWENTY-TWO 10 + 8 + 16: 74. The row: CHAPTER 7, twice: 14. 74 + 14 = 88.
       (Before: the number was stored "Twenty-One" and "Twenty-Two": the same counts, and E N W T Y O of the file stood against e n w t y o of the book.) */
    const g = await importFile('labels-recased.md', null, 'CHAPTER TWENTY-ONE\n\n# No Quarter\n\n' + ONE + '\n\nCHAPTER TWENTY-TWO\n\n# The Creek\n\n' + TWO + '\n');
    expect(chapters(g)).toEqual([{ number: 'TWENTY-ONE', title: 'No Quarter' }, { number: 'TWENTY-TWO', title: 'The Creek' }]);
    expect(figures(g)).toEqual(clean(88, 74, { headingMarks: 14 }));
  }, 120_000);

  it('a PDF, "PART ONE" set over "Ebb" and "CHAPTER 1" over each chapter\'s title: the Part\'s number is stored "ONE" as the page has it (the PDF reader re-set the label line "Part One") — "PART" and "CHAPTER" are the row\'s and no character differs', async () => {
    /* in the file: PARTONE 7 + Ebb 3 = 10; CHAPTER1 8 + TheMuster 9 + 21 = 38; CHAPTER2 8 + TheReturn 9 + 16 = 33; CHAPTER3 8 + ThePans 7 + 24 = 39: 120.
       In the book: ONE 3 + Ebb 3 = 6; 1 + 9 + 21 = 31; 1 + 9 + 16 = 26; 1 + 7 + 24 = 32: 95. The row: PART 4 and CHAPTER 7 three times: 25. 95 + 25 = 120.
       (Before: stored "One", and N E of the file stood against n e of the book.) */
    const g = await importFile('labels-recased.pdf', await pdf([
      [['PART ONE', 24], ['Ebb', 24]],
      [['CHAPTER 1', 14], ['The Muster', 20], [ONE, 11]],
      [['CHAPTER 2', 14], ['The Return', 20], [TWO, 11]],
      [['CHAPTER 3', 14], ['The Pans', 20], [GLOSS, 11]],
    ]), '');
    expect(parts(g)).toEqual([{ number: 'ONE', title: 'Ebb' }]);
    expect(chapters(g)).toEqual([{ number: '1', title: 'The Muster' }, { number: '2', title: 'The Return' }, { number: '3', title: 'The Pans' }]);
    expect(figures(g)).toEqual(clean(120, 95, { headingMarks: 25 }));
  }, 120_000);
});

describe('a named page\'s name is not a label: the book stores its own name for the page, and what that changes is in no row', () => {
  it('a text file, "PROLOGUE" and "Acknowledgements": stored "Prologue" and "Acknowledgments" (the book\'s names for those pages) — the row takes nothing of either, and every character that differs is listed', async () => {
    /* This pins what the import does today so that it cannot move unseen. It is a known change of the writer's characters, not a pass mark for it.
       In the file: PROLOGUE 8 + 24; the two chapters' 63; Acknowledgements 16 + 24: 135.
       In the book: Prologue 8 + 24; 47; Acknowledgments 15 + 24: 118. The row: the two chapters' 16, nothing of the pages. 135 - 118 - 16 = 1: the "e" of "Acknowledgements".
       What differs: PROLOGUE against Prologue, R O L O G U E against r o l o g u e; the "e" the book's "Acknowledgments" lacks leaves the file one "e" more, so "e" stands on neither side. */
    const g = await importFile('labels-pages.txt', null, 'PROLOGUE\n\n' + GLOSS + '\n\nCHAPTER 1 — DAWN\n\n' + ONE + '\n\nCHAPTER 2 — DUSK\n\n' + TWO + '\n\nAcknowledgements\n\n' + GLOSS + '\n');
    expect(pages(g)).toEqual([{ type: 'prologue', title: 'Prologue' }, { type: 'acknowledgments', title: 'Acknowledgments' }]);
    expect(figures(g)).toEqual({ file: 135, book: 118, aside: { headingMarks: 16 }, unaccounted: 1, same: false,
      fileOnly: [['O', 2], ['E', 1], ['G', 1], ['L', 1], ['R', 1], ['U', 1]], bookOnly: [['o', 2], ['g', 1], ['l', 1], ['r', 1], ['u', 1]] });
  }, 120_000);
});
