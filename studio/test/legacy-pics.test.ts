// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { LEGACY_DB, LEGACY_PIC, LEGACY_STORE, readLegacyBook } from '../src/book/legacy10';
import { loadClosure } from '../src/closure/index';

/* Wave 1c, task 5: 1.0's device save names its pictures (BEUK:localpics,
   f072a76). Each picture / research file is stored once in "kv" as
   "pic:<sha256>" ({ mediaType, data }); the record's JSON carries
   "beuk-pic:<sha256>" where the bytes were. 2.0's read-only import fills
   them back in exactly as 1.0's localPickRecord / localUnpack do: "book" when
   whole, else a whole "book-prev", else whichever parses with `missing`
   counted (the names kept, as 1.0 keeps them). Never a write to beuk-local. */

type Rec = Record<string, unknown>;
const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function seed10(idb: IDBFactory, recs: Record<string, unknown>): Promise<void> {
  const open = idb.open(LEGACY_DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(LEGACY_STORE);
  const db = await req(open);
  const tx = db.transaction(LEGACY_STORE, 'readwrite');
  for (const [k, v] of Object.entries(recs)) tx.objectStore(LEGACY_STORE).put(v, k);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  db.close();
}
async function dump10(idb: IDBFactory): Promise<unknown> {
  const db = await req(idb.open(LEGACY_DB));
  const st = db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE);
  const keys = await req(st.getAllKeys());
  const out: Record<string, unknown> = {};
  for (const k of keys) out[String(k)] = await req(st.get(k));
  const v = db.version;
  db.close();
  return { v, out, names: (await idb.databases()).map((d) => `${d.name}@${d.version}`) };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');
const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const PIC_A = b64('A picture of the harbour. '.repeat(80)); // over 1.0's PIC_MIN (1024)
const PIC_B = b64('A recording of gulls. '.repeat(80));
/** The book as the desk holds it (bytes inline). */
const BOOK: Rec = {
  meta: { title: 'The Lantern Coast' },
  sections: [{ id: 's1', content: 'Hello.' }],
  images: [{ id: 'img1', name: 'harbour.png', mediaType: 'image/png', data: PIC_A }],
  cover: null,
  research: { files: [{ id: 'f1', name: 'gulls.wav', mediaType: 'audio/wav', data: PIC_B, bytes: 1 }] },
};
/** 1.0's localPackRecord: every picture-shaped data named "beuk-pic:<sha>", the bytes beside it as "pic:<sha>". */
function packed(book: Rec): { rec: Rec; pics: Record<string, unknown> } {
  const pics: Record<string, unknown> = {};
  const swap = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(swap);
    if (!v || typeof v !== 'object') return v;
    const o = v as Rec, out: Rec = {};
    for (const k of Object.keys(o)) {
      if (k === 'data' && typeof o[k] === 'string' && typeof o.mediaType === 'string' && (o[k] as string).length >= 1024) {
        const h = sha(o[k] as string);
        pics[LEGACY_PIC + h] = { mediaType: o.mediaType, data: o[k] };
        out[k] = 'beuk-pic:' + h;
      } else out[k] = swap(o[k]);
    }
    return out;
  };
  const json = JSON.stringify(swap({ format: 1, book, sample: { loaded: false } }));
  return { rec: { format: 1, savedAt: '2026-10-31T10:00:00.000Z', json }, pics };
}

describe('1.0\'s packed device save (BEUK:localpics), read-only', () => {
  it('a packed record with its pictures on the device: the imported book is the unpacked doc; beuk-local untouched', async () => {
    const c = await loadClosure();
    const idb = new IDBFactory();
    const p = packed(BOOK);
    expect(p.rec.json).toContain('beuk-pic:');
    expect(Object.keys(p.pics).length).toBe(2);
    await seed10(idb, { book: p.rec, ...p.pics });
    const before = await dump10(idb);
    const got = await readLegacyBook(idb);
    expect(got?.from).toBe('book');
    expect(got?.missing).toBe(0);
    expect(c.api.stableJson(got!.book)).toBe(c.api.stableJson(BOOK));
    expect(JSON.stringify(got!.book)).not.toContain('beuk-pic:');
    expect(await dump10(idb)).toEqual(before);
  });

  it('a picture missing from "book" while "book-prev" is whole: book-prev is opened (1.0\'s localPickRecord)', async () => {
    const idb = new IDBFactory();
    const older = { ...BOOK, meta: { title: 'Older' } };
    const p = packed(BOOK), q = packed(older);
    const pics = { ...q.pics };
    // "book" names a picture the device no longer holds
    const lost = JSON.parse(p.rec.json as string);
    lost.book.images[0].data = 'beuk-pic:' + 'f'.repeat(64);
    await seed10(idb, { book: { ...p.rec, json: JSON.stringify(lost) }, 'book-prev': q.rec, ...pics });
    const got = await readLegacyBook(idb);
    expect(got?.from).toBe('book-prev');
    expect(got?.missing).toBe(0);
    expect((got!.book.meta as Rec).title).toBe('Older');
    expect(JSON.stringify(got!.book)).not.toContain('beuk-pic:');
  });

  it('neither copy whole: "book" is opened with the missing count (1.0 keeps the names and says local.picsMissing)', async () => {
    const idb = new IDBFactory();
    const p = packed(BOOK);
    const pics = { ...p.pics };
    delete pics[LEGACY_PIC + sha(PIC_B)];
    await seed10(idb, { book: p.rec, ...pics });
    const got = await readLegacyBook(idb);
    expect(got?.from).toBe('book');
    expect(got?.missing).toBe(1);
    expect(((got!.book.images as Rec[])[0]!).data).toBe(PIC_A);
  });

  it('an old record with the bytes inline opens as it is', async () => {
    const idb = new IDBFactory();
    await seed10(idb, { book: { format: 1, savedAt: '2026-10-30T10:00:00.000Z', json: JSON.stringify({ book: BOOK }) } });
    const got = await readLegacyBook(idb);
    expect(got).toEqual({ book: BOOK, from: 'book', savedAt: '2026-10-30T10:00:00.000Z', missing: 0 });
  });
});
