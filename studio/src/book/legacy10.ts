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
   - deleteDatabase is never called. */

export const LEGACY_DB = 'beuk-local';
export const LEGACY_STORE = 'kv';

export type LegacyBook = { book: Record<string, unknown>; from: 'book' | 'book-prev'; savedAt: string | null };

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

/** 1.0's local book on this device, or null. Never writes, upgrades, creates or deletes anything. */
export async function readLegacyBook(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<LegacyBook | null> {
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
    const a = parseLegacyRecord(book);
    if (a) return { book: a.book, from: 'book', savedAt: savedAtOf(book) };
    const b = parseLegacyRecord(prev);
    if (b) return { book: b.book, from: 'book-prev', savedAt: savedAtOf(prev) };
    return null;
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
