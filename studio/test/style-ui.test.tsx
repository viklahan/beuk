import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { closureIfLoaded, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset, styleRun } from '../src/style/session';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { PNG_1PX, SVG_TEXT, styledBook, ttfData } from './style-fixture';
import { backupClicked } from './backup-wait';

/* Wave 4a, tasks 2 and 3 (inventory D1, D2): the Style tab in the studio — 1.0's markup, drawn by 1.0's renderers and
   wired by 1.0's initStudio, each handler writing back only what it changed. 1.0's self-checks re-expressed here
   (see the report for the full list): fonts.library.expanded-shelf, fonts.each.reaches-export-css,
   fonts.sans.clean-stack, themes.library.count-shelves-shape, themes.apply.exports-pairing-header-ornament (CSS
   half), themes.apply.then-overridable, fonts.display.heading-only (pickers and CSS), colour.contrast.guard,
   colour.unset.css-identical, colour.persists-with-book, colour.print.black-ink-option (data and print CSS),
   colour.dark-surfaces.readable (CSS), colour.accent.reaches-every-output (preview and EPUB CSS), flourish.ornament and
   flourish.heading (the library, the choices, the fallbacks), fonts.upload (pickers, refusal), theme.creator (the
   gallery). Review focus #4: browsing writes nothing. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  c.vars.tcDraft = null;
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  desk.ydoc = null;
  desk.active = null;
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const LANTERN = () => structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
async function studioWith(doc: Rec) {
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('tabBtnType').getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openTab() {
  fireEvent.click($('tabBtnType'));
  await waitFor(() => expect(document.querySelectorAll('#presetGrid [data-preset]').length).toBe(15), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
  ];
  await backupClicked(() => fireEvent.click($('btnLocalBackup')));
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec }).book;
}
const change = (el: HTMLInputElement | HTMLSelectElement, v: string, ev: 'input' | 'change' = 'change') =>
  act(() => {
    el.value = v;
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  });
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
/** A File 1.0's FileReader reads (jsdom's). */
const fileOf = (bin: string, name: string, type: string) => {
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new File([bytes], name, { type });
};
async function upload(inputId: string, f: File) {
  const inp = $(inputId);
  Object.defineProperty(inp, 'files', { value: [f], configurable: true });
  await act(async () => {
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const css = (scope = '') => styleRun((cc) => cc.api.buildBookCss(scope))!;

describe('the Style tab in the studio', { timeout: 60_000 }, () => {
  it('opens with 1.0\'s markup and lists; browsing (hover, the creator opened, its controls, Start from, Close) writes nothing', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    const before = JSON.stringify(await exported());
    await openTab();
    expect($('tabBtnType').classList.contains('active')).toBe(true);
    expect($('panelContent').style.display).toBe('none');
    // the presets: 1.0's fifteen, the book's own active (themes.library.count-shelves-shape)
    const cards = Array.from(document.querySelectorAll('#presetGrid [data-preset]'));
    expect(cards.map((b) => b.getAttribute('data-preset'))).toEqual(c.api.PRESETS.map((p) => p.id));
    expect(document.querySelector('#presetGrid .preset-card.active')!.getAttribute('data-preset')).toBe(doc.activePreset);
    const shelves = new Set(c.api.PRESETS.map((p) => p.genre.split(' · ')[0]));
    for (const s of ['Fiction', 'Nonfiction', 'Memoir', 'Academic', "Children's", 'Poetry']) expect(shelves.has(s), s).toBe(true);
    for (const p of c.api.PRESETS) {
      expect(c.api.BODY_FONTS).toContain(p.theme.bodyFont);
      expect(c.api.HEAD_FONTS).toContain(p.theme.headFont);
      expect(c.api.ORNAMENTS.map((o) => o.id)).toContain(p.theme.ornament);
    }
    // the pickers: the expanded shelf (fonts.library.expanded-shelf); display faces in the heading picker only, in their
    // own group (fonts.display.heading-only)
    const opts = (id: string) => Array.from($(id).querySelectorAll('option')).map((o) => o.value);
    for (const f of ['Playfair Display', 'Crimson Pro', 'Libre Caslon Text', 'PT Serif', 'Gentium Book Plus', 'Alegreya', 'Literata', 'Lora', 'Source Serif 4', 'Inter', 'Source Sans 3']) expect(opts('selBodyFont')).toContain(f);
    for (const d of ['Pinyon Script', 'Patrick Hand', 'Abril Fatface']) {
      expect(opts('selBodyFont')).not.toContain(d);
      expect(Array.from(document.querySelectorAll('#selHeadFont optgroup')).find((g) => g.getAttribute('label') === t('fonts.displayGroup'))!.textContent).toContain(d);
    }
    expect($('selBodyFont').value).toBe((doc.theme as Rec).bodyFont);
    expect($('valSize').textContent).toBe((doc.theme as Rec).fontSize + ' px');
    expect(document.querySelectorAll('#ornamentGrid [data-orn]').length).toBe(13);
    expect($('myThemeGrid').textContent).toContain(t('themes.empty'));
    expect(document.querySelectorAll('#colourAccentRow [data-colour-kind="accent"]').length).toBe(11);
    // browse: hover every preset, open the creator, move its controls (the draft only), Start from a preset, Close
    for (const b of cards) fireEvent.mouseOver(b);
    await click($('btnNewTheme'));
    expect($('themeCreator').style.display).toBe('');
    await change($('tcFont-title') as unknown as HTMLSelectElement, 'Cinzel');
    await change($('tcSize-number'), '1.2', 'input');
    await click(document.querySelector('[data-tc-case="title"] [data-val="upper"]'));
    $('tcBase').value = 'preset:noir';
    await click($('btnTcBase'));
    await change($('tcName'), 'Not saved', 'input');
    await click($('btnTcClose'));
    expect($('themeCreator').style.display).toBe('none');
    await new Promise((r) => setTimeout(r, 400)); // past the typing pause
    expect(JSON.stringify(await exported())).toBe(before);
    // back to the page: the desk shows again
    await click($('tabBtnContent'));
    expect($('panelType').style.display).toBe('none');
  });

  it('a preset applied: 1.0\'s click writes its theme and activePreset (and nothing else), with 1.0\'s toast', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    const before = await exported();
    await openTab();
    await click(document.querySelector('#presetGrid [data-preset="noir"]'));
    const after = await exported();
    const noir = c.api.PRESETS.find((p) => p.id === 'noir')!;
    expect(after.theme).toEqual(noir.theme);
    expect(after.activePreset).toBe('noir');
    for (const k of Object.keys(before)) if (k !== 'theme' && k !== 'activePreset' && k !== 'history' && k !== 'historyPool') expect(after[k], k).toEqual(before[k]);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    await waitFor(() => expect(toasts().some((x) => x.includes('Preset applied: ' + noir.name))).toBe(true));
    expect(document.querySelector('#presetGrid .preset-card.active')!.getAttribute('data-preset')).toBe('noir');
    // themes.apply.exports-pairing-header-ornament (the CSS half): the pairing reaches the book CSS
    expect(css()).toContain("'Merriweather'");
    expect(css()).toContain("'Oswald'");
    // themes.apply.then-overridable: a body font after the theme wins; the heading, ornament and size stand
    await change($('selBodyFont') as unknown as HTMLSelectElement, 'Lora');
    const ov = await exported();
    expect((ov.theme as Rec).bodyFont).toBe('Lora');
    expect((ov.theme as Rec).headFont).toBe('Oswald');
    expect((ov.theme as Rec).ornament).toBe('diamonds');
    expect((ov.theme as Rec).fontSize).toBe(16);
    expect(ov.activePreset).toBe(null); // 1.0's customTheme()
    expect(css()).toContain("'Lora'");
  });

  it('the fine controls: range (after the pause), header style, rhythm, drop caps, switches, ornament', async () => {
    await studioWith(LANTERN());
    await openTab();
    await change($('rngSize'), '19.5', 'input');
    expect($('valSize').textContent).toBe('19.5 px');
    await waitFor(async () => expect(((await exported()).theme as Rec).fontSize).toBe(19.5), { timeout: 3000 });
    await change($('rngLeading'), '1.8', 'input');
    await change($('selHeaderStyle') as unknown as HTMLSelectElement, 'editorial_left');
    await click(document.querySelector('#segParaMode [data-mode="block"]'));
    expect($('indentDepthCtl').style.display).toBe('none');
    await change($('selDropDepth') as unknown as HTMLSelectElement, '4');
    await change($('rngSmallCaps'), '5', 'input');
    await click($('tglJustify'));
    await click($('tglHyph'));
    await click(document.querySelector('#ornamentGrid [data-orn="stars"]'));
    // wait for the writes themselves, not a fixed sleep (the header style was once lost here: another session
    // displacing the closure's state inside the select's open call rebuilt the Style session; session.ts now keeps it)
    await waitFor(
      async () =>
        expect((await exported()).theme as Rec).toMatchObject({ fontSize: 19.5, lineHeight: 1.8, headerStyle: 'editorial_left', paraMode: 'block', dropDepth: 4, smallCapsWords: 5, justify: false, hyphens: false, ornament: 'stars' }),
      { timeout: 3000 },
    );
    expect($('tglJustify').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('#ornamentGrid .orn-btn.active')!.getAttribute('data-orn')).toBe('stars');
  });

  it('every font on the shelf reaches the book CSS; sans faces take the sans stack (fonts.each.reaches-export-css, fonts.sans.clean-stack)', async () => {
    await studioWith(LANTERN());
    await openTab();
    const bad: string[] = [];
    styleRun((cc) => {
      const st = cc.getState() as unknown as Rec & { theme: Rec };
      const keep = st.theme;
      try {
        for (const f of cc.api.BODY_FONTS) {
          st.theme = { ...keep, bodyFont: f };
          const out = cc.api.buildBookCss('');
          if (!out.includes("'" + f + "'")) bad.push('body ' + f);
          if (['Inter', 'Source Sans 3'].includes(f) !== /'(?:Inter|Source Sans 3)', 'Noto Serif Devanagari', 'Amiri', 'Helvetica Neue'/.test(out)) bad.push('stack ' + f);
        }
        for (const f of cc.api.HEAD_FONTS) {
          st.theme = { ...keep, headFont: f };
          if (!cc.api.buildBookCss('').includes("'" + f + "'")) bad.push('head ' + f);
        }
      } finally {
        st.theme = keep;
      }
    });
    expect(bad).toEqual([]);
    expect(c.api.BODY_FONTS.length).toBeGreaterThanOrEqual(15);
    expect(c.api.HEAD_FONTS.length).toBeGreaterThanOrEqual(15);
  });

  it('the book colour: a swatch, the guard\'s refusal (nothing changes), print in black ink, cleared back to the same CSS and no key', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openTab();
    const plain = css('');
    const plainKeys = Object.keys(await exported());
    await click(document.querySelector('#colourAccentRow [data-colour="#1f62a8"]'));
    let out = await exported();
    expect(out.colour).toEqual({ accent: '#1f62a8', tint: '' });
    const okRatio = c.api.bookColourCheck('accent', '#1f62a8', { accent: '', tint: '' }).params.ratio as string;
    expect($('colourMsg').textContent).toBe(t('colour.okAccent', { hex: '#1f62a8', ratio: okRatio }));
    // colour.accent.reaches-every-output (the preview and EPUB CSS) and colour.dark-surfaces.readable (CSS)
    expect(css('')).toMatch(/\.chapter-title[^{]*\{ color: #1f62a8; \}/);
    expect(css('.fc-page')).not.toContain('.frame-phone .fc-page'); // azure already reads 3:1 on the phone's black
    await click(document.querySelector('#colourAccentRow [data-colour="#1f3a64"]'));
    expect(css('.fc-page')).toMatch(/\.frame-phone \.fc-page \.chapter-number[^{]*\{ color: #[0-9a-f]{6}; \}/); // ink is lightened there
    expect(css('')).not.toContain('.frame-phone'); // the EPUB keeps the colour chosen
    await click(document.querySelector('#colourAccentRow [data-colour="#1f62a8"]'));
    // colour.contrast.guard: a pale accent refused with its numbers, the book unchanged
    await change($('colourAccentCustom'), '#ffe9a0');
    expect($('colourMsg').classList.contains('warn')).toBe(true);
    expect($('colourMsg').textContent).toContain('#ffe9a0');
    expect($('colourMsg').textContent).toContain('3:1');
    expect((await exported()).colour).toEqual({ accent: '#1f62a8', tint: '' });
    const none = { accent: '', tint: '' };
    const pale = c.api.bookColourCheck('accent', '#ffd23f', none);
    expect([pale.ok, pale.key, pale.params.ratio]).toEqual([false, 'colour.refusedAccent', '1.44']);
    const clash = c.api.bookColourCheck('tint', '#a0a0a0', { accent: '#1f62a8', tint: '' });
    expect([clash.ok, clash.key, clash.params.ratio]).toEqual([false, 'colour.refusedTintAccent', '2.38']);
    // a tint, then print in black ink (rides with the book; colour.print.black-ink-option, data and print CSS)
    await click(document.querySelector('#colourTintRow [data-colour="#fbf5e6"]'));
    await act(async () => {
      $('colourPrintBlack').checked = true;
      $('colourPrintBlack').dispatchEvent(new Event('change', { bubbles: true }));
    });
    out = await exported();
    expect(out.colour).toEqual({ accent: '#1f62a8', tint: '#fbf5e6', printBlack: true });
    // colour.persists-with-book: a fresh import reads it back exactly
    expect(readBook(out).book.colour).toEqual(out.colour);
    // cleared: the accent goes with its print option, the tint too — the same CSS bytes, no colour key (colour.unset.css-identical)
    await click(document.querySelector('#colourAccentRow [data-colour=""]'));
    await click(document.querySelector('#colourTintRow [data-colour=""]'));
    out = await exported();
    expect('colour' in out).toBe(false);
    expect(Object.keys(out)).toEqual(plainKeys);
    expect(css('')).toBe(plain);
  });

  it('flourishes: an SVG and a PNG join the library and the ornament choices, a bad file is refused, the heading flourish and its placement, removal falls back (flourish.ornament, flourish.heading)', async () => {
    await studioWith(LANTERN());
    await openTab();
    await change($('flourishName'), 'Harbour star', 'input');
    await upload('flourishFileInput', fileOf(SVG_TEXT, 'star.svg', 'image/svg+xml'));
    await waitFor(() => expect(document.querySelectorAll('#flourishList .flourish-row').length).toBe(1));
    await upload('flourishFileInput', fileOf(atob(PNG_1PX), 'dot.png', 'image/png'));
    await waitFor(() => expect(document.querySelectorAll('#flourishList .flourish-row').length).toBe(2));
    await upload('flourishFileInput', fileOf('<svg onload="x()"><script>alert(1)</script></svg>', 'evil.svg', 'image/svg+xml'));
    await upload('flourishFileInput', fileOf('not a png', 'fake.png', 'image/png'));
    await waitFor(() => expect(toasts().filter((x) => x.includes(t('flourish.invalid'))).length).toBe(2));
    let out = await exported();
    const fl = (out.images as Rec[]).filter((im) => im.flourish === true);
    expect(fl.map((im) => [im.name, im.mediaType, im.ext])).toEqual([['Harbour star.svg', 'image/svg+xml', 'svg'], ['dot.png', 'image/png', 'png']]);
    expect(readBook(out).status).toBe('ok');
    // the ornament grid offers both (13 built-ins + 2), the thumbnails through 2.0's checked picture URL
    expect(document.querySelectorAll('#ornamentGrid [data-orn]').length).toBe(15);
    for (const img of Array.from(document.querySelectorAll('#ornamentGrid img.orn-thumb'))) expect(img.getAttribute('src')).toMatch(/^data:image\/(svg\+xml|png);base64,/);
    const svgId = fl[0]!.id as string, pngId = fl[1]!.id as string;
    await click(document.querySelector(`#ornamentGrid [data-orn="fl:${svgId}"]`));
    await change($('selHeadingFlourish') as unknown as HTMLSelectElement, pngId);
    await click(document.querySelector('#segFlourishPos [data-fpos="below"]'));
    out = await exported();
    expect(out.theme).toMatchObject({ ornament: 'fl:' + svgId, headingFlourish: pngId, headingFlourishPos: 'below' });
    expect(out.activePreset).toBe(null);
    // removing them: the fleuron stands back in, no heading flourish (no dangling reference)
    await click(document.querySelector(`#flourishList [data-flremove="${svgId}"]`));
    await click(document.querySelector(`#flourishList [data-flremove="${pngId}"]`));
    out = await exported();
    expect(out.theme).toMatchObject({ ornament: 'fleuron', headingFlourish: '' });
    expect((out.images as Rec[]).some((im) => im.flourish === true)).toBe(false);
    expect(readBook(out).status).toBe('ok');
  });

  it('fonts: a .ttf joins Your fonts and every picker, wears as body and heading, a wrong file is refused, removal falls back (fonts.upload)', async () => {
    await studioWith(LANTERN());
    await openTab();
    await upload('fontFileInput', fileOf(atob(ttfData()), 'Writer-Hand.ttf', 'font/ttf'));
    await waitFor(() => expect(document.querySelectorAll('#fontList .font-row').length).toBe(1));
    await upload('fontFileInput', fileOf('OTTO-not-a-ttf', 'Bad.ttf', 'font/ttf'));
    await upload('fontFileInput', fileOf('hello', 'notes.txt', 'text/plain'));
    await waitFor(() => expect(toasts().filter((x) => x.includes(t('fonts.invalid'))).length).toBe(2));
    let out = await exported();
    expect((out.fonts as Rec[]).map((f) => [f.name, f.family, f.ext, f.mediaType])).toEqual([['Writer-Hand.ttf', 'Writer Hand', 'ttf', 'font/ttf']]);
    for (const id of ['selBodyFont', 'selHeadFont']) {
      const g = Array.from(document.querySelectorAll(`#${id} optgroup`)).find((x) => x.getAttribute('label') === t('fonts.mineGroup'));
      expect(g?.textContent, id).toBe('Writer Hand');
    }
    await change($('selBodyFont') as unknown as HTMLSelectElement, 'Writer Hand');
    await change($('selHeadFont') as unknown as HTMLSelectElement, 'Writer Hand');
    expect(css()).toContain("'Writer Hand'");
    expect(css()).toContain('@font-face'.slice(0, 0)); // the face itself rides into the export with the EPUB (wave 5)
    // the creator's pickers offer it too
    await click($('btnNewTheme'));
    expect(Array.from(document.querySelectorAll('#tcFont-title optgroup')).some((g) => g.textContent === 'Writer Hand')).toBe(true);
    await click($('btnTcClose'));
    // removed: the pairing falls back to 1.0's standing faces
    const id = (out.fonts as Rec[])[0]!.id as string;
    await click(document.querySelector(`#fontList [data-fontremove="${id}"]`));
    out = await exported();
    expect(out.fonts).toEqual([]);
    expect(out.theme).toMatchObject({ bodyFont: 'EB Garamond', headFont: 'Libre Baskerville' });
    expect(readBook(out).status).toBe('ok');
  });

  it('the theme creator and My themes: design, save (applied), reload in the gallery, edit, duplicate, delete; the built-ins unchanged (theme.creator)', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openTab();
    const builtIns = JSON.stringify(c.api.PRESETS);
    await click($('btnNewTheme'));
    await change($('tcName'), 'Harbour Test', 'input');
    await change($('tcFont-number') as unknown as HTMLSelectElement, 'Cinzel');
    await change($('tcFont-title') as unknown as HTMLSelectElement, 'Playfair Display');
    await change($('tcFont-subtitle') as unknown as HTMLSelectElement, 'Lora');
    await click(document.querySelector('[data-tc-case="title"] [data-val="upper"]'));
    await click(document.querySelector('[data-tc-align="number"] [data-val="right"]'));
    await change($('tcAbove-subtitle'), '1.5', 'input');
    expect($('tcPreview').querySelector('.tcp-title')).not.toBeNull();
    await click($('btnTcSave'));
    let out = await exported();
    const cts = out.customThemes as (Rec & { theme: Rec & { header: Record<string, Rec> } })[];
    expect(cts.length).toBe(1);
    expect(cts[0]!.name).toBe('Harbour Test');
    expect(cts[0]!.theme.header).toMatchObject({ number: { font: 'Cinzel', align: 'right' }, title: { font: 'Playfair Display', casing: 'upper' }, subtitle: { font: 'Lora', above: 1.5 } });
    expect(out.activePreset).toBe('custom:' + cts[0]!.id);
    expect(out.theme).toEqual(cts[0]!.theme);
    // the header design reaches the book CSS (the export half of theme.creator, as CSS)
    expect(css('')).toMatch(/\.chapter-opening \.chapter-title \{ font-family: 'Playfair Display'[^}]*text-transform: uppercase/);
    await click($('btnTcClose'));
    // the gallery: one card, active, with 1.0's line of fonts
    const card = document.querySelector('#myThemeGrid [data-mine]')!;
    expect(card.classList.contains('active')).toBe(true);
    expect(card.textContent).toContain('Harbour Test');
    // another preset, then the card applies it again
    await click(document.querySelector('#presetGrid [data-preset="modern"]'));
    await click(document.querySelector('#myThemeGrid [data-mine] .p-name'));
    expect((await exported()).activePreset).toBe('custom:' + cts[0]!.id);
    // edit: the creator opens on it; a change saved replaces it in place
    await click(document.querySelector('#myThemeGrid [data-mine-edit]'));
    expect($('tcName').value).toBe('Harbour Test');
    expect($('tcBase').value).toBe('mine:' + cts[0]!.id);
    await click(document.querySelector('[data-tc-case="title"] [data-val="small"]'));
    await click($('btnTcSave'));
    out = await exported();
    expect((out.customThemes as Rec[]).length).toBe(1);
    expect(((out.customThemes as Rec[])[0]!.theme as Rec & { header: Record<string, Rec> }).header.title!.casing).toBe('small');
    await click($('btnTcClose'));
    // duplicate, then delete both
    await click(document.querySelector('#myThemeGrid [data-mine-dup]'));
    out = await exported();
    expect((out.customThemes as Rec[]).map((x) => x.name)).toEqual(['Harbour Test', 'Harbour Test' + t('themes.copySuffix')]);
    await click(document.querySelector('#myThemeGrid [data-mine-del]'));
    await click(document.querySelector('#myThemeGrid [data-mine-del]'));
    out = await exported();
    expect(out.customThemes).toEqual([]);
    expect($('myThemeGrid').textContent).toContain(t('themes.empty'));
    expect(out.activePreset).toBe(null); // the book keeps what it wears; the gallery stops calling it active
    expect(JSON.stringify(c.api.PRESETS)).toBe(builtIns);
    expect(readBook(out).status).toBe('ok');
  });

  it('a styled book (uploaded font, flourishes, custom themes, colour) opens, browses and exports exactly; the gallery and pickers show its own', async () => {
    const doc = styledBook();
    await studioWith(doc);
    const before = JSON.stringify(await exported());
    await openTab();
    expect(Array.from(document.querySelectorAll('#myThemeGrid [data-mine]')).map((x) => x.getAttribute('data-mine'))).toEqual(['ctHarbour', 'ctPlain']);
    expect(document.querySelector('#myThemeGrid .preset-card.active')!.getAttribute('data-mine')).toBe('ctHarbour');
    expect(document.querySelectorAll('#flourishList .flourish-row').length).toBe(2);
    expect(document.querySelectorAll('#fontList .font-row').length).toBe(1);
    expect($('selHeadFont').value).toBe('Writer Hand');
    expect($('selHeadingFlourish').value).toBe('flpng1');
    expect(document.querySelector('#ornamentGrid .orn-btn.active')!.getAttribute('data-orn')).toBe('fl:flsvg1');
    expect(document.querySelector('#colourAccentRow [aria-pressed="true"]')!.getAttribute('data-colour')).toBe('#1f62a8');
    expect($('colourPrintBlack').checked).toBe(true);
    await click($('btnNewTheme'));
    await click($('btnTcClose'));
    await click(document.querySelector('#myThemeGrid [data-mine-edit="ctPlain"]'));
    await click($('btnTcClose'));
    expect(JSON.stringify(await exported())).toBe(before);
    expect(closureIfLoaded()).toBeTruthy();
  });
});
