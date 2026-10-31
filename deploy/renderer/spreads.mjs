// Facing pages and painted spreads for the print PDF — the parts of the
// print interior that Chromium's print engine does not do by itself.
//
// Measured on Chromium 131 (the engine page.pdf runs here):
//   - `break-before: left | right | recto | verso` (and the legacy
//     page-break-before forms) insert NO blank page: each is treated as a
//     plain page break, so "chapters open on a recto" never happened in
//     the PDF and a verso plate could land on a recto.
//   - nothing a document paints reaches the page margins: content is
//     clipped to the page area, and an @page background starts at the
//     page area's corner. A plate could not print edge to edge, and a
//     spread's painting could not cross the gutter margin.
//
// So the renderer finishes the job in three steps:
//   1. a measuring pass: hidden links to every section make Chromium
//      write a named destination for each, which says the page it starts on;
//   2. blank pages are inserted before every section whose required side
//      (data-start="recto" / "verso" — page parity: a verso is even) it
//      missed. Each section already begins on a fresh page, so a blank
//      page moves what follows by exactly one page and reflows nothing;
//   3. the final pass, then each paired spread's pictures — prepared by
//      the studio at the trim's own size — are drawn BENEATH the page's
//      content with pdf-lib: the plate edge to edge on its verso, and its
//      backdrop (at its own strength) over the whole facing recto, gutter
//      margin included.
// Every step is plain data in, data out, so the tests run without a browser.

import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
} from 'pdf-lib';
import { coverRect, bleedSides } from './bleed.mjs';

const SECTION_RE = /<section class="(print-sec[^"]*)" id="(ps-\d+)"(?: data-start="(recto|verso)")?>/g;
// (the figure may carry attributes after its class: the footnote
// layout marks every block it measures — see footnotes.mjs)
const PLATE_RE = /<figure class="plate-page"[^>]*><img src="(data:image\/(?:jpeg|png);base64,[^"]+)"/;
// A paired spread's backdrop, baked by the studio at the page's size (bd-page).
const LAYER_RE = /<div class="bd-layer bd-(?:whisper|soft|strong|spread) bd-page bd-baked" style="background-image:url\((data:image\/(?:jpeg|png);base64,[^)]+)\)"/;

/** The print sections, in order, with the side each must start on and
 *  — for a paired spread — the pictures to draw beneath its pages. */
export function planSections(html) {
  const found = [];
  let m;
  SECTION_RE.lastIndex = 0;
  while ((m = SECTION_RE.exec(html))) found.push({ id: m[2], classes: m[1].split(/\s+/), start: m[3] || null, at: m.index });
  return found.map((s, i) => {
    const body = html.slice(s.at, i + 1 < found.length ? found[i + 1].at : html.length);
    const spread = s.classes.includes('spread-sec');
    const plate = spread ? (PLATE_RE.exec(body) || [])[1] || null : null;
    const layer = spread ? (LAYER_RE.exec(body) || [])[1] || null : null;
    // (display: a title / copyright / dedication page — no head, no folio; heads.mjs)
    return { id: s.id, start: s.start, spread, plate, layer, display: s.classes.includes('display-sec') };
  });
}

/** True when the document needs anything beyond a single plain pass. */
export function needsFinishing(plan) {
  return plan.some((s) => s.start || (s.spread && (s.plate || s.layer)));
}

function afterBodyTag(html, insert) {
  const i = html.search(/<body[^>]*>/i);
  if (i < 0) return insert + html;
  const end = html.indexOf('>', i) + 1;
  return html.slice(0, end) + insert + html.slice(end);
}

/** The measuring pass's document: one hidden link per section, so the
 *  PDF carries a named destination for each (Chromium writes one only
 *  for a link target). */
export function withPageMap(html, plan) {
  const links = plan.map((s) => '<a href="#' + s.id + '">.</a>').join('');
  return afterBodyTag(html, '<div style="position:absolute;width:1px;height:1px;overflow:hidden">' + links + '</div>');
}

/** 0-based start page of every section, from the PDF's named destinations. */
export async function startPages(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  const out = new Map();
  const dests = doc.catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (!dests) return out;
  for (const [key, value] of dests.entries()) {
    const arr = value instanceof PDFArray ? value : doc.context.lookupMaybe(value, PDFArray);
    const target = arr && arr.get(0);
    if (target instanceof PDFRef && pageIndex.has(target.toString())) out.set(key.decodeText(), pageIndex.get(target.toString()));
  }
  return out;
}

/** Which sections need a blank page before them, and where every
 *  section starts once they are in (0-based; page number = index + 1,
 *  so a recto is an even index and a verso an odd one). */
export function blanksFor(plan, starts) {
  const before = new Set();
  const finalStart = new Map();
  let offset = 0;
  for (const s of plan) {
    if (!starts.has(s.id)) continue;
    const at = starts.get(s.id) + offset;
    const pageNo = at + 1;
    if ((s.start === 'recto' && pageNo % 2 === 0) || (s.start === 'verso' && pageNo % 2 === 1)) {
      before.add(s.id);
      offset += 1;
    }
    finalStart.set(s.id, starts.get(s.id) + offset);
  }
  return { before, finalStart };
}

/** The final document: a blank page before each section that needs one,
 *  and the studio's in-page plate and backdrop of a stamped spread
 *  stood down — the same pictures are drawn beneath the page instead. */
export function finalHtml(html, before, stamped) {
  let out = html.replace(SECTION_RE, (tag, cls, id) => (before.has(id) ? '<div class="print-blank" aria-hidden="true"></div>' : '') + tag);
  if (stamped.size) out = out.replace(/<\/head>/i, '<style>' + stampCss(stamped) + '</style></head>');
  return out;
}

/** The rules that stand a stamped spread's in-page pictures down. The
 *  plate keeps its place (its page); the stamped layer leaves the layout
 *  altogether. The print page colour is white (the paper itself); left
 *  painted, it would cover whatever is drawn beneath.
 *  Every measuring pass carries these rules too: the layer is as wide
 *  as the trim and starts in the gutter margin, so while it is in the
 *  layout it overflows the page and Chromium shrinks the whole document
 *  to fit — measured on the sample, body type at 9.97pt instead of 11pt,
 *  92 pages instead of 99 — and the page map no longer matched the
 *  pages printed: each backdrop was drawn on a bare page after its
 *  plate, its opening one page later. */
export function stampCss(stamped) {
  if (!stamped.size) return '';
  const plates = [...stamped].map((id) => '#' + id + ' .plate-page img').join(', ');
  const layers = [...stamped].map((id) => '#' + id + ' .bd-layer.bd-page').join(', ');
  return plates + ' { visibility: hidden !important; } ' + layers + ' { display: none !important; } html, body { background: transparent !important; }';
}

function dataUrlBytes(url) {
  const comma = url.indexOf(',');
  // A copy in its own ArrayBuffer: pdf-lib's JPEG reader views the whole
  // `.buffer` from offset 0, and a small Buffer.from() lives at an offset
  // in Node's shared pool — a picture under 4 KB then read as garbage
  // ("SOI not found in JPEG"; seen in tests/print-bleed.test.ts).
  return { png: url.startsWith('data:image/png'), bytes: new Uint8Array(Buffer.from(url.slice(comma + 1), 'base64')) };
}

async function embed(doc, url) {
  const { png, bytes } = dataUrlBytes(url);
  return png ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

/** The spreads whose pictures can be drawn (pdf-lib embeds JPEG and
 *  PNG). Decided before the final pass: a spread that cannot be stamped
 *  keeps its own in-page pictures. */
export async function stampable(plan) {
  const doc = await PDFDocument.create();
  const ok = new Set();
  for (const s of plan) {
    if (!s.spread || !(s.plate || s.layer)) continue;
    try {
      if (s.plate) await embed(doc, s.plate);
      if (s.layer) await embed(doc, s.layer);
      ok.add(s.id);
    } catch {
      /* stays in the page as the studio set it */
    }
  }
  return ok;
}

/** Draw `image` over the whole page — covering it, centred, never
 *  stretched — beneath everything already on it. With bleed `sides`
 *  (bleed.mjs), it covers the bleed beyond the trim too: drawn past the
 *  page edge here, it shows once applyBleed grows the page. */
function drawBeneath(doc, page, image, name, sides = null) {
  const { width, height } = page.getSize();
  const r = coverRect(image.width, image.height, width, height, sides);
  const key = page.node.newXObject(name, image.ref);
  const under = doc.context.register(doc.context.contentStream([
    pushGraphicsState(),
    concatTransformationMatrix(r.w, 0, 0, r.h, r.x, r.y),
    drawObject(key),
    popGraphicsState(),
  ]));
  const nothing = doc.context.register(doc.context.contentStream([]));
  page.node.wrapContentStreams(under, nothing);
}

/** The finished PDF: each spread's plate on its verso, its backdrop
 *  on the facing recto, drawn beneath the page content — out to the
 *  bleed on the page's top, bottom and outer edge when the book asks
 *  for bleed (`bleed`: bleed.bleedConfig). */
export async function stampSpreads(pdfBytes, plan, finalStart, stamped, bleed = null) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const pages = doc.getPages();
  let n = 0;
  for (const s of plan) {
    if (!stamped.has(s.id) || !finalStart.has(s.id)) continue;
    const at = finalStart.get(s.id);
    const sides = (i) => (bleed ? bleedSides(i, bleed) : null);
    if (s.plate && pages[at]) drawBeneath(doc, pages[at], await embed(doc, s.plate), 'BeukPlate' + (n += 1), sides(at));
    if (s.layer && pages[at + 1]) drawBeneath(doc, pages[at + 1], await embed(doc, s.layer), 'BeukSpread' + (n += 1), sides(at + 1));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
