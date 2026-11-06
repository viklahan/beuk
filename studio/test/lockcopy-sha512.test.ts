// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadClosure } from '../src/closure/index';

/* Locked review copy, final review F4: the hand-written SHA-512 (1.0's BEUK:lockcopy: lockSha512Compress, the one
   compression behind the DOCX key spin and lockSha512Js) against the FIPS 180-2 known answers and node:crypto, inside
   vitest (the msoffcrypto-tool oracle is a Python venv and can be skipped). */
type Api = { lockSha512Js: (m: Uint8Array) => Uint8Array; lockSha512Spin: (h0: Uint8Array, rounds: number) => Uint8Array };
let api: Api;
beforeAll(async () => {
  api = (await loadClosure()).api as unknown as Api;
});
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const ref = (m: Uint8Array | string) => createHash('sha512').update(m).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s);

describe('lockSha512Js: FIPS 180-2 known answers', () => {
  it('"abc" (one block)', () => {
    expect(hex(api.lockSha512Js(enc('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });
  it('the empty string', () => {
    expect(hex(api.lockSha512Js(new Uint8Array(0)))).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    );
  });
  it('the 896-bit message (two blocks)', () => {
    const m = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
    expect(m.length * 8).toBe(896);
    expect(hex(api.lockSha512Js(enc(m)))).toBe(
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    );
  });
});

describe('lockSha512Js and lockSha512Spin against node:crypto', () => {
  it('an input of more than 1 MB (an odd length)', () => {
    const m = new Uint8Array(1_048_576 + 37).map((_, i) => (Math.imul(i, 2654435761) >>> 24) ^ (i & 255));
    expect(m.length).toBeGreaterThan(1_048_576);
    expect(hex(api.lockSha512Js(m))).toBe(ref(m));
  });
  it('one million "a" (the FIPS 180-2 long message)', () => {
    const m = new Uint8Array(1_000_000).fill(0x61);
    expect(hex(api.lockSha512Js(m))).toBe(ref(m));
  });
  it('every padding edge: lengths 0, 1, 111, 112, 113, 127, 128, 129, 239, 240, 255, 256', () => {
    for (const n of [0, 1, 111, 112, 113, 127, 128, 129, 239, 240, 255, 256]) {
      const m = new Uint8Array(n).map((_, i) => (i * 7 + n) & 255);
      expect(hex(api.lockSha512Js(m)), 'length ' + n).toBe(ref(m));
    }
  });
  it('the spin (H_n = SHA-512(LE32(n-1) || H_n-1)) for 1, 2, 3 and 1000 rounds', () => {
    const h0 = new Uint8Array(createHash('sha512').update('spin start').digest());
    for (const rounds of [1, 2, 3, 1000]) {
      let h: Buffer = Buffer.from(h0);
      for (let i = 0; i < rounds; i++) {
        const le = Buffer.alloc(4);
        le.writeUInt32LE(i);
        h = createHash('sha512').update(le).update(h).digest();
      }
      expect(hex(api.lockSha512Spin(h0.slice(), rounds)), rounds + ' rounds').toBe(h.toString('hex'));
    }
  });
});
