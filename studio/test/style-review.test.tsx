import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleBegin, styleEnter, styleRelease, styleReset, styleRoot, styleRun, styleSettle } from '../src/style/session';
import { StyleFrame } from '../src/style/StyleTab';
import { removePictures } from '../src/pictures/imagelib';
import { fixtures } from './fixtures';
import { PNG_1PX, SVG_TEXT, ttfData } from './style-fixture';

/* Wave 4a, review round (coordinator's should-fixes S1–S7):
   S1/S2 a picture's or a font's base64 data that is not base64 never reaches 1.0's markup or a FontFace (and stays in
   the book untouched); S3 a theme font name that is neither a library face nor a plain uploaded family becomes 1.0's
   default before 1.0's book-CSS function sees it; constraint 33 the themes seam; the FontFaces a book added go when the
   book goes; a settle inside a running call writes the held edit; a picture removal does not lose a held Style edit
   (nor does the held edit put the stale theme back); a family with letters outside ASCII is kept and registered; a
   font stored without an id gets a stable one. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

/** A stand-in for the page's FontFaceSet and FontFace (jsdom has neither): faces are recorded, loads succeed. */
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
beforeEach(() => {
  styleRelease();
  faces.clear();
});
afterEach(() => {
  cleanup();
  styleRoot.el = null;
  desk.ydoc = null;
  c.vars.tcDraft = null;
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
    cc.api.registerAllFonts();
    cc.api.initStudio();
    cc.api.syncStudioControls();
  });
  return container;
};
const st = () => styleRun((cc) => cc.getState() as unknown as Rec & { theme: Rec; fonts: Rec[]; images: Rec[] })!;
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const BAD_IMG = 'AAA"><div id="presetGrid"></div><button class="orn-btn" data-orn="fleuron">x</button>';
const BAD_FONT = 'x),url(https://evil.invalid/p)';
const BAD_NAME = "x'}body *{visibility:hidden}.q{font-family:'";

describe('S1, S2: data that is not base64', () => {
  it('a flourish whose data breaks out of its src adds nothing to the tab, and stays in the book as stored', () => {
    const doc = LANTERN();
    doc.images = [{ id: 'flbad', name: 'bad.png', mediaType: 'image/png', ext: 'png', data: BAD_IMG, flourish: true }, { id: 'flok', name: 'ok.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX, flourish: true }];
    const y = onDesk(doc);
    const root = tab();
    expect(root.querySelectorAll('#presetGrid').length).toBe(1);
    expect(Array.from(root.querySelectorAll('#ornamentGrid [data-orn]')).map((b) => b.getAttribute('data-orn'))).toEqual([...c.api.ORNAMENTS.map((o) => o.id), 'fl:flok']);
    expect(root.querySelector('#ornamentGrid button button')).toBeNull();
    // a library write keeps the bad picture exactly as stored
    styleRun((cc) => (cc.getState() as unknown as { images: Rec[] }).images.push({ id: 'flnew', name: 'n.svg', mediaType: 'image/svg+xml', ext: 'svg', data: btoa(SVG_TEXT), flourish: true }));
    const out = exportBook(y);
    expect((out.images as Rec[]).find((im) => im.id === 'flbad')).toEqual((doc.images as Rec[])[0]);
    y.destroy();
  });

  it('a font whose data adds a remote source is never a FontFace, and stays in the book as stored', () => {
    const doc = LANTERN();
    doc.fonts = [{ id: 'fbad', name: 'b.ttf', family: 'Bad Data', ext: 'ttf', mediaType: 'font/ttf', data: BAD_FONT }, { id: 'fok', name: 'o.ttf', family: 'Good Face', ext: 'ttf', mediaType: 'font/ttf', data: ttfData() }];
    const y = onDesk(doc);
    tab();
    const srcs = Array.from(faces).map((f) => f.src);
    expect(srcs.some((s) => s.includes('evil'))).toBe(false);
    expect(Array.from(faces).map((f) => f.family)).toEqual(['Good Face']);
    expect(Array.from(document.querySelectorAll('#fontList .fl-name')).map((x) => x.textContent)).toEqual(['Good Face']);
    styleRun((cc) => (cc.getState() as unknown as { fonts: Rec[] }).fonts.push({ id: 'fnew', name: 'n.ttf', family: 'New Face', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 3) }));
    expect((exportBook(y).fonts as Rec[]).map((f) => f.id)).toEqual(['fbad', 'fok', 'fnew']);
    expect((exportBook(y).fonts as Rec[])[0]).toEqual((doc.fonts as Rec[])[0]);
    y.destroy();
  });
});

describe('S3: theme font names', () => {
  it('a name that would break out of the book CSS becomes 1.0\'s default before buildBookCss sees it (theme, header, custom themes)', () => {
    const doc = LANTERN();
    const header = { number: { font: BAD_NAME, size: 1, align: 'center', casing: 'upper', above: 0, below: 0 }, title: { font: 'Lora', size: 2, align: 'center', casing: 'asis', above: 0, below: 0 }, subtitle: { font: BAD_NAME, size: 1, align: 'center', casing: 'asis', above: 0, below: 0 } };
    doc.theme = { ...(doc.theme as Rec), bodyFont: BAD_NAME, headFont: BAD_NAME, header };
    doc.customThemes = [{ id: 'ctb', name: 'B', theme: { ...(doc.theme as Rec) } }];
    const y = onDesk(doc);
    tab();
    const css = styleRun((cc) => cc.api.buildBookCss('') + cc.api.buildBookCss('.fc-page'))!;
    expect(css).not.toContain('visibility');
    const th = st().theme as Rec & { header: Record<string, Rec> };
    expect([th.bodyFont, th.headFont, th.header.number!.font, th.header.title!.font, th.header.subtitle!.font]).toEqual(['EB Garamond', 'Libre Baskerville', 'Libre Baskerville', 'Lora', 'Libre Baskerville']);
    const ct = styleRun((cc) => (cc.getState() as unknown as { customThemes: { theme: Rec & { header: Record<string, Rec> } }[] }).customThemes[0]!.theme)!;
    expect([ct.bodyFont, ct.headFont, ct.header.number!.font]).toEqual(['EB Garamond', 'Libre Baskerville', 'Libre Baskerville']);
    const css2 = styleRun((cc) => {
      cc.api.applyCustomTheme('ctb');
      return cc.api.buildBookCss('');
    });
    expect(css2).not.toContain('visibility');
    // a plain uploaded family and a library face stand
    const d2 = LANTERN();
    d2.fonts = [{ id: 'fw', name: 'w.ttf', family: 'Writer Hand', ext: 'ttf', mediaType: 'font/ttf', data: ttfData() }];
    d2.theme = { ...(d2.theme as Rec), bodyFont: 'Writer Hand', headFont: 'Pinyon Script' };
    onDesk(d2);
    expect([st().theme.bodyFont, st().theme.headFont]).toEqual(['Writer Hand', 'Pinyon Script']);
    y.destroy();
  });
});

describe('constraint 33: the themes seam', () => {
  it('themes.ts reads, normalises and writes customThemes and imports nothing of the session; the session calls it', () => {
    const src = (f: string) => readFileSync(fileURLToPath(new URL('../src/style/' + f, import.meta.url)), 'utf8');
    const themes = src('themes.ts'), session = src('session.ts');
    expect(themes).not.toMatch(/from '\.\/session'/);
    expect(session).toMatch(/from '\.\/themes'/);
    expect(session).toMatch(/readThemes\(/);
    expect(session).toMatch(/serializeThemes\(/);
    expect(session).toMatch(/writeThemes\(/);
    expect(session).not.toMatch(/normalizeCustomTheme/);
  });
});

describe('FontFaces follow the book', () => {
  it('book A\'s faces go when the book goes; B\'s same family with other bytes is B\'s; back to A registers A again', () => {
    const fontA = { id: 'fa', name: 'a.ttf', family: 'Shared', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 3) };
    const fontB = { id: 'fa', name: 'b.ttf', family: 'Shared', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 9) };
    const a = LANTERN(), b = LANTERN();
    a.fonts = [fontA];
    b.fonts = [fontB];
    onDesk(a);
    styleRun((cc) => cc.api.registerAllFonts());
    expect(Array.from(faces).map((f) => f.src.includes(fontA.data))).toEqual([true]);
    styleRelease();
    expect(faces.size).toBe(0);
    onDesk(b);
    styleRun((cc) => cc.api.registerAllFonts());
    expect(Array.from(faces).map((f) => f.src.includes(fontB.data))).toEqual([true]);
    styleRelease();
    onDesk(a);
    styleRun((cc) => cc.api.registerAllFonts());
    expect(Array.from(faces).map((f) => f.src.includes(fontA.data))).toEqual([true]);
  });
});

describe('the pause, and other writers', () => {
  it('a settle inside a running call writes the held edit', () => {
    const y = onDesk(LANTERN());
    styleRun((cc) => ((cc.getState() as unknown as { theme: Rec }).theme.fontSize = 21), true);
    expect((exportBook(y).theme as Rec).fontSize).not.toBe(21);
    styleRun(() => {
      styleSettle();
      expect((exportBook(y).theme as Rec).fontSize).toBe(21);
    });
    y.destroy();
  });

  it('another session displacing the closure\'s state inside an open call loses none of the call\'s edit (the preview and My themes do: seen as a lost header style)', () => {
    const y = onDesk(LANTERN());
    const end = styleBegin()!;
    const mine = c.getState() as unknown as { theme: Rec };
    mine.theme.headerStyle = 'editorial_left';
    c.setState(structuredClone(mine) as never); // the preview's pvRefresh / another session sets its own state
    expect(styleEnter()).not.toBeNull(); // My themes' render reads the book through the session meanwhile
    end();
    expect((exportBook(y).theme as Rec).headerStyle).toBe('editorial_left');
    y.destroy();
  });

  it('a picture removed while a Style edit is held: both land (the ornament falls back, the size stands)', async () => {
    const doc = LANTERN();
    doc.images = [{ id: 'flx', name: 'x.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX, flourish: true }];
    doc.theme = { ...(doc.theme as Rec), ornament: 'fl:flx' };
    const y = onDesk(doc);
    styleRun((cc) => ((cc.getState() as unknown as { theme: Rec }).theme.fontSize = 22), true);
    expect(removePictures(c, y, ['flx'])).not.toBeNull();
    await new Promise((r) => setTimeout(r, 450));
    const th = exportBook(y).theme as Rec;
    expect(th.fontSize).toBe(22);
    expect(th.ornament).toBe('fleuron');
    y.destroy();
  });
});

describe('nits', () => {
  it('a family with letters outside ASCII is kept in the book and registered; an unsafe one is kept in the book only', () => {
    const doc = LANTERN();
    doc.fonts = [
      { id: 'fc', name: 'c.ttf', family: 'Café Script', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 4) },
      { id: 'fb', name: 'b.ttf', family: 'Noto Serif (Bold)', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 6) },
      { id: 'fu', name: 'u.ttf', family: 'Un"safe', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 8) },
    ];
    const y = onDesk(doc);
    tab();
    expect(Array.from(faces).map((f) => f.family).sort()).toEqual(['Café Script', 'Noto Serif (Bold)']);
    styleRun((cc) => (cc.getState() as unknown as { fonts: Rec[] }).fonts.push({ id: 'fn', name: 'n.ttf', family: 'New', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 2) }));
    expect((exportBook(y).fonts as Rec[]).map((f) => f.family)).toEqual(['Café Script', 'Noto Serif (Bold)', 'Un"safe', 'New']);
    y.destroy();
  });

  it('a font stored without an id gets a stable one: no write on a session, the same id in the next', () => {
    const doc = LANTERN();
    doc.fonts = [{ name: 'w.ttf', family: 'Writer Hand', ext: 'ttf', mediaType: 'font/ttf', data: ttfData() }];
    const y = onDesk(doc);
    const sv = Y.encodeStateVector(y);
    const id1 = st().fonts[0]!.id;
    styleReset();
    const id2 = st().fonts[0]!.id;
    expect(id1).toBe(id2);
    expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(sv))).toBe(true);
    expect(JSON.stringify(exportBook(y))).toBe(JSON.stringify(want(doc)));
    y.destroy();
  });
});

void vi;
