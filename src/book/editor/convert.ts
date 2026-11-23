import { type Mark, type Node } from 'prosemirror-model';
import { DELIMITED_MARKS, LINE_BLOCKS, bookSchema as S, textblockPrefix } from './schema.js';

/* BEUK:editor-convert — 1.0's section `content` <-> a ProseMirror document,
   losslessly: toText(toDoc(t)) === t, byte for byte, for every string t.

   How the guarantee holds whatever the converter's coverage:
   1. Blocks are cut at exact offsets. Everything between two blocks (blank
      lines, a trimmed block's leading and trailing whitespace, "\r") is
      kept verbatim in the next block's `pre`; what follows the last block
      is its `post`.
   2. Inline text is never escaped or rewritten: a construct's delimiters
      are dropped from the text only where a mark writes them back (em,
      strong, link). Everything else, recognised or not, stays as text.
   3. Each block is checked as it is built: if its node does not write back
      exactly its source, the block becomes a rawBlock holding the source.
   4. The whole document is checked at the end; on any mismatch it becomes
      one rawBlock holding the whole text.

   The grammar is 1.0's renderer (client/index.html), read on the STORED
   text: parseContainers (CONTAINER_OPEN_RE, CONTAINER_CLOSE_RE),
   contentBlocksToHtml (blocks split on blank lines and trimmed; emitBlock:
   scene break, note definition, picture line; emitText: list, quote,
   heading, paragraph), beautifyText (a note definition starts its own
   block; "###", "---", "___", "#" lines are scene breaks), parseImageLine
   (IMAGE_LINE_RE), listItemsOf (LIST_BULLET, LIST_NUMBER), inlineMd
   (REDACT_RE first, then mdLinkRe, then **strong**, then *em*, then
   [^n]/[n] refs, then note links). Pure: no DOM, runs in Node and the
   browser. */

/* ---- 1.0's patterns ---- */
const CONTAINER_OPEN_RE = /^[ \t]*:::[ \t]+([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+(.*?))?[ \t]*$/;
const CONTAINER_CLOSE_RE = /^[ \t]*:::[ \t]*$/;
const SCENE_BREAK_SRC_RE = /^[ \t]*([*#]{3,}|-{3,}|_{3,}|#)[ \t]*$/;
const ORNAMENT_RE = /^(\*\*\*|❦|⁂)$/;
/* BEUK:notelabels — a note keeps the label the writer typed: "[^label]" under any label (no space, no "]"), or the
   bare "[12]" of one to three digits (client/index.html noteMarkRe and NOTE_DEF_RE). */
const NOTE_DEF_LINE_RE = /^\[(?:\^[^\]\s]+|\d{1,3})\]:/;
const NOTE_DEF_RE = /^\[(\^[^\]\s]+|\d{1,3})\]:(\s*)([\s\S]+)$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(img:([A-Za-z0-9-]+)(\|full)?(?:([ \t]+)(["“”])([^"“”\n]*)(["“”]))?\)$/;
const LIST_BULLET = /^[-*+•‣⁃■-➿]\s+/; // BEUK:listmarkstyped — "-", "*", "+", "•", "‣", "⁃" and U+25A0 to U+27BF, as 1.0's
const LIST_NUMBER = /^(\d{1,3})[.)]\s+/;
const QUOTE_PREFIX = /^>\s?/;
const REDACT_RE = /\|\|(?=[^|\s])([^|\n]*?[^|\s])\|\|/g;
const LINK_RE = /(?<!!)\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)\)/gi;
const STRONG_RE = /\*\*([^*]+)\*\*/g;
const EM_RE = /\*([^*\n]+)\*/g;
const REF_RE = /\[(?:\^[^\]\s]+|\d{1,3})\]/g;
const NOTE_LINK_RE = /\[([^\]]+)\]\(note:([a-z0-9-]+)\)/g;

/** Container kinds whose content 1.0 sets as ordinary blocks (CONTAINER_KINDS center/right: cx.blocks(seg.text)). Other kinds are rawBlock. */
const BLOCK_CONTAINERS = new Set(['center', 'right']);
/** A private-use character standing in for text 1.0 sets aside before a later pattern runs (its placeholders hold no "*", "[" or newline). */
const HOLD = '';

export type ConvertStats = { blocks: number; raw: number; rawWhy: Record<string, number> };

/* ---- lines ---- */

type Line = { start: number; end: number; next: number };
/** Lines of `t`: [start, end) is the content without "\r\n" / "\n"; `next` starts the next line. A lone "\r" is content. */
function splitLines(t: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (;;) {
    const nl = t.indexOf('\n', start);
    if (nl === -1) { out.push({ start, end: t.length, next: t.length }); return out; }
    out.push({ start, end: nl > start && t.charCodeAt(nl - 1) === 13 ? nl - 1 : nl, next: nl + 1 });
    start = nl + 1;
  }
}

const isBlank = (s: string): boolean => s.trim() === '';
const isImageLine = (s: string): boolean => IMAGE_LINE_RE.test(s.trim());

/** 1.0's listItemsOf over a block's lines (`lines` without "\r", `raw` as written): each marked line starts an item
 *  (its marker as written, the rest its text), an unmarked line continues the item above it ("\n" and the line, kept
 *  in the item's text). Null when 1.0 does not read the block as a list. */
function listItemsOf(lines: string[], raw: string[]): { marker: string; text: string }[] | null {
  const fam = listFamily(lines[0]!);
  if (!fam) return null;
  const items: { marker: string; text: string }[] = [];
  const tms: TypedMark[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!, r = raw[i]!;
    if (fam.opens(l)) {
      const m = fam.re.exec(r)![0];
      items.push({ marker: m, text: r.slice(m.length) });
      if (fam.kind === 't') tms.push(listTypedOf(l)!);
    } else if (fam.kind === 'b' && LIST_NUMBER.test(l)) return null;
    else items[items.length - 1]!.text += '\n' + r;
  }
  if (fam.kind === 't') return listSeriesOk(tms) ? items : null;
  return fam.kind === 'n' || items.length >= 2 ? items : null;
}

/* BEUK:listmarkstyped — 1.0's typed marks, the editor's copy (client/index.html: LIST_TYPED, listTypedOf,
   listSeriesOf). A list's item may open on a letter ("a." "B)"), a Roman numeral up to 399 ("iv." "XII)"), or any of
   those or a number in brackets ("(a)" "(iv)" "(3)"). Letters at the head of a line are also how a name is written,
   so such a list is read only where two or more items carry marks of one shape that climb. */
const LIST_TYPED = /^(?:\((\d{1,3}|[A-Za-z]{1,8})\)|([A-Za-z]{1,8})[.)])\s+/;
type TypedMark = { shape: string; num: number; alpha: number; roman: number };
const toRoman = (n: number): string => { let s = ''; for (const [v, r] of [[100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as [number, string][]) while (n >= v) { s += r; n -= v; } return s; };
function romanOf(s: string): number {
  const V: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let n = 0;
  for (let i = 0; i < s.length; i++) { const a = V[s[i]!], b = V[s[i + 1] ?? ''] ?? 0; if (!a) return 0; n += a < b ? -a : a; }
  return n > 0 && n < 400 && toRoman(n) === s ? n : 0;
}
/** A typed mark at the head of a line: its shape (the brackets or closing mark around "1", "a" or "A") and what it counts as. */
function listTypedOf(line: string): TypedMark | null {
  const m = LIST_TYPED.exec(line);
  if (!m) return null;
  const body = (m[1] || m[2])!, digits = /^\d+$/.test(body), low = body.toLowerCase();
  if (!digits && body !== low && body !== body.toUpperCase()) return null;
  const alpha = !digits && low.length <= 3 && low === low.charAt(0).repeat(low.length) ? (low.length - 1) * 26 + low.charCodeAt(0) - 96 : 0;
  const roman = digits ? 0 : romanOf(low);
  if (!digits && !alpha && !roman) return null;
  return { shape: (m[1] ? '(' : '') + (digits ? '1' : body === low ? 'a' : 'A') + (m[1] ? ')' : m[0].charAt(body.length)), num: digits ? parseInt(body, 10) : 0, alpha, roman };
}
/** 1.0's listSeriesOf: typed marks make a list where they are two or more, of one shape, and climb as numbers, letters or Roman numerals. */
function listSeriesOk(tms: TypedMark[]): boolean {
  if (tms.length < 2 || tms.some((t) => t.shape !== tms[0]!.shape)) return false;
  const climbs = (k: 'num' | 'alpha' | 'roman'): boolean => tms.every((t, i) => t[k] > 0 && (!i || t[k] > tms[i - 1]![k]));
  return climbs('num') || climbs('alpha') || climbs('roman');
}
/** The kind of list a block's first line opens: its kind, the pattern of an item's mark (with its spacing), and whether a line opens an item of it. */
function listFamily(first: string): { kind: 'n' | 'b' | 't'; re: RegExp; opens: (l: string) => boolean } | null {
  if (LIST_NUMBER.test(first)) return { kind: 'n', re: LIST_NUMBER, opens: (l) => LIST_NUMBER.test(l) };
  if (LIST_BULLET.test(first)) return { kind: 'b', re: LIST_BULLET, opens: (l) => LIST_BULLET.test(l) };
  const t0 = listTypedOf(first);
  return t0 ? { kind: 't', re: LIST_TYPED, opens: (l) => listTypedOf(l)?.shape === t0.shape } : null;
}

/* BEUK:looselists — 1.0's looseListBlocks, read by the editor too. A list whose items the writer parted with blank
   lines is stored as typed, each item a block of its own; 1.0 reads a run of two or more such blocks that open on a
   list's mark of one kind (a number; or "*" or "•", never "- ") as ONE list, and so does the editor now: until
   this it drew them as paragraphs that open on an asterisk, and a numbered one as so many one-item lists.
   Nothing new is stored and the schema is as it was. The list is one `list` node; an item that follows a blank line
   carries, in front of its mark in `marker`, the exact text that stood between it and the item above (after the one
   line break every list writes between two items): the blank lines and the item's own indent. So the text written
   back is the text read, byte for byte, and a build that does not know this reading still writes the same text.
   The plain-text shape is read as 1.0 reads it: a block of text lines whose LAST line alone opens on a mark, with the
   next block opening on a mark of the same kind, is the paragraph of its lines and that last line the list's first
   item (the list's `pre` holds the line break and indent between them). */
const dropCr = (l: string): string => (l.endsWith('\r') ? l.slice(0, -1) : l);
/** 1.0's kindOf: the kind of list a line opens ('n' a number; 'b' a bullet, any the list reads but "-"; 't' and its
 *  shape, a typed mark), or ''. A line that is only marks ("* * *") opens none. */
function looseKind(line: string): string {
  const l = dropCr(line);
  if (LIST_NUMBER.test(l)) return 'n';
  if (LIST_BULLET.test(l)) return l.charAt(0) !== '-' && /[^\s*+•‣⁃■-➿]/.test(l) ? 'b' : '';
  const tm = listTypedOf(l);
  return tm ? 't' + tm.shape : '';
}
const firstLine = (B: string): string => { const nl = B.indexOf('\n'); return nl === -1 ? B : B.slice(0, nl); };

/* ---- inline ---- */

const F_RAW = 1, F_EM = 2, F_STRONG = 4, F_LINK = 8, F_REF = 16, F_SKIP = 32;

function maskRanges(s: string, ranges: [number, number][]): string {
  if (!ranges.length) return s;
  let out = '', at = 0;
  for (const [a, b] of ranges) { out += s.slice(at, a) + HOLD.repeat(b - a); at = b; }
  return out + s.slice(at);
}

/** A span 1.0 reads as markup but a mark cannot write back: kept as source under rawInline. Two spans of the same mark
 *  that touch ("*a**b*", "**a****b**", "[a](u)[b](u)") would merge into one mark, so the second is kept this way. */
function rawSpan(flags: Uint8Array, s0: number, e0: number): void {
  for (let i = s0; i < e0; i++) flags[i]! |= F_RAW;
}

/** **strong** then *em* over str[a, b), as inlineMd's emph: strong first, then em on the text with the strong delimiters gone. */
function emph(str: string, a: number, b: number, joinLines: boolean, flags: Uint8Array, links: Set<string> | null = null): void {
  const sub = str.slice(a, b);
  if (sub.indexOf('*') === -1) return;
  const held: [number, number][] = [];
  let prevEnd = -1;
  for (const m of sub.matchAll(STRONG_RE)) {
    const s0 = a + m.index, e0 = s0 + m[0].length;
    // touching the previous strong, or wrapping exactly one link (marks cannot tell **[x](u)** from [**x**](u))
    if (s0 === prevEnd || links?.has((s0 + 2) + ':' + (e0 - 2))) { rawSpan(flags, s0, e0); held.push([m.index, m.index + m[0].length]); continue; }
    prevEnd = e0;
    flags[s0] = flags[s0 + 1] = flags[e0 - 2] = flags[e0 - 1] = F_SKIP;
    for (let i = s0 + 2; i < e0 - 2; i++) flags[i]! |= F_STRONG;
    held.push([m.index, m.index + 2], [m.index + m[0].length - 2, m.index + m[0].length]);
  }
  let emStr = maskRanges(sub, held);
  if (joinLines) emStr = emStr.replace(/\n/g, ' '); // a paragraph's lines are joined with a space before inlineMd
  prevEnd = -1;
  for (const m of emStr.matchAll(EM_RE)) {
    const s0 = a + m.index, e0 = s0 + m[0].length;
    if (s0 === prevEnd || links?.has((s0 + 1) + ':' + (e0 - 1))) { rawSpan(flags, s0, e0); continue; }
    prevEnd = e0;
    flags[s0] = flags[e0 - 1] = F_SKIP;
    for (let i = s0 + 1; i < e0 - 1; i++) flags[i]! |= F_EM;
  }
}

const markCache = new Map<number, readonly Mark[]>();
function marksFor(f: number, href: string | null): readonly Mark[] {
  if (href !== null) {
    const ms: Mark[] = [S.marks.link!.create({ href })];
    if (f & F_EM) ms.push(S.marks.em!.create());
    if (f & F_STRONG) ms.push(S.marks.strong!.create());
    if (f & F_REF) ms.push(S.marks.footnoteRef!.create());
    if (f & F_RAW) ms.push(S.marks.rawInline!.create());
    return ms;
  }
  let ms = markCache.get(f);
  if (!ms) {
    const a: Mark[] = [];
    if (f & F_EM) a.push(S.marks.em!.create());
    if (f & F_STRONG) a.push(S.marks.strong!.create());
    if (f & F_REF) a.push(S.marks.footnoteRef!.create());
    if (f & F_RAW) a.push(S.marks.rawInline!.create());
    markCache.set(f, (ms = a));
  }
  return ms;
}

/** Inline text -> text nodes with marks. `joinLines`: em may run over a line break (1.0 joins a paragraph's lines first). */
function inlineNodes(s: string, joinLines: boolean): Node[] {
  const n = s.length;
  if (!n) return [];
  if (!/[*[|]/.test(s)) return [S.text(s)];
  const flags = new Uint8Array(n);
  let linkOf: Int32Array | null = null;
  const hrefs: string[] = [];

  // 1. redactions: set aside before anything can read their words
  const reds: [number, number][] = [];
  if (s.indexOf('||') !== -1) for (const m of s.matchAll(REDACT_RE)) {
    reds.push([m.index, m.index + m[0].length]);
    for (let i = m.index; i < m.index + m[0].length; i++) flags[i]! |= F_RAW;
  }
  const masked = maskRanges(s, reds);

  // 2. links, each set aside whole; the label takes its own emphasis
  const links: [number, number][] = [];
  let prevLink = -1, prevHref = '';
  if (masked.indexOf('](') !== -1) for (const m of masked.matchAll(LINK_RE)) {
    const start = m.index, labelStart = start + 1, labelEnd = labelStart + m[1]!.length, end = start + m[0].length;
    const href = s.slice(labelEnd + 2, end - 1);
    links.push([start, end]);
    if (start === prevLink && href === prevHref) { rawSpan(flags, start, end); continue; }
    prevLink = end; prevHref = href;
    linkOf ??= new Int32Array(n).fill(-1);
    flags[start] = F_SKIP;
    for (let i = labelEnd; i < end; i++) flags[i] = F_SKIP;
    for (let i = labelStart; i < labelEnd; i++) { flags[i]! |= F_LINK; linkOf[i] = hrefs.length; }
    hrefs.push(href);
    emph(masked, labelStart, labelEnd, false, flags);
  }
  const outer = maskRanges(masked, links);

  // 3. emphasis, 4. footnote refs, 5. note links (left raw)
  /* BEUK:notemarks — a note's mark that holds a "*" ("[^*]": a mark of the writer's, shown as typed) is set aside
     while the emphasis is read, as 1.0's inlineMd sets a note's mark aside: its "*" is the mark, never the opening
     or the close of an italic. (This model reads one block at a time and cannot know whether a note answers the
     mark; 1.0 sets aside only a mark a note answers.) */
  const starRefs: [number, number][] = [];
  if (outer.indexOf('[^') !== -1 && outer.indexOf('*') !== -1) for (const m of outer.matchAll(REF_RE)) if (m[0].indexOf('*') !== -1) starRefs.push([m.index, m.index + m[0].length]);
  emph(starRefs.length ? maskRanges(outer, starRefs) : outer, 0, n, joinLines, flags, links.length ? new Set(links.map(([x, y]) => x + ':' + y)) : null);
  if (outer.indexOf('[') !== -1) {
    for (const m of outer.matchAll(REF_RE)) for (let i = m.index; i < m.index + m[0].length; i++) flags[i]! |= F_REF;
    if (outer.indexOf('](note:') !== -1) for (const m of outer.matchAll(NOTE_LINK_RE)) for (let i = m.index; i < m.index + m[0].length; i++) flags[i]! |= F_RAW;
  }

  const out: Node[] = [];
  let i = 0;
  while (i < n) {
    if (flags[i]! & F_SKIP) { i++; continue; }
    const f = flags[i]!, lk = linkOf ? linkOf[i]! : -1;
    let j = i + 1;
    while (j < n && flags[j] === f && (linkOf ? linkOf[j] : -1) === lk) j++;
    out.push(S.text(s.slice(i, j), marksFor(f, lk >= 0 ? hrefs[lk]! : null)));
    i = j;
  }
  return out;
}

/* ---- writing back ---- */

const DELIM_RANK: Record<string, number> = Object.fromEntries(DELIMITED_MARKS.map((m, i) => [m, i]));
const openOf = (m: Mark): string => (m.type.name === 'link' ? '[' : m.type.name === 'em' ? '*' : '**');
const closeOf = (m: Mark): string => (m.type.name === 'link' ? '](' + String(m.attrs.href) + ')' : m.type.name === 'em' ? '*' : '**');

/** The order in which the delimited marks `open` (all opening at child j of `kids`) are written: the mark that runs
 *  longest opens first (it encloses the others); on a tie, link, then em, then strong. ONE function, shared by inlineText
 *  and positions.ts, so the text and the offsets can never disagree. Returns a new array. */
export function openingOrder(kids: readonly Node[], j: number, open: readonly Mark[]): Mark[] {
  const out = [...open];
  if (out.length > 1) {
    const run = (m: Mark): number => { let x = j; while (x < kids.length && m.isInSet(kids[x]!.marks)) x++; return x - j; };
    const len = new Map(out.map((m) => [m, run(m)]));
    out.sort((p, q) => len.get(q)! - len.get(p)! || DELIM_RANK[p.type.name]! - DELIM_RANK[q.type.name]!);
  }
  return out;
}

/** A textblock's inline content as source: text verbatim, em/strong/link delimiters written where their marks open and close. */
export function inlineText(node: Node): string {
  const kids: Node[] = [];
  node.forEach((k) => { kids.push(k); });
  let out = '';
  const stack: Mark[] = [];
  for (let j = 0; j < kids.length; j++) {
    const kid = kids[j]!;
    const ms = kid.marks.filter((m) => m.type.name in DELIM_RANK);
    let k = 0;
    while (k < stack.length && stack[k]!.isInSet(ms)) k++;
    for (let t = stack.length - 1; t >= k; t--) out += closeOf(stack[t]!);
    stack.length = k;
    const open = openingOrder(kids, j, ms.filter((m) => !m.isInSet(stack)));
    for (const m of open) { out += openOf(m); stack.push(m); }
    out += kid.isText ? kid.text! : '';
  }
  for (let t = stack.length - 1; t >= 0; t--) out += closeOf(stack[t]!);
  return out;
}

/** One block's source, without its pre/post. */
export function blockText(node: Node): string {
  const a = node.attrs;
  switch (node.type.name) {
    case 'paragraph': return inlineText(node);
    case 'footnoteDef': case 'heading': return textblockPrefix(node) + inlineText(node);
    case 'quote': case 'list': return linesText(node);
    case 'image':
      return '![' + String(a.alt) + '](img:' + String(a.id) + (a.full ? '|full' : '') +
        (a.caption !== null ? String(a.capGap) + String(a.q1) + String(a.caption) + String(a.q2) : '') + ')';
    case 'sceneBreak': return String(a.raw);
    case 'rawBlock': return node.textContent;
    case 'container': return String(a.open) + String(a.openEol) + blocksText(node) + (a.close !== null ? String(a.close) : '');
    default: return node.textContent;
  }
}

/** A quote's or a list's source: each line's prefix and text, "\n" between lines. */
function linesText(node: Node): string {
  let out = '';
  node.forEach((line, _o, i) => { out += (i ? '\n' : '') + textblockPrefix(line) + inlineText(line); });
  return out;
}

/** The source of a run of blocks (a doc's or a container's children). */
export function blocksText(parent: Node): string {
  let out = '';
  for (let i = 0; i < parent.childCount; i++) out += childText(parent, i);
  return out;
}

/** The text in front of child i: its pre, or the canonical separator ("" first, "\n\n" after) when pre is null. */
function preOf(b: Node, i: number): string {
  const pre = b.attrs.pre;
  return pre === null || pre === undefined ? (i === 0 ? '' : '\n\n') : String(pre);
}

/** Child i's source with its pre, and its post only when it is the last child: an editor split copies attrs, so a post
 *  left on a block that is no longer last must not land in the middle of the text. */
function childText(parent: Node, i: number): string {
  const b = parent.child(i);
  return preOf(b, i) + blockText(b) + (i === parent.childCount - 1 ? String(b.attrs.post ?? '') : '');
}

/** A document's source text: 1.0's section `content`. */
export function toText(doc: Node): string {
  return blocksText(doc);
}

/* ---- reading ---- */

function mergeStats(into: ConvertStats, from: ConvertStats): void {
  into.blocks += from.blocks; into.raw += from.raw;
  for (const [k, v] of Object.entries(from.rawWhy)) into.rawWhy[k] = (into.rawWhy[k] ?? 0) + v;
}

function raw(text: string, why: string, stats?: ConvertStats): Node {
  if (stats) stats.rawWhy[why] = (stats.rawWhy[why] ?? 0) + 1;
  return S.node('rawBlock', null, text ? [S.text(text)] : []);
}

/** One trimmed block of non-container text -> its node (unchecked). */
function buildBlock(B: string, stats?: ConvertStats): Node {
  const rawLines = B.split('\n');
  const lines = rawLines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const single = lines.length === 1;
  if (single && (ORNAMENT_RE.test(B) || SCENE_BREAK_SRC_RE.test(B))) return S.node('sceneBreak', { raw: B });
  const nd = NOTE_DEF_RE.exec(B);
  if (nd) { const caret = nd[1]!.startsWith('^'); return S.node('footnoteDef', { caret, n: caret ? nd[1]!.slice(1) : nd[1], gap: nd[2] }, inlineNodes(nd[3]!, false)); }
  if (single) {
    const im = IMAGE_LINE_RE.exec(B);
    if (im) {
      const cap = im[6] !== undefined;
      return S.node('image', {
        alt: im[1], id: im[2], full: !!im[3],
        caption: cap ? im[6] : null, capGap: cap ? im[4] : ' ', q1: cap ? im[5] : '"', q2: cap ? im[7] : '"',
      });
    }
  }
  // emitText's order: a list, then a quote, then a heading (wave 2a: modelled; raw before)
  const items = listItemsOf(lines, rawLines);
  if (items) return S.node('list', null, items.map((it) => S.node('listItem', { marker: it.marker }, inlineNodes(it.text, true))));
  if (lines.every((l) => l.startsWith('>'))) {
    return S.node('quote', null, rawLines.map((r) => {
      const prefix = QUOTE_PREFIX.exec(r)![0];
      return S.node('quoteLine', { prefix }, inlineNodes(r.slice(prefix.length), false));
    }));
  }
  if (B.startsWith('## ')) return S.node('heading', { level: 2 }, inlineNodes(B.slice(3), false));
  if (B.startsWith('# ')) return S.node('heading', { level: 1 }, inlineNodes(B.slice(2), false));
  return S.node('paragraph', null, inlineNodes(B, true));
}

function withEdges(node: Node, pre: string | null, post: string): Node {
  if (node.attrs.pre === pre && node.attrs.post === post) return node;
  return node.type.create({ ...node.attrs, pre, post }, node.content, node.marks);
}

/** A block as parseBlocks cut it: [start, end) of the text and its node. `B` is its text where 1.0 reads it as an
 *  ordinary block (no container, no stray close line, nothing kept as raw source). */
type Unit = { start: number; end: number; node: Node; B?: string };

/** BEUK:looselists — 1.0's looseListBlocks over the blocks of one run of text: each run of two or more blocks that
 *  open on a list's mark of one kind becomes one `list` unit (see the note at looseKind). Blocks follow one another
 *  here only where a blank line parts them, as 1.0's blocks do; a container, a raw block or a picture between two
 *  blocks ends a run. */
function looseLists(t: string, units: Unit[], stats?: ConvertStats): Unit[] {
  if (units.length < 2) return units;
  const next = (i: number): Unit | null => {
    const a = units[i]!, b = units[i + 1];
    return b && a.B !== undefined && b.B !== undefined && /\n[^\S\n]*\n/.test(t.slice(a.end, b.start)) ? b : null;
  };
  const kindOf = (u: Unit | null): string => (u && u.B !== undefined ? looseKind(firstLine(u.B)) : '');
  const out: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.B === undefined) { out.push(u); continue; }
    let k = kindOf(u), headStart = u.start, lead: Unit | null = null;
    if (!k) {
      // text lines whose last line alone opens on a mark, the list going on in the next block
      const nl = u.B.lastIndexOf('\n');
      const lastRaw = nl === -1 ? '' : u.B.slice(nl + 1);
      const lk = lastRaw.trim() ? looseKind(lastRaw.trim()) : '';
      if (lk && kindOf(next(i)) === lk && !u.B.slice(0, nl).split('\n').some((l) => looseKind(l.trim()))) {
        const leadText = u.B.slice(0, nl).trimEnd();
        let node = buildBlock(leadText, stats);
        if (node.type.name !== 'rawBlock' && blockText(node) !== leadText) node = raw(leadText, 'mismatch', stats);
        lead = { start: u.start, end: u.start + leadText.length, node, B: leadText };
        headStart = u.start + nl + 1 + (lastRaw.length - lastRaw.trimStart().length);
        k = lk;
      }
    }
    if (!k) { out.push(u); continue; }
    let j = i;
    while (kindOf(next(j)) === k) j++;
    const list = j > i ? looseListNode(t, units, i, j, headStart) : null;
    if (!list) { out.push(u); continue; }
    if (lead) out.push(lead);
    out.push({ start: headStart, end: units[j]!.end, node: list, B: t.slice(headStart, units[j]!.end) });
    i = j;
  }
  return out;
}

/** The blocks units[i..j] (the first from `headStart`) as one list of kind `k`, or null where 1.0's listItemsOf does
 *  not read their lines as a list, or the node would not write back exactly the text it was read from. */
function looseListNode(t: string, units: Unit[], i: number, j: number, headStart: number): Node | null {
  const fam = listFamily(dropCr(firstLine(t.slice(headStart, units[i]!.end))));
  if (!fam) return null;
  const tms: TypedMark[] = [];
  const items: { marker: string; text: string }[] = [];
  for (let x = i; x <= j; x++) {
    const from = x === i ? headStart : units[x]!.start;
    let gap = '';
    if (x > i) {
      // between two items a list writes one "\n": what stood before it stays the upper item's own text (as the end of
      // any item's line does), what stood after it goes in front of this item's mark
      const between = t.slice(units[x - 1]!.end, from);
      const nl = between.indexOf('\n');
      if (nl === -1) return null;
      items[items.length - 1]!.text += between.slice(0, nl);
      gap = between.slice(nl + 1);
    }
    const rawLines = t.slice(from, units[x]!.end).split('\n');
    for (let li = 0; li < rawLines.length; li++) {
      const r = rawLines[li]!, l = dropCr(r);
      if (fam.opens(l)) {
        const m = fam.re.exec(r)![0];
        if (fam.kind === 't') tms.push(listTypedOf(l)!);
        items.push({ marker: (li === 0 ? gap : '') + m, text: r.slice(m.length) });
      } else if (fam.kind === 'b' && LIST_NUMBER.test(l)) return null; // listItemsOf: a numbered line in a bulleted list makes it no list
      else if (!items.length) return null;
      else items[items.length - 1]!.text += '\n' + r;
    }
  }
  const node = S.node('list', null, items.map((it) => S.node('listItem', { marker: it.marker }, inlineNodes(it.text, true))));
  if (fam.kind === 't' && !listSeriesOk(tms)) return null; // listItemsOf: typed marks are a list only where they climb
  return blockText(node) === t.slice(headStart, units[j]!.end) ? node : null;
}

/** A run of text -> its blocks (at least one), each carrying its exact pre, the last its post. */
function parseBlocks(t: string, stats?: ConvertStats): Node[] {
  const lines = splitLines(t);
  const content = (L: Line): string => t.slice(L.start, L.end);
  let units: Unit[] = []; // counted for `stats` once they are final (below): a loose list is one block

  let i = 0;
  while (i < lines.length) {
    const L = lines[i]!;
    const c = content(L);
    if (isBlank(c)) { i++; continue; }

    const om = CONTAINER_OPEN_RE.exec(c);
    if (om) {
      // a container runs to its close line, the next opener, or the end (parseContainers)
      let j = i + 1, close = -1;
      for (; j < lines.length; j++) {
        const cj = content(lines[j]!);
        if (CONTAINER_OPEN_RE.test(cj)) break;
        if (CONTAINER_CLOSE_RE.test(cj)) { close = j; break; }
      }
      const end = close >= 0 ? lines[close]!.end : j < lines.length ? lines[j]!.start : t.length;
      const src = t.slice(L.start, end);
      let node: Node;
      if (BLOCK_CONTAINERS.has(om[1]!.toLowerCase())) {
        const inner = t.slice(L.next, close >= 0 ? lines[close]!.start : end);
        const innerStats: ConvertStats | undefined = stats ? { blocks: 0, raw: 0, rawWhy: {} } : undefined;
        node = S.node('container', { open: c, openEol: t.slice(L.end, L.next), close: close >= 0 ? content(lines[close]!) : null }, parseBlocks(inner, innerStats));
        if (blockText(node) !== src) node = raw(src, 'mismatch', stats);
        else if (stats && innerStats) mergeStats(stats, innerStats);
      } else {
        node = raw(src, 'container:' + om[1]!.toLowerCase(), stats);
      }
      units.push({ start: L.start, end, node });
      i = close >= 0 ? close + 1 : j;
      continue;
    }

    // a block: non-blank lines, cut before a container line, a note definition, and around a picture line
    let j = i + 1;
    if (!CONTAINER_CLOSE_RE.test(c) && !isImageLine(c)) {
      for (; j < lines.length; j++) {
        const cj = content(lines[j]!);
        if (isBlank(cj) || CONTAINER_OPEN_RE.test(cj) || CONTAINER_CLOSE_RE.test(cj) || NOTE_DEF_LINE_RE.test(cj) || isImageLine(cj)) break;
      }
    }
    const first = L.start + (c.length - c.trimStart().length);
    const lastL = lines[j - 1]!;
    const lastC = t.slice(lastL.start, lastL.end);
    const end = lastL.start + lastC.trimEnd().length;
    const B = t.slice(first, end);
    let node: Node, plain = false;
    if (CONTAINER_CLOSE_RE.test(c)) node = raw(B, 'stray-close', stats); // 1.0 drops a stray close line; kept here as source
    else {
      node = buildBlock(B, stats);
      if (node.type.name !== 'rawBlock' && blockText(node) !== B) node = raw(B, 'mismatch', stats);
      else plain = node.type.name !== 'rawBlock';
    }
    units.push(plain ? { start: first, end, node, B } : { start: first, end, node });
    i = j;
  }

  units = looseLists(t, units, stats);
  if (stats) for (const u of units) if (u.node.type.name !== 'container') { stats.blocks++; if (u.node.type.name === 'rawBlock') stats.raw++; }
  if (!units.length) return [S.node('paragraph', { pre: null, post: t })];
  const out: Node[] = [];
  let at = 0;
  units.forEach((u, k) => {
    const pre = t.slice(at, u.start);
    const post = k === units.length - 1 ? t.slice(u.end) : '';
    out.push(withEdges(u.node, pre === (k === 0 ? '' : '\n\n') ? null : pre, post));
    at = u.end;
  });
  return out;
}

/** 1.0's section `content` -> a document of bookSchema. Never throws on a string; toText of the result is `text` exactly. */
export function toDoc(text: string, stats?: ConvertStats): Node {
  const local: ConvertStats | undefined = stats ? { blocks: 0, raw: 0, rawWhy: {} } : undefined;
  let doc = S.node('doc', null, parseBlocks(text, local));
  if (toText(doc) !== text) {
    doc = S.node('doc', null, [raw(text, 'doc-mismatch')]);
    if (local) { local.blocks = 1; local.raw = 1; local.rawWhy = { 'doc-mismatch': 1 }; }
  }
  if (stats && local) mergeStats(stats, local);
  return doc;
}

/** Blocks and raw blocks in a document (containers count by their children; the empty-text placeholder counts nothing). */
export function blockCoverage(doc: Node): { blocks: number; raw: number } {
  let blocks = 0, rawN = 0;
  doc.descendants((n) => {
    if (n.type.name === 'container') return true;
    if (!n.isBlock) return false;
    if (n.type.name === 'paragraph' && n.childCount === 0 && blocks === 0 && doc.childCount === 1) return false;
    blocks++;
    if (n.type.name === 'rawBlock') rawN++;
    return false;
  });
  return { blocks, raw: rawN };
}

/* ---- keeping an edited document writable (step 4 review, fix round 1) ----

   The lossless guarantee is text -> doc -> text. An EDITED document can hold
   things the text cannot say back the same way: a typed "2*3 and 4*5"
   reopens in italics, bold over text that contains "*" reopens differently,
   a "\n\n" typed inside a paragraph reopens as two paragraphs. The editor
   (part C) keeps the document in its normal form, the form toDoc gives:

   - normalizeBlock(parent, index) re-reads child `index` with the same
     block and inline rules and says which children to replace. The window
     reaches the neighbours because a block's normal form depends on them:
     the canonical separator is by position, a trimmed block's trailing
     whitespace belongs to the next block's pre, an emptied block merges into
     its neighbours' separators, and a ":::" line restructures everything
     after it. Inside a container a ":::" line is always loose (it would end
     the container), so the answer is 'up': normalize the container itself
     in its own parent.
   - canApplyMark / canSetLink say, before a mark is applied, whether the
     result would be read back exactly as applied.

   For a document every block of which normalizeBlock leaves alone,
   toDoc(toText(doc)) equals doc (tests/book-editor-convert.test.ts). */

const looseMarker = (text: string): boolean =>
  text.indexOf(':::') !== -1 && text.split('\n').some((l) => {
    const c = l.endsWith('\r') ? l.slice(0, -1) : l;
    return CONTAINER_OPEN_RE.test(c) || CONTAINER_CLOSE_RE.test(c);
  });

export type BlockFix = { from: number; to: number; blocks: Node[] };

/** Child `index` of `parent` (a doc or a container) in normal form: null when the children are already normal around it,
 *  'up' when the parent (a container) must itself be normalized in its own parent, or the children [from, to) to
 *  replace with `blocks`. */
export function normalizeBlock(parent: Node, index: number): BlockFix | 'up' | null {
  const n = parent.childCount;
  const inContainer = parent.type.name === 'container';
  let from = Math.max(0, index - 1), to = Math.min(n, index + 2);
  // BEUK:looselists — a block that opens on a list's mark may be one list with the blocks before and after it (and the
  // last line of the block before it that list's first item): the window takes in the whole run
  const opens = (i: number): boolean => { const s = blockText(parent.child(i)).trimStart(); return looseKind(firstLine(s)) !== ''; };
  for (;;) {
    if (from > 0 && opens(from)) { from--; continue; }
    if (to < n && opens(to)) { to++; continue; }
    let text = '';
    for (let i = from; i < to; i++) text += childText(parent, i);
    if (looseMarker(text)) {
      if (inContainer) return 'up';
      if (to < n) { to = n; continue; } // a container line reaches to the end of the run
    }
    const blocks = parseBlocks(text);
    const empty = blocks.length === 1 && blocks[0]!.type.name === 'paragraph' && blocks[0]!.childCount === 0 && text.trim() === '';
    if (empty && !(from === 0 && to === n)) { // only whitespace left: it belongs to a neighbour's separator
      if (to < n) to++; else from--;
      continue;
    }
    const last = blocks[blocks.length - 1]!;
    if (!empty && to < n && last.attrs.post !== '') { to++; continue; } // trailing whitespace belongs to the next block's pre
    if (from > 0 && !empty) { // parseBlocks writes the first pre for position 0; re-canonicalise it for position `from`
      const first = blocks[0]!;
      const actual = preOf(first, 0);
      blocks[0] = withEdges(first, actual === '\n\n' ? null : actual, first.attrs.post as string);
    }
    if (to - from === blocks.length && blocks.every((b, k) => b.eq(parent.child(from + k)))) return null;
    return { from, to, blocks };
  }
}

/** The whole document in normal form, block by block: what part C reaches by running normalizeBlock as it edits. At the
 *  document level a window that holds a container re-reads it whole, so this also normalizes container contents. */
export function normalizeDoc(doc: Node): Node {
  let d = doc;
  for (let i = 0, guard = 0; i < d.childCount && guard < 100_000; guard++) {
    const f = normalizeBlock(d, i);
    if (f === null || f === 'up') { i++; continue; }
    d = applyFix(d, f);
    i = Math.max(0, f.from - 1);
  }
  return d;
}

function spliceChildren(parent: Node, f: BlockFix): import('prosemirror-model').Fragment {
  const kids: Node[] = [];
  parent.forEach((k) => { kids.push(k); });
  kids.splice(f.from, f.to - f.from, ...f.blocks);
  return S.node(parent.type.name, parent.attrs, kids).content;
}
function applyFix(parent: Node, f: BlockFix | null): Node {
  return f ? parent.copy(spliceChildren(parent, f)) : parent;
}

/** A link address 1.0 reads as a link (mdLinkRe's address part). */
const HREF_RE = /^(?:https?:\/\/|mailto:)[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*$/i;

/** True when `mark` over [from, to) of `block`'s content (offsets inside the block) reads back exactly as applied:
 *  the block re-read from its text has the same content. False for em/strong over a "*", a span touching the same
 *  mark, a link label with "]" or a line break, an href 1.0 does not read as a link, and any mark on a rawBlock or atom. */
export function canApplyMark(block: Node, from: number, to: number, mark: Mark, line?: { parent: Node; index: number }): boolean {
  if (!block.isTextblock || !block.type.allowsMarkType(mark.type) || from >= to || from < 0 || to > block.content.size) return false;
  // a quote line or list item is read back with its whole block (`line`: that block and the line's index in it)
  if (!('pre' in block.type.spec.attrs!) && !(line && LINE_BLOCKS.has(line.parent.type.name))) return false;
  if (mark.type.name === 'link' && !HREF_RE.test(String(mark.attrs.href))) return false;
  const kids: Node[] = [];
  block.forEach((k, off) => {
    const t = k.text ?? '', a = off, b = off + t.length;
    const cut = (x: number, y: number, add: boolean): void => {
      if (y > x) kids.push(S.text(t.slice(x - a, y - a), add ? mark.addToSet(k.marks) : k.marks));
    };
    const s0 = Math.max(a, Math.min(b, from)), s1 = Math.max(a, Math.min(b, to));
    cut(a, s0, false); cut(s0, s1, true); cut(s1, b, false);
  });
  let candidate: Node;
  if (line && !('pre' in block.type.spec.attrs!)) {
    const p = line.parent;
    candidate = p.type.create({ ...p.attrs, pre: null, post: '' }, p.content.replaceChild(line.index, block.type.create(block.attrs, kids)));
  } else candidate = block.type.create({ ...block.attrs, pre: null, post: '' }, kids);
  const back = parseBlocks(blockText(candidate));
  return back.length === 1 && back[0]!.eq(candidate);
}

/** canApplyMark for a link to `href`. */
export function canSetLink(block: Node, from: number, to: number, href: string, line?: { parent: Node; index: number }): boolean {
  return HREF_RE.test(href) && canApplyMark(block, from, to, S.marks.link!.create({ href }), line);
}
