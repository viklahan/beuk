import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { COMPARE_SLUGS } from '../src/routes/site.js';
import { createTestDb, startTestServer } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');

// The site pages beside the landing page: /features, /compare and /compare/<slug>.
const PAGES: { file: string[]; url: string }[] = [
  { file: ['client', 'site', 'features.html'], url: '/features' },
  { file: ['client', 'site', 'compare', 'index.html'], url: '/compare' },
  ...COMPARE_SLUGS.map((s) => ({ file: ['client', 'site', 'compare', `${s}.html`], url: `/compare/${s}` })),
];

// Same list as the landing page's test (tests/site.test.ts), plus claims these pages must never make.
const FALSE_CLAIMS = [
  /quietshelf/i, /open[- ]source/i, /zero-warning/i, /googleapis|gstatic/, /href="#"/, /data-cta/, /no features held back/i, /fare is free/i,
  /ten (stores|ports|export|presets|platform)/i, /six trim/i,
  // No price is decided: nothing may show or imply one for Beuk.
  /beuk[^.<]{0,60}(\$|€|£)\s?\d/i, /\/\s?month/i,
  /\bthe best\b/i, /\bbest-in-class\b/i, /!(?![-=\[])/,
];

test('the site pages exist, make no false claims, carry link previews and a canonical URL', () => {
  assert.deepEqual([...COMPARE_SLUGS], ['atticus', 'vellum', 'reedsy-studio', 'dabble']);
  for (const p of PAGES) {
    assert.ok(existsSync(path.join(root, ...p.file)), p.file.join('/'));
    const html = read(...p.file);
    // Text only (no tags, comments or scripts) for the copy rules.
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
    for (const bad of FALSE_CLAIMS.slice(0, 10)) assert.doesNotMatch(html, bad, `${p.url}: ${bad}`);
    for (const bad of FALSE_CLAIMS.slice(10)) assert.doesNotMatch(text, bad, `${p.url}: ${bad}`);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://beuk\\.studio${p.url.replace(/\//g, '\\/')}" />`), p.url);
    assert.match(html, new RegExp(`<meta property="og:url" content="https://beuk\\.studio${p.url.replace(/\//g, '\\/')}" />`), p.url);
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(html, new RegExp(`<meta property="${prop}" content="[^"]+"`), `${p.url} ${prop}`);
    assert.match(html, /<meta property="og:image" content="https:\/\/beuk\.studio\/site\/og\.png" \/>/, p.url);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/, p.url);
    assert.match(html, /<title>[^<]+ — Beuk<\/title>/, p.url);
    // Self-hosted fonts and the shared site stylesheet.
    assert.ok(html.includes('<link rel="stylesheet" href="/assets/fonts/fonts-site.css" />'), p.url);
    assert.ok(html.includes('<link rel="stylesheet" href="/site/site.css" />'), p.url);
    // The doors are the landing page's.
    assert.ok(html.includes('href="/studio"'), `${p.url} opens the studio`);
    for (const d of ['/features', '/compare', '/help', '/privacy', '/terms']) assert.ok(html.includes(`href="${d}"`), `${p.url} links ${d}`);
    // Beuk's price is the decided wording, never a number.
    if (p.url !== '/features') assert.ok(html.includes('7-day free trial, then one price — announced before launch'), `${p.url} states the price wording`);
  }
  assert.ok(read('client', 'site', 'features.html').includes('a 7-day free trial, then one price — announced before launch'));
});

test('every picture and stylesheet the site pages reference is a file of this origin; every studio picture has alt text and its real size', () => {
  for (const p of PAGES) {
    const html = read(...p.file);
    for (const m of html.matchAll(/(?:src|href)="(\/(?:site|assets)\/[^"?#]+)"/g)) assert.ok(existsSync(path.join(root, 'client', m[1])), `${p.url}: ${m[1]}`);
    assert.doesNotMatch(html, /<img [^>]*src="https?:/, `${p.url}: no remote images`);
  }
  const features = read('client', 'site', 'features.html');
  const imgs = [...features.matchAll(/<img ([^>]+)>/g)].map((m) => m[1]);
  assert.ok(imgs.length >= 9, `features has its screenshots (${imgs.length})`);
  for (const a of imgs) {
    const src = /src="([^"]+)"/.exec(a)?.[1] ?? '';
    assert.match(src, /^\/site\/shots\/[a-z-]+\.webp$/, src);
    const alt = /alt="([^"]*)"/.exec(a)?.[1] ?? '';
    assert.ok(alt.length > 40, `${src} has a real description`);
    // width/height match the WebP's own size (VP8/VP8L/VP8X header).
    const w = Number(/width="(\d+)"/.exec(a)?.[1]);
    const h = Number(/height="(\d+)"/.exec(a)?.[1]);
    const buf = readFileSync(path.join(root, 'client', src));
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF', src);
    assert.equal(buf.toString('ascii', 8, 12), 'WEBP', src);
    const kind = buf.toString('ascii', 12, 16);
    let dims: [number, number];
    if (kind === 'VP8 ') dims = [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    else if (kind === 'VP8L') {
      const b = buf.readUInt32LE(21);
      dims = [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
    } else dims = [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
    assert.deepEqual(dims, [w, h], `${src} is ${dims.join('×')}`);
    assert.ok(buf.length < 200_000, `${src} stays small (${buf.length} bytes)`);
  }
  // Beta-reader links need an account, so the page says there is no picture rather than faking one.
  assert.match(features, /No picture here yet\./);
});

test('every comparison page has a sources list of links to the vendor, with the date they were checked, and every fact mark points into it', () => {
  const vendorHost: Record<string, RegExp> = {
    atticus: /^https:\/\/www\.atticus\.io\//,
    vellum: /^https:\/\/vellum\.pub\//,
    'reedsy-studio': /^https:\/\/reedsy\.com\/studio/,
    dabble: /^https:\/\/www\.dabblewriter\.com\//,
  };
  for (const slug of COMPARE_SLUGS) {
    const html = read('client', 'site', 'compare', `${slug}.html`);
    const sources = /<section class="sources" id="sources"[\s\S]*?<ol>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? '';
    const items = [...sources.matchAll(/<li id="src-(\d+)"><a href="([^"]+)"[^>]*>[^<]+<\/a>[^<]*Checked 26 October 2026\.<\/li>/g)];
    assert.ok(items.length >= 1, `${slug}: a sources list`);
    assert.equal(items.length, (sources.match(/<li /g) ?? []).length, `${slug}: every source carries its link and the date`);
    for (const [, , url] of items) assert.match(url, vendorHost[slug], `${slug}: ${url} is the vendor's own site`);
    const ids = new Set(items.map((m) => m[1]));
    const marks = [...html.matchAll(/href="#src-(\d+)"/g)].map((m) => m[1]);
    assert.ok(marks.length >= 5, `${slug}: facts carry source marks`);
    for (const id of marks) assert.ok(ids.has(id), `${slug}: [${id}] is listed`);
    for (const id of ids) assert.ok(marks.includes(id), `${slug}: source ${id} is used`);
    assert.match(html, /checked 26 October 2026/, `${slug}: the date is visible above the table`);
    // Fair: says where the other tool is stronger, and what Beuk doesn't do.
    assert.match(html, /<h2 id="h-honest">Where [^<]+ is stronger<\/h2>/, slug);
    assert.match(html, /What Beuk doesn't do/, slug);
  }
  const index = read('client', 'site', 'compare', 'index.html');
  for (const slug of COMPARE_SLUGS) assert.ok(index.includes(`href="/compare/${slug}"`), `index links ${slug}`);
});

test('sitemap.xml lists /features, /compare and every comparison', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, { appBaseUrl: 'https://beuk.studio' });
  try {
    const xml = await (await fetch(`${server.base}/sitemap.xml`)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const p of PAGES) assert.ok(locs.includes(`https://beuk.studio${p.url}`), p.url);
    assert.equal(new Set(locs).size, locs.length, 'no duplicates');
    const robots = await (await fetch(`${server.base}/robots.txt`)).text();
    assert.doesNotMatch(robots, /Disallow: \/(features|compare)/);
  } finally {
    await server.close();
  }
});

test('Caddy serves each page at its exact path, and a trailing slash redirects to it', () => {
  const caddy = read('Caddyfile');
  for (const p of PAGES) {
    const target = '/' + p.file.slice(1).join('/');
    assert.ok(caddy.includes(`\tredir ${p.url}/ ${p.url} 308\n`), `${p.url}/ redirects`);
    assert.ok(
      caddy.includes(`\thandle ${p.url} {\n\t\theader Cache-Control "no-cache"\n\t\troot * /srv/client\n\t\trewrite * ${target}\n\t\tfile_server\n\t}\n`),
      `${p.url} → ${target}`,
    );
  }
  // The studio fallback for every other path stays last.
  assert.ok(caddy.indexOf('handle /compare/dabble {') < caddy.indexOf('try_files {path} /index.html'));
});

test('both service workers leave /features and /compare to the network', () => {
  for (const p of [['client', 'sw.js'], ['client', 'assets', 'sw.js']]) {
    const sw = read(...p);
    const re = /if \(url\.origin === self\.location\.origin && \/(\^\\\/\([^)]+\)\(\\\/\|\$\))\/\.test\(url\.pathname\)\) return;/.exec(sw);
    assert.ok(re, p.join('/'));
    const rx = new RegExp(re![1].replace(/\\\//g, '/'));
    for (const u of ['/features', '/compare', '/compare/', '/compare/vellum', '/compare/reedsy-studio']) assert.ok(rx.test(u), `${p.join('/')}: ${u}`);
    for (const u of ['/', '/studio', '/index.html', '/featuresx', '/compared']) assert.ok(!rx.test(u), `${p.join('/')}: not ${u}`);
  }
});

test('the landing page links Features and Compare in its top bar and footer', () => {
  const html = read('client', 'site', 'index.html');
  assert.equal((html.match(/href="\/features"/g) ?? []).length, 2);
  assert.equal((html.match(/href="\/compare"/g) ?? []).length, 2);
  assert.match(html, /<a class="nl" href="\/features">Features<\/a>\n\s+<a class="nl" href="\/compare">Compare<\/a>/);
  assert.match(html, /<a href="\/features">Features<\/a>\n\s+<a href="\/compare">Compare<\/a>/);
});
