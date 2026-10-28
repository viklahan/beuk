import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestDb, startTestServer, type TestServer } from './helpers.js';

// A request whose body is not JSON is the client's mistake: it answers 400
// with a reason, never 500 "internal error" with a parser stack in the log
// (the launch checklist carried this as known and accepted until now).
let server: TestServer;

before(async () => {
  server = await startTestServer(await createTestDb());
});

after(async () => {
  await server.close();
});

const send = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(server.base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

test('broken JSON to the login route answers 400 with a reason', async () => {
  const res = await send('/api/auth/login', '{"email": "a@example.com", "password": ');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'the request body is not valid JSON' });
});

test('broken JSON to any JSON route answers 400, not 500', async () => {
  for (const path of ['/api/auth/register', '/api/manuscripts']) {
    const res = await send(path, 'not json at all');
    assert.equal(res.status, 400, path);
  }
});

test('a body in an unsupported charset answers 415', async () => {
  const res = await send('/api/auth/login', '{}', { 'content-type': 'application/json; charset=klingon' });
  assert.equal(res.status, 415);
});

test('valid JSON still reaches the route', async () => {
  const res = await send('/api/auth/login', JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password-123' }));
  assert.notEqual(res.status, 400);
  assert.notEqual(res.status, 500);
});
