import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureT, stateFromBook, type Closure } from '../src/closure/index';
import { chopMove, chopUndo } from '../src/chapters/chop';
import { boardEdit, boardState, boardView, secIn, type BoardUi } from '../src/outline/board';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { fixtures } from './fixtures';

/* Wave 2c, task 3: the outline board's data (inventory B5), against 1.0's
   own functions.
   Review focus #3 — the board round-trips: tags (with colours), threads,
   custom fields and saved filters, synopsis, status and point of view
   survive a reload (export → import → export, string-equal) and 1.0 reads
   them identically (1.0's olNormalize / olSectionFields over the exported
   book give back exactly what 2.0 stored: 1.0's serializeBook form).
   Review focus #4 (model half) — reading the board never writes.
   1.0 self-checks re-expressed (data halves; the export halves — EPUB,
   print, Word identical — are wave 5): outline.status.tags,
   outline.filter.saved, outline.grid.threads, outline.fields,
   outline.cards.reorder, outline.synopsis.notexported (word counts),
   outline.grid.fills-from-text (counts equal the Covenant's own). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});
const UI: BoardUi = { view: 'cards', matter: false, status: [], tags: [], savedId: null, tagsOpen: false, fieldsOpen: false };
const secs = (y: Y.Doc) => exportBook(y).sections as Rec[];
const open = (book: Rec) => {
  const y = new Y.Doc();
  importBook(book, y);
  return y;
};
const reload = (y: Y.Doc) => open(exportBook(y));
const PLAN = ['synopsis', 'status', 'tags', 'pov', 'threads', 'custom'];

/** Everything the board can set, on the first three body sections, through 1.0's own functions. */
function plan(y: Y.Doc) {
  // three sections: the first body ones (a short book lends from its other matter)
  const all = secs(y).filter((s) => s.type !== 'part');
  const body = [...all.filter((s) => (s.kind ?? 'body') === 'body'), ...all.filter((s) => (s.kind ?? 'body') !== 'body')].slice(0, 3).map((s) => String(s.id));
  expect(body.length).toBe(3);
  const [a, b, d] = body as [string, string, string];
  const ed = <R,>(fn: (st: ReturnType<typeof stateFromBook>) => R, ui = UI) => boardEdit(c, y, ui, fn);
  ed((st) => c.api.olSetField(secIn(st, a), 'status', 'draft'));
  ed((st) => c.api.olSetField(secIn(st, b), 'status', 'final'));
  ed((st) => c.api.olSetField(secIn(st, a), 'synopsis', 'The muster at dawn.'));
  ed((st) => c.api.olSetField(secIn(st, b), 'pov', 'Athos'));
  ed((st) => c.api.olAddTag(secIn(st, a), 'Subplot'));
  ed((st) => c.api.olAddTag(secIn(st, b), 'subplot')); // the same tag, another case: 1.0 keeps the registry's name
  ed((st) => c.api.olAddTag(secIn(st, b), 'Night'));
  ed(() => {
    const tg = c.api.olTagOf('Night')!;
    tg.colour = 5;
  });
  const th = ed(() => c.api.olAddThread('The letter')).value!;
  ed((st) => c.api.olSetThreadNote(secIn(st, d), th.id, 'It is sealed.'));
  const ft = ed(() => c.api.olAddField('Weather', 'text')).value!;
  const fc = ed(() => c.api.olAddField('Checked', 'check')).value!;
  const fl = ed(() => c.api.olAddField('Mood', 'list')).value!;
  const fd = ed(() => c.api.olAddField('When', 'date')).value!;
  ed(() => c.api.olSetFieldOptions(fl.id, 'calm, stormy، grim'));
  ed((st) => c.api.olSetCustom(secIn(st, a), ft.id, 'Rain'));
  ed((st) => c.api.olSetCustom(secIn(st, a), fc.id, true));
  ed((st) => c.api.olSetCustom(secIn(st, b), fl.id, 'stormy'));
  ed((st) => c.api.olSetCustom(secIn(st, b), fd.id, '1625-04-01'));
  ed((st) => c.api.olSetCustom(secIn(st, d), fd.id, 'April')); // not a date: 1.0 keeps no value
  const saved = ed(() => c.api.olSaveFilter('Drafts with subplot'), { ...UI, status: ['draft'], tags: ['Subplot'] });
  return { a, b, d, th, ft, fc, fl, fd, saved };
}

const books = fixtures('real').filter((f) => Array.isArray((f.book as Rec).sections));

describe('the outline board round-trips (review focus #3)', () => {
  it('on every real fixture: survives a reload string-equal, and 1.0 reads back exactly what 2.0 stored', () => {
    for (const f of books) {
      const y = open(f.book);
      const original = exportBook(y);
      const p = plan(y);
      const out = exportBook(y);
      // only what the board set changed: every other top-level value and every other section key as stored
      for (const k of Object.keys(original)) if (k !== 'sections' && k !== 'outline') expect(JSON.stringify(out[k]), `${f.name} ${k}`).toBe(JSON.stringify(original[k]));
      const was = new Map((original.sections as Rec[]).map((s) => [s.id, s]));
      for (const s of out.sections as Rec[]) {
        const w = was.get(s.id)!;
        for (const k of Object.keys(w)) if (!PLAN.includes(k)) expect(JSON.stringify(s[k]), `${f.name} ${String(s.id)}.${k}`).toBe(JSON.stringify(w[k]));
      }
      // a reload keeps it, byte for byte
      expect(JSON.stringify(exportBook(reload(y)))).toBe(JSON.stringify(out));
      // 1.0 reading the exported book (applyBookDoc's olNormalize, serializeBook's olBookPack / olSectionFields)
      const st = stateFromBook(c, JSON.parse(JSON.stringify(out)));
      st.outline = c.api.olNormalize(out.outline, st.sections);
      c.setState(st);
      expect(JSON.stringify(c.api.olBookPack())).toBe(JSON.stringify(out.outline));
      for (const s of out.sections as Rec[]) {
        const plan1 = c.api.olSectionFields(s);
        const stored: Rec = {};
        for (const k of PLAN) if (k in s) stored[k] = s[k];
        expect(JSON.stringify(stored)).toBe(JSON.stringify(plan1));
      }
      // what was set
      const sa = (out.sections as Rec[]).find((s) => s.id === p.a)!, sb = (out.sections as Rec[]).find((s) => s.id === p.b)!, sd = (out.sections as Rec[]).find((s) => s.id === p.d)!;
      expect(sa).toMatchObject({ status: 'draft', synopsis: 'The muster at dawn.', tags: ['Subplot'], custom: { [p.ft.id]: 'Rain', [p.fc.id]: true } });
      expect(sb).toMatchObject({ status: 'final', pov: 'Athos', tags: ['Subplot', 'Night'], custom: { [p.fl.id]: 'stormy', [p.fd.id]: '1625-04-01' } });
      expect(sd.threads).toEqual({ [p.th.id]: 'It is sealed.' });
      expect(sd.custom).toBeUndefined();
      const o = out.outline as Rec;
      expect((o.tags as Rec[]).find((x) => x.name === 'Night')!.colour).toBe(5);
      expect((o.fields as Rec[]).find((x) => x.id === p.fl.id)!.options).toEqual(['calm', 'stormy', 'grim']);
      expect((o.filters as Rec[])[0]).toMatchObject({ name: 'Drafts with subplot', status: ['draft'], tags: ['Subplot'] });
      expect(p.saved.ui.savedId).toBe((o.filters as Rec[])[0]!.id);
      // not book text: every section's word count is what it was (outline.synopsis.notexported, the count half)
      const before = stateFromBook(c, JSON.parse(JSON.stringify(original)));
      const wordsBefore = before.sections.map((s) => c.api.sectionWords(s));
      const after = stateFromBook(c, JSON.parse(JSON.stringify(out)));
      expect(after.sections.map((s) => c.api.sectionWords(s))).toEqual(wordsBefore);
    }
  }, 600_000);

  it('a book without them keeps no outline, threads, fields or custom key; taking every one away returns to that shape', () => {
    const f = books.find((x) => x.name === 'real/bookbinders-letter')!;
    const y = open(f.book);
    const origText = JSON.stringify(exportBook(y));
    // reading the board writes nothing (review focus #4, model half): every view, every filter
    for (const view of ['cards', 'list', 'grid'] as const)
      for (const status of [[], ['none'], ['draft', 'final']])
        for (const matter of [false, true]) boardView(c, boardState(c, y), { ...UI, view, status, matter }, t);
    expect(JSON.stringify(exportBook(y))).toBe(origText);
    const id = String(secs(y).find((s) => s.kind === 'body')!.id);
    boardEdit(c, y, UI, (st) => c.api.olAddTag(secIn(st, id), 'x'));
    const th = boardEdit(c, y, UI, () => c.api.olAddThread('T')).value!;
    const fd = boardEdit(c, y, UI, () => c.api.olAddField('F', 'text')).value!;
    expect(exportBook(y).outline).toBeTruthy();
    boardEdit(c, y, UI, () => c.api.olDeleteTag('x'));
    boardEdit(c, y, UI, () => c.api.olDeleteThread(th.id));
    boardEdit(c, y, UI, () => c.api.olDeleteField(fd.id));
    expect(JSON.stringify(exportBook(y))).toBe(origText);
  });

  it('values outside the fixed set are dropped on reading, as 1.0 drops them (applyBookDoc olNormalize)', () => {
    const book = c.api.buildEmptyBook() as unknown as Rec & { sections: Rec[] };
    const ch = book.sections.find((s) => s.kind === 'body')!;
    Object.assign(ch, { status: 'bogus', tags: ['ok', '', 'OK'], threads: { 'no thread': 'x', t1: 'kept' }, custom: { f1: 'nope', gone: 'x' } });
    book.outline = { tags: [{ name: 'ok', colour: 99 }], threads: [{ id: 't1', name: 'One' }], fields: [{ id: 'f1', name: 'D', type: 'date' }] };
    const y = open(book);
    const st = boardState(c, y);
    const s = st.sections.find((x) => x.id === ch.id)!;
    expect(s.status).toBeUndefined();
    expect(s.tags).toEqual(['ok']);
    expect(s.threads).toEqual({ t1: 'kept' });
    expect(s.custom).toBeUndefined();
    c.setState(st);
    expect(c.api.olBook().tags).toEqual([{ name: 'ok', colour: 0 }]);
  });
});

describe("1.0's outline self-checks, re-expressed (data halves)", () => {
  it('outline.filter.saved: status chips any, tag chips every (AND), the count of hidden; a saved filter rides the book and gives the same items; List filters the same', () => {
    const f = books.find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = open(f.book);
    const ids = secs(y).filter((s) => s.kind === 'body' && s.type !== 'part').map((s) => String(s.id));
    const [a, b, d] = ids as [string, string, string];
    boardEdit(c, y, UI, (st) => c.api.olSetField(secIn(st, a), 'status', 'draft'));
    boardEdit(c, y, UI, (st) => c.api.olSetField(secIn(st, b), 'status', 'final'));
    boardEdit(c, y, UI, (st) => c.api.olAddTag(secIn(st, a), 'p'));
    boardEdit(c, y, UI, (st) => c.api.olAddTag(secIn(st, a), 'q'));
    boardEdit(c, y, UI, (st) => c.api.olAddTag(secIn(st, d), 'p'));
    const shown = (ui: BoardUi) => {
      const v = boardView(c, boardState(c, y), ui, t);
      return { ids: v.groups.flatMap((g) => g.items.filter((x) => !x.isPart).map((x) => x.id)), hidden: v.hidden, total: v.countable };
    };
    const any = shown({ ...UI, status: ['draft', 'final'] });
    expect(any.ids).toEqual([a, b]);
    expect(any.hidden).toBe(any.total - 2);
    expect(shown({ ...UI, tags: ['p'] }).ids).toEqual([a, d]);
    expect(shown({ ...UI, tags: ['p', 'q'] }).ids).toEqual([a]);
    expect(shown({ ...UI, view: 'list', tags: ['p', 'q'] }).ids).toEqual([a]);
    const sv = boardEdit(c, y, { ...UI, tags: ['p', 'q'] }, () => c.api.olSaveFilter('PQ'));
    const y2 = reload(y);
    const st = boardState(c, y2);
    c.setState(st);
    const fl = c.api.olBook().filters.find((x) => x.name === 'PQ')!;
    expect(fl.id).toBe(sv.ui.savedId);
    Object.assign(c.api.olUi, { status: [], tags: [], savedId: null });
    c.api.olApplySaved(fl.id);
    const v = boardView(c, st, { ...UI, status: c.api.olUi.status, tags: c.api.olUi.tags, savedId: c.api.olUi.savedId }, t);
    expect(v.groups.flatMap((g) => g.items.filter((x) => !x.isPart).map((x) => x.id))).toEqual([a]);
    expect(v.savedOn[fl.id]).toBe(true);
  });

  it('outline.cards.reorder: a move is 1.0\'s chopRun — the order moves, every text untouched, numbers in sequence, a "Before moving" snapshot, Undo puts it back; across tiers refused', () => {
    const book = c.api.buildEmptyBook() as unknown as Rec & { sections: Rec[] };
    const mk = c.api.mkSection;
    const chs = ['One', 'Two', 'Three'].map((n, i) => mk('body', 'chapter', n, { number: String(i + 1), content: n + ' words.' }));
    book.sections = book.sections.filter((s) => s.kind === 'front').concat(chs, book.sections.filter((s) => s.kind === 'back'));
    const y = open(book);
    const before = JSON.stringify((({ history, historyPool, ...r }) => r)(exportBook(y)));
    const env = { c, ydoc: y, t: t as never, activeId: null };
    const r = chopMove(env, chs[2]!.id, chs[0]!.id, false);
    expect(r && typeof r === 'object').toBe(true);
    const body = secs(y).filter((s) => s.type === 'chapter');
    expect(body.map((s) => s.title)).toEqual(['Three', 'One', 'Two']);
    expect(body.map((s) => s.number)).toEqual(['1', '2', '3']);
    expect(body.map((s) => s.content)).toEqual(['Three words.', 'One words.', 'Two words.']);
    const hist = exportBook(y).history as Rec[];
    expect((hist[0]!.chop as Rec).op).toBe('move');
    if (r && typeof r === 'object') {
      const u = chopUndo(env, r.rec, () => true);
      expect(u.ok).toBe(true);
    }
    expect(JSON.stringify((({ history, historyPool, ...r2 }) => r2)(exportBook(y)))).toBe(before);
    const ack = secs(y).find((s) => s.kind === 'back')!;
    expect(chopMove(env, chs[0]!.id, String(ack.id), false)).toBe('tier');
    expect(JSON.stringify((({ history, historyPool, ...r2 }) => r2)(exportBook(y)))).toBe(before);
  });

  it('outline.grid.threads and outline.fields: a thread renamed keeps its notes, deleting takes them and Undo brings them back; a list keeps a choice taken off it; a date must be YYYY-MM-DD', () => {
    const f = books.find((x) => x.name === 'real/salt-road-book-one')!;
    const y = open(f.book);
    const id = String(secs(y).find((s) => s.kind === 'body')!.id);
    const th = boardEdit(c, y, UI, () => c.api.olAddThread('Debt')).value!;
    boardEdit(c, y, UI, (st) => c.api.olSetThreadNote(secIn(st, id), th.id, 'owed'));
    boardEdit(c, y, UI, () => c.api.olRenameThread(th.id, 'Debts'));
    expect(secs(y).find((s) => s.id === id)!.threads).toEqual({ [th.id]: 'owed' });
    let undo: (() => void) | null = null;
    boardEdit(c, y, UI, () => c.api.olDeleteThread(th.id), (_m, _i, act) => {
      undo = act ? act.onClick : null;
    });
    expect(secs(y).find((s) => s.id === id)!.threads).toBeUndefined();
    expect(undo).not.toBeNull();
    boardEdit(c, y, UI, () => undo!());
    expect(secs(y).find((s) => s.id === id)!.threads).toEqual({ [th.id]: 'owed' });
    const fl = boardEdit(c, y, UI, () => c.api.olAddField('Mood', 'list')).value!;
    boardEdit(c, y, UI, () => c.api.olSetFieldOptions(fl.id, 'a, b'));
    boardEdit(c, y, UI, (st) => c.api.olSetCustom(secIn(st, id), fl.id, 'b'));
    boardEdit(c, y, UI, () => c.api.olSetFieldOptions(fl.id, 'a'));
    expect((secs(y).find((s) => s.id === id)!.custom as Rec)[fl.id]).toBe('b');
    const fd = boardEdit(c, y, UI, () => c.api.olAddField('When', 'date')).value!;
    boardEdit(c, y, UI, (st) => c.api.olSetCustom(secIn(st, id), fd.id, '2026-1-1'));
    expect((secs(y).find((s) => s.id === id)!.custom as Rec)[fd.id]).toBeUndefined();
    // Grid rows: the story's sections, a section with no words yet among them
    const v = boardView(c, boardState(c, y), { ...UI, view: 'grid' }, t);
    expect(v.grid!.rows.length).toBeGreaterThan(0);
    expect(v.grid!.threads.map((x) => x.name)).toEqual(['Debts']);
  });

  it('outline.grid.fills-from-text: every square equals the Covenant\'s own count for that name in that section; the totals sum the columns', () => {
    for (const name of ['real/lantern-coast-book-one', 'real/oz-14-glinda']) {
      const f = books.find((x) => x.name === name)!;
      const y = open(f.book);
      const st = boardState(c, y);
      const v = boardView(c, st, { ...UI, view: 'grid' }, t);
      c.setState(st);
      const men = c.api.bibleMentionsCompute(st.sections, c.api.bibleAllEntries(), c.api.bookLang());
      const ci = new Map(men.cols.map((col, i) => [col.id, i]));
      expect(v.grid!.entries.length).toBe(c.api.bibleAllEntries().length);
      v.grid!.rows.forEach(({ item, cells }) => {
        v.grid!.entries.forEach((e, k) => {
          const i = ci.get(item.id);
          expect(cells[k]!.n).toBe(i == null ? 0 : men.per[e.id]!.counts[i] ?? 0);
        });
      });
      v.grid!.entries.forEach((e, k) => expect(v.grid!.totals.entries[k]).toBe(men.per[e.id]!.total));
      // opening the grid leaves the book file byte-identical
      expect(JSON.stringify(exportBook(y))).toBe(JSON.stringify(exportBook(open(f.book))));
    }
  });
});
