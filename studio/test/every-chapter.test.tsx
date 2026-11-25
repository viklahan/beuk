import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { exportBook, importBook, keyOfId, removeSection, sectionAt, sectionList } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { applyToEvery, chaptersOf, countWords, ctxOf, planFor, ROWS, undoEvery, type RowId } from '../src/chapters/everych';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { EditorMeta } from '../src/editor/EditorMeta';
import { live } from '../src/history/history';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { DialogStackProvider, focusablesIn } from '../src/shell/Dialog';
import { ToastProvider } from '../src/shell/Toasts';

/* "Use on every chapter…" (2026-11-24; src/chapters/everych.ts, EveryChapter.tsx): one chapter's backdrop (the
   picture and its strength together), drop cap, small-caps lead-in or plate fit copied to every other chapter.

   What is held here:
   - the count each row shows, on a book with mixed settings, is the number of chapters the write then changes;
   - the write changes exactly the chapters that differ and exactly the keys that differ: every section is compared
     before and after, key by key, and its text byte for byte; Parts, front matter and back matter are untouched even
     where they store the same keys; the fit goes only where a plate is; a row not picked changes nothing;
   - it is ONE Y transaction (one update), with a History snapshot of the book as it stood in it;
   - Undo puts every key back exactly (a key the chapter did not store is removed again) and removes the snapshot; a
     chapter changed again since is left as it is, and then the snapshot stays;
   - the dialog: every row unticked and the action disabled when it opens, each checkbox described by its value and
     count, Cancel and Escape change nothing, focus returns to the button, the message says exact counts.
   Not held here (jsdom draws nothing): how a copied backdrop looks on a page. That is the e2e's (e2e/book.mjs,
   everyChapter). */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const im = (id: string, name: string) => ({ id, name, mediaType: 'image/png', ext: 'png', data: PNG });

/* Five chapters (one a prologue left out of the export), a Part, front and back matter. c1 is the chapter copied from.
   Against c1 (backdrop p1 at Soft, drop cap off, lead-in on, plate p3 shown whole):
     c2  the same backdrop, drop cap and lead-in; no plate
     c3  another backdrop at Strong, drop cap on, lead-in off, a plate with no fit stored (reads as "fill")
     c4  no backdrop, drop cap on, lead-in on, a plate id that is not in the library (no plate)
     c5  the same picture at Spread, drop cap off, lead-in off, a plate already shown whole
   The Part, the dedication and the acknowledgments store the same keys with other values, and must never move. */
const BOOK = (): Rec => ({
  meta: { title: 'Mixed Settings', author: 'A. Writer', language: 'en' },
  images: [im('p1', 'Harbour at dusk.png'), im('p2', 'Tide.png'), im('p3', 'Plate one.png')],
  sections: [
    { id: 'f1', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the ferrymen.', plateId: 'p3', plateAlt: 'A plate', plateFit: 'fill', backdropId: 'p2', backdropStrength: 'strong', dropCap: true, smallCaps: false },
    { id: 'c1', kind: 'body', type: 'chapter', number: '1', title: 'One', content: 'The *first* chapter.\n\nIts second paragraph — with a dash.', backdropId: 'p1', backdropStrength: 'soft', dropCap: false, smallCaps: true, plateId: 'p3', plateAlt: 'The plate', plateFit: 'whole' },
    { id: 'c2', kind: 'body', type: 'chapter', number: '2', title: 'Two', content: 'The second chapter.', backdropId: 'p1', backdropStrength: 'soft', dropCap: false, smallCaps: true },
    { id: 'pt', kind: 'body', type: 'part', number: 'II', title: 'The Harbour', content: '', backdropId: 'p2', backdropStrength: 'strong', dropCap: true, smallCaps: false, plateId: 'p3', plateAlt: 'On a Part', plateFit: 'fill' },
    { id: 'c3', kind: 'body', type: 'chapter', number: '3', title: 'Three', content: 'The third chapter.\n\n> A quoted line.\n\n***\n\nAfter the break.', backdropId: 'p2', backdropStrength: 'strong', dropCap: true, smallCaps: false, plateId: 'p3', plateAlt: 'Another plate' },
    { id: 'c4', kind: 'body', type: 'prologue', title: 'Prologue', content: 'Before it all.', included: false, backdropId: null, backdropStrength: 'whisper', dropCap: true, smallCaps: true, plateId: 'gone', plateAlt: 'No such picture', plateFit: 'fill' },
    { id: 'c5', kind: 'body', type: 'chapter', number: '4', title: 'Four', content: 'The fourth chapter.', backdropId: 'p1', backdropStrength: 'spread', dropCap: false, smallCaps: false, plateId: 'p2', plateAlt: 'A tide', plateFit: 'whole' },
    { id: 'b1', kind: 'back', type: 'acknowledgments', title: 'Acknowledgments', content: 'Thanks.', backdropId: 'p2', backdropStrength: 'soft', dropCap: true, smallCaps: false },
  ],
});
/** What each chapter must hold afterwards when every row is copied from c1; a section not named must not move. */
const ALL_FROM_C1: Record<string, Rec> = {
  c3: { backdropId: 'p1', backdropStrength: 'soft', dropCap: false, smallCaps: true, plateFit: 'whole' },
  c4: { backdropId: 'p1', backdropStrength: 'soft', dropCap: false },
  c5: { backdropStrength: 'soft', smallCaps: true },
};
const EVERY: RowId[] = ['backdrop', 'dropCap', 'smallCaps', 'plateFit'];

const onDoc = (book: Rec = BOOK()) => {
  const y = new Y.Doc();
  importBook(structuredClone(book), y);
  return y;
};
const secs = (y: Y.Doc) => exportBook(y).sections as Rec[];
const byId = (list: Rec[]) => Object.fromEntries(list.map((s) => [String(s.id), s]));
const noHistory = (b: Rec) => {
  const o = { ...b };
  delete o.history;
  delete o.historyPool;
  return o;
};
/** Every section of `after` against `before`: the keys named in `want` hold the wanted value, every other key and the
 *  text are exactly what they were, and no section came or went. */
function expectOnly(before: Rec[], after: Rec[], want: Record<string, Rec>) {
  expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
  for (let i = 0; i < before.length; i++) {
    const b = before[i]!, a = after[i]!, w = want[String(b.id)] ?? {};
    expect(a.content, `${String(b.id)} text`).toBe(b.content);
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (Object.hasOwn(w, k)) expect(a[k], `${String(b.id)}.${k}`).toEqual(w[k]);
      else {
        expect(Object.hasOwn(a, k), `${String(b.id)}.${k} is still ${Object.hasOwn(b, k) ? 'stored' : 'absent'}`).toBe(Object.hasOwn(b, k));
        expect(a[k], `${String(b.id)}.${k}`).toEqual(b[k]);
      }
    }
  }
}
const updates = (y: Y.Doc) => {
  const n = { count: 0 };
  y.on('update', () => {
    n.count++;
  });
  return n;
};

let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

describe('which sections are chapters', () => {
  it('every body section that is not a Part, a prologue and one left out of the export included; never front or back matter', () => {
    const y = onDoc();
    expect(chaptersOf(y).map((m) => m.get('id'))).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    // the same rule the chapter settings show their rows by: a section with no kind is body, with no type a chapter
    const bare = onDoc();
    const m = sectionAt(bare, 1) as Y.Map<unknown>;
    bare.transact(() => {
      m.delete('kind');
      m.delete('type');
    });
    expect(chaptersOf(bare).map((x) => x.get('id'))).toContain('c1');
  });

  it('a Part, front matter or back matter is not a chapter to copy from', () => {
    const y = onDoc();
    const before = exportBook(y);
    for (const id of ['pt', 'f1', 'b1', 'nowhere']) {
      expect(planFor(y, id, ctxOf(c, y)), id).toBeNull();
      expect(applyToEvery(c, y, id, EVERY), id).toBeNull();
    }
    expect(exportBook(y)).toEqual(before);
  });
});

describe('the counts the dialog shows', () => {
  it('from c1: each row counts exactly the other chapters that differ', () => {
    const y = onDoc();
    const before = exportBook(y);
    const n = updates(y);
    const plan = planFor(y, 'c1', ctxOf(c, y))!;
    expect(plan.others).toBe(4);
    expect(plan.rows.map((r) => [r.id, r.changes, r.reach])).toEqual([
      ['backdrop', 3, 4], // c3 (picture and strength), c4 (none), c5 (strength only); c2 is the same
      ['dropCap', 2, 4], // c3, c4
      ['smallCaps', 2, 4], // c3, c5
      ['plateFit', 1, 2], // of c3 and c5 (the two with a plate), c3; c4's plate id is not in the library
    ]);
    // of the chapters that get the picture (c3, c4), one has a plate facing its opening
    expect(plan.rows.map((r) => r.note)).toEqual([{ key: 'everych.platePair', n: 1 }, null, null, null]);
    expect(plan.rows[0]!.said).toEqual([{ text: 'Harbour at dusk.png' }, { key: 'editor.bdSoft' }]);
    expect(plan.rows[1]!.said).toEqual([{ key: 'everych.off' }]);
    expect(plan.rows[2]!.said).toEqual([{ key: 'everych.on' }]);
    expect(plan.rows[3]!.said).toEqual([{ key: 'editor.plateFitWhole' }]);
    // reading the plan writes nothing
    expect(n.count).toBe(0);
    expect(exportBook(y)).toEqual(before);
  });

  it('from a chapter with no plate the fit is not offered; from one with no backdrop the others would lose theirs', () => {
    const y = onDoc();
    expect(planFor(y, 'c2', ctxOf(c, y))!.rows.map((r) => r.id)).toEqual(['backdrop', 'dropCap', 'smallCaps']);
    const p4 = planFor(y, 'c4', ctxOf(c, y))!;
    expect(p4.rows.map((r) => r.id)).toEqual(['backdrop', 'dropCap', 'smallCaps']); // its plate id is not a picture of the book
    expect(p4.rows[0]).toMatchObject({ changes: 4, reach: 4, note: null, said: [{ key: 'editor.backdropNone' }] });
    expect(p4.rows[1]).toMatchObject({ changes: 3 }); // c1, c2, c5 have the drop cap off
  });

  it('each count is the number of chapters the write then changes', () => {
    for (const from of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      const plan = planFor(onDoc(), from, ctxOf(c, onDoc()))!;
      for (const r of plan.rows) {
        const y = onDoc();
        const before = byId(secs(y));
        applyToEvery(c, y, from, [r.id]);
        const after = byId(secs(y));
        const changed = Object.keys(before).filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]));
        expect(changed.length, `${from} ${r.id}`).toBe(r.changes);
      }
    }
  });
});

describe('the write', () => {
  it('every row from c1: exactly the differing keys of the differing chapters; every text byte for byte; one transaction', () => {
    const y = onDoc();
    const whole = exportBook(y);
    const before = structuredClone(whole.sections as Rec[]);
    const n = updates(y);
    const rec = applyToEvery(c, y, 'c1', EVERY)!;
    expect(n.count).toBe(1);
    expect(rec.counts).toEqual({ backdrop: 3, dropCap: 2, smallCaps: 2, plateFit: 1 });
    const after = exportBook(y);
    expectOnly(before, after.sections as Rec[], ALL_FROM_C1);
    // c3 stored no fit before: it is the one key that is new
    expect(Object.hasOwn(byId(before).c3!, 'plateFit')).toBe(false);
    // nothing of the book besides its sections and its History moved
    expect({ ...noHistory(after), sections: null }).toEqual({ ...noHistory(whole), sections: null });
  });

  it('the Part, the front matter and the back matter keep their own values, though they store the same keys', () => {
    const y = onDoc();
    const before = byId(secs(y));
    applyToEvery(c, y, 'c1', EVERY);
    const after = byId(secs(y));
    for (const id of ['pt', 'f1', 'b1', 'c1', 'c2']) expect(after[id], id).toEqual(before[id]);
    expect(after.pt).toMatchObject({ backdropId: 'p2', backdropStrength: 'strong', dropCap: true, smallCaps: false, plateFit: 'fill' });
  });

  it('the fit goes only where a plate is', () => {
    const y = onDoc();
    const before = secs(y);
    const rec = applyToEvery(c, y, 'c1', ['plateFit'])!;
    expect(rec.counts).toEqual({ plateFit: 1 });
    expectOnly(before, secs(y), { c3: { plateFit: 'whole' } });
    // c2 has no plate and c4's plate id is no picture of the book: neither is given a fit
    expect(Object.hasOwn(byId(secs(y)).c2!, 'plateFit')).toBe(false);
    expect(byId(secs(y)).c4!.plateFit).toBe('fill');
  });

  it('a row that is not picked changes nothing', () => {
    for (const [picked, want] of [
      [['backdrop'], { c3: { backdropId: 'p1', backdropStrength: 'soft' }, c4: { backdropId: 'p1', backdropStrength: 'soft' }, c5: { backdropStrength: 'soft' } }],
      [['dropCap'], { c3: { dropCap: false }, c4: { dropCap: false } }],
      [['smallCaps'], { c3: { smallCaps: true }, c5: { smallCaps: true } }],
      [['dropCap', 'plateFit'], { c3: { dropCap: false, plateFit: 'whole' }, c4: { dropCap: false } }],
    ] as [RowId[], Record<string, Rec>][]) {
      const y = onDoc();
      const before = secs(y);
      applyToEvery(c, y, 'c1', picked);
      expectOnly(before, secs(y), want);
    }
  });

  it('no backdrop on the first chapter: the others lose their picture and keep the strength they stored', () => {
    const y = onDoc();
    const before = secs(y);
    const rec = applyToEvery(c, y, 'c4', ['backdrop'])!;
    expect(rec.counts).toEqual({ backdrop: 4 });
    expectOnly(before, secs(y), { c1: { backdropId: null }, c2: { backdropId: null }, c3: { backdropId: null }, c5: { backdropId: null } });
    expect(byId(secs(y)).c5!.backdropStrength).toBe('spread');
  });

  it('a Spread backdrop is copied as any other strength, to a chapter with a plate and to one without', () => {
    const y = onDoc();
    const before = secs(y);
    applyToEvery(c, y, 'c5', ['backdrop']);
    const want = { backdropId: 'p1', backdropStrength: 'spread' };
    expectOnly(before, secs(y), { c1: { backdropStrength: 'spread' }, c2: { backdropStrength: 'spread' }, c3: want, c4: want });
    // every value written is one 1.0 keeps (normalizeSection): a strength of its list, a picture of the library
    for (const s of secs(y).filter((x) => x.kind === 'body' && x.type !== 'part')) {
      expect(c.api.BACKDROP_STRENGTHS).toContain(s.backdropStrength);
      expect(['p1', 'p2', 'p3']).toContain(s.backdropId);
    }
  });

  it('a picture id that is not in the library is no picture: it is never copied', () => {
    const book = BOOK();
    (book.sections as Rec[])[1]!.backdropId = 'gone';
    const y = onDoc(book);
    const plan = planFor(y, 'c1', ctxOf(c, y))!;
    expect(plan.rows[0]!.said).toEqual([{ key: 'editor.backdropNone' }]);
    const before = secs(y);
    applyToEvery(c, y, 'c1', ['backdrop']);
    // the others lose their backdrop (c4 had none); the id that names nothing stays where it was, on c1 only
    expectOnly(before, secs(y), { c2: { backdropId: null }, c3: { backdropId: null }, c5: { backdropId: null } });
    expect(secs(y).filter((s) => s.backdropId === 'gone').map((s) => s.id)).toEqual(['c1']);
  });

  it('when nothing differs nothing is written: no transaction, no snapshot', () => {
    const y = onDoc({ meta: { title: 'Same', language: 'en' }, images: [], sections: [
      { id: 'a', kind: 'body', type: 'chapter', title: 'A', content: 'One.' },
      { id: 'b', kind: 'body', type: 'chapter', title: 'B', content: 'Two.' },
    ] });
    const before = exportBook(y);
    const n = updates(y);
    const rec = applyToEvery(c, y, 'a', ['backdrop', 'dropCap', 'smallCaps'])!;
    expect(rec).toMatchObject({ changes: [], snapId: null, counts: { backdrop: 0, dropCap: 0, smallCaps: 0 } });
    expect(n.count).toBe(0);
    expect(exportBook(y)).toEqual(before);
    expect(undoEvery(c, rec)).toBeNull();
  });

  it('if History cannot be packed the write fails whole: no chapter is changed, no snapshot is left', () => {
    const y = onDoc();
    const before = exportBook(y);
    const n = updates(y);
    const pack = vi.spyOn(c.api, 'histPack').mockImplementation(() => {
      throw new Error('no room');
    });
    expect(() => applyToEvery(c, y, 'c1', EVERY)).toThrow('no room');
    pack.mockRestore();
    expect(n.count).toBe(0);
    expect(exportBook(y)).toEqual(before);
  });

  it('a snapshot of the book as it stood is in History, named "Before a chapter change", in the same transaction', () => {
    const y = onDoc();
    const before = secs(y);
    const rec = applyToEvery(c, y, 'c1', EVERY)!;
    const hist = live(c, y).state.history;
    expect(hist.length).toBe(1);
    expect(hist[0]).toMatchObject({ id: rec.snapId, auto: 'chapterop', name: '' });
    expect(hist[0]!.chop).toBeUndefined();
    expect(t('history.auto.' + hist[0]!.auto)).toBe('Before a chapter change');
    const snapped = byId(hist[0]!.doc.sections as unknown as Rec[]);
    for (const b of before) {
      for (const k of ['backdropId', 'backdropStrength', 'dropCap', 'smallCaps', 'plateFit', 'content']) expect(snapped[String(b.id)]![k], `${String(b.id)}.${k}`).toEqual(b[k]);
    }
  });
});

describe('Undo', () => {
  it('puts every key back exactly, removes the key a chapter did not store, and removes the spent snapshot: one transaction', () => {
    const y = onDoc();
    const before = exportBook(y);
    const rec = applyToEvery(c, y, 'c1', EVERY)!;
    expect(secs(y)).not.toEqual(before.sections);
    const n = updates(y);
    expect(undoEvery(c, rec)).toEqual({ restored: 3, skipped: 0 });
    expect(n.count).toBe(1);
    const after = exportBook(y);
    expect(noHistory(after)).toEqual(noHistory(before));
    expect(Object.hasOwn(byId(after.sections as Rec[]).c3!, 'plateFit')).toBe(false);
    expect(live(c, y).state.history).toEqual([]);
    // once only
    expect(undoEvery(c, rec)).toBeNull();
    expect(noHistory(exportBook(y))).toEqual(noHistory(before));
  });

  it('a chapter changed again since is left as it is, whole; the others go back; the snapshot stays', () => {
    const y = onDoc();
    const before = secs(y);
    const rec = applyToEvery(c, y, 'c1', EVERY)!;
    const c5 = sectionList(y).find((m) => m instanceof Y.Map && m.get('id') === 'c5') as Y.Map<unknown>;
    c5.set('backdropStrength', 'strong'); // the writer's own later choice
    expect(undoEvery(c, rec)).toEqual({ restored: 2, skipped: 1 });
    expectOnly(before, secs(y), { c5: { backdropStrength: 'strong', smallCaps: true } });
    expect(live(c, y).state.history.map((h) => h.id)).toEqual([rec.snapId]);
  });

  it('a chapter deleted since is counted as left; a book that is gone undoes nothing', () => {
    const y = onDoc();
    const rec = applyToEvery(c, y, 'c1', ['dropCap'])!;
    removeSection(y, keyOfId(y, 'c4')!);
    expect(undoEvery(c, rec)).toEqual({ restored: 1, skipped: 1 });
    expect(byId(secs(y)).c3!.dropCap).toBe(true);
    expect(secs(y).map((s) => s.id)).not.toContain('c4');
    const y2 = onDoc();
    const rec2 = applyToEvery(c, y2, 'c1', ['dropCap'])!;
    y2.destroy();
    expect(undoEvery(c, rec2)).toBeNull();
  });
});

/* Poem Mode (src/editor/poem.ts): a chapter whose `mode` is "verse" takes no drop cap and no lead-in, its settings do
   not show those two switches, and what they store is left as it is. So those two rows are not offered from a poem
   and never reach one; the backdrop and the plate fit, which a poem does show, go to a poem as to any chapter. */
const POEMS = (...ids: string[]): Rec => {
  const book = BOOK();
  for (const s of book.sections as Rec[]) if (ids.includes(String(s.id))) s.mode = 'verse';
  return book;
};
const rowOf = (id: RowId) => ROWS.find((r) => r.id === id)!;

describe('poems', () => {
  it('the drop cap and the lead-in never reach a poem: it is not counted, and its stored switches stay as they are', () => {
    const y = onDoc(POEMS('c3'));
    const plan = planFor(y, 'c1', ctxOf(c, y))!;
    expect(plan.others).toBe(4);
    expect(plan.rows.map((r) => [r.id, r.changes, r.reach, r.left])).toEqual([
      ['backdrop', 3, 4, 0], // a poem shows a backdrop: c3 is reached and changes
      ['dropCap', 1, 3, 1], // c4; c3 would have changed, and is a poem
      ['smallCaps', 1, 3, 1], // c5; c3 would have changed, and is a poem
      ['plateFit', 1, 2, 2], // a poem shows its plate: c3 is the one that changes
    ]);
    const before = secs(y);
    applyToEvery(c, y, 'c1', EVERY);
    expectOnly(before, secs(y), {
      c3: { backdropId: 'p1', backdropStrength: 'soft', plateFit: 'whole' }, // dropCap true and smallCaps false, as stored
      c4: { backdropId: 'p1', backdropStrength: 'soft', dropCap: false },
      c5: { backdropStrength: 'soft', smallCaps: true },
    });
    expect(byId(secs(y)).c3).toMatchObject({ mode: 'verse', dropCap: true, smallCaps: false });
  });

  it('from a poem the drop cap and the lead-in are not offered, and asking for them all the same writes nothing', () => {
    const y = onDoc(POEMS('c3'));
    expect(planFor(y, 'c3', ctxOf(c, y))!.rows.map((r) => r.id)).toEqual(['backdrop', 'plateFit']);
    const before = exportBook(y);
    const n = updates(y);
    const rec = applyToEvery(c, y, 'c3', ['dropCap', 'smallCaps'])!;
    expect(rec.changes).toEqual([]);
    expect(rec.snapId).toBeNull();
    expect(n.count).toBe(0);
    expect(exportBook(y)).toEqual(before);
  });

  it('each count is still the number of chapters the write then changes', () => {
    for (const from of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      const plan = planFor(onDoc(POEMS('c3', 'c4')), from, ctxOf(c, onDoc(POEMS('c3', 'c4'))))!;
      for (const r of plan.rows) {
        const y = onDoc(POEMS('c3', 'c4'));
        const before = byId(secs(y));
        applyToEvery(c, y, from, [r.id]);
        const after = byId(secs(y));
        const changed = Object.keys(before).filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]));
        expect(changed.length, `${from} ${r.id}`).toBe(r.changes);
        expect(r.reach + r.left, `${from} ${r.id}`).toBe(plan.others);
      }
    }
  });

  it('the count line names poems only when a poem is left out', () => {
    const line = (book: Rec, row: RowId) => {
      const y = onDoc(book);
      return countWords(rowOf(row), planFor(y, 'c1', ctxOf(c, y))!.rows.find((r) => r.id === row)!);
    };
    // no poem in the book: the words every row has always had
    expect(line(BOOK(), 'dropCap')).toEqual({ key: 'everych.count', n: 2, total: 4 });
    // one poem among the others
    expect(line(POEMS('c3'), 'dropCap')).toEqual({ key: 'everych.proseCount', n: 1, total: 3 });
    const same = POEMS('c3');
    for (const s of same.sections as Rec[]) if (s.id === 'c4') s.dropCap = false;
    expect(line(same, 'dropCap')).toEqual({ key: 'everych.proseSame' });
    // every other chapter a poem
    expect(line(POEMS('c2', 'c3', 'c4', 'c5'), 'dropCap')).toEqual({ key: 'everych.proseNone' });
    expect(line(POEMS('c2', 'c3', 'c4', 'c5'), 'smallCaps')).toEqual({ key: 'everych.proseNone' });
    // the backdrop reaches poems, so its words never change
    expect(line(POEMS('c3'), 'backdrop')).toEqual({ key: 'everych.count', n: 3, total: 4 });
    expect(E['everych.proseCount']).toBe('Other chapters that would change: {n} of {total}. Poems are left as they are.');
    expect(E['everych.proseSame']).toBe('Every other chapter that is not a poem already has this.');
    expect(E['everych.proseNone']).toBe('Every other chapter is a poem, and poems are left as they are.');
  });
});

/* ---- the button and its dialog ---- */

const $ = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const indexOfId = (y: Y.Doc, id: string) => sectionList(y).findIndex((m) => m instanceof Y.Map && m.get('id') === id);
async function mount(y: Y.Doc, id: string, lang = 'en') {
  const section = sectionAt(y, indexOfId(y, id)) as Y.Map<unknown>;
  const r = render(
    <LocaleProvider initial={lang}>
      <ToastProvider>
        <DialogStackProvider>
          <EditorMeta ydoc={y} section={section} />
        </DialogStackProvider>
      </ToastProvider>
    </LocaleProvider>,
  );
  if (section.get('kind') === 'body' && section.get('type') !== 'part') await waitFor(() => expect($('btnEveryChapter')).not.toBeNull(), { timeout: 20_000 });
  return r;
}
const press = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).focus();
    fireEvent.click(el!);
  });
const openDialog = async () => {
  await press($('btnEveryChapter'));
  expect($('modalEveryChapter')).not.toBeNull();
};
const box = (row: RowId) => $('everyCh-' + row)!;
const desc = (row: RowId) => document.getElementById(box(row).getAttribute('aria-describedby')!)!.textContent ?? '';
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((x) => x.querySelector('span')?.textContent ?? '');

describe('the button', () => {
  it('stands at the end of a chapter\'s settings, after the art rows; a Part and front matter have none', async () => {
    const y = onDoc();
    await mount(y, 'c1');
    await waitFor(() => expect($('chBackdrop')).not.toBeNull(), { timeout: 20_000 });
    const btn = $('btnEveryChapter')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe(E['everych.open']);
    expect(btn.textContent).toBe('Use on every chapter…');
    expect(btn.closest('#bodyArtRows')).not.toBeNull();
    for (const before of ['tglDropCap', 'tglSmallCaps', 'chPlate', 'chBackdrop', 'chBackdropStrength']) {
      expect($(before)!.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING, before).toBeTruthy();
    }
    cleanup();
    for (const id of ['pt', 'f1', 'b1']) {
      await mount(y, id);
      expect($('btnEveryChapter'), id).toBeNull();
      cleanup();
    }
  });
});

describe('the dialog', () => {
  it('opens with every row unticked and the action disabled; each checkbox is named, and described by its value and exact count', async () => {
    const y = onDoc();
    await mount(y, 'c1');
    await openDialog();
    const dlg = document.querySelector('#modalEveryChapter [role="dialog"]')!;
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)!.textContent).toBe("Use this chapter's settings on every chapter");
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)!.textContent).toBe(E['everych.scope']);
    expect(E['everych.scope']).toMatch(/except Part dividers/);
    expect(E['everych.scope']).toMatch(/not included in the export are changed too/);
    expect(E['everych.scope']).toMatch(/Front and back matter are not changed/);
    const rows = [...document.querySelectorAll('#modalEveryChapter .everych-row')].map((li) => li.getAttribute('data-row'));
    expect(rows).toEqual(EVERY);
    expect(EVERY.map((r) => document.querySelector(`label[for="everyCh-${r}"]`)!.textContent)).toEqual(['Chapter backdrop', 'Drop cap', 'Small-caps lead-in', 'Plate fit']);
    for (const r of EVERY) {
      expect(box(r).type).toBe('checkbox');
      expect(box(r).checked, r).toBe(false);
      expect(box(r).disabled, r).toBe(false);
      expect(document.querySelector(`label[for="everyCh-${r}"]`)!.textContent, r).toBe(t(ROWS.find((x) => x.id === r)!.label));
    }
    expect(desc('backdrop')).toContain('This chapter: Harbour at dusk.png · Soft');
    expect(desc('backdrop')).toContain('Other chapters that would change: 3 of 4');
    expect(desc('backdrop')).toContain('Chapters with an opening plate that would get this backdrop: 1.');
    expect(desc('dropCap')).toBe('This chapter: Off' + 'Other chapters that would change: 2 of 4');
    expect(desc('smallCaps')).toBe('This chapter: On' + 'Other chapters that would change: 2 of 4');
    expect(desc('plateFit')).toBe('This chapter: Show the whole picture' + 'Other chapters with a plate that would change: 1 of 2');
    expect($('btnEveryChApply')!.disabled).toBe(true);
    expect($('btnEveryChApply')!.textContent).toBe('Use on every chapter');
    // what it says about getting the old settings back is what exists: the Undo in the message, and the snapshot
    const warn = $('everyChReplace')!.textContent!;
    expect(warn).toContain('A chapter that changes loses the setting it has now.');
    expect(warn).toContain('no text is changed');
    expect(warn).toContain('Undo is offered in the message that follows');
    expect(warn).toContain('named “Before a chapter change”');
    // keyboard: focus is in the dialog on its first checkbox; the stops are the four checkboxes and Cancel (the
    // disabled action is not one until a row is ticked)
    expect(document.activeElement).toBe(box('backdrop'));
    expect(focusablesIn(dlg as HTMLElement).map((el) => el.id)).toEqual(['everyCh-backdrop', 'everyCh-dropCap', 'everyCh-smallCaps', 'everyCh-plateFit', 'btnEveryChCancel']);
    await act(async () => void fireEvent.click(box('dropCap')));
    expect($('btnEveryChApply')!.disabled).toBe(false);
    expect(focusablesIn(dlg as HTMLElement).map((el) => el.id).at(-1)).toBe('btnEveryChApply');
    await act(async () => void fireEvent.click(box('dropCap')));
    expect($('btnEveryChApply')!.disabled).toBe(true);
  });

  it('Escape, Cancel and a click outside change nothing, and focus returns to the button; it opens unticked again', async () => {
    const y = onDoc();
    const before = exportBook(y);
    const n = updates(y);
    await mount(y, 'c1');
    const closers: (() => void)[] = [
      () => void fireEvent.keyDown(document, { key: 'Escape' }),
      () => void fireEvent.click($('btnEveryChCancel')!),
      () => void fireEvent.click($('modalEveryChapter')!),
    ];
    for (const close of closers) {
      await openDialog();
      for (const r of EVERY) expect(box(r).checked, r).toBe(false);
      await act(async () => void fireEvent.click(box('backdrop')));
      await act(async () => void fireEvent.click(box('plateFit')));
      expect(box('backdrop').checked && box('plateFit').checked).toBe(true);
      await act(async () => close());
      expect($('modalEveryChapter')).toBeNull();
      expect(document.activeElement).toBe($('btnEveryChapter'));
    }
    expect(n.count).toBe(0);
    expect(exportBook(y)).toEqual(before);
    expect(toasts()).toEqual([]);
  });

  it('ticked rows are copied; the message says how many chapters each changed; Undo in it puts them back', async () => {
    const y = onDoc();
    const before = exportBook(y);
    await mount(y, 'c1');
    await openDialog();
    await act(async () => void fireEvent.click(box('backdrop')));
    await act(async () => void fireEvent.click(box('dropCap')));
    const n = updates(y);
    await press($('btnEveryChApply'));
    expect(n.count).toBe(1);
    expect($('modalEveryChapter')).toBeNull();
    expect(document.activeElement).toBe($('btnEveryChapter'));
    expectOnly(before.sections as Rec[], secs(y), {
      c3: { backdropId: 'p1', backdropStrength: 'soft', dropCap: false },
      c4: { backdropId: 'p1', backdropStrength: 'soft', dropCap: false },
      c5: { backdropStrength: 'soft' },
    });
    expect(toasts()).toEqual(['Other chapters changed. Chapter backdrop: 3 · Drop cap: 2']);
    const undo = document.querySelector('#toasts .toast .toast-action') as HTMLButtonElement;
    expect(undo.textContent).toBe('Undo');
    await act(async () => void fireEvent.click(undo));
    expect(noHistory(exportBook(y))).toEqual(noHistory(before));
    expect(live(c, y).state.history).toEqual([]);
    expect(toasts()).toEqual(['Undone']);
  });

  it('Undo after a chapter was changed again says how many were left, and names the snapshot', async () => {
    const y = onDoc();
    await mount(y, 'c1');
    await openDialog();
    await act(async () => void fireEvent.click(box('smallCaps')));
    await press($('btnEveryChApply'));
    expect(toasts()).toEqual(['Other chapters changed. Small-caps lead-in: 2']);
    const c5 = sectionList(y).find((m) => m instanceof Y.Map && m.get('id') === 'c5') as Y.Map<unknown>;
    act(() => void c5.set('smallCaps', false));
    await act(async () => void fireEvent.click(document.querySelector('#toasts .toast .toast-action')!));
    expect(toasts()).toEqual(['Undone, except chapters changed again since: 1. They are left as they are, and the snapshot “Before a chapter change” in History still holds the earlier settings.']);
    expect(byId(secs(y)).c3!.smallCaps).toBe(false);
  });

  it('a write that fails says so, with the error, and changes nothing', async () => {
    const y = onDoc();
    const before = exportBook(y);
    await mount(y, 'c1');
    await openDialog();
    await act(async () => void fireEvent.click(box('backdrop')));
    const pack = vi.spyOn(c.api, 'histPack').mockImplementation(() => {
      throw new Error('no room');
    });
    await press($('btnEveryChApply'));
    pack.mockRestore();
    expect($('modalEveryChapter')).toBeNull();
    expect(toasts()).toEqual(['The settings could not be copied. Nothing was changed. The error was: no room']);
    expect(document.querySelector('#toasts .toast .toast-action')).toBeNull();
    expect(exportBook(y)).toEqual(before);
  });

  it('a row that would change nothing says so; using it changes nothing and says that', async () => {
    const book = BOOK();
    for (const s of book.sections as Rec[]) s.smallCaps = true;
    const y = onDoc(book);
    const before = exportBook(y);
    const n = updates(y);
    await mount(y, 'c1');
    await openDialog();
    expect(desc('smallCaps')).toBe('This chapter: On' + 'Every other chapter already has this.');
    await act(async () => void fireEvent.click(box('smallCaps')));
    await press($('btnEveryChApply'));
    expect(n.count).toBe(0);
    expect(exportBook(y)).toEqual(before);
    expect(toasts()).toEqual(['Every other chapter already had these settings. Nothing was changed.']);
    expect(document.querySelector('#toasts .toast .toast-action')).toBeNull();
  });

  it('the fit row: absent without a plate here; "no other chapter has a plate" when none does', async () => {
    const y = onDoc();
    await mount(y, 'c2');
    await openDialog();
    expect($('everyCh-plateFit')).toBeNull();
    expect([...document.querySelectorAll('#modalEveryChapter .everych-row')].length).toBe(3);
    cleanup();
    const book = BOOK();
    for (const s of book.sections as Rec[]) if (s.id !== 'c1') s.plateId = null;
    const y2 = onDoc(book);
    await mount(y2, 'c1');
    await openDialog();
    expect(desc('plateFit')).toBe('This chapter: Show the whole picture' + 'No other chapter has a plate.');
  });

  it('a book with one chapter: no rows, the words say so, nothing to use', async () => {
    const y = onDoc({ meta: { title: 'One', language: 'en' }, images: [], sections: [
      { id: 'only', kind: 'body', type: 'chapter', title: 'Only', content: 'Alone.' },
      { id: 'pt', kind: 'body', type: 'part', title: 'A Part', content: '' },
      { id: 'fm', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For no one.' },
    ] });
    await mount(y, 'only');
    await openDialog();
    expect(document.querySelectorAll('#modalEveryChapter .everych-row').length).toBe(0);
    expect(document.querySelector('#modalEveryChapter .everych-alone')!.textContent).toBe('This book has no other chapter.');
    expect($('btnEveryChApply')!.disabled).toBe(true);
    expect(document.activeElement).toBe($('btnEveryChCancel'));
  });

  it('the counts follow the book while the dialog is open', async () => {
    const y = onDoc();
    await mount(y, 'c1');
    await openDialog();
    expect(desc('dropCap')).toContain('2 of 4');
    const c3 = sectionList(y).find((m) => m instanceof Y.Map && m.get('id') === 'c3') as Y.Map<unknown>;
    act(() => void c3.set('dropCap', false));
    expect(desc('dropCap')).toContain('1 of 4');
  });

  it('a book with a poem: the drop cap row says poems are left; in the poem\'s own settings the two rows are absent', async () => {
    const y = onDoc(POEMS('c3'));
    await mount(y, 'c1');
    await openDialog();
    expect(desc('dropCap')).toBe('This chapter: Off' + 'Other chapters that would change: 1 of 3. Poems are left as they are.');
    expect(desc('smallCaps')).toBe('This chapter: On' + 'Other chapters that would change: 1 of 3. Poems are left as they are.');
    expect(desc('backdrop')).toContain('Other chapters that would change: 3 of 4');
    cleanup();
    await mount(y, 'c3');
    // the poem's settings show neither switch (Poem Mode), and the dialog offers neither row
    expect($('tglDropCap')).toBeNull();
    expect($('tglSmallCaps')).toBeNull();
    await openDialog();
    expect([...document.querySelectorAll('#modalEveryChapter .everych-row')].map((li) => li.getAttribute('data-row'))).toEqual(['backdrop', 'plateFit']);
  });
});

describe('its words in every language', () => {
  const dir = path.resolve(__dirname, '../src/generated/packs');
  const packs = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Record<string, string>]));
  const keys = Object.keys(E).filter((k) => k.startsWith('everych.'));
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');

  it('26 keys in each of the 13 packs, each with English\'s placeholders, none empty, no exclamation mark', () => {
    expect(keys.length).toBe(26);
    expect(Object.keys(packs).length).toBe(13);
    for (const [lang, pack] of Object.entries(packs)) {
      for (const k of keys) {
        expect(typeof pack[k] === 'string' && pack[k]!.trim().length > 0, `${lang} ${k}`).toBe(true);
        expect(holes(pack[k]!), `${lang} ${k}`).toBe(holes(E[k]!));
        expect(/[!！]/.test(pack[k]!), `${lang} ${k}`).toBe(false);
        // a draft is a translation, not the English left in place ("{setting}: {n}" is the one string that is only its marks)
        if (lang !== 'en' && k !== 'everych.doneItem') expect(pack[k], `${lang} ${k} is still the English`).not.toBe(E[k]);
      }
    }
  });

  it('docs/strings-pending-signoff.md lists every key as a draft, and approves none', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../docs/strings-pending-signoff.md'), 'utf8');
    expect(doc.toLowerCase()).toContain('not approved');
    for (const k of keys) expect(doc, k).toContain('### `' + k + '`');
    // each key's twelve drafts stand there as the packs hold them
    for (const [lang, pack] of Object.entries(packs)) {
      if (lang === 'en') continue;
      for (const k of keys) expect(doc, `${lang} ${k}`).toContain('`' + pack[k] + '`');
    }
  });

  it('every count stands after a colon or in "n of total", so no key needs a plural form', () => {
    expect(keys.filter((k) => k.endsWith('Plural'))).toEqual([]);
    for (const k of ['everych.count', 'everych.plateCount', 'everych.proseCount', 'everych.platePair', 'everych.undonePart', 'everych.doneItem']) expect(E[k], k).toMatch(/: \{n\}/);
  });

  it('the dialog in Arabic: every row and the action carry that pack\'s words', async () => {
    const y = onDoc();
    await loadPack('ar');
    await mount(y, 'c1', 'ar');
    await waitFor(() => expect($('btnEveryChapter')!.textContent).toBe(packs.ar!['everych.open']), { timeout: 20_000 });
    await openDialog();
    expect($('everyChH')!.textContent).toBe(packs.ar!['everych.title']);
    expect($('btnEveryChApply')!.textContent).toBe(packs.ar!['everych.apply']);
    expect(desc('dropCap')).toContain(packs.ar!['everych.count']!.replace('{n}', '2').replace('{total}', '4'));
  });
});
