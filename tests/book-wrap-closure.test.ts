import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { reachableFrom } from '../src/book/studio/closure.js';
import { WRAP_CLOSURE, WRAP_ROOTS, WRAP_SUPPLIED, extractWrapSource, loadWrapClosure, manifestFonts, wrapState } from '../src/book/wrap/closure.js';
import { type FontPlan, expandFamilies, makeWrapSandbox, parseCssFont, shimContext } from '../src/book/wrap/sandbox.js';
import { readBook } from '../src/book/read.js';
import { fixturePath } from './book-fixtures.js';

/* BEUK:wrap-server — the studio's own cover-wrap painter (drawWrapTo and
   everything it reaches), lifted out of client/index.html
   (src/book/wrap/closure.ts) and run in a fenced vm context
   (src/book/wrap/sandbox.ts) against an @napi-rs/canvas canvas inside a
   worker. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
const bookOf = (rel: string) => readBook((JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as { book: unknown }).book).book;

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(b: Buffer): { w: number; h: number } {
  assert.equal(b.readUInt16BE(0), 0xffd8, 'a JPEG');
  let i = 2;
  while (i < b.length) {
    const marker = b.readUInt16BE(i);
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && marker !== 0xffc4 && marker !== 0xffc8 && marker !== 0xffcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('no start-of-frame marker');
}

test('wrap closure: every WRAP_CLOSURE name is a top-level declaration of the studio', () => {
  const src = extractWrapSource(html);
  for (const n of WRAP_CLOSURE) assert.ok(src.names.includes(n), `lifted ${n}`);
  for (const n of WRAP_ROOTS) assert.ok(WRAP_CLOSURE.includes(n), `root ${n} is in the closure`);
  assert.ok(src.code.includes('function drawWrapTo('));
});

test('wrap closure: the list equals everything the studio code reaches from the roots', () => {
  assert.deepEqual(reachableFrom(html, WRAP_ROOTS, WRAP_SUPPLIED), [...WRAP_CLOSURE].sort());
});

test('wrap closure: a studio rename fails loudly, naming the missing declaration', () => {
  const renamed = html.replace('function hcDrawFlaps(', 'function hcDrawFlapsRenamed(');
  assert.notEqual(renamed, html, 'the fixture rename applied');
  assert.throws(() => extractWrapSource(renamed), /no longer declares: hcDrawFlaps\b/);
});

test('wrap sandbox: no require, no process, no module, no eval; createElement makes canvases only', () => {
  const ctx = makeWrapSandbox();
  assert.equal(vm.runInContext('typeof require', ctx), 'undefined');
  assert.equal(vm.runInContext('typeof process', ctx), 'undefined');
  assert.equal(vm.runInContext('typeof module', ctx), 'undefined');
  assert.equal(vm.runInContext('typeof fetch', ctx), 'undefined');
  assert.throws(() => vm.runInContext('eval("1")', ctx), /Code generation from strings disallowed/);
  assert.throws(() => vm.runInContext('new Function("return 1")', ctx), /Code generation from strings disallowed/);
  assert.equal(vm.runInContext('const c = document.createElement("canvas"); c.width = 7; c.height = 5; c.getContext("2d") ? c.width * c.height : 0', ctx), 35);
  assert.throws(() => vm.runInContext('document.createElement("div")', ctx), /only a canvas/);
  assert.throws(() => vm.runInContext('new Image()', ctx), /Image/);
});

test('wrap closure: Lantern Coast print renders a 300-DPI JPEG of the wrap size, and a PDF page of exactly the wrap size', async () => {
  const sb = loadWrapClosure(html, CLIENT);
  const state = wrapState(bookOf('real/lantern-coast-print.json'));
  const jpg = await sb.render(state, 'jpg', { lang: 'en' });
  const { totalW, totalH } = jpg.dims;
  assert.equal(totalH, 9.25, '6x9 trim plus an eighth-inch bleed top and bottom');
  assert.ok(totalW > 12.25 && totalW < 14, `two 6 in panels, a spine and the bleed (${totalW})`);
  assert.deepEqual(jpegSize(jpg.bytes), { w: Math.round(totalW * 300), h: Math.round(totalH * 300) });
  assert.ok(jpg.items.barcode && jpg.items.barcode.w === 2 && jpg.items.barcode.h === 1.2, 'the barcode reserve');
  assert.equal(jpg.items.spineDir, 'ttb', 'an English book reads top to bottom');
  for (const fam of ['Libre Baskerville', 'EB Garamond', 'Amiri', 'Noto Serif Devanagari']) {
    assert.ok(jpg.fonts.includes(fam), `the recipe's face ${fam} registered from the studio's own files (${jpg.fonts.join(', ')})`);
  }
  assert.ok(jpg.aliases.includes('Libre Baskerville beuk-latin-ext'), `the latin-ext subset rides as an alias (${jpg.aliases.join(', ')})`);
  assert.equal(GlobalFonts.has('Libre Baskerville'), false, 'the build takes its faces with it');
  assert.equal(GlobalFonts.has('Libre Baskerville beuk-latin-ext'), false, 'and its aliases');

  const pdf = await sb.render(state, 'pdf', { lang: 'en' });
  assert.equal(pdf.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const doc = await PDFDocument.load(pdf.bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - totalW * 72) < 1e-6, `page width ${width} = ${totalW * 72}`);
  assert.ok(Math.abs(height - totalH * 72) < 1e-6, `page height ${height} = ${totalH * 72}`);
  assert.deepEqual(pdf.items, jpg.items, 'the same layout either way');
});

test('wrap closure: a cover picture the shelf no longer has is named, not painted blank', async () => {
  const sb = loadWrapClosure(html, CLIENT);
  const state = wrapState(bookOf('real/lantern-coast-print.json')) as { images: { id: string }[] };
  state.images = state.images.filter((im) => im.id !== 'sample-img-cover-art');
  await assert.rejects(sb.render(state as never, 'jpg', { lang: 'en' }), (e: Error & { missing?: string[] }) => {
    assert.deepEqual(e.missing, ['sample-img-cover-art']);
    return true;
  });
});

test('wrap fonts: faces only, each family led by its whole font, else its plain-Latin upright subset', () => {
  const fonts = manifestFonts(CLIENT);
  assert.ok(fonts.length > 0);
  assert.ok(fonts.every((f) => /\.(ttf|otf|woff2?)$/i.test(f.file)), 'no licence texts');
  const first = new Map<string, string>();
  for (const f of fonts) if (!first.has(f.family)) first.set(f.family, path.basename(f.file));
  assert.match(first.get('Libre Baskerville')!, /-latin-normal-/);
  assert.match(first.get('EB Garamond')!, /-latin-normal-/);
  assert.match(first.get('Amiri')!, /\.ttf$/);
  for (const [fam, file] of first) assert.ok(/\.(ttf|otf)$/i.test(file) || /-latin-normal-/.test(file) || !fonts.some((f) => f.family === fam && /-latin-normal-/.test(f.file)), `${fam} leads with ${file}`);
});

/* ---- the font shim (src/book/wrap/sandbox.ts) ---- */

const FONTS = path.join(CLIENT, 'assets', 'fonts');
/** Register probe faces for one test and take them away after. */
function withFaces<T>(faces: [string, string][], fn: () => T): T {
  const keys = faces.map(([file, name]) => {
    const k = GlobalFonts.registerFromPath(path.join(FONTS, file), name);
    assert.ok(k, `registered ${file}`);
    return k!;
  });
  try {
    return fn();
  } finally {
    GlobalFonts.removeBatch(keys);
  }
}
const ctx2d = (plan?: FontPlan) => {
  const c = createCanvas(10, 10).getContext('2d');
  return plan ? shimContext(c, plan) : c;
};
const widthOf = (ctx: { font: string; measureText(t: string): { width: number } }, font: string, text: string) => {
  ctx.font = font;
  return ctx.measureText(text).width;
};

test('font shim: parses the shorthand the studio writes', () => {
  assert.deepEqual(parseCssFont("italic 600 12.5px 'EB Garamond', 'Amiri', serif"),
    { lead: ['italic', '600'], size: '12.5px', families: ["'EB Garamond'", "'Amiri'", 'serif'], weight: 600, italic: true });
  assert.equal(parseCssFont("bold 40px 'Lora'")!.weight, 700);
  assert.equal(parseCssFont("40px 'Lora'")!.weight, 400);
  assert.equal(parseCssFont('500 3.0000000000000004px "A B", serif')!.families[0], '"A B"');
  assert.equal(parseCssFont('not a font'), null);
  const plan = { aliases: { 'A B': ['A B beuk-latin-ext'] } };
  const once = expandFamilies(["'A B'", 'serif'], plan);
  assert.deepEqual(once, ["'A B'", '"A B beuk-latin-ext"', 'serif']);
  assert.deepEqual(expandFamilies(once, plan), once, 'idempotent');
});

test('font shim: a variable face sets bold at wght 700, as Chrome does (Skia alone sets the 400 instance)', () => {
  const T = 'The Lantern Coast';
  withFaces([['librebaskerville/librebaskerville-latin-normal-400_700.woff2', 'Probe LB']], () => {
    const plain = ctx2d(), shim = ctx2d({ aliases: {} });
    const p400 = widthOf(plain, "400 40px 'Probe LB'", T), p700 = widthOf(plain, "700 40px 'Probe LB'", T);
    const s400 = widthOf(shim, "400 40px 'Probe LB'", T), s700 = widthOf(shim, "700 40px 'Probe LB'", T);
    assert.ok(Math.abs(s400 - p400) < 1e-6, `400 untouched (${s400} vs ${p400})`);
    assert.ok(s700 / s400 > 1.015, `bold is wider: ${s700} vs ${s400} (without the shim: ${p700})`);
    assert.equal((shim as unknown as { fontVariationSettings: string }).fontVariationSettings, "'wght' 700");
    /* restore() brings back the earlier font, and its weight with it */
    shim.font = "400 40px 'Probe LB'";
    shim.save();
    shim.font = "700 40px 'Probe LB'";
    shim.restore();
    assert.ok(Math.abs(shim.measureText(T).width - s400) < 1e-6, 'after restore() the 400 width again');
  });
});

test('font shim: the variable face at wght 700 matches the static 700 instance of the same font', () => {
  const T = 'नमस्ते दुनिया';
  withFaces([
    ['notoserifdevanagari/notoserifdevanagari-devanagari-normal-400_500_600_700.woff2', 'Probe NSD var'],
    ['notoserifdevanagari/Noto_Serif_Devanagari-normal-700.ttf', 'Probe NSD 700'],
  ], () => {
    const shim = ctx2d({ aliases: {} });
    const v700 = widthOf(shim, "700 40px 'Probe NSD var'", T);
    const s700 = widthOf(ctx2d(), "700 40px 'Probe NSD 700'", T);
    assert.ok(Math.abs(v700 / s700 - 1) < 0.01, `variable at wght 700 ${v700} vs static 700 ${s700}`);
  });
});

test('font shim: a static face gets no variation', () => {
  withFaces([['notoserifdevanagari/Noto_Serif_Devanagari-normal-400.ttf', 'Probe NSD 400']], () => {
    const shim = ctx2d({ aliases: {} }) as unknown as { font: string; fontVariationSettings: string };
    shim.font = "700 40px 'Probe NSD 400', serif";
    assert.equal(shim.fontVariationSettings, 'normal');
  });
});

test('font shim: latin-ext and vietnamese letters come from the family\'s own subsets, not the fallback', () => {
  withFaces([
    ['librebaskerville/librebaskerville-latin-normal-400_700.woff2', 'Probe LB2'],
    ['librebaskerville/librebaskerville-latin-ext-normal-400_700.woff2', 'Probe LB2 beuk-latin-ext'],
  ], () => {
    const plan = { aliases: { 'Probe LB2': ['Probe LB2 beuk-latin-ext'] } };
    const EXT = 'ŁŻĐŚ';
    const viaAlias = widthOf(ctx2d(plan), "400 40px 'Probe LB2', serif", EXT);
    const subsetAlone = widthOf(ctx2d(), "400 40px 'Probe LB2 beuk-latin-ext'", EXT);
    const fallback = widthOf(ctx2d(), "400 40px 'Probe LB2', serif", EXT);
    assert.ok(Math.abs(viaAlias - subsetAlone) < 1e-6, `the subset sets the letters (${viaAlias} vs ${subsetAlone})`);
    assert.ok(Math.abs(viaAlias - fallback) > 0.5, `not the generic fallback (${viaAlias} vs ${fallback})`);
    const title = 'Łódź Żółć Đặng';
    assert.notEqual(widthOf(ctx2d(plan), "400 40px 'Probe LB2', serif", title), widthOf(ctx2d(), "400 40px 'Probe LB2', serif", title));
    const shim = ctx2d(plan);
    shim.font = "400 40px 'Probe LB2', serif";
    assert.equal((shim.font.match(/Probe LB2 beuk-latin-ext/g) ?? []).length, 1, `one alias in ${shim.font}`);
  });
});

test('wrap fonts: subsets other than plain Latin register under "<family> beuk-<subset>"', () => {
  const lb = manifestFonts(CLIENT).filter((f) => f.family === 'Libre Baskerville');
  assert.deepEqual(lb.map((f) => [path.basename(f.file), f.alias]), [
    ['librebaskerville-latin-normal-400_700.woff2', 'Libre Baskerville'],
    ['librebaskerville-latin-italic-400.woff2', 'Libre Baskerville'],
    ['librebaskerville-latin-ext-normal-400_700.woff2', 'Libre Baskerville beuk-latin-ext'],
    ['librebaskerville-latin-ext-italic-400.woff2', 'Libre Baskerville beuk-latin-ext'],
  ]);
  assert.ok(manifestFonts(CLIENT).filter((f) => f.family === 'Amiri' && /\.ttf$/.test(f.file)).every((f) => f.alias === 'Amiri'));
});

test('wrap closure: loading is cached per studio file', () => {
  assert.equal(loadWrapClosure(html, CLIENT), loadWrapClosure(html, CLIENT));
});
