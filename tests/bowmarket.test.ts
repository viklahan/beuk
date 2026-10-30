import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkBowmarketContent, forSale, loadBowmarketContent, pagesOf, parseItem } from '../src/bowmarket/content.js';
import { getSchoolContent } from '../src/school/content.js';
import { createTestDb, startTestServer } from './helpers.js';

/* Bowmarket (V, 2026-10-29): the School's bookshop — box sets and books, sold through Stripe Payment Links. */

const root = path.resolve(import.meta.dirname, '..');

async function getPage(base: string, p: string, redirect: RequestRedirect = 'follow') {
  const res = await fetch(`${base}${p}`, { redirect });
  return { status: res.status, html: await res.text(), headers: res.headers };
}

test('bowmarket content: the Crashlanders and Frost Line sets and What You See? parse clean; a set counts its books\' pages; nothing is on sale without a price and a link', () => {
  const c = loadBowmarketContent('en');
  assert.deepEqual(checkBowmarketContent(c), []);
  assert.deepEqual(c.items.map((i) => i.slug), ['kleos', 'the-cheese-bandit-diaries', 'the-raven-from-darkness', 'the-frost-line', 'the-moscow-dead-drop', 'the-house-of-mirrors', 'zero-hour', 'what-you-see', 'crashlanders', 'crash', 'the-howl-chase', 'into-the-maw'], "latest first; a set's books follow it in volume order");
  const set = c.itemBySlug.get('crashlanders')!;
  assert.equal(set.kind, 'set');
  assert.deepEqual(set.contents, ['crash', 'the-howl-chase', 'into-the-maw']);
  assert.equal(pagesOf(c, set), 101 + 119 + 121, 'the page counts are the PDFs\' own');
  assert.equal(c.itemBySlug.get('what-you-see')!.pages, 20);
  const frost = c.itemBySlug.get('the-frost-line')!;
  assert.deepEqual(frost.contents, ['the-moscow-dead-drop', 'the-house-of-mirrors', 'zero-hour']);
  assert.equal(pagesOf(c, frost), 312 + 302 + 293, 'the Frost Line page counts are the PDFs\' own');
  for (const i of c.items) assert.equal(forSale(i), i.priceCents !== null && i.buy !== null);
  assert.ok(!getSchoolContent().courseBySlug.has('bowmarket'), 'no course may take the shop\'s address');
});

test('bowmarket content: a bad price, a non-Stripe buy link, an unsafe picture name and an unknown kind are refused', () => {
  const ok = '---\ntitle: T\nkind: book\nauthor: A\ndeck: D\nimage: a.webp\nformats: [PDF]\nprice: 2.99\nbuy: https://buy.stripe.com/test_abc123\n---\nA paragraph.\n';
  const item = parseItem(ok, '/x/t.md');
  assert.equal(item.priceCents, 299);
  assert.ok(forSale(item));
  assert.throws(() => parseItem(ok.replace('price: 2.99', 'price: free'), '/x/t.md'), /price is a number/);
  assert.throws(() => parseItem(ok.replace('https://buy.stripe.com/test_abc123', 'https://evil.example/pay'), '/x/t.md'), /Stripe Payment Link/);
  assert.throws(() => parseItem(ok.replace('https://buy.stripe.com/test_abc123', 'javascript:alert(1)'), '/x/t.md'), /Stripe Payment Link/);
  assert.throws(() => parseItem(ok.replace('image: a.webp', 'image: ../../.env'), '/x/t.md'), /plain .jpg/);
  assert.throws(() => parseItem(ok.replace('kind: book', 'kind: bundle'), '/x/t.md'), /book or set/);
  assert.throws(() => parseItem(ok.replace('A paragraph.', '> Only a quote.'), '/x/t.md'), /at least one paragraph/);
});

test('bowmarket pages: the shop and each item render in the School shell with the tab current; buttons say Coming soon until a link exists; pictures serve, manuscripts never do', async () => {
  const db = await createTestDb();
  const s = await startTestServer(db);
  try {
    const shop = await getPage(s.base, '/school/bowmarket');
    assert.equal(shop.status, 200);
    assert.match(shop.html, /<a href="\/school\/bowmarket" aria-current="page">Bowmarket<\/a>/);
    assert.match(shop.html, /<a href="\/school\/weekly">Beuk Weekly<\/a>/);
    assert.match(shop.html, /<h2 id="bm-sets">Box sets<\/h2>/);
    assert.ok(shop.html.indexOf('/school/bowmarket/the-frost-line"') < shop.html.indexOf('/school/bowmarket/crashlanders"'), 'the newest set comes first');
    assert.ok(shop.html.indexOf('/school/bowmarket/the-cheese-bandit-diaries"') < shop.html.indexOf('/school/bowmarket/the-raven-from-darkness"'), 'the newest book comes first');
    assert.ok(shop.html.indexOf('id="bm-books"') < shop.html.indexOf('id="bm-sets"'), 'the shelf with the newest item comes first');
    assert.match(shop.html, /href="\/site\/bowmarket\.css"/);
    const content = loadBowmarketContent('en');
    const selling = content.items.filter(forSale).length;
    assert.equal((shop.html.match(/class="bm-buy soon"/g) ?? []).length, content.items.length - selling);
    if (!selling) assert.match(shop.html, /Nothing can be bought yet/);
    assert.ok(!/buy\.stripe\.com/.test(shop.html) || selling > 0, 'no Stripe link on the page while nothing is for sale');
    assert.equal((await getPage(s.base, '/school/bowmarket/', 'manual')).status, 301);

    const set = await getPage(s.base, '/school/bowmarket/crashlanders');
    assert.equal(set.status, 200);
    assert.match(set.html, /<h1>Crashlanders — the complete trilogy<\/h1>/);
    assert.match(set.html, /341 in all/);
    assert.match(set.html, /<h2 id="bm-in">In this set<\/h2>/);
    assert.match(set.html, /there is no cover art yet/);
    assert.match(set.html, /class="bm-stage" data-turn tabindex="0" role="img" aria-label="The 3 books of Crashlanders — the complete trilogy, in 3D\./);
    const stage = set.html.slice(set.html.indexOf('class="bm-stage"'), set.html.indexOf('</figure>', set.html.indexOf('class="bm-stage"')));
    assert.equal((stage.match(/class="bk"/g) ?? []).length, 3, 'the set stands as its three books');
    assert.match(set.html, /<script src="\/site\/bowmarket\.js" defer><\/script>/);

    const book = await getPage(s.base, '/school/bowmarket/crash');
    assert.equal(book.status, 200);
    assert.match(book.html, /Crashlanders, Volume 1 · by Max Fable/);
    assert.match(book.html, /Also in <a href="\/school\/bowmarket\/crashlanders">/);
    assert.match(book.html, /src="\/school\/bowmarket\/img\/crash-2\.webp"/);

    const img = await fetch(`${s.base}/school/bowmarket/img/crash-1.webp`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');
    for (const bad of ['crash.md', '..%2F..%2Fpackage.json', 'crashlanders-vol1-crash.pdf'])
      assert.equal((await fetch(`${s.base}/school/bowmarket/img/${bad}`)).status, 404, bad);
    assert.equal((await getPage(s.base, '/school/bowmarket/nope')).status, 404);

    const sitemap = await getPage(s.base, '/sitemap.xml');
    assert.match(sitemap.html, /\/school\/bowmarket\/what-you-see</);
    assert.match(sitemap.html, /\/school\/bowmarket\/zero-hour</);

    const frost = await getPage(s.base, '/school/bowmarket/the-frost-line');
    assert.equal(frost.status, 200);
    assert.match(frost.html, /907 in all/);
    const fstage = frost.html.slice(frost.html.indexOf('class="bm-stage"'), frost.html.indexOf('</figure>', frost.html.indexOf('class="bm-stage"')));
    assert.equal((fstage.match(/class="bk"/g) ?? []).length, 3, 'the Frost Line set stands as its three books');
    assert.match((await getPage(s.base, '/school/bowmarket/zero-hour')).html, /The Frost Line, Volume 3 · by Gisèle Torres/);
  } finally {
    await s.close();
  }
});

test('bowmarket: the stylesheet exists and every School tab names the shop', () => {
  assert.match(readFileSync(path.join(root, 'client', 'site', 'bowmarket.css'), 'utf8'), /\.bm-buy/);
  assert.match(readFileSync(path.join(root, 'src', 'school', 'render.ts'), 'utf8'), /href="\/school\/bowmarket"/);
});

test('Housekeeping self-check: Bowmarket content parses clean and reports what is on sale', async () => {
  const { SELF_CHECK_CASES, buildCheckContext } = await import('../src/housekeeping/registry.js');
  const { testConfig } = await import('./helpers.js');
  const ctx = buildCheckContext(await createTestDb(), testConfig());
  const detail = await SELF_CHECK_CASES.find((c) => c.id === 'bowmarket.content.parses-clean')!.run!(ctx);
  const c = loadBowmarketContent('en');
  const selling = c.items.filter(forSale).length;
  assert.equal(detail, `${c.items.length} item(s), 2 box set(s); ${selling} on sale, ${c.items.length - selling} coming soon`);
  assert.equal(c.items.length, 12);
});
