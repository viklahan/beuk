import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, loadSample, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { arriveForExport } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { loadPrint, type PrintClosure } from '../src/print/print';
import { installCanvas } from './print-fixture';
import { PNG_1PX } from './style-fixture';
import markup from '../src/generated/print-markup.json';

/* Wave 5b — 1.0's print self-checks (client/index.html, feature "print"), re-expressed on print's own module: the
   very functions 1.0's checks call (src/generated/closure-print.js), on 1.0's applyBookDoc state of the fixture
   (src/export/state.ts arriveForExport, corrected as the export corrects it). Each test names its check id; a check's
   halves that need the browser's layout (the interior view's pages per chapter, offsets) are the e2e's (the interior
   view's model compared with 1.0's on every fixture), and the halves that are the store check's (5d) are left out —
   the report says which. The "Untitled" book: 1.0's buildEmptyBook. */

type Rec = Record<string, unknown>;
type Api = PrintClosure['api'] & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let pc: PrintClosure;
let a: Api;
beforeAll(async () => {
  c = await loadClosure();
  pc = await loadPrint();
  a = pc.api as Api;
  setClosureT(t);
  setClosureLang('en');
  installCanvas();
  // 1.0's Print Interior View and its measurer, as the studio puts them on the page (src/print/PrintModals.tsx)
  document.body.insertAdjacentHTML('beforeend', markup.view + markup.measure);
});
/** 1.0's state of `book` (applyBookDoc, as the export builds it), set into print's module. */
function on(book: Rec): Rec {
  const st = arriveForExport(c, structuredClone(book)) as unknown as Rec;
  exportSafe(c, st as never, book);
  pc.setState(st);
  return st;
}
const empty = (): Rec => on(c.api.buildEmptyBook());
const PARA = 'The tide came in over the mud flats and the gulls rose all at once, crying over the harbour while the ferry sounded its horn twice for the far shore and the lamps came on along the quay one by one in the blue dusk.';
const many = (n: number) => Array.from({ length: n }, () => PARA).join('\n\n');

describe("1.0's print self-checks, on print's module", () => {
  it('print.trims.page-dimensions', () => {
    empty();
    const want = [['5x8', '5in 8in'], ['5.25x8', '5.25in 8in'], ['5.5x8.5', '5.5in 8.5in'], ['6x9', '6in 9in'], ['7x10', '7in 10in'], ['8.5x11', '8.5in 11in']];
    const bad = want.filter((w) => !(a.TRIM_SIZES as unknown as { id: string }[]).some((x) => x.id === w[0]) || !a.buildPrintCss(w[0], false).includes('size: ' + w[1] + ';'));
    expect(bad).toEqual([]);
  });

  it('print.trims.library (the wrap calculator is the main closure\'s wrapDims, 4c)', () => {
    const st = empty();
    const sizes = a.TRIM_SIZES as unknown as { id: string; group: string; w: number; h: number }[];
    const groups = a.TRIM_GROUPS as unknown as string[];
    expect(sizes.length).toBe(24);
    expect(new Set(sizes.map((x) => x.id)).size).toBe(24);
    expect(groups.every((g) => sizes.some((x) => x.group === g))).toBe(true);
    const opts = String(a.trimOptionsHtml());
    expect([(opts.match(/<optgroup/g) || []).length, (opts.match(/<option/g) || []).length]).toEqual([4, 24]);
    for (const id of ['4.25x7', '5.83x8.27', '6x9', '8.5x11', '11x8.5']) {
      const tr = a.trimSize(id);
      expect(a.buildPrintCss(id, false), id).toContain('size: ' + tr.w + 'in ' + tr.h + 'in;');
      st.printTrim = id;
      const g = a.pivGeometry();
      expect([g.pageW, g.pageH, g.trim.id], id).toEqual([tr.w * a.PIV_PX, tr.h * a.PIV_PX, id]);
      expect(g.contentW).toBe((tr.w - g.mg.inside - g.mg.outside) * a.PIV_PX);
      const d = c.api.wrapDims({ wrap: { trim: id, pages: 200, paper: 'white', customFactor: 0.0025, blurb: '', quote: '', imprint: '' } }) as unknown as { trim: { id: string }; totalW: number; totalH: number };
      expect(d.trim.id).toBe(id);
      expect(Math.abs(d.totalW - (tr.w * 2 + 200 * 0.0025 + 0.125 * 2))).toBeLessThan(1e-9);
      expect(Math.abs(d.totalH - (tr.h + 0.125 * 2))).toBeLessThan(1e-9);
    }
  });

  it('print.largeprint (the spread view\'s re-lay at 8.5x11: its geometry here, its pages in the e2e)', () => {
    const st = empty();
    const secs = st.sections as Rec[];
    const ch = secs.find((s) => s.type === 'chapter')!;
    ch.title = 'The Crossing';
    ch.content = 'The ferry left the harbour at first light, when the water was the colour of pewter and the gulls had not yet begun their arguing over the harbour wall.';
    const contentBefore = ch.content;
    st.printLargePrint = true;
    for (const id of ['6x9', '5x8']) {
      const css = String(a.buildPrintCss(id, false));
      for (const s of ['font-size: 18pt', 'line-height: 1.6', 'text-align: left', 'hyphens: manual']) expect(css, id + ' ' + s).toContain(s);
    }
    st.printTrim = '6x9';
    const html = String(pc.vars.buildPrintHtml());
    // (1.0's check finds the colophon's place among the included sections. The document holds the sections in the
    // book — inBook: an empty starter is left out, and the empty book's colophon is empty — so here the edition line's
    // section is found by 1.0's own rule in buildPrintHtml: the colophon, else the copyright page, else the last)
    const inDoc = secs.filter((s) => a.inBook(s) && s.type !== 'cover');
    const colo = inDoc.find((s) => s.type === 'colophon') || inDoc.find((s) => s.type === 'copyright') || inDoc[inDoc.length - 1];
    const coloIx = inDoc.indexOf(colo!);
    const chunks = html.split('<section class="print-sec');
    expect(html).toContain('<p class="lp-edition">' + t('print.lpEdition') + '</p>');
    expect(html).toContain('body { font-size: 18pt; }');
    expect(coloIx).toBeGreaterThanOrEqual(0);
    expect(chunks[coloIx + 1]).toContain('<p class="lp-edition">');
    expect(chunks.every((x, i) => i === 0 || i === coloIx + 1 || !x.includes('lp-edition'))).toBe(true);
    a.pivEnsureStyle();
    const sheet = document.getElementById('pivBookStyle')!.textContent!;
    for (const s of ['font-size: 18pt', 'line-height: 1.6', '.piv-book { font-size: 18pt; }']) expect(sheet).toContain(s);
    st.printTrim = '8.5x11';
    st.printRecto = false;
    const model = a.buildPrintViewModel();
    expect(model.g.pageW).toBe(816);
    expect(model.pages.length).toBeGreaterThan(0);
    expect(ch.content).toBe(contentBefore);
    st.printLargePrint = false;
    expect(a.buildPrintCss('6x9', false)).not.toContain('font-size: 18pt');
    expect(pc.vars.buildPrintHtml()).not.toContain('<p class="lp-edition">');
  });

  it('print.preflight', async () => {
    const st = empty();
    (st.meta as Rec).title = 'Preflight Fixture';
    (st.meta as Rec).author = 'Fixture Author';
    st.printTrim = '6x9';
    st.printLargePrint = false;
    const ch = (st.sections as Rec[]).find((s) => s.type === 'chapter')!;
    ch.title = 'Fixture Chapter';
    ch.content = Array.from({ length: 6500 }, () => 'harbour').join(' ') + '\n\n![A tiny chart](img:scpfimg1|full)';
    (st.images as Rec[]).push({ id: 'scpfimg1', name: 'Tiny Chart.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX });
    const r = a.auditPrintInterior() as { findings: { id: string; jump: { kind: string; sectionId?: string } | null }[]; facts: Rec & { trim: { id: string }; pages: number } };
    const dpi = r.findings.find((x) => x.id === 'images.resolution');
    expect(dpi?.jump).toEqual({ kind: 'section', sectionId: ch.id });
    expect(r.facts.pages).toBeGreaterThanOrEqual(24);
    expect(r.facts.trim.id).toBe('6x9');
    expect([r.facts.bodyFont, r.facts.headFont]).toEqual([(st.theme as Rec).bodyFont, (st.theme as Rec).headFont]);
    expect(r.findings.some((x) => x.id === 'margins.minimum')).toBe(false);
    expect(r.findings.some((x) => x.id === 'pages.range')).toBe(false);
    // the sample, reported as it is (1.0 reports it; it does not require it clean)
    const sample = await loadSample();
    const s2 = on(sample.buildSampleBook());
    s2.printTrim = '6x9';
    const r2 = a.auditPrintInterior() as { findings: unknown[]; facts: unknown };
    expect(r2.facts).toBeTruthy();
    expect(Array.isArray(r2.findings)).toBe(true);
  });

  it('print.margins.mirrored-gutter, print.margins.gutter-grows-with-pages', () => {
    empty();
    const mg = a.printMargins('6x9', 120);
    const css = String(a.buildPrintCss('6x9', false));
    const gi = a.inCss(mg.inside), go = a.inCss(mg.outside);
    expect(mg.inside).toBeGreaterThan(mg.outside);
    expect(css).toContain('@page :left { margin-left: ' + go + '; margin-right: ' + gi + '; }');
    expect(css).toContain('@page :right { margin-left: ' + gi + '; margin-right: ' + go + '; }');
    const g = (n: number) => a.printMargins('6x9', n).inside;
    expect(g(100)).toBe(0.625);
    expect(g(100) < g(250) && g(250) < g(450) && g(450) < g(650) && g(650) < g(800)).toBe(true);
    expect(g(800)).toBe(1.125);
    expect(a.printMargins('5x8', 100).top).toBeGreaterThanOrEqual(0.5);
    expect(a.printMargins('5x8', 100).bottom).toBeGreaterThan(a.printMargins('5x8', 100).top);
  });

  it('print.chapters.page-break-rules, print.running-head-and-folio', () => {
    const st = empty();
    const on1 = String(a.buildPrintCss('6x9', true)), off = String(a.buildPrintCss('6x9', false));
    expect(on1).toContain('.print-sec.chapter-sec { page-break-before: recto; }');
    expect(off).toContain('.print-sec.chapter-sec { page-break-before: always; }');
    expect(off).not.toContain('page-break-before: recto');
    expect(on1).toContain('.print-sec { page-break-before: always; }');
    expect(on1).toContain('.print-sec:first-child { page-break-before: avoid; }');
    expect(on1.indexOf('.print-sec.chapter-sec')).toBeLessThan(on1.indexOf('.print-sec:first-child'));
    const m = st.meta as Rec;
    expect(on1).toContain('@top-center { content: ' + a.cssStr(a.printHeadText()) + ';');
    expect(a.printHeadText()).toBe(String(m.title || '') + (m.author ? '  ·  ' + m.author : ''));
    expect(on1).toContain('@bottom-center { content: counter(page);');
    expect(on1).toContain('@page :first { @top-center { content: none; } @bottom-center { content: none; } }');
  });

  it('print.document.interior-only (on the sample: 1.0 runs it on the open book)', async () => {
    const st = on((await loadSample()).buildSampleBook());
    st.cover = { data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: 'Print Check Cover.png' };
    const html = String(pc.vars.buildPrintHtml());
    const wrapped = (st.sections as Rec[]).filter((s) => s.included && s.type !== 'cover').length;
    const tr = a.trimSize();
    expect(html).toContain('@page {');
    expect(html).toContain('size: ' + tr.w + 'in ' + tr.h + 'in;');
    expect((html.match(/class="print-sec/g) || []).length).toBe(wrapped);
    expect(/class="print-sec chapter-sec[ "]/.test(html)).toBe(true);
    expect(html).not.toContain('<img class="cover-img"');
    expect(html).not.toContain('PDF/X');
  });

  it('print.view.spreads (the model, the blank verso, the folio, the mirrored text box, the geometry; pages per chapter: the e2e)', () => {
    const st = empty();
    st.cover = null;
    st.images = [];
    const ht = c.api.mkSection('front', 'halftitle', 'Half Title', {});
    const ch1 = c.api.mkSection('body', 'chapter', 'The Crossing', { number: '1', content: many(60) });
    const ch2 = c.api.mkSection('body', 'chapter', 'The Return', { number: '2', content: many(60) });
    st.sections = [ht, ch1, ch2];
    st.activeId = ch1.id;
    Object.assign(st.meta as Rec, { title: 'Spread Fixture', author: 'Fixture Author' });
    st.printTrim = '6x9';
    st.printRecto = true;
    const piv = a.piv as unknown as { model: { g: Rec & { mg: Rec }; pages: { n: number; blank: boolean; section: unknown }[] } | null; spread: number; guides: boolean };
    piv.guides = true;
    piv.model = a.buildPrintViewModel();
    piv.spread = 0;
    const model = piv.model!, g = model.g;
    const mg = a.printMargins('6x9', a.printPageEstimate());
    expect([g.pageW, g.pageH, g.mg.inside]).toEqual([576, 864, mg.inside]);
    expect(String(a.buildPrintCss('6x9', true))).toContain('@page :right { margin-left: ' + a.inCss(mg.inside) + ';');
    const blank = model.pages.find((p) => p.blank)!;
    expect(blank.n).toBe(2);
    expect(model.pages.find((p) => p.section === ch1)!.n).toBe(3);
    expect(model.pages.find((p) => p.section === ch2)!.n % 2).toBe(1);
    piv.spread = 1;
    a.renderPrintView();
    const spreadEl = document.getElementById('pivSpread')!;
    const leftEl = spreadEl.querySelector('.piv-page[data-page="2"]')!;
    const rightEl = spreadEl.querySelector('.piv-page[data-page="3"]')!;
    expect(leftEl.getAttribute('data-blank')).toBe('true');
    expect(leftEl.querySelector('.piv-clip')).toBeNull();
    expect(rightEl.querySelector('.piv-clip')).not.toBeNull();
    expect(rightEl.querySelector('.piv-folio')!.textContent).toBe('3');
    expect(Math.abs(parseFloat((rightEl as HTMLElement).style.width) - 576)).toBeLessThan(0.01);
  });

  it('print.view.guides', () => {
    const st = empty();
    st.cover = null;
    st.images = [];
    const ht = c.api.mkSection('front', 'halftitle', 'Half Title', {});
    const ch1 = c.api.mkSection('body', 'chapter', 'The Crossing', { number: '1', content: many(20) });
    // (jsdom lays no columns out: each section is one page here, so a second chapter makes spread 1 two leaves, as
    // 1.0's 20 paragraphs do in a browser)
    const ch1b = c.api.mkSection('body', 'chapter', 'The Return', { number: '2', content: many(20) });
    st.sections = [ht, ch1, ch1b];
    st.activeId = ch1.id;
    st.printTrim = '6x9';
    st.printRecto = false;
    const piv = a.piv as unknown as { model: unknown; spread: number; guides: boolean };
    piv.guides = true;
    piv.model = a.buildPrintViewModel();
    piv.spread = 1;
    a.renderPrintView();
    const spreadEl = document.getElementById('pivSpread')!;
    expect([spreadEl.querySelectorAll('.piv-guide-trim').length, spreadEl.querySelectorAll('.piv-guide-margin').length, spreadEl.querySelectorAll('.piv-guide-gutter').length]).toEqual([2, 2, 2]);
    piv.guides = false;
    a.renderPrintView();
    expect(spreadEl.querySelectorAll('.piv-guide').length).toBe(0);
    piv.guides = true;
    a.renderPrintView();
    expect(spreadEl.querySelectorAll('.piv-guide').length).toBe(6);
    const html = String(pc.vars.buildPrintHtml());
    for (const s of ['piv-guide', 'piv-page', 'piv-runhead', 'piv-folio', 'piv-clip']) expect(html).not.toContain(s);
  });

  it('print.margins.custom', () => {
    const st = empty();
    const ch1 = c.api.mkSection('body', 'chapter', 'The Crossing', { number: '1', content: many(400) });
    st.sections = [ch1];
    st.activeId = ch1.id;
    st.printTrim = '6x9';
    st.printRecto = false;
    st.printMarginMode = 'auto';
    const estAuto = a.printPageEstimate();
    st.printMarginMode = 'custom';
    st.printCustomMargins = { inside: 0.9, outside: 0.4, top: 0.5, bottom: 0.8 };
    const mg = a.printMargins();
    const css = String(a.buildPrintCss('6x9', true));
    const geom = a.pivGeometry();
    expect([mg.inside, mg.outside, mg.top, mg.bottom]).toEqual([0.9, 0.4, 0.5, 0.8]);
    expect(css).toContain('margin: 0.5in 0.4in 0.8in 0.9in;');
    expect(css).toContain('@page :right { margin-left: 0.9in; margin-right: 0.4in; }');
    expect(css).toContain('@page :left { margin-left: 0.4in; margin-right: 0.9in; }');
    expect([geom.mg.inside, geom.mg.outside]).toEqual([0.9, 0.4]);
    expect(Math.abs(geom.contentW - (6 - 0.9 - 0.4) * 96)).toBeLessThan(0.01);
    expect(Math.abs(geom.contentH - (9 - 0.5 - 0.8) * 96)).toBeLessThan(0.01);
    expect(a.printPageEstimate()).toBeGreaterThan(estAuto);
    st.printCustomMargins = { inside: 0.25, outside: 0.5, top: 0.6, bottom: 0.75 };
    expect((a.auditPrintInterior() as { findings: { id: string }[] }).findings.some((f) => f.id === 'margins.minimum')).toBe(true);
    // Reset (1.0's #btnMarginReset listener: printMarginMode = "auto"), its stepped values
    st.printMarginMode = 'auto';
    expect([a.printMargins('6x9', 100).inside, a.printMargins('6x9', 800).inside]).toEqual([0.625, 1.125]);
  });

  it('print.runningheads (the @page margin boxes; the view\'s head on a second page of a chapter: the e2e)', () => {
    const st = empty();
    const ht = c.api.mkSection('front', 'halftitle', 'Half Title', {});
    const ch1 = c.api.mkSection('body', 'chapter', 'The Crossing', { number: '1', content: many(60) });
    st.sections = [ht, ch1];
    Object.assign(st.meta as Rec, { title: 'Head Fixture', author: 'Fixture Author' });
    Object.assign(st, { printTrim: '6x9', printRecto: true, printMarginMode: 'auto', printHeadPlace: 'top', printFolio: 'centre', printOmitChapterHead: false, printOmitBlankHead: true });
    st.printHeadContent = 'author';
    expect(a.buildPrintCss('6x9', true)).toContain('@top-center { content: "Fixture Author";');
    st.printHeadContent = 'title';
    const cssTitle = String(a.buildPrintCss('6x9', true));
    expect(cssTitle).toContain('@top-center { content: "Head Fixture";');
    expect(cssTitle).not.toContain('Fixture Author');
    st.printHeadContent = 'chapter';
    const cssChapter = String(a.buildPrintCss('6x9', true));
    expect(cssChapter).toContain('@top-center { content: string(chapterTitle);');
    expect(cssChapter).toContain('.chapter-opening .chapter-title { string-set: chapterTitle content(text); }');
    st.printHeadContent = 'none';
    const cssNone = String(a.buildPrintCss('6x9', true));
    expect(cssNone.includes('content: "') || cssNone.includes('string(chapterTitle)')).toBe(false);
    expect(cssNone).toContain('@bottom-center { content: counter(page);');
    st.printHeadContent = 'titleauthor';
    st.printHeadPlace = 'bottom';
    const cssBottom = String(a.buildPrintCss('6x9', true));
    expect(cssBottom).toContain('@bottom-center { content: ' + a.cssStr(a.printHeadText()) + ';');
    expect(cssBottom).toContain('@bottom-left { content: counter(page);');
    expect(cssBottom).toContain('@bottom-right { content: counter(page);');
    expect(cssBottom).not.toContain('@bottom-center { content: counter(page);');
    expect(a.printFolioPos()).toBe('outer');
    st.printHeadPlace = 'top';
    st.printFolio = 'none';
    expect(a.buildPrintCss('6x9', true)).not.toContain('counter(page)');
    st.printFolio = 'outer';
    expect(a.buildPrintCss('6x9', true)).toContain('@page :left { margin-left: 0.5in; margin-right: 0.625in; @bottom-left { content: counter(page);');
    st.printFolio = 'centre';
    st.printOmitChapterHead = true;
    const cssOmit = String(a.buildPrintCss('6x9', true));
    expect(cssOmit).toContain('.print-sec { page: chapterstart; }');
    expect(cssOmit).not.toContain('.print-sec.chapter-sec { page: chapterstart; }');
    expect(cssOmit).toContain('@page chapterstart:first { @top-center { content: none; } }');
    expect(cssOmit).toContain('@page :blank { @top-center { content: none; } @bottom-center { content: none; } }');
    // the view: the opening page bare of its head, folio kept; the blank verso bare
    const piv = a.piv as unknown as { model: { pages: { n: number; blank: boolean; section: unknown }[] } | null; spread: number };
    piv.model = a.buildPrintViewModel();
    const first = piv.model!.pages.find((p) => p.section === ch1)!;
    const blank = piv.model!.pages.find((p) => p.blank)!;
    piv.spread = Math.floor(first.n / 2);
    a.renderPrintView();
    const sp = document.getElementById('pivSpread')!;
    const openEl = sp.querySelector('.piv-page[data-page="' + first.n + '"]')!;
    expect(openEl.querySelector('.piv-runhead')).toBeNull();
    expect(openEl.querySelector('.piv-folio')).not.toBeNull();
    const blankEl = sp.querySelector('.piv-page[data-page="' + blank.n + '"]')!;
    expect([blankEl.querySelector('.piv-runhead'), blankEl.querySelector('.piv-folio')]).toEqual([null, null]);
  });

  it('print.displayleaf', () => {
    on({ meta: { title: 'Display Test', author: 'A. Writer' }, images: [], printTrim: '6x9',
      sections: [c.api.mkSection('front', 'titlepage', 'Title Page'), c.api.mkSection('front', 'dedication', 'Dedication', { content: 'For you.' }), c.api.mkSection('front', 'preface', 'Preface', { content: 'A word first.' }), c.api.mkSection('body', 'chapter', 'One', { number: '1', content: 'Words.' })] });
    const html = String(pc.vars.buildPrintHtml());
    const secs = html.match(/<section class="print-sec[^"]*"/g) || [];
    expect(secs.map((x) => / display-sec\b/.test(x))).toEqual([true, true, false, false]);
    expect(/@page displayleaf \{[^}]*@top-center \{ content: none; \}/.test(html)).toBe(true);
    expect(/@page displayleaf \{(?:[^{}]|\{[^{}]*\})*@bottom-(center|left|right) \{ content: none; \}/.test(html)).toBe(true);
    expect(html).toContain('.print-sec.display-sec { page: displayleaf; }');
  });

  it('print.bleed (the print halves; the store rows are 5d\'s, the view\'s plate offsets the e2e\'s)', async () => {
    const sample = await loadSample();
    const st = on(sample.buildSampleBook());
    expect((c.api.buildEmptyBook() as Rec).printBleed).toBe(false);
    expect(st.printBleed).toBe(false);
    const edge = (a.printEdgeSections() as unknown[]).length;
    expect(edge).toBeGreaterThan(0);
    const metaOf = (html: string) => /<meta name="beuk-bleed" content="([^"]*)"\/>\n/.exec(html);
    const offHtml = String(pc.vars.buildPrintHtml());
    expect(metaOf(offHtml)).toBeNull();
    st.printBleed = true;
    const onHtml = String(pc.vars.buildPrintHtml());
    const m = metaOf(onHtml)!;
    expect(JSON.parse(m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))).toEqual({ in: 0.125, rtl: false });
    expect(onHtml.replace(m[0], '')).toBe(offHtml);
    expect(a.kdpEdgeMin()).toBe(0.375);
    // the book file carries it, and a book without it prints at the trim (applyBookDoc's line)
    expect(arriveForExport(c, { printBleed: true } as Rec).printBleed).toBe(true);
    expect(arriveForExport(c, {} as Rec).printBleed).toBe(false);
    for (const lang of Object.keys(meta.pluralForms)) for (const k of ['exp.bleedTitle', 'exp.bleedDesc', 'print.bleedTag', 'print.bleedNote', 'print.bleedSuggest']) expect(k in (en as Rec) || lang !== 'en', k).toBe(true);
  });

  it('print.picturebook (the print and state halves; the 11 × 8.5 plate facing its lines: the e2e)', () => {
    const st = empty();
    st.printPictureBook = true;
    st.printLargePrint = false;
    expect(a.printPictureBookOn()).toBe(true);
    expect(a.printBaseFontPt()).toBe(24);
    const css = String(a.buildPrintCss('11x8.5', false));
    expect(css).toContain('font-size: 24pt');
    expect(css).toContain('line-height: 1.4');
    st.printLargePrint = true; // never together: large print wins in 1.0's printPictureBookOn
    expect(a.printPictureBookOn()).toBe(false);
    expect(arriveForExport(c, { printPictureBook: true, printLargePrint: true } as Rec).printPictureBook).toBe(false);
    expect(a.printFilename()).toMatch(/-large-print\.html$/);
    st.printLargePrint = false;
    expect(a.printFilename()).toMatch(/-picture-book\.html$/);
  });

  it("starters.blanks-flagged (5a left its print half): a [[blank]] is a preflight finding that jumps to its page; one on a page switched off is not; filled, gone", () => {
    const st = empty();
    const secs = st.sections as Rec[];
    const ch = secs.find((s) => s.type === 'chapter')!;
    ch.content = "The ledger lay open on the captain's table, and every name in it was a debt. ".repeat(20);
    const about = secs.find((s) => s.type === 'aboutauthor')!, ack = secs.find((s) => s.type === 'acknowledgments')!;
    about.content = 'Zoey Suzuki lives in [[your town]] and writes at [[your website]].';
    ack.content = 'Thanks to [[your editor]].';
    ack.included = false;
    const hits = () => (a.auditPrintInterior() as { findings: { id: string; name: string; detail: string; jump: { sectionId?: string } | null }[] }).findings.filter((f) => f.id === 'template.blanks');
    const p1 = hits();
    expect(p1.length).toBe(1);
    expect(p1[0]!.jump?.sectionId).toBe(about.id);
    expect(p1[0]!.name).toBe(t('check.blanks.name'));
    expect(p1[0]!.detail).not.toContain('[[your editor]]');
    about.content = String(about.content).replace('[[your town]]', 'Bristol').replace('[[your website]]', 'zoeysuzuki.com');
    expect(hits()).toEqual([]);
  });

  it('starters.empty-left-out (5a left its print half): a page with no words of its own is not in the print document; a written one and the generated pages are', () => {
    const st = empty();
    const secs = st.sections as Rec[];
    secs.find((s) => s.type === 'chapter')!.content = 'Words of the chapter.';
    secs.find((s) => s.type === 'dedication')!.content = 'For you.';
    const html = String(pc.vars.buildPrintHtml());
    const ids = [...html.matchAll(/<section class="print-sec[^"]*" id="ps-(\d+)"/g)].length;
    const want = secs.filter((s) => a.inBook(s) && s.type !== 'cover');
    expect(ids).toBe(want.length);
    for (const ty of ['epigraph', 'aboutauthor', 'alsoby']) expect(want.some((s) => s.type === ty), ty).toBe(false);
    for (const ty of ['dedication', 'titlepage', 'copyright', 'chapter']) expect(want.some((s) => s.type === ty), ty).toBe(true);
    expect(html).toContain('For you.');
  });

  it('print.press.solid-tints, print.press.blend-math', async () => {
    const sample = await loadSample();
    on(sample.buildSampleBook());
    const book = String(a.buildBookCss(''));
    const html = String(pc.vars.buildPrintHtml());
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const body = html.slice(html.indexOf('<body>'));
    const want: { sel: string; a: number }[] = [];
    book.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel: string, decl: string) => {
      const m = /(?:^|;)\s*opacity:\s*([0-9.]+)\s*(?:;|$)/.exec(decl);
      if (m && parseFloat(m[1]!) < 1 && !/\.bd-/.test(sel) && sel.trim().charAt(0) !== '@') want.push({ sel: sel.trim(), a: parseFloat(m[1]!) });
      return all;
    });
    const tint = (x: number) => '#' + [0, 0, 0].map(() => Math.round(255 * (1 - x)).toString(16).padStart(2, '0')).join('');
    const missing = want.filter((w) => css.lastIndexOf(w.sel + ' { opacity: 1; color: ' + tint(w.a) + '; }') <= css.indexOf(w.sel + ' {'));
    expect(want.length).toBeGreaterThanOrEqual(10);
    expect(missing.map((x) => x.sel)).toEqual([]);
    expect(css).toContain('html, body { margin: 0; padding: 0; background: #ffffff; color: #000000; }');
    expect(css).not.toContain('#191713');
    expect((body.match(/<svg class="ornament"/g) || []).length).toBeGreaterThan(0);
    expect((body.match(/<svg\b[\s\S]*?<\/svg>/g) || []).filter((s) => /\sopacity="0?\.\d+"/.test(s)).length).toBe(0);
    expect(/\.chapter-number \{[^}]*opacity: 0\.75;/.test(book)).toBe(true);
    expect(book).not.toContain('opacity: 1; color: #');
    expect([a.printBlendHex('#000000', '#ffffff', 0.75), a.printBlendHex('#000', '#fff', 0.85), a.printBlendHex('#8a2b1c', '#ffffff', 0.5)]).toEqual(['#404040', '#262626', '#c5958e']);
    const svg = String(a.printSolidSvgHtml('<svg><g fill="currentColor"><path d="M0 0" opacity=".8"/><rect x="1" opacity="0.5" fill="#8a2b1c"/><path d="M1 1"/></g></svg>'));
    expect(svg).toContain('<path d="M0 0" fill="#333333"/>');
    expect(svg).toContain('<rect x="1" fill="#c5958e"/>');
    expect(svg).not.toContain('opacity');
  });
});
