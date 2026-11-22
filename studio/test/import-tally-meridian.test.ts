// @vitest-environment node
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { MERIDIAN_INVENTORY, type Inventory } from './import-tally-meridian.inventory';

/* The import tally (BEUK:importtally) on a real book: the Meridian Ledger stress book, one manuscript in seven formats
   and two PDFs, each read by 1.0's own readImportFile (the text 2.0 lifts) and tallied in CHARACTERS (V, 2026-11-22:
   "We tally the characters and images and everything and then make sure that its the same").

   The comparison forgives nothing, so this test does not say "every character is accounted for" where it is not. It
   holds two things for each file:
     - the arithmetic, which must always be exact: the file's characters are the book's, plus each named row set
       aside, plus what is unaccounted; and the characters that differ, file side less book side, sum to exactly
       that unaccounted figure;
     - the INVENTORY (import-tally-meridian.inventory.ts): the exact figures and every character that still differs,
       with its count on each side, as measured on 2026-11-22. That list is everything the import still changes in
       this book. It is pinned so that it cannot move unseen: an import change that removes a difference, or adds
       one, fails here until the inventory is updated on purpose. A pinned difference is a known change of the
       writer's characters awaiting the owner's ruling, never a pass mark for it.

   The book is the owner's untracked folder (tools/Testbooks, never committed), so it stands in his checkout only:
   BEUK_TESTBOOKS names the folder, else the default below is tried; the two PDFs of it stand where
   BEUK_MERIDIAN_PDFS names. Where a file is not there its test is skipped and says so — never painted green without
   having run. BEUK_TALLY_OUT names a folder to write each file's full measurement into (the words each differing
   character stands in among it: the owner's text, so it is written only where asked, never committed). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const VENDOR = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
const DIR = process.env.BEUK_TESTBOOKS || path.join(import.meta.dirname, '..', '..', 'tools', 'Testbooks', 'The_Meridian_Ledger_TestSuite');
const PDFS = process.env.BEUK_MERIDIAN_PDFS || '';
const OUT = process.env.BEUK_TALLY_OUT || '';
const FILES: [string, string, string][] = [
  ['docx', DIR, 'The_Meridian_Ledger.docx'], ['rtf', DIR, 'The_Meridian_Ledger.rtf'], ['odt', DIR, 'The_Meridian_Ledger.odt'], ['html', DIR, 'The_Meridian_Ledger.html'],
  ['md', DIR, 'The_Meridian_Ledger.md'], ['txt', DIR, 'The_Meridian_Ledger.txt'], ['epub', DIR, 'The_Meridian_Ledger_Reference.epub'],
  ['pdf-plain', PDFS, 'meridian-plain.pdf'], ['pdf-heads', PDFS, 'meridian-heads.pdf'],
];
const here = (dir: string, name: string) => !!dir && existsSync(path.join(dir, name));
const present = FILES.some(([, dir, name]) => here(dir, name));

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
type Diff = [string, number, string[]][];
type Tally = { v: number; counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number; marks: number;
  chars: { same: boolean; fileOnlyN: number; bookOnlyN: number };
  pdf?: { raw: number; joins: Record<string, number>; rejoined: { from: string[]; to: string; n: number }[]; pieced: unknown[] } };
type Last = { diff: { fileOnly: Diff; bookOnly: Diff } | null; steps: { bucket: string; before: string; after: string; n: number; pure: boolean }[] };
const name = (c: string) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');

describe.skipIf(!present)('the import tally of the Meridian stress book, in characters: the arithmetic is exact and every remaining difference is the pinned inventory' + (present ? '' : ' — SKIPPED: the book is not in this checkout (tools/Testbooks is the owner\'s untracked folder; set BEUK_TESTBOOKS to run it)'), () => {
  beforeAll(async () => {
    loadMammoth();
    const g = globalThis as Rec;
    /* pdf.js loads in a Node environment (as lockcopy-pdf.test.ts loads it); the import's page is a jsdom window set up here */
    const jsdomModule = 'jsdom'; /* a computed specifier: jsdom ships no types, and the test needs none */
    const { JSDOM } = (await import(/* @vite-ignore */ jsdomModule)) as unknown as { JSDOM: new (h: string, o?: Rec) => { window: Rec & { document: Document } } };
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
    for (const k of Object.getOwnPropertyNames(dom.window)) if (!(k in g)) { try { g[k] = dom.window[k]; } catch (e) { /* read-only */ } }
    g.document = dom.window.document;
    g.pdfjsWorker = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')).href);
    g.pdfjsLib = await import(/* @vite-ignore */ pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href);
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited', 'pdfLoadLib'].includes(n));
    const roots = ['applyBookDoc', 'buildEmptyBook', 'readImportFile', 'pdfExtract', 'importPdfExtracted', 'irTallyPdf', 'irTallyWrite', 'irTallyLast'];
    const out = await buildTestModule(HTML, epub, { roots, supplied: [...new Set([...stubs, 'pdfLoadLib', 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-tally', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_TALLY', fn: 'createImportTally', title: "1.0's import with its tally (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportTally(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  for (const [kind, dir, file] of FILES) {
    const there = here(dir, file);
    it.skipIf(!there)(kind + ': the file\'s characters are the book\'s plus each named row plus what is unaccounted, and what differs is the inventory' + (there ? '' : ' — SKIPPED: ' + file + ' is not here (' + (kind.startsWith('pdf') ? 'set BEUK_MERIDIAN_PDFS to the folder that holds the two PDFs' : 'set BEUK_TESTBOOKS') + ')'), async () => {
      document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
      const m = make(env());
      m.api.applyBookDoc(m.api.buildEmptyBook());
      const bytes = readFileSync(path.join(dir, file));
      // a buffer of this page's own kind (the test page's ArrayBuffer is the one JSZip knows; Node's Buffer is another realm's)
      const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
      const run = (await m.api.readImportFile({ name: file, arrayBuffer: async () => buf(), text: async () => new TextDecoder('utf-8').decode(bytes) })) as () => { tally?: Tally };
      const ty = run().tally!;
      expect(ty, 'the import wrote no tally').toBeTruthy();
      const last = m.api.irTallyLast() as Last;
      const diff = last.diff!;
      const aside = Object.values(ty.aside).reduce((a, n) => a + n, 0);
      const side = (l: Diff) => l.map(([c, n]) => [name(c), n] as [string, number]);
      const got: Inventory = { file: ty.file, book: ty.book, aside: ty.aside, unaccounted: ty.unaccounted, fileOnly: side(diff.fileOnly), bookOnly: side(diff.bookOnly),
        ...(ty.pdf ? { pdf: { raw: ty.pdf.raw, joins: ty.pdf.joins, rejoined: ty.pdf.rejoined.reduce((a, e) => a + e.n, 0) } } : {}) };
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        const changed = last.steps.filter((s) => !s.pure).map((s) => ({ row: s.bucket, before: s.before, after: s.after }));
        writeFileSync(path.join(OUT, kind + '.json'), JSON.stringify({ ...got, marks: ty.marks, fileOnlyWords: diff.fileOnly.map(([c, n, w]) => [name(c), c, n, w]), bookOnlyWords: diff.bookOnly.map(([c, n, w]) => [name(c), c, n, w]),
          rejoined: ty.pdf ? ty.pdf.rejoined : undefined, piecedJoins: ty.pdf ? ty.pdf.pieced.length : undefined, stepsThatChangedCharacters: changed }, null, 1));
      }
      // the arithmetic, exact whatever the import does
      expect(ty.v).toBe(3);
      expect(ty.counted).toBe(true);
      expect(ty.file, kind + ': file = book + set aside + unaccounted').toBe(ty.book + aside + ty.unaccounted);
      const sum = (l: Diff) => l.reduce((a, x) => a + x[1], 0);
      expect(sum(diff.fileOnly) - sum(diff.bookOnly), kind + ': the differing characters sum to the unaccounted figure').toBe(ty.unaccounted);
      expect({ fileOnlyN: ty.chars.fileOnlyN, bookOnlyN: ty.chars.bookOnlyN, same: ty.chars.same }).toEqual({ fileOnlyN: sum(diff.fileOnly), bookOnlyN: sum(diff.bookOnly), same: !diff.fileOnly.length && !diff.bookOnly.length });
      // the inventory: everything the import still changes in this file, exactly
      expect(got, kind + ': the measurement is not the pinned inventory (import-tally-meridian.inventory.ts): the import now changes something else, or no longer changes something').toEqual(MERIDIAN_INVENTORY[kind]);
    }, 600_000);
  }
});
