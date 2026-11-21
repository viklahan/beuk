import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* BEUK:headlevels — one rule says which Heading 2 opens a chapter and which
   is a sub-heading inside its chapter, and every way in that reads heading
   levels asks it: Word, RTF and markdown. These tests lift the rule out of
   client/index.html with the heading vocabulary it reads and run it in a
   sandbox; the last ones check each reader really calls it. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

type Head = { level: number; text: string };

async function rule() {
  const html = await clientHtml();
  const vocabStart = html.indexOf('      const MATTER_HEADINGS = {');
  const vocab = html.slice(vocabStart, html.indexOf('      function parseChapterHeading('));
  const part = /\n(\s*const PART_HEAD_RE = [^\n]+)\n/.exec(html);
  const block = /\/\* ==== BEUK:headlevels ==== \*\/([\s\S]*?)\/\* ==== \/BEUK:headlevels ==== \*\//.exec(html);
  assert.ok(vocabStart > 0 && part, 'the heading vocabulary is in the studio');
  assert.ok(block, 'the BEUK:headlevels block is in the studio');
  const sandbox: Record<string, unknown> = { irSent: (tag: string, n: number) => '<' + tag + n + '>' };
  vm.runInNewContext(vocab + '\n' + part[1] + '\n' + block[1] + '\nthis.irSubHeadings = irSubHeadings; this.irMdSubHeadings = irMdSubHeadings;', sandbox);
  return {
    subs: (heads: Head[]) => JSON.parse(JSON.stringify((sandbox.irSubHeadings as (h: Head[]) => boolean[])(heads))) as boolean[],
    md: (text: string) => {
      const ir = { subs: [] as string[] };
      const out = (sandbox.irMdSubHeadings as (t: string, ir: unknown) => string)(text, ir);
      return { out, subs: JSON.parse(JSON.stringify(ir.subs)) as string[] };
    },
  };
}
const h1 = (text: string): Head => ({ level: 1, text });
const h2 = (text: string): Head => ({ level: 2, text });
const subTexts = (heads: Head[], flags: boolean[]) => heads.filter((_, i) => flags[i]).map((h) => h.text);

test('head levels: in a book whose chapters are Heading 1, each Heading 2 is a sub-heading inside its chapter', async () => {
  const { subs } = await rule();
  /* The shape of the manuscript that showed this: numbered Heading 1 chapters, far more Heading 2 than Heading 1. */
  const heads = [
    h1('Introduction'), h2('Why This Book Exists'),
    h1('Chapter 1: Why It Hits Hard'), h2('Responsibility Is at Its Peak'), h2('Your Body Starts Sending New Signals'), h2('A Moment to Reflect'),
    h1('Chapter 2: The Noise'), h2('The Mental Noise Never Turns Off'), h2('Exercise 1: Mapping Your Triggers'), h2('A Moment to Reflect'),
    h1('End Note'),
  ];
  const flags = subs(heads);
  assert.deepEqual(heads.map((h, i) => (h.level === 1 ? false : flags[i])), heads.map((h) => h.level === 2), 'every Heading 2 is a sub-heading');
  assert.ok(heads.every((h, i) => h.level !== 1 || !flags[i]), 'no Heading 1 is ever a sub-heading');
});

test('head levels: Heading 1 chapters without numbers are chapters all the same', async () => {
  const { subs } = await rule();
  const heads = [h1('The Harbour'), h2('Morning'), h2('Evening'), h1('The Crossing'), h2('The Squall'), h1('Landfall')];
  assert.deepEqual(subTexts(heads, subs(heads)), ['Morning', 'Evening', 'The Squall']);
});

test('head levels: a title set as Heading 1 over Heading 2 chapters keeps its chapters', async () => {
  const { subs } = await rule();
  const one = [h1('The Lantern Coast'), h2('The Keeper'), h2('The Storm'), h2('The Wreck')];
  assert.deepEqual(subTexts(one, subs(one)), []);
  /* a second Heading 1 that holds none of the Heading 2s changes nothing: they all still sit under one */
  const two = [h1('The Lantern Coast'), h1('Introduction'), h2('The Keeper'), h2('The Storm'), h2('The Wreck'), h2('The Morning After')];
  assert.deepEqual(subTexts(two, subs(two)), []);
  const back = [h1('The Lantern Coast'), h2('The Keeper'), h2('The Storm'), h2('The Wreck'), h2('The Morning After'), h1('Acknowledgments'), h1('About the Author')];
  assert.deepEqual(subTexts(back, subs(back)), [], 'matter pages set as Heading 1 are not what makes a book Heading 1');
});

test('head levels: Heading 1 Parts over Heading 2 chapters keep their chapters', async () => {
  const { subs } = await rule();
  const heads = [h1('Part One'), h2('The Keeper'), h2('The Storm'), h1('Part Two: The Sea'), h2('The Wreck'), h2('The Morning After')];
  assert.deepEqual(subTexts(heads, subs(heads)), []);
  const books = [h1('Book I'), h2('Arrival'), h2('Winter'), h1('Volume Two'), h2('Thaw'), h2('Leaving')];
  assert.deepEqual(subTexts(books, subs(books)), []);
});

test('head levels: a book that numbers its chapters in Heading 2 says Heading 2 is the chapter', async () => {
  const { subs } = await rule();
  const heads = [h1('The Storm Years'), h2('Chapter 1'), h2('Chapter 2'), h2('Interlude'), h1('The Calm Years'), h2('Chapter 3'), h2('A Letter'), h2('Chapter 4')];
  assert.deepEqual(subTexts(heads, subs(heads)), [], 'not even the unnumbered Heading 2s are folded in');
});

test('head levels: a Heading 2 that names a chapter, a part or a matter page is never a sub-heading', async () => {
  const { subs } = await rule();
  const heads = [h1('The Harbour'), h2('Morning'), h2('Epilogue'), h1('The Crossing'), h2('The Squall'), h2('Part Two'), h2('Chapter Nine'), h2('Acknowledgments')];
  assert.deepEqual(subTexts(heads, subs(heads)), ['Morning', 'The Squall']);
});

test('head levels: a Heading 2 before the first Heading 1 has no chapter to sit in', async () => {
  const { subs } = await rule();
  const heads = [h2('A Note Before'), h1('The Harbour'), h2('Morning'), h1('The Crossing'), h2('The Squall')];
  assert.deepEqual(subTexts(heads, subs(heads)), ['Morning', 'The Squall']);
});

test('head levels: more Heading 1 than Heading 2 was the rule before, and still holds', async () => {
  const { subs } = await rule();
  const heads = [h1('One'), h1('Two'), h2('An aside'), h1('Three')];
  assert.deepEqual(subTexts(heads, subs(heads)), ['An aside']);
});

test('head levels: markdown follows the same rule — "##" under "#" chapters is a sub-heading, kept in its chapter', async () => {
  const { md } = await rule();
  const book = ['# The Harbour', '', 'Dawn.', '', '## Morning', '', 'Fog.', '', '# The Crossing', '', '## The Squall', '', 'Rain.', '', '```', '## not a heading: code', '```'].join('\n');
  const r = md(book);
  assert.deepEqual(r.subs, ['Morning', 'The Squall']);
  assert.match(r.out, /^# The Harbour$/m);
  assert.doesNotMatch(r.out, /^## (Morning|The Squall)$/m);
  assert.match(r.out, /\n<SUB0>\n/, 'each sub-heading stands as a block of its own where it stood');
  assert.match(r.out, /^## not a heading: code$/m, 'a fenced line is text');
  /* a title over "##" chapters is untouched, character for character */
  const titled = ['# The Lantern Coast', '', '## The Keeper', '', 'One.', '', '## The Storm', '', 'Two.'].join('\n');
  const t = md(titled);
  assert.equal(t.out, titled);
  assert.deepEqual(t.subs, []);
});

test('head levels: Google Docs\' markdown — headings wholly in bold, and bare "#" lines for empty paragraphs — reads as the headings it means', async () => {
  const { md } = await rule();
  /* the shape Google Docs' "Markdown (.md)" download writes */
  const book = ['# ', '', '**The Title**', '', '## ', '', '# **Chapter 1: The Harbour**', '', 'Dawn.', '', '## **Morning**', '', 'Fog.', '', '# **Chapter 2: The Crossing**', '', '## **The Squall**', '', 'Rain, *sideways*.', '', '# *Not* all *of it*'].join('\n');
  const r = md(book);
  assert.match(r.out, /^# Chapter 1: The Harbour$/m, 'the bold marks are not part of the title');
  assert.match(r.out, /^# Chapter 2: The Crossing$/m);
  assert.deepEqual(r.subs, ['Morning', 'The Squall'], 'a sub-heading comes across plain too');
  assert.doesNotMatch(r.out, /^#{1,6}\s*$/m, 'an empty heading line is nothing');
  assert.match(r.out, /^\*\*The Title\*\*$/m, 'a bold line that is no heading is left alone');
  assert.match(r.out, /Rain, \*sideways\*\./, 'emphasis in the prose is left alone');
  assert.match(r.out, /^# \*Not\* all \*of it\*$/m, 'a heading with emphasis inside it keeps it');
});

test('head levels: a numbered book invents no chapter, and the studio checks one book through every reader', async () => {
  const html = await clientHtml();
  const parse = html.slice(html.indexOf('function parseManuscript('), html.indexOf('function importFoundList('));
  /* an unnumbered heading between two numbered chapters joins the chapter before it, as its sub-heading */
  assert.match(parse, /if \(ii > firstN && ii < lastN\) \{[\s\S]{0,900}host\.bodyText = \[host\.bodyText, line, it\.bodyText\]\.filter\(Boolean\)\.join\("\\n\\n"\);\s*it\.cls = "skip";/);
  const id = 'import.headlevels.same-book-every-reader';
  assert.ok(html.includes(`{ id: "${id}"`), 'the self-check is in the studio');
  const { SELF_CHECK_CASES } = await import('../src/housekeeping/registry.js');
  const c = SELF_CHECK_CASES.find((x) => x.id === id);
  assert.ok(c && c.kind === 'client-only' && c.reason && c.reason.length > 10, 'and registered client-only, with a reason');
});

test('head levels: every reader of heading levels asks the one rule', async () => {
  const html = await clientHtml();
  assert.equal((html.match(/function irSubHeadings\(/g) || []).length, 1, 'one rule, declared once');
  const docx = html.slice(html.indexOf('function irDocxHtmlToText('), html.indexOf('function irFinish('));
  assert.match(docx, /irSubHeadings\(/, 'Word');
  assert.doesNotMatch(docx, /h1n > h2n/, 'Word keeps no rule of its own');
  const rtf = html.slice(html.indexOf('function importRtfRead('), html.indexOf('/* ==== /BEUK:rtfimport ==== */'));
  assert.match(rtf, /rtfSubHeadings\(rd\)/, 'RTF, the Import button');
  const rtfText = html.slice(html.indexOf('function rtfToManuscriptText('), html.indexOf('function importRtfRead('));
  assert.match(rtfText, /rtfSubHeadings\(rd\)/, 'RTF, the text-only reader');
  const rtfRule = html.slice(html.indexOf('function rtfSubHeadings('), html.indexOf('function rtfToManuscriptText('));
  /* V's ruling, 2026-11-20: depth is relative for every format. RTF asks irHeadDepths (the levels in use, read in order, then the one
     rule irSubHeadings inside it), so a file of Heading 1 and Heading 3 keeps its Heading 3s as sub-headings; it no longer reads
     "level <= 2" for itself. */
  assert.match(rtfRule, /irHeadDepths\(hb\)/, "RTF's two readers share one call of the rule");
  assert.doesNotMatch(rtfRule + rtf + rtfText, /b\.level <= 2/, 'RTF reads no heading level by its number');
  const depths = html.slice(html.indexOf('function irHeadDepths('), html.indexOf('function irMdSubHeadings('));
  assert.match(depths, /irSubHeadings\(/, 'the reading of depth asks the one rule');
  assert.match(docx, /irHeadDepths\(/, 'Word, OpenDocument and web pages are walked by the levels in use');
  const epub = html.slice(html.indexOf('/* ==== BEUK:epubimport ==== '), html.indexOf('/* ==== /BEUK:epubimport ==== */'));
  assert.match(epub, /irHeadDepths\(plainHeads\)/, 'EPUB asks the same reading');
  assert.doesNotMatch(rtf + rtfText, /"ilvl"/);
  /* a PDF's bookmarks are nested as its headings were: their depth is the level the rule reads */
  const pdf = html.slice(html.indexOf('function pdfLayout('), html.indexOf('function pdfIdentity('));
  assert.match(pdf, /markLevel\.set\(n \+ " " \+ full, o\.level\)/, "PDF: a bookmark's depth is kept");
  assert.match(pdf, /irSubHeadings\(marked\.map\(\(b\) => \(\{ level: markLevel\.get\(b\.page \+ " " \+ markKey\(b\.text\)\) > 1 \? 2 : 1, text: b\.text \}\)\)\)/, 'PDF');
  const plain = html.slice(html.indexOf('function importPlainManuscript('), html.indexOf('const IR_MAMMOTH_OPTS'));
  assert.match(plain, /irMdSubHeadings\(/, 'markdown and text');
});
