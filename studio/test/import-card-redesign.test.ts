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

/* The import card and "The full account", as the owner approved them on 2026-11-22 (BEUK:importcard).
   The card answers "is my whole book here?" first: the verdict panel (the file's characters = the book's + what was
   set aside, a row per kind, and what is unaccounted for), then the book Beuk found, then the looks a Beuk book does
   not carry. The full account is the same report part by part, and no item of it is left out.
   1.0's own code (the text 2.0 lifts), run on files made here. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const VENDOR = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
type Api = Record<string, (...a: unknown[]) => unknown>;
let make: (env: Rec) => { api: Api };
const noop = () => undefined;
let toasts: string[] = [];
function env(): Rec {
  const e: Rec = { state: {}, toast: (msg: string) => { toasts.push(String(msg)); }, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString().slice(0, 10), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis,
    mammoth: (globalThis as Rec).mammoth, pdfLoadLib: async () => (globalThis as Rec).pdfjsLib };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf', 'selectSection']) if (!(n in e)) e[n] = noop;
  return e;
}
type PdfLib = { PDFDocument: { create: () => Promise<{ addPage: (s: [number, number]) => { drawText: (s: string, o: Rec) => void }; embedFont: (f: string) => Promise<unknown>; save: () => Promise<Uint8Array> }> }; StandardFonts: Record<string, string> };
let pdfLib: PdfLib;

type Item = { id: string; kind: string; group: string; state: string; reversible?: boolean; before?: string; after?: string; where?: { secId: string | null; label: string }; why?: string; data: Rec };
type Row = { key: string; file: number; book: number; why: { k: string; n: number; side: number; row?: string }[] };
type Tally = { v: number; counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; rows: Row[]; chars: { same: boolean } };
type Rep = { file: string; at: string; tally: Tally; items: Item[] };
type Doc = { sections: { id: string; type: string; kind: string; title: string; content: string }[]; importReport: Rep };
let api: Api;
/** A fresh desk with the import's markup on the page (the report, as the studio hosts it), 1.0's listeners wired. */
function fresh(withReport = true): Api {
  document.body.innerHTML = markup.summary + markup.reopen + (withReport ? markup.report : '') + markup.fileInput;
  toasts = [];
  api = make(env()).api;
  api.applyBookDoc(api.buildEmptyBook());
  if (withReport) api.initImportReport();
  return api;
}
/** `texts`: what the file answers each time its text is read, in order (the last one again after that) */
async function importFile(name: string, bytes: Uint8Array | null, ...texts: string[]): Promise<Rep> {
  let read = 0;
  const text = () => texts[Math.min(read++, texts.length - 1)] || '';
  const buf = () => { const b = bytes || new TextEncoder().encode(text()); const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); return ab; };
  return ((await api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text() })) as () => Rep)();
}
const doc = () => JSON.parse(JSON.stringify(api.serializeBook())) as Doc;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement | null;
const qa = (sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];
const txt = (el: Element | null) => (el ? el.textContent || '' : '').replace(/\s+/g, ' ').trim();
const card = () => q('#irBody .ir-card')!;
const account = () => q('#irBody .ir-list')!;
const boxClass = () => q('#modalImportReport .ir-modal')!.classList;
const num = (n: number) => n.toLocaleString('en-US');
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, n) => a + n, 0);
/** the rows under the verdict's rule: each count with its sentence */
const verdictRows = () => { const cells = qa('.ir-vrows > span', card()).map(txt); const out: string[][] = []; for (let i = 0; i < cells.length; i += 2) out.push([cells[i], cells[i + 1]]); return out; };
const figures = () => ['file', 'book', 'aside'].map((k) => [txt(q('.ir-fig.' + k + ' b', card())), txt(q('.ir-fig.' + k + ' span', card()))]);

const LAST = 'The pans lay white.';
const BREAKS = 'Chapter 1\n\nBefore the break.\n\n---\n\nAfter the break.\n\nChapter 2\n\n' + LAST + '\n';
const LINE = '"Go," she said. It ran on.';
const TXT = 'Chapter 1\n\n' + LINE + '\n\nChapter 2\n\n' + LAST + '\n';

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
  const out = await buildTestModule(HTML, epubClosure, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'serializeBook', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irRenderReport', 'irOpenReport', 'initImportReport', 'irUndoItem', 'irTallyHtmlOf'],
    supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf', 'selectSection'])], what: 'import-card-redesign', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_CARD_REDESIGN', fn: 'createImportCard', title: "1.0's import card and full account (tests only)" });
  const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportCard(env);';
  make = (e: Rec) => new Function('env', code)(e) as { api: Api };
}, 180_000);

describe('the card: the verdict panel first', () => {
  it('everything accounted for: the title and the file, the verdict sentence, the three figures joined by = and +, a row per kind set aside, and "Unaccounted for" 0; no checklist, kicker, lede or stat tile', async () => {
    fresh();
    const rep = await importFile('breaks.txt', null, BREAKS);
    const ty = rep.tally;
    expect({ counted: ty.counted, unaccounted: ty.unaccounted, same: ty.chars.same, aside: ty.aside }).toEqual({ counted: true, unaccounted: 0, same: true, aside: { sceneBreaks: 3, headingMarks: 14 } });
    expect($('modalImportReport').classList.contains('open'), 'the report opens').toBe(true);
    expect(boxClass().contains('ir-card-view'), 'on the card').toBe(true);
    expect(boxClass().contains('ir-differs')).toBe(false);
    expect(txt($('irH'))).toBe('Your book is in.');
    expect(txt($('irFile'))).toBe('breaks.txt');
    expect(txt($('irSub')) + txt(card()), 'no "Beuk read N words" sentence').not.toContain('Beuk read');
    expect($('irSub').classList.contains('ir-intro'), 'the account\'s opening lines are kept off the card by the stylesheet (.ir-card-view .ir-intro)').toBe(true);
    const panel = q('.ir-verdict', card())!;
    expect(card().firstElementChild, 'the verdict panel is the first thing on the card').toBe(panel);
    expect(panel.classList.contains('clear')).toBe(true);
    expect(q('.ir-vhead svg.ir-mark.ok', panel), 'a tick').not.toBeNull();
    expect(txt(q('.ir-vhead p', panel))).toBe('Every character of your file is in your book.');
    expect(figures()).toEqual([[num(ty.file), 'characters in your file'], [num(ty.book), 'in your book'], [num(17), 'set aside, each one named']]);
    expect(qa('.ir-figs .ir-sign', panel).map(txt)).toEqual(['', '=', '+']);
    expect(ty.file, 'the arithmetic is true').toBe(ty.book + 17);
    // one row per kind set aside, in the tally's own order, then what is unaccounted for
    expect(verdictRows()).toEqual([...Object.keys(ty.aside).map((k) => [num(ty.aside[k]), t('ir.tally.b.' + k)]), ['0', 'Unaccounted for']]);
    for (const gone of ['.ir-kicker', '.ir-stats', '.ir-stat', '.ir-did', '.ir-didline']) expect(q(gone, card()), gone + ' is gone').toBeNull();
    expect(txt(card())).not.toContain('What Beuk did');
    expect($('btnIrClose').textContent).toBe('Open my book');
    expect($('btnIrEvery').textContent).toBe('See the full account');
    expect($('btnIrUndoAll').textContent).toBe('Undo this import');
  }, 120_000);

  it('the book Beuk found: one heading that carries the counts, the zones, the first four chapters and "Show all N chapters"; a page is pressed to open it', async () => {
    fresh();
    const chapters = [1, 2, 3, 4, 5, 6].map((n) => '# Chapter ' + n + ': Day ' + n + '\n\nWords of day ' + n + '.' + (n < 3 ? '\n\n## Morning\n\nFog.\n\n## Noon\n\nSun.' : '')).join('\n\n');
    await importFile('six.md', null, chapters + '\n\n# Acknowledgments\n\nThanks to the harbour.\n');
    const found = q('.ir-found', card())!;
    expect(txt(q('.ir-fhead h3', found))).toBe('The book Beuk found: 6 chapters, 4 sections inside them, 1 other page');
    expect(txt(q('.ir-fhead p', found))).toBe('Filed wrong? Press a page to change it.');
    expect(qa('.ir-zone', found).map(txt)).toEqual(['The chapters', 'After the story']);
    const rows = () => qa('.ir-row', found).map((r) => [txt(q('.ir-rn', r)), txt(q('.ir-rt', r)), txt(q('.ir-rs', r))]);
    expect(rows()).toEqual([['1', 'Day 1', '2 sections'], ['2', 'Day 2', '2 sections'], ['3', 'Day 3', ''], ['4', 'Day 4', '']]);
    expect(txt(q('.ir-more', found))).toBe('Show all 6 chapters');
    q('.ir-more', found)!.click();
    expect(qa('.ir-row', card()).length).toBe(6);
    expect(txt(q('.ir-more', card()))).toBe('Show fewer');
    expect(qa('.ir-page', card()).map(txt)).toEqual(['Acknowledgments']);
    expect(q('.ir-page', card())!.tagName).toBe('BUTTON');
    q('.ir-page', card())!.click();
    expect($('modalImportReport').classList.contains('open'), 'a page pressed opens it: the report closes').toBe(false);
  }, 120_000);

  it('a character changed on the way in: the title says how many to check, the panel is the differs panel with an information mark, the differing characters stand side by side with their counts and words, and the primary action opens the book as it is', async () => {
    fresh();
    // the file is counted as the writer wrote it; the reading that reaches the book has its two straight double quotes made curly
    const rep = await importFile('as-given.txt', null, TXT, TXT.replace('"Go,"', '“Go,”'));
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same }).toEqual({ unaccounted: 0, same: false });
    expect(txt($('irH'))).toBe('Your book is in, with 2 characters to check.');
    expect(boxClass().contains('ir-differs')).toBe(true);
    const panel = q('.ir-verdict', card())!;
    expect(panel.classList.contains('differs')).toBe(true);
    expect(q('.ir-vhead svg.ir-mark.info', panel), 'an information mark').not.toBeNull();
    expect(q('.ir-vhead svg.ir-mark.ok', panel), 'no tick').toBeNull();
    expect(txt(q('.ir-vhead p', panel))).toBe('2 characters of your file are not in your book as written.');
    expect(txt(panel)).not.toContain('Every character of your file is in your book.');
    const grid = q('.ir-diffgrid', panel)!;
    expect(qa('.ir-dh', grid).map(txt)).toEqual(['In your file, not in your book', 'In your book, not in your file', 'Times']);
    const cells = Array.from(grid.children).slice(3).map(txt);
    expect(cells).toEqual(['“"” U+0022in “"Go,"”', '', '2', '', '““” U+201Cin ““Go,””', '1', '', '“”” U+201Din ““Go,””', '1']);
    // never red for a difference: no class of the old warning lines, and the panel's own rule is gold (the stylesheet: tests/import-card.test.ts)
    expect(qa('[class*="warn"], [class*="bad"]', card())).toEqual([]);
    expect($('btnIrClose').textContent).toBe('Open my book as it is');
    expect(q('.ir-vact [data-irpart="count"]', panel), 'a link to the list in the full account').not.toBeNull();
  }, 120_000);

  it('a count that differs with no named reason puts the panel in the differs state: a file with no headings, whose book has one', async () => {
    fresh();
    const rep = await importFile('no-headings.txt', null, 'The caravan left at dawn.\n\nThe pans lay white under the sun.\n');
    const un = rep.tally.rows.filter((r) => r.file !== r.book && r.why.some((y) => y.k === 'none'));
    expect(un.map((r) => [r.key, r.file, r.book, r.why]), 'the tally itself: one heading in the book that the file does not have, not explained').toEqual([['headings', 0, 1, [{ k: 'none', n: 1, side: -1 }]]]);
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same }).toEqual({ unaccounted: 0, same: true });
    expect(txt($('irH'))).toBe('Your book is in, with 1 count to check.');
    const panel = q('.ir-verdict', card())!;
    expect(panel.classList.contains('differs')).toBe(true);
    expect(txt(q('.ir-vhead p', panel))).toBe('Headings: 0 in your file, 1 in your book (1 in the book not explained).');
    // the characters themselves all agree, and the panel still says so
    expect(qa('.ir-vsay', panel).map(txt)).toContain('Every character of your file is in your book.');
    // the full account: the row stands in the table of counts that differ, with its reason
    q('.ir-vact [data-irpart="count"]', panel)!.click();
    expect(boxClass().contains('ir-card-view')).toBe(false);
    const row = qa('#ir-g-count .ir-ctable .ir-trow', account()).find((r) => txt(q('.ir-tname', r)) === 'Headings')!;
    expect(qa('span.num', row).map(txt)).toEqual(['0', '1']);
    expect(txt(q('.ir-twhy', row))).toBe('1 in the book not explained');
  }, 120_000);
});

const MD = '# Chapter 1\n\nThe plate is below.[^1]\n\n![A copper plate](images/plate-01.png)\n\n[^1]: A note the text marks.\n\n[^9]: A note nothing marks.\n\n# Chapter 2\n\n' + LAST + '\n';

describe('what the old screen filed under "Dropped or not supported" is named for what it is', () => {
  it('a Markdown file that names a picture it does not hold, and a note nothing marks: each said in its own words on the card and under "For you to look at", gold, and never as content left out', async () => {
    fresh();
    const rep = await importFile('plates.md', null, MD);
    expect(rep.items.filter((it) => it.kind === 'mdImage').map((it) => it.data.n)).toEqual([1]);
    const orphans = rep.items.filter((it) => it.kind === 'noteOrphan');
    expect(orphans.length).toBe(1);
    expect(txt($('irH'))).toBe('Your book is in, with 2 things to check.');
    const panel = q('.ir-verdict', card())!;
    expect(panel.classList.contains('differs')).toBe(true);
    const said = [txt(q('.ir-vhead p', panel)), ...qa('.ir-vsay', panel).map(txt)];
    expect(said).toContain('Your file names 1 picture it does not contain.');
    expect(said).toContain('Your book keeps each pointer and its description, and has no picture to show. Add the pictures from the image library, or import the folder as a zip.');
    expect(said).toContain('1 note in your file has no mark in the text.');
    expect(said).toContain('A note that nothing in the text marks cannot be linked to a place. Its text is kept in your book as a paragraph, where it stood.');
    // the book does hold them: the pointer with its description, and the note's text
    const all = doc().sections.map((s) => s.content).join('\n');
    expect(all).toContain('![A copper plate](images/plate-01.png)');
    expect(all).toContain('A note nothing marks.');
    q('.ir-vact [data-irpart="look"]', panel)!.click();
    const look = q('#ir-g-look', account())!;
    expect(txt(q('.ir-ph', look))).toBe('For you to look at');
    const heads = qa('.ir-askhead', look).map(txt);
    expect(heads[0]).toBe('Your file names 1 picture it does not contain. Your book keeps each pointer and its description, and has no picture to show. Add the pictures from the image library, or import the folder as a zip.');
    expect(heads[1]).toBe('1 note in your file has no mark in the text. A note that nothing in the text marks cannot be linked to a place. Its text is kept in your book as a paragraph, where it stood.');
    // the note is named by the writer's own label, with its text
    const note = qa('.ir-item', look).find((r) => r.getAttribute('data-irid') === orphans[0].id)!;
    expect(txt(q('.ir-notelabel', note))).toBe(String(orphans[0].data.n));
    expect(txt(q('.ir-set', note))).toBe('A note nothing marks.');
    expect(txt(look)).not.toMatch(/left out|not brought in|dropped|not imported|not supported|was lost/i);
    expect(qa('.ir-askhead svg.ir-mark.info', look).length, 'gold information marks').toBe(2);
    expect(qa('[class*="warn"], [class*="bad"]', look)).toEqual([]);
  }, 120_000);
});

/** Items of every part, written into a real import's report as an import would write them (the kinds a text file cannot make here). */
function withItems(extra: Partial<Item>[]): Rep {
  const d = doc();
  extra.forEach((x, i) => d.importReport.items.push(Object.assign({ id: 'x' + i, state: 'applied', where: { secId: null, label: '' }, before: '', after: '', reversible: false, why: 'source', data: {} }, x) as Item));
  api.applyBookDoc(d as never);
  api.irOpenReport();
  return doc().importReport;
}

describe('the full account: the same report, part by part', () => {
  it('"Looks" holds only formatting; an item of a kind or a group it does not know stands in a default part; every item of the report is one row of the account, none twice, none missing', async () => {
    fresh();
    await importFile('breaks.txt', null, BREAKS);
    const ch1 = doc().sections.find((s) => s.type === 'chapter')!;
    const rep = withItems([
      { kind: 'underline', group: 'dropped', data: { n: 3 } }, { kind: 'strike', group: 'dropped', data: { n: 2 } }, { kind: 'mono', group: 'dropped', data: { n: 40 } }, { kind: 'headers', group: 'dropped', data: { n: 1 } },
      { kind: 'comments', group: 'dropped', data: { n: 2 } }, { kind: 'links', group: 'dropped', data: { n: 5 } }, { kind: 'imageDropped', group: 'dropped', data: { type: 'image/tiff' } },
      { kind: 'zzNewKind', group: 'zzNewGroup', data: { n: 1 } }, { kind: 'zzStructure', group: 'structure', data: {} }, { kind: 'zzNote', group: 'notes', data: {} }, { kind: 'zzBook', group: 'book', data: {} },
      { kind: 'matter', group: 'matter', reversible: true, why: '', where: { secId: ch1.id, label: 'Chapter 1' }, after: 'A line of verse.', data: { type: 'epigraph', via: 'chapter-head', chapterId: ch1.id, chapterLabel: 'Chapter 1', content: 'A line of verse.', mode: 'created' } },
    ]);
    // the card: the looks in one sentence with their counts, most first, and nothing but looks
    const looks = q('.ir-looks', card())!;
    expect(txt(q('h3', looks))).toBe('4 looks from your file that a Beuk book does not carry');
    expect(txt(q('p', looks))).toBe('Your words are all kept; these ways of setting them are not: passages in a typewriter font (40), underlined passages (3), struck-through passages (2), and page headers or footers with text (1). See each one');
    q('[data-irpart="looks"]', looks)!.click();
    expect(boxClass().contains('ir-card-view')).toBe(false);
    const kindOf = (r: Element) => rep.items.find((it) => it.id === r.getAttribute('data-irid'))!.kind;
    const inPart = (id: string) => qa('#ir-g-' + id + ' [data-irid]', account()).map(kindOf);
    expect(inPart('looks')).toEqual(['mono', 'underline', 'strike', 'headers']);
    expect(qa('#ir-g-looks .ir-lrow', account()).map((r) => [txt(q('.ir-vn', r)), txt(q('.ir-lname', r)), txt(q('.ir-lis', r))])[0]).toEqual(['40', 'passages in a typewriter font', 'Set in your book\'s own text face.']);
    expect(txt(q('#ir-g-looks', account()))).not.toContain('Can\'t be undone on its own');
    // a kind and a group the account does not know: "Set aside"; a kind it does not know in a group it does: that group's part
    expect(inPart('aside')).toEqual(expect.arrayContaining(['comments', 'links', 'zzNewKind']));
    expect(inPart('filed')).toEqual(expect.arrayContaining(['zzStructure', 'matter']));
    expect(inPart('notes')).toEqual(expect.arrayContaining(['imageDropped', 'zzNote']));
    expect(inPart('book')).toEqual(expect.arrayContaining(['zzBook']));
    // items in, rows out
    const rows = qa('[data-irid]', account()).map((r) => r.getAttribute('data-irid'));
    expect(rows.length, 'no item twice').toBe(new Set(rows).size);
    expect([...rows].sort()).toEqual(rep.items.map((it) => it.id).sort());
    // an epigraph found at a chapter's head stands under "Where Beuk filed your pages", with "Change" and the button that puts it back
    const epi = qa('#ir-g-filed [data-irid]', account()).find((r) => kindOf(r) === 'matter')!;
    expect(txt(q('.ir-fas small', epi))).toBe('Lifted from the opening of Chapter 1.');
    expect(q('[data-irsec]', epi)!.textContent).toBe('Change');
    expect(q('[data-irundo]', epi)!.textContent).toBe('Undo this');
    // where an item cannot be undone, nothing is said of it
    expect(txt(account())).not.toContain('Can\'t be undone on its own');
  }, 120_000);

  it('its title, its opening lines, the links to its parts, the parts in their order, and no empty part', async () => {
    fresh();
    await importFile('breaks.txt', null, BREAKS);
    $('btnIrEvery').click();
    expect(boxClass().contains('ir-card-view')).toBe(false);
    expect(txt($('irH'))).toBe('The full account');
    expect(txt($('irFile'))).toMatch(/^breaks\.txt, imported \d{4}-\d{2}-\d{2}$/);
    expect(txt($('irSub'))).toBe('Your file beside your book, count by count. Beuk changed none of your characters: no quote, dash or ellipsis was changed. Auto-Format in the editor tidies them when you want it. What follows is what it set aside, what a Beuk book cannot show, and where it filed each page.');
    const order = ['count', 'look', 'aside', 'looks', 'typography', 'filed', 'notes', 'book'];
    const ids = () => qa('.ir-part', account()).map((p) => p.id.replace('ir-g-', ''));
    expect(ids(), 'only the parts this import has something in, in order').toEqual(['count', 'aside', 'filed']);
    expect(qa('.ir-chip', account()).map((a) => a.getAttribute('href'))).toEqual(ids().map((p) => '#ir-g-' + p));
    for (const p of qa('.ir-part', account())) expect(p.children.length, p.id + ' has something under its heading').toBeGreaterThan(1);
    expect(qa('.ir-chip', account()).map(txt)).toEqual(['The count', 'Set aside 17 characters', 'Where pages were filed']);
    expect(qa('.ir-ph', account()).map(txt)).toEqual(['The count', 'Set aside: 17 characters', 'Where Beuk filed your pages']);
    // every part, when each has something
    withItems([{ kind: 'mdImage', group: 'dropped', data: { n: 2 } }, { kind: 'underline', group: 'dropped', data: { n: 3 } }, { kind: 'typography', group: 'typography', data: { q: 1, d: 0, e: 0 } }, { kind: 'notes', group: 'notes', data: { found: 1, mapped: 1, orphans: 0 } }, { kind: 'zzBook', group: 'book', data: {} }]);
    $('btnIrEvery').click();
    expect(ids()).toEqual(order);
    // a report whose import did tidy typography does not say it changed none of the characters
    expect(txt($('irSub'))).toBe('Your file beside your book, count by count. What follows is what it set aside, what a Beuk book cannot show, and where it filed each page.');
    // back to the summary, and the old controls: Dismiss as a quiet text button, Keep all as the account's "Open my book"
    $('btnIrBack').click();
    expect(boxClass().contains('ir-card-view')).toBe(true);
    expect($('btnIrDismiss').textContent).toBe('Dismiss report');
    $('btnIrEvery').click();
    $('btnIrKeep').click();
    expect($('modalImportReport').classList.contains('open')).toBe(false);
    expect((doc().importReport as unknown as { kept: boolean }).kept).toBe(true);
  }, 120_000);

  it('the count: only the counts that differ in the table (file, book, why), the same counts listed with their figures, and the whole tally still there behind them', async () => {
    fresh();
    const rep = await importFile('breaks.txt', null, BREAKS);
    const ty = rep.tally;
    $('btnIrEvery').click();
    const count = q('#ir-g-count', account())!;
    const table = qa('.ir-ctable .ir-trow', count);
    expect(qa('span', table[0]).map(txt)).toEqual(['Where the two differ', 'In the file', 'In the book', 'Why']);
    const body = table.slice(1).map((r) => [txt(q('.ir-tname', r)), ...qa('span.num', r).map(txt)]);
    const differ = ty.rows.filter((r) => r.file !== r.book);
    expect(body).toEqual([['Characters', num(ty.file), num(ty.book)], ...differ.map((r) => [t('ir.tally.r.' + r.key), num(r.file), num(r.book)])]);
    expect(txt(q('.ir-twhy', table[1]))).toBe('17 are set aside, each named under Set aside.None is unaccounted for.');
    const same = ty.rows.filter((r) => r.file === r.book);
    expect(txt(q('.ir-samehead', count))).toBe(same.length + ' counts are the same in your file and your book');
    expect(qa('.ir-samegrid > div', count).map((d) => qa('span', d).map(txt))).toEqual(same.map((r) => [t('ir.tally.r.' + r.key), num(r.book)]));
    // nothing the old tally showed is gone: it stands whole, behind the counts
    const whole = q('details#ir-g-tally', count)!;
    expect(whole.hasAttribute('open'), 'shut until the reader opens it').toBe(false);
    for (const want of [t('ir.tally.b.sceneBreaks') + '3', t('ir.tally.b.headingMarks') + '14', t('ir.tally.unaccounted') + '0', t('ir.tally.wf.same'), t('ir.tally.wf.ignored')]) expect(txt(whole), want).toContain(want);
  }, 120_000);
});

describe('a PDF\'s words left for the writer: a calm line, never a difference', () => {
  async function hyphenPdf(): Promise<Rep> {
    const d = await pdfLib.PDFDocument.create();
    const font = await d.embedFont(pdfLib.StandardFonts.Helvetica);
    const pages: [string, string[]][] = [['Chapter 1', ['The caravan left at dawn and the trans-', 'port reached the pans by noon.']], ['Chapter 2', [LAST]]];
    for (const [h, lines] of pages) {
      const pg = d.addPage([420, 595]);
      pg.drawText(h, { x: 60, y: 480, size: 20, font });
      lines.forEach((s, i) => pg.drawText(s, { x: 60, y: 430 - i * 16, size: 11, font }));
    }
    return importFile('hyphen.pdf', await d.save());
  }
  it('the card stays all clear, with one calm row and "See the words"; the words and "Join it" stand under "For you to look at"; a hyphen the writer joins is named in a row and taken off the book\'s figure, so the arithmetic stays true', async () => {
    fresh();
    const rep = await hyphenPdf();
    const ty = rep.tally;
    const ask = rep.items.find((it) => it.kind === 'pdfHyphenAsk')!;
    expect(ask.data).toMatchObject({ kept: 'trans-port', offered: 'transport' });
    expect({ unaccounted: ty.unaccounted, same: ty.chars.same }).toEqual({ unaccounted: 0, same: true });
    expect(txt($('irH')), 'the title does not change: nothing differs').toBe('Your book is in.');
    const panel = () => q('.ir-verdict', card())!;
    expect(panel().classList.contains('clear')).toBe(true);
    expect(boxClass().contains('ir-differs')).toBe(false);
    const calm = qa('.ir-vcalm', panel());
    expect(calm.map(txt)).toEqual(['1 word ends a line of the PDF on a hyphen its text does not settle. Your book keeps it as the page shows it, and it is listed for you to look at. See the words']);
    expect(q('svg.ir-mark.info', calm[0]), 'a gold information mark').not.toBeNull();
    expect(panel().lastElementChild, 'at the foot of the panel').toBe(calm[0]);
    const aside = sum(ty.aside);
    expect(figures().map((f) => f[0])).toEqual([num(ty.file), num(ty.book), num(aside)]);
    // to the words
    q('[data-irhyph]', calm[0])!.click();
    expect(boxClass().contains('ir-card-view')).toBe(false);
    const row = () => qa('#ir-g-look [data-irid]', account()).find((r) => r.getAttribute('data-irid') === ask.id)!;
    expect(row(), 'the word stands under "For you to look at"').toBeTruthy();
    expect(txt(q('#ir-g-look .ir-ph', account()))).toBe('For you to look at');
    expect(q('[data-irundo]', row())!.textContent).toBe('Join it: “transport”');
    q('[data-irundo]', row())!.click();
    expect(doc().sections.map((s) => s.content).join('\n')).toContain('the transport reached');
    expect(txt(q('.ir-done', row()))).toBe('Joined: “transport”');
    // the card again: the hyphen joined is one character less in the book, named among what is set aside
    $('btnIrBack').click();
    expect(figures().map((f) => f[0])).toEqual([num(ty.file), num(ty.book - 1), num(aside + 1)]);
    expect(ty.file, 'file = book + set aside, still').toBe(ty.book - 1 + aside + 1);
    expect(verdictRows()).toContainEqual(['1', 'Hyphens you joined since the import']);
    expect(verdictRows().filter((r) => r[1] !== 'Unaccounted for' && !/PDF|pdf\.js/.test(r[1])).reduce((a, r) => a + Number(r[0].replace(/,/g, '')), 0), 'the named rows add up to the figure').toBe(aside + 1);
    expect(qa('.ir-vcalm', panel()), 'no word is left: the calm line is not written').toEqual([]);
    expect(txt($('irH'))).toBe('Your book is in.');
  }, 120_000);
});

describe('the "Imported" toast does not sit over the open card', () => {
  it('with the card open the toast is not raised; where no card can open, it is raised as before', async () => {
    fresh();
    await importFile('breaks.txt', null, BREAKS);
    expect($('modalImportReport').classList.contains('open')).toBe(true);
    expect(toasts.filter((m) => m.indexOf(t('import.imported', { name: 'breaks.txt' })) === 0), 'no "Imported" toast over the card').toEqual([]);
    fresh(false);
    await importFile('breaks.txt', null, BREAKS);
    expect(toasts.filter((m) => m.indexOf(t('import.imported', { name: 'breaks.txt' })) === 0).length, 'the page has no report to open: the toast says it').toBe(1);
  }, 120_000);
});
