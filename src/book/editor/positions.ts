import { type Mark, type Node } from 'prosemirror-model';
import { DELIMITED_MARKS } from './schema.js';

/* BEUK:editor-positions — text offsets <-> ProseMirror positions (step 5
   design, decision 6; pulled forward to wave 1b for split at the caret).

   An OFFSET counts characters of toText(doc) — 1.0's section `content` —
   including every block's `pre` / `post` whitespace, a note definition's
   "[^n]: " prefix, a container's opener and close lines, the delimiters
   em / strong / link write ("*", "**", "[", "](href)"), and rawBlock /
   rawInline source. A POSITION is a ProseMirror position in the document.

   posToTextOffset is total: every position 0..doc.content.size has one
   offset, and offsets never decrease as positions grow.
   - Inside a textblock, the position before inline character k maps to the
     text written before that character's own opening delimiters: the
     closing delimiters of marks that end at k are counted, the opening
     ones of marks that start at k are not. The position at the end of the
     block's content maps to the offset after every closing delimiter.
   - A position between blocks (or around an atom: picture, scene break)
     maps to the offset where the next block's `pre` starts; after the last
     child of the document, to the end of the text (its `post` included);
     after the last child of a container, to the start of its close line.

   textOffsetToPos(doc, o) is the cursor position for offset o: among the
   positions a text cursor can stand at (inside a textblock), the one with
   the greatest offset <= o (ties: the first such position). An offset no
   position represents exactly (inside a delimiter, a `pre`, a note prefix,
   an atom's source, a container's lines) therefore maps to the nearest
   representable offset BELOW it ("floor"); one below every cursor position
   maps to the first. A document with no textblock uses every position.
   So posToTextOffset(doc, textOffsetToPos(doc, o)) === o exactly when o is
   representable, else the floor of o. */

const DELIM = new Set<string>(DELIMITED_MARKS);
const openOf = (m: Mark): string => (m.type.name === 'link' ? '[' : m.type.name === 'em' ? '*' : '**');
const closeOf = (m: Mark): string => (m.type.name === 'link' ? '](' + String(m.attrs.href) + ')' : m.type.name === 'em' ? '*' : '**');

/** One position's offset; `text`: a text cursor can stand here (inside a textblock). */
type Table = { off: Int32Array; text: Uint8Array };

function preOf(b: Node, i: number): string {
  const pre = b.attrs.pre;
  return pre === null || pre === undefined ? (i === 0 ? '' : '\n\n') : String(pre);
}

/** The prefix a block writes before its inline content (convert.ts blockText). */
function prefixOf(node: Node): string {
  const a = node.attrs;
  if (node.type.name === 'footnoteDef') return '[' + (a.caret ? '^' : '') + String(a.n) + ']:' + String(a.gap);
  if (node.type.name === 'container') return String(a.open) + String(a.openEol);
  return '';
}

/** Characters an atom block writes (convert.ts blockText for image and sceneBreak). */
function atomLength(node: Node): number {
  const a = node.attrs;
  if (node.type.name === 'image')
    return ('![' + String(a.alt) + '](img:' + String(a.id) + (a.full ? '|full' : '') +
      (a.caption !== null ? String(a.capGap) + String(a.q1) + String(a.caption) + String(a.q2) : '') + ')').length;
  if (node.type.name === 'sceneBreak') return String(a.raw).length;
  return node.textContent.length;
}

/** Fill offsets for a textblock's content; `pos` is its content start, `at` the offset there. Returns the offset after it. */
function walkInline(node: Node, pos: number, at: number, t: Table): number {
  if (node.type.spec.code) {
    // rawBlock: verbatim text, no marks written
    for (let k = 0; k <= node.content.size; k++) { t.off[pos + k] = at + k; t.text[pos + k] = 1; }
    return at + node.content.size;
  }
  // inlineText's walk: closes, then opens, then the text, for each child
  const kids: Node[] = [];
  node.forEach((k) => { kids.push(k); });
  const stack: Mark[] = [];
  let p = pos;
  for (let j = 0; j < kids.length; j++) {
    const kid = kids[j]!;
    const ms = kid.marks.filter((m) => DELIM.has(m.type.name));
    let k = 0;
    while (k < stack.length && stack[k]!.isInSet(ms)) k++;
    for (let x = stack.length - 1; x >= k; x--) at += closeOf(stack[x]!).length;
    stack.length = k;
    t.off[p] = at; t.text[p] = 1; // the boundary before this child: closes counted, opens not
    for (const m of ms) if (!m.isInSet(stack)) { at += openOf(m).length; stack.push(m); }
    const len = kid.isText ? kid.text!.length : kid.nodeSize;
    // inside a text node, character c sits at at + c; position p + c (c >= 1) is between characters
    for (let c = 1; c < len; c++) { t.off[p + c] = at + c; t.text[p + c] = 1; }
    at += kid.isText ? len : 0;
    p += len;
  }
  for (let x = stack.length - 1; x >= 0; x--) at += closeOf(stack[x]!).length;
  t.off[p] = at; t.text[p] = 1; // end of content
  return at;
}

/** Fill offsets for the children of `parent` (a doc or a container); `pos` is its content start, `at` the offset there.
 *  Returns the offset after the last child (its post included). */
function walkBlocks(parent: Node, pos: number, at: number, t: Table): number {
  let p = pos;
  const n = parent.childCount;
  for (let i = 0; i < n; i++) {
    const b = parent.child(i);
    t.off[p] = at; // before child i: where its pre starts
    at += preOf(b, i).length;
    if (b.type.name === 'container') {
      at += prefixOf(b).length;
      at = walkBlocks(b, p + 1, at, t);
      t.off[p + b.nodeSize - 1] = at; // the container's content end: its close line starts here
      if (b.attrs.close !== null) at += String(b.attrs.close).length;
    } else if (b.isTextblock) {
      at += prefixOf(b).length;
      at = walkInline(b, p + 1, at, t);
    } else {
      at += atomLength(b);
    }
    if (i === n - 1) at += String(b.attrs.post ?? '').length;
    p += b.nodeSize;
  }
  t.off[p] = Math.max(t.off[p] ?? 0, at); // after the last child
  return at;
}

const tables = new WeakMap<Node, Table>();
function table(doc: Node): Table {
  let t = tables.get(doc);
  if (!t) {
    const size = doc.content.size;
    t = { off: new Int32Array(size + 1), text: new Uint8Array(size + 1) };
    walkBlocks(doc, 0, 0, t); // writes every position 0..size, in order
    tables.set(doc, t);
  }
  return t;
}

/** The text offset (in toText(doc)) of ProseMirror position `pos` (clamped to the document). */
export function posToTextOffset(doc: Node, pos: number): number {
  const t = table(doc);
  const p = Math.max(0, Math.min(doc.content.size, Math.floor(pos)));
  return t.off[p]!;
}

/** The cursor position for text offset `offset`: the textblock position with the greatest offset <= `offset` (the first
 *  such), else the first textblock position. See the header for the full rule. */
export function textOffsetToPos(doc: Node, offset: number): number {
  const t = table(doc);
  const size = doc.content.size;
  let anyText = false;
  for (let p = 0; p <= size; p++) if (t.text[p]) { anyText = true; break; }
  let best = -1, first = -1;
  for (let p = 0; p <= size; p++) {
    if (anyText && !t.text[p]) continue;
    if (first < 0) first = p;
    const o = t.off[p]!;
    if (o <= offset && (best < 0 || o > t.off[best]!)) best = p;
  }
  return best >= 0 ? best : Math.max(0, first);
}
