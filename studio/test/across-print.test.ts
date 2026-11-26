import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { arriveForExport } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { loadPrint, type PrintClosure } from '../src/print/print';
import { fixtures } from './fixtures';

/* Across both pages, Task 3 — print. 1.0's buildPrintHtml and its press bake (client/index.html), reached through
   print's own module (src/generated/closure-print.js), on 1.0's applyBookDoc state of a book.
   jsdom draws no canvas and decodes no picture, so this file puts in two honest stand-ins, installed BEFORE print's
   module loads (it takes the page's Image when it is made):
   - an Image that "decodes" to the picture's real pixel size, read from its PNG / JPEG header;
   - a canvas that draws nothing but writes down what it was asked to draw. Its toDataURL is a JPEG data URL whose
     payload is that list (JSON): which picture, which source rectangle, onto how many pixels, which fade. So these
     tests read the bake's instructions from the very data URLs the print file carries — what was cut, where, at what
     size — not its pixels; the pixels are judged in the real-renderer prints (the task report's contact sheets). */

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Api = PrintClosure['api'] & Rec;
type Rect = { x: number; y: number; w: number; h: number };
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);

/* ---- the stand-ins ---- */
const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
function sizeOf(src: string): { w: number; h: number } {
  const b64 = src.slice(src.indexOf(',') + 1);
  const bytes = Buffer.from(b64.slice(0, 64 * 1024), 'base64');
  if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const mk = bytes[i + 1]!;
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: bytes.readUInt16BE(i + 7), h: bytes.readUInt16BE(i + 5) };
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return { w: 10, h: 10 };
}
const UNDECODABLE = new Set<string>();
type Op = unknown[];
type Drawn = { w: number; h: number; ops: Op[] };
function installStandIns(): void {
  const proto = HTMLCanvasElement.prototype as unknown as Rec;
  proto.getContext = function (this: HTMLCanvasElement & Rec) {
    if (this.__ctx) return this.__ctx;
    const canvas = this;
    canvas.__ops = [] as Op[];
    const rec = (...op: unknown[]) => canvas.__ops.push(op);
    const o: Rec = {
      font: '10px serif',
      measureText: (s: string) => ({ width: String(s).length * (parseFloat(String(o.font)) || 10) * 0.5 }),
      createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
        const g = { grad: [x0, y0, x1, y1], stops: [] as unknown[] };
        return { ...g, addColorStop: (at: number, c: string) => g.stops.push([at, c]), __g: g };
      },
      drawImage: (im: Rec, ...a: number[]) => rec('drawImage', im instanceof HTMLCanvasElement ? { canvas: { w: im.width, h: im.height, ops: (im as Rec).__ops || [] } } : 'img:' + im.__tag, ...a),
      fillRect: (...a: number[]) => rec('fillRect', ...a),
      clearRect: (...a: number[]) => rec('clearRect', ...a),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
    };
    const ctx = new Proxy(o, {
      get: (x, k) => (k in x ? x[k as string] : () => undefined),
      set: (x, k, v) => {
        if (k === 'fillStyle') rec('fillStyle', v && v.__g ? v.__g : v);
        else if (k === 'globalAlpha' || k === 'globalCompositeOperation') rec(k, v);
        x[k as string] = v;
        return true;
      },
    });
    this.__ctx = ctx;
    return ctx;
  } as never;
  proto.toDataURL = function (this: HTMLCanvasElement & Rec) {
    const drawn: Drawn = { w: this.width, h: this.height, ops: this.__ops || [] };
    return 'data:image/jpeg;base64,' + Buffer.from(JSON.stringify(drawn)).toString('base64');
  };
  (globalThis as unknown as { Image: unknown }).Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    __tag = '';
    decode() {
      return Promise.resolve();
    }
    set src(v: string) {
      const s = sizeOf(v);
      this.naturalWidth = this.width = s.w;
      this.naturalHeight = this.height = s.h;
      this.__tag = s.w + 'x' + s.h + '#' + shortHash(v);
      // a picture the test marks undecodable fails as a broken one does (1.0's printDecodeImage rejects)
      if (UNDECODABLE.has(v)) setTimeout(() => this.onerror?.(), 0);
      else setTimeout(() => this.onload?.(), 0);
    }
  };
}
/** What a stand-in canvas was asked to draw, from its data URL. */
const drawnOf = (url: string): Drawn => JSON.parse(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8')) as Drawn;
/** The picture drawn onto a bake (the first drawImage of a picture, at any depth), and the rectangles. */
function picDraw(d: Drawn): { tag: string; src: Rect; dst: Rect } | null {
  for (const op of d.ops) {
    if (op[0] !== 'drawImage') continue;
    if (typeof op[1] === 'string') {
      const n = op.slice(2) as number[];
      return n.length === 8 ? { tag: op[1], src: { x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! }, dst: { x: n[4]!, y: n[5]!, w: n[6]!, h: n[7]! } } : { tag: op[1], src: { x: 0, y: 0, w: NaN, h: NaN }, dst: { x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! } };
    }
    const inner = picDraw((op[1] as { canvas: Drawn }).canvas);
    if (inner) return inner;
  }
  return null;
}
function gradOf(d: Drawn): { grad: number[]; stops: [number, string][] } | null {
  for (const op of d.ops) {
    if (op[0] === 'fillStyle' && op[1] && typeof op[1] === 'object') return op[1] as { grad: number[]; stops: [number, string][] };
    if (op[0] === 'drawImage' && typeof op[1] === 'object') {
      const g = gradOf((op[1] as { canvas: Drawn }).canvas);
      if (g) return g;
    }
  }
  return null;
}

/** A real PNG of w × h (one colour; deflated, so small). */
function png(w: number, h: number): string {
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([40, 90, 140], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

let c: Closure;
let pc: PrintClosure;
let a: Api;
const WIDE = png(1600, 1200);
const OTHER = png(800, 1000);
beforeAll(async () => {
  installStandIns();
  c = await loadClosure();
  pc = await loadPrint();
  a = pc.api as Api;
  setClosureT(t);
  setClosureLang('en');
});
/** 1.0's state of `book` (applyBookDoc, as the export builds it), set into print's module. */
function on(book: Rec): Rec {
  const st = arriveForExport(c, structuredClone(book)) as unknown as Rec;
  exportSafe(c, st as never, book);
  pc.setState(st);
  return st;
}
const PARA = 'The tide came in over the mud flats and the gulls rose all at once, crying over the harbour while the ferry sounded its horn twice for the far shore and the lamps came on along the quay one by one in the blue dusk.';
const many = (n: number) => Array.from({ length: n }, () => PARA).join('\n\n');
/** A 6 x 9 book whose first chapter's plate is a 1600 x 1200 picture set across both pages; the chapter also stores a
 *  backdrop (which across takes over for the opening). */
function acrossBook(o: { bleed?: boolean; lang?: string; trim?: string; pic?: string } = {}): { st: Rec; ch: Rec; src: string; bdSrc: string } {
  const st = on(c.api.buildEmptyBook() as Rec);
  st.images = [
    { id: 'wide', name: 'Harbour at dusk', mediaType: 'image/png', ext: 'png', data: o.pic || WIDE },
    { id: 'other', name: 'A gull', mediaType: 'image/png', ext: 'png', data: OTHER },
  ];
  const chs = (st.sections as Rec[]).filter((s) => s.kind === 'body');
  chs.forEach((s, i) => {
    s.title = 'Chapter ' + (i + 1);
    s.content = many(4);
  });
  const ch = chs[0]!;
  Object.assign(ch, { plateId: 'wide', plateAlt: 'A harbour at dusk, wide', plateFit: 'across', backdropId: 'other', backdropStrength: 'strong' });
  st.printTrim = o.trim || '6x9';
  st.printBleed = !!o.bleed;
  st.meta.language = o.lang || 'en';
  return { st, ch, src: 'data:image/png;base64,' + (o.pic || WIDE), bdSrc: 'data:image/png;base64,' + OTHER };
}
const printHtml = async () => {
  await a.preparePrintPress();
  return String(pc.vars.buildPrintHtml());
};
/** The print section of `ch` in the document. */
function sectionOf(html: string, st: Rec, ch: Rec): string {
  const inDoc = (st.sections as Rec[]).filter((s) => a.inBook(s) && s.type !== 'cover');
  const k = inDoc.indexOf(ch);
  expect(k).toBeGreaterThanOrEqual(0);
  const from = html.indexOf('id="ps-' + k + '"');
  expect(from).toBeGreaterThan(0);
  const start = html.lastIndexOf('<section', from);
  return html.slice(start, html.indexOf('</section>', from) + '</section>'.length);
}
const VERSO_RE = /<figure class="plate-page plate-across"><img src="(data:image\/jpeg;base64,[^"]+)" alt="([^"]*)"\/><\/figure>/;
const RECTO_RE = /<div class="bd-layer bd-spread bd-page bd-baked" style="background-image:url\((data:image\/jpeg;base64,[^)]+)\)"/;
const halvesIn = (sec: string) => {
  const v = VERSO_RE.exec(sec), r = RECTO_RE.exec(sec);
  expect(v, 'the across figure').toBeTruthy();
  expect(r, 'the Spread page layer').toBeTruthy();
  return { verso: v![1]!, recto: r![1]!, alt: v![2]! };
};
const imgTag = (data: string, w: number, h: number) => 'img:' + w + 'x' + h + '#' + shortHash('data:image/png;base64,' + data);

describe('Across both pages in print (Task 3)', () => {
  it("print HTML: an across chapter has <figure class=\"plate-page plate-across\"> and its opening has the bd-spread page layer; the section's own backdrop is not drawn", async () => {
    const { st, ch } = acrossBook();
    const html = await printHtml();
    const sec = sectionOf(html, st, ch);
    expect(sec.startsWith('<section class="print-sec chapter-sec spread-sec" id="ps-')).toBe(true);
    expect(sec).toMatch(/^<section [^>]* data-start="verso">/);
    const h = halvesIn(sec);
    expect(h.alt).toBe('A harbour at dusk, wide');
    // the figure leads the section, then the opening, whose one layer is the Spread page layer
    expect(sec.indexOf('plate-across')).toBeLessThan(sec.indexOf('chapter-opening'));
    expect((sec.match(/class="bd-layer/g) || []).length).toBe(1);
    expect(sec).toContain('aria-hidden="true" role="presentation"');
    // both halves are of the plate's picture; nothing of the stored backdrop (its own src or a bake of it) is drawn
    for (const url of [h.verso, h.recto]) expect(picDraw(drawnOf(url))!.tag).toBe(imgTag(WIDE, 1600, 1200));
    expect(sec).not.toContain(OTHER.slice(0, 200));
    expect(sec).not.toContain('bd-strong');
    expect(JSON.stringify(drawnOf(h.recto))).not.toContain(imgTag(OTHER, 800, 1000));
    // the backdrop stays stored (nothing deleted)
    expect([ch.backdropId, ch.backdropStrength]).toEqual(['other', 'strong']);
    // printAcrossHalves hands out the very data URLs the print file carries (Task 4 reads them)
    expect(await a.printAcrossHalves(ch)).toEqual({ verso: h.verso, recto: h.recto });
    // and the press report counts the recto as a baked layer, nothing left pending
    const rep = a.printPressReport() as Rec;
    expect(rep.seeThroughLeft).toBe(0);
    expect(rep.errors).toEqual([]);
    // the chapter needs bleed: counted among the sections whose art reaches the page edge (both its pages)
    expect((a.printEdgeSections() as Rec[]).includes(ch)).toBe(true);
  });

  it('print HTML for fill and whole plates is byte-identical to main (fixture books: snapshot before the change)', async () => {
    /* Recorded on f29a4d0 (the unchanged print code, before this task's edits) with these stand-ins: sha256 of
       buildPrintHtml after preparePrintPress. A fixture's plates as stored (fill: no fixture stores a fit), every plate
       set to whole, and each with bleed on, and right to left. If an intended print change elsewhere moves these, the
       failure prints the new values; re-record them only on the code before such a change, never to get a green. */
    const SNAP: Record<string, string> = {
      'real/bookbinders-letter fill en': '482e9c6ae94486544ceded4bab7937c1124cda4f81085b18de7d380de80debc1',
      'real/bookbinders-letter fill ar': '3e5b58422f4f261733fbdba2ca2aed32b73630a4a11278363ed19812ebe9594a',
      'real/bookbinders-letter fill bleed en': 'd166c4c056d9384e4bd89e36d1cf62abb1703dde0982bfcfddf1ea0dd30a4192',
      'real/bookbinders-letter fill bleed ar': '6107d5cfd40c8a5c3814d41e983530bf2117433193070e646399050be77cfa97',
      'real/bookbinders-letter whole en': '317ac8540874d729731a15c3c43d3e303ff1e76ef18473098ca5bf69e83e8e22',
      'real/bookbinders-letter whole ar': '8644a7d04aa710d6d3e0c0cc12c8d302944ad1c73e974eaebdefa05a5e077cbc',
      'real/bookbinders-letter whole bleed en': '03f918a24b4b477400089746ba613f9cbe90c644f6497e728a4c63bfc0161a8e',
      'real/bookbinders-letter whole bleed ar': '839512bde0fb0ec84ca50e0b18c7281636b6a09e40c7c864090cf4513f55ef58',
      'real/lantern-coast-print fill en': '93ff90842499f4c9df96a308789f35aedf5522161fb06c82a21c9b0980622dd6',
      'real/lantern-coast-print fill ar': '3574e58dc4bedd3c739e0300494d2f902d8a0d99579c9e52c6f41eb855531400',
      'real/lantern-coast-print fill bleed en': '62bc3039ec5d3f98c17537aa69ff04a52946d31e22f962914414cd0b382656b7',
      'real/lantern-coast-print fill bleed ar': 'e77d22c1711bbdf25a363ccb4fd4e8b7506106ee2358acc1f26d6afa9181a496',
      'real/lantern-coast-print whole en': 'c473481eb0a71d215dfdf99f7bdb8bdfe6eb0a78efc38d69b09cdf9763b63c0b',
      'real/lantern-coast-print whole ar': 'b1839ef1052f4440515edad5db8e9fab96390a14d9ea3655547841bf75eae164',
      'real/lantern-coast-print whole bleed en': 'bf05becd8ce204ecd825d07904e1a0261bf24745f1b929774807ba47bc288293',
      'real/lantern-coast-print whole bleed ar': '6bff2da0f10745fddfe25aa744658b2ac0f20e9209953a6656fd3611e0afe934',
      'real/lunas-beach-standalone fill en': '26afd728b67c928caeece928e48ab2ed60eb6ceddb088ca4bf7ff39fe5fe7275',
      'real/lunas-beach-standalone fill ar': '85d2469b151e507c104cee8e305481ad72a10d3198d17b724ee27a05fe674739',
      'real/lunas-beach-standalone fill bleed en': '20a97a2310cff38cbccbe380655df5603929143ae061ff1bafe2b894366308e2',
      'real/lunas-beach-standalone fill bleed ar': '7126d0ef82b9b5f956d68de82609cf9ccdb54b89493dac21f6c57d2e15e78284',
      'real/lunas-beach-standalone whole en': 'dca2dafca8a1f639a77dd9769d308d003e4bd605e43a95fc6f788824d151a291',
      'real/lunas-beach-standalone whole ar': 'fb63a7b8a5d25a783ccf973d4b4a61a7736eb56b12659f913b06ecdba5fdbae9',
      'real/lunas-beach-standalone whole bleed en': '1ba5b00b2698fb1f03127c1322b4a230a34f8cbe44723d6a1469881198671194',
      'real/lunas-beach-standalone whole bleed ar': '2d5166e2d282507cbfc456e3d7b482d843b9ecb875decc562f7d6ac7a41aad1a',
      'real/salt-road-book-one fill en': '1873806ae65525b930d91f4b7a8f0d2674000db1728aaf804bbaab2512154f5e',
      'real/salt-road-book-one fill ar': '6f6c95abae2079fd06183e4de8c57b1e27e12aa26b134e109ec5fa83fe016907',
      'real/salt-road-book-one fill bleed en': '385496564c3f5f92f07812dfa963fe8f49081993f7248e53dc404e2691cd8add',
      'real/salt-road-book-one fill bleed ar': '6b183b90edab37f89a4266789d825b07091bd001623f799fa76cd4397b3be4d0',
      'real/salt-road-book-one whole en': '3d9dbf08fbf6a87c99a3f31ecc95a2a57b156b51d4f533a3e043f9d58ff34e02',
      'real/salt-road-book-one whole ar': 'ac54c2d521646acf2484fe68ca9916a87d998a983c0bce98a3c6705b7c89aae8',
      'real/salt-road-book-one whole bleed en': 'a637a503b157e2c6c83686b85ebe1c5e44848201b0549de6d4cb39e3f7a540c3',
      'real/salt-road-book-one whole bleed ar': 'cb1590f8ed5b88383cd78c66de70b7dd1f1ca8314a91b29ea74e44ddf10b9f44',
    };
    const got: Record<string, string> = {};
    const names = ['real/lantern-coast-print', 'real/lunas-beach-standalone', 'real/salt-road-book-one', 'real/bookbinders-letter'];
    for (const f of fixtures('real').filter((x) => names.includes(x.name))) {
      for (const fit of ['fill', 'whole'] as const) {
        for (const bleed of [false, true]) {
          for (const lang of ['en', 'ar']) {
            const st = on(f.book);
            if (fit === 'whole') for (const s of st.sections as Rec[]) if (s.plateId) s.plateFit = 'whole';
            st.printBleed = bleed;
            if (lang !== 'en') st.meta.language = lang;
            const html = await printHtml();
            // (what is pinned: a document carrying the fixture's plates, as fill or whole, and no across markup)
            expect(html).toContain(fit === 'whole' ? '<figure class="plate-page plate-whole"><img' : '<figure class="plate-page"><img');
            expect(html).not.toContain('plate-across');
            got[`${f.name} ${fit}${bleed ? ' bleed' : ''} ${lang}`] = createHash('sha256').update(html).digest('hex');
          }
        }
      }
    }
    if (process.env.ACROSS_RECORD) console.log('ACROSS_SNAPSHOT ' + JSON.stringify(got));
    expect(Object.keys(got).length).toBe(names.length * 8);
    expect(got).toEqual(SNAP);
  }, 600_000);

  it('halves are re-baked for a new trim: the cache key changes when state.printTrim changes (Review Focus 4)', async () => {
    const { st, ch, src } = acrossBook();
    const html6 = await printHtml();
    const k6 = String(a.printAcrossKey(src));
    const h6 = halvesIn(sectionOf(html6, st, ch));
    st.printTrim = '5x8';
    const k5 = String(a.printAcrossKey(src));
    expect(k5).not.toBe(k6);
    expect(k5).toContain('5x8');
    const h5 = halvesIn(sectionOf(await printHtml(), st, ch));
    expect(h5.verso).not.toBe(h6.verso);
    expect(h5.recto).not.toBe(h6.recto);
    // the new halves are cut for 5 x 8: the source rectangle is acrossCrop's for the new trim, on a 5 : 8 page
    const want = c.api.acrossCrop(1600, 1200, { w: 5, h: 8 }, 0, false);
    const v = drawnOf(h5.verso), pd = picDraw(v)!;
    expect(pd.src).toEqual(want.verso);
    expect(Math.abs(v.w / v.h - 5 / 8) * v.h).toBeLessThanOrEqual(1);
    expect(picDraw(drawnOf(h5.recto))!.src).toEqual(want.recto);
    // bleed and direction are in the key too
    st.printBleed = true;
    expect(String(a.printAcrossKey(src))).not.toBe(k5);
    st.printBleed = false;
    st.meta.language = 'ar';
    expect(String(a.printAcrossKey(src))).not.toBe(k5);
  });

  it("RTL book: the verso half is the picture's right half; the fade runs to the left (Review Focus 2)", async () => {
    for (const lang of ['en', 'ar']) {
      const rtl = lang === 'ar';
      const { st, ch } = acrossBook({ lang });
      const html = await printHtml();
      expect(html).toContain(rtl ? 'dir="rtl"' : '<html lang="en"');
      const h = halvesIn(sectionOf(html, st, ch));
      const want = c.api.acrossCrop(1600, 1200, { w: 6, h: 9 }, 0, rtl);
      const vs = picDraw(drawnOf(h.verso))!.src, rs = picDraw(drawnOf(h.recto))!.src;
      expect(vs, lang).toEqual(want.verso);
      expect(rs, lang).toEqual(want.recto);
      // RTL: the verso is the crop's right half and the recto its left; they meet at the crop's centre line
      if (rtl) {
        expect(vs.x).toBe(want.crop.x + Math.floor(want.crop.w / 2));
        expect(rs.x + rs.w).toBe(vs.x);
      } else expect(vs.x + vs.w).toBe(rs.x);
      // the verso is drawn edge to edge, unfaded; the recto fades from the gutter edge toward the words
      expect(gradOf(drawnOf(h.verso))).toBeNull();
      const d = drawnOf(h.recto), g = gradOf(d)!;
      expect(g).toBeTruthy();
      const [x0, , x1] = g.grad as [number, number, number, number];
      if (rtl) expect([x0, x1]).toEqual([d.w, 0]); // from the right (the gutter) to the left
      else expect([x0, x1]).toEqual([0, d.w]);
      // the stops are the Spread fade's, measured on this page (trim width, the gutter margin)
      const stops = a.spreadFadeStops(6, (a.printMargins('6x9') as Rec).inside) as [number, number][];
      expect(stops.length).toBe(5);
      expect(g.stops.slice(0, stops.length)).toEqual(stops.map((p) => [p[0], 'rgba(0,0,0,' + p[1] + ')']));
      expect(g.stops[g.stops.length - 1]).toEqual([1, 'rgba(0,0,0,0)']);
    }
  });

  it('bleed on and off: the verso image covers trim + bleed on the outer edges and meets the gutter exactly (Review Focus 1)', async () => {
    for (const bleed of [false, true]) {
      for (const lang of ['en', 'ar']) {
        const rtl = lang === 'ar';
        const b = bleed ? 0.125 : 0;
        const { st, ch } = acrossBook({ bleed, lang });
        const html = await printHtml();
        expect(html.includes('<meta name="beuk-bleed"'), `${bleed} ${lang}`).toBe(bleed);
        const h = halvesIn(sectionOf(html, st, ch));
        const want = c.api.acrossCrop(1600, 1200, { w: 6, h: 9 }, b, rtl);
        for (const [half, rect] of [[h.verso, want.verso], [h.recto, want.recto]] as const) {
          const d = drawnOf(half), pd = picDraw(d)!;
          // the half is the page with its bleed (trim + bleed on the outer edge, top and bottom), drawn whole onto it
          expect(Math.abs(d.w / d.h - (6 + b) / (9 + 2 * b)) * d.h, `${bleed} ${lang}`).toBeLessThanOrEqual(1);
          expect(d.w).toBe(Math.round((6 + b) * Math.max(150, Math.min(300, want.ppi))));
          expect(pd.src).toEqual(rect);
          expect(pd.dst).toEqual({ x: 0, y: 0, w: d.w, h: d.h });
        }
        // the two halves meet at the crop's centre line: no source pixel lost or doubled at the gutter
        const [l, r] = rtl ? [want.recto, want.verso] : [want.verso, want.recto];
        expect(l.x + l.w).toBe(r.x);
        expect(l.w + r.w).toBe(want.crop.w);
        // in the print document itself (the browser's own print, the downloaded file), the recto layer shows its trim
        // part: with bleed, the bigger picture is set so its gutter edge stays on the gutter
        const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
        const k = /id="ps-(\d+)"/.exec(sectionOf(html, st, ch))![1];
        const rule = '#ps-' + k + ' .bd-layer.bd-page.bd-baked { background-size: 6.125in 9.25in; background-position: ' + (rtl ? '-0.125in' : '0') + ' -0.125in; }';
        expect(css.includes(rule), `${bleed} ${lang}`).toBe(bleed);
      }
    }
  });

  it("the first chapter and a box set's chapters still pair verso + recto (isPairedSpread; break-before: verso)", async () => {
    const { st, ch } = acrossBook();
    const first = (st.sections as Rec[]).filter((s) => a.inBook(s) && s.kind === 'body')[0];
    expect(first).toBe(ch); // the across chapter is the book's first chapter
    expect(a.isPairedSpread(ch)).toBe(true);
    const modes: [string, (s: Rec) => void][] = [
      ['chapters on any page', (s) => (s.printRecto = false)],
      ['chapters on a recto', (s) => (s.printRecto = true)],
      ['large print', (s) => ((s.printLargePrint = true), (s.printPictureBook = false))],
      ['picture book', (s) => ((s.printLargePrint = false), (s.printPictureBook = true))],
      ['bleed', (s) => ((s.printPictureBook = false), (s.printBleed = true))],
    ];
    for (const [name, set] of modes) {
      set(st);
      const html = await printHtml();
      const sec = sectionOf(html, st, ch);
      expect(sec, name).toMatch(/^<section class="print-sec chapter-sec spread-sec" id="ps-\d+" data-start="verso">/);
      expect(html, name).toContain('.print-sec.chapter-sec.spread-sec { page-break-before: left; break-before: verso; }');
      halvesIn(sec);
    }
    // a box set has no print interior of its own: print is the open book (state.sections) — its added volumes,
    // across chapters and all, do not enter the print document
    st.printBleed = false;
    const alone = await printHtml();
    st.boxSetVolumes = [{ id: 'v2', meta: { title: 'Book Two', language: 'en' }, sections: [structuredClone(ch)], images: structuredClone(st.images) }];
    expect(await printHtml()).toBe(alone);
  });

  /* Fix round 1, finding 1: printPlacements (the preflight's images.resolution, the Store-ready check's dpi rows)
     measures an across plate where it prints — across the open spread, (2 x 6 + 2b) x (9 + 2b) in — at its one crop's
     pixels per inch, acrossCrop(...).ppi = crop.w / (2W + 2b):
       3000 x 3000 on 6 x 9: narrower than the spread, so crop.w = 3000: 3000 / 12 = 250 DPI; with bleed 3000 / 12.25 =
       244.897… DPI (the plate as fill would have read min(3000 / 6, 3000 / 9) = 333.3 and passed);
       1408 x 768: crop.w = 1024, 1024 / 12 = 85.33 DPI.
     The chapter's stored backdrop is not printed under across, so it is not measured. */
  it('printPlacements: an across plate is measured across the spread at its crop ppi, and fails the 300 DPI rows; its stored backdrop is not measured', () => {
    const head = (w: number, h: number) =>
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 2, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
    const { st, ch } = acrossBook();
    (st.images as Rec[]).push(
      { id: 'sq', name: 'Square', mediaType: 'image/png', ext: 'png', data: head(3000, 3000) },
      { id: 'w2', name: 'Myra wide', mediaType: 'image/png', ext: 'png', data: head(1408, 768) },
      { id: 'low', name: 'Small backdrop', mediaType: 'image/png', ext: 'png', data: head(100, 100) },
    );
    Object.assign(ch, { plateId: 'sq', backdropId: 'low', backdropStrength: 'whisper' });
    const mine = () => (a.printPlacements() as Rec[]).filter((p) => p.section === ch);
    // no bleed: 250 DPI over 12 x 9 in, one row only (the 100 x 100 backdrop is stored, not printed, not measured)
    let pl = mine();
    expect(pl.map((p) => p.img.id)).toEqual(['sq']);
    expect(pl[0]!.dpi).toBe(250);
    expect([pl[0]!.placedW, pl[0]!.placedH]).toEqual([12, 9]);
    // the preflight flags it, once, at 250
    const found = (a.auditPrintInterior() as { findings: Rec[] }).findings.filter((f) => f.id === 'images.resolution' && f.jump && f.jump.sectionId === ch.id);
    expect(found.length).toBe(1);
    expect(String(found[0]!.detail)).toContain('250');
    // the Store-ready check (the main closure, on the same state) fails it, once, at 250 DPI, and is not ready
    c.setState(st as never);
    (c.api as Rec).storeUi.server = null;
    const x = (c.api as Rec).storeAudit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }) as { groups: { interior: Rec[] }; verdict: string };
    const rows = x.groups.interior.filter((r) => String(r.id).indexOf('dpi.') === 0 && r.action && r.action.sectionId === ch.id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('fail');
    expect(String(rows[0]!.evidence)).toContain('250 DPI');
    expect(x.verdict).toBe('notReady');
    // with bleed: 3000 / 12.25 over 12.25 x 9.25 in
    st.printBleed = true;
    pl = mine();
    expect(pl.length).toBe(1);
    expect(pl[0]!.dpi).toBe(3000 / 12.25);
    expect(Math.round(pl[0]!.dpi * 10) / 10).toBe(244.9);
    expect([pl[0]!.placedW, pl[0]!.placedH]).toEqual([12.25, 9.25]);
    st.printBleed = false;
    // 1408 x 768: 85 DPI (1024 / 12)
    ch.plateId = 'w2';
    pl = mine();
    expect(pl.length).toBe(1);
    expect(pl[0]!.dpi).toBe(1024 / 12);
    expect(Math.round(pl[0]!.dpi)).toBe(85);
    // back to fill: measured as before — the plate over one trim, and the stored backdrop again
    ch.plateFit = 'fill';
    pl = mine();
    expect(pl.map((p) => [p.img.id, p.placedW, p.placedH])).toEqual([['w2', 6, 9], ['low', 6, 9]]);
    expect(pl[0]!.dpi).toBe(Math.min(1408 / 6, 768 / 9));
  });

  /* Fix round 1, finding 2: when the halves cannot be baked (here the picture will not decode), the across plate is
     printed whole inside the margins, as "Show the whole picture" prints — never the renderer's cover crop of a fill
     plate — with no layer, the stored backdrop still not drawn, and the failure in the press report. */
  it('a bake that fails prints the plate whole (plate-page plate-whole), never a cover crop; no layer; the stored backdrop still not drawn', async () => {
    const broken = png(1500, 1000);
    UNDECODABLE.add('data:image/png;base64,' + broken);
    try {
      const { st, ch } = acrossBook({ pic: broken });
      const html = await printHtml();
      const sec = sectionOf(html, st, ch);
      expect(sec).toContain('<figure class="plate-page plate-whole"><img src="data:image/png;base64,' + broken.slice(0, 40));
      expect(sec).toContain('alt="A harbour at dusk, wide"');
      expect(sec).not.toContain('plate-across');
      expect(sec).not.toMatch(/<figure class="plate-page"><img/);
      expect(sec).not.toContain('class="bd-layer');
      expect(sec).not.toContain(OTHER.slice(0, 200));
      // the whole plate is fitted, not cropped, even though this book has no whole plate of its own
      const k = /id="ps-(\d+)"/.exec(sec)![1];
      expect(html).toContain('#ps-' + k + ' .plate-page.plate-whole img { object-fit: contain; object-position: center center; }');
      // it still opens on a verso facing its opening
      expect(sec).toMatch(/^<section class="print-sec chapter-sec spread-sec" id="ps-\d+" data-start="verso">/);
      // the failure is reported, not hidden
      const rep = a.printPressReport() as { errors: string[]; seeThroughLeft: number };
      expect(rep.errors).toContain('the picture did not decode');
      expect(rep.seeThroughLeft).toBeGreaterThanOrEqual(1);
      await expect(a.printAcrossHalves(ch)).rejects.toThrow('the picture did not decode');
    } finally {
      UNDECODABLE.clear();
    }
  });
});
