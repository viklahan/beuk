import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook, META } from '../../src/book/editor/index';
import { getMeta, sectionOps, setMeta, setMetaMany } from '../src/book/hooks';
import { DUMAS, fixtures } from './fixtures';

/* Task 2: typed book hooks. Book data goes through Yjs only: settings as
   NEW values in `meta`, sections by structural operations, each one Y
   transaction. */

const open = (name = 'real/lunas-beach') => {
  const f = fixtures('real').find((x) => x.name === name) ?? fixtures('real')[0]!;
  const ydoc = new Y.Doc();
  importBook(f.book, ydoc);
  return ydoc;
};
/** How many transactions (Y updates) `fn` makes. */
const updates = (ydoc: Y.Doc, fn: () => void): number => {
  let n = 0;
  const on = () => n++;
  ydoc.on('update', on);
  fn();
  ydoc.off('update', on);
  return n;
};
type Rec = Record<string, unknown>;

describe('setMeta / getMeta', () => {
  it('stores a new value, never the object it was handed, in one transaction; the export carries it', () => {
    const ydoc = open();
    const meta = getMeta(ydoc, 'meta')!;
    const next = { ...meta, title: 'A New Title' };
    expect(updates(ydoc, () => setMeta(ydoc, 'meta', next))).toBe(1);
    const stored = ydoc.getMap(META).get('meta') as Rec;
    expect(stored).not.toBe(next);
    next.title = 'mutated after';
    expect((ydoc.getMap(META).get('meta') as Rec).title).toBe('A New Title');
    expect((exportBook(ydoc).meta as Rec).title).toBe('A New Title');
    expect(meta.title).not.toBe('A New Title'); // the value read before is untouched
  });

  it('setMetaMany writes several keys in one transaction', () => {
    const ydoc = open();
    expect(updates(ydoc, () => setMetaMany(ydoc, { history: [], historyPool: { images: [], fonts: [], covers: [] } }))).toBe(1);
  });
});

describe('section operations: one transaction each, exported exactly', () => {
  it('insert, remove, move, duplicate', () => {
    const ydoc = open(DUMAS);
    const before = exportBook(ydoc).sections as Rec[];
    const ops = sectionOps(ydoc);
    const n = ops.length;

    const extra = { ...before[3]!, id: 'sNEW001', content: 'A new *section*.\n\nTwo paragraphs.' };
    expect(updates(ydoc, () => ops.insert(2, [extra]))).toBe(1);
    let now = exportBook(ydoc).sections as Rec[];
    expect(now.length).toBe(n + 1);
    expect(now[2]).toEqual(extra);

    expect(updates(ydoc, () => ops.remove(2))).toBe(1);
    expect(exportBook(ydoc).sections).toEqual(before);

    expect(updates(ydoc, () => ops.move(5, 1))).toBe(1);
    now = exportBook(ydoc).sections as Rec[];
    const moved = [...before];
    moved.splice(1, 0, moved.splice(5, 1)[0]!);
    expect(now).toEqual(moved);
    ops.move(1, 5);
    expect(exportBook(ydoc).sections).toEqual(before);

    expect(updates(ydoc, () => ops.duplicate(7, { id: 'sDUP0001' }))).toBe(1);
    now = exportBook(ydoc).sections as Rec[];
    expect(now[8]).toEqual({ ...before[7]!, id: 'sDUP0001' });
    expect(now.length).toBe(n + 1);
  });

  it('importBook still stores exactly what it did (it now goes through insertSections)', () => {
    for (const f of fixtures('real')) {
      const ydoc = new Y.Doc();
      const r = importBook(f.book, ydoc);
      expect(r.status).toBe('ok');
      const a = exportBook(ydoc);
      const again = new Y.Doc();
      importBook(a, again);
      expect(exportBook(again), f.name).toEqual(a);
    }
  });
});
