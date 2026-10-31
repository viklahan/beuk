import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { OPTIONAL_TOP_LEVEL, TOP_LEVEL_KEYS } from '../src/book/schema.js';
import { STEPS } from '../src/book/upgrade.js';

/* BEUK:book-format-guard — the schema's twin of serializeBook cannot drift.
   serializeBook is parsed out of client/index.html with the TypeScript API
   (the technique of tests/localization.test.ts); its returned object
   literal gives the keys it writes, spreads included. docs/book-format.md
   must then name every key and every upgrade step.
   formatVersion lands in serializeBook in a later task; until then the
   guards accept it present or absent in serializeBook (FV_IN_SERIALIZE
   below is the one line that tightens). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
const readDoc = () => readFileSync(path.join(ROOT, 'docs', 'book-format.md'), 'utf8');

const SCRIPT = (() => {
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>\n/g)) if (m[1]!.includes('function serializeBook')) return m[1]!;
  throw new Error('no inline <script> in client/index.html declares serializeBook');
})();
const sf = ts.createSourceFile('studio.js', SCRIPT, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function propName(p: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.MethodDeclaration): string {
  const n = p.name;
  assert.ok(ts.isIdentifier(n) || ts.isStringLiteral(n), 'serializeBook keys are plain names');
  return n.text;
}

/** The keys of the object literal serializeBook returns: [always written, written conditionally via a spread]. */
function serializeKeys(): { always: string[]; conditional: string[] } {
  let fn: ts.FunctionDeclaration | undefined;
  const find = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'serializeBook') fn = n;
    else ts.forEachChild(n, find);
  };
  find(sf);
  assert.ok(fn?.body, 'serializeBook found');
  // the last top-level `return {...}` of the function body
  const ret = [...fn!.body!.statements].reverse().find((s): s is ts.ReturnStatement => ts.isReturnStatement(s));
  assert.ok(ret?.expression && ts.isObjectLiteralExpression(ret.expression), 'serializeBook ends in `return { ... }`');
  const always: string[] = [];
  const conditional: string[] = [];
  for (const p of (ret!.expression as ts.ObjectLiteralExpression).properties) {
    if (ts.isSpreadAssignment(p)) {
      // ...(cond ? { k: v } : {})
      let e: ts.Expression = p.expression;
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      assert.ok(ts.isConditionalExpression(e), 'a spread in serializeBook is `...(cond ? { k } : {})`');
      for (const branch of [e.whenTrue, e.whenFalse]) {
        let b: ts.Expression = branch;
        while (ts.isParenthesizedExpression(b)) b = b.expression;
        assert.ok(ts.isObjectLiteralExpression(b), 'both spread branches are object literals');
        for (const q of b.properties) {
          assert.ok(!ts.isSpreadAssignment(q), 'no nested spread');
          conditional.push(propName(q as ts.PropertyAssignment));
        }
      }
    } else {
      always.push(propName(p as ts.PropertyAssignment));
    }
  }
  return { always, conditional };
}

const FV = 'formatVersion';
const sorted = (a: readonly string[]) => [...a].sort();

test('guard: serializeBook\'s keys equal TOP_LEVEL_KEYS (formatVersion present or absent until it lands)', () => {
  const { always, conditional } = serializeKeys();
  const keys = [...always, ...conditional];
  assert.equal(new Set(keys).size, keys.length, 'serializeBook writes no key twice');
  const expected = TOP_LEVEL_KEYS.filter((k) => k !== FV);
  const got = keys.filter((k) => k !== FV);
  assert.deepEqual(sorted(got), sorted(expected),
    'serializeBook and TOP_LEVEL_KEYS disagree: a key was added or removed in client/index.html, so update src/book/schema.ts and docs/book-format.md');
});

test('guard: keys serializeBook writes conditionally are exactly OPTIONAL_TOP_LEVEL minus formatVersion', () => {
  const { conditional } = serializeKeys();
  assert.deepEqual(sorted(conditional.filter((k) => k !== FV)), sorted(OPTIONAL_TOP_LEVEL.filter((k) => k !== FV)));
});

test('guard: docs/book-format.md has one table row per TOP_LEVEL_KEYS entry and one section per STEPS name', () => {
  const doc = readDoc();
  // the nested-structures table repeats some key names, so rows are counted in the top-level section only
  const top = /^## Top-level keys\s*$/m.exec(doc);
  assert.ok(top, 'the doc has a "Top-level keys" heading');
  const after = doc.slice(top.index + top[0].length);
  const end = after.search(/^## /m);
  const topSection = end < 0 ? after : after.slice(0, end);
  for (const k of TOP_LEVEL_KEYS) {
    const rows = topSection.split('\n').filter((l) => l.startsWith(`| \`${k}\` |`));
    assert.equal(rows.length, 1, `docs/book-format.md needs exactly one table row for top-level key ${k} (found ${rows.length})`);
  }
  for (const s of STEPS) {
    const heads = doc.split('\n').filter((l) => /^###\s/.test(l) && l.includes(`\`${s.name}\``));
    assert.equal(heads.length, 1, `docs/book-format.md needs exactly one "### \`${s.name}\`" section (found ${heads.length})`);
  }
});

test('guard: docs/book-format.md lists every place readBook differs from applyBookDoc (heading "Where readBook differs from 1.0")', () => {
  const doc = readDoc();
  const m = /^## Where readBook differs from 1\.0\s*$/m.exec(doc);
  assert.ok(m, 'the doc has a "Where readBook differs from 1.0" heading');
  const rest = doc.slice(m.index + m[0].length);
  const section = rest.slice(0, rest.search(/^## /m) < 0 ? undefined : rest.search(/^## /m));
  const items = section.split('\n').filter((l) => /^\d+\.\s/.test(l));
  const need: [string, RegExp][] = [
    ['sections-split opens', /sections-split/],
    ['over-limit values stay with a warning', /over.?limit/i],
    ['unusable values go to preserved', /preserved/],
    ['missing meta.year', /meta\.year/],
    ['inherited-key language codes', /constructor/],
    ['the reader is pure (no desk behaviour)', /pure/i],
    ['sections-missing records the replaced activeId', /sections-missing/],
    ['record-only steps fire on every read', /recordOnly/],
  ];
  assert.equal(items.length, need.length, `expected ${need.length} numbered differences, found ${items.length}`);
  for (const [what, re] of need) assert.ok(items.some((l) => re.test(l)), `the differences list covers: ${what}`);
  assert.match(section, /bookid-sample/, 'the section notes bookid-sample maps only lantern-coast');
});
