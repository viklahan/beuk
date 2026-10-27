import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from 'pdf-lib';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as bleed from '../deploy/renderer/bleed.mjs';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as spreads from '../deploy/renderer/spreads.mjs';

/* deploy/renderer/bleed.mjs — KDP-style print bleed. The studio asks for it
   with <meta name="beuk-bleed">; the renderer renders at the trim as ever,
   then, last, grows every page by 0.125 in on its top, bottom and OUTER
   edge (right-hand pages bleed right, left-hand pages left), moves the
   content so it stays put relative to the trim, sets TrimBox = the trim and
   BleedBox = MediaBox, and draws the spread pictures out to the bleed.
   KDP: a 6 × 9 trim is set at 6.125 × 9.25 in. PDFs are built with pdf-lib. */

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDIooor5E/SD//Z';

const W = 432, H = 648, B = 9; // 6 × 9 in trim, 0.125 in bleed, in pt
const META = '<meta name="beuk-bleed" content="{&quot;in&quot;:0.125,&quot;rtl&quot;:false}"/>';
const DOC = '<!doctype html><html><head>' + META + '</head><body>' +
  '<section class="print-sec chapter-sec spread-sec" id="ps-0" data-start="verso">\n<div class="ch-wrap has-backdrop"><figure class="plate-page"><img src="' + JPEG + '" alt="A plate"/></figure>' +
  '<header class="chapter-opening has-bd"><div class="bd-layer bd-spread bd-page bd-baked" style="background-image:url(' + JPEG + ')" aria-hidden="true"></div><h2>One</h2></header><p>Words.</p></div>\n</section>' +
  '</body></html>';

const box = (page: { node: PDFDict }, key: string) => {
  const arr = page.node.lookup(PDFName.of(key));
  return arr instanceof PDFArray ? arr.asArray().map((n) => (n as PDFNumber).asNumber()) : null;
};

function contentsOf(doc: PDFDocument, pageIndex: number): string[] {
  const contents = doc.getPages()[pageIndex].node.Contents();
  const list = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return list.map((ref) => Buffer.from(decodePDFRawStream(doc.context.lookup(ref as PDFRef) as PDFRawStream).decode()).toString('latin1'));
}

/** A trim-size book of `n` pages, each with a link and a named destination. */
async function trimBook(n: number) {
  const doc = await PDFDocument.create();
  const dests = doc.context.obj({});
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([W, H]);
    p.drawText('words ' + i, { x: 60, y: 600, size: 11 });
    dests.set(PDFName.of('d' + i), doc.context.obj([p.ref, PDFName.of('XYZ'), 6, 636, 0]));
    const link = doc.context.register(doc.context.obj({
      Type: 'Annot', Subtype: 'Link', Rect: [50, 100, 150, 120], Border: [0, 0, 0],
      A: { S: 'GoTo', D: PDFString.of('d0') },
    }));
    p.node.set(PDFName.of('Annots'), doc.context.obj([link]));
  }
  doc.catalog.set(PDFName.of('Dests'), doc.context.register(dests));
  return doc.save({ useObjectStreams: false });
}

test('print bleed: the document asks for it, or does not', () => {
  assert.deepEqual(bleed.bleedConfig(DOC), { pt: 9, rtl: false });
  assert.deepEqual(bleed.bleedConfig(DOC.replace('false', 'true')), { pt: 9, rtl: true });
  assert.equal(bleed.bleedConfig('<html><head></head><body></body></html>'), null);
  assert.equal(bleed.bleedConfig(DOC.replace('0.125', '0')), null, 'no bleed asked');
  assert.equal(bleed.bleedConfig(DOC.replace('0.125', '3')), null, 'an absurd bleed is not trusted');
  assert.equal(bleed.bleedConfig(DOC.replace('{&quot;in', '{in')), null, 'unreadable');
});

test('print bleed: right-hand pages bleed right, left-hand pages left, both top and bottom (right to left mirrored)', () => {
  const ltr = { pt: B, rtl: false }, rtl = { pt: B, rtl: true };
  assert.deepEqual(bleed.bleedSides(0, ltr), { left: 0, right: B, top: B, bottom: B }, 'page 1, a recto, on the right');
  assert.deepEqual(bleed.bleedSides(1, ltr), { left: B, right: 0, top: B, bottom: B }, 'page 2, a verso, on the left');
  assert.deepEqual(bleed.bleedSides(4, ltr), { left: 0, right: B, top: B, bottom: B });
  assert.deepEqual(bleed.bleedSides(0, rtl), { left: B, right: 0, top: B, bottom: B }, 'right to left, page 1 is a left-hand page');
  assert.deepEqual(bleed.bleedSides(1, rtl), { left: 0, right: B, top: B, bottom: B });
});

test('print bleed: pictures cover trim + bleed, never stretched, held at the gutter', () => {
  // no bleed: exactly the trim cover the renderer always drew
  assert.deepEqual(bleed.coverRect(4, 6, W, H, null), { x: 0, y: 0, w: W, h: H });
  const covers = (r: { x: number; y: number; w: number; h: number }, x0: number, y0: number, x1: number, y1: number) =>
    r.x <= x0 + 1e-6 && r.y <= y0 + 1e-6 && r.x + r.w >= x1 - 1e-6 && r.y + r.h >= y1 - 1e-6;
  // a trim-shaped picture on a recto (bleeds right): covers [0, W+B] × [-B, H+B]; its gutter edge stays at x = 0
  const recto = bleed.coverRect(4, 6, W, H, bleed.bleedSides(0, { pt: B, rtl: false }));
  assert.ok(covers(recto, 0, -B, W + B, H + B), JSON.stringify(recto));
  assert.equal(recto.x, 0);
  assert.ok(Math.abs(recto.w / recto.h - 4 / 6) < 1e-9, 'not stretched');
  // the same on a verso (bleeds left): covers [-B, W] × [-B, H+B]; its gutter edge stays at x = W
  const verso = bleed.coverRect(4, 6, W, H, bleed.bleedSides(1, { pt: B, rtl: false }));
  assert.ok(covers(verso, -B, -B, W, H + B), JSON.stringify(verso));
  assert.ok(Math.abs(verso.x + verso.w - W) < 1e-9);
  // the two halves of one painting grow alike, so they still meet at the spine
  assert.ok(Math.abs(recto.w - verso.w) < 1e-9 && Math.abs(recto.y - verso.y) < 1e-9);
  // a wide picture already reaching past the trim: still covers, still centred where it can be
  const wide = bleed.coverRect(1200, 600, W, H, bleed.bleedSides(0, { pt: B, rtl: false }));
  assert.ok(covers(wide, 0, -B, W + B, H + B), JSON.stringify(wide));
  assert.ok(Math.abs(wide.w / wide.h - 2) < 1e-9);
});

test('print bleed: every page is trim + bleed on its own outer side, TrimBox the trim, BleedBox = MediaBox, content and links where they were', async () => {
  const out = await bleed.applyBleed(await trimBook(4), { pt: B, rtl: false });
  const doc = await PDFDocument.load(out);
  const pages = doc.getPages();
  assert.equal(pages.length, 4, 'no page added or lost');
  pages.forEach((p, i) => {
    const recto = i % 2 === 0;
    const dx = recto ? 0 : B;
    assert.deepEqual(box(p, 'MediaBox'), [0, 0, W + B, H + 2 * B], 'page ' + (i + 1) + ': 6.125 × 9.25 in');
    assert.deepEqual(box(p, 'BleedBox'), [0, 0, W + B, H + 2 * B]);
    assert.deepEqual(box(p, 'TrimBox'), [dx, B, dx + W, B + H], 'page ' + (i + 1) + ': the trim, the bleed on the ' + (recto ? 'right' : 'left'));
    // the page's own content is moved by the bleed on its left and bottom edges
    const cs = contentsOf(doc, i);
    assert.match(cs[0], new RegExp('^q\\s+1 0 0 1 ' + dx + ' ' + B + ' cm'), 'page ' + (i + 1) + ' content shift');
    assert.match(cs[cs.length - 1], /Q\s*$/);
    // its link with it
    const annot = (p.node.lookup(PDFName.of('Annots'), PDFArray)).lookup(0, PDFDict);
    assert.deepEqual(annot.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => (n as PDFNumber).asNumber()), [50 + dx, 100 + B, 150 + dx, 120 + B]);
  });
  // named destinations point at the same spot of their page
  const dests = doc.catalog.lookup(PDFName.of('Dests'), PDFDict);
  const at = (name: string) => (dests.lookup(PDFName.of(name), PDFArray)).asArray().slice(2, 4).map((n) => (n as PDFNumber).asNumber());
  assert.deepEqual(at('d0'), [6, 636 + B]);
  assert.deepEqual(at('d1'), [6 + B, 636 + B]);
});

test('print bleed: a page whose content is one stream (as Chromium writes it) is moved too', async () => {
  const doc0 = await PDFDocument.create();
  const p = doc0.addPage([W, H]);
  const stream = doc0.context.register(doc0.context.flateStream('BT /F1 11 Tf 60 600 Td (words) Tj ET'));
  p.node.set(PDFName.of('Contents'), stream);
  const doc = await PDFDocument.load(await bleed.applyBleed(await doc0.save({ useObjectStreams: false }), { pt: B, rtl: false }));
  const cs = contentsOf(doc, 0);
  // the shift first, then the page (pdf-lib adds its own q … Q around it), the restore last
  assert.match(cs[0], new RegExp('^q\\s+1 0 0 1 0 ' + B + ' cm'));
  assert.ok(cs.slice(1, -1).some((c) => /60 600 Td/.test(c)), 'the page\'s own stream is inside the shift');
  assert.match(cs[cs.length - 1], /^Q\s*$/);
});

test('print bleed: right to left, the first page bleeds left', async () => {
  const doc = await PDFDocument.load(await bleed.applyBleed(await trimBook(2), { pt: B, rtl: true }));
  const [p1, p2] = doc.getPages();
  assert.deepEqual(box(p1, 'TrimBox'), [B, B, B + W, B + H]);
  assert.deepEqual(box(p2, 'TrimBox'), [0, B, W, B + H]);
  assert.deepEqual(box(p1, 'MediaBox'), [0, 0, W + B, H + 2 * B]);
});

/** The image rectangle a page draws `name` with (from its cm), in that
 *  page's final coordinates (after the page's own content shift). */
function drawnRect(doc: PDFDocument, pageIndex: number, name: RegExp) {
  const cs = contentsOf(doc, pageIndex);
  const shift = /^q\s+1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm/.exec(cs[0]);
  const s = cs.find((c) => name.test(c));
  assert.ok(shift && s, 'page ' + (pageIndex + 1) + ' draws ' + name);
  const m = /(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm\s+\/Beuk/.exec(s as string);
  assert.ok(m, 'the picture is placed by a cm');
  const [w, h, x, y] = (m as RegExpExecArray).slice(1).map(Number);
  return { x: x + Number(shift![1]), y: y + Number(shift![2]), w, h };
}

test('print bleed: a spread\'s plate and its backdrop reach the bleed edge of their pages', async () => {
  const base = await PDFDocument.create();
  for (let i = 0; i < 4; i++) base.addPage([W, H]).drawText('words ' + i, { x: 60, y: 600, size: 11 });
  const plan = spreads.planSections(DOC);
  const stamped = await spreads.stampable(plan);
  const cfg = bleed.bleedConfig(DOC);
  // the plate on page 2 (a verso), its backdrop on page 3 (a recto)
  const stampedPdf = await spreads.stampSpreads(await base.save({ useObjectStreams: false }), plan, new Map([['ps-0', 1]]), stamped, cfg);
  const doc = await PDFDocument.load(await bleed.applyBleed(stampedPdf, cfg));
  const full = { w: W + B, h: H + 2 * B };
  const plate = drawnRect(doc, 1, /\/BeukPlate1(-\d+)? Do/);
  const layer = drawnRect(doc, 2, /\/BeukSpread2(-\d+)? Do/);
  const eps = 1e-3;
  for (const [what, r] of [['plate', plate], ['backdrop', layer]] as const) {
    assert.ok(r.x <= eps && r.y <= eps && r.x + r.w >= full.w - eps && r.y + r.h >= full.h - eps, what + ' covers the whole bleed box: ' + JSON.stringify(r));
    assert.ok(Math.abs(r.w / r.h - 4 / 6) < 1e-6, what + ' not stretched');
  }
  // at the spine: the plate's right edge is the verso's trim edge (x = B + W), the backdrop's left the recto's (x = 0)
  assert.ok(Math.abs(plate.x + plate.w - (B + W)) < eps, 'plate meets the spine');
  assert.ok(Math.abs(layer.x) < eps, 'backdrop meets the spine');
  // the page's own content (the words) stays on top and in place relative to the trim
  assert.match(contentsOf(doc, 1)[0], new RegExp('^q\\s+1 0 0 1 ' + B + ' ' + B + ' cm'));
});

test('print bleed: without bleed the stamped spread is exactly as before', async () => {
  const base = await PDFDocument.create();
  for (let i = 0; i < 4; i++) base.addPage([W, H]).drawText('words ' + i, { x: 60, y: 600, size: 11 });
  const plan = spreads.planSections(DOC);
  const out = await spreads.stampSpreads(await base.save({ useObjectStreams: false }), plan, new Map([['ps-0', 1]]), await spreads.stampable(plan));
  const doc = await PDFDocument.load(out);
  assert.match(contentsOf(doc, 1)[0], /432 0 0 648 0 0 cm/);
  assert.deepEqual(box(doc.getPages()[1], 'MediaBox'), [0, 0, W, H]);
  assert.equal(box(doc.getPages()[1], 'TrimBox'), null);
});
