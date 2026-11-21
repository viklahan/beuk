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
    const jsdomModule = 'jsdom'; /* a computed specifier, as pdf-lib is loaded above: jsdom ships no types, and the test needs none */
    const { JSDOM } = (await import(/* @vite-ignore */ jsdomModule)) as unknown as { JSDOM: new (h: string, o?: Rec) => { window: Rec & { document: Document } } };
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

  /* A PDF marks no lists: a note's printed number ("7.") is a word of the file before and after the reader joins its
     line, never a join. Kept by the book (set bold, as the Meridian PDFs' notes are), nothing is set aside; set by the
     book as a list's number, which the studio does not count, it is a counted line, "list numbers". */
  async function numbered(bold: boolean) {
    const doc = await pdfLib.PDFDocument.create();
    const font = (await doc.embedFont(pdfLib.StandardFonts.Helvetica)) as { widthOfTextAtSize: (s: string, n: number) => number };
    const face = bold ? await doc.embedFont(pdfLib.StandardFonts.HelveticaBold) : font;
    const w = (face as typeof font).widthOfTextAtSize('7. ', 11);
    BOOK.forEach((lines, k) => {
      const pg = doc.addPage([420, 595]);
      lines.forEach(([s, x, y, size]) => pg.drawText(s, { x, y, size, font }));
      if (k === 1) {
        /* the number and its line as two pieces (pdf.js gives one per drawn run), on a line of its own */
        pg.drawText('7.', { x: 60, y: 380, size: 11, font: face });
        pg.drawText('The clerk counted the plates.', { x: 60 + w, y: 380, size: 11, font: face });
      }
    });
    return (await importPdf('salt-road-numbered.pdf', await doc.save())).tally as Tally & { words: { same: boolean; fileOnly: unknown[]; bookOnly: unknown[] } };
  }
  it('a numbered line the book keeps (set bold): "7." is a word on both sides, no join is counted, and every word is the book\'s', async () => {
    const ty = await numbered(true);
    expect({ raw: ty.pdf && ty.pdf.raw, joins: ty.pdf && ty.pdf.joins, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted, same: ty.words.same, fileOnly: ty.words.fileOnly, bookOnly: ty.words.bookOnly })
      .toEqual({ raw: 54, joins: { pdfRejoined: 1 }, file: 53, book: 41, aside: { headers: 9, pageNumbers: 3 }, unaccounted: 0, same: true, fileOnly: [], bookOnly: [] });
  }, 120_000);
  it('a numbered line the book sets as a list\'s item: "7." is counted as a list number the book now sets, not lost', async () => {
    const ty = await numbered(false);
    expect({ raw: ty.pdf && ty.pdf.raw, joins: ty.pdf && ty.pdf.joins, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted, same: ty.words.same })
      .toEqual({ raw: 54, joins: { pdfRejoined: 1 }, file: 53, book: 40, aside: { headers: 9, pageNumbers: 3, listMarks: 1 }, unaccounted: 0, same: true });
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

  /* Running heads (BEUK:importtally, gap B). Text repeated at a page's edge is not enough to make a running line: a
     line of the story can repeat there (a book whose memos open with the same FROM and TO, a paragraph that closes
     several pages the same way). What parts a running line from the story is the space around it: in the Meridian
     PDFs every true head and page number stands 1.8 leads or more from the text, every line of the story taken for
     one sat one line (1.0 to 1.1 leads) from the line beside it. */
  const reportText = () => { lastModule!.api.irRenderReport(); return (document.body.textContent || '').replace(/\s+/g, ' '); };
  it('a line of the story that repeats at the edge of several pages stays in the book: memo lines set smaller at the top, a paragraph\'s close at the foot', async () => {
    const memo = (n: number): [string, number, number, number][] => [['FROM: THE GRAZ DESK', 60, 560, 8.5], ['TO: THE NORTHBRIDGE ARCHIVE', 60, 548, 8.5], ['RE: shipment ' + n + ' of the copper plates', 60, 536, 8.5]];
    const body = (from: number, lines: string[]): [string, number, number, number][] => lines.map((s, i) => [s, 60, from - i * 16, 11] as [string, number, number, number]);
    const filler = (k: number) => Array.from({ length: 24 }, (_, i) => 'Line ' + (i + 1) + ' of page ' + k + ' tells of the road.');
    /* three pages: a memo, then text down to the foot, closing on the same two lines of the story */
    const full = (k: number) => [...memo(k), ...body(470, filler(k)), ...body(470 - 24 * 16, ['Following the audit, the clerk reviewed the', 'ledger that every station had kept.'])];
    /* four short pages (a chapter's last page, and so on): the text ends high */
    const short = (k: number) => body(470, filler(k).slice(0, 8));
    const first: [string, number, number, number][] = [['Chapter 1: The Memos', 60, 480, 20], ...body(430, filler(0).slice(0, 8))];
    const ty = (await importPdf('memos.pdf', await makePdf([first, full(1), short(2), full(3), short(4), full(5), short(6), short(7)]))).tally as Tally & { words: { same: boolean; fileOnly: unknown[] } };
    expect({ aside: ty.aside, unaccounted: ty.unaccounted, same: ty.words.same, fileOnly: ty.words.fileOnly, bookOnly: (ty.words as unknown as Rec).bookOnly }).toEqual({ aside: {}, unaccounted: 0, same: true, fileOnly: [], bookOnly: [] });
    expect(ty.file).toBe(ty.book);
  }, 120_000);

  it('a true running head and page numbers are set aside, and the report lists each line with the pages that carried it', async () => {
    const rep = await importPdf('salt-road.pdf', await makePdf(BOOK));
    expect(rep.tally.aside).toEqual({ headers: 9, pageNumbers: 3 });
    const said = reportText();
    expect(said).toContain('“THE SALT ROAD” ×3');
    expect(said).toContain('1, 2, 3… ×3');
  }, 120_000);

  it('a running head that is the chapter\'s title changes with the chapter: each is set aside within its chapter and listed', async () => {
    const head = (s: string): [string, number, number, number] => [s, 180, 560, 8];
    const text = (k: number, n: number) => Array.from({ length: n }, (_, i) => ['Line ' + (i + 1) + ' on page ' + k + ' of the long road.', 60, 430 - i * 16, 11] as [string, number, number, number]);
    const pages = [
      [['Chapter 1: Dawn', 60, 480, 20], ...text(1, 10), ['1', 205, 30, 9]],
      [head('DAWN ON THE PANS'), ...text(2, 20), ['2', 205, 30, 9]],
      [head('DAWN ON THE PANS'), ...text(3, 20), ['3', 205, 30, 9]],
      [['Chapter 2: Dusk', 60, 480, 20], ...text(4, 10), ['4', 205, 30, 9]],
      [head('DUSK OVER THE SALT'), ...text(5, 20), ['5', 205, 30, 9]],
      [head('DUSK OVER THE SALT'), ...text(6, 20), ['6', 205, 30, 9]],
    ] as [string, number, number, number][][];
    const rep = await importPdf('two-chapters.pdf', await makePdf(pages));
    const ty = rep.tally as Tally & { words: { same: boolean } };
    expect({ aside: ty.aside, unaccounted: ty.unaccounted, same: ty.words.same }).toEqual({ aside: { headers: 16, pageNumbers: 6 }, unaccounted: 0, same: true });
    const said = reportText();
    expect(said).toContain('“DAWN ON THE PANS” ×2');
    expect(said).toContain('“DUSK OVER THE SALT” ×2');
  }, 120_000);

  /* A title page (BEUK:titlepage): a PDF sets its lines large, so the reader reads them as headings with no text under
     them. The book's details take them, as they take a title page's lines set plain in any format, and the tally counts
     them as the title page's; before, the zone rule filed each as a preface with no text, never kept: the writer's
     title went nowhere and showed as unaccounted. */
  it('a title page set large: its lines go to the book\'s details and are counted as the title page\'s, not lost', async () => {
    const title: [string, number, number, number][] = [['THE SALT ROAD', 120, 420, 26], ['A Novel', 175, 380, 14], ['Ada Wren', 170, 300, 16]];
    const rep = await importPdf('salt-road-title.pdf', await makePdf([title, ...BOOK])) as unknown as { tally: Tally & { words: { same: boolean } }; items: { kind: string; data: Record<string, unknown> }[] };
    const ty = rep.tally;
    expect({ aside: ty.aside, unaccounted: ty.unaccounted, same: ty.words.same }).toEqual({ aside: { headers: 9, pageNumbers: 3, titlePage: 7 }, unaccounted: 0, same: true });
    expect(rep.items.some((it) => it.kind === 'lifted' && it.data.reason === 'titlepage'), 'the report lists the title page as lifted into the details').toBe(true);
  }, 120_000);
  it('a title over a page of its own text (the author and the rights): the title is the title page\'s, the rest stays the book\'s', async () => {
    const title: [string, number, number, number][] = [['The Salt Road', 120, 420, 26], ['Ada Wren', 170, 360, 14], ['Copyright © 2026 Ada Wren. All rights reserved.', 60, 120, 9]];
    const ty = (await importPdf('salt-road-rights.pdf', await makePdf([title, ...BOOK]))).tally as Tally & { words: { same: boolean } };
    expect({ aside: ty.aside, unaccounted: ty.unaccounted, same: ty.words.same }).toEqual({ aside: { headers: 9, pageNumbers: 3, titlePage: 3 }, unaccounted: 0, same: true });
  }, 120_000);

  /* What the title-page rule must never take: a heading that is a page of the book, not its title. None of these is
     moved to the book's details, whatever else the import does with it. */
  const details = (rep: { items: { kind: string; data: Record<string, unknown>; after?: string }[] }) => ({
    lifted: rep.items.filter((it) => it.kind === 'lifted' && it.data.reason === 'titlepage').length,
    title: (rep.items.find((it) => it.kind === 'meta' && it.data.field === 'title') || { after: '' }).after,
  });
  const big = (s: string, y: number): [string, number, number, number] => [s, 60, y, 20];
  const prose = (k: number): [string, number, number, number][] => [['The caravan left at dawn and the pans lay white on day ' + k + '.', 60, 430, 11]];
  type Rep = { items: { kind: string; data: Record<string, unknown>; after?: string }[] };
  for (const [name, pages, not] of [
    ['a first chapter with no text under it, before chapters with text', [[big('Chapter One', 480)], [big('Chapter Two', 480), ...prose(2)], [big('Chapter Three', 480), ...prose(3)]], ['Chapter One']],
    ['an outline: five headings and no prose', [[big('The Road', 520), big('The Pans', 470), big('The Salt', 420), big('The Wind', 370), big('The Dusk', 320)]], ['The Road', 'The Pans']],
    ['"Part One" with nothing under it, before Chapter 1', [[big('Part One', 480)], ...BOOK], ['Part One']],
    ['an author\'s note heading with nothing under it, before the chapters', [[big('Author\'s Note', 480)], ...BOOK], ['Author\'s Note', 'Author’s Note']],
  ] as [string, [string, number, number, number][][], string[]][]) {
    it('never a title page: ' + name, async () => {
      const d = details((await importPdf('not-a-title.pdf', await makePdf(pages))) as unknown as Rep);
      expect(d.lifted, 'nothing lifted as the title page').toBe(0);
      for (const h of not) expect(d.title, 'the title is not "' + h + '"').not.toBe(h);
    }, 120_000);
  }

  it('a locked PDF is counted as the open file holds it, once its password is given', async () => {
    const m = make(env());
    const locked = (await m.api.lockPdfBytes(await makePdf(BOOK), 'lantern')) as Uint8Array;
    const rep = await importPdf('salt-road-locked.pdf', locked);
    const ty = rep.tally;
    expect({ raw: ty.pdf && ty.pdf.raw, file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted }).toEqual({ raw: 48, file: 47, book: 35, aside: { headers: 9, pageNumbers: 3 }, unaccounted: 0 });
  }, 120_000);
});
