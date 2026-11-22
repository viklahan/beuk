#!/usr/bin/env node
/**
 * Runs the studio page's own self-checks (client/index.html: window.runBeukSelfChecks and
 * window.runBeukAsyncSelfChecks) in headless Chromium and holds the result against a ledger.
 *
 * Why this exists: the page carries several hundred self-checks, and the automated suites re-express only some of
 * them. On 2026-11-22 a first run of all of them found 36 failing on main with nobody the wiser: one check had thrown
 * before testing anything for two days, three pinned a behaviour that had been removed, two had drifted from a rule
 * they were meant to hold, and one was reporting a real defect (a box set giving two pages one file). A check that is
 * not run is not a check.
 *
 * How it runs: client/ is served statically on 127.0.0.1 (no Beuk server), the sample book is loaded (the checks read
 * the book on the desk: its title and author, its story), and the window is 1920x1080.
 *
 * The ledger, known-not-passing.json, names every check that does not pass in THIS harness and why. It is not a
 * pass mark: each entry is a red, stated. The run fails when a check fails that the ledger does not name, and when a
 * check the ledger names passes (take it out: the ledger must not go stale either).
 *
 *   node tools/page-selfchecks/run.mjs [--out result.json] [--width 1920 --height 1080]
 *
 * Needs playwright-core: PLAYWRIGHT_CORE=<path to the playwright-core package> (else it is imported by name), and
 * optionally CHROMIUM=<path to a Chromium executable>.
 */
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(here, '..', '..', 'client');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const outPath = arg('out', '');
const width = Number(arg('width', 1920)), height = Number(arg('height', 1080));
const ledger = JSON.parse(readFileSync(path.join(here, 'known-not-passing.json'), 'utf8'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(CLIENT, decodeURIComponent(u.pathname)));
  if (!p.startsWith(CLIENT)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/';
const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href : 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
let results = [], error = '', desk = null;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(base + 'index.html');
  await page.waitForFunction(() => typeof window.runBeukSelfChecks === 'function' && typeof window.runBeukAsyncSelfChecks === 'function', null, { timeout: 120000 });
  desk = await page.evaluate(async () => {
    const b = document.getElementById('btnSampleStory');
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 6000));
    return { sampleButton: !!b };
  });
  const pick = (r, kind) => ({ id: r.id, feature: r.feature, pass: r.pass, detail: String(r.detail).slice(0, 600), kind });
  const sync = await page.evaluate(() => window.runBeukSelfChecks().map((r) => ({ id: r.id, feature: r.feature, pass: r.pass, detail: String(r.detail) })));
  let asyncRes = [];
  try { asyncRes = await page.evaluate(async () => (await window.runBeukAsyncSelfChecks()).map((r) => ({ id: r.id, feature: r.feature, pass: r.pass, detail: String(r.detail) }))); }
  catch (e) { error = 'the async checks did not finish: ' + String(e && e.message ? e.message : e).slice(0, 300); }
  results = sync.map((r) => pick(r, 'sync')).concat(asyncRes.map((r) => pick(r, 'async')));
} catch (e) { error = String(e && e.stack ? e.stack : e).slice(0, 600); }
await browser.close();
server.close();

const failing = results.filter((r) => !r.pass);
const known = new Map(ledger.checks.map((c) => [c.id, c]));
const ran = new Set(results.map((r) => r.id));
const unexplained = failing.filter((r) => !known.has(r.id));
/* an entry marked "sometimes" has been seen to pass on one run and not on the next in this harness: it is never a
   reason for the run to fail, either way, and its entry says how often it was seen each way */
const stale = ledger.checks.filter((c) => !c.sometimes && ran.has(c.id) && !failing.some((r) => r.id === c.id));
const gone = ledger.checks.filter((c) => !ran.has(c.id));
if (outPath) writeFileSync(outPath, JSON.stringify({ error, desk, window: { width, height }, results }, null, 1));

console.log('page self-checks: ' + results.length + ' run, ' + (results.length - failing.length) + ' pass, ' + failing.length + ' do not (' + width + 'x' + height + ', sample book on the desk)');
for (const r of failing.filter((x) => known.has(x.id))) console.log('  not passing, in the ledger: ' + r.id + ' — ' + known.get(r.id).why);
for (const r of unexplained) console.log('  FAILS, NOT IN THE LEDGER: ' + r.id + ' :: ' + r.detail.replace(/\s+/g, ' ').slice(0, 300));
for (const c of stale) console.log('  PASSES NOW, STILL IN THE LEDGER (take it out): ' + c.id);
for (const c of gone) console.log('  IN THE LEDGER, NOT RUN (renamed or removed?): ' + c.id);
if (error) console.log('  ERROR: ' + error);
const ok = !error && results.length > 0 && !unexplained.length && !stale.length && !gone.length;
console.log(ok ? 'result: as the ledger says' : 'result: NOT as the ledger says');
process.exit(ok ? 0 : 1);
