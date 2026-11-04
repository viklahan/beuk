// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractStudioSource } from '../../src/book/studio/closure';
import { CLOSURE_NAMES, CLOSURE_ROOTS, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { studioHtml } from './one-source';

/* Wave 6, task 1 (decision 1; review focus #1): THE IMPORT IS 1.0's. The reader of every format, the Import button's path,
   the whole-book replace, the sandboxed import, the summary and the report with its undo are 1.0's own declarations,
   lifted into the main closure: each one's text there equals 1.0's source, character for character. What 1.0's import
   reaches outside the import is supplied (src/import/import.ts), and 5c's stand-ins for Add a Book are gone. */

const CLOSURE_JS = fileURLToPath(new URL('../src/generated/closure.js', import.meta.url));
const declNames = (st: ts.Statement): string[] => {
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
};
function byName(statements: readonly ts.Statement[], sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of statements) for (const n of declNames(st)) out.set(n, st.getText(sf));
  return out;
}

export const WAVE6 = {
  reader: ['readImportFile', 'importRefusal', 'IMPORT_DOCX_BROKEN', 'detectDocxLanguage', 'readDocxCoreIdentity', 'irScanDocxXml', 'IR_MAMMOTH_OPTS', 'importDocxConverted',
    'irDocxHtmlToText', 'rtfRead', 'rtfBytesToString', 'importRtfRead', 'importPlainManuscript', 'bulkParseFrontmatter', 'epubRead', 'epubPieces', 'importEpubRead',
    'pdfLoadLib', 'PDFJS_DIR', 'PDFJS_FILES', 'pdfExtract', 'pdfImageToData', 'pdfIsScanned', 'importPdfExtracted', 'pdfLayout'],
  button: ['handleImportFile', 'importConfirmReplace', 'importExpandZips', 'ZIP_MAX_FILES', 'ZIP_MAX_BYTES', 'zipClutter', 'bulkIsManuscript', 'initImport'],
  book: ['parseManuscript', 'splitSegments', 'placeMatterPieces', 'copyrightMetaFrom', 'imApplyIdentity', 'replaceBodyChapters', 'importFoundList', 'renderImportSummary',
    'lastImportFound', 'offerDetectedLanguage', 'applyDetectedLanguage', 'snapshotBookDoc'],
  sandbox: ['importSandboxed', 'manuscriptFileToBookDoc', 'boxSetExpandPick', 'manuscriptFileToVolume'],
  report: ['IR_REC', 'irBegin', 'irAbort', 'irFinish', 'normalizeImportReport', 'IR_UNDO', 'irUndoItem', 'irUndoAllAvailability', 'irUndoAll', 'irDismiss', 'IR_GROUPS',
    'irItemLabel', 'IR_HINT', 'irRenderReport', 'irOpenReport', 'irCloseReport', 'irSyncReopen', 'irOnLangChange', 'initImportReport'],
};
/** What 1.0's import reaches outside it: 2.0's own (src/import/import.ts, src/closure/index.ts). */
export const IMPORT_SUPPLIED = ['applyBookDoc', 'restoreSnapshot', 'applySampleBookSync', 'deskIsUntouchedSample', 'renderSampleButton', 'refreshLangHint'];

describe("wave 6: the import is 1.0's code (decision 1)", () => {
  it('the reader, the button, the replace, the sandbox and the report are lifted, never supplied; only their surroundings are supplied', () => {
    for (const [what, names] of Object.entries(WAVE6))
      for (const n of names) {
        expect(CLOSURE_NAMES, what + ' ' + n).toContain(n);
        expect(CLOSURE_SUPPLIED, what + ' ' + n).not.toContain(n);
      }
    for (const n of ['readImportFile', 'handleImportFile', 'importSandboxed', 'manuscriptFileToBookDoc', 'initImport', 'initImportReport', 'irUndoItem', 'irUndoAll', 'irDismiss',
      'irOpenReport', 'boxSetExpandPick', 'manuscriptFileToVolume'])
      expect(CLOSURE_ROOTS, n).toContain(n);
    for (const n of IMPORT_SUPPLIED) {
      expect(CLOSURE_SUPPLIED, n).toContain(n);
      expect(CLOSURE_NAMES, n).not.toContain(n);
    }
    // G3 (bulk import to the shelf) is wave 7's: nothing of it is lifted
    for (const n of ['startBulkImport', 'bulkRun', 'cloudLoadShelf', 'cloudSaveRun']) expect(CLOSURE_NAMES, n).not.toContain(n);
  });

  it("each of their declarations' text in the closure equals 1.0's source, character for character", () => {
    const names = Object.values(WAVE6).flat();
    const one = extractStudioSource(studioHtml(), names, { listRef: 'studio/test/import-closure.test.ts', api: '', stringTables: false });
    const sfO = ts.createSourceFile('one.js', one.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const o = byName(sfO.statements, sfO);
    const gen = readFileSync(CLOSURE_JS, 'utf8');
    const sfB = ts.createSourceFile('closure.js', gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const create = sfB.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'createClosure');
    const b = byName(create!.body!.statements, sfB);
    const unequal: string[] = [];
    for (const n of names) {
      expect(o.has(n), `1.0 declares ${n}`).toBe(true);
      expect(b.has(n), `the closure lifts ${n}`).toBe(true);
      if (o.get(n) !== b.get(n)) unequal.push(n);
    }
    expect(unequal).toEqual([]);
    // the one supplied name 1.0's import assigns (importSandboxed restores cloudDirty) is a `let`
    expect(gen).toMatch(/\n {2}let cloudDirty = env\.cloudDirty;/);
  });
});

describe("V's ruling 2026-11-04 (1.0 bugs are fixed, in 1.0): pdf.js never tries WebAssembly", () => {
  it("1.0's own pdfExtract opens a PDF with useWasm: false (the served CSP has no 'wasm-unsafe-eval'), and the closure lifts that text", () => {
    const gen = readFileSync(CLOSURE_JS, 'utf8');
    for (const src of [studioHtml(), gen]) expect(src).toMatch(/lib\.getDocument\(\{ data, [^}]*useWasm: false/);
  });
});
