import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { resetShelfStatusCache } from '../src/help/status.js';
import { createTestDb, startTestServer } from './helpers.js';

/* BEUK:lighthouse — the Help home's status is the Lighthouse: a three.js
   harbour where the lighthouse is the server (lit and sweeping while it
   answers, dark when it doesn't) and each part the server reports is a
   named buoy (green up, orange needs a look, red dead). The page reads
   /api/status/public itself; the server's own rows stay underneath as the
   plain reading for anyone without WebGL or scripts. */

const root = path.resolve(import.meta.dirname, '..');
const lighthouseJs = () => readFileSync(path.join(root, 'client', 'help', 'lighthouse.js'), 'utf8');

test('lighthouse: the Help home shows the Lighthouse in place of "Shelf status", with the plain reading kept underneath', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    resetShelfStatusCache();
    const html = await (await fetch(server.base + '/help/')).text();
    assert.match(html, /<p class="kicker" id="status-h">Lighthouse<\/p>/);
    assert.doesNotMatch(html, />Shelf status</);
    assert.match(html, /<div class="lh-scene" id="lighthouse" data-status-url="\/api\/status\/public"/);
    assert.match(html, /<button type="button" class="lh-meteor" id="lh-meteor"[^>]*>Send a shooting star<\/button>/);
    assert.match(html, /id="status-line">/, 'the headline the server read stays, for no-script readers');
    assert.match(html, /<ul class="status-rows">/);
    // three.js is Beuk's own vendored copy, pinned by its hash; the scene is a hashed Help asset
    assert.match(html, /<script src="\/assets\/vendor\/three\.r128\.min\.js" integrity="sha512-[A-Za-z0-9+/=]+" crossorigin="anonymous" defer><\/script>/);
    const js = /<script src="(\/help\/static\/lighthouse\.[0-9a-f]{12}\.js)" defer><\/script>/.exec(html);
    assert.ok(js, 'the Lighthouse script is served from a content-hashed path');
    const res = await fetch(server.base + js![1]);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);
    assert.match(res.headers.get('cache-control') ?? '', /immutable/);
    // only the home page carries the scene
    const guide = await (await fetch(server.base + '/help/check-your-book')).text();
    assert.doesNotMatch(guide, /lighthouse\./);
  } finally {
    await server.close();
  }
});

test('lighthouse: the scene reads the live status, maps it to three colours, and is kind to the machine', () => {
  const src = lighthouseJs();
  assert.match(src, /POLL_MS = 30000/, 'asks the server every 30 seconds');
  assert.match(src, /ok: 'up', attention: 'needs a look', off: 'needs a look', down: 'dead'/, 'not set up is not dead: only down is red');
  assert.match(src, /prefers-reduced-motion/, 'a still scene for people who turn motion off');
  assert.match(src, /visibilitychange/, 'no drawing or polling while the tab is hidden');
  assert.match(src, /IntersectionObserver/, 'no drawing while the scene is scrolled away');
  assert.match(src, /if \(!window\.THREE\)/, 'without three.js the plain reading stands');
  assert.doesNotMatch(src, /https?:\/\//, 'nothing loads from another origin');
  assert.match(src, /function placeTags\(\)/, 'buoy names give way to each other instead of overlapping');
  assert.match(src, /never cut off at the frame's edge/, 'a name near the edge stays inside the scene');
});
