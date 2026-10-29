import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* BEUK:rtfimport — the studio's RTF reader runs in the browser. These
   tests lift the marked block out of client/index.html and run its pure
   reader (rtfRead) in a sandbox, against hand-written snippets for single
   features and against a file Microsoft Word 16 wrote itself
   (tests/fixtures/rtf/word-16-sampler.rtf). */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

type Run = { t: string; i: boolean; b: boolean; href: string };
type Block = { kind: string; level?: number; text?: string; runs?: Run[]; quote?: boolean; ordered?: boolean; items?: Run[][]; rows?: string[][]; images?: number; ext?: string; data?: string };
type Read = { blocks: Block[]; notes: { n: string; runs: Run[] }[]; info: { title: string; author: string; subject: string }; counts: Record<string, number> };

async function reader() {
  const html = await clientHtml();
  const m = /\/\* ==== BEUK:rtfimport ==== \*\/([\s\S]*?)\/\* ==== \/BEUK:rtfimport ==== \*\//.exec(html);
  assert.ok(m, 'the BEUK:rtfimport block is in the studio');
  const sandbox: Record<string, unknown> = { TextDecoder, btoa, Uint8Array, String };
  vm.runInNewContext(m[1] + '\nthis.rtfRead = rtfRead; this.rtfBytesToString = rtfBytesToString;', sandbox);
  return {
    /* Plain data out of the sandbox, so deep equality compares values, not realms. */
    read: (src: string) => JSON.parse(JSON.stringify((sandbox.rtfRead as (s: string) => unknown)(src))) as Read,
    bytes: sandbox.rtfBytesToString as (b: ArrayBuffer | Uint8Array) => string,
  };
}
const plain = (rs: Run[] | undefined) => (rs ?? []).map((r) => r.t).join('').replace(/\s+/g, ' ').trim();
const texts = (r: Read) => r.blocks.map((b) => (b.kind === 'p' || b.kind === 'h' ? plain(b.runs) : b.kind));

test('rtf: paragraphs, italic and bold runs, symbols and escapes', async () => {
  const { read } = await reader();
  const r = read(String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}\pard It was a {\i dark} and \b stormy\b0  night\emdash or so \{they\} said.\par Second \'93para\'94\~here.\par}`);
  assert.deepEqual(texts(r), ['It was a dark and stormy night—or so {they} said.', 'Second “para” here.']);
  const runs = r.blocks[0].runs!;
  assert.ok(runs.some((x) => x.t === 'dark' && x.i && !x.b));
  assert.ok(runs.some((x) => x.t === 'stormy' && x.b && !x.i));
});

test('rtf: \\uN with its \\uc fallback is read once, surrogate pairs included', async () => {
  const { read } = await reader();
  /* A plain string, not String.raw: under tsx a raw template still reads \uNNNN as the character. */
  const r = read('{\\rtf1\\ansi\\pard Caf\\u233\\\'e9 \\u8212? \\uc0\\u26085\\u26412  \\uc1\\u-10179?\\u-8704? \\u8220\\emdash x\\par}');
  assert.equal(plain(r.blocks[0].runs), 'Café — 日本 😀 “x');
});

test('rtf: the code page decides what \\\'hh means (\\ansicpg1251, a font \\fcharset)', async () => {
  const { read } = await reader();
  const cyr = read(String.raw`{\rtf1\ansi\ansicpg1251\pard \'cf\'f0\'e8\'e2\'e5\'f2\par}`);
  assert.equal(plain(cyr.blocks[0].runs), 'Привет');
  const greekFont = read(String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Times;}{\f1\fcharset161 Times Greek;}}\pard\f0 caf\'e9 {\f1 \'e1\'e2\'e3}\par}`);
  assert.equal(plain(greekFont.blocks[0].runs), 'café αβγ');
});

test('rtf: headings come from a "heading N" style or \\outlinelevel; a quote style is a quote', async () => {
  const { read } = await reader();
  const r = read(String.raw`{\rtf1\ansi{\stylesheet{\s0 Normal;}{\s1\outlinelevel0 heading 1;}{\s3 heading 3;}{\s7 Quote;}{\*\cs10 Default Paragraph Font;}}
\pard\s1 Chapter One\par\pard\s0 Body.\par\pard\s3 Small\par\pard\outlinelevel1 Part Two\par\pard\s7 Quoted.\par}`);
  const h = r.blocks.filter((b) => b.kind === 'h');
  assert.deepEqual(h.map((b) => [b.level, b.text]), [[1, 'Chapter One'], [3, 'Small'], [2, 'Part Two']]);
  const q = r.blocks.find((b) => b.kind === 'p' && plain(b.runs) === 'Quoted.');
  assert.equal(q?.quote, true);
  assert.equal(r.blocks.find((b) => plain(b.runs) === 'Body.')?.quote, false);
});

test('rtf: footnotes leave [^n] where they stood and keep their own text', async () => {
  const { read } = await reader();
  const r = read(String.raw`{\rtf1\ansi\pard Storm.{\super\chftn}{\footnote\pard\plain{\super\chftn} A {\i wet} one.}\par\pard\intbl Not here\cell\row\pard After{\super\chftn}{\footnote\pard{\super\chftn} Two.}\par}`);
  assert.equal(plain(r.blocks[0].runs), 'Storm.[^1]');
  assert.deepEqual(r.notes.map((n) => [n.n, plain(n.runs)]), [['1', 'A wet one.'], ['2', 'Two.']]);
  assert.ok(r.notes[0].runs.some((x) => x.t === 'wet' && x.i));
  assert.equal(plain(r.blocks[r.blocks.length - 1].runs), 'After[^2]');
});

test('rtf: hyperlinks keep their address; an internal bookmark link is counted, not carried', async () => {
  const { read } = await reader();
  const r = read(String.raw`{\rtf1\ansi\pard Go {\field{\*\fldinst{HYPERLINK "https://beuk.studio/"}}{\fldrslt{\ul the studio}}} or {\field{\*\fldinst HYPERLINK \\l "toc1"}{\fldrslt back}}.\par}`);
  const runs = r.blocks[0].runs!;
  assert.ok(runs.some((x) => x.t === 'the studio' && x.href === 'https://beuk.studio/'));
  assert.equal(plain(runs), 'Go the studio or back.');
  assert.deepEqual(runs.filter((x) => x.href).map((x) => x.t), ['the studio']);
  assert.equal(r.counts.underline, 0, "a link's own underline is not a lost underline");
  assert.equal(r.counts.linksOk, 1);
  assert.equal(r.counts.links, 1);
});

test('rtf: lists, tables and set-aside text are kept apart and counted', async () => {
  const { read } = await reader();
  const r = read(String.raw`{\rtf1\ansi
{\header \pard Running head\par}
\pard{\listtext \'95\tab}\ls1 One\par{\listtext \'95\tab}\ls1 Two\par
\pard{\listtext 1.\tab}\ls2 First\par
\pard\intbl Name\cell Role\cell\row\pard\intbl Ada\cell Keeper\cell\row
\pard After the table {\*\annotation{\*\atnid A} a comment}{\deleted gone }{\revised added }{\v hidden }{\ul u}{\strike s}{\super 2}.\par}`);
  const kinds = r.blocks.map((b) => b.kind);
  assert.deepEqual(kinds, ['list', 'list', 'table', 'p']);
  assert.equal(r.blocks[0].ordered, false);
  assert.deepEqual(r.blocks[0].items!.map(plain), ['One', 'Two']);
  assert.equal(r.blocks[1].ordered, true);
  assert.deepEqual(r.blocks[2].rows, [['Name', 'Role'], ['Ada', 'Keeper']]);
  assert.equal(plain(r.blocks[3].runs), 'After the table added us2.');
  assert.deepEqual(
    { headers: r.counts.headers, comments: r.counts.comments, del: r.counts.del, ins: r.counts.ins, underline: r.counts.underline, strike: r.counts.strike, subsup: r.counts.subsup },
    { headers: 1, comments: 1, del: 1, ins: 1, underline: 1, strike: 1, subsup: 1 },
  );
});

test('rtf: PNG and JPEG pictures come through; other formats and \\nonshppict fallbacks do not', async () => {
  const { read } = await reader();
  const png = '89504e470d0a1a0a0000000d49484452';
  const r = read(`{\\rtf1\\ansi\\pard Before\\par{\\*\\shppict{\\pict\\pngblip\\picw1\\pich1 ${png}}}{\\nonshppict{\\pict\\wmetafile8 0102}}\\pard After\\par{\\pict\\emfblip 0102}\\par}`);
  const img = r.blocks.find((b) => b.kind === 'img');
  assert.equal(img?.ext, 'png');
  assert.equal(Buffer.from(img!.data!, 'base64').toString('hex'), png);
  assert.deepEqual(r.blocks.map((b) => b.kind), ['p', 'img', 'p']);
  assert.equal(r.counts.pictures, 2, 'the PNG and the EMF; the WMF fallback is the same picture');
});

test('rtf: the document\'s own \\info title and author are read', async () => {
  const { read } = await reader();
  const r = read(String.raw`{\rtf1\ansi{\info{\title The Lantern Keeper}{\author Ada Quill}{\operator Someone}{\creatim\yr2026}}\pard Text.\par}`);
  assert.deepEqual([r.info.title, r.info.author], ['The Lantern Keeper', 'Ada Quill']);
  assert.deepEqual(texts(r), ['Text.']);
});

test('rtf: a file that is not RTF is refused, not imported as noise', async () => {
  const { read } = await reader();
  assert.throws(() => read('Just some text'), /not an RTF file/);
});

const WORD = path.join(here, 'fixtures', 'rtf', 'word-16-sampler.rtf');
test('rtf: a file Microsoft Word 16 wrote reads as the document it was', { skip: !existsSync(WORD) && 'fixture missing' }, async () => {
  const { read, bytes } = await reader();
  const r = read(bytes(await readFile(WORD)));
  assert.deepEqual([r.info.title, r.info.author], ['The Lantern Keeper', 'Ada Quill']);
  const heads = r.blocks.filter((b) => b.kind === 'h').map((b) => [b.level, b.text]);
  assert.deepEqual(heads, [[1, 'Chapter One'], [1, 'Chapter Two'], [3, 'A small subhead']]);
  const all = texts(r).join('\n');
  assert.match(all, /It was a dark and stormy night\.\[\^1\]/);
  assert.match(all, /Café — naïve “quotes” 日本 😀\.\[\^2\]/);
  assert.match(all, /^\* \* \*$/m);
  assert.doesNotMatch(all, /HIDDENWORDS|DELETEME|Running head|Check this/);
  assert.match(all, /Kept words and inserted words\./);
  assert.deepEqual(r.notes.map((n) => plain(n.runs)), ['First note, about the storm.', 'Second note.']);
  const first = r.blocks.find((b) => b.kind === 'p' && /dark/.test(plain(b.runs)))!;
  assert.ok(first.runs!.some((x) => x.t.trim() === 'dark' && x.i));
  assert.ok(first.runs!.some((x) => x.t.trim() === 'stormy' && x.b));
  const link = r.blocks.flatMap((b) => b.runs ?? []).find((x) => x.href);
  assert.equal(link?.href, 'https://beuk.studio/');
  assert.equal(r.blocks.find((b) => b.kind === 'p' && plain(b.runs) === 'A quoted line.')?.quote, true);
  const lists = r.blocks.filter((b) => b.kind === 'list');
  assert.deepEqual(lists.map((l) => [l.ordered, l.items!.map(plain)]), [[false, ['First bullet', 'Second bullet']], [true, ['First step', 'Second step']]]);
  assert.deepEqual(r.blocks.find((b) => b.kind === 'table')?.rows, [['Name', 'Role'], ['Ada', 'Keeper']]);
  assert.deepEqual(r.blocks.filter((b) => b.kind === 'img').map((b) => b.ext), ['png', 'jpg']);
  assert.equal(r.counts.comments, 1);
  assert.equal(r.counts.headers, 1);
  assert.ok(r.counts.del >= 1 && r.counts.ins >= 1, `tracked: ${r.counts.ins} ins / ${r.counts.del} del`);
  assert.deepEqual([r.counts.underline, r.counts.strike, r.counts.subsup], [1, 1, 1]);
});

test('rtf: the text-only reader (shelf bulk import, box-set volumes) writes Beuk\'s marks and keeps each note in its chapter', async () => {
  const html = await clientHtml();
  const block = /\/\* ==== BEUK:rtfimport ==== \*\/([\s\S]*?)\/\* ==== \/BEUK:rtfimport ==== \*\//.exec(html)![1];
  const start = html.indexOf('      function irRunsToMd(');
  const marks = html.slice(start, html.indexOf('\n      function ', start + 10));
  const sandbox: Record<string, unknown> = { TextDecoder, btoa, Uint8Array, String };
  vm.runInNewContext(marks + '\n' + block + '\nthis.toText = (s) => rtfToManuscriptText(rtfRead(s));', sandbox);
  const toText = sandbox.toText as (s: string) => string;
  const out = toText(String.raw`{\rtf1\ansi{\stylesheet{\s1 heading 1;}}\pard\s1 One\par\pard It was {\i dark}.{\super\chftn}{\footnote\pard{\super\chftn} A note.}\par{\listtext 1.\tab}\ls1 Step\par\pard\s1 Two\par\pard The end.\par}`);
  assert.equal(out, '# One\n\nIt was *dark*.[^1]\n\n1. Step\n\n[^1]: A note.\n\n# Two\n\nThe end.');
});

test('rtf: the import report names the RTF file, not a Word file, in all 13 locales', async () => {
  const html = await clientHtml();
  for (const k of ['ir.why.sourceRtf', 'ir.k.commentsRtf', 'ir.k.commentsRtfPlural']) {
    const vals = [...html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "([^"]+)"`, 'g'))].map((m) => m[1]);
    assert.equal(vals.length, 13, `${k} in 13 locales`);
    for (const v of vals) {
      assert.match(v, /RTF/, `${k}: ${v}`);
      assert.doesNotMatch(v, /Word/, `${k}: ${v}`);
      if (k !== 'ir.why.sourceRtf') assert.ok(v.includes('{n}'), `${k} keeps {n}`);
    }
  }
  assert.match(html, /if \(ir\.format === "docx" \|\| ir\.format === "rtf"\) from = headingLevelOf\(heading\)/);
});

test('rtf: every studio file picker and the bulk reader take .rtf', async () => {
  const html = await clientHtml();
  assert.match(html, /id="fileInput" accept="[^"]*\.rtf/);
  assert.match(html, /id="bulkFileInput" accept="[^"]*\.rtf/);
  assert.match(html, /id="boxSetFileInput" accept="[^"]*\.rtf/);
  assert.match(html, /const BULK_MANUSCRIPT_EXT = \[[^\]]*"\.rtf"/);
  assert.match(html, /if \(lower\.endsWith\("\.rtf"\)\) \{ importRtfRead\(name, rtfRead\(rtfBytesToString\(await file\.arrayBuffer\(\)\)\)\); return; \}/);
});
