// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { LEGACY_DB, LEGACY_STORE, parseLegacyRecord, readLegacyBook } from '../src/book/legacy10';

/* 1.0's local book, read-only (constraint 7 and the facts' TRAP): reading
   must never create, upgrade, write or delete 1.0's "beuk-local". */

const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** 1.0's localOpenDb + a save: "beuk-local" v1 with its "kv" store, holding these records. */
async function seed10(idb: IDBFactory, recs: Record<string, unknown>, opts: { store?: boolean } = {}): Promise<void> {
  const open = idb.open(LEGACY_DB, 1);
  open.onupgradeneeded = () => {
    if (opts.store !== false) open.result.createObjectStore(LEGACY_STORE);
  };
  const db = await req(open);
  if (opts.store !== false) {
    const tx = db.transaction(LEGACY_STORE, 'readwrite');
    for (const [k, v] of Object.entries(recs)) tx.objectStore(LEGACY_STORE).put(v, k);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  }
  db.close();
}

/** Everything in 1.0's database: its version, its stores, and every record. */
async function dump10(idb: IDBFactory): Promise<unknown> {
  const names = (await idb.databases()).map((d) => `${d.name}@${d.version}`).sort();
  if (!names.some((n) => n.startsWith(LEGACY_DB + '@'))) return { names };
  const db = await req(idb.open(LEGACY_DB));
  const stores = Array.from(db.objectStoreNames);
  const out: Record<string, unknown> = {};
  if (stores.includes(LEGACY_STORE)) {
    const st = db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE);
    const keys = await req(st.getAllKeys());
    for (const k of keys) out[String(k)] = await req(st.get(k));
  }
  const version = db.version;
  db.close();
  return { names, version, stores, out };
}

const rec = (book: unknown, extra: Record<string, unknown> = {}) => ({ format: 1, savedAt: '2026-10-30T10:00:00.000Z', json: JSON.stringify({ book, ...extra }) });
const BOOK = { meta: { title: 'The Lantern Coast' }, sections: [{ id: 's1', content: 'Hello *there*.' }] };
const PREV = { meta: { title: 'Older' }, sections: [] };

/** A factory without databases(), as in browsers that lack it: only open/deleteDatabase/cmp. */
const noList = (idb: IDBFactory): IDBFactory =>
  ({ open: idb.open.bind(idb), deleteDatabase: idb.deleteDatabase.bind(idb), cmp: idb.cmp.bind(idb) }) as unknown as IDBFactory;

describe("1.0's local book, read-only", () => {
  it('REQUIRED: on a device without 1.0\'s database, reading leaves databases() without beuk-local', async () => {
    const idb = new IDBFactory();
    expect(await readLegacyBook(idb)).toBeNull();
    expect((await idb.databases()).map((d) => d.name)).not.toContain(LEGACY_DB);
  });

  it('REQUIRED (no databases() to check first): the no-version open is aborted, so still no beuk-local', async () => {
    const idb = new IDBFactory();
    expect(await readLegacyBook(noList(idb))).toBeNull();
    expect((await idb.databases()).map((d) => d.name)).not.toContain(LEGACY_DB);
    // 1.0 can still create its own database afterwards, with its kv store (its onupgradeneeded fires)
    await seed10(idb, { book: rec(BOOK) });
    expect(await readLegacyBook(idb)).toMatchObject({ book: BOOK, from: 'book' });
  });

  it('reads "book", and changes nothing: same version, stores and records before and after', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: rec(BOOK, { sample: { loaded: false } }), 'book-prev': rec(PREV), link: { link: { id: 'x' } } });
    const before = await dump10(idb);
    const got = await readLegacyBook(idb);
    expect(got).toEqual({ book: BOOK, from: 'book', savedAt: '2026-10-30T10:00:00.000Z' });
    expect(await readLegacyBook(noList(idb))).toEqual(got);
    expect(await dump10(idb)).toEqual(before);
  });

  it('falls back to "book-prev" when "book" does not parse (1.0\'s localRestore), still read-only', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: { format: 1, savedAt: 'x', json: '{broken' }, 'book-prev': rec(PREV) });
    const before = await dump10(idb);
    expect(await readLegacyBook(idb)).toEqual({ book: PREV, from: 'book-prev', savedAt: '2026-10-30T10:00:00.000Z' });
    expect(await dump10(idb)).toEqual(before);
  });

  it('no book in either record: null', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: { format: 1, json: JSON.stringify({ book: { sections: 'no' } }) }, link: {} });
    expect(await readLegacyBook(idb)).toBeNull();
  });

  it('a beuk-local without its kv store: null, and the store is not created', async () => {
    const idb = new IDBFactory();
    await seed10(idb, {}, { store: false });
    const before = await dump10(idb);
    expect(await readLegacyBook(idb)).toBeNull();
    expect(await dump10(idb)).toEqual(before);
    expect((before as { stores: string[] }).stores).toEqual([]);
  });

  it('parseLegacyRecord is 1.0\'s localParseRecord: { json } holding { book: { sections: [] } }', () => {
    expect(parseLegacyRecord(rec(BOOK))).toEqual({ book: BOOK });
    expect(parseLegacyRecord({ json: JSON.stringify(BOOK) })).toBeNull(); // the json is { book, … }, not the book
    expect(parseLegacyRecord({ json: 5 })).toBeNull();
    expect(parseLegacyRecord(null)).toBeNull();
    expect(parseLegacyRecord({ json: 'null' })).toBeNull();
  });
});
