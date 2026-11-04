import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
// @ts-expect-error — a plain .mjs build script, no types
import { buildTestModule } from '../scripts/extract-closure.mjs';
import { ORACLE_STUBS } from './import-oracle';
import { loadMammoth } from './vendor';
import markup from '../src/generated/import-markup.json';

/* Wave 6 — review focus #5: 1.0's import self-checks (client/index.html: every SELF_CHECKS / SELF_CHECKS_ASYNC entry with
   feature "import" — the 39 `id: "import.` checks and the 5 `id: "pdf.` ones, and any other the grep finds), RUN VERBATIM:
   each check's own object literal, cut out of 1.0's source by the TypeScript AST, is evaluated inside a module of 1.0's
   own declarations that it reaches (buildTestModule, the extractor the closure is built by), with only 1.0's redraws and
   page hooks stubbed (ORACLE_STUBS). The functions it runs are the very text 2.0's closure lifts (import-closure.test.ts
   holds them character for character). A check that needs what jsdom has not (pdf.js, a real canvas, the network) is
   listed in SKIP with its reason; every other must pass. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');

/** Checks that need what jsdom cannot give, with the reason (each is held by the e2e instead, where it says so). */
const PAGE = "it drives 1.0's own page fields (Project Settings' #metaTitle / #metaAuthor, the top bar's title, a section editor's title box), which 2.0 has as React (waves 1a, 2c): the import's identity rules it checks are held instead by the parity of every corpus file onto a written book and the untouched sample (import-data, the e2e)";
const PDFJS = "it parses a real PDF with pdf.js, which jsdom cannot load (an ES module build): the e2e imports real PDFs beside 1.0's page";
export const SKIP: Record<string, string> = {
  'import.displaces-sample-identity': PAGE,
  'import.credits-document-fills-blanks-only': PAGE,
  'import.semantics.review': PAGE,
  'import.title.from-titlepage': PAGE,
  'import.title.keeps-writers': PAGE,
  'import.title.keeps-section-editor': PAGE,
  'settings.title.placeholder-not-stored': PAGE + ' (a Project Settings check that 1.0 files under feature "import")',
  'import.zip.mixed-bulk': PDFJS + ' (its five.pdf; the zip and the other five books are bulk import, wave 7)',
  'import.epub.bulk-and-boxset': "it reads the accept lists of 1.0's bulk picker (#bulkFileInput: the shelf, wave 7) and the box set's (#boxSetFileInput, in the export modal's markup, not on this test page)",
  'import.replace.unlinks-shelf': "the shelf link (cloud.linkedId) is wave 7's: before it nothing is linked, and the branch stays dormant (replaceBodyChapters runs it as 1.0's text)",
  'pdf.bookmarks.read-with-their-pages': PDFJS,
  'boxset.zip-and-pdf': PDFJS + ' (its PDF volume)',
  'import.pdf': PDFJS,
};

/** The checks earlier waves left for the import (5c: the box set's manuscript and zip volumes, the manuscript read back). */
export const WAVE6_OTHERS = ['boxset.zip-and-pdf', 'boxset.volumes.whole-books'];
type Check = { id: string; feature: string; name: string; text: string; async: boolean };
/** The studio script's top level, parsed once (the same script the extractor reads). */
async function checksAndModule(): Promise<{ checks: Check[]; run: (env: Rec) => { checks: { id: string; run: () => unknown }[] } }> {
  const { studioScript } = await import('../../src/book/studio/closure');
  const src = studioScript(HTML);
  const sf = ts.createSourceFile('studio.js', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declared = new Set<string>();
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) declared.add(st.name.text);
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) declared.add(d.name.text);
  }
  const checks: Check[] = [];
  const refs = new Set<string>();
  // every check object (feature "import") that stands at the top level of a SELF_CHECKS / SELF_CHECKS_ASYNC array
  // literal or of a SELF_CHECKS(.ASYNC).push(...) statement — 1.0's own lists
  const take = (el: ts.Expression, isAsync: boolean) => {
    if (!ts.isObjectLiteralExpression(el)) return;
    const prop = (k: string) => {
      const p = el.properties.find((x): x is ts.PropertyAssignment => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === k);
      return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : '';
    };
    if (prop('feature') !== 'import' && !WAVE6_OTHERS.includes(prop('id'))) return;
    checks.push({ id: prop('id'), feature: prop('feature'), name: prop('name'), text: el.getText(sf), async: isAsync });
    const walk = (n: ts.Node) => {
      if (ts.isIdentifier(n) && declared.has(n.text)) {
        const p = n.parent;
        const isKey = (ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && p.name === n);
        if (!isKey) refs.add(n.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(el);
  };
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && /^SELF_CHECKS(_ASYNC)?$/.test(d.name.text) && d.initializer && ts.isArrayLiteralExpression(d.initializer))
          for (const el of d.initializer.elements) take(el, d.name.text === 'SELF_CHECKS_ASYNC');
    if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression) && ts.isPropertyAccessExpression(st.expression.expression) && st.expression.expression.name.text === 'push') {
      const recv = st.expression.expression.expression;
      if (ts.isIdentifier(recv) && /^SELF_CHECKS(_ASYNC)?$/.test(recv.text)) for (const el of st.expression.arguments) take(el, recv.text === 'SELF_CHECKS_ASYNC');
    }
  }
  const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
  const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
  const roots = ['applyBookDoc', 'buildEmptyBook', ...refs].filter((n) => !stubs.includes(n) && !['state', 'toast', 'samplePicsRequire', 'JSZip'].includes(n) && !/^SELF_CHECKS/.test(n));
  const out = await buildTestModule(HTML, epub, { roots, supplied: [...new Set([...stubs, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-selfchecks', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_SC', fn: 'createImportChecks', title: "1.0's import self-checks (wave 6, tests only)" });
  let code = (out.code as string).replace(/^export (const|function) /gm, '$1 ');
  const tail = '  return { api: {';
  const at = code.lastIndexOf(tail);
  if (at < 0) throw new Error('the test module no longer ends with its api');
  code = code.slice(0, at) + '  const __checks = [\n' + checks.map((c) => c.text).join(',\n') + '\n  ];\n  return { checks: __checks, api: {' + code.slice(at + tail.length);
  code += '\nreturn createImportChecks(env);';
  return { checks, run: (env: Rec) => new Function('env', code)(env) as { checks: { id: string; run: () => unknown }[] } };
}

let mod: Awaited<ReturnType<typeof checksAndModule>>;
beforeAll(async () => {
  loadMammoth();
  mod = await checksAndModule();
}, 120_000);

const noop = () => undefined;
function env(): Rec {
  const e: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis,
    mammoth: (globalThis as Rec).mammoth };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  // 1.0's checks swap a page hook by assigning window[name] (window.toast = …, window.cloudConfirm = …): each supplied
  // function here answers through window[name] while a check has set one
  const w = globalThis as unknown as Rec;
  for (const [n, f] of Object.entries(e)) if (typeof f === 'function' && n !== '$' && n !== 't' && n !== 'JSZip' && n !== 'getUiLang') e[n] = (...a: unknown[]) => (typeof w[n] === 'function' ? (w[n] as (...x: unknown[]) => unknown)(...a) : (f as (...x: unknown[]) => unknown)(...a));
  return e;
}

describe("wave 6: 1.0's import self-checks, run verbatim (review focus #5)", () => {
  it('the grep counts: 39 import.* and 5 pdf.* ids; every feature "import" check is found', () => {
    expect((HTML.match(/id: *"import[^"]*"/g) || []).length).toBe(39);
    expect((HTML.match(/id: *"pdf[^"]*"/g) || []).length).toBe(5);
    expect(mod.checks.filter((c) => c.feature === 'import').length).toBe((HTML.match(/feature: *"import"/g) || []).length);
    expect(mod.checks.filter((c) => WAVE6_OTHERS.includes(c.id)).map((c) => c.id).sort()).toEqual([...WAVE6_OTHERS].sort());
  });
  it('every check passes, but those listed in SKIP with their reason', async () => {
    const results: { id: string; pass: boolean; detail: string }[] = [];
    for (const ck of mod.checks) {
      if (SKIP[ck.id]) continue;
      // a fresh 1.0 desk for each check: its empty book arrived, 1.0's import markup on the page
      document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
      const m = mod.run(env()) as unknown as { checks: { id: string; run: () => unknown }[]; api: Record<string, (...a: unknown[]) => unknown> };
      const empty = m.api.buildEmptyBook() as Rec & { meta: Rec };
      m.api.applyBookDoc(empty);
      const c = m.checks.find((x) => (x as unknown as { id: string }).id === ck.id)!;
      let r: { pass: boolean; detail?: string };
      try {
        r = (await c.run()) as { pass: boolean; detail?: string };
      } catch (e) {
        r = { pass: false, detail: 'threw: ' + ((e as Error).stack || String(e)).slice(0, 600) };
      }
      results.push({ id: ck.id, pass: !!r.pass, detail: String(r.detail || '').slice(0, 400) });
    }
    console.log(results.map((r) => (r.pass ? 'PASS ' : 'FAIL ') + r.id + (r.pass ? '' : ' — ' + r.detail)).join('\n'));
    expect(results.filter((r) => !r.pass)).toEqual([]);
    expect(results.length).toBe(mod.checks.length - Object.keys(SKIP).length);
    expect(results.length).toBe(34);
  }, 600_000);
});
