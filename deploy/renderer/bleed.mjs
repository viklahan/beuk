// Print bleed for the interior PDF — KDP / IngramSpark style.
//
// A book whose art runs to the page edge (a spread's verso plate, its
// backdrop over the facing recto) must reach the printer as pages a
// little larger than the trim, the art carried past the trim line, so
// the trimming blade cuts through art and never leaves a white sliver.
// KDP (https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6, read
// 2026-10-27): page width with bleed = trim width + 0.125 in, page height
// = trim height + 2 × 0.125 in, "trimmed ... by cutting 0.125" (3.2 mm)
// from the top, bottom, and outside edges" — the inner (gutter) edge gets
// none (e.g. a 6 × 9 trim is set at 6.125 × 9.25 in).
//
// Chromium cannot do it in the document itself: page content is clipped
// to the page area, an @page background starts at the page area's
// corner, and it does not know a page's final side (the renderer inserts
// the blank pages that settle parity — see spreads.mjs). So the studio
// asks for bleed with <meta name="beuk-bleed" content="{json}"> and the
// document is rendered at the trim exactly as without it; this module is
// the very last step of the finishing pass, on the finished PDF whose
// page order is final:
//   - every page's MediaBox grows by the bleed on its top, bottom and
//     outer edge — a right-hand page bleeds right, a left-hand page left
//     (the first page is a right-hand page left to right, a left-hand
//     page right to left; footnotes.isRightPage);
//   - the page's content is moved by the bleed on its left and bottom
//     edges, so everything on it — text block, running head, folio,
//     page-foot notes — stays exactly where it was relative to the trim;
//     its links and named destinations move with it;
//   - TrimBox is the trim inside that, BleedBox = MediaBox.
// The spread pictures stamped beneath the pages (spreads.stampSpreads)
// are drawn by coverRect below to cover the trim AND the bleed.
// Data in, data out: the tests run without a browser.

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import { isRightPage } from './footnotes.mjs';

const BLEED_RE = /<meta name="beuk-bleed" content="([^"]*)"\s*\/?>/;
/** The largest bleed accepted (in): KDP and IngramSpark ask for 0.125. */
const MAX_IN = 0.5;

function unescapeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The bleed the print document asks for, or null when it asks for
 *  none: { pt (the bleed, in pt), rtl }. */
export function bleedConfig(html) {
  const m = BLEED_RE.exec(String(html));
  if (!m) return null;
  let c;
  try {
    c = JSON.parse(unescapeAttr(m[1]));
  } catch {
    return null;
  }
  const inch = c && typeof c.in === 'number' && isFinite(c.in) && c.in > 0 && c.in <= MAX_IN ? c.in : null;
  if (!inch) return null;
  return { pt: inch * 72, rtl: !!c.rtl };
}

/** The bleed on each edge of page `i` (0-based, in the finished PDF), in pt. */
export function bleedSides(i, cfg) {
  const b = cfg.pt;
  const right = isRightPage(i, cfg.rtl);
  return { left: right ? 0 : b, right: right ? b : 0, top: b, bottom: b };
}

/** Where a picture of iw × ih is drawn on a W × H trim (pt, in the
 *  trim's own coordinates): covering it, centred, never stretched —
 *  and, with bleed `sides`, scaled up further only as far as it takes
 *  to cover the bleed too, about the middle of the gutter edge (the edge
 *  that does not bleed). Two halves of one painting, a verso plate and
 *  its recto backdrop, both trim-shaped, so grow by the same factor about
 *  the same point of the spine and still meet there. */
export function coverRect(iw, ih, W, H, sides = null) {
  const k = Math.max(W / iw, H / ih);
  const w0 = iw * k, h0 = ih * k;
  const x0 = (W - w0) / 2, y0 = (H - h0) / 2;
  if (!sides || !(sides.left || sides.right || sides.top || sides.bottom)) return { x: x0, y: y0, w: w0, h: h0 };
  const gx = sides.left > 0 ? W : 0;
  const reachV = H / 2 + Math.max(sides.top, sides.bottom);
  const sV = reachV / (h0 / 2);
  const sH = gx === 0 ? (W + sides.right) / (x0 + w0) : (W + sides.left) / (W - x0);
  const s = Math.max(1, sV, sH);
  return { x: gx + (x0 - gx) * s, y: H / 2 + (y0 - H / 2) * s, w: w0 * s, h: h0 * s };
}

const num = (v) => (v instanceof PDFNumber ? v.asNumber() : null);

/** Move an explicit destination ([page /XYZ left top zoom], /FitH top,
 *  /FitV left, /FitR l b r t …) by its target page's shift. */
function shiftDest(arr, shiftOf, done) {
  if (!(arr instanceof PDFArray) || arr.size() < 2 || done.has(arr)) return;
  done.add(arr);
  const target = arr.get(0);
  const d = target instanceof PDFRef ? shiftOf.get(target.toString()) : null;
  if (!d) return;
  const kind = String(arr.get(1));
  const add = (i, by) => {
    const v = num(arr.get(i));
    if (v !== null) arr.set(i, PDFNumber.of(Math.round((v + by) * 1000) / 1000));
  };
  if (kind === '/XYZ') { add(2, d.dx); add(3, d.dy); }
  else if (kind === '/FitH' || kind === '/FitBH') add(2, d.dy);
  else if (kind === '/FitV' || kind === '/FitBV') add(2, d.dx);
  else if (kind === '/FitR') { add(2, d.dx); add(3, d.dy); add(4, d.dx); add(5, d.dy); }
}

/** The finished PDF with bleed: every page trim + bleed on its top,
 *  bottom and outer edge, its content where it was relative to the trim,
 *  TrimBox = the trim, BleedBox = MediaBox. */
export async function applyBleed(pdfBytes, cfg) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const pages = doc.getPages();
  const shiftOf = new Map();
  pages.forEach((page, i) => {
    const mb = page.getMediaBox();
    const W = mb.width, H = mb.height;
    const s = bleedSides(i, cfg);
    const dx = s.left - mb.x, dy = s.bottom - mb.y;
    shiftOf.set(page.ref.toString(), { dx, dy });
    // Chromium writes a page's content as one stream; pdf-lib wraps
    // only a Contents array (a lone stream is left as it was — measured
    // on the sample before this line: the 64 unstamped pages with words
    // kept their text where it was on the enlarged page, 9 pt off the
    // trim), so the page is normalised to an array first.
    page.node.normalize();
    const before = doc.context.register(doc.context.contentStream([pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, dx, dy)]));
    const after = doc.context.register(doc.context.contentStream([popGraphicsState()]));
    page.node.wrapContentStreams(before, after);
    const fullW = W + s.left + s.right, fullH = H + s.top + s.bottom;
    page.setMediaBox(0, 0, fullW, fullH);
    page.node.delete(PDFName.of('CropBox'));
    page.node.delete(PDFName.of('ArtBox'));
    page.setBleedBox(0, 0, fullW, fullH);
    page.setTrimBox(s.left, s.bottom, W, H);
    // Links move with the page they sit on.
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) {
      for (let a = 0; a < annots.size(); a++) {
        const an = annots.lookupMaybe(a, PDFDict);
        if (!an) continue;
        for (const key of ['Rect', 'QuadPoints']) {
          const arr = an.lookupMaybe(PDFName.of(key), PDFArray);
          if (!arr) continue;
          for (let k = 0; k < arr.size(); k++) {
            const v = num(arr.get(k));
            if (v !== null) arr.set(k, PDFNumber.of(Math.round((v + (k % 2 === 0 ? dx : dy)) * 1000) / 1000));
          }
        }
      }
    }
  });
  // Every explicit destination — named ones and those written into a
  // link — points at the same spot of its page as before.
  const done = new Set(); // a destination object shared by two names moves once
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (dests) for (const [, value] of dests.entries()) {
    const v = value instanceof PDFRef ? doc.context.lookup(value) : value;
    shiftDest(v instanceof PDFDict ? v.lookupMaybe(PDFName.of('D'), PDFArray) : v, shiftOf, done);
  }
  for (const page of pages) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let a = 0; a < annots.size(); a++) {
      const an = annots.lookupMaybe(a, PDFDict);
      if (!an) continue;
      const dest = an.lookup(PDFName.of('Dest'));
      if (dest instanceof PDFArray) shiftDest(dest, shiftOf, done);
      const action = an.lookupMaybe(PDFName.of('A'), PDFDict);
      const d = action ? action.lookup(PDFName.of('D')) : null;
      if (d instanceof PDFArray) shiftDest(d, shiftOf, done);
    }
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
