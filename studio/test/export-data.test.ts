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
import { exportBody, exportReset, exportRun, exportState, loadSerialize } from '../src/export/state';
import { styleRelease } from '../src/style/session';
import { DUMAS, fixtures } from './fixtures';

/* Wave 5a, task 1 — constraint 54 (review focus #3): the no-edit gate. Running the export's code on a book — the
   presets, the package of every preset, Markdown, standalone HTML, the validator, the audit — writes nothing; the
   preset chosen writes exactly 1.0's state.exportPlatform (serializeBook's `exportPlatform`), in its place among the
   book's keys, and choosing the first one again gives the book back exactly. Constraint 51: the request body's shape
   is 1.0's buildEpub's ({ book, platform, lang }, the book less what it leaves home). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  await loadSerialize();
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

describe('wave 5a: the export reads the book and writes nothing but the preset (constraint 54)', () => {
  it('on every fixture: the presets, every package, Markdown, HTML, the validator and the audit write nothing', () => {
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const y = onDesk(structuredClone(f.book));
      const before = Y.encodeStateVector(y);
      const presets = f.name === DUMAS || /valois|oz-14/.test(f.name) ? ['generic', 'kdp', 'apple'] : c.api.PLATFORM_PRESETS.map((p) => p.id);
      exportRun((cc) => {
        cc.api.platformPreset();
        cc.api.platformFilename();
        cc.api.epubPlan();
        for (const id of presets) {
          const files = cc.api.epubFiles(id);
          cc.api.validateEpubPackage(files);
          cc.api.auditAccessibility(files);
          cc.api.epubManifestPropertyReport(files);
        }
        cc.api.buildMarkdown();
        cc.api.buildStandaloneHtml();
      });
      expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(before)), f.name).toBe(true);
      const out = exportBook(y);
      expect(out, f.name).toEqual(want(f.book, out));
      y.destroy();
    }
  }, 240_000);

  it("a preset chosen writes 1.0's exportPlatform alone, in its place; the first again gives the book back exactly", () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = onDesk(structuredClone(f.book));
    const orig = exportBook(y) as Rec;
    expect(orig.exportPlatform).toBe('generic');
    exportRun((cc) => {
      (cc.getState() as Rec).exportPlatform = 'kdp'; // 1.0's renderPlatformPresets click
    });
    const after = exportBook(y) as Rec;
    expect(after.exportPlatform).toBe('kdp');
    expect(Object.keys(after)).toEqual(Object.keys(orig));
    expect({ ...after, exportPlatform: 'generic' }).toEqual(orig);
    // the state follows (the next call reads kdp)
    expect(exportRun((cc) => (cc.getState() as Rec).exportPlatform)).toBe('kdp');
    exportRun((cc) => {
      (cc.getState() as Rec).exportPlatform = 'generic';
    });
    expect(JSON.stringify(exportBook(y))).toBe(JSON.stringify(orig));
    // a call that changes nothing writes nothing
    const sv = Y.encodeStateVector(y);
    exportRun((cc) => cc.api.epubFiles());
    expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(sv))).toBe(true);
    y.destroy();
  });

  it('another session displacing the closure\'s state inside an open call keeps the preset it chose (no rebuild)', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = onDesk(structuredClone(f.book));
    exportRun((cc) => {
      const mine = cc.getState() as Rec;
      mine.exportPlatform = 'kdp';
      cc.setState(structuredClone(mine) as never); // the preview / the Style session sets its own state
      expect(exportRun((c2) => (c2.getState() as Rec).exportPlatform)).toBe('kdp'); // a nested call reads ours
    });
    expect((exportBook(y) as Rec).exportPlatform).toBe('kdp');
    y.destroy();
  });

  it("the request body is 1.0's buildEpub's: { book, platform, lang }, the book 1.0's serializeBook less what it leaves home", async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = onDesk(structuredClone(f.book));
    exportRun((cc) => {
      (cc.getState() as Rec).exportPlatform = 'apple';
    });
    const body = JSON.parse((await exportBody('fr'))!) as Rec & { book: Rec };
    expect(Object.keys(body)).toEqual(['book', 'platform', 'lang']);
    expect(body.platform).toBe('apple');
    expect(body.lang).toBe('fr');
    expect(Object.keys(body.book)[0]).toBe('formatVersion');
    for (const k of ['history', 'historyPool', 'notebook', 'research', 'audio', 'importReport']) expect(k in body.book, k).toBe(false);
    // serializeBook's keys, in its order (client/index.html serializeBook)
    expect(Object.keys(body.book)).toEqual(['formatVersion', 'meta', 'theme', 'activePreset', 'sections', 'cover', 'coverRecipe', 'images', 'fonts', 'customThemes', 'activeId',
      'exportPlatform', 'printTrim', 'printRecto', 'printLargePrint', 'printPictureBook', 'printBleed', 'printMarginMode', 'printCustomMargins', 'printHeadContent', 'printHeadPlace',
      'printOmitChapterHead', 'printOmitBlankHead', 'printFolio', 'printNotes', 'storeCheck', 'goals', ...Object.keys(body.book).slice(27)]);
    expect(readBook(body.book).status).toBe('ok');
    expect(exportState()).not.toBeNull();
    y.destroy();
  });
});
