import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { loadConfig } from '../src/config.js';
import { studioRoutes } from '../src/routes/studio.js';
import { createTestDb, startTestServer } from './helpers.js';

/* The studio is Beuk 2.0 (React) at /studio/ (spec 2026-11-12-studio-2-cutover, D1–D3): Caddy proxies
   /studio and /studio/* to the app, which serves the image's build of studio/ (client/next/). 2.0's page
   answers at /studio AND at /studio/ (final review C2: no redirect between the two, in either mode, so a
   browser's cached permanent redirect can never loop), the query kept; the page tidies /studio to /studio/
   itself. The old /next address redirects (308, no-cache) to the same path under /studio/.
   STUDIO_CLASSIC=true is the emergency rollback: 1.0's client/index.html at /studio, as Caddy served it
   before the switch, and /studio/… → 302 (no-store) /studio. */

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
/** A redirect, with its Cache-Control (final review C2: never cached for ever). */
async function redirect(url: string): Promise<[number, string | null, string | null]> {
  const r = await fetch(url, manual);
  return [r.status, r.headers.get('location'), r.headers.get('cache-control')];
}

test('/studio/ serves the 2.0 build: index, immutable hashed assets, the app\'s own routes, loud 404s', async (t) => {
  const s = await serve({ dir: fakeBuild(t) });
  t.after(s.close);

  // 2.0's page at both addresses: /studio is not redirected (final review C2), the query is the page's own (the doors
  // ?signin, ?signup, ?book=<uuid>), and the page tidies its address to /studio/ itself (studio/index.html).
  for (const p of ['/studio', '/studio?book=abc&x=1', '/studio?signin', '/studio/', '/studio/?signup', '/studio/book/abc', '/studio/index.html']) {
    const r = await fetch(s.base + p, manual);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('location'), null, p);
    assert.match(await r.text(), /id="root"/, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache', p);
    assert.match(r.headers.get('content-type') ?? '', /^text\/html/, p);
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
  // the worker's scope is /studio (both addresses; studio/src/sw-register.ts), wider than its folder: allowed by header
  assert.equal((await fetch(s.base + '/studio/sw.js')).headers.get('service-worker-allowed'), '/studio');
  assert.equal((await fetch(s.base + '/studio/sw-precache.js')).headers.get('service-worker-allowed'), null);

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
  // final review C2: a browser never keeps it for ever
  assert.deepEqual(await redirect(s.base + '/next?x=1'), [308, '/studio/?x=1', 'no-cache']);
  assert.deepEqual(await redirect(s.base + '/next/foo?q'), [308, '/studio/foo?q', 'no-cache']);
  assert.deepEqual(await location(s.base + '/next'), [308, '/studio/']);
  assert.deepEqual(await location(s.base + '/next?x=1'), [308, '/studio/?x=1']);
  assert.deepEqual(await location(s.base + '/next/'), [308, '/studio/']);
  assert.deepEqual(await location(s.base + '/next/foo?q'), [308, '/studio/foo?q']);
  assert.deepEqual(await location(s.base + '/next/?book=abc&x=1'), [308, '/studio/?book=abc&x=1']);
  assert.deepEqual(await location(s.base + '/next/assets/index-AbC123.js'), [308, '/studio/assets/index-AbC123.js']);
  // Review M3: the Location is always a same-origin path under /studio/, never another host.
  assert.deepEqual(await location(s.base + '/next//evil.example'), [308, '/studio//evil.example']);
  assert.deepEqual(await location(s.base + '/next/%5Cevil.example'), [308, '/studio/%5Cevil.example']);
  // Exact paths only: /nextbook is not /next.
  assert.equal((await fetch(s.base + '/nextbook', manual)).status, 404);
});

test('/studio and /studio/ without a build on disk fall through (404), they never throw', async (t) => {
  const s = await serve({ dir: path.join(os.tmpdir(), 'beuk-studio-does-not-exist') });
  t.after(s.close);
  assert.equal((await fetch(s.base + '/studio/', manual)).status, 404);
  assert.equal((await fetch(s.base + '/studio?signin', manual)).status, 404);
});

test('STUDIO_CLASSIC: /studio is 1.0 (no-cache, as Caddy sent it), /studio/ → 302 (no-store) /studio, 2.0\'s build is not served', async (t) => {
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
  // final review C2: a temporary redirect, never stored, so flipping back to 2.0 can't loop on a cached one
  assert.deepEqual(await redirect(s.base + '/studio/'), [302, '/studio', 'no-store']);
  assert.deepEqual(await redirect(s.base + '/studio/?book=abc&x=1'), [302, '/studio?book=abc&x=1', 'no-store']);
  // 2.0's own routes land on 1.0 too, never on 2.0
  assert.deepEqual(await redirect(s.base + '/studio/book/abc'), [302, '/studio', 'no-store']);
  // 2.0's files are not served in this mode (its worker's update check finds no worker)
  for (const p of ['/studio/assets/index-AbC123.js', '/studio/sw.js', '/studio/index.html']) assert.equal((await fetch(s.base + p, manual)).status, 404, p);
  // /next still goes under /studio/ (and from there to /studio)
  assert.deepEqual(await redirect(s.base + '/next/foo?q'), [308, '/studio/foo?q', 'no-cache']);
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
    // no redirect at /studio (this tree may hold no build: 200 with 2.0's page, else the 404 fall-through)
    assert.equal((await location(two.base + '/studio?book=abc&x=1'))[1], null);
    assert.deepEqual(await redirect(two.base + '/next/foo?q'), [308, '/studio/foo?q', 'no-cache']);
    assert.deepEqual(await redirect(two.base + '/next'), [308, '/studio/', 'no-cache']);
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
    assert.deepEqual(await redirect(one.base + '/studio/?book=abc'), [302, '/studio?book=abc', 'no-store']);
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
  // Before the static mount's catch-all, so /studio/ is never answered by it.
  assert.ok(caddy.indexOf('handle @studio {') < caddy.indexOf('# === STATIC CLIENT ==='));
  assert.ok(caddy.indexOf('handle @next {') < caddy.indexOf('# === STATIC CLIENT ==='));
  // Review C1: the catch-all never serves 1.0 (client/index.html) any more. /index.html → 308 /studio (query kept);
  // a missing path without an extension → 302 /studio (no slash: the app decides 2.0 or the rollback; query kept);
  // a missing path with an extension → file_server's plain 404; an existing static file is served as before.
  assert.ok(!caddy.includes('try_files {path} /index.html'), 'no SPA fallback to 1.0');
  assert.ok(!/try_files/.test(caddy.slice(caddy.indexOf('# === STATIC CLIENT ==='))), 'no try_files in the catch-all');
  assert.ok(
    caddy.includes(
      '\thandle {\n' +
        '\t\t# Revalidate on every load (cheap 304 via ETag) so a deploy reaches\n' +
        '\t\t# writers immediately instead of a heuristically cached old file.\n' +
        '\t\theader Cache-Control "no-cache"\n' +
        '\t\troot * /srv/client\n' +
        '\t\t@oldStudio path /index.html\n' +
        '\t\tredir @oldStudio /studio{?query} 308\n' +
        '\t\t@missingPage {\n' +
        '\t\t\tnot file\n' +
        '\t\t\tnot path_regexp \\.[^/]+$\n' +
        '\t\t}\n' +
        '\t\tredir @missingPage /studio{?query} 302\n' +
        '\t\tfile_server\n' +
        '\t}\n}',
    ),
    'the catch-all: /index.html 308, a missing extensionless path 302, everything else file_server (404 when missing)',
  );
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

test("review I2: 2.0's own manifest, the same app as 1.0's install (same id), starting at /studio/", () => {
  const one = JSON.parse(read('client/assets/manifest.webmanifest')) as Record<string, unknown>;
  const two = JSON.parse(read('studio/public/manifest.webmanifest')) as Record<string, unknown>;
  // the same app to the writer: every field but the addresses is 1.0's
  for (const k of ['name', 'short_name', 'description', 'background_color', 'theme_color', 'display', 'orientation', 'lang']) {
    assert.deepEqual(two[k], one[k], k);
  }
  assert.equal(two.id, '/');
  assert.equal(two.start_url, '/studio/');
  assert.equal(two.scope, '/');
  // icons: 1.0's three, by absolute path (the files at the site root), same sizes, types and purposes
  const oneIcons = (one.icons as { src: string }[]).map((i) => ({ ...i, src: '/assets/' + i.src }));
  assert.deepEqual(two.icons, oneIcons);
  for (const i of oneIcons) assert.ok(existsSync(path.join(root, 'client', i.src)), i.src);

  // W3C Web Application Manifest, as browsers process them (manifest URL as the base for start_url and scope):
  const site = 'https://beuk.studio';
  const oneUrl = site + '/assets/manifest.webmanifest';
  const twoUrl = site + '/studio/manifest.webmanifest';
  const oneStart = new URL(one.start_url as string, oneUrl);
  const twoStart = new URL(two.start_url as string, twoUrl);
  // §1.11 "Processing the id member": 1.0 has no id, so its id is its start_url; 2.0's id is parsed against its
  // start_url's ORIGIN, must be same-origin, and loses its fragment
  assert.equal(one.id, undefined);
  const oneId = oneStart.href;
  const twoId = new URL(two.id as string, twoStart.origin);
  assert.equal(twoId.origin, twoStart.origin);
  twoId.hash = '';
  assert.equal(twoId.href, oneId, 'the same id: an existing install is this app, not a second one');
  // §1.6 "Processing the scope member" + §5 "within scope": start_url must be within scope (same origin, its path
  // starts with the scope's path), or the scope falls back to the start_url's folder
  const twoScope = new URL(two.scope as string, twoUrl);
  assert.equal(twoStart.origin, twoScope.origin);
  assert.ok(twoStart.pathname.startsWith(twoScope.pathname));
  // the CSP's manifest-src 'self': same origin
  assert.equal(new URL(twoUrl).origin, site);

  // 2.0's page links it at the build's base; 1.0's manifest is untouched (the studio-dir-only hosting uses it)
  assert.match(read('studio/index.html'), /<link rel="manifest" href="%BASE_URL%manifest\.webmanifest" \/>/);
  assert.equal(one.start_url, '../');
  assert.equal(one.scope, '../');
});

test('the manifest is served under /studio/ with no-cache, as a manifest', async (t) => {
  const dir = fakeBuild(t);
  writeFileSync(path.join(dir, 'manifest.webmanifest'), read('studio/public/manifest.webmanifest'));
  const s = await serve({ dir });
  t.after(s.close);
  const r = await fetch(s.base + '/studio/manifest.webmanifest');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.match(r.headers.get('content-type') ?? '', /^application\/manifest\+json/);
  assert.equal((JSON.parse(await r.text()) as { id: string }).id, '/');
});
