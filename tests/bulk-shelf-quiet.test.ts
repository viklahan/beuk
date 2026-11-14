import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:bulkquiet — a folder / bulk import adds books to the shelf one at a
   time. The bug: bulkCreateShelfBook re-rendered the shelf list after EVERY
   book, and the bulk panel lives inside the shelf modal right under that
   list, so the writer watched it churn and was invited to review a moving
   target. The fix holds the shelf list steady for the whole batch
   (renderShelfList bails while bulkBusy) and renders it ONCE when the batch
   settles. These are static-source assertions, the studio's own idiom. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('bulkquiet: renderShelfList bails while a bulk import is in flight', async () => {
  const html = await clientHtml();
  const fn = html.slice(
    html.indexOf('function renderShelfList()'),
    html.indexOf('function deskHoldsUnshelvedWork('),
  );
  assert.ok(fn.length > 0, 'renderShelfList present');
  assert.match(fn, /if \(bulkBusy\) return;/, 'renderShelfList must bail while bulkBusy, or the shelf churns per book');
});

test('bulkquiet: bulkCreateShelfBook records the book but does not render per book', async () => {
  const html = await clientHtml();
  const fn = html.slice(
    html.indexOf('function bulkCreateShelfBook('),
    html.indexOf('function renderBulkSummary('),
  );
  assert.ok(fn.length > 0, 'bulkCreateShelfBook present');
  assert.ok(fn.includes('cloud.shelf.unshift'), 'still records the new book in the in-memory shelf');
  assert.ok(!fn.includes('renderShelfList()'), 'bulkCreateShelfBook must NOT render the shelf per book (the moving-target churn)');
});

test('bulkquiet: startBulkImport renders the settled shelf once when the batch finishes', async () => {
  const html = await clientHtml();
  const s = html.indexOf('function startBulkImport(');
  assert.ok(s > 0, 'startBulkImport present');
  const fn = html.slice(s, s + 2600);
  assert.match(
    fn,
    /bulkBusy = false;\s*\n\s*renderShelfList\(\);/,
    'after the batch settles (bulkBusy = false) the shelf must render once',
  );
});

test('bulkquiet: the behavior is a registered self-check, client registry + server mirror', async () => {
  const html = await clientHtml();
  assert.ok(
    html.includes('{ id: "bulk.shelf.quiet-during-import"'),
    'client self-check bulk.shelf.quiet-during-import must be registered in the studio',
  );
  const c = SELF_CHECK_CASES.find((x) => x.id === 'bulk.shelf.quiet-during-import');
  assert.ok(c, 'server registry must mirror bulk.shelf.quiet-during-import');
  assert.equal(c!.kind, 'client-only', 'a DOM-timing behavior is client-only');
  assert.ok((c!.reason ?? '').length > 10, 'the server mirror must carry a one-line reason');
});
