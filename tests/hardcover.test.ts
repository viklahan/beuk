import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* Hardcover wraps (case laminate + dust jacket) live in the client
   cover maker. The server side of the feature is its Housekeeping
   registration: every client self-check is mirrored here as a
   client-only case with a reason — never dropped, never faked. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('hardcover: every client cover.hardcover.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await clientHtml();
  const clientIds = [...html.matchAll(/id: "(cover\.hardcover\.[a-z0-9.-]+)"/g)].map((m) => m[1]);
  assert.ok(clientIds.length >= 9, `expected the hardcover self-checks in the client, found ${clientIds.length}`);
  const serverIds = SELF_CHECK_CASES.filter((c) => c.id.startsWith('cover.hardcover.')).map((c) => c.id);
  assert.deepEqual([...serverIds].sort(), [...new Set(clientIds)].sort());
  for (const c of SELF_CHECK_CASES.filter((x) => x.id.startsWith('cover.hardcover.'))) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} must carry a reason`);
  }
});

test('hardcover: the spec constants cite IngramSpark and every hardcover UI string ships in all 13 locales', async () => {
  const html = await clientHtml();
  assert.match(html, /https:\/\/www\.ingramspark\.com\/hubfs\/downloads\/file-creation-guide\.pdf/);
  assert.match(html, /https:\/\/www\.ingramspark\.com\/hubfs\/downloads\/trim-sizes\.pdf/);
  assert.match(html, /caseLam: \{ boardWMinus: 0\.185, boardHPlus: 0\.25, wrap: 0\.625, hinge: 0\.5,/);
  assert.match(html, /jacket: \{ panelWPlus: 0\.4375, panelHPlus: 0\.25, bleed: 0\.125, flap: 3\.25, flapFold: 0\.25,/);
  const enBlock = /Object\.assign\(UI_STRINGS\.en, \{ ("covermk\.hc\.[^\n]*) \}\);/.exec(html);
  assert.ok(enBlock, 'English hardcover strings present');
  const keys = [...enBlock[1].matchAll(/"(covermk\.hc\.[A-Za-z]+)":/g)].map((m) => m[1]);
  assert.ok(keys.length >= 30, `hardcover keys: ${keys.length}`);
  for (const k of keys) {
    const n = html.split(`"${k}":`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locale packs, expected 13`);
  }
});
