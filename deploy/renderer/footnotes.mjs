// Page-bottom footnotes for the print PDF — set where Chromium cannot.
//
// The studio writes a book's notes ([^n]) into each section's endnotes
// block; when the writer asks for notes "at the foot of the page" that
// block carries the class fn-page and the document carries a
// <meta name="beuk-footnotes"> with the page geometry. Printed as is,
// the document still reads correctly — the notes stand at the end of
// their section — so a print that never reaches this renderer loses
// nothing. This module moves each note to the foot of the page its
// reference lands on.
//
// Measured on Chromium 156 (the engine page.pdf runs here):
//   - no CSS GCPM footnotes (float: footnote) and no @page :nth(), so
//     no page can be given a deeper bottom margin by itself;
//   - a named destination is written for every link target, and its
//     y is the page height less the target's depth below the top of
//     the page area (whatever the top margin) — a position, not just
//     a page;
//   - an EMPTY inline marker loses its destination when it falls at a
//     line end; a span wrapping a word never does. Each destination
//     costs about a millisecond, so words are only wrapped on the one
//     page being decided, never across the book.
//
// So the layout is decided one page at a time, by measuring:
//   1. the notes are typeset by Chromium alone, one to a tall page, at
//      the text column's width: each note's height, in its own type;
//   2. a coarse pass over one section marks every block's top and
//      foot; the first page whose notes (with any carried over) do
//      not fit below its text is the page to decide;
//   3. a fine pass wraps the words of that page's blocks: every line
//      and every reference on it, exactly. The page keeps as many
//      lines as fit above the notes those lines call for — no orphan
//      or widow under three lines, a heading never left at the foot —
//      and the rest is forced onto the next page: a paragraph is split
//      in two at the first word of the first line that moves (the head
//      justified to its end, the tail unindented), or a whole block
//      moves. A word hyphenated across the cut moves whole.
//   4. repeat from 2 until every page fits; then the final pass, and
//      each page's notes are drawn into the room left at its foot from
//      the notes' own PDF (pdf-lib, a clipped form XObject), under a
//      short rule — a full-width rule when the page continues a note.
// A note too long for the page's note area (half the page area) runs
// on at the foot of the next page, split between lines — onto a page
// added at the section's end when it runs past the last. A section that
// cannot be settled (FALLBACK says why) keeps its notes at its end, as
// printed by the studio — never a note lost, never one drawn over text.
// Every step is plain data in, data out, so the tests run without a browser.

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFNull, rgb } from 'pdf-lib';

const SECTION_OPEN_RE = /<section class="print-sec[^"]*" id="(ps-\d+)"[^>]*>/g;
const CONFIG_RE = /<meta name="beuk-footnotes" content="([^"]*)"\s*\/?>/;
const FN_BLOCK_RE = /<div class="endnotes fn-page"/;
const NOTE_RE = /<p class="endnote" id="([^"]+)"[^>]*><a class="note-back" href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/p>/g;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = new Set('p div section article aside header footer nav figure figcaption blockquote ul ol li dl dt dd h1 h2 h3 h4 h5 h6 table pre hr main address details summary form fieldset'.split(' '));
const ATOMIC_TAG = new Set(['figure', 'table', 'pre', 'hr', 'header', 'nav', 'details', 'form', 'fieldset']);
const ATOMIC_CLASS = /\b(chapter-opening|scene-break|plate-page|part-divider|tp-top)\b/;
const SKIP_CLASS = /\b(bd-layer|endnotes|print-blank|fn-tail)\b/;
const KEEP_NEXT_CLASS = /\b(inhead|chapter-opening|pre-break|endnotes-h|chapter-number|part-kicker)\b/;
const KEEP_PREV_CLASS = /\b(scene-break)\b/;
const SPLITTABLE = new Set(['p', 'blockquote']);
const NO_WORDS_TAG = new Set(['sup', 'sub', 'svg', 'script', 'style', 'math']);
const NO_WORDS_CLASS = /\b(dropcap|noteref)\b/;

const ZWSP = '​';

function unescapeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
const attrOf = (tagText, name) => {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tagText);
  return m ? m[1] : null;
};

/** The page geometry the studio wrote into the print document, in pt;
 *  null when the book does not ask for page-bottom notes. */
export function footnoteConfig(html) {
  const m = CONFIG_RE.exec(html);
  if (!m) return null;
  let c;
  try {
    c = JSON.parse(unescapeAttr(m[1]));
  } catch {
    return null;
  }
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);
  const cfg = {
    trimW: num(c.trimW), trimH: num(c.trimH), top: num(c.top), bottom: num(c.bottom),
    inside: num(c.inside), outside: num(c.outside), pitch: num(c.pitch), noteLine: num(c.noteLine),
    rtl: !!c.rtl, justify: !!c.justify,
    cap: num(c.cap) && c.cap <= 0.8 ? c.cap : 0.5,
    orphans: Number.isInteger(c.orphans) && c.orphans > 0 ? c.orphans : 3,
    widows: Number.isInteger(c.widows) && c.widows > 0 ? c.widows : 3,
  };
  if ([cfg.trimW, cfg.trimH, cfg.top, cfg.bottom, cfg.inside, cfg.outside, cfg.pitch, cfg.noteLine].some((v) => !v && v !== 0) || !cfg.trimW || !cfg.trimH || !cfg.pitch || !cfg.noteLine) return null;
  cfg.colW = cfg.trimW - cfg.inside - cfg.outside;
  cfg.contentH = cfg.trimH - cfg.top - cfg.bottom;
  // The rule's zone above the notes: one note line, the rule in it.
  cfg.sep = cfg.noteLine;
  return cfg;
}

/** Every print section, with its slice of the document. */
export function sectionSlices(html) {
  const found = [];
  let m;
  SECTION_OPEN_RE.lastIndex = 0;
  while ((m = SECTION_OPEN_RE.exec(html))) found.push({ id: m[1], at: m.index });
  const bodyEnd = html.search(/<\/body>/i);
  return found.map((s, i) => {
    const end = i + 1 < found.length ? found[i + 1].at : bodyEnd >= 0 ? bodyEnd : html.length;
    return { id: s.id, at: s.at, end, html: html.slice(s.at, end) };
  });
}

/** The notes a section asks to set at the foot of the page, in order. */
export function sectionNotes(secHtml) {
  const blockAt = secHtml.search(FN_BLOCK_RE);
  if (blockAt < 0) return [];
  const notes = [];
  let m;
  NOTE_RE.lastIndex = blockAt;
  while ((m = NOTE_RE.exec(secHtml))) {
    notes.push({ id: m[1], ref: m[2], num: m[3].replace(/<[^>]*>/g, '').trim(), body: '<span class="fn-num">' + m[3] + '</span>' + m[4] });
  }
  return notes;
}

/* ---------------- a small HTML tree, with source offsets ---------------- */

const TOKEN_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;

/** Parse the studio's own (well-formed) print markup into elements and
 *  text runs that remember where they sit in the source string. */
export function parseHtml(html) {
  const root = { tag: '#root', kids: [], parent: null, start: 0, openEnd: 0, closeStart: html.length, cls: '', id: null, open: '' };
  let cur = root;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(html))) {
    const start = m.index, end = start + m[0].length;
    if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) {
        let e = cur;
        while (e && e.tag !== tag) e = e.parent;
        if (e && e !== root) {
          for (let c = cur; c !== e.parent; c = c.parent) if (c.closeStart == null) c.closeStart = start;
          e.closeStart = start;
          cur = e.parent;
        }
        continue;
      }
      const el = { tag, kids: [], parent: cur, start, openEnd: end, closeStart: null, open: m[0], cls: attrOf(m[0], 'class') || '', id: attrOf(m[0], 'id') };
      cur.kids.push(el);
      if (VOID.has(tag) || /\/\s*$/.test(m[3])) el.closeStart = end;
      else cur = el;
    } else if (m[0] !== '<' && !m[0].startsWith('<!--')) {
      cur.kids.push({ text: true, start, end, parent: cur });
    }
  }
  for (let c = cur; c && c !== root; c = c.parent) if (c.closeStart == null) c.closeStart = html.length;
  return root;
}

const isEl = (n) => n && !n.text;
const blockKids = (el) => el.kids.filter((k) => isEl(k) && BLOCK.has(k.tag) && !SKIP_CLASS.test(k.cls));

/** The section's flow, as the units a page break can fall between:
 *  text blocks (their words listed) and atomic blocks (figures,
 *  headers, ornaments — never broken). The references to the notes
 *  are located in the unit that holds them. */
export function sectionModel(secHtml) {
  const root = parseHtml(secHtml);
  const section = root.kids.find((k) => isEl(k) && k.tag === 'section') || root;
  const units = [];
  const refs = new Map();
  const visit = (el) => {
    for (const k of el.kids) {
      if (!isEl(k) || !BLOCK.has(k.tag) || SKIP_CLASS.test(k.cls)) continue;
      const atomic = ATOMIC_TAG.has(k.tag) || ATOMIC_CLASS.test(k.cls);
      if (!atomic && blockKids(k).length) { visit(k); continue; }
      const u = {
        i: units.length, el: k, tag: k.tag, atomic,
        hasBlockKids: blockKids(k).length > 0,
        splittable: !atomic && SPLITTABLE.has(k.tag),
        keepNext: /^h[1-6]$/.test(k.tag) || KEEP_NEXT_CLASS.test(k.cls),
        keepPrev: KEEP_PREV_CLASS.test(k.cls),
        words: [],
      };
      units.push(u);
      collectWords(secHtml, u, refs);
    }
  };
  visit(section);
  return { html: secHtml, units, refs, section };
}

/* A word starts where a run of non-space follows a space (or the
   block's start); a run that follows a tag with no space before it —
   "exam<em>ple</em>", a drop cap's letter — continues the word before.
   Text in references, superscripts and drop caps is never a word, but
   still counts for continuity. An atomic unit lists no words; its
   references are still located. */
/* Each word also records where a page cut before it goes: at the start
   of the space before it (with the elements open there), so the head
   ends on its last word, a reference glued to that word ("ledger¹.")
   included, and the space falls to the tail. */
function collectWords(html, u, refs) {
  let prevSpace = true;
  let ws = null;
  const walk = (el, stack, quiet) => {
    for (const k of el.kids) {
      if (isEl(k)) {
        if (k.id && /\bnoteref\b/.test(k.cls)) refs.set(k.id, u.i);
        walk(k, stack.concat([k]), quiet || NO_WORDS_TAG.has(k.tag) || NO_WORDS_CLASS.test(k.cls));
        if (k.tag === 'br') { prevSpace = true; ws = null; }
        continue;
      }
      const text = html.slice(k.start, k.end);
      const re = /\s+|\S+/g;
      let w;
      while ((w = re.exec(text))) {
        const at = k.start + w.index;
        if (/^\s/.test(w[0])) {
          if (!ws) ws = { at, stack };
          prevSpace = true;
          continue;
        }
        if (!quiet && prevSpace) u.words.push({ start: at, end: at + w[0].length, stack, cutAt: ws ? ws.at : at, cutStack: ws ? ws.stack : stack });
        prevSpace = false;
        ws = null;
      }
    }
  };
  walk(u.el, [], u.atomic);
}

/* How far down the page a piece reaches, from its foot marker: a text
   block's marker sits on its last line (one line box further down), an
   atomic block's empty marker at its foot — or, when it has no block
   inside, on its last line too. */
function footOf(u, b, metrics, cfg) {
  if (u.atomic && u.hasBlockKids) return b.depth;
  const m = metrics && metrics.get(u.i);
  return b.depth + (m && !u.atomic ? m.pitch - m.h0 : cfg.pitch);
}

/* ---------------- building the measured and the final section ---------------- */

const unitId = (u) => u.el.id || 'fnu-' + u.i;
/* An opening tag with an id added, classes added or dropped. New
   attributes go at the tag's end, so a tag still begins as the studio
   wrote it (spreads.mjs reads `<figure class="plate-page"` …). */
const withAttrs = (open, { id, addClass, dropClass, dropId }) => {
  let t = open;
  const append = (attr) => { t = t.replace(/\s*(\/?)>$/, ' ' + attr + '$1>'); };
  if (dropId) t = t.replace(/\sid="[^"]*"/, '');
  if ((dropClass && /\sclass="/.test(t)) || (addClass && addClass.length)) {
    const cls = (attrOf(t, 'class') || '').split(/\s+/).filter((c) => c && !(dropClass || []).includes(c));
    for (const c of addClass || []) if (!cls.includes(c)) cls.push(c);
    const value = ' class="' + cls.join(' ') + '"';
    if (/\sclass="[^"]*"/.test(t)) t = t.replace(/\sclass="[^"]*"/, value);
    else append(value.trim());
  }
  if (id && !attrOf(t, 'id')) append('id="' + id + '"');
  return t;
};

/** The pieces of each unit once the cuts are made: a split unit is set
 *  as two or more blocks, each after the first forced to a new page. */
function piecesOf(model, cuts) {
  const out = new Map();
  for (const u of model.units) out.set(u.i, [{ unit: u.i, from: 0, top: unitId(u), end: 'fnue-' + u.i }]);
  const splits = cuts.filter((c) => c.type === 'split').sort((a, b) => a.unit - b.unit || a.word - b.word);
  for (const c of splits) {
    const list = out.get(c.unit);
    const last = list[list.length - 1];
    last.end = 'fncz-' + c.id;
    list.push({ unit: c.unit, from: c.word, top: 'fncu-' + c.id, end: 'fnue-' + c.unit });
  }
  return out;
}

/** The section's markup with the cuts made, every unit's top and foot
 *  marked (kept in the final document too, so what was measured is
 *  what prints), on a fine pass the words of `fine` wrapped, and
 *  `tail` empty pages forced at the section's end: the room a note
 *  referenced on its last page runs on into. */
export function buildSection(model, cuts, fine = new Set(), tail = 0) {
  const html = model.html;
  const points = [];
  const tags = new Map();
  const put = (at, order, text) => points.push({ at, order, text });
  const byUnit = new Map();
  for (const c of cuts) {
    if (!byUnit.has(c.unit)) byUnit.set(c.unit, []);
    byUnit.get(c.unit).push(c);
  }
  for (const u of model.units) {
    const mine = byUnit.get(u.i) || [];
    const splits = mine.filter((c) => c.type === 'split').sort((a, b) => a.word - b.word);
    const add = [];
    if (splits.length) add.push('fn-split');
    if (mine.some((c) => c.type === 'before')) add.push('fn-brk');
    tags.set(u.el.start, { end: u.el.openEnd, text: withAttrs(u.el.open, { id: unitId(u), addClass: add }) });
    if (u.atomic) {
      if (!VOID.has(u.tag)) put(u.el.closeStart, 3, '<span id="fnue-' + u.i + '">' + (u.hasBlockKids ? '' : ZWSP) + '</span>');
    } else {
      put(u.el.closeStart, 3, '<span id="fnue-' + u.i + '">' + ZWSP + '</span>');
    }
    splits.forEach((c, n) => {
      const w = u.words[c.word];
      if (!w) return;
      // The head ends on its last word (and anything glued to it); the
      // space before the moved word goes with the tail, where a line's
      // leading space collapses. The head's foot is marked by wrapping
      // its last word: an empty or zero-width marker at the end of a
      // line justified to its end loses its destination (measured).
      const at = w.cutAt;
      const inner = w.cutStack;
      const close = inner.slice().reverse().map((e) => '</' + e.tag + '>').join('') + '</' + u.tag + '>';
      const cont = withAttrs(u.el.open, { dropId: true, id: 'fncu-' + c.id, dropClass: ['first', 'has-dropcap'], addClass: ['fn-cont', 'fn-brk'].concat(n + 1 < splits.length ? ['fn-split'] : []) });
      const reopen = cont + inner.map((e) => withAttrs(e.open, { dropId: true })).join('');
      const last = u.words[c.word - 1];
      if (last) {
        put(last.start, 6, '<span id="fncz-' + c.id + '">');
        put(last.end, -1, '</span>');
      }
      put(at, 4, (last ? '' : '<span id="fncz-' + c.id + '">' + ZWSP + '</span>') + close + reopen);
    });
    if (fine.has(u.i)) {
      u.words.forEach((w, k) => {
        put(w.start, 5, '<span id="fnw-' + u.i + '-' + k + '">');
        put(w.end, 0, '</span><span id="fnx-' + u.i + '-' + k + '"></span>');
      });
    }
  }
  if (tail > 0 && model.section && model.section.tag === 'section') {
    put(model.section.closeStart, 2, Array.from({ length: tail }, (_, k) => '<div class="fn-tail fn-brk" id="fnt-' + k + '" aria-hidden="true"></div>').join(''));
  }
  points.sort((a, b) => a.at - b.at || a.order - b.order);
  let out = '';
  let pos = 0;
  let p = 0;
  const tagStarts = [...tags.keys()].sort((a, b) => a - b);
  let t = 0;
  while (pos < html.length || p < points.length) {
    const nextTag = t < tagStarts.length ? tagStarts[t] : Infinity;
    const nextPoint = p < points.length ? points[p].at : Infinity;
    const next = Math.min(nextTag, nextPoint, html.length);
    out += html.slice(pos, next);
    pos = next;
    if (nextPoint === pos && p < points.length) {
      out += points[p].text;
      p += 1;
      continue;
    }
    if (nextTag === pos && t < tagStarts.length) {
      const r = tags.get(nextTag);
      out += r.text;
      pos = r.end;
      t += 1;
      continue;
    }
    if (pos >= html.length) break;
  }
  return out;
}

/** The ids a pass needs destinations for. */
export function passIds(model, cuts, fine = new Set(), refIds = []) {
  const ids = [];
  for (const [, list] of piecesOf(model, cuts)) for (const pc of list) ids.push(pc.top, pc.end);
  for (const u of model.units) if (fine.has(u.i)) u.words.forEach((w, k) => ids.push('fnw-' + u.i + '-' + k, 'fnx-' + u.i + '-' + k));
  return ids.concat(refIds);
}

/* ---------------- documents ---------------- */

function docParts(html) {
  const headEnd = html.search(/<\/head>/i);
  const bodyOpen = /<body[^>]*>/i.exec(html);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : '<!DOCTYPE html><html><head>';
  return { head, body: bodyOpen ? bodyOpen[0] : '<body>' };
}

const hiddenLinks = (ids) => '<div style="position:absolute;width:1px;height:1px;overflow:hidden" aria-hidden="true">' + ids.map((i) => '<a href="#' + i + '">.</a>').join('') + '</div>';

/** The structural rules every pass and the final document carry: the
 *  forced breaks, the split paragraph's two halves, and the notes that
 *  now print at the foot of the page hidden from their end-of-section
 *  list (`hide`: note ids; `hideBlocks`: section ids whose every note
 *  moved, so the list's heading goes too). */
export function footnoteCss(cfg, hide = [], hideBlocks = []) {
  const rules = [
    '.fn-brk { break-before: page !important; page-break-before: always !important; }',
    '.fn-split { margin-bottom: 0 !important; padding-bottom: 0 !important; border-bottom: 0 !important;' + (cfg.justify ? ' text-align-last: justify;' : '') + ' }',
    '.fn-cont { text-indent: 0 !important; margin-top: 0 !important; padding-top: 0 !important; border-top: 0 !important; }',
    // a page only the notes run on into: one point of nothing, so it is a page
    '.fn-tail { display: block !important; height: 1pt; margin: 0 !important; padding: 0 !important; border: 0 !important; }',
  ];
  if (hide.length) rules.push(hide.map((id) => '[id="' + id + '"]').join(', ') + ' { display: none !important; }');
  if (hideBlocks.length) rules.push(hideBlocks.map((id) => '#' + id + ' .endnotes.fn-page').join(', ') + ' { display: none !important; }');
  return rules.join('\n');
}

/** A measuring document: one section, its rules, and the links that
 *  make Chromium write a destination for each id. */
export function sectionDoc(html, secHtml, css, ids) {
  const { head, body } = docParts(html);
  return head + '<style>' + css + '</style></head>' + body + secHtml + hiddenLinks(ids) + '</body></html>';
}

const TALL_IN = 100;

/** The notes document: each note alone at the top of a tall page as
 *  wide as the text column, in the book's own stylesheet. */
export function notesDoc(html, cfg, notes) {
  const { head, body } = docParts(html);
  const boxes = ['top-left-corner', 'top-left', 'top-center', 'top-right', 'top-right-corner', 'bottom-left-corner', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-right-corner', 'left-top', 'left-middle', 'left-bottom', 'right-top', 'right-middle', 'right-bottom']
    .map((b) => '@' + b + ' { content: none; }').join(' ');
  const page = '{ size: ' + cfg.colW + 'pt ' + TALL_IN + 'in; margin: 0; ' + boxes + ' }';
  const css = ['@page ' + page, '@page :left ' + page, '@page :right ' + page, '@page :first ' + page, '@page :blank ' + page,
    'html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }',
    '.fn-wrap { break-after: page; width: ' + cfg.colW + 'pt; margin: 0; padding: 0; }',
    '.fn-wrap:last-child { break-after: auto; }',
  ].join('\n');
  const bodyTag = body.replace(/^<body/i, '<body class="beuk-fn-doc"').replace(/class="beuk-fn-doc"([^>]*)\sclass="([^"]*)"/, 'class="beuk-fn-doc $2"$1');
  const ids = [];
  const items = notes.map((n, i) => {
    ids.push('fnn-' + i, 'fnne-' + i);
    return '<div class="fn-wrap"><div class="fn-note" id="fnn-' + i + '">' + n.body + '</div><div id="fnne-' + i + '" style="height:0"></div></div>';
  }).join('');
  return head + '<style>' + css + '</style></head>' + bodyTag + items + hiddenLinks(ids) + '</body></html>';
}

/** Every named destination in a PDF: its page and its depth below the
 *  top of the page area (Chromium writes y = page height − depth). */
export async function readDests(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const out = new Map();
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (dests) {
    for (const [key, value] of dests.entries()) {
      const arr = value instanceof PDFArray ? value : doc.context.lookupMaybe(value, PDFArray);
      const target = arr && arr.get(0);
      if (!(target instanceof PDFRef) || !pageIndex.has(target.toString())) continue;
      const i = pageIndex.get(target.toString());
      const yObj = arr.get(3);
      const y = yObj && typeof yObj.asNumber === 'function' ? yObj.asNumber() : Number(String(yObj));
      out.set(key.decodeText(), { page: i, depth: pages[i].getHeight() - (isFinite(y) ? y : pages[i].getHeight()) });
    }
  }
  return { dests: out, pages: pages.length };
}

/** Each note's height in pt, from the notes document's destinations;
 *  Infinity for a note taller than its tall page (never placed). */
export function noteHeights(dests, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = dests.get('fnn-' + i), b = dests.get('fnne-' + i);
    out.push(a && b && a.page === b.page ? { page: a.page, top: a.depth, h: Math.max(0, b.depth - a.depth) } : { page: a ? a.page : -1, top: 0, h: Infinity });
  }
  return out;
}

/* ---------------- deciding the pages ---------------- */

const SAME = 0.6;

/** How the notes fall onto pages: each page takes the lines carried
 *  over from earlier pages first, then its own notes in order, up to
 *  the note area's cap. A carried note yields to the page's own notes
 *  (keeping two lines here, or all it has left) and runs on further —
 *  so every note begins on its reference's page whenever it can; one
 *  that cannot begin there (at least two lines, or the whole of a
 *  shorter one) is `displaced`, and the layout avoids that by moving
 *  the reference instead. Heights are in pt; a note splits only
 *  between lines (cfg.noteLine), and only if it is set on that grid. */
export function assignNotes(ownByPage, heights, cfg, pageCount) {
  const capLines = Math.max(2, Math.floor((cfg.cap * cfg.contentH - cfg.sep) / cfg.noteLine));
  const linesOf = (n) => Math.max(1, Math.round(heights[n].h / cfg.noteLine));
  const onGrid = (n) => Math.abs(heights[n].h - linesOf(n) * cfg.noteLine) < cfg.noteLine * 0.3;
  const pages = [];
  let carry = [];
  for (let p = 0; p < pageCount || carry.length; p++) {
    const own = ownByPage.get(p) || [];
    const carryLeft = carry.reduce((k, c) => k + linesOf(c.note) - c.from, 0);
    const ownLines = own.reduce((k, n) => k + linesOf(n), 0);
    const carryCap = own.length ? Math.max(Math.min(2, carryLeft), capLines - ownLines) : capLines;
    const frags = [];
    const next = [];
    let used = 0;
    let usedPt = 0;
    let displaced = false;
    const place = (note, from, room, ownNote) => {
      const lines = linesOf(note);
      const left = lines - from;
      if (left <= room) {
        const hPt = from === 0 ? heights[note].h : left * cfg.noteLine;
        frags.push({ note, from, to: lines, h: hPt, whole: from === 0 });
        used += left;
        usedPt += hPt;
      } else if (room >= Math.min(2, left) && onGrid(note)) {
        frags.push({ note, from, to: from + room, h: room * cfg.noteLine, whole: false });
        used += room;
        usedPt += room * cfg.noteLine;
        next.push({ note, from: from + room });
      } else {
        next.push({ note, from });
        if (ownNote && from === 0) displaced = true;
      }
    };
    let carryUsed = 0;
    for (const c of carry) {
      const before = used;
      const room = Math.min(capLines - used, carryCap - carryUsed);
      if (room <= 0) { next.push(c); continue; }
      place(c.note, c.from, room, false);
      carryUsed += used - before;
    }
    // the page's own notes keep their order: once one cannot begin,
    // the rest wait behind it
    let blocked = false;
    for (const n of own) {
      if (blocked) { next.push({ note: n, from: 0 }); displaced = true; continue; }
      const had = next.length;
      place(n, 0, capLines - used, true);
      if (next.length > had && next[next.length - 1].from === 0) blocked = true;
    }
    carry = next;
    pages.push({ frags, area: frags.length ? usedPt + cfg.sep : 0, displaced, continued: frags.length > 0 && frags[0].from > 0 });
    if (p > pageCount + 400) break;
  }
  return pages;
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** The coarse picture of a section from one pass: where each piece
 *  starts and ends, which page each reference falls on, and how far
 *  down each page the text reaches (contentH when it runs on). */
export function coarseLayout(model, cuts, dests, pageCount, cfg, notes, metrics) {
  const pieces = piecesOf(model, cuts);
  const bottom = new Array(pageCount).fill(0);
  const full = new Array(pageCount).fill(false);
  let unknown = false;
  for (const u of model.units) {
    for (const pc of pieces.get(u.i)) {
      const a = dests.get(pc.top), b = dests.get(pc.end);
      if (!a) { unknown = true; continue; }
      if (!b) {
        // no foot measured: count the piece as reaching the foot of its page
        if (a.page < pageCount) full[a.page] = true;
        continue;
      }
      for (let p = a.page; p < b.page && p < pageCount; p++) full[p] = true;
      if (b.page < pageCount) bottom[b.page] = Math.max(bottom[b.page], footOf(u, b, metrics, cfg));
    }
  }
  const refPage = new Map();
  notes.forEach((n, i) => { const d = dests.get(n.ref); if (d) refPage.set(i, d); });
  return { bottom, full, refPage, unknown };
}

export function ownByPageOf(refPage, placeable) {
  const own = new Map();
  [...refPage.entries()].filter(([i]) => placeable(i)).sort((a, b) => a[1].page - b[1].page || a[1].depth - b[1].depth || a[0] - b[0])
    .forEach(([i, d]) => { if (!own.has(d.page)) own.set(d.page, []); own.get(d.page).push(i); });
  return own;
}

/** The first page, at or after `from`, whose notes do not fit. */
export function firstOverfull(layout, assignment, cfg, from, okPages) {
  for (let p = from; p < layout.bottom.length; p++) {
    if (okPages.has(p)) continue;
    const a = assignment[p];
    if (!a || (!a.area && !a.displaced)) continue;
    if (a.displaced || layout.full[p] || layout.bottom[p] + 1 > cfg.contentH - a.area) return p;
  }
  return -1;
}

/** Lines of the fine pass: for each wrapped unit, its words grouped
 *  into lines (page, top), with line boxes from the unit's own pitch. */
export function fineLines(model, cuts, fine, dests, cfg) {
  const pieces = piecesOf(model, cuts);
  const lines = [];
  const metrics = new Map();
  for (const u of model.units) {
    if (!fine.has(u.i)) continue;
    const pcs = pieces.get(u.i);
    const ul = [];
    u.words.forEach((w, k) => {
      const d = dests.get('fnw-' + u.i + '-' + k);
      if (!d) return;
      const last = ul[ul.length - 1];
      if (last && last.page === d.page && Math.abs(last.top - d.depth) < SAME) { last.lastWord = k; return; }
      ul.push({ unit: u.i, page: d.page, top: d.depth, firstWord: k, lastWord: k });
    });
    const diffs = [];
    for (let i = 1; i < ul.length; i++) if (ul[i].page === ul[i - 1].page && ul[i].top > ul[i - 1].top) diffs.push(ul[i].top - ul[i - 1].top);
    const pitch = median(diffs) || cfg.pitch;
    const first = dests.get(pcs[0].top);
    let h0 = ul.length && first && first.page === ul[0].page ? ul[0].top - first.depth : ul.length ? ul[0].top : 0;
    h0 = Math.max(0, Math.min(pitch / 2, h0));
    metrics.set(u.i, { pitch, h0 });
    ul.forEach((l, i) => {
      const nx = ul[i + 1];
      l.boxTop = l.top - h0;
      l.bottom = nx && nx.page === l.page && nx.top > l.top ? nx.top - h0 : l.top - h0 + pitch;
      l.piece = pcs.filter((pc) => pc.from <= l.firstWord).length - 1;
      lines.push(l);
    });
  }
  return { lines, metrics };
}

/** Decide page `P`: the lines it keeps, given the notes carried into it
 *  and the notes its own references call for. Returns { fits } or
 *  { cut } — a split before a word, or a whole unit moved — or
 *  { fail } when no line can stay. */
export function decidePage(P, ctx) {
  const { model, cuts, cfg, dests, notes, heights, carryOwn, fine, placeable } = ctx;
  const pieces = piecesOf(model, cuts);
  const { lines: fl } = fine;
  // The page's lines in document order: wrapped words, or one line per atomic / unwrapped piece.
  const pageLines = [];
  for (const u of model.units) {
    const pcs = pieces.get(u.i);
    const mine = fl.filter((l) => l.unit === u.i && l.page === P);
    if (mine.length) { pageLines.push(...mine.map((l) => Object.assign({ atomic: false }, l))); continue; }
    if (fl.some((l) => l.unit === u.i)) continue; // wrapped, but no line on this page
    pcs.forEach((pc, k) => {
      const a = dests.get(pc.top), b = dests.get(pc.end);
      if (!a || a.page > P || (b && b.page < P)) return;
      const bottom = b && b.page === P ? footOf(u, b, fine.metrics, cfg) : cfg.contentH;
      // a unit from an earlier page reaching into this one starts at its top
      pageLines.push({ unit: u.i, piece: k, page: P, boxTop: a.page < P ? 0 : a.depth, bottom, atomic: true });
    });
  }
  if (!pageLines.length) return { fits: true };
  // Which line each reference sits on.
  const refLine = new Map();
  notes.forEach((n, i) => {
    if (!placeable(i)) return;
    const d = dests.get(n.ref);
    if (!d || d.page !== P) return;
    const unit = model.refs.get(n.ref);
    let best = -1;
    pageLines.forEach((l, j) => { if (l.unit === unit && (l.atomic || l.boxTop <= d.depth + SAME)) best = j; });
    if (best < 0) best = pageLines.findIndex((l) => l.unit === unit);
    if (best < 0) best = pageLines.length - 1;
    refLine.set(i, best);
  });
  const unitLines = (u, piece) => fl.filter((l) => l.unit === u && l.piece === piece);
  const m = pageLines.length;
  // the lowest any kept line reaches, for each count of kept lines
  const reach = [];
  pageLines.forEach((l, j) => { reach[j] = Math.max(j ? reach[j - 1] : 0, l.bottom); });
  const tries = [{ keep: true, orph: true, disp: true }, { keep: false, orph: true, disp: true }, { keep: false, orph: false, disp: true }, { keep: false, orph: false, disp: false }];
  for (const rule of tries) {
    for (let k = m; k >= 1; k--) {
      const a = pageLines[k - 1], b = pageLines[k];
      if (k < m) {
        if (a.unit === b.unit && a.piece === b.piece) {
          if (a.atomic || b.atomic || !model.units[a.unit].splittable) continue;
          if (rule.orph) {
            const all = unitLines(a.unit, a.piece);
            const at = all.findIndex((l) => l.firstWord === b.firstWord);
            if (at < cfg.orphans || all.length - at < cfg.widows) continue;
          }
        } else {
          if (b.piece > 0) continue; // a continued piece already starts its own page
          if (rule.keep && (model.units[a.unit].keepNext || model.units[b.unit].keepPrev)) continue;
        }
      }
      const own = [];
      refLine.forEach((j, i) => { if (j < k) own.push(i); });
      own.sort((x, y) => refLine.get(x) - refLine.get(y) || x - y);
      const ownByPage = new Map(carryOwn);
      ownByPage.set(P, own);
      const asg = assignNotes(ownByPage, heights, cfg, P + 1)[P];
      if (rule.disp && asg.displaced) continue;
      if (reach[k - 1] + 1 > cfg.contentH - asg.area) continue;
      if (k === m) return { fits: true };
      if (a.unit === b.unit && a.piece === b.piece) {
        // split before line b — or before the word hyphenated into it
        let word = b.firstWord;
        const prev = b.firstWord - 1;
        const x = dests.get('fnx-' + b.unit + '-' + prev);
        if (prev > a.firstWord && x && x.page === b.page && Math.abs(x.depth - b.top) < SAME) word = prev;
        return { cut: { type: 'split', unit: b.unit, word, page: P } };
      }
      return { cut: { type: 'before', unit: b.unit, page: P } };
    }
  }
  return { fail: true };
}

/** The units whose words a fine pass over page P wraps: every text
 *  block on that page that reaches below `zoneTop` (or runs on past
 *  it) — a cut can only fall there; a block wholly above it stays one
 *  line to the decision, and its words cost no destinations. */
export function unitsOnPage(model, cuts, dests, P, zoneTop = 0) {
  const pieces = piecesOf(model, cuts);
  const out = new Set();
  for (const u of model.units) {
    if (!u.words.length) continue;
    for (const pc of pieces.get(u.i)) {
      const a = dests.get(pc.top), b = dests.get(pc.end);
      if (a && a.page <= P && (!b || b.page > P || (b.page === P && b.depth >= zoneTop))) out.add(u.i);
    }
  }
  return out;
}

/** Why a section's notes stayed at its end, as the renderer reports it
 *  (the x-beuk-footnotes header, and from there the studio): */
export const FALLBACK = {
  time: 'time', // not settled within the renderer's time share (or its pass limit)
  full: 'full', // a page could keep no line above the notes it calls for
  long: 'long', // a note ran on past even the pages added for it at the section's end
  book: 'book', // the section broke differently in the whole book than measured alone
  final: 'final', // the final pass put a reference on another page
  note: 'note', // that note alone: it could not be measured, or its reference is not in the text
};
/* At most this many pages are added at a section's end for notes
   running on from its last page. */
const MAX_TAIL = 3;

/**
 * Settle one section. `render(html) -> PDF bytes` prints a document;
 * `deadline` (ms epoch) stops the work in time. Returns the cuts and
 * the per-page note placement, or { fallback: reason } to keep the
 * notes at its end.
 */
export async function layoutSection({ html, sec, cfg, notes, heights, render, deadline, extraCss = '', log = () => {} }) {
  const model = sectionModel(sec.html);
  const placeable = (i) => isFinite(heights[i].h) && model.refs.has(notes[i].ref);
  const refIds = notes.filter((n, i) => placeable(i)).map((n) => n.ref);
  const hide = notes.filter((n, i) => placeable(i)).map((n) => n.id);
  const css = footnoteCss(cfg, hide, hide.length === notes.length ? [sec.id] : []);
  const measureCss = extraCss ? extraCss + ' ' + css : css;
  const metrics = new Map();
  let cuts = [];
  let nextId = 0;
  let okPages = new Set();
  let passes = 0;
  const maxPasses = 60;
  // The deepest a cut can rise: the note area's cap, a heading's and a
  // widow's few lines more.
  const zoneTop = cfg.contentH * (1 - cfg.cap) - cfg.pitch * (cfg.orphans + cfg.widows + 2);
  // After a cut on page P, the pass that checks it also wraps the words
  // of what will be page P + 1 (the cut block's tail and the old page
  // P + 1): when that page is the next to decide — notes falling page
  // after page — its words are measured already, and a pass is saved.
  let speculate = new Set();
  // Empty pages forced at the section's end, for a note that runs on
  // from its last page (the next section starts on a fresh page).
  let tail = 0;
  const giveUp = (reason, why) => { log('footnotes: ' + sec.id + ' ' + why); return { fallback: reason }; };
  for (;;) {
    if (Date.now() > deadline || passes >= maxPasses) return giveUp(FALLBACK.time, 'not settled after ' + passes + ' passes');
    passes += 1;
    const wrapped = speculate;
    const coarse = await readDests(await render(sectionDoc(html, buildSection(model, cuts, wrapped, tail), measureCss, passIds(model, cuts, wrapped, refIds))));
    const layout = coarseLayout(model, cuts, coarse.dests, coarse.pages, cfg, notes, metrics);
    let from = 0;
    let decided = false;
    while (!decided) {
      const own = ownByPageOf(layout.refPage, placeable);
      const assignment = assignNotes(own, heights, cfg, coarse.pages);
      const P = firstOverfull(layout, assignment, cfg, from, okPages);
      if (P < 0) {
        // settled — unless a note runs on past the section's last page:
        // then that many empty pages more at its end, and measure again
        // (the pages before are decided; the new ones hold no text)
        let past = 0;
        for (let p = coarse.pages; p < assignment.length; p++) if (assignment[p].frags.length) past = p - coarse.pages + 1;
        if (past > 0) {
          if (tail + past > MAX_TAIL) return giveUp(FALLBACK.long, 'notes run past the section end');
          tail += past;
          speculate = new Set();
          decided = true;
          continue;
        }
        // the placement every page carries
        return { model, cuts, tail, css, hide, placement: assignment.slice(0, coarse.pages), pages: coarse.pages, passes, refIds, refPage: layout.refPage };
      }
      if (Date.now() > deadline || passes >= maxPasses) return giveUp(FALLBACK.time, 'out of time');
      if (process.env.FN_DEBUG) log('  decide page ' + P + ': text to ' + layout.bottom[P].toFixed(1) + (layout.full[P] ? ' (runs on)' : '') + ', notes ' + assignment[P].area.toFixed(1) + ' of ' + cfg.contentH);
      const need = unitsOnPage(model, cuts, coarse.dests, P, zoneTop);
      let fineSet = wrapped;
      let fineRun = coarse;
      if ([...need].some((u) => !wrapped.has(u))) {
        passes += 1;
        fineSet = need;
        fineRun = await readDests(await render(sectionDoc(html, buildSection(model, cuts, fineSet, tail), measureCss, passIds(model, cuts, fineSet, refIds))));
      }
      const fine = fineLines(model, cuts, fineSet, fineRun.dests, cfg);
      for (const [u, mt] of fine.metrics) metrics.set(u, mt);
      const carryOwn = new Map([...own.entries()].filter(([p]) => p < P));
      const verdict = decidePage(P, { model, cuts, cfg, dests: fineRun.dests, notes, heights, carryOwn, fine, placeable });
      if (verdict.fail) return giveUp(FALLBACK.full, 'page ' + P + ' cannot hold its notes');
      if (verdict.fits) { okPages.add(P); from = P + 1; continue; }
      const measured = cuts;
      cuts = cuts.filter((c) => c.page < P);
      cuts.push(Object.assign({ id: nextId++ }, verdict.cut));
      okPages = new Set([...okPages].filter((p) => p < P));
      speculate = unitsOnPage(model, measured, fineRun.dests, P + 1);
      if (model.units[verdict.cut.unit].words.length) speculate.add(verdict.cut.unit);
      decided = true;
    }
  }
}

/**
 * The whole book: the notes typeset once, then each section with notes
 * settled in turn. Returns null when the document asks for no
 * page-bottom notes (or none could be placed); otherwise the document
 * to print and what to draw on its pages.
 */
export async function settleFootnotes({ html, render, pool = null, deadline, extraCss = '', log = () => {} }) {
  const cfg = footnoteConfig(html);
  if (!cfg) return null;
  const secs = sectionSlices(html).map((sec) => ({ sec, notes: sectionNotes(sec.html) })).filter((s) => s.notes.length);
  if (!secs.length) return null;
  const all = secs.flatMap((s) => s.notes);
  const notesPdf = await render(notesDoc(html, cfg, all));
  const heights = noteHeights((await readDests(notesPdf)).dests, all.length);
  let off = 0;
  const jobs = secs.map((s) => { const h = heights.slice(off, off + s.notes.length); off += s.notes.length; return { s, h, r: null }; });
  // Each page of the pool settles one section at a time; sections are
  // independent (each starts on a fresh page).
  let next = 0;
  const worker = async (r) => {
    while (next < jobs.length) {
      const j = jobs[next++];
      if (Date.now() < deadline) j.r = await layoutSection({ html, sec: j.s.sec, cfg, notes: j.s.notes, heights: j.h, render: r, deadline, extraCss, log });
    }
  };
  await Promise.all((pool && pool.length ? pool : [render]).map(worker));
  const results = [];
  let kept = 0;
  // every section (or note) left at its end, and why: { id, reason, notes }
  const fallbacks = [];
  for (const j of jobs) {
    if (j.r && !j.r.fallback) {
      results.push(Object.assign(j.r, { sec: j.s.sec, notes: j.s.notes, heights: j.h }));
      const left = j.s.notes.length - j.r.hide.length;
      kept += left;
      if (left) fallbacks.push({ id: j.s.sec.id, reason: FALLBACK.note, notes: left });
    } else {
      kept += j.s.notes.length;
      fallbacks.push({ id: j.s.sec.id, reason: j.r ? j.r.fallback : FALLBACK.time, notes: j.s.notes.length });
    }
  }
  if (!results.length) return { cfg, results, notesPdf, html, refIds: [], placed: 0, kept, fallbacks };
  return { cfg, results, notesPdf, html: placedHtml(html, results), refIds: results.flatMap((r) => r.refIds), placed: results.reduce((n, r) => n + r.hide.length, 0), kept, fallbacks };
}

/** The renderer's account of the notes, for its x-beuk-footnotes
 *  header (ASCII): "placed=N; kept=N; passes=N" and, when any note
 *  stayed at its section's end, "; fallback=ps-3:time:2,ps-7:long:1"
 *  — the print section, the reason (FALLBACK), the notes it kept. */
export function footnoteHeader({ placed = 0, kept = 0, passes = 0, fallbacks = [] }) {
  const safe = (s) => String(s).replace(/[^\w-]/g, '');
  const fb = fallbacks.filter((f) => f.notes > 0).map((f) => safe(f.id) + ':' + safe(f.reason) + ':' + (f.notes | 0));
  return 'placed=' + placed + '; kept=' + kept + '; passes=' + passes + (fb.length ? '; fallback=' + fb.join(',') : '');
}

/** The settled sections whose references did not land, in the whole
 *  book's page-map pass, on the pages their own pass found — the
 *  section measured alone and the section in the book must agree. */
export function misplaced(results, dests) {
  return results.filter((r) => {
    const start = dests.get(r.sec.id);
    if (start == null) return true;
    for (const [i, d] of r.refPage) {
      if (!r.hide.includes(r.notes[i].id)) continue;
      const at = dests.get(r.notes[i].ref);
      if (at == null || at - start !== d.page) return true;
    }
    return false;
  });
}

/** Where each settled section's pages sit in the finished PDF, read
 *  from its references' destinations there: every placed reference
 *  must sit the same number of pages after its section-alone page.
 *  Null when one does not — the book broke differently than measured. */
export function placementsIn(results, dests) {
  const out = [];
  for (const r of results) {
    let offset = null;
    for (const [i, d] of r.refPage) {
      if (!r.hide.includes(r.notes[i].id)) continue;
      const at = dests.get(r.notes[i].ref);
      if (!at) return null;
      const o = at.page - d.page;
      if (offset != null && o !== offset) return null;
      if (Math.abs(at.depth - d.depth) > 1) return null;
      offset = o;
    }
    if (offset == null) continue;
    out.push({ start: offset, placement: r.placement, notes: r.heights, ids: r.notes.map((n) => n.id) });
  }
  return out;
}

/** The document with every settled section's cuts made and its moved
 *  notes hidden from its end-of-section list. */
export function placedHtml(html, results) {
  if (!results.length) return html;
  results = results.slice().sort((a, b) => a.sec.at - b.sec.at);
  const css = [];
  let out = '';
  let pos = 0;
  for (const r of results) {
    out += html.slice(pos, r.sec.at) + buildSection(r.model, r.cuts, new Set(), r.tail || 0);
    pos = r.sec.end;
    css.push(r.css);
  }
  out += html.slice(pos);
  const unique = [...new Set(css.join('\n').split('\n'))].join('\n');
  return out.replace(/<\/head>/i, '<style>' + unique + '</style></head>');
}

/** The notes' references, made visible to the page-map pass. */
export function withRefMap(html, refIds) {
  if (!refIds.length) return html;
  return html.replace(/<\/body>(?![\s\S]*<\/body>)/i, hiddenLinks(refIds) + '</body>');
}

/** True when the page index (0-based, in the finished PDF) is a
 *  right-hand page: the first page is a right page left to right, a
 *  left page right to left (measured on Chromium 156). */
export const isRightPage = (i, rtl) => (i % 2 === 0) !== !!rtl;

/** Remove the measuring names (`ids`) from a finished PDF: their named
 *  destinations, and any link annotation the hidden links left. */
function stripNames(doc, ids) {
  if (!ids.length) return;
  const names = new Set(ids);
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (dests) for (const key of [...dests.keys()]) if (names.has(key.decodeText())) dests.delete(key);
  const nameOf = (v) => (v && typeof v.decodeText === 'function' ? v.decodeText() : null);
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
      const target = nameOf(a.lookup(PDFName.of('Dest'))) || (action ? nameOf(action.lookup(PDFName.of('D'))) : null);
      if (target && names.has(target)) annots.remove(i);
    }
  }
}

/** A link to a named destination the file does not hold goes nowhere:
 *  remove it. (A reference whose note moved to the page foot linked to
 *  the note in its section's end list, which no longer prints; the
 *  stamping names the note where it is drawn, so this is a net.) */
function dropDeadLinks(doc) {
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const have = new Set(dests ? [...dests.keys()].map((k) => k.decodeText()) : []);
  const nameOf = (v) => (v && !(v instanceof PDFArray) && typeof v.decodeText === 'function' ? v.decodeText() : null);
  let dropped = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
      const goTo = !action || String(action.lookup(PDFName.of('S'))) === '/GoTo';
      const target = nameOf(a.lookup(PDFName.of('Dest'))) || (action && goTo ? nameOf(action.lookup(PDFName.of('D'))) : null);
      if (target && !have.has(target)) { annots.remove(i); dropped += 1; }
    }
  }
  return dropped;
}

/** Every link annotation in a PDF that names a destination the file
 *  does not hold (a dead link) — what the tests assert is none. */
export async function deadLinks(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const have = new Set(dests ? [...dests.keys()].map((k) => k.decodeText()) : []);
  const nameOf = (v) => (v && !(v instanceof PDFArray) && typeof v.decodeText === 'function' ? v.decodeText() : null);
  const out = [];
  doc.getPages().forEach((page, p) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
      const target = nameOf(a.lookup(PDFName.of('Dest'))) || (action ? nameOf(action.lookup(PDFName.of('D'))) : null);
      if (target && !have.has(target)) out.push({ page: p, target });
    }
  });
  return out;
}

/** Draw each page's notes into the room left at its foot: clipped from
 *  the notes PDF, under a short rule (full width when a note runs on).
 *  Each note drawn from its first line is named there (its own id), so
 *  its reference's link jumps to it at the foot of the page; a link
 *  still naming nothing is removed. */
export async function stampFootnotes(pdfBytes, notesPdfBytes, sections, cfg, strip = []) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const src = await PDFDocument.load(notesPdfBytes, { updateMetadata: false });
  stripNames(doc, strip);
  const pages = doc.getPages();
  const srcPages = src.getPages();
  const cache = new Map();
  let drawn = 0;
  for (const s of sections) {
    s.placement.forEach((pl, p) => {
      if (!pl.frags.length) return;
      cache.set(s.start + p, { pl, notes: s.notes, ids: s.ids || [] });
    });
  }
  let dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  const name = (id, page, x, y) => {
    if (!id) return;
    if (!dests) { dests = doc.context.obj({}); doc.catalog.set(PDFName.of('Dests'), dests); }
    dests.set(PDFName.of(id), doc.context.obj([page.ref, PDFName.of('XYZ'), PDFNumber.of(x), PDFNumber.of(y), PDFNull]));
  };
  for (const [at, { pl, notes, ids }] of [...cache.entries()].sort((a, b) => a[0] - b[0])) {
    const page = pages[at];
    if (!page) continue;
    const x0 = isRightPage(at, cfg.rtl) ? cfg.inside : cfg.outside;
    const yFoot = cfg.bottom;
    const notesTop = yFoot + pl.area - cfg.sep;
    const ruleY = notesTop + cfg.sep * 0.45;
    const ruleW = pl.continued ? cfg.colW : Math.min(cfg.colW, Math.max(36, cfg.colW * 0.3));
    const ruleX = cfg.rtl ? x0 + cfg.colW - ruleW : x0;
    page.drawLine({ start: { x: ruleX, y: ruleY }, end: { x: ruleX + ruleW, y: ruleY }, thickness: 0.5, color: rgb(0, 0, 0) });
    let y = notesTop;
    for (const f of pl.frags) {
      const n = notes[f.note];
      const sp = srcPages[n.page];
      if (!sp) continue;
      const H = sp.getHeight();
      const top = H - n.top - f.from * cfg.noteLine;
      const h = f.h;
      const emb = await doc.embedPage(sp, { left: 0, bottom: top - h, right: cfg.colW, top });
      page.drawPage(emb, { x: x0, y: y - h });
      if (f.from === 0) name(ids[f.note], page, x0, Math.round(y * 100) / 100);
      y -= h;
      drawn += 1;
    }
  }
  const dead = dropDeadLinks(doc);
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), drawn, dead };
}
