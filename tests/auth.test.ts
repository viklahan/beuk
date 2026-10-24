import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

let db: Db;
let server: TestServer;

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db);
});

after(async () => {
  await server.close();
});

test('health endpoint reports ok', async () => {
  const client = new Client(server.base);
  const res = await client.get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, db: 'up' });
});

test('register → me → logout → me is 401', async () => {
  const client = new Client(server.base);

  const meBefore = await client.get('/api/auth/me');
  assert.equal(meBefore.status, 401);

  const registered = await registerUser(client, 'ada@example.com');
  assert.equal(registered.status, 201);
  const user = registered.body.user as { id: string; email: string };
  assert.equal(user.email, 'ada@example.com');
  assert.ok(user.id);

  // Session cookie must be http-only.
  const setCookie = registered.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /beuk_session=/);
  assert.match(setCookie, /HttpOnly/i);

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.user, { id: user.id, email: 'ada@example.com' });

  const logout = await client.post('/api/auth/logout');
  assert.equal(logout.status, 204);

  const meAfter = await client.get('/api/auth/me');
  assert.equal(meAfter.status, 401);
});

test('duplicate registration is rejected; login works with the right password only', async () => {
  const client = new Client(server.base);
  await registerUser(client, 'grace@example.com');
  await client.post('/api/auth/logout');

  const dup = await registerUser(new Client(server.base), 'grace@example.com');
  assert.equal(dup.status, 409);

  const wrong = await client.post('/api/auth/login', {
    email: 'grace@example.com',
    password: 'wrong password entirely',
  });
  assert.equal(wrong.status, 401);

  const unknown = await client.post('/api/auth/login', {
    email: 'nobody@example.com',
    password: 'correct horse battery',
  });
  assert.equal(unknown.status, 401);

  const ok = await client.post('/api/auth/login', {
    email: 'grace@example.com',
    password: 'correct horse battery',
  });
  assert.equal(ok.status, 200);
  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((me.body.user as { email: string }).email, 'grace@example.com');
});

test('registration validates email and password length', async () => {
  const client = new Client(server.base);
  const badEmail = await client.post('/api/auth/register', { email: 'not-an-email', password: 'long enough password' });
  assert.equal(badEmail.status, 400);
  const shortPw = await client.post('/api/auth/register', { email: 'ok@example.com', password: 'short' });
  assert.equal(shortPw.status, 400);
});
