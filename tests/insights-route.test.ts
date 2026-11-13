import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

/* GET /api/manuscripts/:id/insights — Beuk's own InsightsData for one book,
   computed server-side by the lifted insComputeFor (the MCP get_insights
   tool's source). */

let db: Db;
let server: TestServer;
let alice: Client;
let bob: Client;
let bookId: string;

const doc = {
  meta: { title: 'Salt Road', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'ch1', kind: 'body', type: 'chapter', included: true, number: 'One', title: 'The Tide',
      content: '"You\'re late," said the ferryman. "I am never late," Mara said. She just stepped aboard and the long grey water carried them out past the harbour wall.' },
    { id: 'ch2', kind: 'body', type: 'chapter', included: true, number: 'Two', title: 'Salt',
      content: 'Salt. Everywhere salt. The sea keeps its own counsel, she thought, and she just kept walking up the long hill toward the light.' },
  ],
};

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db);
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
  await registerUser(bob, 'bob@example.com');
  const created = await alice.post('/api/manuscripts', { title: 'Salt Road', doc });
  assert.equal(created.status, 201);
  bookId = (created.body.manuscript as { id: string }).id;
});

after(async () => {
  await server.close();
});

test('GET :id/insights returns Beuk\'s own analytics for the writer\'s book', async () => {
  const res = await alice.get(`/api/manuscripts/${bookId}/insights`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ins = res.body.insights as {
    title: string; revision: number; lang: string;
    frequency: { total: number }; rhythm: Array<{ words: number }>;
    dialogue: { total: number; share: number }; chapters: number;
  };
  assert.equal(ins.title, 'Salt Road');
  assert.equal(ins.revision, 1);
  assert.equal(ins.lang, 'en');
  assert.ok(ins.frequency.total > 0, 'real words counted');
  assert.equal(ins.rhythm.length, 2, 'one rhythm row per body section');
  assert.equal(ins.chapters, 2);
  assert.ok(ins.dialogue.total > 0 && ins.dialogue.share > 0, 'dialogue detected');
});

test('insights is owner-scoped: another writer gets a 404, not someone else\'s numbers', async () => {
  const res = await bob.get(`/api/manuscripts/${bookId}/insights`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'manuscript not found');
});

test('insights for a missing book is a 404', async () => {
  const res = await alice.get('/api/manuscripts/00000000-0000-4000-8000-00000000dead/insights');
  assert.equal(res.status, 404);
});
