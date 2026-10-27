import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:slim — the sample story's pictures are files under
   client/assets/sample/, not base64 inside client/index.html. These
   guards keep the page under its size budget, every listed file on
   disk with its exact bytes, and the page, the manifest and both
   service workers naming the same files. */

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.join(here, '..', 'client');
const sampleDir = path.join(client, 'assets', 'sample');

/* Measured after the move: 5,746,092 bytes (was 16,430,441). The budget
   sits just above it, so a picture pasted back into the page fails here. */
const INDEX_BUDGET_BYTES = 5_800_000;

type Pic = { id?: string; name: string; mediaType: string; ext: string; file: string; bytes: number; sha256: string };
const manifest = async () => JSON.parse(await readFile(path.join(sampleDir, 'manifest.json'), 'utf8')) as { format: string; version: number; images: Pic[]; cover: Pic };

test('slim: client/index.html stays under its size budget and carries no base64 run of 50,000+ characters', async () => {
  const size = (await stat(path.join(client, 'index.html'))).size;
  assert.ok(size <= INDEX_BUDGET_BYTES, `index.html is ${size} bytes, budget ${INDEX_BUDGET_BYTES}`);
  const html = await readFile(path.join(client, 'index.html'), 'utf8');
  const run = /[A-Za-z0-9+/=]{50000,}/.exec(html);
  assert.equal(run, null, run ? `a ${run[0].length}-character base64 run at offset ${run.index}` : '');
  assert.ok(!/const SAMPLE_IMAGES = \[/.test(html) && !/const SAMPLE_COVER = \{ data:/.test(html), 'the embedded sample picture constants are gone');
});

test('slim: every manifest file exists with its exact size and sha256, and is the image it says it is', async () => {
  const m = await manifest();
  assert.equal(m.format, 'beuk-sample-assets');
  assert.equal(m.images.length, 36);
  const ids = new Set<string>();
  for (const p of [...m.images, m.cover]) {
    const buf = await readFile(path.join(sampleDir, p.file));
    assert.equal(buf.length, p.bytes, `${p.file} size`);
    assert.equal(createHash('sha256').update(buf).digest('hex'), p.sha256, `${p.file} sha256`);
    assert.equal(p.mediaType, 'image/jpeg', p.file);
    assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${p.file} is a JPEG`);
    assert.equal(p.file, (p.id ?? 'sample-cover') + '.' + p.ext);
    if (p.id) { assert.match(p.id, /^sample-img-[a-z0-9-]+$/); assert.ok(!ids.has(p.id), `${p.id} listed once`); ids.add(p.id); }
  }
  assert.equal(m.cover.name, 'the-lantern-coast-cover.jpg');
});

test('slim: the page lists exactly the manifest (same order, same values)', async () => {
  const m = await manifest();
  const html = await readFile(path.join(client, 'index.html'), 'utf8');
  const list = /\n {6}const SAMPLE_IMAGE_FILES = (\[[\s\S]*?\n {6}\]);/.exec(html);
  assert.ok(list, 'SAMPLE_IMAGE_FILES present');
  assert.deepEqual(JSON.parse(list[1]), m.images);
  const cover = /\n {6}const SAMPLE_COVER_FILE = (\{.*?\});\n/.exec(html);
  assert.ok(cover, 'SAMPLE_COVER_FILE present');
  assert.deepEqual(JSON.parse(cover[1]), m.cover);
});

test('slim: both service workers precache exactly the manifest files, at shell cache v18', async () => {
  const m = await manifest();
  const files = [...m.images, m.cover].map((p) => p.file).sort();
  for (const [rel, prefix] of [['sw.js', './assets/sample/'], [path.join('assets', 'sw.js'), './sample/']] as const) {
    const sw = await readFile(path.join(client, rel), 'utf8');
    assert.match(sw, /const BEUK_CACHE = "beuk-shell-v18";/, rel);
    const block = /const BEUK_SAMPLE = \[([\s\S]*?)\];/.exec(sw);
    assert.ok(block, `${rel}: BEUK_SAMPLE list`);
    const listed = [...block[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    assert.ok(listed.every((u) => u.startsWith(prefix)), `${rel}: paths relative to the worker`);
    assert.deepEqual(listed.map((u) => u.slice(prefix.length)).sort(), files, `${rel}: same files as the manifest`);
    assert.match(sw, /cache\.match\(u\)\.then\(\(hit\) => hit \|\| cache\.add\(u\)\)\.then\(\(\) => true, \(\) => false\)/, `${rel}: cached per file, never fetched twice`);
    assert.match(sw, /event\.data\.type === "BEUK_SAMPLE_CACHE"[\s\S]{0,120}event\.waitUntil\(precacheSample\(\)/, `${rel}: precached on the page's word, kept alive by waitUntil`);
    const install = /addEventListener\("install"[\s\S]*?\n\}\);/.exec(sw);
    assert.ok(install && !install[0].includes('BEUK_SAMPLE'), `${rel}: not in install (it would hold back the first takeover)`);
    const activate = /addEventListener\("activate"[\s\S]*?\n\}\);/.exec(sw);
    assert.ok(activate && !activate[0].includes('precacheSample'), `${rel}: not in activate (it would hold every fetch)`);
  }
  const html = await readFile(path.join(client, 'index.html'), 'utf8');
  assert.match(html, /const BEUK_CACHE_NAME = "beuk-shell-v18";/);
});

test('slim: shell.sample.external is in the client and registered client-only with a reason', async () => {
  const html = await readFile(path.join(client, 'index.html'), 'utf8');
  assert.ok(html.includes('{ id: "shell.sample.external"'));
  const c = SELF_CHECK_CASES.find((x) => x.id === 'shell.sample.external');
  assert.ok(c, 'registered');
  assert.equal(c.kind, 'client-only');
  assert.ok((c.reason ?? '').length > 10);
});
