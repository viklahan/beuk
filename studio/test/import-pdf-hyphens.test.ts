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
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irTallyHtmlOf', 'irUndoItem', 'serializeBook'], supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-pdf-hyphens', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_PDF_HYPHENS', fn: 'createImportPdfHyphens', title: "1.0's PDF import, a hyphen at a line's end (tests only)" });
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
});
