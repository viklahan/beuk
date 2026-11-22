// @vitest-environment node
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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

/* The owner's ruling (2026-11-22): "stop the silent tidying … We do not change anything from what the writer gives
   us." The import stores the writer's characters: a straight quote stays straight, "--" stays "--", "..." stays
   "...", a hyphen between two numbers stays a hyphen, a spaced hyphen stays a hyphen. One small manuscript, made here
   in each format the import reads, each read by 1.0's own readImportFile (the text 2.0 lifts): the line the writer
   typed is in the book as typed. Polish in the editor is the writer's own button for the tidying; the import does none. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const VENDOR = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
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

type Sec = { type: string; kind?: string; title: string; content: string; number?: string };
type Rep = { tally?: Rec; items: { kind: string; group?: string; before?: string; after?: string; data?: Rec }[] };
let lastModule: { api: Api } | null = null;
/** `texts`: what the file answers each time its text is read, in order (the last one again after that) */
async function importFile(name: string, bytes: Uint8Array | null, ...texts: string[]): Promise<{ rep: Rep; secs: Sec[]; all: string }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  lastModule = m;
  m.api.applyBookDoc(m.api.buildEmptyBook());
  let read = 0;
  const text = () => texts[Math.min(read++, texts.length - 1)] || '';
  const buf = () => { const b = bytes || new TextEncoder().encode(text()); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text() })) as () => Rep)();
  const doc = m.api.snapshotBookDoc() as { sections: Sec[] };
  return { rep, secs: doc.sections, all: doc.sections.map((s) => s.title + '\n' + s.content).join('\n') };
}

/* What the writer typed: straight double and single quotes, an apostrophe, two and three hyphens, three dots, a range
   of years, a spaced range of pages, a spaced hyphen between words. */
const LINE = '"Go," she said -- \'now\'... It ran 1914-1918, pages 12 - 15; a - b, and it\'s done---almost.';
const NOTE = 'A "wet" one -- truly...';
const CELL = '"aye" -- twice...';
const LAST = 'The pans lay white.';
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function docx(): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>');
  const p = (s: string, h?: boolean) => '<w:p>' + (h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>';
  const cell = (s: string) => '<w:tc>' + p(s) + '</w:tc>';
  const table = '<w:tbl><w:tr>' + cell('Port') + cell('Said') + '</w:tr><w:tr>' + cell('Leith') + cell(CELL) + '</w:tr></w:tbl>';
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>' + p('Chapter 1', true) + p(LINE) + table + p('Chapter 2', true) + p(LAST) + '</w:body></w:document>');
  return z.generateAsync({ type: 'uint8array' });
}
async function odt(): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  z.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
  z.file('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
    + '<text:h text:outline-level="1">Chapter 1</text:h><text:p>' + xml(LINE) + '</text:p><text:h text:outline-level="1">Chapter 2</text:h><text:p>' + xml(LAST) + '</text:p></office:text></office:body></office:document-content>');
  return z.generateAsync({ type: 'uint8array' });
}
async function epub(): Promise<Uint8Array> {
  const z = new ((globalThis as Rec).JSZip as Zip)();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:0</dc:identifier><dc:title>As Given</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>'
    + '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  const pageOf = (h: string, s: string) => '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + h + '</title></head><body><h1>' + h + '</h1><p>' + xml(s) + '</p></body></html>';
  z.file('OEBPS/c1.xhtml', pageOf('Chapter 1', LINE));
  z.file('OEBPS/c2.xhtml', pageOf('Chapter 2', LAST));
  return z.generateAsync({ type: 'uint8array' });
}
async function pdf(): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const [h, s] of [['Chapter 1', LINE], ['Chapter 2', LAST]]) {
    const pg = doc.addPage([620, 595]);
    pg.drawText(h, { x: 60, y: 480, size: 20, font });
    pg.drawText(s, { x: 60, y: 430, size: 11, font });
  }
  return doc.save();
}
const MD = '# Chapter 1\n\n' + LINE + '[^1]\n\n[^1]: ' + NOTE + '\n\n| Port | Said |\n| --- | --- |\n| Leith | ' + CELL + ' |\n\n# Chapter 2\n\n' + LAST + '\n';
const TXT = 'Chapter 1\n\n' + LINE + '\n\nChapter 2\n\n' + LAST + '\n';
const PAGE = '<!doctype html><html><head><title>As Given</title></head><body><h1>Chapter 1</h1><p>' + xml(LINE) + '</p><table><tr><td>Port</td><td>Said</td></tr><tr><td>Leith</td><td>' + xml(CELL) + '</td></tr></table><h1>Chapter 2</h1><p>' + xml(LAST) + '</p></body></html>';
const RTF = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times;}}{\\stylesheet{\\s0 Normal;}{\\s1\\outlinelevel0 heading 1;}}\n\\pard\\s1 Chapter 1\\par\\pard\\s0 ' + LINE + '{\\super\\chftn}{\\footnote\\pard{\\super\\chftn} ' + NOTE + '}\\par\n\\pard\\s1 Chapter 2\\par\\pard\\s0 ' + LAST + '\\par}';

/* each file, and what of it must stand in the book as typed (the line; a note's text and a table cell's where the format made here has one) */
const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>, string[]][] = [
  ['as-given.txt', async () => ({ bytes: null, text: TXT }), [LINE]],
  ['as-given.md', async () => ({ bytes: null, text: MD }), [LINE, NOTE, CELL]],
  ['as-given.html', async () => ({ bytes: null, text: PAGE }), [LINE, CELL]],
  ['as-given.rtf', async () => ({ bytes: new TextEncoder().encode(RTF), text: RTF }), [LINE, NOTE]],
  ['as-given.docx', async () => ({ bytes: await docx(), text: '' }), [LINE, CELL]],
  ['as-given.odt', async () => ({ bytes: await odt(), text: '' }), [LINE]],
  ['as-given.epub', async () => ({ bytes: await epub(), text: '' }), [LINE]],
  ['as-given.pdf', async () => ({ bytes: await pdf(), text: '' }), [LINE]],
];

beforeAll(async () => {
  loadMammoth();
  pdfLib = (await import(/* @vite-ignore */ pathToFileURL(path.join(import.meta.dirname, '..', '..', 'node_modules', 'pdf-lib', 'cjs', 'index.js')).href)) as unknown as PdfLib;
  const g = globalThis as Rec;
  /* pdf.js loads in a Node environment (as lockcopy-pdf.test.ts loads it); the import's page is a jsdom window set up here */
  const jsdomModule = 'jsdom'; /* a computed specifier: jsdom ships no types, and the test needs none */
  const { JSDOM } = (await import(/* @vite-ignore */ jsdomModule)) as unknown as { JSDOM: new (h: string, o?: Rec) => { window: Rec & { document: Document } } };
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
  for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = dom.window[k]; } catch (e) { /* read-only */ } }
  g.document = dom.window.document;
  g.pdfjsWorker = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')).href);
  g.pdfjsLib = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href);
  const epubClosure = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
  const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited', 'pdfLoadLib'].includes(n));
  const out = await buildTestModule(HTML, epubClosure, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf', 'irTallyLast', 'beautifyText'], supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-as-given', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_AS_GIVEN', fn: 'createImportAsGiven', title: "1.0's import, storing the file's characters as given (tests only)" });
  const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportAsGiven(env);';
  make = (e: Rec) => new Function('env', code)(e) as { api: Api };
}, 180_000);

describe('the import stores the writer\'s characters as the file gives them: no quote, dash or ellipsis is changed', () => {

  it.each(FILES)('%s: what the writer typed is in the book as typed', async (name, build, kept) => {
    const f = await build();
    const { all, rep } = await importFile(name, f.bytes, f.text);
    for (const want of kept) expect(all, name + ': the book does not hold ' + JSON.stringify(want)).toContain(want);
    // no curly quote, dash or ellipsis the file does not have
    expect(all.match(/[“”‘’—–…]/g) || [], name + ': characters the file does not have').toEqual([]);
    // and the report lists no typography change: the import made none
    expect(rep.items.filter((it) => it.group === 'typography').map((it) => it.kind), name + ': typography items in the report').toEqual([]);
  }, 120_000);

  it('Polish, the writer\'s own button, still tidies: the same line through the tidier is curly quotes, dashes and an ellipsis', async () => {
    await importFile('as-given.txt', null, TXT);
    const polished = String(lastModule!.api.beautifyText(LINE));
    expect(polished).toBe('“Go,” she said — ‘now’… It ran 1914–1918, pages 12–15; a — b, and it’s done—almost.');
  }, 120_000);

  it('the import card says so in one sentence, naming the editor\'s own button for the tidying', async () => {
    await importFile('as-given.txt', null, TXT);
    lastModule!.api.irRenderReport();
    const said = (document.body.textContent || '').replace(/\s+/g, ' ');
    expect(t('tool.autoFormat')).toBe('Auto-Format');
    expect(said).toContain('Your text is as your file gave it: no quote, dash or ellipsis was changed. Auto-Format in the editor tidies them when you want it.');
  }, 120_000);

  it('a scene break the writer typed is still the book\'s own break, and the report names the marker it came from', async () => {
    const { secs, rep } = await importFile('breaks.txt', null, 'Chapter 1\n\nBefore the break.\n\n* * *\n\nAfter the break.\n\nChapter 2\n\n' + LAST + '\n');
    const ch1 = secs.find((s) => s.type === 'chapter' && s.number === '1')!;
    expect(ch1.content).toBe('Before the break.\n\n***\n\nAfter the break.');
    expect(rep.items.filter((it) => it.kind === 'break').map((it) => it.before)).toEqual(['* * *']);
  }, 120_000);
});

/* Part two of the ruling: "We tally the characters and images and everything and then make sure that its the same."
   The tally counts and compares CHARACTERS, one rule for every format: a character is a code point that is not
   whitespace; nothing is folded (a capital is not its small letter, a curly quote is not a straight one). */
type Diff = [string, number, string[]][];
type Chars = { same: boolean; fileOnlyN: number; bookOnlyN: number; fileOnly: Diff; bookOnly: Diff };
type Tally = { v: number; counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; marks: number; chars: Chars;
  pdf?: { raw: number; joins: Record<string, number>; rejoined: { from: string[]; to: string; n: number }[] } };
const tallyOf = (rep: Rep) => rep.tally as unknown as Tally;
const reportSaid = (rep: Rep) => { const el = document.createElement('div'); el.innerHTML = String(lastModule!.api.irTallyHtmlOf(rep)); return (el.textContent || '').replace(/\s+/g, ' '); };
const cardSaid = () => { lastModule!.api.irRenderReport(); return (document.body.textContent || '').replace(/\s+/g, ' '); };
/** the characters of a text as the tally counts them here: every code point that is not whitespace (the fixtures hold none of Beuk's marks) */
const count = (s: string) => Array.from(s.replace(/\s+/g, '')).length;

describe('the import tally counts and compares characters, exactly', () => {
  it.each(FILES)('%s: every character of the file is in the book or in a named row, and the characters themselves agree', async (name, build) => {
    const f = await build();
    const { rep } = await importFile(name, f.bytes, f.text);
    const ty = tallyOf(rep);
    expect(ty, 'the import wrote no tally').toBeTruthy();
    expect(ty.v).toBe(3);
    expect(ty.counted).toBe(true);
    const aside = Object.values(ty.aside).reduce((a, n) => a + n, 0);
    expect(ty.file, name + ': file = book + set aside + unaccounted').toBe(ty.book + aside + ty.unaccounted);
    expect({ unaccounted: ty.unaccounted, same: ty.chars.same, fileOnly: ty.chars.fileOnly, bookOnly: ty.chars.bookOnly }, name).toEqual({ unaccounted: 0, same: true, fileOnly: [], bookOnly: [] });
    // the all-clear, in characters
    expect(cardSaid()).toContain(t('ir.tally.cardOk', { file: ty.file.toLocaleString('en-US'), book: ty.book.toLocaleString('en-US'), aside: aside.toLocaleString('en-US') }));
    expect(reportSaid(rep)).toContain('Every character of your file is in your book.');
  }, 120_000);

  it('a text file is counted by hand: the characters of its four lines; the word "Chapter" of its two headings is each heading\'s own label, set aside, and nothing else is', async () => {
    const { rep } = await importFile('as-given.txt', null, TXT);
    const ty = tallyOf(rep);
    const want = count('Chapter 1') + count(LINE) + count('Chapter 2') + count(LAST);
    expect(want).toBe(105); // 8 + 73 + 8 + 16
    // in the book: the two numbers and the two lines, 1 + 73 + 1 + 16 = 91; the row: "Chapter" 7, twice
    expect({ file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted, marks: ty.marks }).toEqual({ file: 105, book: 91, aside: { headingMarks: 14 }, unaccounted: 0, marks: 0 });
  }, 120_000);

  it('a character changed on the way in is named, with its count on each side and the words it stands in: the count alone would not show it', async () => {
    // the file is counted as the writer wrote it; the reading that reaches the book has its two straight double quotes made curly
    const { rep } = await importFile('as-given.txt', null, TXT, TXT.replace('"Go,"', '“Go,”'));
    const ty = tallyOf(rep);
    expect(ty.unaccounted, 'the counts agree').toBe(0);
    expect(ty.chars.same).toBe(false);
    expect(ty.chars.fileOnly).toEqual([['"', 2, ['"Go,"']]]);
    expect(ty.chars.bookOnly).toEqual([['“', 1, ['“Go,”']], ['”', 1, ['“Go,”']]]);
    const card = cardSaid();
    expect(card).not.toContain('Every character is accounted for');
    expect(card).toContain('2 characters of your file are not in your book as written.');
    const said = reportSaid(rep);
    expect(said).toContain('In your file, not in your book: “"” U+0022 ×2 (in “"Go,"”)');
    expect(said).toContain('In your book, not in your file: ““” U+201C ×1 (in ““Go,””), “”” U+201D ×1 (in ““Go,””)');
    expect(said).not.toContain('Every character of your file is in your book.');
  }, 120_000);

  it('a capital is not its small letter: nothing is folded', async () => {
    const { rep } = await importFile('as-given.txt', null, TXT, TXT.replace('The pans', 'the pans'));
    const ty = tallyOf(rep);
    expect({ unaccounted: ty.unaccounted, fileOnly: ty.chars.fileOnly, bookOnly: ty.chars.bookOnly }).toEqual({ unaccounted: 0, fileOnly: [['T', 1, ['The']]], bookOnly: [['t', 1, ['the']]] });
  }, 120_000);

  it('a scene-break marker the writer typed is counted in a row of its own: "---" is three characters set aside, the book\'s "***" is the book\'s', async () => {
    const { rep, secs } = await importFile('breaks.txt', null, 'Chapter 1\n\nBefore the break.\n\n---\n\nAfter the break.\n\nChapter 2\n\n' + LAST + '\n');
    expect(secs.find((s) => s.type === 'chapter' && s.number === '1')!.content).toBe('Before the break.\n\n***\n\nAfter the break.');
    const ty = tallyOf(rep);
    // and the word "Chapter" of the two headings "Chapter 1" and "Chapter 2", each heading's own label: 7, twice
    expect({ aside: ty.aside, unaccounted: ty.unaccounted, same: ty.chars.same }).toEqual({ aside: { sceneBreaks: 3, headingMarks: 14 }, unaccounted: 0, same: true });
    expect(reportSaid(rep)).toContain(t('ir.tally.b.sceneBreaks') + '3');
  }, 120_000);

  it('the marks Beuk reads as its own are not compared, and the tally says how many of the file\'s characters that is', async () => {
    const { rep } = await importFile('marks.md', null, '# Chapter 1\n\nThe *caravan* left.\n\n# Chapter 2\n\n' + LAST + '\n');
    const ty = tallyOf(rep);
    expect({ marks: ty.marks, unaccounted: ty.unaccounted, same: ty.chars.same }).toEqual({ marks: 4, unaccounted: 0, same: true }); // two "#" and two "*"
    expect(reportSaid(rep)).toContain('4 characters of your file are marks Beuk reads as markup, not as text');
  }, 120_000);

  /* A PDF's hyphen at a line's end (BEUK:hyphensgiven; every case of the rule is import-pdf-hyphens.test.ts's). The page
     does not say whose hyphen it is. Where the book's own text does not either ("transport" stands nowhere else), the
     hyphen is the page's and stays: no character is removed, nothing is counted. Where the book writes the word whole
     without it elsewhere, it is taken off: a character removed, in a named row, each one listed. */
  async function hyphenPdf(second: string) {
    const doc = await pdfLib.PDFDocument.create();
    const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
    const lines: [string, string[]][] = [['Chapter 1', ['The caravan left at dawn and the trans-', 'port reached the pans by noon.']], ['Chapter 2', [second]]];
    for (const [h, body] of lines) {
      const pg = doc.addPage([420, 595]);
      pg.drawText(h, { x: 60, y: 480, size: 20, font });
      body.forEach((s, i) => pg.drawText(s, { x: 60, y: 430 - i * 16, size: 11, font }));
    }
    const raw = count('Chapter 1') + count(lines[0][1][0]) + count(lines[0][1][1]) + count('Chapter 2') + count(second);
    return { raw, ...(await importFile('hyphen.pdf', await doc.save())) };
  }
  it('a PDF: a hyphen at a line\'s end that the book\'s own text does not settle stays in the book as the page shows it: no character is removed, no row is counted, and the word is listed for the writer', async () => {
    const { rep, all, raw } = await hyphenPdf(LAST);
    expect(all).toContain('the trans-port reached');
    const ty = tallyOf(rep);
    // the book: the file's characters less the word "Chapter" of the two headings (7 each: the heading's own label, a row of its own)
    expect({ raw: ty.pdf!.raw, joins: ty.pdf!.joins, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted, same: ty.chars.same }).toEqual({ raw, joins: {}, file: raw, book: raw - 14, aside: { headingMarks: 14 }, unaccounted: 0, same: true });
    expect(ty.pdf!.rejoined).toEqual([]);
    expect(rep.items.filter((it) => it.kind === 'pdfHyphenAsk').map((it) => it.data)).toMatchObject([{ kept: 'trans-port', offered: 'transport', why: 'neither', n: 1 }]);
    const said = reportSaid(rep);
    expect(said).not.toContain(t('ir.tally.j.pdfRejoined'));
    expect(said).not.toContain('Each hyphen taken off at a line’s end');
  }, 120_000);
  it('a PDF: a hyphen taken off where the book writes the word whole elsewhere is a character removed, in a named row, and each one is listed', async () => {
    const { rep, all, raw } = await hyphenPdf('The transport lay white.');
    expect(all).toContain('the transport reached');
    const ty = tallyOf(rep);
    expect({ raw: ty.pdf!.raw, joins: ty.pdf!.joins, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted, same: ty.chars.same }).toEqual({ raw, joins: { pdfRejoined: 1 }, file: raw - 1, book: raw - 1 - 14, aside: { headingMarks: 14 }, unaccounted: 0, same: true });
    expect(ty.pdf!.rejoined).toEqual([{ from: ['trans-', 'port'], to: 'transport', n: 1 }]);
    const said = reportSaid(rep);
    expect(said).toContain(t('ir.tally.j.pdfRejoined') + '− 1');
    expect(said).toContain('Each hyphen taken off at a line’s end: “trans-” + “port” → “transport”');
  }, 120_000);
});
