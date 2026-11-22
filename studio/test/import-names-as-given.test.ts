// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, docx, epub, figures, importFile, odt, oh, op, page, pdf, pdfPara, rtfDoc, rtfH, rtfP, setupImport, written, wp, xml, type Got, type PdfLine, type Sec } from './import-given';

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." A heading that names a page of the book says what
   KIND of page it is ("Acknowledgements" is the acknowledgments page, "Also by Ada Wren" the also-by page, "PROLOGUE"
   the prologue). Its title is the heading as the writer typed it (BEUK:namesgiven).

   Until this test the page was stored under the book's own name for its kind: "Acknowledgements" became
   "Acknowledgments", "Also by Ada Wren" became "Also by the Author", "PROLOGUE" became "Prologue", "ABOUT THE
   AUTHOR" "About the Author". Two places did it: the parser took the name from its table of page kinds, and a page
   that took a seat the empty book already had (Acknowledgments, About the Author, Also by the Author, Dedication…)
   kept the seat's name, whatever the file called it; that second place renamed an EPUB's pages too.

   Held here, in every format: the title stored; what the contents list, the EPUB's navigation, the page itself and
   the print running head then show (each sets the stored title); and the tally, which now finds nothing changed.
   A page the import finds by its shape (a dedication with no heading) has no name of the writer's: the book's own
   name for it stays. Every text here is made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '. The tide kept its own count of the days and the salt answered to no clerk.';
type Block = { h?: string; p?: string };
const BLOCKS: Block[] = [
  { h: 'PROLOGUE' }, { p: P(1) },
  { h: 'Chapter 1: The Muster' }, { p: P(2) }, { p: P(3) },
  { h: 'Chapter 2: The Ledger' }, { p: P(4) }, { p: P(5) },
  { h: 'Acknowledgements' }, { p: 'Thanks to the keepers of the pans, every one of them.' },
  { h: 'Also by Ada Wren' }, { p: 'The Night Ferry. The Harbour Lights.' },
  { h: 'ABOUT THE AUTHOR' }, { p: 'Ada Wren keeps a ledger of her own.' },
];
/* each named page, by its kind, with the title the file gave it */
const NAMED = [
  { type: 'prologue', title: 'PROLOGUE' },
  { type: 'acknowledgments', title: 'Acknowledgements' },
  { type: 'alsoby', title: 'Also by Ada Wren' },
  { type: 'aboutauthor', title: 'ABOUT THE AUTHOR' },
];
const named = (g: Got) => written(g).filter((s) => s.type !== 'chapter').map((s) => ({ type: s.type, title: s.title })).sort((a, b) => NAMED.findIndex((n) => n.type === a.type) - NAMED.findIndex((n) => n.type === b.type));

const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
  ['names.docx', async () => ({ bytes: await docx(BLOCKS.map((b) => (b.h != null ? wp(b.h, true) : wp(b.p!))).join('')), text: '' })],
  ['names.odt', async () => ({ bytes: await odt(BLOCKS.map((b) => (b.h != null ? oh(b.h) : op(b.p!))).join('')), text: '' })],
  ['names.html', async () => ({ bytes: null, text: page(BLOCKS.map((b) => (b.h != null ? '<h1>' + xml(b.h) + '</h1>' : '<p>' + xml(b.p!) + '</p>')).join('')) })],
  ['names.rtf', async () => ({ bytes: null, text: rtfDoc(BLOCKS.map((b) => (b.h != null ? rtfH(b.h) : rtfP(b.p!))).join('')) })],
  ['names.md', async () => ({ bytes: null, text: BLOCKS.map((b) => (b.h != null ? '# ' + b.h : b.p!)).join('\n\n') + '\n' })],
  ['names.txt', async () => ({ bytes: null, text: BLOCKS.map((b) => (b.h != null ? b.h : b.p!)).join('\n\n') + '\n' })],
  ['names.epub', async () => {
    const pages: { title: string; body: string }[] = [];
    for (const b of BLOCKS) { if (b.h != null) pages.push({ title: b.h, body: '<h1>' + xml(b.h) + '</h1>' }); else pages[pages.length - 1].body += '<p>' + xml(b.p!) + '</p>'; }
    return { bytes: await epub(pages), text: '' };
  }],
  ['names.pdf', async () => {
    const lines: PdfLine[] = [];
    for (const b of BLOCKS) { if (b.h != null) { if (lines.length) lines.push({ page: true }); lines.push({ text: b.h, size: 20, gap: 34 }); } else lines.push(...pdfPara(b.p!)); }
    return { bytes: await pdf(lines), text: '' };
  }],
];

beforeAll(async () => { await setupImport('import-names-as-given', ['epubFiles', 'frontBackHtml', 'printRunHeadOf', 'sectionLabel']); }, 180_000);

describe('a named page keeps the heading the writer typed as its title, whatever kind of page it is read as', () => {
  it.each(FILES)('%s: "PROLOGUE", "Acknowledgements", "Also by Ada Wren" and "ABOUT THE AUTHOR" are stored as typed, and nothing differs', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    expect(named(g), name + ': each page by its kind, under the title the file gave it').toEqual(NAMED);
    expect(figures(g), name + ': the tally').toEqual(CLEAR);
  }, 120_000);

  it('the contents list, the EPUB\'s navigation, the page itself and the print running head all show the writer\'s title', async () => {
    const f = await FILES[0][1]();
    const g = await importFile('names.docx', f.bytes, f.text);
    const of = (type: string) => g.secs.find((s) => s.type === type) as Sec;
    const files = g.api.epubFiles('generic') as { path: string; content: string }[];
    const nav = files.find((x) => x.path === 'OEBPS/nav.xhtml')!.content;
    const ncx = files.find((x) => x.path === 'OEBPS/toc.ncx')!.content;
    const contents = g.api.frontBackHtml({ type: 'toc', kind: 'front', title: 'Contents' }, true) as string;
    for (const { type, title } of NAMED) {
      expect(nav, 'the EPUB navigation: ' + title).toContain('>' + title + '</a>');
      expect(ncx, 'the EPUB\'s older navigation (toc.ncx): ' + title).toContain('<text>' + title + '</text>');
      expect(contents, 'the contents list: ' + title).toContain('<span class="toc-label">' + title + '</span>');
      expect(g.api.sectionLabel(of(type)), 'the name the studio lists the page under: ' + title).toBe(title);
      expect(g.api.printRunHeadOf(of(type)), 'the print running head: ' + title).toBe(title);
    }
    /* a back page sets its own title at its head (frontBackHtml's default case) */
    expect(g.api.frontBackHtml(of('acknowledgments'), true) as string).toContain('<h1 class="chapter-title small">Acknowledgements</h1>');
    expect(g.api.frontBackHtml(of('alsoby'), true) as string).toContain('<h1 class="chapter-title small">Also by Ada Wren</h1>');
    /* and none of the book's own names for those kinds is anywhere in what is shown */
    for (const own of ['Acknowledgments', 'Also by the Author', 'About the Author', '>Prologue<']) { expect(nav).not.toContain(own); expect(contents).not.toContain(own); }
  }, 120_000);

  it('a page the import finds by its shape has no name of the writer\'s: the book\'s own name for it stays', async () => {
    /* a short line before Chapter 1 with no heading over it is read as the dedication */
    const g = await importFile('shape.md', null, 'For my mother, who kept the ledger.\n\n# Chapter 1: The Muster\n\n' + P(2) + '\n\n# Chapter 2: The Ledger\n\n' + P(4) + '\n');
    expect(written(g).filter((s) => s.type !== 'chapter').map((s) => ({ type: s.type, title: s.title, content: s.content }))).toEqual([{ type: 'dedication', title: 'Dedication', content: 'For my mother, who kept the ledger.' }]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
