import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as spreads from '../deploy/renderer/spreads.mjs';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as bleedMod from '../deploy/renderer/bleed.mjs';

/* deploy/renderer/spreads.mjs — facing pages and painted spreads for the
   print PDF. Chromium (page.pdf) inserts no blank page for recto/verso
   breaks and paints nothing in the margins; the renderer measures where
   each section starts, adds the blank pages the studio's data-start sides
   ask for, and draws each paired spread's pictures beneath the pages.
   These tests build their PDFs with pdf-lib, so no browser is needed. */

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAGAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDIooor5E/SD//Z';

const DOC = '<!doctype html><html><head><style>p{}</style></head><body>' +
  '<section class="print-sec" id="ps-0">\n<p>Title page</p>\n</section>' +
  '<section class="print-sec chapter-sec" id="ps-1" data-start="recto">\n<p>Prologue</p>\n</section>' +
  '<section class="print-sec chapter-sec spread-sec" id="ps-2" data-start="verso">\n<div class="ch-wrap has-backdrop"><figure class="plate-page"><img src="' + JPEG + '" alt="A plate"/></figure>' +
  '<header class="chapter-opening has-bd"><div class="bd-layer bd-spread bd-page bd-baked" style="background-image:url(' + JPEG + ')" aria-hidden="true"></div><h2>One</h2></header><p>Words.</p></div>\n</section>' +
  '<section class="print-sec chapter-sec" id="ps-3" data-start="recto">\n<p>Two</p>\n</section>' +
  '</body></html>';

test('print spreads: the plan reads every section, its side, and a spread\'s pictures', () => {
  const plan = spreads.planSections(DOC);
  assert.deepEqual(plan.map((s: { id: string }) => s.id), ['ps-0', 'ps-1', 'ps-2', 'ps-3']);
  assert.deepEqual(plan.map((s: { start: string | null }) => s.start), [null, 'recto', 'verso', 'recto']);
  assert.equal(plan[2].spread, true);
  assert.equal(plan[2].plate, JPEG);
  assert.equal(plan[2].layer, JPEG);
  assert.equal(plan[1].spread, false);
  assert.equal(spreads.needsFinishing(plan), true);
  assert.equal(spreads.needsFinishing(spreads.planSections('<section class="print-sec" id="ps-0">x</section>')), false);
});

test('print spreads: the measuring pass links every section so Chromium names a destination for each', () => {
  const plan = spreads.planSections(DOC);
  const measured = spreads.withPageMap(DOC, plan);
  for (const id of ['ps-0', 'ps-1', 'ps-2', 'ps-3']) assert.ok(measured.includes('<a href="#' + id + '">'), id);
  assert.ok(measured.indexOf('<a href="#ps-0">') > measured.indexOf('<body>'));
});

test('print spreads: blank pages go exactly where a side was missed, and later sections shift by one each', () => {
  const plan = spreads.planSections(DOC);
  // Measured (0-based): title p1, prologue p2 (a verso: wants recto), spread plate p4 (verso — fine before the shift), two p7.
  const starts = new Map([['ps-0', 0], ['ps-1', 1], ['ps-2', 3], ['ps-3', 6]]);
  const { before, finalStart } = spreads.blanksFor(plan, starts);
  // prologue -> blank, now p3 (recto); the plate moves to p5 (a recto) -> blank, now p6 (verso); two moves to p9 (recto) -> fine
  assert.deepEqual([...before].sort(), ['ps-1', 'ps-2']);
  assert.equal(finalStart.get('ps-1'), 2);
  assert.equal(finalStart.get('ps-2'), 5);
  assert.equal(finalStart.get('ps-3'), 8);
  const html = spreads.finalHtml(DOC, before, new Set(['ps-2']));
  assert.equal(html.split('<div class="print-blank" aria-hidden="true"></div><section').length - 1, 2);
  assert.ok(html.includes('<div class="print-blank" aria-hidden="true"></div><section class="print-sec chapter-sec" id="ps-1"'));
  assert.ok(html.includes('#ps-2 .plate-page img { visibility: hidden !important; } #ps-2 .bd-layer.bd-page { display: none !important; }'));
  // The measuring pass must wear the same rules (spreads.stampCss): the
  // trim-wide layer otherwise overflows the page and Chromium shrinks
  // the whole document, so the page map would not match the pages printed.
  assert.ok(html.includes(spreads.stampCss(new Set(['ps-2']))));
  assert.equal(spreads.stampCss(new Set()), '');
  assert.ok(html.includes('html, body { background: transparent !important; }'), 'the white page colour must not cover the pictures beneath');
  assert.ok(!spreads.finalHtml(DOC, new Set(), new Set()).includes('visibility: hidden'));
});

async function pdfWithDests(pages: number, dests: Record<string, number>) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([432, 648]);
  const refs = doc.getPages().map((p) => p.ref);
  const dict = doc.context.obj({});
  for (const [name, at] of Object.entries(dests)) dict.set(PDFName.of(name), doc.context.obj([refs[at], PDFName.of('XYZ'), 6, 636, 0]));
  doc.catalog.set(PDFName.of('Dests'), doc.context.register(dict));
  return doc.save({ useObjectStreams: false });
}

test('print spreads: start pages are read from the PDF\'s named destinations', async () => {
  const bytes = await pdfWithDests(6, { 'ps-0': 0, 'ps-1': 2, 'ps-2': 5 });
  const starts = await spreads.startPages(bytes);
  assert.deepEqual(Object.fromEntries(starts), { 'ps-0': 0, 'ps-1': 2, 'ps-2': 5 });
  assert.equal((await spreads.startPages(await (await PDFDocument.create()).save())).size, 0);
});

function contentsOf(doc: PDFDocument, pageIndex: number): string[] {
  const contents = doc.getPages()[pageIndex].node.Contents();
  const list = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return list.map((ref) => {
    const stream = doc.context.lookup(ref as PDFRef) as PDFRawStream;
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  });
}

test('print spreads: the plate and the Spread layer are drawn beneath the page, covering it', async () => {
  const base = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const p = base.addPage([432, 648]);
    p.drawText('words ' + i, { x: 60, y: 600, size: 11 });
  }
  const bytes = await base.save({ useObjectStreams: false });
  const plan = spreads.planSections(DOC);
  const stamped = await spreads.stampable(plan);
  assert.deepEqual([...stamped], ['ps-2']);
  const out = await spreads.stampSpreads(bytes, plan, new Map([['ps-2', 1]]), stamped);
  const doc = await PDFDocument.load(out);
  const plate = contentsOf(doc, 1), layer = contentsOf(doc, 2), untouched = contentsOf(doc, 0);
  // pdf-lib suffixes a new XObject's name with a random number
  assert.match(plate[0], /\/BeukPlate1(-\d+)? Do/, 'the plate is the first thing drawn on its page');
  assert.match(layer[0], /\/BeukSpread2(-\d+)? Do/, 'the backdrop is the first thing drawn on the facing page');
  assert.ok(plate.slice(1).join('').includes('words 1') || plate.join('').length > plate[0].length, 'the page\'s own content follows, on top');
  assert.ok(!untouched.join('').includes('Beuk'), 'other pages are untouched');
  // 4×6 px picture on a 432×648 pt page: covered exactly (same aspect), from the corner
  assert.match(plate[0], /432 0 0 648 0 0 cm/);
});

test('print spreads: a spread whose picture cannot be embedded keeps its own pictures in the page', async () => {
  const webp = DOC.split(JPEG).join('data:image/png;base64,AAAA');
  const plan = spreads.planSections(webp);
  assert.equal((await spreads.stampable(plan)).size, 0);
});

/* BEUK:platefit — a plate the writer shows whole stays in its page, inside
   the margins: the studio marks its figure `plate-page plate-whole`, which
   PLATE_RE (an exact `class="plate-page"`) does not read, so nothing is
   drawn edge to edge for it. Its backdrop is still stamped, and the
   stand-down rule that then hides the section's in-page plate is answered
   in the studio's own stylesheet (client/index.html buildPrintHtml:
   `#ps-N .plate-page.plate-whole img { visibility: visible !important }`). */
test('print spreads: a plate shown whole is not drawn edge to edge; its backdrop still is', async () => {
  const whole = DOC.replace('<figure class="plate-page">', '<figure class="plate-page plate-whole">');
  assert.notEqual(whole, DOC);
  const plan = spreads.planSections(whole);
  assert.equal(plan[2].spread, true);
  assert.equal(plan[2].plate, null, 'a whole plate is left in the page');
  assert.equal(plan[2].layer, JPEG, 'its backdrop is still read');
  assert.equal(plan[2].start, 'verso', 'it still opens on a verso');
  const stamped = await spreads.stampable(plan);
  assert.deepEqual([...stamped], ['ps-2']);
  // the stand-down rule the studio's own rule must outrank: one id, one class, one element
  assert.ok(spreads.stampCss(stamped).startsWith('#ps-2 .plate-page img { visibility: hidden !important; }'));
  // a section with a whole plate and no backdrop has nothing to stamp, so nothing is stood down
  const bare = whole.replace(/<div class="bd-layer[^>]*><\/div>/, '');
  assert.notEqual(bare, whole);
  assert.deepEqual([...(await spreads.stampable(spreads.planSections(bare)))], []);
});

/* Across both pages — one picture over the gutter. The studio crops it
   once (client/index.html acrossCrop) and bakes each half at the size of
   its page WITH its bleed (trim + bleed on the outer edge, top and bottom;
   the trim alone without bleed), and marks the verso's figure
   `plate-page plate-across` (a class after `plate-page`, so a fill plate's
   markup is unchanged). The renderer draws both halves of such a spread
   exactly over that box: no cover crop of its own, no scaling about the
   spine — a second crop here would move the gutter line. */
const cmOf = (content: string): number[] => {
  const m = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/.exec(content);
  assert.ok(m, 'a placement matrix');
  return m.slice(1, 7).map(Number);
};
const near = (got: number[], want: number[], what: string) =>
  assert.ok(got.length === want.length && got.every((v, i) => Math.abs(v - want[i]!) < 1e-3), what + ': ' + got.join(' ') + ' vs ' + want.join(' '));
async function fourPages() {
  const base = await PDFDocument.create();
  for (let i = 0; i < 4; i++) base.addPage([432, 648]).drawText('words ' + i, { x: 60, y: 600, size: 11 });
  return base.save({ useObjectStreams: false });
}

test('print spreads: a plate-across figure is drawn as given: its image box equals the page box with bleed, and is not re-cropped', async () => {
  const across = DOC.replace('<figure class="plate-page">', '<figure class="plate-page plate-across">');
  assert.notEqual(across, DOC);
  const plan = spreads.planSections(across);
  assert.equal(plan[2].spread, true);
  assert.equal(plan[2].across, true);
  assert.equal(plan[2].plate, JPEG, 'the across half is read as the plate');
  assert.equal(plan[2].layer, JPEG, 'its other half, the Spread page layer');
  const stamped = await spreads.stampable(plan);
  assert.deepEqual([...stamped], ['ps-2']);
  // its in-page picture is stood down like any stamped plate's
  assert.ok(spreads.stampCss(stamped).startsWith('#ps-2 .plate-page img { visibility: hidden !important; }'));
  const bytes = await fourPages();
  const b = 9; // 0.125 in
  // no bleed: each half covers its trim exactly
  {
    const doc = await PDFDocument.load(await spreads.stampSpreads(bytes, plan, new Map([['ps-2', 1]]), stamped));
    near(cmOf(contentsOf(doc, 1)[0]!), [432, 0, 0, 648, 0, 0], 'verso, no bleed');
    near(cmOf(contentsOf(doc, 2)[0]!), [432, 0, 0, 648, 0, 0], 'recto, no bleed');
  }
  // bleed, left to right: the verso (a left page) bleeds left, top and bottom; the recto right, top and bottom.
  // Each half is drawn over exactly trim + its bleed (441 x 666 pt) — the 4 x 6 picture is not cover-cropped to it —
  // and the two meet at the spine (x = 432 on the verso, x = 0 on the recto)
  {
    const doc = await PDFDocument.load(await spreads.stampSpreads(bytes, plan, new Map([['ps-2', 1]]), stamped, { pt: b, rtl: false }));
    const v = cmOf(contentsOf(doc, 1)[0]!), r = cmOf(contentsOf(doc, 2)[0]!);
    near(v, [432 + b, 0, 0, 648 + 2 * b, -b, -b], 'verso, bleed');
    near(r, [432 + b, 0, 0, 648 + 2 * b, 0, -b], 'recto, bleed');
    assert.equal(v[4]! + v[0]!, 432, 'the verso ends at the spine');
    assert.equal(r[4], 0, 'the recto starts at the spine');
    // a fill plate on the same page would be cover-fitted about the spine instead: the test tells the two apart
    const cover = bleedMod.coverRect(4, 6, 432, 648, bleedMod.bleedSides(1, { pt: b, rtl: false }));
    assert.ok(Math.abs(cover.w - v[0]!) > 1 || Math.abs(cover.x - v[4]!) > 1, 'coverRect would have cropped it again');
  }
  // bleed, right to left: the verso is a right-hand page and bleeds right; the recto bleeds left
  {
    const doc = await PDFDocument.load(await spreads.stampSpreads(bytes, plan, new Map([['ps-2', 1]]), stamped, { pt: b, rtl: true }));
    near(cmOf(contentsOf(doc, 1)[0]!), [432 + b, 0, 0, 648 + 2 * b, 0, -b], 'RTL verso, bleed');
    near(cmOf(contentsOf(doc, 2)[0]!), [432 + b, 0, 0, 648 + 2 * b, -b, -b], 'RTL recto, bleed');
  }
});

test('print spreads: a plain plate-page figure is unchanged', async () => {
  const plan = spreads.planSections(DOC);
  assert.equal(plan[2].across, false);
  assert.equal(plan[2].plate, JPEG);
  const stamped = await spreads.stampable(plan);
  const bytes = await fourPages();
  const b = 9;
  const doc = await PDFDocument.load(await spreads.stampSpreads(bytes, plan, new Map([['ps-2', 1]]), stamped, { pt: b, rtl: false }));
  // still the cover fit about the spine (bleed.mjs coverRect), for the plate and its backdrop alike
  for (const [page, what] of [[1, 'plate'], [2, 'layer']] as const) {
    const r = bleedMod.coverRect(4, 6, 432, 648, bleedMod.bleedSides(page, { pt: b, rtl: false }));
    near(cmOf(contentsOf(doc, page)[0]!), [r.w, 0, 0, r.h, r.x, r.y], what);
  }
  // and a whole plate is still not read
  assert.equal(spreads.planSections(DOC.replace('<figure class="plate-page">', '<figure class="plate-page plate-whole">'))[2].across, false);
});
