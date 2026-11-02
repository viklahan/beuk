import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook, shaOfData, PIC_REF } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleRelease, styleReset, styleRoot, styleRun } from '../src/style/session';
import { StyleFrame } from '../src/style/StyleTab';
import { applyMine, mineDocFromBook, saveToMine, bookThemesNotInMine } from '../src/style/themeActions';
import { mineDelete, mineGet, mineList, mineLoad, mineReset, mineSave, type Bytes, type MineDoc } from '../src/style/mine';
import { fixtures } from './fixtures';
import { PNG_1PX, styledBook, ttfData } from './style-fixture';

/* Per-user themes, task 2 (the book side, constraints 46 and 48): a book theme saved to My themes carries the fonts and
   flourishes it wears, resolved as 1.0 resolves them; applying a My theme to another book copies it in exactly as 1.0
   would hold it had the theme been made there (its fonts in `fonts`, its flourishes in the image library, the bytes
   packed once, an asset the book already holds reused); a hostile My theme passes the same safe path as a book's. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

class FakeFace {
  family: string;
  src: string;
  status = 'loaded';
  constructor(family: string, src: string) {
    this.family = family;
    this.src = src;
  }
  load() {
    return Promise.resolve(this);
  }
}
const faces = new Set<FakeFace>();
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  (globalThis as unknown as { FontFace: unknown }).FontFace = FakeFace;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { add: (f: FakeFace) => faces.add(f), delete: (f: FakeFace) => faces.delete(f), has: (f: FakeFace) => faces.has(f), [Symbol.iterator]: () => faces.values() },
  });
});
beforeEach(async () => {
  styleRelease();
  mineReset();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('beuk-mythemes');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  await mineLoad(); // signed out: this device
});
afterEach(() => {
  cleanup();
  styleRoot.el = null;
  desk.ydoc = null;
  mineReset();
});

const LANTERN = () => structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  return y;
};
const tab = () => {
  const { container } = render(<StyleFrame t={t as never} />);
  styleRoot.el = container;
  styleRun((cc) => {
    cc.vars.fontPickerSig = null;
    cc.api.initStudio();
    cc.api.syncStudioControls();
  });
  return container;
};
const exact = (y: Y.Doc) => JSON.parse(JSON.stringify(exportBook(y))) as Rec;

describe('save to My themes: the theme and what it wears', () => {
  it('a book theme carries its uploaded fonts and flourishes (by hash, bytes beside it); the book is not written', async () => {
    const book = styledBook();
    const y = onDesk(book);
    tab();
    const before = Y.encodeStateVector(y);
    const made = mineDocFromBook('ctHarbour')!;
    expect(made.doc.id).toBe('ctHarbour');
    expect(made.doc.name).toBe('Harbour Lights');
    const font = (book.fonts as Rec[])[0]!;
    const svg = (book.images as Rec[]).find((im) => im.id === 'flsvg1')!;
    const png = (book.images as Rec[]).find((im) => im.id === 'flpng1')!;
    expect(made.doc.assets).toEqual([
      { kind: 'font', sha256: shaOfData(font.data as string), mediaType: 'font/ttf', id: 'fntWriter', name: 'Writer-Hand.ttf', family: 'Writer Hand', ext: 'ttf' },
      { kind: 'flourish', sha256: shaOfData(svg.data as string), mediaType: 'image/svg+xml', id: 'flsvg1', name: 'Harbour star.svg', ext: 'svg', flourish: true },
      { kind: 'flourish', sha256: shaOfData(png.data as string), mediaType: 'image/png', id: 'flpng1', name: 'Dot.png', ext: 'png', flourish: true },
    ]);
    expect(made.bytes.get(shaOfData(font.data as string))?.data).toBe(font.data);
    // a theme wearing no upload carries nothing
    expect(mineDocFromBook('ctPlain')!.doc.assets).toEqual([]);
    expect(await saveToMine('ctHarbour')).toBe(true);
    expect(mineList().map((r) => [r.key, r.name])).toEqual([['ctHarbour', 'Harbour Lights']]);
    expect(Array.from(Y.encodeStateVector(y))).toEqual(Array.from(before));
    expect(bookThemesNotInMine().map((ct) => ct.id)).toEqual(['ctPlain']);
    y.destroy();
  });
});

describe('apply a My theme to another book (constraint 46: the book stays a 1.0 book)', () => {
  it('copies the theme, its font and its flourishes in 1.0\'s shapes, packs the bytes once, and wears it', async () => {
    const a = onDesk(styledBook());
    tab();
    expect(await saveToMine('ctHarbour')).toBe(true);
    cleanup();
    a.destroy();
    styleRelease();

    const b0 = LANTERN();
    const y = onDesk(b0);
    tab();
    expect(await applyMine('ctHarbour')).toBe(true);
    const out = exact(y);
    const src = styledBook();
    const font = (src.fonts as Rec[])[0]!;
    expect(out.fonts).toEqual([font]);
    const imgs = (out.images as Rec[]).filter((im) => im.flourish);
    expect(imgs).toEqual((src.images as Rec[]).filter((im) => im.flourish));
    const ct = (out.customThemes as Rec[]).find((x) => x.id === 'ctHarbour')!;
    const want = c.api.normalizeCustomTheme((src.customThemes as Rec[])[0]);
    expect(ct).toEqual(JSON.parse(JSON.stringify(want)));
    expect(out.theme).toEqual(ct.theme);
    expect(out.activePreset).toBe('custom:ctHarbour');
    // the book is a 1.0 book: readBook reads it as it is, nothing new, every other key as it was
    const r = readBook(out);
    expect(r.status).toBe('ok');
    expect(JSON.parse(JSON.stringify(r.book))).toEqual(out);
    for (const k of Object.keys(b0)) if (!['fonts', 'images', 'customThemes', 'theme', 'activePreset', 'history', 'historyPool'].includes(k)) expect(out[k], k).toEqual(b0[k]);
    expect(Object.keys(out).filter((k) => !(k in b0)).sort()).toEqual(['activePreset', 'customThemes', 'fonts', 'theme'].filter((k) => !(k in b0)).sort());
    // the bytes are packed once (blobs), never inline in meta
    const metaFonts = y.getMap('meta').get('fonts') as Rec[];
    expect(metaFonts[0]!.data).toBe(PIC_REF + shaOfData(font.data as string));
    expect(y.getMap('blobs').has(shaOfData(font.data as string))).toBe(true);
    // 1.0's CSS for the book wears the face
    const css = styleRun((cc) => cc.api.buildBookCss('.fc-page'))!;
    expect(css).toContain("'Writer Hand'");
    y.destroy();
  });

  it('dedupe: an asset the book already holds (same bytes) is reused, not duplicated; a flourish under another id is renamed in the theme', async () => {
    const a = onDesk(styledBook());
    tab();
    await saveToMine('ctHarbour');
    cleanup();
    a.destroy();
    styleRelease();

    const b = styledBook();
    // the same flourish bytes under other ids; the same font bytes under the same family
    (b.images as Rec[]).forEach((im) => {
      if (im.id === 'flsvg1') im.id = 'myStar';
      if (im.id === 'flpng1') im.id = 'myDot';
    });
    b.customThemes = [];
    b.theme = { ...(b.theme as Rec), ornament: 'fl:myStar', headingFlourish: 'myDot' };
    const y = onDesk(b);
    tab();
    const blobsBefore = Array.from(y.getMap('blobs').keys()).sort();
    expect(await applyMine('ctHarbour')).toBe(true);
    const out = exact(y);
    expect(out.fonts).toEqual(b.fonts);
    expect(out.images).toEqual(b.images);
    const ct = (out.customThemes as Rec[])[0]!;
    expect((ct.theme as Rec).ornament).toBe('fl:myStar');
    expect((ct.theme as Rec).headingFlourish).toBe('myDot');
    expect(Array.from(y.getMap('blobs').keys()).sort()).toEqual(blobsBefore);
    y.destroy();
  });

  it("a book face of the same family with other bytes takes the theme's bytes (1.0's own upload rule, handleFontFile)", async () => {
    const a = onDesk(styledBook());
    tab();
    await saveToMine('ctHarbour');
    cleanup();
    a.destroy();
    styleRelease();
    const b = LANTERN();
    b.fonts = [{ id: 'old1', name: 'old.ttf', family: 'Writer Hand', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 11) }];
    const y = onDesk(b);
    tab();
    await applyMine('ctHarbour');
    const fonts = exact(y).fonts as Rec[];
    expect(fonts.length).toBe(1);
    expect(fonts[0]!.id).toBe('old1');
    expect(fonts[0]!.data).toBe((styledBook().fonts as Rec[])[0]!.data);
    y.destroy();
  });

  it('deleting a My theme never touches a book that wears it', async () => {
    const a = onDesk(styledBook());
    tab();
    await saveToMine('ctHarbour');
    cleanup();
    a.destroy();
    styleRelease();
    const y = onDesk(LANTERN());
    tab();
    await applyMine('ctHarbour');
    const before = exact(y);
    const sv = Y.encodeStateVector(y);
    expect(await mineDelete('ctHarbour')).toBe(true);
    expect(mineGet('ctHarbour')).toBeNull();
    expect(exact(y)).toEqual(before);
    expect(Array.from(Y.encodeStateVector(y))).toEqual(Array.from(sv));
    y.destroy();
  });
});

describe('constraint 48: a hostile My theme passes the same safe path', () => {
  it('bad font names, header style, numbers and a flourish reference are corrected; bad bytes are never added', async () => {
    const goodFont = ttfData(1600, 4);
    const notAFont = btoa('<html><script>alert(1)</script></html>' + 'x'.repeat(1200));
    const evilSvg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const doc: MineDoc = {
      id: 'evil1',
      name: '<img src=x onerror=alert(1)>',
      theme: {
        bodyFont: "x'}body *{visibility:hidden}.q{font-family:'",
        headFont: 'Fake Family',
        headerStyle: 'classic"><script>alert(1)</script>',
        indentDepth: '1em; background:url(https://evil.example/x)',
        fontSize: 'calc(100vw)',
        lineHeight: 1.6,
        ornament: 'fl:flEvil',
        headingFlourish: 'flEvil',
        header: { number: { font: "a'),url(https://evil.example/f", size: 1, align: 'center', casing: 'asis', above: 0, below: 0 } },
      },
      assets: [
        { kind: 'font', sha256: shaOfData(notAFont), mediaType: 'font/ttf', id: 'fe', name: 'fake.ttf', family: 'Fake Family', ext: 'ttf' },
        { kind: 'font', sha256: shaOfData(goodFont), mediaType: 'font/ttf', id: 'fg', name: 'good.ttf', family: 'Good Face', ext: 'ttf' },
        { kind: 'flourish', sha256: shaOfData(evilSvg), mediaType: 'image/svg+xml', id: 'flEvil', name: 'evil.svg', ext: 'svg', flourish: true },
      ],
    };
    const bytes = new Map<string, Bytes>([
      [shaOfData(notAFont), { mediaType: 'font/ttf', data: notAFont }],
      [shaOfData(goodFont), { mediaType: 'font/ttf', data: goodFont }],
      [shaOfData(evilSvg), { mediaType: 'image/svg+xml', data: evilSvg }],
    ]);
    expect(await mineSave(doc, bytes)).toBe(true);
    const y = onDesk(LANTERN());
    const root = tab();
    expect(await applyMine('evil1')).toBe(true);
    const out = exact(y);
    expect((out.fonts as Rec[]).map((f) => f.family)).toEqual(['Good Face']); // the file that is not a font is not added
    expect(((out.images as Rec[]) ?? []).filter((im) => im.flourish)).toEqual([]); // the SVG with a script is not added
    const th = out.theme as Rec;
    expect(th.bodyFont).toBe('EB Garamond');
    expect(th.headFont).toBe('Libre Baskerville');
    expect(th.headerStyle).toBe('classic_centered');
    expect(th.indentDepth).toBe('1.5em');
    expect(typeof th.fontSize).toBe('number');
    expect(((th.header as Rec).number as Rec).font).toBe('Libre Baskerville');
    const css = styleRun((cc) => cc.api.buildBookCss('.fc-page'))!;
    expect(css).not.toMatch(/evil\.example|visibility:hidden|<script/);
    // the name is text (1.0's esc()): no element, handler or remote address reaches the tab
    expect(root.querySelector('script, img[src="x"], [onerror]')).toBeNull();
    const attrs = Array.from(root.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((at) => at.name + '=' + at.value));
    expect(attrs.filter((a) => /^on|evil\.example|javascript:/i.test(a))).toEqual([]);
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(readBook(out).status).toBe('ok');
    y.destroy();
  });
});

describe('review (Important 4): applying never overwrites the book\'s own different copy', () => {
  it('a book theme of the same id edited since: kept as it is; the kept theme joins under a new id and is worn', async () => {
    const a = onDesk(styledBook());
    tab();
    expect(await saveToMine('ctHarbour')).toBe(true);
    // the book's own copy edited afterwards (a plain Save in the creator), not kept again
    styleRun((cc) => {
      const st = cc.getState() as unknown as { customThemes: { id: string; name: string; theme: Rec }[] };
      st.customThemes[0]!.theme = { ...st.customThemes[0]!.theme, fontSize: 24 };
      st.customThemes[0]!.name = 'Harbour Lights, edited';
    });
    const edited = JSON.parse(JSON.stringify((exact(a).customThemes as Rec[])[0]));
    expect(await applyMine('ctHarbour')).toBe(true);
    const out = exact(a);
    const list = out.customThemes as Rec[];
    expect(list.find((x) => x.id === 'ctHarbour')).toEqual(edited);
    const added = list.find((x) => x.id !== 'ctHarbour' && x.name === 'Harbour Lights')!;
    expect(added).toBeTruthy();
    expect((added.theme as Rec).fontSize).toBe(17.5);
    expect(out.activePreset).toBe('custom:' + added.id);
    // the same again: the copy the book now holds is that theme, so nothing more is added
    const n = list.length;
    expect(await applyMine('ctHarbour')).toBe(true);
    expect((exact(a).customThemes as Rec[]).length).toBe(n);
    a.destroy();
  });
});

describe('review (Minor): a flourish the theme names but could not bring never points at another picture', () => {
  it('its id is cleared from the theme when its bytes are refused (1.0 falls back as when a flourish leaves)', async () => {
    const evilSvg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
    await mineSave(
      {
        id: 'flMiss',
        name: 'Missing Flourish',
        theme: { bodyFont: 'EB Garamond', ornament: 'fl:pic1', headingFlourish: 'pic1' },
        assets: [{ kind: 'flourish', sha256: shaOfData(evilSvg), mediaType: 'image/svg+xml', id: 'pic1', name: 'x.svg', ext: 'svg', flourish: true }],
      },
      new Map<string, Bytes>([[shaOfData(evilSvg), { mediaType: 'image/svg+xml', data: evilSvg }]]),
    );
    const b = LANTERN();
    b.images = [...((b.images as Rec[]) ?? []), { id: 'pic1', name: 'unrelated.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX }];
    const y = onDesk(b);
    tab();
    expect(await applyMine('flMiss')).toBe(true);
    const th = exact(y).theme as Rec;
    expect(th.headingFlourish).toBe('');
    expect(th.ornament).toBe('fleuron');
    y.destroy();
  });
});

describe('no edit: listing My themes and declining the offer write nothing', () => {
  it('the Y state vector is unchanged', async () => {
    const y = onDesk(styledBook());
    tab();
    const sv = Y.encodeStateVector(y);
    expect(bookThemesNotInMine().map((x) => x.id)).toEqual(['ctHarbour', 'ctPlain']);
    mineDocFromBook('ctHarbour');
    expect(Array.from(Y.encodeStateVector(y))).toEqual(Array.from(sv));
    y.destroy();
  });
});
