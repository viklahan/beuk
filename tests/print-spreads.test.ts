import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as spreads from '../deploy/renderer/spreads.mjs';

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
