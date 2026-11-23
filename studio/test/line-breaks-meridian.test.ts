// @vitest-environment node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { importFile, setupImport, standInCanvas, type Rec, type Sec } from './import-given';

/* BEUK:breaksshown on a real book: the Meridian Ledger stress book, one manuscript in seven formats. A line break
   the writer made is now shown as one, and a paragraph the file merely typed (or wrapped) on several lines must
   still read as it did. This holds, for each format, the whole stored book's line breaks and what each surface
   then sets for them:
   - in the stored book: the paragraphs that hold a newline, their newlines, and how many of those are MARKED as a
     break the writer made (a backslash straight before the newline);
   - on each surface: its line breaks (<br> on the typeset page, the EPUB's pages, the standalone web page and the
     print interior; w:br that is no page break in the Word export; a marked break in the Markdown export; a new
     line inside a paragraph of the narration script).
   The figures are pinned as measured, so a change that makes a wrapped paragraph break at its lines, or stops
   showing a break, fails here until the pin is changed on purpose.

   The book is the owner's untracked folder (tools/Testbooks): BEUK_TESTBOOKS names it, else the default below is
   tried; its two PDFs stand where BEUK_MERIDIAN_PDFS names. Where a file is not there its test is skipped and says so. BEUK_BREAKS_OUT names a folder to write each
   format's whole stored book and counts into (the owner's text: written only where asked, never committed). */

const DIR = process.env.BEUK_TESTBOOKS || path.join(import.meta.dirname, '..', '..', 'tools', 'Testbooks', 'The_Meridian_Ledger_TestSuite');
const PDFS = process.env.BEUK_MERIDIAN_PDFS || '';
const OUT = process.env.BEUK_BREAKS_OUT || '';
const BS = String.fromCharCode(92);
const FILES: [string, string, string][] = [['docx', DIR, 'The_Meridian_Ledger.docx'], ['odt', DIR, 'The_Meridian_Ledger.odt'], ['rtf', DIR, 'The_Meridian_Ledger.rtf'], ['html', DIR, 'The_Meridian_Ledger.html'],
  ['epub', DIR, 'The_Meridian_Ledger_Reference.epub'], ['md', DIR, 'The_Meridian_Ledger.md'], ['txt', DIR, 'The_Meridian_Ledger.txt'],
  /* a PDF's import is not changed by this; its two files are held so that it stays so */
  ['pdf-plain', PDFS, 'meridian-plain.pdf'], ['pdf-heads', PDFS, 'meridian-heads.pdf']];
const here = (dir: string, f: string) => !!dir && existsSync(path.join(dir, f));
const present = FILES.some(([, dir, f]) => here(dir, f));

/* the narration script holds a line break the writer made as this one character until its file is written */
const HELD = String.fromCharCode(0xe070);
type Counts = { stored: { paragraphsOfSeveralLines: number; newlines: number; marked: number; markedInQuotations: number }; preview: number; epub: number; standalone: number; print: number; word: number; markdown: number; narration: number };
/* As measured on 2026-11-22. Before BEUK:breaksshown every figure of "marked", "word", "markdown" and "narration" was 0,
   and the text file's page figures were 0; nothing else moved, and no block of any format's stored book changed but
   by a mark (compared whole, block by block, before and after):
   - Word, OpenDocument, RTF, the web page and the two PDFs hold no line break inside a paragraph: nothing to show.
   - The EPUB's 12 page breaks are its 12 quotations of two paragraphs each (two lines of the quotation, as before).
   - Markdown: the file's 12 hard breaks (two spaces before the newline, each in a quotation's sign-off) are now
     marked. The page already set every line of a quotation on its own line (144, unchanged); the Word export and
     the narration script, which run a quotation's lines on, now break at those 12. Its 30 paragraphs typed on
     several lines (102 newlines) hold no mark and are set as running text, as before.
   - Text: the file is wrapped at 78 columns. 4,360 of its paragraphs' 4,545 line ends are lines the width broke or
     the file does not show, left bare and set as running text as before; 185, in 107 paragraphs, stop short of
     the width and are lines the writer ended, now kept: 67 rules of typed tables, 48 "FROM:"/"TO:" lines of
     telegrams, 18 numbered headings over their typed underline, 12 letters' sign-offs, 12 ends of a letter's
     first paragraph, 12 epigraphs' last lines before their attribution, 8 of the 12 letters' datelines (the other
     four reach the letter's own narrower width), and 8 other lines (a title's, and ends of specimen notes).
     Each was read from the listing of all 185. A typed table's rows that reach the width are read as broken by
     it, so such a table is set with its rules on lines of their own and its rows run on: it was one run of text
     before, and is no table either way (a text file's typed table is not read as a table). */
const ZERO = { paragraphsOfSeveralLines: 0, newlines: 0, marked: 0, markedInQuotations: 0 };
const NONE: Counts = { stored: ZERO, preview: 0, epub: 0, standalone: 0, print: 0, word: 0, markdown: 0, narration: 0 };
const PINNED: Record<string, Counts> = {
  docx: NONE, odt: NONE, rtf: NONE, html: NONE, 'pdf-plain': NONE, 'pdf-heads': NONE,
  epub: { stored: ZERO, preview: 12, epub: 12, standalone: 12, print: 12, word: 0, markdown: 0, narration: 0 },
  md: { stored: { paragraphsOfSeveralLines: 30, newlines: 102, marked: 0, markedInQuotations: 12 }, preview: 144, epub: 144, standalone: 144, print: 144, word: 12, markdown: 12, narration: 12 },
  txt: { stored: { paragraphsOfSeveralLines: 594, newlines: 4545, marked: 185, markedInQuotations: 0 }, preview: 185, epub: 185, standalone: 185, print: 185, word: 185, markdown: 185, narration: 185 },
};

type File = { path: string; content: string };
const brs = (html: string) => (html.match(/<br\s*\/?>/g) || []).length;
/* a list's first line, by the marks the book's list reads: since the lists kept the writer's own bullets (◆ ◇ ❧ ▸ in this book), a list opens on more than "-", "*" and "•" */
const LIST = /^(?:[-*+•‣⁃■-➿]\s+|\d{1,3}[.)]\s+)/;
/* the blocks of a section's text the book reads as paragraphs (outside every fence but a centred or right-set one) */
function paragraphs(content: string): string[] {
  const out: string[] = [];
  let keep = true;
  const cur: string[] = [];
  const flush = () => { cur.join('\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).forEach((b) => {
    const lines = b.split('\n');
    if (/^(\*\*\*|❦|⁂)$/.test(b) || /^\[\^?\d{1,3}\]:/.test(b) || lines.some((l) => /^!\[[^\]]*\]\(img:/.test(l.trim())) || LIST.test(lines[0]!) || lines.every((l) => l.startsWith('>')) || /^##? /.test(b)) return;
    out.push(b);
  }); cur.length = 0; };
  for (const l of String(content || '').split('\n')) {
    const om = /^[ \t]*:::[ \t]+([A-Za-z][A-Za-z0-9-]*)/.exec(l);
    if (om) { if (keep) flush(); cur.length = 0; keep = /^(center|centre|right)$/i.test(om[1]!); continue; }
    if (/^[ \t]*:::[ \t]*$/.test(l)) { if (keep) flush(); cur.length = 0; keep = true; continue; }
    cur.push(l);
  }
  if (keep) flush();
  return out;
}

describe.skipIf(!present)('the Meridian stress book: its line breaks in the stored book and on every surface, per format' + (present ? '' : ' — SKIPPED: the book is not in this checkout (set BEUK_TESTBOOKS)'), () => {
  beforeAll(async () => {
    await setupImport('line-breaks-meridian', ['epubFiles', 'buildDocxFiles', 'buildMarkdown', 'contentBlocksToHtml', 'buildStandaloneHtml', 'buildPrintHtml', 'acxBuildPlan']);
    standInCanvas();
  }, 180_000);

  for (const [kind, dir, file] of FILES) {
    const there = here(dir, file);
    it.skipIf(!there)(kind + ': the stored book\'s line breaks and each surface\'s are the pinned figures' + (there ? '' : ' — SKIPPED: ' + file + ' is not here'), async () => {
      const bytes = readFileSync(path.join(dir, file));
      const g = await importFile(file, new Uint8Array(bytes), new TextDecoder('utf-8').decode(bytes));
      const secs = g.secs as (Sec & Rec)[];
      const paras = secs.flatMap((s) => paragraphs(s.content));
      const several = paras.filter((p) => p.indexOf('\n') !== -1);
      const quotes = secs.flatMap((s) => String(s.content || '').split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b && b.split('\n').every((l) => l.startsWith('>'))));
      const stored = { paragraphsOfSeveralLines: several.length, newlines: several.reduce((a, p) => a + p.split('\n').length - 1, 0), marked: several.reduce((a, p) => a + p.split(BS + '\n').length - 1, 0),
        markedInQuotations: quotes.reduce((a, q) => a + q.split(BS + '\n').length - 1, 0) };
      const body = (html: string) => html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
      const word = (g.api.buildDocxFiles() as File[]).find((f) => f.path === 'word/document.xml')!.content;
      const md = String(g.api.buildMarkdown());
      const plan = g.api.acxBuildPlan() as { files: { lines: { k: string; text: string }[] }[] };
      const preview = secs.map((s) => String(g.api.contentBlocksToHtml(s.content, s, s.kind === 'body', false)));
      const got: Counts = {
        stored,
        preview: preview.reduce((a, h) => a + brs(h), 0),
        epub: (g.api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path)).reduce((a, f) => a + brs(body(String(f.content))), 0),
        standalone: brs(body(String(g.api.buildStandaloneHtml()))),
        print: brs(body(String(g.api.buildPrintHtml()))),
        word: (word.match(/<w:br\/>/g) || []).length,
        markdown: md.split(BS + '\n').length - 1,
        narration: plan.files.reduce((a, f) => a + f.lines.filter((l) => l.k === 'para' || l.k === 'quote').reduce((b, l) => b + String(l.text).split(HELD).length - 1, 0), 0),
      };
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(path.join(OUT, kind + '.book.json'), JSON.stringify({ sections: secs.map((s) => ({ type: s.type, kind: s.kind, number: s.number, title: s.title, subtitle: s.subtitle, content: s.content })),
          tally: { file: g.tally.file, book: g.tally.book, aside: g.tally.aside, unaccounted: g.tally.unaccounted, rows: g.tally.rows }, report: g.rep.items.map((it) => ({ kind: it.kind, data: it.data, where: it.where && it.where.label })) }, null, 1));
        writeFileSync(path.join(OUT, kind + '.counts.json'), JSON.stringify(got, null, 1));
        writeFileSync(path.join(OUT, kind + '.preview.html'), preview.join('\n<!-- section -->\n'));
      }
      expect(got, kind).toEqual(PINNED[kind]);
    }, 600_000);
  }
});
