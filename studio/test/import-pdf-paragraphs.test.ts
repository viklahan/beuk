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

/* The paragraphs a PDF's page shows are the writer's (BEUK:pdfparas). A PDF keeps no paragraphs, only lines; the reader
   makes paragraphs of them from what the page shows: an indent, a taller gap, a line that stops short of the far margin.
   One of its rules cut the writer's paragraphs in two on evidence the page did not give:

   A line that opens on a dash. Any line of 80 characters or fewer opening on "— " ended its paragraph ("an attribution
   stands on its own"), so a sentence whose spaced dash fell at the start of a full line was cut there, and a line of
   dash-set dialogue that wrapped was cut after its first line. What the page shows of an attribution is that it is
   short: it stops well before the far margin. A dash-opened line that runs to the margin is a line of its paragraph.
   And a quotation mark standing after a space at a line's end opens a quotation: it is no closed sentence, so a dash
   on the next line begins no paragraph there.

   Every sentence here is made up for this test. The PDFs are made with pdf-lib (Helvetica, whose real widths decide
   where each line breaks, as a typesetter's measure does) and read by the vendored pdf.js, as import-tally-pdf.test.ts
   does. */

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
type Font = { widthOfTextAtSize: (s: string, n: number) => number };
type PdfLib = { PDFDocument: { create: () => Promise<{ addPage: (s: [number, number]) => { drawText: (s: string, o: Rec) => void }; embedFont: (f: string) => Promise<Font>; save: () => Promise<Uint8Array> }> }; StandardFonts: Record<string, string> };
let pdfLib: PdfLib;
let font: Font;

type Sec = { type: string; kind?: string; title: string; content: string };
type Rep = { tally: { counted: boolean; unaccounted: number; chars: { same: boolean } } };

/* The page: text 11 on 16, a measure of 300 from x = 60, 29 lines to a full page. */
const SIZE = 11, LEAD = 16, LEFT = 60, MEASURE = 300, TOP = 520, FOOT = 72;
/** A block of the page: text the measure breaks (or lines given as they stand), set `inset` in from the margin on a
 *  measure of its own; `first` sets its first line further in (a paragraph's indent), `hang` its later lines (a list
 *  item's); `gap` is the space above it, in lines. A "|" inside a word is where the word may break at a line's end. */
type Block = { text?: string; lines?: string[]; inset?: number; measure?: number; first?: number; hang?: number; gap?: number };
type Page = { head?: string; blocks: Block[]; toFoot?: boolean };

/** greedy line breaking by the font's own widths: a word goes to the next line when it does not fit */
function wrap(text: string, measure: number, first = 0, hang = 0): string[] {
  const lines: string[] = [];
  let cur = '';
  const room = () => measure - (lines.length ? hang : first);
  for (const word of text.split(' ')) {
    word.split('|').forEach((part, k) => {
      const glue = k > 0 || !cur ? '' : ' ';
      if (cur && font.widthOfTextAtSize(cur + glue + part, SIZE) > room()) { lines.push(cur); cur = part; }
      else cur += glue + part;
    });
  }
  if (cur) lines.push(cur);
  return lines;
}
const linesOf = (b: Block): string[] => b.lines || wrap(b.text || '', b.measure || MEASURE - (b.inset || 0), b.first || 0, b.hang || 0);

async function makePdf(pages: Page[]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const f = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const pg of pages) {
    const page = doc.addPage([420, 595]);
    const put: [string, number, number][] = [];
    let y = TOP + LEAD;
    pg.blocks.forEach((b) => {
      y -= (b.gap || 0) * LEAD;
      linesOf(b).forEach((s, k) => { y -= LEAD; put.push([s, LEFT + (b.inset || 0) + (k === 0 ? b.first || 0 : b.hang || 0), y]); });
    });
    /* a page that runs to its foot: its last line stands on the foot line, as a full page's does */
    const drop = pg.toFoot ? y - FOOT : 0;
    if (pg.head) page.drawText(pg.head, { x: LEFT, y: TOP + 40 - drop, size: 20, font: f });
    for (const [s, x, yy] of put) page.drawText(s, { x, y: yy - drop, size: SIZE, font: f });
  }
  return doc.save();
}
async function importPdf(name: string, pages: Page[]): Promise<{ rep: Rep; paras: string[] }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const bytes = await makePdf([...pages, CLOSING]);
  const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => '' })) as () => Rep)();
  const ch = (m.api.snapshotBookDoc() as { sections: Sec[] }).sections.filter((s) => s.type === 'chapter');
  expect(ch.map((s) => s.title), 'the two chapters').toEqual(['The Lamp', 'The Bar']);
  return { rep, paras: ch[0].content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) };
}
const clean = (rep: Rep) => ({ counted: rep.tally.counted, unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same });
const CLEAN = { counted: true, unaccounted: 0, same: true };

/* Plain paragraphs of the story, set to the full measure. Each ends short of the margin on a closed sentence. */
const FERRY = 'The ferry left the island at six with nine passengers and a crate of hens. Old Mirren sat by the rail and counted the buoys as she had counted them every morning for thirty years.';
const FOG = 'By the second bell the fog had come down over the channel and the pilot rang for half speed. Nobody spoke of the lamp that had gone dark on the outer rock.';
/* the book's second chapter, on a page of its own: every book here has two chapters, so the first one's text is a chapter's */
const CLOSING: Page = { head: 'Chapter 2: The Bar', blocks: [{ text: 'The bar was crossed at slack water with a hand to spare. Mirren did not look back at the rock.' }, { text: 'She had no need to look.', first: 18 }] };
const HEAD = 'Chapter 1: The Lamp';

describe('a PDF\'s paragraphs are the ones its page shows: a line that opens on a dash', () => {
  beforeAll(async () => {
    loadMammoth();
    pdfLib = (await import(/* @vite-ignore */ pathToFileURL(path.join(import.meta.dirname, '..', '..', 'node_modules', 'pdf-lib', 'cjs', 'index.js')).href)) as unknown as PdfLib;
    font = await (await pdfLib.PDFDocument.create()).embedFont(pdfLib.StandardFonts.Helvetica);
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
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'lockPdfBytes', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf'], supplied: [...new Set([...stubs, 'importLockAsk', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-pdf-paragraphs', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_TALLY_PDF', fn: 'createImportTallyPdf', title: "1.0's PDF import with its tally (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportTallyPdf(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  it('a sentence whose dash falls at the start of a full line stays one paragraph: the line runs to the margin, so nothing ended there', async () => {
    const RULE = 'The harbour master had a rule for mornings like this one, and he kept it through the whole of that long and bitterest winter — no boat left the quay before the lamp was lit again, whatever the owners said about tides and money.';
    const lines = wrap(RULE, MEASURE);
    const at = lines.findIndex((l) => /^— /.test(l));
    expect(at > 0 && at < lines.length - 1, 'the fixture: a middle line of the paragraph opens on the dash: ' + JSON.stringify(lines)).toBe(true);
    expect(font.widthOfTextAtSize(lines[at], SIZE), 'the fixture: that line is not short (the reader calls a line short when it stops more than 22% of the measure before the far margin)').toBeGreaterThan(MEASURE * 0.78);
    expect(lines[at].length, 'the fixture: and is 80 characters or fewer, which was all the old rule asked').toBeLessThanOrEqual(80);
    const { rep, paras } = await importPdf('lamp-dash.pdf', [{ head: HEAD, blocks: [{ text: FERRY }, { text: RULE }, { text: FOG, first: 18 }] }]);
    expect(paras).toEqual([FERRY, RULE, FOG]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  it('dialogue set with dashes: each speech is a paragraph, and a speech that turns onto a second line is not cut after its first', async () => {
    const SAIL = '— We sail at the turn of the tide and not one minute before it.';
    const LIT = '— Then the lamp must be lit by four, said the mate.';
    const CLIMB = '— It will be lit, said Mirren, if I have to climb the rock and light it with my own two hands.';
    expect(wrap(CLIMB, MEASURE).length, 'the fixture: the third speech turns onto a second line').toBe(2);
    expect(wrap(SAIL, MEASURE).length + wrap(LIT, MEASURE).length, 'the fixture: the first two are a line each').toBe(2);
    const { rep, paras } = await importPdf('lamp-speech.pdf', [{ head: HEAD, blocks: [{ text: FERRY }, { text: SAIL }, { text: LIT }, { text: CLIMB }, { text: FOG, first: 18 }] }]);
    expect(paras).toEqual([FERRY, SAIL, LIT, CLIMB, FOG]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  it('a quotation mark after a space at a line\'s end opens a quotation, it closes no sentence: the dash on the next line begins no paragraph', async () => {
    const ROPE = 'When the rope came aboard she turned to the lad and said, " — hold it as you would hold a sleeping child, and do not let it run through your hands." He held it so.';
    const lines = wrap(ROPE, MEASURE);
    expect(/, "$/.test(lines[0]) && /^— /.test(lines[1]), 'the fixture: the first line ends on the opening mark, the second opens on the dash: ' + JSON.stringify(lines)).toBe(true);
    const { rep, paras } = await importPdf('lamp-rope.pdf', [{ head: HEAD, blocks: [{ text: FERRY }, { text: ROPE }, { text: FOG, first: 18 }] }]);
    expect(paras).toEqual([FERRY, ROPE, FOG]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  /* Guard: what must stay as it is. */
  it('an attribution under a quotation still stands on its own, and so does the paragraph after it: the attribution is short of the margin', async () => {
    const SAYING = 'A harbour is a promise the land makes to the sea, and the sea has never once been asked whether it agrees.';
    const BY = '— Ilse Brandt';
    const HEART = 'Mirren had that line by heart before she could read, and she said it over the rail each morning as the ferry cleared the bar.';
    const { rep, paras } = await importPdf('lamp-saying.pdf', [{ head: HEAD, blocks: [{ text: FERRY }, { text: SAYING }, { text: BY }, { text: HEART }, { text: FOG, first: 18 }] }]);
    expect(paras).toEqual([FERRY, SAYING, BY, HEART, FOG]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);
});
