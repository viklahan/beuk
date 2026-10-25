import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

let server: TestServer;
let alice: Client;
let bob: Client;

const sampleDoc = {
  title: 'The Lantern Coast',
  author: 'A. Writer',
  settings: { bodyFont: 'EB Garamond', fontSizePx: 19, lineHeight: 1.6 },
  sections: {
    frontMatter: [{ kind: 'title-page', text: 'The Lantern Coast' }],
    body: [{ kind: 'chapter', title: 'One', text: 'It began with the tide.' }],
    backMatter: [{ kind: 'about-author', text: 'A. Writer lives by the sea.' }],
  },
};

before(async () => {
  const db: Db = await createTestDb();
  server = await startTestServer(db);
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
  await registerUser(bob, 'bob@example.com');
});

after(async () => {
  await server.close();
});

test('manuscript CRUD happy path for the owner', async () => {
  const created = await alice.post('/api/manuscripts', { doc: sampleDoc });
  assert.equal(created.status, 201);
  const manuscript = created.body.manuscript as { id: string; title: string; doc: typeof sampleDoc };
  assert.equal(manuscript.title, 'The Lantern Coast'); // title lifted from doc
  assert.deepEqual(manuscript.doc, sampleDoc);

  const list = await alice.get('/api/manuscripts');
  assert.equal(list.status, 200);
  const items = list.body.manuscripts as Array<{ id: string; title: string }>;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, manuscript.id);
  // List returns metadata only, not the document.
  assert.equal((items[0] as Record<string, unknown>).doc, undefined);

  const fetched = await alice.get(`/api/manuscripts/${manuscript.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual((fetched.body.manuscript as { doc: unknown }).doc, sampleDoc);

  const updatedDoc = { ...sampleDoc, title: 'The Lantern Coast (Revised)' };
  const updated = await alice.put(`/api/manuscripts/${manuscript.id}`, { doc: updatedDoc, revision: 1 });
  assert.equal(updated.status, 200);
  assert.equal((updated.body.manuscript as { title: string }).title, 'The Lantern Coast');
  assert.equal((updated.body.manuscript as { revision: number }).revision, 2);

  const renamed = await alice.put(
    `/api/manuscripts/${manuscript.id}`,
    { title: 'Salt & Tide' },
    { 'if-match': '"2"' },
  );
  assert.equal(renamed.status, 200);
  assert.equal((renamed.body.manuscript as { title: string }).title, 'Salt & Tide');
  assert.equal(renamed.headers.get('etag'), '"3"');

  const removed = await alice.delete(`/api/manuscripts/${manuscript.id}`);
  assert.equal(removed.status, 204);
  const gone = await alice.get(`/api/manuscripts/${manuscript.id}`);
  assert.equal(gone.status, 404);
});

test("owner isolation: user B cannot read, update, delete, or even see user A's manuscript", async () => {
  const created = await alice.post('/api/manuscripts', { doc: sampleDoc });
  const id = (created.body.manuscript as { id: string }).id;

  const bobList = await bob.get('/api/manuscripts');
  assert.deepEqual(bobList.body.manuscripts, []);

  const bobRead = await bob.get(`/api/manuscripts/${id}`);
  assert.equal(bobRead.status, 404);

  const bobUpdate = await bob.put(`/api/manuscripts/${id}`, { doc: { title: 'Hijacked' } });
  assert.equal(bobUpdate.status, 404);
  // Naming the right revision does not help: still 404, nothing leaked.
  const bobUpdateRev = await bob.put(`/api/manuscripts/${id}`, { doc: { title: 'Hijacked' }, revision: 1 });
  assert.equal(bobUpdateRev.status, 404);
  assert.equal(bobUpdateRev.body.manuscript, undefined);

  const bobDelete = await bob.delete(`/api/manuscripts/${id}`);
  assert.equal(bobDelete.status, 404);

  // Alice's copy is untouched.
  const stillThere = await alice.get(`/api/manuscripts/${id}`);
  assert.equal(stillThere.status, 200);
  assert.deepEqual((stillThere.body.manuscript as { doc: unknown }).doc, sampleDoc);
});

test('manuscript endpoints require auth and a valid doc', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.get('/api/manuscripts')).status, 401);
  assert.equal((await anon.post('/api/manuscripts', { doc: sampleDoc })).status, 401);

  const badDoc = await alice.post('/api/manuscripts', { doc: 'not an object' });
  assert.equal(badDoc.status, 400);
  const arrayDoc = await alice.post('/api/manuscripts', { doc: [1, 2, 3] });
  assert.equal(arrayDoc.status, 400);
});

test('optimistic concurrency: revision starts at 1, each write bumps it, GET/POST/PUT carry it as ETag', async () => {
  const created = await alice.post('/api/manuscripts', { doc: sampleDoc });
  assert.equal(created.status, 201);
  const m = created.body.manuscript as { id: string; revision: number };
  assert.equal(m.revision, 1);
  assert.equal(created.headers.get('etag'), '"1"');

  const got = await alice.get(`/api/manuscripts/${m.id}`);
  assert.equal(got.headers.get('etag'), '"1"');
  const list = await alice.get('/api/manuscripts');
  const row = (list.body.manuscripts as Array<{ id: string; revision: number }>).find((x) => x.id === m.id);
  assert.equal(row?.revision, 1);

  const weak = await alice.put(`/api/manuscripts/${m.id}`, { doc: sampleDoc }, { 'if-match': 'W/"1"' });
  assert.equal(weak.status, 200);
  assert.equal((weak.body.manuscript as { revision: number }).revision, 2);
});

test('optimistic concurrency: a stale revision gets 409 with the current shelf copy, and nothing is overwritten', async () => {
  const created = await alice.post('/api/manuscripts', { doc: sampleDoc });
  const id = (created.body.manuscript as { id: string }).id;

  // Device A saves on top of revision 1 → revision 2.
  const deviceADoc = { ...sampleDoc, title: 'Written on device A' };
  const a = await alice.put(`/api/manuscripts/${id}`, { doc: deviceADoc }, { 'if-match': '"1"' });
  assert.equal(a.status, 200);
  assert.equal((a.body.manuscript as { revision: number }).revision, 2);

  // Device B still believes the shelf is at revision 1.
  const deviceBDoc = { ...sampleDoc, title: 'Written on device B' };
  const b = await alice.put(`/api/manuscripts/${id}`, { doc: deviceBDoc }, { 'if-match': '"1"' });
  assert.equal(b.status, 409);
  const shelf = b.body.manuscript as { id: string; revision: number; doc: typeof sampleDoc; updatedAt: string };
  assert.equal(shelf.id, id);
  assert.equal(shelf.revision, 2);
  assert.deepEqual(shelf.doc, deviceADoc);
  assert.ok(shelf.updatedAt);
  assert.equal(b.headers.get('etag'), '"2"');

  // Same refusal when the stale base comes in the body.
  const bBody = await alice.put(`/api/manuscripts/${id}`, { doc: deviceBDoc, revision: 1 });
  assert.equal(bBody.status, 409);

  // Device A's writing is untouched.
  const after = await alice.get(`/api/manuscripts/${id}`);
  assert.deepEqual((after.body.manuscript as { doc: unknown }).doc, deviceADoc);
  assert.equal((after.body.manuscript as { revision: number }).revision, 2);

  // Device B resolves "Keep mine": it now names revision 2 and lands.
  const keepMine = await alice.put(`/api/manuscripts/${id}`, { doc: deviceBDoc }, { 'if-match': '"2"' });
  assert.equal(keepMine.status, 200);
  assert.equal((keepMine.body.manuscript as { revision: number }).revision, 3);
  assert.deepEqual((keepMine.body.manuscript as { doc: unknown }).doc, deviceBDoc);
});

test('optimistic concurrency: a PUT without a revision is refused (428) with the shelf copy; a malformed one is 400', async () => {
  const created = await alice.post('/api/manuscripts', { doc: sampleDoc });
  const id = (created.body.manuscript as { id: string }).id;

  const blind = await alice.put(`/api/manuscripts/${id}`, { doc: { ...sampleDoc, title: 'Blind overwrite' } });
  assert.equal(blind.status, 428);
  assert.deepEqual((blind.body.manuscript as { doc: unknown }).doc, sampleDoc);

  const bad = await alice.put(`/api/manuscripts/${id}`, { doc: sampleDoc }, { 'if-match': 'banana' });
  assert.equal(bad.status, 400);
  const badBody = await alice.put(`/api/manuscripts/${id}`, { doc: sampleDoc, revision: 'one' });
  assert.equal(badBody.status, 400);

  const still = await alice.get(`/api/manuscripts/${id}`);
  assert.deepEqual((still.body.manuscript as { doc: unknown }).doc, sampleDoc);
  assert.equal((still.body.manuscript as { revision: number }).revision, 1);

  // 404 still wins for a manuscript that does not exist.
  const missing = await alice.put('/api/manuscripts/00000000-0000-0000-0000-000000000000', { doc: sampleDoc, revision: 1 });
  assert.equal(missing.status, 404);
});
