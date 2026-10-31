import * as Y from 'yjs';
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb';
import { exportBook, importBook, LAYOUT, META, SECTIONS, type TextWarning } from '@book/editor/index.js';

/* The books on this device, as Y.Docs (step 4 part C).

   Each book is one Y.Doc (src/book/editor/model.ts), persisted with
   y-indexeddb under its own database, `beuk-next-book-<bookId>`: never
   1.0's "beuk-local". Tabs of /next on the same book share updates over a
   BroadcastChannel of the same name, and Yjs merges whatever arrives
   (y-indexeddb itself keeps no tabs in step). The list of books on this
   device, and which one was open last, is a small localStorage record. */

export const DB_PREFIX = 'beuk-next-book-';
export const REGISTRY_KEY = 'beuk.next.books.v1';

export const dbNameFor = (bookId: string): string => DB_PREFIX + bookId;

export type BookEntry = { id: string; title: string; openedAt: string };
export type Registry = { v: 1; last: string | null; books: BookEntry[] };

const emptyRegistry = (): Registry => ({ v: 1, last: null, books: [] });

export function readRegistry(): Registry {
  try {
    const raw = globalThis.localStorage?.getItem(REGISTRY_KEY);
    if (!raw) return emptyRegistry();
    const r = JSON.parse(raw) as Partial<Registry>;
    if (r.v !== 1 || !Array.isArray(r.books)) return emptyRegistry();
    const books = r.books.filter((b): b is BookEntry => !!b && typeof b.id === 'string' && typeof b.title === 'string');
    return { v: 1, last: typeof r.last === 'string' ? r.last : null, books };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(r: Registry): void {
  try {
    globalThis.localStorage?.setItem(REGISTRY_KEY, JSON.stringify(r));
  } catch {
    /* private mode: the list lasts this visit */
  }
}

function remember(id: string, title: string): void {
  const r = readRegistry();
  const books = [{ id, title, openedAt: new Date().toISOString() }, ...r.books.filter((b) => b.id !== id)];
  writeRegistry({ v: 1, last: id, books });
}

function forget(id: string): void {
  const r = readRegistry();
  writeRegistry({ v: 1, last: r.last === id ? null : r.last, books: r.books.filter((b) => b.id !== id) });
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The book's meta object, as stored (a JSON value in the `meta` Y.Map). Never mutate it: set a new value. */
export function bookMeta(ydoc: Y.Doc): Rec {
  const m = ydoc.getMap<unknown>(META).get('meta');
  return isRec(m) ? m : {};
}

export const bookIdOf = (ydoc: Y.Doc): string | null => {
  const id = bookMeta(ydoc).bookId;
  return typeof id === 'string' && id ? id : null;
};

const isEmptyDoc = (ydoc: Y.Doc): boolean =>
  ydoc.getArray(SECTIONS).length === 0 && ydoc.getMap(META).size === 0 && ydoc.getMap(LAYOUT).size === 0;

/** y-indexeddb's whenSynced never settles when the database cannot be opened (storage blocked): fail instead. */
function synced(p: IndexeddbPersistence): Promise<unknown> {
  return Promise.race([p.whenSynced, p._db.then(() => new Promise<never>(() => undefined))]);
}

/** A structured-cloned byte array as a Uint8Array (instanceof can fail across realms, so check the view). */
const bytes = (v: unknown): Uint8Array | null =>
  ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;

/** One open book: its Y.Doc, its persistence, and the tab channel. */
export class OpenBook {
  readonly id: string;
  readonly ydoc: Y.Doc;
  readonly persistence: IndexeddbPersistence;
  /** What importBook had to change on the way in (lone surrogates); empty for a book reopened from this device. */
  readonly textWarnings: TextWarning[];
  private channel: BroadcastChannel | null = null;
  private closed = false;

  constructor(id: string, ydoc: Y.Doc, persistence: IndexeddbPersistence, textWarnings: TextWarning[] = []) {
    this.id = id;
    this.ydoc = ydoc;
    this.persistence = persistence;
    this.textWarnings = textWarnings;
    if (typeof BroadcastChannel === 'function') {
      const ch = new BroadcastChannel(dbNameFor(id));
      this.channel = ch;
      ch.onmessage = (e: MessageEvent) => {
        const m = e.data as { u?: unknown; sv?: unknown } | null;
        const u = bytes(m?.u);
        const sv = bytes(m?.sv);
        if (u) Y.applyUpdate(ydoc, u, ch);
        // a new tab says hello with its state vector: send it what it lacks
        else if (sv) ch.postMessage({ u: Y.encodeStateAsUpdate(ydoc, sv) });
      };
      ydoc.on('update', this.relay);
      ch.postMessage({ sv: Y.encodeStateVector(ydoc) });
    }
  }

  private relay = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this.channel && this.channel) this.channel.postMessage({ u: update });
  };

  /** The book as book-format v1 (the `book` of a backup file). */
  export(): Rec {
    return exportBook(this.ydoc);
  }

  /** Close this book here (the data stays on the device). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ydoc.off('update', this.relay);
    this.channel?.close();
    this.channel = null;
    await this.persistence.destroy();
    this.ydoc.destroy();
  }
}

/** Reopen a book saved on this device. Null when there is nothing stored under that id. */
export async function openStoredBook(id: string): Promise<OpenBook | null> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(dbNameFor(id), ydoc);
  await synced(persistence);
  if (isEmptyDoc(ydoc)) {
    await persistence.destroy();
    ydoc.destroy();
    forget(id);
    return null;
  }
  remember(id, String(bookMeta(ydoc).title ?? ''));
  return new OpenBook(id, ydoc, persistence);
}

/** Open a book document (or a backup file's book) on this device: importBook (readBook first; throws BookImportError unless
 *  it reads as 'ok'), then persist it as a fresh database. A copy of the same book already on this device is replaced. */
export async function importToDevice(doc: unknown): Promise<OpenBook> {
  const ydoc = new Y.Doc();
  const res = importBook(doc, ydoc);
  const id = bookIdOf(ydoc);
  if (!id) throw new Error('the imported book has no bookId'); // readBook mints one, so this cannot happen
  await clearDocument(dbNameFor(id));
  const persistence = new IndexeddbPersistence(dbNameFor(id), ydoc); // stores the whole doc as its first update
  await synced(persistence);
  remember(id, String(bookMeta(ydoc).title ?? ''));
  return new OpenBook(id, ydoc, persistence, res.textWarnings);
}

/** The book that was open last on this device, if it is still stored. */
export async function openLastBook(): Promise<OpenBook | null> {
  const last = readRegistry().last;
  return last ? openStoredBook(last) : null;
}
