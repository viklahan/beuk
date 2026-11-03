// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractStudioSource } from '../../src/book/studio/closure';
import { CLOSURE_NAMES, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { PRINT_API, PRINT_NAMES, PRINT_SUPPLIED_NAMES } from '../src/generated/closure-print.js';
import { PREVIEW_NAMES } from '../src/generated/closure-preview.js';
import { studioHtml } from './one-source';

/* Wave 5b, task 1 — constraint 57 (review focus #1): THE TYPESETTER IS 1.0's. buildPrintHtml, the print CSS
   (buildPrintCss, printTypeCss, the footnote and layout rules, the press tints), the interior view's pagination
   (buildPrintViewModel, pivSectionFlow, pivFootnoteLayout) and the preflight (auditPrintInterior) are 1.0's own
   declarations, lifted into print's own module (src/generated/closure-print.js): each one's text there equals 1.0's
   source (client/index.html, the same extraction the server's closures use), character for character. Nothing of it
   is in React. The main closure's initExport reaches print through its two supplied names (renderPrintControls,
   runPrintPreflight), and the preview's full screen through renderPrintView: never a second copy there. */

const PRINT_JS = fileURLToPath(new URL('../src/generated/closure-print.js', import.meta.url));
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

describe("wave 5b: print's code is 1.0's (constraint 57)", () => {
  it('the print family is lifted into its own module, and the main closure and the preview reach it only through supplied names', () => {
    for (const n of ['buildPrintHtml', 'printFilename', 'preparePrintPress', 'buildPrintCss', 'printTypeCss', 'renderPrintControls', 'initPrint', 'openPrintView',
      'initPrintView', 'buildPrintViewModel', 'pivSectionFlow', 'pivFootnoteLayout', 'renderPrintView', 'pivRebuild', 'openPrintInteriorView',
      'auditPrintInterior', 'runPrintPreflight', 'preflightJumpTo', 'printPlacements', 'printReadyPdf']) {
      expect(PRINT_NAMES, n).toContain(n);
      expect(PRINT_SUPPLIED_NAMES, n).not.toContain(n);
    }
    for (const n of ['buildPrintHtml', 'renderPrintControls', 'runPrintPreflight', 'renderPrintView', 'initPrint', 'initPrintView', 'printReadyPdf']) expect(PRINT_API).toContain(n);
    // initExport (the main closure) calls these two: supplied there, forwarded to print's module (src/closure/index.ts)
    for (const n of ['renderPrintControls', 'runPrintPreflight']) {
      expect(CLOSURE_SUPPLIED, n).toContain(n);
      expect(CLOSURE_NAMES, n).not.toContain(n);
    }
    // the preview's full screen redraws an open interior view through its supplied renderPrintView
    expect(PREVIEW_NAMES).not.toContain('renderPrintView');
    // the shelf's job (the print-ready PDF) and the sign-in are supplied (shelf-gated, src/print/print.ts)
    for (const n of ['storeMakePrintJob', 'storeRefreshJobs', 'openAuth', 'cloud', 'a11yJumpTo']) expect(PRINT_SUPPLIED_NAMES, n).toContain(n);
  });

  it("each declaration's text in print's module equals 1.0's source, character for character", () => {
    const one = extractStudioSource(studioHtml(), PRINT_NAMES, { listRef: 'studio/test/print-closure.test.ts', api: '', stringTables: false });
    const sfO = ts.createSourceFile('one.js', one.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const o = byName(sfO.statements, sfO);
    const gen = readFileSync(PRINT_JS, 'utf8');
    const sfP = ts.createSourceFile('closure-print.js', gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const create = sfP.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'createPrintClosure');
    expect(create?.body).toBeTruthy();
    const p = byName(create!.body!.statements, sfP);
    const unequal: string[] = [];
    for (const n of PRINT_NAMES) {
      expect(o.has(n), `1.0 declares ${n}`).toBe(true);
      expect(p.has(n), `print's module lifts ${n}`).toBe(true);
      if (o.get(n) !== p.get(n)) unequal.push(n);
    }
    expect(unequal).toEqual([]);
    expect(PRINT_NAMES.length).toBeGreaterThan(250);
    expect(p.get('buildPrintHtml')).toMatch(/buildPrintCss\(state\.printTrim, !!state\.printRecto\)/);
  });
});
