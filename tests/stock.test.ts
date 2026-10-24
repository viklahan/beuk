import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

// A placeholder fixture key for tests only — not a real Pexels key.
const API_KEY = 'pexels_test_key_fixture_not_real';

// One canned Pexels-shaped photo (invented fixture values).
const FIXTURE_BODY = {
  total_results: 1,
  page: 1,
  per_page: 24,
  photos: [
    {
      id: 424242,
      width: 6000,
      height: 4000,
      url: 'https://www.pexels.com/photo/424242/',
      photographer: 'Fixture Photographer',
      photographer_url: 'https://www.pexels.com/@fixture-photographer',
      src: {
        original: 'https://images.pexels.com/photos/424242/original.jpg',
        large: 'https://images.pexels.com/photos/424242/large.jpg',
        medium: 'https://images.pexels.com/photos/424242/medium.jpg',
        small: 'https://images.pexels.com/photos/424242/small.jpg',
      },
    },
  ],
};

let db: Db;
let plainServer: TestServer; // no Pexels key → the unconfigured path
let stockServer: TestServer; // key set, base pointed at the stub below
let stub: Server;
let stubBase = '';
let stubFails = false;
let lastUpstreamUrl = '';
let lastUpstreamAuth: string | null = null;

before(async () => {
  // A local stub standing in for the Pexels API: records what it was
  // asked (path + Authorization header) and answers the fixture body,
  // or a 500 while stubFails is set.
  stub = createServer((req, res) => {
    lastUpstreamUrl = req.url ?? '';
    lastUpstreamAuth = req.headers.authorization ?? null;
    if (stubFails) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'stub upstream failure' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(FIXTURE_BODY));
  });
  await new Promise<void>((resolve) => stub.listen(0, () => resolve()));
  const address = stub.address();
  if (!address || typeof address === 'string') throw new Error('no stub address');
  stubBase = `http://127.0.0.1:${address.port}/v1`;

  db = await createTestDb();
  plainServer = await startTestServer(db);
  stockServer = await startTestServer(db, undefined, {
    pexelsApiKey: API_KEY,
    pexelsApiBase: stubBase,
  });
});

after(async () => {
  await plainServer.close();
  await stockServer.close();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

test('stock search requires a signed-in session', async () => {
  const anonPlain = new Client(plainServer.base);
  assert.equal((await anonPlain.get('/api/stock/search?q=harbour')).status, 401);

  // Auth is checked before configuration, like the billing endpoints.
  const anonStock = new Client(stockServer.base);
  assert.equal((await anonStock.get('/api/stock/search?q=harbour')).status, 401);
});

test('with no Pexels key the search is a clean 501', async () => {
  const client = new Client(plainServer.base);
  await registerUser(client, 'nocfg-stock@example.com');

  const res = await client.get('/api/stock/search?q=harbour');
  assert.equal(res.status, 501);
  assert.match(String(res.body.error), /not configured/i);
});

test('configured search returns the normalized photo list', async () => {
  const client = new Client(stockServer.base);
  await registerUser(client, 'stock@example.com');

  stubFails = false;
  const res = await client.get('/api/stock/search?q=misty%20harbour');
  assert.equal(res.status, 200);
  assert.ok(!JSON.stringify(res.body).includes(API_KEY), 'API key leaked into the response');

  const photos = res.body.photos as Array<Record<string, unknown>>;
  assert.equal(photos.length, 1);
  const photo = photos[0];
  assert.equal(photo.id, 424242);
  assert.equal(photo.width, 6000);
  assert.equal(photo.height, 4000);
  assert.equal(photo.photographer, 'Fixture Photographer');
  assert.equal(photo.photographerUrl, 'https://www.pexels.com/@fixture-photographer');
  assert.equal(photo.pageUrl, 'https://www.pexels.com/photo/424242/');
  const src = photo.src as Record<string, unknown>;
  assert.equal(src.large, 'https://images.pexels.com/photos/424242/large.jpg');
  assert.equal(src.medium, 'https://images.pexels.com/photos/424242/medium.jpg');
  assert.equal(src.original, 'https://images.pexels.com/photos/424242/original.jpg');

  // The upstream saw the query, the default per_page, and the key as
  // the Authorization header (server-side only).
  const upstream = new URL(lastUpstreamUrl, stubBase);
  assert.equal(upstream.pathname, '/v1/search');
  assert.equal(upstream.searchParams.get('query'), 'misty harbour');
  assert.equal(upstream.searchParams.get('per_page'), '24');
  assert.equal(lastUpstreamAuth, API_KEY);
});

test('per_page is honoured and clamped to the maximum', async () => {
  const client = new Client(stockServer.base);
  await registerUser(client, 'stock-pages@example.com');

  const small = await client.get('/api/stock/search?q=forest&per_page=5');
  assert.equal(small.status, 200);
  assert.equal(new URL(lastUpstreamUrl, stubBase).searchParams.get('per_page'), '5');

  const huge = await client.get('/api/stock/search?q=forest&per_page=500');
  assert.equal(huge.status, 200);
  assert.equal(new URL(lastUpstreamUrl, stubBase).searchParams.get('per_page'), '40');
});

test('a missing search term is a plain 400', async () => {
  const client = new Client(stockServer.base);
  await registerUser(client, 'stock-noterm@example.com');

  const res = await client.get('/api/stock/search');
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /search term/i);
});

test('an upstream failure answers 502 and never leaks the key', async () => {
  const client = new Client(stockServer.base);
  await registerUser(client, 'stock-fail@example.com');

  stubFails = true;
  const res = await client.get('/api/stock/search?q=harbour');
  assert.equal(res.status, 502);
  assert.match(String(res.body.error), /unavailable/i);
  assert.ok(!JSON.stringify(res.body).includes(API_KEY), 'API key leaked into the error body');
  stubFails = false;
});
