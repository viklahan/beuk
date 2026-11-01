/* Beuk 2.0 studio — 1.0's render code in the browser, ONE SOURCE (step 5
   design, decision 3). The server already lifts the studio's preview /
   export / cover code out of client/index.html (src/book/studio/closure.ts,
   used by the EPUB and wrap builds). This build step reuses that very
   selection — the same TypeScript-AST extractor (extractStudioSource) and
   reachability walk (reachableFrom) — to emit a static ES module:

     src/generated/closure.js   (gitignored)

   export function createClosure(env) → { api, setState, getState, arrive }

   - The lifted top-level declarations sit inside createClosure, in 1.0's
     order, so each studio gets its own copy and nothing leaks to window.
   - The names 1.0's code takes from its page are passed in explicitly
     (SUPPLIED): `state` (settable: setState), `toast`,
     `samplePicsRequire`, `JSZip` (the EPUB build's own supplied names,
     read out of src/book/epub/closure.ts), plus `t` and a minimal
     `UI_STRINGS` (the studio's own strings: the browser already has them,
     split per language, so the string tables are NOT lifted).
   - ROOTS: the EPUB build's roots (EPUB_ROOTS, read from
     src/book/epub/closure.ts), countWords and buildBookCss, and the History
     functions wave 1a runs (pack/unpack, prune, the section diff and word
     diff, the word counts, the empty-desk tests).
   - `arrive` is the EPUB build's ARRIVE (src/book/epub/closure.ts): the
     lines of applyBookDoc that give a read book the studio's state shape.
     How 2.0 builds `state` from its Y.Doc: exportBook(ydoc) (book format v1,
     what readBook reads), then the server's epubState mapping (`colour` →
     `bookColour`), then arrive() — see src/closure/index.ts.

   Static code, generated at build time: no eval, no new Function, so the
   CSP holds. Fails loudly — naming what is missing — when a root, a
   supplied name or ARRIVE disappears, when the lifted code reaches a
   string table other than UI_STRINGS, or reaches UI_STRINGS from a function
   not known to read only "misc.untitledBook". */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(STUDIO, '..');

/** History (step 5 wave 1a) and the word counts: functions run by name. */
export const EXTRA_ROOTS = [
  'countWords', 'buildBookCss', 'bookWordTotal', 'sectionWords', 'rightsLine', 'rightsModeOf', 'copyrightRightsParas', 'imRealTitle', 'uid', 'newBookId',
  'normalizeHistory', 'histPack', 'pruneAutoSnapshots', 'histSectionDiff', 'histTextDiff', 'histWordDiff', 'snapshotSectionWords', 'snapshotSectionName',
  'isEmptyDesk', 'deskTrulyEmpty', 'stableJson', 'HISTORY_AUTO_CAP', 'CHOP_SNAP_CAP', 'CC_LICENCES',
  // 1.0's own blank book and section maker (the History checks build their books with them, as 1.0's do)
  'buildEmptyBook', 'mkSection',
];
/** Names the browser studio supplies besides the EPUB build's. */
export const BROWSER_SUPPLIED = ['t', 'UI_STRINGS'];
/** Lifted declarations that may read UI_STRINGS: each reads only every pack's "misc.untitledBook". */
export const UI_STRINGS_READERS = ['imIsPlaceholderTitle'];
/** Never lifted: the string tables and the interface language (the studio owns those). */
const FORBIDDEN = /^(UI_STRINGS|UI_LANG_ORDER|UI_LANG_NAMES|UI_PLURAL_FORMS|[A-Z][A-Z0-9_]*_STRINGS|uiLangState|tCountForm|uiPluralCategory|uiPluralRulesCache)$/;

const fail = (msg) => {
  throw new Error(`extract-closure: ${msg}`);
};

let closureMod = null;
async function studioClosure() {
  if (closureMod) return closureMod;
  const studioPkg = pathToFileURL(path.join(STUDIO, 'package.json')).href;
  const hook = `export async function resolve(spec, ctx, next) {
    if (spec === 'typescript' && ctx.parentURL && ctx.parentURL.endsWith('/src/book/studio/closure.ts')) return next(spec, { ...ctx, parentURL: ${JSON.stringify(studioPkg)} });
    return next(spec, ctx);
  }`;
  register('data:text/javascript,' + encodeURIComponent(hook));
  closureMod = await import(pathToFileURL(path.join(REPO, 'src', 'book', 'studio', 'closure.ts')).href);
  return closureMod;
}

/** EPUB_ROOTS, EPUB_SUPPLIED (string arrays) and ARRIVE (a template literal), read out of src/book/epub/closure.ts. */
export function epubSpec(source) {
  const sf = ts.createSourceFile('epub-closure.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = {};
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const name = d.name.text;
      if ((name === 'EPUB_ROOTS' || name === 'EPUB_SUPPLIED') && ts.isArrayLiteralExpression(d.initializer)) {
        const items = d.initializer.elements.map((e) => (ts.isStringLiteral(e) ? e.text : null));
        if (items.includes(null)) fail(`src/book/epub/closure.ts ${name} is no longer a list of plain strings`);
        found[name] = items;
      } else if (name === 'ARRIVE' && ts.isNoSubstitutionTemplateLiteral(d.initializer)) {
        found.ARRIVE = d.initializer.text;
      }
    }
  }
  for (const k of ['EPUB_ROOTS', 'EPUB_SUPPLIED', 'ARRIVE']) if (!found[k]) fail(`src/book/epub/closure.ts no longer declares ${k}`);
  return found;
}

const declName = (code) => {
  const m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(code.trim());
  return m ? m[1] || m[2] : null;
};

/** The generated module's source for this studio file. */
export async function buildClosureModule(html, epubSource) {
  const { extractStudioSource, reachableFrom } = await studioClosure();
  const spec = epubSpec(epubSource);
  const roots = [...spec.EPUB_ROOTS, ...EXTRA_ROOTS];
  const supplied = [...spec.EPUB_SUPPLIED, ...BROWSER_SUPPLIED];
  const names = reachableFrom(html, roots, supplied);
  const forbidden = names.filter((n) => FORBIDDEN.test(n));
  if (forbidden.length) fail(`the lifted code reaches ${forbidden.join(', ')}, which the browser studio does not lift (supply it, or change the roots)`);
  let src;
  try {
    // extractStudioSource throws naming every root (or reached name) client/index.html no longer declares
    src = extractStudioSource(html, [...new Set([...roots, ...names])], { listRef: 'studio/scripts/extract-closure.mjs ROOTS', api: '', stringTables: false });
  } catch (e) {
    fail(e.message);
  }
  // each lifted statement, to check who reads UI_STRINGS
  const lifted = ts.createSourceFile('closure.js', src.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const readers = [];
  for (const st of lifted.statements) {
    let hit = false;
    const walk = (n) => {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === 'UI_STRINGS') hit = true;
      else ts.forEachChild(n, walk);
    };
    walk(st);
    if (hit) readers.push(declName(st.getText(lifted)) || '(unnamed)');
  }
  const strayReaders = readers.filter((n) => !UI_STRINGS_READERS.includes(n));
  if (strayReaders.length) fail(`UI_STRINGS is read by ${strayReaders.join(', ')}: only ${UI_STRINGS_READERS.join(', ')} may (the browser supplies a table of "misc.untitledBook" alone)`);
  const api = [...new Set(roots)].filter((n) => src.names.includes(n));
  const head = [
    '/* GENERATED by studio/scripts/extract-closure.mjs from client/index.html — do not edit.',
    `   ${src.names.length} top-level declarations (${src.lines} lines) of 1.0's own code, reached from the roots below;`,
    `   studio sha256 ${src.studioSha}. */`,
    '/* eslint-disable */',
    `export const CLOSURE_NAMES = ${JSON.stringify(src.names)};`,
    `export const CLOSURE_ROOTS = ${JSON.stringify(api)};`,
    `export const CLOSURE_SUPPLIED = ${JSON.stringify(supplied)};`,
    `export const STUDIO_SHA = ${JSON.stringify(src.studioSha)};`,
    'export function createClosure(env) {',
    '  let state = env.state;',
    ...supplied.filter((n) => n !== 'state').map((n) => `  const ${n} = env.${n};`),
  ].join('\n');
  const tail = [
    '',
    `  return { api: { ${api.join(', ')} }, setState: (s) => { state = s; }, getState: () => state, arrive: ${spec.ARRIVE} };`,
    '}',
    '',
  ].join('\n');
  return { code: head + '\n' + src.code + tail, names: src.names, roots: api, supplied };
}

/** The module's types (the functions are 1.0's untyped code: src/closure/index.ts gives the ones 2.0 calls their types). */
const DTS = `/* GENERATED by studio/scripts/extract-closure.mjs — do not edit. */
export declare const CLOSURE_NAMES: string[];
export declare const CLOSURE_ROOTS: string[];
export declare const CLOSURE_SUPPLIED: string[];
export declare const STUDIO_SHA: string;
export type ClosureEnv = { state: unknown; toast: (msg: string, icon?: string) => void; samplePicsRequire: () => Promise<unknown>; JSZip: unknown; t: (key: string, params?: Record<string, unknown>) => string; UI_STRINGS: Record<string, Record<string, string>> };
export declare function createClosure(env: ClosureEnv): { api: Record<string, (...args: any[]) => any> & Record<string, any>; setState(s: unknown): void; getState(): any; arrive(s: unknown): any };
`;

export async function writeClosure() {
  const html = readFileSync(path.join(REPO, 'client', 'index.html'), 'utf8');
  const epub = readFileSync(path.join(REPO, 'src', 'book', 'epub', 'closure.ts'), 'utf8');
  const out = await buildClosureModule(html, epub);
  const dir = path.join(STUDIO, 'src', 'generated');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'closure.js'), out.code);
  writeFileSync(path.join(dir, 'closure.d.ts'), DTS);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeClosure()
    .then((o) => console.log(`extract-closure: ${o.names.length} declarations, ${o.roots.length} roots → src/generated/closure.js`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
