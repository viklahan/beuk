/* 1.0's own book on this device, read WITHOUT touching it.

   1.0 keeps the open book in IndexedDB "beuk-local" (version 1, one
   object store "kv", out-of-line keys): "book" holds
   { format: 1, savedAt, json }, where json is the serialised
   { book, sample?, flags? }; "book-prev" is the last good copy, same shape
   (client/index.html LOCAL_DB_NAME / localReadAll / localParseRecord /
   localRestore). 1.0 restores "book", and "book-prev" when "book" does not
   parse; this mirrors that.

   THE TRAP: indexedDB.open("beuk-local", 1) on a device where 1.0 never ran
   creates an empty v1 database with no "kv" store. 1.0's own
   onupgradeneeded would then never fire and every 1.0 save would fail.
   So, here:
   - when indexedDB.databases() exists, beuk-local must be listed, or we stop;
   - the database is opened with NO version argument (never a higher one);
   - onupgradeneeded means it did not exist: the version-change transaction
     is aborted, which leaves no database behind ("no 1.0 book");
   - no "kv" store: close, "no 1.0 book";
   - readonly transactions only; the connection closes straight after;
   - deleteDatabase is never called.

   BEUK:localpics (1.0, f072a76): 1.0's device save stores each picture and
   research file ONCE in the same "kv" store as "pic:<sha256>"
   ({ mediaType, data }), and the record's JSON carries "beuk-pic:<sha256>"
   where the bytes were. 1.0 reads it back with localPickRecord /
   localUnpack: "book" when every name resolves, else "book-prev" when that
   one resolves fully, else whichever parses, its unresolved names kept and
   the count said (local.picsMissing). This mirrors it: the names are found
   and swapped by 1.0's own picSwap / picIsRef (the browser closure), the
   pictures read in a readonly transaction (get "pic:"+sha), and `missing`
   is handed on so the studio says 1.0's message. A record that holds its
   bytes inline (saved before f072a76) has no names and opens as it is. */

import { loadClosure } from '../closure/index';

export const LEGACY_DB = 'beuk-local';
export const LEGACY_STORE = 'kv';

export type LegacyBook = { book: Record<string, unknown>; from: 'book' | 'book-prev'; savedAt: string | null; missing: number };
export const LEGACY_PIC = 'pic:'; // 1.0's LOCAL_PIC

/** 1.0's picSwap / picIsRef / PIC_REF (from the browser closure). */
export type PicCode = { picSwap: (v: unknown, swap: (data: string) => string | null) => unknown; picIsRef: (s: unknown) => boolean; PIC_REF: string };
const loadPicCode = async (): Promise<PicCode> => {
  const c = await loadClosure();
  return { picSwap: c.api.picSwap, picIsRef: c.api.picIsRef, PIC_REF: c.api.PIC_REF };
};

type Rec = Record<string, unknown>;

/** 1.0's localParseRecord: the record's parsed { book, … }, or null when it does not hold a book. */
export function parseLegacyRecord(rec: unknown): { book: Rec } | null {
  if (!rec || typeof (rec as { json?: unknown }).json !== 'string') return null;
  try {
    const d = JSON.parse((rec as { json: string }).json) as { book?: unknown } | null;
    if (!d || typeof d !== 'object' || !d.book || typeof d.book !== 'object' || !Array.isArray((d.book as { sections?: unknown }).sections)) return null;
    return d as { book: Rec };
  } catch {
    return null;
  }
}

function openExisting(idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(LEGACY_DB); // no version: never create, never upgrade
    } catch {
      resolve(null);
      return;
    }
    let created = false;
    req.onupgradeneeded = () => {
      // It did not exist. Abort the version change: the database is not created.
      created = true;
      try {
        req.transaction?.abort();
      } catch {
        /* already finishing */
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (created) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    req.onerror = (e) => {
      e.preventDefault?.(); // the abort surfaces here as an AbortError
      resolve(null);
    };
    req.onblocked = () => resolve(null);
  });
}

const get = (store: IDBObjectStore, key: string): Promise<unknown> =>
  new Promise((resolve) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });

/** 1.0's localReq: a request's result, or a REJECTION when the read fails. A picture that cannot be read is a failed
 *  restore (1.0 retries at its next load), never a "missing" picture: the import is made once (store.ts
 *  importLegacyOnce), so it must not be made from a read error. */
const getStrict = (store: IDBObjectStore, key: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('read failed'));
  });

/** 1.0's localUnpack: the parsed record with its pictures filled back in from the device ({ doc, missing }; the names of
 *  pictures the device does not hold stay, as 1.0 keeps them). Readonly. */
export async function unpackLegacy(db: IDBDatabase, d: Rec, pic: PicCode): Promise<{ doc: Rec; missing: number }> {
  const want = new Set<string>();
  const cut = pic.PIC_REF.length;
  pic.picSwap(d, (x) => {
    if (pic.picIsRef(x)) want.add(x.slice(cut));
    return null;
  });
  if (!want.size) return { doc: d, missing: 0 };
  const store = db.transaction(LEGACY_STORE, 'readonly').objectStore(LEGACY_STORE);
  const got = new Map<string, string>();
  await Promise.all(
    Array.from(want).map(async (h) => {
      const v = (await getStrict(store, LEGACY_PIC + h)) as { data?: unknown } | undefined;
      if (v && typeof v.data === 'string' && v.data) got.set(h, v.data);
    }),
  );
  return { doc: pic.picSwap(d, (x) => (pic.picIsRef(x) ? got.get(x.slice(cut)) || null : null)) as Rec, missing: want.size - got.size };
}

/** 1.0's localPickRecord: which stored copy 1.0 opens, and how many of its pictures the device lacks. */
export async function pickLegacy(db: IDBDatabase, all: { book: unknown; prev: unknown }, pic: PicCode): Promise<{ doc: { book: Rec } | null; from: 'book' | 'book-prev' | null; missing: number }> {
  const bookRec = parseLegacyRecord(all.book), prevRec = parseLegacyRecord(all.prev);
  const bookU = bookRec ? await unpackLegacy(db, bookRec, pic) : null;
  const prevU = bookU && !bookU.missing ? null : prevRec ? await unpackLegacy(db, prevRec, pic) : null;
  if (bookU && !bookU.missing) return { doc: bookU.doc as { book: Rec }, from: 'book', missing: 0 };
  if (prevU && !prevU.missing) return { doc: prevU.doc as { book: Rec }, from: 'book-prev', missing: 0 };
  if (bookU) return { doc: bookU.doc as { book: Rec }, from: 'book', missing: bookU.missing };
  if (prevU) return { doc: prevU.doc as { book: Rec }, from: 'book-prev', missing: prevU.missing };
  return { doc: null, from: null, missing: 0 };
}

/** 1.0's local book on this device, or null. Never writes, upgrades, creates or deletes anything. */
export async function readLegacyBook(idb: IDBFactory | undefined = globalThis.indexedDB, picCode: () => Promise<PicCode> = loadPicCode): Promise<LegacyBook | null> {
  if (!idb) return null;
  if (typeof idb.databases === 'function') {
    try {
      const list = await idb.databases();
      if (!list.some((d) => d.name === LEGACY_DB)) return null;
    } catch {
      /* not answerable: fall through to the safe open */
    }
  }
  const db = await openExisting(idb);
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(LEGACY_STORE)) return null;
    const tx = db.transaction(LEGACY_STORE, 'readonly');
    const store = tx.objectStore(LEGACY_STORE);
    const [book, prev] = await Promise.all([get(store, 'book'), get(store, 'book-prev')]);
    if (!parseLegacyRecord(book) && !parseLegacyRecord(prev)) return null;
    const pick = await pickLegacy(db, { book, prev }, await picCode());
    if (!pick.doc || !pick.from) return null;
    return { book: pick.doc.book, from: pick.from, savedAt: savedAtOf(pick.from === 'book' ? book : prev), missing: pick.missing };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

const savedAtOf = (rec: unknown): string | null => {
  const v = (rec as { savedAt?: unknown } | null)?.savedAt;
  return typeof v === 'string' ? v : null;
};
