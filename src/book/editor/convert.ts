import { type Mark, type Node } from 'prosemirror-model';
import { DELIMITED_MARKS, bookSchema as S } from './schema.js';

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
const NOTE_DEF_LINE_RE = /^\[\^?\d{1,3}\]:/;
const NOTE_DEF_RE = /^\[(\^?)(\d{1,3})\]:(\s*)([\s\S]+)$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(img:([A-Za-z0-9-]+)(\|full)?(?:([ \t]+)(["“”])([^"“”\n]*)(["“”]))?\)$/;
const LIST_BULLET = /^[-*•]\s+/;
const LIST_NUMBER = /^(\d{1,3})[.)]\s+/;
const REDACT_RE = /\|\|(?=[^|\s])([^|\n]*?[^|\s])\|\|/g;
const LINK_RE = /(?<!!)\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()<>]+(?:\([^\s()<>]*\)[^\s()<>]*)*)\)/gi;
const STRONG_RE = /\*\*([^*]+)\*\*/g;
const EM_RE = /\*([^*\n]+)\*/g;
const REF_RE = /\[\^(\d{1,3})\]|\[(\d{1,3})\]/g;
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

function listItemsOf(lines: string[]): boolean { // 1.0's listItemsOf, as a test
  const ordered = LIST_NUMBER.test(lines[0]!);
  if (!ordered && !LIST_BULLET.test(lines[0]!)) return false;
  const mark = ordered ? LIST_NUMBER : LIST_BULLET;
  let items = 0;
  for (const l of lines) {
    if (mark.test(l)) items++;
    else if (!ordered && LIST_NUMBER.test(l)) return false;
  }
  return ordered || items >= 2;
}

/* ---- inline ---- */

const F_RAW = 1, F_EM = 2, F_STRONG = 4, F_LINK = 8, F_REF = 16, F_SKIP = 32;

function maskRanges(s: string, ranges: [number, number][]): string {
  if (!ranges.length) return s;
  let out = '', at = 0;
  for (const [a, b] of ranges) { out += s.slice(at, a) + HOLD.repeat(b - a); at = b; }
  return out + s.slice(at);
}

/** **strong** then *em* over str[a, b), as inlineMd's emph: strong first, then em on the text with the strong delimiters gone. */
function emph(str: string, a: number, b: number, joinLines: boolean, flags: Uint8Array): void {
  const sub = str.slice(a, b);
  if (sub.indexOf('*') === -1) return;
  const held: [number, number][] = [];
  for (const m of sub.matchAll(STRONG_RE)) {
    const s0 = a + m.index, e0 = s0 + m[0].length;
    flags[s0] = flags[s0 + 1] = flags[e0 - 2] = flags[e0 - 1] = F_SKIP;
    for (let i = s0 + 2; i < e0 - 2; i++) flags[i]! |= F_STRONG;
    held.push([m.index, m.index + 2], [m.index + m[0].length - 2, m.index + m[0].length]);
  }
  let emStr = maskRanges(sub, held);
  if (joinLines) emStr = emStr.replace(/\n/g, ' '); // a paragraph's lines are joined with a space before inlineMd
  for (const m of emStr.matchAll(EM_RE)) {
    const s0 = a + m.index, e0 = s0 + m[0].length;
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
  if (masked.indexOf('](') !== -1) for (const m of masked.matchAll(LINK_RE)) {
    const start = m.index, labelStart = start + 1, labelEnd = labelStart + m[1]!.length, end = start + m[0].length;
    linkOf ??= new Int32Array(n).fill(-1);
    flags[start] = F_SKIP;
    for (let i = labelEnd; i < end; i++) flags[i] = F_SKIP;
    for (let i = labelStart; i < labelEnd; i++) { flags[i]! |= F_LINK; linkOf[i] = hrefs.length; }
    hrefs.push(s.slice(labelEnd + 2, end - 1));
    emph(masked, labelStart, labelEnd, false, flags);
    links.push([start, end]);
  }
  const outer = maskRanges(masked, links);

  // 3. emphasis, 4. footnote refs, 5. note links (left raw)
  emph(outer, 0, n, joinLines, flags);
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
    const open = ms.filter((m) => !m.isInSet(stack));
    if (open.length > 1) {
      // the mark that runs longest opens first (it encloses the others); on a tie, link, then em, then strong
      const run = (m: Mark): number => { let x = j; while (x < kids.length && m.isInSet(kids[x]!.marks)) x++; return x - j; };
      const len = new Map(open.map((m) => [m, run(m)]));
      open.sort((p, q) => len.get(q)! - len.get(p)! || DELIM_RANK[p.type.name]! - DELIM_RANK[q.type.name]!);
    }
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
    case 'footnoteDef': return '[' + (a.caret ? '^' : '') + String(a.n) + ']:' + String(a.gap) + inlineText(node);
    case 'image':
      return '![' + String(a.alt) + '](img:' + String(a.id) + (a.full ? '|full' : '') +
        (a.caption !== null ? String(a.capGap) + String(a.q1) + String(a.caption) + String(a.q2) : '') + ')';
    case 'sceneBreak': return String(a.raw);
    case 'rawBlock': return node.textContent;
    case 'container': return String(a.open) + String(a.openEol) + blocksText(node) + (a.close !== null ? String(a.close) : '');
    default: return node.textContent;
  }
}

/** The source of a run of blocks (a doc's or a container's children). */
export function blocksText(parent: Node): string {
  let out = '';
  parent.forEach((b, _off, i) => {
    const pre = b.attrs.pre;
    out += (pre === null || pre === undefined ? (i === 0 ? '' : '\n\n') : String(pre)) + blockText(b) + String(b.attrs.post ?? '');
  });
  return out;
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
  const lines = B.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const single = lines.length === 1;
  if (single && (ORNAMENT_RE.test(B) || SCENE_BREAK_SRC_RE.test(B))) return S.node('sceneBreak', { raw: B });
  const nd = NOTE_DEF_RE.exec(B);
  if (nd) return S.node('footnoteDef', { caret: nd[1] === '^', n: nd[2], gap: nd[3] }, inlineNodes(nd[4]!, false));
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
  if (listItemsOf(lines)) return raw(B, 'list', stats);
  if (lines.every((l) => l.startsWith('>'))) return raw(B, 'quote', stats);
  if (B.startsWith('## ') || B.startsWith('# ')) return raw(B, 'heading', stats);
  return S.node('paragraph', null, inlineNodes(B, true));
}

function withEdges(node: Node, pre: string | null, post: string): Node {
  if (pre === null && post === '') return node;
  return node.type.create({ ...node.attrs, pre, post }, node.content, node.marks);
}

/** A run of text -> its blocks (at least one), each carrying its exact pre, the last its post. */
function parseBlocks(t: string, stats?: ConvertStats): Node[] {
  const lines = splitLines(t);
  const content = (L: Line): string => t.slice(L.start, L.end);
  const units: { start: number; end: number; node: Node }[] = [];
  const count = (node: Node): Node => {
    if (stats && node.type.name !== 'container') { stats.blocks++; if (node.type.name === 'rawBlock') stats.raw++; }
    return node;
  };

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
        if (blockText(node) !== src) node = count(raw(src, 'mismatch', stats));
        else if (stats && innerStats) mergeStats(stats, innerStats);
      } else {
        node = count(raw(src, 'container:' + om[1]!.toLowerCase(), stats));
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
    let node: Node;
    if (CONTAINER_CLOSE_RE.test(c)) node = raw(B, 'stray-close', stats); // 1.0 drops a stray close line; kept here as source
    else {
      node = buildBlock(B, stats);
      if (node.type.name !== 'rawBlock' && blockText(node) !== B) node = raw(B, 'mismatch', stats);
    }
    units.push({ start: first, end, node: count(node) });
    i = j;
  }

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
