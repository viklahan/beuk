/* A shape as a printed book's PDF: a title page of its own, each heading
   on a new page, the layout the shape is about drawn the way a press
   lays it out (spaced capitals, a place kicker over a caps title, a head
   broken over two lines, a large initial that the text layer hands over
   as its own item). No document metadata: the reader has to find the
   title and author on the page. Fixed dates and producer, so the bytes
   never change. */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { expandBlocks, spacedCaps } from './render-text.js';
import type { Shape } from './shape.js';

const W = 396, H = 612, M = 54; // 5.5 × 8.5 in
const FIXED = new Date('2026-01-01T00:00:00Z');

export async function renderPdf(s: Shape): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setCreationDate(FIXED); doc.setModificationDate(FIXED);
  doc.setProducer('beuk import-shapes'); doc.setCreator('beuk import-shapes');
  const roman = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  let page: PDFPage | null = null;
  let y = 0;
  let fresh = true; // nothing drawn on this page yet
  let afterHeading = false;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; fresh = true; };
  const need = (h: number) => { if (!page || y - h < M) newPage(); };
  const centred = (t: string, font: PDFFont, size: number) => {
    need(size * 1.4);
    page!.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y: y - size, size, font });
    y -= size * 1.4; fresh = false;
  };
  const wrap = (t: string, font: PDFFont, size: number, width: (line: number) => number): string[] => {
    const lines: string[] = [];
    let cur = '';
    for (const w of t.split(/\s+/)) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && font.widthOfTextAtSize(next, size) > width(lines.length)) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const LEAD = 15, SIZE = 11;
  const paragraph = (t: string, indentFirst: boolean, dropcap: boolean) => {
    if (dropcap) {
      const cap = t.slice(0, 1), capSize = 36, capW = roman.widthOfTextAtSize(cap, capSize) + 4;
      need(LEAD * 3);
      page!.drawText(cap, { x: M, y: y - capSize + 8, size: capSize, font: roman });
      const lines = wrap(t.slice(1), roman, SIZE, (i) => (i < 2 ? W - 2 * M - capW : W - 2 * M));
      lines.forEach((l, i) => { need(LEAD); page!.drawText(l, { x: M + (i < 2 ? capW : 0), y: y - SIZE, size: SIZE, font: roman }); y -= LEAD; });
    } else {
      const ind = indentFirst ? 18 : 0;
      wrap(t, roman, SIZE, (i) => W - 2 * M - (i === 0 ? ind : 0)).forEach((l, i) => {
        need(LEAD); page!.drawText(l, { x: M + (i === 0 ? ind : 0), y: y - SIZE, size: SIZE, font: roman }); y -= LEAD;
      });
    }
    fresh = false;
  };

  const blocks = expandBlocks(s.blocks);
  const titlePage = blocks.findIndex((b) => b.t !== 'title' && b.t !== 'byline' && b.t !== 'series');
  const tpEnd = titlePage < 0 ? blocks.length : titlePage;
  if (tpEnd > 0) { newPage(); y = H * 0.62; }
  blocks.forEach((b, i) => {
    if (i === tpEnd && tpEnd > 0) newPage();
    switch (b.t) {
      case 'title': centred(b.spaced ? spacedCaps(b.text) : b.text, bold, 28); y -= 10; break;
      case 'byline': centred(b.spaced ? spacedCaps(b.text) : b.text, roman, 14); break;
      case 'series': centred(b.text, italic, 12); break;
      case 'heading': {
        if (!fresh || !page) newPage();
        y -= 72;
        if (b.kicker) { centred(b.kicker.toUpperCase(), roman, 11); y -= 6; }
        const size = b.level === 1 ? 18 : 16;
        for (const l of b.lines ?? [b.text]) centred(b.caps ? l.toUpperCase() : l, bold, size);
        y -= 24; afterHeading = true;
        return;
      }
      case 'para': paragraph(b.text, !afterHeading, !!b.dropcap); break;
      case 'break':
        if (b.marker === 'space') y -= 24;
        else { y -= 6; centred(b.marker, roman, SIZE); y -= 6; afterHeading = true; return; }
        afterHeading = true; return;
      case 'contents':
        if (!fresh || !page) newPage();
        y -= 72; centred('Contents', bold, 16); y -= 18;
        for (const e of b.entries) { need(LEAD); page!.drawText(e, { x: M, y: y - SIZE, size: SIZE, font: roman }); y -= LEAD; }
        newPage(); afterHeading = false; return;
    }
    afterHeading = false;
  });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
