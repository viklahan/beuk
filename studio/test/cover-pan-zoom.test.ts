import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleRelease, styleReset, styleRun } from '../src/style/session';
import { fixtures } from './fixtures';

/* Cover picture: move and zoom (docs/superpowers/specs/2026-11-27-cover-art-pan-zoom-design.md).

   The pins: every call 1.0's cover painters make on a canvas, recorded (a 2D context that writes down each method
   call with its arguments and each property it is given), for covers that carry no picture placement — the writer's
   art (landscape and portrait), a stock photo, duotone over art, the built-in duotone scene, solid, gradient — on
   the front cover (the maker's preview size and the e-book render), and on the print wrap (paperback and dust
   jacket). Each log's SHA-256 was recorded on the code BEFORE the placement existed (main 3dcabd1). Equal logs mean
   the same pixels: the canvas was told exactly the same things in the same order. A cover with no new fields must
   still produce exactly these logs. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

/* ---- the recording context ---- */
let log: unknown[] = [];
let canvasSeq = 0;
const tagOf = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    const o = v as Rec;
    if (typeof o.__tag === 'string') return o.__tag;
    if (o instanceof HTMLCanvasElement) {
      const cv = o as HTMLCanvasElement & { __id?: number };
      if (cv.__id == null) cv.__id = ++canvasSeq;
      return `canvas#${cv.__id}:${cv.width}x${cv.height}`;
    }
    if (o.data instanceof Uint8ClampedArray) return `imagedata:${o.width}x${o.height}:` + createHash('sha256').update(o.data as Uint8ClampedArray).digest('hex').slice(0, 16);
    if (Array.isArray(v)) return v.map(tagOf);
    return JSON.stringify(v);
  }
  return v;
};
function recordingCtx(canvas: HTMLCanvasElement): unknown {
  let gradSeq = 0;
  const target: Rec = {
    canvas,
    measureText: (s: string) => {
      log.push(['measureText', s]);
      return { width: String(s).length * 10 };
    },
    getImageData: (x: number, y: number, w: number, h: number) => {
      log.push(['getImageData', x, y, w, h]);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) & 255; // deterministic stand-in pixels
      return { data, width: w, height: h };
    },
  };
  const grad = (kind: string) => (...args: unknown[]) => {
    const tag = `${kind}#${++gradSeq}`;
    log.push([kind, ...args.map(tagOf), '->', tag]);
    return { __tag: tag, addColorStop: (o: number, col: string) => log.push([tag + '.addColorStop', o, col]) };
  };
  target.createLinearGradient = grad('createLinearGradient');
  target.createRadialGradient = grad('createRadialGradient');
  return new Proxy(target, {
    get: (o, k) => {
      if (k in o) return o[k as string];
      return (...args: unknown[]) => {
        log.push([String(k), ...args.map(tagOf)]);
        return undefined;
      };
    },
    set: (o, k, v) => {
      log.push(['=', String(k), tagOf(v)]);
      return true;
    },
  });
}
const fakeImage = (tag: string, w: number, h: number) => ({ __tag: tag, naturalWidth: w, naturalHeight: h, width: w, height: h });

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const self = this as HTMLCanvasElement & { __ctx?: unknown };
    if (!self.__ctx) self.__ctx = recordingCtx(this);
    return self.__ctx as never;
  } as never;
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {};
  (window as unknown as { lucide: unknown }).lucide = { icons: {} };
});
beforeEach(() => styleRelease());
afterEach(() => {
  desk.ydoc = null;
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  return y;
};
const LANTERN = () => structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
const run = <T>(fn: (a: Closure['api']) => T): T => styleRun((cc) => fn(cc.api))!;
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

type Recipe = Rec & { wrap: Rec; elements: Record<string, Rec> };
/** The pinned covers: none of them carries a picture placement. */
function pinRecipes(a: Closure['api']): Record<string, Recipe> {
  const base = () => a.defaultCoverRecipe() as unknown as Recipe;
  const mk = (over: Rec) => Object.assign(base(), over) as Recipe;
  const out: Record<string, Recipe> = {
    'art-landscape': mk({ bgType: 'image', bgImageId: 'pin-land', layout: 'classic', title: 'The Lantern Coast', author: 'A Writer', tagline: 'Salt and patience' }),
    'art-portrait-free': mk({ bgType: 'image', bgImageId: 'pin-tall', layout: 'free', title: 'Free', subtitle: 'Placed by hand', author: 'A Writer' }),
    photo: mk({ bgType: 'photo', bgImageId: 'pin-photo', layout: 'banded', title: 'A Stock Photo', author: 'A Writer' }),
    'duotone-art': mk({ bgType: 'duotone', bgImageId: 'pin-square', bgColor: '#18262e', bgColor2: '#dcb96f', title: 'Two Inks', author: 'A Writer' }),
    'duotone-scene': mk({ bgType: 'duotone', bgImageId: null, title: 'Harbour', author: 'A Writer' }),
    solid: mk({ bgType: 'solid', bgColor: '#3b2f63', layout: 'framed', title: 'Solid', author: 'A Writer' }),
    gradient: mk({ bgType: 'gradient', bgColor: '#1e3a5f', bgColor2: '#c9a959', layout: 'editorial', title: 'Gradient', author: 'A Writer' }),
  };
  out['art-portrait-free']!.elements.title!.pos = { x: 0.3, y: 0.5 };
  return out;
}
function putPictures(a: Closure['api']): void {
  const cache = a.coverImgCache as unknown as Rec;
  cache['pin-land'] = fakeImage('img:land', 3000, 2000);
  cache['pin-tall'] = fakeImage('img:tall', 1000, 3000);
  cache['pin-photo'] = fakeImage('img:photo', 1800, 1200);
  cache['pin-square'] = fakeImage('img:square', 1200, 1200);
}
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}
/** The logs of every pinned render, hashed. */
function renderLogs(a: Closure['api'], recipes: Record<string, Recipe>): Record<string, string> {
  const out: Record<string, string> = {};
  const capture = (name: string, paint: () => unknown) => {
    log = [];
    canvasSeq = 0;
    const ret = paint();
    out[name] = sha([log, tagOf(ret)]);
  };
  for (const [name, r] of Object.entries(recipes)) {
    const n = a.normalizeCoverRecipe(structuredClone(r)) as Recipe;
    capture(`front-800:${name}`, () => a.drawCoverTo(canvasOf(800, 1280), n));
    capture(`front-ebook:${name}`, () => a.renderCoverCanvas(n, a.COVER_EBOOK_W, a.COVER_EBOOK_H));
  }
  for (const name of ['art-landscape', 'photo', 'duotone-art', 'solid']) {
    const n = a.normalizeCoverRecipe(structuredClone(recipes[name])) as Recipe;
    n.wrap = Object.assign(a.wrapDefaults(), { trim: '6x9', pages: 300, paper: 'white', blurb: 'A blurb.', quote: 'A quote.', imprint: 'Imprint' });
    capture(`wrap-paperback:${name}`, () => {
      const d = a.wrapDims(n);
      return a.drawWrapTo(canvasOf(Math.round(d.totalW * 60), Math.round(d.totalH * 60)), n, { guides: true });
    });
    n.wrap = Object.assign(a.wrapDefaults(), { trim: '6x9', pages: 300, binding: 'jacket', hcSpine: 0.75 });
    capture(`wrap-jacket:${name}`, () => {
      const d = a.wrapDims(n);
      return a.drawWrapTo(canvasOf(Math.round(d.totalW * 60), Math.round(d.totalH * 60)), n, {});
    });
  }
  return out;
}

/* Recorded on main 3dcabd1, before the placement code existed. */
const PINS: Record<string, string> = {
  'front-800:art-landscape': '940c7440c0f5f607aab915c62cba8764267a44f29e319f5c42f15b7cfbe88591',
  'front-800:art-portrait-free': '6c85dfe461df5f13580bd414c95aa297b7b7bf35913ff75ea3b40dd45f3f5a69',
  'front-800:duotone-art': 'aebc0f973e47c8b58be70d622094d1c039ec7aba1c093ff0e517b94a162e236c',
  'front-800:duotone-scene': '6701620f16e795ed670f3d0a18418154826da50b18daa1aacc45e3d227f8c977',
  'front-800:gradient': 'da69a8010661af66c9eeb83ecbddfbdb5337990e5a73620d6ae79f4f9687364c',
  'front-800:photo': 'a198f3823fc2097a77aae2b260f7cdd03f2eba199d526f47ce9f7dac1e4ff623',
  'front-800:solid': '41a6aeca2d3b77fae72825f94a7138522c0c14ba23911ff963911714810abf6c',
  'front-ebook:art-landscape': 'ae85629e910e8eefcc90ab495c9f66e8e99fc1894eae5181b861c5761d89058e',
  'front-ebook:art-portrait-free': 'a9f76f5403f29ca0af30a70606ff7c28770ad66fa6a0bd09331b67b955f2cc89',
  'front-ebook:duotone-art': '9822b1609d67e21baa74178ae4024b6efadad4466b5552cccc176e71a55d19d8',
  'front-ebook:duotone-scene': '131199d365d373d501863d7c473348a5be8c53ca2019af80914fa11e19c789b4',
  'front-ebook:gradient': '80f91d966fbe55c416e60865daf6739dfb9b099282010971f41239dca8df84aa',
  'front-ebook:photo': '597599405620dc2e42322a11efbd79d15ad9a433a06514b5b638ecf844cff5d4',
  'front-ebook:solid': '5e6abc6a12b8e34a6674ab2ebd8472c18919fc16b64984995a1ed117017a43f7',
  'wrap-jacket:art-landscape': 'c9f3f0f8a75667093905aa17186982f129b40836eb2630dccacf08eeb50d916f',
  'wrap-jacket:duotone-art': 'ffacfcb324f2e76afb640a705952cd7ed88abc9bfccc5c237eb84ca044a4764d',
  'wrap-jacket:photo': '9c24f431a23570964ce91f345a5e3e11327fe4447945f674138c9f80d9df50b8',
  'wrap-jacket:solid': 'e63718d35389ceb1d7f523d284bd8bfa5eca8cae753f6116638af31bf866ae85',
  'wrap-paperback:art-landscape': '59bfac6175f1c919f52b2c168ece8aefa2998413978cb83460b3d912eb34bcf2',
  'wrap-paperback:duotone-art': '7e9e5e249e4e0280d68cb8f72564a6f7a9c5f97ae9ccd76aedc1c87277e50a5f',
  'wrap-paperback:photo': 'eaaec355330ec791414d60f6e5910855c393d7b6880f807d68ea76539c5b3230',
  'wrap-paperback:solid': '4f3cc3bf590480fa2a5424ffab829afb8faf3dbbf03d871b43bb502c8d29d937',
};

describe('cover picture placement: covers without it render exactly as before', () => {
  it('the canvas calls of every pinned cover are the ones recorded before the placement existed', () => {
    onDesk(LANTERN());
    const got = run((a) => {
      putPictures(a);
      return renderLogs(a, pinRecipes(a));
    });
    expect(got).toEqual(PINS);
  });
});

describe('cover picture placement: the maths (1.0 coverArtPlace, coverArtRect, coverArtPpi)', () => {
  it('absent placement is centred at 1×; values are held to 0–1 and 1–3×; junk falls back to the centre', () => {
    const a = c.api;
    expect(a.COVER_ZOOM_MAX).toBe(3);
    expect(a.coverArtPlace({})).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(a.coverArtPlace(null)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(a.coverArtPlace({ bgFocus: { x: -0.4, y: 7 }, bgZoom: 12 })).toEqual({ x: 0, y: 1, zoom: 3 });
    expect(a.coverArtPlace({ bgFocus: { x: 'left', y: 0.25 }, bgZoom: 0.3 })).toEqual({ x: 0.5, y: 0.25, zoom: 1 });
    expect(a.coverArtPlace({ bgFocus: { x: 0.1, y: 0.9 }, bgZoom: 'big' })).toEqual({ x: 0.1, y: 0.9, zoom: 1 });
  });

  it('the centred 1× rectangle is exactly the old centred cover-crop', () => {
    const a = c.api;
    for (const [iw, ih, W, H] of [[3000, 2000, 800, 1280], [1000, 3000, 1600, 2560], [37, 91, 1800, 2700], [1200, 1200, 1650, 2550]] as const) {
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale, dh = ih * scale;
      expect(a.coverArtRect(iw, ih, W, H, a.coverArtPlace({}))).toEqual({ x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh, scale });
      expect(a.coverArtRect(iw, ih, W, H)).toEqual(a.coverArtRect(iw, ih, W, H, a.coverArtPlace({})));
    }
  });

  it('no placement leaves a gap: the picture always covers the whole cover, at every focus and zoom', () => {
    const a = c.api;
    let n = 0;
    for (const [iw, ih] of [[3000, 2000], [1000, 3000], [800, 1280], [50, 40], [4000, 400]] as const)
      for (const x of [0, 0.01, 0.37, 0.5, 0.99, 1])
        for (const y of [0, 0.5, 1])
          for (const zoom of [1, 1.01, 1.7, 2.5, 3]) {
            const r = a.coverArtRect(iw, ih, 800, 1280, { x, y, zoom });
            expect(r.x).toBeLessThanOrEqual(1e-9);
            expect(r.y).toBeLessThanOrEqual(1e-9);
            expect(r.x + r.w).toBeGreaterThanOrEqual(800 - 1e-9);
            expect(r.y + r.h).toBeGreaterThanOrEqual(1280 - 1e-9);
            n++;
          }
    expect(n).toBe(450);
  });

  it('zoom scales the drawn picture by its factor; focus 0 / 1 puts the picture\'s edge on the cover\'s edge', () => {
    const a = c.api;
    const one = a.coverArtRect(3000, 2000, 800, 1280, { x: 0.5, y: 0.5, zoom: 1 });
    const two = a.coverArtRect(3000, 2000, 800, 1280, { x: 0.5, y: 0.5, zoom: 2 });
    expect(two.w / one.w).toBeCloseTo(2, 12);
    expect(two.h / one.h).toBeCloseTo(2, 12);
    expect(two.h).toBeCloseTo(2560, 9); // a landscape picture fills the height at 1×
    const left = a.coverArtRect(3000, 2000, 800, 1280, { x: 0, y: 0, zoom: 2 });
    const right = a.coverArtRect(3000, 2000, 800, 1280, { x: 1, y: 1, zoom: 2 });
    expect([left.x + 0, left.y + 0]).toEqual([0, 0]); // (W - dw) × 0 is -0: the same edge
    expect(right.x + right.w).toBeCloseTo(800, 9);
    expect(right.y + right.h).toBeCloseTo(1280, 9);
  });

  it('print sharpness: the picture\'s pixels per inch on the print cover follow the zoom', () => {
    const a = c.api;
    expect(a.COVER_SOFT_PPI).toBe(200);
    expect(a.coverArtPpi(3000, 4500, 6, 9, a.coverArtPlace({}))).toBeCloseTo(500, 9);
    expect(a.coverArtPpi(3000, 4500, 6, 9, a.coverArtPlace({ bgZoom: 2 }))).toBeCloseTo(250, 9);
    expect(a.coverArtPpi(3000, 4500, 6, 9, a.coverArtPlace({ bgZoom: 3 }))).toBeCloseTo(500 / 3, 9);
    // a landscape picture on a portrait cover is limited by its height: 2000 px over 9 in
    expect(a.coverArtPpi(3000, 2000, 6, 9, a.coverArtPlace({}))).toBeCloseTo(2000 / 9, 9);
    expect(a.coverArtPpi(0, 2000, 6, 9)).toBe(0);
  });

  it('normalizeCoverRecipe keeps the placement only when the recipe has one, held to range', () => {
    onDesk(LANTERN());
    run((a) => {
      const plain = a.normalizeCoverRecipe(a.defaultCoverRecipe()) as Rec;
      expect('bgFocus' in plain || 'bgZoom' in plain).toBe(false);
      const kept = a.normalizeCoverRecipe(Object.assign(a.defaultCoverRecipe(), { bgFocus: { x: 0.2, y: 0.9 }, bgZoom: 2.5 })) as Rec;
      expect([kept.bgFocus, kept.bgZoom]).toEqual([{ x: 0.2, y: 0.9 }, 2.5]);
      const held = a.normalizeCoverRecipe(Object.assign(a.defaultCoverRecipe(), { bgFocus: { x: -3, y: 4 }, bgZoom: 40 })) as Rec;
      expect([held.bgFocus, held.bgZoom]).toEqual([{ x: 0, y: 1 }, 3]);
      const junk = a.normalizeCoverRecipe(Object.assign(a.defaultCoverRecipe(), { bgFocus: 'centre', bgZoom: null })) as Rec;
      expect('bgFocus' in junk || 'bgZoom' in junk).toBe(false);
      // a normalized recipe without the fields reads back key for key as before (the same keys, the same order)
      expect(Object.keys(plain)).toEqual(Object.keys(a.normalizeCoverRecipe(structuredClone(plain)) as Rec));
    });
  });

  it('a placed cover draws the picture where coverArtRect says, on the front cover and on the wrap\'s front panel only', () => {
    onDesk(LANTERN());
    run((a) => {
      putPictures(a);
      const r = Object.assign(a.defaultCoverRecipe(), { bgType: 'image', bgImageId: 'pin-land', title: '', subtitle: '', author: '', tagline: '', series: '', bgFocus: { x: 0.1, y: 0.8 }, bgZoom: 2 });
      const n = a.normalizeCoverRecipe(r) as Recipe;
      log = [];
      a.drawCoverTo(canvasOf(800, 1280), n);
      const draws = log.filter((e) => Array.isArray(e) && e[0] === 'drawImage') as unknown[][];
      const want = a.coverArtRect(3000, 2000, 800, 1280, { x: 0.1, y: 0.8, zoom: 2 });
      expect(draws).toEqual([['drawImage', 'img:land', want.x, want.y, want.w, want.h]]);
      // the wrap: the sheet-wide background stays centred; the front panel is the placed front cover
      n.wrap = Object.assign(a.wrapDefaults(), { trim: '6x9', pages: 300, paper: 'white' });
      const d = a.wrapDims(n);
      const W = Math.round(d.totalW * 60), H = Math.round(d.totalH * 60);
      log = [];
      a.drawWrapTo(canvasOf(W, H), n, {});
      const wd = log.filter((e) => Array.isArray(e) && e[0] === 'drawImage' && e[1] === 'img:land') as unknown[][];
      const sheet = a.coverArtRect(3000, 2000, W, H);
      const pw = Math.max(2, Math.round(d.layout.panelW * (W / d.totalW))), ph = Math.max(2, Math.round(d.layout.panelH * (W / d.totalW)));
      const front = a.coverArtRect(3000, 2000, pw, ph, { x: 0.1, y: 0.8, zoom: 2 });
      expect(wd).toEqual([['drawImage', 'img:land', sheet.x, sheet.y, sheet.w, sheet.h], ['drawImage', 'img:land', front.x, front.y, front.w, front.h]]);
    });
  });
});
