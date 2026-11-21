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

/* The import tally on a PDF (BEUK:importtally, gap 2). A PDF keeps no paragraphs — only the text items pdf.js reads off
   each page — so "in the file" is the words of those items, each counted on its own, before the reader builds lines,
   drops running heads and page numbers, or rejoins a word hyphenated across a line's end. Each thing the reader does
   that changes the count is counted where it does it: the words it sets aside (running heads, page numbers), and the
   words it joins (a hyphen removed at a line's end: two pieces, one word). What is left is unaccounted, shown as it is.

   The PDFs are made here with pdf-lib (the server's own dependency) and read by the pdf.js 1.0 vendors, loaded in
   Node as lockcopy-pdf.test.ts loads them: the same reader the studio runs, on the main thread. */

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
    mammoth: (globalThis as Rec).mammoth,
    /* the page loads pdf.js with script tags; here it is the vendored build already loaded in Node */
    pdfLoadLib: async () => (globalThis as Rec).pdfjsLib,
    /* a locked PDF: the writer types its password (here, the one the test locked it with) */
    importLockAsk: async (_name: string, tryOpen: (pw: string) => Promise<unknown>) => tryOpen('lantern') };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}
type PdfLib = { PDFDocument: { create: () => Promise<{ addPage: (s: [number, number]) => { drawText: (s: string, o: Rec) => void }; embedFont: (f: string) => Promise<unknown>; save: () => Promise<Uint8Array> }> }; StandardFonts: Record<string, string> };
let pdfLib: PdfLib;

/** pages: each a list of [text, x, y, size] */
async function makePdf(pages: [string, number, number, number][][]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([420, 595]);
    for (const [s, x, y, size] of lines) page.drawText(s, { x, y, size, font });
  }
  return doc.save();
}
type Tally = { counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; pdf?: { raw: number; joins: Record<string, number> } };
let lastModule: { api: Api } | null = null;
async function importPdf(name: string, bytes: Uint8Array): Promise<{ tally: Tally }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  lastModule = m;
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
  const file = { name, arrayBuffer: async () => buf(), text: async () => '' };
  return ((await m.api.readImportFile(file)) as () => { tally: Tally })();
}

/* three pages: a running head and a page number on each, a chapter heading, body lines; on page one a word hyphenated
   across a line's end ("trans-" / "port") */
const HEAD: [string, number, number, number] = ['THE SALT ROAD', 160, 560, 9];
const page = (n: number, title: string, body: string[]): [string, number, number, number][] => [
  HEAD, ['Chapter ' + n + ': ' + title, 60, 480, 20], ...body.map((s, i) => [s, 60, 430 - i * 16, 11] as [string, number, number, number]), [String(n), 205, 30, 9],
];
const BOOK = [
  page(1, 'Dawn', ['The caravan left at dawn and the trans-', 'port reached the pans by noon.']),
  page(2, 'Noon', ['The pans lay white under the sun.']),
  page(3, 'Dusk', ['The wind rose over the salt.']),
];

describe('the import tally counts a PDF from the text pdf.js reads, and names what the reader does with it', () => {
  beforeAll(async () => {
    loadMammoth();
    pdfLib = (await import(/* @vite-ignore */ pathToFileURL(path.join(import.meta.dirname, '..', '..', 'node_modules', 'pdf-lib', 'cjs', 'index.js')).href)) as unknown as PdfLib;
    const g = globalThis as Rec;
    /* pdf.js loads in a Node environment (as lockcopy-pdf.test.ts loads it); the import's page is a jsdom window set up here */
    const { JSDOM } = (await import('jsdom')) as unknown as { JSDOM: new (h: string, o?: Rec) => { window: Rec & { document: Document } } };
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
    for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = dom.window[k]; } catch (e) { /* read-only */ } }
    g.document = dom.window.document;
    g.pdfjsWorker = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')).href);
    g.pdfjsLib = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href);
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'readImportFile', 'lockPdfBytes', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf'], supplied: [...new Set([...stubs, 'importLockAsk', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-tally-pdf', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_TALLY_PDF', fn: 'createImportTallyPdf', title: "1.0's PDF import with its tally (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportTallyPdf(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  it('a book of three pages: 48 words in its pieces, less 1 rejoined at a line\'s end, is 47 in the file = 35 in the book + 9 of running heads + 3 page numbers', async () => {
    const rep = await importPdf('salt-road.pdf', await makePdf(BOOK));
    const ty = rep.tally;
    expect(ty.counted, 'the PDF is counted from its text').toBe(true);
    expect({ raw: ty.pdf && ty.pdf.raw, joins: ty.pdf && ty.pdf.joins, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted }).toEqual({ raw: 48, joins: { pdfRejoined: 1 }, file: 47, book: 35, aside: { headers: 9, pageNumbers: 3 }, unaccounted: 0 });
    // the card's sentence stays true arithmetic (47 − 35 = 12 set aside); the full tally shows the pieces' 48 and the join
    lastModule!.api.irRenderReport();
    expect(document.body.textContent || '').toContain(t('ir.tally.cardOk', { file: '47', book: '35', aside: '12' }));
    const el = document.createElement('div');
    el.innerHTML = String(lastModule!.api.irTallyHtmlOf(rep));
    const said = (el.textContent || '').replace(/\s+/g, ' ');
    for (const want of [t('ir.tally.j.raw') + '48', t('ir.tally.j.pdfRejoined') + '− 1', t('ir.tally.b.pageNumbers') + '3', t('ir.tally.pdf.note')]) expect(said, want).toContain(want);
  }, 120_000);

  it('a word set as two touching pieces ("cara" + "van") is one word: the join is counted as pieced together on a line, and the card still adds up', async () => {
    const doc = await pdfLib.PDFDocument.create();
    const font = (await doc.embedFont(pdfLib.StandardFonts.Helvetica)) as { widthOfTextAtSize: (s: string, n: number) => number };
    const italic = await doc.embedFont(pdfLib.StandardFonts.HelveticaOblique); /* a change of font: pdf.js gives two pieces */
    BOOK.forEach((lines, k) => {
      const pg = doc.addPage([420, 595]);
      lines.forEach(([s, x, y, size]) => {
        if (k === 1 && s === 'The pans lay white under the sun.') { pg.drawText('The cara', { x, y, size, font }); pg.drawText('van lay white under the sun.', { x: x + font.widthOfTextAtSize('The cara', size), y, size, font: italic }); return; }
        pg.drawText(s, { x, y, size, font });
      });
    });
    const ty = (await importPdf('salt-road-pieces.pdf', await doc.save())).tally;
    expect({ raw: ty.pdf && ty.pdf.raw, joins: ty.pdf && ty.pdf.joins, file: ty.file, book: ty.book, unaccounted: ty.unaccounted })
      .toEqual({ raw: 49, joins: { pdfRejoined: 1, pdfPieced: 1 }, file: 47, book: 35, unaccounted: 0 });
  }, 120_000);

  it('a step the reader takes that the tally is not told of shows as unaccounted, never hidden: a line dropped after the count is 2 words unaccounted', async () => {
    document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
    const m = make(env());
    m.api.applyBookDoc(m.api.buildEmptyBook());
    const bytes = await makePdf([BOOK[0], BOOK[1], page(3, 'Dusk', ['The wind rose over the salt.', 'Night fell.'])]);
    const ext = (await m.api.pdfExtract((globalThis as Rec).pdfjsLib, bytes.slice(), {})) as { pages: { items: { s: string }[] }[] };
    const src = Object.assign(m.api.irTallyPdf(ext) as Rec, { kind: 'pdf', counted: true });
    // the reader's step the tally knows nothing of: the last body line of page 3 ("Night fell.") taken out
    const p3 = ext.pages[2];
    p3.items = p3.items.filter((it) => it.s !== 'Night fell.');
    // a fresh import's buckets (readImportFile opens them), then the reader on the changed text, then the tally of the whole file
    await m.api.readImportFile({ name: 'x.txt', arrayBuffer: async () => new ArrayBuffer(0), text: async () => 'Chapter 1\n\nA line.' });
    const rep = m.api.importPdfExtracted('salt-road.pdf', ext);
    const ty = m.api.irTallyWrite(rep, src) as Tally;
    expect({ file: ty.file, unaccounted: ty.unaccounted }).toEqual({ file: 49, unaccounted: 2 });
  }, 120_000);

  it('a PDF with no text layer (a scanned page) is refused as scanned: nothing is counted, nothing claimed', async () => {
    const doc = await (pdfLib.PDFDocument as unknown as { create: () => Promise<{ addPage: (s: [number, number]) => { drawRectangle: (o: Rec) => void }; save: () => Promise<Uint8Array> }> }).create();
    doc.addPage([420, 595]).drawRectangle({ x: 20, y: 20, width: 380, height: 555 });
    await expect(importPdf('scan.pdf', await doc.save())).rejects.toThrow(t('pdf.scanned', { n: 1 }));
  }, 120_000);

  it('a locked PDF is counted as the open file holds it, once its password is given', async () => {
    const m = make(env());
    const locked = (await m.api.lockPdfBytes(await makePdf(BOOK), 'lantern')) as Uint8Array;
    const rep = await importPdf('salt-road-locked.pdf', locked);
    const ty = rep.tally;
    expect({ raw: ty.pdf && ty.pdf.raw, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted }).toEqual({ raw: 48, file: 47, book: 35, aside: { headers: 9, pageNumbers: 3 }, unaccounted: 0 });
  }, 120_000);
});
