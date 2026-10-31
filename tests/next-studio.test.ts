import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { nextStudioRoutes } from '../src/routes/next-studio.js';

/* Beuk 2.0 studio at /next (step 4, part A): Caddy proxies /next* to the
   app, which serves the image's build of studio/ from client/next. */

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

async function serve(dir: string) {
  const app = express();
  app.use(nextStudioRoutes(dir));
  app.use((_req, res) => res.status(404).send('nope'));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('/next serves the build: index, immutable hashed assets, the app\'s own routes, loud 404s', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-next-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'assets'));
  mkdirSync(path.join(dir, '.vite'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dir, 'assets', 'index-AbC123.js'), 'console.log(1)');
  writeFileSync(path.join(dir, 'sw.js'), '/* sw */');
  writeFileSync(path.join(dir, '.vite', 'manifest.json'), '{}');
  const s = await serve(dir);
  t.after(s.close);

  const bare = await fetch(s.base + '/next?x=1', { redirect: 'manual' });
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get('location'), '/next/?x=1');

  for (const p of ['/next/', '/next/book/abc', '/next/index.html']) {
    const r = await fetch(s.base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /id="root"/, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
  }
  const js = await fetch(s.base + '/next/assets/index-AbC123.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(js.headers.get('content-type') ?? '', /javascript/);

  const sw = await fetch(s.base + '/next/sw.js');
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');

  // A missing file is a 404, never the page; the build manifest is not served.
  assert.equal((await fetch(s.base + '/next/assets/gone-123.js')).status, 404);
  assert.equal((await fetch(s.base + '/next/.vite/manifest.json')).status, 404);
  // Outside /next: untouched.
  assert.equal((await fetch(s.base + '/studio')).status, 404);
});

test('/next without a build on disk falls through (404), it never throws', async (t) => {
  const s = await serve(path.join(os.tmpdir(), 'beuk-next-does-not-exist'));
  t.after(s.close);
  assert.equal((await fetch(s.base + '/next/')).status, 404);
});

test('the app mounts it, Caddy proxies /next* to the app, and the image builds it', () => {
  assert.match(read('src/app.ts'), /app\.use\(nextStudioRoutes\(\)\);/);
  const caddy = read('Caddyfile');
  assert.ok(caddy.includes('handle /next* {\n\t\treverse_proxy app:3000\n\t}'), 'Caddyfile: handle /next* → app');
  // Before the studio's catch-all, so /next is never answered with 1.0's index.html.
  assert.ok(caddy.indexOf('handle /next* {') < caddy.indexOf('try_files {path} /index.html'));
  const docker = read('Dockerfile');
  assert.match(docker, /FROM node:24-slim AS studio/);
  assert.match(docker, /RUN cd studio && npm ci/);
  assert.match(docker, /RUN cd studio && npm run build/);
  assert.match(docker, /COPY --from=studio \/app\/client\/next \.\/client\/next/);
  // The build output and the extracted files are never committed.
  const ignore = read('.gitignore');
  for (const p of ['studio/node_modules/', 'studio/src/generated/', 'client/next/']) assert.ok(ignore.includes(p), p);
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['test:studio'], 'cd studio && npm ci && npx vitest run');
});
