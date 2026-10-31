import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('read: the cover recipe keeps wrap.spine and wrap.back exactly, with no warning (BEUK:spineback)', () => {
  const spine = {
    bg: { mode: 'gradient', color: '#112233', color2: '#c9a959', dir: 'diag-up', pattern: 'dots' },
    font: 'Libre Baskerville', color: '#f0e6d2', show: 'custom', text: 'BOOK II', caps: false, dir: 'ttb',
    iconTop: { kind: 'lucide', name: 'Feather', picId: null }, iconBottom: { kind: 'upload', name: '', picId: 'abc' },
  };
  const back = { bg: { mode: 'pattern', color: '#304050', color2: '#c9a959', dir: 'down', pattern: 'diamonds' }, font: '', color: '#e8e0d0' };
  const book = real();
  const wrap = { trim: '6x9', pages: 300, paper: 'cream', customFactor: 0.0025, blurb: '', quote: '', imprint: '', binding: 'paperback', hcSpine: 0, hcSpineAllow: 0, flapFront: '', flapBack: '', flapPhotoId: null, spine, back };
  book.coverRecipe = {
    layout: 'classic', bgType: 'solid', bgColor: '#222222', bgColor2: '#c9a959', texture: 'linen', bgImageId: null,
    title: 'T', subtitle: '', author: 'A', tagline: '', series: '', wrap,
    elements: Object.fromEntries(['series', 'title', 'subtitle', 'tagline', 'author'].map((k) => [k, { font: 'Libre Baskerville', size: 40, color: '#ffffff' }])),
  };
  const r = readBook(book);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.warnings.filter((w) => w.code === 'schema' || /spine|back/.test(JSON.stringify(w))), []);
  const out = (r.book as Json).coverRecipe.wrap;
  assert.equal(JSON.stringify(out.spine), JSON.stringify(spine));
  assert.equal(JSON.stringify(out.back), JSON.stringify(back));
  const again = readBook(r.book);
  assert.equal(JSON.stringify((again.book as Json).coverRecipe.wrap), JSON.stringify(out));
  assert.deepEqual(again.preserved, []);
});

const legacyDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'books', 'legacy');
const hostile: [string, unknown][] = [
  ['null', null], ['[]', []], ['"x"', 'x'], ['7', 7],
  ['theme []', { theme: [] }], ['theme ""', { theme: '' }], ['theme false', { theme: false }], ['activePreset ""', { activePreset: '' }],
];

test('read: idempotent over real fixtures, legacy fixtures and hostile inputs: second read deep-equals and fires only record-only steps', () => {
  const inputs: [string, unknown][] = [
    ...realFixtures().map((f) => [f.name, f.book] as [string, unknown]),
    ...readdirSync(legacyDir).filter((n) => n.endsWith('.json')).sort()
      .map((n) => [`legacy/${n}`, (JSON.parse(readFileSync(path.join(legacyDir, n), 'utf8')) as { book: unknown }).book] as [string, unknown]),
    ...hostile.map(([n, v]) => [`hostile ${n}`, v] as [string, unknown]),
  ];
  assert.ok(inputs.length >= 8 + 13);
  for (const [name, book] of inputs) {
    const a = readBook(book);
    const b = readBook(a.book);
    assert.deepStrictEqual(b.book, a.book, name);
    assert.deepEqual(b.upgrades.filter((u) => !recordOnly.has(u)), [], name);
    assert.deepEqual(b.preserved, [], name);
    assert.deepEqual(b.warnings.filter((w) => w.code !== 'unknown-key' && w.code !== 'duplicate-id' && w.code !== 'over-limit' && w.code !== 'schema'), [], name);
  }
});

test('read: never throws: a throwing getter, a 10k-deep object, a function value', () => {
  const getter = {} as Record<string, unknown>;
  Object.defineProperty(getter, 'meta', { enumerable: true, get() { throw new Error('boom'); } });
  let deep: Record<string, unknown> = {};
  const root = deep;
  for (let i = 0; i < 10_000; i++) { const n = {}; deep.n = n; deep = n; }
  for (const [name, input] of [['getter', getter], ['deep', root], ['function value', { sections: () => 1 }], ['function', () => 1]] as [string, unknown][]) {
    let r: ReturnType<typeof readBook> | undefined;
    assert.doesNotThrow(() => { r = readBook(input); }, name);
    assert.ok(r && ['ok', 'failed'].includes(r.status), name);
    assert.ok(Array.isArray(r!.book.sections), name);
  }
});

test('read: a wrong-typed theme is refilled with the classic theme, raw preserved, warned; activePreset follows 1.0', () => {
  for (const [theme, preset] of [[[], null], ['', 'classic'], [false, 'classic']] as [unknown, string | null][]) {
    const r = readBook({ theme });
    assert.ok(r.book.theme && !Array.isArray(r.book.theme) && typeof r.book.theme === 'object', JSON.stringify(theme));
    assert.equal(r.book.theme.bodyFont, 'EB Garamond');
    const p = r.preserved.find((x) => x.path === 'theme');
    assert.ok(p, JSON.stringify(theme));
    assert.deepStrictEqual(p!.raw, theme);
    assert.ok(r.warnings.some((w) => w.path === 'theme' && w.code === 'bad-type'), JSON.stringify(theme));
    assert.equal(r.book.activePreset, preset, JSON.stringify(theme));
  }
  const r = readBook({ activePreset: '' });
  assert.ok(r.preserved.some((x) => x.path === 'activePreset' && x.raw === ''));
  assert.ok(r.warnings.some((w) => w.path === 'activePreset'));
});

test('read: a scaffold carries a bookId, and the catch path preserves the input and reports status failed', () => {
  const r = readBook(null);
  assert.match(String(r.book.meta.bookId), /^urn:uuid:/);
  const getter = {} as Record<string, unknown>;
  Object.defineProperty(getter, 'x', { enumerable: true, get() { throw new Error('boom'); } });
  const f = readBook(getter);
  assert.equal(f.status, 'failed');
  assert.ok(f.warnings.some((w) => w.code === 'read-failed'));
  const p = f.preserved.find((x) => x.path === '');
  assert.ok(p, 'the input is preserved');
  assert.equal(p!.raw, getter);
  assert.match(String(f.book.meta.bookId), /^urn:uuid:/);
});

test('read: a falsy theme with activePreset null reads "classic" (1.0: doc.activePreset || (doc.theme ? null : "classic")), stable on re-read', () => {
  for (const theme of [null, '', false]) {
    const a = readBook({ theme, activePreset: null });
    assert.equal(a.book.activePreset, 'classic', JSON.stringify(theme));
    const b = readBook(a.book);
    assert.deepStrictEqual(b.book, a.book);
    assert.deepEqual(b.upgrades.filter((u) => !recordOnly.has(u)), []);
  }
});

test('read: a hostile thrown value (null-prototype object, revoked Proxy, Error with a throwing message) still returns status failed', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const badErr = new Error('x');
  Object.defineProperty(badErr, 'message', { get() { throw new Error('nested'); } });
  for (const [name, thrown] of [['null-proto', Object.create(null)], ['revoked proxy', proxy], ['bad message', badErr]] as [string, unknown][]) {
    const input = {} as Record<string, unknown>;
    Object.defineProperty(input, 'meta', { enumerable: true, get() { throw thrown; } });
    let r: ReturnType<typeof readBook> | undefined;
    assert.doesNotThrow(() => { r = readBook(input); }, name);
    assert.equal(r!.status, 'failed', name);
    assert.ok(r!.warnings.some((w) => w.code === 'read-failed'), name);
    assert.ok(r!.preserved.some((x) => x.path === ''), name);
    assert.ok(Array.isArray(r!.book.sections), name);
  }
});

test('read: an unknown-key warning path is the bare top-level key name (observe privacySafe relies on it)', () => {
  const r = readBook({ zzFutureThing: { a: { b: 1 } }, 'weird.key[0]': 1 });
  const paths = r.warnings.filter((w) => w.code === 'unknown-key').map((w) => w.path).sort();
  assert.deepEqual(paths, ['weird.key[0]', 'zzFutureThing']);
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
  const strip = (b: ReturnType<typeof readBook>['book']) => { const c = structuredClone(b) as Json; delete c.meta.bookId; return c; };
  assert.deepStrictEqual(strip(readBook(null).book), strip(readBook(null).book)); // the one random part is meta.bookId (bookid-missing)
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

/* The full gallery, read one book at a time (never all in memory). Skipped
   unless BEUK_BOOK_CORPUS names a folder; every *.beuk-backup.json under it
   (any depth) is read. See tests/fixtures/books/README.md. */
const corpusDir = process.env.BEUK_BOOK_CORPUS;

function* backupFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* backupFiles(full);
    else if (e.name.endsWith('.beuk-backup.json')) yield full;
  }
}

test('read: full corpus (BEUK_BOOK_CORPUS)', { skip: corpusDir ? false : 'set BEUK_BOOK_CORPUS to a folder of *.beuk-backup.json' }, (t) => {
  const upgrades = new Map<string, number>();
  const warns = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  let books = 0;
  for (const file of backupFiles(corpusDir!)) {
    const name = path.relative(corpusDir!, file).split(path.sep).join('/');
    const raw = (JSON.parse(readFileSync(file, 'utf8')) as { book: unknown }).book;
    const a = readBook(raw);
    assert.equal(a.status, 'ok', name);
    assert.deepEqual(a.warnings.filter((w) => w.code === 'schema'), [], name);
    const b = readBook(a.book);
    assert.deepStrictEqual(b.book, a.book, name);
    assert.deepEqual(b.upgrades.filter((u) => !recordOnly.has(u)), [], name);
    assert.deepEqual(b.preserved, [], name);
    for (const u of a.upgrades) bump(upgrades, u);
    for (const w of a.warnings) bump(warns, w.code);
    books++;
  }
  assert.ok(books > 0, 'no *.beuk-backup.json found under BEUK_BOOK_CORPUS');
  const fmt = (m: Map<string, number>) => [...m].sort().map(([k, n]) => `${k}=${n}`).join(' ') || 'none';
  t.diagnostic(`books read: ${books}`);
  t.diagnostic(`upgrades: ${fmt(upgrades)}`);
  t.diagnostic(`warnings: ${fmt(warns)}`);
});
