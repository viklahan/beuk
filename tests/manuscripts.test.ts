import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

let server: TestServer;
let alice: Client;
let bob: Client;

const sampleDoc = {
  title: 'The Salt Meridian',
  author: 'A. Writer',
  settings: { bodyFont: 'EB Garamond', fontSizePx: 19, lineHeight: 1.6 },
  sections: {
    frontMatter: [{ kind: 'title-page', text: 'The Salt Meridian' }],
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
  assert.equal(manuscript.title, 'The Salt Meridian'); // title lifted from doc
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

  const updatedDoc = { ...sampleDoc, title: 'The Salt Meridian (Revised)' };
  const updated = await alice.put(`/api/manuscripts/${manuscript.id}`, { doc: updatedDoc });
  assert.equal(updated.status, 200);
  assert.equal((updated.body.manuscript as { title: string }).title, 'The Salt Meridian');

  const renamed = await alice.put(`/api/manuscripts/${manuscript.id}`, { title: 'Salt & Tide' });
  assert.equal(renamed.status, 200);
  assert.equal((renamed.body.manuscript as { title: string }).title, 'Salt & Tide');

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
