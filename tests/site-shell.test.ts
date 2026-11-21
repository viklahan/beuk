import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BRAND_VERSION, SITE_ICON_HTML } from '../src/warmth/pages.js';
import { createTestDb, startTestServer } from './helpers.js';

/* What every page family shares (site audit, 2026-11-20): the tab icon,
   the meta description, and the footer's quiet "Beuk 2.0". */

const root = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => readFileSync(path.join(root, ...p), 'utf8');
const KOFI = 'https://ko-fi.com/testmaker';
const AS_PAGE = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

async function get(base: string, p: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${p}`, { headers, redirect: 'manual' });
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

/** Every static page under client/ that is a page of the site (not the 1.0 studio, not a build). */
function sitePages(): string[] {
  const dir = path.join(root, 'client', 'site');
  const top = readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => ['client', 'site', f]);
  const compare = readdirSync(path.join(dir, 'compare')).filter((f) => f.endsWith('.html')).map((f) => ['client', 'site', 'compare', f]);
  return [...top, ...compare].map((p) => p.join('/'));
}
const LANDING_ICON = '<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png" />';

test('one tab icon: every page family names the file the landing page names', async () => {
  const landing = read('client', 'site', 'index.html');
  assert.ok(landing.includes(LANDING_ICON), 'the landing page names /assets/icon-192.png');
  assert.ok(SITE_ICON_HTML.startsWith(LANDING_ICON), 'the server-rendered pages take the same line');
  assert.ok(readFileSync(path.join(root, 'client', 'assets', 'icon-192.png')).length > 0, 'the file exists');
  const iconsOf = (html: string) => [...html.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  // The static pages: the site pages and the three warmth pages.
  const statics = [...sitePages(), 'client/thanks/index.html', 'client/support/index.html', 'client/reset/index.html'];
  assert.ok(statics.length >= 13, `${statics.length} static pages`);
  for (const f of statics) assert.deepEqual(iconsOf(read(...f.split('/'))), ['/assets/icon-192.png'], f);
  // The 1.0 studio (the rollback page) names it relative to its own address; 2.0's build injects ICON_FILE.
  assert.deepEqual(iconsOf(read('client', 'index.html')), ['assets/icon-192.png']);
  assert.match(read('studio', 'vite.config.ts'), /export const ICON_FILE = '\/assets\/icon-192\.png';/);
  // The rendered pages: Help (and the pages in its frame), the legal pages, the account page, the School.
  const server = await startTestServer(await createTestDb(), undefined, { kofiUrl: KOFI, arisEnabled: true, arisKeySecret: 'test-secret' });
  try {
    for (const p of ['/help/', '/help/import-a-manuscript', '/help/errors', '/changelog', '/roadmap', '/status', '/aris', '/privacy', '/terms', '/account', '/thanks', '/support', '/reset', '/school']) {
      const r = await get(server.base, p, AS_PAGE);
      assert.deepEqual(iconsOf(r.text), ['/assets/icon-192.png'], `${p} (${r.status})`);
    }
  } finally {
    await server.close();
  }
});

test('meta description: the public warmth pages carry one sentence; the noindex pages carry none', async () => {
  const server = await startTestServer(await createTestDb(), undefined, { kofiUrl: KOFI });
  try {
    const descOf = (html: string) => /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? null;
    for (const p of ['/thanks', '/support', '/privacy', '/terms']) {
      const r = await get(server.base, p, AS_PAGE);
      assert.equal(r.status, 200, p);
      const d = descOf(r.text);
      assert.ok(d && d.length >= 30 && d.length <= 160, `${p}: a description of a sentence's length (${d})`);
      assert.equal(count(d!.replace(/beuk\.studio/g, ''), '.'), d!.endsWith('.') ? 1 : 0, `${p}: one sentence`);
      assert.equal(count(r.text, '<meta name="description"'), 1, `${p}: once`);
      assert.doesNotMatch(r.text, /<meta name="robots" content="noindex"/, `${p} is a public page`);
    }
    // /reset and /account are kept out of search on purpose (noindex, and robots.txt): no description to show there.
    for (const p of ['/reset', '/account']) {
      const r = await get(server.base, p, AS_PAGE);
      assert.equal(r.status, 200, p);
      assert.match(r.text, /<meta name="robots" content="noindex" \/>/, p);
      assert.equal(descOf(r.text), null, `${p}: no description on a noindex page`);
    }
  } finally {
    await server.close();
  }
});

test('/reset: "Back to the studio" goes to the studio, not the landing page', () => {
  assert.match(read('client', 'reset', 'index.html'), /<a class="back-link" href="\/studio">Back to the studio<\/a>/);
});

test('"Beuk 2.0": said once in every family\'s footer, as plain text, from one place per family', async () => {
  assert.equal(BRAND_VERSION, 'Beuk 2.0');
  const text = (html: string) => html.replace(/&nbsp;/g, ' ');
  const footerOf = (html: string) => /<footer[\s\S]*<\/footer>/.exec(html)?.[0] ?? '';
  // Server-rendered families (Help and its frame, the warmth pages, the account page): the one string in
  // src/warmth/pages.ts. The static warmth pages carry a slot, never the words.
  for (const f of ['client/thanks/index.html', 'client/support/index.html', 'client/reset/index.html']) {
    const html = read(...f.split('/'));
    assert.equal(count(html, '<!--BEUK_VERSION-->'), 1, `${f} carries the slot once`);
    assert.doesNotMatch(html, /Beuk 2\.0/, `${f} never spells it out`);
  }
  for (const f of ['src/help/render.ts', 'src/account/page.ts', 'src/legal/render.ts', 'src/routes/warmth.ts', 'src/school/render.ts'])
    assert.doesNotMatch(read(...f.split('/')), /Beuk 2\.0/, `${f} takes it from BRAND_VERSION, or from site.css`);
  const server = await startTestServer(await createTestDb(), undefined, { kofiUrl: KOFI });
  try {
    for (const p of ['/help/', '/help/import-a-manuscript', '/changelog', '/roadmap', '/status', '/privacy', '/terms', '/thanks', '/support', '/reset', '/account']) {
      const r = await get(server.base, p, AS_PAGE);
      assert.doesNotMatch(r.text, /BEUK_VERSION/, `${p}: no leftover slot`);
      const foot = text(footerOf(r.text));
      assert.equal(count(foot, 'Beuk 2.0'), 1, `${p}: once, in the footer`);
      assert.equal(count(text(r.text), 'Beuk 2.0'), 1, `${p}: and nowhere else on the page`);
      assert.doesNotMatch(foot, /<a [^>]*>[^<]*Beuk 2\.0/, `${p}: not a link`);
    }
    // The School is the site's own shell on site.css: the words come from that sheet, not its markup.
    const school = await get(server.base, '/school', AS_PAGE);
    assert.match(school.text, /<link rel="stylesheet" href="\/site\/site\.css" \/>/);
    assert.match(school.text, /<p class="footline">/);
    assert.doesNotMatch(school.text, /Beuk 2\.0/);
  } finally {
    await server.close();
  }
  // The site pages (and the School): one rule in site.css, closing the footer's last line.
  const css = read('client', 'site', 'site.css');
  assert.equal(count(css, 'Beuk 2.0'), 1, 'one rule');
  assert.match(css, /\n\.footline::after\{content:" Beuk 2\.0\."\}\n/);
  for (const f of sitePages()) {
    const html = read(...f.split('/'));
    assert.equal(count(html, '<footer>'), 1, `${f} has one <footer>`);
    assert.equal(count(html, '<p class="footline">'), 1, `${f} has the footer's last line`);
    assert.ok(html.indexOf('<p class="footline">') > html.indexOf('<footer>') && html.indexOf('<p class="footline">') < html.indexOf('</footer>'), `${f}: inside the footer`);
    if (f === 'client/site/index.html') {
      // The landing page styles itself and does not load site.css: it carries the words in its own footline.
      assert.doesNotMatch(html, /href="\/site\/site\.css"/);
      assert.equal(count(html, 'Beuk 2.0'), 1, f);
      assert.match(html, /<p class="footline">[^<]* Beuk 2\.0\.<\/p>/);
    } else {
      assert.match(html, /<link rel="stylesheet" href="\/site\/site\.css" \/>/, `${f} loads site.css`);
      assert.doesNotMatch(html, /Beuk 2\.0/, `${f} takes it from site.css`);
    }
  }
});
