import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* Per-device page counts are laid out by the studio at each profile's
   fixed CSS-px reading area. The server side is the Housekeeping
   registration (client-only, with a reason) and a static guard that the
   geometry table covers every e-reader profile on the device bar. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('pagecount: every client preview.pagecount.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await clientHtml();
  const clientIds = [...html.matchAll(/id: "(preview\.pagecount\.[a-z0-9.-]+)"/g)].map((m) => m[1]);
  assert.ok(clientIds.length >= 1, 'expected the pagecount self-check in the client');
  const serverIds = SELF_CHECK_CASES.filter((c) => c.id.startsWith('preview.pagecount.')).map((c) => c.id);
  assert.deepEqual([...serverIds].sort(), [...new Set(clientIds)].sort());
  for (const c of SELF_CHECK_CASES.filter((x) => x.id.startsWith('preview.pagecount.'))) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} must carry a reason`);
  }
});

test('pagecount: the geometry table has a sourced row for every e-reader profile on the device bar', async () => {
  const html = await clientHtml();
  const bar = /<div class="device-bar" id="deviceBar">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(bar, 'device bar present');
  const ids = [...bar[1].matchAll(/data-device="([a-z]+)"/g)].map((m) => m[1]).filter((d) => d !== 'hardcover');
  assert.equal(ids.length, 10);
  const table = /const PAGE_GEOMETRY = \{([\s\S]*?)\n {6}\};/.exec(html);
  assert.ok(table, 'PAGE_GEOMETRY table present');
  for (const d of ids) {
    const row = new RegExp(`\\n\\s+${d}: \\{ screen: \\[(\\d+), (\\d+)\\], screenSrc: "([^"]+)", screenVerified: (true|false), dpr: ([\\d.]+), dprVerified: (true|false)`).exec(table[1]);
    assert.ok(row, `${d} has a geometry row`);
    assert.ok(Number(row[1]) > 500 && Number(row[2]) > Number(row[1]), `${d} screen is portrait pixels`);
    assert.ok(/https:\/\/|derived:/.test(row[3]), `${d} screen cites a source or says it is derived`);
    assert.match(table[1], new RegExp(`\\n\\s+${d}: \\{[^\\n]*insetVerified: false`), `${d} margins are marked unverified`);
  }
  // The counts must not read the window's box.
  const fn = /function computeDeskCountsSync\(\) \{([\s\S]*?)\n {6}\}/.exec(html);
  assert.ok(fn, 'computeDeskCountsSync present');
  assert.doesNotMatch(fn[1], /flowWrap|clientWidth|innerWidth|devicePixelRatio/);
});

test('pagecount: the estimate copy ("about N pages") and the basis line ship in all 13 locales', async () => {
  const html = await clientHtml();
  const basis = [...html.matchAll(/"preview\.desk\.basis": "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(basis.length, 13);
  for (const b of basis) assert.ok(b.includes('{w}') && b.includes('{h}') && b.includes('{size}'), b);
  assert.match(html, /"preview\.desk\.totalPlural": "\{title\} · about \{n\} pages on \{device\}"/);
});
