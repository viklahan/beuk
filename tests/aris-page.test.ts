import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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

test('/aris carries the journey: the Calling hero, six cards, the altar', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, ON);
  try {
    const page = await get(server.base, '/aris');
    assert.equal(page.status, 200);
    // the hero: the Calling engine mounts on its canvas
    assert.match(page.text, /id="calling"/);
    assert.match(page.text, /<script src="\/aris\/calling\.js"/);
    // six journey cards, each opening the shared plate dialog
    for (let n = 1; n <= 6; n++) assert.match(page.text, new RegExp(`/aris/cards/${n}`));
    assert.equal((page.text.match(/class="aris-card"/g) ?? []).length, 6);
    assert.match(page.text, /<dialog class="aris-plate"/);
    assert.match(page.text, /<script src="\/aris\/journey\.js"/);
    // the copy still rides along (persona ## Page remains the single source)
    assert.match(page.text, /ἄριστος/);
    assert.match(page.text, /Never enter uninvited/);
    // the altar at the end: the key walkthrough docs sit above the controls
    assert.match(page.text, /Your key, step by step/);
    assert.match(page.text, /aistudio\.google\.com/);
    assert.match(page.text, /data-aris-controls/);
    assert.match(page.text, /data-aris-signed-out/);
    const js = await get(server.base, '/aris/calling.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.match(js.text, /data-theme/); // the engine follows the site's theme
  } finally {
    await server.close();
  }
});

test('/aris answers: threshold panels flank the hero, the FAQ stands before the altar', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, ON);
  try {
    const page = await get(server.base, '/aris');
    assert.equal(page.status, 200);
    // two threshold panels on the hero, revealed by the engine when the name settles
    assert.equal((page.text.match(/data-calling-panel/g) ?? []).length, 2);
    assert.match(page.text, /not a ghostwriter/);
    assert.match(page.text, /You decide/);
    // the same copy stacks below the hero for narrow screens
    assert.match(page.text, /aris-threshold-stack/);
    // the FAQ: nine questions a writer actually asks, as native details
    assert.match(page.text, /Asked and answered/);
    assert.equal((page.text.match(/<details class="aris-faq-item"/g) ?? []).length, 9);
    assert.match(page.text, /Will Aris write for me/);
    assert.match(page.text, /does not exist/); // the quote law, stated to the writer
    // the engine knows the panels and reveals them at the settle
    const js = await get(server.base, '/aris/calling.js');
    assert.match(js.text, /data-calling-panel/);
  } finally {
    await server.close();
  }
});

test('/aris/cards/N serves the writer-dropped image, or a placeholder until then', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, ON);
  // The writer's real art may occupy any slot. It is MOVED ASIDE, never
  // overwritten or unlinked, and always put back — a test must not eat art.
  const slot3 = 'content/aris/cards/card-3.webp';
  const slot6 = 'content/aris/cards/card-6.webp';
  const aside = (f: string) => { if (existsSync(f)) renameSync(f, `${f}.test-aside`); };
  const restore = (f: string) => { if (existsSync(`${f}.test-aside`)) renameSync(`${f}.test-aside`, f); };
  aside(slot3);
  aside(slot6);
  try {
    // an empty slot: a built-in SVG placeholder, never a broken image
    const ph = await get(server.base, '/aris/cards/3');
    assert.equal(ph.status, 200);
    assert.match(ph.type, /svg/);
    assert.match(ph.text, /<svg/);
    // a dropped file wins the slot
    writeFileSync(slot6, Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]));
    const img = await fetch(`${server.base}/aris/cards/6`);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('content-type') ?? '', /webp/);
    // only the six slots exist
    for (const bad of ['0', '7', 'x', '1.webp']) assert.equal((await get(server.base, `/aris/cards/${bad}`)).status, 404);
  } finally {
    try { unlinkSync(slot6); } catch { /* our dummy, if it was written */ }
    restore(slot3);
    restore(slot6);
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
    assert.equal((await get(server.base, '/aris/calling.js')).status, 404);
    assert.equal((await get(server.base, '/aris/journey.js')).status, 404);
    assert.equal((await get(server.base, '/aris/cards/1')).status, 404);
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
