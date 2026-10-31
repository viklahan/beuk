import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createTestDb, startTestServer } from './helpers.js';

/* BEUK:caife — the thank-you on /support: a paper note drifts down over a
   real dawn sea, folds into a boat and sails toward the sun, past a
   headland lighthouse, a ship in the haze and a few gulls. The plate is
   printed onto the page with the paper's grain showing through. */

const root = path.resolve(import.meta.dirname, '..');
const boatJs = () => readFileSync(path.join(root, 'client', 'assets', 'caife', 'boat.js'), 'utf8');

test('caife: /support loads the vendored three.js and the boat, and mounts it with the page palette', async () => {
  const db = await createTestDb();
  // /support is only served when a Ko-fi page is configured
  const server = await startTestServer(db, undefined, { kofiUrl: 'https://ko-fi.com/testmaker' });
  try {
    const html = await (await fetch(server.base + '/support')).text();
    assert.match(html, /<script src="\/assets\/vendor\/three\.r128\.min\.js" integrity="sha512-[A-Za-z0-9+/=]+" crossorigin="anonymous"><\/script>/);
    assert.match(html, /<script src="\/assets\/caife\/boat\.js"><\/script>/);
    assert.match(html, /window\.BeukCaife\.mount\(document\.getElementById\('caife-sea'\)/);
  } finally {
    await server.close();
  }
});

test('caife: the boat keeps the page contract (BeukCaife.mount, play, sailed, onWords, palette, reduced motion)', () => {
  const js = boatJs();
  assert.match(js, /window\.BeukCaife = \{ mount: mount \};/);
  assert.doesNotMatch(js, /BeukCaife2/, 'no mockup name left behind');
  assert.match(js, /play: function \(\)/);
  assert.match(js, /sailed: function \(\)/);
  assert.match(js, /opts\.onWords\(\)/);
  assert.match(js, /opts\.palette/);
  assert.match(js, /var reduce = !!opts\.reduce;/);
  assert.match(js, /if \(!window\.THREE\) return null;/, 'no three.js: the painted fallback stays');
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /visibilitychange/);
  assert.doesNotMatch(js, /https?:\/\//, 'nothing loads from another origin');
});

test('caife: the realistic plate — dawn sky, headland lighthouse, a ship, gulls — wears the printed grain by default', () => {
  const js = boatJs();
  assert.match(js, /function ambient\(g\)/, 'the scenery moves: lighthouse flash, ship, gulls');
  assert.match(js, /uGrain: \{ value: 0\.05 \}, uSkip: \{ value: 0\.16 \}/, 'printed grain is on from the first frame');
  assert.match(js, /THREE\.HalfFloatType/, 'the scene is lit in linear HDR before it is printed');
});
