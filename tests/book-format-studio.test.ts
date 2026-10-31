import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

/* BEUK:book-format-studio — the one change to the live 1.0 studio: its
   serializeBook writes `formatVersion: 1`, and bookDocsSame ignores that key
   so a shelf copy saved before the change still equals the desk's new
   serialization (no false 409 conflict, no false sign-in conflict). The
   functions are lifted out of client/index.html with the TypeScript API and
   run in a vm sandbox (the technique of tests/book-upgrade.test.ts). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
const SCRIPT = (() => {
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>\n/g)) if (m[1]!.includes('function serializeBook')) return m[1]!;
  throw new Error('no inline <script> in client/index.html declares serializeBook');
})();
const sf = ts.createSourceFile('studio.js', SCRIPT, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

/** The first function declaration or const named `name`, wherever it nests. */
function find(name: string): ts.Node {
  let hit: ts.Node | undefined;
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) hit = n;
    else if (ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)) hit = n;
    else ts.forEachChild(n, walk);
  };
  walk(sf);
  assert.ok(hit, `the studio script declares ${name}`);
  return hit;
}
const src = (name: string) => find(name).getText(sf);

type Doc = Record<string, unknown>;
function same(): (a: unknown, b: unknown) => boolean {
  const sandbox: Record<string, unknown> = { JSON, Array, Object };
  vm.createContext(sandbox);
  vm.runInContext(`${src('stableJson')}\n${src('bookDocsSame')}\nthis.f = bookDocsSame;`, sandbox);
  return sandbox.f as (a: unknown, b: unknown) => boolean;
}
const book = (): Doc => ({ meta: { title: 'T', bookId: 'urn:uuid:x' }, sections: [{ id: 's1', title: 'One', type: 'chapter' }], activeId: 's1' });

test('studio: serializeBook writes formatVersion: 1 as its first key', () => {
  const fn = find('serializeBook') as ts.FunctionDeclaration;
  const ret = [...fn.body!.statements].reverse().find((s): s is ts.ReturnStatement => ts.isReturnStatement(s))!;
  const first = (ret.expression as ts.ObjectLiteralExpression).properties[0] as ts.PropertyAssignment;
  assert.ok(ts.isPropertyAssignment(first) && ts.isIdentifier(first.name) && first.name.text === 'formatVersion', 'first property is formatVersion');
  assert.ok(ts.isNumericLiteral(first.initializer) && first.initializer.text === '1', 'its value is the literal 1');
});

test('studio: bookDocsSame treats a shelf doc without formatVersion and the same doc with formatVersion: 1 as the same', () => {
  const f = same();
  const shelf = book();
  const desk = { formatVersion: 1, ...book() };
  assert.equal(f(shelf, desk), true);
  assert.equal(f(desk, shelf), true);
  assert.equal(f(desk, { ...book(), formatVersion: 1 }), true);
});

test('studio: bookDocsSame still sees a real difference (a changed section title) as different', () => {
  const f = same();
  const other = book();
  (other.sections as Doc[])[0]!.title = 'Two';
  assert.equal(f({ formatVersion: 1, ...book() }, { formatVersion: 1, ...other }), false);
  assert.equal(f(book(), { formatVersion: 1, ...other }), false);
  assert.equal(f(null, book()), false);
});

test('studio: bookDocsSame does not mutate its arguments', () => {
  const f = same();
  const d = { formatVersion: 1, ...book() };
  f(d, book());
  assert.equal(d.formatVersion, 1);
});

test('studio: applyBookDoc ignores formatVersion (it reads keys by name; no wholesale copy of doc)', () => {
  const body = (find('applyBookDoc') as ts.FunctionDeclaration).body!.getText(sf);
  assert.ok(!/formatVersion/.test(body), 'applyBookDoc never mentions formatVersion');
  assert.ok(!/Object\.assign\(\s*state\s*,/.test(body), 'no Object.assign(state, ...)');
  assert.ok(!/Object\.(keys|entries)\(\s*doc\s*\)|\bin\s+doc\b|\.\.\.\s*doc\b/.test(body), 'no iteration or spread over doc');
  assert.match(body, /state\.printNotes = doc\.printNotes/, 'it assigns state fields from named doc keys');
});
