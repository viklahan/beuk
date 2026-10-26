import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getHelpContent } from '../src/help/content.js';
import { createTestDb, startTestServer } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

test('robots.txt keeps the studio, the API, reading copies and reset out of search, and names the sitemap', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { appBaseUrl: 'https://beuk.studio' });
  try {
    const res = await fetch(`${server.base}/robots.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
    const body = await res.text();
    for (const p of ['/api/', '/read/', '/reset', '/studio', '/index.html', '/help/search']) assert.ok(body.includes(`Disallow: ${p}\n`), p);
    assert.match(body, /^Sitemap: https:\/\/beuk\.studio\/sitemap\.xml$/m);
  } finally {
    await server.close();
  }
});

test('sitemap.xml lists the landing page, every Help guide and error entry, and the legal pages; /support only while Ko-fi is set', async () => {
  const db = await createTestDb();
  for (const kofiUrl of [null, 'https://ko-fi.com/example']) {
    const server = await startTestServer(db, undefined, { appBaseUrl: 'https://beuk.studio', kofiUrl });
    try {
      const res = await fetch(`${server.base}/sitemap.xml`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /^application\/xml/);
      const xml = await res.text();
      assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const c = getHelpContent();
      const want = ['/', '/help', '/help/errors', '/changelog', '/roadmap', '/privacy', '/terms', ...c.guides.map((g) => `/help/${g.slug}`), ...c.errors.map((e) => `/help/errors/${e.code}`)];
      for (const p of want) assert.ok(locs.includes(`https://beuk.studio${p}`), p);
      assert.equal(locs.includes('https://beuk.studio/support'), kofiUrl !== null);
      assert.ok(!locs.some((l) => /\/(studio|read|api|reset)\b/.test(l)), 'no app shell, reading copy, API or reset page');
      assert.equal(new Set(locs).size, locs.length, 'no duplicates');
      assert.match(xml, /<loc>https:\/\/beuk\.studio\/help\/saving<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    } finally {
      await server.close();
    }
  }
});

test('the landing page: beuk.studio, no false claims, no font host, real doors, link previews, content visible without JavaScript', () => {
  const html = read('client', 'site', 'index.html');
  for (const bad of [/quietshelf/i, /open[- ]source/i, /zero-warning/i, /googleapis|gstatic/, /href="#"/, /data-cta/, /no features held back/i, /fare is free/i, /ten (stores|ports|export|presets|platform)/i, /six trim/i]) {
    assert.doesNotMatch(html, bad, String(bad));
  }
  assert.match(html, /<title>Beuk — your EPUB &amp; print studio<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/beuk\.studio\/" \/>/);
  for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(html, new RegExp(`<meta property="${prop}" content="[^"]+"`), prop);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  // Doors: start writing, sign in, start the free week — all into the studio.
  assert.match(html, /<a class="btn" href="\/studio">Start writing/);
  assert.match(html, /href="\/studio\?signin"/);
  assert.match(html, /href="\/studio\?signup">Start your free week<\/a>/);
  for (const p of ['/help', '/changelog', '/roadmap', '/privacy', '/terms']) assert.ok(html.includes(`href="${p}"`), `footer links ${p}`);
  // The scroll reveal only hides what its script will show.
  assert.match(html, /\.js \.reveal\{opacity:0/);
  assert.doesNotMatch(html, /(^|[^s] )\.reveal\{opacity:0/m);
  assert.match(html, /document\.documentElement\.className \+= " js"/);
  // A writer with a book on this device goes back to the studio; /?home shows the page.
  assert.match(html, /localStorage\.getItem\("beuk\.desk"\) === "1"\) location\.replace\("\/studio"\)/);
  // Its pictures and fonts are files of this origin.
  for (const m of html.matchAll(/(?:src|href)="(\/(?:site|assets)\/[^"]+)"/g)) assert.ok(existsSync(path.join(root, 'client', m[1])), m[1]);
});

test("the landing page's numbers are the studio's", () => {
  const html = read('client', 'site', 'index.html');
  const studio = read('client', 'index.html');
  const presets = /const PLATFORM_PRESETS = \[([\s\S]*?)\n\s*\];/.exec(studio)?.[1] ?? '';
  const presetIds = [...presets.matchAll(/\{ id: "([a-z0-9]+)"/g)].map((m) => m[1]);
  assert.equal(presetIds.length, 11, `11 presets: ${presetIds.join(', ')}`);
  assert.match(html, /<b>11<\/b><span>Store presets<\/span>/);
  assert.match(html, /<h3>Google Play Books<\/h3>/);
  const trims = /const TRIM_SIZES = \[([\s\S]*?)\];/.exec(studio)?.[1] ?? '';
  const trimIds = [...trims.matchAll(/\bid: "([0-9.x]+)"/g)].map((m) => m[1]);
  assert.equal(trimIds.length, 24, `24 trims: ${trimIds.join(', ')}`);
  assert.match(html, /<b>24<\/b><span>Trim sizes<\/span>/);
  const packs = /const LANG_PACKS = \{([\s\S]*?)\n {6}\};/.exec(studio)?.[1] ?? '';
  assert.equal((packs.match(/^\s+"[A-Za-z-]+":\s+\{ name:/gm) ?? []).length, 36, 'the book language list (Project Settings) has 36 entries');
  assert.match(html, /<b>36<\/b><span>Book languages<\/span>/);
});

test('fonts-site.css: Karla, Literata and IBM Plex Mono only, every file on disk', () => {
  const css = read('client', 'assets', 'fonts', 'fonts-site.css');
  const families = new Set([...css.matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...families].sort(), ['IBM Plex Mono', 'Karla', 'Literata']);
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 20);
  for (const u of urls) assert.ok(existsSync(path.join(root, 'client', 'assets', 'fonts', u)), u);
});

test('Caddy: / is the landing page (marked for the worker), /studio is the studio, robots and sitemap go to the app', () => {
  const caddy = read('Caddyfile');
  assert.match(caddy, /@landing path \/\n\thandle @landing \{\n\t\theader Cache-Control "no-cache"\n\t\theader X-Beuk-Page "landing"\n\t\troot \* \/srv\/client\n\t\trewrite \* \/site\/index\.html\n\t\tfile_server\n\t\}/);
  assert.match(caddy, /redir \/studio\/ \/studio 308\n\thandle \/studio \{\n\t\theader Cache-Control "no-cache"\n\t\troot \* \/srv\/client\n\t\trewrite \* \/index\.html\n\t\tfile_server\n\t\}/);
  for (const p of ['/robots.txt', '/sitemap.xml']) assert.ok(caddy.includes(`handle ${p} {\n\t\treverse_proxy app:3000\n\t}`), p);
  // The studio fallback for every other path stays, so old links still open it.
  assert.match(caddy, /try_files \{path\} \/index\.html/);
});

test('both service workers: the landing page is never cached as the studio; /studio refreshes the shell', () => {
  for (const p of [['client', 'sw.js'], ['client', 'assets', 'sw.js']]) {
    const sw = read(...p);
    assert.match(sw, /url\.pathname === shellDir \+ "studio"/, p.join('/'));
    assert.match(sw, /res\.headers\.get\("X-Beuk-Page"\) !== "landing"/, p.join('/'));
    assert.match(sw, /\(help\|support\|thanks\|changelog\|roadmap\|privacy\|terms\|site\|robots\\\.txt\|sitemap\\\.xml\)/, p.join('/'));
  }
  assert.match(read('client', 'assets', 'manifest.webmanifest'), /"start_url":"\.\.\/studio"/);
});

test('the studio opens the landing page doors and marks a desk that has been written on', () => {
  const studio = read('client', 'index.html');
  assert.match(studio, /function studioDoorFromUrl\(\) \{/);
  assert.match(studio, /door = q\.has\("signup"\) \? "register" : q\.has\("signin"\) \? "login" : null;/);
  assert.match(studio, /if \(!up\) \{ cloudGoLocal\(\); studioDoorFromUrl\(\); return; \}/);
  assert.match(studio, /if \(local\.realEdits > 0\) \{ try \{ localStorage\.setItem\("beuk\.desk", "1"\); \} catch \(e\) \{\} \}/);
});

test('Help pages carry link previews over the site image, on APP_BASE_URL', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { appBaseUrl: 'https://beuk.studio' });
  try {
    for (const p of ['/help/', '/help/saving', '/help/errors']) {
      const html = await (await fetch(`${server.base}${p}`)).text();
      assert.match(html, /<meta property="og:title" content="[^"]+" \/>/, p);
      assert.match(html, /<meta property="og:image" content="https:\/\/beuk\.studio\/site\/og\.png" \/>/, p);
      assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/, p);
    }
  } finally {
    await server.close();
  }
});
