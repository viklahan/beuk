import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { STUDIO_FONT_CSS, fontDescriptors, loadWrapClosure, wrapState } from '../src/book/wrap/closure.js';
import { matchDescriptor } from '../src/book/wrap/sandbox.js';
import { readBook } from '../src/book/read.js';

/* BEUK:wrap-server — parity, the acceptance test: for every captured
   wrap the server's render equals the studio's. The studio side was
   captured in a real browser by tools/book-corpus/wrap-parity.mjs
   (tests/fixtures/wrap-parity/*.json): a fixture book plus a patch, the
   studio's items and dims, glyph-width probes, and the render as
   downloaded (JPEG 0.92) box-averaged to 600 px wide.

   Review focus #1: items and dims are the studio's, number for number.
   Review focus #2: the render, averaged the same way, has a mean
     absolute channel difference of at most 6/255 and no 32×32 tile over
     40/255.
   Review focus #4: each probe (measureText of sample text in a recipe
     face, set in the sandbox with this build's faces) is within 1% of
     Chrome's. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const DIR = path.join(FIXTURES, 'wrap-parity');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');

const MEAN_MAX = 6;
const TILE_MAX = 40;
const TILE = 32;
const PROBE_MAX = 0.01;
/** Layout numbers are inches. Everything not measured from text is equal to the last bit; a number measured
 *  from text may differ by @napi-rs/canvas rounding measureText to 0.01 px (Chrome keeps float32): at most
 *  0.005 px per measure, under 2e-5 in at 300 DPI. A real difference (a face, a weight, a kerning pair) is
 *  0.005 in or more. The worst number per wrap is reported as a diagnostic. */
const LAYOUT_EPS = 1e-4;

type Probe = { font: string; text: string; width: number };
type Patch = { meta?: Record<string, unknown>; theme?: Record<string, unknown>; recipe?: Record<string, unknown>; fonts?: { from: string; index?: number; family?: string }[] };
type Capture = {
  name: string; book: string; patch: Patch; lang: string; faces: string[];
  size: { w: number; h: number }; dims: unknown; items: unknown; probes: Probe[]; png: string;
};
type Book = Record<string, unknown> & { meta?: Record<string, unknown>; coverRecipe?: unknown; fonts?: unknown[] };

/* ---- the same steps as tools/book-corpus/wrap-parity.mjs (applyPatch, downsample) ---- */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return structuredClone(b);
  const o: Record<string, unknown> = { ...a };
  for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : structuredClone(b[k]);
  return o;
}
function applyPatch(book: Book, patch: Patch, load: (rel: string) => Book): Book {
  const b = structuredClone(book);
  if (patch.meta) b.meta = { ...b.meta, ...patch.meta };
  if (patch.theme) b.theme = structuredClone(patch.theme);
  if (patch.recipe) b.coverRecipe = merge(b.coverRecipe, patch.recipe);
  if (patch.fonts) b.fonts = patch.fonts.map((f) => ({ ...(load(f.from).fonts![f.index || 0] as object), ...(f.family ? { family: f.family } : {}) }));
  return b;
}
function downsample(src: Uint8ClampedArray, W: number, H: number, tw: number): { data: Uint8ClampedArray; w: number; h: number } {
  const th = Math.round(tw * H / W);
  const sum = new Float64Array(tw * th * 3), cnt = new Uint32Array(tw * th);
  const bx = new Int32Array(W);
  for (let x = 0; x < W; x++) bx[x] = Math.min(tw - 1, Math.floor(x * tw / W));
  for (let y = 0; y < H; y++) {
    const row = Math.min(th - 1, Math.floor(y * th / H)) * tw;
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const t = row + bx[x]!;
      sum[t * 3]! += src[i]!; sum[t * 3 + 1]! += src[i + 1]!; sum[t * 3 + 2]! += src[i + 2]!; cnt[t]!++;
    }
  }
  const data = new Uint8ClampedArray(tw * th * 4);
  for (let t = 0; t < tw * th; t++) {
    data[t * 4] = Math.round(sum[t * 3]! / cnt[t]!); data[t * 4 + 1] = Math.round(sum[t * 3 + 1]! / cnt[t]!);
    data[t * 4 + 2] = Math.round(sum[t * 3 + 2]! / cnt[t]!); data[t * 4 + 3] = 255;
  }
  return { data, w: tw, h: th };
}
/* ---- /same steps ---- */

const loadBook = (rel: string) => (JSON.parse(readFileSync(path.join(FIXTURES, rel), 'utf8')) as { book: Book }).book;
const captures = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const loadCapture = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as Capture;

async function pixels(img: Buffer): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const im = await loadImage(img);
  const c = createCanvas(im.width, im.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(im, 0, 0);
  return { data: ctx.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height };
}

/** Mean absolute channel difference (RGB, /255) over the image, and the worst 32×32 tile's. */
function compare(a: { data: Uint8ClampedArray; w: number; h: number }, b: { data: Uint8ClampedArray; w: number; h: number }) {
  assert.equal(a.w, b.w, 'same width');
  assert.equal(a.h, b.h, 'same height');
  let total = 0;
  let worst = { diff: 0, x: 0, y: 0 };
  for (let ty = 0; ty < a.h; ty += TILE) for (let tx = 0; tx < a.w; tx += TILE) {
    let s = 0, n = 0;
    for (let y = ty; y < Math.min(a.h, ty + TILE); y++) for (let x = tx; x < Math.min(a.w, tx + TILE); x++) {
      const i = (y * a.w + x) * 4;
      s += Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
      n += 3;
    }
    total += s;
    if (s / n > worst.diff) worst = { diff: s / n, x: tx, y: ty };
  }
  return { mean: total / (a.w * a.h * 3), worst };
}

const worstLayout = { v: 0 };
/** Every place two layouts differ, by path (never only the first). */
function layoutDiff(a: unknown, b: unknown, at: string, out: string[]): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(Math.abs(a - b) <= LAYOUT_EPS)) out.push(`${at}: server ${a}, studio ${b}`);
    worstLayout.v = Math.max(worstLayout.v, Math.abs(a - b));
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: server has ${a.length} entries, studio ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) layoutDiff(a[i], b[i], `${at}[${i}]`, out);
    return;
  }
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a)) out.push(`${at}.${k}: only the studio has it (${JSON.stringify(b[k])})`);
      else if (!(k in b)) out.push(`${at}.${k}: only the server has it (${JSON.stringify(a[k])})`);
      else layoutDiff(a[k], b[k], `${at}.${k}`, out);
    }
    return;
  }
  if (a !== b) out.push(`${at}: server ${JSON.stringify(a)}, studio ${JSON.stringify(b)}`);
}

/* The wraps the plan names: every fixture book with a made cover (Lantern Coast print in all three bindings), and
   the constructed ones for the faces (Review focus #4) and the open items of the server's first round. */
const EXPECTED = [
  'lantern-coast-print--paperback', 'lantern-coast-print--case', 'lantern-coast-print--jacket',
  'lantern-coast-book-one--paperback',
  'faces--paperback', 'arabic--paperback', 'uploaded-font--paperback', 'upload-collision--paperback', 'theme-defaults--paperback',
];

test('wrap parity: a capture for every wrap named, and for every fixture book with a made cover', () => {
  const names = captures.map((c) => loadCapture(c).name);
  assert.deepEqual([...names].sort(), [...EXPECTED].sort());
  const covered = new Set(captures.map((c) => loadCapture(c).book));
  const withCover = ['books/real', 'books/legacy', 'epub-parity/books']
    .flatMap((d) => readdirSync(path.join(FIXTURES, d)).filter((f) => f.endsWith('.json')).map((f) => `${d}/${f}`))
    .filter((rel) => !!loadBook(rel).coverRecipe);
  assert.deepEqual(withCover.filter((b) => !covered.has(b)), []);
});

test('wrap fonts: the shim reads the face descriptors from the stylesheets the studio links', () => {
  const linked = [...html.matchAll(/<link rel="stylesheet" href="assets\/fonts\/([^"\/]+\.css)"/g)].map((m) => m[1]);
  assert.deepEqual([...linked].sort(), [...STUDIO_FONT_CSS].sort());
  const d = fontDescriptors(CLIENT);
  assert.deepEqual(d.get('ebgaramond/ebgaramond-latin-normal-400_500_600.woff2'), { italic: false, weights: [400, 500, 600] });
  assert.deepEqual(d.get('literata/literata-latin-normal-400_500_600_700.woff2'), { italic: false, weights: [400, 500, 600] }, 'declared, not what the file name says');
});

test('wrap fonts: faces are matched the way Chrome matched them in the captures', () => {
  const n = (...w: number[]) => w.map((weight) => ({ italic: false, weight }));
  const i = (...w: number[]) => w.map((weight) => ({ italic: true, weight }));
  /* EB Garamond (normal 400-600, italic 400-500): 700 is set in the 600 face, italic 600 in the italic 500 face */
  assert.deepEqual(matchDescriptor([...n(400, 500, 600), ...i(400, 500)], 700, false), { italic: false, weight: 600 });
  assert.deepEqual(matchDescriptor([...n(400, 500, 600), ...i(400, 500)], 600, true), { italic: true, weight: 500 });
  /* Cinzel (500-700): 400 is set at 500; Lora 700 at 600; Libre Baskerville 600 at 700 */
  assert.deepEqual(matchDescriptor(n(500, 600, 700), 400, false), { italic: false, weight: 500 });
  assert.deepEqual(matchDescriptor([...n(400, 500, 600), ...i(400)], 700, false), { italic: false, weight: 600 });
  assert.deepEqual(matchDescriptor([...n(400, 700), ...i(400)], 600, false), { italic: false, weight: 700 });
  /* italic asked of a family with no italic face: the normal face (Chrome slants it) */
  assert.deepEqual(matchDescriptor(n(400), 600, true), { italic: false, weight: 400 });
  assert.equal(matchDescriptor([], 400, false), null);
});

for (const file of captures) {
  test(`wrap parity: ${file}`, async (t) => {
    const cap = loadCapture(file);
    const book = readBook(applyPatch(loadBook(cap.book), cap.patch, loadBook));
    assert.equal(book.status, 'ok', 'readBook status');
    const out = await loadWrapClosure(html, CLIENT).render(wrapState(book.book), 'jpg', { lang: cap.lang, probes: cap.probes.map(({ font, text }) => ({ font, text })) });
    const bad: string[] = [];

    /* Review focus #1 */
    worstLayout.v = 0;
    layoutDiff(out.dims, cap.dims, 'dims', bad);
    layoutDiff(out.items, cap.items, 'items', bad);
    t.diagnostic(`layout: worst number off by ${worstLayout.v.toExponential(2)} in`);

    /* Review focus #2 */
    const full = await pixels(out.bytes);
    assert.deepEqual({ w: full.w, h: full.h }, cap.size, 'the 300-DPI canvas is the studio\'s size');
    const mine = downsample(full.data, full.w, full.h, 600);
    const theirs = await pixels(Buffer.from(cap.png, 'base64'));
    const px = compare(mine, theirs);
    t.diagnostic(`pixels: mean ${px.mean.toFixed(3)}/255, worst tile ${px.worst.diff.toFixed(3)}/255 at (${px.worst.x},${px.worst.y}) of ${mine.w}x${mine.h}`);
    if (px.mean > MEAN_MAX) bad.push(`pixels: mean ${px.mean.toFixed(3)}/255 over ${MEAN_MAX}`);
    if (px.worst.diff > TILE_MAX) bad.push(`pixels: tile at (${px.worst.x},${px.worst.y}) ${px.worst.diff.toFixed(3)}/255 over ${TILE_MAX}`);

    /* Review focus #4 */
    cap.probes.forEach((p, i) => {
      const got = out.probes[i]!;
      const off = Math.abs(got / p.width - 1);
      t.diagnostic(`probe ${p.font.split(',')[0]} "${p.text}": server ${got.toFixed(3)}, studio ${p.width.toFixed(3)} (${(off * 100).toFixed(3)}%)`);
      if (!(off <= PROBE_MAX)) bad.push(`probe ${p.font.split(',')[0]} "${p.text}": server ${got}, studio ${p.width} (${(off * 100).toFixed(2)}%)`);
    });
    assert.deepEqual(bad, []);
  });
}
