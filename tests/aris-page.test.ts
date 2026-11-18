import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTestDb, startTestServer } from './helpers.js';

const ON = { arisEnabled: true, arisKeySecret: 'test-secret' };

async function get(base: string, p: string) {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
}

test('/aris renders the persona page when enabled', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, ON);
  try {
    const page = await get(server.base, '/aris');
    assert.equal(page.status, 200);
    assert.match(page.type, /html/);
    assert.match(page.text, /ἄριστος/);
    assert.match(page.text, /data-aris-controls/);
    assert.match(page.text, /data-aris-signed-out/);
    assert.match(page.text, /href="\/account"/);
    assert.match(page.text, /<script src="\/aris\/aris\.js"/);
    const js = await get(server.base, '/aris/aris.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.match(js.text, /\/api\/aris\/status/);
    assert.match(js.text, /status === 404\) return GONE/);
  } finally {
    await server.close();
  }
});

test('/aris is 404 when the feature is off', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    assert.equal((await get(server.base, '/aris')).status, 404);
    assert.equal((await get(server.base, '/aris/aris.js')).status, 404);
    assert.equal((await get(server.base, '/aris/aris.css')).status, 404);
  } finally {
    await server.close();
  }
});

test('the sitemap, service workers and Caddyfile carry /aris', async () => {
  const db = await createTestDb();
  const off = await startTestServer(db);
  const on = await startTestServer(db, undefined, ON);
  try {
    // Listed only when the page exists (the /support pattern): never a 404 in the sitemap.
    assert.match((await get(on.base, '/sitemap.xml')).text, /\/aris</);
    assert.doesNotMatch((await get(off.base, '/sitemap.xml')).text, /\/aris</);
  } finally {
    await on.close();
    await off.close();
  }
  for (const sw of ['client/sw.js', 'client/assets/sw.js']) assert.match(readFileSync(sw, 'utf8'), /\|aris\)/, sw);
  assert.match(readFileSync('Caddyfile', 'utf8'), /@aris path \/aris \/aris\/\*\s+handle @aris \{\s*reverse_proxy app:3000/);
});
