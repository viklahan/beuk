import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
// @ts-expect-error — a plain .mjs build script, no types
import { buildTestModule } from '../scripts/extract-closure.mjs';
import { ORACLE_STUBS } from './import-oracle';
import { loadMammoth } from './vendor';
import markup from '../src/generated/import-markup.json';

/* The import tally (BEUK:importtally) on a real book: the Meridian Ledger stress book, one manuscript in seven formats,
   each read by 1.0's own readImportFile (the text 2.0 lifts) and reconciled — the words counted from the file by the
   tally's own reading are the words in the book plus each named bucket set aside, with nothing unaccounted for. When
   a format does not reconcile the test does not bend: it prints which words they are (the first forty the file holds
   and the book does not, each with its neighbours in the file) and fails, because those are words the import lost.

   The book is the owner's untracked folder (tools/Testbooks, never committed), so it stands in his checkout only:
   BEUK_TESTBOOKS names the folder, else the default below is tried, and where neither holds the book the test is
   skipped and says so — it is never painted green without having run. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const DIR = process.env.BEUK_TESTBOOKS || path.join(import.meta.dirname, '..', '..', 'tools', 'Testbooks', 'The_Meridian_Ledger_TestSuite');
const FILES: [string, string][] = [
  ['docx', 'The_Meridian_Ledger.docx'], ['rtf', 'The_Meridian_Ledger.rtf'], ['odt', 'The_Meridian_Ledger.odt'], ['html', 'The_Meridian_Ledger.html'],
  ['md', 'The_Meridian_Ledger.md'], ['txt', 'The_Meridian_Ledger.txt'], ['epub', 'The_Meridian_Ledger_Reference.epub'],
];
const present = existsSync(path.join(DIR, FILES[0][1]));

type Api = Record<string, (...a: unknown[]) => unknown>;
let make: (env: Rec) => { api: Api };
const noop = () => undefined;
function env(): Rec {
  const e: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis,
    mammoth: (globalThis as Rec).mammoth };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}

describe.skipIf(!present)('the import tally reconciles the Meridian stress book in every format' + (present ? '' : ' — SKIPPED: the book is not in this checkout (tools/Testbooks is the owner\'s untracked folder; set BEUK_TESTBOOKS to run it)'), () => {
  beforeAll(async () => {
    loadMammoth();
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const roots = ['applyBookDoc', 'buildEmptyBook', 'readImportFile', 'irTallySource', 'irTallyBook', 'irTallyTokens'];
    const out = await buildTestModule(HTML, epub, { roots, supplied: [...new Set([...stubs, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-tally', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_TALLY', fn: 'createImportTally', title: "1.0's import with its tally (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportTally(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  it.each(FILES)('%s: every word of the file is in the book or in a named bucket', async (kind, name) => {
    document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
    const m = make(env());
    m.api.applyBookDoc(m.api.buildEmptyBook());
    const bytes = readFileSync(path.join(DIR, name));
    // a buffer of this page's own kind (the test page's ArrayBuffer is the one JSZip knows; Node's Buffer is another realm's)
    const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
    const file = { name, arrayBuffer: async () => buf(), text: async () => new TextDecoder('utf-8').decode(bytes) };
    const run = (await m.api.readImportFile(file)) as () => { tally?: { counted: boolean; file: number; book: number; aside: Record<string, number>; unaccounted: number }; items: unknown[] };
    const rep = run();
    const ty = rep.tally!;
    expect(ty, 'the import wrote no tally').toBeTruthy();
    const aside = Object.values(ty.aside).reduce((a, n) => a + n, 0);
    console.log(`${kind}: file ${ty.file} · book ${ty.book} · set aside ${aside} ${JSON.stringify(ty.aside)} · unaccounted ${ty.unaccounted}`);
    if (ty.unaccounted !== 0) {
      // which words: the file's word list less the book's, with each one's neighbours in the file
      const data = kind === 'rtf' ? Array.from(bytes, (b) => String.fromCharCode(b)).join('') : kind === 'docx' || kind === 'odt' || kind === 'epub' ? buf() : new TextDecoder('utf-8').decode(bytes);
      const src = (await m.api.irTallySource(kind, data)) as { parts: Record<string, string[]> };
      const fileTok = m.api.irTallyTokens(Object.values(src.parts).map((p) => p.join('\n')).join('\n')) as string[];
      const bookTok = m.api.irTallyTokens((m.api.irTallyBook(rep) as { text: string }).text) as string[];
      const norm = (w: string) => w.toLowerCase().replace(/[’ʼ]/g, "'");
      const left = new Map<string, number>();
      bookTok.forEach((w) => left.set(norm(w), (left.get(norm(w)) || 0) + 1));
      const missing: string[] = [];
      fileTok.forEach((w, i) => { const k = norm(w), n = left.get(k) || 0; if (n > 0) { left.set(k, n - 1); return; } if (missing.length < 40) missing.push(`${w}  ← … ${fileTok.slice(Math.max(0, i - 4), i + 5).join(' ')} …`); });
      console.log(`${kind}: the first words the file holds and the book does not (words set aside are among them):\n` + missing.join('\n'));
    }
    expect(ty.counted).toBe(true);
    expect(ty.file).toBe(ty.book + aside + ty.unaccounted);
    expect(ty.unaccounted, `${kind}: words unaccounted for`).toBe(0);
  }, 600_000);
});
