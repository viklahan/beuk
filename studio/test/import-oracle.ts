import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — a plain .mjs build script, no types
import { buildTestModule } from '../scripts/extract-closure.mjs';
const studioHtml = (): string => readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');

/* Wave 6, task 1: THE ORACLE. 1.0's own code in Node, independent of 2.0's import session: applyBookDoc (1.0's real
   arrival, not 2.0's re-typed lines), serializeBook, autoSnapshot / takeSnapshot / restoreSnapshot, readImportFile and the
   whole import, the report and its undo — lifted from client/index.html by the same extractor (buildTestModule), with
   only 1.0's redraws and page hooks stubbed (ORACLE_STUBS: nothing that changes the book). Each oracle is a fresh
   createImportOracle(env) — its own state, its own copy of every top-level `let`. */

export const ORACLE_ROOTS = ['applyBookDoc', 'serializeBook', 'readImportFile', 'buildEmptyBook', 'isEmptyDesk', 'sampleState', 'autoSnapshot', 'restoreSnapshot',
  'irUndoItem', 'irUndoAll', 'irDismiss', 'irUndoAllAvailability', 'normalizeImportReport', 'importConfirmReplace', 'irRenderReport', 'manuscriptFileToVolume', 'boxSetExpandPick'];
/** 1.0's redraws and page hooks (and the string tables and interface language, which the studio owns), stubbed. */
export const ORACLE_STUBS = ['$', 't', 'UI_STRINGS', 'getUiLang', 'uiLangState', 'tCountForm', 'uiPluralCategory', 'fmtDateIntl', 'icons', 'cloudConfirm', 'cloud',
  'net', 'apiFetch', 'cloudDirty', 'renderSidebar', 'syncEditor', 'renderStudio', 'syncStudioControls', 'renderPreview', 'updateStats', 'refreshExportTree',
  'renderCoverSettings', 'localMarkDirty', 'langSugReset', 'samplePicsFill', 'samplePicsEnsure', 'nbShown', 'nbRender', 'chopBookArrived', 'registerAllFonts',
  'raStop', 'dictDiscard', 'markWritingActivity', 'noteBookEdited', 'cloudHeartbeat', 'renderSampleButton', 'refreshLangHint', 'bibleBookArrived',
  'irOpenReport', 'openSettings', 'applySampleBookSync', 'mammoth', 'pdfLoadLib', 'document', 'window'];

type Rec = Record<string, unknown>;
export type Oracle = { api: Record<string, (...a: never[]) => unknown> & Rec; setState: (s: unknown) => void; getState: () => Rec };
let source: string | null = null;
async function oracleSource(): Promise<string> {
  if (source) return source;
  const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
  const out = await buildTestModule(studioHtml(), epub, { roots: ORACLE_ROOTS, supplied: ORACLE_STUBS, what: 'import-oracle', prefix: 'IMPORT_ORACLE', fn: 'createImportOracle', title: "The import's oracle (wave 6, tests only)" });
  source = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportOracle(env);';
  return source;
}
const noop = () => undefined;
/** A fresh 1.0 desk in Node. `t` is the studio's English (the same strings 2.0's closure is given). */
export async function createImportOracle(t: (k: string, p?: Rec) => string, extra: Rec = {}): Promise<Oracle> {
  const code = await oracleSource();
  const env: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: {}, net: { online: false },
    apiFetch: async () => null, cloudDirty: false, $: () => null, document: globalThis.document, window: globalThis };
  for (const n of ORACLE_STUBS) if (!(n in env)) env[n] = noop;
  Object.assign(env, extra);
  // 1.0 swaps a page hook by assigning window[name] (importSandboxed's quiet hooks; its checks' window.toast): each
  // supplied function answers through window[name] while one is set there
  const w = globalThis as unknown as Rec;
  for (const [n, f] of Object.entries(env))
    if (typeof f === 'function' && !['$', 't', 'JSZip', 'getUiLang', 'fmtDateIntl'].includes(n))
      env[n] = (...a: unknown[]) => (typeof w[n] === 'function' ? (w[n] as (...x: unknown[]) => unknown)(...a) : (f as (...x: unknown[]) => unknown)(...a));
  return new Function('env', code)(env) as Oracle;
}
