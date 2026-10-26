import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:imagelib — removing pictures from the book's image library runs
   in the studio. Server side: the Housekeeping registration (client-only,
   with a reason) and static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['images.usage.finds-every-role', 'images.delete.unused-undo', 'images.delete.used-clears-roles', 'images.cleanup.unused-only', 'images.delete.leaves-serialized-book'];

test('imagelib: every new self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client SELF_CHECKS`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only', id);
    assert.ok((c.reason ?? '').length > 10, `${id} must carry a reason`);
  }
});

test('imagelib: every new string ships in all 13 locales, placeholders intact', async () => {
  const html = await clientHtml();
  const keys = [...html.matchAll(/"(imglib\.[A-Za-z.]+)": "/g)].map((m) => m[1]);
  const uniq = [...new Set(keys)];
  assert.ok(uniq.length >= 30, `found ${uniq.length} imglib keys`);
  for (const k of [...uniq, 'history.auto.imgremove']) {
    const n = html.split(`"${k}": "`).length - 1;
    assert.equal(n, 13, `${k} appears in ${n} locales`);
  }
  const ph: Record<string, string[]> = {
    'imglib.cleanup': ['{n}', '{size}'], 'imglib.cleanupToast': ['{n}', '{size}'], 'imglib.useItem': ['{where}', '{role}'],
    'imglib.confirmTitle': ['{name}'], 'imglib.deleteAria': ['{name}'], 'imglib.where.theme': ['{name}'],
  };
  for (const [k, need] of Object.entries(ph)) {
    for (const m of html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "([^"]+)"`, 'g'))) {
      for (const p of need) assert.ok(m[1].includes(p), `${k}: ${m[1]} lacks ${p}`);
    }
  }
});

test('imagelib: the snapshot kind is whitelisted, the sample line is untouched, and the shell cache names stay', async () => {
  const html = await clientHtml();
  const m = /function normalizeHistory\(list\) \{[\s\S]*?auto: (\[[^\]]+\])\.indexOf\(e\.auto\)/.exec(html);
  assert.ok(m, 'normalizeHistory whitelist found');
  assert.ok((JSON.parse(m[1]) as string[]).includes('imgremove'));
  assert.match(html, /autoSnapshot\("imgremove"\)/);
  // The sample's own pictures are never offered for removal while the sample is the book on the desk.
  assert.match(html, /const imglibIsSample = \(im\) => !!im && typeof im\.id === "string" && im\.id\.indexOf\("sample-img-"\) === 0 &&\s*\(sampleState\.loaded \|\| isSampleBookId\(state\.meta\.bookId\)\);/);
  const sw = await readFile(path.join(here, '..', 'client', 'sw.js'), 'utf8');
  assert.match(sw, /beuk-shell-v5/);
  assert.match(sw, /beuk-sound-v2/);
});

test('imagelib: toast action buttons take clicks although the toast stack passes them through', async () => {
  const html = await clientHtml();
  assert.match(html, /#toasts \{[^}]*pointer-events: none;/);
  assert.match(html, /\.toast-action \{ pointer-events: auto; \}/);
});
