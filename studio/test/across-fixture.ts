import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/* Across both pages: the stand-ins the print and print-preview tests share (studio/test/across-print.test.ts,
   across-preview.test.ts). jsdom draws no canvas and decodes no picture, so a test installs these two honest
   stand-ins BEFORE print's module loads (it takes the page's Image when it is made):
   - an Image that "decodes" to the picture's real pixel size, read from its PNG / JPEG header;
   - a canvas that draws nothing but writes down what it was asked to draw. Its toDataURL is a JPEG data URL whose
     payload is that list (JSON): which picture, which source rectangle, onto how many pixels, which fade. So the tests
     read the bake's instructions from the very data URLs the print file (and the preview) carries — what was cut,
     where, at what size — not its pixels; the pixels are judged by the page self-checks and the real-renderer prints. */

export type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Rect = { x: number; y: number; w: number; h: number };

export const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
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
/** Pictures (data URLs) the Image stand-in fails to decode, as a broken one fails (1.0's printDecodeImage rejects). */
export const UNDECODABLE = new Set<string>();
type Op = unknown[];
export type Drawn = { w: number; h: number; ops: Op[] };
export function installStandIns(): void {
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
export const drawnOf = (url: string): Drawn => JSON.parse(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8')) as Drawn;
/** The picture drawn onto a bake (the first drawImage of a picture, at any depth), and the rectangles. */
export function picDraw(d: Drawn): { tag: string; src: Rect; dst: Rect } | null {
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
export function gradOf(d: Drawn): { grad: number[]; stops: [number, string][] } | null {
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
export function png(w: number, h: number): string {
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
