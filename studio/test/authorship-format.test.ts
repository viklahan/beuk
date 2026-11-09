// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadClosure } from '../src/closure/index';

/* Locked backups and the authorship record (design 2026-11-09), task 2: 1.0's BEUK:authorship block — the book's
   fingerprint, the plain backup with its authorship block, the locked envelope (PBKDF2-SHA-256 600000 → AES-GCM 256
   over WebCrypto) and the reader of a backup file. */
type Envelope = Record<string, unknown> & {
  format: string;
  version: number;
  kdf: { name: string; hash: string; iterations: number; salt: string };
  cipher: { name: string; iv: string };
  data: string;
};
type Api = {
  backupFingerprint: (book: object) => Promise<string>;
  backupPayload: (book: object, recorded: string | null) => Promise<{ text: string; sha256: string }>;
  backupLock: (plainText: string, password: string) => Promise<string>;
  backupUnlock: (envelope: object, password: string) => Promise<string>;
  backupRead: (
    text: string,
  ) => Promise<
    | null
    | { locked: true; envelope: Envelope }
    | { locked: false; book: Record<string, unknown>; authorship: Record<string, unknown> | null; intact: boolean | null }
  >;
};
let api: Api;
beforeAll(async () => {
  api = (await loadClosure()).api as unknown as Api;
});

const TITLE = 'Café — “quotes” 日本';
const AUTHOR = 'Ada Quillfeather';
const WORD = 'zephyrwhisk';
const book = () => ({
  meta: { title: TITLE, author: AUTHOR, bookId: 'b-123' },
  sections: [{ id: 's1', type: 'chapter', title: 'One', html: '<p>The ' + WORD + ' sang in the dark.</p>' }],
});
const sha = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const b64d = (s: string) => Buffer.from(s, 'base64');
const flip = (s: string, at = 0) => {
  const b = b64d(s);
  b[at] ^= 1;
  return b.toString('base64');
};
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    return String((e as { code?: unknown }).code);
  }
  return 'resolved';
}

describe('backupFingerprint', () => {
  it('matches node:crypto sha256 of JSON.stringify(book)', async () => {
    const b = book();
    const fp = await api.backupFingerprint(b);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(sha(JSON.stringify(b)));
  });
});

describe('backupPayload', () => {
  it('authorship.sha256 = fingerprint; savedAt === exportedAt; recorded passed through (null and an ISO)', async () => {
    const b = book();
    const fp = await api.backupFingerprint(b);
    const a = await api.backupPayload(b, null);
    expect(a.sha256).toBe(fp);
    const p = JSON.parse(a.text);
    expect(Object.keys(p)).toEqual(['format', 'version', 'exportedAt', 'book', 'authorship']);
    expect(p.format).toBe('beuk-backup');
    expect(p.version).toBe(1);
    expect(p.book).toEqual(b);
    expect(Object.keys(p.authorship)).toEqual(['author', 'savedAt', 'sha256', 'recorded']);
    expect(p.authorship.author).toBe(AUTHOR);
    expect(p.authorship.sha256).toBe(fp);
    expect(p.authorship.savedAt).toBe(p.exportedAt);
    expect(new Date(p.exportedAt).toISOString()).toBe(p.exportedAt);
    expect(p.authorship.recorded).toBeNull();
    // the fingerprint is over the book exactly as written to the file
    expect(sha(JSON.stringify(p.book))).toBe(fp);
    const iso = '2026-11-09T12:34:56.789Z';
    const c = JSON.parse((await api.backupPayload(b, iso)).text);
    expect(c.authorship.recorded).toBe(iso);
    // no author: an empty string
    const d = JSON.parse((await api.backupPayload({ sections: [] }, null)).text);
    expect(d.authorship.author).toBe('');
  });
  it('stays readable by today\'s localParseBackup', async () => {
    const full = (await loadClosure()).api as unknown as { localParseBackup: (t: string) => unknown };
    const b = book();
    const { text } = await api.backupPayload(b, null);
    expect(full.localParseBackup(text)).toEqual(b);
    const r = await api.backupRead(text);
    expect(r && !r.locked && r.book).toEqual(b);
  });
});

describe('locked envelope', () => {
  it('backupLock → backupUnlock round-trips the exact text', async () => {
    const { text } = await api.backupPayload(book(), null);
    const env = await api.backupLock(text, 'correct horse ☃');
    expect(await api.backupUnlock(JSON.parse(env), 'correct horse ☃')).toBe(text);
  });
  it('keys exactly format,version,kdf,cipher,data; kdf.iterations 600000; salt 16 bytes, iv 12; two locks differ', async () => {
    const { text } = await api.backupPayload(book(), null);
    const s1 = await api.backupLock(text, 'pw');
    const s2 = await api.backupLock(text, 'pw');
    const e1 = JSON.parse(s1) as Envelope;
    const e2 = JSON.parse(s2) as Envelope;
    expect(Object.keys(e1)).toEqual(['format', 'version', 'kdf', 'cipher', 'data']);
    expect(e1.format).toBe('beuk-backup-locked');
    expect(e1.version).toBe(1);
    expect(Object.keys(e1.kdf)).toEqual(['name', 'hash', 'iterations', 'salt']);
    expect(e1.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
    expect(Object.keys(e1.cipher)).toEqual(['name', 'iv']);
    expect(e1.cipher.name).toBe('AES-GCM');
    expect(b64d(e1.kdf.salt).length).toBe(16);
    expect(b64d(e1.cipher.iv).length).toBe(12);
    // ciphertext of the UTF-8 of the text, plus the 128-bit tag
    expect(b64d(e1.data).length).toBe(Buffer.byteLength(text, 'utf8') + 16);
    expect(e1.kdf.salt).not.toBe(e2.kdf.salt);
    expect(e1.cipher.iv).not.toBe(e2.cipher.iv);
    expect(e1.data).not.toBe(e2.data);
  });
  it('leaks nothing: the title, author and a chapter word are not in the envelope', async () => {
    const { text } = await api.backupPayload(book(), null);
    const env = await api.backupLock(text, 'pw');
    for (const needle of [TITLE, 'Café', '日本', AUTHOR, 'Quillfeather', WORD, 'b-123']) expect(env).not.toContain(needle);
  });
});

describe('backupUnlock failures', () => {
  let env: Envelope;
  beforeAll(async () => {
    const { text } = await api.backupPayload(book(), null);
    env = JSON.parse(await api.backupLock(text, 'right'));
  });
  const clone = () => JSON.parse(JSON.stringify(env)) as Envelope;
  it('wrong password → code "wrong"', async () => {
    expect(await code(api.backupUnlock(clone(), 'wrong'))).toBe('wrong');
  });
  it('one flipped byte in data / iv / salt → code "wrong"', async () => {
    const d = clone();
    d.data = flip(d.data, 5);
    expect(await code(api.backupUnlock(d, 'right'))).toBe('wrong');
    const t = clone();
    t.data = flip(t.data, b64d(t.data).length - 1); // the tag
    expect(await code(api.backupUnlock(t, 'right'))).toBe('wrong');
    const i = clone();
    i.cipher.iv = flip(i.cipher.iv);
    expect(await code(api.backupUnlock(i, 'right'))).toBe('wrong');
    const s = clone();
    s.kdf.salt = flip(s.kdf.salt);
    expect(await code(api.backupUnlock(s, 'right'))).toBe('wrong');
  });
  it('iterations 600001, format "x", bad base64, missing data → code "bad"', async () => {
    const it1 = clone();
    it1.kdf.iterations = 600001;
    expect(await code(api.backupUnlock(it1, 'right'))).toBe('bad');
    const f = clone();
    f.format = 'x';
    expect(await code(api.backupUnlock(f, 'right'))).toBe('bad');
    const bd = clone();
    bd.data = '@@not*base64!!';
    expect(await code(api.backupUnlock(bd, 'right'))).toBe('bad');
    const bd2 = clone();
    bd2.data = bd2.data.slice(0, -1); // truncated: no longer a whole base64 quantum
    expect(await code(api.backupUnlock(bd2, 'right'))).toBe('bad');
    const md = clone();
    delete (md as Record<string, unknown>).data;
    expect(await code(api.backupUnlock(md, 'right'))).toBe('bad');
  });
  it('the other structural checks → code "bad"', async () => {
    const cases: ((e: Envelope) => void)[] = [
      (e) => { e.version = 2; },
      (e) => { e.kdf.name = 'scrypt'; },
      (e) => { e.kdf.hash = 'SHA-1'; },
      (e) => { e.cipher.name = 'AES-CBC'; },
      (e) => { e.kdf.salt = Buffer.alloc(15).toString('base64'); },
      (e) => { e.cipher.iv = Buffer.alloc(16).toString('base64'); },
      (e) => { (e as Record<string, unknown>).data = 42; },
      (e) => { e.kdf.salt = '%%%%'; },
      (e) => { delete (e as Record<string, unknown>).kdf; },
      (e) => { delete (e as Record<string, unknown>).cipher; },
    ];
    for (const [n, mut] of cases.entries()) {
      const e = clone();
      mut(e);
      expect(await code(api.backupUnlock(e, 'right')), 'case ' + n).toBe('bad');
    }
    for (const junk of [null, undefined, 'str', 7, []]) expect(await code(api.backupUnlock(junk as never, 'right'))).toBe('bad');
  });
});

describe('backupRead', () => {
  it('a plain backup: intact true; one chapter word changed: false; no authorship: null', async () => {
    const { text, sha256 } = await api.backupPayload(book(), '2026-11-09T00:00:00.000Z');
    const r = await api.backupRead(text);
    expect(r).toMatchObject({ locked: false, intact: true });
    if (!r || r.locked) throw new Error('not plain');
    expect(r.book).toEqual(book());
    expect(r.authorship).toMatchObject({ author: AUTHOR, sha256, recorded: '2026-11-09T00:00:00.000Z' });

    const edited = text.replace(WORD, 'zephyrwhisp');
    expect(edited).not.toBe(text);
    expect(await api.backupRead(edited)).toMatchObject({ locked: false, intact: false });

    const old = JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', book: book() });
    const o = await api.backupRead(old);
    expect(o).toEqual({ locked: false, book: book(), authorship: null, intact: null });
  });
  it('an authorship without a 64-lowercase-hex sha256 is no authorship', async () => {
    const p = JSON.parse((await api.backupPayload(book(), null)).text);
    for (const bad of [undefined, '', 'ABC', 'A'.repeat(64), 'g'.repeat(64), 12]) {
      p.authorship.sha256 = bad;
      expect(await api.backupRead(JSON.stringify(p))).toMatchObject({ locked: false, authorship: null, intact: null });
    }
    p.authorship = 'nope';
    expect(await api.backupRead(JSON.stringify(p))).toMatchObject({ locked: false, authorship: null, intact: null });
  });
  it('an envelope gives {locked:true}', async () => {
    const env = await api.backupLock((await api.backupPayload(book(), null)).text, 'pw');
    const r = await api.backupRead(env);
    expect(r).toEqual({ locked: true, envelope: JSON.parse(env) });
  });
  it('"{}", "not json", a .docx text and other non-backups give null, never a throw', async () => {
    const docx = 'PK\u0003\u0004\u0014\u0000\u0006\u0000\b\u0000\u0000\u0000!\u0000[Content_Types].xml';
    for (const t of ['{}', 'not json', docx, '', 'null', '[]', '"x"', '42',
      JSON.stringify({ format: 'beuk-backup', book: {} }),
      JSON.stringify({ format: 'beuk-backup', book: { sections: 'x' } }),
      JSON.stringify({ format: 'beuk-backup-locked' }),
      JSON.stringify({ format: 'beuk-backup-locked', version: 1, kdf: {}, cipher: {}, data: 'x' }),
    ]) {
      expect(await api.backupRead(t), JSON.stringify(t)).toBeNull();
    }
    for (const junk of [null, undefined, 5, {}]) expect(await api.backupRead(junk as never)).toBeNull();
  });
});
