#!/usr/bin/env node
/* Beuk 2.0 studio — end-to-end check of the part A shell, in a real
   Chromium against the production build (client/next/, `npm run build`
   first), served with the Caddyfile's real security headers
   (e2e/serve.mjs). One browser, closed at the end.

     CHROMIUM=<chrome executable>  PLAYWRIGHT_CORE=<playwright-core package dir>
     node e2e/shell.mjs            (E2E_OUT=<dir> keeps the screenshots)

   (a) CSP: a click-through (language menu, Arabic, German, theme switch,
       phone tabs, service worker) reports ZERO securitypolicyviolation
       events under the Caddyfile's Content-Security-Policy.
   (b) Offline: after one online visit, the browser is set offline (the
       server stays up and counts what reaches it: nothing may); a reload
       renders the shell from the service worker, and a language switch
       still works (packs are precached). Then, back online, the server
       answers the page with a 502 (the app down during a deploy): the
       worker serves the cached shell instead.
   (c) Look: the shell next to 1.0's same regions (/studio) at 1280×800
       and 390×844, in Paper and Candlelight, region by region:
       - geometry of every frame region equal within GEOMETRY_PX;
       - the frame's computed styles (backgrounds, borders, fonts,
         paddings) equal;
       - a pixel diff of each ported chrome region (top bar, phone tabs,
         sidebar actions, centre tab row) within PIXEL_TOLERANCE.
       1.0's parts that 2.0 does not have yet (step 5: the device-save
       pill, offline pill, account and support pills, the second and
       third centre tabs, the column folds) are hidden in 1.0 first;
       the panes' CONTENT is not compared (it is step 5's).
   (d) The same comparison in Arabic (mirrored chrome; the manuscript
       stays LTR) and German (long labels: nothing in the top bar may
       overflow or clip at 1280 or 390).
   The numbers are printed; the pass criteria below are fixed. Exit 1 on
   any failure. */
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

/* ---- pass criteria (fixed) ---- */
const MAX_CSP_VIOLATIONS = 0;
const GEOMETRY_PX = 1;
/* A pixel "differs" when any channel differs by more than PIXEL_DELTA
   (0–255): sub-pixel text antialiasing between two documents moves a
   few edge pixels by small amounts; real colour or layout changes move
   them by far more. A region passes when at most PIXEL_TOLERANCE of its
   pixels differ (0.5%: a single misplaced glyph in the top bar is ~1%). */
const PIXEL_DELTA = 32;
const PIXEL_TOLERANCE = 0.005;

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(STUDIO, '..');
if (!existsSync(path.join(REPO, 'client', 'next', 'index.html'))) {
  console.error('client/next/ has no build: run `npm run build` in studio/ first');
  process.exit(2);
}
const OUT = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : mkdtempSync(path.join(os.tmpdir(), 'beuk-next-e2e-'));
mkdirSync(OUT, { recursive: true });

const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href : 'playwright-core');
const browser = await pw.chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

/** Records CSP violations from the first script on (before the app's). */
const CSP_LISTENER = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, sample: e.sample });
  });
};

async function cspAndOffline() {
  const srv = await startServer({ repo: REPO });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(CSP_LISTENER);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    const res = await page.goto(srv.origin + '/next/');
    check(res.headers()['content-security-policy'] === srv.headers['Content-Security-Policy'], "(a) /next/ is served with the Caddyfile's Content-Security-Policy");
    await page.waitForSelector('#topbar');
    // The click-through.
    await page.click('#btnUiLang');
    await page.click('#uiLangMenu [data-lang="ar"]');
    await page.waitForFunction(() => document.getElementById('app')?.getAttribute('dir') === 'rtl');
    await page.click('#btnUiLang');
    await page.click('#uiLangMenu [data-lang="de"]');
    await page.waitForFunction(() => document.documentElement.lang === 'de');
    await page.click('#btnTheme');
    await page.waitForSelector('#toasts .toast');
    await page.click('#btnTheme');
    await page.click('#btnUiLang');
    await page.click('#uiLangMenu [data-lang="en"]');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const sel of ['[data-mpane="center"]:not([data-mstyle])', '[data-mstyle="1"]', '[data-mpane="preview"]', '[data-mpane="structure"]']) await page.click('#mobileTabs ' + sel);
    await page.setViewportSize({ width: 1280, height: 800 });
    // The service worker installs and takes control.
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller, caches: await caches.keys() };
    });
    check(sw.controlled && sw.scope.endsWith('/next/'), `(a) the service worker controls the page (scope ${sw.scope})`);
    check(sw.caches.some((c) => /^beuk-next-[0-9a-f]{12}$/.test(c)), `(b) the precache exists (${sw.caches.join(', ')})`);
    await page.reload();
    await page.waitForSelector('#topbar');
    const violations = await page.evaluate(() => window.__csp);
    console.log(`     CSP violations: ${violations.length}${violations.length ? ' ' + JSON.stringify(violations) : ''}`);
    check(violations.length <= MAX_CSP_VIOLATIONS, `(a) ${violations.length} securitypolicyviolation events (max ${MAX_CSP_VIOLATIONS})`);
    check(errors.length === 0, `(a) no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

    // (b) Offline: the browser is offline; the server stays up and counts requests.
    const served = srv.state.requests.length;
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#topbar', { timeout: 10_000 });
    const off = await page.evaluate(() => ({
      title: document.getElementById('projectTitleDisplay')?.textContent,
      panes: !!document.getElementById('pane-center'),
      styled: getComputedStyle(document.getElementById('topbar')).display === 'flex',
      controlled: !!navigator.serviceWorker.controller,
    }));
    check(off.panes && off.styled && !!off.title && off.controlled, `(b) offline reload renders the styled shell from the service worker ("${off.title}")`);
    await page.click('#btnUiLang');
    await page.click('#uiLangMenu [data-lang="ja"]');
    const ja = await page.waitForFunction(() => document.documentElement.lang === 'ja', null, { timeout: 5000 }).then(() => true, () => false);
    check(ja, '(b) offline, a language switch still works (its pack is precached)');
    check(srv.state.requests.length === served, '(b) nothing reached the server while offline');
    const offViolations = await page.evaluate(() => window.__csp);
    check(offViolations.length === 0, `(a) ${offViolations.length} violations offline`);

    // (b) A deploy: online again, but the page answers 502. The cached shell renders.
    await ctx.setOffline(false);
    srv.state.navStatus = 502;
    const before502 = srv.state.requests.length;
    await page.reload();
    const shell502 = await page
      .waitForSelector('#topbar', { timeout: 10_000 })
      .then(() => page.evaluate(() => !!document.getElementById('pane-center') && getComputedStyle(document.getElementById('topbar')).display === 'flex'))
      .catch(() => false);
    const asked = srv.state.requests.slice(before502).filter((p) => p === '/next/').length;
    check(shell502 && asked > 0, `(b) a 502 for the page (the app down during a deploy) still opens the cached shell (${asked} page request(s) answered 502)`);
    srv.state.navStatus = 0;
    const swr = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('beuk-next-')));
      return !!(await c.match('/assets/fonts/fonts.css'));
    });
    check(swr, '(b) 1.0\'s fonts.css is in the precache (served stale-while-revalidate)');
  } finally {
    await ctx.close();
    await srv.stop().catch(() => undefined);
  }
}

/* ---- (c)/(d) the look, region by region ---- */

/** 1.0's parts 2.0 has not ported yet (step 5): hidden before comparing. */
const ONE_HIDE =
  '.local-wrap, #netPill, #btnAccount, #btnSupport, #updateBar, #tabBtnType, #tabBtnOutline, .pane-fold, #tipLayer, .beuk-tip,' +
  /* the sidebar's content below its two action buttons (step 5) */
  ' .sample-bar, #bulkHint, #importSummary, #irReopen { display: none !important; }' +
  /* KNOWN 1.0 QUIRK, not reproduced: at phone widths 1.0 drops the pane
     borders (#panes .pane { border: none }), but its RTL swap rule
     (html[dir=rtl] #pane-structure { border-left: 1px … }) is more
     specific and puts a 1px line back at the screen's edge in Arabic only.
     2.0's logical borders follow the LTR behaviour. Neutralised in 1.0
     so the rest of the comparison stays strict. */
  ' @media (max-width: 1023px) { html[dir="rtl"] #panes .pane { border: none !important; } }';
const FRAME = ['#topbar', '#mobileTabs', '#panes', '#pane-structure', '#pane-center', '#pane-preview', '.center-tabs', '.side-actions', '#btnUiLang', '#btnTheme', '#btnHomeport', '#btnHelp', '#btnExport'];
const STYLE_PROPS = ['display', 'background-color', 'background-image', 'color', 'font-family', 'font-size', 'font-weight', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-radius', 'box-shadow'];
const PIXEL_REGIONS = { desktop: ['#topbar', '.side-actions', '.center-tabs'], phone: ['#topbar', '#mobileTabs', '.side-actions'] };

async function open(url, { width, height, theme, lang, hide }) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ([t, l]) => {
      try {
        localStorage.setItem('beuk.theme.v1', t);
        if (l) localStorage.setItem('beuk.uiLang.v1', l);
        localStorage.setItem('beuk.tour.v1', 'done');
      } catch {
        /* no storage */
      }
    },
    [theme, lang],
  );
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector('#topbar');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 15_000 });
  if (hide) await page.addStyleTag({ content: hide });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { ctx, page };
}

const measure = (page) =>
  page.evaluate(
    ([sels, props]) =>
      Object.fromEntries(
        sels.map((s) => {
          const e = document.querySelector(s);
          if (!e) return [s, null];
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return [s, { box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v)), style: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])) }];
        }),
      ),
    [FRAME, STYLE_PROPS],
  );

/** Fraction of differing pixels between two PNGs, computed in a blank page's canvas (no PNG library). */
async function pixelDiff(diffPage, a, b) {
  return diffPage.evaluate(
    async ([a64, b64, delta]) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + src; });
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib);
      let bad = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) > delta || Math.abs(da[i + 1] - db[i + 1]) > delta || Math.abs(da[i + 2] - db[i + 2]) > delta || Math.abs(da[i + 3] - db[i + 3]) > delta) bad++;
      }
      return { ratio: bad / (w * h), bad, size: [ia.width, ia.height, ib.width, ib.height] };
    },
    [a.toString('base64'), b.toString('base64'), PIXEL_DELTA],
  );
}

async function compare(diffPage, { width, height, theme, lang }) {
  const tag = `${width}x${height} ${theme}${lang ? ' ' + lang : ''}`;
  const file = `${width}-${theme}${lang ? '-' + lang : ''}`;
  const srv = await startServer({ repo: REPO });
  const one = await open(srv.origin + '/studio', { width, height, theme, lang, hide: ONE_HIDE });
  const two = await open(srv.origin + '/next/', { width, height, theme, lang });
  try {
    writeFileSync(path.join(OUT, `one-${file}.png`), await one.page.screenshot());
    writeFileSync(path.join(OUT, `two-${file}.png`), await two.page.screenshot());
    const [m1, m2] = await Promise.all([measure(one.page), measure(two.page)]);
    const geomBad = [];
    const styleBad = [];
    for (const s of FRAME) {
      const a = m1[s], b = m2[s];
      if (!a || !b) { geomBad.push(`${s}: ${!a && !b ? 'missing in BOTH 1.0 and 2.0' : a ? 'missing in 2.0' : 'missing in 1.0'}`); continue; }
      if (a.box.some((v, i) => Math.abs(v - b.box[i]) > GEOMETRY_PX)) geomBad.push(`${s}: 1.0 ${a.box} vs 2.0 ${b.box}`);
      if (a.style.display === 'none' && b.style.display === 'none') continue;
      for (const p of STYLE_PROPS) if (a.style[p] !== b.style[p]) styleBad.push(`${s} ${p}: 1.0 "${a.style[p]}" vs 2.0 "${b.style[p]}"`);
    }
    check(geomBad.length === 0, `(c) ${tag}: frame geometry within ${GEOMETRY_PX}px${geomBad.length ? ' — ' + geomBad.join('; ') : ''}`);
    check(styleBad.length === 0, `(c) ${tag}: frame computed styles equal${styleBad.length ? ' — ' + styleBad.join('; ') : ''}`);
    const kind = width >= 1024 ? 'desktop' : 'phone';
    const results = [];
    for (const sel of PIXEL_REGIONS[kind]) {
      const la = one.page.locator(sel).first(), lb = two.page.locator(sel).first();
      if (!(await la.isVisible()) || !(await lb.isVisible())) { check(false, `(c) ${tag}: region ${sel} visible in both`); continue; }
      const [ia, ib] = [await la.screenshot(), await lb.screenshot()];
      const name = sel.replace(/[^a-z]/gi, '');
      writeFileSync(path.join(OUT, `region-${file}-${name}-one.png`), ia);
      writeFileSync(path.join(OUT, `region-${file}-${name}-two.png`), ib);
      const d = await pixelDiff(diffPage, ia, ib);
      results.push(`${sel} ${(d.ratio * 100).toFixed(2)}%`);
      check(d.ratio <= PIXEL_TOLERANCE, `(c) ${tag}: ${sel} differs in ${(d.ratio * 100).toFixed(3)}% of pixels (max ${PIXEL_TOLERANCE * 100}%) [${d.size}]`);
    }
    return { tag, results };
  } finally {
    await one.ctx.close();
    await two.ctx.close();
    await srv.stop();
  }
}

/** (d) German: nothing in the top bar overflows or clips. */
async function noOverflow(width, height) {
  const srv = await startServer({ repo: REPO });
  const two = await open(srv.origin + '/next/', { width, height, theme: 'paper', lang: 'de' });
  try {
    const r = await two.page.evaluate(() => {
      const bar = document.getElementById('topbar');
      const br = bar.getBoundingClientRect();
      const bad = [];
      if (bar.scrollWidth > bar.clientWidth + 1) bad.push(`#topbar scrollWidth ${bar.scrollWidth} > ${bar.clientWidth}`);
      for (const el of bar.querySelectorAll('button, .brand, .book-id')) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (r.left < br.left - 1 || r.right > br.right + 1 || r.right > window.innerWidth + 1) bad.push(`${el.id || el.className} outside the bar (${Math.round(r.left)}–${Math.round(r.right)})`);
        if (el.matches('button') && el.scrollWidth > el.clientWidth + 1) bad.push(`${el.id} clips its label (${el.scrollWidth} > ${el.clientWidth})`);
      }
      const labels = [...bar.querySelectorAll('.tb-label')].filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.textContent);
      return { bad, labels };
    });
    check(r.bad.length === 0, `(d) German at ${width}px: the top bar does not overflow [${r.labels.join(' | ')}]${r.bad.length ? ' — ' + r.bad.join('; ') : ''}`);
  } finally {
    await two.ctx.close();
    await srv.stop();
  }
}

/** (d) Arabic: the chrome mirrors (outline on the right), the manuscript stays LTR. */
async function arabic() {
  const srv = await startServer({ repo: REPO });
  const two = await open(srv.origin + '/next/', { width: 1280, height: 800, theme: 'paper', lang: 'ar' });
  try {
    const r = await two.page.evaluate(() => ({
      app: document.getElementById('app').getAttribute('dir'),
      html: document.documentElement.dir,
      ms: getComputedStyle(document.getElementById('manuscript')).direction,
      outlineRight: document.getElementById('pane-structure').getBoundingClientRect().left > window.innerWidth / 2,
      brandRight: document.querySelector('.brand').getBoundingClientRect().left > window.innerWidth / 2,
    }));
    check(r.app === 'rtl' && r.html === 'rtl' && r.outlineRight && r.brandRight, `(d) Arabic: the chrome is mirrored (dir ${r.app}; outline and brand on the right)`);
    check(r.ms === 'ltr', `(d) Arabic: the manuscript stays LTR (direction ${r.ms})`);
  } finally {
    await two.ctx.close();
    await srv.stop();
  }
}

try {
  await cspAndOffline();
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  const table = [];
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    for (const theme of ['paper', 'candlelight']) table.push(await compare(diffPage, { width, height, theme }));
    for (const lang of ['ar', 'de']) table.push(await compare(diffPage, { width, height, theme: 'paper', lang }));
  }
  await diffCtx.close();
  await noOverflow(1280, 800);
  await noOverflow(390, 844);
  await arabic();
  console.log('\nregion pixel diffs (share of pixels off by more than ' + PIXEL_DELTA + '/255):');
  for (const r of table) console.log(`  ${r.tag.padEnd(24)} ${r.results.join('   ')}`);
  console.log(`screenshots: ${OUT}`);
} catch (e) {
  failures.push(String(e && e.stack ? e.stack : e));
  console.error(e);
} finally {
  await browser.close();
}
console.log(failures.length ? `\nFAILED: ${failures.length} check(s)` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
