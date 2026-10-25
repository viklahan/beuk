import { deflateSync } from 'node:zlib';
import { readObjects, type PdfObject } from './pdfinspect.js';

/**
 * Press facts and the one press fix-up the pdfx job makes itself.
 *
 * 1. neutralRgbToGray — before Ghostscript. Chromium (Skia/PDF) writes
 *    every colour as DeviceRGB (`r g b rg` / `RG`), black text
 *    included. Ghostscript's pdfwrite converts DeviceRGB to CMYK
 *    through an ICC transform, so pure black text came out as rich
 *    four-colour black (measured on GPL Ghostscript 10.00.0, 2026-10-25:
 *    `0 0 0 rg` → `0.71 0.659 0.651 0.996 k`, 301 % total ink, through
 *    the SWOP profile), while DeviceGray is left as DeviceGray
 *    (`1 g` stayed `1 g` in the same run) — and Ghostscript documents
 *    that "By default, Ghostscript will map DeviceGray color spaces to
 *    pure K when the output device is CMYK based"
 *    (https://ghostscript.readthedocs.io/en/latest/GhostscriptColorManagement.html,
 *    -dDeviceGrayToK). IngramSpark asks for text in black ink only
 *    (File Creation Guide, https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf).
 *    So every NEUTRAL fill/stroke colour (r = g = b) in the renderer's
 *    content streams is rewritten as the same DeviceGray value
 *    (`a a a rg` → `a g`) — black stays black, a grey tint stays the same
 *    grey, printed on the black plate alone. Coloured values are never
 *    touched. The rewritten streams are appended as a standard PDF
 *    incremental update (ISO 32000-1 §7.5.6), so the original bytes are
 *    kept verbatim ahead of it.
 *
 * 2. textInkFacts — after Ghostscript: every text-showing operator in
 *    the converted file, with the fill (or stroke) colour in force when
 *    it ran, so the Store-ready report can say "text is black ink only"
 *    from the file itself, never from the recipe.
 *
 * 3. transparencyFacts — on the renderer's PDF: what PDF/X-1a will make
 *    Ghostscript flatten (constant alpha < 1, soft masks, blend modes,
 *    transparency groups), counted.
 *
 * 4. parsePam / tacFromPam — the per-pixel total ink of a CMYK raster
 *    of the converted file (Ghostscript's pamcmyk32 device; see
 *    measureTac in tools.ts).
 *
 * Honesty: anything this reader cannot read is reported as unknown or
 * skipped with the reason — never as a pass.
 */

/* ------------------------------ content tokens ------------------------------ */

export type ContentToken =
  | { kind: 'num'; text: string; value: number; start: number; end: number }
  | { kind: 'name'; text: string; start: number; end: number }
  | { kind: 'op'; text: string; start: number; end: number }
  | { kind: 'other'; text: string; start: number; end: number };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** Tokenise a PDF content stream (ISO 32000-1 §7.2, §7.8.2). Strings,
 *  hex strings, arrays/dict brackets and inline image data are emitted
 *  as 'other' so no operator is ever read out of them. */
export function contentTokens(src: string): ContentToken[] {
  const out: ContentToken[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (WS.has(c)) {
      i += 1;
      continue;
    }
    const ch = src[i];
    if (ch === '%') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    const start = i;
    if (ch === '(') {
      let depth = 0;
      for (; i < n; i += 1) {
        const x = src[i];
        if (x === '\\') {
          i += 1;
          continue;
        }
        if (x === '(') depth += 1;
        else if (x === ')') {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
      }
      out.push({ kind: 'other', text: src.slice(start, i), start, end: i });
      continue;
    }
    if (ch === '<') {
      if (src[i + 1] === '<') {
        i += 2;
        out.push({ kind: 'other', text: '<<', start, end: i });
        continue;
      }
      const close = src.indexOf('>', i);
      i = close === -1 ? n : close + 1;
      out.push({ kind: 'other', text: src.slice(start, i), start, end: i });
      continue;
    }
    if (ch === '>' && src[i + 1] === '>') {
      i += 2;
      out.push({ kind: 'other', text: '>>', start, end: i });
      continue;
    }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '>' || ch === ')') {
      i += 1;
      out.push({ kind: 'other', text: ch, start, end: i });
      continue;
    }
    if (ch === '/') {
      i += 1;
      while (i < n && !WS.has(src.charCodeAt(i)) && !DELIM.has(src[i])) i += 1;
      out.push({ kind: 'name', text: src.slice(start + 1, i), start, end: i });
      continue;
    }
    while (i < n && !WS.has(src.charCodeAt(i)) && !DELIM.has(src[i])) i += 1;
    const word = src.slice(start, i);
    if (NUM_RE.test(word)) {
      out.push({ kind: 'num', text: word, value: Number(word), start, end: i });
      continue;
    }
    if (word === 'BI') {
      // Inline image: the dictionary, then ID, binary data, then EI on
      // its own token (§8.9.7). Skip the whole thing as one token.
      const id = src.indexOf('ID', i);
      let j = id === -1 ? n : id + 2;
      const eiRe = /\sEI(?=[\s]|$)/g;
      eiRe.lastIndex = j;
      const m = eiRe.exec(src);
      j = m ? m.index + m[0].length : n;
      i = j;
      out.push({ kind: 'other', text: 'BI…EI', start, end: i });
      continue;
    }
    out.push({ kind: 'op', text: word, start, end: i });
  }
  return out;
}

/* ------------------------------ neutral RGB → gray ------------------------------ */

/** Rewrite neutral `a a a rg` / `a a a RG` as `a g` / `a G` in one
 *  decoded content stream. Returns the new text and how many it changed. */
export function neutralizeContent(src: string): { text: string; rewritten: number } {
  const toks = contentTokens(src);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (let k = 3; k < toks.length; k += 1) {
    const op = toks[k];
    if (op.kind !== 'op' || (op.text !== 'rg' && op.text !== 'RG')) continue;
    const a = toks[k - 3], b = toks[k - 2], c = toks[k - 1];
    if (a.kind !== 'num' || b.kind !== 'num' || c.kind !== 'num') continue;
    if (a.value !== b.value || b.value !== c.value) continue;
    edits.push({ start: a.start, end: op.end, text: `${a.text} ${op.text === 'rg' ? 'g' : 'G'}` });
  }
  if (!edits.length) return { text: src, rewritten: 0 };
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += src.slice(at, e.start) + e.text;
    at = e.end;
  }
  return { text: out + src.slice(at), rewritten: edits.length };
}

const refNum = (dict: string, key: string): number | null => {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(dict);
  return m ? Number(m[1]) : null;
};

/** Every content-stream object: page /Contents (a ref or an array of
 *  refs), Form XObjects, and tiling patterns (their own content). */
function contentStreamNums(objects: PdfObject[]): Set<number> {
  const nums = new Set<number>();
  for (const o of objects) {
    if (/\/Type\s*\/Page(?![A-Za-z])/.test(o.dict)) {
      const arr = /\/Contents\s*\[([^\]]*)\]/.exec(o.dict);
      if (arr) for (const m of arr[1].matchAll(/(\d+)\s+\d+\s+R/g)) nums.add(Number(m[1]));
      else {
        const one = refNum(o.dict, 'Contents');
        if (one !== null) nums.add(one);
      }
    }
    if (o.stream !== null && (/\/Subtype\s*\/Form\b/.test(o.dict) || /\/PatternType\s+1\b/.test(o.dict))) nums.add(o.num);
  }
  return nums;
}

export interface NeutralGrayOutcome {
  pdf: Buffer;
  /** Content streams rewritten / operators rewritten. 0/0 = unchanged bytes. */
  streams: number;
  operators: number;
  /** Set when the rewrite was not attempted; the bytes are unchanged. */
  skipped: string | null;
}

/** Apply neutralizeContent to every content stream of a PDF, as an
 *  incremental update. A file this cannot safely update (an xref
 *  stream, a stream it cannot decode) is returned unchanged, saying so. */
export function neutralRgbToGray(buf: Buffer): NeutralGrayOutcome {
  const same = (skipped: string | null): NeutralGrayOutcome => ({ pdf: buf, streams: 0, operators: 0, skipped });
  const tailText = buf.subarray(Math.max(0, buf.length - 4096)).toString('latin1');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tailText);
  const trailerAt = tailText.lastIndexOf('trailer');
  if (!sx || trailerAt === -1) {
    return same('the PDF has no classic xref table and trailer (an xref stream?), so it was left as rendered');
  }
  const trailer = tailText.slice(trailerAt, tailText.lastIndexOf('startxref'));
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(trailer);
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(trailer);
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)?.[1] ?? NaN);
  if (!root || !Number.isFinite(size)) return same('the PDF trailer has no /Root or /Size, so it was left as rendered');
  if (/\/Encrypt\b/.test(trailer)) return same('the PDF is encrypted, so it was left as rendered');

  const notes: string[] = [];
  const objects = readObjects(buf, notes);
  const latest = new Map<number, PdfObject>();
  for (const o of objects) latest.set(o.num, o);
  const targets = contentStreamNums([...latest.values()]);

  const parts: Buffer[] = [];
  const offsets: Array<{ num: number; gen: number; offset: number }> = [];
  let offset = buf.length;
  let operators = 0;
  const push = (b: Buffer) => {
    parts.push(b);
    offset += b.length;
  };
  push(Buffer.from('\n', 'latin1'));
  for (const num of [...targets].sort((x, y) => x - y)) {
    const o = latest.get(num);
    if (!o || o.stream === null) continue; // not decodable: left as is
    if (/\/DecodeParms\b/.test(o.dict)) continue;
    const { text, rewritten } = neutralizeContent(o.stream);
    if (!rewritten) continue;
    const body = deflateSync(Buffer.from(text, 'latin1'));
    const dict = o.dict
      .trim()
      .replace(/^<<|>>$/g, '')
      .replace(/\/Length\s+\d+(?:\s+\d+\s+R)?/, '')
      .replace(/\/Filter\s*(?:\[[^\]]*\]|\/\w+)/, '');
    offsets.push({ num, gen: o.gen, offset });
    push(Buffer.from(`${num} ${o.gen} obj\n<<${dict} /Filter /FlateDecode /Length ${body.length}>>\nstream\n`, 'latin1'));
    push(body);
    push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    operators += rewritten;
  }
  if (!offsets.length) return same(null);
  const xrefAt = offset;
  let xref = 'xref\n';
  for (const e of offsets) xref += `${e.num} 1\n${String(e.offset).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} n \n`;
  const newSize = Math.max(size, ...offsets.map((e) => e.num + 1));
  xref +=
    `trailer\n<</Size ${newSize} /Root ${root[1]}${info ? ` /Info ${info[1]}` : ''} /Prev ${sx[1]}>>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  push(Buffer.from(xref, 'latin1'));
  return { pdf: Buffer.concat([buf, ...parts]), streams: offsets.length, operators, skipped: null };
}

/* ------------------------------ text ink ------------------------------ */

export interface TextInkFacts {
  /** Text-showing operators (Tj, TJ, ', ") that put ink down. */
  textShows: number;
  /** …of which in black ink only: DeviceGray, or CMYK with C = M = Y = 0. */
  kOnly: number;
  /** K-only text by its black value, e.g. { "100": 812, "75": 40 } (percent K). */
  kValues: Record<string, number>;
  /** Text in any other colour: a few examples, "c m y k k" / "r g b rg" / a space name. */
  otherColours: Record<string, number>;
  /** Pages (1-based) that show any text at all. */
  pagesWithText: number[];
  pageCount: number;
  notes: string[];
}

interface Colour {
  space: string;
  values: number[];
}
interface GState {
  fill: Colour;
  stroke: Colour;
  tr: number;
}

const DEFAULT_COLOUR: Colour = { space: 'DeviceGray', values: [0] };
const defaultFor = (space: string): Colour => {
  if (space === 'DeviceRGB') return { space, values: [0, 0, 0] };
  if (space === 'DeviceCMYK') return { space, values: [0, 0, 0, 1] };
  if (space === 'DeviceGray') return { space, values: [0] };
  return { space, values: [] };
};

/** The balanced `<< … >>` dictionary text after `/key`, following one
 *  indirect reference if the value is `N G R`. */
function subDict(dict: string, key: string, byNum: Map<number, PdfObject>): string | null {
  const at = dict.search(new RegExp('/' + key + '(?![A-Za-z0-9])'));
  if (at === -1) return null;
  let i = at + key.length + 1;
  while (/\s/.test(dict[i] ?? '')) i += 1;
  if (dict.startsWith('<<', i)) {
    let depth = 0;
    for (let j = i; j < dict.length - 1; j += 1) {
      if (dict.startsWith('<<', j)) {
        depth += 1;
        j += 1;
      } else if (dict.startsWith('>>', j)) {
        depth -= 1;
        j += 1;
        if (depth === 0) return dict.slice(i, j + 1);
      }
    }
    return null;
  }
  const r = /^(\d+)\s+\d+\s+R/.exec(dict.slice(i));
  if (r) {
    const o = byNum.get(Number(r[1]));
    return o ? o.dict : null;
  }
  return null;
}

/** name → object number from a resource sub-dictionary (e.g. /XObject). */
function resourceRefs(resources: string | null, kind: string, byNum: Map<number, PdfObject>): Map<string, number> {
  const out = new Map<string, number>();
  if (!resources) return out;
  const d = subDict(resources, kind, byNum);
  if (!d) return out;
  for (const m of d.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) out.set(m[1], Number(m[2]));
  return out;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const isKOnly = (c: Colour): boolean =>
  c.space === 'DeviceGray' ||
  (c.space === 'DeviceCMYK' && c.values.length === 4 && c.values[0] <= 0.0005 && c.values[1] <= 0.0005 && c.values[2] <= 0.0005);
const kPercent = (c: Colour): string =>
  String(Math.round((c.space === 'DeviceGray' ? 1 - (c.values[0] ?? 0) : (c.values[3] ?? 0)) * 100));
const describe = (c: Colour): string =>
  c.space === 'DeviceCMYK' ? `${c.values.map(fmt).join(' ')} k` : c.space === 'DeviceRGB' ? `${c.values.map(fmt).join(' ')} rg` : `${c.space} ${c.values.map(fmt).join(' ')}`.trim();

export function textInkFacts(buf: Buffer): TextInkFacts {
  const notes: string[] = [];
  const objects = readObjects(buf, notes);
  const byNum = new Map<number, PdfObject>();
  for (const o of objects) byNum.set(o.num, o);
  const facts: TextInkFacts = { textShows: 0, kOnly: 0, kValues: {}, otherColours: {}, pagesWithText: [], pageCount: 0, notes };
  const pages = objects.filter((o) => /\/Type\s*\/Page(?![A-Za-z])/.test(o.dict));
  facts.pageCount = pages.length;

  const inheritedResources = (o: PdfObject): string | null => {
    for (let hops = 0, cur: PdfObject | undefined = o; cur && hops < 32; hops += 1) {
      const r = subDict(cur.dict, 'Resources', byNum);
      if (r) return r;
      const p = refNum(cur.dict, 'Parent');
      cur = p === null ? undefined : byNum.get(p);
    }
    return null;
  };

  const run = (content: string, resources: string | null, start: GState, depth: number): number => {
    let shows = 0;
    const stack: GState[] = [];
    let gs: GState = { fill: { ...start.fill }, stroke: { ...start.stroke }, tr: start.tr };
    let operands: ContentToken[] = [];
    const colourSpaces = resourceRefs(resources, 'ColorSpace', byNum);
    const xobjects = resourceRefs(resources, 'XObject', byNum);
    const spaceOf = (name: string): string => {
      if (name === 'DeviceGray' || name === 'DeviceRGB' || name === 'DeviceCMYK' || name === 'Pattern') return name;
      const num = colourSpaces.get(name);
      const o = num === undefined ? undefined : byNum.get(num);
      // A named space we can't read stays named: reported, never assumed K.
      return o ? `/${name} (${o.dict.trim().slice(0, 40)})` : `/${name}`;
    };
    const nums = () => operands.filter((t) => t.kind === 'num').map((t) => (t as { value: number }).value);
    const record = () => {
      if (gs.tr === 3 || gs.tr === 7) return; // invisible text puts no ink down
      const c = gs.tr === 1 || gs.tr === 5 ? gs.stroke : gs.fill;
      shows += 1;
      facts.textShows += 1;
      if (isKOnly(c)) {
        facts.kOnly += 1;
        const k = kPercent(c);
        facts.kValues[k] = (facts.kValues[k] ?? 0) + 1;
      } else {
        const d = describe(c);
        facts.otherColours[d] = (facts.otherColours[d] ?? 0) + 1;
      }
    };
    for (const tok of contentTokens(content)) {
      if (tok.kind !== 'op') {
        operands.push(tok);
        continue;
      }
      const v = nums();
      switch (tok.text) {
        case 'q':
          stack.push({ fill: { ...gs.fill }, stroke: { ...gs.stroke }, tr: gs.tr });
          break;
        case 'Q':
          gs = stack.pop() ?? gs;
          break;
        case 'g':
          gs.fill = { space: 'DeviceGray', values: v.slice(-1) };
          break;
        case 'G':
          gs.stroke = { space: 'DeviceGray', values: v.slice(-1) };
          break;
        case 'rg':
          gs.fill = { space: 'DeviceRGB', values: v.slice(-3) };
          break;
        case 'RG':
          gs.stroke = { space: 'DeviceRGB', values: v.slice(-3) };
          break;
        case 'k':
          gs.fill = { space: 'DeviceCMYK', values: v.slice(-4) };
          break;
        case 'K':
          gs.stroke = { space: 'DeviceCMYK', values: v.slice(-4) };
          break;
        case 'cs':
        case 'CS': {
          const name = operands.filter((t) => t.kind === 'name').pop();
          const c = defaultFor(name ? spaceOf(name.text) : 'unknown');
          if (tok.text === 'cs') gs.fill = c;
          else gs.stroke = c;
          break;
        }
        case 'sc':
        case 'scn':
          gs.fill = { space: gs.fill.space, values: v };
          break;
        case 'SC':
        case 'SCN':
          gs.stroke = { space: gs.stroke.space, values: v };
          break;
        case 'Tr':
          gs.tr = v.length ? v[v.length - 1] : gs.tr;
          break;
        case 'Tj':
        case 'TJ':
        case "'":
        case '"':
          record();
          break;
        case 'Do': {
          const name = operands.filter((t) => t.kind === 'name').pop();
          const num = name ? xobjects.get(name.text) : undefined;
          const x = num === undefined ? undefined : byNum.get(num);
          if (x && /\/Subtype\s*\/Form\b/.test(x.dict)) {
            if (depth > 12) notes.push('form XObjects nest deeper than 12; the rest were not read');
            else if (x.stream === null) notes.push(`form XObject ${num} could not be decoded; its text was not read`);
            else shows += run(x.stream, subDict(x.dict, 'Resources', byNum) ?? resources, gs, depth + 1);
          }
          break;
        }
        default:
          break;
      }
      operands = [];
    }
    return shows;
  };

  pages.forEach((p, idx) => {
    const arr = /\/Contents\s*\[([^\]]*)\]/.exec(p.dict);
    const refs = arr ? [...arr[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])) : [refNum(p.dict, 'Contents')].filter((x): x is number => x !== null);
    const texts: string[] = [];
    for (const r of refs) {
      const o = byNum.get(r);
      if (!o || o.stream === null) notes.push(`page ${idx + 1}: a content stream could not be decoded; its text was not read`);
      else texts.push(o.stream);
    }
    const shows = run(texts.join('\n'), inheritedResources(p), { fill: DEFAULT_COLOUR, stroke: DEFAULT_COLOUR, tr: 0 }, 0);
    if (shows > 0) facts.pagesWithText.push(idx + 1);
  });
  return facts;
}

/* ------------------------------ transparency ------------------------------ */

export interface TransparencyFacts {
  /** ExtGState dictionaries with constant alpha /ca or /CA below 1. */
  constantAlpha: number;
  /** ExtGState soft masks (/SMask other than /None). */
  softMasks: number;
  /** Images carrying their own /SMask. */
  imageSoftMasks: number;
  /** Blend modes other than Normal / Compatible. */
  blendModes: number;
  /** Transparency groups (/Group << /S /Transparency >>). */
  groups: number;
}

/** What in a PDF counts as transparency to PDF/X-1a (ISO 15930-1
 *  forbids it; Ghostscript flattens any page that has some). */
export function transparencyFacts(buf: Buffer): TransparencyFacts {
  const objects = readObjects(buf, []);
  const f: TransparencyFacts = { constantAlpha: 0, softMasks: 0, imageSoftMasks: 0, blendModes: 0, groups: 0 };
  for (const o of objects) {
    const d = o.dict;
    for (const m of d.matchAll(/\/(ca|CA)\s+([0-9.]+)/g)) if (Number(m[2]) < 1) f.constantAlpha += 1;
    if (/\/Subtype\s*\/Image\b/.test(d)) {
      if (/\/SMask\s+\d+\s+\d+\s+R/.test(d)) f.imageSoftMasks += 1;
    } else {
      for (const m of d.matchAll(/\/SMask\s*(\/None|<<|\d+\s+\d+\s+R)/g)) if (m[1] !== '/None') f.softMasks += 1;
    }
    for (const m of d.matchAll(/\/BM\s*\/(\w+)/g)) if (m[1] !== 'Normal' && m[1] !== 'Compatible') f.blendModes += 1;
    if (/\/S\s*\/Transparency\b/.test(d)) f.groups += 1;
  }
  return f;
}

/* ------------------------------ total ink ------------------------------ */

export interface PamImage {
  width: number;
  height: number;
  depth: number;
  maxval: number;
  tupltype: string;
  data: Buffer;
}

/** Netpbm PAM (P7) reader — https://netpbm.sourceforge.net/doc/pam.html */
export function parsePam(buf: Buffer): PamImage | null {
  if (buf.subarray(0, 3).toString('latin1') !== 'P7\n') return null;
  const end = buf.indexOf('ENDHDR\n', 0, 'latin1');
  if (end === -1) return null;
  const head = buf.subarray(3, end).toString('latin1');
  const field = (k: string) => new RegExp('^' + k + '\\s+(\\S+)', 'm').exec(head)?.[1];
  const width = Number(field('WIDTH'));
  const height = Number(field('HEIGHT'));
  const depth = Number(field('DEPTH'));
  const maxval = Number(field('MAXVAL'));
  const tupltype = String(field('TUPLTYPE') ?? '');
  const data = buf.subarray(end + 7);
  if (![width, height, depth, maxval].every((x) => Number.isInteger(x) && x > 0)) return null;
  if (maxval > 255 || data.length < width * height * depth) return null;
  return { width, height, depth, maxval, tupltype, data };
}

/** Highest per-pixel C+M+Y+K, in percent, of an 8-bit CMYK PAM. */
export function tacFromPam(img: PamImage): number | null {
  if (img.depth !== 4 || !/CMYK/i.test(img.tupltype)) return null;
  let max = 0;
  const d = img.data;
  const len = img.width * img.height * 4;
  for (let i = 0; i < len; i += 4) {
    const s = d[i] + d[i + 1] + d[i + 2] + d[i + 3];
    if (s > max) max = s;
  }
  return Math.round((max / img.maxval) * 1000) / 10;
}
