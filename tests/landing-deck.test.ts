import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// BEUK:deck — the landing page as a tour: one scene per click on a wide
// window, one long page everywhere else. Never moves on by itself.
const root = path.resolve(import.meta.dirname, '..');
const html = readFileSync(path.join(root, 'client', 'site', 'index.html'), 'utf8');
const scenes = [...html.matchAll(/<section class="scene[^"]*" id="([a-z0-9-]+)"(?: data-alias="([a-z]+)")? data-name="([^"]+)"/g)].map((m) => ({
  id: m[1],
  alias: m[2],
  name: m[3],
}));

test('the tour has twelve scenes, each named, one dot apiece in order', () => {
  assert.deepEqual(
    scenes.map((s) => s.id),
    ['aboard', 'port-1', 'port-2', 'port-3', 'port-4', 'port-5', 'port-6', 'ports', 'manifest', 'helm', 'proof', 'home'],
  );
  const dots = [...html.matchAll(/<button class="tb-dot[^"]*" data-scene="(\d+)" aria-label="(\d+) of 12 — [^"]+"><\/button>/g)];
  assert.equal(dots.length, 12);
  dots.forEach((d, i) => {
    assert.equal(Number(d[1]), i, 'dot order');
    assert.equal(Number(d[2]), i + 1, 'dot label counts from 1');
  });
  // The first scene shows before any script runs; no other does.
  assert.equal((html.match(/<section class="scene[^"]* on"/g) ?? []).length, 1);
  assert.match(html, /<section class="scene on" id="aboard"/);
});

test('every in-page link lands on a scene', () => {
  const keys = new Set(scenes.flatMap((s) => [s.id, s.alias].filter(Boolean)));
  assert.ok(keys.has('top') && keys.has('voyage'), 'the old #top and #voyage still work');
  const hrefs = [...html.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 6);
  for (const h of hrefs) assert.ok(keys.has(h), `#${h} names a scene`);
  for (const go of [...html.matchAll(/data-go="([a-z0-9-]+)"/g)].map((m) => m[1])) assert.ok(keys.has(go), `chooser → ${go}`);
});

test('the deck is chosen before the first paint, by the same query the page script watches', () => {
  const q = '(min-width: 980px) and (min-height: 600px)';
  assert.ok(html.includes(`window.matchMedia("${q}").matches) document.documentElement.className += " deck"`), 'head script');
  assert.ok(html.includes(`var DECK_MQ = "${q}";`), 'page script');
});

test('the tour never moves by itself, and its controls wait for script', () => {
  assert.doesNotMatch(html, /setInterval|autoplay|auto-advance/i);
  assert.match(html, /<div class="deck-nav" id="deck-nav" role="group" aria-label="Tour controls" hidden>/);
  assert.match(html, /\.deck-nav\[hidden\]\{display:none\}/);
});

test('a click on a scene moves on, but never through a control, a drag or a selection', () => {
  const skip = html.match(/var CLICK_SKIP = "([^"]+)";/);
  assert.ok(skip, 'the skip list exists');
  for (const sel of ['a', 'button', 'input', 'label', '[tabindex]', '[data-book3d]', '.deck-nav']) {
    assert.ok(skip[1].split(', ').includes(sel), `clicks on ${sel} are left alone`);
  }
  assert.match(html, /Math\.abs\(e\.clientX - px\) > 6/, 'a drag is not a click');
  assert.match(html, /sel\.isCollapsed/, 'selecting text is not a click');
  assert.match(html, /if\(e\.detail > 1\) return;/, 'a double-click picks a word, not a scene');
  assert.match(html, /!selecting\(\) && cur < N - 1\) goTo\(cur \+ 1\);/, 'a click stops at the last scene');
});

test('a scene that is too tall shrinks to no less than 80%, then scrolls inside itself', () => {
  assert.match(html, /var ZOOM_FLOOR = 0\.8;/);
  assert.match(html, /\.deck \.scene\{position:absolute;inset:0;[^}]*overflow-y:auto/);
  // Hidden scenes leave the Tab order and the accessibility tree with visibility, not opacity alone.
  assert.match(html, /\.deck \.scene\{[^}]*visibility:hidden/);
});
