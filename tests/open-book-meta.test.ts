import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const studioPath = path.join(here, '..', 'client', 'index.html');

/* BEUK:metaleak — the simulation found a standalone book opened after a
   series book arriving with that series (applyBookDoc merged the arriving
   meta onto the desk's meta). The browser self-checks prove the behaviour;
   this pins the shape so the merge cannot quietly come back. */
async function applyBookDocSource(): Promise<string> {
  const studio = await readFile(studioPath, 'utf8');
  const start = studio.indexOf('      function applyBookDoc(doc');
  assert.ok(start > 0, 'applyBookDoc present');
  const end = studio.indexOf('\n      }\n', start);
  return studio.slice(start, end);
}

test('Opening a book: applyBookDoc never builds the arriving meta on top of the desk meta', async () => {
  const src = await applyBookDocSource();
  assert.ok(!/Object\.assign\(\s*\{\s*\}\s*,\s*state\.meta/.test(src), 'applyBookDoc must not merge doc.meta onto state.meta');
  assert.ok(/state\.meta = Object\.assign\(baseMeta, arrMeta\)/.test(src), 'the arriving meta is laid over bookMetaDefaults()');
  assert.ok(/bookPrintDefaults\(\)/.test(src), 'print and export choices start from bookPrintDefaults()');
  assert.ok(/!opts\.keepHistory && !sameBook\) state\.history = \[\]/.test(src), 'another book arriving without History of its own gets none');
});

test('Opening a book: the meta-leak self-checks are registered client-only with a reason', async () => {
  const studio = await readFile(studioPath, 'utf8');
  const byId = new Map(SELF_CHECK_CASES.map((c) => [c.id, c]));
  for (const id of ['book.arrival.replaces-whole', 'shelf.open.no-meta-carryover']) {
    assert.ok(studio.includes(`{ id: "${id}"`), `${id} present in the studio`);
    const c = byId.get(id);
    assert.ok(c, `${id} missing from the server registry`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a reason`);
  }
});
