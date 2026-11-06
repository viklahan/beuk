// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractStudioSource } from '../../src/book/studio/closure';
import { CLOSURE_NAMES, CLOSURE_ROOTS, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { studioHtml } from './one-source';

/* Wave 5a, task 1 — constraint 52 (review focus #1): ONE BUILDER. The browser's buildEpubBlob (and the package code
   under it: epubFiles, the accessibility audit and stamp, the manifest properties) is 1.0's code lifted from the same
   source as the server's EPUB_CLOSURE (src/book/epub/closure.ts): every name the server lifts for the EPUB is lifted
   into the browser closure too (bar the string tables, the interface language and `$`, which the browser studio
   supplies), and each declaration's text there equals the server's extraction of it, character for character (as
   wave 4c's test does for WRAP_CLOSURE). tests/book-epub-closure.test.ts and book-epub-parity.test.ts stay as they are. */

const EPUB_TS = fileURLToPath(new URL('../../src/book/epub/closure.ts', import.meta.url));
const CLOSURE_JS = fileURLToPath(new URL('../src/generated/closure.js', import.meta.url));

/** EPUB_CLOSURE, EPUB_ROOTS and EPUB_SUPPLIED, read out of the server's source (no import: it loads node workers). */
function epubList(name: 'EPUB_CLOSURE' | 'EPUB_ROOTS' | 'EPUB_SUPPLIED'): string[] {
  const src = readFileSync(EPUB_TS, 'utf8');
  const m = new RegExp('export const ' + name + ': readonly string\\[\\] = \\[([\\s\\S]*?)\\];').exec(src);
  if (!m) throw new Error(`src/book/epub/closure.ts no longer declares ${name}`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}
/** The browser studio's own names (never lifted: it supplies them) — the string tables, t() and its plural helpers,
 *  the interface language, and `$` (1.0's getElementById, 2.0's page: src/environment/page.ts). */
const SUPPLIED_BY_BROWSER = /^(UI_STRINGS|UI_PLURAL_FORMS|uiLangState|tCountForm|uiPluralCategory|uiPluralRulesCache|t|\$)$/;

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

describe("wave 5a: the browser's EPUB code is 1.0's, the same text as the server's EPUB_CLOSURE (constraint 52)", () => {
  it('every EPUB_CLOSURE name the browser does not supply is lifted, and every EPUB_ROOT is a root of the browser closure', () => {
    const epub = epubList('EPUB_CLOSURE');
    expect(epub.length).toBe(302); // 301 + picDataSrc (wave 7b, 1.0 fix 3d34720)
    const browserOwn = epub.filter((n) => SUPPLIED_BY_BROWSER.test(n));
    expect(browserOwn.sort()).toEqual(['$', 'UI_PLURAL_FORMS', 'UI_STRINGS', 't', 'tCountForm', 'uiLangState', 'uiPluralCategory', 'uiPluralRulesCache'].sort());
    expect(CLOSURE_SUPPLIED).toEqual(expect.arrayContaining(['t', 'UI_STRINGS', 'uiLangState', '$']));
    // the EPUB build's own supplied names are the browser's too (state, toast, samplePicsRequire, JSZip)
    expect(CLOSURE_SUPPLIED).toEqual(expect.arrayContaining(epubList('EPUB_SUPPLIED')));
    const missing = epub.filter((n) => !SUPPLIED_BY_BROWSER.test(n) && !CLOSURE_NAMES.includes(n));
    expect(missing).toEqual([]);
    for (const r of epubList('EPUB_ROOTS')) expect(CLOSURE_ROOTS).toContain(r);
    // what the export modal runs (wave 5a): lifted, never supplied
    for (const n of ['buildEpubBlob', 'epubFiles', 'buildEpub', 'buildMarkdown', 'buildStandaloneHtml', 'validateEpubPackage', 'auditAccessibility', 'refreshExportTree', 'initExport']) {
      expect(CLOSURE_NAMES, n).toContain(n);
      expect(CLOSURE_SUPPLIED, n).not.toContain(n);
    }
  });

  it("each EPUB declaration's text in the browser closure equals the server's extraction of it (buildEpubBlob included)", () => {
    const epub = epubList('EPUB_CLOSURE').filter((n) => !SUPPLIED_BY_BROWSER.test(n));
    const server = extractStudioSource(studioHtml(), epub, { listRef: 'studio/test/export-closure.test.ts', api: '', stringTables: false });
    const sfS = ts.createSourceFile('epub.js', server.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const s = byName(sfS.statements, sfS);
    const gen = readFileSync(CLOSURE_JS, 'utf8');
    const sfB = ts.createSourceFile('closure.js', gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const create = sfB.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'createClosure');
    expect(create?.body).toBeTruthy();
    const b = byName(create!.body!.statements, sfB);
    const unequal: string[] = [];
    for (const n of epub) {
      expect(s.has(n), `the server lifts ${n}`).toBe(true);
      expect(b.has(n), `the browser lifts ${n}`).toBe(true);
      if (s.get(n) !== b.get(n)) unequal.push(n);
    }
    expect(unequal).toEqual([]);
    expect(epub.length).toBe(294); // 293 + picDataSrc (wave 7b, 1.0 fix 3d34720)
    expect(b.get('buildEpubBlob')).toBe(s.get('buildEpubBlob'));
    expect(b.get('buildEpubBlob')).toMatch(/new JSZip\(\)/);
  });
});

/* Locked review copy (design 2026-11-06), task 1 — global constraint 5 (one source): 1.0's PDF lock (BEUK:lockcopy) is
   lifted into the main closure, never supplied and never copied: each of its declarations' text there equals 1.0's.
   Task 2: and the DOCX lock (lockDocxBytes), in the same block. The EPUB counts above do not move (the lock is no part
   of the EPUB build). */
describe('locked review copy: the PDF and DOCX locks are 1.0\'s, lifted (constraint 5)', () => {
  it('lockPdfBytes, lockSaslPrep and lockDocxBytes are roots of the main closure, and the whole BEUK:lockcopy block is 1.0\'s text', () => {
    for (const n of ['lockPdfBytes', 'lockSaslPrep', 'lockDocxBytes']) {
      expect(CLOSURE_ROOTS, n).toContain(n);
      expect(CLOSURE_SUPPLIED, n).not.toContain(n);
    }
    const html = studioHtml();
    const block = html.slice(html.indexOf('/* ==== BEUK:lockcopy ===='), html.indexOf('/* ==== /BEUK:lockcopy ==== */'));
    const sfH = ts.createSourceFile('lock.js', block, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const one = byName(sfH.statements, sfH);
    expect(one.size).toBe(66); // every top-level declaration of the block: task 1's 32, task 2's 15, task 3's 17, task 4's 2 (lockAccessNote, lockAccessRefresh)
    const gen = readFileSync(CLOSURE_JS, 'utf8');
    const sfB = ts.createSourceFile('closure.js', gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const create = sfB.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'createClosure');
    const b = byName(create!.body!.statements, sfB);
    for (const [n, text] of one) expect(b.get(n), n).toBe(text);
  });

  /* Task 3: the controls and the download points' halves. The Word file and the manuscript reach them through 1.0's
     downloadDocx / msDownload (main closure); the print-ready panel (print's module) lifts the PDF dialog and the PDF
     lock with it, and the plan line (the shelf's module) the day-22 note: each module's copy is 1.0's text, never a
     second version. */
  it("task 3: the lock controls are roots of the main closure, and the print and shelf modules' lifted copies of the block are 1.0's text", () => {
    for (const n of ['lockFieldsRead', 'lockFieldsClear', 'lockCopyAllowed', 'lockFieldsRender', 'lockPlanNote', 'lockPdfOpen', 'lockedPdfDownload']) {
      expect(CLOSURE_ROOTS, n).toContain(n);
      expect(CLOSURE_SUPPLIED, n).not.toContain(n);
    }
    const html = studioHtml();
    const block = html.slice(html.indexOf('/* ==== BEUK:lockcopy ===='), html.indexOf('/* ==== /BEUK:lockcopy ==== */'));
    const sfH = ts.createSourceFile('lock.js', block, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const one = byName(sfH.statements, sfH);
    const lifted = (file: string, fn: string) => {
      const gen = readFileSync(fileURLToPath(new URL('../src/generated/' + file, import.meta.url)), 'utf8');
      const sf = ts.createSourceFile(file, gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const create = sf.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === fn);
      expect(create?.body, fn).toBeTruthy();
      return byName(create!.body!.statements, sf);
    };
    const print = lifted('closure-print.js', 'createPrintClosure');
    const shelf = lifted('closure-cloud.js', 'createCloudClosure');
    // what each reaches: the print panel the PDF dialog and the PDF lock; the plan line the day-22 note
    for (const n of ['lockPdfOpen', 'lockPdfDialog', 'lockedPdfDownload', 'lockPdfBytes', 'lockCopyAllowed']) expect(print.has(n), 'print lifts ' + n).toBe(true);
    for (const n of ['lockPlanNote', 'lockAccessNote', 'lockAccessRefresh', 'lockFieldsRender', 'lockCopyAllowed']) expect(shelf.has(n), 'the shelf lifts ' + n).toBe(true);
    let compared = 0;
    for (const [n, text] of one) {
      for (const [where, m] of [['print', print], ['shelf', shelf]] as const) {
        if (!m.has(n)) continue;
        compared++;
        expect(m.get(n), where + ' ' + n).toBe(text);
      }
    }
    expect(compared).toBeGreaterThan(8);
  });
});
