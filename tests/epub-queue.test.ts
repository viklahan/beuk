import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';
import { EpubBuildError, EPUB_WORKER_ENV_KEYS, workerOptions, DEFAULT_EPUB_WORKER_HEAP_MB } from '../src/book/epub/closure.js';
import { buildEpub, studioEpub } from '../src/book/epub/build.js';
import { EpubBusyError, EpubQueue } from '../src/book/epub/queue.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { PIC_REF_PREFIX } from '../src/pictures.js';
import { Client, createTestDb, registerUser, testConfig } from './helpers.js';

/* BEUK:epub-server — the review fixes: size before hydration, a bounded
   queue (per user one), the worker's environment, defaults, a missing
   studio file. */

let db: Db;
let server: Server;
let base = '';
let queue: EpubQueue;
let seq = 0;

before(async () => {
  db = await createTestDb();
  const app = buildApp({ db, config: testConfig({ manuscriptMaxBytes: 4 * 1024 * 1024 }) });
  queue = app.locals.epubQueue as EpubQueue;
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${a.port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function writer(): Promise<{ c: Client; id: string }> {
  const email = `epubq-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email)).status, 201);
  return { c, id: (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id };
}
const cookie = (c: Client) => (c as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
const BOOK = { meta: { title: 'Q', author: 'A', language: 'en', bookId: 'urn:uuid:00000000-0000-4000-8000-0000000000aa' }, sections: [{ id: 'c1', kind: 'body', type: 'chapter', title: 'One', content: 'x' }] };
async function post(c: Client, body: unknown, signal?: AbortSignal) {
  const r = await fetch(base + '/api/epub', { method: 'POST', headers: { 'content-type': 'application/json', ...cookie(c) }, body: JSON.stringify(body), signal });
  const text = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, text: text.toString('utf8') };
}
/** Hold one slot of the app's queue for `userId` until release() is called. */
function hold(userId: string): { release: () => void; done: Promise<unknown> } {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const done = queue.run(userId, undefined, () => gate).catch((e) => e);
  return { release, done };
}

/* ---- 1. size before hydration ---- */

test('a small book naming one stored picture many times is refused (413) before anything is hydrated or queued', async () => {
  const w = await writer();
  const data = Buffer.alloc(300_000, 7).toString('base64'); // 400 KB of base64
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
  assert.equal((await w.c.put(`/api/pictures/${sha}`, { mediaType: 'image/png', data })).status, 201);
  const ref = PIC_REF_PREFIX + sha;
  const book = { ...BOOK, images: Array.from({ length: 40 }, (_, i) => ({ id: `im${i}`, name: 'p.png', mediaType: 'image/png', ext: 'png', data: ref })) };
  assert.ok(JSON.stringify(book).length < 10_000, 'the request itself is small');
  /* the real buildEpub, with a db that records what it is asked */
  const asked: string[] = [];
  const spy = { query: (sql: string, params?: unknown[]) => { asked.push(sql); return db.query(sql, params as never); } } as unknown as Db;
  const small = new EpubQueue(1, 0);
  await assert.rejects(
    buildEpub(spy, w.id, { book }, 'generic', 'en', { maxBytes: 4 * 1024 * 1024, timeoutMs: 60_000, heapMb: 512 }, small),
    (e: Error & { status?: number }) => e.status === 413,
  );
  assert.ok(!asked.some((q) => /select sha256, data from pictures/.test(q)), `no hydration query: ${asked.join(' | ')}`);
  assert.deepEqual(small.stats(), { running: 0, waiting: 0 }, 'no slot taken');
  const r = await post(w.c, { book });
  assert.equal(r.status, 413, r.text);
});

/* ---- 2. a bounded queue ---- */

test('EpubQueue: one at a time, hand-off in order, never over the cap', async () => {
  const q = new EpubQueue(1, 2);
  const order: string[] = [];
  let peak = 0;
  const job = (name: string) => async () => { peak = Math.max(peak, q.stats().running); order.push(name); await new Promise((r) => setTimeout(r, 5)); };
  await Promise.all([q.run('a', undefined, job('a')), q.run('b', undefined, job('b')), q.run('c', undefined, job('c'))]);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(peak, 1);
  assert.deepEqual(q.stats(), { running: 0, waiting: 0 });
});

test('the queue full: 503 with Retry-After, nothing built', async () => {
  const holders = [hold('h1')];
  for (let i = 0; i < queue.maxQueued; i++) holders.push(hold(`h-wait-${i}`));
  try {
    const w = await writer();
    const r = await post(w.c, { book: BOOK });
    assert.equal(r.status, 503, r.text);
    assert.ok(Number(r.headers.get('retry-after')) > 0, 'Retry-After');
  } finally {
    holders.forEach((h) => h.release());
    await Promise.all(holders.map((h) => h.done));
  }
});

test('one build per writer: a second while the first is in flight or waiting is 429', async () => {
  const w = await writer();
  const h = hold(w.id);
  try {
    const r = await post(w.c, { book: BOOK });
    assert.equal(r.status, 429, r.text);
  } finally {
    h.release();
    await h.done;
  }
  assert.equal((await post(w.c, { book: BOOK })).status, 200, 'free again once the first is done');
});

test('a writer who goes away while waiting leaves the queue', async () => {
  const h = hold('someone-else');
  const w = await writer();
  const ac = new AbortController();
  const pending = post(w.c, { book: BOOK }, ac.signal).catch((e) => e);
  for (let i = 0; i < 100 && queue.stats().waiting === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(queue.stats().waiting, 1, 'queued behind the held slot');
  ac.abort();
  await pending;
  for (let i = 0; i < 100 && queue.stats().waiting !== 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(queue.stats().waiting, 0, 'removed on close');
  h.release();
  await h.done;
  assert.deepEqual(queue.stats(), { running: 0, waiting: 0 });
});

test('EpubQueue: an aborted waiter is rejected and removed; a busy writer is refused', async () => {
  const q = new EpubQueue(1, 1);
  let release!: () => void;
  const first = q.run('a', undefined, () => new Promise<void>((r) => { release = r; }));
  const ac = new AbortController();
  const second = q.run('b', ac.signal, async () => 'ran');
  await assert.rejects(q.run('a', undefined, async () => 1), (e: EpubBusyError) => e.reason === 'user-busy');
  await assert.rejects(q.run('c', undefined, async () => 1), (e: EpubBusyError) => e.reason === 'queue-full');
  ac.abort();
  await assert.rejects(second, (e: EpubBusyError) => e.reason === 'aborted');
  assert.equal(q.stats().waiting, 0);
  release();
  await first;
});

/* ---- 3. defaults ---- */

test('defaults: one build at a time, four waiting, a 512 MB worker heap; all configurable', () => {
  const d = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(d.epubMaxConcurrent, 1);
  assert.equal(d.epubMaxQueued, 4);
  assert.equal(d.epubWorkerHeapMb, 512);
  assert.equal(DEFAULT_EPUB_WORKER_HEAP_MB, 512);
  const e = loadConfig({ EPUB_MAX_CONCURRENT: '2', EPUB_MAX_QUEUED: '9', EPUB_WORKER_HEAP_MB: '768' } as NodeJS.ProcessEnv);
  assert.deepEqual([e.epubMaxConcurrent, e.epubMaxQueued, e.epubWorkerHeapMb], [2, 9, 768]);
});

/* ---- 4. the worker carries no secrets ---- */

test('the build worker gets an empty environment: no DATABASE_URL, no Stripe keys', async () => {
  const opts = workerOptions({} as never, 512);
  for (const k of Object.keys(opts.env as object)) assert.ok(EPUB_WORKER_ENV_KEYS.includes(k), `only temp-dir variables reach the worker (${k})`);
  assert.equal(opts.resourceLimits?.maxOldGenerationSizeMb, 512);
  process.env.DATABASE_URL = 'postgres://secret@db/beuk';
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_a_real_key';
  try {
    const keys = await new Promise<string[]>((resolve, reject) => {
      const w = new Worker("require('node:worker_threads').parentPort.postMessage(Object.keys(process.env))", { eval: true, env: opts.env, resourceLimits: opts.resourceLimits });
      w.once('message', (m: string[]) => { resolve(m); void w.terminate(); });
      w.once('error', reject);
    });
    assert.ok(!keys.includes('DATABASE_URL') && !keys.some((k) => k.startsWith('STRIPE')), keys.join(','));
    assert.ok(keys.every((k) => EPUB_WORKER_ENV_KEYS.includes(k)), `nothing else: ${keys.join(',')}`);
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.STRIPE_SECRET_KEY;
  }
});

/* ---- 6. a missing studio file ---- */

test('a missing client/index.html or jszip.min.js is a plain failed build naming the file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-noclient-'));
  assert.throws(() => studioEpub(dir), (e: EpubBuildError) => e instanceof EpubBuildError && e.reason === 'failed' && /index\.html/.test(e.message));
  writeFileSync(path.join(dir, 'index.html'), '<script>\nfunction epubFiles() {}\n</script>\n');
  mkdirSync(path.join(dir, 'assets', 'vendor'), { recursive: true });
  assert.throws(() => studioEpub(dir), (e: EpubBuildError) => e instanceof EpubBuildError && e.reason === 'failed' && /jszip\.min\.js/.test(e.message));
});
