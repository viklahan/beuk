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

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." A list's number or bullet is a character the writer
   typed. The import tally does not compare a list's mark at the head of a line (the book writes the same marks, so
   neither side counts them): a reader that changed one would change it unseen. So this holds it directly, each file
   read by 1.0's own readImportFile (the text 2.0 lifts):

   - in every format, a number typed at the head of a paragraph is stored as typed: 1. 2. 4. stays 1. 2. 4., "1)" keeps
     its bracket, 2. 1. 3. keeps its order;
   - Markdown and plain text, where the list is nested, indented or stands straight under a line of text (the lists
     irFlatLists sets at the margin, one level deep): each item keeps the number and bracket, or the "-", "*" or "•",
     the writer typed. Until this test the numbers were written over from the first one in steps of one ("3. 7. 9."
     came in "3. 4. 5."), a bracket became a full stop, and a bullet under a numbered item was given a number of
     Beuk's. A bullet of the writer's own ("+", "◆") stays that bullet (BEUK:listmarkstyped: it was set as "-");
   - RTF, whose lists write their numbers out ({\listtext 5.\tab}): the number the file wrote is the number stored
     (it was written over 1, 2, 3 whatever the file said), and so is a letter, a Roman numeral or a bullet of the
     writer's own (BEUK:listmarkstyped: "a.", "iv." and "◆" were given the book's own). Only a mark of no form the
     book's list reads gets the book's own, and its characters are counted in the tally's row.

   What each surface then SHOWS for a stored number is not held here: the preview, the EPUB and the Word export number
   an ordered list from its first item in steps of one (listItemsOf's `start`), a measured finding reported apart. */

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
const zipOf = () => new ((globalThis as Rec).JSZip as Zip)();

type Sec = { type: string; kind?: string; title: string; content: string; number?: string };
type Tally = { counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; chars: { same: boolean; fileOnly: unknown[]; bookOnly: unknown[] } };
type Rep = { tally?: Rec; items: { kind: string; data?: Rec }[] };
/** the file read into an empty book: the blocks of its first chapter, the tally, and how many nested items the report counts */
async function importFile(name: string, bytes: Uint8Array | null, text: string): Promise<{ blocks: string[]; tally: Tally; nested: number }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const b = bytes || new TextEncoder().encode(text); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Rep)();
  const doc = m.api.snapshotBookDoc() as { sections: Sec[] };
  const ch = doc.sections.find((s) => s.type === 'chapter' && s.number === '1');
  const nested = rep.items.filter((i) => i.kind === 'nestedList').reduce((a, i) => a + Number((i.data || {}).n || 0), 0);
  return { blocks: (ch ? ch.content : '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean), tally: rep.tally as unknown as Tally, nested };
}
const clear = (ty: Tally) => ({ counted: ty.counted, unaccounted: ty.unaccounted, same: ty.chars.same, fileOnly: ty.chars.fileOnly, bookOnly: ty.chars.bookOnly });
const CLEAR = { counted: true, unaccounted: 0, same: true, fileOnly: [], bookOnly: [] };
const LAST = 'The pans lay white.';
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ---- part one: a number typed at the head of a paragraph, in every format ---- */
const TYPED: [string, string[]][] = [
  ['gap', ['1.', '2.', '4.']],
  ['bracket', ['1)', '2)', '3)']],
  ['order', ['2.', '1.', '3.']],
];
const NUMS = ['one', 'two', 'three'];
const PARAS: string[] = TYPED.flatMap(([word, marks]) => marks.map((mk, k) => mk + ' ' + word + ' ' + NUMS[k] + ' went out.').concat(['After ' + word + ' the page goes on.']));

async function docx(paras: string[]): Promise<Uint8Array> {
  const z = zipOf();
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>');
  const p = (s: string, h?: boolean) => '<w:p>' + (h ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>';
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>' + p('Chapter 1', true) + paras.map((s) => p(s)).join('') + p('Chapter 2', true) + p(LAST) + '</w:body></w:document>');
  return z.generateAsync({ type: 'uint8array' });
}
async function odt(paras: string[]): Promise<Uint8Array> {
  const z = zipOf();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  z.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
  z.file('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
    + '<text:h text:outline-level="1">Chapter 1</text:h>' + paras.map((s) => '<text:p>' + xml(s) + '</text:p>').join('') + '<text:h text:outline-level="1">Chapter 2</text:h><text:p>' + LAST + '</text:p></office:text></office:body></office:document-content>');
  return z.generateAsync({ type: 'uint8array' });
}
const pageBody = (paras: string[]) => '<h1>Chapter 1</h1>' + paras.map((s) => '<p>' + xml(s) + '</p>').join('');
async function epub(paras: string[]): Promise<Uint8Array> {
  const z = zipOf();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:0</dc:identifier><dc:title>Lists</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>'
    + '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  const pageOf = (title: string, body: string) => '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + title + '</title></head><body>' + body + '</body></html>';
  z.file('OEBPS/c1.xhtml', pageOf('Chapter 1', pageBody(paras)));
  z.file('OEBPS/c2.xhtml', pageOf('Chapter 2', '<h1>Chapter 2</h1><p>' + LAST + '</p>'));
  return z.generateAsync({ type: 'uint8array' });
}
async function pdf(paras: string[]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  let pg = doc.addPage([620, 595]), y = 520;
  pg.drawText('Chapter 1', { x: 60, y, size: 20, font }); y -= 44;
  for (const s of paras) { pg.drawText(s, { x: 60, y, size: 11, font }); y -= /^After/.test(s) ? 30 : 16; }
  pg = doc.addPage([620, 595]);
  pg.drawText('Chapter 2', { x: 60, y: 520, size: 20, font });
  pg.drawText(LAST, { x: 60, y: 476, size: 11, font });
  return doc.save();
}
const BS = String.fromCharCode(92);
const w = (word: string) => BS + word;
const rtfEsc = (s: string) => Array.from(s).map((c) => (c === BS || c === '{' || c === '}' ? BS + c : c.charCodeAt(0) > 126 ? BS + 'u' + c.charCodeAt(0) + '?' : c)).join('');
const rtfPara = (s: string) => w('pard') + w('s0') + ' ' + rtfEsc(s) + w('par') + '\n';
const rtfDoc = (body: string) => '{' + w('rtf1') + w('ansi') + w('deff0') + '{' + w('fonttbl') + '{' + w('f0') + ' Times;}}{' + w('stylesheet') + '{' + w('s0') + ' Normal;}{' + w('s1') + w('outlinelevel0') + ' heading 1;}}\n'
  + w('pard') + w('s1') + ' Chapter 1' + w('par') + '\n' + body + w('pard') + w('s1') + ' Chapter 2' + w('par') + '\n' + rtfPara(LAST) + '}';
const plain = (paras: string[], head: (s: string) => string) => [head('Chapter 1'), ...paras, head('Chapter 2'), LAST].join('\n\n') + '\n';

const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
  ['lists.txt', async () => ({ bytes: null, text: plain(PARAS, (s) => s) })],
  ['lists.md', async () => ({ bytes: null, text: plain(PARAS, (s) => '# ' + s) })],
  ['lists.html', async () => ({ bytes: null, text: '<!doctype html><html><head><title>Lists</title></head><body>' + pageBody(PARAS) + '<h1>Chapter 2</h1><p>' + LAST + '</p></body></html>' })],
  ['lists.rtf', async () => { const s = rtfDoc(PARAS.map(rtfPara).join('')); return { bytes: new TextEncoder().encode(s), text: s }; }],
  ['lists.docx', async () => ({ bytes: await docx(PARAS), text: '' })],
  ['lists.odt', async () => ({ bytes: await odt(PARAS), text: '' })],
  ['lists.epub', async () => ({ bytes: await epub(PARAS), text: '' })],
  ['lists.pdf', async () => ({ bytes: await pdf(PARAS), text: '' })],
];

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
  const out = await buildTestModule(HTML, epubClosure, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite'], supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-list-marks-as-given', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_LIST_MARKS', fn: 'createImportListMarks', title: "1.0's import, storing a list's marks as given (tests only)" });
  const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportListMarks(env);';
  make = (e: Rec) => new Function('env', code)(e) as { api: Api };
}, 180_000);

describe('a number typed at the head of a paragraph is stored as typed, in every format', () => {
  it.each(FILES)('%s: 1. 2. 4. keeps its gap, 1) 2) 3) its brackets, 2. 1. 3. its order', async (name, build) => {
    const f = await build();
    const { blocks, tally } = await importFile(name, f.bytes, f.text);
    /* a PDF states no paragraphs: its reader may join a short line to the one above it, so there each typed line is looked for at the head of a block */
    if (/\.pdf$/.test(name)) for (const line of PARAS.filter((s) => !/^After/.test(s))) expect(blocks.filter((b) => b.startsWith(line)), name + ': ' + line).toHaveLength(1);
    else expect(blocks, name).toEqual(PARAS);
    expect(clear(tally), name).toEqual(CLEAR);
  }, 120_000);
});

/* ---- part two: Markdown and plain text, the lists irFlatLists sets at the margin ---- */
const TEXT: [string, (s: string) => string][] = [['lists.txt', (s) => s], ['lists.md', (s) => '# ' + s]];
const file = (head: (s: string) => string, ...blocks: string[]) => [head('Chapter 1'), 'Counted twice.', ...blocks, head('Chapter 2'), LAST].join('\n\n') + '\n';

describe('Markdown and plain text: a list set at the margin keeps each item\'s mark as the writer typed it', () => {
  it.each(TEXT)('%s: a numbered list straight under a line of text keeps its numbers (3. 7. 9.)', async (name, head) => {
    const { blocks, tally, nested } = await importFile(name, null, file(head, 'Things to bring:\n3. salt for the pans\n7. water for two days\n9. rope'));
    expect(blocks).toEqual(['Counted twice.', 'Things to bring:', '3. salt for the pans\n7. water for two days\n9. rope']);
    expect(clear(tally)).toEqual(CLEAR);
    expect(nested).toBe(0);
  }, 120_000);

  it.each(TEXT)('%s: a numbered list inside a numbered list keeps the numbers of both (1. 1. 2. 2.), flat, and the report counts the two nested items', async (name, head) => {
    const { blocks, tally, nested } = await importFile(name, null, file(head, '1. bread\n    1. rye\n    2. wheat\n2. water'));
    expect(blocks).toEqual(['Counted twice.', '1. bread\n1. rye\n2. wheat\n2. water']);
    expect(clear(tally)).toEqual(CLEAR);
    expect(nested).toBe(2);
  }, 120_000);

  it.each(TEXT)('%s: a bracket stays a bracket, and a wrapped item keeps its second line', async (name, head) => {
    const { blocks, tally } = await importFile(name, null, file(head, 'Before sailing:\n2) check the\n   moorings\n5) stow the nets\n9) douse the lamps'));
    expect(blocks).toEqual(['Counted twice.', 'Before sailing:', '2) check the\nmoorings\n5) stow the nets\n9) douse the lamps']);
    expect(clear(tally)).toEqual(CLEAR);
  }, 120_000);

  it.each(TEXT)('%s: "*" stays "*" and "•" stays "•": the book\'s list reads both', async (name, head) => {
    const { blocks, tally } = await importFile(name, null, file(head, '* bread\n    * rye\n* water', '• nets\n    • floats\n• lines'));
    expect(blocks).toEqual(['Counted twice.', '* bread\n* rye\n* water', '• nets\n• floats\n• lines']);
    expect(clear(tally)).toEqual(CLEAR);
  }, 120_000);

  it.each(TEXT)('%s: bullets under a numbered item are a list of their own, and the numbered items keep their numbers (no bullet is given a number of Beuk\'s)', async (name, head) => {
    const { blocks, tally, nested } = await importFile(name, null, file(head, '1. Pack the bags\n   - socks\n   - shirts\n2. Lock the door'));
    expect(blocks).toEqual(['Counted twice.', '1. Pack the bags', '- socks\n- shirts', '2. Lock the door']);
    expect(clear(tally)).toEqual(CLEAR);
    expect(nested).toBe(2);
  }, 120_000);

  it.each(TEXT)('%s: numbers under a bulleted item keep their numbers (they were set as "-"), and a bullet left standing alone stays as typed', async (name, head) => {
    const { blocks, tally } = await importFile(name, null, file(head, '◆ Tools\n  1. hammer\n  2. saw\n◆ Wood'));
    expect(blocks).toEqual(['Counted twice.', '◆ Tools', '1. hammer\n2. saw', '◆ Wood']);
    expect(clear(tally)).toEqual(CLEAR);
    expect(tally.aside.listMarks, 'no mark was taken off').toBeUndefined();
  }, 120_000);

  /* BEUK:listmarkstyped — this case pinned the defect: "+" and "◆" were set as "-" and their six characters counted in the
     tally's row as set aside. The book's list reads them now, so each stays the bullet the writer typed, in the book. */
  it.each(TEXT)('%s: a bullet of the writer\'s own ("+", "◆", "◇") stays that bullet, and none is set aside', async (name, head) => {
    const { blocks, tally } = await importFile(name, null, file(head, '+ bread\n+ rye\n+ water', '◆ nets\n    ◇ floats\n◆ lines'));
    expect(blocks).toEqual(['Counted twice.', '+ bread\n+ rye\n+ water', '◆ nets\n◇ floats\n◆ lines']);
    expect(tally.aside.listMarks, 'no mark was taken off').toBeUndefined();
    expect(clear(tally)).toEqual(CLEAR);
  }, 120_000);

  it.each(TEXT)('%s: a list already at the margin in the book\'s own marks is left exactly as typed', async (name, head) => {
    const { blocks, tally } = await importFile(name, null, file(head, '1. bread\n2. rye\n4. water', '- nets\n- floats'));
    expect(blocks).toEqual(['Counted twice.', '1. bread\n2. rye\n4. water', '- nets\n- floats']);
    expect(clear(tally)).toEqual(CLEAR);
  }, 120_000);
});

/* ---- part three: RTF, whose lists write their numbers out ---- */
describe('RTF: the number a list wrote out is the number stored', () => {
  let ls = 0;
  const list = (marks: string[], word: string, levels?: number[]) => { ls++; return marks.map((mk, k) => w('pard') + w('ls' + ls) + w('ilvl' + ((levels || [])[k] || 0)) + '{' + w('listtext') + ' ' + rtfEsc(mk) + w('tab') + '}' + word + ' ' + NUMS[k % 3] + (k > 2 ? ' again' : '') + w('par') + '\n').join(''); };
  it('a list written 5. 6. 7. is stored 5. 6. 7.; 1) keeps its bracket; 1. 2. 9. its 9; a list inside a list both its numbers; "•" stays "•"', async () => {
    const body = rtfPara('Counted twice.') + list(['5.', '6.', '7.'], 'start') + rtfPara('Then.') + list(['1)', '2)', '3)'], 'bracket') + rtfPara('Then.') + list(['1.', '2.', '9.'], 'jump')
      + rtfPara('Then.') + list(['1.', '1.', '2.', '2.'], 'nest', [0, 1, 1, 0]) + rtfPara('Then.') + list(['•', '•', '•'], 'dot');
    const s = rtfDoc(body);
    const { blocks, tally, nested } = await importFile('lists.rtf', new TextEncoder().encode(s), s);
    expect(blocks).toEqual(['Counted twice.', '5. start one\n6. start two\n7. start three', 'Then.', '1) bracket one\n2) bracket two\n3) bracket three', 'Then.', '1. jump one\n2. jump two\n9. jump three',
      'Then.', '1. nest one\n1. nest two\n2. nest three\n2. nest one again', 'Then.', '• dot one\n• dot two\n• dot three']);
    expect(clear(tally)).toEqual(CLEAR);
    expect(tally.aside.listMarks, 'a number or "•" at the head of a line is counted on neither side').toBeUndefined();
    expect(nested).toBe(2);
  }, 120_000);
  /* BEUK:listmarkstyped — this case pinned the defect: "a." "b." "c." and "i." "ii." "iii." were stored 1. 2. 3., "◆" was
     stored "-", and the 18 characters the file wrote were counted in the tally's row as set aside. Each is stored as
     written now. Only a mark of no form the book's list reads ("Step 1:") still gets the book's own, and is counted. */
  it('a letter, a Roman numeral and a bullet of the writer\'s own ("a.", "ii.", "◆") are stored as the file wrote them; a mark of no form the list reads gets the book\'s own, counted in the tally\'s row', async () => {
    const body = rtfPara('Counted twice.') + list(['a.', 'b.', 'c.'], 'letter') + rtfPara('Then.') + list(['i.', 'ii.', 'iii.'], 'roman') + rtfPara('Then.') + list(['◆', '◆', '◆'], 'glyph') + rtfPara('Then.') + list(['Step 1:', 'Step 2:', 'Step 3:'], 'step');
    const s = rtfDoc(body);
    const { blocks, tally } = await importFile('lists.rtf', new TextEncoder().encode(s), s);
    expect(blocks).toEqual(['Counted twice.', 'a. letter one\nb. letter two\nc. letter three', 'Then.', 'i. roman one\nii. roman two\niii. roman three', 'Then.', '◆ glyph one\n◆ glyph two\n◆ glyph three', 'Then.', '- step one\n- step two\n- step three']);
    expect(tally.aside.listMarks).toBe(18); // "Step 1:" "Step 2:" "Step 3:", six characters each: the only marks not in the book
    expect(clear(tally)).toEqual(CLEAR);
  }, 120_000);
});
