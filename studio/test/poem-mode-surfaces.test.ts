// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { freshApi, setupImport, standInCanvas, type Api, type Rec, type Sec } from './import-given';

/* BEUK:poemmode — a chapter marked as a poem (section.mode "verse"), on
   every surface that sets the book, through 1.0's own functions (the code
   the studio runs in the browser and the server lifts for the EPUB).

   The rule held here: the stored text is the source of truth. Read as a
   poem, a new line of it is a line and a blank line parts two stanzas; no
   surface joins, justifies or indents a poem's lines, none gives a poem
   the chapter's drop cap or lead-in, and none changes one character of the
   text. The poem is set by the verse block's own renderer, so its markup
   is the verse block's, with the poem's alignment as a class.

   Every line of the books below was made up for the test. */

const BS = String.fromCharCode(92);
const NB = String.fromCharCode(160);
const POEM = 'The tide comes in on quiet feet.\nIt counts the *stones* along the street.\n\nThe gulls wake up and start to call.\n  The morning light is on the wall.';
/* the same poem typed while the chapter was prose: its first line break marked with Shift+Enter */
const MARKED = POEM.replace('feet.\n', 'feet.' + BS + '\n');
const STANZAS =
  '<p class="stanza"><span class="vl">The tide comes in on quiet feet.</span><br/><span class="vl">It counts the <em>stones</em> along the street.</span></p>' +
  '<p class="stanza"><span class="vl">The gulls wake up and start to call.</span><br/><span class="vl">' + NB + NB + 'The morning light is on the wall.</span></p></div>';

type File = { path: string; content: string };
type Pages = { preview: string; epub: string; standalone: string; print: string; css: string; printCss: string; stored: string; words: number; bookWords: number };
let api: Api;

function build(content: string, opts: Rec = {}): { ch: Sec & Rec; sec: Sec & Rec } {
  const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
  const ch = doc.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
  Object.assign(ch, { title: 'Tide', content, dropCap: true, smallCaps: true }, opts);
  Object.assign(doc.meta, { title: 'Lines', author: 'A. Writer', language: 'en' });
  api.applyBookDoc(doc);
  const sec = (api.snapshotBookDoc() as { sections: (Sec & Rec)[] }).sections.find((s) => s.id === ch.id)!;
  return { ch, sec };
}
const body = (html: string) => html.replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
const head = (html: string) => html.replace(/<body[\s\S]*$/, '');

function pages(content: string, opts: Rec = {}): Pages {
  const { sec } = build(content, opts);
  const files = api.epubFiles('generic') as File[];
  const standalone = String(api.buildStandaloneHtml());
  const print = String(api.buildPrintHtml());
  return {
    preview: String(api.contentBlocksToHtml(sec.content, sec, true, false)),
    epub: files.filter((f) => /\.xhtml$/.test(f.path) && String(f.content).indexOf('quiet feet') !== -1).map((f) => body(String(f.content))).join('\n'),
    standalone: body(standalone),
    print: body(print),
    css: String(files.find((f) => /\.css$/.test(f.path))!.content),
    printCss: head(print),
    stored: String(sec.content),
    words: Number(api.sectionWords(sec)),
    bookWords: Number(api.bookWordTotal()),
  };
}
const PAGES = ['preview', 'epub', 'standalone', 'print'] as const;

beforeAll(async () => {
  await setupImport('poem-mode-surfaces', ['epubFiles', 'contentBlocksToHtml', 'buildStandaloneHtml', 'buildPrintHtml', 'sectionWords', 'bookWordTotal', 'buildBookCss']);
  standInCanvas();
  api = freshApi();
}, 180_000);

describe('a poem chapter is set as verse on every page', () => {
  let centred: Pages, left: Pages, prose: Pages;
  beforeAll(() => {
    centred = pages(POEM, { mode: 'verse' });
    left = pages(POEM, { mode: 'verse', verseAlign: 'left' });
    prose = pages(POEM);
  });

  it.each(PAGES)('%s: a line for every new line and a stanza for every blank line, centred unless left was chosen; the indent kept', (name) => {
    expect(centred[name], name).toContain('<div class="verse poem poem-center">' + STANZAS);
    expect(left[name], name).toContain('<div class="verse poem poem-left">' + STANZAS);
    for (const p of [centred, left]) {
      expect((p[name].match(/<span class="vl">/g) || []).length, name).toBe(4);
      expect((p[name].match(/<p class="stanza">/g) || []).length, name).toBe(2);
    }
  });

  it.each(PAGES)('%s: a poem takes no drop cap, no lead-in and no opening paragraph; the same text as prose takes all three, as it always did', (name) => {
    for (const p of [centred, left]) expect(/dropcap|class="first|class="lead/.test(p[name]), name).toBe(false);
    expect(prose[name], name).not.toContain('class="verse');
    expect(prose[name], name).toMatch(/<p class="first has-dropcap">/);
    // in prose a single new line is the space it always was
    expect(prose[name], name).toMatch(/quiet feet\. It counts the <em>stones<\/em> along the street\.<\/p>/);
  });

  it('the stored text is the same string whatever the mode, and the word counts are the same numbers', () => {
    expect(centred.stored).toBe(POEM);
    expect(left.stored).toBe(POEM);
    expect(prose.stored).toBe(POEM);
    expect(centred.words).toBe(prose.words);
    expect(left.words).toBe(prose.words);
    expect(centred.bookWords).toBe(prose.bookWords);
    expect(prose.words).toBeGreaterThan(20);
  });

  it('the book stylesheet: centred lines with no hung turn-over; left is the verse block (flush, the turn-over hung 1.5em); the EPUB asks for no fit-content', () => {
    for (const p of [centred, left, prose]) {
      expect(p.css).toContain('.verse.poem { margin: 1em 0; }');
      expect(p.css).toContain('.verse.poem-center, .verse.poem-center p.stanza { text-align: center; }');
      expect(p.css).toContain('.verse.poem-center .vl { padding-left: 0; padding-right: 0; text-indent: 0; }');
      expect(p.css).toContain('.verse .vl { display: block; padding-left: 1.5em; text-indent: -1.5em; }');
      expect(p.css).toContain('break-inside: avoid; page-break-inside: avoid; }');
      expect(p.css).not.toContain('fit-content');
    }
    // the studio's preview (a scoped stylesheet) centres a left poem's block as a whole
    expect(String(api.buildBookCss('.pv'))).toContain('.pv .verse.poem-left { width: -moz-fit-content; width: fit-content; max-width: 100%; margin-left: auto; margin-right: auto; }');
  });
});

describe('a line break marked while the chapter was prose', () => {
  it.each(PAGES)('%s: in a poem it ends its line like any other and its backslash is not set; in prose it is the line break it was', (name) => {
    const poem = pages(MARKED, { mode: 'verse' });
    expect(poem[name], name).toContain('<div class="verse poem poem-center">' + STANZAS);
    expect(poem[name].indexOf(BS), name).toBe(-1);
    expect(poem.stored).toBe(MARKED); // the mark is still in the text: nothing took it out
    const prose = pages(MARKED);
    expect(prose[name], name).toMatch(/quiet feet\.<br\/>It counts the <em>stones<\/em> along the street\.<\/p>/);
  });
});

describe('what a poem chapter may hold besides its lines', () => {
  const MIXED = 'One line[^1]\ntwo\n\n***\n\n[^1]: The note.\n\n::: center\nA sign\n:::\n\n::: verse\n  fenced\n:::\n\nLast line';
  it.each(PAGES)('%s: a note, a scene break, a fenced block (set as it always was) and the writer\'s own verse block', (name) => {
    const p = pages('quiet feet\n\n' + MIXED, { mode: 'verse' })[name];
    expect(p, name).toMatch(/<span class="vl">One line<a class="noteref"[^>]*><sup class="endnote-ref">[^<]*<\/sup><\/a><\/span><br\/><span class="vl">two<\/span><\/p>/);
    expect(p, name).toMatch(/<div class="scene-break">/);
    expect(p, name).toContain('<div class="align-center"><p>A sign</p></div>');
    expect(p, name).toContain('<div class="verse"><p class="stanza"><span class="vl">' + NB + NB + 'fenced</span></p></div>');
    expect(p, name).toContain('<div class="verse poem poem-center"><p class="stanza"><span class="vl">Last line</span></p></div>');
    expect(p, name).toMatch(/class="endnotes[\s\S]*The note\./);
    expect(p, name).not.toContain('[^1]:');
  });

  it('a Part and front matter are never poems, whatever they store', () => {
    const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
    const ded = doc.sections.find((s) => s.type === 'dedication')!;
    Object.assign(ded, { content: 'For the keepers,\nwho read the water.', mode: 'verse' });
    api.applyBookDoc(doc);
    const sec = (api.snapshotBookDoc() as { sections: (Sec & Rec)[] }).sections.find((s) => s.id === ded.id)!;
    expect(sec.mode).toBe('verse'); // stored as written; not read
    expect(String(api.contentBlocksToHtml(sec.content, sec, true, true))).not.toContain('class="verse');
  });

  it('an empty poem exports nothing at all', () => {
    const { sec } = build('', { mode: 'verse' });
    expect(String(api.contentBlocksToHtml(sec.content, sec, true, true))).toBe('');
    const all = (api.epubFiles('generic') as File[]).filter((f) => typeof f.content === 'string').map((f) => f.content).join('\n');
    for (const ghost of ['Write your first line', 'press Enter for the next one', 'a blank line starts a new stanza', 'Name your poem']) expect(all).not.toContain(ghost);
    expect(Number(api.sectionWords(sec))).toBe(0);
  });
});
