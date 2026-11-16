import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:zencalm — in Zen it is the manuscript and nothing else: the chapter's
   settings and its pictures fold behind one closed line each, the word count
   waits for a hover, Typography Studio is not in Zen, the text box fills the
   screen down to the bottom controls, and an ink painting the writer picks in
   the scene changer (Bliss, Calm, Mind, Sakura) stands behind the page in
   place of the old harbour sketch. One studio self-check; server side: its
   registration, the paintings on disk and in the offline shell. */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const clientHtml = () => readFile(path.join(root, 'client', 'index.html'), 'utf8');
const PAINTINGS = ['bliss', 'calm', 'mind', 'sakura'];

test('zen calm: the self-check is registered client-only; the sketch and its no-reader check are gone', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('{ id: "zen.calm.manuscript-only"'));
  const c = SELF_CHECK_CASES.find((x) => x.id === 'zen.calm.manuscript-only');
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(!html.includes('ZEN_ART_SVG'), 'the harbour sketch is gone');
  assert.ok(!SELF_CHECK_CASES.some((x) => x.id === 'zen.day.no-reader'));
});

test('zen calm: the four paintings are small web images, listed in the scene changer and the offline shell', async () => {
  const html = await clientHtml();
  for (const p of PAINTINGS) {
    const st = await stat(path.join(root, 'client', 'assets', 'zen', p + '.webp'));
    assert.ok(st.size > 5_000 && st.size < 200_000, p + ' is a web-sized image');
    assert.ok(html.includes(`id: "${p}"`), p + ' in ZEN_PAINTINGS');
  }
  for (const [rel, pre] of [['client/sw.js', './assets/zen/'], ['client/assets/sw.js', './zen/']] as const) {
    const sw = await readFile(path.join(root, rel), 'utf8');
    for (const p of PAINTINGS) assert.ok(sw.includes(`"${pre}${p}.webp"`), `${rel} precaches ${p}`);
  }
});

test('zen calm: settings and pictures fold, the count and the tabs are not on show, the box fits the screen', async () => {
  const html = await clientHtml();
  assert.match(html, /body\.zen:not\(\.zen-details-open\) #secSettings, body\.zen:not\(\.zen-details-open\) #editorMeta \{ display: none; \}/);
  assert.match(html, /body\.zen:not\(\.zen-pics-open\) #panelContent:not\(\.zen-led\) #zenStage \{ display: none !important; \}/);
  assert.match(html, /body\.zen #editorWordBar \{ display: none !important; \}/);
  assert.match(html, /body\.zen \.center-tabs \{ display: none; \}/);
  assert.match(html, /body\.zen #panelContent > #editorArea \{ flex: 1 1 auto;/);
  assert.equal((html.match(/"zen\.paint\.pick": "/g) || []).length, 13);
});

test('zen calm: below 1024px the editor pane is the one Zen column, never the 0px first track', async () => {
  // Regression (Nov 2026): 620e602 pins the panes to grid columns only at
  // >= 1024px, so on narrower screens the three-track Zen grid (0 / 1fr / 0)
  // auto-placed #pane-center into the 0px first track and the page vanished.
  const html = await clientHtml();
  const m = /@media \(max-width: 1023px\) \{\s*body\.zen:not\(\.zen-fading\) #panes \{ grid-template-columns: minmax\(0, 1fr\); \}\s*body\.zen:not\(\.zen-fading\) #panes #pane-center \{ grid-column: 1; \}/.exec(html);
  assert.ok(m, 'narrow Zen collapses to one column with the editor in it');
  assert.ok(html.indexOf(m![0]) > html.indexOf('body.zen #panes { grid-template-columns: 0px minmax(0, 1fr) 0px; }'), 'the narrow rule comes after the three-track rule');
});
