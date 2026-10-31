import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { ACCESS_RULES } from '../src/access.js';
import { buildApp } from '../src/app.js';
import { EpubBusyError, EpubQueue } from '../src/book/epub/queue.js';
import { BuildBusyError, BuildQueue } from '../src/book/studio/queue.js';
import { buildWrap } from '../src/book/wrap/build.js';
import { MAX_WRAP_PIXELS, imageSize } from '../src/book/wrap/limits.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';
import { PIC_REF_PREFIX } from '../src/pictures.js';
import { fixturePath } from './book-fixtures.js';
import { Client, createTestDb, registerUser, startTestServer, testConfig, type TestServer } from './helpers.js';

/* BEUK:wrap-server — POST /api/wrap: the cover wrap painted on the server
   by the studio's own painter (src/routes/wrap.ts, src/book/wrap). */

const ON: Partial<Config> = {
  stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
  stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
  stripePriceId: 'price_fixture_one',
  stripeApiBase: 'http://127.0.0.1:9',
};
const DAY = 86_400_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let db: Db;
let on: TestServer; // billing on: trial / paused are real states
let small: TestServer; // billing off, an 8 MB manuscript cap and a 1 ms build cap
let off: { server: Server; base: string; queue: BuildQueue; epubQueue: EpubQueue };
let seq = 0;

before(async () => {
  db = await createTestDb();
  on = await startTestServer(db, undefined, ON);
  small = await startTestServer(db, undefined, { manuscriptMaxBytes: 8 * 1024 * 1024, jobTimeoutMs: 1 });
  const app = buildApp({ db, config: testConfig() });
  const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('no address');
  off = { server, base: `http://127.0.0.1:${a.port}`, queue: app.locals.wrapQueue as BuildQueue, epubQueue: app.locals.epubQueue as EpubQueue };
});
after(async () => {
  await on.close();
  await small.close();
  await new Promise<void>((r) => off.server.close(() => r()));
});

async function writer(base: string): Promise<{ c: Client; id: string }> {
  const email = `wrap-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id;
  return { c, id };
}
const cookie = (c: Client) => (c as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();

/** POST that keeps the bytes (Client.request parses JSON). */
async function postWrap(base: string, c: Client | null, body: unknown, signal?: AbortSignal) {
  const res = await fetch(`${base}/api/wrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c ? cookie(c) : {}) },
    body: JSON.stringify(body),
    signal,
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const json = () => JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  return { status: res.status, headers: res.headers, bytes, json };
}

type Recipe = { title?: string; bgType?: string; bgImageId: string | null; wrap: Record<string, unknown> };
type Book = { meta: { title: string }; coverRecipe: Recipe | null; images: { id: string; name?: string; mediaType: string; ext?: string; data: string }[] };
/** Lantern Coast print, a 6x9 paperback with a made cover (a fresh copy each call). */
const lantern = (): Book => (JSON.parse(readFileSync(fixturePath('real', 'lantern-coast-print.json'), 'utf8')) as { book: Book }).book;
const disposition = (h: Headers) => /filename="([^"]+)"/.exec(h.get('content-disposition') ?? '')?.[1];
const reasonOf = (r: { json: () => Record<string, unknown> }) => ({ reason: r.json().reason, pictures: r.json().pictures });

/** The studio's own slug(), evaluated from client/index.html. */
const studioSlug = (() => {
  const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  const line = /function slug\(s\) \{[^\n]*\}/.exec(html);
  assert.ok(line, 'the studio declares slug(s) on one line');
  return vm.runInNewContext(`(${line[0]})`) as (s: string) => string;
})();

/** A solid PNG of one colour. */
function solidPng(rgb: [number, number, number], size = 64): string {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${rgb.join(',')})`;
  ctx.fillRect(0, 0, size, size);
  return c.toBuffer('image/png').toString('base64');
}
const sha = (b64: string) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');

/** How many pixels of a JPEG (scaled to a quarter) sit near each colour. */
async function colourCounts(jpeg: Buffer, colours: [number, number, number][]): Promise<number[]> {
  const img = await loadImage(jpeg);
  const w = Math.round(img.width / 4), h = Math.round(img.height / 4);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = colours.map(() => 0);
  for (let i = 0; i < d.length; i += 4) {
    colours.forEach(([r, g, b], k) => {
      if (Math.abs(d[i]! - r) < 40 && Math.abs(d[i + 1]! - g) < 40 && Math.abs(d[i + 2]! - b) < 40) out[k]!++;
    });
  }
  return out;
}

/* ---- the gate ---- */

test('the route is gated by export.wrap (one more export route)', () => {
  assert.deepEqual(ACCESS_RULES.filter((r) => r.path === '/api/wrap'), [{ method: 'POST', path: '/api/wrap', feature: 'export.wrap' }]);
});

test('signed out: 401, nothing built', async () => {
  const r = await postWrap(on.base, null, { book: lantern(), kind: 'pdf' });
  assert.equal(r.status, 401);
});

test('after the trial unpaid: 402 with the paused body (feature export.wrap), nothing built', async () => {
  const w = await writer(on.base);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(Date.now() - DAY)]);
  const r = await postWrap(on.base, w.c, { book: lantern(), kind: 'jpg' });
  assert.equal(r.status, 402);
  assert.equal(r.json().feature, 'export.wrap');
  assert.equal(r.json().paused, true);
});

/* ---- 200 in trial ---- */

test('in trial: a PDF of exactly the wrap size and a 300-DPI JPEG, named the way downloadWrap names them', async () => {
  const w = await writer(on.base);
  const pdf = await postWrap(on.base, w.c, { book: lantern(), kind: 'pdf' });
  assert.equal(pdf.status, 200, pdf.bytes.toString('utf8').slice(0, 300));
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(disposition(pdf.headers), 'the-lantern-coast-cover-wrap.pdf');
  assert.equal(pdf.headers.get('cache-control'), 'no-store');
  const page = (await PDFDocument.load(pdf.bytes)).getPage(0).getSize();
  assert.equal(page.height, 9.25 * 72, '6x9 trim plus the bleed');
  const jpg = await postWrap(on.base, w.c, { book: lantern(), kind: 'jpg' });
  assert.equal(jpg.status, 200, jpg.bytes.toString('utf8').slice(0, 300));
  assert.equal(jpg.headers.get('content-type'), 'image/jpeg');
  assert.equal(disposition(jpg.headers), 'the-lantern-coast-cover-wrap.jpg');
  assert.deepEqual(imageSize(jpg.bytes), { w: Math.round((page.width / 72) * 300), h: Math.round((page.height / 72) * 300) }, 'the JPEG is the PDF page at 300 DPI');
});

test('file names: a case laminate, and titles through the studio\'s own slug (empty title = "cover")', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.coverRecipe!.wrap = { ...b.coverRecipe!.wrap, binding: 'case' };
  b.meta.title = 'Łódź: Ünïcode — the Second Book!';
  const r = await postWrap(on.base, w.c, { book: b, kind: 'jpg' });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  assert.equal(disposition(r.headers), studioSlug(b.meta.title) + '-case-laminate-wrap.jpg');
  assert.equal(studioSlug('The Lantern Coast'), 'the-lantern-coast', 'the studio slug as used above');
  const e = lantern();
  e.meta.title = '';
  const r2 = await postWrap(on.base, w.c, { book: e, kind: 'jpg' });
  assert.equal(r2.status, 200);
  assert.equal(disposition(r2.headers), studioSlug('cover') + '-cover-wrap.jpg');
});

/* ---- Review focus #3: pictures from the shelf ---- */

test('pictures from the shelf: a cover background, a jacket flap photo and an uploaded spine icon, stored as beuk-pic refs, all appear in the render', async (t) => {
  const w = await writer(on.base);
  const MAGENTA: [number, number, number] = [255, 0, 255], GREEN: [number, number, number] = [0, 200, 0], BLUE: [number, number, number] = [0, 0, 255];
  const pics = { 'pic-bg': solidPng(MAGENTA), 'pic-flap': solidPng(GREEN), 'pic-icon': solidPng(BLUE) };
  for (const data of Object.values(pics)) assert.equal((await w.c.put(`/api/pictures/${sha(data)}`, { mediaType: 'image/png', data })).status, 201);
  const b = lantern();
  b.images = Object.entries(pics).map(([id, data]) => ({ id, name: `${id}.png`, mediaType: 'image/png', ext: 'png', data: PIC_REF_PREFIX + sha(data) }));
  b.coverRecipe!.bgType = 'image';
  b.coverRecipe!.bgImageId = 'pic-bg';
  b.coverRecipe!.wrap = { ...b.coverRecipe!.wrap, binding: 'jacket', pages: 400, flapPhotoId: 'pic-flap', spine: { iconTop: { kind: 'upload', name: '', picId: 'pic-icon' } } };
  const saved = await w.c.request('POST', '/api/manuscripts', { doc: b }, { 'beuk-pictures': 'ref' });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const mid = (saved.body.manuscript as { id: string }).id;
  const r = await postWrap(on.base, w.c, { manuscriptId: mid, kind: 'jpg' });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  assert.equal(disposition(r.headers), 'the-lantern-coast-dust-jacket.jpg');
  /* the studio lays its art scrim (COVER_ART_SCRIM, rgba(12,10,8,0.2)) over a background picture */
  const scrim = (c: [number, number, number]): [number, number, number] => c.map((v, i) => Math.round(v * 0.8 + [12, 10, 8][i]! * 0.2)) as [number, number, number];
  const [bg, flap, icon] = await colourCounts(r.bytes, [scrim(MAGENTA), GREEN, BLUE]);
  assert.ok(bg! > 5000, `the background picture is painted (${bg} px near magenta at quarter scale)`);
  assert.ok(flap! > 500, `the flap photo is painted (${flap} px near green)`);
  assert.ok(icon! > 50, `the spine icon is painted (${icon} px near blue)`);
  /* the same book without those pictures paints none of those colours */
  const plain = lantern();
  plain.coverRecipe!.wrap = { ...plain.coverRecipe!.wrap, binding: 'jacket', pages: 400 };
  const p = await postWrap(on.base, w.c, { book: plain, kind: 'jpg' });
  assert.equal(p.status, 200);
  const base = await colourCounts(p.bytes, [scrim(MAGENTA), GREEN, BLUE]);
  assert.ok(base.every((n) => n < 20), `no such colours without the pictures (${base.join(', ')})`);
  t.diagnostic(`colour counts at quarter scale: with pictures bg ${bg}, flap ${flap}, icon ${icon}; without ${base.join(', ')}`);
});

test('a picture the cover names that the book does not hold: a clear 422 naming it, not a blank panel', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.coverRecipe!.bgImageId = 'gone-pic';
  const r = await postWrap(on.base, w.c, { book: b, kind: 'pdf' });
  assert.equal(r.status, 422, r.bytes.toString('utf8').slice(0, 300));
  assert.deepEqual(reasonOf(r), { reason: 'missing-pictures', pictures: ['gone-pic'] });
  assert.match(String(r.json().error), /gone-pic/);
});

test('a ref the shelf does not hold: 422 naming it, before anything is built', async () => {
  const w = await writer(on.base);
  const b = lantern();
  const gone = 'b'.repeat(64);
  b.images.find((i) => i.id === 'sample-img-cover-art')!.data = PIC_REF_PREFIX + gone;
  const r = await postWrap(on.base, w.c, { book: b, kind: 'pdf' });
  assert.equal(r.status, 422);
  assert.deepEqual(r.json().missingPictures, [gone]);
  assert.match(String(r.json().error), /picture/);
});

test('an SVG chosen as cover art: 422 naming it as a picture the wrap cannot paint', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.images.push({ id: 'svg-flourish', name: 'star.svg', mediaType: 'image/svg+xml', ext: 'svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString('base64') });
  b.coverRecipe!.bgImageId = 'svg-flourish';
  const r = await postWrap(on.base, w.c, { book: b, kind: 'jpg' });
  assert.equal(r.status, 422, r.bytes.toString('utf8').slice(0, 300));
  assert.deepEqual(reasonOf(r), { reason: 'picture-unsupported', pictures: ['svg-flourish'] });
  assert.match(String(r.json().error), /svg-flourish/);
  assert.match(String(r.json().error), /JPEG/);
});

test('a book with no made cover: 422 no-cover', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.coverRecipe = null;
  const r = await postWrap(on.base, w.c, { book: b, kind: 'pdf' });
  assert.equal(r.status, 422);
  assert.equal(r.json().reason, 'no-cover');
  assert.match(String(r.json().error), /cover/);
});

/* ---- Review focus #5: a hostile recipe ---- */

test('hostile: another writer\'s picture ref is a picture this writer does not hold (422), never their bytes; their shelf book is 404', async () => {
  const owner = await writer(on.base);
  const data = solidPng([255, 0, 255]);
  assert.equal((await owner.c.put(`/api/pictures/${sha(data)}`, { mediaType: 'image/png', data })).status, 201);
  const ob = lantern();
  ob.images = [{ id: 'pic-bg', name: 'bg.png', mediaType: 'image/png', ext: 'png', data: PIC_REF_PREFIX + sha(data) }];
  ob.coverRecipe!.bgImageId = 'pic-bg';
  const saved = await owner.c.request('POST', '/api/manuscripts', { doc: ob }, { 'beuk-pictures': 'ref' });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const mid = (saved.body.manuscript as { id: string }).id;

  const thief = await writer(on.base);
  const r = await postWrap(on.base, thief.c, { book: ob, kind: 'jpg' });
  assert.equal(r.status, 422);
  assert.equal(r.json().reason, 'missing-pictures');
  assert.deepEqual(r.json().missingPictures, [sha(data)]);
  assert.equal(r.headers.get('content-type')?.startsWith('application/json'), true, 'no picture, no wrap');
  assert.ok(!r.bytes.toString('utf8').includes(data.slice(0, 40)), 'none of the owner\'s bytes');
  assert.equal((await postWrap(on.base, thief.c, { manuscriptId: mid, kind: 'jpg' })).status, 404);
  /* the owner gets their wrap */
  assert.equal((await postWrap(on.base, owner.c, { manuscriptId: mid, kind: 'jpg' })).status, 200);
});

test('hostile: a 10,000-character spine text is bounded by normalizeWrap (80) and the wrap renders', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.coverRecipe!.wrap = { ...b.coverRecipe!.wrap, pages: 400, spine: { show: 'custom', text: 'X'.repeat(10_000) } };
  const r = await postWrap(on.base, w.c, { book: b, kind: 'jpg' });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  const s = imageSize(r.bytes)!;
  assert.ok(s.w * s.h <= MAX_WRAP_PIXELS);
});

test('hostile: an absurd trim and pages=99999 are bounded by normalizeWrap (the book\'s trim, 5000 pages) and fit the size cap', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.coverRecipe!.wrap = { ...b.coverRecipe!.wrap, trim: '99999x99999', pages: 99999, paper: 'white' };
  const r = await postWrap(on.base, w.c, { book: b, kind: 'jpg' });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  const s = imageSize(r.bytes)!;
  assert.equal(s.h, Math.round(9.25 * 300), 'the book\'s own 6x9 trim');
  assert.ok(s.w * s.h <= MAX_WRAP_PIXELS, `${s.w} x ${s.h}`);
  const five = lantern();
  five.coverRecipe!.wrap = { ...five.coverRecipe!.wrap, pages: 5000, paper: 'white' };
  const r5 = await postWrap(on.base, w.c, { book: five, kind: 'jpg' });
  assert.equal(r5.status, 200);
  assert.deepEqual(imageSize(r5.bytes), s, 'the same wrap as 5000 pages');
});

test('hostile: a wrap over the pixel cap (custom paper 0.02, 5000 pages) is a 422 too-large', async () => {
  const w = await writer(on.base);
  const b = lantern();
  b.coverRecipe!.wrap = { ...b.coverRecipe!.wrap, paper: 'custom', customFactor: 0.02, pages: 5000 };
  const r = await postWrap(on.base, w.c, { book: b, kind: 'pdf' });
  assert.equal(r.status, 422);
  assert.equal(r.json().reason, 'too-large');
  assert.match(String(r.json().error), /larger than the server paints/);
});

test('hostile: a picture whose header declares 30000x30000, and a picture id of __proto__, are refused by id', async () => {
  const w = await writer(on.base);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(30000, 8); ihdr.writeUInt32BE(30000, 12); ihdr[16] = 8; ihdr[17] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]).toString('base64');
  const big = lantern();
  big.images.find((i) => i.id === 'sample-img-cover-art')!.data = png;
  const r = await postWrap(on.base, w.c, { book: big, kind: 'jpg' });
  assert.equal(r.status, 422);
  assert.deepEqual(reasonOf(r), { reason: 'picture-too-large', pictures: ['sample-img-cover-art'] });
  assert.match(String(r.json().error), /sample-img-cover-art/);
  const proto = lantern();
  proto.images.push({ ...proto.images[0]!, id: '__proto__' });
  proto.coverRecipe!.bgImageId = '__proto__';
  const r2 = await postWrap(on.base, w.c, { book: proto, kind: 'jpg' });
  assert.equal(r2.status, 422);
  assert.deepEqual(reasonOf(r2), { reason: 'bad-picture-id', pictures: ['__proto__'] });
});

test('bad requests: neither or both inputs, a kind that is not pdf or jpg, a non-uuid id', async () => {
  const w = await writer(on.base);
  assert.equal((await postWrap(on.base, w.c, { kind: 'pdf' })).status, 400);
  assert.equal((await postWrap(on.base, w.c, { book: {}, manuscriptId: 'x', kind: 'pdf' })).status, 400);
  assert.equal((await postWrap(on.base, w.c, { book: lantern() })).status, 400);
  assert.equal((await postWrap(on.base, w.c, { book: lantern(), kind: 'png' })).status, 400);
  assert.equal((await postWrap(on.base, w.c, { manuscriptId: 'not-a-uuid', kind: 'pdf' })).status, 404);
});

/* ---- size and time ---- */

test('size bound: a body over the manuscript limit (a 50 MB base64 picture) is refused (413)', async () => {
  const w = await writer(small.base);
  const b = lantern();
  b.images[0]!.data = 'A'.repeat(50 * 1024 * 1024);
  const r = await postWrap(small.base, w.c, { book: b, kind: 'pdf' });
  assert.equal(r.status, 413);
});

test('size bound before hydration: a small book naming one stored picture many times is 413 with nothing hydrated or queued', async () => {
  const w = await writer(off.base);
  const data = Buffer.alloc(300_000, 7).toString('base64');
  assert.equal((await w.c.put(`/api/pictures/${sha(data)}`, { mediaType: 'image/png', data })).status, 201);
  const b = lantern();
  b.images = Array.from({ length: 40 }, (_, i) => ({ id: `im${i}`, mediaType: 'image/png', data: PIC_REF_PREFIX + sha(data) }));
  const asked: string[] = [];
  const spy = { query: (sql: string, params?: unknown[]) => { asked.push(sql); return db.query(sql, params as never); } } as unknown as Db;
  const q = new BuildQueue(1, 0);
  await assert.rejects(
    buildWrap(spy, w.id, { book: b }, 'jpg', 'en', { maxBytes: 4 * 1024 * 1024, timeoutMs: 60_000, heapMb: 512 }, q),
    (e: Error & { status?: number }) => e.status === 413,
  );
  assert.ok(!asked.some((s) => /select sha256, data from pictures/.test(s)), `no hydration query: ${asked.join(' | ')}`);
  assert.deepEqual(q.stats(), { running: 0, waiting: 0 }, 'no slot taken');
});

test('time bound: a render past JOB_TIMEOUT_MS is stopped with a plain 503', async () => {
  const w = await writer(small.base);
  const r = await postWrap(small.base, w.c, { book: lantern(), kind: 'jpg' });
  assert.equal(r.status, 503);
  assert.equal(r.json().reason, 'timeout');
});

/* ---- the wrap's own queue: 429 and 503 ---- */

/** Hold one slot of the app's wrap queue for `userId` until release() is called. */
function hold(userId: string): { release: () => void; done: Promise<unknown> } {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const done = off.queue.run(userId, undefined, () => gate).catch((e) => e);
  return { release, done };
}

test('the wrap has its own queue: one at a time, four waiting, separate from the EPUB queue', () => {
  assert.ok(off.queue instanceof BuildQueue);
  assert.notEqual(off.queue as unknown, off.epubQueue as unknown);
  assert.equal(off.queue.maxConcurrent, 1);
  assert.equal(off.queue.maxQueued, 4);
  assert.equal(EpubQueue, BuildQueue, 'EpubQueue is the part 3 name of BuildQueue');
  assert.equal(EpubBusyError, BuildBusyError);
});

test('the queue full: 503 with Retry-After, nothing built', async () => {
  const holders = [hold('h1')];
  for (let i = 0; i < off.queue.maxQueued; i++) holders.push(hold(`h-wait-${i}`));
  try {
    const w = await writer(off.base);
    const r = await postWrap(off.base, w.c, { book: lantern(), kind: 'pdf' });
    assert.equal(r.status, 503, r.bytes.toString('utf8'));
    assert.equal(r.json().reason, 'queue-full');
    assert.ok(Number(r.headers.get('retry-after')) > 0, 'Retry-After');
  } finally {
    holders.forEach((h) => h.release());
    await Promise.all(holders.map((h) => h.done));
  }
});

test('one wrap per writer: a second while the first is in flight is 429; an EPUB in flight does not block a wrap', async () => {
  const w = await writer(off.base);
  const h = hold(w.id);
  try {
    const r = await postWrap(off.base, w.c, { book: lantern(), kind: 'pdf' });
    assert.equal(r.status, 429, r.bytes.toString('utf8'));
    assert.equal(r.json().reason, 'user-busy');
    assert.ok(Number(r.headers.get('retry-after')) > 0, 'Retry-After');
  } finally {
    h.release();
    await h.done;
  }
  let release!: () => void;
  const epub = off.epubQueue.run(w.id, undefined, () => new Promise<void>((r) => { release = r; }));
  try {
    assert.equal((await postWrap(off.base, w.c, { book: lantern(), kind: 'pdf' })).status, 200, 'free again, and the EPUB queue is not the wrap\'s');
  } finally {
    release();
    await epub;
  }
});

/* ---- settings and housekeeping ---- */

test('defaults: one wrap at a time, four waiting, a 512 MB worker heap; all configurable', () => {
  const d = loadConfig({} as NodeJS.ProcessEnv);
  assert.deepEqual([d.wrapMaxConcurrent, d.wrapMaxQueued, d.wrapWorkerHeapMb], [1, 4, 512]);
  const e = loadConfig({ WRAP_MAX_CONCURRENT: '2', WRAP_MAX_QUEUED: '9', WRAP_WORKER_HEAP_MB: '768' } as NodeJS.ProcessEnv);
  assert.deepEqual([e.wrapMaxConcurrent, e.wrapMaxQueued, e.wrapWorkerHeapMb], [2, 9, 768]);
});

test('housekeeping registers the server cover wrap as a server self-check, and it passes', async () => {
  const c = SELF_CHECK_CASES.find((x) => x.id === 'export.wrap-server.build');
  assert.ok(c, 'registered');
  assert.equal(c.kind, 'server');
  const detail = await c.run!({ db, config: on.config, fixtures: undefined as never });
  assert.match(detail, /in wrap, \d+ bytes of PDF/);
});
