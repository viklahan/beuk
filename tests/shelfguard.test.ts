import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:shelfguard — opening a shelf book never silently replaces a book
   that exists only on this device, and "Restore the whole book" always
   takes the snapshot its confirmation promises. Both run in the studio;
   server side: their Housekeeping registration and static guards over
   client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['shelf.open.guards-device-only', 'history.restore.snapshot-always', 'confirm.alt.hidden-when-unused'];

test('shelfguard: every new self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a reason`);
  }
});

test('shelfguard: every new string ships in all 13 locales', async () => {
  const html = await clientHtml();
  for (const k of ['shelf.guardDeviceBody', 'shelf.guardKeep', 'shelf.guardReplace', 'shelf.guardSaveFirst', 'shelf.guardSaveFailed']) {
    const n = html.split(`"${k}": "`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locales`);
  }
});

test('shelfguard: the shelf-open guard no longer depends on edits made this session alone', async () => {
  const html = await clientHtml();
  const start = html.indexOf('async function cloudOpenBook(id) {');
  assert.ok(start > 0, 'cloudOpenBook found');
  const body = html.slice(start, html.indexOf('async function cloudAfterSignIn()', start));
  assert.doesNotMatch(body, /cloudDirty \|\| \(cloud\.linkState !== "linked" && cloud\.sessionEdited\)/);
  assert.match(body, /if \(deskHoldsUnshelvedWork\(\)\) \{/);
  // The guard runs before the shelf book is fetched.
  assert.ok(body.indexOf('deskHoldsUnshelvedWork()') < body.indexOf('apiFetch("/api/manuscripts/"'));
});

test('shelfguard: a whole-book restore snapshots unconditionally (its confirmation says so)', async () => {
  const html = await clientHtml();
  const start = html.indexOf('function restoreSnapshot(id) {');
  const body = html.slice(start, html.indexOf('function restoreSnapshotSection(', start));
  assert.match(body, /takeSnapshot\("", "restore"\);/);
  assert.doesNotMatch(body, /autoSnapshot\("restore"\)/);
});

test('shelfguard: the optional third confirm button is really hidden and a stray "alt" never reads as yes', async () => {
  const html = await clientHtml();
  // .tb-btn is display:inline-flex, which beats the bare hidden attribute.
  assert.match(html, /#btnConfirmAlt\[hidden\] \{ display: none; \}/);
  const start = html.indexOf('function cloudConfirmDone(value) {');
  assert.ok(start > 0, 'cloudConfirmDone found');
  const body = html.slice(start, html.indexOf('\n      }', start));
  assert.match(body, /if \(value === "alt" && !cloudConfirmAltOffered\) value = false;/);
});
