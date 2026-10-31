// Running heads for the print PDF — set where Chromium cannot.
//
// The studio writes the head into an @page margin box: a literal line
// (the book's title, its author, or both) or the chapter's own title
// through `string-set: chapterTitle` / `content: string(chapterTitle)`,
// with `@page chapterstart:first` taking it off a chapter's opening
// page. Measured on Chromium (the engine page.pdf runs here):
//   - string-set / string() are not supported: a chapter-title head
//     prints EMPTY on every page (0 of 820 body pages of a 917-page
//     novel, 0 of 70 of the 97-page sample);
//   - :first on a named page group is not supported: the head prints on
//     every opening page whatever the writer chose;
//   - one `@page { @top-center { content: none !important } }` clears
//     the head box on every page rule the studio writes (named pages,
//     :left / :right, :first).
// So the studio also describes the head in <meta name="beuk-heads">:
// the margin box, the head's type (the same declarations its @page rule
// carries), whether opening pages and blank pages print bare, and the
// text each section's pages carry — worked out the way the Print
// Interior View draws them, so the PDF is the page the writer saw. The
// renderer then:
//   1. clears the stylesheet's own head (headsCss) in the final pass;
//   2. works out every page's head from where each section starts — the
//      page map spreads.mjs measures, with its blank pages — (pageHeads):
//      no head on the first page, a display page, a spread's plate, a
//      blank page when blanks print bare, an opening page when openings
//      print bare, or a page whose section carries no text;
//   3. has Chromium typeset each distinct head once on each side of the
//      spread, in a document that is the book's own <head> (its fonts
//      and @page margins) with named pages for the text and nothing in
//      the body (headsDocument) — the head is Chromium's own margin-box
//      text, exactly as the stylesheet would have set it;
//   4. draws the matching side's head over each page (stampHeads),
//      embedded once for the whole book (pdf-lib embedPages: one copy of
//      the head's font, measured +25 KB for 180 heads; an embedPage call
//      per head copied the font each time, +2.1 MB).
// A document without the meta prints exactly as before. Every step is
// plain data in, data out, so the tests run without a browser.

import { PDFDocument } from 'pdf-lib';
import { stripNames } from './footnotes.mjs';

const BOXES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const MAX_TEXT = 300;
const MAX_STYLE = 600;

function unescapeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The head the document asks the renderer to set, or null: no meta, or
 *  one that does not read as a head (the stylesheet then stands as is). */
export function headsConfig(html) {
  const m = /<meta name="beuk-heads" content="([^"]*)"\s*\/?>/.exec(html);
  if (!m) return null;
  let cfg;
  try { cfg = JSON.parse(unescapeAttr(m[1])); } catch { return null; }
  if (!cfg || typeof cfg !== 'object') return null;
  if (cfg.box !== 'top-center' && cfg.box !== 'bottom-center') return null;
  // the head's type is pasted into a stylesheet: declarations only
  if (typeof cfg.style !== 'string' || cfg.style.length > MAX_STYLE || /[{}<>@\\]/.test(cfg.style)) return null;
  if (!cfg.heads || typeof cfg.heads !== 'object') return null;
  const heads = {};
  for (const [id, text] of Object.entries(cfg.heads)) {
    if (!/^ps-\d+$/.test(id)) continue;
    heads[id] = typeof text === 'string' ? text.slice(0, MAX_TEXT) : '';
  }
  return { box: cfg.box, style: cfg.style, omitOpenings: cfg.omitOpenings === true, omitBlank: cfg.omitBlank === true, heads };
}

/** The final pass's extra rule: the stylesheet's own head stands down
 *  (stamped instead), on every page whatever its @page rule. */
export function headsCss(cfg) {
  return '@page { @' + cfg.box + ' { content: none !important; } }';
}

export function withHeadsCss(html, cfg) {
  return html.replace(/<\/head>/i, () => '<style>' + headsCss(cfg) + '</style></head>');
}

/** Every page's head (0-based page index → text, or null for none), from
 *  the sections' start pages (`starts`, id → page) and the sections a
 *  blank page was put before (`before`), exactly as the Print Interior
 *  View draws them: a blank page belongs to the section before it. */
export function pageHeads({ plan, starts, before = new Set(), pageCount, cfg }) {
  const order = plan.filter((s) => starts.has(s.id)).map((s) => ({ ...s, at: starts.get(s.id) })).sort((a, b) => a.at - b.at);
  const blank = new Set();
  for (const s of order) if (before.has(s.id) && s.at > 0) blank.add(s.at - 1);
  const out = new Array(pageCount).fill(null);
  let k = -1;
  for (let p = 0; p < pageCount; p++) {
    while (k + 1 < order.length && order[k + 1].at <= p) k++;
    if (p === 0 || k < 0) continue;
    const s = order[k];
    if (blank.has(p)) {
      if (!cfg.omitBlank) out[p] = cfg.heads[s.id] || null;
      continue;
    }
    if (s.display) continue;
    if (s.spread && p === s.at) continue; // the plate's own page
    if (cfg.omitOpenings && p === (s.spread ? s.at + 1 : s.at)) continue;
    out[p] = cfg.heads[s.id] || null;
  }
  return out;
}

/** A CSS string literal that cannot end the string, the rule or the
 *  <style> element it sits in. */
export function cssString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, ' ').replace(/</g, '\\3C ') + '"';
}

/** The document Chromium typesets the heads in: the book's own <head>
 *  (its fonts, its @page sizes and margins, so each head sits where the
 *  book's would), one named page per distinct head carrying it in the
 *  head's box with every other margin box cleared, and an empty body of
 *  two pages per head — page 2i on the side of the book's first page
 *  (and of every page an even number of pages after it), 2i + 1 on the
 *  other. */
export function headsDocument(html, texts, cfg) {
  const end = html.search(/<\/head>/i);
  const head = end >= 0 ? html.slice(0, end) : '<!DOCTYPE html><html><head>';
  const rules = texts.map((text, i) =>
    '@page bh' + i + ' { ' + BOXES.map((b) => '@' + b + ' { ' + (b === cfg.box ? 'content: ' + cssString(text) + '; ' + cfg.style : 'content: none;') + ' }').join(' ') + ' }').join('\n');
  const css = 'html, body { background: transparent !important; }\n.bh { break-before: page; height: 1px; }\n.bh:first-child { break-before: auto; }\n' + rules;
  const body = texts.map((_, i) => '<div class="bh" style="page: bh' + i + '"></div><div class="bh" style="page: bh' + i + '"></div>').join('');
  return head + '<style>\n' + css + '\n</style></head><body>' + body + '</body></html>';
}

/** The distinct heads, in first-use order, and each page's index into them. */
export function headTexts(slots) {
  const texts = [];
  const at = new Map();
  const index = slots.map((t) => {
    if (t == null) return -1;
    if (!at.has(t)) { at.set(t, texts.length); texts.push(t); }
    return at.get(t);
  });
  return { texts, index };
}

export async function pageCountOf(pdfBytes) {
  return (await PDFDocument.load(pdfBytes, { updateMetadata: false })).getPageCount();
}

/** Draw each page's head from the typeset heads (`headsPdfBytes`, two
 *  pages per head; null when no page carries one), removing the
 *  measuring names `strip` on the way. */
export async function stampHeads(pdfBytes, headsPdfBytes, index, strip = []) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  stripNames(doc, strip);
  const src = headsPdfBytes ? await PDFDocument.load(headsPdfBytes, { updateMetadata: false }) : null;
  const embedded = src ? await doc.embedPages(src.getPages()) : [];
  let drawn = 0;
  doc.getPages().forEach((page, p) => {
    const i = index[p];
    if (i == null || i < 0) return;
    const head = embedded[2 * i + (p % 2)];
    if (!head) return;
    page.drawPage(head, { x: 0, y: 0 });
    drawn += 1;
  });
  return { pdf: Buffer.from(await doc.save({ useObjectStreams: false })), drawn };
}
