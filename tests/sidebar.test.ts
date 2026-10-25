import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:sidebar — the compact header pill, single Import / Project
   Settings, the collapsible sidebar and the pre-rename sample swap all
   run in the studio. Server side: their Housekeeping registration
   (client-only, with a reason) and static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['ui.savepill.compact', 'ui.header.no-duplicates', 'ui.sidebar.collapse', 'ui.outline.groups', 'sample.legacy-salt-meridian'];

test('sidebar: every new self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client SELF_CHECKS`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a reason`);
  }
});

test('sidebar: the header carries no duplicate Import / Settings buttons and no dead references to them', async () => {
  const full = await clientHtml();
  // The ui.header.no-duplicates self-check itself names the removed ids to prove they are gone.
  const start = full.indexOf('{ id: "ui.header.no-duplicates"');
  const end = full.indexOf('{ id: "ui.sidebar.collapse"');
  assert.ok(start > 0 && end > start, 'self-check block found');
  const html = full.slice(0, start) + full.slice(end);
  assert.doesNotMatch(html, /btnImportTop/);
  assert.doesNotMatch(html, /\$\("btnSettings"\)|id="btnSettings"|#btnSettings\b/);
  assert.doesNotMatch(html, /"top\.import"|"top\.settings"/);
  assert.match(html, /id="btnImport"/);
  assert.match(html, /id="btnSettings2"/);
});

test('sidebar: every new or changed string ships in all 13 locales', async () => {
  const html = await clientHtml();
  const keys = ['local.savedRiskShort', 'side.toolInsights', 'side.toolGoals', 'side.toolHistory', 'side.toolComments', 'side.toolsAria',
    'side.statsAria', 'side.statsSummary', 'side.groupCount', 'side.groupCountPlural', 'sample.legacyUpdated', 'history.auto.sampleupdate', 'sample.coverUpdated'];
  for (const k of keys) {
    const n = html.split(`"${k}": "`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locales`);
  }
  assert.doesNotMatch(html, /"local\.evictable"/, 'the removed pill suffix leaves no dead key');
  for (const m of html.matchAll(/"side\.statsSummary": "([^"]+)"/g)) {
    assert.ok(m[1].includes('{words}') && m[1].includes('{pages}') && m[1].includes('{time}'), m[1]);
  }
  for (const m of html.matchAll(/"sample\.legacyUpdated": "([^"]+)"/g)) assert.ok(m[1].includes('{old}'), m[1]);
});

test('sidebar: History keeps every snapshot kind the studio writes (backup and sampleupdate included)', async () => {
  const html = await clientHtml();
  const m = /function normalizeHistory\(list\) \{[\s\S]*?auto: (\[[^\]]+\])\.indexOf\(e\.auto\)/.exec(html);
  assert.ok(m, 'normalizeHistory whitelist found');
  const kinds = JSON.parse(m[1]) as string[];
  for (const k of ['import', 'sample', 'restore', 'conflict', 'bookid', 'backup', 'sampleupdate']) assert.ok(kinds.includes(k), k);
  // Every kind the code snapshots with is whitelisted.
  const used = new Set([...html.matchAll(/(?:autoSnapshot|takeSnapshot)\((?:"[^"]*"|t\("[^"]+"\)), "([a-z]+)"\)|autoSnapshot\("([a-z]+)"\)/g)].map((x) => x[1] || x[2]));
  for (const k of used) assert.ok(kinds.includes(k), `snapshot kind ${k} is whitelisted`);
});

test('sidebar: the pre-rename sample title survives only inside the legacy-recognition code', async () => {
  const html = await clientHtml();
  const lines = html.split('\n');
  let inBlock = false;
  const stray: number[] = [];
  lines.forEach((l, i) => {
    if (l.length > 100000) return; // the embedded image data lines
    if (l.includes('==== BEUK:sidebar ====')) inBlock = true;
    if (/salt.?meridian/i.test(l) && !inBlock && !/isSampleBookId|pre-rename id/.test(l)) stray.push(i + 1);
    if (l.includes('==== /BEUK:sidebar ====')) inBlock = false;
  });
  assert.deepEqual(stray, [], 'lines naming the old title outside the legacy block');
});

test('sidebar: the packaged sample cover is the re-lettered one, never the stale JPEG the stale-cover sweep looks for', async () => {
  const { createHash } = await import('node:crypto');
  const html = await clientHtml();
  const data = /\n {6}const SAMPLE_COVER = \{ data: "([A-Za-z0-9+/=]+)"/.exec(html);
  assert.ok(data, 'SAMPLE_COVER present');
  const stale = /const SAMPLE_COVER_STALE = \{ len: (\d+), sha1: "([0-9a-f]{40})" \}/.exec(html);
  assert.ok(stale, 'stale-cover fingerprint present');
  const sha = createHash('sha1').update(data[1], 'utf8').digest('hex');
  assert.notEqual(sha, stale[2], 'the shipped cover must not be the stale one');
  assert.ok(data[1].length !== Number(stale[1]) || sha !== stale[2]);
});
