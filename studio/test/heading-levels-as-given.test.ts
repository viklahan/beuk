// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, W_NS, blocksOf, docx, epub, figures, freshApi, importFile, odt, page, pdf, pdfPara, rtfDoc, rtfEsc, rw, setupImport, standInCanvas, written, xml, type Api, type Got, type Rec, type Sec } from './import-given';

/* A heading the writer made stays a heading, at its own depth (BEUK:headdepths; the owner's rule, 2026-11-22: "KEEP
   WHAT THE WRITER GIVES US").

   Measured before, on the made-up book below (two chapters; the first holds headings at three depths under the
   chapter, with text under each) in every format the import reads:
   - Markdown, text, Word, OpenDocument, RTF and a web page: the first depth was kept ("# The quay") and the two under
     it came in as paragraphs nothing told from the text round them. The report listed each ("Heading 3 became body
     text"), and the tally said "Headings: 7 in the file, 5 in the book, 2 in the book as paragraphs".
   - an EPUB kept all three as headings, the second and the third depth both as "## ".
   - a PDF marks no levels; its reader finds headings by their type size and hands every one it finds on at one
     depth, none to the report. That is its own rule and is not changed here (its figures are the same before and
     after, measured on six made-up books).

   Now: every level below a file's chapters comes in as a heading inside the chapter, at the depth the writer gave it
   relative to the others (the file's levels by rank, as irHeadDepths ranks them: a file of Heading 1, 3, 5 and 6
   holds the same book as one of Heading 1, 2, 3 and 4). The stored text holds a heading inside a section as a block
   that opens on one "#" for each depth and a space: "# " and "## ", as it always did, and "### ", "#### " and
   "##### " for the third to the fifth depth. Five is as deep as a page goes (h2 to h6 under the section's own h1), so
   one case is left where a heading cannot be kept: the sixth depth, in a file with seven levels of heading in use.
   That one is still set as a paragraph, still reported, and its button sets it as the deepest heading a section holds.

   Every surface sets each as a heading of its depth: the typeset page, the EPUB's page, the web page and the print
   interior (h2 to h6), the Word export (Heading 2 to Heading 6) and the Markdown export ("###" to "######": Markdown
   has six levels and the book's title and the section's heading take two, so the fifth depth is written at the sixth
   level beside the fourth). The narration script reads a heading's words, as it did; the contents list and the EPUB's
   navigation list sections, never a heading inside one, as they did.

   A book stored before this reads as it did: "# " and "## " are the same h2 and h3, and its stylesheet is byte for
   byte what it was (the three rules for h4 to h6 are written only for a book that holds one).

   Every text here is made up. */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '.';
type Line = [number, string];
const NAMES = ['The quay', 'The east berth', 'The third bollard', 'The iron ring', 'The rust', 'The flake'];
/* `lv`: the file's level for the chapters, then for each depth under them. Level 0 is a paragraph. */
const book = (lv: number[]): Line[] => {
  const out: Line[] = [[lv[0]!, 'Chapter 1'], [0, P(1)]];
  lv.slice(1).forEach((l, k) => { out.push([l, NAMES[k]!], [0, P(2 + k)]); });
  out.push([lv[1]!, 'The pans'], [0, P(20)], [lv[0]!, 'Chapter 2'], [0, P(21)], [lv[1]!, 'The ledger'], [0, P(22)]);
  return out;
};
/* the first chapter as the book must store it: each heading under as many "#" as its depth */
const stored = (depths: number) => [P(1)].concat(...NAMES.slice(0, depths).map((n, k) => ['#'.repeat(k + 1) + ' ' + n, P(2 + k)]), ['# The pans', P(20)]);

const STYLES = '<?xml version="1.0" encoding="UTF-8"?><w:styles ' + W_NS + '>' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:pPr><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr></w:style>').join('') + '</w:styles>';
const wpar = (l: Line) => '<w:p>' + (l[0] ? '<w:pPr><w:pStyle w:val="Heading' + l[0] + '"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(l[1]) + '</w:t></w:r></w:p>';
const opar = (l: Line) => (l[0] ? '<text:h text:outline-level="' + l[0] + '">' + xml(l[1]) + '</text:h>' : '<text:p>' + xml(l[1]) + '</text:p>');
const hpar = (l: Line) => (l[0] ? '<h' + l[0] + '>' + xml(l[1]) + '</h' + l[0] + '>' : '<p>' + xml(l[1]) + '</p>');
const mpar = (l: Line) => (l[0] ? '#'.repeat(l[0]) + ' ' + l[1] : l[1]);
const rpar = (l: Line) => rw('pard') + rw('s' + l[0]) + ' ' + rtfEsc(l[1]) + rw('par') + '\n';
const rtfOf = (ls: Line[]) => rtfDoc(ls.map(rpar).join('')).replace('{' + rw('s1') + rw('outlinelevel0') + ' heading 1;}', [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '{' + rw('s' + n) + rw('outlinelevel' + (n - 1)) + ' heading ' + n + ';}').join(''));

type Kind = 'md' | 'txt' | 'docx' | 'odt' | 'rtf' | 'html' | 'epub';
const KINDS: Kind[] = ['md', 'txt', 'docx', 'odt', 'rtf', 'html', 'epub'];
async function read(kind: Kind, ls: Line[]): Promise<Got> {
  const cut = ls.findIndex((l) => l[1] === 'Chapter 2');
  switch (kind) {
    case 'md': return importFile('given.md', null, ls.map(mpar).join('\n\n') + '\n');
    case 'txt': return importFile('given.txt', null, ls.map(mpar).join('\n\n') + '\n');
    case 'docx': return importFile('given.docx', await docx(ls.map(wpar).join(''), { 'word/styles.xml': STYLES }), '');
    case 'odt': return importFile('given.odt', await odt(ls.map(opar).join('')), '');
    case 'rtf': return importFile('given.rtf', null, rtfOf(ls));
    case 'html': return importFile('given.html', null, page(ls.map(hpar).join('')));
    case 'epub': return importFile('given.epub', await epub([{ title: 'One', body: ls.slice(0, cut).map(hpar).join('') }, { title: 'Two', body: ls.slice(cut).map(hpar).join('') }]), '');
  }
}
const chapters = (g: Got) => written(g).filter((s) => s.kind === 'body' && s.type === 'chapter');
const one = (g: Got) => blocksOf(chapters(g)[0]!.content);
const demoted = (g: Got) => g.rep.items.filter((i) => i.kind === 'demoted');
type Row = { key: string; file: number; book: number; why?: { k: string; row?: string; n: number; side: number }[] };
const row = (g: Got, key: string) => (g.tally.rows as Row[]).find((r) => r.key === key);
const levels = (g: Got) => (g.tally as unknown as { levels?: { file: Record<string, number>; book: Record<string, number> } }).levels;

beforeAll(async () => {
  await setupImport('heading-levels-as-given', ['epubFiles', 'buildDocxFiles', 'buildMarkdown', 'contentBlocksToHtml', 'buildStandaloneHtml', 'buildPrintHtml', 'buildBookCss', 'acxBuildPlan', 'acxFileTxt', 'tocTree', 'sectionLabel', 'irHeadDepths', 'irUndoItem']);
  standInCanvas();
}, 180_000);

describe('the rule every reader asks: a heading\'s depth is how far below the heading that opened its section it stands, by rank', () => {
  const depths = (api: Api, hs: [number, string][]) => (api.irHeadDepths(hs.map(([level, text]) => ({ level, text }))) as { rank: number; sub: boolean; depth: number }[]).map((d) => d.depth);
  let api: Api;
  beforeAll(() => { api = freshApi(); });

  it('Heading 1 chapters: the levels under them are depths 1, 2, 3; a level left out is no level', () => {
    const b = (lv: number[]) => book(lv).filter((l) => l[0]).map((l) => [l[0], l[1]] as [number, string]);
    expect(depths(api, b([1, 2, 3, 4]))).toEqual([0, 1, 2, 3, 1, 0, 1]);
    expect(depths(api, b([1, 3, 5, 6]))).toEqual([0, 1, 2, 3, 1, 0, 1]);
  });
  it('a title in Heading 1 over Heading 2 chapters: the chapters open sections, and the levels under them are depths 1, 2, 3', () => {
    const hs: [number, string][] = [[1, 'The Salt Ledger'], [2, 'Chapter 1'], [3, 'The quay'], [4, 'The east berth'], [5, 'The third bollard'], [3, 'The pans'], [2, 'Chapter 2'], [3, 'The ledger']];
    expect(depths(api, hs)).toEqual([0, 0, 1, 2, 3, 1, 0, 1]);
  });
  it('a third-level heading straight under a first-level chapter, with no second-level heading between, is still two depths down: its depth is the file\'s, not the chapter\'s', () => {
    const hs: [number, string][] = [[1, 'Chapter 1'], [2, 'The quay'], [3, 'The east berth'], [1, 'Chapter 2'], [3, 'The slip'], [1, 'Chapter 3'], [2, 'The ledger']];
    expect(depths(api, hs)).toEqual([0, 1, 2, 0, 2, 0, 1]);
  });
  it('headings standing before any heading that opens a section are counted from the shallowest of them', () => {
    const hs: [number, string][] = [[3, 'A note'], [4, 'Its source'], [1, 'Chapter 1'], [2, 'The quay'], [1, 'Chapter 2'], [2, 'The pans']];
    expect(depths(api, hs)).toEqual([1, 2, 0, 1, 0, 1]);
  });
  it('a heading with no words is given no depth (it is handled as it was)', () => {
    expect(depths(api, [[1, 'Chapter 1'], [3, ''], [2, 'The quay'], [1, 'Chapter 2'], [2, 'The pans']])).toEqual([0, 0, 1, 0, 1]);
  });
});

describe('a file\'s headings below its chapters each come in as a heading, at their depth', () => {
  it.each(KINDS)('%s: Heading 1 chapters with three levels under them: "# ", "## ", "### "; nothing reported; the Headings row agrees', async (kind) => {
    const g = await read(kind, book([1, 2, 3, 4]));
    expect(chapters(g).map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(one(g)).toEqual(stored(3));
    expect(blocksOf(chapters(g)[1]!.content)).toEqual([P(21), '# The ledger', P(22)]);
    expect(demoted(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    /* a text file has no heading of its own to count: its "#" lines are its paragraphs, and the row says where each went */
    if (kind === 'txt') expect(row(g, 'paragraphs')).toEqual({ key: 'paragraphs', file: 14, book: 7, why: [{ k: 'book', row: 'headings', n: 7, side: 1 }] });
    else {
      expect(row(g, 'headings')).toEqual({ key: 'headings', file: 7, book: 7, why: [] });
      expect(row(g, 'paragraphs')).toEqual({ key: 'paragraphs', file: 7, book: 7, why: [] });
      /* the book's side counts each depth */
      expect(levels(g)!.book).toEqual({ sub: 3, sub2: 1, sub3: 1, chapters: 2, pages: 0 });
    }
  }, 120_000);

  it.each(KINDS)('%s: the same book with levels left out (Heading 1, 3, 5, 6) is the same book: three depths, not five', async (kind) => {
    const g = await read(kind, book([1, 3, 5, 6]));
    expect(one(g)).toEqual(stored(3));
    expect(demoted(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it.each(KINDS)('%s: a title in the first level over second-level chapters: the three levels under a chapter are its three depths', async (kind) => {
    const g = await read(kind, ([[1, 'The Salt Ledger']] as Line[]).concat(book([2, 3, 4, 5])));
    expect(chapters(g).map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(one(g)).toEqual(stored(3));
    expect(demoted(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it.each(KINDS)('%s: five levels under a chapter, the most a file of six levels can hold, are five depths: "# " to "##### "', async (kind) => {
    const g = await read(kind, book([1, 2, 3, 4, 5, 6]));
    expect(one(g)).toEqual(stored(5));
    expect(demoted(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    if (kind !== 'txt') {
      expect(row(g, 'headings')).toEqual({ key: 'headings', file: 9, book: 9, why: [] });
      expect(levels(g)!.book).toEqual({ sub: 3, sub2: 1, sub3: 1, sub4: 1, sub5: 1, chapters: 2, pages: 0 });
    }
  }, 120_000);

  it('a Word heading below a sub-heading keeps the italic it had as a paragraph', async () => {
    const it4 = '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t xml:space="preserve">The </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">east</w:t></w:r><w:r><w:t xml:space="preserve"> berth</w:t></w:r></w:p>';
    const ls = book([1, 2, 3, 4]);
    const g = await importFile('given.docx', await docx(ls.map((l) => (l[1] === 'The east berth' ? it4 : wpar(l))).join(''), { 'word/styles.xml': STYLES }), '');
    expect(one(g)[3]).toBe('## The *east* berth');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

/* A page has six levels of heading; RTF and Word name nine and OpenDocument ten. Measured before on a made-up book of
   Heading 1 chapters with Heading 7 and Heading 9 under them: RTF read the three levels; a Word paragraph in Heading
   7, 8 or 9 was no heading at all (the converter knows six: each came in as a paragraph, with no item in the report,
   and the tally said "Headings: 6 in the file, 2 in the book, 4 in the book as paragraphs"); an OpenDocument heading
   at level 7 or deeper was read as level 6, so its Heading 7 and Heading 9 came in at one depth. */
describe('a level past the sixth is a level of the file like any other: Word\'s Heading 7 to 9, OpenDocument\'s 7 to 10', () => {
  it.each(['docx', 'odt', 'rtf'] as const)('%s: Heading 1 chapters with Heading 7 and Heading 9 under them hold three levels: "# " and "## "', async (kind) => {
    const g = await read(kind, book([1, 7, 9]));
    expect(chapters(g).map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(one(g)).toEqual(stored(2));
    expect(blocksOf(chapters(g)[1]!.content)).toEqual([P(21), '# The ledger', P(22)]);
    expect(demoted(g)).toEqual([]);
    expect(row(g, 'headings')).toEqual({ key: 'headings', file: 6, book: 6, why: [] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
  it('OpenDocument: a heading at level 10 is read at its level too', async () => {
    const g = await read('odt', book([1, 8, 10]));
    expect(one(g)).toEqual(stored(2));
    expect(demoted(g)).toEqual([]);
  }, 120_000);
  it('a Word file whose chapters are in Heading 7 (nothing above it) is a book of chapters', async () => {
    const g = await read('docx', book([7, 8, 9]));
    expect(chapters(g).map((s) => s.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(one(g)).toEqual(stored(2));
    expect(g.rep.items.filter((i) => i.kind === 'mammoth'), 'the converter names no style it does not know').toEqual([]);
  }, 120_000);
});

describe('the one heading that cannot be kept: the sixth depth, in a file with seven levels of heading in use', () => {
  /* Chapters in Heading 1 and a heading at each of Heading 2 to Heading 7 under the first: the Heading 7 is six
     depths down, and a section holds five. It is set as a paragraph, reported exactly as before, and the Headings
     row's two totals differ by that one and say why. (Markdown, a web page and an EPUB have six levels: the case
     cannot arise in them.) */
  it.each(['rtf', 'docx', 'odt'] as const)('%s, Heading 1 to Heading 7: five depths kept, the sixth reported as body text; the Headings row says the one and no more; its button sets it as the deepest heading', async (kind) => {
    const g = await read(kind, book([1, 2, 3, 4, 5, 6, 7]));
    expect(one(g)).toEqual(stored(5).slice(0, 11).concat(['The flake', P(7), '# The pans', P(20)]));
    const dem = demoted(g);
    expect(dem.map((i) => [i.before, (i.data as Rec).level, (i as unknown as Rec).reversible])).toEqual([['The flake', 7, true]]);
    expect(row(g, 'headings')).toEqual({ key: 'headings', file: 10, book: 9, why: [{ k: 'book', row: 'paragraphs', n: 1, side: 1 }] });
    expect(row(g, 'paragraphs')).toEqual({ key: 'paragraphs', file: 10, book: 11, why: [{ k: 'file', row: 'headings', n: 1, side: -1 }] });
    expect(levels(g)!.book).toEqual({ sub: 3, sub2: 1, sub3: 1, sub4: 1, sub5: 1, chapters: 2, pages: 0 });
    expect(figures(g)).toEqual(CLEAR);
    /* the report's own button */
    const done = g.api.irUndoItem((dem[0] as unknown as { id: string }).id) as { ok: boolean };
    expect(done.ok).toBe(true);
    const after = (g.api.snapshotBookDoc() as { sections: Sec[] }).sections.find((s) => /The flake/.test(s.content))!;
    expect(blocksOf(after.content)).toContain('##### The flake');
  }, 120_000);
});

type File = { path: string; content: string };
const body = (html: string) => html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
const heads = (html: string) => (html.match(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g) || []).map((x) => x.replace(/\s+/g, ' '));
const inheads = (html: string) => heads(html).filter((h) => /class="inhead"/.test(h));
type Shown = { preview: string[]; epub: string[]; standalone: string[]; print: string[]; word: string[]; wordStyles: string; markdown: string[]; narration: string[]; narrationKinds: string[]; nav: string; ncx: string; toc: string[]; css: string; printCss: string };
/** a book of one chapter holding `content`, on every surface */
function shown(api: Api, content: string): Shown {
  const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
  const ch = doc.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
  Object.assign(ch, { title: 'Dawn', content });
  Object.assign(doc.meta, { title: 'Depths', author: 'A. Writer', language: 'en' });
  api.applyBookDoc(doc);
  const sec = (api.snapshotBookDoc() as { sections: (Sec & Rec)[] }).sections.find((s) => s.id === ch.id)!;
  const ef = api.epubFiles('generic') as File[];
  const plan = api.acxBuildPlan() as { files: { sectionId?: string; lines: { k: string; text: string }[] }[] };
  const script = plan.files.find((f) => f.sectionId === ch.id)!;
  const dx = api.buildDocxFiles() as File[];
  const print = String(api.buildPrintHtml());
  return {
    preview: inheads(String(api.contentBlocksToHtml(sec.content, sec, true, false))),
    epub: inheads(ef.filter((f) => /\.xhtml$/.test(f.path) && !/nav\.xhtml$/.test(f.path)).map((f) => body(String(f.content))).join('\n')),
    standalone: inheads(body(String(api.buildStandaloneHtml()))),
    print: inheads(body(print)),
    word: (dx.find((f) => f.path === 'word/document.xml')!.content.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*?<w:pStyle w:val="Heading[2-9]"\/>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g) || []).map((p) => (/Heading\d/.exec(p) || [''])[0] + ': ' + p.replace(/<[^>]+>/g, '')),
    wordStyles: dx.find((f) => f.path === 'word/styles.xml')!.content,
    markdown: String(api.buildMarkdown()).split('\n').filter((l) => /^#{3,} /.test(l)),
    narration: String(api.acxFileTxt(script)).split('\n').map((l) => l.trim()).filter(Boolean),
    narrationKinds: script.lines.map((l) => l.k + ': ' + l.text),
    nav: String(ef.find((f) => /nav\.xhtml$/.test(f.path))!.content),
    ncx: String((ef.find((f) => /\.ncx$/.test(f.path)) || { content: '' }).content),
    toc: (api.tocTree() as { s: Rec; children: { s: Rec }[] }[]).map((e) => String(api.sectionLabel(e.s)) + (e.children.length ? ' [' + e.children.map((c) => api.sectionLabel(c.s)).join(', ') + ']' : '')),
    css: String(ef.find((f) => /blitz\.css$/.test(f.path))!.content),
    printCss: print.replace(/<body[\s\S]*$/, ''),
  };
}
const FIVE = ['Opening words of the chapter.', '# The quay', 'Under the quay.', '## The east berth', 'Under the berth.', '### The third bollard', 'Under the bollard.', '#### The iron ring', 'Under the ring.', '##### The rust', 'Under the rust.', '# The pans', 'Under the pans.'].join('\n\n');
const TWO = ['Opening words of the chapter.', '# The quay', 'Under the quay.', '## The east berth', 'Under the berth.', '# The pans', 'Under the pans.'].join('\n\n');
const H = (n: number, s: string) => '<h' + n + ' class="inhead">' + s + '</h' + n + '>';

describe('every surface sets a heading inside a section as a heading of its depth', () => {
  let s: Shown;
  beforeAll(() => { s = shown(freshApi(), FIVE); });

  it.each(['preview', 'epub', 'standalone', 'print'] as const)('%s: h2 to h6, one for each depth', (name) => {
    expect(s[name]).toEqual([H(2, 'The quay'), H(3, 'The east berth'), H(4, 'The third bollard'), H(5, 'The iron ring'), H(6, 'The rust'), H(2, 'The pans')]);
  });
  it('the Word export: Word\'s own Heading 2 to Heading 6, each a style the file defines at its outline level', () => {
    expect(s.word).toEqual(['Heading2: The quay', 'Heading3: The east berth', 'Heading4: The third bollard', 'Heading5: The iron ring', 'Heading6: The rust', 'Heading2: The pans']);
    for (const n of [2, 3, 4, 5, 6]) expect(s.wordStyles, 'Heading ' + n).toMatch(new RegExp('<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/>(?:(?!</w:style>)[\\s\\S])*<w:outlineLvl w:val="' + (n - 1) + '"/>'));
  });
  it('the Markdown export: two levels under its own depth, below the book\'s "#" and the section\'s "##"; the fifth depth at Markdown\'s sixth and last level', () => {
    expect(s.markdown).toEqual(['### The quay', '#### The east berth', '##### The third bollard', '###### The iron ring', '###### The rust', '### The pans']);
  });
  it('the narration script: each heading\'s words are read, in their place, and no "#" is', () => {
    const at = (w: string) => s.narration.indexOf(w);
    for (const [h, under] of [['The quay', 'Under the quay.'], ['The east berth', 'Under the berth.'], ['The third bollard', 'Under the bollard.'], ['The iron ring', 'Under the ring.'], ['The rust', 'Under the rust.'], ['The pans', 'Under the pans.']]) {
      expect(at(h!), h).toBeGreaterThan(-1);
      expect(at(under!), under).toBe(at(h!) + 1);
    }
    expect(s.narration.join('\n')).not.toContain('#');
    expect(s.narrationKinds).toContain('para: The third bollard');
  });
  it('the contents list and the EPUB\'s navigation list the section, and no heading inside it: what they listed before', () => {
    for (const h of ['The quay', 'The east berth', 'The third bollard', 'The iron ring', 'The rust', 'The pans']) {
      expect(s.nav, 'nav: ' + h).not.toContain(h);
      expect(s.ncx, 'ncx: ' + h).not.toContain(h);
      expect(s.toc.join(' | '), 'contents: ' + h).not.toContain(h);
    }
    expect(s.nav).toContain('Dawn');
    expect(s.toc.join(' | ')).toContain('Dawn');
  });
  it('the stylesheet: h4 to h6 at the text\'s size, told apart by their cut; the print interior keeps each with what follows it', () => {
    expect(s.css).toContain('h4.inhead, h5.inhead, h6.inhead { font-size: 1em; }\nh5.inhead, h6.inhead { font-style: italic; }\nh6.inhead { font-weight: 400; }');
    expect(s.printCss).toContain('h2.inhead, h3.inhead, h4.inhead, h5.inhead, h6.inhead, .chapter-opening, .endnotes-h { page-break-after: avoid;');
  });
});

describe('a book stored before this reads as it did', () => {
  it('"# " and "## " are the h2 and the h3 they were on every page, Heading 2 and Heading 3 in Word, "###" and "####" in Markdown; and the stylesheet has no rule it did not have', () => {
    const api = freshApi();
    const s = shown(api, TWO);
    const want = [H(2, 'The quay'), H(3, 'The east berth'), H(2, 'The pans')];
    for (const name of ['preview', 'epub', 'standalone', 'print'] as const) expect(s[name], name).toEqual(want);
    expect(s.word).toEqual(['Heading2: The quay', 'Heading3: The east berth', 'Heading2: The pans']);
    expect(s.markdown).toEqual(['### The quay', '#### The east berth', '### The pans']);
    expect(s.css).not.toMatch(/h[456]\.inhead/);
    /* the studio's own page (a scope) always carries the three rules: its stylesheet is not written again when the text changes */
    expect(String(api.buildBookCss('.fc-page'))).toContain('.fc-page h4.inhead, .fc-page h5.inhead, .fc-page h6.inhead { font-size: 1em; }');
  });
  it('six "#" and a space is no heading: it is the paragraph it was, on the page and in Word', () => {
    const s = shown(freshApi(), ['Opening words.', '###### Six marks', 'Closing words.'].join('\n\n'));
    for (const name of ['preview', 'epub', 'standalone', 'print'] as const) expect(s[name], name).toEqual([]);
    expect(s.word).toEqual([]);
  });
});

describe('Beuk\'s own files read back: export, import again, the same book', () => {
  const FOUR = FIVE.replace('\n\n##### The rust\n\nUnder the rust.', '');
  function exported(content: string): { api: Api; md: string; docxFiles: File[]; epubFiles: File[] } {
    const api = freshApi();
    const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
    const chs = doc.sections.filter((s) => s.kind === 'body' && s.type === 'chapter');
    Object.assign(chs[0]!, { number: '1', title: 'Dawn', content });
    /* a second chapter that holds a heading of its own, so that the file's chapters are plainly its chapters */
    doc.sections.splice(doc.sections.indexOf(chs[0]!) + 1, 0, { ...chs[0]!, id: 'sec-two', number: '2', title: 'Noon', content: 'Opening words of the second.\n\n# The ledger\n\nUnder the ledger.' });
    Object.assign(doc.meta, { title: 'Depths', author: 'A. Writer', language: 'en' });
    api.applyBookDoc(doc);
    return { api, md: String(api.buildMarkdown()), docxFiles: api.buildDocxFiles() as File[], epubFiles: api.epubFiles('generic') as File[] };
  }
  const zipOf = async (files: File[]) => {
    const z = new ((globalThis as Rec).JSZip as new () => { file: (p: string, s: unknown, o?: Rec) => void; generateAsync: (o: Rec) => Promise<Uint8Array> })();
    for (const f of files) z.file(f.path, f.content as unknown, f.path === 'mimetype' ? { compression: 'STORE' } : (f as unknown as Rec).base64 ? { base64: true } : undefined);
    return z.generateAsync({ type: 'uint8array' });
  };
  const dawn = (g: Got) => blocksOf(chapters(g).find((s) => s.title === 'Dawn')!.content);

  it('Markdown: a book of four depths comes back with its four depths', async () => {
    const g = await importFile('depths.md', null, exported(FOUR).md);
    expect(dawn(g)).toEqual(blocksOf(FOUR));
    expect(demoted(g)).toEqual([]);
  }, 120_000);
  it('Markdown: the fifth depth has no level of its own in Markdown, and comes back beside the fourth: still a heading', async () => {
    const g = await importFile('depths.md', null, exported(FIVE).md);
    expect(dawn(g)).toEqual(blocksOf(FIVE.replace('##### The rust', '#### The rust')));
    expect(demoted(g)).toEqual([]);
  }, 120_000);
  it('Word: a book of five depths comes back with its five depths', async () => {
    const g = await importFile('depths.docx', await zipOf(exported(FIVE).docxFiles), '');
    expect(dawn(g)).toEqual(blocksOf(FIVE));
    expect(demoted(g)).toEqual([]);
  }, 120_000);
  it('EPUB: a book of five depths comes back with its five depths', async () => {
    const g = await importFile('depths.epub', await zipOf(exported(FIVE).epubFiles), '');
    expect(dawn(g)).toEqual(blocksOf(FIVE));
    expect(demoted(g)).toEqual([]);
  }, 120_000);
});

describe('a PDF marks no levels: its reader finds headings by their size, hands each on at one depth, and reports none (its own rule, not changed here)', () => {
  it('three sizes of heading under each of three numbered chapters: each heading the reader finds is a heading; none is listed as body text', async () => {
    const ch = (n: number) => [{ text: 'Chapter ' + n, size: 26, gap: 40 }, ...pdfPara(P(n * 10)), { text: 'The quay ' + n, size: 20, gap: 30 }, ...pdfPara(P(n * 10 + 1)), { text: 'The east berth ' + n, size: 17, gap: 26 }, ...pdfPara(P(n * 10 + 2)),
      { text: 'The third bollard ' + n, size: 14.5, gap: 22 }, ...pdfPara(P(n * 10 + 3)), { page: true }];
    const g = await importFile('given.pdf', await pdf([...ch(1), ...ch(2), ...ch(3)]), '');
    expect(demoted(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    /* every block of the book that opens on "#" is one of the file's headings, at the one depth the reader gives */
    const marks = written(g).flatMap((s) => blocksOf(s.content)).filter((b) => /^#/.test(b));
    expect(marks.every((b) => /^# (The quay|The east berth|The third bollard) \d$/.test(b)), JSON.stringify(marks)).toBe(true);
  }, 120_000);
});
