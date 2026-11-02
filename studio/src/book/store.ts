import * as Y from 'yjs';
import { IndexeddbPersistence, clearDocument, storeState } from 'y-indexeddb';
import { BLOB_ORIGIN, collectBlobs, exportBook, importBook, LAYOUT, META, migrateSections, packBlobs, sectionsCount, type TextWarning } from '@book/editor/index.js';

/* The books on this device, as Y.Docs (step 4 part C).

   GENERATIONS. Every import of a book starts a new generation (an epoch):
   its own y-indexeddb database and its own tab channel, both named
   `beuk-next-book-<bookId>-<epoch>` (never 1.0's "beuk-local"). Two Y.Docs
   made by two imports of the same book hold the same content under
   different Yjs client ids, so they must never meet: merging them would
   double every section. Tabs exchange updates only within a generation.
   - Opening a backup (the writer's explicit choice) persists a NEW
     generation, then tells the other tabs ("replaced → epoch E" on the
     book's control channel `beuk-next-book-<bookId>`), and only then
     deletes the older generations' databases. A tab still on an old
     generation drops it and reopens the new one (also when it sees a newer
     epoch in the registry, and when its database is deleted under it).
   - The automatic import of 1.0's local book never clears or replaces
     anything: it first looks for any 2.0 book already on this device (the
     registry, then indexedDB.databases()), and opens that instead. It runs
     under a Web Lock and re-checks inside it, so two tabs opened together
     import once. It writes the fixed first generation LEGACY_EPOCH, which a
     browser without databases() can still find with the registry lost.

   The list of books (id, title, epoch) and the last one open is a small
   localStorage record; losing it loses nothing (the databases are the
   truth, and the record is rebuilt from them). */

export const DB_PREFIX = 'beuk-next-book-';
export const REGISTRY_KEY = 'beuk.next.books.v1';
/** The generation of a book imported automatically from 1.0 (sorts before every minted epoch). */
export const LEGACY_EPOCH = 'e' + '0'.repeat(21);
const EPOCH_RE = /^e\d{15}[0-9a-f]{6}$/;
const NAME_RE = /^beuk-next-book-(.+)-(e\d{15}[0-9a-f]{6})$/;

/** A new epoch: "e" + 15 digits of milliseconds + 6 hex, so epochs sort by time as strings. */
export function newEpoch(): string {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(3));
  return 'e' + String(Date.now()).padStart(15, '0') + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const dbNameFor = (bookId: string, epoch: string): string => `${DB_PREFIX}${bookId}-${epoch}`;
const controlName = (bookId: string): string => DB_PREFIX + bookId;

export function parseDbName(name: string): { id: string; epoch: string } | null {
  const m = NAME_RE.exec(name);
  return m ? { id: m[1]!, epoch: m[2]! } : null;
}

export type BookEntry = { id: string; title: string; openedAt: string; epoch: string };
export type Registry = { v: 1; last: string | null; books: BookEntry[] };

const emptyRegistry = (): Registry => ({ v: 1, last: null, books: [] });

export function readRegistry(): Registry {
  try {
    const raw = globalThis.localStorage?.getItem(REGISTRY_KEY);
    if (!raw) return emptyRegistry();
    const r = JSON.parse(raw) as Partial<Registry>;
    if (r.v !== 1 || !Array.isArray(r.books)) return emptyRegistry();
    const books = r.books.filter(
      (b): b is BookEntry => !!b && typeof b.id === 'string' && typeof b.title === 'string' && typeof b.epoch === 'string' && EPOCH_RE.test(b.epoch),
    );
    return { v: 1, last: typeof r.last === 'string' ? r.last : null, books };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(r: Registry): void {
  try {
    globalThis.localStorage?.setItem(REGISTRY_KEY, JSON.stringify(r));
  } catch {
    /* blocked or full: the databases stay the truth, and the record is rebuilt from them */
  }
}

function remember(id: string, epoch: string, title: string): void {
  const r = readRegistry();
  const books = [{ id, title, epoch, openedAt: new Date().toISOString() }, ...r.books.filter((b) => b.id !== id)];
  writeRegistry({ v: 1, last: id, books });
}

/** The registry's epoch for a book, if any. */
export const registryEpoch = (id: string): string | null => readRegistry().books.find((b) => b.id === id)?.epoch ?? null;

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
  sectionsCount(ydoc) === 0 && ydoc.getMap(META).size === 0 && ydoc.getMap(LAYOUT).size === 0;

/** y-indexeddb's whenSynced never settles when the database cannot be opened (storage blocked): fail instead. */
function synced(p: IndexeddbPersistence): Promise<unknown> {
  return Promise.race([p.whenSynced, p._db.then(() => new Promise<never>(() => undefined))]);
}

/** A structured-cloned byte array as a Uint8Array (instanceof can fail across realms, so check the view). */
const bytes = (v: unknown): Uint8Array | null =>
  ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : null;

/** Every 2.0 book generation on this device, or null when the browser cannot list databases. */
export async function listGenerations(): Promise<{ id: string; epoch: string; name: string }[] | null> {
  const idb = globalThis.indexedDB;
  if (!idb || typeof idb.databases !== 'function') return null;
  try {
    const list = await idb.databases();
    return list.flatMap((d) => {
      const p = d.name ? parseDbName(d.name) : null;
      return p ? [{ ...p, name: d.name! }] : [];
    });
  } catch {
    return null;
  }
}

/** How long after a change to the book's values the unnamed pictures are let go (one sweep for a burst of changes). */
export const BLOB_GC_MS = 800;

/** One open book (one generation): its Y.Doc, its persistence, and the tab channels. */
export class OpenBook {
  readonly id: string;
  readonly epoch: string;
  readonly ydoc: Y.Doc;
  readonly persistence: IndexeddbPersistence;
  /** What importBook had to change on the way in (lone surrogates); empty for a book reopened from this device. */
  readonly textWarnings: TextWarning[];
  /** Called once when this generation stops being the book's current one (replaced elsewhere, or its database deleted). */
  onStale: ((b: OpenBook) => void) | null = null;
  private channel: BroadcastChannel | null = null;
  private control: BroadcastChannel | null = null;
  private closed = false;
  private stale = false;
  private blobTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(id: string, epoch: string, ydoc: Y.Doc, persistence: IndexeddbPersistence, textWarnings: TextWarning[] = []) {
    this.id = id;
    this.epoch = epoch;
    this.ydoc = ydoc;
    this.persistence = persistence;
    this.textWarnings = textWarnings;
    ydoc.on('afterTransaction', this.watchBlobs);
    // The database deleted under us (a newer generation replaced it): stop writing, then go stale.
    void persistence._db.then((db) => {
      const prev = db.onversionchange;
      db.onversionchange = (e) => {
        this.markStale();
        if (typeof prev === 'function') prev.call(db, e);
      };
    }).catch(() => undefined);
    if (typeof BroadcastChannel === 'function') {
      const ch = new BroadcastChannel(dbNameFor(id, epoch));
      this.channel = ch;
      ch.onmessage = (e: MessageEvent) => {
        if (this.stale) return;
        const m = e.data as { u?: unknown; sv?: unknown } | null;
        const u = bytes(m?.u);
        const sv = bytes(m?.sv);
        if (u) Y.applyUpdate(ydoc, u, ch);
        // a new tab on this generation says hello with its state vector: send it what it lacks
        else if (sv) ch.postMessage({ u: Y.encodeStateAsUpdate(ydoc, sv) });
      };
      ydoc.on('update', this.relay);
      ch.postMessage({ sv: Y.encodeStateVector(ydoc) });
      const ctl = new BroadcastChannel(controlName(id));
      this.control = ctl;
      ctl.onmessage = (e: MessageEvent) => {
        const m = e.data as { replaced?: unknown } | null;
        if (typeof m?.replaced === 'string' && m.replaced > this.epoch) this.markStale();
      };
    }
  }

  /** After a change of this tab's to the book's values: the pictures no value names any more are let go (never one still
   *  named — History and its pool are values too), and y-indexeddb is compacted so their bytes leave IndexedDB
   *  (it keeps every update until ~500 have gathered). A keystroke changes no value: nothing runs. */
  private watchBlobs = (tr: Y.Transaction): void => {
    if (this.stale || this.closed || !tr.local || tr.origin === BLOB_ORIGIN || !tr.changed.has(this.ydoc.getMap(META) as never)) return;
    if (this.blobTimer) clearTimeout(this.blobTimer);
    this.blobTimer = setTimeout(() => void this.collect(), BLOB_GC_MS);
  };

  /** Let go of unnamed pictures now and compact the store when any went (also what the debounced watcher runs). */
  async collect(): Promise<number> {
    this.blobTimer = null;
    if (this.stale || this.closed) return 0;
    const n = collectBlobs(this.ydoc);
    if (n) await storeState(this.persistence, true).catch(() => undefined);
    return n;
  }

  private relay = (update: Uint8Array, origin: unknown): void => {
    if (!this.stale && origin !== this.channel && this.channel) this.channel.postMessage({ u: update });
  };

  /** This generation is no longer the book's: stop relaying and storing, and tell whoever holds it. */
  markStale(): void {
    if (this.stale) return;
    this.stale = true;
    this.ydoc.off('update', this.relay);
    this.ydoc.off('update', this.persistence._storeUpdate);
    const cb = this.onStale;
    this.onStale = null;
    if (cb) queueMicrotask(() => cb(this));
  }

  get isStale(): boolean {
    return this.stale;
  }

  /** Tell the other tabs that this generation replaced every older one. */
  announce(): void {
    this.control?.postMessage({ replaced: this.epoch });
  }

  /** The book as book-format v1 (the `book` of a backup file). What a feature still holds unwritten (the Covenant
   *  room's 300 ms pause) is written first. */
  export(): Rec {
    settleWrites();
    return exportBook(this.ydoc);
  }

  /** Close this book here (the data stays on the device). */
  async close(): Promise<void> {
    if (this.closed) return;
    settleWrites();
    this.closed = true;
    this.onStale = null;
    this.ydoc.off('update', this.relay);
    this.ydoc.off('afterTransaction', this.watchBlobs);
    if (this.blobTimer) clearTimeout(this.blobTimer);
    this.blobTimer = null;
    this.channel?.close();
    this.control?.close();
    this.channel = null;
    this.control = null;
    await this.persistence.destroy().catch(() => undefined);
    this.ydoc.destroy();
  }
}

/** Open one generation; null (and nothing created that matters) when it holds no book. */
async function openGeneration(id: string, epoch: string): Promise<OpenBook | null> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(dbNameFor(id, epoch), ydoc);
  await synced(persistence);
  if (isEmptyDoc(ydoc)) {
    await persistence.destroy();
    ydoc.destroy();
    return null;
  }
  // a book stored before the picture store (waves 1a-1c held pictures inline in meta): packed once, then the old
  // updates compacted away so the inline copies leave IndexedDB (a storage change only: the export is the same)
  // a book stored before the section order was kept apart (model v1, one Y.Array): migrated once, in one transaction
  // (sections.ts migrateSections: deterministic keys, so two tabs migrating at once converge), then compacted
  const migrated = migrateSections(ydoc);
  if (packBlobs(ydoc) || migrated) await storeState(persistence, true).catch(() => undefined);
  remember(id, epoch, String(bookMeta(ydoc).title ?? ''));
  return new OpenBook(id, epoch, ydoc, persistence);
}

/** The newest generation of a book on this device that holds it: the registry's epoch and every listed one, newest first. */
export async function openStoredBook(id: string): Promise<OpenBook | null> {
  const epochs = new Set<string>();
  const reg = registryEpoch(id);
  const gens = await listGenerations();
  if (gens) {
    // only generations that exist (opening a missing one would create an empty database)
    for (const g of gens) if (g.id === id) epochs.add(g.epoch);
  } else {
    // no list: the registry's epoch, and the fixed first generation 1.0's import writes
    if (reg) epochs.add(reg);
    epochs.add(LEGACY_EPOCH);
  }
  for (const epoch of [...epochs].sort().reverse()) {
    const b = await openGeneration(id, epoch);
    if (b) return b;
  }
  return null;
}

/** The book that was open last on this device, if it is still stored. */
export async function openLastBook(): Promise<OpenBook | null> {
  const last = readRegistry().last;
  return last ? openStoredBook(last) : null;
}

/** Any 2.0 book already on this device (the registry first, then every database listed), newest generation first.
 *  Rebuilds the registry from what it opens. Null when there is none (or the browser cannot list databases). */
export async function discoverBook(): Promise<OpenBook | null> {
  const last = await openLastBook();
  if (last) return last;
  for (const b of readRegistry().books) {
    const o = await openStoredBook(b.id);
    if (o) return o;
  }
  const gens = (await listGenerations()) ?? [];
  const newest = new Map<string, string>();
  for (const g of gens) if ((newest.get(g.id) ?? '') < g.epoch) newest.set(g.id, g.epoch);
  for (const [id] of [...newest].sort((a, b) => (a[1] < b[1] ? 1 : -1))) {
    const o = await openStoredBook(id);
    if (o) return o;
  }
  return null;
}

/** Delete every generation of a book except `keep` (after `keep` is persisted). Never waits more than a few seconds. */
async function dropOlderGenerations(id: string, keep: string, known: string[]): Promise<void> {
  const names = new Set(known.filter((e) => e !== keep).map((e) => dbNameFor(id, e)));
  for (const g of (await listGenerations()) ?? []) if (g.id === id && g.epoch !== keep) names.add(g.name);
  await Promise.all(
    [...names].map((n) => Promise.race([clearDocument(n).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))])),
  );
}

/** The writer opened a backup (or a book document): importBook (readBook first; throws BookImportError unless 'ok'), persist
 *  it as a NEW generation, tell the other tabs, then delete the book's older generations. Nothing is merged into an old one. */
export async function importToDevice(doc: unknown): Promise<OpenBook> {
  const ydoc = new Y.Doc();
  const res = importBook(doc, ydoc);
  const id = bookIdOf(ydoc);
  if (!id) throw new Error('the imported book has no bookId'); // readBook mints one, so this cannot happen
  const previous = registryEpoch(id);
  const epoch = newEpoch();
  const persistence = new IndexeddbPersistence(dbNameFor(id, epoch), ydoc); // stores the whole doc as its first update
  await synced(persistence);
  remember(id, epoch, String(bookMeta(ydoc).title ?? ''));
  const book = new OpenBook(id, epoch, ydoc, persistence, res.textWarnings);
  book.announce();
  await dropOlderGenerations(id, epoch, [LEGACY_EPOCH, ...(previous ? [previous] : [])]);
  return book;
}

/** Same-tab fallback when the browser has no Web Locks: one start-up at a time. */
let localChain: Promise<unknown> = Promise.resolve();
function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks && typeof locks.request === 'function') return locks.request('beuk-next-import', fn) as Promise<T>;
  const run = localChain.then(fn, fn);
  localChain = run.catch(() => undefined);
  return run;
}

/** 1.0's book, imported automatically: never clears or replaces. If this book (or any 2.0 book) is already on the device,
 *  that is opened instead. `imported` says whether anything was written. */
async function importLegacyOnce(book: unknown): Promise<{ book: OpenBook; imported: boolean }> {
  const existing = await discoverBook();
  if (existing) return { book: existing, imported: false };
  const ydoc = new Y.Doc();
  const res = importBook(book, ydoc);
  const id = bookIdOf(ydoc);
  if (!id) throw new Error('the imported book has no bookId');
  const already = await openStoredBook(id); // finds LEGACY_EPOCH even without databases() or the registry
  if (already) {
    ydoc.destroy();
    return { book: already, imported: false };
  }
  const persistence = new IndexeddbPersistence(dbNameFor(id, LEGACY_EPOCH), ydoc);
  await synced(persistence);
  remember(id, LEGACY_EPOCH, String(bookMeta(ydoc).title ?? ''));
  return { book: new OpenBook(id, LEGACY_EPOCH, ydoc, persistence, res.textWarnings), imported: true };
}

/** What the studio opens at start-up: the last book, else any 2.0 book on this device, else 1.0's local book imported once
 *  (under a Web Lock, re-checked inside it), else nothing. `importedLegacy` is true only when 1.0's book was written now. */
export async function startBook(readLegacy: () => Promise<{ book: Rec; missing?: number } | null>): Promise<{ book: OpenBook; importedLegacy: boolean; picsMissing: number } | null> {
  const found = await discoverBook();
  if (found) return { book: found, importedLegacy: false, picsMissing: 0 };
  const legacy = await readLegacy();
  if (!legacy) return null;
  const r = await withImportLock(() => importLegacyOnce(legacy.book));
  // 1.0's local.picsMissing: pictures of 1.0's saved book this device could not read (their names kept, as 1.0 opens it)
  return { book: r.book, importedLegacy: r.imported, picsMissing: r.imported ? legacy.missing ?? 0 : 0 };
}

/** Forget a book on this device: every generation's database deleted and its registry entry dropped (1.0's
 *  BEUK:remnants — Remove sample leaves nothing of the sample behind). Never call it for the book open in this tab. */
export async function forgetBook(id: string): Promise<void> {
  const r = readRegistry();
  const known = r.books.filter((b) => b.id === id).map((b) => b.epoch);
  writeRegistry({ v: 1, last: r.last === id ? null : r.last, books: r.books.filter((b) => b.id !== id) });
  await dropOlderGenerations(id, '', [LEGACY_EPOCH, ...known]);
}

/* Writes a feature holds back for a pause (1.0 saved the book a moment after an edit; the Covenant room writes after
   300 ms of quiet): every one is written before the book is exported or closed. */
const settlers = new Set<() => void>();
/** Register a writer to settle before an export or a close; returns the unregister. */
export function onSettleWrites(fn: () => void): () => void {
  settlers.add(fn);
  return () => settlers.delete(fn);
}
/** Write everything held back now. */
export function settleWrites(): void {
  for (const fn of settlers) fn();
}
