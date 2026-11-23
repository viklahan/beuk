// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, docx, figures, freshApi, importFile, setupImport, standInCanvas, wp, written, xml, type Api, type Got, type Rec, type Sec } from './import-given';

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." A line break the writer made inside a paragraph is
   the writer's, and every surface shows it (BEUK:breaksshown).

   The difficulty: the book's text has always held a newline inside a paragraph for lines that are NOT breaks the
   writer made (a paragraph typed on several lines in the editor, where one Enter is a new line of the same
   paragraph; a text file's paragraphs wrapped at a column; a Markdown paragraph typed on several lines, which
   Markdown itself reads as one flowing paragraph). A stored newline cannot say which it is, and a book already on a
   shelf must read as it did. So a break the writer made is MARKED, in Markdown's own spelling: a backslash straight
   before the newline. Only a marked newline is shown as a line break; a bare newline is the space it always was.

   Held here, on the book's stored text (every text made up for the test), for each surface:
   the typeset page (the preview), the EPUB's page, the standalone web page, the print interior, the Word export,
   the Markdown export, and the narration script (its text file and its Word file):
   - a marked break is a line break, and the backslash that marks it is not shown;
   - emphasis may run over a break; a centred paragraph keeps its breaks; the paragraph a chapter opens on (its
     drop cap and lead-in) keeps its breaks;
   - a quotation's lines are lines already: a marked line of one shows no backslash;
   - a backslash the writer typed stays: before the mark ("C:\" then a break) and at a block's end;
   - a paragraph typed on several lines with no mark (every book stored before this) is set exactly as it was: one
     flowing paragraph, with no line break added on any surface.

   BEUK_BREAKS_OUT names a folder to write each surface's markup into, for the report's measurements. */

const BS = String.fromCharCode(92);
const BR = BS + '\n';
const ADDRESS = ['She wrote the address on the packet:', '12 Salt Road', 'Harbour Town', 'HT1 2AB'];
const SOFT = ['Wrapped here', 'by the writer, a paragraph', 'typed on three lines.'];
const OPENING = 'Dawn came slowly' + BR + 'over the pans.';
const MARKED = [
  OPENING,
  ADDRESS.join(BR),
  SOFT.join('\n'),
  '*Slowly*' + BR + '*the tide* came in.',
  '*An italic passage' + BR + 'over a break* and on.',
  '> The tide keeps' + BR + '> its own count',
  '::: center\nThe Salt Road' + BR + 'A Chronicle\n:::',
  'The path was C:' + BS + BR + 'and the next line.',
  'The last block ends on a backslash ' + BS,
].join('\n\n');
/* the same book as every book stored it until now: the same lines, no mark */
const UNMARKED = MARKED.split(BR).join('\n').replace('C:' + BS + '\n', 'C:\n');

type File = { path: string; content: string };
type Line = { k: string; text: string };
type Surfaces = { preview: string; epub: string; standalone: string; print: string; word: string; markdown: string; narration: string; narrationWord: string };
let api: Api;

function surfaces(content: string, opts: Rec = {}): Surfaces {
  const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
  const ch = doc.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
  Object.assign(ch, { title: 'Dawn', content }, opts);
  Object.assign(doc.meta, { title: 'Lines', author: 'A. Writer', language: 'en' });
  api.applyBookDoc(doc);
  const sec = (api.snapshotBookDoc() as { sections: (Sec & Rec)[] }).sections.find((s) => s.id === ch.id)!;
  const body = (html: string) => html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
  const epub = (api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path) && String(f.content).indexOf('Salt Road') !== -1).map((f) => body(String(f.content))).join('\n');
  const plan = api.acxBuildPlan() as { files: { sectionId?: string; lines: Line[] }[] };
  const script = plan.files.find((f) => f.sectionId === ch.id)!;
  return {
    preview: String(api.contentBlocksToHtml(sec.content, sec, true, false)),
    epub,
    standalone: body(String(api.buildStandaloneHtml())),
    print: body(String(api.buildPrintHtml())),
    word: (api.buildDocxFiles() as File[]).find((f) => f.path === 'word/document.xml')!.content,
    markdown: String(api.buildMarkdown()),
    narration: String(api.acxFileTxt(script)),
    narrationWord: String(api.acxDocxXml(script.lines)),
  };
}
const PAGES = ['preview', 'epub', 'standalone', 'print'] as const;
const brs = (html: string) => (html.match(/<br\s*\/?>/g) || []).length;
/* a Word file's line breaks: w:br that is no page break */
const wbrs = (xml: string) => (xml.match(/<w:br\/>/g) || []).length;
const wt = (s: string, pr = '') => '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + s + '</w:t></w:r>';
const WBR = '<w:r><w:br/></w:r>';
const dump = (name: string, s: Surfaces) => {
  const out = process.env.BEUK_BREAKS_OUT;
  if (!out) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, name + '.json'), JSON.stringify({ ...s, counts: { preview: brs(s.preview), epub: brs(s.epub), standalone: brs(s.standalone), print: brs(s.print), word: wbrs(s.word), narrationWord: wbrs(s.narrationWord) } }, null, 1));
};

beforeAll(async () => {
  await setupImport('line-breaks-shown', ['epubFiles', 'buildDocxFiles', 'buildMarkdown', 'contentBlocksToHtml', 'buildStandaloneHtml', 'buildPrintHtml', 'acxBuildPlan', 'acxFileTxt', 'acxDocxXml']);
  standInCanvas();
  api = freshApi();
}, 180_000);

describe('a marked line break is shown as a line break on every surface', () => {
  let s: Surfaces;
  beforeAll(() => { s = surfaces(MARKED); dump('marked', s); });

  it.each(PAGES)('%s: each marked break is a <br/>, the mark itself is not shown, and a bare newline is still a space', (name) => {
    const html = s[name];
    expect(html, name).toContain('She wrote the address on the packet:<br/>12 Salt Road<br/>Harbour Town<br/>HT1 2AB</p>');
    expect(html, name).toContain('Wrapped here by the writer, a paragraph typed on three lines.</p>');
    expect(html, name).toContain('<em>Slowly</em><br/><em>the tide</em> came in.</p>');
    expect(html, name).toContain('<em>An italic passage<br/>over a break</em> and on.</p>');
    expect(html, name).toContain('The tide keeps<br/>its own count</blockquote>');
    expect(html, name).toContain('The Salt Road<br/>A Chronicle</p>');
    /* the chapter's opening paragraph */
    expect(html, name).toMatch(/<p class="first[^"]*">.*awn came slowly.*<br\/>over the pans\.<\/p>/);
    /* a backslash the writer typed stays; the one that marks the break does not show */
    expect(html, name).toContain('The path was C:' + BS + '<br/>and the next line.</p>');
    expect(html, name).toContain('The last block ends on a backslash ' + BS + '</p>');
    expect(html.split(BS).length - 1, name + ': the two backslashes the writer typed, and no other').toBe(2);
  });

  it('the Word export: a real line break inside the one paragraph, the runs\' italic kept on each side of it', () => {
    expect(s.word).toContain(wt('She wrote the address on the packet:') + WBR + wt('12 Salt Road') + WBR + wt('Harbour Town') + WBR + wt('HT1 2AB') + '</w:p>');
    expect(s.word).toContain(wt('Wrapped here by the writer, a paragraph typed on three lines.') + '</w:p>');
    expect(s.word).toContain(wt('Slowly', '<w:i/>') + WBR + wt('the tide', '<w:i/>') + wt(' came in.') + '</w:p>');
    expect(s.word).toContain(wt('An italic passage', '<w:i/>') + WBR + wt('over a break', '<w:i/>') + wt(' and on.') + '</w:p>');
    expect(s.word).toContain(wt('The tide keeps') + WBR + wt('its own count') + '</w:p>');
    expect(s.word).toContain(wt('The Salt Road') + WBR + wt('A Chronicle') + '</w:p>');
    expect(s.word).toContain(wt('Dawn came slowly') + WBR + wt('over the pans.') + '</w:p>');
    expect(s.word).toContain(wt('The path was C:' + BS) + WBR + wt('and the next line.') + '</w:p>');
    expect(s.word.split(BS).length - 1).toBe(2);
  });

  it('the Markdown export: the break in Markdown\'s own spelling (a backslash before the newline); a bare newline a space, as before', () => {
    expect(s.markdown).toContain(ADDRESS.join(BR) + '\n\n');
    expect(s.markdown).toContain(SOFT.join(' ') + '\n\n');
    expect(s.markdown).toContain('*Slowly*' + BR + '*the tide* came in.');
    expect(s.markdown).toContain('> The tide keeps' + BR + '> its own count');
    expect(s.markdown).toContain('The Salt Road' + BR + 'A Chronicle');
    expect(s.markdown).toContain('The path was C:' + BS + BR + 'and the next line.');
  });

  it('the narration script: the break is a new line of the paragraph in the text file and a line break in the Word file; no backslash is read out', () => {
    expect(s.narration).toContain(ADDRESS.join('\n') + '\n\n');
    expect(s.narration).toContain(SOFT.join(' ') + '\n\n');
    expect(s.narration).toContain('Slowly\nthe tide came in.');
    expect(s.narration.split(BS).length - 1).toBe(2);
    expect(s.narrationWord).toContain(wt('She wrote the address on the packet:') + WBR + wt('12 Salt Road') + WBR + wt('Harbour Town') + WBR + wt('HT1 2AB') + '</w:p>');
    expect(s.narrationWord).toContain(wt('Wrapped here by the writer, a paragraph typed on three lines.') + '</w:p>');
  });

  it('a chapter that opens on a drop cap and a small-capital lead-in keeps its opening paragraph\'s break', () => {
    const d = surfaces(MARKED, { dropCap: true, smallCaps: true });
    for (const name of PAGES) {
      expect(d[name], name).toMatch(/<p class="first has-dropcap">.*<br\/>over the pans\.<\/p>/);
      /* markup that nests: every tag the opening paragraph opens it closes, in order */
      const p = (d[name].match(/<p class="first has-dropcap">[\s\S]*?<\/p>/) || [''])[0];
      const open: string[] = [];
      for (const m of p.matchAll(/<(\/?)([a-z]+)\b[^>]*?(\/?)>/g)) { if (m[3]) continue; if (m[1]) expect(open.pop(), name + ': ' + p).toBe(m[2]); else open.push(m[2]!); }
      expect(open, name).toEqual([]);
    }
  });
});

describe('a break the writer made in a Word file is on the page, and survives export to Markdown and back', () => {
  const wr = (t: string) => '<w:r><w:t xml:space="preserve">' + xml(t) + '</w:t></w:r>';
  const WBREAK = '<w:r><w:br/></w:r>';
  const BODY = 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year.';
  const chapter1 = (g: Got) => blocksOf((written(g).find((x) => x.type === 'chapter' && String(x.content).indexOf('Salt Road') !== -1) || { content: '' }).content);
  let g: Got;
  beforeAll(async () => {
    g = await importFile('breaks.docx', await docx(wp('Chapter 1', true) + wp(BODY) + '<w:p>' + ADDRESS.map(wr).join(WBREAK) + '</w:p>'
      + '<w:p>' + wr('The path was C:' + BS) + WBREAK + wr('and the next line.') + '</w:p>' + wp('Chapter 2', true) + wp('The second chapter stands here so that the book has two.')), '');
  }, 120_000);

  it('the book stores each break marked; a backslash the writer typed before one stays, before the mark; the tally is clear', () => {
    expect(chapter1(g)).toEqual([BODY, ADDRESS.join(BR), 'The path was C:' + BS + BR + 'and the next line.']);
    expect(figures(g)).toEqual(CLEAR);
  });

  it('the EPUB\'s page of that book sets the breaks', () => {
    const page = (g.api.epubFiles('generic') as File[]).filter((f) => /\.xhtml$/.test(f.path) && String(f.content).indexOf('Salt Road') !== -1).map((f) => String(f.content)).join('');
    expect(page).toContain('She wrote the address on the packet:<br/>12 Salt Road<br/>Harbour Town<br/>HT1 2AB</p>');
    expect(page).toContain('The path was C:' + BS + '<br/>and the next line.</p>');
  });

  it('its Markdown export, imported again, gives the same paragraphs, and that import\'s tally counts the mark\'s backslash on neither side', async () => {
    const md = String(g.api.buildMarkdown());
    expect(md).toContain(ADDRESS.join(BR));
    const back = await importFile('breaks-back.md', null, md);
    expect(chapter1(back)).toEqual(chapter1(g));
    const f = figures(back);
    expect(f.counted).toBe(true);
    expect(f.fileOnly.concat(f.bookOnly).filter((x) => x[0] === BS), 'no backslash differs between the file and the book').toEqual([]);
  }, 120_000);
});

describe('a book stored before this (a paragraph typed on several lines, no mark) is set exactly as it was', () => {
  let s: Surfaces;
  beforeAll(() => { s = surfaces(UNMARKED); dump('unmarked', s); });

  it.each(PAGES)('%s: every paragraph flows; the only line breaks are the quotation\'s own, as before', (name) => {
    const html = s[name];
    expect(html, name).toContain('She wrote the address on the packet: 12 Salt Road Harbour Town HT1 2AB</p>');
    expect(html, name).toContain('Wrapped here by the writer, a paragraph typed on three lines.</p>');
    expect(html, name).toContain('<em>Slowly</em> <em>the tide</em> came in.</p>');
    expect(html, name).toContain('The Salt Road A Chronicle</p>');
    expect(html, name).toContain('The tide keeps<br/>its own count</blockquote>');
    expect(brs(html), name + ': one <br/>, the quotation\'s').toBe(1);
  });

  it('the Word export, the Markdown export and the narration script: no line break is added', () => {
    expect(s.word).toContain(wt('She wrote the address on the packet: 12 Salt Road Harbour Town HT1 2AB') + '</w:p>');
    expect(wbrs(s.word)).toBe(0);
    expect(s.markdown).toContain(ADDRESS.join(' ') + '\n\n');
    expect(s.markdown).toContain(SOFT.join(' ') + '\n\n');
    expect(s.narration).toContain(ADDRESS.join(' ') + '\n\n');
    expect(wbrs(s.narrationWord)).toBe(0);
  });
});
