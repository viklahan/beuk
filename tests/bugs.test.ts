import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:bugs (round 6) — the false conflict on reload after a shelf save,
   live language redraws, CLDR plurals, the truthful sample count and the
   empty-desk restore all run in the studio. Server side: their
   Housekeeping registration (client-only, with a reason) and static
   guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['shelf.reload.no-false-conflict', 'ui.lang.live-account-desk', 'ui.plural.counts', 'sample.count.truthful', 'history.restore.empty-desk-no-prune'];

test('bugs: every new self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, `${id} has a reason`);
  }
});

test('bugs: a landed shelf save writes the new revision to the device at once, and a hidden page flushes a pending link write', async () => {
  const html = await clientHtml();
  const start = html.indexOf('async function cloudSaveRun() {');
  const body = html.slice(start, html.indexOf('function setSyncStatus(status) {', start));
  const ok = body.indexOf('if (typeof res.manuscript.revision === "number") cloud.baseRevision = res.manuscript.revision;');
  assert.ok(ok > 0, 'success branch found');
  assert.ok(body.indexOf('localWriteLinkNow()', ok) > ok, 'the 200 branch writes the link now');
  const hide = html.slice(html.indexOf('function localFlushOnHide() {'), html.indexOf('/* ---- boot: restore before the desk is shown ---- */'));
  assert.match(hide, /else if \(localLinkTimer\) localWriteLinkNow\(\);/);
});

test('bugs: a stale note is forgiven only when the shelf copy is the same book', async () => {
  const html = await clientHtml();
  // Both tolerance sites compare whole documents; neither compares anything weaker.
  assert.match(html, /res\.__status === 409 && res\.__body && res\.__body\.manuscript && res\.__body\.manuscript\.doc &&\s+typeof res\.__body\.manuscript\.revision === "number" && typeof bookDocsSame === "function" && bookDocsSame\(res\.__body\.manuscript\.doc, doc\)/);
  assert.match(html, /\} else if \(m\.doc && typeof bookDocsSame === "function" && bookDocsSame\(m\.doc, serializeBook\(\)\)\) \{/);
  // The real conflict branch is still there, after it.
  const rec = html.slice(html.indexOf('async function localReconcileOnSignIn() {'));
  assert.ok(rec.indexOf('bookDocsSame(m.doc, serializeBook())') < rec.indexOf('raiseConflict(m);'));
});

test('bugs: every new or changed string ships in all 13 locales', async () => {
  const html = await clientHtml();
  const keys = ['side.statsWords', 'side.statsWordsPlural', 'side.statsPages', 'side.statsPagesPlural', 'side.statsSummary',
    'editor.countSection', 'editor.countSectionPlural', 'editor.countBook', 'editor.countBookPlural', 'top.accountTitle', 'history.restoreBodyEmpty'];
  for (const k of keys) {
    const n = html.split(`"${k}": "`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locales`);
  }
  for (const m of html.matchAll(/"top\.accountTitle": "([^"]+)"/g)) assert.ok(m[1].includes('{email}'), m[1]);
  for (const m of html.matchAll(/"history\.restoreBodyEmpty": "([^"]+)"/g)) assert.ok(m[1].includes('{name}'), m[1]);
  assert.doesNotMatch(html, /btn\.title = cloud\.user\.email \+ " — your shelf"/, 'no hard-coded English account title');
});

test('bugs: the sample Load button no longer states a typed-in round count', async () => {
  const html = await clientHtml();
  assert.doesNotMatch(html, /t\("side\.sampleLoad", \{ n: fmtNum\(25000\) \}\)/);
  assert.match(html, /t\("side\.sampleLoad", \{ n: fmtNum\(sw\), count: sw \}\)/);
});
