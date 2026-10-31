import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { fixturePath } from './book-fixtures.js';
import { readBook } from '../src/book/read.js';
import { toDoc } from '../src/book/editor/convert.js';
import { BODY, BookImportError, LAYOUT, META, SECTIONS, exportBook, fragmentText, importBook } from '../src/book/editor/model.js';

/* BEUK:editor-model — a book goes into one Y.Doc and comes back as the same
   book: readBook(exportAny(importBook(doc))).book deep-equals
   readBook(doc).book for every fixture, legacy ones included. Editing one
   chapter changes only that chapter's content; the Yjs update is the
   persistence shape; concurrent edits to different chapters merge. */

type Rec = Record<string, any>;
const exportAny = (d: Y.Doc): Rec => exportBook(d);

function fixtureEnvelopes(): { name: string; env: Rec }[] {
  const out: { name: string; env: Rec }[] = [];
  for (const dir of ['real', 'legacy'])
    for (const f of readdirSync(fixturePath(dir)).filter((x) => x.endsWith('.json')).sort())
      out.push({ name: `${dir}/${f}`, env: JSON.parse(readFileSync(fixturePath(dir, f), 'utf8')) as Rec });
  return out;
}

/** readBook mints a fresh bookId for a book without one (the bookid-missing step), so two reads of such a book differ there and only there. */
function sameMintedId(expected: Rec, actual: Rec, upgrades: string[]): Rec {
  if (!upgrades.includes('bookid-missing')) return expected;
  assert.match(String(actual.meta.bookId), /^urn:uuid:/);
  const e = structuredClone(expected);
  e.meta.bookId = actual.meta.bookId;
  return e;
}

const contentIndexes = (book: Rec): number[] =>
  (book.sections as Rec[]).map((s, i) => (typeof s?.content === 'string' && s.content.length > 0 ? i : -1)).filter((i) => i >= 0);

/** Replace a section's text the way an editor does: y-prosemirror diffs the new document into the existing fragment. */
function editSection(ydoc: Y.Doc, i: number, text: string): void {
  const m = ydoc.getArray<Y.Map<unknown>>(SECTIONS).get(i);
  prosemirrorToYXmlFragment(toDoc(text), m.get(BODY) as Y.XmlFragment);
}

test('model: every fixture book round-trips through the Y.Doc (readBook(exportAny(importBook(doc))).book equals readBook(doc).book)', (t) => {
  let books = 0;
  for (const { name, env } of fixtureEnvelopes()) {
    const a = readBook(env.book);
    assert.equal(a.status, 'ok', name);
    const imp = importBook(env.book);
    assert.equal(imp.status, 'ok', name);
    const exported = exportAny(imp.ydoc);
    // exportBook gives back exactly the book readBook read, keys in the same order
    const expected = sameMintedId(a.book as unknown as Rec, exported, a.upgrades);
    assert.deepStrictEqual(exported, expected, name);
    assert.equal(JSON.stringify(exported), JSON.stringify(expected), `${name}: key order`);
    // and reading the export again changes nothing
    const b = readBook(exported);
    assert.equal(b.status, 'ok', name);
    assert.deepStrictEqual(b.book, expected, name);
    // the persistence shape: a Yjs update applied to a fresh doc exports the same book
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(imp.ydoc));
    assert.deepStrictEqual(exportAny(fresh), exported, `${name}: through a Yjs update`);
    assert.equal(JSON.stringify(exportAny(fresh)), JSON.stringify(exported), `${name}: key order through a Yjs update`);
    books++;
  }
  t.diagnostic(`books ${books}`);
});

test('model: the Y.Doc layout is meta (JSON values), sections (Y.Maps with a body fragment), scenes as attributes', () => {
  const env = JSON.parse(readFileSync(fixturePath('real', 'reads-you.json'), 'utf8')) as Rec;
  const { ydoc } = importBook(env.book);
  const meta = ydoc.getMap(META), sections = ydoc.getArray(SECTIONS);
  assert.ok(!meta.has('sections'));
  assert.deepStrictEqual(meta.get('meta'), readBook(env.book).book.meta);
  assert.ok(Array.isArray(ydoc.getMap(LAYOUT).get('keys')));
  const s0 = sections.get(0) as Y.Map<unknown>;
  assert.ok(s0 instanceof Y.Map);
  assert.ok(s0.get(BODY) instanceof Y.XmlFragment);
  assert.equal(s0.has('content'), false);
  assert.ok(Array.isArray(s0.get('scenes')));
  assert.equal(fragmentText(s0.get(BODY) as Y.XmlFragment), env.book.sections[0].content);
});

test('model: a backup file imports as its book; a book readBook will not read as ok is refused', () => {
  const env = JSON.parse(readFileSync(fixturePath('real', 'reads-you.json'), 'utf8')) as Rec;
  assert.deepStrictEqual(exportAny(importBook(env).ydoc), exportAny(importBook(env.book).ydoc));
  const newer = { ...structuredClone(env.book), formatVersion: 2 };
  assert.throws(() => importBook(newer), (e: unknown) => e instanceof BookImportError && e.read.status === 'newer');
});

test('model: editing one chapter changes only that section\'s content; every other field, unknown keys included, is untouched', () => {
  const env = JSON.parse(readFileSync(fixturePath('real', 'dartagnan-01-three-musketeers.json'), 'utf8')) as Rec;
  const book = structuredClone(env.book) as Rec;
  // keys readBook carries loosely: an unknown top-level key, unknown section keys, and keys the model must escape
  book.zzUnknownTop = { nested: [1, { deep: 'x' }], nul: null };
  book.sections[3].zzUnknownSection = ['kept'];
  book.sections[3].body = 'a section key named body';
  book.sections[3]['~tilde'] = { t: 1 };
  book.sections[4].content = 7; // not a string: kept as a JSON value
  const before = readBook(book);
  assert.ok(before.warnings.some((w) => w.code === 'unknown-key' && w.path === 'zzUnknownTop'));
  const { ydoc } = importBook(book);
  const original = exportAny(ydoc);
  assert.deepStrictEqual(original, before.book);

  const idx = contentIndexes(original).find((i) => i > 5)!;
  const edited = original.sections[idx].content + '\n\nA new paragraph, *typed* in 2.0.';
  editSection(ydoc, idx, edited);
  const after = exportAny(ydoc);

  assert.equal(after.sections[idx].content, edited);
  const expect = structuredClone(original);
  expect.sections[idx].content = edited;
  assert.deepStrictEqual(after, expect);
  assert.equal(JSON.stringify(after), JSON.stringify(expect));
  assert.deepStrictEqual(after.zzUnknownTop, { nested: [1, { deep: 'x' }], nul: null });
  assert.equal(after.sections[3].body, 'a section key named body');
  assert.deepStrictEqual(after.sections[3]['~tilde'], { t: 1 });
  assert.deepStrictEqual(after.sections[3].zzUnknownSection, ['kept']);
  assert.equal(after.sections[4].content, 7);
});

test('model: two concurrent edits to different chapters merge', () => {
  const env = JSON.parse(readFileSync(fixturePath('real', 'valois-02-chicot.json'), 'utf8')) as Rec;
  const docA = importBook(env.book).ydoc;
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const base = exportAny(docA);
  const [i, j] = contentIndexes(base).slice(10, 12) as [number, number];
  const textA = '*Edited* on one device.\n\n' + base.sections[i].content;
  const textB = base.sections[j].content + '\n\n***\n\nEdited on **another**.';
  editSection(docA, i, textA);
  editSection(docB, j, textB);
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));
  const a = exportAny(docA), b = exportAny(docB);
  assert.deepStrictEqual(a, b);
  const expect = structuredClone(base);
  expect.sections[i].content = textA;
  expect.sections[j].content = textB;
  assert.deepStrictEqual(a, expect);
});

test('model: the Dumas book imports and exports in time', (t) => {
  const env = JSON.parse(readFileSync(fixturePath('real', 'dartagnan-01-three-musketeers.json'), 'utf8')) as Rec;
  const t0 = performance.now();
  const { ydoc } = importBook(env.book);
  const t1 = performance.now();
  const update = Y.encodeStateAsUpdate(ydoc);
  const t2 = performance.now();
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, update);
  const t3 = performance.now();
  const out = exportAny(fresh);
  const t4 = performance.now();
  assert.deepStrictEqual(out.sections.map((s: Rec) => s.content), env.book.sections.map((s: Rec) => s.content));
  t.diagnostic(`Dumas: importBook ${(t1 - t0).toFixed(0)} ms, encode ${(t2 - t1).toFixed(0)} ms (${update.length} bytes), apply ${(t3 - t2).toFixed(0)} ms, exportBook ${(t4 - t3).toFixed(0)} ms`);
  assert.ok(t4 - t0 < 15000, `Dumas import/export took ${(t4 - t0).toFixed(0)} ms (budget 15000 ms)`);
});

/* ---- the full corpus, when there is one ---- */

const corpusDir = process.env.BEUK_BOOK_CORPUS;
function* backupFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* backupFiles(full);
    else if (e.name.endsWith('.beuk-backup.json')) yield full;
  }
}

test('model: full corpus round-trips through the Y.Doc (BEUK_BOOK_CORPUS)', { skip: corpusDir ? false : 'set BEUK_BOOK_CORPUS to a folder of *.beuk-backup.json' }, (t) => {
  let books = 0;
  for (const file of backupFiles(corpusDir!)) {
    const name = path.relative(corpusDir!, file).split(path.sep).join('/');
    const env = JSON.parse(readFileSync(file, 'utf8')) as Rec;
    const a = readBook(env.book);
    const { ydoc } = importBook(env);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(ydoc));
    const exported = exportAny(fresh);
    const expected = sameMintedId(a.book as unknown as Rec, exported, a.upgrades);
    assert.deepStrictEqual(exported, expected, name);
    assert.deepStrictEqual(readBook(exported).book, expected, name);
    books++;
  }
  assert.ok(books > 0, 'no *.beuk-backup.json found under BEUK_BOOK_CORPUS');
  t.diagnostic(`books ${books}`);
});
