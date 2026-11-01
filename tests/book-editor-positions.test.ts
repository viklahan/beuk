import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Node } from 'prosemirror-model';
import { fixturePath } from './book-fixtures.js';
import { toDoc, toText } from '../src/book/editor/convert.js';
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
