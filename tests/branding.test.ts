import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';
import { BRAND_FOOTNOTE, BRAND_SUBLINE } from '../src/warmth/pages.js';
import { createTestDb, startTestServer } from './helpers.js';

/* BEUK:branding — V's decisions of 2026-10-25:
   D1/D6 the sub-brand and footer name beuk.studio (the production
         domain), not quietshelf.studio / "from Quiet Shelf";
   D2/D3 no "free" or "open-source" claim anywhere (no LICENSE exists);
   D4    the Ko-fi tip jar hides itself once GET /api/billing/status
         answers { live: true } — every other answer keeps it showing;
   D5    the sample imprint "Quiet Shelf Studio" stays (V declined). */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..', 'client');
const read = (...p: string[]) => readFile(path.join(clientDir, ...p), 'utf8');

async function warmthStaticPages(): Promise<string[]> {
  const help = (await readdir(path.join(clientDir, 'help'))).filter((f) => f.endsWith('.html'));
  return [
    ...help.map((f) => path.join('help', f)),
    path.join('reset', 'index.html'),
    path.join('support', 'index.html'),
    path.join('thanks', 'index.html'),
  ];
}

test('branding: every client ui.brand.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await read('index.html');
  const clientIds = [...new Set([...html.matchAll(/id: "(ui\.brand\.[a-z0-9.-]+)"/g)].map((m) => m[1]))];
  assert.ok(clientIds.includes('ui.brand.domain'), 'the brand self-check is in the client');
  const serverCases = SELF_CHECK_CASES.filter((c) => c.id.startsWith('ui.brand.'));
  assert.deepEqual(serverCases.map((c) => c.id).sort(), [...clientIds].sort());
  for (const c of serverCases) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} must carry a reason`);
  }
});

test('branding: warmth pages carry the beuk.studio sub-brand and footer, never quietshelf.studio', async () => {
  assert.equal(BRAND_SUBLINE, 'beuk.studio');
  const pages = await warmthStaticPages();
  assert.ok(pages.length >= 15, `expected the 12 help pages + reset/support/thanks, got ${pages.length}`);
  for (const p of pages) {
    const html = await read(p);
    assert.doesNotMatch(html, /quietshelf/i, `${p} must not name quietshelf.studio`);
    assert.doesNotMatch(html, /Quiet Shelf/, `${p} must not say "from Quiet Shelf"`);
    assert.ok(html.includes(`<span class="subbrand">${BRAND_SUBLINE}</span>`), `${p} sub-brand`);
    assert.ok(html.includes(`<p class="foot-note">${BRAND_FOOTNOTE}</p>`), `${p} footer`);
    assert.doesNotMatch(html, /open[\s-]?source/i, `${p} must not claim open source`);
  }
});

test('branding: studio title, header lockup and manifest name beuk.studio, no free/open-source claim', async () => {
  const html = await read('index.html');
  assert.match(html, /<title>Beuk — beuk\.studio<\/title>/);
  assert.match(html, /<div class="brand-sub">beuk\.studio<\/div>/);
  assert.doesNotMatch(html, /quietshelf/i, 'no quietshelf.studio anywhere in the studio');
  // D5: the only "Quiet Shelf" left is the sample imprint "Quiet Shelf Studio".
  const qs = [...html.matchAll(/Quiet Shelf(.{0,7})/g)].map((m) => m[1]);
  assert.ok(qs.length > 0, 'the sample imprint is still there (V declined D5)');
  for (const tail of qs) assert.ok(tail.startsWith(' Studio'), `unexpected "Quiet Shelf${tail}"`);

  const manifest = JSON.parse(await read('assets', 'manifest.webmanifest')) as { description: string };
  assert.doesNotMatch(manifest.description, /free|open[\s-]?source/i);
  assert.match(manifest.description, /EPUB & print studio/);
});

test('branding: brand.tagline exists in all 13 locales and none says "free" or "open source"', async () => {
  const html = await read('index.html');
  const lines = [...html.matchAll(/Object\.assign\(UI_STRINGS(?:\.([a-z]+)|\["([A-Za-z-]+)"\]), \{ "brand\.tagline": "([^"]*)" \}\);/g)];
  const byLang = new Map(lines.map((m) => [m[1] ?? m[2], m[3]]));
  assert.deepEqual(
    [...byLang.keys()].sort(),
    ['ar', 'de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru', 'tr', 'zh-Hans'],
  );
  assert.equal(byLang.get('en'), 'your EPUB & print studio');
  const banned = [
    /\bfree\b/i, /open[\s-]?source/i, /gratuit/i, /gratis/i, /código (abierto|aberto)/i, /kostenlos/i,
    /quelloffen/i, /darmow/i, /otwartoźródłow/i, /бесплатн/i, /открыт\S* исходн/i, /ücretsiz/i,
    /açık kaynak/i, /مجاني/, /مفتوح المصدر/, /無料/, /オープンソース/, /免费/, /开源/,
  ];
  for (const [lang, tagline] of byLang) {
    assert.ok(tagline.trim().length > 0, `${lang} tagline is empty`);
    for (const re of banned) assert.doesNotMatch(tagline, re, `${lang}: ${tagline}`);
  }
});

/* ---- D4: the Ko-fi gate ---- */

const KOFI = 'https://ko-fi.com/testmaker';

async function getPage(base: string, p: string): Promise<{ status: number; html: string; type: string }> {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, html: await res.text(), type: res.headers.get('content-type') ?? '' };
}

test('ko-fi gate: pages with a jar load the gate and mark every jar element data-kofi; without Ko-fi there is no gate', async () => {
  const db = await createTestDb();
  const withJar = await startTestServer(db, undefined, { kofiUrl: KOFI });
  try {
    const js = await getPage(withJar.base, '/help/billing-gate.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.match(js.html, /\/api\/billing\/status/);
    for (const p of ['/help/', '/help/box-sets.html', '/thanks', '/support', '/changelog', '/roadmap']) {
      const { status, html } = await getPage(withJar.base, p);
      assert.equal(status, 200, p);
      assert.match(html, /<script src="\/help\/billing-gate\.js"><\/script>/, `${p} loads the gate`);
      assert.doesNotMatch(html, /BEUK_BILLING_GATE/, `${p} must not leak the slot marker`);
      assert.match(html, /<a href="\/support" data-kofi>Support<\/a>/, `${p} nav link is gated`);
      assert.match(html, /<span class="subbrand">beuk\.studio<\/span>/, `${p} sub-brand`);
      assert.doesNotMatch(html, /quietshelf|from Quiet Shelf/i, `${p} old brand`);
      if (p !== '/support') assert.match(html, /<aside class="kofi-jar" data-kofi>/, `${p} jar is gated`);
    }
    // Every link to Ko-fi on the support page sits inside a data-kofi block.
    const support = (await getPage(withJar.base, '/support')).html;
    assert.match(support, /<section class="ask" aria-labelledby="ask-headline" data-kofi>[\s\S]*ko-fi\.com\/testmaker[\s\S]*<\/section>/);
    assert.equal((support.match(/ko-fi\.com\/testmaker/g) ?? []).length, 1, 'one Ko-fi link on /support, inside the gated section');
  } finally {
    await withJar.close();
  }

  const db2 = await createTestDb();
  const noJar = await startTestServer(db2, undefined, {});
  try {
    for (const p of ['/help/', '/thanks', '/changelog']) {
      const { html } = await getPage(noJar.base, p);
      assert.doesNotMatch(html, /billing-gate/, `${p}: no jar, so no gate and no request`);
      assert.doesNotMatch(html, /BEUK_BILLING_GATE/, `${p} must not leak the slot marker`);
    }
  } finally {
    await noJar.close();
  }
});

type FetchImpl = () => Promise<unknown>;

/** Run client/help/billing-gate.js in a sandbox with a fake document
 *  and fetch; return the html[data-billing] state after it settles. */
async function runGate(fetchImpl: FetchImpl | null, fireTimer = false): Promise<string | null> {
  const src = await read('help', 'billing-gate.js');
  const attrs = new Map<string, string>();
  const root = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    appendChild: () => undefined,
  };
  let timerFn: (() => void) | null = null;
  const sandbox: Record<string, unknown> = {
    document: {
      documentElement: root,
      head: { appendChild: () => undefined },
      createElement: () => ({ setAttribute: () => undefined, textContent: '' }),
    },
    setTimeout: (fn: () => void) => { timerFn = fn; return 1; },
    clearTimeout: () => { timerFn = null; },
  };
  if (fetchImpl) sandbox.fetch = fetchImpl;
  vm.runInNewContext(src, sandbox);
  // With a fetch to wait on, the jar is held while the question is open
  // (without one, the gate answers "not live" synchronously).
  if (fetchImpl) assert.equal(attrs.get('data-billing'), 'checking', 'the jar is held while the question is open');
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  if (fireTimer && timerFn) (timerFn as () => void)();
  return attrs.get('data-billing') ?? null;
}

const respond = (status: number, body: unknown, jsonOk = true) => () =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => (jsonOk ? Promise.resolve(body) : Promise.reject(new SyntaxError('not json'))),
  });

test('ko-fi gate: only an explicit { live: true } hides the jar; 404, 501, errors, junk and silence keep it', async () => {
  assert.equal(await runGate(respond(200, { live: true })), 'live');
  assert.equal(await runGate(respond(200, { live: false })), 'not-live');
  assert.equal(await runGate(respond(200, { live: 'true' })), 'not-live', 'a string is not a yes');
  assert.equal(await runGate(respond(200, {})), 'not-live');
  assert.equal(await runGate(respond(200, null, false)), 'not-live', 'non-JSON body');
  assert.equal(await runGate(respond(404, { error: 'not found' })), 'not-live', 'route not shipped');
  assert.equal(await runGate(respond(501, { live: true })), 'not-live', '501 means not live, whatever the body');
  assert.equal(await runGate(() => Promise.reject(new TypeError('Failed to fetch'))), 'not-live', 'network error');
  assert.equal(await runGate(null), 'not-live', 'no fetch API');
  // No answer at all: the wait times out and the jar shows.
  assert.equal(await runGate(() => new Promise(() => undefined), true), 'not-live', 'silence');
});
