import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { geminiProvider, inboxProvider, makePictures, museProvider, type ImageProvider } from '../tools/weekly/images.js';

/* The Beuk Weekly drafter's tools (tools/weekly/, spec 2026-10-29). */

const root = path.resolve(import.meta.dirname, '..');
const ISSUE1 = path.join(root, 'content', 'weekly', 'en', '001');

/** A copy of issue No. 1 to draft into, with one story that has no picture yet. */
function draftFolder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'drafter-'));
  for (const f of readdirSync(ISSUE1)) copyFileSync(path.join(ISSUE1, f), path.join(dir, f));
  writeFileSync(path.join(dir, 'sources.json'), '[]');
  return dir;
}
const front = (dir: string, slug: string) => readFileSync(path.join(dir, `${slug}.md`), 'utf8').split('\n---')[0];

/** A provider that is ready and "draws" by writing a small file. */
function fakeLocal(calls: string[]): ImageProvider {
  return {
    name: 'local',
    configured: async () => null,
    make: async (story, prompt, outDir) => {
      calls.push(`${story}: ${prompt}`);
      writeFileSync(path.join(outDir, `${story}.jpg`), 'jpeg');
      return { file: `${story}.jpg`, model: 'fake-model', seed: 7 };
    },
  };
}
const notReady = (name: ImageProvider['name'], reason: string): ImageProvider => ({
  name,
  configured: async () => reason,
  make: async () => {
    throw new Error(`${name} must never be asked to draw`);
  },
});

test('pictures: an inbox picture wins over the local model and is not marked an illustration', async () => {
  const dir = draftFolder();
  const inbox = mkdtempSync(path.join(tmpdir(), 'inbox-'));
  writeFileSync(path.join(inbox, 'first-line.png'), 'png');
  const calls: string[] = [];
  const r = await makePictures(dir, [{ story: 'first-line', prompt: 'a quill' }], [inboxProvider(inbox), fakeLocal(calls)]);
  assert.deepEqual(r.made, { 'first-line': ['first-line.png'] });
  assert.deepEqual(calls, [], 'the local model is not asked when V supplied a picture');
  assert.match(front(dir, 'first-line'), /^image: first-line\.png$/m);
  assert.doesNotMatch(front(dir, 'first-line'), /illustration:/);
});

test('pictures: a generated picture marks the story an illustration and records provider, model, seed and prompt', async () => {
  const dir = draftFolder();
  const calls: string[] = [];
  const r = await makePictures(dir, [{ story: 'first-line', prompt: 'a quill' }], [inboxProvider(mkdtempSync(path.join(tmpdir(), 'inbox-'))), fakeLocal(calls)]);
  assert.deepEqual(r.made, { 'first-line': ['first-line.jpg'] });
  assert.match(front(dir, 'first-line'), /^image: first-line\.jpg$/m);
  assert.match(front(dir, 'first-line'), /^illustration: yes$/m);
  const sources = JSON.parse(readFileSync(path.join(dir, 'sources.json'), 'utf8'));
  assert.deepEqual(sources, [{ story: 'first-line', picture: { provider: 'local', model: 'fake-model', seed: 7, prompt: 'a quill' } }]);
});

test('pictures: a not-configured local model is skipped and named; the story is listed as having no picture; the placeholders are never called', async () => {
  const dir = draftFolder();
  const r = await makePictures(
    dir,
    [{ story: 'first-line', prompt: 'a quill' }, { story: 'first-line', prompt: 'an inkwell' }],
    [inboxProvider(mkdtempSync(path.join(tmpdir(), 'inbox-'))), notReady('local', 'BEUK_WEEKLY_IMAGE_MODEL is not set'), geminiProvider, museProvider],
  );
  assert.deepEqual(r.made, {});
  assert.deepEqual(r.noPictures, ['first-line']);
  assert.deepEqual(
    r.skipped.map((s) => s.provider),
    ['local', 'gemini', 'muse'],
  );
  assert.match(r.skipped[0].reason, /BEUK_WEEKLY_IMAGE_MODEL/);
  assert.match(r.skipped[1].reason, /placeholder: no account route yet/);
  assert.doesNotMatch(front(dir, 'first-line'), /^image:/m);
  await assert.rejects(geminiProvider.make('x', 'y', dir), /placeholder/);
  await assert.rejects(museProvider.make('x', 'y', dir), /placeholder/);
});

test('pictures: a story that already carries a picture keeps it', async () => {
  const dir = draftFolder();
  const calls: string[] = [];
  const r = await makePictures(dir, [{ story: 'twenty-four-trims', prompt: 'a ruler' }], [fakeLocal(calls)]);
  assert.deepEqual(calls, []);
  assert.deepEqual(r.made, {});
  assert.deepEqual(r.noPictures, []);
  assert.match(front(dir, 'twenty-four-trims'), /^image: trims\.jpg$/m);
});
