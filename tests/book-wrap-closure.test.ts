import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { reachableFrom } from '../src/book/studio/closure.js';
import { WRAP_CLOSURE, WRAP_ROOTS, WRAP_SUPPLIED, extractWrapSource, loadWrapClosure, manifestFonts, wrapState } from '../src/book/wrap/closure.js';
import { makeWrapSandbox } from '../src/book/wrap/sandbox.js';
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
  assert.equal(GlobalFonts.has('Libre Baskerville'), false, 'the build takes its faces with it');

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

test('wrap closure: loading is cached per studio file', () => {
  assert.equal(loadWrapClosure(html, CLIENT), loadWrapClosure(html, CLIENT));
});
