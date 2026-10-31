import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as heads from '../deploy/renderer/heads.mjs';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as spreads from '../deploy/renderer/spreads.mjs';

/* deploy/renderer/heads.mjs (BEUK:runheads) — running heads drawn onto
   the print PDF. Chromium sets neither string(chapterTitle) (a chapter
   head prints empty) nor :first on a named page (every opening page
   keeps its head), so the studio names each section's head in a
   <meta name="beuk-heads"> and the renderer stamps it. These tests build
   their PDFs with pdf-lib, so no browser is needed. */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFile(path.join(here, '..', f), 'utf8');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STYLE = "font-family: 'Libre Baskerville', Georgia, serif; font-size: 8.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #555;";
const metaDoc = (cfg: unknown) => '<!doctype html><html lang="en"><head><meta charset="utf-8"/>\n<meta name="beuk-heads" content="' + esc(JSON.stringify(cfg)) + '"/>\n<style>@page { size: 6in 9in; }</style></head><body></body></html>';
const CFG = { box: 'top-center', style: STYLE, omitOpenings: true, omitBlank: true, heads: { 'ps-0': '', 'ps-1': '', 'ps-2': 'The Ferry Crossing', 'ps-3': 'Gull Terrace & “Home”', 'ps-4': 'Gull Terrace & “Home”' } };

test('print heads: the document asks for heads, or does not; a meta that does not read as a head is ignored', () => {
  const cfg = heads.headsConfig(metaDoc(CFG));
  assert.deepEqual(cfg, { box: 'top-center', style: STYLE, omitOpenings: true, omitBlank: true, heads: CFG.heads });
  assert.equal(heads.headsConfig('<html><head></head><body></body></html>'), null);
  assert.equal(heads.headsConfig(metaDoc({ ...CFG, box: 'left-middle' })), null, 'only the two head boxes');
  assert.equal(heads.headsConfig(metaDoc({ ...CFG, style: 'color: red; } body { display: none' })), null, 'declarations only, no rule break-out');
  assert.equal(heads.headsConfig(metaDoc({ ...CFG, style: 'color: red; </style><script>' })), null);
  assert.equal(heads.headsConfig(metaDoc({ ...CFG, style: 'background: url(x) @import' })), null);
  assert.equal(heads.headsConfig(metaDoc({ ...CFG, heads: null })), null);
  const loose = heads.headsConfig(metaDoc({ ...CFG, omitOpenings: 'yes', heads: { 'ps-0': 'A'.repeat(500), evil: 'x', 'ps-1': 7 } }));
  assert.equal(loose.omitOpenings, false, 'only a real true omits');
  assert.equal(loose.heads['ps-0'].length, 300, 'a head is capped');
  assert.equal(loose.heads['ps-1'], '');
  assert.ok(!('evil' in loose.heads), 'only section ids');
});

test('print heads: the final pass clears the stylesheet\'s own head in the chosen box, on every page', () => {
  assert.equal(heads.headsCss({ box: 'top-center' }), '@page { @top-center { content: none !important; } }');
  assert.equal(heads.headsCss({ box: 'bottom-center' }), '@page { @bottom-center { content: none !important; } }');
  const out = heads.withHeadsCss('<html><head><style>x</style></head><body></body></html>', { box: 'top-center' });
  assert.ok(out.includes('<style>@page { @top-center { content: none !important; } }</style></head>'));
});

/* Five sections: a title page (display), a foreword, a chapter that is a
   paired spread (plate on its first page), a chapter with a blank verso
   before it, and acknowledgments (back matter). */
const PLAN = [
  { id: 'ps-0', display: true, spread: false },
  { id: 'ps-1', display: false, spread: false },
  { id: 'ps-2', display: false, spread: true },
  { id: 'ps-3', display: false, spread: false },
  { id: 'ps-4', display: false, spread: false },
];
// 0 title | 1 foreword, 2 foreword | 3 plate, 4 opening, 5 | 6 blank | 7 opening, 8, 9 | 10 ack opening, 11
const STARTS = new Map([['ps-0', 0], ['ps-1', 1], ['ps-2', 3], ['ps-3', 7], ['ps-4', 10]]);

test('print heads: each page\'s head, as the Print Interior View draws it', () => {
  const cfg = heads.headsConfig(metaDoc(CFG));
  const slots = heads.pageHeads({ plan: PLAN, starts: STARTS, before: new Set(['ps-3']), pageCount: 12, cfg });
  assert.deepEqual(slots, [
    null, // the first page
    null, null, // the foreword: no chapter yet, so no chapter head (its opening is bare anyway)
    null, // the plate's own page
    null, // the spread chapter's opening (the page after its plate)
    'The Ferry Crossing',
    null, // a blank page, bare
    null, // the next chapter's opening
    'Gull Terrace & “Home”', 'Gull Terrace & “Home”',
    null, // the acknowledgments' opening — every opening is bare (V, 2026-10-31)
    'Gull Terrace & “Home”', // back matter carries the last chapter's head, as the view does
  ]);
});

test('print heads: openings and blank pages carry the head when the writer asks', () => {
  const cfg = heads.headsConfig(metaDoc({ ...CFG, omitOpenings: false, omitBlank: false }));
  const slots = heads.pageHeads({ plan: PLAN, starts: STARTS, before: new Set(['ps-3']), pageCount: 12, cfg });
  assert.equal(slots[0], null, 'the first page never');
  assert.equal(slots[3], null, 'a plate never');
  assert.equal(slots[4], 'The Ferry Crossing', 'the spread\'s opening');
  assert.equal(slots[6], 'The Ferry Crossing', 'the blank page belongs to the section before it');
  assert.equal(slots[7], 'Gull Terrace & “Home”');
  assert.equal(slots[10], 'Gull Terrace & “Home”');
  const lit = heads.headsConfig(metaDoc({ ...CFG, heads: Object.fromEntries(Object.keys(CFG.heads).map((k) => [k, 'Head Fixture  ·  Fixture Author'])) }));
  const litSlots = heads.pageHeads({ plan: PLAN, starts: STARTS, before: new Set(['ps-3']), pageCount: 12, cfg: lit });
  assert.equal(litSlots[2], 'Head Fixture  ·  Fixture Author', 'a literal head on the foreword\'s second page');
  assert.equal(litSlots[0], null, 'never on a display page');
  assert.equal(litSlots[1], null, 'the foreword\'s opening is bare');
});

test('print heads: never on the book\'s first page or on a display page, wherever it falls', () => {
  // a foreword first (not a display page), a dedication (display) later, then a chapter
  const plan = [{ id: 'ps-0', display: false, spread: false }, { id: 'ps-1', display: true, spread: false }, { id: 'ps-2', display: false, spread: false }];
  const starts = new Map([['ps-0', 0], ['ps-1', 2], ['ps-2', 3]]);
  const lit = heads.headsConfig(metaDoc({ ...CFG, omitOpenings: false, omitBlank: false, heads: { 'ps-0': 'Book', 'ps-1': 'Book', 'ps-2': 'Book' } }));
  const slots = heads.pageHeads({ plan, starts, before: new Set(), pageCount: 5, cfg: lit });
  assert.deepEqual(slots, [null, 'Book', null, 'Book', 'Book'], 'page 1 bare though its section carries a head; the dedication bare though openings carry heads');
});

test('print heads: a head is a CSS string that cannot leave its rule or its <style>', () => {
  assert.equal(heads.cssString('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
  assert.equal(heads.cssString('x</style><script>alert(1)</script>'), '"x\\3C /style>\\3C script>alert(1)\\3C /script>"');
  assert.equal(heads.cssString('two\nlines'), '"two lines"');
  const html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><style>@page { size: 6in 9in; }</style></head><body><p>book</p></body></html>';
  const doc = heads.headsDocument(html, ['One', 'Two </style><b>'], { box: 'bottom-center', style: STYLE });
  assert.ok(doc.startsWith('<!doctype html><html lang="ar" dir="rtl"><head>'), 'the book\'s own root and head: its direction, so its sides');
  assert.ok(!doc.includes('<p>book</p>'), 'nothing of the book\'s body');
  assert.ok(doc.includes('@page bh0 { @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: "One"; ' + STYLE + ' } @bottom-right { content: none; } }'));
  assert.ok(doc.includes('content: "Two \\3C /style>\\3C b>"'));
  assert.equal(doc.split('</style>').length - 1, 2, 'the book\'s style and the heads\' — a head never closes one early');
  assert.equal((doc.match(/<div class="bh" style="page: bh1"><\/div>/g) || []).length, 2, 'two pages per head: one per side');
  assert.ok(doc.includes('html, body { background: transparent !important; }'), 'nothing painted over the page it is drawn on');
});

test('print heads: each distinct head is set once', () => {
  assert.deepEqual(heads.headTexts([null, 'A', 'A', null, 'B', 'A']), { texts: ['A', 'B'], index: [-1, 0, 0, -1, 1, 0] });
});

async function bookPdf(pages: number, linkName?: string) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([432, 648]);
  if (linkName) {
    const p0 = doc.getPage(0);
    doc.catalog.set(PDFName.of('Dests'), doc.context.obj({ [linkName]: [p0.ref, PDFName.of('XYZ'), 0, 648, null] }));
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], Dest: PDFString.of(linkName) });
    p0.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  }
  return Buffer.from(await doc.save());
}
async function headsPdf(texts: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of texts) for (const side of ['first', 'other']) doc.addPage([432, 648]).drawText(t + '/' + side, { x: 100, y: 630, size: 8, font });
  return Buffer.from(await doc.save());
}
const xobjectsOn = (doc: PDFDocument, i: number) => {
  const res = doc.getPage(i).node.Resources();
  const xo = res && res.lookupMaybe(PDFName.of('XObject'), PDFDict);
  return xo ? xo.keys().length : 0;
};

test('print heads: each page gets its head\'s page for its own side, and pages with none are untouched', async () => {
  const { pdf, drawn } = await heads.stampHeads(await bookPdf(5), await headsPdf(['A', 'B']), [-1, 0, 0, -1, 1]);
  assert.equal(drawn, 3);
  const doc = await PDFDocument.load(pdf);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => xobjectsOn(doc, i)), [0, 1, 1, 0, 1]);
  // the side: page 1 (odd) takes head A's second page, page 2 (even) its first
  const used = (i: number) => {
    const xo = doc.getPage(i).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    return xo.lookup(xo.keys()[0]);
  };
  assert.notEqual(used(1), used(2), 'a left page and a right page take different sides');
});

test('print heads: every head is embedded from one copy of its type (one embedPages call: the font once, not once per head)', async () => {
  const texts = Array.from({ length: 12 }, (_, i) => 'Head ' + i);
  const index = Array.from({ length: 24 }, (_, p) => p % 12);
  const { pdf } = await heads.stampHeads(await bookPdf(24), await headsPdf(texts), index);
  const doc = await PDFDocument.load(pdf);
  const fonts = new Set<string>();
  for (const page of doc.getPages()) {
    const xo = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    for (const k of xo.keys()) {
      const form = xo.lookup(k) as unknown as { dict: PDFDict };
      const res = form.dict.lookup(PDFName.of('Resources'), PDFDict);
      const font = res.lookup(PDFName.of('Font'), PDFDict);
      for (const fk of font.keys()) fonts.add(String(font.get(fk)));
    }
  }
  assert.equal(fonts.size, 1, 'one font object behind all 24 drawn heads, got ' + fonts.size);
});

test('print heads: the measuring links come out of the shipped file', async () => {
  const { pdf } = await heads.stampHeads(await bookPdf(2, 'ps-0'), null, [-1, -1], ['ps-0']);
  const doc = await PDFDocument.load(pdf);
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  assert.ok(!dests || !dests.keys().some((k) => k.decodeText() === 'ps-0'), 'no named destination left');
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  assert.ok(!annots || annots.size() === 0, 'no link annotation left');
  assert.equal(await heads.pageCountOf(pdf), 2);
});

test('print heads: the plan knows a display section', () => {
  const plan = spreads.planSections('<section class="print-sec display-sec" id="ps-0">t</section><section class="print-sec chapter-sec" id="ps-1" data-start="recto">c</section>');
  assert.deepEqual(plan.map((s: { display: boolean }) => s.display), [true, false]);
});

test('print heads: the renderer draws them after spreads and notes, before bleed; the studio writes the meta', async () => {
  const server = await read('deploy/renderer/server.mjs');
  assert.match(server, /import \{[^}]*headsConfig[^}]*\} from '\.\/heads\.mjs'/);
  const finish = server.slice(server.indexOf('const finish = async'), server.indexOf('let out = await finish(fn);'));
  assert.ok(finish.indexOf('stampFootnotes(') < finish.indexOf('drawHeads(out, plan, finalStart, before)'), 'after the notes');
  assert.match(finish, /if \(!heads\) return printDoc\(source\);/, 'a document without heads prints as before');
  assert.match(finish, /withHeadsCss\(finalHtml\(source, before, stamped\), heads\)/, 'the final pass clears the stylesheet head');
  assert.ok(server.indexOf('drawHeads(out, plan, finalStart, before)') < server.indexOf('applyBleed(out, bleed)'), 'before bleed');
  assert.match(await read('deploy/renderer/Dockerfile'), /COPY server\.mjs spreads\.mjs footnotes\.mjs bleed\.mjs heads\.mjs \.\//);
  const html = await read('client/index.html');
  assert.match(html, /\(printHeadsConfig\(\) \? '<meta name="beuk-heads" content="' \+ esc\(JSON\.stringify\(printHeadsConfig\(\)\)\)/);
  assert.match(html, /const headText = printPageHeadText\(page\.chapter\);/, 'the view reads the same words');
  assert.match(html, /const chapterOpening = !page\.blank && page\.col === \(paired \? 1 : 0\) && !!page\.section;/, 'every section opening');
  assert.match(html, /\(omitChapter \? "\\n\.print-sec \{ page: chapterstart; \}" : ""\)/, 'the stylesheet\'s rule too');
});
