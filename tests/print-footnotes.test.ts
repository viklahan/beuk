import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream, rgb } from 'pdf-lib';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as fn from '../deploy/renderer/footnotes.mjs';
// @ts-expect-error — a plain ES module of the renderer, no type declarations
import * as spreads from '../deploy/renderer/spreads.mjs';
import { parseFootnoteHeader } from '../src/jobs/tools.js';

/* deploy/renderer/footnotes.mjs — page-bottom notes for the print PDF.
   Chromium sets no footnotes; the renderer measures where each reference
   lands (named destinations), cuts the page's text short to make room,
   and draws the note at the page foot from the notes' own PDF. These
   tests build their PDFs with pdf-lib — and a small paginator stands in
   for Chromium — so no browser is needed. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const CFG = { trimW: 300, trimH: 280, top: 40, bottom: 40, inside: 30, outside: 20, pitch: 10, noteLine: 10, rtl: false, justify: true, cap: 0.5, orphans: 2, widows: 2 };
const meta = (c: object) => '<meta name="beuk-footnotes" content="' + JSON.stringify(c).replace(/"/g, '&quot;') + '"/>';

const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => tag + i).join(' ');
const SECTION = (paras: string[], notes: Array<[string, string]>) =>
  '<section class="print-sec chapter-sec" id="ps-1">\n<div class="ch-wrap"><header class="chapter-opening"><h1 class="chapter-title">One</h1></header>\n' +
  paras.join('\n') + '\n' +
  '<div class="endnotes fn-page" epub:type="endnotes"><p class="endnotes-h">Notes</p>' +
  notes.map(([n, text]) => '<p class="endnote" id="s1-fn' + n + '" epub:type="endnote"><a class="note-back" href="#s1-fnref' + n + '" title="Back to the reference"><sup>' + n + '</sup></a> ' + text + '</p>').join('') +
  '</div></div>\n</section>';
const ref = (n: string) => '<a class="noteref" epub:type="noteref" id="s1-fnref' + n + '" href="#s1-fn' + n + '"><sup class="endnote-ref">' + n + '</sup></a>';
const DOC = (sec: string, c: object = CFG) => '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8"/>\n' + meta(c) + '<title>T</title>\n<style>p{}</style>\n</head>\n<body>\n' +
  '<section class="print-sec" id="ps-0">\n<p>Title</p>\n</section>\n' + sec + '\n</body>\n</html>';

test('print footnotes: the studio\'s page geometry is read from its meta, or the book asks for none', () => {
  const cfg = fn.footnoteConfig(DOC(''));
  assert.equal(cfg.colW, 250);
  assert.equal(cfg.contentH, 200);
  assert.equal(cfg.sep, 10);
  assert.equal(cfg.cap, 0.5);
  assert.equal(fn.footnoteConfig('<html><head></head><body></body></html>'), null);
  assert.equal(fn.footnoteConfig(DOC('', { ...CFG, pitch: 'x' })), null, 'a malformed geometry places nothing');
});

test('print footnotes: notes, units, words and references are read from a section', () => {
  const sec = SECTION(['<p class="first">Alpha beta' + ref('1') + '. Gamma <em>delta</em> exam<em>ple</em> end.</p>', '<h2 class="inhead">Interlude</h2>', '<figure class="book-img"><img src="data:image/png;base64,AA" alt=""/><figcaption>Cap</figcaption></figure>'],
    [['1', 'A <em>note</em>.']]);
  const html = DOC(sec);
  const slice = fn.sectionSlices(html).find((s: Any) => s.id === 'ps-1');
  const notes = fn.sectionNotes(slice.html);
  assert.deepEqual(notes.map((n: Any) => [n.id, n.ref, n.num]), [['s1-fn1', 's1-fnref1', '1']]);
  assert.ok(notes[0].body.startsWith('<span class="fn-num"><sup>1</sup></span>'));
  const model = fn.sectionModel(slice.html);
  const kinds = model.units.map((u: Any) => [u.tag, u.atomic, u.splittable, u.keepNext]);
  assert.deepEqual(kinds, [['header', true, false, true], ['p', false, true, false], ['h2', false, false, true], ['figure', true, false, false]]);
  const p = model.units[1];
  const ws = p.words.map((w: Any) => slice.html.slice(w.start, w.end));
  // the reference's figure is never a word; "exam<em>ple</em>" is one word, its start piece listed
  assert.deepEqual(ws, ['Alpha', 'beta', 'Gamma', 'delta', 'exam', 'end.']);
  assert.equal(model.refs.get('s1-fnref1'), 1);
  // a cut before "Gamma" falls at the space after "beta¹." — the reference stays with its word
  const g = p.words[2];
  assert.equal(slice.html.slice(g.cutAt - 1, g.cutAt + 1), '. ');
});

test('print footnotes: a split ends the head on its last word and reopens the tail, inline elements and all', () => {
  const JPEG = 'data:image/jpeg;base64,AA';
  const sec = '<section class="print-sec chapter-sec spread-sec" id="ps-1" data-start="verso">\n<figure class="plate-page"><img src="' + JPEG + '" alt=""/></figure>' +
    '<div class="ch-wrap"><p class="first">One two <em>three four five</em> six.</p></div>\n</section>';
  const html = DOC(sec);
  const slice = fn.sectionSlices(html).find((s: Any) => s.id === 'ps-1');
  const model = fn.sectionModel(slice.html);
  const p = model.units.findIndex((u: Any) => u.tag === 'p');
  const out = fn.buildSection(model, [{ id: 0, type: 'split', unit: p, word: 3, page: 0 }]);
  // the head: up to "three" (its foot marked by wrapping it), every open element closed
  assert.ok(out.includes('<p class="first fn-split" id="fnu-' + p + '">One two <em><span id="fncz-0">three</span></em></p>'), out);
  // the tail: forced to a new page, unindented, the <em> reopened, the space before "four" with it
  assert.ok(out.includes('</p><p class="fn-cont fn-brk" id="fncu-0"><em> four five</em> six.<span id="fnue-' + p + '">​</span></p>'), out);
  // attributes are added at a tag's end, so spreads.mjs still finds the plate it draws
  assert.ok(out.includes('<figure class="plate-page" id="fnu-0"><img'));
  const plan = spreads.planSections(out);
  assert.equal(plan[0].plate, JPEG);
  const before = fn.buildSection(model, [{ id: 1, type: 'before', unit: p, page: 0 }]);
  assert.ok(before.includes('<p class="first fn-brk" id="fnu-' + p + '">'));
  const wrapped = fn.buildSection(model, [], new Set([p]));
  assert.ok(wrapped.includes('<span id="fnw-' + p + '-0">One</span><span id="fnx-' + p + '-0"></span>'));
  assert.ok(wrapped.includes('<em><span id="fnw-' + p + '-2">three</span><span id="fnx-' + p + '-2"></span>'));
  assert.equal(fn.passIds(model, [], new Set([p])).filter((i: string) => i.startsWith('fnw-')).length, 6);
});

test('print footnotes: notes fill a page to its cap, a long one runs on between lines, and one that cannot start is flagged', () => {
  const cfg = fn.footnoteConfig(DOC(''));
  // cap: (0.5 × 200 − 10) / 10 = 9 note lines a page
  const heights = [{ h: 20 }, { h: 30 }, { h: 120 }, { h: 20 }];
  const own = new Map([[0, [0, 1]], [1, [2]], [2, [3]]]);
  const pages = fn.assignNotes(own, heights, cfg, 4);
  assert.deepEqual(pages[0].frags.map((f: Any) => [f.note, f.from, f.to]), [[0, 0, 2], [1, 0, 3]]);
  assert.equal(pages[0].area, 60);
  assert.deepEqual(pages[1].frags.map((f: Any) => [f.note, f.from, f.to]), [[2, 0, 9]]);
  assert.equal(pages[1].continued, false);
  // page 2: the long note's last 3 lines first, under a full rule, then its own note
  assert.deepEqual(pages[2].frags.map((f: Any) => [f.note, f.from, f.to]), [[2, 9, 12], [3, 0, 2]]);
  assert.equal(pages[2].continued, true);
  assert.equal(pages[2].displaced, false);
  const crowded = fn.assignNotes(new Map([[0, [2, 0]]]), heights, cfg, 2);
  assert.equal(crowded[0].displaced, true, 'a note with no room to begin on its page is displaced');
});

/* ---- a stand-in for Chromium: a toy paginator writing real named destinations ---- */

const PER_LINE = 6; // words a line
const H0 = 2; // a word span's top below its line's top
async function toyPdf(pageCount: number, pageH: number, dests: Map<string, { page: number; depth: number }>) {
  const doc = await PDFDocument.create();
  const pages = Array.from({ length: Math.max(1, pageCount) }, () => doc.addPage([300, pageH]));
  const dict = doc.context.obj({});
  for (const [name, d] of dests) {
    const arr = doc.context.obj([pages[d.page].ref, PDFName.of('XYZ'), PDFNumber.of(0), PDFNumber.of(pageH - d.depth), PDFNumber.of(0)]);
    (dict as PDFDict).set(PDFName.of(name), arr);
  }
  doc.catalog.set(PDFName.of('Dests'), dict);
  return Buffer.from(await doc.save());
}

/** Lay a measuring document out like a browser would, crudely: lines of
 *  six words, ten points apart, forced breaks honoured; every id the
 *  document links to gets a destination. */
async function toyRender(html: string) {
  const linked = new Set([...html.matchAll(/<a href="#([^"]+)">\.<\/a>/g)].map((m) => m[1]));
  if (html.includes('beuk-fn-doc')) {
    const d = new Map();
    let i = 0;
    for (const m of html.matchAll(/<div class="fn-note" id="fnn-(\d+)">([\s\S]*?)<\/div>/g)) {
      const lines = /LONG/.test(m[2]) ? 14 : 2;
      d.set('fnn-' + m[1], { page: i, depth: 0 });
      d.set('fnne-' + m[1], { page: i, depth: lines * 10 });
      i += 1;
    }
    return toyPdf(i, 7200, d);
  }
  const cfg = fn.footnoteConfig(html);
  const sec = fn.sectionSlices(html)[0].html;
  const model = fn.sectionModel(sec);
  const tree = fn.parseHtml(sec);
  const ids: Array<{ id: string; at: number }> = [];
  const walk = (el: Any) => { for (const k of el.kids) if (!k.text) { if (k.id) ids.push({ id: k.id, at: k.start }); walk(k); } };
  walk(tree);
  const dests = new Map();
  let page = 0;
  let y = 0;
  const lineAt: Array<{ at: number; page: number; depth: number }> = [];
  let doneMc = -1;
  for (const u of model.units) {
    if (u.mc >= 0) {
      // a multicol block, two columns: a fragment that runs on fills the
      // page's foot, column after column; the last fragment is balanced
      if (u.mc === doneMc) continue;
      doneMc = u.mc;
      if (/\bfn-brk\b/.test(u.mcPath[0].cls) && y > 0) { page += 1; y = 0; }
      const ls: number[] = [];
      for (const v of model.units.filter((w: Any) => w.mc === u.mc)) {
        const n = Math.max(1, Math.ceil(v.words.length / PER_LINE));
        for (let l = 0; l < n; l++) ls.push(l === 0 ? v.el.start : v.words[l * PER_LINE].cutAt);
      }
      let i = 0;
      while (i < ls.length) {
        const rows = Math.floor((cfg.contentH - y) / 10);
        const left = ls.length - i;
        if (left > 2 * rows) {
          for (let c = 0; c < 2; c++) for (let r = 0; r < rows; r++) lineAt.push({ at: ls[i++], page, depth: y + r * 10 });
          page += 1;
          y = 0;
        } else {
          const rr = Math.ceil(left / 2);
          for (let r = 0; r < left; r++) lineAt.push({ at: ls[i++], page, depth: y + (r % rr) * 10 });
          y += rr * 10;
        }
      }
      continue;
    }
    const brk = /\bfn-brk\b/.test(u.el.cls);
    if (brk && y > 0) { page += 1; y = 0; }
    if (u.atomic) {
      if (y + 30 > cfg.contentH) { page += 1; y = 0; }
      lineAt.push({ at: u.el.start, page, depth: y });
      dests.set('__top' + u.el.start, { page, depth: y });
      dests.set('__foot' + u.el.start, { page, depth: y + 30 });
      y += 30;
      continue;
    }
    const n = Math.max(1, Math.ceil(u.words.length / PER_LINE));
    for (let l = 0; l < n; l++) {
      if (y + 10 > cfg.contentH) { page += 1; y = 0; }
      const first = u.words[l * PER_LINE];
      lineAt.push({ at: l === 0 ? u.el.start : first.cutAt, page, depth: y });
      y += 10;
    }
  }
  const lineOf = (at: number) => { let best = lineAt[0]; for (const l of lineAt) if (l.at <= at) best = l; return best; };
  for (const { id, at } of ids) {
    if (!linked.has(id)) continue;
    const unit = model.units.find((u: Any) => u.el.start === at);
    if (unit && unit.atomic) { dests.set(id, dests.get('__top' + at)); continue; }
    const owner = model.units.find((u: Any) => u.el.start <= at && at < u.el.closeStart);
    if (owner && owner.atomic && /^fnue-/.test(id)) { dests.set(id, dests.get('__foot' + owner.el.start)); continue; }
    const l = lineOf(at);
    dests.set(id, { page: l.page, depth: l.depth + (unit ? 0 : H0) });
  }
  for (const k of [...dests.keys()]) if (k.startsWith('__')) dests.delete(k);
  // the empty pages forced at the section's end, each a page of its own
  const tails = (sec.match(/class="fn-tail/g) || []).length;
  return toyPdf(page + 1 + tails, cfg.trimH, dests);
}

test('print footnotes: the settling loop cuts the page where a note needs room, and the result holds', async () => {
  // contentH 200 = 20 lines a page. The opening (30pt) then paragraphs of 6 lines; a reference late on page 0.
  const paras = [
    '<p class="first">' + words(36, 'a') + '</p>',
    '<p>' + words(30, 'b') + ' ref' + ref('1') + ' ' + words(29, 'c') + '</p>',
    '<p>' + words(36, 'd') + '</p>',
    '<p>' + words(24, 'e') + ' long' + ref('2') + ' ' + words(11, 'f') + '</p>',
    '<p>' + words(60, 'g') + '</p>',
  ];
  const html = DOC(SECTION(paras, [['1', 'A short note.'], ['2', 'LONG note that runs on.']]));
  let passes = 0;
  const res = await fn.settleFootnotes({ html, render: (h: string) => { passes += 1; return toyRender(h); }, deadline: Date.now() + 30000 });
  assert.ok(res && res.results.length === 1, 'the section settles');
  assert.equal(res.placed, 2);
  const r = res.results[0];
  assert.ok(r.cuts.length >= 1, 'the text was cut short somewhere');
  assert.ok(passes < 20, 'it settles in a handful of passes: ' + passes);
  // Lay the settled section out once more and check every page: the
  // text stops above its notes, and each note begins on its reference's page.
  const final = await fn.readDests(await toyRender(fn.sectionDoc(html, fn.buildSection(r.model, r.cuts), r.css, fn.passIds(r.model, r.cuts, new Set(), r.refIds))));
  const cfg = res.cfg;
  const foot = new Map<number, number>();
  for (const [k, d] of final.dests as Map<string, Any>) if (/^fnu(e|-)|^fncz-/.test(k)) foot.set(d.page, Math.max(foot.get(d.page) || 0, d.depth + (k.startsWith('fnu-') ? 0 : cfg.pitch - H0)));
  r.placement.forEach((pl: Any, p: number) => {
    if (!pl.frags.length) return;
    assert.ok((foot.get(p) || 0) <= cfg.contentH - pl.area + 1, 'page ' + p + ': text to ' + foot.get(p) + ', notes from ' + (cfg.contentH - pl.area));
  });
  for (const [i, d] of r.refPage as Map<number, Any>) {
    const pl = r.placement[d.page];
    assert.ok(pl.frags.some((f: Any) => f.note === i && f.from === 0), 'note ' + (i + 1) + ' begins on its reference\'s page ' + d.page);
  }
  // the long note (14 lines, cap 9) runs on to the next page, under a full rule
  const long = r.placement.findIndex((pl: Any) => pl.frags.some((f: Any) => f.note === 1 && f.from > 0));
  assert.ok(long > 0 && r.placement[long].continued, 'the long note continues on a later page');
  // the document now carries the cuts and hides the moved notes from the end list
  assert.ok(res.html.includes('fn-brk'));
  assert.ok(res.html.includes('[id="s1-fn1"], [id="s1-fn2"] { display: none !important; }'));
  assert.ok(res.html.includes('#ps-1 .endnotes.fn-page { display: none !important; }'));
});

test('print footnotes: a cut inside "::: columns" ends the columns there and reopens them on the next page, a list at its next number', () => {
  const sec = '<section class="print-sec chapter-sec" id="ps-1">\n<div class="columns"><ol class="book-list" start="3"><li>a b</li><li>c d</li></ol><p class="hg">e f</p></div>\n</section>';
  const model = fn.sectionModel(sec);
  assert.deepEqual(model.units.map((u: Any) => [u.tag, u.mc]), [['li', 0], ['li', 0], ['p', 0]]);
  const li2 = fn.buildSection(model, [{ id: 0, type: 'before', unit: 1, page: 0 }]);
  assert.ok(li2.includes('</ol></div><div class="columns fn-brk fn-mc"><ol class="book-list" start="4"><li id="fnu-1">c d'), li2);
  const first = fn.buildSection(model, [{ id: 0, type: 'before', unit: 0, page: 0 }]);
  assert.ok(first.startsWith('<section class="print-sec chapter-sec" id="ps-1">\n<div class="columns fn-brk"><ol'), 'the whole block moves: ' + first);
  const split = fn.buildSection(model, [{ id: 0, type: 'split', unit: 2, word: 1, page: 0 }]);
  assert.ok(split.includes('<span id="fncz-0">e</span></p></div><div class="columns fn-brk fn-mc"><p class="hg fn-cont" id="fncu-0"> f'), split);
});

test('print footnotes: references before and inside a "::: columns" block that runs over pages settle at the foot of their pages', async () => {
  // contentH 200 = 20 lines; the opening (30pt), a paragraph with a
  // reference, then 20 two-line entries in two columns with references
  // in the third and the twelfth: the columns run on from page 0.
  const entries = Array.from({ length: 20 }, (_, i) => '<p class="hg">' + words(11, 'e' + i + 'x') + ' end' + (i === 2 ? ref('1') : i === 11 ? ref('2') : '') + '</p>');
  const paras = ['<p class="first">' + words(11, 'a') + ' gone' + ref('3') + '</p>', '<div class="columns">' + entries.join('') + '</div>', '<p>' + words(12, 'z') + '</p>'];
  const html = DOC(SECTION(paras, [['1', 'Note one.'], ['2', 'Note two.'], ['3', 'Note three.']]));
  let passes = 0;
  const res = await fn.settleFootnotes({ html, render: (h: string) => { passes += 1; return toyRender(h); }, deadline: Date.now() + 30000 });
  assert.ok(res && res.results.length === 1, 'the section settles: ' + JSON.stringify(res && res.fallbacks));
  assert.equal(res.placed, 3);
  assert.ok(passes < 20, 'in a handful of passes: ' + passes);
  const r = res.results[0];
  assert.ok(res.html.includes('fn-mc'), 'the columns were ended at a cut and reopened');
  const final = await fn.readDests(await toyRender(fn.sectionDoc(html, fn.buildSection(r.model, r.cuts), r.css, fn.passIds(r.model, r.cuts, new Set(), r.refIds))));
  const cfg = res.cfg;
  const foot = new Map<number, number>();
  for (const [k, d] of final.dests as Map<string, Any>) if (/^fnu(e|-)|^fncz-/.test(k)) foot.set(d.page, Math.max(foot.get(d.page) || 0, d.depth + (k.startsWith('fnu-') ? 0 : cfg.pitch - H0)));
  r.placement.forEach((pl: Any, p: number) => {
    if (!pl.frags.length) return;
    assert.ok((foot.get(p) || 0) <= cfg.contentH - pl.area + 1, 'page ' + p + ': text to ' + foot.get(p) + ', notes from ' + (cfg.contentH - pl.area));
  });
  for (const [i, d] of r.refPage as Map<number, Any>) {
    assert.ok(r.placement[d.page].frags.some((f: Any) => f.note === i && f.from === 0), 'note ' + (i + 1) + ' begins on its reference\'s page ' + d.page);
  }
  // notes 3 and 1 on the first page; note 2 later
  assert.equal(r.refPage.get(2).page, 0);
  assert.equal(r.refPage.get(0).page, 0);
});

test('print footnotes: a section that cannot settle in time keeps its notes at its end', async () => {
  const html = DOC(SECTION(['<p>' + words(30, 'b') + ' ref' + ref('1') + '</p>'], [['1', 'Note.']]));
  const res = await fn.settleFootnotes({ html, render: toyRender, deadline: Date.now() - 1 });
  assert.equal(res.results.length, 0);
  assert.equal(res.kept, 1);
  assert.equal(res.html, html, 'the document prints exactly as the studio wrote it');
});

test('print footnotes: a note running on past the section\'s last page gets a page added at the section end, not a fallback', async () => {
  // the reference on the section's last line; the note is 14 lines, the cap 9
  const html = DOC(SECTION(['<p class="first">' + words(30, 'a') + ' last' + ref('1') + '</p>'], [['1', 'LONG note that runs on.']]));
  const res = await fn.settleFootnotes({ html, render: toyRender, deadline: Date.now() + 30000 });
  assert.equal(res.results.length, 1, 'the section settles');
  assert.equal(res.placed, 1);
  assert.equal(res.kept, 0);
  assert.deepEqual(res.fallbacks, []);
  const r = res.results[0];
  assert.equal(r.tail, 1, 'one empty page forced at the section end');
  assert.equal(r.placement.length, 2);
  assert.deepEqual(r.placement[0].frags.map((f: Any) => [f.note, f.from, f.to]), [[0, 0, 9]]);
  assert.deepEqual(r.placement[1].frags.map((f: Any) => [f.note, f.from, f.to]), [[0, 9, 14]]);
  assert.equal(r.placement[1].continued, true);
  // the document prints the page: an empty forced-break block before the section closes
  assert.ok(res.html.includes('</div></div>\n<div class="fn-tail fn-brk" id="fnt-0" aria-hidden="true"></div></section>'), res.html.slice(-300));
  assert.ok(res.html.includes('.fn-tail {'));
});

test('print footnotes: why a section kept its notes is reported, and the header round-trips to the job result', async () => {
  const html = DOC(SECTION(['<p>' + words(30, 'b') + ' ref' + ref('1') + '</p>'], [['1', 'Note.']]));
  const late = await fn.settleFootnotes({ html, render: toyRender, deadline: Date.now() - 1 });
  assert.deepEqual(late.fallbacks, [{ id: 'ps-1', reason: 'time', notes: 1 }]);
  const header = fn.footnoteHeader({ placed: 3, kept: 3, passes: 7, fallbacks: [{ id: 'ps-4', reason: 'long', notes: 2 }, { id: 'ps-9', reason: 'note', notes: 1 }, { id: 'ps-2', reason: 'book', notes: 0 }] });
  assert.equal(header, 'placed=3; kept=3; passes=7; fallback=ps-4:long:2,ps-9:note:1');
  assert.equal(fn.footnoteHeader({ placed: 2, kept: 0, passes: 4 }), 'placed=2; kept=0; passes=4');
  assert.deepEqual(parseFootnoteHeader(header), { placed: 3, kept: 3, passes: 7, fallbacks: [{ section: 'ps-4', reason: 'long', notes: 2 }, { section: 'ps-9', reason: 'note', notes: 1 }] });
  assert.deepEqual(parseFootnoteHeader('placed=2; kept=0; passes=4'), { placed: 2, kept: 0, passes: 4, fallbacks: [] });
  assert.equal(parseFootnoteHeader(null), null);
  assert.equal(parseFootnoteHeader('nonsense'), null);
});

test('print footnotes: the finished pages are found from the shipped PDF, and a moved reference is refused', () => {
  const r = { sec: { id: 'ps-1' }, hide: ['s1-fn1', 's1-fn2'], notes: [{ id: 's1-fn1', ref: 'r1' }, { id: 's1-fn2', ref: 'r2' }], refPage: new Map([[0, { page: 1, depth: 50 }], [1, { page: 2, depth: 80 }]]), placement: [], heights: [] };
  const ok = new Map([['r1', { page: 9, depth: 50 }], ['r2', { page: 10, depth: 80 }]]);
  assert.deepEqual(fn.placementsIn([r], ok).map((s: Any) => s.start), [8]);
  assert.equal(fn.placementsIn([r], new Map([['r1', { page: 9, depth: 50 }], ['r2', { page: 11, depth: 80 }]])), null);
  assert.equal(fn.placementsIn([r], new Map([['r1', { page: 9, depth: 62 }], ['r2', { page: 10, depth: 80 }]])), null);
  assert.deepEqual(fn.misplaced([r], new Map([['ps-1', 8], ['r1', 9], ['r2', 10]])), []);
  assert.equal(fn.misplaced([r], new Map([['ps-1', 8], ['r1', 9], ['r2', 11]])).length, 1);
  assert.equal(fn.isRightPage(0, false), true);
  assert.equal(fn.isRightPage(1, false), false);
  assert.equal(fn.isRightPage(0, true), false);
});

function pageOps(doc: PDFDocument, i: number) {
  const contents = doc.getPages()[i].node.Contents();
  if (!contents) return '';
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
}

test('print footnotes: each page\'s notes are drawn at its foot from the notes PDF, under a rule; measuring names are stripped', async () => {
  const cfg = fn.footnoteConfig(DOC(''));
  const book = await PDFDocument.create();
  for (let i = 0; i < 3; i++) book.addPage([300, 280]);
  // a measuring name and its hidden link, to be stripped from the shipped file
  const dests = book.context.obj({});
  (dests as PDFDict).set(PDFName.of('s1-fnref1'), book.context.obj([book.getPages()[1].ref, PDFName.of('XYZ'), PDFNumber.of(0), PDFNumber.of(100), PDFNumber.of(0)]));
  (dests as PDFDict).set(PDFName.of('ps-1'), book.context.obj([book.getPages()[0].ref, PDFName.of('XYZ'), PDFNumber.of(0), PDFNumber.of(280), PDFNumber.of(0)]));
  book.catalog.set(PDFName.of('Dests'), dests);
  const link = book.context.register(book.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 1, 1], Dest: PDFString.of('s1-fnref1') }));
  // the reference's link to its note, which no longer prints in the end list
  // (Chromium writes the link, and no destination), and a link to nothing
  const toNote = book.context.register(book.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [5, 5, 9, 9], Dest: PDFName.of('s1-fn1') }));
  const toNothing = book.context.register(book.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [5, 5, 9, 9], A: { S: 'GoTo', D: PDFString.of('s1-fn9') } }));
  book.getPages()[0].node.set(PDFName.of('Annots'), book.context.obj([link]));
  book.getPages()[1].node.set(PDFName.of('Annots'), book.context.obj([toNote, toNothing]));
  assert.equal((await fn.deadLinks(Buffer.from(await book.save()))).length, 2, 'the unstamped file has two dead links');
  const notes = await PDFDocument.create();
  const np = notes.addPage([250, 7200]);
  np.drawRectangle({ x: 0, y: 7200 - 20, width: 250, height: 20, color: rgb(0, 0, 0) });
  const placement = [{ frags: [] }, { frags: [{ note: 0, from: 0, to: 2, h: 20, whole: true }], area: 30, continued: false }, { frags: [] }];
  const { pdf, drawn } = await fn.stampFootnotes(Buffer.from(await book.save()), Buffer.from(await notes.save()), [{ start: 0, placement, notes: [{ page: 0, top: 0, h: 20 }], ids: ['s1-fn1'] }], cfg, ['s1-fnref1']);
  assert.equal(drawn, 1);
  const out = await PDFDocument.load(pdf);
  const ops = pageOps(out, 1);
  assert.match(ops, /\/[\w-]+ Do/, 'the note is drawn as a form XObject');
  // page 1 is a left page: the outside margin (20) is its left edge; notes top = 40 + 30 − 10 = 60
  assert.match(ops, /1 0 0 1 20 40 cm/, 'drawn at the foot of the text column, notes ending on the bottom margin');
  assert.match(ops, /20 64\.5 m\s+95 64\.5 l/, 'a short rule (30% of the column) above the notes');
  assert.doesNotMatch(pageOps(out, 0), /Do/);
  assert.doesNotMatch(pageOps(out, 2), /Do/);
  const kept = out.catalog.lookup(PDFName.of('Dests'), PDFDict);
  assert.deepEqual([...kept.keys()].map((k) => k.decodeText()).sort(), ['ps-1', 's1-fn1']);
  assert.equal(out.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray).size(), 0);
  // the note is named where it is drawn: page 1, at the notes' top (y 60)
  const at = kept.lookup(PDFName.of('s1-fn1'), PDFArray);
  assert.equal(at.get(0).toString(), out.getPages()[1].ref.toString());
  assert.equal(String(at.get(3)), '60');
  // the reference's link now lands on it; the link to nothing is gone
  assert.equal(out.getPages()[1].node.lookup(PDFName.of('Annots'), PDFArray).size(), 1);
  assert.deepEqual(await fn.deadLinks(pdf), [], 'no link in the stamped file names a missing destination');
});

test('print footnotes: the notes document sets each note alone at the column width, page boxes silenced', () => {
  const cfg = fn.footnoteConfig(DOC(''));
  const d = fn.notesDoc(DOC(''), cfg, [{ body: '<span class="fn-num"><sup>1</sup></span> One.' }, { body: 'Two.' }]);
  assert.ok(d.includes('<body class="beuk-fn-doc">'));
  assert.ok(d.includes('size: 250pt 100in; margin: 0;'));
  assert.ok(d.includes('@top-center { content: none; }'));
  assert.ok(d.includes('<div class="fn-wrap"><div class="fn-note" id="fnn-1">Two.</div><div id="fnne-1" style="height:0"></div></div>'));
  assert.ok(d.includes('<a href="#fnne-1">.</a>'));
  assert.ok(d.includes('html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }'), 'transparent, so the page beneath shows through');
});
