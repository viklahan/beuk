import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const studioPath = path.join(here, '..', 'client', 'index.html');

test('ACX audio script: every client self-check is registered server-side as client-only with a reason', async () => {
  const studio = await readFile(studioPath, 'utf8');
  const clientIds = Array.from(studio.matchAll(/\{ id: "(acx\.[a-z0-9.-]+)", feature: "acx"/g), (m) => m[1]);
  assert.equal(clientIds.length, 4, `client registry acx cases: ${clientIds.join(', ')}`);
  const byId = new Map(SELF_CHECK_CASES.map((c) => [c.id, c]));
  for (const id of clientIds) {
    const c = byId.get(id);
    assert.ok(c, `${id} missing from the server registry`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a one-line reason`);
  }
  // No server entry without a client case behind it.
  const serverAcx = SELF_CHECK_CASES.filter((c) => c.id.startsWith('acx.')).map((c) => c.id).sort();
  assert.deepEqual(serverAcx, [...clientIds].sort());
});

test('ACX audio script: the studio cites ACX for every rule constant it uses', async () => {
  const studio = await readFile(studioPath, 'utf8');
  const start = studio.indexOf('/* ==== BEUK:acx ==== */\n      /* ================= Audio script export');
  assert.ok(start > 0, 'acx block present');
  const block = studio.slice(start, studio.indexOf('/* ==== /BEUK:acx ==== */', start));
  // Each constant sits next to the URL it came from.
  const near = (needle: string, url: string) => {
    const i = block.indexOf(needle);
    assert.ok(i > 0, `${needle} present`);
    const before = block.slice(Math.max(0, i - 400), i);
    assert.ok(before.includes(url), `${needle} must be preceded by its source ${url}`);
  };
  near('wordsPerHour: 9300', 'https://help.acx.com/s/article/how-long-will-my-narrated-audiobook-be');
  near('maxFileMinutes: 120', 'https://help.acx.com/s/article/acx-audio-submission-requirements');
  near('sampleMaxMinutes: 5', 'https://help.acx.com/s/article/acx-audio-submission-requirements');
  assert.ok(block.includes('https://help.acx.com/s/article/producing-and-recording-your-audiobook'), 'TOC rule cited');
});
