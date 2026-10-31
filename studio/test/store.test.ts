import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { BODY, BookImportError, SECTIONS, toDoc } from '@book/editor/index.js';
import { readBook } from '@book/read.js';
import { LEGACY_DB } from '../src/book/legacy10';
import { REGISTRY_KEY, dbNameFor, importToDevice, openLastBook, openStoredBook, readRegistry, type OpenBook } from '../src/book/store';
import { DUMAS, fixtures } from './fixtures';

/* The store: a book opened on this device is a Y.Doc in its own
   y-indexeddb database; reopening it from that database and exporting
   gives back exactly what readBook read (review focus #1 at the model
   level, through persistence), and nothing touches 1.0's database. */

const open: OpenBook[] = [];
const track = (b: OpenBook | null): OpenBook => {
  if (!b) throw new Error('expected a book');
  open.push(b);
  return b;
};
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
  localStorage.clear();
});

const expectedOf = (book: unknown, exported: Record<string, unknown>): unknown => {
  const r = readBook(book);
  const want = JSON.parse(JSON.stringify(r.book)) as Record<string, unknown>;
  // readBook mints a random bookId for a book without one (bookid-missing): the export keeps the one minted at import
  if (r.upgrades.includes('bookid-missing')) (want.meta as Record<string, unknown>).bookId = (exported.meta as Record<string, unknown>).bookId;
  return want;
};

const chapterFragment = (b: OpenBook, i: number): Y.XmlFragment => (b.ydoc.getArray(SECTIONS).get(i) as Y.Map<unknown>).get(BODY) as Y.XmlFragment;

describe('the store (y-indexeddb)', () => {
  it('no-edit gate, model level: every fixture imports, reopens from its database, and exports exactly what readBook read', async () => {
    const all = fixtures('all');
    expect(all.length).toBeGreaterThanOrEqual(25);
    for (const f of all) {
      const a = await importToDevice(f.book);
      const id = a.id;
      const first = a.export();
      await a.close();
      const b = await openStoredBook(id);
      expect(b, f.name).not.toBeNull();
      const again = b!.export();
      await b!.close();
      expect(JSON.stringify(again), f.name).toBe(JSON.stringify(first));
      expect(again, f.name).toEqual(expectedOf(f.book, again));
      expect(JSON.stringify(again), f.name + ' (key order too)').toBe(JSON.stringify(expectedOf(f.book, again)));
    }
  }, 240_000);

  it('the database name is beuk-next-book-<bookId>; the registry remembers the last book; openLastBook reopens it', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const a = track(await importToDevice(f.book));
    const bookId = (f.book.meta as { bookId: string }).bookId;
    expect(a.id).toBe(bookId);
    expect(dbNameFor(bookId)).toBe('beuk-next-book-' + bookId);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain('beuk-next-book-' + bookId);
    expect(names).not.toContain(LEGACY_DB);
    expect(readRegistry()).toMatchObject({ v: 1, last: bookId, books: [{ id: bookId, title: (f.book.meta as { title: string }).title }] });
    expect(JSON.parse(localStorage.getItem(REGISTRY_KEY)!).last).toBe(bookId);
    await open.pop()!.close();
    const b = track(await openLastBook());
    expect(b.id).toBe(bookId);
  });

  it('an edit persists: change a chapter, close, reopen from the database — only that section\'s content differs', async () => {
    const f = fixtures('real').find((x) => x.name === DUMAS)!;
    const a = await importToDevice(f.book);
    const before = a.export();
    const frag = chapterFragment(a, 3);
    a.ydoc.transact(() => {
      frag.delete(0, frag.length);
      prosemirrorToYXmlFragment(toDoc('A new first line.\n\nAnd *another*.'), frag);
    });
    await a.close();
    const b = track(await openStoredBook(a.id));
    const after = b.export();
    const bs = before.sections as Record<string, unknown>[];
    const as = after.sections as Record<string, unknown>[];
    expect(as[3]!.content).toBe('A new first line.\n\nAnd *another*.');
    expect({ ...after, sections: as.map((s, i) => (i === 3 ? { ...s, content: bs[3]!.content } : s)) }).toEqual(before);
  }, 60_000);

  it('two tabs on one book: edits made in each reach the other and both export the same book with both edits', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/salt-road-book-one')!;
    const a = track(await importToDevice(f.book));
    const b = track(await openStoredBook(a.id));
    const put = (bk: OpenBook, i: number, text: string) => {
      const frag = chapterFragment(bk, i);
      bk.ydoc.transact(() => {
        frag.delete(0, frag.length);
        prosemirrorToYXmlFragment(toDoc(text), frag);
      });
    };
    put(a, 1, 'Edited in tab A.');
    put(b, 2, 'Edited in tab B.');
    await new Promise((r) => setTimeout(r, 200)); // BroadcastChannel delivery
    const ea = a.export();
    const eb = b.export();
    const content = (e: Record<string, unknown>, i: number) => (e.sections as { content: string }[])[i]!.content;
    expect([content(ea, 1), content(ea, 2)], 'tab A sees both edits').toEqual(['Edited in tab A.', 'Edited in tab B.']);
    expect([content(eb, 1), content(eb, 2)], 'tab B sees both edits').toEqual(['Edited in tab A.', 'Edited in tab B.']);
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    // and the database holds both: a third open (a reload) sees them
    await new Promise((r) => setTimeout(r, 100));
    const c = track(await openStoredBook(a.id));
    const ec = c.export();
    expect([content(ec, 1), content(ec, 2)], 'a reload sees both edits').toEqual(['Edited in tab A.', 'Edited in tab B.']);
    expect(JSON.stringify(ec)).toBe(JSON.stringify(ea));
  });

  it('a book readBook cannot open is refused (BookImportError) and nothing is stored', async () => {
    const newer = { meta: { title: 'From the future', bookId: 'urn:uuid:11111111-2222-4333-8444-555555555555' }, sections: [], formatVersion: 999 };
    expect(readBook(newer).status).toBe('newer');
    await expect(importToDevice(newer)).rejects.toBeInstanceOf(BookImportError);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(dbNameFor('urn:uuid:11111111-2222-4333-8444-555555555555'));
  });

  it('lone surrogates are reported as textWarnings with the section id (constraint 8)', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/bookbinders-letter')!;
    const book = structuredClone(f.book) as { sections: { id: string; content: string }[] };
    book.sections[1]!.content = 'broken \uD800 here';
    const a = track(await importToDevice(book));
    expect(a.textWarnings).toEqual([expect.objectContaining({ code: 'lone-surrogate', sectionId: book.sections[1]!.id, count: 1 })]);
    // reopened from the device, the book carries no warnings: they belong to the import
    const id = a.id;
    await open.pop()!.close();
    const b = track(await openStoredBook(id));
    expect(b.textWarnings).toEqual([]);
  });

  it('nothing in the store ever creates 1.0\'s database', async () => {
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(LEGACY_DB);
  });
});
