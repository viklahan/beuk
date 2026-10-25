import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* The editor toolbar's self-checks run in the client; each one is
   mirrored server-side as a client-only case with a reason. The
   toolbar markup keeps every id / data-insert / aria hook the rest of
   the studio and its self-checks depend on. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('toolbar: every client editor.toolbar.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await clientHtml();
  const clientIds = [...new Set([...html.matchAll(/id: "(editor\.toolbar\.[a-z0-9.-]+)"/g)].map((m) => m[1]))];
  assert.ok(clientIds.includes('editor.toolbar.layout'), 'the layout self-check is in the client');
  const serverIds = SELF_CHECK_CASES.filter((c) => c.id.startsWith('editor.toolbar.')).map((c) => c.id);
  assert.deepEqual([...serverIds].sort(), [...clientIds].sort());
  for (const c of SELF_CHECK_CASES.filter((x) => x.id.startsWith('editor.toolbar.'))) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} must carry a reason`);
  }
});

test('toolbar: grouped markup keeps every hook, four whole groups, no inline margin-left:auto', async () => {
  const html = await clientHtml();
  const start = html.indexOf('<div class="toolbar" id="insertToolbar">');
  const end = html.indexOf('<div id="sceneBar">', start);
  assert.ok(start > 0 && end > start, 'toolbar block found');
  const tb = html.slice(start, end);
  for (const hook of [
    'data-insert="bold"', 'data-insert="italic"', 'data-insert="blockquote"', 'data-insert="scenebreak"',
    'data-insert="emdash"', 'data-insert="endnote"', 'id="btnInsertImage"', 'id="btnDictate"', 'id="dictBtnLabel"',
    'id="btnBeautify"', 'id="btnReadAloud"', 'aria-haspopup="dialog"', 'id="raPop"', 'id="btnZen"', 'class="ra-wrap"',
    'data-i18n-aria="top.readAloudAria"',
  ]) assert.ok(tb.includes(hook), `toolbar keeps ${hook}`);
  const groups = [...tb.matchAll(/class="tool-group[^"]*" data-tg="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['format', 'structure', 'assist', 'focus']);
  assert.ok(/class="tool-group focus-cluster"/.test(tb), 'the Focus group keeps the focus-cluster class zen relies on');
  assert.equal((tb.match(/class="tool-break"/g) || []).length, 3, 'one possible break between each pair of groups');
  assert.ok(!/margin-left:\s*auto/.test(tb), 'nothing is pushed to a corner with margin-left:auto');
  for (const key of ['tool.bold', 'tool.italic', 'tool.blockquote', 'tool.sceneBreak', 'tool.emDash', 'tool.footnote', 'tool.insertImage', 'tool.autoFormat']) {
    assert.ok(tb.includes(`<span class="tl" data-i18n="${key}">`), `${key} label sits in a foldable span`);
  }
  // every foldable button carries a tooltip
  for (const m of tb.matchAll(/<button [^>]*data-collapse="[123]"[^>]*>/g)) assert.match(m[0], / title="[^"]+"/, m[0]);
});
