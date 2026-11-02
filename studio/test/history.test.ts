import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook, META, sectionPlain, insertSectionsAt, removeSection, sectionKeys, sectionByKey, sectionsCount } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { setMeta } from '../src/book/hooks';
import { importToDevice, type OpenBook } from '../src/book/store';
import { loadClosure, setClosureT, type Closure } from '../src/closure/index';
import { histDeltaText } from '../src/history/HistoryDialog';
import { autoSnapshot, backupArrival, deleteSnapshot, live, liveDoc, repackHistory, restoreDoc, restoreSection, saveNamed, takeSnapshot, writeHistory } from '../src/history/history';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { loadPack } from '../src/i18n/strings';
import { DUMAS, fixtures } from './fixtures';

/* Task 3: History. Re-expresses 1.0's history self-checks on the Y.Doc
   (each book built, as 1.0's checks build theirs, with 1.0's own
   buildEmptyBook and mkSection through the closure), plus review focus #1
   (a replace you can undo, through the store) and #2 at the model level
   (History is stored in 1.0's saved form; the e2e checks it against 1.0
   itself). */

type Rec = Record<string, unknown>;
let c: Closure;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});
const opened: OpenBook[] = [];
afterEach(async () => {
  for (const b of opened.splice(0)) await b.close();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const words = (n: number, w = 'word') => Array(n).fill(w).join(' ');
/** 1.0's buildEmptyBook, its body sections replaced by `body` (front and back matter kept), as a Y.Doc. */
function desk(body?: Rec[], patch?: (b: Rec) => void): Y.Doc {
  const b = c.api.buildEmptyBook() as Rec & { sections: Rec[] };
  if (body) b.sections = b.sections.filter((s) => s.kind === 'front').concat(body, b.sections.filter((s) => s.kind === 'back'));
  patch?.(b);
  const ydoc = new Y.Doc();
  importBook(b, ydoc);
  return ydoc;
}
const ch = (title: string, n: string, content: string, extra?: Rec) => c.api.mkSection('body', 'chapter', title, { number: n, content, ...extra });
const sections = (ydoc: Y.Doc) => exportBook(ydoc).sections as Rec[];
const sec = (ydoc: Y.Doc, id: string) => sections(ydoc).find((s) => s.id === id);
/** Change one section (as typing would: the section, nothing else), one transaction. */
function edit(ydoc: Y.Doc, id: string, patch: Rec): void {
  const i = sections(ydoc).findIndex((s) => s.id === id);
  const k = sectionKeys(ydoc)[i]!;
  const s = { ...(sectionPlain(sectionByKey(ydoc, k)) as Rec), ...patch };
  ydoc.transact(() => {
    removeSection(ydoc, k);
    insertSectionsAt(ydoc, i, [s]);
  });
}
function dropSection(ydoc: Y.Doc, id: string): void {
  const i = sections(ydoc).findIndex((s) => s.id === id);
  removeSection(ydoc, sectionKeys(ydoc)[i]!);
}
/** The new generation a whole restore (or a backup) opens: the document, through importBook. */
function reopen(doc: Rec): Y.Doc {
  const y = new Y.Doc();
  importBook(doc, y);
  return y;
}
const total = (ydoc: Y.Doc) => {
  const L = live(c, ydoc);
  void L;
  return c.api.bookWordTotal();
};
const history = (ydoc: Y.Doc) => live(c, ydoc).state.history;

describe("1.0's history self-checks, on the Y.Doc", () => {
  it('history.snapshots: a named snapshot saves the book; browsing writes nothing; a restore returns the exact text and count, behind a Before-restore snapshot that undoes it', () => {
    const one = ch('First Light', '1', 'alpha bravo charlie delta echo');
    let y = desk([one]);
    const wordsBefore = total(y);
    const snap = saveNamed(c, y, 'Turning point');
    expect(snap.name).toBe('Turning point');
    expect(snap.auto).toBeNull();
    expect(snap.words).toBe(wordsBefore);
    const h = history(y);
    expect(h.length).toBe(1);
    expect(h[0]!.doc.sections.some((s) => s.id === one.id && s.content === 'alpha bravo charlie delta echo')).toBe(true);
    expect('history' in h[0]!.doc).toBe(false);
    // the stored form is 1.0's saved form: packed (chopDoc), with the pool beside it
    const stored = exportBook(y);
    expect((stored.history as Rec[]).every((e) => e.chopDoc && !e.doc)).toBe(true);
    expect(stored.historyPool).toEqual({ images: [], fonts: [], covers: [] });
    // browsing (live + diffs + counts) writes nothing
    let updates = 0;
    y.on('update', () => updates++);
    const L = live(c, y);
    c.api.histSectionDiff(L.state.history[0]!.doc, liveDoc(L));
    c.api.snapshotSectionWords(L.state.history[0]!.doc, L.state.history[0]!.doc.sections[0]);
    expect(updates).toBe(0);
    // edit, then restore the whole book
    edit(y, one.id, { content: 'completely different words now written here' });
    const editedWords = total(y);
    const doc = restoreDoc(c, y, snap.id)!;
    y = reopen(doc);
    expect(sec(y, one.id)!.content).toBe('alpha bravo charlie delta echo');
    expect(total(y)).toBe(wordsBefore);
    const before = history(y).find((s) => s.auto === 'restore')!;
    expect(before.words).toBe(editedWords);
    expect(before.doc.sections.some((s) => s.id === one.id && s.content === 'completely different words now written here')).toBe(true);
    y = reopen(restoreDoc(c, y, before.id)!);
    expect(sec(y, one.id)!.content).toBe('completely different words now written here');
    expect(total(y)).toBe(editedWords);
  });

  it('history.section-restore: one chapter returns while the others keep their newer edits; a lost section returns at its place and tier', () => {
    const A = ch('Alpha', '1', 'alpha original text stands'), B = ch('Beta', '2', 'beta original text stands'), C = ch('Gamma', '3', 'gamma original text stands');
    const y = desk([A, B, C]);
    const snap = saveNamed(c, y, 'Three chapters');
    edit(y, A.id, { content: 'alpha rewritten much later on' });
    edit(y, B.id, { content: 'beta rewritten much later on' });
    expect(restoreSection(c, y, snap.id, A.id)).not.toBeNull();
    expect(sec(y, A.id)!.content).toBe('alpha original text stands');
    expect(sec(y, B.id)!.content).toBe('beta rewritten much later on');
    dropSection(y, C.id);
    expect(restoreSection(c, y, snap.id, C.id)).not.toBeNull();
    const order = sections(y).map((s) => s.id);
    const cPos = order.indexOf(C.id), bPos = order.indexOf(B.id), backPos = sections(y).findIndex((s) => s.kind === 'back');
    expect(cPos).toBeGreaterThan(bPos);
    if (backPos !== -1) expect(cPos).toBeLessThan(backPos);
    expect(sec(y, C.id)!.kind).toBe('body');
    expect(sec(y, C.id)!.content).toBe('gamma original text stands');
    expect(history(y).filter((s) => s.auto === 'restore').length).toBe(2);
  });

  it('history.autosafety (pruning): more than ten automatic snapshots drop the oldest first; a named one survives (the import and sample halves: waves 6 and 1b)', () => {
    const y = desk([ch('Prune Chapter', '1', 'words enough to need a net beneath')]);
    const named = saveNamed(c, y, 'Keep me forever');
    const L = live(c, y);
    const autoIds: string[] = [];
    for (let i = 0; i < 11; i++) autoIds.push(takeSnapshot(c, L, '', 'import').id);
    writeHistory(c, y, L);
    const autos = history(y).filter((s) => s.auto);
    const twelfth = autoSnapshot(c, y, 'restore')!;
    const after = history(y);
    const autosAfter = after.filter((s) => s.auto);
    expect(autos.length).toBe(10);
    expect(autosAfter.length).toBe(10);
    expect(autosAfter.some((s) => s.id === twelfth.id)).toBe(true);
    expect(after.some((s) => s.id === autoIds[0])).toBe(false);
    expect(after.some((s) => s.id === autoIds[1])).toBe(false);
    expect(after.some((s) => s.id === autoIds[10])).toBe(true);
    expect(after.some((s) => s.id === named.id)).toBe(true);
  });

  it('history.restore.snapshot-always: a whole restore over a book with anything on it takes its snapshot, which gives the replaced book back exactly (the untouched-sample half: wave 1b)', () => {
    let y = desk(undefined, (b) => {
      (b.meta as Rec).title = 'Check Restore Mine';
      (b.sections as Rec[]).find((x) => x.type === 'chapter')!.content = 'Words kept in a named snapshot — check.';
    });
    const mine = saveNamed(c, y, 'Check mine');
    edit(y, sections(y).find((x) => x.type === 'chapter')!.id as string, { content: 'Other words on the desk now.' });
    const replaced = exportBook(y);
    const n0 = history(y).length;
    y = reopen(restoreDoc(c, y, mine.id)!);
    const h = history(y);
    expect(h.length).toBe(n0 + 1);
    expect(h[0]!.auto).toBe('restore');
    expect(h[0]!.doc.sections.map((x) => x.content).join('\n')).toBe((replaced.sections as Rec[]).map((x) => x.content).join('\n'));
    // and that snapshot gives the replaced book back exactly (History aside)
    const back = exportBook(reopen(restoreDoc(c, y, h[0]!.id)!));
    const strip = (b: Rec) => {
      const o = { ...b };
      delete o.history;
      delete o.historyPool;
      delete o.importReport;
      return o;
    };
    expect(strip(back)).toEqual(strip(replaced));
  });

  it('history.delta.words: +N / −N / same length against the book now, with each language\'s plural (Polish słowo / słowa / słów)', async () => {
    const y = desk();
    y.transact(() => sectionKeys(y).forEach((k) => removeSection(y, k)));
    const one = ch('', '1', words(100));
    insertSectionsAt(y, 0, [one]);
    const snap = saveNamed(c, y, 'Delta check');
    const tt = t as unknown as Parameters<typeof histDeltaText>[2];
    edit(y, one.id, { content: words(140) });
    expect(histDeltaText(snap.words, total(y), tt, 'en')).toBe(t('history.deltaUp', { n: '40', count: 40 }));
    edit(y, one.id, { content: words(70) });
    expect(histDeltaText(snap.words, total(y), tt, 'en')).toBe(t('history.deltaDown', { n: '30', count: 30 }));
    edit(y, one.id, { content: words(100) });
    expect(histDeltaText(snap.words, total(y), tt, 'en')).toBe(t('history.deltaSame'));
    const pl = await loadPack('pl');
    const tpl = ((k: string, p?: Rec) => translate({ packs: { en: en as Pack, pl }, pluralForms: meta.pluralForms as PluralForms }, 'pl', k, p)) as unknown as typeof tt;
    expect([1, 22, 5].map((n) => histDeltaText(0, n, tpl, 'pl'))).toEqual(['+1 słowo od tamtej pory', '+22 słowa od tamtej pory', '+5 słów od tamtej pory']);
    expect(histDeltaText(5, 0, tpl, 'pl')).toBe('−5 słów od tamtej pory');
  });

  it('history.delta.sections: added, no longer in the book, changed (or edited at the same length), left out, brought in; the rows add up to the chip', () => {
    const A = ch('Alpha', '1', words(50)), B = ch('Beta', '2', words(30)), C = ch('Gamma', '3', words(20)), D = ch('Delta', '4', words(10, 'old'));
    const y = desk();
    y.transact(() => {
      sectionKeys(y).forEach((k) => removeSection(y, k));
      insertSectionsAt(y, 0, [A, B, C, D]);
    });
    const snap = saveNamed(c, y, 'Sections check');
    const E = ch('Epsilon', '5', words(25));
    dropSection(y, B.id);
    insertSectionsAt(y, sectionsCount(y), [E]);
    edit(y, A.id, { content: words(55) });
    edit(y, D.id, { content: words(10, 'new') });
    const L = live(c, y);
    const snapDoc = L.state.history.find((s) => s.id === snap.id)!.doc;
    const diff = c.api.histSectionDiff(snapDoc, liveDoc(L));
    expect(diff.added.map((r) => r.id)).toEqual([E.id]);
    expect(diff.removed.map((r) => r.id)).toEqual([B.id]);
    expect(diff.changed.map((r) => r.id)).toEqual([A.id, D.id]);
    expect(diff.changed.find((r) => r.id === A.id)!.delta).toBe(5);
    expect(diff.changed.find((r) => r.id === D.id)!.delta).toBe(0);
    const sum = diff.added.concat(diff.removed, diff.changed).reduce((n, r) => n + r.delta, 0);
    expect(sum).toBe(c.api.bookWordTotal() - snap.words);
    // the sidebar eye: a section left out counts for nothing on either side
    edit(y, C.id, { included: false });
    const L2 = live(c, y);
    const hide = c.api.histSectionDiff(L2.state.history.find((s) => s.id === snap.id)!.doc, liveDoc(L2));
    expect(hide.leftout.map((r) => r.id)).toEqual([C.id]);
    const all = (['added', 'removed', 'leftout', 'broughtin', 'changed'] as const).reduce((n, k) => n + hide[k].reduce((m, r) => m + r.delta, 0), 0);
    expect(all).toBe(c.api.bookWordTotal() - snap.words);
    // a snapshot of the book exactly as it is: nothing differs
    const same = saveNamed(c, y, 'Same');
    const L3 = live(c, y);
    const none = c.api.histSectionDiff(L3.state.history.find((s) => s.id === same.id)!.doc, liveDoc(L3));
    expect(none.added.length + none.removed.length + none.leftout.length + none.broughtin.length + none.changed.length).toBe(0);
  });

  it('history.compare.words: the word diff and the paragraph diff (the engine, 1.0\'s own)', () => {
    const wd = c.api.histWordDiff('the grey sea was calm', 'the pewter sea was calm and wide');
    expect(wd.filter((p) => p.t !== '-').map((p) => p.s).join('')).toBe('the pewter sea was calm and wide');
    expect(wd.filter((p) => p.t === '-').map((p) => p.s.trim()).join('|')).toBe('grey');
    expect(wd.filter((p) => p.t === '+').map((p) => p.s.trim()).join('|')).toBe('pewter|and wide');
    const td = c.api.histTextDiff('One stays.\n\nTwo was here.\n\nThree is cut.\n\nFour stays.', 'One stays.\n\nTwo is here now.\n\nFour stays.\n\nFive is new.');
    expect(td.rows.map((r) => r.kind).join(',')).toBe('same,changed,removed,same,added');
    expect([td.removed, td.added]).toEqual([5, 6]);
  });

  it('history.snapshots.share-pictures: each picture written once; a dropped one once, in historyPool; it reads back and restores exactly; an older plain snapshot still reads', () => {
    const dataA = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(6000), dataB = 'data:image/png;base64,iVBORw0KGgo' + 'B'.repeat(6000);
    const y = desk(undefined, (b) => {
      b.images = [
        { id: 'hsA', name: 'Share A.png', mediaType: 'image/png', ext: 'png', data: dataA },
        { id: 'hsB', name: 'Share B.png', mediaType: 'image/png', ext: 'png', data: dataB },
      ];
      (b.meta as Rec).title = 'Share Check';
      (b.sections as Rec[]).find((x) => x.type === 'chapter')!.content = 'Words before the snapshots.';
    });
    const n1 = saveNamed(c, y, 'Share one');
    saveNamed(c, y, 'Share two');
    autoSnapshot(c, y, 'import');
    const copies = (doc: unknown, d: string) => JSON.stringify(doc).split(d).length - 1;
    const ser1 = exportBook(y);
    expect([copies(ser1, dataA), copies(ser1, dataB)]).toEqual([1, 1]);
    expect((ser1.history as Rec[]).some((h) => h.doc || !h.chopDoc)).toBe(false);
    // the book drops picture B (any code that changes pictures repacks History in the same transaction)
    repackHistory(c, y, () => setMeta(y, 'images', (exportBook(y).images as Rec[]).filter((im) => im.id !== 'hsB') as never));
    const ser2 = exportBook(y);
    expect(copies(ser2, dataB)).toBe(1);
    expect(((ser2.historyPool as Rec).images as Rec[]).map((i) => i.id)).toEqual(['hsB']);
    expect(copies(ser2, dataA)).toBe(1);
    const back = reopen(JSON.parse(JSON.stringify(ser2)) as Rec);
    const h = history(back);
    expect(h.length).toBe(3);
    expect(h.every((e) => (e.doc.images as Rec[]).length === 2 && (e.doc.images as Rec[]).some((im) => im.id === 'hsB' && im.data === dataB))).toBe(true);
    const restored = exportBook(reopen(restoreDoc(c, back, n1.id)!));
    const b = (restored.images as Rec[]).find((im) => im.id === 'hsB');
    expect(b && b.data).toBe(dataB);
    expect((restored.meta as Rec).title).toBe('Share Check');
    const legacy = c.api.normalizeHistory([{ id: 'old1', name: 'Old', at: '2026-01-01T00:00:00.000Z', words: 3, doc: { sections: [], images: [{ id: 'hsZ', data: 'x' }] } }]);
    expect(legacy.length).toBe(1);
    expect((legacy[0]!.doc.images as Rec[])[0]!.data).toBe('x');
  });

  it('history.restore.empty-desk-no-prune: over a truly empty desk no snapshot is taken (no real automatic one pruned); a title alone, and the snapshot is taken', () => {
    const src = desk(undefined, (b) => {
      (b.meta as Rec).title = 'Check Target';
      (b.sections as Rec[]).find((x) => x.type === 'chapter')!.content = 'The words to restore — check.';
    });
    const target = saveNamed(c, src, 'Check target');
    const L = live(c, src);
    for (let i = 0; i < (c.api.HISTORY_AUTO_CAP as number); i++) takeSnapshot(c, L, '', 'import');
    writeHistory(c, src, L);
    const kept = exportBook(src);
    const autosBefore = history(src).filter((s) => s.auto).map((s) => s.id).join(',');
    // an empty desk carrying that History
    const empty = desk(undefined, (b) => {
      b.history = kept.history;
      b.historyPool = kept.historyPool;
    });
    live(c, empty);
    expect(c.api.deskTrulyEmpty()).toBe(true);
    expect(t('history.restoreBodyEmpty', { name: 'x' })).not.toBe(t('history.restoreBody', { name: 'x' }));
    const n0 = history(empty).length;
    const after = reopen(restoreDoc(c, empty, target.id)!);
    expect(history(after).length).toBe(n0);
    expect(history(after).filter((s) => s.auto).map((s) => s.id).join(',')).toBe(autosBefore);
    expect((exportBook(after).meta as Rec).title).toBe('Check Target');
    // anything on the desk: the snapshot is taken
    const titled = desk(undefined, (b) => {
      b.history = kept.history;
      b.historyPool = kept.historyPool;
      (b.meta as Rec).title = 'Only a title';
    });
    live(c, titled);
    expect(c.api.deskTrulyEmpty()).toBe(false);
    const r = reopen(restoreDoc(c, titled, target.id)!);
    const s0 = history(r)[0]!;
    expect(history(r).length).toBe(n0);
    expect(s0.auto).toBe('restore');
    expect((s0.doc.meta as Rec).title).toBe('Only a title');
  });
});

describe('History storage: 1.0\'s saved form (review focus #2, model level)', () => {
  it('the stored form reads back through 1.0\'s own normalizeHistory after a book-format round trip; deleting a snapshot rewrites only History', () => {
    const y = desk([ch('One', '1', 'some words here')]);
    saveNamed(c, y, 'A');
    const b = saveNamed(c, y, 'B');
    const exported = JSON.parse(JSON.stringify(exportBook(y))) as Rec;
    const read = readBook(exported);
    expect(read.status).toBe('ok');
    const r = read.book as unknown as Rec;
    expect(c.api.normalizeHistory(r.history, r.historyPool).map((s) => s.name)).toEqual(['B', 'A']);
    const before = exportBook(y);
    expect(deleteSnapshot(c, y, b.id)).toBe(true);
    const after = exportBook(y);
    expect((after.history as Rec[]).map((e) => e.name)).toEqual(['A']);
    const rest = (x: Rec) => JSON.stringify({ ...x, history: null, historyPool: null });
    expect(rest(after)).toBe(rest(before));
    expect(deleteSnapshot(c, y, 'no-such-id')).toBe(false);
  });

  it('opening History on a fixture writes nothing (the no-edit gate)', () => {
    for (const f of fixtures('real')) {
      const y = new Y.Doc();
      importBook(f.book, y);
      let n = 0;
      y.on('update', () => n++);
      const L = live(c, y);
      c.api.bookWordTotal();
      for (const s of L.state.history) c.api.histSectionDiff(s.doc, liveDoc(L));
      expect(n, f.name).toBe(0);
      expect(y.getMap(META).get('history')).toEqual((readBook(f.book).book as unknown as Rec).history);
    }
  });
});

describe('review focus #1: a replace you can undo (through the store)', () => {
  it('a backup opened over the open book snapshots it first; Restore on that snapshot brings the old book back exactly (export-equal, History aside)', async () => {
    const all = fixtures('real');
    const A = all.find((f) => f.name === DUMAS)!, B = all.find((f) => f.name !== DUMAS && f.name.includes('lantern'))!;
    const a = await importToDevice(A.book);
    opened.push(a);
    const oldExport = a.export();
    // 1.0's localApplyBackup History: snapshot of the open book, then the arriving book (B carries its own History list)
    const read = readBook(B.book).book as unknown as Rec;
    const arrived = backupArrival(c, a.ydoc, B.book as Rec, read);
    expect(arrived).not.toBe(read);
    const b = await importToDevice(arrived);
    opened.push(b);
    const h = history(b.ydoc);
    expect(h[0]!.auto).toBe('backup');
    expect((exportBook(b.ydoc).sections as Rec[]).length).toBe((read.sections as Rec[]).length);
    // Restore the whole book on "Before opening a backup"
    const doc = restoreDoc(c, b.ydoc, h[0]!.id)!;
    const r = await importToDevice(doc);
    opened.push(r);
    const back = r.export();
    const strip = (x: Rec) => {
      const o = { ...x };
      delete o.history;
      delete o.historyPool;
      delete o.importReport;
      return o;
    };
    expect(strip(back)).toEqual(strip(oldExport));
    expect(JSON.stringify(strip(back))).toBe(JSON.stringify(strip(oldExport))); // key order too
    // and the restore is itself undoable: a Before-restore snapshot of the backup's book stands first
    const h2 = history(r.ydoc);
    expect(h2[0]!.auto).toBe('restore');
    expect(h2[1]!.auto).toBe('backup');
  }, 120_000);

  it('every real fixture: replaced by the next one, then restored from "Before opening a backup", exports exactly as before (key order included, History aside)', async () => {
    const all = fixtures('real');
    const strip = (x: Rec) => {
      const o = { ...x };
      delete o.history;
      delete o.historyPool;
      delete o.importReport;
      return o;
    };
    for (const [i, A] of all.entries()) {
      const B = all[(i + 1) % all.length]!;
      const a = await importToDevice(A.book);
      opened.push(a);
      const oldExport = a.export();
      const b = await importToDevice(backupArrival(c, a.ydoc, B.book as Rec, readBook(B.book).book as unknown as Rec));
      opened.push(b);
      const snap = history(b.ydoc)[0]!;
      expect(snap.auto, A.name).toBe('backup');
      const r = await importToDevice(restoreDoc(c, b.ydoc, snap.id)!);
      opened.push(r);
      expect(JSON.stringify(strip(r.export())), `${A.name} (replaced by ${B.name})`).toBe(JSON.stringify(strip(oldExport)));
      for (const o of opened.splice(0)) await o.close();
    }
  }, 300_000);

  it('a backup over an empty-desk book takes no snapshot (1.0: an empty desk is replaced without asking); nothing arrives changed when nothing is added', () => {
    const y = desk();
    const f = fixtures('real')[0]!;
    const read = readBook(f.book).book as unknown as Rec;
    live(c, y);
    expect(c.api.isEmptyDesk()).toBe(true);
    expect(backupArrival(c, y, f.book as Rec, read)).toBe(read);
    expect(backupArrival(c, null, f.book as Rec, read)).toBe(read);
  });
});

describe('fix round 1: a snapshot stored without an id', () => {
  it('gets the same id on every read (its place in the list), nothing is written on open, and it can be deleted and restored', () => {
    const one = ch('One', '1', 'first words');
    const y = desk([one]);
    saveNamed(c, y, 'Older');
    edit(y, one.id, { content: 'second words here' });
    saveNamed(c, y, 'Newer');
    const book = JSON.parse(JSON.stringify(exportBook(y))) as Rec;
    const h = book.history as Rec[];
    delete h[1]!.id; // "Older", as some old studio could have stored it
    const y2 = reopen(book);
    let n = 0;
    y2.on('update', () => n++);
    const ids1 = history(y2).map((s) => s.id), ids2 = history(y2).map((s) => s.id);
    expect(ids1).toEqual(ids2);
    expect(ids1[1]).toBe('hist-1');
    expect(n).toBe(0);
    // restore the id-less one (whole book), then delete it
    const back = reopen(restoreDoc(c, y2, 'hist-1')!);
    expect(sections(back).find((x) => x.id === one.id)!.content).toBe('first words');
    expect(restoreSection(c, y2, 'hist-1', one.id)).not.toBeNull();
    expect(sec(y2, one.id)!.content).toBe('first words');
    const names = () => history(y2).map((s) => s.name);
    expect(names()).toContain('Older');
    const olderId = history(y2).find((s) => s.name === 'Older')!.id; // the History write above persisted its id
    expect(olderId).toBe('hist-1');
    expect(deleteSnapshot(c, y2, olderId)).toBe(true);
    expect(names()).not.toContain('Older');
  });
});
