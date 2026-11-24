// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { epub, freshApi, importFile, setupImport, standInCanvas, written, type Api, type Rec, type Sec } from './import-given';

/* BEUK:poemmode — a chapter marked as a poem in the files a writer takes
   away besides the EPUB: the Word export, the submission manuscript, the
   Markdown export, the narration script (its text and its Word file) and
   the print interior's file. Through 1.0's own functions.

   The rule: no file runs a poem's lines together. Word and the manuscript
   write a stanza as one Verse paragraph with a real line break after each
   line (the verse block's own Word form). Markdown writes the lines as the
   book stores them. The narration script gives each line a line. Print
   centres a left poem's block as a whole. And the same text with Poem Mode
   off is written exactly as prose always was.

   Every line of the books below was made up for the test. */

const BS = String.fromCharCode(92);
const NB = String.fromCharCode(160);
const POEM = 'The tide comes in on quiet feet.\nIt counts the *stones* along the street.\n\nThe gulls wake up and start to call.\n  The morning light is on the wall.';
const MARKED = POEM.replace('feet.\n', 'feet.' + BS + '\n');

type File = { path: string; content: string };
type Line = { k: string; text: string };
type Files = { word: string; manuscript: string; markdown: string; narration: string; narrationWord: string; print: string; stored: string };
let api: Api;

function files(content: string, opts: Rec = {}): Files {
  const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
  const ch = doc.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
  Object.assign(ch, { title: 'Tide', content, dropCap: true, smallCaps: true }, opts);
  Object.assign(doc.meta, { title: 'Lines', author: 'A. Writer', language: 'en' });
  api.applyBookDoc(doc);
  const sec = (api.snapshotBookDoc() as { sections: (Sec & Rec)[] }).sections.find((s) => s.id === ch.id)!;
  const plan = api.acxBuildPlan() as { files: { sectionId?: string; lines: Line[] }[] };
  const script = plan.files.find((f) => f.sectionId === ch.id)!;
  return {
    word: (api.buildDocxFiles() as File[]).find((f) => f.path === 'word/document.xml')!.content,
    manuscript: String(api.msDocumentXml(api.msPlan())),
    markdown: String(api.buildMarkdown()),
    narration: String(api.acxFileTxt(script)),
    narrationWord: String(api.acxDocxXml(script.lines)),
    print: String(api.buildPrintHtml()),
    stored: String(sec.content),
  };
}
const wt = (s: string, pr = '') => '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + s + '</w:t></w:r>';
const WBR = '<w:r><w:br/></w:r>';
/** the Verse paragraphs of a Word body, in order */
const verse = (xml: string) => xml.match(/<w:p><w:pPr><w:pStyle w:val="Verse"\/>[\s\S]*?<\/w:p>/g) || [];
const STANZA_1 = wt('The tide comes in on quiet feet.') + WBR + wt('It counts the ') + wt('stones', '<w:i/>') + wt(' along the street.') + '</w:p>';
const STANZA_2 = wt('The gulls wake up and start to call.') + WBR + wt(NB + NB) + wt('The morning light is on the wall.') + '</w:p>';

beforeAll(async () => {
  await setupImport('poem-mode-files', ['buildDocxFiles', 'msDocumentXml', 'msPlan', 'buildMarkdown', 'buildPrintHtml', 'acxBuildPlan', 'acxFileTxt', 'acxDocxXml', 'contentBlocksToHtml']);
  standInCanvas();
  api = freshApi();
}, 180_000);

describe('a poem chapter in the files a writer takes away', () => {
  let centred: Files, left: Files, prose: Files, marked: Files;
  beforeAll(() => {
    centred = files(POEM, { mode: 'verse' });
    left = files(POEM, { mode: 'verse', verseAlign: 'left' });
    prose = files(POEM);
    marked = files(MARKED, { mode: 'verse' });
  });

  it('Word: a stanza is one Verse paragraph with a real line break after each line; a centred poem\'s are centred and set flush', () => {
    const c = verse(centred.word), l = verse(left.word);
    expect(c.length).toBe(2);
    expect(l.length).toBe(2);
    const CENTRED = '<w:p><w:pPr><w:pStyle w:val="Verse"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>';
    const LEFT = '<w:p><w:pPr><w:pStyle w:val="Verse"/></w:pPr>';
    expect(c).toEqual([CENTRED + STANZA_1, CENTRED + STANZA_2]);
    expect(l).toEqual([LEFT + STANZA_1, LEFT + STANZA_2]);
    // the same text as prose: no Verse paragraph, the lines of a paragraph run on as they always did
    expect(verse(prose.word).length).toBe(0);
    expect(prose.word).toContain('quiet feet. It counts the </w:t></w:r>' + wt('stones', '<w:i/>') + wt(' along the street.') + '</w:p>');
  });

  it('the submission manuscript: Verse paragraphs too, each with one indent of its own, never two', () => {
    const c = verse(centred.manuscript), l = verse(left.manuscript);
    expect(c.length).toBe(2);
    expect(l.length).toBe(2);
    for (const p of [...c, ...l]) expect((p.match(/<w:br\/>/g) || []).length).toBe(1);
    for (const p of c) {
      expect((p.match(/<w:ind /g) || []).length).toBe(1);
      expect(p).toContain('<w:jc w:val="center"/>');
    }
    expect(verse(prose.manuscript).length).toBe(0);
  });

  it('Markdown: the lines as the book stores them, a blank line between stanzas; prose lines run on, as they did', () => {
    expect(centred.markdown).toContain('\n\n' + POEM + '\n');
    expect(left.markdown).toContain('\n\n' + POEM + '\n');
    expect(marked.markdown).toContain('\n\n' + MARKED + '\n'); // a mark the writer typed is left where it is
    expect(prose.markdown).not.toContain(POEM);
    expect(prose.markdown).toMatch(/The tide comes in on quiet feet\. It counts the \*stones\* along the street\.\n\nThe gulls wake up and start to call\. +The morning light is on the wall\./);
    // nothing in the file says the chapter is a poem
    expect(centred.markdown).not.toMatch(/verse|poem/i);
  });

  it('the narration script: each line of the poem is a line of the script; prose is a paragraph a block, as it was', () => {
    const LINES = 'The tide comes in on quiet feet.\nIt counts the stones along the street.\n\nThe gulls wake up and start to call.\nThe morning light is on the wall.';
    expect(centred.narration).toContain(LINES);
    expect(left.narration).toContain(LINES);
    expect(marked.narration).toContain(LINES);
    expect(marked.narration.indexOf(BS)).toBe(-1);
    expect(prose.narration).toMatch(/The tide comes in on quiet feet\. It counts the stones along the street\.\n+The gulls wake up and start to call\. +The morning light is on the wall\./);
    expect((centred.narrationWord.match(/<w:br\/>/g) || []).length - (prose.narrationWord.match(/<w:br\/>/g) || []).length).toBe(2);
  });

  it('print: the file carries the poem as verse and the rule that centres a left poem\'s block; the EPUB\'s rules are in it too', () => {
    const rule = '.verse.poem-left { width: -moz-fit-content; width: fit-content; max-width: 100%; margin-left: auto; margin-right: auto; }';
    for (const p of [centred, left, prose]) expect(p.print).toContain(rule);
    expect(centred.print).toContain('<div class="verse poem poem-center">');
    expect(left.print).toContain('<div class="verse poem poem-left">');
    expect(left.print).toContain('.verse.poem-center .vl { padding-left: 0; padding-right: 0; text-indent: 0; }');
    expect(prose.print).not.toContain('<div class="verse');
  });

  it('no file changes the stored text', () => {
    expect(centred.stored).toBe(POEM);
    expect(left.stored).toBe(POEM);
    expect(marked.stored).toBe(MARKED);
  });
});

describe('a known limit, written down: a poem brought back from an EPUB', () => {
  it('arrives as a verse block inside an ordinary chapter (the import reads the verse markup, not the poem\'s classes): the lines are kept, the mode is not', async () => {
    const body = '<h1>Tide</h1><div class="verse poem poem-center"><p class="stanza"><span class="vl">The tide comes in on quiet feet.</span><br/><span class="vl">It counts the stones along the street.</span></p><p class="stanza"><span class="vl">The gulls wake up and start to call.</span></p></div>';
    const got = await importFile('tide.epub', await epub([{ title: 'Tide', body }]), '');
    const secs = written(got) as (Sec & Rec)[];
    const ch = secs.find((s) => String(s.content).includes('quiet feet'))!;
    expect(ch).toBeTruthy();
    expect(ch.content).toBe('::: verse\nThe tide comes in on quiet feet.\nIt counts the stones along the street.\n\nThe gulls wake up and start to call.\n:::');
    expect('mode' in ch).toBe(false);
    expect('verseAlign' in ch).toBe(false);
  });
});

describe('a known limit, written down: a stanza whose lines open with a list mark, ">" or "#"', () => {
  const ODD = 'quiet feet\n\n- a dash line\n- another\n\n> a quoted line\n\n# a hash line';
  it('the page and Word set them as lines of verse, the marks as typed (the editor still shows a list, a quotation and a heading)', () => {
    const doc = api.buildEmptyBook() as { sections: (Sec & Rec)[]; meta: Rec };
    const ch = doc.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
    Object.assign(ch, { title: 'Odd', content: ODD, mode: 'verse' });
    api.applyBookDoc(doc);
    const sec = (api.snapshotBookDoc() as { sections: (Sec & Rec)[] }).sections.find((s) => s.id === ch.id)!;
    const html = String(api.contentBlocksToHtml(sec.content, sec, true, true));
    expect(html).toBe('<div class="verse poem poem-center"><p class="stanza"><span class="vl">quiet feet</span></p><p class="stanza"><span class="vl">- a dash line</span><br/><span class="vl">- another</span></p><p class="stanza"><span class="vl">&gt; a quoted line</span></p><p class="stanza"><span class="vl"># a hash line</span></p></div>');
    expect(html).not.toMatch(/<ul|<ol|<blockquote|<h[1-6]/);
    const word = (api.buildDocxFiles() as File[]).find((f) => f.path === 'word/document.xml')!.content;
    expect(verse(word).length).toBe(4);
    expect(word).toContain(wt('- a dash line') + WBR + wt('- another') + '</w:p>');
    expect(String(api.buildMarkdown())).toContain(ODD);
  });
});
