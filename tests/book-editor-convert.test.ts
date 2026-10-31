import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import type { Node } from 'prosemirror-model';
import { fixturePath } from './book-fixtures.js';
import { blockCoverage, toDoc, toText, type ConvertStats } from '../src/book/editor/convert.js';

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

const roundTrips = (t: string): void => {
  const back = toText(toDoc(t));
  if (back !== t) assert.fail(`not lossless: ${JSON.stringify(t).slice(0, 200)} -> ${JSON.stringify(back).slice(0, 200)}`);
};

/** The text nodes of a document's blocks, as [text, mark names] pairs, for structure assertions. */
function runs(doc: Node): [string, string[]][] {
  const out: [string, string[]][] = [];
  doc.descendants((n) => { if (n.isText) out.push([n.text!, n.marks.map((m) => m.type.name)]); return true; });
  return out;
}
const types = (doc: Node): string[] => { const o: string[] = []; doc.forEach((b) => { o.push(b.type.name); }); return o; };

/* ---- the fixtures ---- */

/** Coverage measured when this test was written (blocks, raw), per fixture: the floor. Legacy fixtures are copies of real/reads-you. */
const COVERAGE_FLOOR: Record<string, { blocks: number; raw: number }> = {
  'real/bookbinders-letter.json': { blocks: 33, raw: 2 },
  'real/dartagnan-01-three-musketeers.json': { blocks: 8117, raw: 0 },
  'real/four-kitchens-book-one.json': { blocks: 7, raw: 3 },
  'real/lantern-coast-book-one.json': { blocks: 96, raw: 0 },
  'real/lantern-coast-print.json': { blocks: 264, raw: 0 },
  'real/lunas-beach-standalone.json': { blocks: 36, raw: 0 },
  'real/oz-14-glinda.json': { blocks: 1114, raw: 0 },
  'real/reads-you.json': { blocks: 61, raw: 26 },
  'real/salt-road-book-one.json': { blocks: 20, raw: 3 },
  'real/salt-road-standalone.json': { blocks: 36, raw: 8 },
  'real/valois-02-chicot.json': { blocks: 7402, raw: 0 },
};
const share = (c: { blocks: number; raw: number }): number => (c.blocks ? (c.blocks - c.raw) / c.blocks : 1);

test('convert: every section of every fixture book round-trips byte for byte', (t) => {
  let sections = 0, chars = 0;
  for (const { name, book } of fixtureBooks()) {
    for (const s of sectionsOf(book)) {
      if (typeof s.content !== 'string') continue;
      const back = toText(toDoc(s.content));
      assert.equal(back === s.content, true, `${name} section ${String(s.id)}: not lossless`);
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
  // other kinds stay raw; quotes, lists and headings are raw in v1
  assert.deepEqual(types(toDoc('::: verse\na\n  b\n:::')), ['rawBlock']);
  assert.deepEqual(types(toDoc('> quote\n>\n> blank line inside')), ['rawBlock']);
  assert.deepEqual(types(toDoc('- one\n  continued\n- two')), ['rawBlock']);
  // a note definition starts its own block, as beautifyText splits it
  assert.deepEqual(types(toDoc('[^1]: one\n[^2]: two')), ['footnoteDef', 'footnoteDef']);
  // a picture line stands alone even inside a run of lines
  assert.deepEqual(types(toDoc('a\n![p](img:x)\nb')), ['paragraph', 'image', 'paragraph']);
  assert.deepEqual(types(toDoc('x\n\n***\n\ny')), ['paragraph', 'sceneBreak', 'paragraph']);
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

test('convert: random markup soup round-trips (5000 strings)', () => {
  const alphabet = ['*', '**', '_', '[', ']', '(', ')', '^', '1', '12', ':', '::: center', '::: verse', ':::', '!', '|', '||', '>', '- ', '1. ', '#', '## ',
    '\n', '\n\n', '\r\n', ' ', '\t', 'a', 'word', 'https://x.y', 'mailto:a@b', 'img:', 'note:s', '“', '”', '"', '❦', '***', ' ', 'é', '👨‍👩‍👧'];
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
