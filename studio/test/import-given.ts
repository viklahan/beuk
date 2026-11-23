import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
// @ts-expect-error — a plain .mjs build script, no types
import { buildTestModule } from '../scripts/extract-closure.mjs';
import { ORACLE_STUBS } from './import-oracle';
import { loadMammoth } from './vendor';
import markup from '../src/generated/import-markup.json';

/* What the "as given" import tests share (the second sweep, 2026-11-22): 1.0's own readImportFile in Node, as
   import-list-marks-as-given.test.ts builds it, and a made-up file in each format the import reads. Tests only:
   nothing here is imported by the app. Every text in a file made here is invented for the test. */

export type Rec = Record<string, unknown>;
export type Sec = { id: string; type: string; kind?: string; title: string; subtitle?: string; content: string; number?: string };
export type Diff = [string, number, string[]][];
export type Tally = { v: number; counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; rows: { key: string; file: number; book: number }[];
  chars: { same: boolean; fileOnly: Diff; bookOnly: Diff } };
export type Item = { kind: string; group?: string; before?: string; after?: string; data?: Rec; where?: { secId: string | null; label: string } };
export type Api = Record<string, (...a: unknown[]) => unknown>;
export type Got = { secs: Sec[]; rep: { items: Item[]; tally?: Tally }; tally: Tally; api: Api; images: Rec[] };

const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
export const english = t;
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const VENDOR = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
const noop = () => undefined;
function env(): Rec {
  const e: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis,
    mammoth: (globalThis as Rec).mammoth, pdfLoadLib: async () => (globalThis as Rec).pdfjsLib };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}
type PdfPage = { drawText: (s: string, o: Rec) => void };
type PdfFont = { widthOfTextAtSize: (s: string, n: number) => number };
type PdfLib = { PDFDocument: { create: () => Promise<{ addPage: (s: [number, number]) => PdfPage; embedFont: (f: string) => Promise<PdfFont>; save: () => Promise<Uint8Array> }> }; StandardFonts: Record<string, string> };
let pdfLib: PdfLib;
type Zip = new () => { file: (p: string, s: string, o?: Rec) => void; generateAsync: (o: Rec) => Promise<Uint8Array> };
const zipOf = () => new ((globalThis as Rec).JSZip as Zip)();
let make: (e: Rec) => { api: Api };

/** Call in beforeAll: the page's import lifted into a module of its own (`what` names it; `roots` are added to the import's own). */
export async function setupImport(what: string, roots: string[] = []): Promise<void> {
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
  const all = [...new Set(['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irTallyLast', ...roots])];
  const out = await buildTestModule(HTML, epubClosure, { roots: all, supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what, fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_GIVEN', fn: 'createImportGiven', title: "1.0's import, as given (tests only)" });
  const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportGiven(env);';
  make = (e: Rec) => new Function('env', code)(e) as { api: Api };
}

/** The file read into an empty book: the book's sections, the import report with its tally, and the module's own functions. */
export async function importFile(name: string, bytes: Uint8Array | null, text: string): Promise<Got> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const b = bytes || new TextEncoder().encode(text); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Got['rep'])();
  const doc = m.api.snapshotBookDoc() as { sections: Sec[]; images?: Rec[] };
  return { secs: doc.sections, rep, tally: rep.tally as Tally, api: m.api, images: doc.images || [] };
}
/** the sections that hold something of the file: text, or a heading of their own */
export const written = (g: Got): Sec[] => g.secs.filter((s) => String(s.content || '').trim() || s.type === 'part' || (s.kind === 'body' && s.type === 'chapter'));
export const blocksOf = (content: string): string[] => String(content || '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
export const figures = (g: Got) => ({ counted: g.tally.counted, unaccounted: g.tally.unaccounted, same: g.tally.chars.same, fileOnly: g.tally.chars.fileOnly.map(([c, n]) => [c, n]), bookOnly: g.tally.chars.bookOnly.map(([c, n]) => [c, n]) });
export const CLEAR = { counted: true, unaccounted: 0, same: true, fileOnly: [], bookOnly: [] };

export const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
export const W_NS = W;
/** a Word paragraph of plain text (`heading`: in the Heading 1 style) */
export const wp = (s: string, heading?: boolean) => '<w:p>' + (heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>';
/** a Word package: the body's own XML, and any further parts by path (word/footnotes.xml, word/endnotes.xml, word/numbering.xml are declared and related) */
export async function docx(bodyXml: string, extra: Record<string, string> = {}): Promise<Uint8Array> {
  const z = zipOf();
  const kinds: Record<string, string> = { 'word/footnotes.xml': 'footnotes', 'word/endnotes.xml': 'endnotes', 'word/numbering.xml': 'numbering' };
  const over = Object.keys(extra).filter((p) => kinds[p]).map((p) => '<Override PartName="/' + p + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + kinds[p] + '+xml"/>').join('');
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' + over + '</Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  Object.keys(extra).filter((p) => kinds[p]).forEach((p, k) => rels.push('<Relationship Id="rIdX' + k + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + kinds[p] + '" Target="' + p.replace(/^word\//, '') + '"/>'));
  if (extra['word/media/p1.png']) rels.push('<Relationship Id="rIdP1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p1.png"/>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style></w:styles>');
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + bodyXml + '</w:body></w:document>');
  for (const [p, s] of Object.entries(extra)) { if (/\.png$/.test(p)) z.file(p, s, { base64: true }); else z.file(p, s); }
  return z.generateAsync({ type: 'uint8array' });
}
const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
/** an OpenDocument text: the body's own XML (`auto`: its automatic styles; `extra`: further files by path, a .png as base64) */
export async function odt(bodyXml: string, auto = '', extra: Record<string, string> = {}): Promise<Uint8Array> {
  const z = zipOf();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  z.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' + Object.keys(extra).map((p) => '<manifest:file-entry manifest:full-path="' + p + '" manifest:media-type="image/png"/>').join('') + '</manifest:manifest>');
  z.file('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + ODT_NS + '><office:automatic-styles>' + auto + '</office:automatic-styles><office:body><office:text>' + bodyXml + '</office:text></office:body></office:document-content>');
  for (const [p, s] of Object.entries(extra)) z.file(p, s, { base64: true });
  return z.generateAsync({ type: 'uint8array' });
}
export const oh = (s: string) => '<text:h text:outline-level="1">' + xml(s) + '</text:h>';
export const op = (s: string) => '<text:p>' + xml(s) + '</text:p>';
/** an EPUB 3 of the given pages, in order (`extra`: further files by their path in the package) */
export async function epub(pages: { title: string; body: string }[], extra: Record<string, string> = {}): Promise<Uint8Array> {
  const z = zipOf();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:0</dc:identifier><dc:title>As Given</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en</dc:language></metadata>'
    + '<manifest>' + pages.map((p, i) => '<item id="c' + i + '" href="c' + i + '.xhtml" media-type="application/xhtml+xml"/>').join('') + '</manifest><spine>' + pages.map((p, i) => '<itemref idref="c' + i + '"/>').join('') + '</spine></package>');
  pages.forEach((p, i) => z.file('OEBPS/c' + i + '.xhtml', '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>' + xml(p.title) + '</title></head><body>' + p.body + '</body></html>'));
  for (const [p, s] of Object.entries(extra)) z.file(p, s);
  return z.generateAsync({ type: 'uint8array' });
}
export const page = (body: string) => '<!doctype html><html><head><meta charset="utf-8"><title>As Given</title></head><body>' + body + '</body></html>';
const BS = String.fromCharCode(92);
/** an RTF control word */
export const rw = (s: string) => BS + s;
export const rtfEsc = (s: string) => Array.from(s).map((c) => (c === BS || c === '{' || c === '}' ? BS + c : c.charCodeAt(0) > 126 ? BS + 'u' + c.charCodeAt(0) + '?' : c)).join('');
export const rtfP = (s: string) => rw('pard') + rw('s0') + ' ' + rtfEsc(s) + rw('par') + '\n';
export const rtfH = (s: string) => rw('pard') + rw('s1') + ' ' + rtfEsc(s) + rw('par') + '\n';
export const rtfDoc = (body: string) => '{' + rw('rtf1') + rw('ansi') + rw('deff0') + '{' + rw('fonttbl') + '{' + rw('f0') + ' Times;}}{' + rw('stylesheet') + '{' + rw('s0') + ' Normal;}{' + rw('s1') + rw('outlinelevel0') + ' heading 1;}}\n' + body + '}';

export type PdfLine = { text?: string; size?: number; x?: number; gap?: number; page?: boolean; runs?: { text: string; size?: number }[] };
/** a PDF set in Helvetica, line by line down each page ({ page: true } starts a new page; `runs` sets pieces of several sizes on one line) */
export async function pdf(lines: PdfLine[], width = 620): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  const H = 595;
  let pg = doc.addPage([width, H]), y = H - 70;
  for (const l of lines) {
    if (l.page) { pg = doc.addPage([width, H]); y = H - 70; continue; }
    const size = l.size || 11;
    if (y < 60) { pg = doc.addPage([width, H]); y = H - 70; }
    if (l.runs) { let x = l.x == null ? 60 : l.x; for (const r of l.runs) { pg.drawText(r.text, { x, y, size: r.size || size, font }); x += font.widthOfTextAtSize(r.text, r.size || size); } }
    else pg.drawText(l.text || '', { x: l.x == null ? 60 : l.x, y, size, font });
    y -= l.gap == null ? size * 1.35 : l.gap;
  }
  return doc.save();
}
/** a paragraph's lines for a PDF page, wrapped at about `at` characters */
export function pdfPara(text: string, at = 62): PdfLine[] {
  const out: PdfLine[] = [];
  let cur = '';
  for (const wd of text.split(' ')) { if ((cur + ' ' + wd).trim().length > at) { out.push({ text: cur.trim(), size: 11, gap: 15 }); cur = wd; } else cur = (cur + ' ' + wd).trim(); }
  if (cur) out.push({ text: cur, size: 11, gap: 24 });
  return out;
}
