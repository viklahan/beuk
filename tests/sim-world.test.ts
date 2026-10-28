import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* The world simulation (tools/sim): its generator must be deterministic —
   the same seed gives a byte-identical world spec — and must build the
   world only from the committed catalog (no clock, no Math.random, no
   network). These run without the sim stack. */

const here = path.dirname(fileURLToPath(import.meta.url));
const worldModule = () => import(pathToFileURL(path.join(here, '..', 'tools', 'sim', 'world.mjs')).href);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('sim world: the same seed gives a byte-identical world spec', async () => {
  const { worldBytes } = await worldModule();
  const a = worldBytes(20261027);
  const b = worldBytes(20261027);
  assert.equal(sha(a), sha(b));
  assert.equal(a, b);
});

test('sim world: a different seed gives a different world', async () => {
  const { worldBytes } = await worldModule();
  assert.notEqual(sha(worldBytes(20261027)), sha(worldBytes(7)));
});

test('sim world: generation reads no clock and no Math.random', async () => {
  const { buildWorld, loadInputs } = await worldModule();
  const inputs = loadInputs();
  const realRandom = Math.random;
  const realNow = Date.now;
  Math.random = () => { throw new Error('Math.random used'); };
  Date.now = () => { throw new Error('Date.now used'); };
  try {
    const w = buildWorld(20261027, inputs);
    assert.ok(w.books.length > 0);
  } finally {
    Math.random = realRandom;
    Date.now = realNow;
  }
});

test('sim world: every book comes from the catalog, every persona is a .test address, every series is 3+ books in order', async () => {
  const { buildWorld, loadInputs } = await worldModule();
  const inputs = loadInputs();
  const w = buildWorld(20261027, inputs);
  const keys = new Set(inputs.catalog.sources.map((s: { key: string }) => s.key));
  const ebooks = new Set(inputs.catalog.sagas.map((s: { ebook: number }) => s.ebook));
  for (const b of w.books) {
    if (b.source.kind === 'saga') assert.ok(ebooks.has(b.source.ebook), `${b.id} saga source in catalog`);
    else assert.ok(keys.has(b.source.key), `${b.id} source ${b.source.key} in catalog`);
  }
  for (const p of w.personas) assert.match(p.email, /@sim\.beuk\.test$/);
  for (const s of w.series) {
    assert.ok(s.books.length >= 3, `${s.key} has ${s.books.length} books`);
    s.books.forEach((id: string, i: number) => assert.equal(w.books.find((b: { id: string }) => b.id === id).series.order, i + 1));
  }
  const writers = w.personas.filter((p: { kind: string }) => p.kind !== 'lab' && p.kind !== 'load');
  assert.ok(writers.length >= 6 && writers.length <= 10, `${writers.length} writer personas`);
});
