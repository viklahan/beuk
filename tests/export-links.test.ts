import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

/* Phase 3: signed export-download links (PHASE3.md item 3). A link a
   Claude client hands the writer must open in a bare browser — no
   session cookie, no OAuth bearer — so the download route gets a
   short-lived HMAC-signed variant. The secret is EXPORT_URL_SECRET;
   unset, minting answers 501 "not configured" and nothing pretends to
   work (the billing/stock pattern). */

let db: Db;
let server: TestServer;
let bare: Client; // never registered: no cookies, like a pasted link in a fresh browser
let alice: Client;
let bob: Client;
let exportId: string;
const bytes = Buffer.from('PK\x03\x04 signed-link test epub bytes');
let clock: Date;

before(async () => {
  db = await createTestDb();
  clock = new Date('2026-11-13T12:00:00Z');
  server = await startTestServer(db, () => clock, {
    exportUrlSecret: 'test-export-url-secret',
  });
  alice = new Client(server.base);
  bob = new Client(server.base);
  bare = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
  await registerUser(bob, 'bob@example.com');
  const created = await alice.post('/api/manuscripts', {
    doc: { title: 'Signed Links', sections: { frontMatter: [], body: [], backMatter: [] } },
  });
  assert.equal(created.status, 201);
  const manuscriptId = (created.body.manuscript as { id: string }).id;
  const saved = await alice.upload(
    `/api/exports?manuscriptId=${manuscriptId}&format=epub&filename=signed.epub&preset=kdp`,
    bytes,
  );
  assert.equal(saved.status, 201);
  exportId = (saved.body.export as { id: string }).id;
});

after(async () => {
  await server.close();
});

/** The path+query of a minted absolute url, fetchable against the test server. */
function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

test('mint + bare fetch round-trip: the signed link downloads the bytes with no session', async () => {
  const minted = await alice.post(`/api/exports/${exportId}/link`, {});
  assert.equal(minted.status, 200);
  const link = minted.body.link as { url: string; expiresAt: string };
  assert.ok(link.url.includes(`/api/exports/${exportId}/file?`));
  assert.ok(new Date(link.expiresAt).getTime() > clock.getTime());

  const got = await bare.download(pathOf(link.url));
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-disposition'), 'attachment; filename="signed.epub"');
  assert.deepEqual(got.bytes, bytes);
});

test('minting is owner-only: bob cannot mint a link for alice export', async () => {
  const minted = await bob.post(`/api/exports/${exportId}/link`, {});
  assert.equal(minted.status, 404);
});

test('a forged signature is a plain 404, indistinguishable from a missing export', async () => {
  const minted = await alice.post(`/api/exports/${exportId}/link`, {});
  const url = new URL((minted.body.link as { url: string }).url);
  url.searchParams.set('sig', 'f'.repeat(64));
  const got = await bare.download(url.pathname + url.search);
  assert.equal(got.status, 404);
});

test('tampering the expiry invalidates the signature', async () => {
  const minted = await alice.post(`/api/exports/${exportId}/link`, {});
  const url = new URL((minted.body.link as { url: string }).url);
  url.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 3600));
  const got = await bare.download(url.pathname + url.search);
  assert.equal(got.status, 404);
});

test('an expired link answers 410 with the reason, never the file', async () => {
  const minted = await alice.post(`/api/exports/${exportId}/link`, { ttlSeconds: 60 });
  const link = minted.body.link as { url: string };
  clock = new Date(clock.getTime() + 61_000);
  try {
    const got = await bare.get(pathOf(link.url));
    assert.equal(got.status, 410);
    assert.equal(got.body.error, 'link expired');
  } finally {
    clock = new Date('2026-11-13T12:00:00Z');
  }
});

test('ttlSeconds is capped and validated', async () => {
  const bad = await alice.post(`/api/exports/${exportId}/link`, { ttlSeconds: 0 });
  assert.equal(bad.status, 400);
  const tooLong = await alice.post(`/api/exports/${exportId}/link`, { ttlSeconds: 999_999 });
  assert.equal(tooLong.status, 400);
});

test('without EXPORT_URL_SECRET minting answers 501 not configured, and the file route serves nothing', async () => {
  const plain = await startTestServer(db, () => clock, { exportUrlSecret: null });
  try {
    const a2 = new Client(plain.base);
    await registerUser(a2, 'carol@example.com');
    const created = await a2.post('/api/manuscripts', {
      doc: { title: 'No Secret', sections: { frontMatter: [], body: [], backMatter: [] } },
    });
    const mid = (created.body.manuscript as { id: string }).id;
    const saved = await a2.upload(`/api/exports?manuscriptId=${mid}&format=epub&filename=x.epub&preset=kdp`, bytes);
    const eid = (saved.body.export as { id: string }).id;
    const minted = await a2.post(`/api/exports/${eid}/link`, {});
    assert.equal(minted.status, 501);
    assert.equal(minted.body.error, 'signed links not configured');
    const got = await new Client(plain.base).get(`/api/exports/${eid}/file?exp=9999999999&sig=${'a'.repeat(64)}`);
    assert.equal(got.status, 501);
  } finally {
    await plain.close();
  }
});
