import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Node } from 'prosemirror-model';
import { fixturePath } from './book-fixtures.js';
import { toDoc, toText } from '../src/book/editor/convert.js';
import { bookSchema as S } from '../src/book/editor/schema.js';
import { posToTextOffset, textOffsetToPos } from '../src/book/editor/positions.js';

/* BEUK:editor-positions — text offsets <-> ProseMirror positions, defined
   against toText (src/book/editor/positions.ts). Over every section of
   every fixture book and the review cases:
   - posToTextOffset is total and never decreases;
   - every k-th offset o: posToTextOffset(textOffsetToPos(o)) is o when o is
     representable, else the nearest representable offset BELOW o (floor;
     the first cursor offset when o is below them all);
   - inside a text node, the text between two neighbouring positions holds
     exactly the character between them (plus delimiters only), so the
     offsets point at the right place in the string;
   - splitting toText at a mapped offset is 1.0's string split: the two
     halves join back to the text, and the half before ends with the
     document's text before the cursor (delimiters aside). */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function sectionsOf(book: unknown): Rec[] {
  if (!isRec(book)) return [];
  const s = book.sections;
  if (Array.isArray(s)) return s.filter(isRec);
  if (isRec(s)) return (['frontMatter', 'body', 'backMatter'] as const).flatMap((k) => (Array.isArray(s[k]) ? (s[k] as unknown[]).filter(isRec) : []));
  return [];
}

function fixtureTexts(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const dir of ['real', 'legacy'])
    for (const f of readdirSync(fixturePath(dir)).filter((x) => x.endsWith('.json')).sort()) {
      const book = (JSON.parse(readFileSync(fixturePath(dir, f), 'utf8')) as { book: unknown }).book;
      sectionsOf(book).forEach((s, i) => {
        if (typeof s.content === 'string') out.push({ where: `${dir}/${f}#${i}`, text: s.content });
      });
    }
  return out;
}

const CASES = [
  '', 'One.', '  lead\n\nTwo.  \n', 'a *b* c', '**bold** and *em*', '[a link](https://x.example) after',
  'Text.[^1]\n\n[^1]: The note.', 'Ref [2] here.\n\n[2]:  Gap note.', '***', '❦\n\nAfter the ornament.',
  '![A lamp](img:p1 "The lamp")\n\nUnder it.', '::: center\nCentred.\n\nStill.\n:::\n\nAfter.', '::: center\nRuns to the end.',
  '::: verse\nraw lines\n  kept\n:::', '# A heading\n\nBody.', '- one\n- two', '> quote\n> more', '||secret|| words',
  '[note link](note:abc) here', 'Line one\nline two\r\nline three', '*em over\na break*', '\n\n\n', 'x\n\n\n\ny',
  '**[bold link](https://a.b)**', '[*em label*](mailto:a@b.c) x', '*a**b*', 'Emoji 😀 and ü.',
];

/** Every cursor position (a textblock position) of a document with its offset. */
function cursorOffsets(doc: Node): { pos: number; off: number }[] {
  const out: { pos: number; off: number }[] = [];
  for (let p = 0; p <= doc.content.size; p++) {
    const r = doc.resolve(p);
    if (r.parent.isTextblock) out.push({ pos: p, off: posToTextOffset(doc, p) });
  }
  return out;
}

function check(where: string, text: string, step: number): void {
  const doc = toDoc(text);
  assert.equal(toText(doc), text, `${where}: lossless`);
  const size = doc.content.size;
  let prev = -1;
  for (let p = 0; p <= size; p++) {
    const o = posToTextOffset(doc, p);
    assert.ok(o >= prev && o >= 0 && o <= text.length, `${where}: offset of pos ${p} (${o}) is in order and in range`);
    prev = o;
  }
  assert.equal(posToTextOffset(doc, size), text.length, `${where}: the end of the document is the end of the text`);

  const cursors = cursorOffsets(doc);
  const reps = cursors.length ? cursors : Array.from({ length: size + 1 }, (_, pos) => ({ pos, off: posToTextOffset(doc, pos) }));
  const floor = (o: number): number => {
    let best = -1;
    for (const c of reps) if (c.off <= o && c.off > best) best = c.off;
    return best >= 0 ? best : reps[0]!.off;
  };
  for (let o = 0; o <= text.length; o += step) {
    const p = textOffsetToPos(doc, o);
    assert.equal(posToTextOffset(doc, p), floor(o), `${where}: offset ${o} maps back to its floor`);
    if (cursors.length) assert.ok(doc.resolve(p).parent.isTextblock, `${where}: offset ${o} gives a cursor position`);
  }
  // every representable offset maps back exactly
  for (const c of cursors) assert.equal(posToTextOffset(doc, textOffsetToPos(doc, c.off)), c.off, `${where}: offset ${c.off} is exact`);

  // inside a text node: the text between neighbouring positions holds the character between them
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    const s = n.text!;
    for (let k = 0; k < s.length; k++) {
      const a = posToTextOffset(doc, pos + k), b = posToTextOffset(doc, pos + k + 1);
      const seg = text.slice(a, b);
      assert.ok(seg.includes(s[k]!), `${where}: pos ${pos + k}..${pos + k + 1} segment ${JSON.stringify(seg)} holds ${JSON.stringify(s[k])}`);
    }
    return false;
  });

  // a split at a cursor's offset: the halves join back, and the first ends with the plain text before the cursor
  for (const c of cursors.filter((_, i) => i % step === 0)) {
    const before = text.slice(0, c.off), after = text.slice(c.off);
    assert.equal(before + after, text);
    const r = doc.resolve(c.pos);
    const plainBefore = r.parent.textBetween(0, r.parentOffset);
    if (!r.parent.type.spec.code && /[*[\]()]/.test(text)) continue; // delimiters interleave with the plain text
    assert.ok(before.endsWith(plainBefore), `${where}: text before pos ${c.pos} ends with ${JSON.stringify(plainBefore.slice(-20))}`);
  }
}

test('positions: review cases, every offset', () => {
  for (const [i, text] of CASES.entries()) check(`case ${i} ${JSON.stringify(text)}`, text, 1);
});

test('positions: every fixture section, every k-th offset', () => {
  const texts = fixtureTexts();
  assert.ok(texts.length > 100, `fixture sections found (${texts.length})`);
  for (const { where, text } of texts) check(where, text, Math.max(1, Math.floor(text.length / 400)));
});

test('positions: the documented cases', () => {
  // "a *b* c": the position before "b" counts the text before the opening "*"; after "b", the closing one
  const d = toDoc('a *b* c');
  assert.equal(posToTextOffset(d, 1), 0);
  assert.equal(posToTextOffset(d, 3), 2); // before "b": "a " written, "*" not
  assert.equal(posToTextOffset(d, 4), 5); // after "b": "*" closed
  assert.equal(textOffsetToPos(d, 3), 3); // inside the opening delimiter: floor to before it
  // a note definition: its prefix is not a cursor offset
  const n = toDoc('Text.\n\n[^1]: Note.');
  const defStart = n.child(0).nodeSize + 1;
  assert.equal(posToTextOffset(n, defStart), 'Text.\n\n[^1]: '.length);
  assert.equal(textOffsetToPos(n, 'Text.\n\n['.length), n.child(0).nodeSize - 1); // inside the prefix: end of "Text."
  // an atom: offsets inside its source floor to the cursor before it
  const im = toDoc('One.\n\n![x](img:a)\n\nTwo.');
  assert.equal(textOffsetToPos(im, 'One.\n\n![x'.length), 5); // end of "One."
  // a document of atoms only: every position counts
  const a = toDoc('***');
  assert.equal(posToTextOffset(a, 0), 0);
  assert.equal(posToTextOffset(a, 1), 3);
  assert.equal(textOffsetToPos(a, 2), 0);
});

/* ---- fix round 1: nested marks (several opening on one character) ----
   inlineText opens the longest-running mark first; positions.ts must open them in the very same order (one shared
   function, convert.ts openingOrder), or the offsets drift by the delimiters closed and reopened. */

const nested = ['***x* y**', '***x** y*', '**_x_ y**', '*[**a b**](https://e.x/a) c*', '[*a* **b c**](https://e.x/b) d', '**[a](https://e.x/a) *b***', 'p ***q*** r *s **t** u* v'];

test('positions: nested marks, every offset (fix round 1)', () => {
  for (const [i, text] of nested.entries()) {
    const doc = toDoc(text);
    assert.equal(toText(doc), text);
    check(`nested ${i} ${JSON.stringify(text)}`, text, 1);
  }
  // the reported case: bold "x y" with italic "x" writes "***x* y**", 9 characters, and the block ends at 9
  const d = S.node('doc', null, [S.node('paragraph', null, [
    S.text('x', [S.marks.em!.create(), S.marks.strong!.create()]), S.text(' y', [S.marks.strong!.create()]),
  ])]);
  assert.equal(toText(d), '***x* y**');
  assert.equal(posToTextOffset(d, d.child(0).nodeSize - 1), 9);
  assert.equal(posToTextOffset(d, 2), 5); // after "x": the em closed, the strong still open
});

/* A seeded random doc: paragraphs of short letter runs, each under a random set of em / strong / link marks. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomDoc(r: () => number): Node {
  const hrefs = ['https://e.x/a', 'https://e.x/b'];
  const paras: Node[] = [];
  const np = 1 + Math.floor(r() * 3);
  for (let p = 0; p < np; p++) {
    const runs: Node[] = [];
    const nr = 1 + Math.floor(r() * 6);
    for (let k = 0; k < nr; k++) {
      let t = '';
      const len = 1 + Math.floor(r() * 4);
      for (let c = 0; c < len; c++) t += 'abcd e'[Math.floor(r() * 6)];
      const ms = [];
      if (r() < 0.45) ms.push(S.marks.em!.create());
      if (r() < 0.45) ms.push(S.marks.strong!.create());
      if (r() < 0.3) ms.push(S.marks.link!.create({ href: hrefs[Math.floor(r() * 2)] }));
      runs.push(S.text(t, ms));
    }
    paras.push(S.node('paragraph', null, runs));
  }
  return S.node('doc', null, paras);
}
/** Trailing closing delimiters ("*", "**", "](href)") of a text that ends inside a run of letters. */
const stripClosers = (s: string): string => s.replace(/(?:\*|\]\([^)]*\))+$/, '');

test('positions: random marked documents, checked against toText of the document cut at each position (fix round 1)', () => {
  const r = rng(20261031);
  let blocks = 0, inner = 0, bounds = 0;
  for (let n = 0; n < 400; n++) {
    const doc = randomDoc(r);
    const T = toText(doc);
    doc.forEach((para, pos) => {
      // the end of each block: the cut document's text is exactly the text up to there
      const end = pos + para.nodeSize - 1;
      assert.equal(posToTextOffset(doc, end), toText(doc.cut(0, end)).length, `${JSON.stringify(T)}: end of block at ${end}`);
      blocks++;
      para.forEach((kid, off) => {
        const start = pos + 1 + off;
        // inside a text node: the cut text, less the closers the cut adds, is the text before that character
        for (let c = 1; c < kid.text!.length; c++) {
          const L = toText(doc.cut(0, start + c));
          assert.equal(posToTextOffset(doc, start + c), stripClosers(L).length, `${JSON.stringify(T)}: inside a run at ${start + c}`);
          // (only the LENGTH is compared: in the cut document a run may be shorter, so marks opening together can open
          // in another order there — the same delimiters, the same count of characters)
          inner++;
        }
        // a run boundary: at or after the plain text before it, only closing delimiters in between, then openers and the run
        const base = stripClosers(toText(doc.cut(0, start))).length;
        const o = posToTextOffset(doc, start);
        assert.ok(o >= base && /^(?:\*|\]\([^)]*\))*$/.test(T.slice(base, o)), `${JSON.stringify(T)}: boundary at ${start}: ${o} vs ${base}`);
        assert.ok(T.slice(o).replace(/^(?:\*|\[)*/, '').startsWith(kid.text!), `${JSON.stringify(T)}: boundary at ${start} is followed by its run`);
        bounds++;
      });
    });
  }
  assert.ok(blocks > 500 && inner > 1000 && bounds > 1000, `${blocks} block ends, ${inner} inner and ${bounds} boundary positions checked`);
});
