import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:bulkchip — a folder import is a background job: a persistent,
   dismissible status chip lives OUTSIDE the shelf modal, so the writer can
   close the shelf and keep writing. It mirrors the import progress, and
   when the batch settles it offers to open the shelf (bring to foreground).
   Static-source assertions, the studio's own test idiom; the behavior
   itself is exercised by the in-studio self-check bulk.chip.background. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('bulkchip: a persistent status chip exists outside the shelf modal', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('id="bulkChip"'), 'the bulk status chip element exists');
  assert.ok(
    html.indexOf('id="bulkChip"') > html.indexOf('id="toasts"'),
    'the chip sits outside the shelf modal (after the toasts layer) so it survives closing the shelf',
  );
});

test('bulkchip: import progress and completion drive the chip', async () => {
  const html = await clientHtml();
  const s = html.indexOf('function startBulkImport(');
  assert.ok(s > 0, 'startBulkImport present');
  const fn = html.slice(s, s + 2800);
  assert.match(fn, /bulkChipBusy\(/, 'progress updates must drive the chip (keep-writing status)');
  assert.match(fn, /bulkChipDone\(summary\)/, 'completion must set the chip to its done state');
});

test('bulkchip: the dismiss control carries a localized tooltip', async () => {
  const html = await clientHtml();
  const s = html.indexOf('id="bulkChip"');
  const block = html.slice(s, s + 700);
  assert.match(block, /data-tip="[a-z]+\.[a-z]+"/, 'the chip dismiss control has a localized tooltip');
});

test('bulkchip: the open-shelf action and dismiss are wired at init', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('function initBulkChip('), 'initBulkChip defined');
  assert.ok(html.includes('initBulkChip();'), 'initBulkChip is actually called from startup');
  const s = html.indexOf('function initBulkChip(');
  const fn = html.slice(s, s + 800);
  assert.match(fn, /modalShelf/, 'the open action brings the shelf to the front');
  assert.match(fn, /bulkChipHide/, 'the dismiss action hides the chip');
});

test('bulkchip: the behavior is a registered self-check, client registry + server mirror', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('{ id: "bulk.chip.background"'), 'client self-check registered');
  const c = SELF_CHECK_CASES.find((x) => x.id === 'bulk.chip.background');
  assert.ok(c, 'server registry must mirror bulk.chip.background');
  assert.equal(c!.kind, 'client-only', 'a DOM-timing behavior is client-only');
  assert.ok((c!.reason ?? '').length > 10, 'the server mirror must carry a one-line reason');
});
