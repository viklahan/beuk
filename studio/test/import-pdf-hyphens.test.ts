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

/* A PDF's hyphen at a line's end (BEUK:hyphensgiven). The owner's rule: "KEEP WHAT THE WRITER GIVES US." The page does
   not say whose hyphen it is — the writer's ("one-time") or the typesetter's (a break of "transport") — but the book's
   own text often does. When a line ends on a hyphen and the next line continues the word:
     - the hyphen is kept when the hyphenated form stands whole somewhere else in the PDF's text (capitals aside);
     - the word is joined without it when the joined form stands whole somewhere else and the hyphenated form does not;
     - when neither stands elsewhere, or both do, nothing the page shows is changed: the hyphen is kept (only the line
       break goes), and the word is listed in the report as one for the writer to look at, with what stands in the book
       and what the other reading would be. No guess. The writer can join it there, or all of them.
   The tally's row counts only hyphens actually taken off, each listed. A kept hyphen is not a character removed.

   Before, the reader looked for the two forms among the words of each line LESS ITS FIRST AND ITS LAST, and looked for
   the hyphenated form as its last two pieces only ("to-raster" for "vector-to-" + "raster"); where it found neither it
   took the hyphen off. Measured on the Meridian stress book's two PDFs it took 56 hyphens off, each one the writer's.

   The PDFs are made here with pdf-lib and read by the vendored pdf.js, as import-tally-pdf.test.ts makes and reads them. */

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

type Line = [string, number, number, number];
async function makePdf(pages: Line[][]): Promise<Uint8Array> {
  const doc = await pdfLib.PDFDocument.create();
  const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
  for (const lines of pages) {
    const pg = doc.addPage([420, 595]);
    for (const [s, x, y, size] of lines) pg.drawText(s, { x, y, size, font });
  }
  return doc.save();
}
/** a page: its chapter heading and its lines of text, one under the other */
const page = (n: number, title: string, body: string[]): Line[] => [['Chapter ' + n + ': ' + title, 60, 480, 20], ...body.map((s, i) => [s, 60, 430 - i * 16, 11] as Line)];
/** three chapters: the first holds the lines under test, the second what stands elsewhere in the book */
const book = (first: string[], second: string[]): Line[][] => [page(1, 'Dawn', first), page(2, 'Noon', second), page(3, 'Dusk', ['The wind rose over the salt.'])];

type Item = { id: string; kind: string; group: string; state: string; reversible: boolean; partial?: { done: number; total: number }; data: Rec };
type Tally = { counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; chars: { same: boolean };
  pdf: { raw: number; joins: Record<string, number>; rejoined: { from: string[]; to: string; n: number }[] } };
type Got = { tally: Tally; items: Item[]; all: string; asks: Item[]; api: Api };
const textOf = (api: Api) => (api.snapshotBookDoc() as { sections: { content: string }[] }).sections.map((s) => s.content).join('\n');
const got = (api: Api, rep: { tally: Tally; items: Item[] }): Got => ({ tally: rep.tally, items: rep.items, all: textOf(api), asks: rep.items.filter((it) => it.kind === 'pdfHyphenAsk'), api });
function fresh(): Api {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  return m.api;
}
async function importPdf(pages: Line[][]): Promise<Got> {
  const api = fresh();
  const bytes = await makePdf(pages);
  const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
  const rep = ((await api.readImportFile({ name: 'hyphens.pdf', arrayBuffer: async () => buf(), text: async () => '' })) as () => { tally: Tally; items: Item[] })();
  return got(api, rep);
}
/** the same, with the text pdf.js read changed before the reader sees it (a character pdf-lib's standard fonts cannot set: a soft hyphen, U+2010) */
async function importChanged(pages: Line[][], change: (s: string) => string): Promise<Got> {
  const api = fresh();
  const ext = (await api.pdfExtract((globalThis as Rec).pdfjsLib, (await makePdf(pages)).slice(), {})) as { pages: { items: { s: string }[] }[] };
  ext.pages.forEach((p) => p.items.forEach((it) => { it.s = change(it.s); }));
  const src = Object.assign(api.irTallyPdf(ext) as Rec, { kind: 'pdf', counted: true });
  /* a fresh import's buckets (readImportFile opens them), then the reader on the changed text, then the tally of the whole file */
  await api.readImportFile({ name: 'x.txt', arrayBuffer: async () => new ArrayBuffer(0), text: async () => 'Chapter 1\n\nA line.' });
  const rep = api.importPdfExtracted('hyphens.pdf', ext) as { tally: Tally; items: Item[] };
  rep.tally = api.irTallyWrite(rep, src) as Tally;
  return got(api, rep);
}
const reportSaid = (g: Got) => { g.api.irRenderReport(); return (document.body.textContent || '').replace(/\s+/g, ' '); };
const tallySaid = (g: Got) => { const el = document.createElement('div'); el.innerHTML = String(g.api.irTallyHtmlOf({ tally: g.tally })); return (el.textContent || '').replace(/\s+/g, ' '); };
const SHY = String.fromCharCode(0xad), HY = String.fromCharCode(0x2010);
const BROKEN = ['The caravan left at dawn and the trans-', 'port reached the pans by noon.'];

describe('a PDF\'s hyphen at a line\'s end is settled by the book\'s own text, and where the text does not settle it nothing the page shows is changed', () => {
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
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited', 'pdfLoadLib'].includes(n));
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf', 'irUndoItem', 'serializeBook', 'initImportReport'], supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-pdf-hyphens', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_PDF_HYPHENS', fn: 'createImportPdfHyphens', title: "1.0's PDF import, a hyphen at a line's end (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportPdfHyphens(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  it('a word that stands hyphenated elsewhere in the PDF ("one-time") and is broken at its hyphen: the book keeps the hyphen, nothing is counted in the row, nothing is left for the writer', async () => {
    const g = await importPdf(book(['The clerk kept the code and the one-', 'time pad lay beside the ledger.'], ['A one-time code was set that night.']));
    expect(g.all).toContain('the one-time pad lay');
    expect(g.all).not.toContain('onetime');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: {}, rejoined: [], unaccounted: 0, same: true });
    expect(g.tally.file, 'no character was taken off: the file\'s characters are its pieces\'').toBe(g.tally.pdf.raw);
    expect(g.asks).toEqual([]);
    expect(g.items.find((it) => it.kind === 'pdfHyphens')!.data).toEqual({ n: 0, kept: 1 });
    expect(tallySaid(g)).not.toContain(t('ir.tally.j.pdfRejoined'));
  }, 120_000);

  it('the hyphenated form is looked for whole, however many hyphens it has: "vector-to-" + "raster" with "vector-to-raster" elsewhere keeps its hyphen', async () => {
    const g = await importPdf(book(['The plates were sent through a vector-to-', 'raster pass before the night shift.'], ['A vector-to-raster pass takes an hour.']));
    expect(g.all).toContain('a vector-to-raster pass before');
    expect({ joins: g.tally.pdf.joins, asks: g.asks.length }).toEqual({ joins: {}, asks: 0 });
  }, 120_000);

  it('where it stands hyphenated elsewhere only as a line\'s first or last word, it still stands there: the hyphen is kept', async () => {
    const g = await importPdf(book(['The clerk kept the code and the one-', 'time pad lay beside the ledger.'], ['One-time codes were set that night.', 'The desk had asked for one-time']));
    expect(g.all).toContain('the one-time pad lay');
    expect({ joins: g.tally.pdf.joins, asks: g.asks.length }).toEqual({ joins: {}, asks: 0 });
  }, 120_000);

  it('a word that stands whole and unhyphenated elsewhere ("transport") and is broken with a hyphen at a line\'s end: joined, the hyphen counted in the row and listed', async () => {
    const g = await importPdf(book(BROKEN, ['The transport was late again.']));
    expect(g.all).toContain('the transport reached');
    expect(g.all).not.toContain('trans-');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: { pdfRejoined: 1 }, rejoined: [{ from: ['trans-', 'port'], to: 'transport', n: 1 }], unaccounted: 0, same: true });
    expect(g.tally.file).toBe(g.tally.pdf.raw - 1);
    expect(g.asks).toEqual([]);
    expect(g.items.find((it) => it.kind === 'pdfHyphens')!.data).toEqual({ n: 1, kept: 0 });
    const said = tallySaid(g);
    expect(said).toContain(t('ir.tally.j.pdfRejoined') + '− 1');
    expect(said).toContain('Each hyphen taken off at a line’s end: “trans-” + “port” → “transport”');
  }, 120_000);

  it('the two halves at the line\'s end are not themselves the word standing elsewhere: the same broken word twice, and nowhere whole, settles nothing', async () => {
    const g = await importPdf(book(BROKEN, ['Every cart of the second trans-', 'port was counted at the gate.']));
    expect(g.all).toContain('the trans-port reached');
    expect(g.all).toContain('second trans-port was');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined }).toEqual({ joins: {}, rejoined: [] });
    expect(g.asks.map((it) => it.data)).toMatchObject([{ kept: 'trans-port', offered: 'transport', why: 'neither', n: 2 }]);
  }, 120_000);

  it('a word that stands nowhere else: the hyphen is kept as the page shows it, nothing is counted in the row, and the report lists the word with both readings', async () => {
    const g = await importPdf(book(BROKEN, ['The pans lay white under the sun.']));
    expect(g.all).toContain('the trans-port reached');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: {}, rejoined: [], unaccounted: 0, same: true });
    expect(g.tally.file).toBe(g.tally.pdf.raw);
    expect(g.asks.map((it) => ({ group: it.group, state: it.state, reversible: it.reversible, data: it.data }))).toMatchObject([{ group: 'structure', state: 'applied', reversible: true, data: { kept: 'trans-port', offered: 'transport', why: 'neither', n: 1 } }]);
    expect(g.items.some((it) => it.kind === 'pdfHyphens'), 'no word was joined and none was kept by the book\'s own text: that line is not written').toBe(false);
    expect(g.items.some((it) => it.kind === 'pdfHyphenAskAll'), 'one word: no "join all"').toBe(false);
    const said = reportSaid(g);
    expect(said).toContain('A line of the PDF ends on the hyphen of “trans-port”, and the word stands nowhere else in it to say whose hyphen that is. Your book keeps it as the page shows it: “trans-port”. The other reading is “transport”.');
    expect(said).toContain('Join it: “transport”');
    expect(tallySaid(g)).not.toContain(t('ir.tally.j.pdfRejoined'));
  }, 120_000);

  it('a word that stands both ways elsewhere: the hyphen is kept, and the report lists the word, saying the PDF writes it both ways', async () => {
    const g = await importPdf(book(BROKEN, ['The transport was late and the trans-port clerk knew.']));
    expect(g.all).toContain('the trans-port reached');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: {}, rejoined: [], unaccounted: 0, same: true });
    expect(g.asks.map((it) => it.data)).toMatchObject([{ kept: 'trans-port', offered: 'transport', why: 'both', n: 1 }]);
    expect(reportSaid(g)).toContain('A line of the PDF ends on the hyphen of “trans-port”, and elsewhere the PDF writes both “trans-port” and “transport”, so it does not say which is meant here. Your book keeps it as the page shows it: “trans-port”. The other reading is “transport”.');
  }, 120_000);

  it('capitals aside: "Trans-" + "port" at a sentence\'s start is settled by "transport" elsewhere, and keeps its own capital', async () => {
    const g = await importPdf(book(['The caravan left at dawn in the cold. Trans-', 'port reached the pans by noon.'], ['The transport was late again.']));
    expect(g.all).toContain('cold. Transport reached');
    expect(g.tally.pdf.rejoined).toEqual([{ from: ['Trans-', 'port'], to: 'Transport', n: 1 }]);
  }, 120_000);

  it('a second half that opens on a capital ("Austro-" + "Hungarian") is settled the same way: nowhere else, it is kept and listed', async () => {
    const g = await importPdf(book(['The ledger came from the old Austro-', 'Hungarian customs house at the pass.'], ['The pans lay white under the sun.']));
    expect(g.all).toContain('old Austro-Hungarian customs');
    expect(g.tally.pdf.joins).toEqual({});
    expect(g.asks.map((it) => it.data)).toMatchObject([{ kept: 'Austro-Hungarian', offered: 'AustroHungarian', why: 'neither', n: 1 }]);
  }, 120_000);

  it('"Join it" replaces that one word in the book as it stands now; a word written whole with its hyphen elsewhere is not touched', async () => {
    const g = await importPdf(book(BROKEN, ['The transport was late and the trans-port clerk knew.']));
    const ask = g.asks[0];
    expect(g.api.irUndoItem(ask.id)).toMatchObject({ ok: true });
    const all = textOf(g.api);
    expect(all).toContain('the transport reached');
    expect(all, 'the word the writer set whole with its hyphen stays').toContain('the trans-port clerk knew');
    expect(ask.state).toBe('undone');
    expect(reportSaid(g)).toContain('Joined: “transport”');
  }, 120_000);

  it('"Join it" on a word broken twice joins both; once the text has been edited it joins what it still finds and says how many', async () => {
    const twice = book(BROKEN, ['Every cart of the second trans-', 'port was counted at the gate.']);
    const g = await importPdf(twice);
    expect(g.api.irUndoItem(g.asks[0].id)).toMatchObject({ ok: true });
    expect(textOf(g.api)).toContain('the transport reached');
    expect(textOf(g.api)).toContain('second transport was');
    // the same book, with the second place rewritten by the writer before the join
    const h = await importPdf(twice);
    type Doc = { sections: { content: string }[]; importReport: { items: Item[] } };
    const doc = h.api.serializeBook() as Doc;
    doc.sections.forEach((s) => { s.content = s.content.replace('second trans-port was', 'third trans-port is'); });
    h.api.applyBookDoc(doc);
    const id = doc.importReport.items.find((it) => it.kind === 'pdfHyphenAsk')!.id;
    expect(h.api.irUndoItem(id)).toMatchObject({ ok: true, partial: { done: 1, total: 2 } });
    const after = h.api.serializeBook() as Doc;
    const all = after.sections.map((s) => s.content).join('\n');
    expect(all).toContain('the transport reached');
    expect(all, 'the place the writer rewrote is left as the writer has it').toContain('third trans-port is');
    expect(after.importReport.items.find((it) => it.id === id)).toMatchObject({ state: 'undone', partial: { done: 1, total: 2 } });
    expect(reportSaid(h)).toContain('1 of 2 joined; the rest had been edited since the import');
    // and where none of it is found any more, nothing is changed and the line says why
    const k = await importPdf(book(BROKEN, ['The pans lay white under the sun.']));
    const gone = k.api.serializeBook() as Doc;
    gone.sections.forEach((s) => { s.content = s.content.replace('the trans-port reached', 'the trans-port came'); });
    k.api.applyBookDoc(gone);
    const before = (k.api.serializeBook() as Doc).sections.map((s) => s.content).join('\n');
    expect(k.api.irUndoItem(gone.importReport.items.find((it) => it.kind === 'pdfHyphenAsk')!.id)).toMatchObject({ ok: false, why: 'gone' });
    expect((k.api.serializeBook() as Doc).sections.map((s) => s.content).join('\n')).toBe(before);
    expect(reportSaid(k)).toContain('Could not join: ' + t('ir.why.gone') + '.');
  }, 120_000);

  it('two words left for the writer: each is listed, and "Join all of these" joins every one', async () => {
    const g = await importPdf(book([...BROKEN, 'The clerk wrote it in the day-', 'book before the lamp went out.'], ['The pans lay white under the sun.']));
    expect(g.all).toContain('the trans-port reached');
    expect(g.all).toContain('the day-book before');
    expect(g.asks.map((it) => it.data)).toMatchObject([{ kept: 'trans-port', offered: 'transport', why: 'neither', n: 1 }, { kept: 'day-book', offered: 'daybook', why: 'neither', n: 1 }]);
    const every = g.items.find((it) => it.kind === 'pdfHyphenAskAll')!;
    expect(every, 'the report offers to join all').toBeTruthy();
    expect({ reversible: every.reversible, data: every.data }).toEqual({ reversible: true, data: { n: 2 } });
    const said = reportSaid(g);
    expect(said).toContain('Words that end a line of the PDF on a hyphen its text does not settle: 2. Each is listed here, kept as the page shows it.');
    expect(said).toContain('Join all of these');
    expect(g.api.irUndoItem(every.id)).toMatchObject({ ok: true });
    const all = textOf(g.api);
    expect(all).toContain('the transport reached');
    expect(all).toContain('the daybook before');
    expect(g.asks.map((it) => it.state)).toEqual(['undone', 'undone']);
    expect(reportSaid(g)).toContain('All joined');
  }, 120_000);

  it('a soft hyphen (U+00AD) at a line\'s end is the typesetter\'s by definition: taken off whatever stands elsewhere, counted in the row, listed', async () => {
    const g = await importChanged(book(BROKEN, ['The pans lay white under the sun.']), (s) => s.replace(/trans-$/, 'trans' + SHY));
    expect(g.all).toContain('the transport reached');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: { pdfRejoined: 1 }, rejoined: [{ from: ['trans' + SHY, 'port'], to: 'transport', n: 1 }], unaccounted: 0, same: true });
    expect(g.asks).toEqual([]);
  }, 120_000);

  it('U+2010 at a line\'s end, kept: the book holds the page\'s own character, not "-" in its place', async () => {
    const g = await importChanged(book(BROKEN, ['The pans lay white under the sun.']), (s) => s.replace(/trans-$/, 'trans' + HY));
    expect(g.all).toContain('the trans' + HY + 'port reached');
    expect(g.all).not.toContain('trans-port');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: {}, rejoined: [], unaccounted: 0, same: true });
    expect(g.asks.map((it) => it.data)).toMatchObject([{ kept: 'trans' + HY + 'port', offered: 'transport', why: 'neither', n: 1 }]);
  }, 120_000);

  it('U+2010 at a line\'s end with the joined word elsewhere: taken off and counted, as "-" is; with the word hyphenated elsewhere (by "-" or U+2010), kept as the page has it', async () => {
    const joined = await importChanged(book(BROKEN, ['The transport was late again.']), (s) => s.replace(/trans-$/, 'trans' + HY));
    expect(joined.all).toContain('the transport reached');
    expect({ joins: joined.tally.pdf.joins, rejoined: joined.tally.pdf.rejoined, same: joined.tally.chars.same }).toEqual({ joins: { pdfRejoined: 1 }, rejoined: [{ from: ['trans' + HY, 'port'], to: 'transport', n: 1 }], same: true });
    const kept = await importChanged(book(BROKEN, ['The trans-port clerk was late again.']), (s) => s.replace(/trans-$/, 'trans' + HY));
    expect(kept.all).toContain('the trans' + HY + 'port reached');
    expect({ joins: kept.tally.pdf.joins, asks: kept.asks.length, same: kept.tally.chars.same }).toEqual({ joins: {}, asks: 0, same: true });
  }, 120_000);

  /* The rule does not ask what kind of character stands either side of the hyphen, so long as it is a word's: a letter
     or a digit. Before, it asked for a letter before the hyphen and a letter to open the next line; any other line-end
     hyphen fell to the plain rule for two lines and got a space of Beuk's own after it, inside the writer's own code:
     "VIE-" + "04-10" was stored "VIE- 04-10", "GRZ-02-" + "REF-17" was "GRZ-02- REF-17", "5-" + "unit" was "5- unit". */
  const CODE = ['Marta entered the confirmation code VIE-', '04-10 into the ledger that night.'];

  it('a code broken at its hyphen before a digit ("VIE-" + "04-10"), whole elsewhere in the PDF: closed up with no space of Beuk\'s, the hyphen kept, nothing left for the writer', async () => {
    const g = await importPdf(book(CODE, ['The code VIE-04-10 was struck out at noon.']));
    expect(g.all).toContain('confirmation code VIE-04-10 into the ledger');
    expect(g.all).not.toContain('VIE- 04');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: {}, rejoined: [], unaccounted: 0, same: true });
    expect(g.tally.file).toBe(g.tally.pdf.raw);
    expect(g.asks).toEqual([]);
    expect(g.items.find((it) => it.kind === 'pdfHyphens')!.data).toEqual({ n: 0, kept: 1 });
  }, 120_000);

  it('the same code standing nowhere else: the hyphen is kept and no space is added (only the line break goes), and it is listed for the writer like any other; "Join it" takes that one hyphen out', async () => {
    const g = await importPdf(book(CODE, ['The pans lay white under the sun.']));
    expect(g.all).toContain('confirmation code VIE-04-10 into the ledger');
    expect(g.all).not.toContain('VIE- 04');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: {}, rejoined: [], unaccounted: 0, same: true });
    expect(g.tally.file).toBe(g.tally.pdf.raw);
    expect(g.asks.map((it) => ({ group: it.group, state: it.state, reversible: it.reversible, data: it.data }))).toMatchObject([{ group: 'structure', state: 'applied', reversible: true, data: { kept: 'VIE-04-10', offered: 'VIE04-10', why: 'neither', n: 1 } }]);
    const said = reportSaid(g);
    expect(said).toContain('A line of the PDF ends on the hyphen of “VIE-04-10”, and the word stands nowhere else in it to say whose hyphen that is. Your book keeps it as the page shows it: “VIE-04-10”. The other reading is “VIE04-10”.');
    expect(said).toContain('Join it: “VIE04-10”');
    expect(g.api.irUndoItem(g.asks[0].id)).toMatchObject({ ok: true });
    expect(textOf(g.api)).toContain('confirmation code VIE04-10 into the ledger');
  }, 120_000);

  it('the same code where only the form without that hyphen stands elsewhere ("VIE04-10"): taken off, counted in the row and listed, as for any word', async () => {
    const g = await importPdf(book(CODE, ['The code VIE04-10 was struck out at noon.']));
    expect(g.all).toContain('confirmation code VIE04-10 into the ledger');
    expect({ joins: g.tally.pdf.joins, rejoined: g.tally.pdf.rejoined, unaccounted: g.tally.unaccounted, same: g.tally.chars.same }).toEqual({ joins: { pdfRejoined: 1 }, rejoined: [{ from: ['VIE-', '04-10'], to: 'VIE04-10', n: 1 }], unaccounted: 0, same: true });
    expect(g.tally.file).toBe(g.tally.pdf.raw - 1);
    expect(g.asks).toEqual([]);
  }, 120_000);

  it('a digit before the hyphen and a letter after ("GRZ-02-" + "REF-17", "5-" + "unit"): the same rule, and no space of Beuk\'s', async () => {
    const kept = await importPdf(book(['Lindholm entered it under the index GRZ-02-', 'REF-17 and marked the page.'], ['The index GRZ-02-REF-17 was struck out at noon.']));
    expect(kept.all).toContain('the index GRZ-02-REF-17 and marked');
    expect({ joins: kept.tally.pdf.joins, asks: kept.asks.length, same: kept.tally.chars.same }).toEqual({ joins: {}, asks: 0, same: true });
    const listed = await importPdf(book(['The message was transmitted that night via 5-', 'unit Baudot wire to the annex.'], ['The pans lay white under the sun.']));
    expect(listed.all).toContain('that night via 5-unit Baudot wire');
    expect(listed.all).not.toContain('5- unit');
    expect(listed.tally.pdf.joins).toEqual({});
    expect(listed.asks.map((it) => it.data)).toMatchObject([{ kept: '5-unit', offered: '5unit', why: 'neither', n: 1 }]);
  }, 120_000);

  it('a digit either side ("pages 12-" + "15"): the hyphen is the page\'s and stays, no space is added, and where the PDF does not settle it the range is listed like any other', async () => {
    const g = await importPdf(book(['The entry is in the second ledger, pages 12-', '15 of the bound volume.'], ['The pans lay white under the sun.']));
    expect(g.all).toContain('ledger, pages 12-15 of the bound volume');
    expect(g.all).not.toContain('12- 15');
    expect({ joins: g.tally.pdf.joins, same: g.tally.chars.same }).toEqual({ joins: {}, same: true });
    expect(g.asks.map((it) => it.data)).toMatchObject([{ kept: '12-15', offered: '1215', why: 'neither', n: 1 }]);
    const settled = await importPdf(book(['The entry is in the second ledger, pages 12-', '15 of the bound volume.'], ['See pages 12-15 again.']));
    expect(settled.all).toContain('ledger, pages 12-15 of the bound volume');
    expect({ joins: settled.tally.pdf.joins, asks: settled.asks.length }).toEqual({ joins: {}, asks: 0 });
  }, 120_000);

  it('a dash the page sets apart is not a word\'s hyphen: a line that ends on a spaced hyphen keeps the space the page shows before it and is closed with a space after it, before a letter or a digit, and nothing is listed', async () => {
    const word = await importPdf(book(['The pans lay white under the morning sun -', 'and the wind rose over the salt.'], ['The clerk kept the ledger.']));
    expect(word.all).toContain('morning sun - and the wind rose');
    expect({ joins: word.tally.pdf.joins, asks: word.asks.length }).toEqual({ joins: {}, asks: 0 });
    expect(word.items.some((it) => it.kind === 'pdfHyphens')).toBe(false);
    const digit = await importPdf(book(['The clerk at the gate counted from 12 -', '15 carts in every caravan that week.'], ['The clerk kept the ledger.']));
    expect(digit.all).toContain('counted from 12 - 15 carts');
    expect({ joins: digit.tally.pdf.joins, asks: digit.asks.length }).toEqual({ joins: {}, asks: 0 });
  }, 120_000);

  it('a long dash at a line\'s end is not this rule either: after a letter it closes up to the next line as it did, and nothing is listed', async () => {
    const em = await importPdf(book(['The wind rose over the salt and the pans—', 'and fell again before the noon bell.'], ['The clerk kept the ledger.']));
    expect(em.all).toContain('the pans—and fell again');
    expect({ joins: em.tally.pdf.joins, asks: em.asks.length }).toEqual({ joins: {}, asks: 0 });
    const en = await importPdf(book(['The wind rose over the salt and the pans–', 'and fell again before the noon bell.'], ['The clerk kept the ledger.']));
    expect(en.all).toContain('the pans–and fell again');
    expect({ joins: en.tally.pdf.joins, asks: en.asks.length }).toEqual({ joins: {}, asks: 0 });
  }, 120_000);

  it('a minus sign or a dash that OPENS the next line is no second half of a word: the two lines are closed with a space, as the page parts them', async () => {
    const minus = await importPdf(book(['By dawn the glass at the gate had fallen to', '-5 and the pans were white with frost.'], ['The clerk kept the ledger.']));
    expect(minus.all).toContain('had fallen to -5 and the pans');
    expect({ joins: minus.tally.pdf.joins, asks: minus.asks.length }).toEqual({ joins: {}, asks: 0 });
    const dash = await importPdf(book(['The clerk kept the code and wrote down one-', '- time, he said, and no other - in the ledger.'], ['The pans lay white under the sun.']));
    expect(dash.all).toContain('wrote down one- - time, he said');
    expect({ joins: dash.tally.pdf.joins, asks: dash.asks.length }).toEqual({ joins: {}, asks: 0 });
  }, 120_000);

  /* A long list stays usable. A book set with hyphenation leaves many words for the writer (measured: a 75,000-word
     novel set justified with the browser's own hyphenation left 82 of its 828 line-end hyphens), and the report opens
     on the card, with a group of more than six lines shut: so the card states the number plainly and its button goes
     to the words, and the line that joins them all stands before them, not after the last. */
  const cardSaid = (g: Got) => { g.api.irRenderReport(); return (document.querySelector('.ir-card')!.textContent || '').replace(/\s+/g, ' '); };
  const MANY = ['The clerk kept in one chest the salt-', 'pan ledger and beside it the cart-', 'wheel tally and under them the day-', 'book of the old customs-', 'house and the plans of the rope-',
    'walk and the deeds of the tide-', 'mill and a receipt for lamp-', 'oil and the keys of the gate-', 'house on their iron ring'];

  it('the card states how many words are left for the writer, many or one, and no longer counts a word the writer has joined; a PDF that leaves none says nothing of it', async () => {
    const two = await importPdf(book([...BROKEN, 'The clerk wrote it in the day-', 'book before the lamp went out.'], ['The pans lay white under the sun.']));
    expect(cardSaid(two)).toContain('2 words end a line of the PDF on a hyphen its text does not settle. Your book keeps each as the page shows it, and they are listed for you to look at. See the words');
    expect(two.api.irUndoItem(two.asks[0].id)).toMatchObject({ ok: true });
    expect(cardSaid(two)).toContain('1 word ends a line of the PDF on a hyphen its text does not settle. Your book keeps it as the page shows it, and it is listed for you to look at. See the words');
    expect(two.api.irUndoItem(two.asks[1].id)).toMatchObject({ ok: true });
    expect(cardSaid(two)).not.toContain('a line of the PDF on a hyphen');
    const none = await importPdf(book(['The clerk kept the code and the one-', 'time pad lay beside the ledger.'], ['A one-time code was set that night.']));
    expect(cardSaid(none)).not.toContain('a line of the PDF on a hyphen');
  }, 120_000);

  it('eight words left: "Join all of these" stands before the words it joins and says their number; the card\'s button opens the list at it, the shut group opened; and it joins every one', async () => {
    const g = await importPdf(book(MANY, ['The pans lay white under the sun.']));
    const words = ['salt-pan', 'cart-wheel', 'day-book', 'customs-house', 'rope-walk', 'tide-mill', 'lamp-oil', 'gate-house'];
    expect(g.asks.map((it) => [it.data.kept, it.data.n])).toEqual(words.map((w) => [w, 1]));
    expect(g.items.filter((it) => /^pdfHyphenAsk/.test(it.kind)).map((it) => it.kind), 'the line that joins them all comes first').toEqual(['pdfHyphenAskAll', ...words.map(() => 'pdfHyphenAsk')]);
    const every = g.items.find((it) => it.kind === 'pdfHyphenAskAll')!;
    expect(every.data).toEqual({ n: 8 });
    expect(cardSaid(g)).toContain('8 words end a line of the PDF on a hyphen its text does not settle.');
    g.api.initImportReport();
    g.api.irRenderReport();
    const modal = () => document.querySelector('.ir-modal')!;
    const group = () => document.getElementById('ir-g-structure') as HTMLDetailsElement;
    const row = (id: string) => Array.from(document.querySelectorAll('#irBody [data-irid]')).find((r) => r.getAttribute('data-irid') === id) as HTMLElement;
    expect(modal().classList.contains('ir-card-view'), 'the report opens on the card').toBe(true);
    expect(group().open, 'a group of more than six lines opens shut').toBe(false);
    (document.querySelector('.ir-card [data-irhyph]') as HTMLElement).click();
    expect(modal().classList.contains('ir-card-view'), 'the button goes to the list').toBe(false);
    expect(group().open, 'and opens the group the words are in').toBe(true);
    expect((row(every.id).textContent || '').replace(/\s+/g, ' ')).toContain('Words that end a line of the PDF on a hyphen its text does not settle: 8. Each is listed here, kept as the page shows it.');
    expect(row(every.id).compareDocumentPosition(row(g.asks[0].id)) & 4, 'it stands before the first word (4: the word follows it)').toBe(4);
    (row(every.id).querySelector('[data-irundo]') as HTMLElement).click();
    const all = textOf(g.api);
    for (const w of words) { expect(all).toContain(w.replace('-', '')); expect(all).not.toContain(w); }
    expect(g.asks.map((it) => it.state)).toEqual(words.map(() => 'undone'));
    expect(cardSaid(g)).not.toContain('a line of the PDF on a hyphen');
  }, 120_000);

  /* Found by pressing it in a real browser (2026-11-22): the list is drawn again after every join, and a group of more
     than six lines was drawn shut each time, so the list closed under the writer's hand after one word. */
  it('eight words left: joining one word leaves the list open at the others', async () => {
    const g = await importPdf(book(MANY, ['The pans lay white under the sun.']));
    g.api.initImportReport();
    g.api.irRenderReport();
    const group = () => document.getElementById('ir-g-structure') as HTMLDetailsElement;
    const row = (id: string) => Array.from(document.querySelectorAll('#irBody [data-irid]')).find((r) => r.getAttribute('data-irid') === id) as HTMLElement;
    (document.querySelector('.ir-card [data-irhyph]') as HTMLElement).click();
    expect(group().open, 'the card\'s button opens the group').toBe(true);
    (row(g.asks[0].id).querySelector('[data-irundo]') as HTMLElement).click();
    expect(g.asks.map((it) => it.state)).toEqual(['undone', ...g.asks.slice(1).map(() => 'applied')]);
    expect(group().open, 'the group is still open after one join').toBe(true);
    expect(row(g.asks[1].id).querySelector('[data-irundo]'), 'the next word\'s button is there to press').not.toBeNull();
    // a group the reader has not opened is still drawn shut
    g.api.irRenderReport();
    group().open = false;
    (row(g.asks[1].id).querySelector('[data-irundo]') as HTMLElement).click();
    expect(group().open, 'a group the reader shut stays shut').toBe(false);
    // the 2.0 studio writes the book and reads it back after every press: the report comes back a new object, and it is
    // still the same report (the first statement of this fix compared the objects, and held here but not in the studio)
    group().open = true;
    type Doc = { importReport: { items: Item[] } };
    g.api.applyBookDoc(JSON.parse(JSON.stringify(g.api.serializeBook())));
    (row(g.asks[2].id).querySelector('[data-irundo]') as HTMLElement).click();
    expect((g.api.serializeBook() as Doc).importReport.items.find((it) => it.id === g.asks[2].id), 'the third word is joined in the book as read back').toMatchObject({ state: 'undone' });
    expect(group().open, 'the group is still open when the report came back a new object').toBe(true);
  }, 120_000);
});
