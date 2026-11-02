import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { BLOBS, META, exportBook, sectionAt, setMetaValue } from '../../src/book/editor/index';
import { BLOB_GC_MS, importToDevice, openStoredBook } from '../src/book/store';
import { fixtures } from './fixtures';

/* Wave 1c, fix round 1: the picture store (src/book/editor/model.ts BLOBS) on the device.
   - Measured: 20 research files of 5 MB added one by one, then 10 History snapshots that hold them, stored in
     IndexedDB (y-indexeddb's update log) at no more than ~1.3× the distinct content; all files removed → the store
     lets them go and compaction takes the bytes out of IndexedDB.
   - A 2.0 book stored before the store (pictures inline in meta, waves 1a-1c) is packed when it opens; its export is
     identical before and after. */

type Rec = Record<string, unknown>;
const MB = 1024 * 1024;

afterEach(async () => {
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

/** Bytes of every update y-indexeddb holds for this book's database. */
async function storedBytes(name: string): Promise<number> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const all = await new Promise<unknown[]>((res, rej) => {
    const r = db.transaction('updates', 'readonly').objectStore('updates').getAll();
    r.onsuccess = () => res(r.result as unknown[]);
    r.onerror = () => rej(r.error);
  });
  db.close();
  return all.reduce<number>((n, u) => n + ((u as Uint8Array).byteLength ?? 0), 0);
}
/** Random-looking base64 of n bytes, cheap to make (incompressible enough for a size test: the store does not compress). */
function payload(n: number, seed: number): string {
  const b = new Uint8Array(n);
  let x = seed * 2654435761 >>> 0;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    b[i] = x & 255;
  }
  let s = '';
  for (let i = 0; i < n; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const settle = (b: { persistence: IndexeddbPersistence }) => new Promise<void>((r) => setTimeout(r, 50)).then(() => b.persistence._db);

describe('the picture store in IndexedDB', () => {
  it('20 × 5 MB research files added one by one, then 10 snapshots holding them: stored ≤ 1.3× the distinct content; all removed → the bytes leave after compaction', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const b = await importToDevice(f.book);
    const name = b.persistence.name;
    const base = await storedBytes(name);
    const files: Rec[] = [];
    let distinct = 0;
    for (let i = 0; i < 20; i++) {
      const data = payload(5 * MB, i + 1);
      distinct += data.length;
      files.push({ id: 'f' + i, name: 'f' + i + '.bin', mediaType: 'application/pdf', data, bytes: 5 * MB });
      b.ydoc.transact(() => setMetaValue(b.ydoc, 'research', { files }));
    }
    for (let i = 0; i < 10; i++) {
      b.ydoc.transact(() => setMetaValue(b.ydoc, 'historyPool', { images: [], fonts: [], covers: [], research: files.slice(i, 20) }));
    }
    await settle(b);
    await new Promise((r) => setTimeout(r, 300));
    const full = (await storedBytes(name)) - base;
    const ratio = full / distinct;
    console.log(`blobs e2e (fake-indexeddb): stored ${(full / MB).toFixed(1)} MB for ${(distinct / MB).toFixed(1)} MB distinct (${ratio.toFixed(3)}×); y-indexeddb updates kept before compaction`);
    expect(ratio).toBeLessThanOrEqual(1.3);
    expect(b.ydoc.getMap(BLOBS).size).toBe(20);
    // every file leaves the book (and History's pool): the store lets them go and compacts
    b.ydoc.transact(() => {
      setMetaValue(b.ydoc, 'research', undefined);
      setMetaValue(b.ydoc, 'historyPool', { images: [], fonts: [], covers: [] });
    });
    expect(await b.collect()).toBe(20);
    await new Promise((r) => setTimeout(r, 300));
    const after = (await storedBytes(name)) - base;
    console.log(`blobs e2e: after removing every file and compacting: ${(after / MB).toFixed(2)} MB above the book's own`);
    expect(after).toBeLessThan(1 * MB);
    expect(b.ydoc.getMap(BLOBS).size).toBe(0);
    await b.close();
  }, 240_000);

  it('a book stored by waves 1a-1c (pictures inline in meta) is packed when it opens; the export is identical; the inline bytes are compacted away', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const pic = payload(300 * 1024, 7);
    const book = { ...structuredClone(f.book), images: [{ id: 'p1', name: 'p.png', mediaType: 'image/png', data: pic }, { id: 'p2', name: 'q.png', mediaType: 'image/png', data: pic }] };
    const b = await importToDevice(book);
    const id = b.id, name = b.persistence.name;
    const want = JSON.stringify(b.export());
    // rewrite it the old way: inline values in meta (what waves 1a-1c stored), the store emptied
    const inline = exportBook(b.ydoc) as Rec;
    b.ydoc.transact(() => {
      const m = b.ydoc.getMap<unknown>(META);
      for (const [k, v] of Object.entries(inline)) if (k !== 'sections') m.set(k, v);
      const blobs = b.ydoc.getMap<unknown>(BLOBS);
      for (const k of Array.from(blobs.keys())) blobs.delete(k);
    });
    expect(JSON.stringify(b.export())).toBe(want);
    await settle(b);
    await b.close();
    const reopened = (await openStoredBook(id))!;
    expect(reopened.ydoc.getMap(BLOBS).size).toBe(1);
    expect(JSON.stringify(reopened.export())).toBe(want);
    const images = reopened.ydoc.getMap<unknown>(META).get('images') as Rec[];
    expect(images.every((im) => String(im.data).startsWith('beuk-pic:'))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    // compacted: one state, which holds the picture once
    const bytes = await storedBytes(name);
    expect(bytes).toBeLessThan(pic.length * 1.3 + 200 * 1024);
    await reopened.close();
  }, 120_000);

  it('a keystroke (a section\'s text) runs none of the store\'s housekeeping; a change to a value does, once, after the burst', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const b = await importToDevice(f.book);
    let runs = 0;
    const orig = b.collect.bind(b);
    (b as unknown as { collect: () => Promise<number> }).collect = () => (runs++, orig());
    const s = (sectionAt(b.ydoc, 2) as Y.Map<unknown>);
    const frag = s.get('body') as Y.XmlFragment;
    for (let i = 0; i < 5; i++) b.ydoc.transact(() => frag.insert(0, [new Y.XmlText('x')]));
    await new Promise((r) => setTimeout(r, BLOB_GC_MS + 200));
    expect(runs).toBe(0);
    for (let i = 0; i < 3; i++) b.ydoc.transact(() => setMetaValue(b.ydoc, 'goals', { daily: 100 + i }));
    await new Promise((r) => setTimeout(r, BLOB_GC_MS + 200));
    expect(runs).toBe(1);
    await b.close();
  });
});
