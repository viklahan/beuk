import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realFixtures } from './book-fixtures.js';
import { BookV1, LIMITS, TOP_LEVEL_KEYS, binaryString } from '../src/book/schema.js';

/* BEUK:book-schema — the book JSON written down as a contract (Beuk 2.0,
   step 1). The schema checks STRUCTURE: strings are strings, arrays are
   arrays. 1.0's numeric caps live in LIMITS, because the reader (a later
   task) turns an over-long series into a warning, not a refusal. And
   every object keeps the keys it does not know, because dropping a
   writer's data is the one thing this format must never do. The corpus
   is the proof: if 1.0 wrote it, BookV1 reads it. */

type Json = Record<string, any>;
const real = (): Json => structuredClone(realFixtures()[0]!.book) as Json;
const HEX64 = 'a'.repeat(64);

test('schema: every real fixture\'s book passes BookV1.safeParse with success', () => {
  const books = realFixtures();
  assert.ok(books.length >= 11, 'the corpus is there');
  for (const { name, book } of books) {
    const r = BookV1.safeParse(book);
    assert.ok(r.success, `${name}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`);
  }
});

test('schema: a picture ref beuk-pic:<64 hex> is accepted wherever base64 data is', () => {
  assert.ok(binaryString.safeParse('beuk-pic:' + HEX64).success);
  assert.ok(binaryString.safeParse('iVBORw0KGgo=').success);
  assert.ok(!binaryString.safeParse('beuk-pic:' + 'a'.repeat(63)).success);
  assert.ok(!binaryString.safeParse('not base64!').success);
  const b = real();
  b.images[0].data = 'beuk-pic:' + HEX64;
  b.cover = { data: 'beuk-pic:' + HEX64, mediaType: 'image/jpeg', ext: 'jpg', name: 'c.jpg' };
  b.fonts = [{ id: 'f1', name: 'F', family: 'F', ext: 'ttf', mediaType: 'font/ttf', data: 'beuk-pic:' + HEX64 }];
  b.research = { files: [{ id: 'r1', name: 'a.pdf', mediaType: 'application/pdf', data: 'beuk-pic:' + HEX64, bytes: 12 }] };
  const r = BookV1.safeParse(b);
  assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
});

test('schema: unknown keys survive parse at top level and inside a section', () => {
  const b = real();
  b.futureKey = { a: 1 };
  b.sections[0].futureField = 'kept';
  b.meta.futureMeta = true;
  b.images[0].extraImageKey = 7;
  const r = BookV1.safeParse(b);
  assert.ok(r.success);
  if (!r.success) return;
  const out = r.data as Json;
  assert.deepEqual(out.futureKey, { a: 1 });
  assert.equal(out.sections[0].futureField, 'kept');
  assert.equal(out.meta.futureMeta, true);
  assert.equal(out.images[0].extraImageKey, 7);
});

test('schema: history accepts both a full doc entry and a chopDoc entry with {ref} and {ref, pool} items', () => {
  const base = real();
  const sections = base.sections;
  const b = real();
  b.history = [
    { id: 'h1', name: 'before', auto: null, at: '2026-10-28T00:00:00.000Z', words: 10, doc: { sections, images: base.images, cover: null } },
    {
      id: 'h2', name: 'chop', auto: 'chapterop', at: '2026-10-28T00:00:01.000Z', words: 9,
      chop: { op: 'split', a: 'One', b: 'Two' },
      chopDoc: { sections, images: [{ ref: 'sr-house' }, { ref: 'x', pool: 0 }], fonts: [{ ref: 'f', pool: 1 }], cover: { ref: 'cover' }, research: { files: [{ ref: 'r' }] } },
    },
  ];
  b.historyPool = { images: [{ id: 'x', name: 'x.png', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgo=' }], fonts: [], covers: [], research: [] };
  const r = BookV1.safeParse(b);
  assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
});

test('schema: TOP_LEVEL_KEYS has 38 entries and includes formatVersion', () => {
  assert.equal(TOP_LEVEL_KEYS.length, 38);
  assert.equal(new Set(TOP_LEVEL_KEYS).size, 38);
  assert.ok(TOP_LEVEL_KEYS.includes('formatVersion'));
  assert.equal(LIMITS.seriesMax, 120);
  assert.equal(LIMITS.researchFileMax, 10 * 1024 * 1024);
});

test('schema: a wrong type (sections: "x") fails with a path', () => {
  const b = real();
  b.sections = 'x';
  const r = BookV1.safeParse(b);
  assert.ok(!r.success);
  if (r.success) return;
  assert.deepEqual(r.error.issues[0]!.path, ['sections']);
});

test('schema: the optional structures (outline, bible, notebook, research) parse in the shapes the inventory gives', () => {
  const b = real();
  b.outline = {
    tags: [{ name: 'act1', colour: 0 }],
    filters: [{ id: 'f1', name: 'Open', status: ['none', 'draft'], tags: ['act1'] }],
    threads: [{ id: 't1', name: 'Heist', colour: 1 }],
    fields: [{ id: 'k1', name: 'Mood', type: 'list', options: ['dark'] }],
  };
  b.sections[0].synopsis = 's';
  b.sections[0].status = 'draft';
  b.sections[0].custom = { k1: 'dark', k2: true };
  b.bible = {
    entries: [{
      id: 'b1', type: 'character', name: 'Mara', aliases: [], description: '', notes: '', imageId: null, tags: [], exactCase: false, exclude: [],
      facts: { age: '9' }, links: [{ to: 'b2', label: 'sister' }],
      changes: [{ id: 'c1', anchor: { sec: 's1', quote: 'q', at: 3, book: 'urn:uuid:x', pos: [1, 2, 3] }, text: 'x', fact: { field: 'age', value: '10' } }],
      ai: 'never', scope: 'book',
    }],
    fields: { character: [{ id: 'age', label: 'Age' }] },
    counts: { b1: [1, 2] },
  };
  b.notebook = { notes: [{ id: 'n1', title: 't', body: 'b', folder: 'f', secs: ['s1'], files: ['r1'], url: 'https://x.test', at: '2026-10-28T00:00:00.000Z' }] };
  b.research = { files: [{ id: 'r1', name: 'a.txt', mediaType: 'text/plain', data: 'aGk=', bytes: 2 }] };
  b.formatVersion = 1;
  const r = BookV1.safeParse(b);
  assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
});

test('schema: non-canonical base64 (unpadded, with a newline) is accepted, since 1.0 keeps it inline', () => {
  for (const data of ['aGk', 'aGk=\n', 'aGVs\nbG8=', 'aGk-_']) {
    assert.ok(binaryString.safeParse(data).success, JSON.stringify(data));
  }
  assert.ok(!binaryString.safeParse('not base64!').success);
  const b = real();
  b.images[0].data = 'aGVs\nbG8';
  const r = BookV1.safeParse(b);
  assert.ok(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
});

test('schema: a 6 MB payload parses without throwing (no stack overflow)', () => {
  const big = 'QUJD'.repeat(Math.ceil((6 * 1024 * 1024) / 4));
  assert.ok(big.length >= 6 * 1024 * 1024);
  const b = real();
  b.research = { files: [{ id: 'r1', name: 'big.pdf', mediaType: 'application/pdf', data: big, bytes: big.length }] };
  let r: ReturnType<typeof BookV1.safeParse> | undefined;
  assert.doesNotThrow(() => { r = BookV1.safeParse(b); });
  assert.ok(r?.success);
});
