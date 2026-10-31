import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { reachableFrom } from '../src/book/studio/closure.js';
import { imageSize } from '../src/book/wrap/limits.js';
import { WRAP_CLOSURE, WRAP_ROOTS, WRAP_SUPPLIED, WrapBuildError, WrapInputError, extractWrapSource, loadWrapClosure, manifestFonts, wrapState } from '../src/book/wrap/closure.js';
import { type FontPlan, chromeSize, chromeWords, expandFamilies, makeWrapSandbox, parseCssFont, shimContext } from '../src/book/wrap/sandbox.js';
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
  assert.match(jpg.buildId, /^[0-9a-f]{16}$/);
  assert.ok(GlobalFonts.families.every((f) => !f.family.includes(jpg.buildId)), 'the build takes its faces, subsets included, with it');

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
  const plan = { map: { 'A B': ['A B beuk-1', 'A B beuk-latin-ext beuk-1'] } };
  const once = expandFamilies(["'A B'", 'Georgia', 'serif'], plan).families;
  assert.deepEqual(once, ['"A B beuk-1"', '"A B beuk-latin-ext beuk-1"', 'Georgia', 'serif']);
  assert.deepEqual(expandFamilies(once, plan).families, once, 'idempotent');
});

test('font shim: a variable face sets bold at wght 700, as Chrome does (Skia alone sets the 400 instance)', () => {
  const T = 'The Lantern Coast';
  withFaces([['librebaskerville/librebaskerville-latin-normal-400_700.woff2', 'Probe LB']], () => {
    const plain = ctx2d(), shim = ctx2d({ map: {} });
    const p400 = widthOf(plain, "400 40px 'Probe LB'", T), p700 = widthOf(plain, "700 40px 'Probe LB'", T);
    const s400 = widthOf(shim, "400 40px 'Probe LB'", T), s700 = widthOf(shim, "700 40px 'Probe LB'", T);
    assert.ok(Math.abs(s400 - p400) <= 0.005, `400 untouched, up to the 0.01 px the native width is rounded to (${s400} vs ${p400})`);
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
    const shim = ctx2d({ map: {} });
    const v700 = widthOf(shim, "700 40px 'Probe NSD var'", T);
    const s700 = widthOf(ctx2d(), "700 40px 'Probe NSD 700'", T);
    assert.ok(Math.abs(v700 / s700 - 1) < 0.01, `variable at wght 700 ${v700} vs static 700 ${s700}`);
  });
});

test('font shim: a static face gets no variation', () => {
  withFaces([['notoserifdevanagari/Noto_Serif_Devanagari-normal-400.ttf', 'Probe NSD 400']], () => {
    const shim = ctx2d({ map: {} }) as unknown as { font: string; fontVariationSettings: string };
    shim.font = "700 40px 'Probe NSD 400', serif";
    assert.equal(shim.fontVariationSettings, 'normal');
  });
});

test('font shim: latin-ext and vietnamese letters come from the family\'s own subsets, not the fallback', () => {
  withFaces([
    ['librebaskerville/librebaskerville-latin-normal-400_700.woff2', 'Probe LB2'],
    ['librebaskerville/librebaskerville-latin-ext-normal-400_700.woff2', 'Probe LB2 beuk-latin-ext'],
  ], () => {
    const plan = { map: { 'Probe LB2': ['Probe LB2', 'Probe LB2 beuk-latin-ext'] } };
    const EXT = 'ŁŻĐŚ';
    const viaAlias = widthOf(ctx2d(plan), "400 40px 'Probe LB2', serif", EXT);
    const subsetAlone = widthOf(ctx2d(), "400 40px 'Probe LB2 beuk-latin-ext'", EXT);
    const fallback = widthOf(ctx2d(), "400 40px 'Probe LB2', serif", EXT);
    assert.ok(Math.abs(viaAlias - subsetAlone) <= 0.005, `the subset sets the letters (${viaAlias} vs ${subsetAlone})`);
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

/* ---- fix round 2: the fences ---- */

type Book = { coverRecipe: { bgImageId: string | null; elements: Record<string, { font: string }>; wrap: Record<string, unknown> }; images: { id: string; mediaType: string; data: string }[]; fonts?: unknown[] };
const lantern = () => wrapState(bookOf('real/lantern-coast-print.json')) as unknown as Book;
const refusal = (reason: string, missing: string[] = []) => (e: unknown) => {
  assert.ok(e instanceof WrapInputError, String(e));
  assert.equal(e.reason, reason);
  assert.deepEqual(e.missing, missing);
  return true;
};
/** A PNG that is only a signature and a header declaring w × h. */
function pngHeader(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
}

test('wrap limits: picture sizes come from the header (PNG, JPEG, GIF, WebP); anything else is unknown', async () => {
  assert.deepEqual(imageSize(pngHeader(30000, 30000)), { w: 30000, h: 30000 });
  const jpeg = Buffer.from(lantern().images.find((i) => i.id === 'sample-img-cover-art')!.data, 'base64');
  const decoded = await loadImage(jpeg);
  assert.deepEqual(imageSize(jpeg), { w: decoded.width, h: decoded.height }, "the fixture JPEG's header agrees with the decoder");
  assert.deepEqual(imageSize(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 16, 0, 32, 0])), { w: 16, h: 32 });
  const vp8x = Buffer.alloc(30); vp8x.write('RIFF', 0, 'latin1'); vp8x.write('WEBPVP8X', 8, 'latin1'); vp8x.writeUIntLE(639, 24, 3); vp8x.writeUIntLE(479, 27, 3);
  assert.deepEqual(imageSize(vp8x), { w: 640, h: 480 });
  assert.equal(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff])), null);
});

test('wrap fence: a wrap over 40 MP at 300 DPI is refused before the canvas exists', async () => {
  const b = lantern();
  b.coverRecipe.wrap = { ...b.coverRecipe.wrap, paper: 'custom', customFactor: 0.02, pages: 5000 };
  await assert.rejects(loadWrapClosure(html, CLIENT).render(b as never, 'jpg', { lang: 'en' }), refusal('too-large'));
});

test('wrap fence: a picture whose header declares 30000x30000 is refused by id before it is decoded', async () => {
  const b = lantern();
  const art = b.images.find((i) => i.id === 'sample-img-cover-art')!;
  art.mediaType = 'image/png';
  art.data = pngHeader(30000, 30000).toString('base64');
  await assert.rejects(loadWrapClosure(html, CLIENT).render(b as never, 'jpg', { lang: 'en' }), refusal('picture-too-large', ['sample-img-cover-art']));
});

test('wrap fence: a picture id that is not a plain id (__proto__) is refused', async () => {
  const b = lantern();
  const art = b.images.find((i) => i.id === 'sample-img-cover-art')!;
  b.images.push({ ...art, id: '__proto__' });
  b.coverRecipe.bgImageId = '__proto__';
  await assert.rejects(loadWrapClosure(html, CLIENT).render(b as never, 'jpg', { lang: 'en' }), refusal('bad-picture-id', ['__proto__']));
});

test('wrap fence: renders take turns even when two are started together', async () => {
  const sb = loadWrapClosure(html, CLIENT);
  const [a, b] = await Promise.all([sb.render(lantern() as never, 'jpg', { lang: 'en' }), sb.render(lantern() as never, 'jpg', { lang: 'en' })]);
  assert.ok(a.timing.finished <= b.timing.started, `no overlap: first ${a.timing.started}-${a.timing.finished}, second ${b.timing.started}-${b.timing.finished}`);
  assert.notEqual(a.buildId, b.buildId);
});

/** Lantern Coast with its title and author set in Lora. */
const inLora = () => {
  const b = lantern();
  b.coverRecipe.elements.title!.font = 'Lora';
  b.coverRecipe.elements.author!.font = 'Lora';
  return b;
};

test('wrap fonts: a face left behind (a stopped build, a bare family name) never reaches the next build', async () => {
  const sb = loadWrapClosure(html, CLIENT);
  const clean = await sb.render(inLora() as never, 'jpg', { lang: 'en' });
  await assert.rejects(sb.render(inLora() as never, 'jpg', { lang: 'en', timeoutMs: 1 }), (e: unknown) => e instanceof WrapBuildError && e.reason === 'timeout');
  /* what a build without the nonce would have left: another face under the bare family name */
  const leak = GlobalFonts.registerFromPath(path.join(FONTS, 'abrilfatface', 'Abril_Fatface-normal-400.ttf'), 'Lora');
  assert.ok(leak);
  try {
    const after = await sb.render(inLora() as never, 'jpg', { lang: 'en' });
    assert.deepEqual(after.items, clean.items, 'the same layout as before the leak');
  } finally {
    GlobalFonts.remove(leak!);
  }
});

test('wrap fonts: the writer\'s uploaded "Lora" stands in where Chrome puts it: at normal 400, not where a built-in face matches better', async () => {
  /* the studio registers an upload as new FontFace(family, url): normal, 400. Chrome (tests/fixtures/wrap-parity/upload-collision--paperback.json)
     sets 400 in the upload (the face added last wins among equals), 700 and italic in the built-in faces, which match better */
  const sb = loadWrapClosure(html, CLIENT);
  const LORA = "40px 'Lora', serif", T = 'The Lantern Coast';
  const probes = [{ font: `400 ${LORA}`, text: T }, { font: `700 ${LORA}`, text: T }, { font: `italic 400 ${LORA}`, text: T }];
  const builtIn = await sb.render(inLora() as never, 'jpg', { lang: 'en', probes });
  const b = inLora();
  b.fonts = [{ id: 'up-lora', family: 'Lora', ext: 'ttf', name: 'MyLora.ttf', data: readFileSync(path.join(FONTS, 'abrilfatface', 'Abril_Fatface-normal-400.ttf')).toString('base64') }];
  const up = await sb.render(b as never, 'jpg', { lang: 'en', probes });
  assert.deepEqual(up.uploaded, ['Lora']);
  assert.ok(Math.abs(up.probes[0]! - builtIn.probes[0]!) > 1, `400: the upload's bytes (${up.probes[0]} vs built-in ${builtIn.probes[0]})`);
  assert.equal(up.probes[1], builtIn.probes[1], '700: the built-in face');
  assert.equal(up.probes[2], builtIn.probes[2], 'italic: the built-in italic');
});

test('wrap closure: loading is cached per studio file', () => {
  assert.equal(loadWrapClosure(html, CLIENT), loadWrapClosure(html, CLIENT));
});

test('font shim: a string with spaces measures and paints as its words and spaces, as Chrome shapes it; right-to-left text stays whole', () => {
  assert.deepEqual(chromeWords('APRIL CAROOKE'), ['APRIL', ' ', 'CAROOKE']);
  assert.deepEqual(chromeWords('a  b'), ['a', ' ', ' ', 'b']);
  assert.equal(chromeWords('Lantern'), null);
  assert.equal(chromeWords('فانوس الساحل'), null);
  withFaces([['librebaskerville/librebaskerville-latin-normal-400_700.woff2', 'Probe LB3']], () => {
    const shim = ctx2d({ map: {} }), plain = ctx2d();
    const F = "700 51px 'Probe LB3'";
    const words = ['APRIL', ' ', 'CAROOKE'].reduce((a, w) => a + widthOf(shim, F, w), 0);
    assert.ok(Math.abs(widthOf(shim, F, 'APRIL CAROOKE') - words) < 1e-9, 'the sum of the words');
    /* Chrome measured 493.63 (tools/book-corpus/wrap-parity.mjs); the whole string shaped at once kerns across the space */
    assert.ok(Math.abs(widthOf(shim, F, 'APRIL CAROOKE') - 493.6289) < 0.05, `Chrome's width (${widthOf(shim, F, 'APRIL CAROOKE')})`);
    (plain as unknown as { fontVariationSettings: string }).fontVariationSettings = "'wght' 700";
    assert.ok(Math.abs(widthOf(plain, F, 'APRIL CAROOKE') - 492.15) < 0.05, `Skia's whole-string width (${widthOf(plain, F, 'APRIL CAROOKE')})`);
  });
});

test('font shim: type is set at the size floored to 1/100 px, as Chrome sets it', () => {
  assert.equal(chromeSize('45.003043213633596px'), '45px');
  assert.equal(chromeSize('45.0099px'), '45px');
  assert.equal(chromeSize('44.9999px'), '44.99px');
  assert.equal(chromeSize('44.99px'), '44.99px', 'not floored past itself by binary rounding');
  assert.equal(chromeSize('51.00000000000001px'), '51px');
  assert.equal(chromeSize('3.009px'), '3px');
  assert.equal(chromeSize('1.2em'), '1.2em', 'other units as written');
});
