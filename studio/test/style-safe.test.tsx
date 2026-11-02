import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { cleanFragment, safeHtml, styleReset, styleRoot, styleRun } from '../src/style/session';
import { fixtures } from './fixtures';
import { PNG_1PX, ttfData } from './style-fixture';

/* Wave 4a, security fix (coordinator's review of session.ts): 1.0's Style renderers build HTML strings with book
   values — some unescaped (a flourish's mediaType in an <img src>, a font family in a style attribute). The book is
   untrusted, so:
   - the cleaner is an ALLOWLIST of the tags and attributes 1.0's Style markup really uses; style attributes keep only
     the typographic properties 1.0 sets, with plain values; SVG animation, <use>, <a>, <foreignObject>, <math> never
     pass; an <img src> only through 2.0's checked picture URL;
   - every HTML path 1.0's code could take through the tab's elements (innerHTML, outerHTML, insertAdjacentHTML,
     setHTMLUnsafe) goes through it;
   - at the source: an uploaded font whose family is not a plain name is refused in the session (never registered,
     never offered); a flourish's mediaType that is not a plain media type is not handed to 1.0's markup. */

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
  (window as unknown as { __pwned?: number }).__pwned = 0;
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  styleRoot.el = null;
  desk.ydoc = null;
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const PAYLOADS = [
  '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><use href="data:image/svg+xml,&lt;svg onload=alert(1)&gt;"/></svg>',
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<img src="javascript:alert(1)">',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<a href="javascript:alert(1)">x</a>',
  '<button formaction="javascript:alert(1)">x</button>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<span style="font-family:\'x\';background-image:url(https://evil.invalid/x)">s</span>',
];
const DANGER = /javascript:|onerror|onload|<script|<iframe|<animate|<set\b|<use\b|<a\b|<foreignobject|<math|url\(|href=|formaction|srcdoc/i;

describe('the allowlist cleaner', () => {
  it('every payload comes out inert', () => {
    for (const p of PAYLOADS) {
      const tpl = document.createElement('template');
      tpl.innerHTML = p;
      cleanFragment(tpl.content);
      expect(tpl.innerHTML, p).not.toMatch(DANGER);
    }
  });

  it('1.0\'s own Style markup passes unchanged in what it shows (presets with their fonts, ornament SVGs, swatches, the creator)', () => {
    const host = document.createElement('div');
    const card = '<button class="preset-card" data-preset="classic"><span class="p-name" style="font-family:\'Libre Baskerville\', serif;">Classic</span></button>';
    safeHtml(host, card + c.api.ornamentSvg('doublerule') + c.api.ornamentSvg('infinity') +
      '<button type="button" class="colour-sw" data-colour-kind="accent" data-colour="#1f62a8" style="--sw:#1f62a8" aria-pressed="false" aria-label="Azure" title="Azure"></button>' +
      '<label class="field-lab" for="tcSize-title">Size · <span class="range-val" id="tcSizeVal-title"></span></label><input type="range" id="tcSize-title" data-tc-size="title" min="0.4" max="3.2" step="0.05" />' +
      '<p class="tcp-title" style="font-family:\'EB Garamond\', \'Noto Serif Devanagari\', \'Amiri\', Georgia, \'Times New Roman\', serif;font-size:31.5px;text-align:center;text-transform:uppercase;margin:0.0px 0 0.0px 0;font-weight:600;line-height:1.2;">T</p>' +
      '<select><optgroup label="Library"><option value="Lora">Lora</option></optgroup></select>');
    expect(host.querySelector('.p-name')!.getAttribute('style')).toContain("font-family:'Libre Baskerville', serif");
    expect(host.querySelectorAll('svg path, svg rect, svg circle').length).toBeGreaterThan(3);
    expect(host.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 120 24');
    expect(host.querySelector('rect[fill]')!.getAttribute('fill')).toBe('var(--orn-bg, #fff)');
    expect(host.querySelector('.colour-sw')!.getAttribute('style')).toBe('--sw:#1f62a8');
    expect(host.querySelector('input[type="range"]')!.getAttribute('max')).toBe('3.2');
    expect(host.querySelector('.tcp-title')!.getAttribute('style')).toContain('text-transform:uppercase');
    expect(host.querySelector('optgroup')!.getAttribute('label')).toBe('Library');
  });

  it('the tab\'s elements route innerHTML, outerHTML, insertAdjacentHTML and setHTMLUnsafe through the cleaner', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<div id="presetGrid"></div><div id="fontList"><span id="inner"></span></div>';
    document.body.appendChild(host);
    styleRoot.el = host;
    const { pageEnv } = await import('../src/closure/index');
    const evil = '<img src=x onerror="window.__pwned=1"><svg><animate attributeName="href" values="javascript:alert(1)"/></svg>';
    const grid = pageEnv.$('presetGrid') as HTMLElement;
    grid.innerHTML = evil;
    grid.insertAdjacentHTML('beforeend', evil);
    (grid as unknown as { setHTMLUnsafe?: (h: string) => void }).setHTMLUnsafe?.(evil + evil);
    (pageEnv.$('inner') as HTMLElement).outerHTML = evil;
    expect(host.innerHTML).not.toMatch(DANGER);
    host.remove();
  });
});

describe('at the source: book values that would break 1.0\'s markup', { timeout: 60_000 }, () => {
  it('a font named "<img src=x onerror=…>" and a flourish with a hostile mediaType render inert; the font is refused, the flourish kept', async () => {
    const doc = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
    doc.fonts = [
      { id: 'bad1', name: 'x.ttf', family: '<img src=x onerror=window.__pwned=1>', ext: 'ttf', mediaType: 'font/ttf', data: ttfData() },
      { id: 'bad2', name: 'y.ttf', family: "Q'); } * { x: url(y", ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 11) },
      { id: 'ok1', name: 'z.ttf', family: 'Garamond 3', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 5) },
    ];
    doc.images = [{ id: 'flx', name: '<img src=x onerror=window.__pwned=1>', mediaType: 'image/png" onerror="window.__pwned=1', ext: 'png', data: PNG_1PX, flourish: true }];
    doc.customThemes = [{ id: 'ctx', name: '<img src=x onerror=window.__pwned=1>', theme: { ...(doc.theme as Rec), header: { number: { font: '<img src=x onerror=window.__pwned=1>', size: 1, align: 'center', casing: 'upper', above: 0, below: 0 }, title: { font: 'x" onmouseover="window.__pwned=1', size: 2, align: 'center', casing: 'asis', above: 0, below: 0 }, subtitle: { font: 'Lora', size: 1, align: 'center', casing: 'asis', above: 0, below: 0 } } } }];
    await importToDevice(doc);
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('tabBtnType')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    await act(async () => void fireEvent.click(document.getElementById('tabBtnType')!));
    await waitFor(() => expect(document.querySelectorAll('#presetGrid [data-preset]').length).toBe(15), { timeout: 20_000 });
    await act(async () => void fireEvent.click(document.querySelector('#myThemeGrid [data-mine-edit]')!));
    await new Promise((r) => setTimeout(r, 50));
    // no element of the tab carries a handler, a url() or an unchecked picture (the names show as escaped text)
    const bad: string[] = [];
    for (const el of Array.from(document.getElementById('panelType')!.querySelectorAll('*'))) {
      for (const at of Array.from(el.attributes)) if (/^on/i.test(at.name) || /url\(|javascript:/i.test(at.value)) bad.push(el.tagName + ' ' + at.name + '=' + at.value);
      if (el.tagName === 'IMG' && !/^data:image\/(png|svg\+xml);base64,/.test(el.getAttribute('src') || '')) bad.push('img ' + el.getAttribute('src'));
    }
    expect(bad).toEqual([]);
    expect((window as unknown as { __pwned?: number }).__pwned).toBe(0);
    // the names show as text
    expect(document.getElementById('myThemeGrid')!.textContent).toContain('<img src=x onerror=window.__pwned=1>');
    // the hostile families are refused (not listed, not offered); the plain one stays
    expect(Array.from(document.querySelectorAll('#fontList .fl-name')).map((x) => x.textContent)).toEqual(['Garamond 3']);
    expect(Array.from(document.querySelectorAll('#selBodyFont option')).map((o) => (o as HTMLOptionElement).value)).not.toContain('<img src=x onerror=window.__pwned=1>');
    // the flourish is kept, its thumbnail from 2.0's checked URL
    const thumb = document.querySelector('#ornamentGrid img.orn-thumb');
    expect(thumb?.getAttribute('src')).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(styleRun((cc) => (cc.getState() as unknown as { fonts: Rec[] }).fonts.map((f) => f.id))).toEqual(['ok1']);
  });
});
