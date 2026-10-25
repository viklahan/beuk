import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

// A book over the shelf's size limit must be refused as 413 with a reason
// the studio can show, never a bare 500 (which the studio used to read as
// "saved on this device" with no word about the shelf).
let server: TestServer;
let alice: Client;

before(async () => {
  server = await startTestServer(await createTestDb(), undefined, { manuscriptMaxBytes: 64 * 1024 });
  alice = new Client(server.base);
  await registerUser(alice, 'alice@example.com');
});

after(async () => {
  await server.close();
});

test('an over-limit book is refused as 413 with the limit', async () => {
  const big = { title: 'Heavy', sections: { body: [{ kind: 'chapter', text: 'x'.repeat(100 * 1024) }] } };
  const res = await alice.post('/api/manuscripts', { doc: big });
  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'book is too large for the shelf');
  assert.equal(res.body.limitBytes, 64 * 1024);
});

test('a book under the limit still saves', async () => {
  const small = { title: 'Light', sections: { body: [{ kind: 'chapter', text: 'x'.repeat(1024) }] } };
  const res = await alice.post('/api/manuscripts', { doc: small });
  assert.equal(res.status, 201);
});
