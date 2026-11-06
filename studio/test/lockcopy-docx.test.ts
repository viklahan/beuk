// @vitest-environment node
import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { exportReset, exportRun } from '../src/export/state';
import { fixtures } from './fixtures';
import { hostileExportBook } from './export-fixture';

/* Locked review copy (design 2026-11-06), task 2: lockDocxBytes, 1.0's own DOCX lock (BEUK:lockcopy in client/index.html,
   lifted into the main closure): ECMA-376 Agile encryption (MS-OFFCRYPTO §2.3.4.10–2.3.4.15) in a compound file
   (MS-CFB, version 3, 512-byte sectors).
   The oracle is msoffcrypto-tool, in a venv inside the worktree (studio/e2e/oracles/.venv, gitignored), run by
   e2e/oracles/docx-decrypt.py: it checks the password against the verifier and the package against its HMAC, and
   writes the plain file back. Without the venv, or without the tool in it, every oracle test is SKIPPED, never passed
   (BEUK_DOCX_ORACLE=required turns that skip into a failure).
   The compound file is read here by a reader written apart from 1.0's writer, and the key and the HMAC are derived a
   second time with node:crypto, so the structure and the integrity are checked against the standards, not against the
   lock's own arithmetic. The inputs are 1.0's own Word files: buildDocxBlob() on five fixture books and the hostile book,
   and msBlob(msPlan()) on one book. */

type Rec = Record<string, unknown>;
type Api = {
  lockDocxBytes: (b: Uint8Array, pw: string) => Promise<Uint8Array>;
  buildDocxBlob: () => Promise<Blob>;
  msBlob: (plan: unknown) => Promise<Blob>;
  msPlan: () => unknown;
};
let api: Api;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);

/* 1.0's vendored JSZip, the one the page loads (its UMD: module.exports under require, the global in a page) */
const jszip = createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js') as unknown;
(globalThis as { JSZip?: unknown }).JSZip ??= jszip;
type Zip = { files: Record<string, { dir: boolean; async: (t: 'string' | 'uint8array') => Promise<string | Uint8Array> }> };
const JSZip = (globalThis as unknown as { JSZip: { loadAsync: (b: Uint8Array) => Promise<Zip> } }).JSZip;

/* ---------------- the oracle ---------------- */
const ORACLES = fileURLToPath(new URL('../e2e/oracles/', import.meta.url));
const SCRIPT = path.join(ORACLES, 'docx-decrypt.py');
const VENV_PY = [path.join(ORACLES, '.venv', 'Scripts', 'python.exe'), path.join(ORACLES, '.venv', 'bin', 'python')].find((p) => existsSync(p));
const probe = VENV_PY ? spawnSync(VENV_PY, [SCRIPT, '--probe'], { encoding: 'utf8' }) : null;
const ORACLE = probe !== null && probe.status === 0;
const ORACLE_WHY = !VENV_PY ? 'SKIPPED: no venv at e2e/oracles/.venv' : !ORACLE ? String(probe!.stdout || probe!.stderr).trim() : String(probe!.stdout).trim();
console.log('[lockcopy-docx] oracle: ' + ORACLE_WHY);
if (!ORACLE && process.env.BEUK_DOCX_ORACLE === 'required') throw new Error('the DOCX oracle is required and missing: ' + ORACLE_WHY);
const withOracle = it.skipIf(!ORACLE);

let work: string;
let seq = 0;
/** msoffcrypto opens `locked` with `password`: the exit code, and the plain bytes on 0. */
function oracle(locked: Uint8Array, password: string): { code: number; plain: Uint8Array | null; err: string } {
  const n = ++seq;
  const src = path.join(work, n + '.docx');
  const dst = path.join(work, n + '.plain.docx');
  writeFileSync(src, locked);
  const r = spawnSync(VENV_PY!, [SCRIPT, src, dst, password], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  const code = r.status ?? -1;
  const plain = code === 0 ? new Uint8Array(readFileSync(dst)) : null;
  rmSync(src, { force: true });
  rmSync(dst, { force: true });
  return { code, plain, err: String(r.stderr || '') };
}

/* ---------------- a compound file reader (MS-CFB), apart from 1.0's writer ---------------- */
type Entry = { id: number; name: string; type: number; color: number; left: number; right: number; child: number; start: number; size: number };
const NOSTREAM = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
function readCfb(bytes: Uint8Array) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(b.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
  const header = {
    minor: b.readUInt16LE(24), major: b.readUInt16LE(26), byteOrder: b.readUInt16LE(28), sectorShift: b.readUInt16LE(30), miniShift: b.readUInt16LE(32),
    dirSectors: b.readUInt32LE(40), fatSectors: b.readUInt32LE(44), dir0: b.readUInt32LE(48), cutoff: b.readUInt32LE(56),
    miniFat0: b.readUInt32LE(60), miniFatSectors: b.readUInt32LE(64), difat0: b.readUInt32LE(68), difatSectors: b.readUInt32LE(72),
  };
  const ss = 1 << header.sectorShift;
  const sector = (i: number) => {
    expect(512 + (i + 1) * ss, 'sector ' + i + ' inside the file').toBeLessThanOrEqual(b.length);
    return b.subarray(512 + i * ss, 512 + (i + 1) * ss);
  };
  const fatAt: number[] = [];
  for (let i = 0; i < Math.min(header.fatSectors, 109); i++) fatAt.push(b.readUInt32LE(76 + i * 4));
  for (let d = header.difat0, k = 0; k < header.difatSectors; k++) {
    const s = sector(d);
    for (let i = 0; i < ss / 4 - 1 && fatAt.length < header.fatSectors; i++) fatAt.push(s.readUInt32LE(i * 4));
    d = s.readUInt32LE(ss - 4);
  }
  expect(fatAt.length).toBe(header.fatSectors);
  const fat: number[] = [];
  for (const f of fatAt) for (let i = 0, s = sector(f); i < ss; i += 4) fat.push(s.readUInt32LE(i));
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== ENDOFCHAIN; s = table[s]!) {
      expect(s < table.length && !seen.has(s), 'a chain that ends').toBe(true);
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number) => Buffer.concat(chain(start, fat).map(sector));
  const dir = readChain(header.dir0);
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 64);
    entries.push({
      id: o / 128, name: nl ? dir.subarray(o, o + nl - 2).toString('utf16le') : '', type: dir[o + 66]!, color: dir[o + 67]!,
      left: dir.readUInt32LE(o + 68), right: dir.readUInt32LE(o + 72), child: dir.readUInt32LE(o + 76), start: dir.readUInt32LE(o + 116),
      size: Number(dir.readBigUInt64LE(o + 120)),
    });
  }
  const root = entries[0]!;
  expect(root.type).toBe(5);
  const miniFat: number[] = [];
  if (header.miniFatSectors) {
    const mf = readChain(header.miniFat0);
    for (let i = 0; i < mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  }
  const ministream = root.size ? readChain(root.start).subarray(0, root.size) : Buffer.alloc(0);
  const stream = (e: Entry) => {
    if (e.size === 0) return Buffer.alloc(0);
    if (e.size < header.cutoff) return Buffer.concat(chain(e.start, miniFat).map((m) => ministream.subarray(m * 64, m * 64 + 64))).subarray(0, e.size);
    return readChain(e.start).subarray(0, e.size);
  };
  /* the directory tree: each storage's children a red-black binary search tree under MS-CFB's order (length, then
     upper-case code units) */
  const cmp = (a: string, b2: string) => (a.length !== b2.length ? a.length - b2.length : a.toUpperCase() < b2.toUpperCase() ? -1 : a.toUpperCase() > b2.toUpperCase() ? 1 : 0);
  const paths = new Map<string, Entry>();
  const reached = new Set<number>([0]);
  const walk = (id: number, prefix: string, lo: string | null, hi: string | null): number => {
    if (id === NOSTREAM) return 1;
    const e = entries[id]!;
    expect(reached.has(id), 'entry ' + id + ' reached once').toBe(false);
    reached.add(id);
    if (lo !== null) expect(cmp(lo, e.name), e.name + ' after ' + lo).toBeLessThan(0);
    if (hi !== null) expect(cmp(e.name, hi), e.name + ' before ' + hi).toBeLessThan(0);
    const l = walk(e.left, prefix, lo, e.name);
    const r = walk(e.right, prefix, e.name, hi);
    expect(l, 'black height under ' + e.name).toBe(r);
    if (e.color === 0) for (const k of [e.left, e.right]) if (k !== NOSTREAM) expect(entries[k]!.color, 'red ' + e.name + ' has black children').toBe(1);
    paths.set(prefix + e.name, e);
    if (e.type === 1) {
      const top = e.child === NOSTREAM ? null : entries[e.child]!;
      if (top) expect(top.color, 'the top of ' + e.name + "'s tree is black").toBe(1);
      walk(e.child, prefix + e.name + '/', null, null);
    }
    return l + (e.color === 1 ? 1 : 0);
  };
  if (root.child !== NOSTREAM) expect(entries[root.child]!.color, 'the top of the root tree is black').toBe(1);
  walk(root.child, '', null, null);
  for (const e of entries) if (!reached.has(e.id)) expect(e.type, 'an unreached entry is unused').toBe(0);
  return { header, entries, paths, stream: (p: string) => stream(paths.get(p)!) };
}

/* ---------------- EncryptionInfo, parsed as XML ---------------- */
// jsdom's XML parser (the studio's test environment; it ships no types of its own)
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: { DOMParser: typeof globalThis.DOMParser } } };
const XmlParser = new JSDOM('').window.DOMParser;
function encryptionInfo(locked: Uint8Array) {
  const raw = readCfb(locked).stream('EncryptionInfo');
  const xmlText = raw.subarray(8).toString('utf8');
  const doc = new XmlParser().parseFromString(xmlText, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length, 'EncryptionInfo is well-formed XML').toBe(0);
  const NS = 'http://schemas.microsoft.com/office/2006/encryption';
  const PNS = 'http://schemas.microsoft.com/office/2006/keyEncryptor/password';
  const one = (ns: string, n: string) => {
    const l = doc.getElementsByTagNameNS(ns, n);
    expect(l.length, n).toBe(1);
    return l[0]!;
  };
  const attrs = (el: Element) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value]));
  const b64 = (s: string | undefined) => Buffer.from(String(s), 'base64');
  const root = doc.documentElement;
  return {
    version: [raw.readUInt16LE(0), raw.readUInt16LE(2)], reserved: raw.readUInt32LE(4), root: { ns: root.namespaceURI, name: root.localName },
    keyData: attrs(one(NS, 'keyData')), dataIntegrity: attrs(one(NS, 'dataIntegrity')), keyEncryptor: attrs(one(NS, 'keyEncryptor')),
    encryptedKey: attrs(one(PNS, 'encryptedKey')), b64,
  };
}

/* ---------------- the key, derived again (MS-OFFCRYPTO §2.3.4.11, §2.3.4.13, §2.3.4.14) with node:crypto ---------------- */
const BLK = {
  verifierInput: Buffer.from('fea7d2763b4b9e79', 'hex'), verifierValue: Buffer.from('d7aa0f6d3061344e', 'hex'), keyValue: Buffer.from('146e0be7abacd0d6', 'hex'),
  hmacKey: Buffer.from('5fb2ad010cb9e1f6', 'hex'), hmacValue: Buffer.from('a0677f02b22c8433', 'hex'),
};
const sha512 = (...p: Buffer[]) => createHash('sha512').update(Buffer.concat(p)).digest();
const aesDec = (key: Buffer, iv: Buffer, data: Buffer) => {
  const d = createDecipheriv('aes-256-cbc', key, iv.subarray(0, 16));
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
};
function secretKey(locked: Uint8Array, password: string): Buffer {
  const info = encryptionInfo(locked);
  const salt = info.b64(info.encryptedKey.saltValue);
  let h = sha512(salt, Buffer.from(password, 'utf16le'));
  const it4 = Buffer.alloc(4);
  for (let i = 0; i < Number(info.encryptedKey.spinCount); i++) {
    it4.writeUInt32LE(i, 0);
    h = sha512(it4, h);
  }
  const key = (blk: Buffer) => sha512(h, blk).subarray(0, 32);
  // the verifier: SHA-512 of the decrypted input equals the decrypted hash value
  const vin = aesDec(key(BLK.verifierInput), salt, info.b64(info.encryptedKey.encryptedVerifierHashInput));
  const vhash = aesDec(key(BLK.verifierValue), salt, info.b64(info.encryptedKey.encryptedVerifierHashValue));
  expect(sha512(vin.subarray(0, 16)).equals(vhash.subarray(0, 64)), 'the verifier').toBe(true);
  return aesDec(key(BLK.keyValue), salt, info.b64(info.encryptedKey.encryptedKeyValue)).subarray(0, 32);
}

/* ---------------- 1.0's Word files ---------------- */
function onDesk(doc: Rec): Y.Doc {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  exportReset();
  return y;
}
const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
async function docxOf(doc: Rec): Promise<Uint8Array> {
  const y = onDesk(structuredClone(doc));
  try {
    return await blobBytes(await exportRun((cc) => (cc.api as unknown as Api).buildDocxBlob())!);
  } finally {
    y.destroy();
  }
}
async function manuscriptOf(doc: Rec): Promise<Uint8Array> {
  const y = onDesk(structuredClone(doc));
  try {
    return await blobBytes(await exportRun((cc) => {
      const a = cc.api as unknown as Api;
      return a.msBlob(a.msPlan());
    })!);
  } finally {
    y.destroy();
  }
}
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** The text of word/document.xml's first heading paragraph. */
async function firstHeading(docx: Uint8Array): Promise<string> {
  const z = await JSZip.loadAsync(docx);
  const xml = (await z.files['word/document.xml']!.async('string')) as string;
  const paras = xml.match(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g) || [];
  const h = paras.find((p) => /<w:pStyle w:val="(Heading\d|Title)"\/>/.test(p) && /<w:t[ >]/.test(p))!;
  return decodeXml((h.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join(''));
}
const has = (hay: Uint8Array, needle: Uint8Array) => Buffer.from(hay).indexOf(Buffer.from(needle)) >= 0;

type Input = { name: string; bytes: Uint8Array };
let inputs: Input[];
const withSections = () => fixtures('all').filter((f) => Array.isArray(f.book.sections));
beforeAll(async () => {
  api = (await loadClosure()).api as unknown as Api;
  setClosureT(t);
  setClosureLang('en');
  work = mkdtempSync(path.join(tmpdir(), 'beuk-lockdocx-'));
  inputs = [];
  for (const f of withSections().slice(0, 5)) inputs.push({ name: f.name, bytes: await docxOf(f.book) });
  inputs.push({ name: 'hostile', bytes: await docxOf(hostileExportBook()) });
  const ms = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!;
  inputs.push({ name: 'manuscript ' + ms.name, bytes: await manuscriptOf(ms.book) });
}, 240_000);
afterEach(() => {
  desk.ydoc = null;
  exportReset();
});
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const PW = 'lantern-keeper 42';
describe('lockDocxBytes: ECMA-376 Agile encryption, opened by msoffcrypto-tool (design 2026-11-06, task 2)', () => {
  it("the inputs are 1.0's Word files: five fixture books, the hostile book and a manuscript, each a zip", () => {
    expect(withSections().length).toBe(23);
    expect(inputs.length).toBe(7);
    for (const i of inputs) expect(Buffer.from(i.bytes.subarray(0, 4)).toString('hex'), i.name).toBe('504b0304');
  });

  withOracle('opens in msoffcrypto with the right password: the decrypted bytes equal the input exactly', async () => {
    for (const i of inputs) {
      const locked = await api.lockDocxBytes(i.bytes, PW);
      const r = oracle(locked, PW);
      expect(r.code, i.name + ' ' + r.err).toBe(0);
      expect(Buffer.from(r.plain!).equals(Buffer.from(i.bytes)), i.name).toBe(true);
    }
  }, 240_000);

  withOracle('wrong password refused: "wrong" makes the oracle exit 1', async () => {
    const locked = await api.lockDocxBytes(inputs[0]!.bytes, PW);
    expect(oracle(locked, 'wrong').code).toBe(1);
    expect(oracle(locked, PW + ' ').code).toBe(1);
  }, 120_000);

  it('container shape: a version 3 compound file with EncryptionInfo, EncryptedPackage and the \\x06DataSpaces storage', async () => {
    for (const i of [inputs[0]!, inputs[inputs.length - 1]!]) {
      const locked = await api.lockDocxBytes(i.bytes, PW);
      const cfb = readCfb(locked);
      expect(cfb.header, i.name).toMatchObject({ minor: 0x3e, major: 3, byteOrder: 0xfffe, sectorShift: 9, miniShift: 6, dirSectors: 0, cutoff: 4096 });
      expect((locked.length - 512) % 512, 'whole sectors').toBe(0);
      expect([...cfb.paths.keys()].sort()).toEqual([
        '\u0006DataSpaces', '\u0006DataSpaces/DataSpaceInfo', '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace', '\u0006DataSpaces/DataSpaceMap',
        '\u0006DataSpaces/TransformInfo', '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform', '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary',
        '\u0006DataSpaces/Version', 'EncryptedPackage', 'EncryptionInfo',
      ].sort());
      // the package: its 8-byte size, then 4096-byte segments, each padded to the 16-byte block
      const pkg = cfb.stream('EncryptedPackage');
      expect(Number(pkg.readBigUInt64LE(0))).toBe(i.bytes.length);
      expect(pkg.length).toBe(8 + Math.ceil(i.bytes.length / 16) * 16);
      // MS-OFFCRYPTO §2.1.5–2.1.8, §2.3.4.? the data spaces: the package is mapped to the strong encryption transform
      const ds = (p: string) => cfb.stream('\u0006DataSpaces/' + p).toString('utf16le');
      expect(ds('Version')).toContain('Microsoft.Container.DataSpaces');
      expect(ds('DataSpaceMap')).toContain('EncryptedPackage');
      expect(ds('DataSpaceMap')).toContain('StrongEncryptionDataSpace');
      expect(ds('DataSpaceInfo/StrongEncryptionDataSpace')).toContain('StrongEncryptionTransform');
      const primary = ds('TransformInfo/StrongEncryptionTransform/\u0006Primary');
      expect(primary).toContain('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}');
      expect(primary).toContain('Microsoft.Container.EncryptionTransform');
    }
  }, 120_000);

  withOracle("the data spaces streams are byte for byte msoffcrypto-tool's own (herumi/msoffice's, which Word opens)", async () => {
    const locked = await api.lockDocxBytes(inputs[0]!.bytes, PW);
    const cfb = readCfb(locked);
    const r = spawnSync(VENV_PY!, ['-c', [
      'from msoffcrypto.method.container.ecma376_encrypted import DefaultContent as D',
      'print(D.Version.hex()); print(D.DataSpaceMap.hex()); print(D.StrongEncryptionDataSpace.hex()); print(D.Primary.hex())',
    ].join('\n')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const [version, map, space, primary] = r.stdout.trim().split(/\r?\n/);
    expect(cfb.stream('\u0006DataSpaces/Version').toString('hex')).toBe(version);
    expect(cfb.stream('\u0006DataSpaces/DataSpaceMap').toString('hex')).toBe(map);
    expect(cfb.stream('\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace').toString('hex')).toBe(space);
    expect(cfb.stream('\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary').toString('hex')).toBe(primary);
  }, 60_000);

  it('EncryptionInfo: version 4.4, reserved 0x40, XML with keyData AES-256 / SHA512 / 16, spinCount 100000 and dataIntegrity', async () => {
    const locked = await api.lockDocxBytes(inputs[0]!.bytes, PW);
    const info = encryptionInfo(locked);
    expect(info.version).toEqual([4, 4]);
    expect(info.reserved).toBe(0x40);
    expect(info.root).toEqual({ ns: 'http://schemas.microsoft.com/office/2006/encryption', name: 'encryption' });
    expect(info.keyData).toMatchObject({ saltSize: '16', blockSize: '16', keyBits: '256', hashSize: '64', cipherAlgorithm: 'AES', cipherChaining: 'ChainingModeCBC', hashAlgorithm: 'SHA512' });
    expect(info.b64(info.keyData.saltValue).length).toBe(16);
    expect(info.keyEncryptor.uri).toBe('http://schemas.microsoft.com/office/2006/keyEncryptor/password');
    expect(info.encryptedKey).toMatchObject({ spinCount: '100000', saltSize: '16', blockSize: '16', keyBits: '256', hashSize: '64', cipherAlgorithm: 'AES', cipherChaining: 'ChainingModeCBC', hashAlgorithm: 'SHA512' });
    expect(info.b64(info.encryptedKey.saltValue).length).toBe(16);
    expect(info.b64(info.encryptedKey.encryptedVerifierHashInput).length).toBe(16);
    expect(info.b64(info.encryptedKey.encryptedVerifierHashValue).length).toBe(64);
    expect(info.b64(info.encryptedKey.encryptedKeyValue).length).toBe(32);
    expect(info.b64(info.dataIntegrity.encryptedHmacKey).length).toBe(64);
    expect(info.b64(info.dataIntegrity.encryptedHmacValue).length).toBe(64);
  }, 60_000);

  it('HMAC verifies: the dataIntegrity HMAC, recomputed over EncryptedPackage with the decrypted key, matches', async () => {
    for (const i of [inputs[1]!, inputs[inputs.length - 1]!]) {
      const locked = await api.lockDocxBytes(i.bytes, PW);
      const key = secretKey(locked, PW);
      const info = encryptionInfo(locked);
      const salt = info.b64(info.keyData.saltValue);
      const hmacKey = aesDec(key, sha512(salt, BLK.hmacKey), info.b64(info.dataIntegrity.encryptedHmacKey));
      const hmacValue = aesDec(key, sha512(salt, BLK.hmacValue), info.b64(info.dataIntegrity.encryptedHmacValue));
      const pkg = readCfb(locked).stream('EncryptedPackage');
      expect(createHmac('sha512', hmacKey).update(pkg).digest().equals(hmacValue), i.name).toBe(true);
      // and the package decrypts, segment by segment, with IV = SHA512(keyDataSalt ‖ LE32(segment))[0..16]
      const plain: Buffer[] = [];
      for (let s = 0, o = 8; o < pkg.length; s++, o += 4096) {
        const le = Buffer.alloc(4);
        le.writeUInt32LE(s, 0);
        plain.push(aesDec(key, sha512(salt, le), pkg.subarray(o, Math.min(pkg.length, o + 4096))));
      }
      expect(Buffer.concat(plain).subarray(0, i.bytes.length).equals(Buffer.from(i.bytes)), i.name).toBe(true);
      // one byte changed in the package: the HMAC no longer matches
      const bad = Buffer.from(pkg);
      bad[bad.length - 1] ^= 1;
      expect(createHmac('sha512', hmacKey).update(bad).digest().equals(hmacValue)).toBe(false);
    }
  }, 120_000);

  it("no plaintext left: word/document.xml's first heading, the zip's local-header signature and slices of the input are absent", async () => {
    for (const i of inputs) {
      const heading = await firstHeading(i.bytes);
      expect(heading.length, i.name).toBeGreaterThan(3);
      const locked = await api.lockDocxBytes(i.bytes, PW);
      expect(has(locked, Buffer.from(heading, 'utf8')), i.name + ' ' + heading).toBe(false);
      expect(has(locked, Buffer.from(heading, 'utf16le')), i.name).toBe(false);
      expect(has(locked, Buffer.from('PK\u0003\u0004', 'latin1')), i.name).toBe(false);
      expect(has(locked, Buffer.from('word/document.xml', 'latin1')), i.name).toBe(false);
      for (const at of [0, 0.25, 0.5, 0.75]) {
        const o = Math.floor(i.bytes.length * at);
        expect(has(locked, i.bytes.subarray(o, o + 32)), i.name + ' @' + o).toBe(false);
      }
    }
  }, 240_000);

  withOracle('Unicode: each password round-trips through the oracle as typed, as raw UTF-16LE with surrogate pairs kept (no NFKC)', async () => {
    const docx = inputs[0]!.bytes;
    for (const pw of ['pässwörd', '密码本', '🔒book', 'كلمة', 'ü'.repeat(100), 'lantern-'.repeat(25), 'a​b', 'é']) {
      const locked = await api.lockDocxBytes(docx, pw);
      const r = oracle(locked, pw);
      expect(r.code, pw.slice(0, 12) + ' ' + r.err).toBe(0);
      expect(Buffer.from(r.plain!).equals(Buffer.from(docx))).toBe(true);
      // the key is the raw UTF-16LE: derived here from it, the verifier holds
      expect(secretKey(locked, pw).length).toBe(32);
    }
    // no SASLprep and no NFKC: "ｐass" does not open with "pass", nor "é" (one code point) with "e" + U+0301
    expect(oracle(await api.lockDocxBytes(docx, 'ｐass'), 'pass').code).toBe(1);
    expect(oracle(await api.lockDocxBytes(docx, 'é'), 'é').code).toBe(1);
    // the emoji's neighbour U+1F513 (the same high surrogate, another low one) is another password
    expect(oracle(await api.lockDocxBytes(docx, '🔒book'), '🔓book').code).toBe(1);
  }, 240_000);

  it('fresh randomness: two locks differ in the keyData salt, the password salt and the encrypted key', async () => {
    const a = encryptionInfo(await api.lockDocxBytes(inputs[0]!.bytes, PW));
    const b = encryptionInfo(await api.lockDocxBytes(inputs[0]!.bytes, PW));
    expect(a.keyData.saltValue).not.toBe(b.keyData.saltValue);
    expect(a.encryptedKey.saltValue).not.toBe(b.encryptedKey.saltValue);
    expect(a.encryptedKey.encryptedKeyValue).not.toBe(b.encryptedKey.encryptedKeyValue);
    expect(a.encryptedKey.encryptedVerifierHashInput).not.toBe(b.encryptedKey.encryptedVerifierHashInput);
    expect(a.dataIntegrity.encryptedHmacKey).not.toBe(b.dataIntegrity.encryptedHmacKey);
  }, 60_000);

  it('password not in output: neither its UTF-8 nor its UTF-16LE bytes appear in the result', async () => {
    for (const pw of ['correct horse lantern 7', 'pässwörd-Ünïcode', '密码本密码本', '🔒book-🔒book']) {
      const locked = await api.lockDocxBytes(inputs[0]!.bytes, pw);
      expect(has(locked, Buffer.from(pw, 'utf8')), pw).toBe(false);
      expect(has(locked, Buffer.from(pw, 'utf16le')), pw).toBe(false);
    }
  }, 60_000);

  it('the input is not changed, and an ArrayBuffer is taken as well as a Uint8Array', async () => {
    const i = inputs[0]!;
    const copy = i.bytes.slice();
    const locked = await api.lockDocxBytes(i.bytes, PW);
    expect(Buffer.from(i.bytes).equals(Buffer.from(copy))).toBe(true);
    const fromBuffer = await api.lockDocxBytes(copy.buffer as unknown as Uint8Array, PW);
    expect(Number(readCfb(fromBuffer).stream('EncryptedPackage').readBigUInt64LE(0))).toBe(copy.length);
    expect(locked.length).toBe(fromBuffer.length);
  }, 60_000);

  it('refuses what it cannot lock, and never says the password: an empty password, an already locked file, not a Word file', async () => {
    const secret = 'zebra-crossing-91';
    const locked = await api.lockDocxBytes(inputs[0]!.bytes, secret);
    const msgs: string[] = [];
    for (const [bytes, pw] of [
      [inputs[0]!.bytes, ''],
      [locked, secret],
      [new TextEncoder().encode('not a docx at all'), secret],
      [new Uint8Array(0), secret],
    ] as [Uint8Array, string][]) {
      let err: unknown = null;
      try {
        await api.lockDocxBytes(bytes, pw);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      msgs.push(String((err as Error).message) + String((err as Error).stack));
    }
    for (const m of msgs) {
      expect(m).not.toContain(secret);
      expect(m).not.toContain(Buffer.from(secret, 'utf16le').toString('latin1'));
    }
  }, 60_000);
});
