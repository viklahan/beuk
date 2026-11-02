import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BLOBS, BODY, exportBook, importBook, insertSectionsAt, isV1, LAYOUT, META, MIGRATE_ORIGIN, migrateSections, MODEL, ORDER, SECS, SECTIONS, sectionAt, sectionKeys, sectionList, sectionsCount } from '../../src/book/editor/index';
import { sectionOps } from '../src/book/hooks';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureT, type Closure } from '../src/closure/index';
import { moveTo, retype } from '../src/structure/structure';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { DUMAS, fixtures } from './fixtures';

/* Section order kept apart from the sections (spec 2026-11-01), acceptance #1: the keystroke test. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});

const dumas = () => fixtures('real').find((f) => f.name === DUMAS)!.book;
const ids = (y: Y.Doc) => (exportBook(y).sections as Rec[]).map((s) => String(s.id));
function mapById(y: Y.Doc, id: string): Y.Map<unknown> {
  const m = sectionList(y).find((x) => x instanceof Y.Map && x.get('id') === id);
  return m as Y.Map<unknown>;
}
function firstText(t: Y.XmlFragment | Y.XmlElement): Y.XmlText | null {
  for (const ch of t.toArray()) {
    if (ch instanceof Y.XmlText) return ch;
    if (ch instanceof Y.XmlElement) {
      const r = firstText(ch);
      if (r) return r;
    }
  }
  return null;
}
const sync = (a: Y.Doc, b: Y.Doc) => {
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
};

describe('acceptance #1: typing survives a concurrent move and a cross-tier retype', () => {
  it('A types in chapter 3 while B moves it to the end of the body and retypes it into the back matter', () => {
    const A = new Y.Doc();
    importBook(dumas(), A);
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
    const secs = exportBook(A).sections as Rec[];
    const chapters = secs.filter((s) => s.type === 'chapter');
    const ch3 = String(chapters[2]!.id);
    const lastBody = String([...secs].reverse().find((s) => (s.kind ?? 'body') === 'body')!.id);

    // A types (B has not seen it yet)
    const text = firstText(mapById(A, ch3).get(BODY) as Y.XmlFragment)!;
    text.insert(0, 'KEYSTROKES-FROM-A ');
    // B moves chapter 3 to the end of the body, then retypes it across tiers
    expect(moveTo(c, B, ch3, lastBody, true).wrote).toBe(true);
    expect(retype(c, B, ch3, 'back:aboutauthor').wrote).toBe(true);
    const bOrder = ids(B);
    const bSec = (exportBook(B).sections as Rec[]).find((s) => s.id === ch3)!;
    expect(bSec.kind).toBe('back');

    sync(A, B);
    const ea = exportBook(A), eb = exportBook(B);
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    const got = (ea.sections as Rec[]).filter((s) => s.id === ch3);
    expect(got.length).toBe(1);
    expect(String(got[0]!.content)).toContain('KEYSTROKES-FROM-A');
    expect(got[0]!.kind).toBe('back');
    expect(ids(A)).toEqual(bOrder);
  }, 120_000);
});

/* ---- the door (sections.ts): the read rule, concurrency, the migration ---- */

const order = (y: Y.Doc) => y.getMap<unknown>(ORDER);
const plainBook = (names: string[]) => {
  const book = c.api.buildEmptyBook();
  book.sections = names.map((n) => c.api.mkSection('body', 'chapter', n, { content: n + ' text.' }));
  return book;
};
const titles = (y: Y.Doc) => (exportBook(y).sections as Rec[]).map((s) => String(s.title));
const pair = (book: unknown) => {
  const A = new Y.Doc();
  importBook(book, A);
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(A));
  return [A, B] as const;
};
const chapter = (n: string) => c.api.mkSection('body', 'chapter', n, { content: n + '.' });

/** A v1 doc, laid out exactly as importBook did before model 2 (one Y.Array of section Y.Maps, no layout.model). */
function v1Doc(book: unknown, src = new Y.Doc()): Y.Doc {
  if (!src.getMap(LAYOUT).size) importBook(book, src);
  const y = new Y.Doc();
  y.transact(() => {
    for (const name of [META, BLOBS]) for (const [k, v] of src.getMap<unknown>(name).entries()) y.getMap<unknown>(name).set(k, v instanceof Y.AbstractType ? v.clone() : v);
    for (const [k, v] of src.getMap<unknown>(LAYOUT).entries()) if (k !== 'model') y.getMap<unknown>(LAYOUT).set(k, v);
    y.getArray<unknown>(SECTIONS).insert(0, sectionList(src).map((s) => (s instanceof Y.AbstractType ? s.clone() : s)));
  });
  return y;
}

describe('the read rule', () => {
  it('sorts by (position, key); a section without a position goes last by key; a position without a section is ignored', () => {
    const y = new Y.Doc();
    importBook(plainBook(['A', 'B', 'C']), y);
    const [ka, kb, kc] = sectionKeys(y);
    y.transact(() => {
      order(y).set(kb!, order(y).get(ka!) as string); // a tie with A: the keys decide
      order(y).delete(kc!); // C loses its position
      order(y).set('zzzzzzzzzzzz', '1'); // a position whose section is gone
    });
    expect(sectionKeys(y)).toEqual([...[ka!, kb!].sort(), kc!]);
    expect(sectionsCount(y)).toBe(3);
    // the next write respaces the tie: every section then has its own position
    insertSectionsAt(y, 1, [chapter('N')]);
    const pos = sectionKeys(y).map((k) => order(y).get(k) as string);
    expect(new Set(pos).size).toBe(4);
    expect([...pos].sort()).toEqual(pos);
    expect(titles(y)[1]).toBe('N');
  });
});

describe('acceptance #2: concurrent writes', () => {
  it('two tabs inserting at the same spot at once read the same order', () => {
    const [A, B] = pair(plainBook(['A', 'B', 'C']));
    sectionOps(A).insert(1, [chapter('fromA')]);
    sectionOps(B).insert(1, [chapter('fromB')]);
    sync(A, B);
    expect(titles(A)).toEqual(titles(B));
    expect(titles(A).length).toBe(5);
    expect(titles(A)[0]).toBe('A');
    expect(new Set(titles(A).slice(1, 3))).toEqual(new Set(['fromA', 'fromB']));
    // an insert between the two tied ones still lands between them
    sectionOps(A).insert(2, [chapter('mid')]);
    expect(titles(A)[2]).toBe('mid');
    sync(A, B);
    expect(titles(B)).toEqual(titles(A));
  });
  it('two tabs moving the same chapter at once: one copy, in one of the two places', () => {
    const [A, B] = pair(plainBook(['A', 'B', 'C', 'D', 'E']));
    sectionOps(A).move(1, 4);
    sectionOps(B).move(1, 0);
    sync(A, B);
    expect(titles(A)).toEqual(titles(B));
    expect(titles(A).filter((x) => x === 'B').length).toBe(1);
    expect(titles(A).length).toBe(5);
    expect(['A,C,D,E,B', 'B,A,C,D,E']).toContain(titles(A).join());
  });
  it('a move is one position write: the section keeps its Y.Map and its fragment', () => {
    const y = new Y.Doc();
    importBook(plainBook(['A', 'B', 'C', 'D']), y);
    const m = sectionAt(y, 0) as Y.Map<unknown>;
    const frag = m.get(BODY);
    const was = new Map(order(y).entries());
    sectionOps(y).move(0, 3);
    expect(titles(y)).toEqual(['B', 'C', 'D', 'A']);
    expect(sectionAt(y, 3)).toBe(m);
    expect(m.get(BODY)).toBe(frag);
    expect([...order(y).entries()].filter(([k, v]) => was.get(k) !== v).length).toBe(1);
  });
  it('a delete removes the entry and its position', () => {
    const y = new Y.Doc();
    importBook(plainBook(['A', 'B']), y);
    const k = sectionKeys(y)[0]!;
    sectionOps(y).remove(0);
    expect(y.getMap(SECS).has(k)).toBe(false);
    expect(order(y).has(k)).toBe(false);
    expect(titles(y)).toEqual(['B']);
  });
});

describe('acceptance #6: the v1 -> v2 migration', () => {
  it('every fixture (Dumas among them): the export before and after migrating is identical, and equals the v2 import', () => {
    const all = fixtures('all');
    expect(all.some((f) => f.name === DUMAS)).toBe(true);
    let n = 0;
    for (const f of all) {
      const fresh = new Y.Doc();
      try {
        importBook(f.book, fresh);
      } catch {
        continue; // a book readBook refuses never reaches a Y.Doc
      }
      const y = v1Doc(f.book, fresh);
      expect(isV1(y), f.name).toBe(sectionsCount(fresh) > 0);
      const before = JSON.stringify(exportBook(y));
      expect(before, f.name).toBe(JSON.stringify(exportBook(fresh)));
      expect(sectionsCount(y)).toBe(sectionsCount(fresh)); // readable through the door before migrating
      const ran = migrateSections(y);
      expect(ran, f.name).toBe(sectionsCount(fresh) > 0);
      expect(JSON.stringify(exportBook(y)), f.name).toBe(before);
      expect(y.getArray(SECTIONS).length).toBe(0);
      if (ran) expect(y.getMap(LAYOUT).get('model')).toBe(MODEL);
      // idempotent: a second run is a no-op, nothing written
      const sv = Y.encodeStateVector(y);
      expect(migrateSections(y)).toBe(false);
      expect(Y.encodeStateVector(y)).toEqual(sv);
      // and through a Yjs update
      const z = new Y.Doc();
      Y.applyUpdate(z, Y.encodeStateAsUpdate(y));
      expect(JSON.stringify(exportBook(z)), f.name).toBe(before);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(20);
  }, 300_000);
  it('two tabs migrating the same v1 book at once converge to one copy of each section', () => {
    const v1 = v1Doc(dumas());
    const before = JSON.stringify(exportBook(v1));
    const A = new Y.Doc(), B = new Y.Doc();
    Y.applyUpdate(A, Y.encodeStateAsUpdate(v1));
    Y.applyUpdate(B, Y.encodeStateAsUpdate(v1));
    expect(migrateSections(A)).toBe(true);
    expect(migrateSections(B)).toBe(true);
    sync(A, B);
    expect(JSON.stringify(exportBook(A))).toBe(before);
    expect(JSON.stringify(exportBook(B))).toBe(before);
    expect(A.getMap(SECS).size).toBe(sectionsCount(v1));
    expect(A.getArray(SECTIONS).length).toBe(0);
    expect(migrateSections(A)).toBe(false);
  });
  it('the migration is one transaction with origin beuk-migrate; a write through the door on a v1 doc migrates first', () => {
    const y = v1Doc(plainBook(['A', 'B', 'C']));
    const origins: unknown[] = [];
    y.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    expect(sectionKeys(y)).toEqual(['m000000', 'm000001', 'm000002']);
    sectionOps(y).move(0, 2);
    expect(origins[0]).toBe(MIGRATE_ORIGIN);
    expect(origins.length).toBe(2);
    expect(titles(y)).toEqual(['B', 'C', 'A']);
    expect(isV1(y)).toBe(false);
  });
});
