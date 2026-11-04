import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, writeEnv, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { exportReset, loadSerialize } from '../src/export/state';
import { importPending, importRun, importUi, importWire } from '../src/import/import';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';
import { maskVarying, textCorpus, type CorpusFile } from './import-fixture';
import { createImportOracle } from './import-oracle';

/* Wave 6, task 1 — constraints 77, 78 (vitest half; the e2e runs the same corpus beside 1.0's page, with DOCX, EPUB and
   PDF): THE IMPORT IS 1.0's. Each Markdown, text and RTF file of the corpus, imported through 2.0's Import path (1.0's own
   handleImportFile, readImportFile, importConfirmReplace and replaceBodyChapters in the import session, the book written
   whole), gives the book 1.0's own code gives — the ORACLE: 1.0's real applyBookDoc, serializeBook, autoSnapshot and
   import, lifted by the same extractor and run in Node with only its redraws stubbed (test/import-oracle.ts). Both onto an
   empty desk and onto a written book (Lantern Coast), whose History then holds the import's snapshot.
   Compared: 1.0's serializeBook of each (the book 2.0 hands the backup-open path is 1.0's serializeBook output), and
   2.0's stored book (exportBook of the new generation) with readBook of 1.0's. Masked: only what 1.0 itself varies
   between two imports of the same file (import-fixture.ts maskVarying) — shown varying in the oracle itself. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  await loadSerialize();
  setClosureT(t);
  setClosureLang('en');
  await importWire();
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
});
const fileOf = (f: CorpusFile) => new File([f.text], f.name, { type: f.type });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 2.0: the open book `book` on the desk, the file through 1.0's handleImportFile (the confirm answered `answer`). */
async function import20(book: Rec, file: File, answer = true): Promise<{ handed: Rec | null; stored: Rec | null; asked: number; before: Rec; ydoc: Y.Doc }> {
  const y = new Y.Doc();
  importBook(structuredClone(book), y);
  desk.ydoc = y;
  exportReset();
  const before = exportBook(y) as Rec;
  let handed: Rec | null = null, stored: Rec | null = null, asked = 0;
  importUi.replace = async (doc) => {
    handed = structuredClone(doc);
    const y2 = new Y.Doc();
    importBook(structuredClone(doc), y2);
    stored = exportBook(y2) as Rec;
    return y2;
  };
  writeEnv.confirm = async () => {
    asked++;
    return answer;
  };
  await c.api.handleImportFile(file);
  for (let i = 0; i < 5; i++) await tick();
  await importPending();
  return { handed, stored, asked, before, ydoc: y };
}
/** 1.0 (the oracle): the same book arrived on its desk, the same file read and run. */
async function import10(book: Rec, file: File): Promise<Rec> {
  const o = await createImportOracle(t);
  o.api.applyBookDoc(structuredClone(book) as never);
  const run = (await o.api.readImportFile(file as never)) as () => void;
  run();
  return JSON.parse(JSON.stringify(o.api.serializeBook()));
}

const LANTERN = () => fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!.book;

describe("wave 6: Markdown, text and RTF imports are 1.0's (constraints 77, 78)", () => {
  it('1.0 itself varies only the masked fields: two imports of the same file differ raw, equal masked', async () => {
    const f = textCorpus().find((x) => x.name === 'plain-manuscript.txt')!;
    const a = await import10(LANTERN(), fileOf(f)), b = await import10(LANTERN(), fileOf(f));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(maskVarying(a)).toEqual(maskVarying(b));
    // what varied: the new book's id, the sections' ids, the snapshot's id and time, the report's id and time
    const ra = a.importReport as Rec, rb = b.importReport as Rec;
    expect([(a.meta as Rec).bookId !== (b.meta as Rec).bookId, ra.id !== rb.id, ra.at !== rb.at, (a.history as Rec[])[0]!.id !== (b.history as Rec[])[0]!.id]).toEqual([true, true, true, true]);
  });

  for (const desk0 of ['empty', 'lantern'] as const) {
    it(`every corpus file onto ${desk0 === 'empty' ? 'an empty desk' : 'a written book (Lantern Coast)'}: 2.0's book is 1.0's`, async () => {
      const deskBook = desk0 === 'empty' ? (c.api.buildEmptyBook() as Rec) : LANTERN();
      const corpus = textCorpus();
      expect(corpus.length).toBeGreaterThanOrEqual(14 + 2 + 3);
      for (const f of corpus) {
        const one = await import10(deskBook, fileOf(f));
        const two = await import20(deskBook, fileOf(f));
        expect(two.handed, f.name + ': a whole book was written').not.toBeNull();
        expect(maskVarying(two.handed), f.name + ": the book handed over is 1.0's serializeBook").toEqual(maskVarying(one));
        expect(maskVarying(two.stored), f.name + ': the stored book').toEqual(maskVarying(JSON.parse(JSON.stringify(readBook(one).book))));
        // the confirm appears exactly when 1.0's does (an empty desk: never; a written book: once)
        expect(two.asked, f.name + ' confirm').toBe(desk0 === 'empty' ? 0 : 1);
        const rep = (two.stored as Rec).importReport as Rec;
        expect(rep && rep.v, f.name + ' report').toBe(1);
        if (desk0 === 'lantern') {
          // History holds the "import" snapshot first, and it is the old book (less what a snapshot never carries)
          const h = ((two.stored as Rec).history as Rec[])[0]!;
          expect(h.auto, f.name).toBe('import');
          expect((rep.undo as Rec).snapId).toBe(h.id);
        } else expect((rep.undo as Rec).snapId, f.name).toBeNull();
        two.ydoc.destroy();
      }
    }, 600_000);
  }

  it('cancelling the confirm leaves the book exactly as it was (nothing written)', async () => {
    const f = textCorpus().find((x) => x.name === 'headings.rtf')!;
    const r = await import20(LANTERN(), fileOf(f), false);
    expect(r.asked).toBe(1);
    expect(r.handed).toBeNull();
    expect(exportBook(r.ydoc)).toEqual(r.before);
  });

  it("the refusals are 1.0's words (an empty file, binary as .txt, broken RTF, broken .docx); the desk is untouched", async () => {
    const toasts: string[] = [];
    const { structEnv } = await import('../src/closure/index');
    const keep = structEnv.toast;
    structEnv.toast = (m) => void toasts.push(m);
    const junk = new Uint8Array(600);
    for (let i = 0; i < junk.length; i++) junk[i] = i % 3 === 0 ? 0xff : i % 3 === 1 ? 0x01 : 0x41;
    const cases: [string, () => File][] = [
      ['empty.md', () => new File(['  \n\t '], 'empty.md')],
      ['binary.txt', () => new File([junk], 'binary.txt')],
      ['broken.rtf', () => new File(['this is no rtf at all'], 'broken.rtf')],
    ];
    try {
      for (const [name, make] of cases) {
        // 1.0's own answer (the oracle reads the same bytes)
        const o = await createImportOracle(t);
        let want = '';
        try {
          await o.api.readImportFile(make() as never);
        } catch (e) {
          want = (e as { userMessage?: string }).userMessage || '';
        }
        expect(want, name + ': 1.0 refuses it').not.toBe('');
        toasts.length = 0;
        const r = await import20(LANTERN(), make());
        expect(r.handed, name).toBeNull();
        expect(toasts, name).toEqual([want]);
        expect(exportBook(r.ydoc), name).toEqual(r.before);
      }
    } finally {
      structEnv.toast = keep;
    }
  });
});

describe('wave 6: the import report rides with the book (constraint 79)', () => {
  it("importReport survives importBook → exportBook, and 1.0 reads it back (normalizeImportReport)", async () => {
    const f = textCorpus().find((x) => x.name === 'plain-manuscript.txt')!;
    const r = await import20(LANTERN(), fileOf(f));
    const rep = (r.handed as Rec).importReport as Rec;
    expect(rep && Array.isArray(rep.items) && rep.items.length).toBeTruthy();
    expect((r.stored as Rec).importReport).toEqual(rep);
    const y = new Y.Doc();
    importBook(structuredClone(r.stored), y);
    expect((exportBook(y) as Rec).importReport).toEqual(rep);
    expect(c.api.normalizeImportReport(structuredClone((exportBook(y) as Rec).importReport))).toEqual(rep);
    const o = await createImportOracle(t);
    o.api.applyBookDoc(structuredClone(exportBook(y)) as never);
    expect(o.getState().importReport).toEqual(rep);
  });
});

describe("review of wave 6 (Critical 1): Undo the whole import of the untouched sample before the sample's chunk is here", () => {
  it('refuses rather than clearing the report while the book keeps the import; the chunk is fetched as soon as such a report is read', async () => {
    const report = { v: 1, id: 'r1', file: 'x.md', format: 'md', at: new Date(0).toISOString(), dismissed: false, kept: false, checked: [], scanOk: false, carried: null,
      undo: { snapId: null, preDoc: null, sample: true }, items: [] };
    const doc = { ...(c.api.buildEmptyBook() as Rec), importReport: report };
    const y = new Y.Doc();
    importBook(structuredClone(doc), y);
    desk.ydoc = y;
    const keep = c.sample;
    c.sample = null; // the page was reloaded: the sample's own chunk is not loaded
    const loads: number[] = [];
    const { loadSampleHook } = await import('../src/import/import');
    loadSampleHook.fn = () => void loads.push(1);
    try {
      expect(() => importRun((cc) => cc.api.irUndoAll())).toThrow();
      expect((exportBook(y) as Rec).importReport).toEqual(report);
      expect(loads.length).toBeGreaterThan(0);
    } finally {
      c.sample = keep;
      loadSampleHook.fn = null;
      y.destroy();
    }
  });
});
