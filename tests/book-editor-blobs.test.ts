import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as Y from 'yjs';
import { fixturePath } from './book-fixtures.js';
import { readBook } from '../src/book/read.js';
import {
  BLOBS, META, collectBlobs, exportBook, getMetaValue, importBook, isPicRef, packBlobs, packValue, picRefsInMeta, setMetaValue,
} from '../src/book/editor/model.js';
import { sha256Hex } from '../src/book/editor/sha256.js';

/* BEUK:editor-blobs (step 5 wave 1c, fix round 1) — the book's pictures, fonts, cover and research files are stored
   once in the Y.Doc's `blobs` map, keyed by the SHA-256 of their bytes, and named in `meta` with 1.0's own
   "beuk-pic:<sha256>" (its packed device record). The exported book is byte-identical to what was imported. */

type Rec = Record<string, unknown>;
const REPO = path.resolve(import.meta.dirname, '..');
const JPG = readFileSync(path.join(REPO, 'client', 'assets', 'sample', 'sample-img-portrait.jpg')).toString('base64');
const JPG2 = readFileSync(path.join(REPO, 'client', 'assets', 'sample', 'sample-img-cover-art.jpg')).toString('base64');
const b64 = (s: string) => Buffer.from(s).toString('base64');
const TXT = b64('Soundings: six fathoms, called every mark true. '.repeat(60));

function realFixtures(): { name: string; book: Rec }[] {
  const dir = path.dirname(fixturePath('real', 'lunas-beach-standalone'));
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f, book: (JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { book: Rec }).book }));
}
/** A fixture with pictures (one repeated), a cover, research files named by a note, and a History pool holding a copy. */
function withPictures(book: Rec): Rec {
  const b = structuredClone(book);
  b.images = [
    { id: 'blob-a', name: 'portrait.jpg', mediaType: 'image/jpeg', data: JPG },
    { id: 'blob-b', name: 'again.jpg', mediaType: 'image/jpeg', data: JPG },
    { id: 'blob-c', name: 'cover-art.jpg', mediaType: 'image/jpeg', data: JPG2 },
  ];
  b.cover = { name: 'cover.jpg', mediaType: 'image/jpeg', ext: 'jpg', data: JPG2 };
  b.notebook = { notes: [{ id: 'n1', title: 'Soundings', body: '', files: ['rf1'] }] };
  b.research = { files: [{ id: 'rf1', name: 'soundings.txt', mediaType: 'text/plain', data: TXT, bytes: Buffer.from(TXT, 'base64').length }] };
  b.historyPool = { images: [{ id: 'old', name: 'old.jpg', mediaType: 'image/jpeg', data: JPG }], fonts: [], covers: [] };
  return b;
}
const expected = (book: Rec): string => {
  const r = readBook(book);
  assert.equal(r.status, 'ok');
  return JSON.stringify(r.book);
};
const bigInline = (v: unknown): number => {
  let n = 0;
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      const o = x as Rec;
      if (typeof o.mediaType === 'string' && typeof o.data === 'string' && o.data.length >= 1024) n++;
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  walk(v);
  return n;
};

test('sha256Hex equals node:crypto (FIPS lengths around the padding boundaries, and a large buffer)', () => {
  for (const len of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 1 << 20]) {
    const buf = len === 3 ? Buffer.from('abc') : randomBytes(len);
    assert.equal(sha256Hex(new Uint8Array(buf)), createHash('sha256').update(buf).digest('hex'), `length ${len}`);
  }
});

test('every real fixture, with pictures, a cover, research files and a History pool: import → export is byte-identical; each content stored once; meta holds names', () => {
  for (const f of realFixtures()) {
    const book = withPictures(f.book);
    const y = new Y.Doc();
    importBook(book, y);
    assert.equal(JSON.stringify(exportBook(y)), expected(book), f.name);
    const blobs = y.getMap<unknown>(BLOBS);
    assert.equal(blobs.size, 3, `${f.name}: three distinct contents (JPG, JPG2, TXT)`);
    for (const [k, v] of blobs.entries()) {
      const d = (v as { data: string }).data;
      assert.equal(k, createHash('sha256').update(Buffer.from(d, 'base64')).digest('hex'));
    }
    for (const v of y.getMap<unknown>(META).values()) assert.equal(bigInline(v), 0, `${f.name}: no inline picture left in meta`);
    assert.ok(isPicRef((y.getMap<unknown>(META).get('cover') as Rec).data));
    // and again through a second import of the export
    const y2 = new Y.Doc();
    importBook(exportBook(y), y2);
    assert.equal(JSON.stringify(exportBook(y2)), expected(book), `${f.name} (second round)`);
  }
  // the books without pictures are stored exactly as before: no blobs at all
  for (const f of realFixtures()) {
    const y = new Y.Doc();
    importBook(f.book, y);
    assert.equal(y.getMap(BLOBS).size, 0, f.name);
    assert.equal(JSON.stringify(exportBook(y)), expected(f.book), f.name);
  }
});

test('what is not named stays inline: small data, non-canonical base64, data without a mediaType, a name the store does not hold', () => {
  const y = new Y.Doc();
  const small = { mediaType: 'image/png', data: b64('tiny') };
  const odd = { mediaType: 'image/png', data: JPG.slice(0, 2000) + '=' }; // not canonical base64
  const bare = { data: JPG }; // no mediaType: not picture-shaped (1.0's picObjects)
  const dangling = { mediaType: 'image/png', data: 'beuk-pic:' + 'f'.repeat(64) };
  const v = { list: [small, odd, bare, dangling] };
  y.transact(() => setMetaValue(y, 'x', v));
  assert.equal(y.getMap(BLOBS).size, 0);
  assert.deepEqual(getMetaValue(y, 'x'), v);
});

test('a book stored before the picture store (inline in meta) is packed in one transaction; its export is the same before and after', () => {
  const book = withPictures(realFixtures()[0]!.book);
  const r = readBook(book);
  const y = new Y.Doc();
  // the waves 1a-1c layout: every top-level value inline in meta
  y.transact(() => {
    for (const [k, v] of Object.entries(r.book as unknown as Rec)) if (k !== 'sections') y.getMap<unknown>(META).set(k, v);
    y.getMap<unknown>('layout').set('keys', Object.keys(r.book as unknown as Rec));
  });
  importBook({ ...book, images: [] }, new Y.Doc()); // (unrelated doc: the shared hash memo is warm or cold either way)
  const before = JSON.stringify(exportBook(y));
  let tx = 0;
  y.on('afterTransaction', () => tx++);
  assert.equal(packBlobs(y), true);
  assert.equal(tx, 1);
  assert.equal(JSON.stringify(exportBook(y)), before);
  assert.equal(y.getMap(BLOBS).size, 3);
  assert.equal(packBlobs(y), false);
});

test('collectBlobs lets go of what no value names, and never of what History still names', () => {
  const y = new Y.Doc();
  importBook(withPictures(realFixtures()[0]!.book), y);
  const shaTxt = createHash('sha256').update(Buffer.from(TXT, 'base64')).digest('hex');
  const shaJpg = createHash('sha256').update(Buffer.from(JPG, 'base64')).digest('hex');
  // the research file leaves the book; the picture leaves images but stays in History's pool
  y.transact(() => {
    setMetaValue(y, 'research', undefined);
    setMetaValue(y, 'images', []);
  });
  assert.equal(collectBlobs(y), 1);
  assert.ok(!y.getMap(BLOBS).has(shaTxt));
  assert.ok(y.getMap(BLOBS).has(shaJpg), 'the History pool still names it');
  assert.ok(picRefsInMeta(y).has(shaJpg));
  assert.equal(collectBlobs(y), 0);
});

test('a rewrite of a value holding pictures adds only its names to the update log (20 research files added one by one, then 10 History pool rewrites)', () => {
  const y = new Y.Doc();
  importBook(realFixtures()[0]!.book, y);
  let bytes = 0;
  y.on('update', (u: Uint8Array) => (bytes += u.byteLength));
  const files: Rec[] = [];
  let distinct = 0;
  for (let i = 0; i < 20; i++) {
    const data = randomBytes(256 * 1024).toString('base64'); // 256 KB each here (the 5 MB run is the studio's IndexedDB test)
    distinct += data.length;
    files.push({ id: 'f' + i, name: 'f' + i + '.txt', mediaType: 'text/plain', data, bytes: 256 * 1024 });
    y.transact(() => setMetaValue(y, 'research', { files }));
  }
  for (let i = 0; i < 10; i++) y.transact(() => setMetaValue(y, 'historyPool', { images: [], fonts: [], covers: [], research: files.slice(0, 10 + i) }));
  const ratio = bytes / distinct;
  assert.ok(ratio <= 1.3, `update log ${bytes} bytes for ${distinct} bytes of distinct content (${ratio.toFixed(3)}×)`);
  console.log(`# blobs: update log ${(bytes / 1048576).toFixed(2)} MB for ${(distinct / 1048576).toFixed(2)} MB distinct (${ratio.toFixed(3)}×)`);
  assert.equal(JSON.stringify((exportBook(y).research as Rec).files), JSON.stringify(files));
  // packValue without write leaves the store alone
  const n = y.getMap(BLOBS).size;
  packValue(y, { mediaType: 'text/plain', data: randomBytes(4096).toString('base64') }, false);
  assert.equal(y.getMap(BLOBS).size, n);
});
