import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:panes — the outline (left) and the reader (right) columns fold away
   from a tab on their seam and come back from the same tab; the choice is
   remembered on this device. The behaviour runs in the studio (one
   self-check); server side: its registration and static guards over
   client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const ID = 'panes.collapse.both-sides';

test('panes: the collapse self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes(`{ id: "${ID}"`), `${ID} present in the client self-checks`);
  const c = SELF_CHECK_CASES.find((x) => x.id === ID);
  assert.ok(c, `${ID} registered`);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('panes: each side column has a fold tab, and the grid widths come from variables a fold sets to 0', async () => {
  const html = await clientHtml();
  assert.match(html, /<button[^>]*id="foldLeft"[^>]*aria-controls="pane-structure"/);
  assert.match(html, /<button[^>]*id="foldRight"[^>]*aria-controls="pane-preview"/);
  assert.match(html, /#panes \{[^}]*grid-template-columns: var\(--pane-l\) minmax\(0, 1fr\) var\(--pane-r\)/);
  assert.match(html, /#panes\.fold-left \{ --pane-l: 0px; \}/);
  assert.match(html, /#panes\.fold-right \{ --pane-r: 0px; \}/);
});

test('panes: the fold choice is kept per device under beuk.panes.v1, guarded', async () => {
  const html = await clientHtml();
  const block = html.slice(html.indexOf('/* ==== BEUK:panes ==== */'), html.indexOf('/* ==== /BEUK:panes ==== */'));
  assert.ok(block.length > 0, 'panes block present');
  assert.match(block, /"beuk\.panes\.v1"/);
  assert.match(block, /try \{[^}]*localStorage\.setItem\(PANES_KEY/);
});
