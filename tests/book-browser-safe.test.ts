import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID, sha1, uuidV5 } from '../src/book/upgrade.js';

/* Step 4 part C, constraint 6: readBook runs in the studio's browser bundle,
   so src/book's reading path imports nothing from node: and uses no Buffer.
   The SHA-1 port is checked against node's own, and the minted id keeps
   1.0's newBookId format (urn:uuid: + a random v4). */
const here = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.join(here, '..', 'src', 'book');
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('browser-safe: the reading path (read, upgrade, schema, defaults, observe, editor) imports no node: module and uses no Buffer', () => {
  const files = ['read.ts', 'upgrade.ts', 'schema.ts', 'defaults.ts', 'observe.ts', 'index.ts',
    ...readdirSync(path.join(BOOK, 'editor')).map((f) => path.join('editor', f))];
  for (const f of files) {
    const src = readFileSync(path.join(BOOK, f), 'utf8');
    assert.doesNotMatch(src, /from\s+['"]node:/, `${f} imports a node: module`);
    assert.doesNotMatch(src, /\bBuffer\./, `${f} uses Buffer`);
  }
});

test('browser-safe: sha1 equals node:crypto SHA-1 on edge lengths and random bytes', () => {
  let seed = 7;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4096];
  for (let i = 0; i < 60; i++) lengths.push(rnd() % 2000);
  for (const n of lengths) {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = rnd() & 255;
    assert.equal(Buffer.from(sha1(b)).toString('hex'), createHash('sha1').update(b).digest('hex'), `length ${n}`);
  }
});

test('browser-safe: uuidV5 matches the RFC 9562 vector and a node-built v5 on non-Latin names', () => {
  assert.equal(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  const nodeV5 = (ns: string, name: string): string => {
    const h = createHash('sha1').update(Buffer.from(ns.replace(/-/g, ''), 'hex')).update(Buffer.from(name, 'utf8')).digest();
    const b = Buffer.from(h.subarray(0, 16));
    b[6] = (b[6]! & 0x0f) | 0x50; b[8] = (b[8]! & 0x3f) | 0x80;
    const x = b.toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  };
  for (const name of ['urn:uuid:sabc1234', 'urn:uuid:ünïcödé-日本語', 'كتاب', 'किताब 📚', '', 'x'.repeat(300)])
    assert.equal(uuidV5('8bf1c6b6-5f75-4773-a701-cdd420357f52', name), nodeV5('8bf1c6b6-5f75-4773-a701-cdd420357f52', name));
});

test('browser-safe: randomUUID is a v4 UUID, through randomUUID and through the getRandomValues fallback', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) { const u = randomUUID(); assert.match(u, V4); seen.add(u); }
  assert.equal(seen.size, 50);
  const c = globalThis.crypto as { randomUUID?: unknown };
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), 'randomUUID');
  assert.ok(desc, 'Crypto.prototype.randomUUID exists in Node 22');
  Object.defineProperty(c, 'randomUUID', { value: undefined, configurable: true });
  try {
    for (let i = 0; i < 50; i++) assert.match(randomUUID(), V4);
  } finally {
    delete c.randomUUID;
  }
  assert.equal(typeof globalThis.crypto.randomUUID, 'function');
});
