import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook, insertSections, posToTextOffset, SECTIONS, textOffsetToPos, toDoc, toText } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { chopDelete, chopDuplicate, chopMenuItems, chopMerge, chopSplit, chopSplitWhy, chopUndo, type ChopEnv } from '../src/chapters/chop';
import { bookState, loadClosure, setClosureT, type Closure } from '../src/closure/index';
import { snapshotLabel } from '../src/history/HistoryDialog';
import { live } from '../src/history/history';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { fixtures } from './fixtures';

/* Wave 1b, task 3: the chapter operations (inventory B2), against 1.0's own
   rules run through the closure.
   Review focus #1 — split equals 1.0: at a caret anywhere (inside emphasis,
   a note reference, a raw block, at a block boundary, at the start, at the
   end) the two sections are exactly 1.0's chopSplitPlan for the caret's
   text offset, and where 1.0 refuses, 2.0 refuses with 1.0's message.
   Review focus #2 — merge, delete and duplicate equal 1.0 (chopMergePlan,
   chopMergeWhy, renumbering under every chopNumberStyle incl. Roman; new ids
   by 1.0's uid()).
   Review focus #3 — Undo returns the book to an export-equal state.
   1.0 self-checks re-expressed (on 1.0's own chopCheckFixture, built with
   1.0's buildEmptyBook and mkSection): chapters.delete.undo-restores-exactly,
   chapters.delete.snapshot-taken, chapters.duplicate.deep-copy,
   chapters.split.at-caret, chapters.merge.scene-break,
   chapters.merge.refuses-across-kinds. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 1.0's chopCheckFixture, as a book document (1.0's buildEmptyBook and mkSection), opened in a Y.Doc. */
function fixture() {
  const book = c.api.buildEmptyBook();
  const mk = c.api.mkSection;
  book.images = [{ id: 'chopimg1', name: 'lamp.png', mediaType: 'image/png', data: PNG }];
  const fw = mk('front', 'foreword', 'Foreword', { content: 'A word first.' });
  const c1 = mk('body', 'chapter', 'Harbour', { number: '1', content: 'Alpha one.\n\nAlpha two.' });
  const c2 = mk('body', 'chapter', 'Lantern', {
    number: '2', content: "Bravo opens.[^1]\n\n***\n\n![A lamp](img:chopimg1)\n\nBravo closes.\n\n[^1]: Bravo's note.",
    dropCap: false, smallCaps: false, plateId: 'chopimg1', plateAlt: 'A plate', backdropId: 'chopimg1', backdropStrength: 'strong',
    scenes: [{ at: 0, imageId: 'chopimg1', name: 'Lamp', caption: 'The lamp', alt: 'A lamp' }],
  });
  const c3 = mk('body', 'chapter', 'Tide', { number: '3', content: 'Charlie text.' });
  const ab = mk('back', 'about', 'About the Author', { content: 'Lives by the sea.' });
  book.sections = book.sections.filter((s) => s.kind === 'front').concat([fw, c1, c2, c3], [ab]);
  book.activeId = c2.id;
  const ydoc = new Y.Doc();
  importBook(book, ydoc);
  return { ydoc, fw, c1, c2, c3, ab };
}
const env = (ydoc: Y.Doc, activeId: string | null): ChopEnv => ({ c, ydoc, t: t as ChopEnv['t'], activeId });
const secs = (ydoc: Y.Doc) => exportBook(ydoc).sections as Rec[];
const find = (ydoc: Y.Doc, id: unknown) => secs(ydoc).find((s) => s.id === id)!;
const nums = (ydoc: Y.Doc) => secs(ydoc).filter((s) => s.type === 'chapter').map((s) => s.number).join(',');
const history = (ydoc: Y.Doc) => live(c, ydoc).state.history;
const live1 = () => true;
/** The export with History set aside (a snapshot is History, not the book). */
const book = (ydoc: Y.Doc) => {
  const b = exportBook(ydoc);
  delete b.history;
  delete b.historyPool;
  return JSON.stringify(b);
};
/** The number of Y updates `fn` makes. */
function updates<T>(ydoc: Y.Doc, fn: () => T): [T, number] {
  let n = 0;
  const on = () => n++;
  ydoc.on('update', on);
  const r = fn();
  ydoc.off('update', on);
  return [r, n];
}

describe('chapters.delete (1.0 self-checks)', () => {
  it('undo-restores-exactly: Undo puts the section back at its place, byte for byte, numbers and the active section too; out-of-order undos; hand numbers kept', () => {
    const f = fixture();
    const idx = secs(f.ydoc).findIndex((s) => s.id === f.c2.id);
    const c2json = JSON.stringify(find(f.ydoc, f.c2.id));
    const [done, n] = updates(f.ydoc, () => chopDelete(env(f.ydoc, f.c2.id), f.c2.id));
    expect(n).toBe(1); // the snapshot, the delete and the renumbering: one transaction
    if (!done || done === 'keepOne') throw new Error('not deleted');
    expect(secs(f.ydoc).some((s) => s.id === f.c2.id)).toBe(false);
    expect(done.activeId).toBe(f.c3.id);
    expect(nums(f.ydoc)).toBe('1,2');
    // a later edit elsewhere stands through Undo
    editText(f.ydoc, f.c1.id, (x) => x + '\n\nA later line.');
    const r = chopUndo(env(f.ydoc, done.activeId), done.rec, live1);
    expect(r).toEqual({ ok: true, activeId: f.c2.id });
    expect(JSON.stringify(secs(f.ydoc)[idx])).toBe(c2json);
    expect(nums(f.ydoc)).toBe('1,2,3');
    expect(String(find(f.ydoc, f.c1.id).content).endsWith('A later line.')).toBe(true);
    expect(chopUndo(env(f.ydoc, f.c2.id), done.rec, live1)).toEqual({ ok: false, changed: null }); // spent
    expect(secs(f.ydoc).filter((s) => s.id === f.c2.id).length).toBe(1);

    // the last body chapter, deleted while active: refused only when it is the book's last section (keepOne is 1.0's)
    const g = fixture();
    chopDelete(env(g.ydoc, null), g.c1.id);
    chopDelete(env(g.ydoc, null), g.c3.id);
    const last = chopDelete(env(g.ydoc, g.c2.id), g.c2.id);
    expect(last && last !== 'keepOne').toBe(true);
    expect(secs(g.ydoc).some((s) => s.kind === 'body')).toBe(false);

    // numbered in words: the sequence holds, and Undo puts the words back
    const w = fixture();
    renumber(w.ydoc, ['One', 'Two', 'Three']);
    const recW = chopDelete(env(w.ydoc, null), w.c1.id);
    if (!recW || recW === 'keepOne') throw new Error('x');
    expect(nums(w.ydoc)).toBe('One,Two');
    expect(chopUndo(env(w.ydoc, null), recW.rec, live1).ok).toBe(true);
    expect(nums(w.ydoc)).toBe('One,Two,Three');

    // two deletes undone out of order: the sequence holds at every step and the book comes back exactly
    const o = fixture();
    renumber(o.ydoc, ['One', 'Two', 'Three']);
    const oPre = book(o.ydoc);
    const o1 = chopDelete(env(o.ydoc, null), o.c1.id), o2 = chopDelete(env(o.ydoc, null), o.c3.id);
    if (!o1 || o1 === 'keepOne' || !o2 || o2 === 'keepOne') throw new Error('x');
    expect(nums(o.ydoc)).toBe('One');
    expect(chopUndo(env(o.ydoc, null), o1.rec, live1).ok).toBe(true);
    expect(nums(o.ydoc)).toBe('One,Two');
    expect(chopUndo(env(o.ydoc, null), o2.rec, live1).ok).toBe(true);
    expect(nums(o.ydoc)).toBe('One,Two,Three');
    expect(book(o.ydoc)).toBe(oPre);

    // numbered by hand: nothing renumbered
    const k = fixture();
    renumber(k.ydoc, ['7', '12', '']);
    chopDelete(env(k.ydoc, null), k.c2.id);
    expect(nums(k.ydoc)).toBe('7,');
  });

  it('snapshot-taken: "Before deleting <name>" (chapterop, its chop record) rides the book packed; five structural snapshots kept beside others', () => {
    const f = fixture();
    const done = chopDelete(env(f.ydoc, null), f.c2.id);
    if (!done || done === 'keepOne') throw new Error('x');
    const h = history(f.ydoc);
    const snap = h[0]!;
    expect(snap.id).toBe(done.rec.snapId);
    expect(snap.auto).toBe('chapterop');
    expect(snap.chop).toEqual({ op: 'delete', a: 'Lantern', b: '' });
    expect(snapshotLabel(snap, t as never)).toBe(t('history.auto.chopDelete', { name: 'Lantern' }));
    expect(snap.doc.sections.some((s) => s.id === f.c2.id && s.content === f.c2.content)).toBe(true);
    expect('history' in snap.doc).toBe(false);
    // stored packed: the book's picture named, not copied
    const stored = (exportBook(f.ydoc).history as Rec[]).find((e) => e.id === snap.id)!;
    expect(stored.doc).toBeUndefined();
    expect(JSON.stringify(stored).includes(PNG)).toBe(false);
    // seven more structural edits: five structural snapshots stay
    const g = fixture();
    for (let i = 0; i < 7; i++) chopDuplicate(env(g.ydoc, null), g.c1.id);
    expect(history(g.ydoc).filter((x) => x.auto === 'chapterop').length).toBe(c.api.CHOP_SNAP_CAP);
  });
});

describe('chapters.duplicate.deep-copy (1.0 self-check)', () => {
  it('a deep copy right after, new id by 1.0\'s uid(), "<title> (copy)", selected, renumbered; Undo removes it; refuses when the copy was edited', () => {
    const f = fixture();
    const idx = secs(f.ydoc).findIndex((s) => s.id === f.c2.id);
    const orig = JSON.stringify(find(f.ydoc, f.c2.id));
    const done = chopDuplicate(env(f.ydoc, f.c2.id), f.c2.id)!;
    const copy = secs(f.ydoc)[idx + 1]!;
    expect(copy.id).not.toBe(f.c2.id);
    expect(String(copy.id)).toMatch(/^s/); // 1.0's uid(): "s" + random
    expect(copy.title).toBe(t('chop.copyTitle', { title: 'Lantern' }));
    expect(done.activeId).toBe(copy.id);
    expect(copy.content).toBe(f.c2.content);
    expect([copy.plateId, copy.backdropId, copy.backdropStrength, copy.dropCap, copy.smallCaps]).toEqual(['chopimg1', 'chopimg1', 'strong', false, false]);
    expect(JSON.stringify(copy.scenes)).toBe(JSON.stringify(f.c2.scenes));
    expect(nums(f.ydoc)).toBe('1,2,3,4');
    expect(copy.number).toBe('3');
    expect(JSON.stringify(find(f.ydoc, f.c2.id))).toBe(orig);
    expect(snapshotLabel(history(f.ydoc)[0]!, t as never)).toBe(t('history.auto.chopDuplicate', { name: 'Lantern' }));
    const pre = fixture();
    const before = book(pre.ydoc);
    const d2 = chopDuplicate(env(pre.ydoc, pre.c2.id), pre.c2.id)!;
    expect(chopUndo(env(pre.ydoc, d2.activeId), d2.rec, live1)).toEqual({ ok: true, activeId: pre.c2.id });
    expect(book(pre.ydoc)).toBe(before);
    // an edited copy: Undo refuses, naming it
    const h = fixture();
    const d3 = chopDuplicate(env(h.ydoc, null), h.c2.id)!;
    const copyId = String(d3.rec.data.copyId);
    editText(h.ydoc, copyId, (s) => s + '\n\nNew words in the copy.');
    expect(chopUndo(env(h.ydoc, null), d3.rec, live1)).toEqual({ ok: false, changed: t('chop.copyTitle', { title: 'Lantern' }) });
    expect(secs(h.ydoc).some((s) => s.id === copyId)).toBe(true);
  });
});

describe('chapters.split.at-caret (1.0 self-check) and review focus #1', () => {
  it('cuts at the caret\'s paragraph; the heading at the cut becomes the title; notes follow their citations; Undo restores exactly', () => {
    const f = fixture();
    const text = 'Para one.[^1]\n\nPara two.\n\n***\n\n# The Turn\n\nPara three.[^2]\n\n![A lamp](img:chopimg1)\n\n[^1]: Note one.\n\n[^2]: Note two.';
    editText(f.ydoc, f.c2.id, () => text);
    setField(f.ydoc, f.c2.id, 'scenes', [{ at: 0, imageId: 'chopimg1', name: '', caption: '', alt: 'A lamp' }]);
    const before = book(f.ydoc);
    const a = stateSec(f.ydoc, f.c2.id);
    expect(chopSplitWhy(c, a, f.c2.id, text.indexOf('# The Turn') + 4, t as never)).toBe('');
    expect(chopSplitWhy(c, stateSec(f.ydoc, f.c1.id), f.c2.id, 0, t as never)).toBe(t('chop.splitNeedsActive'));
    expect(c.api.chopSplitPlan(a, 0)).toBeNull();
    expect(c.api.chopSplitPlan(a, text.length)).toBeNull();
    const done = chopSplit(env(f.ydoc, f.c2.id), f.c2.id, text.indexOf('# The Turn') + 4)!;
    const all = secs(f.ydoc);
    const i = all.findIndex((s) => s.id === f.c2.id);
    const A = all[i]!, B = all[i + 1]!;
    expect(A.content).toBe('Para one.[^1]\n\nPara two.\n\n***\n\n[^1]: Note one.');
    expect((A.scenes as unknown[]).length).toBe(1);
    expect(A.title).toBe('Lantern');
    expect(B.title).toBe('The Turn');
    expect(B.content).toBe('Para three.[^2]\n\n![A lamp](img:chopimg1)\n\n[^2]: Note two.');
    expect((B.scenes as unknown[]).length).toBe(0);
    expect([B.type, B.kind, B.dropCap, B.plateId]).toEqual(['chapter', 'body', false, null]);
    expect(done.activeId).toBe(B.id);
    expect(nums(f.ydoc)).toBe('1,2,3,4');
    expect(B.number).toBe('3');
    expect(snapshotLabel(history(f.ydoc)[0]!, t as never)).toBe(t('history.auto.chopSplit', { name: 'Lantern' }));
    expect(chopUndo(env(f.ydoc, done.activeId), done.rec, live1)).toEqual({ ok: true, activeId: f.c2.id });
    expect(book(f.ydoc)).toBe(before);
    // mid-paragraph, no heading: titled "Lantern (2)"
    const g = fixture();
    const gs = stateSec(g.ydoc, g.c2.id);
    const plan = c.api.chopSplitPlan(gs, String(g.c2.content).indexOf('Bravo closes.') + 3)!;
    expect(plan.title).toBe(t('chop.splitTitle', { title: 'Lantern' }));
    expect(plan.c2).toBe('Bravo closes.');
    expect(plan.c1).toBe("Bravo opens.[^1]\n\n***\n\n![A lamp](img:chopimg1)\n\n[^1]: Bravo's note.");
    expect(plan.sc1.length).toBe(1);
    expect(plan.sc2.length).toBe(0);
  });

  it('at a caret anywhere in every fixture chapter (inside emphasis, a note reference, a raw block, a boundary, start, end): exactly 1.0\'s plan for the caret\'s offset, or 1.0\'s refusal', () => {
    let splits = 0, refusals = 0, tried = 0;
    const kinds = new Set<string>();
    for (const fx of fixtures('real')) {
      const ydoc = new Y.Doc();
      importBook(fx.book, ydoc);
      const list = (exportBook(ydoc).sections as Rec[]).map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'body' && typeof s.content === 'string' && (s.content as string).length).slice(0, 3);
      const whole = exportBook(ydoc);
      for (const { s } of list) {
        const text = s.content as string;
        // the chapter with its book around it, less the other chapters (a split reads only its own section)
        const mini = { ...whole, sections: (whole.sections as Rec[]).filter((x) => x.kind !== 'body' || x.id === s.id) };
        const doc = toDoc(text);
        // caret positions: every textblock position for short texts, else a spread plus the ones inside marks and raw blocks
        const positions: number[] = [];
        doc.descendants((n, pos) => {
          if (n.isTextblock) {
            const inner = n.content.size;
            const step = Math.max(1, Math.floor(inner / 6));
            for (let k = 0; k <= inner; k += step) positions.push(pos + 1 + k);
            positions.push(pos + 1 + inner);
            if (n.type.spec.code) kinds.add('raw');
          }
          if (n.isText && n.marks.length) {
            positions.push(pos + Math.floor(n.text!.length / 2));
            for (const m of n.marks) kinds.add(m.type.name);
          }
          return true;
        });
        for (const p of [...new Set(positions)].slice(0, 24)) {
          tried++;
          const off = posToTextOffset(doc, p);
          const y = new Y.Doc();
          importBook(mini, y);
          const st = stateSec(y, s.id);
          const plan = c.api.chopSplitPlan(st, off);
          const why = chopSplitWhy(c, st, String(s.id), off, t as never);
          const done = chopSplit(env(y, String(s.id)), String(s.id), off);
          if (!plan) {
            refusals++;
            expect(done).toBeNull();
            expect(why === t('chop.splitNeedsCaret') || why === t('chop.splitNeedsActive')).toBe(true);
            continue;
          }
          splits++;
          expect(why).toBe('');
          const all = secs(y);
          const i = all.findIndex((x) => x.id === s.id);
          expect(all[i]!.content, `${fx.name} @${off}`).toBe(plan.c1);
          expect(all[i + 1]!.content, `${fx.name} @${off}`).toBe(plan.c2);
          expect(all[i + 1]!.title).toBe(plan.title);
          expect(JSON.stringify(all[i]!.scenes)).toBe(JSON.stringify(plan.sc1));
          expect(JSON.stringify(all[i + 1]!.scenes)).toBe(JSON.stringify(plan.sc2));
          // no heading lifted and no note moved: the halves join back into the original
          if (!plan.lifted && !/\[\^?\d{1,3}\]:/.test(text) && text === text.split(/\n\s*\n/).map((b) => b.replace(/^\s*\n|\n\s*$/g, '')).filter((b) => b.trim()).join('\n\n'))
            expect(plan.c1 + '\n\n' + plan.c2).toBe(text);
          // and the caret position the offset came from is the one textOffsetToPos gives back
          expect(posToTextOffset(doc, textOffsetToPos(doc, off))).toBe(off);
        }
      }
    }
    expect(tried).toBeGreaterThan(100);
    expect(splits).toBeGreaterThan(20);
    expect(refusals).toBeGreaterThan(0); // the start and end of a chapter
    expect([...kinds]).toEqual(expect.arrayContaining(['em', 'footnoteRef']));
  }, 300_000);

  it('a caret inside a raw block, inside a note reference and inside emphasis splits as 1.0 does at that offset', () => {
    const f = fixture();
    const text = 'Intro *slanted words here* end.\n\n- list one\n- list two\n\nSee the note[^1] there.\n\nLast.\n\n[^1]: The note.';
    editText(f.ydoc, f.c2.id, () => text);
    for (const at of [text.indexOf('slanted') + 3, text.indexOf('list two') + 2, text.indexOf('[^1]') + 2, text.indexOf('Last.')]) {
      const y = new Y.Doc();
      importBook(exportBook(f.ydoc), y);
      const plan = c.api.chopSplitPlan(stateSec(y, f.c2.id), at);
      const done = chopSplit(env(y, f.c2.id), f.c2.id, at);
      expect(!!done).toBe(!!plan);
      if (!plan) continue;
      const all = secs(y);
      const i = all.findIndex((x) => x.id === f.c2.id);
      expect([all[i]!.content, all[i + 1]!.content]).toEqual([plan.c1, plan.c2]);
      expect(toText(toDoc(plan.c1))).toBe(plan.c1);
    }
  });
});

describe('chapters.merge (1.0 self-checks) and review focus #2', () => {
  it('scene-break: joined with ***, the clashing note relabelled, the first\'s title and settings kept, scenes shifted; Undo restores both exactly; refuses when edited', () => {
    const f = fixture();
    editText(f.ydoc, f.c1.id, () => 'Alpha one.[^1]\n\n[^1]: A-note.');
    editText(f.ydoc, f.c2.id, () => 'Bravo.[^1]\n\n***\n\nBravo two.\n\n[^1]: B-note.');
    const before = book(f.ydoc);
    expect(c.api.chopMergeWhy(stateSec(f.ydoc, f.c1.id))).toBe('');
    const done = chopMerge(env(f.ydoc, f.c2.id), f.c1.id)!;
    const m = find(f.ydoc, f.c1.id);
    expect(m.content).toBe('Alpha one.[^1]\n\n***\n\nBravo.[^2]\n\n***\n\nBravo two.\n\n[^1]: A-note.\n\n[^2]: B-note.');
    expect(m.title).toBe('Harbour');
    expect(m.dropCap).toBe(true);
    expect(m.plateId).toBeFalsy();
    expect(secs(f.ydoc).some((s) => s.id === f.c2.id)).toBe(false);
    expect(done.activeId).toBe(f.c1.id);
    expect((m.scenes as Rec[]).length).toBe(1);
    expect((m.scenes as Rec[])[0]!.at).toBe(1);
    expect(nums(f.ydoc)).toBe('1,2');
    expect(snapshotLabel(history(f.ydoc)[0]!, t as never)).toBe(t('history.auto.chopMerge', { a: 'Harbour', b: 'Lantern' }));
    expect(chopUndo(env(f.ydoc, done.activeId), done.rec, live1)).toEqual({ ok: true, activeId: f.c2.id });
    expect(book(f.ydoc)).toBe(before);
    const h = fixture();
    const d3 = chopMerge(env(h.ydoc, null), h.c1.id)!;
    editText(h.ydoc, h.c1.id, (s) => s + '\n\nWritten after the merge.');
    expect(chopUndo(env(h.ydoc, null), d3.rec, live1)).toEqual({ ok: false, changed: 'Harbour' });
    expect(secs(h.ydoc).some((s) => s.id === h.c2.id)).toBe(false);
  });

  it('refuses-across-kinds: front→body, body→back, the last section, Part dividers and generated pages, with 1.0\'s reasons; nothing written', () => {
    const f = fixture();
    const before = JSON.stringify(exportBook(f.ydoc));
    const why = (id: string) => c.api.chopMergeWhy(stateSec(f.ydoc, id));
    expect(why(f.fw.id)).toBe(t('chop.mergeAcross', { group: t('side.groupBody') }));
    expect(why(f.c3.id)).toBe(t('chop.mergeAcross', { group: t('side.groupBack') }));
    expect(why(f.ab.id)).toBe(t('chop.mergeNoNext'));
    expect(chopMerge(env(f.ydoc, null), f.fw.id)).toBeNull();
    expect(chopMerge(env(f.ydoc, null), f.c3.id)).toBeNull();
    expect(chopMerge(env(f.ydoc, null), f.ab.id)).toBeNull();
    expect(JSON.stringify(exportBook(f.ydoc))).toBe(before);
    const gen = secs(f.ydoc).find((s) => s.type === 'toc' || s.type === 'titlepage');
    if (gen) {
      expect(why(String(gen.id))).toBe(t('chop.mergeGenerated'));
      expect(chopMenuItems(c, f.ydoc, String(gen.id), t as never, () => '')).toEqual([]);
    }
    // the menu says it too
    const items = chopMenuItems(c, f.ydoc, f.fw.id, t as never, () => '');
    expect(items.find((x) => x.act === 'merge')!.why).toBe(why(f.fw.id));
    // a Part divider
    const p = fixture();
    const part = c.api.mkSection('body', 'part', 'Book One');
    importInto(p.ydoc, secs(p.ydoc).findIndex((s) => s.id === p.c1.id), part);
    expect(c.api.chopMergeWhy(stateSec(p.ydoc, part.id))).toBe(t('chop.mergePart'));
  });

  it('renumbers under every style 1.0 knows (1 2 3, I II III, i ii iii, One, ONE, one, Twenty-One), and keeps hand numbers', () => {
    const styles: [string[], string[]][] = [
      [['1', '2', '3'], ['1', '2']],
      [['I', 'II', 'III'], ['I', 'II']],
      [['i', 'ii', 'iii'], ['i', 'ii']],
      [['One', 'Two', 'Three'], ['One', 'Two']],
      [['ONE', 'TWO', 'THREE'], ['ONE', 'TWO']],
      [['one', 'two', 'three'], ['one', 'two']],
    ];
    for (const [pre, post] of styles) {
      const f = fixture();
      renumber(f.ydoc, pre);
      const before = book(f.ydoc);
      const d = chopMerge(env(f.ydoc, null), f.c1.id)!;
      expect(nums(f.ydoc)).toBe(post.join(','));
      chopUndo(env(f.ydoc, null), d.rec, live1);
      expect(book(f.ydoc)).toBe(before);
    }
    // Roman past ten, and hyphenated words: a duplicate at the end extends the sequence
    const r = fixture();
    renumber(r.ydoc, ['IX', 'X', 'XI']);
    // IX, X, XI as chapters 1..3 do not fit any style starting at I: kept as written
    chopDuplicate(env(r.ydoc, null), r.c3.id);
    expect(nums(r.ydoc)).toBe('IX,X,XI,XI');
    const w = fixture();
    const many = Array.from({ length: 20 }, (_, i) => c.api.mkSection('body', 'chapter', 'C' + (i + 4), { number: '', content: 'x' }));
    for (const s of many) importInto(w.ydoc, secs(w.ydoc).findIndex((x) => x.id === w.ab.id), s);
    const words = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three'];
    renumber(w.ydoc, words);
    chopDuplicate(env(w.ydoc, null), w.c1.id);
    expect(nums(w.ydoc).split(',').slice(-2)).toEqual(['Twenty-three', 'Twenty-four']);
  });
});

describe('Undo is export-equal on every fixture (review focus #3)', () => {
  it('delete, duplicate, split and merge, each undone, give back exactly the book (History aside); each is one transaction', () => {
    const ran: Record<string, number> = { delete: 0, duplicate: 0, split: 0, merge: 0 };
    for (const fx of fixtures('real')) {
      const base = new Y.Doc();
      importBook(fx.book, base);
      const all = exportBook(base).sections as Rec[];
      const bodies = all.filter((s) => s.kind === 'body' && s.type !== 'part');
      if (bodies.length < 2) continue;
      const a = bodies[Math.min(1, bodies.length - 2)]!;
      for (const op of ['delete', 'duplicate', 'split', 'merge'] as const) {
        const y = new Y.Doc();
        importBook(fx.book, y);
        const before = book(y);
        const id = String(a.id);
        const content = String(a.content ?? '');
        const e = env(y, id);
        const [done, n] = updates(y, () =>
          op === 'delete' ? chopDelete(e, id) : op === 'duplicate' ? chopDuplicate(e, id) : op === 'split' ? chopSplit(e, id, Math.floor(content.length / 2)) : chopMerge(e, id),
        );
        if (!done || done === 'keepOne') continue;
        ran[op]!++;
        expect(n, `${fx.name} ${op}`).toBe(1);
        expect(book(y), `${fx.name} ${op} changed something`).not.toBe(before);
        const [r, n2] = updates(y, () => chopUndo(env(y, done.activeId), done.rec, live1));
        expect(r.ok, `${fx.name} ${op} undo`).toBe(true);
        expect(n2).toBe(1);
        expect(book(y), `${fx.name} ${op} undo export-equal`).toBe(before);
        // the spent snapshot is gone
        expect(history(y).some((h) => h.id === done.rec.snapId)).toBe(false);
      }
    }
    for (const op of Object.keys(ran)) expect(ran[op], op).toBeGreaterThanOrEqual(5);
  }, 300_000);

  it('an Undo offered on a book this tab no longer holds does nothing', () => {
    const f = fixture();
    const d = chopDuplicate(env(f.ydoc, null), f.c1.id)!;
    const before = JSON.stringify(exportBook(f.ydoc));
    expect(chopUndo(env(f.ydoc, null), d.rec, () => false)).toEqual({ ok: false, changed: null });
    expect(JSON.stringify(exportBook(f.ydoc))).toBe(before);
    expect(d.rec.done).toBe(true);
  });
});

/* ---- helpers ---- */

function stateSec(ydoc: Y.Doc, id: unknown): Rec {
  const { state } = bookState(c, ydoc);
  c.setState(state);
  return state.sections.find((s) => s.id === id)!;
}
function mapOf(ydoc: Y.Doc, id: unknown): Y.Map<unknown> {
  return ydoc.getArray<Y.Map<unknown>>(SECTIONS).toArray().find((m) => m.get('id') === id)!;
}
function editText(ydoc: Y.Doc, id: unknown, f: (s: string) => string): void {
  // the section with new text, in its place (as an editor's writes would leave it)
  const plain = { ...find(ydoc, id) };
  plain.content = f(String(plain.content));
  const arr = ydoc.getArray(SECTIONS);
  const i = arr.toArray().indexOf(mapOf(ydoc, id));
  ydoc.transact(() => {
    arr.delete(i, 1);
    insertSections(arr, i, [plain]);
  });
}
function setField(ydoc: Y.Doc, id: unknown, k: string, v: unknown): void {
  mapOf(ydoc, id).set(k, v);
}
function importInto(ydoc: Y.Doc, at: number, sec: Rec): void {
  ydoc.transact(() => insertSections(ydoc.getArray(SECTIONS), at, [sec]));
}
/** Set the chapters' numbers, in order (chapters past the list keep theirs). */
function renumber(ydoc: Y.Doc, list: string[]): void {
  const ch = ydoc.getArray<Y.Map<unknown>>(SECTIONS).toArray().filter((m) => m.get('type') === 'chapter');
  ydoc.transact(() => ch.forEach((m, i) => { if (i < list.length) m.set('number', list[i]); }));
}
