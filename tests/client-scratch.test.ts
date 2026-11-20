import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

/* client/ is the web root: Caddy mounts it at /srv/client and its last
   handle serves any file in it, and the runtime image copies the whole
   folder. A working file left there (a probe folder of manuscript PDFs, a
   book backup) is therefore one request from public, one `docker build`
   from being baked into the image, and one `git add .` from the repo.
   Top-level names that start with an underscore are the bench's own, and
   all three doors stay shut on them. */

const root = path.resolve(import.meta.dirname, '..');
const read = (name: string) => readFile(path.join(root, name), 'utf8');
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim());

test('client scratch: Caddy answers 404 for /_… before the static client can serve it', async () => {
  const caddy = await read('Caddyfile');
  const guard = '@scratch path /_*\n\thandle @scratch {\n\t\trespond 404\n\t}';
  const at = caddy.indexOf(guard);
  assert.ok(at > 0, 'the /_* guard is in the Caddyfile');
  // The catch-all is the only handle that serves an arbitrary file; the
  // guard has to be a sibling handle (they are mutually exclusive, and a
  // path matcher outranks the bare handle), so it sits in the same block.
  // Since the 2.0 switch that catch-all has no SPA fallback (1.0's index.html is never answered): it is the
  // bare handle whose last two lines send a missing page to /studio and serve every other file as it is.
  const fallback = caddy.indexOf('\thandle {\n');
  assert.ok(fallback > 0, 'the static client catch-all is still there');
  assert.equal(caddy.indexOf('\thandle {\n', fallback + 1), -1, 'it is the only bare handle');
  assert.ok(caddy.slice(fallback).includes('redir @missingPage /studio{?query} 302\n\t\tfile_server\n\t}'), 'it is the handle that serves the static client');
  assert.ok(!caddy.includes('try_files {path} /index.html'), "no fallback to 1.0's index.html");
  assert.ok(at < fallback, 'the guard is declared ahead of the catch-all');
});

test('client scratch: the image and the repo never pick up client/_…', async () => {
  assert.ok(lines(await read('.dockerignore')).includes('client/_*'), '.dockerignore has client/_*');
  assert.ok(lines(await read('.gitignore')).includes('/client/_*'), '.gitignore has /client/_*');
});
