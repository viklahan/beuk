// @vitest-environment node
import 'fake-indexeddb/auto';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';

/* Opening locked files on import (design 2026-11-10), task 1: 1.0's compound-file reader (cfbStreams), its lock
   sniffer (officeLockKind) and its ECMA-376 Agile decryptor (officeUnlock), BEUK:importlock in client/index.html, lifted
   into the main closure.
   The locked inputs are third-party output: msoffcrypto-tool's OOXMLFile.encrypt (test/fixtures/locked/, made by
   e2e/oracles/make-locked-fixtures.py), Beuk's own lockDocxBytes, and a SHA-1 / AES-128 file made here with node:crypto
   that msoffcrypto opens first. The compound files the hostile tests break are written by 1.0's own lockCfb (premium 1's
   writer), so their layout is known: version 3, 512-byte sectors, one FAT sector, the directory contiguous. */

type CfbDir = { name: string; type: number; color: number; left: number; right: number; child: number; data: Uint8Array };
type Coded = Error & { code?: string };
type Api = {
  cfbStreams: (b: Uint8Array, names?: string[]) => Map<string, Uint8Array>;
  officeLockKind: (b: Uint8Array) => null | 'agile' | 'unsupported';
  officeUnlock: (b: Uint8Array, pw: string) => Promise<Uint8Array>;
  lockDocxBytes: (b: Uint8Array, pw: string) => Promise<Uint8Array>;
  lockCfb: (dirs: CfbDir[]) => Uint8Array;
  importLockSha1Spin: (h0: Uint8Array, rounds: number) => Uint8Array;
};
let api: Api;
const t = (k: string, p?: Record<string, unknown>) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);

/* the page's globals the decryptor reads: 1.0's vendored JSZip (for the checks here) and an XML DOMParser (jsdom's) */
const req = createRequire(import.meta.url);
const jszip = req('../../client/assets/vendor/jszip.min.js') as unknown; // (its UMD sets the global as it loads: required first)
(globalThis as { JSZip?: unknown }).JSZip ??= jszip;
const JSZip = (globalThis as unknown as { JSZip: { loadAsync: (b: Uint8Array) => Promise<{ files: Record<string, unknown> }> } }).JSZip;
const { JSDOM } = req('jsdom') as { JSDOM: new (html: string) => { window: { DOMParser: typeof globalThis.DOMParser } } };
(globalThis as { DOMParser?: unknown }).DOMParser ??= new JSDOM('').window.DOMParser;

const DIR = fileURLToPath(new URL('./fixtures/locked/', import.meta.url));
const fx = (n: string) => new Uint8Array(readFileSync(DIR + n));
const PW = 'correct horse';
const PW_UNICODE = 'pässwörd\u{1F600}';

/* ---------------- the oracle (msoffcrypto-tool, as lockcopy-docx.test.ts runs it) ---------------- */
const ORACLES = fileURLToPath(new URL('../e2e/oracles/', import.meta.url));
const SCRIPT = path.join(ORACLES, 'docx-decrypt.py');
const VENV_PY = [path.join(ORACLES, '.venv', 'Scripts', 'python.exe'), path.join(ORACLES, '.venv', 'bin', 'python')].find((p) => existsSync(p));
const probe = VENV_PY ? spawnSync(VENV_PY, [SCRIPT, '--probe'], { encoding: 'utf8' }) : null;
const ORACLE = probe !== null && probe.status === 0;
const ORACLE_WHY = !VENV_PY ? 'SKIPPED: no venv at e2e/oracles/.venv' : !ORACLE ? String(probe!.stdout || probe!.stderr).trim() : String(probe!.stdout).trim();
console.log('[importlock-docx] oracle: ' + ORACLE_WHY);
if (!ORACLE && process.env.BEUK_DOCX_ORACLE === 'required') throw new Error('the DOCX oracle is required and missing: ' + ORACLE_WHY);
const withOracle = it.skipIf(!ORACLE);
let work: string;
let seq = 0;
/** msoffcrypto opens `locked` with `password` (`extra`: the script's flags): the exit code, and the plain bytes on 0. */
function oracle(locked: Uint8Array, password: string, extra: string[] = []): { code: number; plain: Uint8Array | null; err: string } {
  const n = ++seq;
  const src = path.join(work, n + '.docx');
  const dst = path.join(work, n + '.plain.docx');
  writeFileSync(src, locked);
  const r = spawnSync(VENV_PY!, [SCRIPT, ...extra, src, dst, password], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  const code = r.status ?? -1;
  const plain = code === 0 ? new Uint8Array(readFileSync(dst)) : null;
  rmSync(src, { force: true });
  rmSync(dst, { force: true });
  return { code, plain, err: String(r.stderr || '') };
}

/* ---------------- compound files, written by 1.0's lockCfb ---------------- */
const NOSTREAM = 0xffffffff;
/** The two streams in a version 3 compound file: the root (id 0), EncryptionInfo (id 1, black), EncryptedPackage (id 2,
 *  red, its right sibling: MS-CFB orders by length first, 14 < 16). */
function cfbOf(info: Uint8Array, pkg: Uint8Array): Uint8Array {
  return api.lockCfb([
    { name: 'Root Entry', type: 5, color: 1, left: NOSTREAM, right: NOSTREAM, child: 1, data: new Uint8Array(0) },
    { name: 'EncryptionInfo', type: 2, color: 1, left: NOSTREAM, right: 2, child: NOSTREAM, data: info },
    { name: 'EncryptedPackage', type: 2, color: 0, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, data: pkg },
  ]);
}
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
/** Directory entry `id`'s offset in a lockCfb file (its directory is contiguous from the header's first sector). */
const entryAt = (b: Uint8Array, id: number) => 512 + dv(b).getUint32(48, true) * 512 + id * 128;
const streamsOf = (b: Uint8Array) => {
  const s = api.cfbStreams(b);
  return { info: s.get('EncryptionInfo')!, pkg: s.get('EncryptedPackage')! };
};
const xmlOf = (info: Uint8Array) => new TextDecoder().decode(info.subarray(8));
const infoWith = (head: number[], xml: string) => {
  const x = new TextEncoder().encode(xml);
  const out = new Uint8Array(8 + x.length);
  out.set(head, 0);
  out.set(x, 8);
  return out;
};

/* ---------------- a SHA-1 / AES-128 Agile file, written here with node:crypto (MS-OFFCRYPTO §2.3.4.10–15) ---------------- */
const BLK = {
  verifierInput: Buffer.from('fea7d2763b4b9e79', 'hex'), verifierValue: Buffer.from('d7aa0f6d3061344e', 'hex'), keyValue: Buffer.from('146e0be7abacd0d6', 'hex'),
  hmacKey: Buffer.from('5fb2ad010cb9e1f6', 'hex'), hmacValue: Buffer.from('a0677f02b22c8433', 'hex'),
};
function agileLock(plain: Uint8Array, password: string, o: { hash: 'sha1' | 'sha256' | 'sha384' | 'sha512'; name: string; keyBits: 128 | 256; spin: number }): Uint8Array {
  const H = (...p: Buffer[]) => createHash(o.hash).update(Buffer.concat(p)).digest();
  const hashSize = H().length;
  const fit = (b: Buffer, n: number) => (b.length >= n ? b.subarray(0, n) : Buffer.concat([b, Buffer.alloc(n - b.length, 0x36)]));
  const pad16 = (b: Buffer) => (b.length % 16 ? Buffer.concat([b, Buffer.alloc(16 - (b.length % 16))]) : b);
  const enc = (key: Buffer, iv: Buffer, data: Buffer) => {
    const c = createCipheriv('aes-' + o.keyBits + '-cbc', key, iv);
    c.setAutoPadding(false);
    return Buffer.concat([c.update(data), c.final()]);
  };
  const le32 = (i: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(i, 0);
    return b;
  };
  const pwSalt = randomBytes(16), keySalt = randomBytes(16);
  let h = H(pwSalt, Buffer.from(password, 'utf16le'));
  for (let i = 0; i < o.spin; i++) h = H(le32(i), h);
  const kOf = (blk: Buffer) => fit(H(h, blk), o.keyBits / 8);
  const verifier = randomBytes(16);
  const encVI = enc(kOf(BLK.verifierInput), pwSalt, verifier);
  const encVH = enc(kOf(BLK.verifierValue), pwSalt, pad16(H(verifier)));
  const secret = randomBytes(o.keyBits / 8);
  const encKV = enc(kOf(BLK.keyValue), pwSalt, secret);
  const p = Buffer.from(plain);
  const parts = [Buffer.alloc(8)];
  parts[0]!.writeBigUInt64LE(BigInt(p.length), 0);
  for (let s = 0; s * 4096 < p.length; s++) parts.push(enc(secret, fit(H(keySalt, le32(s)), 16), pad16(p.subarray(s * 4096, (s + 1) * 4096))));
  const pkg = Buffer.concat(parts);
  const hmacKey = randomBytes(hashSize);
  const mac = createHmac(o.hash, hmacKey).update(pkg).digest();
  const encHK = enc(secret, fit(H(keySalt, BLK.hmacKey), 16), pad16(hmacKey));
  const encHV = enc(secret, fit(H(keySalt, BLK.hmacValue), 16), pad16(mac));
  const b64 = (b: Buffer) => b.toString('base64');
  const params = `saltSize="16" blockSize="16" keyBits="${o.keyBits}" hashSize="${hashSize}" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="${o.name}"`;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
    `<keyData ${params} saltValue="${b64(keySalt)}"/>` +
    `<dataIntegrity encryptedHmacKey="${b64(encHK)}" encryptedHmacValue="${b64(encHV)}"/>` +
    '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
    `<p:encryptedKey spinCount="${o.spin}" ${params} saltValue="${b64(pwSalt)}" encryptedVerifierHashInput="${b64(encVI)}" encryptedVerifierHashValue="${b64(encVH)}" encryptedKeyValue="${b64(encKV)}"/>` +
    '</keyEncryptor></keyEncryptors></encryption>';
  return cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], xml), new Uint8Array(pkg));
}

/* ---------------- helpers ---------------- */
const isZip = (b: Uint8Array) => Buffer.from(b.subarray(0, 4)).toString('hex') === '504b0304';
async function rejection(p: Promise<unknown>): Promise<Coded> {
  try {
    await p;
  } catch (e) {
    return e as Coded;
  }
  throw new Error('it did not reject');
}
/** Runs `f`, which must reject; the error and the time it took. */
async function timedRejection(f: () => Promise<unknown>): Promise<{ e: Coded; ms: number }> {
  const t0 = performance.now();
  const e = await rejection(Promise.resolve().then(f));
  return { e, ms: performance.now() - t0 };
}
const noPassword = (e: Coded, pw: string) => {
  expect(String(e.message)).not.toContain(pw);
  expect(String(e.stack || '')).not.toContain(pw);
};

let plain: Uint8Array;
beforeAll(async () => {
  api = (await loadClosure()).api as unknown as Api;
  setClosureT(t);
  setClosureLang('en');
  work = mkdtempSync(path.join(tmpdir(), 'beuk-importlock-'));
  plain = fx('plain.docx');
}, 120_000);
afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('officeUnlock: ECMA-376 Agile decryption in the browser (design 2026-11-10, task 1)', () => {
  withOracle('the fixtures are what the README says: msoffcrypto opens both with their passwords, to plain.docx', () => {
    for (const [name, pw] of [['agile-sha512.docx', PW], ['agile-unicode.docx', PW_UNICODE]] as const) {
      const r = oracle(fx(name), pw);
      expect(r.code, name + ' ' + r.err).toBe(0);
      expect(Buffer.from(r.plain!).equals(Buffer.from(plain)), name).toBe(true);
    }
  }, 60_000);

  it('officeUnlock opens the msoffcrypto Agile fixture', async () => {
    const out = await api.officeUnlock(fx('agile-sha512.docx'), PW);
    expect(isZip(out)).toBe(true);
    expect(Object.keys((await JSZip.loadAsync(out)).files)).toContain('word/document.xml');
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
  }, 30_000);

  it('officeUnlock opens the unicode-password fixture (pässwörd😀, UTF-16LE as typed, the surrogate pair kept)', async () => {
    const out = await api.officeUnlock(fx('agile-unicode.docx'), PW_UNICODE);
    expect(isZip(out)).toBe(true);
    expect(Object.keys((await JSZip.loadAsync(out)).files)).toContain('word/document.xml');
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
    // the NFD spelling (a + U+0308) is another password: the UTF-16LE is taken as typed, never normalized
    expect((await rejection(api.officeUnlock(fx('agile-unicode.docx'), 'pässwörd\u{1F600}'))).code).toBe('wrong-password');
  }, 30_000);

  it("officeUnlock opens Beuk's own lockDocxBytes output: the result is byte-equal to the input", async () => {
    const locked = await api.lockDocxBytes(plain, PW);
    const out = await api.officeUnlock(locked, PW);
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
    // a package under 4096 bytes lives in the mini stream
    const tiny = plain.slice(0, 1000);
    expect(Buffer.from(await api.officeUnlock(await api.lockDocxBytes(tiny, PW), PW)).equals(Buffer.from(tiny))).toBe(true);
  }, 30_000);

  withOracle('officeUnlock opens a SHA-1 / AES-128 Agile file (written here with node:crypto, msoffcrypto opens it first)', async () => {
    const locked = agileLock(plain, PW, { hash: 'sha1', name: 'SHA1', keyBits: 128, spin: 100000 });
    /* msoffcrypto-tool 6.1.0's verify_password and verify_integrity compare the decrypted, block-padded verifier hash and
       HMAC (32 bytes) with SHA-1's 20 bytes, so they refuse every SHA-1 Agile file (it is not truncated to hashSize as
       MS-OFFCRYPTO §2.3.4.13–14 says). Pinned: if a later msoffcrypto fixes it, this line says so. Its key derivation and
       its segment decryption take SHA-1 as the file names it: --no-verify opens the file with those alone. */
    expect(oracle(locked, PW).code, 'msoffcrypto 6.1.0 refuses SHA-1 in its verifiers').toBe(1);
    const r = oracle(locked, PW, ['--no-verify']);
    expect(r.code, r.err).toBe(0);
    expect(Buffer.from(r.plain!).equals(Buffer.from(plain)), 'msoffcrypto decrypts the fixture to the input').toBe(true);
    const t0 = performance.now();
    const out = await api.officeUnlock(locked, PW);
    const ms = performance.now() - t0;
    expect(Buffer.from(out).equals(Buffer.from(plain))).toBe(true);
    // fix round 1: the SHA-1 spin runs in plain JS (importLockSha1Spin), not as 100 000 awaited digests (about 2-3 s)
    expect(ms, 'one SHA-1 attempt, 100 000 rounds').toBeLessThan(1500);
    expect((await rejection(api.officeUnlock(locked, 'correct horsE'))).code).toBe('wrong-password');
  }, 60_000);

  withOracle('SHA-256 / AES-128 and SHA-384 / AES-256 Agile files (node:crypto): msoffcrypto opens them, verified, and so does officeUnlock', async () => {
    for (const o of [{ hash: 'sha256', name: 'SHA256', keyBits: 128, spin: 1000 }, { hash: 'sha384', name: 'SHA384', keyBits: 256, spin: 1000 }] as const) {
      const locked = agileLock(plain, PW, o);
      const r = oracle(locked, PW);
      expect(r.code, o.name + ' ' + r.err).toBe(0);
      expect(Buffer.from(r.plain!).equals(Buffer.from(plain)), o.name).toBe(true);
      expect(Buffer.from(await api.officeUnlock(locked, PW)).equals(Buffer.from(plain)), o.name).toBe(true);
    }
  }, 60_000);

  it('wrong password: rejects with .code "wrong-password", and the error never carries the password', async () => {
    for (const pw of ['correct horse ', 'Correct horse', '']) {
      const e = await rejection(api.officeUnlock(fx('agile-sha512.docx'), pw));
      expect(e.code, JSON.stringify(pw)).toBe('wrong-password');
      if (pw) noPassword(e, pw);
    }
  }, 30_000);

  it('a flipped byte in EncryptedPackage: rejects with .code "damaged" (the HMAC), with the right password', async () => {
    const { info, pkg } = streamsOf(fx('agile-sha512.docx'));
    for (const at of [0, 8, 100, pkg.length - 1]) {
      const bad = pkg.slice();
      bad[at]! ^= 1;
      const e = await rejection(api.officeUnlock(cfbOf(info, bad), PW));
      expect(e.code, 'byte ' + at).toBe('damaged');
      noPassword(e, PW);
    }
    // the same streams unbroken, in lockCfb's container, still open
    expect(Buffer.from(await api.officeUnlock(cfbOf(info, pkg), PW)).equals(Buffer.from(plain))).toBe(true);
  }, 30_000);

  it('a wrong HMAC value or key in dataIntegrity: "damaged", never imported half-right', async () => {
    const { info, pkg } = streamsOf(fx('agile-sha512.docx'));
    const xml = xmlOf(info);
    for (const attr of ['encryptedHmacValue', 'encryptedHmacKey']) {
      const m = new RegExp(attr + '="([^"]+)"').exec(xml)!;
      const raw = Buffer.from(m[1]!, 'base64');
      raw[0]! ^= 0x80;
      const bad = xml.replace(m[0], attr + '="' + raw.toString('base64') + '"');
      expect((await rejection(api.officeUnlock(cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], bad), pkg), PW))).code, attr).toBe('damaged');
    }
  }, 30_000);
});

describe('officeLockKind: what a compound file holds', () => {
  it('"agile" for the fixtures and Beuk\'s own lock; null for a plain DOCX, random bytes, empty bytes and a compound file without the two streams', async () => {
    expect(api.officeLockKind(fx('agile-sha512.docx'))).toBe('agile');
    expect(api.officeLockKind(fx('agile-unicode.docx'))).toBe('agile');
    expect(api.officeLockKind(await api.lockDocxBytes(plain, PW))).toBe('agile');
    expect(api.officeLockKind(plain)).toBe(null);
    expect(api.officeLockKind(new Uint8Array(randomBytes(4096)))).toBe(null);
    expect(api.officeLockKind(new Uint8Array(0))).toBe(null);
    const r = new Uint8Array(randomBytes(4096));
    r.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    expect(api.officeLockKind(r), 'the magic and noise').toBe(null);
    // a .doc-like compound file: one stream, no EncryptionInfo
    const doc = api.lockCfb([
      { name: 'Root Entry', type: 5, color: 1, left: NOSTREAM, right: NOSTREAM, child: 1, data: new Uint8Array(0) },
      { name: 'WordDocument', type: 2, color: 1, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, data: new Uint8Array(randomBytes(5000)) },
    ]);
    expect(api.cfbStreams(doc).has('WordDocument')).toBe(true);
    expect(api.officeLockKind(doc)).toBe(null);
  }, 30_000);

  it('"unsupported" for EncryptionInfo version 3.2 (Standard) and 4.2 / 4.3, and officeUnlock refuses it as "unsupported"', async () => {
    const { info, pkg } = streamsOf(fx('agile-sha512.docx'));
    for (const v of [[3, 0, 2, 0], [4, 0, 2, 0], [4, 0, 3, 0], [2, 0, 2, 0]]) {
      const f = cfbOf(infoWith([...v, 0x24, 0, 0, 0], xmlOf(info)), pkg);
      expect(api.officeLockKind(f), v.join('.')).toBe('unsupported');
      expect((await rejection(api.officeUnlock(f, PW))).code, v.join('.')).toBe('unsupported');
    }
  }, 30_000);

  it('"unsupported" for parameters outside Global 6: AES-192, RC4, ECB, MD5, a certificate-only key and spinCount 1 000 001', async () => {
    const { info, pkg } = streamsOf(fx('agile-sha512.docx'));
    const xml = xmlOf(info);
    const variants: [string, string][] = [
      ['AES-192', xml.replace(/keyBits="256"/g, 'keyBits="192"')],
      ['RC4', xml.replace(/cipherAlgorithm="AES"/g, 'cipherAlgorithm="RC4"')],
      ['ECB', xml.replace(/ChainingModeCBC/g, 'ChainingModeECB')],
      ['MD5', xml.replace(/hashAlgorithm="SHA512"/g, 'hashAlgorithm="MD5"')],
      ['spin', xml.replace('spinCount="100000"', 'spinCount="1000001"')],
      ['no password key', xml.replace('keyEncryptor/password"', 'keyEncryptor/certificate"').replace(/<p:encryptedKey[^>]*\/>/, '').replace(/xmlns:p="[^"]*"/, '')],
    ];
    for (const [what, x] of variants) {
      expect(x, what + ' changed the XML').not.toBe(xml);
      const f = cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], x), pkg);
      expect(api.officeLockKind(f), what).toBe('unsupported');
      expect((await rejection(api.officeUnlock(f, PW))).code, what).toBe('unsupported');
    }
    // spinCount 1 000 000 is inside the cap: it is Agile (and not run here)
    expect(api.officeLockKind(cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], xml.replace('spinCount="100000"', 'spinCount="1000000"')), pkg))).toBe('agile');
  }, 30_000);
});

describe('hostile compound files: "damaged" within 1000 ms, never a hang or a raw RangeError', () => {
  let base: Uint8Array;
  beforeAll(() => {
    const { info, pkg } = streamsOf(fx('agile-sha512.docx'));
    base = cfbOf(info, pkg);
  });
  const fatAt = (b: Uint8Array, sector: number) => 512 + dv(b).getUint32(76, true) * 512 + sector * 4;
  const cases: [string, (b: Uint8Array) => Uint8Array][] = [
    ['a FAT self-loop', (b) => {
      const start = dv(b).getUint32(entryAt(b, 2) + 116, true);
      dv(b).setUint32(fatAt(b, start), start, true);
      return b;
    }],
    ['a FAT loop back to the chain\'s start, deeper in', (b) => {
      const start = dv(b).getUint32(entryAt(b, 2) + 116, true);
      dv(b).setUint32(fatAt(b, start + 5), start, true);
      return b;
    }],
    ['a stream size past its chain', (b) => {
      const o = entryAt(b, 2) + 120;
      const size = dv(b).getUint32(o, true);
      dv(b).setUint32(o, Math.ceil(size / 512) * 512 + 1, true);
      expect(dv(b).getUint32(o, true)).toBeLessThanOrEqual(b.length);
      return b;
    }],
    ['a stream size past the file', (b) => {
      dv(b).setUint32(entryAt(b, 2) + 120, 0x7fffffff, true);
      return b;
    }],
    ['a DIFAT entry past the end of the file', (b) => {
      dv(b).setUint32(76, 0x00fffff0, true);
      return b;
    }],
    ['a FAT sector count past the file', (b) => {
      dv(b).setUint32(44, 0x00ffffff, true);
      return b;
    }],
    ['a directory sibling past the directory', (b) => {
      dv(b).setUint32(entryAt(b, 1) + 72, 1000, true);
      return b;
    }],
    ['a directory cycle (a sibling pointing back at its parent)', (b) => {
      dv(b).setUint32(entryAt(b, 2) + 68, 1, true);
      return b;
    }],
    ['a directory chain into a loop', (b) => {
      const dir0 = dv(b).getUint32(48, true);
      dv(b).setUint32(fatAt(b, dir0), dir0, true);
      return b;
    }],
    ['a mini FAT loop (EncryptionInfo, in the mini stream, chained to itself)', (b) => {
      const s = dv(b).getUint32(entryAt(b, 1) + 116, true);
      expect(dv(b).getUint32(entryAt(b, 1) + 120, true), 'EncryptionInfo is a mini stream').toBeLessThan(4096);
      dv(b).setUint32(512 + dv(b).getUint32(60, true) * 512 + s * 4, s, true);
      return b;
    }],
    ['a sector size other than 512 or 4096', (b) => {
      dv(b).setUint16(30, 16, true);
      return b;
    }],
    ['a 512-byte file (the header alone)', (b) => b.slice(0, 512)],
    ['the header cut short', (b) => b.slice(0, 100)],
  ];
  for (const [what, breakIt] of cases) {
    it(what, async () => {
      const bad = breakIt(base.slice());
      const { e, ms } = await timedRejection(() => api.officeUnlock(bad, PW));
      expect(e.code, what + ': ' + e.message).toBe('damaged');
      expect(e).not.toBeInstanceOf(RangeError);
      expect(ms).toBeLessThan(1000);
      noPassword(e, PW);
      let threw: unknown = null;
      try {
        const k = api.officeLockKind(bad);
        expect(k === null || k === 'agile', what).toBe(true);
      } catch (x) {
        threw = x;
      }
      expect(threw, 'officeLockKind never throws').toBe(null);
      expect(() => api.cfbStreams(bad)).toThrow();
      try {
        api.cfbStreams(bad);
      } catch (x) {
        expect((x as Coded).code).toBe('damaged');
      }
    });
  }

  it('a spinCount of 2 000 000: "unsupported", refused at once, without spinning', async () => {
    const { info, pkg } = streamsOf(base);
    const f = cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], xmlOf(info).replace('spinCount="100000"', 'spinCount="2000000"')), pkg);
    expect(api.officeLockKind(f)).toBe('unsupported');
    const { e, ms } = await timedRejection(() => api.officeUnlock(f, PW));
    expect(e.code).toBe('unsupported');
    expect(ms).toBeLessThan(1000);
  });

  it('EncryptionInfo that is not XML, or XML without its parts: "damaged"', async () => {
    const { info, pkg } = streamsOf(base);
    const xml = xmlOf(info);
    for (const [what, x] of [
      ['not well-formed', xml.replace('</encryption>', '')],
      ['no keyData', xml.replace(/<keyData[^>]*\/>/, '')],
      ['a salt that is not base64', xml.replace(/(<keyData[^>]*saltValue=")[^"]+"/, '$1@@@@"')],
      ['a verifier cut short', xml.replace(/encryptedVerifierHashValue="[^"]+"/, 'encryptedVerifierHashValue="AAAA"')],
      ['an EncryptedPackage size past its data', null],
    ] as [string, string | null][]) {
      let f: Uint8Array;
      if (x === null) {
        const big = pkg.slice();
        dv(big).setUint32(0, pkg.length + 4096, true);
        f = cfbOf(info, big);
      } else {
        expect(x, what).not.toBe(xml);
        f = cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], x), pkg);
      }
      const e = await rejection(api.officeUnlock(f, PW));
      expect(e.code, what + ': ' + e.message).toBe('damaged');
      // fix round 1 (finding 4): a compound file with both streams and a 4.4 EncryptionInfo is a locked file, damaged
      // or not: "agile", so the ask runs and officeUnlock says "damaged" (never today's "another kind of file renamed")
      expect(api.officeLockKind(f), what).toBe('agile');
    }
  }, 30_000);

  it('an EncryptionInfo over 64 KB: "damaged" before DOMParser sees it; officeLockKind still says "agile"', async () => {
    const { info, pkg } = streamsOf(base);
    const xml = xmlOf(info);
    const ok = cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], xml.replace('<keyData', '<!--' + 'x'.repeat(60 * 1024) + '--><keyData')), pkg);
    expect(Buffer.from(await api.officeUnlock(ok, PW)).equals(Buffer.from(plain)), 'a 61 KB one still opens').toBe(true);
    const f = cfbOf(infoWith([4, 0, 4, 0, 0x40, 0, 0, 0], xml.replace('<keyData', '<!--' + 'x'.repeat(70 * 1024) + '--><keyData')), pkg);
    const { e, ms } = await timedRejection(() => api.officeUnlock(f, PW));
    expect(e.code, e.message).toBe('damaged');
    expect(ms).toBeLessThan(1000);
    expect(api.officeLockKind(f)).toBe('agile');
  }, 30_000);

  it('many directory entries over one shared chain: bounded, never a copy per entry (review finding 1)', async () => {
    const { info, pkg } = streamsOf(base);
    const N = 200;
    const dirs: CfbDir[] = [
      { name: 'Root Entry', type: 5, color: 1, left: NOSTREAM, right: NOSTREAM, child: 1, data: new Uint8Array(0) },
      { name: 'EncryptionInfo', type: 2, color: 1, left: NOSTREAM, right: 2, child: NOSTREAM, data: info },
      { name: 'EncryptedPackage', type: 2, color: 1, left: NOSTREAM, right: 3, child: NOSTREAM, data: pkg },
    ];
    for (let i = 0; i < N; i++) dirs.push({ name: 's' + i, type: 2, color: 1, left: NOSTREAM, right: i + 1 < N ? 4 + i : NOSTREAM, child: NOSTREAM, data: new Uint8Array(0) });
    const f = api.lockCfb(dirs);
    // every extra entry is pointed at EncryptedPackage's own chain, with its size
    const start = dv(f).getUint32(entryAt(f, 2) + 116, true), size = dv(f).getUint32(entryAt(f, 2) + 120, true);
    expect(size).toBeGreaterThanOrEqual(4096);
    for (let i = 0; i < N; i++) {
      dv(f).setUint32(entryAt(f, 3 + i) + 116, start, true);
      dv(f).setUint32(entryAt(f, 3 + i) + 120, size, true);
    }
    expect(size * (N + 1), 'reading them all would be far past the file').toBeGreaterThan(f.length * 50);
    // reading every stream: past the file's own size in total, so "damaged"
    let t0 = performance.now();
    let err: Coded | null = null;
    try {
      api.cfbStreams(f);
    } catch (x) {
      err = x as Coded;
    }
    expect(err && err.code).toBe('damaged');
    expect(performance.now() - t0).toBeLessThan(1000);
    // the sniff and the unlock read only EncryptionInfo and EncryptedPackage
    t0 = performance.now();
    expect(api.officeLockKind(f)).toBe('agile');
    expect(performance.now() - t0).toBeLessThan(1000);
    expect([...api.cfbStreams(f, ['EncryptionInfo']).keys()]).toEqual(['EncryptionInfo']);
    expect(Buffer.from(await api.officeUnlock(f, PW)).equals(Buffer.from(plain))).toBe(true);
  }, 30_000);

  it('the DIFAT chain: a loop, and a DIFAT sector past the end of the file (a 10 MB lock, past 109 FAT sectors)', async () => {
    const ten = new Uint8Array(10 * 1024 * 1024);
    ten.set(plain.subarray(0, 4), 0);
    const locked = await api.lockDocxBytes(ten, PW);
    expect(dv(locked).getUint32(72, true), 'DIFAT sectors').toBe(1);
    const difat0 = dv(locked).getUint32(68, true);
    const cases: [string, (b: Uint8Array) => void][] = [
      ['a DIFAT loop', (b) => {
        // two DIFAT sectors needed (more FAT sectors claimed), the first one's next pointing back at itself
        dv(b).setUint32(44, 109 + 127 + 1, true);
        dv(b).setUint32(72, 2, true);
        dv(b).setUint32(512 + difat0 * 512 + 508, difat0, true);
      }],
      ['the first DIFAT sector past the end of the file', (b) => dv(b).setUint32(68, 0x00fffff0, true)],
      ['a DIFAT next pointer past the end of the file', (b) => {
        dv(b).setUint32(44, 109 + 127 + 1, true);
        dv(b).setUint32(72, 2, true);
        dv(b).setUint32(512 + difat0 * 512 + 508, 0x00fffff0, true);
      }],
    ];
    for (const [what, breakIt] of cases) {
      const bad = locked.slice();
      breakIt(bad);
      const { e, ms } = await timedRejection(() => api.officeUnlock(bad, PW));
      expect(e.code, what + ': ' + e.message).toBe('damaged');
      expect(ms, what).toBeLessThan(1000);
      expect(api.officeLockKind(bad), what).toBe(null);
    }
  }, 60_000);
});

/* ---------------- version 4: a compound file with 4096-byte sectors, written here ---------------- */
/** MS-CFB version 4 (§2.2): a 4096-byte header sector, then sector 0 the FAT, 1 the directory, 2 the mini FAT, then the
 *  mini stream (every stream under 4096 bytes, in 64-byte mini sectors) and the large stream, each contiguous. The
 *  directory is the root, `small` (id 1, black) and `big` (id 2, red, its right sibling). `sizeHigh` writes the high
 *  half of the big stream's 64-bit size. */
function cfbV4(small: { name: string; data: Uint8Array }, big: { name: string; data: Uint8Array }, sizeHigh = 0): Uint8Array {
  const SS = 4096, FREE = 0xffffffff, END = 0xfffffffe;
  const nMiniSec = Math.ceil(small.data.length / 64);
  const nMini = Math.ceil((nMiniSec * 64) / SS), nBig = Math.ceil(big.data.length / SS);
  const mini0 = 3, big0 = mini0 + nMini, total = big0 + nBig;
  expect(total, 'one FAT sector').toBeLessThanOrEqual(SS / 4);
  expect(nMiniSec, 'one mini FAT sector').toBeLessThanOrEqual(SS / 4);
  const out = new Uint8Array(SS + total * SS);
  const v = dv(out);
  const at = (s: number) => SS + s * SS;
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  v.setUint16(24, 0x3e, true);
  v.setUint16(26, 4, true);
  v.setUint16(28, 0xfffe, true);
  v.setUint16(30, 12, true);
  v.setUint16(32, 6, true);
  v.setUint32(40, 1, true); // directory sectors (version 4 counts them)
  v.setUint32(44, 1, true);
  v.setUint32(48, 1, true);
  v.setUint32(56, 4096, true);
  v.setUint32(60, 2, true);
  v.setUint32(64, 1, true);
  v.setUint32(68, END, true);
  v.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) v.setUint32(76 + i * 4, i === 0 ? 0 : FREE, true);
  const fat = new Array<number>(SS / 4).fill(FREE);
  fat[0] = 0xfffffffd;
  fat[1] = END;
  fat[2] = END;
  const chain = (s0: number, n: number) => { for (let i = 0; i < n; i++) fat[s0 + i] = i + 1 < n ? s0 + i + 1 : END; };
  chain(mini0, nMini);
  chain(big0, nBig);
  fat.forEach((x, i) => v.setUint32(at(0) + i * 4, x, true));
  for (let i = 0; i < SS / 4; i++) v.setUint32(at(2) + i * 4, i < nMiniSec ? (i + 1 < nMiniSec ? i + 1 : END) : FREE, true);
  out.set(small.data, at(mini0));
  out.set(big.data, at(big0));
  for (let id = 0; id < SS / 128; id++) {
    const o = at(1) + id * 128;
    v.setUint32(o + 68, FREE, true);
    v.setUint32(o + 72, FREE, true);
    v.setUint32(o + 76, FREE, true);
  }
  const entry = (id: number, name: string, type: number, color: number, right: number, child: number, start: number, size: number, high: number) => {
    const o = at(1) + id * 128;
    for (let i = 0; i < name.length; i++) v.setUint16(o + i * 2, name.charCodeAt(i), true);
    v.setUint16(o + 64, (name.length + 1) * 2, true);
    out[o + 66] = type;
    out[o + 67] = color;
    v.setUint32(o + 72, right, true);
    v.setUint32(o + 76, child, true);
    v.setUint32(o + 116, start, true);
    v.setUint32(o + 120, size, true);
    v.setUint32(o + 124, high, true);
  };
  entry(0, 'Root Entry', 5, 1, FREE, 1, mini0, nMiniSec * 64, 0);
  entry(1, small.name, 2, 1, 2, FREE, 0, small.data.length, 0);
  entry(2, big.name, 2, 0, FREE, FREE, big0, big.data.length, sizeHigh);
  return out;
}

describe('version 4 compound files (4096-byte sectors, 64-bit sizes)', () => {
  it('cfbStreams reads a mini stream and a FAT stream from a version 4 file, and officeUnlock opens the fixture repacked as version 4', async () => {
    const a = new Uint8Array(randomBytes(100)), z = new Uint8Array(randomBytes(5000));
    const f = cfbV4({ name: 'Small', data: a }, { name: 'Big', data: z });
    const s = api.cfbStreams(f);
    expect(Buffer.from(s.get('Small')!).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(s.get('Big')!).equals(Buffer.from(z))).toBe(true);
    const { info, pkg } = streamsOf(fx('agile-sha512.docx'));
    expect(info.length).toBeLessThan(4096);
    const v4 = cfbV4({ name: 'EncryptionInfo', data: info }, { name: 'EncryptedPackage', data: pkg });
    expect(dv(v4).getUint16(26, true)).toBe(4);
    expect(api.officeLockKind(v4)).toBe('agile');
    expect(Buffer.from(await api.officeUnlock(v4, PW)).equals(Buffer.from(plain))).toBe(true);
    // the size's high half counts in version 4: 2^32 + n is past the file
    const huge = cfbV4({ name: 'EncryptionInfo', data: info }, { name: 'EncryptedPackage', data: pkg }, 1);
    expect((await rejection(api.officeUnlock(huge, PW))).code).toBe('damaged');
  }, 30_000);
});

describe('cfbStreams: the compound-file reader', () => {
  it("reads lockCfb's output, mini stream and FAT streams alike, and msoffcrypto's file, to the same streams", async () => {
    const small = new Uint8Array(randomBytes(3000)), big = new Uint8Array(randomBytes(70000));
    const f = cfbOf(small, big);
    const s = api.cfbStreams(f);
    expect(Buffer.from(s.get('EncryptionInfo')!).equals(Buffer.from(small))).toBe(true);
    expect(Buffer.from(s.get('EncryptedPackage')!).equals(Buffer.from(big))).toBe(true);
    const m = api.cfbStreams(fx('agile-sha512.docx'));
    expect([...m.keys()].sort()).toEqual(['EncryptedPackage', 'EncryptionInfo']);
    // the 10 MB lock: past 109 FAT sectors, so the FAT is reached through DIFAT sectors
    const ten = new Uint8Array(10 * 1024 * 1024);
    ten.set(plain.subarray(0, 4), 0);
    const locked = await api.lockDocxBytes(ten, PW);
    expect(dv(locked).getUint32(72, true), 'DIFAT sectors').toBeGreaterThan(0);
    expect(api.cfbStreams(locked).get('EncryptedPackage')!.length).toBe(8 + ten.length);
  }, 60_000);

  it('importLockSha1Spin matches WebCrypto SHA-1, round by round (H_n = SHA-1(LE32(n - 1) ‖ H_n-1))', async () => {
    const h0 = new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array(randomBytes(40))));
    let h = h0.slice();
    const want = new Map<number, Uint8Array>([[0, h0.slice()]]);
    for (let i = 0; i < 1000; i++) {
      const buf = new Uint8Array(24);
      dv(buf).setUint32(0, i, true);
      buf.set(h, 4);
      h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
      if ([0, 1, 2, 999].includes(i)) want.set(i + 1, h);
    }
    for (const [n, w] of want) {
      const got = api.importLockSha1Spin(h0, n);
      expect(Buffer.from(got).toString('hex'), n + ' rounds').toBe(Buffer.from(w).toString('hex'));
    }
    expect(Buffer.from(h0).toString('hex'), 'h0 is not changed').toBe(Buffer.from(want.get(0)!).toString('hex'));
  });

  it('refuses a file over 400 MB without reading it', () => {
    const fake = new Uint8Array(16);
    Object.defineProperty(fake, 'length', { value: 400 * 1024 * 1024 + 1 });
    let e: Coded | null = null;
    try {
      api.cfbStreams(fake);
    } catch (x) {
      e = x as Coded;
    }
    expect(e && e.code).toBe('damaged');
  });
});
