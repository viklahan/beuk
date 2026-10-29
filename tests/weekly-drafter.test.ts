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

/* check-draft.ts and upload.ts, run as the drafter runs them. */

import { createTestDb, startTestServer } from './helpers.js';

const TOOL = (name: string) => path.join(root, 'tools', 'weekly', name);
function tool(name: string, args: string[], env: Record<string, string> = {}) {
  // spawnSync would block this process's event loop, and with it the test server; run async.
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn(process.execPath, ['--import', 'tsx', TOOL(name), ...args], { env: { ...process.env, ...env }, cwd: root });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', (code) => resolve({ code, out }));
    });
  });
}

const SHA = 'b'.repeat(40);
const OUTSIDE_STORY = '---\ntitle: KDP Changes A Rule\nsection: Stores\nplace: brief\nsources: [https://kdp.example/news]\n---\nA paragraph.\n';

test('check-draft: an unsourced outside story → exit 1, naming the story; a clean folder → exit 0', async () => {
  const dir = draftFolder();
  writeFileSync(path.join(dir, 'kdp-rule.md'), OUTSIDE_STORY);
  const bad = await tool('check-draft.ts', [dir]);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /kdp-rule: source https:\/\/kdp\.example\/news is not in sources\.json/);
  writeFileSync(path.join(dir, 'sources.json'), JSON.stringify([{ url: 'https://kdp.example/news', fetchedAt: '2026-11-05T07:00:00Z', quote: 'From 1 December.', story: 'kdp-rule' }]));
  writeFileSync(path.join(dir, 'dropped.json'), JSON.stringify([{ title: 'A rumour', why: 'could not confirm' }]));
  const ok = await tool('check-draft.ts', [dir]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /clean: 11 stories/);
});

test('upload: a clean folder uploads (201) without its drafter-only files; a second upload reports the waiting draft; the server down → exit 2', async () => {
  const token = 'k'.repeat(40);
  const db = await createTestDb();
  const s = await startTestServer(db, undefined, { weeklyDraftToken: token, weeklyEditorEmail: 'ed@example.com' });
  try {
    const dir = draftFolder();
    writeFileSync(path.join(dir, 'dropped.json'), JSON.stringify([{ title: 'A rumour', why: 'could not confirm' }]));
    writeFileSync(path.join(dir, 'outlets.json'), JSON.stringify(['example.org']));
    writeFileSync(path.join(dir, 'pictures.json'), JSON.stringify([{ story: 'first-line', prompt: 'a quill' }]));
    writeFileSync(path.join(dir, 'no-pictures.json'), JSON.stringify(['The First Line Does the Hiring: local model not configured']));
    const env = { BEUK_WEEKLY_TOKEN: token };
    const up = await tool('upload.ts', [dir, '--server', s.base, '--commit', SHA], env);
    assert.equal(up.code, 0, up.out);
    const res = JSON.parse(up.out.trim().split('\n').pop()!) as { id: string; previewUrl: string };
    const stored = readdirSync(path.join(s.config.weeklyDir, 'drafts', res.id));
    assert.ok(stored.includes('issue.md') && stored.includes('sources.json'));
    for (const f of ['dropped.json', 'outlets.json', 'pictures.json', 'no-pictures.json']) assert.ok(!stored.includes(f), `${f} stays on the Legion`);
    const row = (await db.query<{ dropped: unknown; outlets: unknown; source_commit: string }>('select dropped, outlets, source_commit from weekly_drafts')).rows[0];
    assert.equal(row.source_commit, SHA);
    assert.deepEqual(row.outlets, ['example.org']);

    const again = await tool('upload.ts', [dir, '--server', s.base, '--commit', SHA], env);
    assert.equal(again.code, 3, again.out);
    assert.match(again.out, /last week's draft is still waiting: .*\/school\/weekly\/draft\//);

    const noToken = await tool('upload.ts', [dir, '--server', s.base, '--commit', SHA], { BEUK_WEEKLY_TOKEN: '' });
    assert.equal(noToken.code, 1, noToken.out);
  } finally {
    await s.close();
  }
  const down = await tool('upload.ts', [draftFolder(), '--server', 'http://127.0.0.1:9', '--commit', SHA], { BEUK_WEEKLY_TOKEN: 'k'.repeat(40) });
  assert.equal(down.code, 2, down.out);
  assert.match(down.out, /could not reach the server/);
  const downFail = await tool('upload.ts', ['--failed', 'claude: not logged in', '--server', 'http://127.0.0.1:9'], { BEUK_WEEKLY_TOKEN: 'k'.repeat(40) });
  assert.equal(downFail.code, 2, downFail.out);
});
