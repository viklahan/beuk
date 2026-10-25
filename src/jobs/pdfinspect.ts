import { inflateSync } from 'node:zlib';

/**
 * Store-ready tie-in: a small, dependency-free reader over the PDF the
 * pdfx job produces, so the studio's "Store-ready?" report can fold in
 * FACTS about the converted file instead of assuming them:
 *
 * - how many pages it has and the first page's MediaBox / TrimBox /
 *   BleedBox (in inches);
 * - whether it declares PDF/X (GTS_PDFXVersion / GTS_PDFXConformance in
 *   the Info dictionary or XMP) and carries a GTS_PDFX OutputIntent;
 * - every font it uses and whether each one's program is embedded
 *   (a FontDescriptor with /FontFile, /FontFile2 or /FontFile3 —
 *   Type 3 fonts are glyph procedures inside the file, so embedded by
 *   construction);
 * - how many RGB colour references remain (DeviceRGB / CalRGB names,
 *   3-component ICCBased profiles, and `rg`/`RG` operators in decoded
 *   content streams).
 *
 * The honesty contract: this reads what the file SAYS. A declared
 * PDF/X version is reported as "declared", never as "validated" — no
 * PDF/X validator runs here. Anything the reader cannot parse is
 * reported as unknown (null), never as a pass.
 *
 * Why these facts: IngramSpark's File Creation Guide (rev. 8.24.26)
 * requires PDF/X-1a:2001 or PDF/X-3:2002 and "ALL FONTS must be
 * embedded" — https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf
 * KDP: "Embed all fonts", "PDF/X-1a is preferred" —
 * https://kdp.amazon.com/en_US/help/topic/G202145060
 */

export interface PdfBoxInches {
  w: number;
  h: number;
}

export interface PdfFontFact {
  name: string;
  subtype: string;
  embedded: boolean;
}

export interface PdfInspection {
  headerVersion: string | null;
  pageCount: number;
  firstPage: { mediaBox: PdfBoxInches | null; trimBox: PdfBoxInches | null; bleedBox: PdfBoxInches | null };
  pdfx: {
    version: string | null;
    conformance: string | null;
    outputIntent: boolean;
    outputCondition: string | null;
  };
  fonts: PdfFontFact[];
  /** true / false when fonts were found; null when the file uses none. */
  fontsAllEmbedded: boolean | null;
  rgb: { colourSpaceRefs: number; rgbOperators: number };
  encrypted: boolean;
  /** Plain notes about anything the reader could not read. */
  notes: string[];
}

interface PdfObject {
  num: number;
  dict: string;
  /** Decoded stream text (latin1) when the stream could be decoded. */
  stream: string | null;
}

const STREAM_DECODE_CAP = 64 * 1024 * 1024;

function decodeStream(dict: string, raw: Buffer): Buffer | null {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict);
  if (!filter) return raw;
  const names = filter[1].match(/\/\w+/g) ?? [];
  if (names.length === 1 && names[0] === '/FlateDecode') {
    try {
      return inflateSync(raw);
    } catch {
      return null;
    }
  }
  return null; // DCT, LZW, … — not text we need to read
}

/** Pull every `N G obj … endobj` out of the file, plus the objects
 *  packed inside FlateDecode object streams (/Type /ObjStm). */
function readObjects(buf: Buffer, notes: string[]): PdfObject[] {
  const text = buf.toString('latin1');
  const out: PdfObject[] = [];
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let decoded = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endobj', start);
    if (end === -1) break;
    const body = text.slice(start, end);
    const streamAt = body.search(/\bstream\r?\n/);
    let dict = body;
    let stream: string | null = null;
    if (streamAt !== -1) {
      dict = body.slice(0, streamAt);
      const nl = body.indexOf('\n', streamAt) + 1;
      const endStream = body.lastIndexOf('endstream');
      if (endStream > nl) {
        let rawEnd = endStream;
        if (body[rawEnd - 1] === '\n') rawEnd -= 1;
        if (body[rawEnd - 1] === '\r') rawEnd -= 1;
        const rawStart = start + nl;
        // A direct /Length is exact; an indirect one falls back to the
        // endstream keyword (trailing EOL trimmed above).
        const len = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
        const lenN = len && !len[2] ? Number(len[1]) : NaN;
        const raw =
          Number.isFinite(lenN) && nl + lenN <= endStream
            ? buf.subarray(rawStart, rawStart + lenN)
            : buf.subarray(rawStart, start + rawEnd);
        if (decoded + raw.length <= STREAM_DECODE_CAP) {
          const dec = decodeStream(dict, raw);
          if (dec) {
            decoded += dec.length;
            stream = dec.toString('latin1');
          }
        }
      }
    }
    out.push({ num: Number(m[1]), dict, stream });
    re.lastIndex = end + 6;
  }
  // Objects compressed inside object streams.
  for (const o of [...out]) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict)) continue;
    if (o.stream === null) {
      notes.push(`object stream ${o.num} could not be decoded; its objects were not read`);
      continue;
    }
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? NaN);
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? NaN);
    if (!Number.isFinite(n) || !Number.isFinite(first)) continue;
    const head = o.stream.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const num = head[i * 2];
      const off = head[i * 2 + 1];
      const nextOff = i + 1 < n ? head[(i + 1) * 2 + 1] : o.stream.length - first;
      if (!Number.isFinite(num) || !Number.isFinite(off)) continue;
      out.push({ num, dict: o.stream.slice(first + off, first + nextOff), stream: null });
    }
  }
  return out;
}

/** A PDF string value (literal or hex) following `key`, decoded. */
export function pdfStringAfter(text: string, key: string): string | null {
  const at = text.search(new RegExp('/' + key + '\\s*[(<]'));
  if (at === -1) return null;
  let i = text.indexOf(key, at) + key.length;
  while (/\s/.test(text[i] ?? '')) i += 1;
  if (text[i] === '<') {
    const end = text.indexOf('>', i);
    const hex = text.slice(i + 1, end).replace(/\s+/g, '');
    const bytes = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = Buffer.from(bytes.subarray(2));
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    return bytes.toString('latin1');
  }
  // literal string with balanced parentheses and backslash escapes
  let depth = 0;
  let out = '';
  for (i += 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') {
      out += text[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    out += c;
  }
  return out;
}

function boxIn(dict: string, key: string): PdfBoxInches | null {
  const m = new RegExp('/' + key + '\\s*\\[\\s*([-\\d.\\s]+)\\]').exec(dict);
  if (!m) return null;
  const n = m[1].trim().split(/\s+/).map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  const r = (v: number) => Math.round((v / 72) * 1000) / 1000;
  return { w: r(Math.abs(n[2] - n[0])), h: r(Math.abs(n[3] - n[1])) };
}

const ref = (dict: string, key: string): number | null => {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(dict);
  return m ? Number(m[1]) : null;
};

export function inspectPdf(buf: Buffer): PdfInspection {
  const notes: string[] = [];
  const header = /^%PDF-(\d\.\d)/.exec(buf.subarray(0, 16).toString('latin1'));
  const objects = readObjects(buf, notes);
  const byNum = new Map<number, PdfObject>();
  for (const o of objects) byNum.set(o.num, o);
  const tail = buf.subarray(Math.max(0, buf.length - 4096)).toString('latin1');

  const isPage = (d: string) => /\/Type\s*\/Page(?![A-Za-z])/.test(d);
  const pages = objects.filter((o) => isPage(o.dict));
  // MediaBox may be inherited from the /Pages tree: walk up /Parent.
  const inherited = (o: PdfObject | undefined, key: string): PdfBoxInches | null => {
    for (let hops = 0; o && hops < 32; hops += 1) {
      const b = boxIn(o.dict, key);
      if (b) return b;
      const p = ref(o.dict, 'Parent');
      o = p === null ? undefined : byNum.get(p);
    }
    return null;
  };
  const firstPageObj = pages[0];
  const mediaBox = firstPageObj ? inherited(firstPageObj, 'MediaBox') : null;
  const firstPage = {
    mediaBox,
    trimBox: firstPageObj ? boxIn(firstPageObj.dict, 'TrimBox') : null,
    bleedBox: firstPageObj ? boxIn(firstPageObj.dict, 'BleedBox') : null,
  };

  // PDF/X declaration: Info dictionary keys, or XMP pdfxid / pdfx tags.
  let version: string | null = null;
  let conformance: string | null = null;
  let outputIntent = false;
  let outputCondition: string | null = null;
  for (const o of objects) {
    if (version === null && o.dict.includes('/GTS_PDFXVersion')) version = pdfStringAfter(o.dict, 'GTS_PDFXVersion');
    if (conformance === null && o.dict.includes('/GTS_PDFXConformance'))
      conformance = pdfStringAfter(o.dict, 'GTS_PDFXConformance');
    if (/\/S\s*\/GTS_PDFX\b/.test(o.dict)) {
      outputIntent = true;
      outputCondition = outputCondition ?? pdfStringAfter(o.dict, 'OutputConditionIdentifier');
    }
    if (o.stream && /\/Type\s*\/Metadata/.test(o.dict)) {
      const xv = /GTS_PDFXVersion(?:>|=")([^<"]+)/.exec(o.stream);
      if (xv && version === null) version = xv[1].trim();
      const xc = /GTS_PDFXConformance(?:>|=")([^<"]+)/.exec(o.stream);
      if (xc && conformance === null) conformance = xc[1].trim();
    }
  }

  // Fonts.
  const fonts: PdfFontFact[] = [];
  for (const o of objects) {
    if (!/\/Type\s*\/Font\b/.test(o.dict)) continue;
    const subtype = /\/Subtype\s*\/(\w+)/.exec(o.dict)?.[1] ?? 'unknown';
    if (subtype === 'Type0') continue; // its descendant CIDFont is counted
    const name = (/\/BaseFont\s*\/([^\s/<>[\]()]+)/.exec(o.dict)?.[1] ?? '(unnamed)').replace(/#20/g, ' ');
    if (subtype === 'Type3') {
      fonts.push({ name, subtype, embedded: true });
      continue;
    }
    const fdNum = ref(o.dict, 'FontDescriptor');
    const fd = fdNum === null ? null : byNum.get(fdNum);
    const embedded = !!fd && /\/FontFile[23]?\s+\d+\s+\d+\s+R/.test(fd.dict);
    fonts.push({ name, subtype, embedded });
  }

  // RGB colour references.
  let colourSpaceRefs = 0;
  let rgbOperators = 0;
  for (const o of objects) {
    colourSpaceRefs += (o.dict.match(/\/(DeviceRGB|CalRGB)\b/g) ?? []).length;
    if (/\/ICCBased/.test(o.dict)) {
      const iccNum = /\/ICCBased\s+(\d+)\s+\d+\s+R/.exec(o.dict);
      const icc = iccNum ? byNum.get(Number(iccNum[1])) : undefined;
      if (icc && /\/N\s+3\b/.test(icc.dict)) colourSpaceRefs += 1;
    }
    if (o.stream && !/\/Type\s*\/(Metadata|ObjStm|XRef)\b/.test(o.dict) && !/\/Subtype\s*\/Image/.test(o.dict)) {
      rgbOperators += (o.stream.match(/(?:^|\s)-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+(rg|RG)(?=\s|$)/g) ?? []).length;
      colourSpaceRefs += (o.stream.match(/\/(DeviceRGB|CalRGB)\b/g) ?? []).length;
    }
  }

  return {
    headerVersion: header ? header[1] : null,
    pageCount: pages.length,
    firstPage,
    pdfx: { version, conformance, outputIntent, outputCondition },
    fonts,
    fontsAllEmbedded: fonts.length ? fonts.every((f) => f.embedded) : null,
    rgb: { colourSpaceRefs, rgbOperators },
    encrypted: /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || objects.some((o) => /\/Encrypt\s+\d+\s+\d+\s+R/.test(o.dict)),
    notes,
  };
}
