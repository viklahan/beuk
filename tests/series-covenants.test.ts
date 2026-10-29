import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import { seriesKey } from '../src/routes/series-covenants.js';
import type { Db } from '../src/db.js';

let server: TestServer;
let alice: Client;
let bob: Client;

const doc = (note: string) => ({ entries: [{ id: 'c1', kind: 'character', name: 'Mara', note }] });

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

test('create then read', async () => {
  const created = await alice.put('/api/series-covenants/lantern%20coast', { name: 'Lantern Coast', doc: doc('first') });
  assert.equal(created.status, 201);
  const s = created.body.series as { key: string; name: string; revision: number; doc: unknown };
  assert.equal(s.key, 'lantern coast');
  assert.equal(s.revision, 1);
  assert.equal(created.headers.get('etag'), '"1"');

  const got = await alice.get('/api/series-covenants/lantern%20coast');
  assert.equal(got.status, 200);
  assert.deepEqual((got.body.series as { doc: unknown }).doc, doc('first'));
  assert.equal((got.body.series as { name: string }).name, 'Lantern Coast');

  const list = await alice.get('/api/series-covenants');
  assert.equal(list.status, 200);
  const items = list.body.series as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'lantern coast');
  assert.equal(items[0].doc, undefined, 'the list names series, it does not carry their docs');

  const upd = await alice.put('/api/series-covenants/lantern%20coast', { name: 'Lantern Coast', doc: doc('second'), revision: 1 });
  assert.equal(upd.status, 200);
  assert.equal((upd.body.series as { revision: number }).revision, 2);
  assert.equal(upd.headers.get('etag'), '"2"');

  assert.equal((await alice.delete('/api/series-covenants/lantern%20coast')).status, 204);
  assert.equal((await alice.get('/api/series-covenants/lantern%20coast')).status, 404);
  assert.equal((await alice.delete('/api/series-covenants/lantern%20coast')).status, 404);
});

test('seriesKey collapses case and spaces', async () => {
  assert.equal(seriesKey('  Salt \t Road\n'), 'salt road');
  assert.equal(seriesKey('salt road'), 'salt road');
  assert.equal(seriesKey('   '), '');

  const a = await alice.put('/api/series-covenants/salt%20road', { name: 'Salt  Road', doc: doc('a') });
  assert.equal(a.status, 201);
  // The same series typed another way is the same row: it needs the base.
  const b = await alice.put('/api/series-covenants/salt%20road', { name: 'salt road', doc: doc('b') });
  assert.equal(b.status, 428);
  const c = await alice.put('/api/series-covenants/salt%20road', { name: 'SALT ROAD', doc: doc('c'), revision: 1 });
  assert.equal(c.status, 200);
  const list = await alice.get('/api/series-covenants');
  assert.equal((list.body.series as unknown[]).filter((x) => (x as { key: string }).key === 'salt road').length, 1);

  // A path key that is not the name's key is refused, not stored under two rows.
  const mismatch = await alice.put('/api/series-covenants/other', { name: 'Salt Road', doc: doc('x'), revision: 2 });
  assert.equal(mismatch.status, 400);
  const blank = await alice.put('/api/series-covenants/%20', { name: '   ', doc: doc('x') });
  assert.equal(blank.status, 400);
});

test('stale revision gets 409 with current copy', async () => {
  await alice.put('/api/series-covenants/stale%20one', { name: 'Stale One', doc: doc('v1') });
  assert.equal((await alice.put('/api/series-covenants/stale%20one', { name: 'Stale One', doc: doc('v2'), revision: 1 })).status, 200);
  const stale = await alice.put('/api/series-covenants/stale%20one', { name: 'Stale One', doc: doc('mine'), revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'BEUK-C802');
  const cur = stale.body.series as { revision: number; doc: unknown };
  assert.equal(cur.revision, 2);
  assert.deepEqual(cur.doc, doc('v2'));
  // Nothing was written by the stale save.
  const got = await alice.get('/api/series-covenants/stale%20one');
  assert.deepEqual((got.body.series as { doc: unknown }).doc, doc('v2'));
  // If-Match works the same as body.revision.
  const viaHeader = await alice.put('/api/series-covenants/stale%20one', { name: 'Stale One', doc: doc('v3') }, { 'if-match': '"2"' });
  assert.equal(viaHeader.status, 200);
});

test('missing revision on existing gets 428', async () => {
  await alice.put('/api/series-covenants/needs%20base', { name: 'Needs Base', doc: doc('v1') });
  const r = await alice.put('/api/series-covenants/needs%20base', { name: 'Needs Base', doc: doc('v2') });
  assert.equal(r.status, 428);
  assert.equal((r.body.series as { revision: number }).revision, 1);
  const got = await alice.get('/api/series-covenants/needs%20base');
  assert.deepEqual((got.body.series as { doc: unknown }).doc, doc('v1'));
  const bad = await alice.put('/api/series-covenants/needs%20base', { name: 'Needs Base', doc: doc('v2'), revision: 'x' });
  assert.equal(bad.status, 400);
});

test('bob cannot read or write alice\'s series (404)', async () => {
  await alice.put('/api/series-covenants/private%20saga', { name: 'Private Saga', doc: doc('secret') });
  assert.equal((await bob.get('/api/series-covenants/private%20saga')).status, 404);
  assert.equal((await bob.put('/api/series-covenants/private%20saga', { name: 'Private Saga', doc: doc('x'), revision: 1 })).status, 404);
  assert.equal((await bob.delete('/api/series-covenants/private%20saga')).status, 404);
  const list = await bob.get('/api/series-covenants');
  assert.deepEqual(list.body.series, []);
  // Bob may start his own series of the same name; it is his row.
  const own = await bob.put('/api/series-covenants/private%20saga', { name: 'Private Saga', doc: doc('bob') });
  assert.equal(own.status, 201);
  assert.deepEqual(((await alice.get('/api/series-covenants/private%20saga')).body.series as { doc: unknown }).doc, doc('secret'));
});

test('signed out gets 401', async () => {
  const anon = new Client(server.base);
  assert.equal((await anon.get('/api/series-covenants')).status, 401);
  assert.equal((await anon.get('/api/series-covenants/x')).status, 401);
  assert.equal((await anon.put('/api/series-covenants/x', { name: 'x', doc: {} })).status, 401);
  assert.equal((await anon.delete('/api/series-covenants/x')).status, 401);
});

test('invalid JSON body gets 400', async () => {
  // The global JSON parser answers before auth, so this needs no session.
  const raw = await fetch(`${server.base}/api/series-covenants/bad%20json`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{"name": ',
  });
  assert.equal(raw.status, 400);
  assert.deepEqual(await raw.json(), { error: 'the request body is not valid JSON' });
  const arrayDoc = await alice.put('/api/series-covenants/bad%20json', { name: 'Bad Json', doc: [] });
  assert.equal(arrayDoc.status, 400);
  const noDoc = await alice.put('/api/series-covenants/bad%20json', { name: 'Bad Json' });
  assert.equal(noDoc.status, 400);
  const noName = await alice.put('/api/series-covenants/bad%20json', { doc: {} });
  assert.equal(noName.status, 400);
  const longName = await alice.put('/api/series-covenants/x', { name: 'x'.repeat(121), doc: {} });
  assert.equal(longName.status, 400);
});
