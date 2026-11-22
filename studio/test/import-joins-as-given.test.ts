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

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." Where the import reads two lines of the file as one
   heading ("Appendix A" over "Field Glossary"; an EPUB's label element before its heading; a PDF's heading lines of
   two sizes) it adds no character of its own: the book holds the two lines with a space between them, never a colon
   the writer did not write. One small manuscript, made here in each format, each read by 1.0's own readImportFile
   (the text 2.0 lifts). The file holds no colon anywhere, so any colon in the book is the import's.

   The form: a front or back page sets only its title (frontBackHtml's default case sets section.title and no
   subtitle), so the label and the name are one title joined with a space. A chapter's number and title are split
   again as they always were ("Chapter 1" over "The Muster": number 1, titled The Muster).

   BEUK_JOINS_OUT names a folder to write each import's sections and tally into (made-up text only). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const VENDOR = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
const OUT = process.env.BEUK_JOINS_OUT || '';
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
type Rep = { tally?: Tally };
type Got = { secs: Sec[]; written: Sec[]; tally: Tally; meta: Rec };
async function importFile(name: string, bytes: Uint8Array | null, text: string): Promise<Got> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const b = bytes || new TextEncoder().encode(text); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Rep)();
  const doc = m.api.snapshotBookDoc() as { sections: Sec[]; meta: Rec };
  /* the pages the import wrote: every page with text, every chapter and every Part */
  const written = doc.sections.filter((s) => /\S/.test(s.content || '') || s.type === 'chapter' || s.type === 'part');
  const got = { secs: doc.sections, written, tally: rep.tally!, meta: doc.meta };
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({ meta: { title: doc.meta.title, subtitle: doc.meta.subtitle, author: doc.meta.author }, written: written.map((s) => ({ kind: s.kind, type: s.type, number: s.number, title: s.title, subtitle: s.subtitle, content: s.content })),
      tally: rep.tally ? { file: rep.tally.file, book: rep.tally.book, aside: rep.tally.aside, unaccounted: rep.tally.unaccounted, same: rep.tally.chars && rep.tally.chars.same, fileOnly: rep.tally.chars && rep.tally.chars.fileOnly, bookOnly: rep.tally.chars && rep.tally.chars.bookOnly } : null }, null, 1));
  }
  return got;
}

/* The manuscript: two numbered chapters with text, and a back page whose label and name stand on two lines. No colon. */
const ONE = 'The caravan left at dawn.';
const TWO = 'The pans lay white.';
const LABEL = 'Appendix A';
const NAME = 'Field Glossary';
const GLOSS = 'A pan is a flat of dried brine.';
const FRONT_LABEL = 'Front Matter';
const FRONT_NAME = 'Editorial Brief';
const BRIEF = 'This book was set from the field ledgers.';
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function docx(): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>');
  const p = (s: string, h?: boolean) => '<w:p>' + (h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>';
  /* the label a plain paragraph (a kicker line), the name the heading under it */
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>' + p('Chapter 1', true) + p(ONE) + p('Chapter 2', true) + p(TWO) + p(LABEL) + p(NAME, true) + p(GLOSS) + '</w:body></w:document>');
  return z.generateAsync({ type: 'uint8array' });
}
const PAGE = '<!doctype html><html><head><title>Joins</title></head><body><h1>Chapter 1</h1><p>' + ONE + '</p><h1>Chapter 2</h1><p>' + TWO + '</p><p class="kicker">' + LABEL + '</p><h1>' + NAME + '</h1><p>' + GLOSS + '</p></body></html>';
/* a text file: the label, the name and the text on lines of their own */
const TXT = 'Chapter 1\n\n' + ONE + '\n\nChapter 2\n\n' + TWO + '\n\n' + LABEL + '\n\n' + NAME + '\n\n' + GLOSS + '\n';
/* a book that does not number its chapters: the label a line of its own over the name's heading */
const MD_UNNUMBERED = '# The Muster\n\n' + ONE + '\n\n# The Return\n\n' + TWO + '\n\n' + LABEL + '\n\n# ' + NAME + '\n\n' + GLOSS + '\n';

type EpubPage = [string, string];
async function epub(pages: EpubPage[]): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:0</dc:identifier><dc:title>Joins</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>'
    + '<manifest>' + pages.map(([id]) => '<item id="' + id + '" href="' + id + '.xhtml" media-type="application/xhtml+xml"/>').join('') + '</manifest><spine>' + pages.map(([id]) => '<itemref idref="' + id + '"/>').join('') + '</spine></package>');
  for (const [id, body] of pages) z.file('OEBPS/' + id + '.xhtml', '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + id + '</title></head><body>' + body + '</body></html>');
  return z.generateAsync({ type: 'uint8array' });
}
/** a heading with its label set before it in the heading's own group, as a book's stylesheet sets a kicker */
const labelled = (label: string, head: string, text: string) => '<header><p class="kicker">' + label + '</p><h1>' + head + '</h1></header><p>' + text + '</p>';
const EPUB_PAGES: EpubPage[] = [
  ['f1', labelled(FRONT_LABEL, FRONT_NAME, BRIEF)],
  ['c1', labelled('Chapter 1', 'The Muster', ONE)],
  ['c2', labelled('Chapter 2', 'The Return', TWO)],
  ['a1', labelled(LABEL, NAME, GLOSS)],
];
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
/* the label and the name set as two heading lines of two sizes on the appendix's page */
const PDF_PAGES: Line[][] = [
  [['Chapter 1', 20], [ONE, 11]],
  [['Chapter 2', 20], [TWO, 11]],
  [[LABEL, 20], [NAME, 15], [GLOSS, 11]],
];

const colons = (g: Got) => g.written.map((s) => [s.title, s.subtitle || '', s.content].join('\n')).join('\n').match(/[:：]/g) || [];
const page = (g: Got, type: string) => g.written.filter((s) => s.type === type).map((s) => ({ kind: s.kind, title: s.title, subtitle: s.subtitle || '', content: s.content }));
const chapters = (g: Got) => g.written.filter((s) => s.type === 'chapter').map((s) => ({ number: s.number, title: s.title, content: s.content }));
const reconciled = (g: Got) => ({ unaccounted: g.tally.unaccounted, same: g.tally.chars.same, fileOnly: g.tally.chars.fileOnly, bookOnly: g.tally.chars.bookOnly });
const CLEAN = { unaccounted: 0, same: true, fileOnly: [], bookOnly: [] };
const APPENDIX = [{ kind: 'back', title: LABEL + ' ' + NAME, subtitle: '', content: GLOSS }];

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
  const out = await buildTestModule(HTML, epubClosure, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irTallyLast'], supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-joins-as-given', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_JOINS', fn: 'createImportJoins', title: "1.0's import, joining two lines of the file with no character of its own (tests only)" });
  const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportJoins(env);';
  make = (e: Rec) => new Function('env', code)(e) as { api: Api };
}, 180_000);

describe('two lines of the file read as one heading are joined with no character of the import\'s own', () => {
  const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
    ['joins.docx', async () => ({ bytes: await docx(), text: '' })],
    ['joins.html', async () => ({ bytes: null, text: PAGE })],
    ['joins.txt', async () => ({ bytes: null, text: TXT })],
    ['joins.pdf', async () => ({ bytes: await pdf(PDF_PAGES), text: '' })],
  ];

  it.each(FILES)('%s: "Appendix A" over "Field Glossary" is the appendix "Appendix A Field Glossary": no colon in the book, every character accounted for', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    expect(colons(g), name + ': colons in the book (the file has none)').toEqual([]);
    expect(page(g, 'appendix'), name + ': the appendix page').toEqual(APPENDIX);
    expect(chapters(g), name + ': the chapters').toEqual([{ number: '1', title: 'Chapter 1', content: ONE }, { number: '2', title: 'Chapter 2', content: TWO }]);
    expect(reconciled(g), name + ': the tally').toEqual(CLEAN);
  }, 120_000);

  it('a book that does not number its chapters: the appendix line over the name\'s heading is still the appendix, joined with a space', async () => {
    const g = await importFile('joins-unnumbered.md', null, MD_UNNUMBERED);
    expect(colons(g)).toEqual([]);
    expect(page(g, 'appendix')).toEqual(APPENDIX);
    expect(g.written.filter((s) => s.type === 'chapter').map((s) => s.title)).toEqual(['The Muster', 'The Return']);
    expect(reconciled(g)).toEqual(CLEAN);
  }, 120_000);

  it('an EPUB: a label element before a heading is read with it — a chapter\'s label is its number, any other label and its heading are one title joined with a space', async () => {
    const g = await importFile('joins.epub', await epub(EPUB_PAGES), '');
    expect(colons(g), 'colons in the book (the file has none)').toEqual([]);
    expect(chapters(g)).toEqual([{ number: '1', title: 'The Muster', content: ONE }, { number: '2', title: 'The Return', content: TWO }]);
    expect(page(g, 'appendix')).toEqual(APPENDIX);
    /* the front page keeps its label and its name as its title, as the zone rule files it (a preface) */
    expect(page(g, 'preface')).toEqual([{ kind: 'front', title: FRONT_LABEL + ' ' + FRONT_NAME, subtitle: '', content: BRIEF }]);
    expect(reconciled(g)).toEqual(CLEAN);
  }, 120_000);

  it('an EPUB: a bare number set before a chapter\'s heading is the chapter\'s number; the word "Chapter" is not stored, and where the heading is not a chapter\'s the number and the heading stand as the file gave them', async () => {
    const g = await importFile('joins-numbers.epub', await epub([
      ['c1', labelled('1', 'The Muster', ONE)],
      ['c2', labelled('2', 'The Return', TWO)],
    ]), '');
    expect(chapters(g)).toEqual([{ number: '1', title: 'The Muster', content: ONE }, { number: '2', title: 'The Return', content: TWO }]);
    expect(g.written.map((s) => [s.title, s.subtitle || '', s.content].join('\n')).join('\n')).not.toMatch(/Chapter/);
    expect(colons(g)).toEqual([]);
    expect(reconciled(g)).toEqual(CLEAN);
  }, 120_000);

  it('a PDF: a label line over a chapter\'s title is still that chapter\'s number, and a Part\'s label over its name is still that Part', async () => {
    const g = await importFile('joins-labels.pdf', await pdf([
      [['PART ONE', 24], ['Ebb', 24]],
      [['CHAPTER 1', 14], ['The Muster', 20], [ONE, 11]],
      [['CHAPTER 2', 14], ['The Return', 20], [TWO, 11]],
      [['CHAPTER 3', 14], ['The Pans', 20], [GLOSS, 11]],
    ]), '');
    expect(chapters(g)).toEqual([{ number: '1', title: 'The Muster', content: ONE }, { number: '2', title: 'The Return', content: TWO }, { number: '3', title: 'The Pans', content: GLOSS }]);
    expect(g.written.filter((s) => s.type === 'part').map((s) => ({ number: s.number, title: s.title, subtitle: s.subtitle || '' }))).toEqual([{ number: 'One', title: 'Ebb', subtitle: '' }]);
    expect(colons(g)).toEqual([]);
  }, 120_000);

  it('a PDF: a label the parser does not part ("BOOK ONE" over its name, "Chapitre 1" over its title) is the page\'s title with the name as its subtitle: no colon is stored', async () => {
    const g = await importFile('joins-unparted.pdf', await pdf([
      [['BOOK ONE', 24], ['Departures', 24]],
      [['Chapitre 1', 14], ['Le Depart', 20], [ONE, 11]],
      [['Chapitre 2', 14], ['Le Retour', 20], [TWO, 11]],
      [['Chapitre 3', 14], ['Les Salines', 20], [GLOSS, 11]],
    ]), '');
    expect(colons(g)).toEqual([]);
    expect(g.written.filter((s) => s.type === 'part').map((s) => ({ title: s.title, subtitle: s.subtitle || '' }))).toEqual([{ title: 'Book One', subtitle: 'Departures' }]);
    expect(g.written.filter((s) => s.type === 'chapter').map((s) => ({ title: s.title, subtitle: s.subtitle || '', content: s.content }))).toEqual([
      { title: 'Chapitre 1', subtitle: 'Le Depart', content: ONE }, { title: 'Chapitre 2', subtitle: 'Le Retour', content: TWO }, { title: 'Chapitre 3', subtitle: 'Les Salines', content: GLOSS },
    ]);
  }, 120_000);

  it('a PDF: a chapter\'s title over a smaller heading line is that chapter\'s title and its subtitle (a page of the body sets its subtitle under its title on every surface); no colon, every character accounted for', async () => {
    const g = await importFile('joins-sizes.pdf', await pdf([
      [['The Muster', 20], [ONE, 11]],
      [['The Return', 20], ['In Which the Pans Are Reached', 15], [TWO, 11]],
      [['The Pans', 20], [GLOSS, 11]],
    ]), '');
    expect(colons(g)).toEqual([]);
    expect(g.written.filter((s) => s.type === 'chapter').map((s) => ({ kind: s.kind, title: s.title, subtitle: s.subtitle || '', content: s.content }))).toEqual([
      { kind: 'body', title: 'The Muster', subtitle: '', content: ONE },
      { kind: 'body', title: 'The Return', subtitle: 'In Which the Pans Are Reached', content: TWO },
      { kind: 'body', title: 'The Pans', subtitle: '', content: GLOSS },
    ]);
    expect(reconciled(g)).toEqual(CLEAN);
  }, 120_000);

  it('a PDF: a title set over a smaller line on its own page before the chapters is the title page — the book\'s title and its subtitle, each as the file set it, no colon', async () => {
    const g = await importFile('joins-title.pdf', await pdf([
      [['The Salt Road', 28], ['A Field Ledger', 18], ['Ada Wren', 14]],
      [['Chapter 1', 20], [ONE, 11]],
      [['Chapter 2', 20], [TWO, 11]],
    ]), '');
    expect(colons(g)).toEqual([]);
    /* the third line (the author, set as a heading line too) has no "by": the shared title-page rule reads no author from it, and it is lifted with the title page (counted in that row) */
    expect({ title: g.meta.title, subtitle: g.meta.subtitle }).toEqual({ title: 'The Salt Road', subtitle: 'A Field Ledger' });
    expect(chapters(g)).toEqual([{ number: '1', title: 'Chapter 1', content: ONE }, { number: '2', title: 'Chapter 2', content: TWO }]);
    // the title page: "The Salt Road" 11 + "A Field Ledger" 12 + "Ada Wren" 7; and each chapter's heading is its label and nothing else ("Chapter 1"): the word "Chapter", 7, is the heading's own label, twice
    expect({ aside: g.tally.aside, ...reconciled(g) }).toEqual({ aside: { titlePage: 30, headingMarks: 14 }, ...CLEAN });
  }, 120_000);

  it('no mark of the import\'s own join is left anywhere in a book: not in a title, a subtitle, a page\'s text or the book\'s details', async () => {
    const mark = new RegExp('[' + String.fromCharCode(0x2006, 0x205F) + ']'); /* U+2006 and U+205F: the spaces of the import's own join mark */
    for (const [name, bytes, text] of [
      ['joins.epub', await epub(EPUB_PAGES), ''], ['joins.pdf', await pdf(PDF_PAGES), ''], ['joins.docx', await docx(), ''], ['joins.html', null, PAGE],
    ] as [string, Uint8Array | null, string][]) {
      const g = await importFile(name, bytes, text);
      expect(mark.test(JSON.stringify(g.secs) + JSON.stringify(g.meta)), name).toBe(false);
    }
  }, 120_000);
});
