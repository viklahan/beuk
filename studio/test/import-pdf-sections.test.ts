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

/* A PDF's section headings stay inside their chapter (BEUK:pdfsections). A PDF marks no heading levels; its type sizes
   do: the chapters ("Chapter 1: …") set at one size, the sections inside them at a smaller one. The reader handed every
   heading on at one level, so the parser could keep a section in its chapter only between two numbered chapters; the
   last chapter's sections were filed as back-matter pages, and most of the chapter's text with them (on the Meridian
   test book's PDF: chapter XII held 1,260 words of its 4,546, and "XII.1" to "XII.6" stood as six appendix pages).

   The PDFs are made here with pdf-lib and read by the vendored pdf.js, as import-tally-pdf.test.ts does. */

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
    importLockAsk: async () => null };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}
type PdfLib = { PDFDocument: { create: () => Promise<{ addPage: (s: [number, number]) => { drawText: (s: string, o: Rec) => void }; embedFont: (f: string) => Promise<unknown>; save: () => Promise<Uint8Array> }> }; StandardFonts: Record<string, string> };
let pdfLib: PdfLib;

type Sec = { type: string; kind?: string; title: string; content: string; number?: string };
type Tally = { counted: boolean; file: number; book: number; unaccounted: number; chars: { same: boolean; fileOnly: unknown[]; bookOnly: unknown[] } };
type Rep = { tally: Tally };
async function importPdf(name: string, bytes: Uint8Array): Promise<{ rep: Rep; secs: Sec[] }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => '' })) as () => Rep)();
  return { rep, secs: (m.api.snapshotBookDoc() as { sections: Sec[] }).sections };
}

/* A page is a list of lines from its top: a chapter heading (20), a section heading (14) or text (11). */
type Line = ['ch' | 'sec' | 'p', string];
const SIZE = { ch: 20, sec: 14, p: 11 };
async function makePdf(pages: Line[][]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const lines of pages) {
    const pg = doc.addPage([420, 595]);
    let y = 500;
    for (const [k, s] of lines) {
      if (k !== 'p' && y < 500) y -= 22; /* a heading stands apart from the text above it */
      pg.drawText(s, { x: 60, y, size: SIZE[k], font });
      y -= k === 'ch' ? 44 : k === 'sec' ? 30 : 16;
    }
  }
  return doc.save();
}

/* three chapters, each with a section inside it; the last chapter's second section opens a page of its own */
const CHAPTERS: Line[][] = [
  [['ch', 'Chapter 1: Dawn'], ['p', 'The caravan left at dawn with forty camels.'], ['p', 'Nobody on the quay looked up from the nets.'], ['sec', 'The Quay'], ['p', 'Salt lay in grey heaps along the harbour wall.'], ['p', 'A boy counted the sacks twice over.']],
  [['ch', 'Chapter 2: Noon'], ['p', 'By noon the pans lay white under the sun.'], ['p', 'The rakers worked in pairs without a word.'], ['sec', 'The Pans'], ['p', 'Each pan held a week of patient evaporation.'], ['p', 'The overseer wrote the yield in his book.']],
  [['ch', 'Chapter 3: Dusk'], ['p', 'At dusk the wind rose over the flats.'], ['p', 'The last cart rolled home before the dark.'], ['sec', 'The Wind'], ['p', 'It carried the smell of rain from the hills.'], ['p', 'Shutters banged along the whole of the street.']],
  [['sec', 'The Salt'], ['p', 'In the store the salt was weighed and sealed.'], ['p', 'The ledger closed on a figure nobody doubted.']],
];
const titles = (secs: Sec[], kind: string) => secs.filter((s) => s.kind === kind && (s.content || '').trim()).map((s) => s.title);
const clean = (rep: Rep) => ({ counted: rep.tally.counted, unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same });

describe('a PDF\'s section headings stay inside their chapter, the last chapter\'s too', () => {
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
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'lockPdfBytes', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf'], supplied: [...new Set([...stubs, 'importLockAsk', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-pdf-sections', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_TALLY_PDF', fn: 'createImportTallyPdf', title: "1.0's PDF import with its tally (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportTallyPdf(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  it('the last chapter keeps its sections: one in the middle of a page, one opening a page of its own', async () => {
    const { rep, secs } = await importPdf('salt-road.pdf', await makePdf(CHAPTERS));
    const ch = secs.filter((s) => s.type === 'chapter');
    expect(ch.map((s) => s.title)).toEqual(['Dawn', 'Noon', 'Dusk']);
    /* each section is its chapter's sub-heading, its text under it */
    expect(ch[0].content).toMatch(/^# The Quay$/m);
    expect(ch[1].content).toMatch(/^# The Pans$/m);
    expect(ch[2].content, 'the section in the middle of the last chapter\'s page').toMatch(/^# The Wind$/m);
    expect(ch[2].content, 'the section that opens a page of its own').toMatch(/^# The Salt$/m);
    expect(ch[2].content).toContain('Shutters banged along the whole of the street.');
    expect(ch[2].content).toContain('The ledger closed on a figure nobody doubted.');
    expect(titles(secs, 'back'), 'no back-matter page is made of the last chapter\'s sections').toEqual([]);
    expect(clean(rep)).toEqual({ counted: true, unaccounted: 0, same: true });
  }, 120_000);

  it('a heading under an appendix, set as the book\'s sections are, is that appendix\'s section: one page, not two', async () => {
    const { rep, secs } = await importPdf('salt-road-appendix.pdf', await makePdf([...CHAPTERS,
      [['ch', 'Tide Tables'], ['p', 'The tables below were kept by the harbour master.'], ['sec', 'Spring Tides'], ['p', 'High water at the full moon reached the third step.'], ['p', 'Low water bared the whole of the outer bar.']]]));
    expect(secs.filter((s) => s.type === 'chapter').map((s) => s.title)).toEqual(['Dawn', 'Noon', 'Dusk']);
    const back = secs.filter((s) => s.kind === 'back' && (s.content || '').trim());
    expect(back.map((s) => s.title)).toEqual(['Tide Tables']);
    expect(back[0].content).toMatch(/^# Spring Tides$/m);
    expect(back[0].content).toContain('Low water bared the whole of the outer bar.');
    expect(clean(rep)).toEqual({ counted: true, unaccounted: 0, same: true });
  }, 120_000);

  /* Guards: what must stay as it is. */
  it('a book with no sections inside its chapters: a smaller heading on a page of its own after the last chapter stays a back-matter page', async () => {
    const plain: Line[][] = CHAPTERS.slice(0, 3).map((pg) => pg.filter(([k]) => k !== 'sec'));
    const { rep, secs } = await importPdf('salt-road-note.pdf', await makePdf([...plain,
      [['sec', 'A Note on the Type'], ['p', 'This book is set in a face cut for small sizes.'], ['p', 'Its italic was drawn a generation later.']]]));
    const ch = secs.filter((s) => s.type === 'chapter');
    expect(ch.map((s) => s.title)).toEqual(['Dawn', 'Noon', 'Dusk']);
    expect(ch[2].content, 'the last chapter does not take it').not.toContain('A Note on the Type');
    expect(titles(secs, 'back')).toEqual(['A Note on the Type']);
    expect(clean(rep)).toEqual({ counted: true, unaccounted: 0, same: true });
  }, 120_000);

  it('only the last chapter has a section: nothing in the book shows what its sections look like, so it stays as it was', async () => {
    const pages: Line[][] = [...CHAPTERS.slice(0, 2).map((pg) => pg.filter(([k]) => k !== 'sec')), CHAPTERS[2].filter(([k, s]) => k !== 'sec' || s !== 'The Wind'), CHAPTERS[3]];
    const { rep, secs } = await importPdf('salt-road-lone.pdf', await makePdf(pages));
    expect(secs.filter((s) => s.type === 'chapter').map((s) => s.title)).toEqual(['Dawn', 'Noon', 'Dusk']);
    expect(titles(secs, 'back')).toEqual(['The Salt']);
    expect(clean(rep)).toEqual({ counted: true, unaccounted: 0, same: true });
  }, 120_000);
});
