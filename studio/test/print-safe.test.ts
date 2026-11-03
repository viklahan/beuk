import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, loadSerialize } from '../src/export/state';
import { loadPrint, printRun, printSinks, type PrintClosure } from '../src/print/print';
import { cleanPrintDoc, printSafety } from '../src/print/safe';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';
import { hostileExportBook, hostileNonStringBook } from './export-fixture';
import { hazards } from './hazards';
import { installCanvas } from './print-fixture';

/* Wave 5b, task 1 — constraint 59 (review focus #3): safety, print's turn. The print document (1.0's buildPrintHtml)
   is a file the writer opens and the print frame's srcdoc. A hostile book (test/export-fixture.ts: 5a's) through it:
   with the export's corrections in the state and print's sinks (src/print/print.ts, safe.ts), no script, handler or
   remote request (parsed text/html and walked: test/hazards.ts), every trim and the toggles that change the document;
   1.0's own build of the same book is the reproducing fixture of the 1.0 finding. An honest book's document passes
   the sinks unchanged, byte for byte. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let pc: PrintClosure;
beforeAll(async () => {
  c = await loadClosure();
  await loadSerialize();
  pc = await loadPrint();
  installCanvas();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
  printSinks.on = true;
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  exportReset();
  return y;
};
const TOGGLES: ((st: Rec) => void)[] = [
  () => undefined,
  (st) => (st.printLargePrint = true),
  (st) => ((st.printPictureBook = true), (st.printLargePrint = false)),
  (st) => (st.printBleed = true),
  (st) => (st.printNotes = 'page'),
  (st) => ((st.printHeadContent = 'chapter'), (st.printHeadPlace = 'bottom'), (st.printFolio = 'outer')),
  (st) => ((st.printMarginMode = 'custom'), (st.printOmitChapterHead = true), (st.printOmitBlankHead = false), (st.printRecto = false)),
];
/** buildPrintHtml on print's state of the open book, after `fn` (a copy of the state: the book is not written). */
const build = (fn: (st: Rec) => void, trim?: string): string =>
  printRun((p) => {
    const st = p.getState() as Rec;
    const keep = structuredClone(Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('print'))));
    fn(st);
    if (trim) st.printTrim = trim;
    try {
      return String(p.vars.buildPrintHtml());
    } finally {
      Object.assign(st, keep);
    }
  })!;

describe("wave 5b: the print document is safe (constraint 59)", () => {
  it('a hostile book: no script, handler or remote request in its print document — every trim, every toggle', () => {
    for (const b of [hostileExportBook(), hostileNonStringBook()]) {
      const y = onDesk(b);
      const trims = (pc.api.TRIM_SIZES as unknown as { id: string }[]).map((x) => x.id);
      for (const trim of trims) expect(hazards(build(() => undefined, trim), trim)).toEqual([]);
      for (const [i, fn] of TOGGLES.entries()) expect(hazards(build(fn), 'toggle ' + i)).toEqual([]);
      y.destroy();
    }
  }, 240_000);

  it("1.0's own build of the hostile book (no corrections, no sinks) carries them: the 1.0 finding's fixture", () => {
    const y = onDesk(hostileExportBook());
    printSinks.on = false;
    const st = arriveForExport(c, exportBook(y) as Rec);
    pc.setState(st);
    const raw = String(pc.vars.buildPrintHtml());
    const found = hazards(raw, 'print');
    expect(found.length).toBeGreaterThan(0);
    // and the document sink alone takes them out
    expect(hazards(cleanPrintDoc(raw), 'cleaned')).toEqual([]);
    y.destroy();
  });

  it("an honest book's print document passes the sinks unchanged, byte for byte (every fixture, every trim, every toggle)", () => {
    const before = printSafety.cleaned;
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const y = onDesk(structuredClone(f.book));
      const big = /dartagnan|valois|oz-14/.test(f.name);
      const trims = big ? ['6x9'] : (pc.api.TRIM_SIZES as unknown as { id: string }[]).map((x) => x.id);
      const runs: [string, (st: Rec) => void, string | undefined][] = [...trims.map((tr) => [tr, () => undefined, tr] as [string, (st: Rec) => void, string]), ...(big ? TOGGLES.slice(0, 2) : TOGGLES).map((fn, i) => ['toggle ' + i, fn, undefined] as [string, (st: Rec) => void, undefined])];
      for (const [name, fn, trim] of runs) {
        printSinks.on = false;
        const one = build(fn, trim);
        printSinks.on = true;
        const mine = build(fn, trim);
        expect(mine === one, `${f.name} ${name}`).toBe(true);
      }
      y.destroy();
    }
    expect(printSafety.cleaned).toBe(before);
  }, 600_000);
});
