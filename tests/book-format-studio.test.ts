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
const book0 = (): Doc => ({ meta: { title: 'T', bookId: 'urn:uuid:x' }, sections: [{ id: 's1', title: 'One', type: 'chapter' }], activeId: 's1' });

test('studio: serializeBook writes formatVersion: 1 as its first key', () => {
  const fn = find('serializeBook') as ts.FunctionDeclaration;
  const ret = [...fn.body!.statements].reverse().find((s): s is ts.ReturnStatement => ts.isReturnStatement(s))!;
  const first = (ret.expression as ts.ObjectLiteralExpression).properties[0] as ts.PropertyAssignment;
  assert.ok(ts.isPropertyAssignment(first) && ts.isIdentifier(first.name) && first.name.text === 'formatVersion', 'first property is formatVersion');
  assert.ok(ts.isNumericLiteral(first.initializer) && first.initializer.text === '1', 'its value is the literal 1');
});

test('studio: bookDocsSame treats a shelf doc without formatVersion and the same doc with formatVersion: 1 as the same', () => {
  const f = same();
  const shelf = book0();
  const desk = { formatVersion: 1, ...book0() };
  assert.equal(f(shelf, desk), true);
  assert.equal(f(desk, shelf), true);
  assert.equal(f(desk, { ...book0(), formatVersion: 1 }), true);
});

test('studio: bookDocsSame still sees a real difference (a changed section title) as different', () => {
  const f = same();
  const other = book0();
  (other.sections as Doc[])[0]!.title = 'Two';
  assert.equal(f({ formatVersion: 1, ...book0() }, { formatVersion: 1, ...other }), false);
  assert.equal(f(book0(), { formatVersion: 1, ...other }), false);
  assert.equal(f(null, book0()), false);
});

test('studio: bookDocsSame does not mutate its arguments', () => {
  const f = same();
  const d = { formatVersion: 1, ...book0() };
  f(d, book0());
  assert.equal(d.formatVersion, 1);
});

test('studio: applyBookDoc ignores formatVersion (it reads keys by name; no wholesale copy of doc)', () => {
  const body = (find('applyBookDoc') as ts.FunctionDeclaration).body!.getText(sf);
  assert.ok(!/formatVersion/.test(body), 'applyBookDoc never mentions formatVersion');
  assert.ok(!/Object\.assign\(\s*state\s*,/.test(body), 'no Object.assign(state, ...)');
  assert.ok(!/Object\.(keys|entries)\(\s*doc\s*\)|\bin\s+doc\b|\.\.\.\s*doc\b/.test(body), 'no iteration or spread over doc');
  /* the lines that show it reads top-level keys by name (client/index.html @03c1928; this branch shifts the numbers at HEAD):
     the function is applyBookDoc(doc, opts) { ... } at 50199-50339 @03c1928; inside it
     50285 `state.printMarginMode = doc.printMarginMode`, 50300 `state.printNotes = doc.printNotes ...`,
     50301 `state.goals = normalizeGoals(doc.goals)`, 50310 `normalizeHistory(doc.history, doc.historyPool)`,
     50317 `acxNormalize(doc.audio)`, 50319 `msNormalize(doc.manuscript)`, 50323 `bibleNormalize(doc.bible)`.
     An unknown top-level key such as formatVersion is therefore never read. */
  assert.match(body, /state\.printNotes = doc\.printNotes/, 'client/index.html:50300 @03c1928 assigns state.printNotes from doc.printNotes by name');
  assert.match(body, /state\.goals = normalizeGoals\(doc\.goals\)/, 'client/index.html:50301 @03c1928 reads doc.goals by name');
  assert.match(body, /state\.audio = acxNormalize\(doc\.audio\)/, 'client/index.html:50317 @03c1928 reads doc.audio by name');
});

test('studio: a sample fingerprint stored before formatVersion equals the new one (sampleLoadedJsonNormal / sampleComparableJson)', () => {
  const book = (title: string): Doc => ({ ...book0(), sections: [{ id: 's1', title, type: 'chapter', content: 'x' }] });
  const sandbox: Record<string, unknown> = { JSON, Array, Object, state: {} };
  vm.createContext(sandbox);
  let cur: Doc = book('One');
  sandbox.serializeBook = () => JSON.parse(JSON.stringify(cur));
  sandbox.samplePicsStrip = () => undefined;
  vm.runInContext(`${src('stableJson')}
${src('sampleComparableJson')}
${src('sampleLoadedJsonNormal')}
this.api = { sampleComparableJson, sampleLoadedJsonNormal };`, sandbox);
  const api = sandbox.api as { sampleComparableJson(): string; sampleLoadedJsonNormal(s: string): string };
  const old = api.sampleComparableJson(); /* what a device record saved before this change holds: the comparable form of a book with no formatVersion */
  cur = { formatVersion: 1, ...book('One') };
  assert.equal(api.sampleLoadedJsonNormal(old), api.sampleComparableJson(), 'old fingerprint equals the new serialization of the same book');
  assert.equal(api.sampleLoadedJsonNormal(JSON.stringify({ formatVersion: 1, ...JSON.parse(old) })), api.sampleComparableJson(), 'a fingerprint that carries formatVersion also matches');
  cur = { formatVersion: 1, ...book('Two') };
  assert.notEqual(api.sampleLoadedJsonNormal(old), api.sampleComparableJson(), 'a real edit still differs');
});
