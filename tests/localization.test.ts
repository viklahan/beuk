import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

/* BEUK:l10n — the localization guard (V, 2026-10-30). Two kinds of
   language, both read straight out of the real code on every run:

   - interface languages: UI_STRINGS, the studio's own voice in the
     UI_LANG_ORDER locales. The in-browser ui.packs.complete self-check
     says the same thing, but only when someone opens the self-check
     window; this runs on every `npm test`.
   - book languages: LANG_PACKS, and every table that must agree with
     it — dictation codes, the detector, the script faces, and the
     server's rough word count in src/account/data.ts.

   Pages that carry no translation at all are listed in
   tests/fixtures/l10n-english-only.json: known debt. A NEW page that
   is not on the list fails here until it is translated or added to
   the list on purpose. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');

/* The studio's main inline script: the one that declares UI_STRINGS. */
const MAIN = (() => {
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>\n/g)) {
    if (m[1].includes('const UI_STRINGS = {')) return { js: m[1], line: html.slice(0, m.index).split('\n').length };
  }
  throw new Error('no inline <script> in client/index.html declares UI_STRINGS');
})();
const sf = ts.createSourceFile('studio.js', MAIN.js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + MAIN.line;

const STRING_TABLE = /^(UI_STRINGS|UI_LANG_ORDER|UI_LANG_NAMES|[A-Z][A-Z0-9_]*_STRINGS)$/;
const BOOK_TABLE = /^(LANG_PACKS|DICT_LANGS|STOPWORDS|SCRIPT_FONTS)$/;

/** Does this expression write into a string table? Object.assign(UI_STRINGS…),
 *  UI_STRINGS[x] = …, and the Object.keys(X_STRINGS).forEach merge idiom. */
function writesTable(e: ts.Expression): boolean {
  const root = (x: ts.Expression): string => {
    while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) x = x.expression;
    return ts.isIdentifier(x) ? x.text : '';
  };
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) return STRING_TABLE.test(root(e.left));
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText(sf);
    if (callee === 'Object.assign') return STRING_TABLE.test(root(e.arguments[0]));
    const m = /^Object\.keys\((\w+)\)\.forEach$/.exec(callee);
    if (m) return STRING_TABLE.test(m[1]);
  }
  return false;
}
/** The rows idiom: [["es", …], …].forEach(([lang, …]) => Object.assign(UI_STRINGS[lang], …)). */
function rowsWriteTable(e: ts.Expression): boolean {
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'forEach') return false;
  if (!ts.isArrayLiteralExpression(e.expression.expression)) return false;
  let found = false;
  (function walk(n: ts.Node) {
    if (!found && ts.isExpression(n) && writesTable(n)) found = true;
    ts.forEachChild(n, walk);
  })(e);
  return found;
}

/* Every top-level statement that builds a table, evaluated in order in
   a bare sandbox. A statement that fails to evaluate fails the guard —
   a silently skipped statement would hide keys. */
const tables = (() => {
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  const taken: ts.Statement[] = [];
  for (const st of sf.statements) {
    let take = false;
    if (ts.isVariableStatement(st)) {
      take = st.declarationList.declarations.some((d) => STRING_TABLE.test(d.name.getText(sf)) || BOOK_TABLE.test(d.name.getText(sf)));
    } else if (ts.isExpressionStatement(st)) take = writesTable(st.expression) || rowsWriteTable(st.expression);
    if (!take) continue;
    taken.push(st);
    const code = st.getText(sf).replace(/^(const|let)\s/, 'var ');
    try {
      vm.runInContext(code, sandbox);
    } catch (e) {
      throw new Error(`client/index.html:${lineOf(st)} — a string-table statement does not evaluate on its own: ${(e as Error).message}`);
    }
  }
  return { sandbox, taken };
})();
/* Copied out of the sandbox's realm, so strict deep-equal compares
   plain values (SCRIPT_FONTS loses its regexes; only langs is read). */
const plain = <T>(name: string): T => JSON.parse(JSON.stringify(tables.sandbox[name] ?? null)) as T;

type Pack = Record<string, string>;
const UI = plain<Record<string, Pack>>('UI_STRINGS');
const UI_ORDER = plain<string[]>('UI_LANG_ORDER');
const UI_NAMES = plain<Record<string, string>>('UI_LANG_NAMES');
type LangPack = { name: string; native: string; dq: string[]; sq: string[]; count: string; rtl?: boolean };
const LANG_PACKS = plain<Record<string, LangPack>>('LANG_PACKS');
const DICT_LANGS = plain<Record<string, string>>('DICT_LANGS');
const STOPWORDS = plain<Record<string, string[]>>('STOPWORDS');
const SCRIPT_FONTS = plain<Record<string, { langs: string[] }>>('SCRIPT_FONTS');
const BOOK_CODES = Object.keys(LANG_PACKS ?? {});
const placeholders = (s: string) => new Set(s.match(/\{\w+\}/g) ?? []);
const fnNamed = (name: string) => {
  const f = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert.ok(f, `client/index.html declares function ${name}`);
  return f;
};
const stringLiterals = (n: ts.Node) => {
  const out: string[] = [];
  (function walk(x: ts.Node) {
    if (ts.isStringLiteral(x)) out.push(x.text);
    ts.forEachChild(x, walk);
  })(n);
  return out;
};

/* ------------------------------------------------ extraction itself */

test('l10n: every write into a string table is a top-level statement the guard evaluates', () => {
  // A write tucked inside a function would add keys at runtime that this
  // guard never sees; keep the tables declarative, or teach the guard.
  const hidden: number[] = [];
  const inTaken = (n: ts.Node) => tables.taken.some((t) => n.pos >= t.pos && n.end <= t.end);
  (function walk(n: ts.Node) {
    if ((ts.isBinaryExpression(n) || ts.isCallExpression(n)) && !inTaken(n) && writesTable(n)) hidden.push(lineOf(n));
    ts.forEachChild(n, walk);
  })(sf);
  assert.deepEqual(hidden, [], `string-table writes outside top-level statements at client/index.html lines ${hidden.join(', ')}`);
  for (const t of ['UI_STRINGS', 'UI_LANG_ORDER', 'UI_LANG_NAMES', 'LANG_PACKS', 'DICT_LANGS', 'STOPWORDS', 'SCRIPT_FONTS']) {
    assert.ok(tables.sandbox[t], `${t} was found and evaluated`);
  }
});

/* ------------------------------------------------ interface languages */

test('l10n ui: every interface language carries every English key, non-empty, with no extras', () => {
  const keys = Object.keys(UI.en);
  assert.ok(keys.length > 1000, `English pack has ${keys.length} keys — the extractor lost most of them`);
  const gaps: string[] = [];
  for (const loc of UI_ORDER) {
    const pack = UI[loc];
    if (!pack) { gaps.push(`${loc}: pack missing`); continue; }
    for (const k of keys) if (typeof pack[k] !== 'string' || !pack[k].trim()) gaps.push(`${loc}: missing ${k}`);
    for (const k of Object.keys(pack)) if (!(k in UI.en)) gaps.push(`${loc}: extra ${k} (not in English)`);
  }
  assert.deepEqual(gaps.slice(0, 40), [], `${gaps.length} gaps across ${UI_ORDER.length} locales`);
});

test('l10n ui: no translation introduces a {placeholder} English does not have', () => {
  // Dropping one is allowed — an Arabic singular says "one book", not
  // "{n} book" — but a placeholder English never fills prints raw.
  const bad: string[] = [];
  for (const loc of UI_ORDER) {
    for (const [k, s] of Object.entries(UI[loc] ?? {})) {
      const en = placeholders(UI.en[k] ?? '');
      for (const p of placeholders(s)) if (!en.has(p)) bad.push(`${loc}:${k} has ${p}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('l10n ui: every key the studio names literally exists in the English pack', () => {
  const used = new Map<string, string>();
  const keyShape = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;
  // Markup outside the script, plus the script's own string and template
  // text (where it builds markup) — never its comments.
  const scriptText: string[] = [];
  (function walk(n: ts.Node) {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) scriptText.push(n.text);
    else if (ts.isTemplateExpression(n)) scriptText.push(n.getText(sf));
    ts.forEachChild(n, walk);
  })(sf);
  const markup = html.replace(MAIN.js, '') + '\n' + scriptText.join('\n');
  for (const m of markup.matchAll(/data-(i18n(?:-[a-z]+)?|tip)="([^"]+)"/g)) if (keyShape.test(m[2])) used.set(m[2], `data-${m[1]}`);
  for (const m of MAIN.js.matchAll(/\bt\(\s*"([^"]+)"\s*[,)]/g)) if (keyShape.test(m[1])) used.set(m[1], 't()');
  const dangling = [...used].filter(([k]) => !(k in UI.en)).map(([k, via]) => `${k} (${via})`);
  assert.ok(used.size > 1000, `found ${used.size} key uses — the scan lost most of them`);
  assert.deepEqual(dangling, []);
});

test('l10n ui: every interface language has a name, a book-language pack and a dictation code', () => {
  assert.deepEqual(Object.keys(UI_NAMES).sort(), [...UI_ORDER].sort(), 'UI_LANG_NAMES names exactly the UI_LANG_ORDER locales');
  assert.equal(UI_ORDER[0], 'en', 'English is the source locale');
  for (const loc of UI_ORDER) {
    assert.ok(UI_NAMES[loc]?.trim(), `${loc} has a display name`);
    // Dictation falls back to the interface language, so it must be one the recogniser knows.
    assert.ok(LANG_PACKS[loc], `${loc} has a LANG_PACKS entry`);
    assert.ok(DICT_LANGS[loc], `${loc} has a DICT_LANGS recognition code`);
  }
});

test('l10n ui: the chrome turns right-to-left for exactly the RTL interface languages', () => {
  const apply = fnNamed('applyUiLang');
  let dirCall: ts.CallExpression | undefined;
  (function walk(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(sf).endsWith('.setAttribute') && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === 'dir') dirCall = n;
    ts.forEachChild(n, walk);
  })(apply);
  assert.ok(dirCall, 'applyUiLang sets the document direction');
  const expr = dirCall.arguments[1].getText(sf);
  const want = UI_ORDER.filter((c) => LANG_PACKS[c]?.rtl).sort();
  if (/\bisRtlLang\(/.test(expr)) return; // driven by LANG_PACKS: right by construction
  const named = stringLiterals(dirCall.arguments[1]).filter((s) => s in LANG_PACKS).sort();
  assert.deepEqual(named, want, `applyUiLang's direction rule (${expr}) must name every RTL interface language`);
});

/* ------------------------------------------------ book languages */

test('l10n book: every language pack is complete', () => {
  assert.ok(BOOK_CODES.length >= 30, `${BOOK_CODES.length} book languages — the extractor lost most of them`);
  for (const [code, p] of Object.entries(LANG_PACKS)) {
    assert.match(code, /^[a-z]{2,3}(-[A-Z][a-z]{3}|-[A-Z]{2})?$/, `${code} is a BCP 47 tag`);
    assert.ok(p.name?.trim() && p.native?.trim(), `${code} has an English and a native name`);
    for (const q of ['dq', 'sq'] as const) {
      assert.ok(Array.isArray(p[q]) && p[q].length === 2 && p[q].every((s) => typeof s === 'string' && s.length > 0), `${code}.${q} is an open/close pair`);
    }
    assert.ok(p.count === 'words' || p.count === 'characters', `${code}.count is words or characters`);
    assert.ok(p.rtl === undefined || p.rtl === true, `${code}.rtl is true or absent`);
  }
});

test('l10n book: dictation knows exactly the book languages', () => {
  assert.deepEqual(Object.keys(DICT_LANGS).sort(), [...BOOK_CODES].sort());
  for (const [code, rec] of Object.entries(DICT_LANGS)) assert.match(rec, /^[a-z]{2,3}-[A-Z]{2}$/, `${code} → ${rec} is a recogniser locale`);
});

test('l10n book: the server counts by characters for exactly the languages the studio does', () => {
  const src = readFileSync(path.join(ROOT, 'src', 'account', 'data.ts'), 'utf8');
  const m = /m\.doc->'meta'->>'language' in \(([^)]*)\)/.exec(src);
  assert.ok(m, "src/account/data.ts still names its character-counted languages in ROUGH_WORDS_SQL");
  const server = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const studio = BOOK_CODES.filter((c) => LANG_PACKS[c].count === 'characters').sort();
  assert.deepEqual(server, studio, 'ROUGH_WORDS_SQL and LANG_PACKS disagree on which books are counted by characters');
});

test('l10n book: the detector, its function words and the script faces name only real book languages', () => {
  const det = ['detectLanguageInText', 'arabicScriptLang', 'cyrillicLang'].flatMap((f) => stringLiterals(fnNamed(f)));
  const tagShape = /^[a-z]{2}(-(Hans|Hant|[A-Z]{2}))?$/;
  const named = new Set(det.filter((s) => tagShape.test(s)));
  for (const c of named) assert.ok(LANG_PACKS[c], `the detector names ${c}, which has no LANG_PACKS entry`);
  for (const c of Object.keys(STOPWORDS)) {
    assert.ok(LANG_PACKS[c], `STOPWORDS.${c} has no LANG_PACKS entry`);
    assert.ok(named.has(c), `STOPWORDS.${c} is never offered to the detector as a candidate`);
  }
  for (const [script, f] of Object.entries(SCRIPT_FONTS)) {
    // A face may cover languages Beuk does not list yet (Marathi, Nepali, Sanskrit share Devanagari).
    assert.ok(f.langs.some((c) => LANG_PACKS[c]), `SCRIPT_FONTS.${script} covers no book language at all`);
  }
});

test('l10n book: every book language can be detected, or is listed as pick-by-hand', () => {
  // Detection can't tell en-GB from en by its words; the writer picks it.
  const PICK_BY_HAND = ['en-GB'];
  const det = ['detectLanguageInText', 'arabicScriptLang', 'cyrillicLang'].flatMap((f) => stringLiterals(fnNamed(f)));
  const reach = new Set(det.filter((s) => s in LANG_PACKS));
  const unreachable = BOOK_CODES.filter((c) => !reach.has(c) && !PICK_BY_HAND.includes(c));
  assert.deepEqual(unreachable, [], 'add detection for these, or list them in PICK_BY_HAND on purpose');
  for (const c of PICK_BY_HAND) assert.ok(LANG_PACKS[c], `PICK_BY_HAND names ${c}, which is not a book language any more`);
});

/* ------------------------------------------------ pages */

type Ledger = { note: string; pages: Record<string, string> };
const LEDGER_PATH = path.join(ROOT, 'tests', 'fixtures', 'l10n-english-only.json');
/* Not pages a writer reads: test fixtures for the admin surface. */
const NOT_PAGES = new Set(['src/housekeeping/fixtures.ts']);

function walk(dir: string, keep: (rel: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name.startsWith('_') || name.startsWith('.') || name === 'node_modules') continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, keep, out);
    else if (keep(rel)) out.push(rel);
  }
  return out;
}
/** Every page a writer can land on: the static HTML under client/ and
 *  every server module that renders a whole document. */
function pages(): string[] {
  const statics = walk('client', (r) => r.endsWith('.html'));
  const rendered = walk('src', (r) => r.endsWith('.ts') && /<!doctype html/i.test(readFileSync(path.join(ROOT, r), 'utf8')));
  return [...statics, ...rendered].filter((p) => !NOT_PAGES.has(p)).sort();
}
const translated = (rel: string) => /data-i18n|UI_STRINGS|\bt\(\s*["'`]/.test(readFileSync(path.join(ROOT, rel), 'utf8'));

test('l10n pages: a page with no translation is on the English-only ledger, on purpose', () => {
  assert.ok(existsSync(LEDGER_PATH), 'tests/fixtures/l10n-english-only.json exists');
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  const all = pages();
  assert.ok(all.includes('client/index.html'), 'the page scan finds the studio');
  assert.ok(translated('client/index.html'), 'the studio is translated');
  const untranslated = all.filter((p) => !translated(p));
  const unlisted = untranslated.filter((p) => !(p in ledger.pages));
  assert.deepEqual(unlisted, [], 'new English-only pages: translate them, or add them to the ledger with a reason');
  const stale = Object.keys(ledger.pages).filter((p) => !untranslated.includes(p));
  assert.deepEqual(stale, [], 'ledger entries that are gone or now translated: take them off the ledger');
  for (const [p, why] of Object.entries(ledger.pages)) assert.ok(why.trim(), `${p} has a reason on the ledger`);
});
