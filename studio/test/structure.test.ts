import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook, META, SECTIONS } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureT, stateFromBook, type Closure } from '../src/closure/index';
import { chopDelete } from '../src/chapters/chop';
import { addChapter, addPart, insertMatter, moveStep, moveTo, retype, toggleIncluded, writeOrdered, type RunResult } from '../src/structure/structure';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { fixtures } from './fixtures';

/* Wave 2c, task 1: section types, the matter library, Add Chapter / Add
   Part, move and the include eye (inventory B3), against 1.0's own
   functions.
   Review focus #1 — matter equals 1.0: on every fixture, inserting each
   type of 1.0's MATTER_LIBRARY gives exactly the sections 1.0's own
   insertMatter gives when run directly on 1.0's state of that book (order,
   fields, mkSection's shape; the new id is the one 2.0's run drew, as 1.0's
   uid() is random); a section the action did not touch is byte-identical
   to the stored one; a singleton that stands refuses a second copy (no
   write, 1.0's toast.pageExists).
   Constraint 19: each action is one Y transaction — one Y.UndoManager step
   gives back an export equal (JSON string) to the original.
   1.0 self-checks re-expressed: structure.matter-library (tiers, order,
   singleton jump; the contents/nav half is export, wave 5),
   structure.reorder (move controls, drag-equivalent, persists across a
   re-import, cross-tier refused; the contents/nav/EPUB half is wave 5),
   structure.parts (the grouping and removing a Part; the sidebar half is
   in structure-ui; the EPUB half is wave 5). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const secs = (y: Y.Doc) => exportBook(y).sections as Rec[];
const undoer = (y: Y.Doc) => new Y.UndoManager([y.getArray(SECTIONS), y.getMap(META)], { captureTimeout: 0 });

/** 1.0's own function run directly on 1.0's state of `book` (the oracle): the sections it leaves, normalised. */
function oracle(book: Rec, fn: () => unknown): Rec[] {
  const st = stateFromBook(c, clone(book));
  c.setState(st);
  fn();
  return st.sections.map((s) => c.api.normalizeSection(s));
}
/** 2.0's export, read the way 1.0 reads it (normalizeSection), with `fresh` ids (sections 2.0 made) renamed to the
 *  oracle's ids for the same place. */
function sameAsOracle(got: Rec[], want: Rec[], before: Rec[]) {
  const old = new Set(before.map((s) => s.id));
  const n = got.map((s) => c.api.normalizeSection(s));
  expect(n.length).toBe(want.length);
  const ren = n.map((s, i) => (old.has(s.id) ? s : { ...s, id: want[i]!.id }));
  expect(JSON.stringify(ren)).toBe(JSON.stringify(want));
  // every section that stood and was not touched is stored exactly as before (no 1.0 defaults written in)
}
function untouched(got: Rec[], before: Rec[], touched: Set<unknown>) {
  const byId = new Map(before.map((s) => [s.id, s]));
  for (const s of got) if (byId.has(s.id) && !touched.has(s.id)) expect(JSON.stringify(s)).toBe(JSON.stringify(byId.get(s.id)));
}

const books = fixtures('all').filter((f) => Array.isArray((f.book as Rec).sections) && ((f.book as Rec).sections as Rec[]).every((s) => typeof s?.id === 'string'));

describe('the matter library equals 1.0 on every fixture (review focus #1)', () => {
  it('each type into each fixture: 1.0\'s sections exactly; a standing singleton refuses; one transaction, one Undo', () => {
    expect(books.length).toBeGreaterThanOrEqual(11);
    let inserted = 0, refused = 0;
    for (const f of books) {
      const y = new Y.Doc();
      importBook(f.book, y);
      const original = exportBook(y);
      const origText = JSON.stringify(original);
      const before = original.sections as Rec[];
      for (const g of c.api.MATTER_LIBRARY) {
        for (const type of g.types) {
          const toasts: string[] = [];
          const um = undoer(y);
          const r = insertMatter(c, y, type, (m) => toasts.push(m));
          const want = oracle(original, () => c.api.insertMatter(type));
          const got = secs(y);
          sameAsOracle(got, want, before);
          const fresh = got.filter((s) => !before.some((b) => b.id === s.id));
          if (r.wrote) {
            inserted++;
            expect(fresh.length).toBe(1);
            expect(fresh[0]).toMatchObject({ kind: g.kind, type });
            // mkSection's own shape, in its key order
            expect(Object.keys(fresh[0]!)).toEqual(Object.keys(c.api.mkSection(g.kind, type, 'x', {})));
            expect(r.selected).toBe(fresh[0]!.id);
            expect(toasts).toEqual([t('toast.pageAdded', { name: t('import.type.' + type) })]);
            untouched(got, before, new Set());
            um.undo();
            expect(JSON.stringify(exportBook(y))).toBe(origText);
          } else {
            refused++;
            expect(c.api.SINGLETON_TYPES).toContain(type);
            expect(fresh.length).toBe(0);
            expect(JSON.stringify(exportBook(y))).toBe(origText);
            expect(toasts).toEqual([t('toast.pageExists', { name: t('import.type.' + type) })]);
            expect(r.selected).toBe(before.find((s) => s.type === type && (s.kind ?? 'body') === g.kind)!.id);
          }
          um.destroy();
        }
      }
    }
    expect(inserted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  }, 600_000);
});

describe('retype, Add Chapter / Add Part, move, the eye equal 1.0 on every fixture (constraint 17, 19)', () => {
  const TARGETS = ['front:foreword', 'front:epigraph', 'body:chapter', 'body:part', 'body:prologue', 'back:cta', 'back:aboutauthor'];
  it('each action: 1.0\'s sections exactly, only the touched section changed, one Undo gives the export back', () => {
    for (const f of books) {
      const base = new Y.Doc();
      importBook(f.book, base);
      const seed = Y.encodeStateAsUpdate(base);
      const original = exportBook(base);
      const origText = JSON.stringify(original);
      const before = original.sections as Rec[];
      // each action on its own copy of the opened book (a Y.UndoManager restoring a section that was taken out and put
      // in again after OTHER undone edits re-lays its keys in Yjs's item order: a property of the test's undo stack,
      // not of the action; 2.0 has no book-wide undo stack, see the report)
      let y = base;
      const run = (label: string, fn2: () => RunResult<unknown>, fn1: () => unknown, touched: Set<unknown>) => {
        y = new Y.Doc();
        Y.applyUpdate(y, seed);
        const um = undoer(y);
        const r = fn2();
        const want = oracle(original, fn1);
        const got = secs(y);
        sameAsOracle(got, want, before);
        untouched(got, before, touched);
        if (r.wrote) {
          um.undo();
          expect(JSON.stringify(exportBook(y)), `${f.name} ${label} undo`).toBe(origText);
        } else expect(JSON.stringify(exportBook(y))).toBe(origText);
        um.destroy();
      };
      // one section of each kind, and the first chapter
      const picks = [...new Set(['front', 'body', 'back'].map((k) => before.find((s) => (s.kind ?? 'body') === k)).concat(before.find((s) => s.type === 'chapter')).filter(Boolean))] as Rec[];
      for (const s of picks) {
        const id = s.id as string;
        for (const to of TARGETS) {
          const [k, ty] = to.split(':');
          // retypeSection renumbers a section turned into a chapter: every chapter's number is read, nothing else moves
          run(`retype ${id} ${to}`, () => retype(c, y, id, to), () => c.api.retypeSection(id, ty!, k!), new Set([id]));
        }
        run(`eye ${id}`, () => toggleIncluded(c, y, id), () => {
          const x = c.getState().sections.find((q: Rec) => q.id === id)!;
          x.included = !x.included;
        }, new Set([id]));
        run(`up ${id}`, () => moveStep(c, y, id, 'up'), () => c.api.moveSection(id, 'up'), new Set());
        run(`down ${id}`, () => moveStep(c, y, id, 'down'), () => c.api.moveSection(id, 'down'), new Set());
      }
      // a drop on every other section of the first body section's tier and across it
      const a = before.find((s) => (s.kind ?? 'body') === 'body')!;
      for (const b of before.slice(0, 16)) {
        if (b === a) continue;
        for (const after of [false, true]) run(`drop ${a.id} on ${b.id} ${after}`, () => moveTo(c, y, a.id as string, b.id as string, after), () => c.api.moveSectionTo(a.id as string, b.id as string, after), new Set());
      }
      run('add chapter', () => addChapter(c, y, () => undefined), () => c.api.addChapter(), new Set());
      run('add part', () => addPart(c, y, () => undefined), () => c.api.addPart(), new Set());
    }
  }, 900_000);
});

describe("1.0's structure self-checks, re-expressed", () => {
  const empty = () => {
    const y = new Y.Doc();
    importBook(c.api.buildEmptyBook(), y);
    return y;
  };
  it('structure.matter-library: Foreword, Preface (front, in canonical order) and Call to Action (back); a singleton jumps to the standing page', () => {
    const y = empty();
    const fw = insertMatter(c, y, 'foreword', () => undefined), pf = insertMatter(c, y, 'preface', () => undefined), cta = insertMatter(c, y, 'cta', () => undefined);
    const s = secs(y);
    const at = (id: unknown) => s.findIndex((x) => x.id === id);
    expect(s[at(fw.selected)]).toMatchObject({ kind: 'front', type: 'foreword' });
    expect(s[at(pf.selected)]).toMatchObject({ kind: 'front', type: 'preface' });
    expect(s[at(cta.selected)]).toMatchObject({ kind: 'back', type: 'cta' });
    expect(at(pf.selected)).toBeGreaterThan(at(fw.selected));
    // an editable surface: a foreword is no generated page (1.0's AUTO_TYPES)
    expect(c.api.AUTO_TYPES).not.toContain('foreword');
    const tp = s.filter((x) => x.type === 'titlepage').length;
    const jumped = insertMatter(c, y, 'titlepage', () => undefined);
    expect(jumped.wrote).toBe(false);
    expect(secs(y).filter((x) => x.type === 'titlepage').length).toBe(tp);
    expect(jumped.selected).toBe(s.find((x) => x.type === 'titlepage')!.id);
  });

  it('structure.reorder: move controls and the drag-equivalent reorder within a tier, the order survives a re-import; a cross-tier drop or move is refused and nothing moves', () => {
    const book = c.api.buildEmptyBook();
    const mk = c.api.mkSection;
    const A = mk('body', 'chapter', 'Alpha', { number: '1', content: 'Alpha words here.' });
    const B = mk('body', 'chapter', 'Beta', { number: '2', content: 'Beta words here.' });
    const C = mk('body', 'chapter', 'Gamma', { number: '3', content: 'Gamma words here.' });
    book.sections = book.sections.filter((s) => s.kind === 'front').concat([A, B, C], book.sections.filter((s) => s.kind === 'back'));
    const y = new Y.Doc();
    importBook(book, y);
    const titles = (yy: Y.Doc) => secs(yy).filter((s) => s.type === 'chapter').map((s) => s.title).join(',');
    moveStep(c, y, C.id, 'up');
    moveStep(c, y, C.id, 'up');
    expect(titles(y)).toBe('Gamma,Alpha,Beta');
    expect(moveTo(c, y, B.id, C.id, false).value).toBe(true);
    expect(titles(y)).toBe('Beta,Gamma,Alpha');
    const y2 = new Y.Doc();
    importBook(exportBook(y), y2);
    expect(titles(y2)).toBe('Beta,Gamma,Alpha');
    const ids = JSON.stringify(secs(y).map((s) => s.id));
    const ack = secs(y).find((s) => s.type === 'acknowledgments')!;
    expect(moveTo(c, y, A.id, ack.id as string, false).value).toBe(false);
    const lastFront = secs(y).filter((s) => s.kind === 'front').pop()!;
    expect(moveStep(c, y, lastFront.id as string, 'down').value).toBe(false);
    expect(JSON.stringify(secs(y).map((s) => s.id))).toBe(ids);
    // every chapter's text came through the moves unchanged
    expect(secs(y).filter((s) => s.type === 'chapter').map((s) => s.content).sort()).toEqual(['Alpha words here.', 'Beta words here.', 'Gamma words here.']);
  });

  it('structure.parts: a Part groups the chapters after it; removing it leaves them in place, unharmed', () => {
    const book = c.api.buildEmptyBook();
    const mk = c.api.mkSection;
    const part = mk('body', 'part', 'The Crossing', { number: 'One', subtitle: 'Where the channel runs east', content: '' });
    const A = mk('body', 'chapter', 'Alpha', { number: '1', content: 'Alpha words here.' });
    const B = mk('body', 'chapter', 'Beta', { number: '2', content: 'Beta words here.' });
    const C = mk('body', 'chapter', 'Gamma', { number: '3', content: 'Gamma words here.' });
    book.sections = book.sections.filter((s) => s.kind === 'front').concat([C, part, A, B], book.sections.filter((s) => s.kind === 'back'));
    const y = new Y.Doc();
    importBook(book, y);
    const groups = c.api.partGroups(secs(y).filter((s) => s.kind === 'body'));
    expect(groups.length).toBe(2);
    expect(groups[0]!.part).toBeNull();
    expect(groups[1]!.part!.title).toBe('The Crossing');
    expect(groups[1]!.items.map((s) => s.title)).toEqual(['Alpha', 'Beta']);
    const bodyBefore = secs(y).filter((s) => s.kind === 'body' && s.type !== 'part');
    const r = chopDelete({ c, ydoc: y, t: t as never, activeId: null }, part.id);
    expect(r && typeof r === 'object').toBe(true);
    const bodyAfter = secs(y).filter((s) => s.kind === 'body');
    expect(bodyAfter.map((s) => s.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(bodyAfter.map((s) => s.content)).toEqual(bodyBefore.map((s) => s.content));
    // Add Part lands after the last body section; Add Chapter after the last chapter, stepping over trailing Parts
    const p2 = addPart(c, y, () => undefined);
    const s2 = secs(y);
    const pi = s2.findIndex((s) => s.id === p2.selected);
    expect(s2[pi]).toMatchObject({ kind: 'body', type: 'part' });
    expect(s2[pi + 1]?.kind).not.toBe('body');
    addChapter(c, y, () => undefined);
    const s3 = secs(y);
    const ni = s3.findIndex((s) => s.title === 'New Chapter');
    expect(s3[ni - 1]?.type).toBe('part');
    expect(s3[ni]!.number).toBe('4');
  });
});

describe('writeOrdered (a moved section)', () => {
  it('moves one section up or down with one section put in again, every text kept', () => {
    const book = c.api.buildEmptyBook();
    const mk = c.api.mkSection;
    const list = ['A', 'B', 'C', 'D', 'E'].map((n) => mk('body', 'chapter', n, { content: n + ' text.' }));
    book.sections = list;
    for (const [from, to] of [[0, 4], [4, 0], [1, 3], [3, 1], [2, 2]] as const) {
      const y = new Y.Doc();
      importBook(book, y);
      const prev = secs(y);
      const next = prev.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m!);
      const maps = y.getArray<Y.Map<unknown>>(SECTIONS).toArray();
      y.transact(() => writeOrdered(y, next, prev));
      expect(secs(y).map((s) => s.title)).toEqual(next.map((s) => s.title));
      expect(secs(y).map((s) => s.content)).toEqual(next.map((s) => s.content));
      const kept = y.getArray<Y.Map<unknown>>(SECTIONS).toArray().filter((x) => maps.includes(x)).length;
      expect(kept).toBe(from === to ? 5 : 4);
    }
  });
});
