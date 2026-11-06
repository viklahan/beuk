// @vitest-environment node
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadClosure } from '../src/closure/index';

/* Locked review copy (design 2026-11-06), task 1: lockPdfBytes, 1.0's own PDF lock (BEUK:lockcopy in client/index.html,
   lifted into the main closure), the standard security handler at AES-256, revision 6 (ISO 32000-2 §7.6.4).
   The oracle is the pdf.js 1.0 vendors (client/assets/vendor/pdfjs-6.4.299/), loaded in Node: it opens the locked file
   with the password, refuses it without one or with a wrong one, and reads the same pages and words as the original.
   The file key is derived here a second time with node:crypto (Algorithm 2.A / 2.B, written apart from 1.0's code), so
   /Perms is checked against the standard, not against the lock's own arithmetic.
   The fixture (test/fixtures/pdfx-sample.pdf) is a real output of the server's pdfx job steps (renderer + Ghostscript,
   see the commit that added it). Ghostscript 10.00.0 writes it as PDF 1.3 with a classic xref, no object streams and
   no xref stream, so a hand-made file with object streams, xref streams and an incremental update covers those. */

type Api = { lockPdfBytes: (b: Uint8Array, pw: string) => Promise<Uint8Array>; lockSaslPrep: (pw: string) => string };
let api: Api;
type PdfJs = {
  getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc>; destroy: () => Promise<void> };
  GlobalWorkerOptions: { workerSrc: string };
  PasswordResponses: { NEED_PASSWORD: number; INCORRECT_PASSWORD: number };
};
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string; transform: number[]; width: number }[] }> }>;
  getMetadata: () => Promise<{ info: Record<string, unknown> }>;
};
let pdfjs: PdfJs;
const VENDOR = new URL('../../client/assets/vendor/pdfjs-6.4.299/', import.meta.url);
const FIXTURE = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/pdfx-sample.pdf', import.meta.url))));

beforeAll(async () => {
  // 2.0's own closure (src/closure/index.ts), so the page's crypto it supplies 1.0's code is the one under test
  api = (await loadClosure()).api as unknown as Api;
  pdfjs = (await import(/* @vite-ignore */ pathToFileURL(fileURLToPath(new URL('pdf.min.mjs', VENDOR))).href)) as PdfJs;
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(fileURLToPath(new URL('pdf.worker.min.mjs', VENDOR))).href;
});

/* ---------------- pdf.js, the oracle ---------------- */
async function open(bytes: Uint8Array, password?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0, isEvalSupported: false });
  try {
    const doc = await task.promise;
    const p1 = await (await doc.getPage(1)).getTextContent();
    const info = (await doc.getMetadata()).info;
    return { pages: doc.numPages, text: p1.items.map((i) => ({ str: i.str, transform: i.transform, width: i.width })), info };
  } finally {
    await task.destroy();
  }
}
async function refusal(bytes: Uint8Array, password?: string): Promise<{ name: string; code: number }> {
  try {
    await open(bytes, password);
  } catch (e) {
    const x = e as { name: string; code: number };
    return { name: x.name, code: x.code };
  }
  throw new Error('pdf.js opened the locked file' + (password === undefined ? ' without a password' : ' with a wrong password'));
}

/* ---------------- hand-made PDFs ---------------- */
const enc = new TextEncoder();
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const SENTENCE = 'Lantern keepers read the water by its wrong-way runs';
const cat = (...parts: (Uint8Array | string)[]) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const content = `BT /F1 12 Tf 20 100 Td (${SENTENCE}) Tj ET`;

/** One page, a classic xref; the content stream raw or Flate (with an indirect /Length), the Info title a literal. */
function handMade(flate: boolean): Uint8Array {
  const body = flate ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const objs: Buffer[] = [
    cat('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    cat('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    cat('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'),
    cat(`4 0 obj\n<< ${flate ? '/Filter /FlateDecode /Length 7 0 R' : '/Length ' + body.length} >>\nstream\n`, body, '\nendstream\nendobj\n'),
    cat('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'),
    cat('6 0 obj\n<< /Title (A hand-made lantern \\(one page\\)) /Producer <FEFF00420065007506> >>\nendobj\n'),
    cat(`7 0 obj\n${body.length}\nendobj\n`),
  ];
  const head = cat('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offs: number[] = [];
  let pos = head.length;
  for (const o of objs) {
    offs.push(pos);
    pos += o.length;
  }
  const xref = 'xref\n0 8\n0000000000 65535 f\r\n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n\r\n').join('');
  const trailer = `trailer\n<< /Size 8 /Root 1 0 R /Info 6 0 R /ID [<00112233445566778899aabbccddeeff><00112233445566778899aabbccddeeff>] >>\nstartxref\n${pos}\n%%EOF\n`;
  return new Uint8Array(cat(head, ...objs, xref, trailer));
}

/** The same page, written the way a PDF 1.5+ writer does: objects 1, 2, 3, 5 and 6 inside an object stream, an xref
 *  stream (no predictor), then an incremental update that replaces the Info dictionary (object 6) with a new plain
 *  object and a second xref stream (PNG Up predictor, /Prev to the first). */
function handMadeObjStm(): Uint8Array {
  const inner: [number, string][] = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [6, '<< /Title (First revision title) >>'],
  ];
  let pairs = '';
  let objsText = '';
  for (const [n, t] of inner) {
    pairs += `${n} ${objsText.length} `;
    objsText += t + '\n';
  }
  const stmData = deflateSync(Buffer.from(pairs + objsText, 'latin1'));
  const contentData = deflateSync(Buffer.from(content, 'latin1'));
  const head = cat('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  const o4 = cat(`4 0 obj\n<< /Filter /FlateDecode /Length ${contentData.length} >>\nstream\n`, contentData, '\nendstream\nendobj\n');
  const o7 = cat(`7 0 obj\n<< /Type /ObjStm /N ${inner.length} /First ${pairs.length} /Filter /FlateDecode /Length ${stmData.length} >>\nstream\n`, stmData, '\nendstream\nendobj\n');
  const off4 = head.length;
  const off7 = off4 + o4.length;
  const off8 = off7 + o7.length;
  // xref stream 8: W [1 4 2], entries 0..8
  const row = (t: number, a: number, b: number) => Buffer.from([t, (a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (b >>> 8) & 255, b & 255]);
  const rows1 = Buffer.concat([row(0, 0, 65535), row(2, 7, 0), row(2, 7, 1), row(2, 7, 2), row(1, off4, 0), row(2, 7, 3), row(2, 7, 4), row(1, off7, 0), row(1, off8, 0)]);
  const x1 = deflateSync(rows1);
  const o8 = cat(`8 0 obj\n<< /Type /XRef /Size 9 /W [1 4 2] /Root 1 0 R /Info 6 0 R /ID [<a1a2a3a4a5a6a7a8a9aaabacadaeafb0><a1a2a3a4a5a6a7a8a9aaabacadaeafb0>] /Filter /FlateDecode /Length ${x1.length} >>\nstream\n`, x1, '\nendstream\nendobj\n');
  const rev1 = cat(head, o4, o7, o8, `startxref\n${off8}\n%%EOF\n`);
  // the update: object 6 again (a plain object now), xref stream 9 with /Index [6 1 9 1] and the PNG Up predictor
  const off6 = rev1.length;
  const o6 = cat('6 0 obj\n<< /Title (Revised lantern title) /Subject <FEFF004C0061006D0070> >>\nendobj\n');
  const off9 = off6 + o6.length;
  const raw2 = [row(1, off6, 0), row(1, off9, 0)];
  let prev = Buffer.alloc(7);
  const up = Buffer.concat(raw2.map((r) => {
    const out = Buffer.alloc(8);
    out[0] = 2;
    for (let i = 0; i < 7; i++) out[i + 1] = (r[i]! - prev[i]! + 256) & 255;
    prev = r;
    return out;
  }));
  const x2 = deflateSync(up);
  const o9 = cat(`9 0 obj\n<< /Type /XRef /Size 10 /Index [6 1 9 1] /W [1 4 2] /Root 1 0 R /Info 6 0 R /Prev ${off8} /ID [<a1a2a3a4a5a6a7a8a9aaabacadaeafb0><b1b2b3b4b5b6b7b8b9babbbcbdbebfc0>] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${x2.length} >>\nstream\n`, x2, '\nendstream\nendobj\n');
  return new Uint8Array(cat(rev1, o6, o9, `startxref\n${off9}\n%%EOF\n`));
}

/** A hybrid file (ISO 32000-1 §7.5.8.4): a classic table that marks object 6 free, and a trailer /XRefStm whose
 *  stream puts object 6 (the Info dictionary) in an object stream. */
function handMadeHybrid(): Uint8Array {
  const contentData = deflateSync(Buffer.from(content, 'latin1'));
  const stmData = deflateSync(Buffer.from('6 0 << /Title (Hidden in an object stream) >>\n', 'latin1'));
  const objs: Buffer[] = [
    cat('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    cat('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    cat('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'),
    cat(`4 0 obj\n<< /Filter /FlateDecode /Length ${contentData.length} >>\nstream\n`, contentData, '\nendstream\nendobj\n'),
    cat('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'),
    cat(`7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${stmData.length} >>\nstream\n`, stmData, '\nendstream\nendobj\n'),
  ];
  const head = cat('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  const offs: number[] = [];
  let pos = head.length;
  for (const o of objs) {
    offs.push(pos);
    pos += o.length;
  }
  const rows = Buffer.from([2, 0, 7, 0]); // W [1 2 1]: object 6 is member 0 of object stream 7
  const xs = cat(`8 0 obj\n<< /Type /XRef /Size 9 /Index [6 1] /W [1 2 1] /Length ${rows.length} >>\nstream\n`, rows, '\nendstream\nendobj\n');
  const off8 = pos;
  pos += xs.length;
  const n = (o: number) => String(o).padStart(10, '0') + ' 00000 n\r\n';
  const xref = 'xref\n0 9\n0000000006 65535 f\r\n' + offs.slice(0, 5).map(n).join('') + '0000000000 00001 f\r\n' + n(offs[5]!) + n(off8);
  const trailer = `trailer\n<< /Size 9 /Root 1 0 R /Info 6 0 R /XRefStm ${off8} >>\nstartxref\n${pos}\n%%EOF\n`;
  return new Uint8Array(cat(head, ...objs, xs, xref, trailer));
}

/* ---------------- reading the locked file (independently of the lock's own parser) ---------------- */
function encryptDict(locked: Uint8Array): string {
  const s = latin1(locked);
  const tr = s.lastIndexOf('trailer');
  expect(tr, 'a classic trailer').toBeGreaterThan(0);
  const m = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(s.slice(tr));
  expect(m, 'the trailer names /Encrypt').toBeTruthy();
  const at = s.lastIndexOf(`\n${m![1]} ${m![2]} obj`);
  expect(at, 'the Encrypt object').toBeGreaterThan(0);
  return s.slice(s.indexOf('obj', at) + 3, s.indexOf('endobj', at)).trim();
}
/** A dictionary's top-level entries: name → the value's text, whitespace collapsed. */
function entries(dict: string): Map<string, string> {
  const t = dict.replace(/\s+/g, ' ').trim();
  expect(t.startsWith('<<') && t.endsWith('>>')).toBe(true);
  const body = t.slice(2, -2);
  const out = new Map<string, string>();
  let i = 0;
  const skipWs = () => {
    while (body[i] === ' ') i++;
  };
  while (i < body.length) {
    skipWs();
    if (i >= body.length) break;
    expect(body[i], 'a key').toBe('/');
    let j = i + 1;
    while (j < body.length && !/[ /<>[\]()]/.test(body[j]!)) j++;
    const key = body.slice(i + 1, j);
    i = j;
    skipWs();
    const start = i;
    if (body.startsWith('<<', i)) {
      let depth = 0;
      while (i < body.length) {
        if (body.startsWith('<<', i)) (depth++, (i += 2));
        else if (body.startsWith('>>', i)) {
          depth--;
          i += 2;
          if (!depth) break;
        } else i++;
      }
    } else if (body[i] === '<') i = body.indexOf('>', i) + 1;
    else if (body[i] === '/') {
      i++;
      while (i < body.length && !/[ /<>[\]()]/.test(body[i]!)) i++;
    } else if (body[i] === '[') i = body.indexOf(']', i) + 1;
    else {
      const ref = /^\d+ \d+ R(?=[ /<>[]|$)/.exec(body.slice(i));
      if (ref) i += ref[0].length;
      else while (i < body.length && body[i] !== ' ' && body[i] !== '/') i++;
    }
    out.set(key, body.slice(start, i).trim());
  }
  return out;
}
const hex = (v: string | undefined) => {
  expect(v && /^<[0-9a-fA-F\s]*>$/.test(v), 'a hex string').toBe(true);
  return Buffer.from(v!.slice(1, -1).replace(/\s+/g, ''), 'hex');
};

/* ---------------- the standard, written apart (node:crypto) ---------------- */
function hash2B(pw: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = createHash('sha256').update(Buffer.concat([pw, salt, udata])).digest();
  let e = Buffer.from([0]);
  for (let i = 0; i < 64 || e[e.length - 1]! > i - 32; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pw, k, udata])));
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    c.setAutoPadding(false);
    e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j]!;
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]!).update(e).digest();
  }
  return k.subarray(0, 32);
}
const saslBytes = (pw: string) => Buffer.from(api.lockSaslPrep(pw), 'utf8').subarray(0, 127);
function fileKey(dict: Map<string, string>, password: string): Buffer {
  const u = hex(dict.get('U'));
  const ue = hex(dict.get('UE'));
  const pw = saslBytes(password);
  expect(hash2B(pw, u.subarray(32, 40), Buffer.alloc(0)).equals(u.subarray(0, 32)), 'Algorithm 11: the user password validates').toBe(true);
  const d = createDecipheriv('aes-256-cbc', hash2B(pw, u.subarray(40, 48), Buffer.alloc(0)), Buffer.alloc(16));
  d.setAutoPadding(false);
  return Buffer.concat([d.update(ue), d.final()]);
}

/** Every stream's raw data, and its inflated data where it inflates. */
function streamsOf(bytes: Uint8Array): { raw: Buffer; inflated: Buffer | null }[] {
  const b = Buffer.from(bytes);
  const s = b.toString('latin1');
  const out: { raw: Buffer; inflated: Buffer | null }[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (s.slice(Math.max(0, m.index - 3), m.index) === 'end') continue;
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const raw = b.subarray(start, end);
    let inflated: Buffer | null = null;
    try {
      inflated = inflateSync(raw);
    } catch {
      inflated = null;
    }
    out.push({ raw, inflated });
    re.lastIndex = end;
  }
  return out;
}
const has = (hay: Uint8Array | Buffer, needle: Buffer) => Buffer.from(hay).indexOf(needle) >= 0;
const inAnyStream = (bytes: Uint8Array, needle: Buffer) => streamsOf(bytes).some((x) => has(x.raw, needle) || (x.inflated !== null && has(x.inflated, needle)));
const utf16be = (s: string) => {
  const b = Buffer.from(s, 'utf16le');
  for (let i = 0; i < b.length; i += 2) [b[i], b[i + 1]] = [b[i + 1]!, b[i]!];
  return b;
};

/* The fixture's page 1, as pdf.js reads it, and its first content stream's inflated bytes: computed once */
let fixtureOpen: Awaited<ReturnType<typeof open>>;
let fixtureLocked: Uint8Array;
const FIXTURE_PW = 'harbour-light 7';
beforeAll(async () => {
  fixtureOpen = await open(FIXTURE);
  fixtureLocked = await api.lockPdfBytes(FIXTURE, FIXTURE_PW);
}, 120_000);

describe('lockPdfBytes: AES-256 R6, opened by pdf.js (design 2026-11-06, task 1)', () => {
  it('opens with the right password: the fixture and a hand-made one-page PDF', async () => {
    expect(fixtureOpen.pages).toBe(102);
    expect(fixtureOpen.text.map((x) => x.str).join('')).toContain('The Lantern Coast');
    const got = await open(fixtureLocked, FIXTURE_PW);
    expect(got.pages).toBe(fixtureOpen.pages);
    expect(got.text).toEqual(fixtureOpen.text);
    expect(got.info.Title).toBe(fixtureOpen.info.Title);
    for (const flate of [false, true]) {
      const orig = handMade(flate);
      const plain = await open(orig);
      expect(plain.text.map((x) => x.str).join('')).toBe(SENTENCE);
      const locked = await api.lockPdfBytes(orig, 'lantern');
      const back = await open(locked, 'lantern');
      expect(back.pages).toBe(1);
      expect(back.text).toEqual(plain.text);
      expect(back.info.Title).toBe('A hand-made lantern (one page)');
    }
  }, 120_000);

  it('object streams, xref streams and an incremental update: every object comes out plain, the newest revision wins', async () => {
    const orig = handMadeObjStm();
    const plain = await open(orig);
    expect(plain.text.map((x) => x.str).join('')).toBe(SENTENCE);
    expect(plain.info.Title).toBe('Revised lantern title');
    const locked = await api.lockPdfBytes(orig, 'lantern');
    const s = latin1(locked);
    expect(s).not.toMatch(/\/ObjStm|\/XRef/);
    expect(s).toMatch(/\nxref\n0 \d+\n0000000000 65535 f\r?\n/);
    const back = await open(locked, 'lantern');
    expect(back.text).toEqual(plain.text);
    expect(back.info.Title).toBe('Revised lantern title');
    expect(back.info.Subject).toBe('Lamp');
    expect(s).not.toContain('First revision title');
  }, 60_000);

  it('a hybrid file: the /XRefStm entries stand for what the table leaves free', async () => {
    const orig = handMadeHybrid();
    // (pdf.js itself reads this original with object 6 free, the table's word; pypdf 6.11 reads it as the standard
    // says, with the title. Once locked, object 6 is a plain object every reader sees.)
    const plain = await open(orig);
    const back = await open(await api.lockPdfBytes(orig, 'lantern'), 'lantern');
    expect(back.text).toEqual(plain.text);
    expect(back.info.Title).toBe('Hidden in an object stream');
  }, 60_000);

  it('refuses without a password (NEED_PASSWORD), then with "wrong" (INCORRECT_PASSWORD)', async () => {
    const none = await refusal(fixtureLocked);
    expect(none).toEqual({ name: 'PasswordException', code: pdfjs.PasswordResponses.NEED_PASSWORD });
    const wrong = await refusal(fixtureLocked, 'wrong');
    expect(wrong).toEqual({ name: 'PasswordException', code: pdfjs.PasswordResponses.INCORRECT_PASSWORD });
    const small = await api.lockPdfBytes(handMade(true), 'lantern');
    expect(await refusal(small)).toEqual({ name: 'PasswordException', code: pdfjs.PasswordResponses.NEED_PASSWORD });
    expect(await refusal(small, 'wrong')).toEqual({ name: 'PasswordException', code: pdfjs.PasswordResponses.INCORRECT_PASSWORD });
  }, 60_000);

  it('the trailer and the Encrypt dictionary: global constraint 2, exactly; /Perms decrypts to "T" + "adb"', () => {
    const s = latin1(fixtureLocked);
    expect(s.startsWith('%PDF-1.7\n')).toBe(true);
    const trailer = entries(s.slice(s.lastIndexOf('trailer') + 7, s.lastIndexOf('startxref')).trim());
    expect(trailer.get('ID')).toMatch(/^\[\s*<[0-9a-fA-F]{32}>\s*<[0-9a-fA-F]{32}>\s*\]$/);
    expect(trailer.get('Encrypt')).toMatch(/^\d+ 0 R$/);
    const d = entries(encryptDict(fixtureLocked));
    expect([...d.keys()].sort()).toEqual(['CF', 'EncryptMetadata', 'Filter', 'Length', 'O', 'OE', 'P', 'Perms', 'R', 'StmF', 'StrF', 'U', 'UE', 'V'].sort());
    expect(d.get('Filter')).toBe('/Standard');
    expect(d.get('V')).toBe('5');
    expect(d.get('R')).toBe('6');
    expect(d.get('Length')).toBe('256');
    expect(d.get('StmF')).toBe('/StdCF');
    expect(d.get('StrF')).toBe('/StdCF');
    expect(d.get('EncryptMetadata')).toBe('true');
    expect(d.get('P')).toBe('-4');
    const cf = entries(d.get('CF')!);
    expect([...cf.keys()]).toEqual(['StdCF']);
    const std = entries(cf.get('StdCF')!);
    expect(Object.fromEntries(std)).toEqual({ CFM: '/AESV3', AuthEvent: '/DocOpen' });
    expect(hex(d.get('U')).length).toBe(48);
    expect(hex(d.get('O')).length).toBe(48);
    expect(hex(d.get('UE')).length).toBe(32);
    expect(hex(d.get('OE')).length).toBe(32);
    const perms = hex(d.get('Perms'));
    expect(perms.length).toBe(16);
    const key = fileKey(d, FIXTURE_PW);
    const ecb = createDecipheriv('aes-256-ecb', key, null);
    ecb.setAutoPadding(false);
    const p = Buffer.concat([ecb.update(perms), ecb.final()]);
    expect(p.subarray(9, 12).toString('latin1')).toBe('adb');
    expect(String.fromCharCode(p[8]!)).toBe('T');
    expect(p.readInt32LE(0)).toBe(-4);
    expect([...p.subarray(4, 8)]).toEqual([255, 255, 255, 255]);
    // the PDF 1.7 reader is told it needs Adobe extension level 8 (AESV3, R6), as qpdf writes it
    expect(s).toMatch(/\/Extensions\s*<<\s*\/ADBE\s*<<\s*\/BaseVersion\s*\/1\.7\s*\/ExtensionLevel\s*8\s*>>\s*>>/);
  });

  it('no plaintext left: the fixture title and its first page, literal and inflated; the hand-made sentence, raw and Flate', async () => {
    // the fixture: what of page 1 is actually readable in the unlocked file (Ghostscript subsets the fonts, so the
    // words in the content streams are glyph codes): the Info title (UTF-16BE), the OutputIntent's name (a literal),
    // and the first page's content stream, inflated
    const s = latin1(FIXTURE);
    const pageRef = /\/Type\s*\/Page\b[\s\S]*?\/Contents\s+(\d+)\s+0\s+R/.exec(s);
    expect(pageRef).toBeTruthy();
    const at = s.indexOf(`\n${pageRef![1]} 0 obj`);
    const st = s.indexOf('stream', at);
    const len = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(s.slice(at, st))?.[1] ?? NaN);
    const page1 = Number.isFinite(len) ? inflateSync(Buffer.from(FIXTURE).subarray(st + 7, st + 7 + len)) : inflateSync(streamsOf(FIXTURE.subarray(at))[0]!.raw);
    const needles: [string, Buffer][] = [
      ['the Info title, UTF-16BE', utf16be('The Lantern Coast')],
      ['the OutputIntent name, a literal', Buffer.from('SWOP2006_Coated3v2.icc', 'latin1')],
      ['the first content stream, inflated (its first 96 bytes)', page1.subarray(0, 96)],
      ['the ICC profile, inflated', Buffer.from('Copyright', 'latin1')],
    ];
    for (const [what, n] of needles) {
      expect(has(FIXTURE, n) || inAnyStream(FIXTURE, n), what + ' is there before the lock').toBe(true);
      expect(has(fixtureLocked, n), what + ': not in the locked bytes').toBe(false);
      expect(inAnyStream(fixtureLocked, n), what + ': not in any locked stream, inflated').toBe(false);
    }
    expect(streamsOf(fixtureLocked).filter((x) => x.inflated !== null)).toEqual([]);
    // the hand-made page: the sentence is in the raw file (or in its inflated stream) before, nowhere after
    for (const flate of [false, true]) {
      const orig = handMade(flate);
      const n = Buffer.from(SENTENCE, 'latin1');
      expect(flate ? inAnyStream(orig, n) && !has(orig, n) : has(orig, n)).toBe(true);
      const locked = await api.lockPdfBytes(orig, 'lantern');
      expect(has(locked, n) || inAnyStream(locked, n)).toBe(false);
      expect(latin1(locked)).not.toContain('hand-made lantern');
    }
  }, 60_000);

  it('fresh randomness: two locks of the same file with the same password differ in /U, /UE, /O and the first stream', async () => {
    const a = await api.lockPdfBytes(handMade(true), 'lantern');
    const b = await api.lockPdfBytes(handMade(true), 'lantern');
    const da = entries(encryptDict(a));
    const db = entries(encryptDict(b));
    for (const k of ['U', 'UE', 'O', 'OE']) expect(hex(da.get(k)).equals(hex(db.get(k))), k).toBe(false);
    const sa = streamsOf(a)[0]!.raw;
    const sb = streamsOf(b)[0]!.raw;
    expect(sa.length).toBe(sb.length);
    expect(sa.equals(sb)).toBe(false);
    expect((await open(a, 'lantern')).text).toEqual((await open(b, 'lantern')).text);
  }, 60_000);

  it('Unicode passwords open with the same typed string; "ｐass" and "pass" open each other (SASLprep NFKC)', async () => {
    const orig = handMade(true);
    const want = (await open(orig)).text;
    for (const pw of ['pässwörd', '密码本', '🔒book', 'كلمة', 'ü'.repeat(100), 'lantern-'.repeat(25)]) {
      if (pw.length > 50) expect(enc.encode(pw).length).toBe(200);
      const locked = await api.lockPdfBytes(orig, pw);
      expect((await open(locked, pw)).text, pw.slice(0, 12)).toEqual(want);
      if (pw.length <= 50) expect(await refusal(locked, pw + 'x'), pw + ' + x').toEqual({ name: 'PasswordException', code: pdfjs.PasswordResponses.INCORRECT_PASSWORD });
    }
    // a 200-byte password is cut at 127 bytes (ISO 32000-2 §7.6.4.3.2): its first 127 bytes are the password
    const long = 'lantern-'.repeat(25);
    const lockedLong = await api.lockPdfBytes(orig, long);
    expect((await open(lockedLong, long.slice(0, 127))).text).toEqual(want);
    const wide = await api.lockPdfBytes(orig, 'ｐass');
    expect((await open(wide, 'pass')).text).toEqual(want);
    const narrow = await api.lockPdfBytes(orig, 'pass');
    expect((await open(narrow, 'ｐass')).text).toEqual(want);
  }, 120_000);

  it('lockSaslPrep: non-ASCII spaces (ZWSP among them) become U+0020, soft hyphen vanishes, NFKC; prohibited output passes through', () => {
    const sp = api.lockSaslPrep;
    for (const c of ['\u00a0', '\u1680', '\u2000', '\u2005', '\u200a', '\u202f', '\u205f', '\u3000']) expect(sp('a' + c + 'b'), c.codePointAt(0)!.toString(16)).toBe('a b');
    for (const c of ['\u00ad', '\u034f', '\u1806', '\u180b', '\u200c', '\u200d', '\u2060', '\ufe00', '\ufe0f', '\ufeff']) expect(sp('a' + c + 'b'), c.codePointAt(0)!.toString(16)).toBe('ab');
    // U+200B is in C.1.2 and in B.1: a space (RFC 4013 §2.1 lists it with the spaces; pdf.js checks its spaces first)
    expect(sp('a\u200bb')).toBe('a b');
    expect(sp('ｐass')).toBe('pass');
    expect(sp('ﬁx')).toBe('fix');
    expect(sp('Ⅸ')).toBe('IX');
    expect(sp('e\u0301')).toBe('é');
    expect(sp('pässwörd')).toBe('pässwörd');
    expect(sp('密码本')).toBe('密码本');
    // RFC 4013 §2.3 would refuse these (C.2.1 controls, C.3 private use, C.9 tagging); V: "let them through"
    expect(sp('a\u0000b')).toBe('a\u0000b');
    expect(sp('a\u007fb')).toBe('a\u007fb');
    expect(sp('a\ue000b')).toBe('a\ue000b');
    expect(sp('a\u{e0001}b')).toBe('a\u{e0001}b');
    expect(sp('I\u00a0\u00adlove')).toBe('I love');
  });

  it('U+200B is a SASLprep space (RFC 4013 C.1.2), as pdf.js reads it: "a\u200bb" opens with itself and with "a b"', async () => {
    const orig = handMade(false);
    const locked = await api.lockPdfBytes(orig, 'a\u200bb');
    expect((await open(locked, 'a\u200bb')).pages).toBe(1);
    expect((await open(locked, 'a b')).pages).toBe(1);
  }, 60_000);

  it('a password with prohibited output still locks, and opens with the same string', async () => {
    const orig = handMade(false);
    const locked = await api.lockPdfBytes(orig, 'a\u0000b');
    expect((await open(locked, 'a\u0000b')).pages).toBe(1);
  }, 60_000);

  it('the password is not in the output: its UTF-8 bytes appear nowhere', async () => {
    for (const pw of ['correct horse lantern 7', 'pässwörd-Ünïcode', '密码本密码本']) {
      const locked = await api.lockPdfBytes(handMade(false), pw);
      expect(has(locked, Buffer.from(pw, 'utf8')), pw).toBe(false);
      expect(has(locked, Buffer.from(api.lockSaslPrep(pw), 'utf8')), pw).toBe(false);
    }
    expect(has(fixtureLocked, Buffer.from(FIXTURE_PW, 'utf8'))).toBe(false);
  }, 60_000);

  it('refuses what it cannot lock, and never says the password: an empty password, an already locked file, not a PDF', async () => {
    const secret = 'zebra-crossing-91';
    const msgs: string[] = [];
    for (const [bytes, pw] of [
      [handMade(false), ''],
      [fixtureLocked, secret],
      [new TextEncoder().encode('not a pdf at all'), secret],
    ] as [Uint8Array, string][]) {
      let err: unknown = null;
      try {
        await api.lockPdfBytes(bytes, pw);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      msgs.push(String((err as Error).message) + String((err as Error).stack));
    }
    for (const m of msgs) expect(m).not.toContain(secret);
  }, 60_000);
});

/* Final review F1: a password SASLprep maps to nothing (RFC 4013 B.1: soft hyphen, joiners, variation selectors, BOM...) is
   an EMPTY user password, and every reader opens that file without asking. lockPdfBytes refuses it. */
describe('lockPdfBytes: a password that is empty after SASLprep (final review F1)', () => {
  it.each([['\u00AD'], ['\u200D\uFEFF'], ['\uFE0F\u180B\u2060\u034F']])('refuses %j and never returns a file', async (pw) => {
    expect(api.lockSaslPrep(pw)).toBe('');
    let out: unknown = null;
    let err: unknown = null;
    try {
      out = await api.lockPdfBytes(FIXTURE, pw);
    } catch (e) {
      err = e;
    }
    expect(out).toBeNull();
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toBe('A password is needed to lock the PDF.');
  }, 60_000);
  it('a mapped-away character beside a real one still locks, and the file needs the password', async () => {
    const out = await api.lockPdfBytes(FIXTURE, '\u00ADx');
    expect(await refusal(out)).toEqual({ name: 'PasswordException', code: pdfjs.PasswordResponses.NEED_PASSWORD });
    expect((await open(out, 'x')).pages).toBeGreaterThan(0);
  }, 60_000);
});

/* Review focus 3 (task 2, step 6): a big book locks without freezing the tab. Budget: PDF ≤ 2 s per 10 MB, measured
   here and logged. The input is the fixture with an incremental update that adds one more stream, the fixture's own
   bytes again (raw, no filter): about 11.9 MB, every byte of it encrypted. */
describe('lockPdfBytes: the budget (review focus 3)', () => {
  it('a synthetic 10 MB+ PDF (the fixture, repeated) locks within 2 s per 10 MB', async () => {
    const tail = latin1(FIXTURE.subarray(FIXTURE.length - 400));
    const size = Number(/\/Size (\d+)/.exec(tail)![1]);
    const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail)![1]);
    const root = /\/Root (\d+ \d+ R)/.exec(tail)![1];
    const info = /\/Info (\d+ \d+ R)/.exec(tail)![1];
    const id = /\/ID \[[^\]]*\]/.exec(tail)![0];
    const obj = cat(`\n${size} 0 obj\n<< /Length ${FIXTURE.length} >>\nstream\n`, FIXTURE, '\nendstream\nendobj\n');
    const objAt = FIXTURE.length + 1;
    const xrefAt = FIXTURE.length + obj.length;
    const update = cat(obj, `xref\n${size} 1\n${String(objAt).padStart(10, '0')} 00000 n\r\ntrailer\n<< /Size ${size + 1} /Root ${root} /Info ${info} ${id} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    const big = new Uint8Array(cat(FIXTURE, update));
    expect(big.length).toBeGreaterThan(10_000_000);
    const t0 = performance.now();
    const locked = await api.lockPdfBytes(big, FIXTURE_PW);
    const ms = performance.now() - t0;
    const budget = 2000 * (big.length / 10_000_000);
    console.log(`[budget] lockPdfBytes: ${(big.length / 1e6).toFixed(1)} MB in ${ms.toFixed(0)} ms (budget ${budget.toFixed(0)} ms, ${(ms / (big.length / 1e7)).toFixed(0)} ms per 10 MB)`);
    expect(locked.length).toBeGreaterThan(big.length);
    expect(ms).toBeLessThanOrEqual(budget);
    expect((await open(locked, FIXTURE_PW)).pages).toBe(fixtureOpen.pages);
  }, 180_000);
});
