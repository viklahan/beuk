import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/print-markup.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { arriveForExport } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { loadPrint, type PrintClosure } from '../src/print/print';
import { fixtures } from './fixtures';
import { drawnOf, installStandIns, picDraw, png, UNDECODABLE, type Rec } from './across-fixture';

/* Across both pages, Task 4 — the print preview (1.0's Print Interior View, pivPageEl / renderPrintView in
   client/index.html), reached through print's own module, on 1.0's applyBookDoc state of a book. The preview shows an
   across chapter with print's very halves (printAcrossHalves, the press cache): the verso half edge to edge on the plate
   leaf, the recto half over the opening leaf, each over its page and its bleed as the renderer draws them. Until the
   halves are baked (or when the bake fails) it shows what print would then print: the whole picture inside the margins
   and no layer. The stored backdrop is never drawn for an across opening.
   jsdom has no canvas and lays no columns out: the stand-ins are ./across-fixture.ts's (installed before print's module
   loads), and every section's measure flow reports two columns, so each section is two pages here — a plate leaf and
   its opening, as in a browser. */

type Api = PrintClosure['api'] & Rec;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);

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
  // 1.0's print dialogs, the Print Interior View and its measurer, as the studio puts them on the page
  // (src/print/PrintModals.tsx); the export modal the view closes as it opens
  document.body.insertAdjacentHTML('beforeend', markup.print + markup.view + markup.measure + '<div id="modalExport"></div>');
  // jsdom lays out no text: a range has no boxes (the footnote layout of a fixture's notes measures them)
  const rp = Range.prototype as unknown as Rec;
  if (typeof rp.getClientRects !== 'function') rp.getClientRects = () => [];
  if (typeof rp.getBoundingClientRect !== 'function') rp.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  // every measure flow (.piv-book) lays out as two columns: a plate leaf and its opening
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('piv-book') ? 2 * (parseFloat(this.style.width) + 96) : 0;
    },
  });
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
/** A 6 x 9 book whose first chapter's plate is set across both pages; the chapter also stores a backdrop (which across
 *  takes over for the opening: stored, not drawn). The second chapter keeps a fill plate. */
function acrossBook(o: { bleed?: boolean; lang?: string; pic?: string } = {}): { st: Rec; ch: Rec; ch2: Rec; src: string } {
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
  let ch2 = chs[1];
  if (!ch2) {
    ch2 = c.api.mkSection('body', 'chapter', 'Chapter 2', { number: '2', content: many(4) }) as Rec;
    (st.sections as Rec[]).splice((st.sections as Rec[]).indexOf(ch) + 1, 0, ch2);
  }
  Object.assign(ch2, { plateId: 'other', plateAlt: 'A gull', plateFit: 'fill' });
  st.printTrim = '6x9';
  st.printRecto = true;
  st.printBleed = !!o.bleed;
  st.meta.language = o.lang || 'en';
  return { st, ch, ch2, src: 'data:image/png;base64,' + (o.pic || WIDE) };
}
type Page = { n: number; blank: boolean; section: Rec | null; col: number };
type Piv = { model: { g: Rec & { mg: Rec }; pages: Page[]; spreads: number } | null; spread: number; guides: boolean; baking?: Promise<unknown> };
const piv = (): Piv => a.piv as unknown as Piv;
const spreadEl = () => document.getElementById('pivSpread')!;
/** The preview's spread holding `s`'s plate leaf, drawn: the plate leaf and the opening leaf. */
function spreadOf(s: Rec, rebuild = true): { plateEl: HTMLElement; openEl: HTMLElement; pages: HTMLElement[]; plate: Page } {
  const v = piv();
  v.guides = true;
  if (rebuild || !v.model) v.model = a.buildPrintViewModel();
  const plate = v.model!.pages.find((p) => p.section === s && p.col === 0)!;
  expect(plate, 'the plate leaf').toBeTruthy();
  v.spread = Math.floor(plate.n / 2);
  a.renderPrintView();
  const el = spreadEl();
  const plateEl = el.querySelector<HTMLElement>('.piv-page[data-page="' + plate.n + '"]')!;
  const openEl = el.querySelector<HTMLElement>('.piv-page[data-page="' + (plate.n + 1) + '"]')!;
  expect(plateEl, 'the plate leaf drawn').toBeTruthy();
  expect(openEl, 'the opening leaf drawn').toBeTruthy();
  return { plateEl, openEl, pages: Array.from(el.querySelectorAll<HTMLElement>(':scope > .piv-page')), plate };
}
/** What print prints for `ch` right now (after its press bake): the across halves, from the document itself. */
async function printHalves(st: Rec, ch: Rec): Promise<{ verso: string; recto: string }> {
  await a.preparePrintPress();
  const html = String(pc.vars.buildPrintHtml());
  const k = (st.sections as Rec[]).filter((s) => a.inBook(s) && s.type !== 'cover').indexOf(ch);
  const from = html.indexOf('id="ps-' + k + '"');
  const sec = html.slice(html.lastIndexOf('<section', from), html.indexOf('</section>', from));
  const v = /<figure class="plate-page plate-across"><img src="(data:image\/jpeg;base64,[^"]+)"/.exec(sec);
  const r = /<div class="bd-layer bd-spread bd-page bd-baked" style="background-image:url\((data:image\/jpeg;base64,[^)]+)\)"/.exec(sec);
  expect(v && r, 'print carries both halves').toBeTruthy();
  return { verso: v![1]!, recto: r![1]! };
}
const urlOf = (bg: string) => (/url\("?([^")]+)"?\)/.exec(bg) || [])[1] || '';
const px = (v: string) => parseFloat(v);

describe('Across both pages in the print preview (Task 4)', () => {
  it("the preview's verso and recto use the same two data URLs as the print HTML (preview = print)", async () => {
    const { st, ch } = acrossBook();
    const h = await printHalves(st, ch);
    expect(await a.printAcrossHalves(ch)).toEqual(h);
    const { plateEl, openEl } = spreadOf(ch);
    // the plate leaf: the verso half, bare (no head, no folio), nothing else of the picture
    const im = plateEl.querySelector<HTMLImageElement>('img.piv-plate-across')!;
    expect(im, 'the verso half on the plate leaf').toBeTruthy();
    expect(im.getAttribute('src')).toBe(h.verso);
    expect(im.alt).toBe('A harbour at dusk, wide');
    expect(plateEl.querySelector('.piv-plate-full, .piv-plate-whole')).toBeNull();
    expect(plateEl.querySelector('.piv-runhead, .piv-folio')).toBeNull();
    // the opening leaf: one layer, the recto half, drawn as print draws a baked layer (whole, unmasked: the Spread
    // fade is the one baked into it); the in-flow copy of that layer stands down
    const lays = openEl.querySelectorAll<HTMLElement>('.piv-bleed');
    expect(lays.length).toBe(1);
    const lay = lays[0]!;
    expect(lay.classList.contains('piv-across')).toBe(true);
    expect(urlOf(lay.style.backgroundImage)).toBe(h.recto);
    expect(lay.style.opacity).toBe('1');
    expect(openEl.classList.contains('piv-paired')).toBe(true);
    const inFlow = openEl.querySelector<HTMLElement>('.piv-clip .bd-layer');
    expect(inFlow, 'the in-flow layer is print\'s baked recto').toBeTruthy();
    expect(inFlow!.className).toBe('bd-layer bd-spread bd-page bd-baked');
    expect(inFlow!.style.display).toBe('none');
    // the chapter's stored backdrop is drawn nowhere in the spread, and stays stored
    const html = spreadEl().innerHTML;
    expect(html).not.toContain(OTHER.slice(0, 200));
    expect(html).not.toContain('bd-strong');
    expect([ch.backdropId, ch.backdropStrength]).toEqual(['other', 'strong']);
    // both halves are print's bakes of the plate's picture (the stand-in canvas's record)
    for (const u of [im.getAttribute('src')!, urlOf(lay.style.backgroundImage)]) expect(picDraw(drawnOf(u))!.tag).toMatch(/^img:1600x1200#/);
  });

  it('bleed on: the halves sit at the gutter edge as the renderer draws them (Review Focus 1)', async () => {
    for (const bleed of [false, true]) {
      for (const lang of ['en', 'ar']) {
        const rtl = lang === 'ar', what = `${bleed ? 'bleed' : 'no bleed'} ${lang}`;
        const { st, ch } = acrossBook({ bleed, lang });
        const h = await printHalves(st, ch);
        const { plateEl, openEl } = spreadOf(ch);
        const g = piv().model!.g;
        const b = bleed ? 0.125 * 96 : 0, W = 576, H = 864;
        expect(g.bleedPx || 0, what).toBe(b);
        // each leaf is its page with its bleed (trim + bleed on the outer edge, top and bottom)
        for (const el of [plateEl, openEl]) expect([px(el.style.width), px(el.style.height)], what).toEqual([W + b, H + 2 * b]);
        // the verso half covers its whole leaf, bleed included, exactly (placed as given: no cover, no crop)
        const im = plateEl.querySelector<HTMLImageElement>('img.piv-plate-across')!;
        expect(im.getAttribute('src'), what).toBe(h.verso);
        expect(im.parentElement, what).toBe(plateEl);
        expect([px(im.style.left), px(im.style.top), px(im.style.width), px(im.style.height)], what).toEqual([0, 0, W + b, H + 2 * b]);
        expect(im.style.objectFit, what).toBe('fill');
        // the recto half covers its whole leaf too, its picture set to the leaf (100% 100%) from its corner
        const lay = openEl.querySelector<HTMLElement>('.piv-bleed.piv-across')!;
        expect(urlOf(lay.style.backgroundImage), what).toBe(h.recto);
        expect([px(lay.style.left), px(lay.style.top), px(lay.style.width), px(lay.style.height)], what).toEqual([0, 0, W + b, H + 2 * b]);
        expect(lay.style.backgroundSize, what).toBe('100% 100%');
        expect(lay.style.backgroundPosition, what).toMatch(/^0(px)? 0(px)?$/);
        // each half is baked to exactly its leaf's shape, so nothing is stretched or cut on screen
        for (const u of [h.verso, h.recto]) {
          const d = drawnOf(u);
          expect(Math.abs(d.w / d.h - (W + b) / (H + 2 * b)) * d.h, what).toBeLessThanOrEqual(1);
        }
        // the gutter: the trim box sits against the spine on both leaves, the bleed on the outer edges, so each half's
        // gutter edge (where acrossCrop's two halves meet) is the trim's gutter edge, as the renderer stamps it
        const box = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > .piv-trimbox');
        if (bleed) {
          const pb = box(plateEl)!, ob = box(openEl)!;
          // LTR: plate on the left (bleed on its left, trim ends at its right edge = the spine); RTL mirrored
          expect(px(pb.style.left) + px(pb.style.width), what).toBe(rtl ? W : W + b);
          expect(px(pb.style.left), what).toBe(rtl ? 0 : b);
          expect(px(ob.style.left), what).toBe(rtl ? b : 0);
        } else {
          expect(box(plateEl), what).toBeNull();
          expect(box(openEl), what).toBeNull();
        }
        const want = c.api.acrossCrop(1600, 1200, { w: 6, h: 9 }, bleed ? 0.125 : 0, rtl);
        expect(picDraw(drawnOf(h.verso))!.src, what).toEqual(want.verso);
        expect(picDraw(drawnOf(h.recto))!.src, what).toEqual(want.recto);
        // the spine joins the two leaves: plate | spine | opening (LTR), opening | spine | plate (RTL); each leaf is
        // drawn for the side it stands on
        const kids = Array.from(spreadEl().children) as HTMLElement[];
        expect(kids.length, what).toBe(3);
        expect(kids[1]!.className, what).toBe('piv-spine');
        expect(kids[rtl ? 2 : 0], what).toBe(plateEl);
        expect(kids[rtl ? 0 : 2], what).toBe(openEl);
        expect(plateEl.classList.contains(rtl ? 'piv-right' : 'piv-left'), what).toBe(true);
        expect(openEl.classList.contains(rtl ? 'piv-left' : 'piv-right'), what).toBe(true);
      }
    }
  });

  it('RTL: the plate leaf is on the right (Review Focus 2)', async () => {
    const { st, ch, ch2 } = acrossBook({ lang: 'ar' });
    const h = await printHalves(st, ch);
    const { plateEl, openEl, pages, plate } = spreadOf(ch);
    // the spread reads right to left as it prints: the plate (the verso) on the right, the opening on the left
    expect(pages.map((p) => p.getAttribute('data-page'))).toEqual([String(plate.n + 1), String(plate.n)]);
    expect(plateEl.classList.contains('piv-right')).toBe(true);
    expect(openEl.classList.contains('piv-left')).toBe(true);
    expect(plateEl.querySelector<HTMLImageElement>('img.piv-plate-across')!.getAttribute('src')).toBe(h.verso);
    expect(urlOf(openEl.querySelector<HTMLElement>('.piv-bleed.piv-across')!.style.backgroundImage)).toBe(h.recto);
    // the verso half is the picture's right half, the recto its left: they meet at the spine
    const want = c.api.acrossCrop(1600, 1200, { w: 6, h: 9 }, 0, true);
    expect(picDraw(drawnOf(h.verso))!.src).toEqual(want.verso);
    expect(want.recto.x + want.recto.w).toBe(want.verso.x);
    // the opening's text box takes its gutter on the right (the spine side), the outer margin on the left
    const g = piv().model!.g, mg = g.mg;
    const clip = openEl.querySelector<HTMLElement>('.piv-clip')!;
    expect(px(clip.style.left)).toBe(mg.outside * 96);
    const gut = openEl.querySelector<HTMLElement>('.piv-guide-gutter')!;
    expect(gut.style.right).toBe('0px');
    // only the across spread is mirrored: the fill plate's spread in the same book is drawn as before (the preview
    // lays every other spread out left to right, verso on the left; see the task report)
    const f = spreadOf(ch2);
    expect(f.plateEl.classList.contains('piv-left')).toBe(true);
    expect(f.plateEl.querySelector('img.piv-plate-full')).toBeTruthy();
    // a left-to-right book keeps the across plate on the left
    const l = acrossBook({ lang: 'en' });
    await printHalves(l.st, l.ch);
    const ltr = spreadOf(l.ch);
    expect(ltr.pages.map((p) => p.getAttribute('data-page'))).toEqual([String(ltr.plate.n), String(ltr.plate.n + 1)]);
    expect(ltr.plateEl.classList.contains('piv-left')).toBe(true);
    expect(ltr.openEl.classList.contains('piv-right')).toBe(true);
  });

  /* Fix round 1, finding 1: the hardcover device's spread (hcFillSide) draws each leaf with pivPageEl on a fixed side,
     the verso always on the left, never mirrored. A leaf drawn away from its print side must never carry a half (in
     a right-to-left book that would be the painting reversed at the gutter): it gets the fallback. */
  it('a leaf drawn away from its print side (the hardcover, RTL, halves cached) shows the whole-picture fallback, never a half', async () => {
    for (const lang of ['ar', 'en']) {
      const rtl = lang === 'ar';
      const { st, ch, src } = acrossBook({ lang });
      const h = await printHalves(st, ch);
      expect(await a.printAcrossHalves(ch)).toEqual(h); // the halves are cached
      const model = a.buildPrintViewModel() as { pages: Page[] };
      const plate = model.pages.find((p) => p.section === ch && p.col === 0)!;
      const opening = model.pages.find((p) => p.section === ch && p.col === 1)!;
      const draw = (p: Page, side: string) => a.pivPageEl(p, side, model) as HTMLElement;
      const printPlateSide = rtl ? 'right' : 'left', otherSide = rtl ? 'left' : 'right';
      // on the wrong sides (as the hardcover draws an RTL book: verso left, recto right)
      const wp = draw(plate, otherSide), wo = draw(opening, printPlateSide);
      const whole = wp.querySelector<HTMLImageElement>('img.piv-plate-whole');
      expect(whole, lang + ': the whole picture on a plate leaf off its print side').toBeTruthy();
      expect(whole!.getAttribute('src')).toBe(src);
      expect(wp.querySelector('.piv-plate-across, .piv-plate-full'), lang).toBeNull();
      expect(wo.querySelector('.piv-bleed'), lang + ': no layer on an opening off its print side').toBeNull();
      const inFlow = wo.querySelector<HTMLElement>('.piv-clip .bd-layer');
      if (inFlow) expect(inFlow.style.display, lang + ': the in-flow layer stands down too').toBe('none');
      // nothing of either half is drawn on these leaves: the plate leaf carries no flow at all; the opening's flow
      // (the section's columns, the clip showing its column 1) holds print's markup — the plate figure in its column 0,
      // out of the clip, and the opening's layer, standing down — and nothing else carries a half
      expect(wp.innerHTML, lang).not.toContain(h.verso);
      expect(wp.innerHTML, lang).not.toContain(h.recto);
      const outsideFlow = (el: HTMLElement) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('.piv-clip').forEach((x) => x.remove());
        return copy.innerHTML;
      };
      expect(outsideFlow(wo), lang).not.toContain(h.verso);
      expect(outsideFlow(wo), lang).not.toContain(h.recto);
      // on their print sides, the halves
      const rp = draw(plate, printPlateSide), ro = draw(opening, otherSide);
      expect(rp.querySelector<HTMLImageElement>('img.piv-plate-across')!.getAttribute('src'), lang).toBe(h.verso);
      expect(urlOf(ro.querySelector<HTMLElement>('.piv-bleed.piv-across')!.style.backgroundImage), lang).toBe(h.recto);
    }
  });

  it('before the halves are baked the preview shows what print would (the whole picture inside the margins, no layer), and re-lays with the halves when they land', async () => {
    const fresh = png(1700, 1100); // a picture no earlier test baked
    const { st, ch, src } = acrossBook({ pic: fresh });
    expect(a.printAcrossKey(src)).toBeTruthy();
    a.openPrintInteriorView();
    const v = piv();
    const baking = v.baking;
    expect(baking, 'the view starts the bake of its across halves').toBeInstanceOf(Promise);
    // drawn now, before the bake has settled: the fallback print would print
    const before = spreadOf(ch, false);
    const whole = before.plateEl.querySelector<HTMLImageElement>('img.piv-plate-whole')!;
    expect(whole, 'the whole picture on the plate leaf').toBeTruthy();
    expect(whole.getAttribute('src')).toBe(src);
    expect(whole.alt).toBe('A harbour at dusk, wide');
    const g = v.model!.g, mg = g.mg;
    expect([px(whole.style.left), px(whole.style.top), px(whole.style.width), px(whole.style.height)]).toEqual([mg.outside * 96, mg.top * 96, g.contentW, g.contentH]);
    expect(before.plateEl.querySelector('.piv-plate-across, .piv-plate-full')).toBeNull();
    expect(before.openEl.querySelector('.piv-bleed')).toBeNull();
    expect(before.openEl.querySelector('.bd-layer')).toBeNull();
    expect(spreadEl().innerHTML).not.toContain(OTHER.slice(0, 200));
    // the bake lands: the view re-lays itself, on the same spread, with print's halves
    await baking;
    const h = await a.printAcrossHalves(ch);
    const after = spreadOf(ch, false);
    expect(after.plateEl.querySelector<HTMLImageElement>('img.piv-plate-across')!.getAttribute('src')).toBe(h.verso);
    expect(urlOf(after.openEl.querySelector<HTMLElement>('.piv-bleed.piv-across')!.style.backgroundImage)).toBe(h.recto);
    expect(await printHalves(st, ch)).toEqual(h);
    document.getElementById('modalPrintView')!.classList.remove('open');
  });

  it('a bake that fails: the preview keeps the fallback print prints (whole, no layer), and does not retry in a loop', async () => {
    const broken = png(1500, 1000);
    UNDECODABLE.add('data:image/png;base64,' + broken);
    try {
      const { st, ch, src } = acrossBook({ pic: broken });
      a.openPrintInteriorView();
      const v = piv();
      const baking = v.baking!;
      await baking;
      await new Promise((r) => setTimeout(r, 30));
      expect(v.baking, 'no second bake started by itself').toBe(baking);
      const { plateEl, openEl } = spreadOf(ch, false);
      expect(plateEl.querySelector<HTMLImageElement>('img.piv-plate-whole')!.getAttribute('src')).toBe(src);
      expect(plateEl.querySelector('.piv-plate-across, .piv-plate-full')).toBeNull();
      expect(openEl.querySelector('.piv-bleed, .bd-layer')).toBeNull();
      // print prints the same fallback, and says why
      await a.preparePrintPress();
      const html = String(pc.vars.buildPrintHtml());
      expect(html).toContain('<figure class="plate-page plate-whole"><img src="' + src + '"');
      expect((a.printPressReport() as Rec).errors).toContain('the picture did not decode');
      void st;
    } finally {
      UNDECODABLE.clear();
      document.getElementById('modalPrintView')!.classList.remove('open');
    }
  });

  it("the preview of fill and whole plates is unchanged (fixture books: every spread's DOM, snapshot before the change)", () => {
    /* Recorded on 22e841c (the preview code before this task's edits) with these stand-ins and two columns a section:
       sha256 of every spread's markup, in order, for each fixture with plates as stored (fill) and every plate set to
       whole, bleed off and on, left to right and right to left. If an intended preview change elsewhere moves these,
       re-record them only on the code before that change, never to get a green. */
    const SNAP: Record<string, string> = {
      'real/bookbinders-letter fill ar': '6bbf44a61ffe1da8152d8dbf83c89c8fa642a76fbc3ebc0f3f77c74c34645213',
      'real/bookbinders-letter fill bleed ar': '37d5b9b808ee14ac260f43d677f6d3df7b0a8156db1962fc5fd0d9ab15644c9c',
      'real/bookbinders-letter fill bleed en': 'ccdf5016dd7b82ab0bbb0c49e937c3cf92ed31c5e25d9ab11f61311184521bf2',
      'real/bookbinders-letter fill en': '95697f7446433d92992bf7196d0e2a3dcdbf6f381145c0e88024adc0ccae77a9',
      'real/bookbinders-letter whole ar': '823a820dfac236f585c3ada1f825de0c4f254a1f735e6b63278ff28d750a565f',
      'real/bookbinders-letter whole bleed ar': 'a6fd70bae4f1f67c99501c8b8e13e10b160687e77fdddd60d4b3cea8d212ff8f',
      'real/bookbinders-letter whole bleed en': 'e687b7748cc1d91edc309d38a2e4569f7bb7934cd64f598a69ae0f0308d0916a',
      'real/bookbinders-letter whole en': '7f43564e990af07b68d2d8710668ed7eb84bdda26df927d3fc4baf2e0b988d08',
      'real/lantern-coast-print fill ar': '68c79c790b0422ebf3cdc6655c503314914ce0522c787681f8c9d4d9a5f8fbd0',
      'real/lantern-coast-print fill bleed ar': '31cec3d08f5428fde968206998b11ee1a0ee2a8c7dabc8166eff62b1d4db4d9a',
      'real/lantern-coast-print fill bleed en': 'c1db4373f8864c4d5590b23c427657cdc7668b514895358b216cf2ae71fdedd4',
      'real/lantern-coast-print fill en': 'aa73d117c0f2a277b0a941811c57aaf0da1d76c7153b8994fe0707a243688098',
      'real/lantern-coast-print whole ar': '4c8ead07d7aaaa84139898f4663bf81bf2ce6ea0a9ad59ac18fdb29ac02b1b26',
      'real/lantern-coast-print whole bleed ar': '637cced2781d573b152be983ffc0bc975de5ada53723cc078dce53acf2d6f59c',
      'real/lantern-coast-print whole bleed en': '81ac706fbb21ba163d67362c226f59d8d1fe82d563a3a38ae3b623defedf0465',
      'real/lantern-coast-print whole en': '3fbdc427b66cf2bad2c0472c2a6d62c3b71d19c119bbd4920765085d840a1034',
      'real/lunas-beach-standalone fill ar': '18d6ca539626bdaefd3e298ff81516a497d17fa823e73d3ae68b9143149d5031',
      'real/lunas-beach-standalone fill bleed ar': '0a41ea6862321a3cf8c5001eaa0ec548cbfacd46e83ec6c086df6d218612fa36',
      'real/lunas-beach-standalone fill bleed en': '289efd32c79322b9e96d57ada6bc27cd6e4acedd152f0bec7ab303b01571bf3a',
      'real/lunas-beach-standalone fill en': 'c7f572eba2493981be00b69622a3a9b9f586025ac8db3968383a988c74a0826d',
      'real/lunas-beach-standalone whole ar': '5f7f0d9a89ebeebfde7c0e6657591923706b50bc7eb30e0266eac3ef2ef8f33b',
      'real/lunas-beach-standalone whole bleed ar': '8f55a6f793eefda9dca615ec43b81b4af6cc96a2ce351790ece742dd097f0b44',
      'real/lunas-beach-standalone whole bleed en': '75cace95713f4eaede95f7235f295d6fffb4ccf907309738727255c501b89f04',
      'real/lunas-beach-standalone whole en': '8c17309a98f8c33b075c9ba5322b6f5e7214c72be911bfc30f246b9ad33603ba',
      'real/salt-road-book-one fill ar': 'e622a6e2c3907407162043e641ca83f1633a2c77f20423ec6fa5917873238e9c',
      'real/salt-road-book-one fill bleed ar': '190df03297d1c91283edfe1fc6c3a8c950846d97379dcb0968264b5665b21c06',
      'real/salt-road-book-one fill bleed en': '658b51dec4077a4318436df7b4d118404c355b0bf81eac61a72cb4abeb48a342',
      'real/salt-road-book-one fill en': '09a76cb232f9ca2d9206159cc395893cc266d33c4e1ee2ea5ff11490ed595d2f',
      'real/salt-road-book-one whole ar': '1dd38d67135da8c4992e60d768183ef28388f019fb2e07b8b019439cad53d073',
      'real/salt-road-book-one whole bleed ar': 'd7965f1375be4775f9c98e8b40e5ab15f7bf20ac6e2c9a94900eed3afa55ab42',
      'real/salt-road-book-one whole bleed en': 'd107ac31bc87671fda80a6379d279d146e68359237e56dc2727d19283202bbb4',
      'real/salt-road-book-one whole en': '4f5320ed4cc81aecbcd269d4917ede9cfc7ff498cb09f740fb5bbeaad8010e01',
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
            const v = piv();
            v.guides = true;
            v.model = a.buildPrintViewModel();
            const hash = createHash('sha256');
            let plates = 0;
            for (let s = 0; s < v.model!.spreads; s++) {
              v.spread = s;
              a.renderPrintView();
              const html = spreadEl().innerHTML;
              plates += (html.match(fit === 'whole' ? /piv-plate-whole/g : /piv-plate-full/g) || []).length;
              hash.update(html);
            }
            // (what is pinned: spreads carrying the fixture's plate leaves, as fill or whole, and no across markup)
            expect(plates, `${f.name} ${fit}`).toBeGreaterThan(0);
            got[`${f.name} ${fit}${bleed ? ' bleed' : ''} ${lang}`] = hash.digest('hex');
          }
        }
      }
    }
    if (process.env.ACROSS_RECORD) console.log('ACROSS_PREVIEW_SNAPSHOT ' + JSON.stringify(got));
    expect(Object.keys(got).length).toBe(names.length * 8);
    expect(got).toEqual(SNAP);
  }, 600_000);
});
