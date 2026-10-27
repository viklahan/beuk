// Playwright side of the simulation: browser contexts on the sim stack,
// the two routed URLs inpage.js uses, and a network log of every /api and
// /read request (method, path, status, bytes, ms) kept as evidence.
import { chromium } from '/tmp/node_modules/playwright/index.mjs';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const BASE = process.env.SIM_BASE || 'http://localhost:8190';
export const OUT = '/sim/out';
export const EVID = path.join(OUT, 'evidence');
mkdirSync(EVID, { recursive: true });
const INPAGE = readFileSync('/sim/inpage.js', 'utf8');
const ALLOWED_READ = ['/ramp/', '/sagas/', '/sim/'];

export function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  return chromium.launch({ args: ['--js-flags=--max-old-space-size=6144'] });
}

/** A browser context = one device. netName: the evidence log it writes. */
export async function device(browser, netName, opts = {}) {
  // The studio's service worker would answer the routed /__sim URLs itself
  // (Playwright cannot intercept service-worker fetches), so seeding
  // contexts run without it; the persona UI sessions keep it (opts.serviceWorkers).
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, acceptDownloads: true, locale: opts.locale || 'en-US', serviceWorkers: opts.serviceWorkers || 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('beuk.tour.v1', 'skipped'); } catch (e) { /* storage blocked */ } });
  await ctx.route('**/__sim/file*', async (route) => {
    const p = new URL(route.request().url()).searchParams.get('p') || '';
    if (!ALLOWED_READ.some((a) => p.startsWith(a)) || p.includes('..') || !existsSync(p)) return route.fulfill({ status: 404, body: 'no' });
    return route.fulfill({ status: 200, body: readFileSync(p), headers: { 'Content-Type': 'application/octet-stream' } });
  });
  await ctx.route('**/__simsave/**', async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__simsave\//, ''));
    if (name.includes('..')) return route.fulfill({ status: 400, body: 'bad' });
    const dest = name.startsWith('sagas/') ? path.join('/sagas', name.slice(6)) : path.join(OUT, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, route.request().postDataBuffer() || Buffer.alloc(0));
    return route.fulfill({ status: 200, body: 'ok' });
  });
  const netFile = path.join(EVID, `net-${netName}.jsonl`);
  ctx.on('requestfinished', async (req) => {
    const u = new URL(req.url());
    if (!/^\/(api|read)\//.test(u.pathname)) return;
    let status = null;
    try { const res = await req.response(); status = res ? res.status() : null; } catch { /* gone */ }
    const t = req.timing();
    const body = req.postDataBuffer();
    appendFileSync(netFile, JSON.stringify({ at: new Date().toISOString(), m: req.method(), p: u.pathname + (u.search.length < 200 ? u.search : '?…'), s: status, reqBytes: body ? body.length : 0, ms: t && t.responseEnd > 0 ? Math.round(t.responseEnd) : null }) + '\n');
  });
  ctx.on('requestfailed', (req) => {
    const u = new URL(req.url());
    if (/^\/(api|read)\//.test(u.pathname)) appendFileSync(netFile, JSON.stringify({ at: new Date().toISOString(), m: req.method(), p: u.pathname, failed: req.failure() && req.failure().errorText }) + '\n');
  });
  return ctx;
}

/** Open the studio and wait until it has settled (it reloads itself once
 *  on a fresh device when its service worker takes control). */
export async function studio(ctx, errors = []) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message || e).slice(0, 300)));
  page.on('crash', () => errors.push('PAGE CRASHED'));
  await page.goto(BASE + '/studio', { waitUntil: 'load', timeout: 180000 });
  await sleep(2500);
  await page.waitForLoadState('load');
  await waitFor(page, () => typeof cloud === 'object' && cloud.available && !!window.JSZip && typeof serializeBook === 'function', null, 180000);
  await sleep(1500);
  await waitFor(page, () => typeof cloud === 'object' && cloud.available, null, 180000);
  await page.addScriptTag({ content: INPAGE });
  return page;
}
export async function inject(page) {
  if (!(await page.evaluate(() => !!window.__sim))) await page.addScriptTag({ content: INPAGE });
}

/** Register (or sign in on a re-run) with the studio's own request, then
 *  take the signed-in state the way cloudAuthSubmit does. */
export async function signInApi(page, persona) {
  return page.evaluate(async (p) => {
    let mode = 'register';
    let r = await apiFetch('/api/auth/register', { method: 'POST', auth: false, body: JSON.stringify({ email: p.email, password: p.password }) });
    if (r && r.__status === 409) { mode = 'login'; r = await apiFetch('/api/auth/login', { method: 'POST', auth: false, body: JSON.stringify({ email: p.email, password: p.password }) }); }
    if (!r || !r.user) return { ok: false, mode, status: r && r.__status, error: r && r.__error };
    cloud.user = r.user; cloud.lastHeartbeatAt = 0;
    renderCloudChrome();
    await cloudLoadShelf();
    return { ok: true, mode, user: r.user };
  }, persona);
}
/** Poll a page predicate (page.waitForFunction needs eval, which the studio CSP refuses). */
export async function waitFor(page, fn, arg, timeoutMs = 120000, everyMs = 250) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await page.evaluate(fn, arg); } catch (e) { if (!/context was destroyed|navigation/i.test(String(e))) throw e; }
    if (ok) return ok;
    if (Date.now() - t0 > timeoutMs) throw new Error("waitFor timed out: " + String(fn).slice(0, 120));
    await sleep(everyMs);
  }
}
export function writeJson(name, obj) { writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 1)); }
export function readJson(name) { return JSON.parse(readFileSync(path.join(OUT, name), 'utf8')); }
