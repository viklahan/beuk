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

/* A heading with nothing under it (BEUK:importtally, the owner's rule: the writer's words stay the writer's). A chapter
   not yet written, an outline of headings, a dedication page still empty: each comes in as the writer wrote it, a
   chapter or a page with no text, its heading counted in the tally. Before, the shared parser dropped every heading
   with no text under it, silently: an empty "Chapter One" was 2 words unaccounted, and an outline of headings came
   in as one chapter named after the file. The same three manuscripts as Markdown, Word and PDF. */

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

type Sec = { type: string; kind?: string; title: string; content: string; number?: string };
type Tally = { studio: { unexplained: number; emptyHeadings: number }; counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; words: { same: boolean; fileOnly: unknown[]; bookOnly: unknown[] } };
type Rep = { tally: Tally; items: { kind: string; before?: string; data?: Record<string, unknown> }[] };
let lastModule: { api: Api } | null = null;
async function importFile(name: string, bytes: Uint8Array | null, text = ''): Promise<{ rep: Rep; secs: Sec[] }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  lastModule = m;
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const buf = () => { const b = bytes || new TextEncoder().encode(text); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Rep)();
  const doc = m.api.snapshotBookDoc() as { sections: Sec[] };
  return { rep, secs: doc.sections };
}

/* A Word file of headings and paragraphs, the parts a reader needs and no more: Heading 1 by its style id, as Word
   writes it, with the style named in styles.xml */
async function docx(blocks: [('h' | 'p'), string][]): Promise<Uint8Array> {
  const JSZip = (globalThis as Rec).JSZip as new () => { file: (p: string, s: string) => void; generateAsync: (o: Rec) => Promise<Uint8Array> };
  const z = new JSZip();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>');
  const body = blocks.map(([k, s]) => '<w:p>' + (k === 'h' ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + esc(s) + '</w:t></w:r></w:p>').join('');
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>' + body + '</w:body></w:document>');
  return z.generateAsync({ type: 'uint8array' });
}
async function pdf(blocks: [('h' | 'p'), string][]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  /* a heading opens a page, set large; a paragraph follows it on its page */
  let pg: { drawText: (s: string, o: Rec) => void } | null = null, y = 0;
  for (const [k, s] of blocks) {
    if (k === 'h' || !pg) { pg = doc.addPage([420, 595]); y = 480; }
    pg.drawText(s, { x: 60, y, size: k === 'h' ? 20 : 11, font });
    y -= k === 'h' ? 50 : 16;
  }
  return doc.save();
}
const md = (blocks: [('h' | 'p'), string][]) => blocks.map(([k, s]) => (k === 'h' ? '# ' : '') + s).join('\n\n') + '\n';

/* The writer's headings, each with its text or with none */
const CASES: [string, [('h' | 'p'), string][], (secs: Sec[], rep: Rep) => void, ((secs: Sec[], rep: Rep) => void)?][] = [
  ['a chapter not yet written: "Chapter One" with nothing under it, then chapters with text', [['h', 'Chapter One'], ['h', 'Chapter Two'], ['p', 'The caravan left at dawn and reached the pans by noon.'], ['h', 'Chapter Three'], ['p', 'The pans lay white under the sun.']],
    (secs) => { const ch = secs.filter((s) => s.type === 'chapter'); expect(ch.map((s) => s.content.trim() === '')).toEqual([true, false, false]); }],
  ['an outline: five headings and no text', [['h', 'The Road'], ['h', 'The Pans'], ['h', 'The Salt'], ['h', 'The Wind'], ['h', 'The Dusk']],
    (secs) => { const ch = secs.filter((s) => s.type === 'chapter'); expect(ch.map((s) => s.title)).toEqual(['The Road', 'The Pans', 'The Salt', 'The Wind', 'The Dusk']); expect(ch.every((s) => s.content.trim() === '')).toBe(true); },
    /* a PDF of headings alone sets them all alike: with no text to set them against, nothing in the file says they are
       headings (no size, no bookmark), so they come in as the book's text, every word of them kept */
    (secs) => { const text = secs.map((s) => s.title + ' ' + s.content).join(' '); for (const h of ['The Road', 'The Pans', 'The Salt', 'The Wind', 'The Dusk']) expect(text).toContain(h); }],
  ['a dedication page not yet written, before the chapters', [['h', 'Dedication'], ['h', 'Chapter 1'], ['p', 'The caravan left at dawn and reached the pans by noon.'], ['h', 'Chapter 2'], ['p', 'The pans lay white under the sun.']],
    (secs, rep) => { expect(rep.items.some((it) => it.kind === 'matter' && /Dedication/.test(String((it as Rec).before || ''))), 'the report names the dedication page as the file’s').toBe(true); expect(secs.filter((s) => s.type === 'chapter').length).toBe(2); }],
];

describe('a heading with nothing under it is kept as the writer wrote it: a chapter with no text, a page with no text', () => {

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
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'lockPdfBytes', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf'], supplied: [...new Set([...stubs, 'importLockAsk', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-empty-headings', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_TALLY_PDF', fn: 'createImportTallyPdf', title: "1.0's PDF import with its tally (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportTallyPdf(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);
  it('the import card shows an outline\'s chapters as found, each with no words yet', async () => {
    await importFile('outline.md', null, md(CASES[1][1]));
    lastModule!.api.irRenderReport();
    const card = (document.body.textContent || '').replace(/\s+/g, ' ');
    expect(card).toContain('outline.md5chapters');
    for (const [n, h] of [[1, 'The Road'], [5, 'The Dusk']] as [number, string][]) expect(card).toContain(n + h + '0');
    /* the card's sentence says what Beuk found, never "read 0 words" of a file with words in it; the studio's own count
       (pages with text) stays what it is */
    expect(card).toContain('Beuk found 5 chapters in your file, with no text under them yet.');
    expect(card).not.toContain('Beuk read 0 words');
  }, 120_000);
  /* Not decided (no rule guessed in): a contents list typed as headings, with no "Contents" heading above it. TODAY each
     of its lines comes in as a chapter with no text, before the chapters themselves, which then appear twice; every word
     is kept and counted. This test shows that, so a change to it is seen; what the book should do is the owner's call. */
  it('today: a contents list typed as headings, with no "Contents" above it, comes in as chapters with no text, before the chapters', async () => {
    const text = md([['h', 'Chapter 1: Dawn'], ['h', 'Chapter 2: Noon'], ['h', 'Chapter 1: Dawn'], ['p', 'The caravan left at dawn.'], ['h', 'Chapter 2: Noon'], ['p', 'The pans lay white.']]);
    const { rep, secs } = await importFile('contents-as-headings.md', null, text);
    const ch = secs.filter((s) => s.type === 'chapter');
    expect(ch.map((s) => [s.title, s.content.trim() === ''])).toEqual([['Dawn', true], ['Noon', true], ['Dawn', false], ['Noon', false]]);
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.words.same }).toEqual({ unaccounted: 0, same: true });
  }, 120_000);
  /* A contents list typed as headings with no "Contents" heading above it (the owner's rule, 2026-11-21): three lines
     or more in a row, each with nothing under it, each the same heading as a later chapter that has text, in the same
     order, nothing else in the run: that run is the typed contents, set aside, counted under contents and listed in the
     report. Anything short of it stays as it is (chapters with no text). */
  const chap = (n: number, t: string): [('h' | 'p'), string][] => [['h', 'Chapter ' + n + ': ' + t], ['p', 'The caravan went on at ' + t.toLowerCase() + '.']];
  const typed = (lines: string[]) => md([...lines.map((l) => ['h', l] as ['h', string]), ...chap(1, 'Dawn'), ...chap(2, 'Noon'), ...chap(3, 'Dusk')]);
  it('three typed contents lines, each a later chapter\'s heading in the same order, are the contents: set aside and counted', async () => {
    const { rep, secs } = await importFile('typed-contents.md', null, typed(['Chapter 1: Dawn', 'Chapter 2: Noon', 'Chapter 3: Dusk']));
    expect(secs.filter((s) => s.type === 'chapter').map((s) => s.title)).toEqual(['Dawn', 'Noon', 'Dusk']);
    expect(rep.items.some((it) => it.kind === 'toc' && /Chapter 1: Dawn/.test(String(it.before || ''))), 'listed in the report').toBe(true);
    expect(rep.tally.aside.contents, "three words a line: Chapter, its number, its title").toBe(9);
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.words.same }).toEqual({ unaccounted: 0, same: true });
  }, 120_000);
  for (const [what, lines] of [
    ['one line matches no chapter', ['Chapter 1: Dawn', 'Chapter 2: Noon', 'Chapter 4: Night']],
    ['the same lines in another order', ['Chapter 2: Noon', 'Chapter 1: Dawn', 'Chapter 3: Dusk']],
  ] as [string, string[]][]) {
    it('not the contents (' + what + '): kept as chapters with no text', async () => {
      const { rep, secs } = await importFile('near-miss.md', null, typed(lines));
      const ch = secs.filter((s) => s.type === 'chapter');
      expect(ch.length).toBe(6);
      expect(ch.slice(0, 3).every((s) => s.content.trim() === '')).toBe(true);
      expect(rep.tally.aside.contents || 0).toBe(0);
      expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.words.same }).toEqual({ unaccounted: 0, same: true });
    }, 120_000);
  }
  for (const [what, blocks, check, pdfCheck] of CASES) {
    for (const fmt of ['md', 'docx', 'pdf'] as const) {
      it(fmt + ': ' + what, async () => {
        const { rep, secs } = fmt === 'md' ? await importFile('book.md', null, md(blocks)) : await importFile('book.' + fmt, fmt === 'docx' ? await docx(blocks) : await pdf(blocks));
        (fmt === 'pdf' && pdfCheck ? pdfCheck : check)(secs, rep);
        const ty = rep.tally;
        expect({ unaccounted: ty.unaccounted, same: ty.words.same, fileOnly: ty.words.fileOnly, bookOnly: ty.words.bookOnly, studioUnexplained: ty.studio.unexplained }).toEqual({ unaccounted: 0, same: true, fileOnly: [], bookOnly: [], studioUnexplained: 0 });
      }, 120_000);
    }
  }
});
