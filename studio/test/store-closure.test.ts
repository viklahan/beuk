// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractStudioSource } from '../../src/book/studio/closure';
import { CLOSURE_NAMES, CLOSURE_ROOTS, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { studioHtml } from './one-source';

/* Wave 5d, task 1 — constraint 71 (review focus #1): THE AUDIT IS 1.0's. STORE_RULES, storeAudit, its facts, verdicts,
   rows and actions (storeAct, storeServerFix, storeServerReason, storeFootnoteFallbacks, …), the report surface
   (storeRowsHtml, renderStoreReport, buildStoreReportHtml, downloadStoreReport) and the store modal's wiring
   (openStoreReady, initStoreReady, storeRunServer, storeRecheck) are 1.0's own declarations, lifted into the main
   closure: each one's text there equals 1.0's source, character for character. Nothing of them is in React.

   The server half stays shelf-gated (wave 7): the four names that would reach the shelf are supplied — storeMakePrintJob
   (the seam: 2.0 answers { needShelf: true } without a request, as 5b's print-ready panel), storeUpload, storeCreateJob
   and storeRefreshJobs (refusing stand-ins: no request). */

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

export const WAVE5D = {
  rules: ['STORE_TRIM_TOL', 'STORE_SPINE_TOL', 'STORE_RULES', 'STORE_IDS', 'storeUi', 'storeDefaults', 'normalizeStoreCheck', 'storeInkId', 'storeIsTrim',
    'storeTrimOnPaper', 'storeMatchTrim', 'storeIn', 'storeTrimLabel'],
  audit: ['storeSpineClearance', 'storeFacts', 'storeBookSig', 'storeServerFresh', 'storeServerReason', 'STORE_CAUSE_FIX', 'storeServerFix', 'storeFootnoteFallbacks',
    'storeFontNames', 'storeAudit'],
  report: ['STORE_ICON', 'storeVerdictText', 'storeFactsLine', 'storeRowsHtml', 'renderStoreReport', 'buildStoreReportHtml', 'downloadStoreReport'],
  modal: ['storeAct', 'openStoreReady', 'storeRunServer', 'storeRecheck', 'initStoreReady'],
  // what the audit reads of print that the main closure did not lift before (print's module has its own copy)
  print: ['printPlacements', 'imagePixelSize', 'printEdgeSections', 'printNotesAtFoot', 'preflightJumpTo'],
};
export const SHELF_SUPPLIED = ['storeMakePrintJob', 'storeUpload', 'storeCreateJob', 'storeRefreshJobs'];

describe("wave 5d: the store-ready check is 1.0's code (constraint 71)", () => {
  it('the rules, the audit, the report and the modal are lifted, never supplied; only the shelf half is supplied', () => {
    for (const [what, names] of Object.entries(WAVE5D))
      for (const n of names) {
        expect(CLOSURE_NAMES, what + ' ' + n).toContain(n);
        expect(CLOSURE_SUPPLIED, what + ' ' + n).not.toContain(n);
      }
    for (const n of ['STORE_RULES', 'storeAudit', 'storeUi', 'storeRowsHtml', 'renderStoreReport', 'buildStoreReportHtml', 'downloadStoreReport', 'storeAct', 'openStoreReady',
      'initStoreReady', 'storeRunServer', 'storeRecheck', 'storeVerdictText', 'storeFactsLine', 'storeSpineClearance', 'storeMatchTrim', 'storeServerFix'])
      expect(CLOSURE_ROOTS, n).toContain(n);
    for (const n of SHELF_SUPPLIED) {
      expect(CLOSURE_SUPPLIED, n).toContain(n);
      expect(CLOSURE_NAMES, n).not.toContain(n);
    }
    // nothing of the shelf's own transport is lifted by the store family (cloudEnsureLinked is the shelf link: wave 7)
    expect(CLOSURE_NAMES).not.toContain('cloudEnsureLinked');
  });

  it("each of their declarations' text in the closure equals 1.0's source, character for character", () => {
    const names = Object.values(WAVE5D).flat();
    const one = extractStudioSource(studioHtml(), names, { listRef: 'studio/test/store-closure.test.ts', api: '', stringTables: false });
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
    expect(b.get('storeAudit')).toMatch(/const verdict = blocking \? "notReady" : unrun \? "cantConfirm" : "ready";/);
  });
});
