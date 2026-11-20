// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { LEGACY_DB, LEGACY_LINKS_KEY, LEGACY_STORE, carryLegacyLink, parseLegacyRecord, readLegacyBook } from '../src/book/legacy10';

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
    expect(got).toEqual({ book: BOOK, from: 'book', savedAt: '2026-10-30T10:00:00.000Z', missing: 0, link: { savedAt: '2026-10-30T10:00:00.000Z', link: { id: 'x' } } });
    expect(await readLegacyBook(noList(idb))).toEqual(got);
    expect(await dump10(idb)).toEqual(before);
  });

  it('falls back to "book-prev" when "book" does not parse (1.0\'s localRestore), still read-only', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: { format: 1, savedAt: 'x', json: '{broken' }, 'book-prev': rec(PREV) });
    const before = await dump10(idb);
    expect(await readLegacyBook(idb)).toEqual({ book: PREV, from: 'book-prev', savedAt: '2026-10-30T10:00:00.000Z', missing: 0, link: null });
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

/* The shelf link comes with the book (2026-11-20). In a real upgrade a signed-in writer's first edit in 2.0 put a second
   copy of their book on the shelf, because the imported book arrived without the link 1.0 kept beside it. */
describe("1.0's shelf link comes with its book", () => {
  const LINK = { userId: 'u1', linkedId: 'shelf-book-1', linkState: 'linked', baseUpdatedAt: '2026-11-19T08:00:00.000Z', baseRevision: 2, shelfDirty: false };
  const mem = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v), dump: () => Object.fromEntries(m) };
  };

  it('the reader hands the link back with the book, and still writes nothing to beuk-local', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: rec(BOOK), link: { savedAt: '2026-11-19T08:00:01.000Z', link: LINK } });
    const before = await dump10(idb);
    const got = await readLegacyBook(idb, async () => ({ picSwap: (v) => v, picIsRef: () => false, PIC_REF: 'pic:' }));
    expect(got?.link).toEqual({ savedAt: '2026-11-19T08:00:01.000Z', link: LINK });
    expect(await dump10(idb)).toEqual(before);
  });

  it('a device book that was never on the shelf has no link to carry', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: rec(BOOK) });
    const got = await readLegacyBook(idb, async () => ({ picSwap: (v) => v, picIsRef: () => false, PIC_REF: 'pic:' }));
    expect(got?.book).toBeTruthy();
    expect(got?.link).toBeNull();
    // a record that is not a link (a string, a link that is a list) is no link either
    for (const bad of ['linked', { savedAt: 'x', link: [1, 2] }, { savedAt: 'x' }]) {
      const idb2 = new IDBFactory();
      await seed10(idb2, { book: rec(BOOK), link: bad });
      expect((await readLegacyBook(idb2, async () => ({ picSwap: (v) => v, picIsRef: () => false, PIC_REF: 'pic:' })))?.link).toBeNull();
    }
  });

  it("it is stored for the imported book exactly as 2.0 keeps a link, and a link 2.0 already holds is never overwritten", () => {
    const store = mem();
    expect(carryLegacyLink('urn:uuid:book-a', { savedAt: '2026-11-19T08:00:01.000Z', link: LINK }, store)).toBe(true);
    expect(JSON.parse(store.dump()[LEGACY_LINKS_KEY])).toEqual({ 'urn:uuid:book-a': { savedAt: '2026-11-19T08:00:01.000Z', link: LINK } });
    // a second carry for the same book changes nothing
    expect(carryLegacyLink('urn:uuid:book-a', { savedAt: 'later', link: { ...LINK, linkedId: 'other' } }, store)).toBe(false);
    expect(JSON.parse(store.dump()[LEGACY_LINKS_KEY])['urn:uuid:book-a'].link.linkedId).toBe('shelf-book-1');
    // another book's link stays beside it
    expect(carryLegacyLink('urn:uuid:book-b', { savedAt: 's', link: LINK }, store)).toBe(true);
    expect(Object.keys(JSON.parse(store.dump()[LEGACY_LINKS_KEY])).sort()).toEqual(['urn:uuid:book-a', 'urn:uuid:book-b']);
    // nothing to carry, or a storage that refuses: nothing written, no throw
    expect(carryLegacyLink('urn:uuid:book-c', null, store)).toBe(false);
    expect(carryLegacyLink('urn:uuid:book-c', { savedAt: 's', link: LINK }, { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toBe(false);
    expect(carryLegacyLink('urn:uuid:book-c', { savedAt: 's', link: LINK }, mem({ [LEGACY_LINKS_KEY]: 'not json' }))).toBe(false);
  });

  it("the key is the one 2.0's cloud reads its links from", () => {
    const cloud = readFileSync(new URL('../src/cloud/cloud.ts', import.meta.url), 'utf8');
    expect(cloud).toContain("export const LINKS_KEY = '" + LEGACY_LINKS_KEY + "';");
    // and the import carries it before the book is handed to the studio
    const store = readFileSync(new URL('../src/book/store.ts', import.meta.url), 'utf8');
    expect(store).toMatch(/remember\(id, LEGACY_EPOCH[^\n]*\n[^\n]*\n\s*if \(carryLink\) carryLink\(id\);\n\s*const legacy = new OpenBook\(/);
    const provider = readFileSync(new URL('../src/book/BookProvider.tsx', import.meta.url), 'utf8');
    expect(provider).toContain('startBook(readLegacyBook, (id, link) => void carryLegacyLink(id, link as LegacyLink))');
  });
});
