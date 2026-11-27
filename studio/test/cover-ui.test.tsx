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
import { styleReset, styleRun } from '../src/style/session';
import { coverFetch, policyPhotos } from '../src/cover/cover';
import { allowedStockUrl } from '../src/pictures/stock';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { PNG_1PX } from './style-fixture';
import { backupClicked } from './backup-wait';

/* Wave 4c, tasks 2 and 3 (inventory D3, D4): the cover maker in the studio — 1.0's markup, wired by 1.0's own
   initCoverMaker, opened from Project Settings' "Make a Cover", every handler run in the Style session. jsdom has no
   canvas: a stand-in 2D context takes 1.0's drawing calls (the painters' pixels are the e2e's, beside 1.0's page).
   Review focus: browsing writes nothing (constraint 45); "Use as My Cover" writes the cover and the recipe; the
   dialog is on the dialog stack (Escape closes it, not Settings beneath it); the stock search's addresses are held to
   the served policy (constraint 44). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

/** A 2D context that takes every call (measureText: 10 px a character), and a canvas that serialises to a JPEG. */
function fakeCtx(): unknown {
  const target: Rec = {
    measureText: (s: string) => ({ width: String(s).length * 10 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => ({}),
    canvas: null,
  };
  return new Proxy(target, {
    get: (o, k) => (k in o ? o[k as string] : () => undefined),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
}
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  HTMLCanvasElement.prototype.getContext = function () {
    return fakeCtx() as never;
  } as never;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==';
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {};
  (window as unknown as { lucide: unknown }).lucide = { icons: {} };
  // jsdom decodes no picture: an Image that loads as soon as it is given a source
  (globalThis as unknown as { Image: unknown }).Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 10;
    naturalHeight = 10;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
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
  // the maker's markup is in place and 1.0's initCoverMaker has wired it (its font list filled)
  await waitFor(() => expect(document.querySelectorAll('#cmElFont option').length).toBeGreaterThan(10), { timeout: 20_000 });
  return r;
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
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const change = (el: HTMLInputElement | HTMLSelectElement, v: string, ev: 'input' | 'change' = 'change') =>
  act(() => {
    el.value = v;
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  });
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = () => $('modalCoverMaker').classList.contains('open');
async function openSettingsAndMaker() {
  await click($('btnSettings2'));
  await waitFor(() => expect($('btnCoverMake')).toBeTruthy(), { timeout: 10_000 });
  await waitFor(() => expect($('coverThumb').querySelector('img, span')).toBeTruthy(), { timeout: 10_000 });
  await click($('btnCoverMake'));
  await waitFor(() => expect(isOpen()).toBe(true));
}

describe('the cover maker in the studio', { timeout: 60_000 }, () => {
  it("opens from Project Settings with 1.0's controls filled from the book's recipe; browsing writes nothing; Escape closes only it", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openSettingsAndMaker();
    const r = doc.coverRecipe as Rec;
    expect($('cmTitle').value).toBe(r.title);
    expect(document.querySelectorAll('#cmLayoutGrid [data-cmlayout]').length).toBe(c.api.COVER_LAYOUTS.length);
    expect(document.querySelector('#cmLayoutGrid .active')!.getAttribute('data-cmlayout')).toBe(r.layout);
    expect(document.querySelectorAll('#cmSwatches [data-cmswatch]').length).toBe(c.api.COVER_PALETTE.length);
    expect(document.querySelector('#cmBgSeg .active')!.getAttribute('data-cmbg')).toBe(r.bgType);
    expect($('cmSpineBody').getAttribute('data-built')).toBe('1');
    expect(document.querySelectorAll('#cmWrapTrim option').length).toBeGreaterThan(5);
    expect($('cmWrapDims').textContent).toMatch(/in/);
    // the words are 1.0's keys
    expect($('cmH').textContent).toBe(t('covermk.title'));
    // browsing: layouts, background types, an element, a size, the wrap's binding — on the maker's own recipe only
    await click(document.querySelector('[data-cmlayout="modern"]'));
    await click(document.querySelector('[data-cmbg="gradient"]'));
    await click(document.querySelector('[data-cmbg="texture"]'));
    await change($('cmElement'), 'author');
    await change($('cmElSize'), '60', 'input');
    await change($('cmHcBinding') as unknown as HTMLSelectElement, 'jacket');
    await change($('cmTitle'), 'Not saved', 'input');
    await new Promise((res) => setTimeout(res, 400));
    expect(isOpen()).toBe(true);
    // Escape closes the maker only (Settings stays open beneath it)
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(isOpen()).toBe(false);
    expect($('modalSettings')).toBeTruthy();
    expect(await exported()).toEqual(want(doc));
  });

  it('Use as My Cover writes the cover and the recipe as 1.0 does; the cover row and the preview follow', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openSettingsAndMaker();
    await change($('cmTitle'), 'The Lantern Coast Again', 'input');
    await click(document.querySelector('[data-cmlayout="framed"]'));
    await click($('btnCmUse'));
    await waitFor(() => expect(isOpen()).toBe(false));
    const out = await exported();
    expect((out.coverRecipe as Rec).title).toBe('The Lantern Coast Again');
    expect((out.coverRecipe as Rec).layout).toBe('framed');
    expect((out.cover as Rec).mediaType).toBe('image/jpeg');
    expect((out.cover as Rec).name).toBe(c.api.slug((doc.meta as Rec).title) + '-cover.jpg');
    expect(readBook(out).status).toBe('ok');
    await waitFor(() => expect(Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent)).toContain(t('toast.coverMade')));
  });

  it("cover picture: move and zoom — the picture's sliders show with the art, write the placement Use as My Cover keeps, and Reset picture takes it away", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openSettingsAndMaker();
    // the book's cover paints its art: the picture's controls show once the picture is decoded
    await waitFor(() => expect($('cmPicRow').style.display).toBe(''));
    expect($('btnCmResetPic').style.display).toBe('');
    for (const [id, key] of [['cmPicH', 'covermk.picH'], ['cmPicV', 'covermk.picV'], ['cmPicZoom', 'covermk.picZoom']] as const) {
      const lab = document.querySelector(`label[for="${id}"]`)!;
      expect(lab.textContent).toContain(t(key)); // labelled, in 1.0's words
    }
    expect([$('cmPicH').value, $('cmPicV').value, $('cmPicZoom').value]).toEqual(['500', '500', '100']); // centred at 1× until moved
    expect($('cmPicZoomVal').textContent).toBe('100%');
    await change($('cmPicH'), '200', 'input');
    await change($('cmPicV'), '800', 'input');
    await change($('cmPicZoom'), '250', 'input');
    expect(c.vars.cmRecipe).toMatchObject({ bgFocus: { x: 0.2, y: 0.8 }, bgZoom: 2.5 });
    expect($('cmPicHVal').textContent).toBe('20%');
    expect($('cmPicZoom').getAttribute('aria-valuetext')).toBe('250%');
    await click($('btnCmUse'));
    await waitFor(() => expect(isOpen()).toBe(false));
    const out = await exported();
    expect((out.coverRecipe as Rec).bgFocus).toEqual({ x: 0.2, y: 0.8 });
    expect((out.coverRecipe as Rec).bgZoom).toBe(2.5);
    expect(readBook(out).status).toBe('ok');
    // opened again, the maker reads the placement back; Reset picture takes it away, and the cover is as it was
    await openSettingsAndMaker();
    await waitFor(() => expect($('cmPicRow').style.display).toBe(''));
    expect([$('cmPicH').value, $('cmPicV').value, $('cmPicZoom').value]).toEqual(['200', '800', '250']);
    await click($('btnCmResetPic'));
    expect([$('cmPicH').value, $('cmPicV').value, $('cmPicZoom').value]).toEqual(['500', '500', '100']);
    await click($('btnCmUse'));
    await waitFor(() => expect(isOpen()).toBe(false));
    const back = (await exported()).coverRecipe as Rec;
    expect('bgFocus' in back || 'bgZoom' in back).toBe(false);
  });

  it('review of PR #66, fix 1: a drag on a picture that just fills one axis does not move it along that axis (1400 × 2100 at 1×, 20 px across with 1 px of vertical wobble)', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openSettingsAndMaker();
    await waitFor(() => expect($('cmPicRow').style.display).toBe(''));
    const id = (doc.coverRecipe as Rec).bgImageId as string;
    (c.api.coverImgCache as unknown as Rec)[id] = { naturalWidth: 1400, naturalHeight: 2100, width: 1400, height: 2100 };
    const cv = document.getElementById('cmCanvas') as HTMLCanvasElement;
    // the precondition the review measured: floating point leaves a hair of slack on the filled (vertical) axis
    const r = c.api.coverArtRect(1400, 2100, cv.width, cv.height);
    expect(r.h - cv.height).toBeGreaterThan(0);
    expect(r.h - cv.height).toBeLessThan(1e-9);
    cv.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: cv.width, bottom: cv.height, width: cv.width, height: cv.height, toJSON: () => ({}) }) as DOMRect;
    const boxes = c.vars.cmBlocks as { left: number; top: number; right: number; bottom: number }[];
    const at = [[0.05, 0.62], [0.95, 0.62], [0.05, 0.97], [0.5, 0.62]].map(([fx, fy]) => ({ x: fx! * cv.width, y: fy! * cv.height }))
      .find((p) => !boxes.some((b) => p.x >= b.left - 8 && p.x <= b.right + 8 && p.y >= b.top - 8 && p.y <= b.bottom + 8))!;
    expect(at).toBeTruthy();
    const PE = (window as unknown as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
    const fire = (type: string, x: number, y: number) => act(() => void cv.dispatchEvent(new PE(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })));
    await fire('pointerdown', at.x, at.y);
    await fire('pointermove', at.x + 10, at.y);
    await fire('pointermove', at.x + 20, at.y + 1);
    await fire('pointerup', at.x + 20, at.y + 1);
    const rc = c.vars.cmRecipe as Rec & { bgFocus: { x: number; y: number } };
    expect(rc.bgFocus.y).toBe(0.5); // RED before the fix: 0 (1 px ÷ 2e-13 px of slack)
    expect(rc.bgFocus.x).toBeCloseTo(0.5 - 20 / (r.w - cv.width), 9); // the axis with room moves as dragged
    expect(rc.bgZoom).toBe(1);
  });

  it('review of PR #66, fix 3: the soft-print line asks to zoom out only when 100% would be sharp enough; else only for a larger picture', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openSettingsAndMaker();
    await waitFor(() => expect($('cmPicRow').style.display).toBe(''));
    const id = (doc.coverRecipe as Rec).bgImageId as string;
    const geo = styleRun((cc) => ({ tr: cc.api.trimSize(), d: cc.api.wrapDims(cc.vars.cmRecipe) }))!;
    // the print cover's ppi at a placement: the lower of the trim and the wrap's front panel (cmPicPrintPpi)
    const ppi = (iw: number, ih: number, zoom: number) => Math.min(c.api.coverArtPpi(iw, ih, geo.tr.w, geo.tr.h, { x: 0.5, y: 0.5, zoom }), c.api.coverArtPpi(iw, ih, geo.d.layout.panelW, geo.d.layout.panelH, { x: 0.5, y: 0.5, zoom }));
    const soft = () => ({ shown: $('cmPicSoft').style.display === '', text: $('cmPicSoft').textContent });
    const use = async (iw: number, ih: number, zoom: string) => {
      (c.api.coverImgCache as unknown as Rec)[id] = { naturalWidth: iw, naturalHeight: ih, width: iw, height: ih };
      await change($('cmPicZoom'), zoom, 'input');
    };
    // 300 ppi at 100%: zoomed to 200% it is about 150 — zooming out helps, and the line says so
    const big = [Math.round(geo.tr.w * 300), Math.round(geo.tr.h * 300)] as const;
    await use(big[0], big[1], '100');
    expect(soft().shown).toBe(false);
    await use(big[0], big[1], '200');
    expect(ppi(big[0], big[1], 1)).toBeGreaterThanOrEqual(200);
    expect(soft()).toEqual({ shown: true, text: t('covermk.picSoft', { ppi: Math.floor(ppi(big[0], big[1], 2)), need: 200 }) });
    expect(soft().text).toContain('Zoom out');
    // 150 ppi at 100%: zooming out cannot reach 200, so the line asks only for a larger picture
    const small = [Math.round(geo.tr.w * 150), Math.round(geo.tr.h * 150)] as const;
    await use(small[0], small[1], '120');
    expect(ppi(small[0], small[1], 1)).toBeLessThan(200);
    expect(soft()).toEqual({ shown: true, text: t('covermk.picSoftLarger', { ppi: Math.floor(ppi(small[0], small[1], 1.2)), need: 200, full: Math.floor(ppi(small[0], small[1], 1)) }) });
    expect(soft().text).not.toContain('Zoom out');
    expect(soft().text).toContain('larger picture');
  });

  it('review, Important 1: the maker opened again after its markup is drawn anew (another book, then back) dresses the 3D book and starts with the guides on', async () => {
    const doc = LANTERN();
    const r = await studioWith(doc);
    await openSettingsAndMaker();
    await waitFor(() => expect($('cm3dFaceFront').style.backgroundImage).toMatch(/^url\(/));
    await click($('btnCmWrapGuides')); // guides off in this markup
    await click($('btnCmCancel'));
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    r.unmount();
    // the same book drawn again: the 3D state 1.0 keeps (its signatures) must not stand for the new markup
    render(<LocaleProvider initial="en"><App /></LocaleProvider>);
    await waitFor(() => expect(document.querySelectorAll('#cmElFont option').length).toBeGreaterThan(10), { timeout: 20_000 });
    await openSettingsAndMaker();
    await waitFor(() => expect($('cm3dFaceFront').style.backgroundImage).toMatch(/^url\(/));
    expect(c.vars.cmWrapGuides).toBe(true);
    expect($('btnCmWrapGuides').getAttribute('aria-pressed')).toBe('true');
  });

  it("Upload Cover and Remove in Project Settings: 1.0's handlers, the row redrawn", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await click($('btnSettings2'));
    await waitFor(() => expect($('coverThumb').querySelector('img')).toBeTruthy(), { timeout: 10_000 });
    expect($('btnCoverRemove').style.display).toBe('');
    const inp = $('coverInput');
    Object.defineProperty(inp, 'files', { value: [new File([Uint8Array.from(atob(PNG_1PX), (ch) => ch.charCodeAt(0))], 'mine.png', { type: 'image/png' })], configurable: true });
    await act(async () => void inp.dispatchEvent(new Event('change', { bubbles: true })));
    await waitFor(async () => expect(((await exported()).cover as Rec)?.name).toBe('mine.png'));
    expect((await exported()).coverRecipe).toBeNull();
    await waitFor(() => expect($('coverNote').textContent).toContain('mine.png'));
    await click($('btnCoverRemove'));
    await waitFor(() => expect($('coverThumb').querySelector('img')).toBeNull());
    expect((await exported()).cover).toBeNull();
    expect($('coverNote').textContent).toBe(t('set.coverNote'));
  });

  it("a hostile recipe and pictures: the maker's markup carries no handler and no foreign source", async () => {
    const doc = LANTERN();
    const tag = '<img src="https://evil.example/x.png" onerror="window.__pw=1">';
    const r = doc.coverRecipe as Rec & { elements: Record<string, Rec> };
    r.title = 'Title ' + tag;
    r.elements.title!.font = "x'; } body { display:none } .y { font-family: '";
    r.bgColor = 'red" onmouseover="window.__pw=2';
    doc.images = [...((doc.images as Rec[]) ?? []), { id: 'bad" onclick="window.__pw=3', name: 'n' + tag, mediaType: 'image/png" onerror="window.__pw=4', ext: 'png', data: PNG_1PX },
      // review, Important 2: an id that would put ids of the maker's own into the page
      { id: 'x" id="cmWrapCanvas', name: 'm', mediaType: 'image/png', ext: 'png', data: PNG_1PX }, { id: 'y" id="cmPhotoQuery" value="evil', name: 'q', mediaType: 'image/png', ext: 'png', data: PNG_1PX }];
    await studioWith(doc);
    await openSettingsAndMaker();
    await click(document.querySelector('[data-cmbg="image"]'));
    const root = $('modalCoverMaker');
    const attrs = Array.from(root.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((a) => a.name + '=' + a.value));
    expect(attrs.filter((a) => /^on/i.test(a))).toEqual([]);
    // a source the page would load (src, href, srcset, style url) names nothing foreign; text attributes (a title) may say anything
    const loads = attrs.filter((a) => /^(src|href|srcset|style|xlink:href)=/i.test(a) && /evil|javascript:|url\((?!"data:image\/jpeg;base64,)/i.test(a)); // the stand's faces: the wrap's own JPEG slices
    expect(loads, loads.join(' | ')).toEqual([]);
    expect(root.querySelectorAll('script, iframe, object, embed, link').length).toBe(0);
    expect((window as unknown as { __pw?: unknown }).__pw).toBeUndefined();
    expect($('cmTitle').value).toContain('Title');
    for (const id of ['cmWrapCanvas', 'cmPhotoQuery']) expect(document.querySelectorAll('#' + id).length, id).toBe(1);
    expect(document.getElementById('cmWrapCanvas')!.tagName).toBe('CANVAS');
    expect(await exported()).toEqual(want(doc));
  });
});

describe('review round 2, Minor 2: "Make a Cover" before the maker is built', { timeout: 60_000 }, () => {
  it('does nothing (the button waits) while the maker is not yet in place: no error, no working recipe left set', async () => {
    const w = window as unknown as { lucide?: unknown };
    const keep = w.lucide;
    delete w.lucide; // jsdom never runs the script: the maker waits for Lucide, as a slow network would make it
    try {
      await importToDevice(LANTERN());
      render(<LocaleProvider initial="en"><App /></LocaleProvider>);
      await waitFor(() => expect($('tabBtnType').getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
      await click($('btnSettings2'));
      await waitFor(() => expect($('btnCoverMake')).toBeTruthy(), { timeout: 10_000 });
      expect(document.getElementById('cmTitle')).toBeNull();
      expect(($('btnCoverMake') as unknown as HTMLButtonElement).disabled).toBe(true);
      const errors: unknown[] = [];
      const onErr = (e: ErrorEvent) => errors.push(e.error);
      window.addEventListener('error', onErr);
      ($('btnCoverMake') as unknown as HTMLButtonElement).disabled = false; // even if it were clicked
      await click($('btnCoverMake'));
      window.removeEventListener('error', onErr);
      expect(errors).toEqual([]);
      expect(c.vars.cmRecipe).toBeNull();
    } finally {
      w.lucide = keep;
    }
  });
});

describe('the stock search under the served policy (constraint 44)', () => {
  it('results keep only the addresses the policy allows; a refused address is never fetched', async () => {
    const out = policyPhotos({ photos: [
      { photographer: 'A', src: { medium: 'https://images.pexels.com/a-m.jpg', large: 'https://evil.example/a.jpg' } },
      { photographer: 'B', src: { medium: 'https://evil.example/b.jpg' } },
      { photographer: 'C', src: { medium: 'javascript:alert(1)', original: 'https://api.openverse.org/v1/images/c/thumb/' } },
    ] }) as { photos: { photographer: string; src: Rec }[] };
    expect(out.photos.map((p) => p.photographer)).toEqual(['A', 'C']);
    expect(out.photos[0]!.src).toEqual({ medium: 'https://images.pexels.com/a-m.jpg' });
    expect(out.photos[1]!.src).toEqual({ original: 'https://api.openverse.org/v1/images/c/thumb/' });
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(Uint8Array.from(atob(PNG_1PX), (ch) => ch.charCodeAt(0))));
    await expect(coverFetch('https://evil.example/x.jpg')).rejects.toThrow(/refused/);
    expect(f).not.toHaveBeenCalled();
    const ok = await coverFetch('https://images.pexels.com/p.png');
    expect((await ok.blob()).type).toBe('image/png');
    f.mockImplementation(async () => new Response('<html>not a picture</html>'));
    const bad = await coverFetch('https://images.pexels.com/p.png');
    await expect(bad.blob()).rejects.toThrow(/JPEG or a PNG/);
  });

  it('review round 2, Minor 3: a result naming this origin (absolute or relative) is not a stock address; a same-origin body read as a picture is sniffed too', async () => {
    const here = location.origin;
    for (const u of [here + '/api/me.png', '/api/me.png', 'me.png', '//images.pexels.com/x.jpg']) expect(allowedStockUrl(u), u).toBe(false);
    expect(allowedStockUrl('https://images.pexels.com/photos/1/x.jpeg')).toBe(true); // the shelf's proxy hands Pexels' own addresses
    const out = policyPhotos({ photos: [{ photographer: 'S', src: { medium: '/api/account', large: here + '/x.png' } }] }) as { photos: unknown[] };
    expect(out.photos).toEqual([]);
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"secret":1}', { headers: { 'content-type': 'image/png' } }));
    const r = await coverFetch(here + '/assets/x.png');
    await expect(r.blob()).rejects.toThrow(/JPEG or a PNG/);
    f.mockImplementation(async () => new Response(Uint8Array.from(atob(PNG_1PX), (ch) => ch.charCodeAt(0))));
    expect((await (await coverFetch(here + '/assets/x.png')).blob()).type).toBe('image/png');
  });
});
