import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { loadConfig } from '../src/config.js';
import { studioRoutes } from '../src/routes/studio.js';
import { createTestDb, startTestServer } from './helpers.js';

/* The studio is Beuk 2.0 (React) at /studio/ (spec 2026-11-12-studio-2-cutover, D1–D3): Caddy proxies
   /studio and /studio/* to the app, which serves the image's build of studio/ (client/next/). /studio
   redirects to /studio/ (the service worker's scope), keeping the query (?signin, ?signup, ?book=…), and
   the old /next address redirects to the same path under /studio/. STUDIO_CLASSIC=true is the
   emergency rollback: 1.0's client/index.html at /studio, as Caddy served it before the switch. */

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

async function serve(opts: Parameters<typeof studioRoutes>[0]) {
  const app = express();
  app.use(studioRoutes(opts));
  app.use((_req, res) => res.status(404).send('nope'));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** A build on disk, as the image's studio stage leaves it in client/next/. */
function fakeBuild(t: { after: (f: () => void) => void }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-studio-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'assets'));
  mkdirSync(path.join(dir, '.vite'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dir, 'assets', 'index-AbC123.js'), 'console.log(1)');
  writeFileSync(path.join(dir, 'sw.js'), '/* sw */');
  writeFileSync(path.join(dir, 'sw-precache.js'), 'self.BEUK_NEXT = {};');
  writeFileSync(path.join(dir, '.vite', 'manifest.json'), '{}');
  return dir;
}

const manual = { redirect: 'manual' } as const;
async function location(url: string): Promise<[number, string | null]> {
  const r = await fetch(url, manual);
  return [r.status, r.headers.get('location')];
}

test('/studio/ serves the 2.0 build: index, immutable hashed assets, the app\'s own routes, loud 404s', async (t) => {
  const s = await serve({ dir: fakeBuild(t) });
  t.after(s.close);

  // /studio → /studio/ (308, the query kept: the doors ?signin, ?signup, ?book=<uuid> survive it)
  assert.deepEqual(await location(s.base + '/studio'), [308, '/studio/']);
  assert.deepEqual(await location(s.base + '/studio?book=abc&x=1'), [308, '/studio/?book=abc&x=1']);
  assert.deepEqual(await location(s.base + '/studio?signin'), [308, '/studio/?signin']);

  for (const p of ['/studio/', '/studio/?signup', '/studio/book/abc', '/studio/index.html']) {
    const r = await fetch(s.base + p, manual);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /id="root"/, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
  }
  const js = await fetch(s.base + '/studio/assets/index-AbC123.js');
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(js.headers.get('content-type') ?? '', /javascript/);

  // the worker and its precache list revalidate on every load, so a deploy reaches the writer at once
  for (const p of ['/studio/sw.js', '/studio/sw-precache.js']) {
    const r = await fetch(s.base + p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
  }

  // A missing file is a 404, never the page; the build manifest is not served.
  assert.equal((await fetch(s.base + '/studio/assets/gone-123.js')).status, 404);
  assert.equal((await fetch(s.base + '/studio/.vite/manifest.json')).status, 404);
  // Exact paths only: /studiofoo is not the studio.
  assert.equal((await fetch(s.base + '/studiofoo', manual)).status, 404);
  assert.equal((await fetch(s.base + '/studio.html', manual)).status, 404);
});

test('the old /next address: 308 to the same path under /studio/, the query kept', async (t) => {
  const s = await serve({ dir: fakeBuild(t) });
  t.after(s.close);
  assert.deepEqual(await location(s.base + '/next'), [308, '/studio/']);
  assert.deepEqual(await location(s.base + '/next?x=1'), [308, '/studio/?x=1']);
  assert.deepEqual(await location(s.base + '/next/'), [308, '/studio/']);
  assert.deepEqual(await location(s.base + '/next/foo?q'), [308, '/studio/foo?q']);
  assert.deepEqual(await location(s.base + '/next/?book=abc&x=1'), [308, '/studio/?book=abc&x=1']);
  assert.deepEqual(await location(s.base + '/next/assets/index-AbC123.js'), [308, '/studio/assets/index-AbC123.js']);
  // Exact paths only: /nextbook is not /next.
  assert.equal((await fetch(s.base + '/nextbook', manual)).status, 404);
});

test('/studio/ without a build on disk falls through (404), it never throws; /studio still redirects', async (t) => {
  const s = await serve({ dir: path.join(os.tmpdir(), 'beuk-studio-does-not-exist') });
  t.after(s.close);
  assert.equal((await fetch(s.base + '/studio/', manual)).status, 404);
  assert.deepEqual(await location(s.base + '/studio?signin'), [308, '/studio/?signin']);
});

test('STUDIO_CLASSIC: /studio is 1.0 (no-cache, as Caddy sent it), /studio/ → /studio, 2.0\'s build is not served', async (t) => {
  const dir = fakeBuild(t);
  const classicFile = path.join(dir, '..', path.basename(dir) + '-classic.html');
  writeFileSync(classicFile, '<!doctype html><title>Beuk 1.0</title>');
  t.after(() => rmSync(classicFile, { force: true }));
  const s = await serve({ dir, classic: true, classicFile });
  t.after(s.close);

  for (const p of ['/studio', '/studio?signin', '/studio?book=abc&x=1']) {
    const r = await fetch(s.base + p, manual);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /Beuk 1\.0/, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
    assert.match(r.headers.get('content-type') ?? '', /^text\/html/, p);
  }
  assert.deepEqual(await location(s.base + '/studio/'), [308, '/studio']);
  assert.deepEqual(await location(s.base + '/studio/?book=abc&x=1'), [308, '/studio?book=abc&x=1']);
  // 2.0's own routes land on 1.0 too, never on 2.0
  assert.deepEqual(await location(s.base + '/studio/book/abc'), [308, '/studio']);
  // 2.0's files are not served in this mode (its worker's update check finds no worker)
  for (const p of ['/studio/assets/index-AbC123.js', '/studio/sw.js', '/studio/index.html']) assert.equal((await fetch(s.base + p, manual)).status, 404, p);
  // /next still goes under /studio/ (and from there to /studio)
  assert.deepEqual(await location(s.base + '/next/foo?q'), [308, '/studio/foo?q']);
  assert.equal((await fetch(s.base + '/studiofoo', manual)).status, 404);
});

test('the app: STUDIO_CLASSIC off by default; both modes through the real app (PGlite), 1.0 from client/index.html', async () => {
  assert.equal(loadConfig({}).studioClassic, false);
  assert.equal(loadConfig({ STUDIO_CLASSIC: 'true' }).studioClassic, true);
  assert.equal(loadConfig({ STUDIO_CLASSIC: 'TRUE' }).studioClassic, true);
  assert.equal(loadConfig({ STUDIO_CLASSIC: '1' }).studioClassic, false);
  const db = await createTestDb();

  const two = await startTestServer(db);
  try {
    assert.deepEqual(await location(two.base + '/studio?book=abc&x=1'), [308, '/studio/?book=abc&x=1']);
    assert.deepEqual(await location(two.base + '/next/foo?q'), [308, '/studio/foo?q']);
    assert.deepEqual(await location(two.base + '/next'), [308, '/studio/']);
  } finally {
    await two.close();
  }

  const one = await startTestServer(db, undefined, { studioClassic: true });
  try {
    const r = await fetch(one.base + '/studio?signin', manual);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    const html = await r.text();
    assert.equal(html, read('client/index.html'), "1.0's index.html, byte for byte");
    assert.deepEqual(await location(one.base + '/studio/?book=abc'), [308, '/studio?book=abc']);
  } finally {
    await one.close();
  }
});

test('the app mounts it, Caddy proxies /studio, /studio/* and /next* to the app (no CSP change), and the image builds it', () => {
  assert.match(read('src/app.ts'), /app\.use\(studioRoutes\(\{ classic: config\.studioClassic \}\)\);/);
  const caddy = read('Caddyfile');
  assert.ok(caddy.includes('\t@studio path /studio /studio/*\n\thandle @studio {\n\t\treverse_proxy app:3000\n\t}'), 'Caddyfile: @studio (/studio, /studio/*) → app');
  assert.ok(caddy.includes('\t@next path /next /next/*\n\thandle @next {\n\t\treverse_proxy app:3000\n\t}'), 'Caddyfile: @next (/next, /next/*) → app, which redirects it');
  // the old static studio is gone: no rewrite of /studio to 1.0, no /studio/ → /studio redirect
  assert.ok(!caddy.includes('handle /studio {'), 'no static handle /studio');
  assert.ok(!caddy.includes('redir /studio/ /studio 308'), 'no /studio/ → /studio redirect');
  assert.ok(!/handle \/studio\*|handle \/next\*/.test(caddy), 'no bare /studio* or /next* prefix (it would take /studiofoo, /nextbook)');
  // Before the catch-all, so /studio/ is never answered with the static mount.
  assert.ok(caddy.indexOf('handle @studio {') < caddy.indexOf('try_files {path} /index.html'));
  assert.ok(caddy.indexOf('handle @next {') < caddy.indexOf('try_files {path} /index.html'));
  // No CSP change (constraints): the one policy line is exactly as it was.
  const csp = caddy.split('\n').filter((l) => l.includes('Content-Security-Policy "'));
  assert.deepEqual(csp, [
    "\theader ?Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https://images.pexels.com https://api.openverse.org; connect-src 'self' https://images.pexels.com https://api.openverse.org; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; frame-src 'self' blob:; form-action 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; report-uri /api/csp-report; report-to csp\"",
  ]);
  const docker = read('Dockerfile');
  assert.match(docker, /FROM node:24-slim AS studio/);
  assert.match(docker, /RUN cd studio && npm ci/);
  assert.match(docker, /RUN cd studio && npm run build/);
  assert.match(docker, /COPY --from=studio \/app\/client\/next \.\/client\/next/);
  // STUDIO_CLASSIC serves 1.0 from the image: client/ (index.html included) is in it.
  assert.match(docker, /^COPY client \.\/client$/m);
  // the build's base is the studio's address
  const vite = read('studio/vite.config.ts');
  assert.match(vite, /\nexport const STUDIO_BASE = '\/studio\/';\n/);
  assert.match(vite, /\n  base: STUDIO_BASE,\n/);
  // The build output and the extracted files are never committed.
  const ignore = read('.gitignore');
  for (const p of ['studio/node_modules/', 'studio/src/generated/', 'client/next/']) assert.ok(ignore.includes(p), p);
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['test:studio'], 'cd studio && npm ci && npx vitest run');
  // the rollback setting is documented where a deploy sets it
  assert.match(read('.env.example'), /^STUDIO_CLASSIC=false$/m);
  assert.match(read('docker-compose.yml'), /^\s+STUDIO_CLASSIC: \$\{STUDIO_CLASSIC:-false\}$/m);
});

test("1.0's assets copy of its worker still leaves /next alone, and 2.0's worker keeps its beuk-next- caches", () => {
  // client/sw.js (scope /) retires itself (tests/sw-retire.test.ts). client/assets/sw.js is 1.0's fallback copy
  // (registered only where the root copy cannot be: its scope /assets/ controls no studio page), kept as it was.
  const sw = read('client/assets/sw.js');
  const head = 'if (url.origin === self.location.origin && /';
  const at = sw.indexOf(head);
  assert.ok(at !== -1, 'the server-pages passthrough');
  const end = sw.indexOf('/.test(url.pathname)) return;', at);
  const rx = new RegExp(sw.slice(at + head.length, end));
  for (const u of ['/next', '/next/', '/next/assets/index-1.js', '/next/sw.js']) assert.ok(rx.test(u), `${u} passes through`);
  assert.ok(sw.includes('keys.filter((k) => k !== BEUK_CACHE && k !== BEUK_SOUND_CACHE && k.indexOf("beuk-next-") !== 0)'), 'activate keeps beuk-next-*');
  // The 2.0 worker's cache names keep their prefix (spec D4: renaming them would throw away warm caches).
  assert.ok(read('studio/public/sw.js').includes("const PREFIX = 'beuk-next-';"));
});
