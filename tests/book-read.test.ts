import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realFixtures } from './book-fixtures.js';
import { readBook } from '../src/book/read.js';
import { STEPS } from '../src/book/upgrade.js';

/* BEUK:book-read — readBook is the one door every book goes through in
   Beuk 2.0: it never throws, never mutates its input, and never throws a
   writer's data away. A value past 1.0's limits stays (with a warning); a
   value 1.0 would replace is replaced and the original is kept in
   preserved[]. The corpus proves it on real books. */

type Json = Record<string, any>;
const recordOnly = new Set(STEPS.filter((s) => s.recordOnly).map((s) => s.name));
const real = (): Json => structuredClone(realFixtures()[0]!.book) as Json;

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

test('read: every real fixture reads with status ok and no schema-failure warnings', () => {
  for (const { name, book } of realFixtures()) {
    const r = readBook(book);
    assert.equal(r.status, 'ok', name);
    const bad = r.warnings.filter((w) => w.code === 'schema');
    assert.deepEqual(bad, [], `${name}: ${JSON.stringify(bad.slice(0, 3))}`);
  }
});

test('read: idempotent, readBook(readBook(x).book) deep-equals the first book and fires no upgrades', () => {
  for (const { name, book } of realFixtures()) {
    const a = readBook(book);
    const b = readBook(a.book);
    assert.deepStrictEqual(b.book, a.book, name);
    // record-only steps describe the shape and change nothing, so they may fire again; every other step must not
    assert.deepEqual(b.upgrades.filter((u) => !recordOnly.has(u)), [], name);
    assert.deepEqual(b.preserved, [], name);
  }
});

test('read: the four backfilled keys are always present on the result', () => {
  const b = real();
  for (const k of ['printPictureBook', 'printBleed', 'printNotes', 'manuscript']) delete b[k];
  const r = readBook(b);
  assert.equal(r.book.printPictureBook, false);
  assert.equal(r.book.printBleed, false);
  assert.equal(r.book.printNotes, 'end', 'an older book keeps end-notes (a missing printNotes reads as "end")');
  assert.deepEqual(r.book.manuscript, {
    legalName: '', address: '', phone: '', email: '', byline: '', surname: '',
    paper: 'letter', font: 'times', italics: 'italic',
  });
  assert.ok(r.upgrades.includes('notes-end'));
  assert.deepEqual(r.warnings.filter((w) => w.code === 'schema'), []);
});

test('read: formatVersion 2 → status newer, book deep-equals input, upgrades [], one warning code format-newer', () => {
  const b = real();
  b.formatVersion = 2;
  delete b.printNotes; // would be backfilled on a v1 read; a newer book is passed through untouched
  const r = readBook(b);
  assert.equal(r.status, 'newer');
  assert.deepStrictEqual(r.book, b);
  assert.deepEqual(r.upgrades, []);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0]!.code, 'format-newer');
});

test('read: formatVersion "1" (string) → warning format-invalid, read as missing', () => {
  const b = real();
  b.formatVersion = '1';
  const r = readBook(b);
  assert.equal(r.status, 'ok');
  assert.ok(r.warnings.some((w) => w.code === 'format-invalid' && w.path === 'formatVersion'));
  assert.ok(!('formatVersion' in r.book));
  assert.ok(r.preserved.some((p) => p.path === 'formatVersion' && p.raw === '1'));
});

test('read: formatVersion 1 reads clean', () => {
  const b = real();
  b.formatVersion = 1;
  const r = readBook(b);
  assert.equal(r.status, 'ok');
  assert.equal(r.book.formatVersion, 1);
  assert.ok(!r.warnings.some((w) => w.code.startsWith('format-')));
});

test('read: does not mutate its input', () => {
  const b = real();
  delete b.printBleed;
  b.printRecto = 'nope';
  const before = structuredClone(b);
  deepFreeze(b);
  const r = readBook(b);
  assert.deepStrictEqual(b, before);
  assert.notEqual(r.book, b);
});

test('read: series of 130 chars stays 130 chars, warning code over-limit path meta.series', () => {
  const b = real();
  b.meta.series = 's'.repeat(130);
  const r = readBook(b);
  assert.equal(r.book.meta.series!.length, 130);
  assert.ok(r.warnings.some((w) => w.code === 'over-limit' && w.path === 'meta.series'));
  assert.deepEqual(r.preserved, []);
});

test('read: a wrong-typed value is replaced by the 1.0 default, raw in preserved, warning code bad-type', () => {
  const b = real();
  b.printBleed = 'yes';
  const r = readBook(b);
  assert.equal(r.book.printBleed, false);
  assert.deepEqual(r.preserved.find((p) => p.path === 'printBleed'), { path: 'printBleed', raw: 'yes', used: false });
  assert.ok(r.warnings.some((w) => w.code === 'bad-type' && w.path === 'printBleed'));
});

test('read: a strict-enum violation takes the 1.0 value, raw in preserved, warning code bad-enum', () => {
  const b = real();
  b.sections[0].backdropStrength = 'LOUD';
  b.printFolio = 'sideways';
  b.storeCheck.store = 'lulu';
  b.history = [{ id: 'h', name: 'n', at: 'x', words: 1, auto: 'weird', doc: { sections: [] } }];
  const r = readBook(b);
  assert.equal(r.book.sections[0]!.backdropStrength, 'whisper');
  assert.equal(r.book.printFolio, 'centre');
  assert.equal(r.book.storeCheck.store, 'kdp');
  assert.equal(r.book.history[0]!.auto, null);
  for (const [path, raw, used] of [
    ['sections[0].backdropStrength', 'LOUD', 'whisper'],
    ['printFolio', 'sideways', 'centre'],
    ['storeCheck.store', 'lulu', 'kdp'],
    ['history[0].auto', 'weird', null],
  ] as const) {
    assert.deepEqual(r.preserved.find((p) => p.path === path), { path, raw, used });
    assert.ok(r.warnings.some((w) => w.code === 'bad-enum' && w.path === path), path);
  }
});

test('read: an unknown top-level key is kept and reported', () => {
  const b = real();
  b.futureThing = { a: 1 };
  const r = readBook(b);
  assert.deepEqual((r.book as Json).futureThing, { a: 1 });
  assert.ok(r.warnings.some((w) => w.code === 'unknown-key' && w.path === 'futureThing'));
});

test('read: non-object input (null, [], "x", 7) → scaffold book, warning not-an-object, raw in preserved, no throw', () => {
  for (const input of [null, [], 'x', 7, undefined, true]) {
    const r = readBook(input);
    assert.equal(r.status, 'ok');
    assert.ok(r.warnings.some((w) => w.code === 'not-an-object'), String(input));
    const p = r.preserved.find((x) => x.path === '');
    assert.ok(p, String(input));
    assert.deepStrictEqual(p!.raw, input);
    assert.ok(Array.isArray(r.book.sections) && r.book.sections.length > 0);
    assert.equal(r.book.printNotes, 'end');
  }
  // a function cannot be cloned; still no throw
  assert.doesNotThrow(() => readBook(() => 1));
  assert.doesNotThrow(() => readBook({ x: () => 1 }));
});

test('read: the scaffold is deterministic (a pure reader)', () => {
  assert.deepStrictEqual(readBook(null).book, readBook(null).book);
});

test('read: a book with "__proto__" and "constructor" keys does not pollute Object.prototype and keeps the keys as data', () => {
  const raw = JSON.stringify(real()).replace(/^\{/, '{"__proto__":{"polluted":true},"constructor":{"x":1},');
  const input = JSON.parse(raw);
  assert.ok(Object.hasOwn(input, '__proto__'));
  const r = readBook(input);
  assert.equal(({} as Json).polluted, undefined);
  assert.equal((Object.prototype as Json).polluted, undefined);
  assert.ok(Object.hasOwn(r.book, '__proto__'));
  assert.deepEqual(Object.getOwnPropertyDescriptor(r.book, '__proto__')!.value, { polluted: true });
  assert.ok(Object.hasOwn(r.book, 'constructor'));
  assert.ok(r.warnings.some((w) => w.code === 'unknown-key' && w.path === '__proto__'));
});

test('read: over-limit values stay: 2001 bible entries and a 201-char narrator', () => {
  const b = real();
  const entry = (i: number) => ({ id: 'e' + i, type: 'lore', name: 'n', aliases: [], description: '', notes: '', imageId: null, tags: [], exactCase: false, exclude: [] });
  b.bible = { entries: Array.from({ length: 2001 }, (_, i) => entry(i)) };
  b.audio.narrator = 'n'.repeat(201);
  const r = readBook(b);
  assert.equal(r.book.bible!.entries.length, 2001);
  assert.equal(r.book.audio.narrator.length, 201);
  assert.ok(r.warnings.some((w) => w.code === 'over-limit' && w.path === 'bible.entries'));
  assert.ok(r.warnings.some((w) => w.code === 'over-limit' && w.path === 'audio.narrator'));
});

test('read: a numeric-string seriesNumber is read as 1.0 reads it, the raw kept', () => {
  const b = real();
  b.meta.seriesNumber = '7';
  const r = readBook(b);
  assert.equal(r.book.meta.seriesNumber, 7);
  assert.deepEqual(r.preserved.find((p) => p.path === 'meta.seriesNumber'), { path: 'meta.seriesNumber', raw: '7', used: 7 });
});
