import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import type { Node } from 'prosemirror-model';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { fixturePath } from './book-fixtures.js';
import {
  blockCoverage, blocksText, canApplyMark, canSetLink, normalizeBlock, normalizeDoc, toDoc, toText, type ConvertStats,
} from '../src/book/editor/convert.js';
import { bookSchema as S } from '../src/book/editor/schema.js';

/* BEUK:editor-convert — the text <-> ProseMirror converter is lossless for
   every string: toText(toDoc(t)) === t byte for byte. Proven over every
   section of every fixture book (and BEUK_BOOK_CORPUS when set), the review
   cases (whitespace, nesting, Unicode), and random markup soup. Coverage
   (blocks parsed rather than raw) is a floor per book, so it cannot slip. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every section of a book file, either shape (the legacy split shape groups them in frontMatter/body/backMatter). */
function sectionsOf(book: unknown): Rec[] {
  if (!isRec(book)) return [];
  const s = book.sections;
  if (Array.isArray(s)) return s.filter(isRec);
  if (isRec(s)) return (['frontMatter', 'body', 'backMatter'] as const).flatMap((k) => (Array.isArray(s[k]) ? (s[k] as unknown[]).filter(isRec) : []));
  return [];
}

function fixtureBooks(): { name: string; book: unknown }[] {
  const out: { name: string; book: unknown }[] = [];
  for (const dir of ['real', 'legacy'])
    for (const f of readdirSync(fixturePath(dir)).filter((x) => x.endsWith('.json')).sort())
      out.push({ name: `${dir}/${f}`, book: (JSON.parse(readFileSync(fixturePath(dir, f), 'utf8')) as { book: unknown }).book });
  return out;
}

/** A document through Yjs the way the studio keeps it: into a fragment, encoded, applied to a fresh doc, read back. */
function throughYjs(doc: Node): Node {
  const a = new Y.Doc();
  prosemirrorToYXmlFragment(doc, a.getXmlFragment('body'));
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return yXmlFragmentToProseMirrorRootNode(b.getXmlFragment('body'), S);
}
/** No lone surrogate (Yjs stores UTF-8, so one cannot pass it; importBook replaces it first, see the model test). */
const isWellFormed = (t: string): boolean => t === Buffer.from(t, 'utf8').toString('utf8');

/** Lossless directly AND through Yjs, and no block fell back to raw because a check failed (raw only by design). */
const roundTrips = (t: string): void => {
  const st: ConvertStats = { blocks: 0, raw: 0, rawWhy: {} };
  const doc = toDoc(t, st);
  const back = toText(doc);
  if (back !== t) assert.fail(`not lossless: ${JSON.stringify(t).slice(0, 200)} -> ${JSON.stringify(back).slice(0, 200)}`);
  if (st.rawWhy.mismatch || st.rawWhy['doc-mismatch']) assert.fail(`check fallback fired: ${JSON.stringify(t).slice(0, 200)} ${JSON.stringify(st.rawWhy)}`);
  if (isWellFormed(t)) {
    const y = toText(throughYjs(doc));
    if (y !== t) assert.fail(`not lossless through Yjs: ${JSON.stringify(t).slice(0, 200)} -> ${JSON.stringify(y).slice(0, 200)}`);
  }
};

/** The text nodes of a document's blocks, as [text, mark names] pairs, for structure assertions. */
function runs(doc: Node): [string, string[]][] {
  const out: [string, string[]][] = [];
  doc.descendants((n) => { if (n.isText) out.push([n.text!, n.marks.map((m) => m.type.name)]); return true; });
  return out;
}
const types = (doc: Node): string[] => { const o: string[] = []; doc.forEach((b) => { o.push(b.type.name); }); return o; };

/* ---- the fixtures ---- */

/** Coverage measured when this test was written (blocks, raw), per fixture: the floor. Legacy fixtures are copies of real/reads-you.
 *  Step 5 wave 2a (headings, quotes and lists became nodes) raised it: four-kitchens raw 3 → 0, reads-you 26 → 16,
 *  salt-road-book-one 3 → 1, salt-road-standalone 8 → 5; the rest unchanged. */
const COVERAGE_FLOOR: Record<string, { blocks: number; raw: number }> = {
  'real/bookbinders-letter.json': { blocks: 33, raw: 2 },
  'real/dartagnan-01-three-musketeers.json': { blocks: 8117, raw: 0 },
  'real/four-kitchens-book-one.json': { blocks: 7, raw: 0 },
  'real/lantern-coast-book-one.json': { blocks: 96, raw: 0 },
  'real/lantern-coast-print.json': { blocks: 264, raw: 0 },
  'real/lunas-beach-standalone.json': { blocks: 36, raw: 0 },
  'real/oz-14-glinda.json': { blocks: 1114, raw: 0 },
  'real/reads-you.json': { blocks: 61, raw: 16 },
  'real/salt-road-book-one.json': { blocks: 20, raw: 1 },
  'real/salt-road-standalone.json': { blocks: 36, raw: 5 },
  'real/valois-02-chicot.json': { blocks: 7402, raw: 0 },
};
const share = (c: { blocks: number; raw: number }): number => (c.blocks ? (c.blocks - c.raw) / c.blocks : 1);

test('convert: every section of every fixture book round-trips byte for byte, directly and through Yjs', (t) => {
  let sections = 0, chars = 0;
  for (const { name, book } of fixtureBooks()) {
    for (const s of sectionsOf(book)) {
      if (typeof s.content !== 'string') continue;
      const doc = toDoc(s.content);
      assert.equal(toText(doc) === s.content, true, `${name} section ${String(s.id)}: not lossless`);
      assert.equal(toText(throughYjs(doc)) === s.content, true, `${name} section ${String(s.id)}: not lossless through Yjs`);
      sections++; chars += s.content.length;
    }
  }
  assert.ok(sections > 300, `only ${sections} sections`);
  t.diagnostic(`sections ${sections}, characters ${chars}`);
});

test('convert: coverage per fixture is at least the floor measured at commit time', (t) => {
  const rows: string[] = [];
  for (const { name, book } of fixtureBooks()) {
    const st: ConvertStats = { blocks: 0, raw: 0, rawWhy: {} };
    const cov = { blocks: 0, raw: 0 };
    for (const s of sectionsOf(book)) {
      if (typeof s.content !== 'string') continue;
      const c = blockCoverage(toDoc(s.content, st));
      cov.blocks += c.blocks; cov.raw += c.raw;
    }
    assert.deepEqual(cov, { blocks: st.blocks, raw: st.raw }, `${name}: blockCoverage and the convert stats disagree`);
    const floor = COVERAGE_FLOOR[name] ?? (name.startsWith('legacy/') ? COVERAGE_FLOOR['real/reads-you.json'] : undefined);
    if (name !== 'legacy/sections-missing.json') {
      assert.ok(floor, `${name}: no coverage floor recorded; add it`);
      assert.ok(share(cov) >= share(floor!), `${name}: coverage ${(share(cov) * 100).toFixed(2)}% fell below ${(share(floor!) * 100).toFixed(2)}%`);
    }
    rows.push(`${name}: ${cov.blocks} blocks, ${cov.raw} raw, ${(share(cov) * 100).toFixed(2)}% parsed ${JSON.stringify(st.rawWhy)}`);
  }
  for (const r of rows) t.diagnostic(r);
});

/* ---- review focus 1: whitespace ---- */

test('convert: whitespace survives (trailing spaces, CRLF, tabs, final newline, blank-line runs, leading spaces)', () => {
  const cases = [
    '', ' ', '\n', '\n\n\n', '\t', '\r\n', '\r', 'a\r', '\ra',
    'one', 'one\n', 'one\n\n', 'one\n\n\n\n', '\n\none',
    'trailing   \nspaces \t\n\nnext  ',
    'a\r\nb\r\n\r\nc\r\n', 'a\r\n\r\n\r\n\r\nb', 'mixed\r\n\nends\n\r\n',
    'tab\there\n\tindented\n\n\t\tdouble',
    'one blank\n\ntwo blanks\n\n\nthree blanks\n\n\n\nfour\n\n\n\n\nend',
    '  leading two\n    four\n\n      six',
    'I went down.\n  One step.\n    Another step.\n      Another.',
    '   \n  \n\t\n', 'x\n \n\t\ny', 'last line no newline', '***\n\n\n',
  ];
  for (const c of cases) roundTrips(c);
  // blank-line runs are kept exactly, as each block's pre
  const d = toDoc('a\n\nb\n\n\nc\n\n\n\nd');
  assert.deepEqual(types(d), ['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  const pres: unknown[] = []; d.forEach((b) => { pres.push(b.attrs.pre); });
  assert.deepEqual(pres, [null, null, '\n\n\n', '\n\n\n\n']);
  // a final newline is the last block's post
  assert.equal(toDoc('a\n').firstChild!.attrs.post, '\n');
});

/* ---- review focus 2: nesting and edge syntax ---- */

test('convert: nesting and edge syntax survive, and the common nestings are modelled', () => {
  const cases = [
    'un*balanced', '*', '**', '***', '****', '* * *', 'a * b * c', 'a** b', '*open', 'close*', '**bold', 'Milady* to be seen',
    '**_x_**', '_x_', '__x__', '*x**', '**x*', '*a**b*', '***x***', '***x** y*', '*x **y***',
    '*see[^1]*', '**see[^1]**', '*a [^1] b [2] c*', '[^1]', '[1]', '[^1000]',
    '::: center\nunclosed to the end\n\nmore', '::: verse\nno close', ':::', '::: center\n:::', '::: center', '::: center\n\n:::\n',
    '::: right\na\n::: center\nb\n:::', 'text\n:::\ntext', '::: Center x y \nA\n:::  ',
    '> quote\n>\n> after a blank quote line', '> a\n\n> b', '>no space', '> — attribution\n> line',
    '- item one\n  continued\n- item two', '1. one\n2. two\ncontinued', '- lone dash line', '* a\n* b',
    '# Heading', '## Sub *em*', '### three', '[x](https://example.com/a_(b)_c)', '[*x*](mailto:a@b.c)', '*[x](https://u)*',
    '![alt](img:abc)', '![alt](img:abc|full)', '![a](img:x  “Cap”)', '![a](img:x "Cap")', 'text ![a](img:x) text', 'a\n![a](img:x)\nb',
    '[^1]: def one\n[^2]: def two', '[^1]:', '[^1]:   spaced', '[3]: bare def', '[^1]: multi\nline def',
    '||redacted *x*||', '||a|| ||b||', '|| not ||', '[a](note:slug)', 'x\n***\ny', '❦', '⁂', '#', '---', '___', '###',
  ];
  for (const c of cases) roundTrips(c);

  // the spike's lost-italic bug: a reference inside emphasis keeps the emphasis
  assert.deepEqual(runs(toDoc('*see[^1]* more')), [['see', ['em']], ['[^1]', ['em', 'footnoteRef']], [' more', []]]);
  assert.deepEqual(runs(toDoc('**_x_**')), [['_x_', ['strong']]]);
  assert.deepEqual(runs(toDoc('***x***')), [['x', ['em', 'strong']]]);
  assert.deepEqual(runs(toDoc('un*balanced')), [['un*balanced', []]]);
  assert.deepEqual(runs(toDoc('[*T*](https://u.org/x)')).map(([s, m]) => [s, m]), [['T', ['link', 'em']]]);
  // em runs over a line break in a paragraph (1.0 joins its lines), the "\n" stays in the text
  assert.deepEqual(runs(toDoc('a *b\nc* d')), [['a ', []], ['b\nc', ['em']], [' d', []]]);

  // ::: with no close runs to the end (parseContainers), and center content is ordinary blocks
  const c1 = toDoc('::: center\nHi *there*\n\nTwo');
  assert.deepEqual(types(c1), ['container']);
  assert.equal(c1.firstChild!.attrs.close, null);
  assert.equal(c1.firstChild!.childCount, 2);
  // other kinds stay raw; quotes, lists and headings are nodes since wave 2a
  assert.deepEqual(types(toDoc('::: verse\na\n  b\n:::')), ['rawBlock']);
  assert.deepEqual(types(toDoc('> quote\n>\n> blank line inside')), ['quote']);
  assert.deepEqual(types(toDoc('- one\n  continued\n- two')), ['list']);
  // a note definition starts its own block, as beautifyText splits it
  assert.deepEqual(types(toDoc('[^1]: one\n[^2]: two')), ['footnoteDef', 'footnoteDef']);
  // a picture line stands alone even inside a run of lines
  assert.deepEqual(types(toDoc('a\n![p](img:x)\nb')), ['paragraph', 'image', 'paragraph']);
  assert.deepEqual(types(toDoc('x\n\n***\n\ny')), ['paragraph', 'sceneBreak', 'paragraph']);
});

/* ---- step 5 wave 2a (B6): headings, quotes and lists are nodes ---- */

test('convert: headings, quotes and lists are nodes, read as 1.0\'s emitText reads them, and round-trip', () => {
  const cases = [
    '# One', '## Two', '# a *b* c\nsecond line', '## **x** [l](https://u.v) [^1]', '#no space', '### three', '# ', '## ',
    '> a\n> b', '>a\n>  b\n>\tc', '>', '> *x*\n> — Name', '> a\r\n> b\r', '>\r\n> x', '> [l](https://a.b)\n> **y**',
    '- a\n- b', '* a\n* b', '• a\n• b', '- a\n  more\n- b', '1. a\n2. b', '3) c\nmore\n4) d', '1. x\n- y', '10.  wide\n11.\tTab',
    '- a\r\n- b\r\n', '- *a\n  b* c\n- d', '- a\n1. b', '-\r\n- x', '- \r\n- y',
    'p\n\n# h\n\n> q\n\n- l\n- m\n\nend', '::: center\n# h\n\n- a\n- b\n:::',
  ];
  for (const c of cases) roundTrips(c);
  assert.deepEqual(types(toDoc('# One\n\n## Two')), ['heading', 'heading']);
  assert.deepEqual(toDoc('# One\n\n## Two').content.content.map((h) => h.attrs.level), [1, 2]);
  assert.deepEqual(types(toDoc('### three')), ['paragraph']); // 1.0: neither "## " nor "# "
  assert.deepEqual(types(toDoc('- lone dash line')), ['paragraph']); // a bulleted list needs two items
  assert.deepEqual(types(toDoc('- a\n1. b')), ['paragraph']); // a numbered line inside a bulleted list: not a list
  // a quote: one line per line, its ">" and one whitespace character as the prefix
  const q = toDoc('>a\n>  b\n> *c*').firstChild!;
  assert.equal(q.type.name, 'quote');
  assert.deepEqual(q.content.content.map((l) => [l.attrs.prefix, l.textContent]), [['>', 'a'], ['> ', ' b'], ['> ', 'c']]);
  assert.deepEqual(runs(toDoc('> *c*')), [['c', ['em']]]);
  // a list: each marked line an item, its marker as written; an unmarked line continues the item ("\n" kept)
  const l = toDoc('3) c\nmore\n4) d').firstChild!;
  assert.equal(l.type.name, 'list');
  assert.deepEqual(l.content.content.map((i) => [i.attrs.marker, i.textContent]), [['3) ', 'c\nmore'], ['4) ', 'd']]);
  // emphasis runs over an item's continuation line (1.0 joins it with a space first)
  assert.deepEqual(runs(toDoc('- *a\n  b* c\n- d')), [['a\n  b', ['em']], [' c', []], ['d', []]]);
  // a heading's emphasis does not run over a line break (1.0 reads the heading's text as is)
  assert.deepEqual(types(toDoc('# *a\nb*')), ['heading']);
  assert.deepEqual(runs(toDoc('# *a\nb*')), [['*a\nb*', []]]);
  // a quote, a list, a heading inside a centre container are nodes too
  assert.deepEqual(types(S.node('doc', null, toDoc('::: center\n# h\n\n- a\n- b\n:::').firstChild!.content.content as Node[])), ['heading', 'list']);
});

/* ---- review focus 3: Unicode ---- */

test('convert: Unicode survives exactly (RTL, Devanagari, ZWJ emoji, combining marks, NBSP, soft hyphen)', () => {
  const cases = [
    'مرحبا بالعالم. *هذا نص مائل* و**غامق**.\n\nفقرة ثانية[^1]\n\n[^1]: حاشية',
    'नमस्ते दुनिया। *क्षत्रिय* और **ज्ञान**',
    'family 👨‍👩‍👧‍👦 and flag 🏳️‍🌈 and skin 👋🏽 *em 🧑‍🚀*',
    'combining: é ä ñ Z̵̡̢ — *cáfé*',
    'no break spaces *in em*\n\n \n\nafter an NBSP-only line',
    'soft­hyphen­ *hy­phen*',
    'lone surrogate \ud800 stays', '﻿BOM first', 'zero​width‍joiner‌', 'RTL mark ‏ and LRM ‎',
    ' line separator paragraph separator',
  ];
  for (const c of cases) roundTrips(c);
  assert.deepEqual(runs(toDoc('*em 🧑‍🚀*')), [['em 🧑‍🚀', ['em']]]);
});

/* ---- every string, not just the ones written down ---- */

test('convert: random markup soup round-trips (5000 strings), directly and through Yjs, with no check fallback', () => {
  const alphabet = ['*', '**', '_', '[', ']', '(', ')', '^', '1', '12', ':', '::: center', '::: verse', ':::', '!', '|', '||', '>', '- ', '1. ', '#', '## ',
    '\n', '\n\n', '\r\n', ' ', '\t', 'a', 'word', '::: right', '::: Center x', 'https://x.y', 'mailto:a@b', 'img:', 'note:s', '“', '”', '"', '❦', '***', ' ', 'é', '👨‍👩‍👧'];
  let seed = 20261031;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
  for (let i = 0; i < 5000; i++) {
    let s = '';
    const len = 1 + rnd(40);
    for (let k = 0; k < len; k++) s += alphabet[rnd(alphabet.length)];
    roundTrips(s);
  }
});

/* ---- review focus 4: size ---- */

test('convert: the 240k-word Dumas fixture converts and round-trips in time, and converting is linear', (t) => {
  const env = JSON.parse(readFileSync(fixturePath('real', 'dartagnan-01-three-musketeers.json'), 'utf8')) as { book: unknown };
  const texts = sectionsOf(env.book).map((s) => s.content).filter((c): c is string => typeof c === 'string');
  const all = texts.join('\n\n');
  const words = all.split(/\s+/).filter(Boolean).length;
  assert.ok(words > 200_000, `only ${words} words`);

  const time = (fn: () => void): number => { let best = Infinity; for (let r = 0; r < 3; r++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0); } return best; };
  let docs: Node[] = [];
  const toDocMs = time(() => { docs = texts.map((x) => toDoc(x)); });
  const toTextMs = time(() => { docs.forEach((d, i) => { if (toText(d) !== texts[i]) assert.fail('Dumas section not lossless'); }); });
  // linear: four times the text takes about four times as long (quadratic would be sixteen)
  const one = time(() => { toDoc(all); });
  const four = time(() => { toDoc(all + '\n\n' + all + '\n\n' + all + '\n\n' + all); });
  t.diagnostic(`Dumas: ${words} words, ${all.length} chars, ${texts.length} sections; toDoc ${toDocMs.toFixed(0)} ms, toText ${toTextMs.toFixed(0)} ms (best of 3)`);
  t.diagnostic(`one string ${one.toFixed(0)} ms, four times the text ${four.toFixed(0)} ms, ratio ${(four / one).toFixed(2)}`);
  assert.ok(toDocMs + toTextMs < 3000, `Dumas round trip took ${(toDocMs + toTextMs).toFixed(0)} ms (budget 3000 ms)`);
  assert.ok(four / one < 8, `4x text took ${(four / one).toFixed(1)}x as long: not linear`);
});

/* ---- the full corpus, when there is one ---- */

const corpusDir = process.env.BEUK_BOOK_CORPUS;
function* backupFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* backupFiles(full);
    else if (e.name.endsWith('.beuk-backup.json')) yield full;
  }
}

test('convert: full corpus round-trips (BEUK_BOOK_CORPUS)', { skip: corpusDir ? false : 'set BEUK_BOOK_CORPUS to a folder of *.beuk-backup.json' }, (t) => {
  let books = 0, sections = 0;
  const st: ConvertStats = { blocks: 0, raw: 0, rawWhy: {} };
  for (const file of backupFiles(corpusDir!)) {
    const name = path.relative(corpusDir!, file).split(path.sep).join('/');
    const book = (JSON.parse(readFileSync(file, 'utf8')) as { book: unknown }).book;
    for (const s of sectionsOf(book)) {
      if (typeof s.content !== 'string') continue;
      assert.equal(toText(toDoc(s.content, st)) === s.content, true, `${name} section ${String(s.id)}: not lossless`);
      sections++;
    }
    books++;
  }
  assert.ok(books > 0, 'no *.beuk-backup.json found under BEUK_BOOK_CORPUS');
  t.diagnostic(`books ${books}, sections ${sections}, blocks ${st.blocks}, raw ${st.raw} (${(share(st) * 100).toFixed(2)}% parsed) ${JSON.stringify(st.rawWhy)}`);
});

/* ---- fix round 1: Yjs attrs, schema, editing ---- */

test('convert: an unclosed container keeps close null through Yjs (y-prosemirror never stores a null attr)', () => {
  assert.equal(S.nodes.container!.spec.attrs!.close!.default, null);
  for (const t of ['::: center\nHello', '::: right\nA\n\nB', '::: center\n', '::: center', 'x\n\n::: center\nHello\n\n', '::: center\nA\n::: right\nB']) {
    roundTrips(t);
    assert.equal(toText(throughYjs(toDoc(t))), t);
  }
  assert.equal(throughYjs(toDoc('::: center\nHello\n:::')).firstChild!.attrs.close, ':::');
});

test('convert: every attr whose meaningful value can be null defaults to null', () => {
  const nullable: string[] = [];
  for (const [name, type] of Object.entries(S.nodes))
    for (const [attr, spec] of Object.entries(type.spec.attrs ?? {}))
      if (spec.default === null) nullable.push(`${name}.${attr}`);
  assert.deepEqual(nullable.sort(), ['container.close', 'container.pre', 'footnoteDef.pre', 'heading.pre', 'image.caption', 'image.pre', 'list.pre', 'paragraph.pre', 'quote.pre', 'rawBlock.pre', 'sceneBreak.pre']);
});

test('convert: paragraph and footnoteDef declare whitespace "pre" (prosemirror-view keeps their line breaks)', () => {
  assert.equal(S.nodes.paragraph!.spec.whitespace, 'pre');
  assert.equal(S.nodes.footnoteDef!.spec.whitespace, 'pre');
});

test('convert: post is written for the last child only (a split copies attrs)', () => {
  const p = (text: string, post: string) => S.node('paragraph', { pre: null, post }, [S.text(text)]);
  const doc = S.node('doc', null, [p('one', '\n\n\n'), p('two', '  '), p('three', '\n')]);
  assert.equal(toText(doc), 'one\n\ntwo\n\nthree\n');
  assert.equal(blocksText(S.node('container', { close: ':::' }, [p('a', 'X'), p('b', '\n')])), 'a\n\nb\n');
});

/* Random edited documents: random blocks, attrs, text and marks, including what 1.0's text cannot say back. */
function randomDocs(count: number, seed0: number): Node[] {
  let seed = seed0;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
  const pick = <T>(a: T[]): T => a[rnd(a.length)]!;
  const ALPHA = ['*', '**', 'a', 'word', ' ', '\n', '\n\n', '[', ']', '(', ')', '^1', '||', '::: center', ':::', '- ', '# ', '>', 'é', '\t', '  ', 'https://x.y', '!', 'img:', '1. ', '2*3', '❦'];
  const str = (max: number): string => { let s = ''; const k = rnd(max); for (let i = 0; i < k; i++) s += pick(ALPHA); return s; };
  const marks = () => {
    const m = [];
    if (rnd(3) === 0) m.push(S.marks.em!.create());
    if (rnd(4) === 0) m.push(S.marks.strong!.create());
    if (rnd(6) === 0) m.push(S.marks.link!.create({ href: pick(['https://u', 'mailto:a@b', 'ftp://x', 'https://a b']) }));
    if (rnd(8) === 0) m.push(S.marks.footnoteRef!.create());
    if (rnd(8) === 0) m.push(S.marks.rawInline!.create());
    return m;
  };
  const inline = (): Node[] => { const out: Node[] = []; const k = rnd(5); for (let i = 0; i < k; i++) { const t = str(6); if (t) out.push(S.text(t, marks())); } return out; };
  const edges = () => ({ pre: pick([null, null, null, '', '\n', '\n\n\n', ' \n\n', '\n  ']), post: pick(['', '', '\n', ' ']) });
  const block = (depth: number): Node => {
    switch (rnd(depth ? 10 : 9)) {
      case 0: case 1: return S.node('paragraph', edges(), inline());
      case 2: { const t = str(6); return S.node('rawBlock', edges(), t ? [S.text(t)] : []); }
      case 3: return S.node('sceneBreak', { ...edges(), raw: pick(['***', '❦', 'x', '---']) });
      case 4: return S.node('image', { ...edges(), alt: pick(['a', 'a]b', '']), id: pick(['x', '', 'a b']), full: rnd(2) === 0, caption: pick([null, 'cap', 'c"d']) });
      case 5: return S.node('footnoteDef', { ...edges(), n: pick(['1', '22']), caret: rnd(2) === 0, gap: pick([' ', '', '\n']) }, inline());
      // wave 2a: headings, quotes, lists (with prefixes and markers 1.0 would not read, as an edit can leave them)
      case 6: return S.node('heading', { ...edges(), level: pick([1, 2, 3]) }, inline());
      case 7: case 8: {
        const quote = rnd(2) === 0;
        const kids: Node[] = [];
        const k = 1 + rnd(3);
        for (let i = 0; i < k; i++) {
          kids.push(quote
            ? S.node('quoteLine', { prefix: pick(['> ', '>', '>\t', '> ', 'x']) }, inline())
            : S.node('listItem', { marker: pick(['- ', '* ', '• ', '1. ', '2) ', '10.  ', '-', 'x ']) }, inline()));
        }
        return S.node(quote ? 'quote' : 'list', edges(), kids);
      }
      default: {
        const kids: Node[] = [];
        const k = 1 + rnd(3);
        for (let i = 0; i < k; i++) kids.push(block(0));
        return S.node('container', { ...edges(), open: pick(['::: center', '::: right', '::: verse', 'x']), openEol: pick(['\n', '']), close: pick([null, ':::', 'zz']) }, kids);
      }
    }
  };
  const out: Node[] = [];
  for (let it = 0; it < count; it++) {
    const kids: Node[] = [];
    const k = 1 + rnd(5);
    for (let i = 0; i < k; i++) kids.push(block(1));
    out.push(S.node('doc', null, kids));
  }
  return out;
}

test('convert: normalizeBlock is idempotent, and a normalised document reads back as itself (5000 random edited docs)', () => {
  for (const d0 of randomDocs(5000, 20261101)) {
    const d = normalizeDoc(d0);
    for (let i = 0; i < d.childCount; i++) {
      assert.equal(normalizeBlock(d, i), null, `not idempotent at ${i}: ${JSON.stringify(toText(d0))}`);
      const c = d.child(i);
      if (c.type.name === 'container') for (let j = 0; j < c.childCount; j++) assert.equal(normalizeBlock(c, j), null, `container child ${j}: ${JSON.stringify(toText(d0))}`);
    }
    assert.ok(toDoc(toText(d)).eq(d), `toDoc(toText(d)) differs from d: ${JSON.stringify(toText(d0))}`);
    assert.ok(throughYjs(d).eq(d), 'a normalised document changes through Yjs');
  }
});

test('convert: normalizeBlock re-reads what the writer typed the way the next open would', () => {
  const para = (text: string) => S.node('doc', null, [S.node('paragraph', null, [S.text(text)])]);
  // typed "2*3 and 4*5" reopens in italics: normalize shows it now
  const f = normalizeBlock(para('2*3 and 4*5'), 0);
  assert.ok(f && f !== 'up');
  assert.deepEqual(f.blocks[0]!.toJSON().content, [{ type: 'text', text: '2' }, { type: 'text', marks: [{ type: 'em' }], text: '3 and 4' }, { type: 'text', text: '5' }]);
  // a blank line typed inside a paragraph makes two paragraphs
  const g = normalizeBlock(para('one\n\ntwo'), 0);
  assert.ok(g && g !== 'up');
  assert.deepEqual(g.blocks.map((b) => b.textContent), ['one', 'two']);
  // a ":::" line typed inside a container restructures its parent: normalize the container in its own parent
  const cont = toDoc('::: center\nA\n\nB\n:::').firstChild!;
  const typed = cont.copy(cont.content.replaceChild(0, S.node('paragraph', null, [S.text('A\n:::')])));
  assert.equal(normalizeBlock(typed, 0), 'up');
  // already normal: nothing to do
  assert.equal(normalizeBlock(toDoc('plain *em* text\n\nmore'), 1), null);
});

test('convert: canApplyMark / canSetLink refuse a mark the text cannot write back', () => {
  const em = S.marks.em!.create(), strong = S.marks.strong!.create();
  const star = S.node('paragraph', null, [S.text('2*3 and more')]);
  assert.equal(canApplyMark(star, 0, 3, em), false); // over a "*"
  assert.equal(canApplyMark(star, 0, 3, strong), false);
  assert.equal(canApplyMark(star, 4, 7, em), false); // "*and*" would pair with the lone "*" before it
  const p = S.node('paragraph', null, [S.text('2x3 and plain [x] words')]);
  assert.equal(canApplyMark(p, 4, 7, em), true); // "and"
  assert.equal(canApplyMark(p, 8, 13, strong), true); // "plain"
  assert.equal(canSetLink(p, 8, 13, 'https://example.com/a'), true);
  assert.equal(canSetLink(p, 8, 13, 'ftp://example.com'), false); // 1.0 reads no other scheme
  assert.equal(canSetLink(p, 8, 13, 'https://a b'), false);
  assert.equal(canSetLink(p, 14, 17, 'https://example.com'), false); // a label with "]"
  assert.equal(canSetLink(S.node('paragraph', null, [S.text('one\ntwo')]), 0, 7, 'https://example.com'), false); // a label with a line break
  const touching = S.node('paragraph', null, [S.text('ab', [em]), S.text('cd')]);
  assert.equal(canApplyMark(touching, 2, 4, em), true); // extends the same em
  assert.equal(canApplyMark(S.node('rawBlock', null, [S.text('x')]), 0, 1, em), false);
});
