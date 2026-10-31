import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { ACCESS_RULES } from '../src/access.js';
import { StrictDomParser } from '../src/book/epub/sandbox.js';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';
import { readZip, validateEpub } from '../src/housekeeping/packages.js';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import { PIC_REF_PREFIX } from '../src/pictures.js';
import { fixturePath } from './book-fixtures.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/* BEUK:epub-server — POST /api/epub: the store-ready EPUB, built on the
   server from the writer's book (src/routes/epub.ts, src/book/epub). */

const ON: Partial<Config> = {
  stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
  stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
  stripePriceId: 'price_fixture_one',
  stripeApiBase: 'http://127.0.0.1:9',
};
const DAY = 86_400_000;
let db: Db;
let on: TestServer; // billing on: trial / paused are real states
let small: TestServer; // billing off, an 8 MB manuscript cap and a 1 ms build cap
let seq = 0;

before(async () => {
  db = await createTestDb();
  on = await startTestServer(db, undefined, ON);
  small = await startTestServer(db, undefined, { manuscriptMaxBytes: 8 * 1024 * 1024, jobTimeoutMs: 1 });
});
after(async () => {
  await on.close();
  await small.close();
});

async function writer(base: string): Promise<{ c: Client; id: string }> {
  const email = `epub-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id;
  return { c, id };
}
const cookie = (c: Client) => (c as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();

/** POST that keeps the bytes (Client.request parses JSON). */
async function postEpub(base: string, c: Client | null, body: unknown) {
  const res = await fetch(`${base}/api/epub`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c ? cookie(c) : {}) },
    body: JSON.stringify(body),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const json = () => JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  return { status: res.status, headers: res.headers, bytes, json };
}

const realBook = (name: string) => (JSON.parse(readFileSync(fixturePath('real', name), 'utf8')) as { book: Record<string, unknown> }).book;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC';
const PNG_SHA = createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex');
const pictureBook = (data: string) => ({
  meta: { title: 'The Salt Road', author: 'A. Writer', language: 'en', bookId: 'urn:uuid:00000000-0000-4000-8000-000000000001' },
  sections: [{ id: 'ch1', type: 'chapter', kind: 'body', title: 'One', content: 'It began with the tide.', plateId: 'im1', plateAlt: 'A gull on a post' }],
  images: [{ id: 'im1', name: 'gull.png', mediaType: 'image/png', ext: 'png', data }],
  cover: null,
});
const failed = (bytes: Buffer) => validateEpub(readZip(bytes)).filter((c) => c.status !== 'pass');

test('the route is gated by export.epub (one more export route)', () => {
  assert.deepEqual(ACCESS_RULES.filter((r) => r.path === '/api/epub'), [{ method: 'POST', path: '/api/epub', feature: 'export.epub' }]);
});

test('signed out: 401, nothing built', async () => {
  const r = await postEpub(on.base, null, { book: realBook('reads-you.json') });
  assert.equal(r.status, 401);
});

test('in trial: 200, application/epub+zip with a file name, and the body passes the package checks', async () => {
  const w = await writer(on.base);
  const r = await postEpub(on.base, w.c, { book: realBook('salt-road-standalone.json'), platform: 'kdp', lang: 'en' });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  assert.equal(r.headers.get('content-type'), 'application/epub+zip');
  assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename="[^"]+-kdp\.epub"/);
  assert.deepEqual(JSON.parse(decodeURIComponent(r.headers.get('x-beuk-notes') ?? '')), []);
  assert.deepEqual(failed(r.bytes), []);
});

test('after the trial unpaid: 402 with the paused body, nothing built', async () => {
  const w = await writer(on.base);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(Date.now() - DAY)]);
  const r = await postEpub(on.base, w.c, { book: realBook('reads-you.json') });
  assert.equal(r.status, 402);
  assert.equal(r.json().feature, 'export.epub');
  assert.equal(r.json().paused, true);
});

test('the shelf copy: pictures stored as beuk-pic refs are filled back in from the writer\'s store', async () => {
  const w = await writer(on.base);
  assert.equal((await w.c.put(`/api/pictures/${PNG_SHA}`, { mediaType: 'image/png', data: PNG })).status, 201);
  const saved = await w.c.request('POST', '/api/manuscripts', { doc: pictureBook(PIC_REF_PREFIX + PNG_SHA) }, { 'beuk-pictures': 'ref' });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const mid = (saved.body.manuscript as { id: string }).id;
  const r = await postEpub(on.base, w.c, { manuscriptId: mid });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  const img = readZip(r.bytes).find((e) => e.name.startsWith('OEBPS/Images/') && !e.name.endsWith('/'));
  assert.ok(img, 'the picture is in the package');
  assert.equal(createHash('sha256').update(img.data).digest('hex'), PNG_SHA, 'the real bytes, not the ref');
  assert.deepEqual(failed(r.bytes), []);
  /* another writer cannot build it (404, existence not leaked) */
  const other = await writer(on.base);
  assert.equal((await postEpub(on.base, other.c, { manuscriptId: mid })).status, 404);
});

test('a picture the shelf no longer holds: a clear 422 naming it, never a broken EPUB', async () => {
  const w = await writer(on.base);
  const gone = 'a'.repeat(64);
  const r = await postEpub(on.base, w.c, { book: pictureBook(PIC_REF_PREFIX + gone) });
  assert.equal(r.status, 422);
  assert.deepEqual(r.json().missingPictures, [gone]);
  assert.match(String(r.json().error), /picture/);
});

test('bad requests: neither or both inputs, an unknown platform, a non-uuid id', async () => {
  const w = await writer(on.base);
  assert.equal((await postEpub(on.base, w.c, {})).status, 400);
  assert.equal((await postEpub(on.base, w.c, { book: {}, manuscriptId: 'x' })).status, 400);
  assert.equal((await postEpub(on.base, w.c, { book: realBook('reads-you.json'), platform: 'vellum' })).status, 400);
  assert.equal((await postEpub(on.base, w.c, { manuscriptId: 'not-a-uuid' })).status, 404);
});

/* ---- Review focus #4: a hostile book ---- */

test('hostile text: </script>, ]]> and <!ENTITY stay text, and the package still passes', async () => {
  const w = await writer(on.base);
  const book = realBook('reads-you.json');
  const evil = '</script><script>alert(1)</script> ]]> <!DOCTYPE x [<!ENTITY boom "BOOM">]> &boom; <![CDATA[x]]>';
  (book.sections as Record<string, unknown>[]).find((s) => s.type === 'chapter')!.content = evil;
  (book.meta as Record<string, unknown>).title = 'Title </title><!ENTITY t "T">';
  const r = await postEpub(on.base, w.c, { book });
  assert.equal(r.status, 200, r.bytes.toString('utf8').slice(0, 300));
  const entries = readZip(r.bytes);
  const ch = entries.find((e) => e.name === 'OEBPS/Text/chapter_01.xhtml')!.data.toString('utf8');
  assert.ok(ch.includes('&lt;/script&gt;'), 'escaped');
  assert.ok(!/<script/i.test(ch), 'no script element');
  assert.ok(!ch.includes('<!ENTITY') && !ch.includes('BOOM</'), 'no entity declared or expanded');
  const opf = entries.find((e) => e.name === 'OEBPS/package.opf')!.data.toString('utf8');
  assert.ok(!opf.includes('<!ENTITY'), 'title escaped in the OPF');
  assert.deepEqual(failed(r.bytes), []);
});

test('the DOMParser stand-in never expands DOCTYPE entities', () => {
  const p = new StrictDomParser();
  let text: string | null = null;
  try {
    const doc = p.parseFromString('<!DOCTYPE x [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;">]><x>&b;&b;</x>', 'application/xml') as { documentElement: { textContent: string } };
    text = doc.documentElement.textContent;
  } catch {
    text = null; /* refused outright: also fine, the studio then sees no document */
  }
  assert.ok(text === null || !text.includes('AAAA'), `not expanded (got ${JSON.stringify(text)})`);
});

test('size bound: a book over the manuscript limit (a 50 MB base64 picture) is refused before any build', async () => {
  const w = await writer(small.base);
  const big = 'A'.repeat(50 * 1024 * 1024);
  const r = await postEpub(small.base, w.c, { book: pictureBook(big) });
  assert.equal(r.status, 413);
});

test('time bound: a build past JOB_TIMEOUT_MS is stopped with a plain 503', async () => {
  const w = await writer(small.base);
  const r = await postEpub(small.base, w.c, { book: realBook('reads-you.json') });
  assert.equal(r.status, 503);
  assert.equal(r.json().reason, 'timeout');
});

test('housekeeping registers the server EPUB build as a server self-check, and it passes', async () => {
  const c = SELF_CHECK_CASES.find((x) => x.id === 'export.epub-server.build');
  assert.ok(c, 'registered');
  assert.equal(c.kind, 'server');
  const detail = await c.run!({ db, config: on.config, fixtures: undefined as never });
  assert.match(detail, /font file/);
});
