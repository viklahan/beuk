import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { cleanFragment, serializedStyle, styleFlush, styleReset, styleRoot, styleRun, styleState } from '../src/style/session';
import { StyleFrame } from '../src/style/StyleTab';
import { applyTheme, deleteTheme, duplicateTheme, listThemes, openCreator, saveTheme } from '../src/style/themes';
import { fixtures } from './fixtures';
import { styledBook } from './style-fixture';

/* Wave 4a, task 1 (constraints 30, 33; review focus #1, #4): the Style tab's data. 1.0's own code runs on 1.0's state
   of the book (styleRun) and only the keys whose serialized form changed are written, as serializeBook writes them.
   - no edit, no write: building the state and running 1.0's renderers' reads leaves the Y state vector unchanged
     on every fixture and on the styled book;
   - every fixture and the styled book export exactly as readBook reads them after a session (round trip);
   - the custom themes (themes.ts, constraint 33): apply, duplicate, delete and the creator's save, each read back
     from a fresh import of the export exactly as written (what 1.0 then reads);
   - the book colour: placed where serializeBook writes `colour`, gone when cleared;
   - the cleaner that stands between 1.0's HTML and the page. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => styleReset());
afterEach(() => {
  cleanup();
  styleRoot.el = null;
  desk.ydoc = null;
  desk.active = null;
  c.vars.tcDraft = null;
});

const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  return y;
};
/** The tab's frame in the page, wired by 1.0's initStudio and drawn by syncStudioControls (StyleTab's own steps). */
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
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const books = () => [...fixtures('all').filter((f) => readBook(f.book).status === 'ok').map((f) => ({ name: f.name, book: f.book })), { name: 'styled', book: styledBook() }];

describe('the Style tab\'s session', () => {
  it('no edit, no write: a session on every fixture (and the styled book) leaves the Y.Doc untouched and the export exact', () => {
    for (const f of books()) {
      const y = onDesk(f.book);
      const sv = Y.encodeStateVector(y);
      styleRun((cc) => {
        const a = cc.api;
        // what the tab's renderers read: the presets, the colour, the fonts, the flourishes, the themes
        a.bookColour();
        a.uploadedFonts();
        a.flourishImages();
        a.normalizeCustomTheme((cc.getState() as unknown as Rec & { customThemes: unknown[] }).customThemes[0]);
      });
      styleFlush();
      expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(sv)), f.name + ': nothing written').toBe(true);
      const got = exportBook(y);
      const exp = want(f.book);
      if (readBook(f.book).upgrades.includes('bookid-missing')) (exp.meta as Rec).bookId = (got.meta as Rec).bookId; // readBook mints one per read
      expect(JSON.stringify(got), f.name + ': export exact').toBe(JSON.stringify(exp));
      y.destroy();
    }
  });

  it('serializeBook\'s Style keys equal the stored ones on the styled book (the shapes 1.0 writes)', () => {
    const doc = styledBook();
    const y = onDesk(doc);
    const out = styleRun((cc) => serializedStyle(cc))!;
    const stored = want(doc);
    for (const k of ['theme', 'activePreset', 'colour', 'fonts', 'customThemes'] as const) expect(out[k], k).toEqual(stored[k]);
    y.destroy();
  });

  it('a preset applied writes theme and activePreset only (1.0\'s preset click), in place; the rest of the book is untouched', () => {
    for (const p of [0, 1, 14]) {
      const doc = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book;
      const y = onDesk(doc);
      const before = exportBook(y);
      styleRun((cc) => {
        const pr = cc.api.PRESETS[p]!;
        const st = cc.getState() as Rec;
        // 1.0's renderStudio preset handler, its two state lines (the UI test clicks the card itself)
        st.theme = Object.assign({}, pr.theme);
        st.activePreset = pr.id;
      });
      const after = exportBook(y);
      expect(Object.keys(after)).toEqual(Object.keys(before));
      const pr = c.api.PRESETS[p]!;
      expect(after.theme).toEqual(pr.theme);
      expect(after.activePreset).toBe(pr.id);
      for (const k of Object.keys(before)) if (k !== 'theme' && k !== 'activePreset') expect(after[k], k).toEqual(before[k]);
      y.destroy();
    }
  });

  it('the book colour: placed where serializeBook writes it, refused below 3:1, gone when cleared', () => {
    const doc = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book;
    const y = onDesk(doc);
    expect(Object.keys(exportBook(y))).not.toContain('colour');
    const r = styleRun((cc) => cc.api.setBookColour('accent', '#1f62a8'))!;
    expect(r.ok).toBe(true);
    let out = exportBook(y);
    expect(out.colour).toEqual({ accent: '#1f62a8', tint: '' });
    const keys = Object.keys(out);
    expect(keys.indexOf('colour')).toBe(keys.indexOf('activePreset') + 1);
    const refused = styleRun((cc) => cc.api.setBookColour('accent', '#f5f5f5'))!;
    expect(refused.ok).toBe(false);
    expect(exportBook(y).colour).toEqual({ accent: '#1f62a8', tint: '' });
    styleRun((cc) => cc.api.setBookPrintBlack(true));
    expect(exportBook(y).colour).toEqual({ accent: '#1f62a8', tint: '', printBlack: true });
    styleRun((cc) => cc.api.setBookColour('accent', ''));
    out = exportBook(y);
    expect(Object.keys(out)).not.toContain('colour');
    y.destroy();
  });
});

describe('the writer\'s themes (themes.ts, constraint 33)', () => {
  it('lists, applies, duplicates and deletes as 1.0 does, and each reads back from a fresh import exactly', () => {
    const doc = styledBook();
    const y = onDesk(doc);
    tab();
    expect(listThemes().map((x) => x.name)).toEqual(['Harbour Lights', 'Plain Modern']);
    expect(applyTheme('ctPlain')).toBe(true);
    // 1.0 wears a copy of the saved theme; serializeBook leaves out a header design that is not there (its null)
    const worn = { ...((c.api.normalizeCustomTheme((doc.customThemes as Rec[])[1]) as Rec).theme as Rec) };
    delete worn.header;
    let out = exportBook(y);
    expect(out.activePreset).toBe('custom:ctPlain');
    expect(out.theme).toEqual(worn);
    const dup = duplicateTheme('ctHarbour')!;
    expect(dup).toBeTruthy();
    out = exportBook(y);
    expect((out.customThemes as Rec[]).map((x) => x.name)).toEqual(['Harbour Lights', 'Harbour Lights' + t('themes.copySuffix'), 'Plain Modern']);
    expect((out.customThemes as Rec[])[1]!.theme).toEqual((out.customThemes as Rec[])[0]!.theme);
    expect(deleteTheme('ctPlain')).toBe(true);
    out = exportBook(y);
    expect((out.customThemes as Rec[]).map((x) => x.id)).toEqual(['ctHarbour', dup]);
    // 1.0: the book keeps the styling it wears; the gallery stops calling it active
    expect(out.activePreset).toBe(null);
    expect(out.theme).toEqual(worn);
    // a fresh import of the export reads back the same (1.0's own normaliser on arrival)
    const y2 = new Y.Doc();
    importBook(structuredClone(out), y2);
    expect(JSON.stringify(exportBook(y2))).toBe(JSON.stringify(out));
    y.destroy();
    y2.destroy();
  });

  it('the creator: open on the worn theme, change the title\'s casing, save — a new theme, applied (1.0\'s saveThemeCreator)', () => {
    const doc = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book;
    const y = onDesk(doc);
    tab();
    const sv = Y.encodeStateVector(y);
    openCreator(null);
    expect(c.vars.tcDraft).toBeTruthy();
    // opening the creator writes nothing (review focus #4)
    expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(sv))).toBe(true);
    styleRun(() => {
      (document.getElementById('tcName') as HTMLInputElement).value = 'Harbour Test'; // 1.0 reads the name at Save
      (c.vars.tcDraft!.header as Rec & { title: Rec }).title.casing = 'upper';
    });
    expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(sv))).toBe(true);
    const id = saveTheme()!;
    const out = exportBook(y);
    const cts = out.customThemes as (Rec & { theme: Rec & { header: Rec & { title: Rec } } })[];
    expect(cts.length).toBe(1);
    expect(cts[0]!.id).toBe(id);
    expect(cts[0]!.name).toBe('Harbour Test');
    expect(cts[0]!.theme.header.title.casing).toBe('upper');
    expect(out.activePreset).toBe('custom:' + id);
    expect(out.theme).toEqual(cts[0]!.theme);
    expect(styleState()).toBeTruthy();
    y.destroy();
  });
});

describe('1.0\'s HTML, made safe (the book is untrusted)', () => {
  it('drops scripts and handlers, keeps an <img> only from a checked picture URL', () => {
    const tpl = document.createElement('template');
    tpl.innerHTML =
      '<button class="orn-btn" data-orn="fl:x"><img class="orn-thumb" src="data:x" onerror="alert(1)" alt=""/><span>A</span></button>' +
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="/>' +
      '<img src="data:image/png;base64,PHN2Zz48L3N2Zz4="/><script>alert(2)</script><a href="javascript:alert(3)">x</a>' +
      '<span class="fl-name" style="font-family:\'x\'"></span><svg onload="alert(4)"><script>alert(5)</script></svg><iframe srcdoc="x"></iframe>';
    cleanFragment(tpl.content);
    const html = tpl.innerHTML;
    expect(html).not.toMatch(/onerror|onload|<script|javascript:|<iframe/i);
    const imgs = Array.from(tpl.content.querySelectorAll('img'));
    expect(imgs[0]!.hasAttribute('src')).toBe(false);
    expect(imgs[1]!.getAttribute('src')).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(imgs[2]!.hasAttribute('src')).toBe(false); // says PNG, is not one
    expect(tpl.content.querySelector('.fl-name')).toBeTruthy();
    expect(tpl.content.querySelector('[data-orn="fl:x"] span')!.textContent).toBe('A');
  });
});
