// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractStudioSource } from '../../src/book/studio/closure';
import { CLOSURE_NAMES, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { studioHtml } from './one-source';

/* Wave 4c, task 1 — constraint 40 (review focus #1): the painters are 1.0's code, and the browser closure's wrap names
   and the server's WRAP_CLOSURE (src/book/wrap/closure.ts) are the same source text. Every name the server lifts for
   the wrap is lifted into the browser closure too (bar the string tables and the interface language, which the browser
   studio supplies: `t`, UI_STRINGS, uiLangState and t()'s plural helpers), and each declaration's text there equals
   the server's extraction of it, character for character. tests/book-wrap-closure.test.ts and
   book-wrap-parity.test.ts stay as they are (the server side is not touched). */

const WRAP_TS = fileURLToPath(new URL('../../src/book/wrap/closure.ts', import.meta.url));
const CLOSURE_JS = fileURLToPath(new URL('../src/generated/closure.js', import.meta.url));

/** WRAP_CLOSURE and WRAP_ROOTS, read out of the server's source (importing it would load @napi-rs/canvas). */
function wrapList(name: 'WRAP_CLOSURE' | 'WRAP_ROOTS'): string[] {
  const src = readFileSync(WRAP_TS, 'utf8');
  const m = new RegExp('export const ' + name + ': readonly string\\[\\] = \\[([\\s\\S]*?)\\];').exec(src);
  if (!m) throw new Error(`src/book/wrap/closure.ts no longer declares ${name}`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}
/** The browser studio's own names (never lifted: the studio supplies them). */
const SUPPLIED_BY_BROWSER = /^(UI_STRINGS|UI_PLURAL_FORMS|uiLangState|tCountForm|uiPluralCategory|uiPluralRulesCache|t)$/;

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

describe("wave 4c: the wrap painters are 1.0's, the same text as the server's WRAP_CLOSURE (constraint 40)", () => {
  it('every WRAP_CLOSURE name the browser does not supply is lifted into the browser closure', () => {
    const wrap = wrapList('WRAP_CLOSURE');
    expect(wrap.length).toBe(127);
    const browserOwn = wrap.filter((n) => SUPPLIED_BY_BROWSER.test(n));
    expect(browserOwn.sort()).toEqual(['UI_PLURAL_FORMS', 'UI_STRINGS', 't', 'tCountForm', 'uiLangState', 'uiPluralCategory', 'uiPluralRulesCache'].sort());
    expect(CLOSURE_SUPPLIED).toEqual(expect.arrayContaining(['t', 'UI_STRINGS', 'uiLangState']));
    const missing = wrap.filter((n) => !SUPPLIED_BY_BROWSER.test(n) && !CLOSURE_NAMES.includes(n));
    expect(missing).toEqual([]);
    for (const r of wrapList('WRAP_ROOTS')) expect(CLOSURE_NAMES).toContain(r);
  });

  it("each wrap declaration's text in the browser closure equals the server's extraction of it", () => {
    const wrap = wrapList('WRAP_CLOSURE').filter((n) => !SUPPLIED_BY_BROWSER.test(n));
    const server = extractStudioSource(studioHtml(), wrap, { listRef: 'studio/test/cover-closure.test.ts', api: '', stringTables: false });
    const sfS = ts.createSourceFile('wrap.js', server.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const s = byName(sfS.statements, sfS);
    const gen = readFileSync(CLOSURE_JS, 'utf8');
    const sfB = ts.createSourceFile('closure.js', gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const create = sfB.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'createClosure');
    expect(create?.body).toBeTruthy();
    const b = byName(create!.body!.statements, sfB);
    const unequal: string[] = [];
    for (const n of wrap) {
      expect(s.has(n), `the server lifts ${n}`).toBe(true);
      expect(b.has(n), `the browser lifts ${n}`).toBe(true);
      if (s.get(n) !== b.get(n)) unequal.push(n);
    }
    expect(unequal).toEqual([]);
    expect(wrap.length).toBe(120);
  });
});
