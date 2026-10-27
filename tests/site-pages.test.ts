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
  { file: ['client', 'site', 'ramp.html'], url: '/ramp' },
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
  assert.deepEqual([...COMPARE_SLUGS], ['atticus', 'vellum', 'reedsy-studio', 'dabble', 'scrivener', 'novelcrafter']);
  for (const p of PAGES) {
    assert.ok(existsSync(path.join(root, ...p.file)), p.file.join('/'));
    const html = read(...p.file);
    // Text only (no tags, comments or scripts) for the copy rules.
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
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
    scrivener: /^https:\/\/www\.literatureandlatte\.com\//,
    novelcrafter: /^https:\/\/www\.novelcrafter\.com\//,
  };
  for (const slug of COMPARE_SLUGS) {
    const html = read('client', 'site', 'compare', `${slug}.html`);
    const sources = /<section class="sources" id="sources"[\s\S]*?<ol>([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? '';
    const checked = /checked (\d{1,2} [A-Z][a-z]+ 20\d\d)/.exec(html)?.[1] ?? '';
    assert.ok(checked, `${slug}: the date it was checked is visible above the table`);
    const items = [...sources.matchAll(new RegExp(`<li id="src-(\\d+)"><a href="([^"]+)"[^>]*>[^<]+<\\/a>[^<]*Checked ${checked}\\.<\\/li>`, 'g'))];
    assert.ok(items.length >= 1, `${slug}: a sources list`);
    assert.equal(items.length, (sources.match(/<li /g) ?? []).length, `${slug}: every source carries its link and the date`);
    for (const [, , url] of items) assert.match(url, vendorHost[slug], `${slug}: ${url} is the vendor's own site`);
    const ids = new Set(items.map((m) => m[1]));
    const marks = [...html.matchAll(/href="#src-(\d+)"/g)].map((m) => m[1]);
    assert.ok(marks.length >= 5, `${slug}: facts carry source marks`);
    for (const id of marks) assert.ok(ids.has(id), `${slug}: [${id}] is listed`);
    for (const id of ids) assert.ok(marks.includes(id), `${slug}: source ${id} is used`);
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

test('the landing page links Features, Ramp and Compare in its top bar and footer', () => {
  const html = read('client', 'site', 'index.html');
  assert.equal((html.match(/href="\/features"/g) ?? []).length, 2);
  assert.equal((html.match(/href="\/ramp"/g) ?? []).length, 2);
  assert.equal((html.match(/href="\/compare"/g) ?? []).length, 2);
  assert.match(html, /<a class="nl" href="\/features">Features<\/a>\n\s+<a class="nl" href="\/ramp">Ramp<\/a>\n\s+<a class="nl" href="\/compare">Compare<\/a>/);
  assert.match(html, /<a href="\/features">Features<\/a>\n\s+<a href="\/ramp">Ramp<\/a>\n\s+<a href="\/compare">Compare<\/a>/);
});

test('the landing top bar hides nothing of its own: the two in-page links it gave up are still in the footer', () => {
  const html = read('client', 'site', 'index.html');
  const bar = /<nav[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  assert.ok(bar.includes('href="/features"') && bar.includes('href="/compare"'), 'the top bar links the new pages');
  assert.ok(!bar.includes('href="#ports"') && !bar.includes('href="#manifest"'), 'no hidden links left in the top bar');
  assert.doesNotMatch(html, /a\.nl\[href[^\]]*\]\{display:none\}/, 'no top-bar link hidden by CSS');
  assert.doesNotMatch(html, /a\.nl\[href[^\]]*\]\s*\{display:none\}/);
  for (const a of ['#ports', '#manifest', '#helm']) assert.ok(html.includes(`<a href="${a}">`), `footer keeps ${a}`);
});

test("the site pages' numbers are the studio's", () => {
  const studio = read('client', 'index.html');
  const themes = /const PRESETS = \[([\s\S]*?)\n\s*\];/.exec(studio)?.[1] ?? '';
  const themeIds = [...themes.matchAll(/^\s+\{ id: "([a-z0-9-]+)", genre:/gm)].map((m) => m[1]);
  const layouts = [...(/const COVER_LAYOUTS = \[([^\]]*)\]/.exec(studio)?.[1] ?? '').matchAll(/"([a-z]+)"/g)];
  const platforms = /const PLATFORM_PRESETS = \[([\s\S]*?)\n\s*\];/.exec(studio)?.[1] ?? '';
  const presetIds = [...platforms.matchAll(/\{ id: "([a-z0-9]+)"/g)];
  const trims = [...(/const TRIM_SIZES = \[([\s\S]*?)\];/.exec(studio)?.[1] ?? '').matchAll(/\bid: "([0-9.x]+)"/g)];
  const packs = /const LANG_PACKS = \{([\s\S]*?)\n {6}\};/.exec(studio)?.[1] ?? '';
  const bookLangs = (packs.match(/^\s+"[A-Za-z-]+":\s+\{ name:/gm) ?? []).length;
  const uiLangs = [...(/const UI_LANG_ORDER = \[([^\]]*)\]/.exec(studio)?.[1] ?? '').matchAll(/"([A-Za-z-]+)"/g)];
  assert.equal(themeIds.length, 15, `15 themes: ${themeIds.join(', ')}`);
  assert.equal(layouts.length, 7, '7 cover layouts');
  assert.equal(presetIds.length, 11, '11 store presets');
  assert.equal(trims.length, 24, '24 trims');
  assert.equal(bookLangs, 36, '36 book languages');
  assert.equal(uiLangs.length, 13, '13 studio languages');
  const WORDS: Record<string, number> = { seven: 7, eleven: 11, thirteen: 13, fifteen: 15 };
  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()] ?? NaN);
  // Every "N themes / layouts / presets / trim sizes / languages" on Beuk's side must match.
  const checks: [RegExp, number][] = [
    [/\b(\d+|[A-Za-z]+)(?: full-book)? themes\b/g, themeIds.length],
    [/\b(\d+|[A-Za-z]+) layouts\b/g, layouts.length],
    [/\b(\d+|[A-Za-z]+)(?: EPUB)?(?: store)? presets\b/g, presetIds.length],
    [/\b(\d+|[A-Za-z]+) book languages\b/g, bookLangs],
    [/speaks (\d+|[A-Za-z]+) languages\b/g, uiLangs.length],
  ];
  let seen = 0;
  for (const p of PAGES) {
    // Beuk's side only: the other tool's table cells hold that tool's own sourced numbers (Vellum's 24 trims).
    const text = read(...p.file)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<td data-label="(?!Beuk")[^"]*">[\s\S]*?<\/td>/g, '')
      .replace(/<[^>]+>/g, ' ');
    for (const [re, want] of checks) {
      for (const m of text.matchAll(re)) {
        const n = num(m[1]);
        if (Number.isNaN(n)) continue; // "Theme presets", "its store presets": no number
        seen++;
        assert.equal(n, want, `${p.url}: "${m[0]}" should say ${want}`);
      }
    }
    for (const m of text.matchAll(/\b(\d+) trim sizes\b/g)) assert.equal(Number(m[1]), trims.length, `${p.url}: "${m[0]}"`);
  }
  assert.ok(seen >= 15, `the counts were found on the pages (${seen})`);
});

test('the pages say what is free and what makes a PDF/X file the way the studio does', () => {
  const features = read('client', 'site', 'features.html');
  // Beuk's server makes PDF/X-1a for signed-in writers (README "Jobs (M5)"), so no page may say Beuk can't.
  for (const p of PAGES) {
    const text = read(...p.file).replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /does not (export a PDF directly|make PDF\/X files in the browser)/, p.url);
    assert.doesNotMatch(text, /no free tier after/i, p.url);
    assert.doesNotMatch(text, /one price after a free week|a free week, then one price\./i, p.url);
  }
  assert.match(features, /with an account, Beuk's server converts the print interior to PDF\/X-1a/);
  assert.match(features, /<li><b>PDF\/X-1a print conversion<\/b> on Beuk's server/);
  assert.match(features, /Everything above works on your device with no account at all, except the parts marked “with an account”\./);
  const vellum = read('client', 'site', 'compare', 'vellum.html');
  const stronger = /Where Vellum is stronger<\/h2>([\s\S]*?)<\/ul>/.exec(vellum)?.[1] ?? '';
  assert.doesNotMatch(stronger, /PDF\/X/, 'PDF/X is not a Vellum-only strength');
  assert.match(vellum, /Checks on Beuk's server<\/b>, with an account: the print interior converted to PDF\/X-1a, and your EPUB run through the official EPUBCheck\./);
  for (const slug of ['atticus', 'reedsy-studio']) {
    assert.match(read('client', 'site', 'compare', `${slug}.html`), /With an account, Beuk's server converts the print interior to PDF\/X-1a\./, slug);
    assert.match(read('client', 'site', 'compare', `${slug}.html`), /Writing and exporting on your device need no Beuk account/, slug);
  }
});

test('Ramp: every book opens on four spreads printed by Beuk, each a real WebP of the size the reader states, each described', () => {
  const html = read('client', 'site', 'ramp.html');
  const books = [...html.matchAll(/"([a-z-]+)": \{ title: "([^"]+)", c: "(#[0-9a-f]{6})", w: (\d+), h: (\d+), spreads: \[([\s\S]*?)\]\}/g)];
  assert.deepEqual(books.map((b) => b[1]), ['rain-on-calder-street', 'four-kitchens', 'the-sunken-vault', 'lunas-beach-treasure-hunt', 'salt-road', 'the-book-that-reads-you', 'the-woolly-school', 'the-travel-guide']);
  for (const [, slug, title, , w, h, body] of books) {
    const spreads = [...body.matchAll(/\["([^"]+)", "([^"]+)"\]/g)];
    assert.equal(spreads.length, 4, `${slug}: four spreads (a book ends in four turns)`);
    spreads.forEach(([, caption, alt], i) => {
      assert.ok(caption.length > 30, `${slug} spread ${i + 1} has a caption`);
      assert.ok(alt.length > 40, `${slug} spread ${i + 1} is described`);
      for (const t of [caption, alt]) assert.doesNotMatch(t, /!/, `${slug} spread ${i + 1}: no exclamation marks in the copy`);
      const file = path.join(root, 'client', 'site', 'ramp', slug, `spread-${i + 1}.webp`);
      assert.ok(existsSync(file), file);
      const buf = readFileSync(file);
      assert.equal(buf.toString('ascii', 8, 12), 'WEBP', file);
      const kind = buf.toString('ascii', 12, 16);
      const dims = kind === 'VP8 ' ? [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]
        : kind === 'VP8L' ? [(buf.readUInt32LE(21) & 0x3fff) + 1, ((buf.readUInt32LE(21) >> 14) & 0x3fff) + 1]
        : [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
      assert.deepEqual(dims, [Number(w), Number(h)], `${file} is ${dims.join('×')}`);
      assert.ok(buf.length < 400_000, `${file} stays small (${buf.length} bytes)`);
    });
    assert.ok(html.includes(`data-book="${slug}"`) && html.includes(`aria-label="Open ${title}"`), `${slug} is on the shelf`);
  }
  // Honest provenance: printed by Beuk's renderer, pictures made with AI tools and licensed, stories invented, the travel guide's places real.
  assert.match(html, /printed to PDF by Beuk's own print renderer/);
  assert.match(html, /Pictures made for Beuk with AI image tools and licensed by Beuk's owner/);
  assert.match(html, /in the stories every name, place and event is invented/);
  assert.match(html, /The travel guide's places are real; its photographs are made images, not photographs of those places\./);
  // Every site page beside it links Ramp.
  for (const f of [['client', 'site', 'index.html'], ['client', 'site', 'features.html'], ['client', 'site', 'compare', 'index.html']])
    assert.ok(read(...f).includes('href="/ramp"'), `${f.join('/')} links /ramp`);
});
