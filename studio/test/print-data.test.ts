import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { PRINT_KEYS, arriveForExport, arrivePrint, exportReset, exportRun, exportState, loadSerialize, printSerialized } from '../src/export/state';
import { loadPrint, printRun, type PrintClosure } from '../src/print/print';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';

/* Wave 5b, task 1 — constraint 58 (review focus #2): PRINT SETTINGS ARE 1.0's DATA. Every state.print* key is what
   1.0's applyBookDoc makes of the stored value (arrivePrint: its defaults, its clamps — a custom margin 0–3 in — and
   its exclusion: picture book never beside large print), and is written back where serializeBook writes it, in its
   shape. A setting changed and put back is the book as it was (constraint 60): a key the book never stored stays
   absent. The export round trip stays exact for every fixture. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let ser: (c: Closure) => Rec;
let pc: PrintClosure;
beforeAll(async () => {
  c = await loadClosure();
  ser = await loadSerialize();
  pc = await loadPrint();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  exportReset();
  return y;
};
const want = (doc: Rec, out?: Rec) => {
  const r = readBook(doc);
  const w = JSON.parse(JSON.stringify(r.book)) as Rec & { meta: Rec };
  if (out && r.upgrades.includes('bookid-missing')) w.meta.bookId = (out.meta as Rec).bookId;
  return w;
};
/** One of 1.0's print listeners' effects, on print's state, in the export session (as a click runs it). */
const set = (fn: (st: Rec) => void) => printRun((p) => fn(p.getState() as Rec));
const withSections = () => fixtures('all').filter((f) => Array.isArray(f.book.sections));

describe("wave 5b: the print settings are 1.0's data (constraint 58)", () => {
  it("on every fixture: print's state is the export's, and its print keys are serializeBook's, in its order", () => {
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      exportRun(() => undefined);
      expect(pc.getState(), f.name).toBe(exportState());
      const st = exportState() as unknown as Rec;
      const one = exportRun((cc) => ser(cc))!;
      const mine = printSerialized(st);
      for (const k of PRINT_KEYS) expect(mine[k], `${f.name} ${k}`).toEqual(one[k]);
      expect(Object.keys(one).filter((k) => (PRINT_KEYS as readonly string[]).includes(k))).toEqual([...PRINT_KEYS]);
      y.destroy();
    }
  }, 240_000);

  it("applyBookDoc's clamps and exclusion: a custom margin outside 0–3 in, picture book beside large print, notes not page/end", () => {
    const s = arrivePrint(c, { printCustomMargins: { inside: 5, outside: 'x', top: -1, bottom: 1.2 }, printLargePrint: true, printPictureBook: true, printNotes: 'side', printFolio: 'top', printHeadContent: 'x', printTrim: '5x8' }, {});
    expect(s.printCustomMargins).toEqual({ inside: 0.625, outside: 0.5, top: 0.6, bottom: 1.2 });
    expect([s.printLargePrint, s.printPictureBook]).toEqual([true, false]);
    expect(s.printNotes).toBe('end');
    expect(s.printFolio).toBe('centre');
    expect(s.printHeadContent).toBe('titleauthor');
    expect(s.printTrim).toBe('5x8');
  });

  it('a setting changed is written as serializeBook writes it, in its place; 1.0 reads it back', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = onDesk(structuredClone(f.book));
    const orig = exportBook(y) as Rec;
    set((st) => {
      st.printTrim = '5x8';
      st.printCustomMargins = Object.assign({}, st.printCustomMargins, { inside: 0.875 });
      st.printMarginMode = 'custom';
    });
    const out = exportBook(y) as Rec;
    expect(out.printTrim).toBe('5x8');
    expect(out.printMarginMode).toBe('custom');
    expect(out.printCustomMargins).toEqual({ inside: 0.875, outside: 0.5, top: 0.6, bottom: 0.75 });
    expect(Object.keys(out)).toEqual(Object.keys(orig)); // in place: no key moved, none added
    // and 1.0 reads it back (applyBookDoc's print lines on the book 2.0 wrote)
    const back = arriveForExport(c, out);
    expect([back.printTrim, back.printMarginMode, (back.printCustomMargins as Rec).inside]).toEqual(['5x8', 'custom', 0.875]);
    y.destroy();
  });

  it('on every fixture: each print setting changed and put back gives the book back exactly (a key never stored stays absent)', () => {
    const flips: [string, (st: Rec) => void][] = [
      ['printTrim', (st) => (st.printTrim = st.printTrim === '5x8' ? '6x9' : '5x8')],
      ['printRecto', (st) => (st.printRecto = !st.printRecto)],
      ['printLargePrint', (st) => ((st.printLargePrint = !st.printLargePrint), st.printLargePrint && (st.printPictureBook = false))],
      ['printPictureBook', (st) => ((st.printPictureBook = !(st.printPictureBook && !st.printLargePrint)), st.printPictureBook && (st.printLargePrint = false))],
      ['printBleed', (st) => (st.printBleed = !st.printBleed)],
      ['printMarginMode', (st) => (st.printMarginMode = st.printMarginMode === 'custom' ? 'auto' : 'custom')],
      ['printCustomMargins', (st) => ((st.printCustomMargins as Rec).top = 1)],
      ['printHeadContent', (st) => (st.printHeadContent = st.printHeadContent === 'none' ? 'title' : 'none')],
      ['printHeadPlace', (st) => (st.printHeadPlace = st.printHeadPlace === 'top' ? 'bottom' : 'top')],
      ['printOmitChapterHead', (st) => (st.printOmitChapterHead = !st.printOmitChapterHead)],
      ['printOmitBlankHead', (st) => (st.printOmitBlankHead = !st.printOmitBlankHead)],
      ['printFolio', (st) => (st.printFolio = st.printFolio === 'none' ? 'outer' : 'none')],
      ['printNotes', (st) => (st.printNotes = st.printNotes === 'end' ? 'page' : 'end')],
    ];
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      const expected = want(f.book, exportBook(y) as Rec);
      for (const [k, flip] of flips) {
        let before: Rec | null = null;
        set((st) => {
          before = printSerialized(st);
          flip(st);
        });
        const changed = exportBook(y) as Rec;
        expect(changed[k], `${f.name} ${k} changed`).not.toEqual(f.book[k] === undefined ? undefined : before![k]);
        set((st) => {
          const b = before!;
          for (const kk of PRINT_KEYS) st[kk] = structuredClone(b[kk]);
        });
        const back = exportBook(y) as Rec;
        expect(back, `${f.name} ${k} put back`).toEqual(expected);
        expect(Object.keys(back), `${f.name} ${k} key order`).toEqual(Object.keys(expected));
      }
      y.destroy();
    }
  }, 240_000);

  it('a book without a print key (readBook fills them in; the Y.Doc made without one): recto off writes printRecto:false; on again, the key is gone', () => {
    const f = fixtures('legacy').find((x) => x.name === 'legacy/print-defaults')!;
    const y = onDesk(structuredClone(f.book));
    y.getMap('meta').delete('printRecto');
    exportReset();
    const orig = exportBook(y) as Rec;
    expect('printRecto' in orig).toBe(false);
    set((st) => (st.printRecto = !st.printRecto));
    expect((exportBook(y) as Rec).printRecto).toBe(false);
    set((st) => (st.printRecto = !st.printRecto));
    expect(exportBook(y)).toEqual(orig);
    y.destroy();
  });
});
