import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

let db: Db;
let server: TestServer;
let alice: Client;
let bob: Client;
let aliceManuscriptId: string;
let bobManuscriptId: string;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function newManuscript(client: Client): Promise<string> {
  const created = await client.post('/api/manuscripts', {
    doc: { title: 'Archive Host', sections: { frontMatter: [], body: [], backMatter: [] } },
  });
  assert.equal(created.status, 201);
  return (created.body.manuscript as { id: string }).id;
}

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db);
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
  await registerUser(bob, 'bob@example.com');
  aliceManuscriptId = await newManuscript(alice);
  bobManuscriptId = await newManuscript(bob);
});

after(async () => {
  await server.close();
});

test('export archive: save → list → download round-trip with sha256 integrity', async () => {
  const bytes = Buffer.from('PK\x03\x04 fake-but-plausible epub bytes 0123456789');
  const query = `manuscriptId=${aliceManuscriptId}&format=epub&filename=the-lantern-coast-kdp.epub&preset=kdp`;
  const saved = await alice.upload(`/api/exports?${query}`, bytes);
  assert.equal(saved.status, 201);
  const meta = saved.body.export as {
    id: string;
    manuscriptId: string;
    format: string;
    preset: string;
    filename: string;
    byteSize: number;
    sha256: string;
  };
  assert.equal(meta.manuscriptId, aliceManuscriptId);
  assert.equal(meta.format, 'epub');
  assert.equal(meta.preset, 'kdp');
  assert.equal(meta.filename, 'the-lantern-coast-kdp.epub');
  assert.equal(meta.byteSize, bytes.length);
  assert.equal(meta.sha256, sha256(bytes));

  const list = await alice.get('/api/exports');
  assert.equal(list.status, 200);
  const items = list.body.exports as Array<{ id: string; sha256: string }>;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, meta.id);
  assert.equal(items[0].sha256, sha256(bytes));

  const download = await alice.download(`/api/exports/${meta.id}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/epub+zip');
  assert.match(download.headers.get('content-disposition') ?? '', /the-lantern-coast-kdp\.epub/);
  assert.deepEqual(download.bytes, bytes);
  assert.equal(sha256(download.bytes), meta.sha256);
});

test('all five formats are accepted, each with its download content type', async () => {
  const cases: Array<[string, string]> = [
    ['markdown', 'text/markdown'],
    ['html', 'text/html'],
    ['print-html', 'text/html'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ];
  for (const [format, contentType] of cases) {
    const bytes = Buffer.from(`payload for ${format}`);
    const saved = await alice.upload(
      `/api/exports?manuscriptId=${aliceManuscriptId}&format=${format}`,
      bytes,
    );
    assert.equal(saved.status, 201, `format ${format}`);
    const id = (saved.body.export as { id: string }).id;
    assert.equal((saved.body.export as { preset: unknown }).preset, null);
    const download = await alice.download(`/api/exports/${id}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-type') ?? '', new RegExp(`^${contentType.replace('/', '\\/')}`));
    assert.deepEqual(download.bytes, bytes);
    assert.equal((await alice.delete(`/api/exports/${id}`)).status, 204);
  }
});

test('cross-user isolation: list, download and delete are owner-scoped 404s', async () => {
  const bytes = Buffer.from('alice only');
  const saved = await alice.upload(
    `/api/exports?manuscriptId=${aliceManuscriptId}&format=html&filename=a.html`,
    bytes,
  );
  const id = (saved.body.export as { id: string }).id;

  assert.deepEqual((await bob.get('/api/exports')).body.exports, []);
  // Bob's list contains only his own exports (none yet), never Alice's.
  const bobList = (await bob.get('/api/exports')).body.exports as Array<{ id: string }>;
  assert.ok(!bobList.some((e) => e.id === id));

  assert.equal((await bob.download(`/api/exports/${id}/download`)).status, 404);
  assert.equal((await bob.delete(`/api/exports/${id}`)).status, 404);

  // Alice's copy is untouched, and she can delete it herself.
  assert.equal((await alice.download(`/api/exports/${id}/download`)).status, 200);
  assert.equal((await alice.delete(`/api/exports/${id}`)).status, 204);
  assert.equal((await alice.download(`/api/exports/${id}/download`)).status, 404);
});

test("manuscript-link validation: an export cannot attach to another user's manuscript", async () => {
  const bytes = Buffer.from('x');
  const foreign = await alice.upload(
    `/api/exports?manuscriptId=${bobManuscriptId}&format=epub`,
    bytes,
  );
  assert.equal(foreign.status, 404);

  const ghost = await alice.upload(
    `/api/exports?manuscriptId=00000000-0000-0000-0000-000000000000&format=epub`,
    bytes,
  );
  assert.equal(ghost.status, 404);

  const missing = await alice.upload(`/api/exports?format=epub`, bytes);
  assert.equal(missing.status, 400);

  const badFormat = await alice.upload(
    `/api/exports?manuscriptId=${aliceManuscriptId}&format=mobi`,
    bytes,
  );
  assert.equal(badFormat.status, 400);

  const empty = await alice.upload(
    `/api/exports?manuscriptId=${aliceManuscriptId}&format=epub`,
    Buffer.alloc(0),
  );
  assert.equal(empty.status, 400);
});

test('export endpoints require auth', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.get('/api/exports')).status, 401);
  assert.equal(
    (await anon.upload(`/api/exports?manuscriptId=${aliceManuscriptId}&format=epub`, Buffer.from('x')))
      .status,
    401,
  );
  assert.equal((await anon.download('/api/exports/whatever/download')).status, 401);
  assert.equal((await anon.delete('/api/exports/whatever')).status, 401);
});

test('upload cap: an export over the limit is a clean 413', async () => {
  const capped = await startTestServer(db, undefined, { exportMaxBytes: 1024 });
  try {
    const carol = new Client(capped.base);
    await registerUser(carol, 'carol@example.com');
    const manuscriptId = await newManuscript(carol);
    const tooBig = await carol.upload(
      `/api/exports?manuscriptId=${manuscriptId}&format=epub`,
      Buffer.alloc(2048, 7),
    );
    assert.equal(tooBig.status, 413);
    assert.match(String(tooBig.body.error), /too large/i);
    // Under the cap still works on the same server.
    const fine = await carol.upload(
      `/api/exports?manuscriptId=${manuscriptId}&format=epub`,
      Buffer.alloc(512, 7),
    );
    assert.equal(fine.status, 201);
  } finally {
    await capped.close();
  }
});
