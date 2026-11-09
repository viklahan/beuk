#!/usr/bin/env node
/* Beuk 2.0 studio — end-to-end check of part C (the book), in a real
   Chromium against the production build (client/next/, `npm run build`
   first), served with the Caddyfile's real security headers
   (e2e/serve.mjs). One browser; every context is closed when done.

     CHROMIUM=<chrome executable>  PLAYWRIGHT_CORE=<playwright-core package dir>
     node e2e/book.mjs             (E2E_OUT=<dir> keeps the screenshots)

   Needs Node 22.18+ / 24 (it loads src/book/read.ts with Node's type
   stripping, to compute what readBook reads: the expected export).

   #1 The no-edit gate: every fixture book (real and legacy, Dumas
      included) is opened from its backup file, every chapter's editor is
      mounted (each section chosen in the outline), nothing is typed, and
      the downloaded backup's book equals readBook's book (JSON-identical,
      key order included). The editor coverage is counted on the way.
   #2 Edit locality: typing in the Dumas book's third chapter changes that
      section's content only.
   #3 Persistence: the edit survives a reload online, and a reload with the
      network off (service worker + y-indexeddb); two tabs of /next on the
      book each type in a different chapter, and both, and a reload, end
      with both edits.
   #4 1.0 safety: a book saved by 1.0 (/studio) is imported by /next on the
      same origin; 1.0's database is byte-identical before and after, and
      1.0 then opens the same book. A device without 1.0 never gets a
      "beuk-local" database from /next.
   #5 Latency: keystroke-to-paint (event timestamp → the task after the
      next animation frame) over 300 keystrokes in the Dumas book's largest
      chapter; p50 and p95 printed (p95 over 16 ms is reported, with the
      profile's hottest functions, not hidden).
   CSP: zero securitypolicyviolation events and no page errors throughout.
   Screenshots: an open book in Paper, Candlelight and Arabic chrome next
   to 1.0 with the same book; the shell regions are diffed as part A does
   (gated), the editor surface is reported only. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';
import { covenantDumas } from './covenant-fixture.mjs';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(STUDIO, '..');
const BOOKS = path.join(REPO, 'tests', 'fixtures', 'books');
if (!existsSync(path.join(REPO, 'client', 'next', 'index.html'))) {
  console.error('client/next/ has no build: run `npm run build` in studio/ first');
  process.exit(2);
}
const OUT = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : mkdtempSync(path.join(os.tmpdir(), 'beuk-next-book-e2e-'));
mkdirSync(OUT, { recursive: true });

/* ---- pass criteria (fixed) ---- */
const MAX_CSP_VIOLATIONS = 0;
const LATENCY_P95_TARGET_MS = 16; // reported against, not gated (controller's ruling)
const PIXEL_DELTA = 32; // part A's tolerance
const PIXEL_TOLERANCE = 0.005;

/* ---- readBook in Node: src/book is TypeScript with ".js" import specifiers ---- */
const hook = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const STUDIO_PKG = ${JSON.stringify(pathToFileURL(path.join(STUDIO, 'package.json')).href)};
export async function resolve(spec, ctx, next) {
  if (spec === 'zod' || spec === 'yjs' || spec === 'y-prosemirror' || spec.startsWith('prosemirror-')) return next(spec, { ...ctx, parentURL: STUDIO_PKG });
  if (spec.startsWith('.') && spec.endsWith('.js') && ctx.parentURL && ctx.parentURL.includes('/src/book/')) {
    const u = new URL(spec.slice(0, -3) + '.ts', ctx.parentURL);
    if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
  }
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
const { readBook } = await import(pathToFileURL(path.join(REPO, 'src', 'book', 'read.ts')).href);

const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href : 'playwright-core');
const browser = await pw.chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const note = (what) => console.log(`     ${what}`);

const CSP_LISTENER = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber });
  });
};
const csp = { violations: [], errors: [] };

async function newContext(opts = {}) {
  const { on = browser, ...rest } = opts;
  opts = rest;
  const ctx = await on.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, deviceScaleFactor: 1, ...opts });
  await ctx.addInitScript(CSP_LISTENER);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('beuk.tour.v1', 'done');
    } catch {
      /* no storage */
    }
  });
  return ctx;
}
async function watch(page) {
  page.on('crash', () => csp.errors.push(`${page.url()}: the page CRASHED`));
  // (wave 7b: the error-report part throws its own probe in the page)
  page.on('pageerror', (e) => {
    if (w7bProbe.on && /wave7b-probe/.test(String(e))) return;
    if (w7bProbe.one && /\/studio/.test(page.url())) w7bProbe.oneErrors.push(String(e));
    else csp.errors.push(`${page.url()}: ${e}`);
  });
  page.on('console', (m) => {
    // wave 7a: the shelf's own answers the browser logs as failed loads — 401 (signed out: /api/auth/me), 402 (a paused
    // account feature on day 22), 409 (a shelf conflict) — are the server's word, not page errors
    if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of (404|401|402|409)|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) {
      // (wave 7b: what 1.0's own page logs with the hostile book on its desk is 1.0's, reported apart)
      if (w7bProbe.one && /\/studio/.test(page.url())) w7bProbe.oneErrors.push(m.text());
      else csp.errors.push(`${page.url()}: ${m.text()}`);
    }
  });
  return page;
}
async function harvestCsp(page) {
  try {
    const v = await page.evaluate(() => window.__csp || []);
    csp.violations.push(...v.map((x) => ({ page: page.url(), ...x })));
  } catch {
    /* page gone */
  }
}

/* ---- fixtures and expectations ---- */
const fixtures = ['real', 'legacy'].flatMap((k) =>
  readdirSync(path.join(BOOKS, k)).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = path.join(BOOKS, k, f);
    return { name: `${k}/${f.replace(/\.json$/, '')}`, file, book: JSON.parse(readFileSync(file, 'utf8')).book };
  }),
);
const DUMAS = fixtures.find((f) => f.name === 'real/dartagnan-01-three-musketeers');

function expected(book, exported) {
  const r = readBook(book);
  const want = JSON.parse(JSON.stringify(r.book));
  if (r.upgrades.includes('bookid-missing')) want.meta.bookId = exported?.meta?.bookId;
  return want;
}

/** A book less what History writes (history, historyPool) and what a snapshot leaves behind (importReport). */
function noHistory(b) {
  const o = { ...b };
  delete o.history;
  delete o.historyPool;
  delete o.importReport;
  return o;
}

/* ---- the studio, driven ---- */
async function openNext(ctx, origin) {
  const page = await watch(await ctx.newPage());
  await page.goto(origin + '/next/');
  await page.waitForSelector('#topbar');
  return page;
}
async function openBackup(page, file) {
  await page.waitForSelector('#btnOpenBackup', { timeout: 15_000 });
  await page.setInputFiles('#btnOpenBackup + input', file);
  await page.waitForSelector('#btnOpenBackup', { state: 'detached', timeout: 60_000 }); // the desk holds the book
}
async function rows(page) {
  // rows stand in their group (front, body, back), so a row's section index is its data-index, not its place
  const list = await page.$$eval('#structureList .sec-item', (els) =>
    els.map((e) => ({ i: Number(e.getAttribute('data-index')), editable: e.getAttribute('aria-disabled') !== 'true', name: e.querySelector('.sec-name')?.textContent ?? '' })));
  return list.sort((a, b) => a.i - b.i);
}
async function choose(page, i) {
  await page.locator(`#structureList .sec-item[data-index="${i}"]`).click();
  await page.waitForSelector(`#manuscript[data-section="${i}"] .ms-editor`, { timeout: 30_000 });
}
async function exportBackup(page) {
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  // wave 5a, round 2: the backup is in 1.0's local pill (its popover's Export a backup), as in 1.0
  await page.click('#localPillBtn');
  await page.click('#btnLocalBackup');
  const d = await dl;
  const text = readFileSync(await d.path(), 'utf8');
  return { name: d.suggestedFilename(), text, json: JSON.parse(text) };
}
/** Blocks shown in the open editor: [total, raw] (a container counts by its children; an empty chapter counts nothing). */
async function coverage(page) {
  return page.evaluate(() => {
    const ed = document.getElementById('manuscript').beukEditor;
    const doc = ed.state.doc;
    if (doc.childCount === 1 && doc.firstChild.type.name === 'paragraph' && doc.firstChild.content.size === 0) return [0, 0];
    let total = 0, raw = 0;
    const walk = (n) => n.forEach((b) => {
      if (b.type.name === 'container') return walk(b);
      total++;
      if (b.type.name === 'rawBlock') raw++;
    });
    walk(doc);
    return [total, raw];
  });
}
/** TipTap's focus() lands on a later frame: wait until the editing surface has focus before typing. */
const focused = (page) => page.waitForFunction(() => !!document.activeElement?.closest('.ms-editor'), null, { timeout: 5000 });
const sectionsOf = (b) => (Array.isArray(b.sections) ? b.sections : []);

/** Escape closes the top dialog; a tooltip shown on keyboard focus takes the first Escape (1.0, WCAG 1.4.13). */
async function closeByEscape(page, sel) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape');
    if (await page.waitForSelector(sel, { state: 'detached', timeout: 1500 }).then(() => true, () => false)) return;
  }
  await page.waitForSelector(sel, { state: 'detached', timeout: 5000 });
}
/** Open and close every room that reads the book without writing it (wave 1a: History, browsed to a snapshot's detail). */
async function readOnlyRooms(page) {
  const done = [];
  await page.click('#btnHistory');
  await page.waitForSelector('#modalHistory #historyList', { timeout: 60_000 });
  const first = await page.$('#historyList [data-hopen]');
  if (first) {
    await first.click();
    await page.waitForSelector('#historyDetail', { timeout: 60_000 });
    const peek = await page.$('#historyDetail [data-hpeek]');
    if (peek) await peek.click();
  }
  await closeByEscape(page, '#modalHistory');
  done.push('History');
  // Project Settings: open, change nothing, Save (an unchanged Save writes nothing)
  await page.click('#btnSettings2');
  await page.waitForSelector('#modalSettings #setTitle', { timeout: 60_000 });
  await page.click('#btnSaveSettings');
  await page.waitForSelector('#modalSettings', { state: 'detached', timeout: 10_000 });
  done.push('Settings (saved unchanged)');
  // wave 1c: Story Insights, drawn and browsed (a mark focused, the variety picker changed), then closed
  await page.click('#btnInsights');
  await page.waitForSelector('#insBody .ins-sec, #insBody .ins-empty', { timeout: 60_000 });
  await page.evaluate(() => {
    document.querySelector('#insBody .ins-mark')?.focus();
    const sel = document.getElementById('insVarSel');
    if (sel && sel.options.length > 1) {
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.click('#btnCloseInsights');
  await page.waitForSelector('#modalInsights', { state: 'detached', timeout: 10_000 });
  done.push('Insights');
  // wave 1c: the Notebook, browsed (every note chosen, every file opened, a search), then closed
  await page.click('#btnNotebook');
  await page.waitForSelector('#modalNotebook #nbList', { timeout: 60_000 });
  for (const b of await page.$$('#nbList [data-nb]')) await b.click();
  for (const b of await page.$$('[data-rsview]')) await b.click();
  await page.fill('#nbSearch', 'a');
  await page.click('#btnCloseNotebook');
  await page.waitForSelector('#modalNotebook', { state: 'detached', timeout: 10_000 });
  done.push('Notebook');
  // wave 2b: Insert Image, browsed (a picture chosen, Full-bleed pressed), then closed without placing anything; a
  // generated section answers with 1.0's toast instead (the "used in" confirm's Cancel: wave2bChecks and the vitest)
  if (await page.$('#btnInsertImage')) {
    await page.click('#btnInsertImage');
    const opened = await page.waitForFunction(() => (document.querySelector('#modalImage #imgLib') ? 'open' : [...document.querySelectorAll('#toasts .toast')].some((x) => x.textContent.includes('generated automatically')) ? 'refused' : null), null, { timeout: 10_000 })
      .then((h) => h.jsonValue()).then((v) => v === 'open');
    if (opened) {
      const cells = await page.$$('#imgLib [data-libimg]');
      if (cells.length) await cells[0].click();
      await page.click('[data-imgdisp="full"]');
      await page.click('#btnCloseImage');
      await page.waitForSelector('#modalImage', { state: 'detached', timeout: 10_000 });
      done.push('Insert Image (' + cells.length + ' pictures)');
    } else done.push('Insert Image (refused: a generated section)');
  }
  // wave 2c (review focus #4): the outline board opened, every view, the matter chip and every status and tag chip
  // pressed and released, then back to the desk — nothing edited
  await page.click('#tabBtnOutline');
  await page.waitForSelector('#olTitle', { timeout: 60_000 });
  for (const v of ['list', 'grid', 'cards']) {
    await page.click(`[data-olview="${v}"]`);
    await page.waitForSelector(`[data-olview="${v}"][aria-pressed="true"]`, { timeout: 30_000 });
  }
  await page.click('[data-olmatter]');
  await page.click('[data-olmatter]');
  for (const sel of ['[data-olst]', '[data-oltag]']) {
    const n = (await page.$$(sel)).length;
    for (let k = 0; k < n; k++) {
      await page.locator(sel).nth(k).click();
      await page.locator(sel).nth(k).click();
    }
  }
  await page.click('#tabBtnContent');
  done.push('the outline board (Cards, List, Grid, filters)');
  // wave 3a (review focus #5): the Goals room opened and closed
  await page.click('#btnGoals');
  await page.waitForSelector('#modalGoals #goalsProgress', { timeout: 60_000 });
  await page.click('#btnCloseGoals');
  await page.waitForSelector('#modalGoals', { state: 'detached', timeout: 10_000 });
  done.push('Goals');
  // wave 3b (review focus #5): the Covenant room — every entry chosen, the Story Insights and Fact fields views opened
  // and left, a search — then closed; nothing added
  await page.click('#btnBible');
  await page.waitForSelector('#modalBible #bibList', { timeout: 60_000 });
  const nEntries = (await page.$$('#bibList .bib-item')).length;
  for (let k = 0; k < Math.min(nEntries, 12); k++) {
    await page.locator('#bibList .bib-item').nth(k).click();
    await page.waitForSelector('#bibDetail #bibFName', { timeout: 10_000 });
  }
  for (const v of ['#btnBibSeed', '#btnBibFields']) {
    await page.click(v);
    // (1.0's back button shows only at phone widths; Cancel leaves the Story Insights view)
    await page.waitForSelector('#btnBibBack', { state: 'attached', timeout: 10_000 });
    await page.$eval('#btnBibSeedCancel, #btnBibBack', (b) => b.click());
  }
  await page.fill('#bibSearch', 'a');
  await page.click('#btnCloseBible');
  await page.waitForSelector('#modalBible', { state: 'detached', timeout: 10_000 });
  done.push('the Covenant (' + nEntries + ' entries browsed)');
  // …and, on an open chapter, Zen entered and left by Escape, the Read Aloud popover and the dictation language picker
  // opened and closed (nothing played, nothing dictated); the language bar is drawn on every chapter mounted above
  if (await page.$('#btnZen')) {
    await page.click('#btnZen');
    await page.waitForFunction(() => document.body.classList.contains('zen'), null, { timeout: 10_000 });
    await page.evaluate(() => window.beukZen.settle());
    // Escape until it is gone (a tooltip shown on hover or focus takes the first Escape: 1.0, WCAG 1.4.13)
    const escUntil = async (gone) => {
      for (let i = 0; i < 3 && !(await page.evaluate(gone)); i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
      await page.waitForFunction(gone, null, { timeout: 10_000 });
    };
    await escUntil(() => !document.body.classList.contains('zen'));
    await page.evaluate(() => window.beukZen.settle());
    await page.click('#btnReadAloud');
    await page.waitForSelector('#raPop:not([hidden])', { timeout: 10_000 });
    await escUntil(() => document.getElementById('raPop').hidden);
    await page.click('#btnDictate', { button: 'right' });
    await page.waitForSelector('#dictPop.open', { timeout: 10_000 });
    await escUntil(() => !document.querySelector('#dictPop.open'));
    done.push('Zen, Read Aloud, the dictation picker');
  }
  // wave 3b: on the open chapter, a mark hovered until its card shows, then left
  const mark = await page.$('#manuscript .bm');
  if (mark) {
    await mark.scrollIntoViewIfNeeded();
    const r = await mark.boundingBox();
    if (r) {
      await page.mouse.move(r.x - 200, r.y);
      await page.mouse.move(r.x + Math.min(4, r.width / 2), r.y + r.height / 2);
      const shown = await page.waitForSelector('#bibleCard:not([hidden])', { timeout: 5000 }).then(() => true, () => false);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400);
      done.push('a Covenant mark hovered' + (shown ? ' (its card shown)' : ' (no card)'));
    }
  }
  // wave 4a (review focus #4): the Style tab — every preset hovered, the theme creator opened (its controls moved: the
  // draft only), Start from a preset, closed — then back to the desk; nothing applied
  await page.click('#tabBtnType');
  await page.waitForFunction(() => document.querySelectorAll('#presetGrid [data-preset]').length === 15, null, { timeout: 60_000 });
  for (const b of await page.$$('#presetGrid [data-preset]')) await b.hover();
  await page.click('#btnNewTheme');
  await page.waitForSelector('#tcElements [data-tc-font="title"]', { timeout: 10_000 });
  await page.click('[data-tc-case="title"] [data-val="upper"]');
  await page.selectOption('#tcBase', 'preset:noir');
  await page.click('#btnTcBase');
  await page.click('#btnTcClose');
  await page.click('#tabBtnContent');
  done.push('the Style tab (15 presets hovered, the creator opened and closed)');
  done.push(await previewBrowse(page));
  // wave 4c (constraint 45): the cover maker opened from Project Settings, browsed (layouts, backgrounds, an element,
  // bindings, the spine and back, the 3D book turned) and cancelled; no stock search here (wave4cGate searches)
  await page.waitForFunction(() => !!window.beukCover && document.getElementById('cmSpineBody')?.getAttribute('data-built') === '1', null, { timeout: 60_000 });
  done.push('the cover maker (' + (await w4cBrowse(page, { search: false })) + ')');
  // wave 5a (constraint 54): the export modal browsed — every preset and the book's own again, the validator, the
  // audit, the inspector — and closed; nothing exported
  done.push(await exportBrowse(page));
  // wave 5b (constraint 60): print browsed — trims, toggles and selects and back, the preflight and a jump, the print
  // view, the interior view paged — every setting where it was
  await page.waitForFunction(() => !!window.beukPrint, null, { timeout: 60_000 });
  done.push(await printBrowse(page));
  // wave 5c (constraint 68): Word, the box set, the manuscript and the ACX script browsed, every setting where it was
  done.push(await msAcxBoxBrowse(page));
  // wave 5d (constraint 73): the store-ready check browsed — every store, binding and paper and the book's own again,
  // Check again, the report downloaded — closed
  done.push(await storeBrowse(page));
  // wave 5a, round 2: the local pill's popover opened, then closed by a click outside and by Escape; nothing backed up
  done.push(await localPillBrowse(page));
  return done.join(' + ');
}
/** Wave 4b (constraint 38): the preview browsed — every device, pages turned both ways, a desk rail row, full screen on
 *  and off, the hardcover opened, turned, closed — and the pane left on the Kindle. */
async function previewBrowse(page) {
  await page.waitForFunction(() => !!window.beukPreview, null, { timeout: 60_000 });
  const devs = await page.$$eval('#deviceBar [data-device]', (bs) => bs.map((b) => b.getAttribute('data-device')));
  for (const d of devs) {
    await page.click(`#deviceBar [data-device="${d}"]`);
    if (d === 'hardcover') {
      await page.waitForSelector('#hcStage:not([hidden])', { timeout: 10_000 });
      // an empty book has nothing to open (1.0: hcToggle off when empty and closed)
      if (await page.$eval('#hcToggle', (b) => b.disabled)) continue;
      await page.click('#hcToggle');
      await page.waitForTimeout(700);
      // 1.0's hcSyncChrome: Next is off on the last spread (a one-spread book such as the Bookbinder's letter), Prev
      // on the first — turn only where 1.0 lets the reader (the spreads themselves are the page parity sweep's)
      if (!(await page.$eval('#hcNext', (b) => b.disabled))) await page.click('#hcNext');
      if (!(await page.$eval('#hcPrev', (b) => b.disabled))) await page.click('#hcPrev');
      await page.click('#hcToggle');
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(80);
  }
  await page.click('#deviceBar [data-device="kindle"]');
  await page.waitForTimeout(400);
  if (!(await page.$eval('#btnNextPage', (b) => b.disabled))) await page.click('#btnNextPage');
  if (!(await page.$eval('#btnPrevPage', (b) => b.disabled))) await page.click('#btnPrevPage');
  await page.click('#pvFull');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const rail = await page.$$('#deskRail .desk-item');
  if (rail.length > 1) {
    await rail[rail.length - 1].click();
    await page.waitForTimeout(300);
  }
  return `the preview (${devs.length} devices, the hardcover opened and turned, pages turned, full screen, a desk row)`;
}

/* ---- #1 the no-edit gate ---- */
async function noEditGate(origin) {
  const cov = [];
  for (const f of fixtures) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      if (!Array.isArray(f.book.sections)) {
        // 1.0's localParseBackup refuses a backup whose book has no sections array; so does 2.0
        await page.waitForSelector('#btnOpenBackup', { timeout: 15_000 });
        await page.setInputFiles('#btnOpenBackup + input', f.file);
        const t = await page.waitForSelector('#toasts .toast').then((x) => x.textContent());
        check(t.includes("That file isn't a Beuk backup") && (await page.$('#btnOpenBackup')) !== null, `#1 ${f.name}: refused as 1.0 refuses it (no sections array): "${t}", the desk stays empty`);
        await harvestCsp(page);
        continue;
      }
      await openBackup(page, f.file);
      let total = 0, raw = 0, mounted = 0;
      for (const r of await rows(page)) {
        if (!r.editable) continue;
        await choose(page, r.i);
        const [t, w] = await coverage(page);
        total += t;
        raw += w;
        mounted++;
      }
      const opened = await readOnlyRooms(page);
      const out = await exportBackup(page);
      const want = expected(f.book, out.json.book);
      const same = JSON.stringify(out.json.book) === JSON.stringify(want);
      check(same, `#1 ${f.name}: ${mounted} chapter editors mounted, ${opened} opened and closed, nothing typed — the export equals readBook's book`);
      check(out.json.format === 'beuk-backup' && out.json.version === 1 && /\.beuk-backup\.json$/.test(out.name) && Object.keys(out.json).join() === 'format,version,exportedAt,book', `#1 ${f.name}: 1.0's backup wrapper (${out.name})`);
      cov.push({ name: f.name, total, raw });
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  note('coverage seen in the editor (blocks parsed / blocks shown):');
  for (const c of cov) if (c.name.startsWith('real/') || c.name === 'legacy/sections-missing') note(`  ${c.name}: ${c.total - c.raw}/${c.total} = ${c.total ? (((c.total - c.raw) / c.total) * 100).toFixed(2) + '%' : '—'}`);
  return cov;
}

/* ---- #2 edit locality and #3 persistence ---- */
async function editAndPersist(origin) {
  const ctx = await newContext();
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, DUMAS.file);
    const all = await rows(page);
    const want0 = expected(DUMAS.book);
    const bodyRows = all.filter((r) => r.editable && sectionsOf(want0)[r.i]?.kind === 'body');
    const target = bodyRows[2];
    const other = bodyRows[5];
    await choose(page, target.i);
    await page.evaluate(() => {
      const ed = document.getElementById('manuscript').beukEditor;
      ed.commands.setTextSelection(1);
      ed.commands.focus();
    });
    await focused(page);
    const TYPED = 'Edited in the e2e. ';
    await page.keyboard.type(TYPED, { delay: 5 });
    await choose(page, other.i); // the chapter closes (normalised, flushed)
    const out = await exportBackup(page);
    const before = sectionsOf(want0);
    const after = sectionsOf(out.json.book);
    const diff = after.map((s, i) => (JSON.stringify(s) === JSON.stringify(before[i]) ? null : i)).filter((i) => i !== null);
    const restSame = JSON.stringify({ ...out.json.book, sections: after.map((s, i) => (i === target.i ? before[i] : s)) }) === JSON.stringify(want0);
    check(diff.length === 1 && diff[0] === target.i && restSame, `#2 typing in chapter 3 (section ${target.i}, "${target.name}") changes only that section (sections changed: ${JSON.stringify(diff)})`);
    const changed = after[target.i];
    check(changed.content === TYPED + before[target.i].content && JSON.stringify({ ...changed, content: '' }) === JSON.stringify({ ...before[target.i], content: '' }), '#2 …and only its content: exactly the typed words before the old text');
    const edited = out.text ? out.json.book : null;

    // #3 a reload, online
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      return reg.scope;
    });
    await page.reload();
    await page.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const online = await exportBackup(page);
    check(JSON.stringify(online.json.book) === JSON.stringify(edited), `#3 the edit is there after a reload online (worker scope ${sw})`);
    // #3 a reload, offline
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const offline = await exportBackup(page);
    check(JSON.stringify(offline.json.book) === JSON.stringify(edited), '#3 the edit is there after a reload with the network off');
    await ctx.setOffline(false);

    // #3 two tabs
    const page2 = await openNext(ctx, origin);
    await page2.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const [a, b] = [bodyRows[7], bodyRows[9]];
    const typeAt = async (p, row, words) => {
      await p.bringToFront(); // keystrokes go to the page in front
      await choose(p, row.i);
      await p.evaluate(() => {
        const ed = document.getElementById('manuscript').beukEditor;
        ed.commands.setTextSelection(1);
        ed.commands.focus();
      });
      await focused(p);
      await p.keyboard.type(words, { delay: 5 });
    };
    await typeAt(page, a, 'Tab A wrote this. ');
    await typeAt(page2, b, 'Tab B wrote this. ');
    await choose(page, bodyRows[0].i);
    await choose(page2, bodyRows[0].i);
    const has = (e) => sectionsOf(e.json.book)[a.i].content.startsWith('Tab A wrote this. ') && sectionsOf(e.json.book)[b.i].content.startsWith('Tab B wrote this. ');
    let ea, eb;
    for (let tries = 0; tries < 10; tries++) { // the tabs exchange updates over a BroadcastChannel: give it up to ~5 s
      await page.waitForTimeout(500);
      ea = await exportBackup(page);
      eb = await exportBackup(page2);
      if (has(ea) && has(eb)) break;
    }
    const show = (e) => JSON.stringify([sectionsOf(e.json.book)[a.i].content.slice(0, 24), sectionsOf(e.json.book)[b.i].content.slice(0, 24)]);
    check(has(ea) && has(eb) && ea.text.slice(ea.text.indexOf('"book"')) === eb.text.slice(eb.text.indexOf('"book"')), `#3 two tabs: each sees both tabs' edits, and both export the same book (A ${show(ea)}, B ${show(eb)})`);
    await page2.close();
    await page.reload();
    await page.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const er = await exportBackup(page);
    check(JSON.stringify(er.json.book) === JSON.stringify(ea.json.book), '#3 two tabs: a reload afterwards holds both edits (the doc merged, nothing lost)');
    const others = sectionsOf(er.json.book).every((s, i) => i === target.i || i === a.i || i === b.i || JSON.stringify(s) === JSON.stringify(sectionsOf(want0)[i]));
    check(others, '#3 two tabs: every other section is untouched');

    // Fix round 1: replace the book (drop its backup on tab 1) while tab 2 has it open — nothing may double
    const tab2 = await openNext(ctx, origin);
    await tab2.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    await page.bringToFront();
    const backupText = readFileSync(DUMAS.file, 'utf8');
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'dumas.beuk-backup.json', { type: 'application/json' }));
      document.querySelector('.desk').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, backupText);
    // step 5 wave 1a: 1.0's confirm first, then a "Before opening a backup" snapshot rides into the arriving book's History
    await page.waitForSelector('#modalConfirm #btnConfirmYes', { timeout: 60_000 });
    await page.click('#modalConfirm #btnConfirmYes');
    await page.waitForFunction(() => /Backup opened/.test(document.getElementById('toasts')?.textContent || ''), null, { timeout: 60_000 });
    const wantBackup = noHistory(expected(DUMAS.book));
    let r1, r2;
    for (let tries = 0; tries < 12; tries++) { // tab 2 reopens the new generation on its own
      await page.waitForTimeout(500);
      r1 = await exportBackup(page);
      r2 = await exportBackup(tab2);
      if (JSON.stringify(noHistory(r2.json.book)) === JSON.stringify(wantBackup) && JSON.stringify(r2.json.book) === JSON.stringify(r1.json.book)) break;
    }
    check(sectionsOf(r1.json.book).length === sectionsOf(DUMAS.book).length && JSON.stringify(noHistory(r1.json.book)) === JSON.stringify(wantBackup),
      `fix 1: a backup opened in tab 1 while tab 2 holds the book exports exactly the backup, History aside (${sectionsOf(r1.json.book).length} sections, backup ${sectionsOf(DUMAS.book).length})`);
    check(r1.json.book.history.length === 1 && r1.json.book.history[0].auto === 'backup' && !!r1.json.book.history[0].chopDoc,
      `wave 1a: the replaced book stands in the backup's History as "Before opening a backup" (${JSON.stringify(r1.json.book.history.map((h) => h.auto))})`);
    check(JSON.stringify(r2.json.book) === JSON.stringify(r1.json.book), `fix 1: tab 2 moved to the new generation (${sectionsOf(r2.json.book).length} sections)`);
    const gens = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n.startsWith('beuk-next-book-')));
    check(gens.length === 1, `fix 1: one generation left on the device (${JSON.stringify(gens)})`);
    await page.reload();
    await page.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const r3 = await exportBackup(page);
    check(JSON.stringify(r3.json.book) === JSON.stringify(r1.json.book), 'fix 1: and after a reload, still exactly the backup (and its History)');
    await harvestCsp(tab2);
    await tab2.close();
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/* ---- #4 1.0 safety ---- */
const DUMP_10 = async () => {
  const names = (await indexedDB.databases()).map((d) => `${d.name}@${d.version}`).sort();
  if (!names.some((n) => n.startsWith('beuk-local@'))) return { names };
  const db = await new Promise((res, rej) => { const r = indexedDB.open('beuk-local'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stores = Array.from(db.objectStoreNames);
  const out = {};
  if (stores.includes('kv')) {
    const st = db.transaction('kv', 'readonly').objectStore('kv');
    const keys = await new Promise((res) => { const r = st.getAllKeys(); r.onsuccess = () => res(r.result); });
    for (const k of keys) out[k] = await new Promise((res) => { const r = st.get(k); r.onsuccess = () => res(r.result); });
  }
  const version = db.version;
  db.close();
  return { names: names.filter((n) => n.startsWith('beuk-local@')), version, stores, out };
};

async function oneSafety(origin) {
  // a device where 1.0 never ran
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      await page.waitForSelector('#btnOpenBackup', { timeout: 15_000 });
      const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
      check(!names.includes('beuk-local'), `#4 a device without 1.0: /next leaves no "beuk-local" database (databases: ${JSON.stringify(names)})`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  const f = fixtures.find((x) => x.name === 'real/salt-road-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const one = await watch(await ctx.newPage());
    await one.goto(origin + '/studio');
    await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    await one.setInputFiles('#localBackupInput', f.file);
    await one.waitForFunction(async () => {
      const r = await new Promise((res) => { const q = indexedDB.open('beuk-local'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (!r || !r.objectStoreNames.contains('kv')) { r?.close(); return false; }
      const rec = await new Promise((res) => { const g = r.transaction('kv', 'readonly').objectStore('kv').get('book'); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
      r.close();
      try { return JSON.parse(rec.json).book.meta.title === 'Salt Road — Book One'; } catch { return false; }
    }, null, { timeout: 30_000, polling: 300 });
    await one.waitForTimeout(1500); // let 1.0's debounced save settle
    const before = await one.evaluate(DUMP_10);
    await harvestCsp(one);
    await one.close();

    // two tabs of /next opened at once on this first visit: 1.0's book is imported once (Web Lock), never doubled
    const [next, twin] = await Promise.all([openNext(ctx, origin), openNext(ctx, origin)]);
    await Promise.all([next, twin].map((p) => p.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 })));
    await next.waitForTimeout(500);
    const twinOut = await exportBackup(twin);
    await harvestCsp(twin);
    await twin.close();
    const title = await next.textContent('#projectTitleDisplay');
    const toast = await next.waitForSelector('#toasts .toast', { timeout: 5000 }).then((t) => t.textContent(), () => '');
    check(title === 'Salt Road — Book One', `#4 /next opened 1.0's book on its own ("${title}"; toast "${toast}")`);
    for (const r of await rows(next)) if (r.editable) await choose(next, r.i);
    const exp = await exportBackup(next);
    const stored = JSON.parse(before.out.book.json).book;
    check(JSON.stringify(exp.json.book) === JSON.stringify(expected(stored, exp.json.book)), '#4 the book /next imported from 1.0 exports exactly what readBook reads from 1.0\'s copy');
    const gens1 = await next.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n.startsWith('beuk-next-book-')));
    check(JSON.stringify(twinOut.json.book) === JSON.stringify(exp.json.book) && sectionsOf(twinOut.json.book).length === sectionsOf(stored).length && gens1.length === 1,
      `fix 1: two tabs opened together imported 1.0's book once (${sectionsOf(twinOut.json.book).length} sections, ${gens1.length} generation)`);
    const after = await next.evaluate(DUMP_10);
    check(JSON.stringify(after) === JSON.stringify(before), `#4 1.0's database is identical after /next imported it (version ${before.version}, stores ${JSON.stringify(before.stores)}, keys ${JSON.stringify(Object.keys(before.out))})`);
    await harvestCsp(next);
    await next.close();

    const again = await watch(await ctx.newPage());
    await again.goto(origin + '/studio');
    await again.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    await again.waitForTimeout(1500);
    const title1 = await again.textContent('#projectTitleDisplay');
    const reopened = await again.evaluate(DUMP_10);
    const same = JSON.stringify(JSON.parse(reopened.out.book.json).book) === JSON.stringify(stored);
    check(title1.trim() === 'Salt Road — Book One' && same, `#4 1.0 at /studio opens the same book with identical content afterwards ("${title1.trim()}")`);
    await harvestCsp(again);
  } finally {
    await ctx.close();
  }
}


/* ---- wave 1c task 5: 1.0's device save names its pictures (BEUK:localpics); /next fills them back in, read-only ---- */
/** 1.0's localUnpack on a dumped beuk-local: every "beuk-pic:<sha>" data (beside a mediaType) given its "pic:<sha>" bytes. */
function unpack10(v, out) {
  if (Array.isArray(v)) return v.map((x) => unpack10(x, out));
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (k === 'data' && typeof x === 'string' && typeof v.mediaType === 'string' && /^beuk-pic:[0-9a-f]{64}$/.test(x) && out['pic:' + x.slice(9)]) o[k] = out['pic:' + x.slice(9)].data;
    else o[k] = x && typeof x === 'object' ? unpack10(x, out) : x;
  }
  return o;
}
async function onePackedPics(origin) {
  const f = fixtures.find((x) => x.name === 'real/salt-road-book-one');
  const jpg = readFileSync(path.join(REPO, 'client', 'assets', 'sample', 'sample-img-portrait.jpg')).toString('base64');
  const book = JSON.parse(JSON.stringify(f.book));
  book.images = [{ id: 'e2e-pic', name: 'portrait.jpg', mediaType: 'image/jpeg', data: jpg }];
  const file = path.join(OUT, 'salt-road-with-picture.beuk-backup.json');
  writeFileSync(file, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book }));
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const one = await watch(await ctx.newPage());
    await one.goto(origin + '/studio');
    await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    await one.setInputFiles('#localBackupInput', file);
    await one.waitForFunction(async () => {
      const r = await new Promise((res) => { const q = indexedDB.open('beuk-local'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
      if (!r || !r.objectStoreNames.contains('kv')) { r?.close(); return false; }
      const rec = await new Promise((res) => { const g = r.transaction('kv', 'readonly').objectStore('kv').get('book'); g.onsuccess = () => res(g.result); g.onerror = () => res(null); });
      r.close();
      return !!rec && typeof rec.json === 'string' && rec.json.includes('Salt Road') && rec.json.includes('beuk-pic:');
    }, null, { timeout: 30_000, polling: 300 });
    await one.waitForTimeout(1500);
    const before = await one.evaluate(DUMP_10);
    await one.close();
    const packedJson = before.out.book.json;
    const stored = unpack10(JSON.parse(packedJson).book, before.out);
    const next = await openNext(ctx, origin);
    await next.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const exp = await exportBackup(next);
    const text = JSON.stringify(exp.json.book);
    check(packedJson.includes('beuk-pic:') && !text.includes('beuk-pic:') && JSON.stringify(exp.json.book) === JSON.stringify(expected(stored, exp.json.book)),
      `wave 1c task 5: a record 1.0 saved packed (${Object.keys(before.out).filter((k) => k.startsWith('pic:')).length} picture stored once) is imported with its picture filled in: /next exports exactly readBook's reading of 1.0's unpacked book, no name left`);
    const after = await next.evaluate(DUMP_10);
    check(JSON.stringify(after) === JSON.stringify(before), `wave 1c task 5: 1.0's database is identical after the import (keys ${JSON.stringify(Object.keys(before.out))})`);
    await harvestCsp(next);
  } finally {
    await ctx.close();
  }
}

/* ---- #5 latency ---- */
async function latency(origin, opts = {}) {
  const delay = opts.delay ?? 30, count = opts.count ?? 300;
  const ctx = await newContext({ serviceWorkers: 'block' });
  // wave 7a: a context made ready first (signed in on the shelf server)
  if (opts.prepare) await opts.prepare(ctx);
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, DUMAS.file);
    if (opts.afterOpen) await opts.afterOpen(page);
    const book = expected(DUMAS.book);
    const secs = sectionsOf(book);
    let big = -1;
    secs.forEach((s, i) => { if (typeof s.content === 'string' && (big < 0 || s.content.length > secs[big].content.length)) big = i; });
    await choose(page, big);
    const size = await page.evaluate(() => {
      const ed = document.getElementById('manuscript').beukEditor;
      const doc = ed.state.doc;
      // the cursor in the middle of the middle paragraph
      let pos = 1, target = Math.floor(doc.childCount / 2), k = 0;
      doc.forEach((b, off) => { if (k++ === target) pos = off + 1 + Math.floor(b.content.size / 2); });
      ed.commands.setTextSelection(pos);
      ed.commands.focus();
      window.__lat = [];
      document.addEventListener('keydown', (e) => {
        const t0 = e.timeStamp;
        requestAnimationFrame(() => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => window.__lat.push(performance.now() - t0);
          ch.port2.postMessage(0);
        });
      }, true);
      return { blocks: doc.childCount, chars: doc.textContent.length };
    });
    const words = 'the quick brown fox jumps over the lazy dog and keeps on running ';
    await focused(page);
    await page.keyboard.type(words.slice(0, 20), { delay: 30 }); // warm-up
    await page.evaluate(() => { window.__lat = []; });
    let text = '';
    while (text.length < 300) text += words;
    await page.keyboard.type(text.slice(0, count), { delay });
    await page.waitForTimeout(300);
    const lat = (await page.evaluate(() => window.__lat)).slice().sort((x, y) => x - y);
    const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)];
    const p50 = q(0.5), p95 = q(0.95), max = lat[lat.length - 1];
    // wave 4b (constraint 37): the preview pane is open beside the editor, following the chapter being typed in
    const pane = await page.evaluate(() => ({ open: !!document.getElementById('pageFlow')?.getClientRects().length && document.getElementById('flowWrap').clientWidth > 0, chars: document.getElementById('pageFlow')?.innerHTML.length ?? 0, counter: document.getElementById('pageCounter')?.textContent ?? '' }));
    check(pane.open && pane.chars > 1000, `#5 the preview pane is open while typing (constraint 37): the chapter typeset in it (${pane.chars} characters of HTML, "${pane.counter}")`);
    note(`latency (preview pane open): section ${big} ("${secs[big].title}"), ${size.blocks} blocks, ${size.chars} characters; ${lat.length} keystrokes: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    check(lat.length >= count - 10, `#5 ${lat.length} keystrokes measured (${delay} ms between keys)`);
    if (opts.quick) {
      await harvestCsp(page);
      return { p50, p95, max, n: lat.length, section: big, ...size, top: [] };
    }
    console.log(`${p95 <= LATENCY_P95_TARGET_MS ? 'ok  ' : 'OVER'} #5 p95 keystroke-to-paint ${p95.toFixed(1)} ms (target ${LATENCY_P95_TARGET_MS} ms; reported, not gated)`);
    // a profile of 100 more keystrokes: the hottest functions by self time
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await page.keyboard.type(text.slice(0, 100), { delay: 30 });
    const { profile } = await cdp.send('Profiler.stop');
    const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
    const self = new Map();
    for (const n of profile.nodes) {
      const fn = n.callFrame.functionName || '(anonymous)';
      if (['(idle)', '(program)', '(root)', '(garbage collector)'].includes(fn) && fn !== '(garbage collector)') continue;
      const key = `${fn} ${path.basename(n.callFrame.url || '')}:${n.callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + (n.hitCount || 0) * dt);
    }
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.LAT_TOP || 6));
    note('profile, 100 keystrokes, top self time: ' + top.map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(' | '));
    await harvestCsp(page);
    return { p50, p95, max, n: lat.length, section: big, ...size, top };
  } finally {
    await ctx.close();
  }
}

/* ---- screenshots, next to 1.0 ---- */
const ONE_HIDE =
  // wave 5a, round 2: the local pill (.local-wrap) is ported, so 1.0 shows it too
  '#netPill, #btnAccount, #btnSupport, #updateBar, .pane-fold, #tipLayer, .beuk-tip,' +
  ' #bulkHint { display: none !important; }' + // wave 6: 1.0's #importSummary and #irReopen are 2.0's too now (bulk import's hint: wave 7) // wave 1c: the sample bar and its tour link are in both
  ' @media (max-width: 1023px) { html[dir="rtl"] #panes .pane { border: none !important; } }';

async function pixelDiff(diffPage, a, b) {
  return diffPage.evaluate(
    async ([a64, b64, delta]) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + src; });
      const [ia, ib] = await Promise.all([load(a64), load(b64)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib);
      let bad = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > delta || Math.abs(da[i + 1] - db[i + 1]) > delta || Math.abs(da[i + 2] - db[i + 2]) > delta || Math.abs(da[i + 3] - db[i + 3]) > delta) bad++;
      return { ratio: bad / (w * h), size: [ia.width, ia.height, ib.width, ib.height] };
    },
    [a.toString('base64'), b.toString('base64'), PIXEL_DELTA],
  );
}

async function screenshots(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  const shots = [];
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const prep = async (ctx) => ctx.addInitScript(([t, l]) => {
        try {
          localStorage.setItem('beuk.theme.v1', t);
          if (l) localStorage.setItem('beuk.uiLang.v1', l);
        } catch {
          /* no storage */
        }
      }, [run.theme, run.lang]);
      const c1 = await newContext({ serviceWorkers: 'block' });
      const c2 = await newContext({ serviceWorkers: 'block' });
      await prep(c1);
      await prep(c2);
      try {
        const one = await watch(await c1.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        await one.setInputFiles('#localBackupInput', f.file);
        await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
        await one.addStyleTag({ content: ONE_HIDE });
        const two = await openNext(c2, origin);
        await openBackup(two, f.file);
        await two.waitForSelector('#manuscript .ms-editor');
        for (const p of [one, two]) {
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800); // toasts gone
        }
        const a = path.join(OUT, `book-one-${tag}.png`), b = path.join(OUT, `book-two-${tag}.png`);
        writeFileSync(a, await one.screenshot());
        writeFileSync(b, await two.screenshot());
        shots.push(a, b);
        // the shell regions (gated), then the writing surface: 1.0's #editorArea textarea vs 2.0's #manuscript (reported only)
        for (const [sel, sel2] of [['#topbar'], ['.side-actions'], ['.sample-bar'], ['.center-tabs'], ['#editorArea', '#manuscript']]) {
          const la = one.locator(sel).first(), lb = two.locator(sel2 ?? sel).first();
          if (!(await la.isVisible()) || !(await lb.isVisible())) { check(false, `screenshots ${tag}: ${sel} visible in both`); continue; }
          const d = await pixelDiff(diffPage, await la.screenshot(), await lb.screenshot());
          const msg = `screenshots ${tag}: ${sel} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}]`;
          if (sel2) note(msg.replace(sel, `${sel} (1.0) vs ${sel2} (2.0)`) + ' (the editor surface: reported, not gated)');
          else check(d.ratio <= PIXEL_TOLERANCE, msg + ` (max ${PIXEL_TOLERANCE * 100}%)`);
        }
        await harvestCsp(one);
        await harvestCsp(two);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
  note('screenshots: ' + shots.join(', '));
  return shots;
}

/* ---- wave 1a: History (review focus #1 and #2) ---- */
const dropOn = (page, file) =>
  page.evaluate(([text, name]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], name, { type: 'application/json' }));
    document.querySelector('.desk').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [readFileSync(file, 'utf8'), path.basename(file)]);
const titleIs = (page, t) => page.waitForFunction((x) => document.getElementById('projectTitleDisplay')?.textContent === x, t, { timeout: 60_000 });

async function historyChecks(origin) {
  const A = fixtures.find((f) => f.name === 'real/lunas-beach-standalone');
  const B = fixtures.find((f) => f.name === 'real/bookbinders-letter');
  // #1 a replace you can undo
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, A.file);
      const old = await exportBackup(page);
      await dropOn(page, B.file);
      await page.waitForSelector('#modalConfirm', { timeout: 30_000 });
      const title = await page.textContent('#confirmTitle'), body = await page.textContent('#confirmBody');
      check(title === 'Open this backup?' && body.includes(old.json.book.meta.title), `wave 1a #1: a backup over the open book asks first, in 1.0's words ("${title}" / "${body.slice(0, 70)}…")`);
      const focusIn = await page.evaluate(() => !!document.activeElement?.closest('#modalConfirm'));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#modalConfirm', { state: 'detached' });
      const kept = await exportBackup(page);
      check(focusIn && JSON.stringify(kept.json.book) === JSON.stringify(old.json.book), 'wave 1a #1: focus is in the confirm; Escape answers "Keep writing" and nothing changes');
      await dropOn(page, B.file);
      await page.waitForSelector('#modalConfirm #btnConfirmYes', { timeout: 30_000 });
      await page.click('#btnConfirmYes');
      await titleIs(page, B.book.meta.title);
      await page.click('#btnHistory');
      await page.waitForSelector('#historyList .hist-row', { timeout: 60_000 });
      const label = await page.textContent('#historyList .hist-row .hist-name');
      await page.click('#historyList .hist-row [data-hopen]');
      await page.waitForSelector('#historyDetail [data-hrestore]');
      await page.click('#historyDetail [data-hrestore]');
      await page.waitForSelector('#modalConfirm #btnConfirmYes');
      const rbody = await page.textContent('#confirmBody');
      await page.click('#btnConfirmYes');
      await titleIs(page, A.book.meta.title);
      const back = await exportBackup(page);
      check(label.includes('Before opening a backup') && rbody.includes('Before opening a backup'), `wave 1a #1: History lists "${label.trim()}", and Restore asks first ("${rbody.slice(0, 50)}…")`);
      // formatVersion is 1.0's label, not content (BEUK:bookformat: bookDocsSame and the sample fingerprint ignore it);
      // a snapshot carries it as 1.0's serializeBook writes it (14e2e98), so a restored book may gain `formatVersion: 1`
      const noLabel = (b) => { const o = noHistory(b); delete o.formatVersion; return o; };
      const labelOk = back.json.book.formatVersion === undefined || back.json.book.formatVersion === 1;
      check(labelOk && JSON.stringify(noLabel(back.json.book)) === JSON.stringify(noLabel(old.json.book)), `wave 1a #1: "Restore the whole book" brings the old book back exactly (export-equal, key order included, History and 1.0's formatVersion label aside; label ${JSON.stringify(back.json.book.formatVersion)})`);
      check(back.json.book.history[0]?.auto === 'restore' && back.json.book.history[1]?.auto === 'backup', `wave 1a #1: and the restore is itself undoable (History: ${JSON.stringify(back.json.book.history.map((h) => h.auto))})`);
      const gens = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n.startsWith('beuk-next-book-')));
      note(`book generations on the device after the restore: ${gens.length}`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  // #2 History made in 1.0 shows in 2.0, and a snapshot made in 2.0 shows in 1.0
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const one = await watch(await ctx.newPage());
      await one.goto(origin + '/studio');
      await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      await one.setInputFiles('#localBackupInput', A.file);
      await one.waitForFunction((t) => document.getElementById('projectTitleDisplay')?.textContent.trim() === t, A.book.meta.title, { timeout: 30_000 });
      const made10 = await one.evaluate(() => {
        window.beukHistory.save('Made in 1.0');
        return JSON.parse(JSON.stringify(serializeBook())); // 1.0's own saved form (a global of its page)
      });
      const file10 = path.join(OUT, 'history-from-1.0.beuk-backup.json');
      writeFileSync(file10, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: made10 }));
      const page = await openNext(ctx, origin);
      // /next opens 1.0's (saved) book from this device on its own, or shows the empty desk
      await page.waitForSelector('#btnOpenBackup, .desk', { timeout: 60_000 });
      if (await page.$('#btnOpenBackup')) await openBackup(page, file10);
      else {
        await dropOn(page, file10);
        await page.waitForFunction(() => !!document.getElementById('modalConfirm') || /Backup opened/.test(document.getElementById('toasts')?.textContent || ''), null, { timeout: 60_000 });
        if (await page.$('#modalConfirm')) {
          await page.click('#modalConfirm #btnConfirmYes');
          await page.waitForFunction(() => /Backup opened/.test(document.getElementById('toasts')?.textContent || ''), null, { timeout: 60_000 });
        }
      }
      await page.click('#btnHistory');
      await page.waitForSelector('#historyList .hist-row', { timeout: 60_000 });
      const names = await page.$$eval('#historyList .hist-name', (els) => els.map((e) => e.textContent.trim()));
      check(names.includes('Made in 1.0'), `wave 1a #2: a snapshot made in 1.0 shows in 2.0's History (${JSON.stringify(names)})`);
      await page.fill('#histNameInput', 'Made in 2.0');
      await page.click('#btnHistSave');
      await page.waitForFunction(() => [...document.querySelectorAll('#historyList .hist-name')].some((e) => e.textContent.trim() === 'Made in 2.0'), null, { timeout: 10_000 });
      await closeByEscape(page, '#modalHistory');
      // review focus #5: Settings edits reach the export, and 1.0 reads them back
      await page.click('#btnSettings2');
      await page.waitForSelector('#modalSettings #setPublisher', { timeout: 60_000 });
      await page.fill('#setPublisher', 'Harbour Press');
      await page.selectOption('#setRightsMode', 'pd');
      await page.fill('#setFirstPublished', '1900');
      const preview = await page.textContent('#rightsPreview');
      await page.click('#btnSaveSettings');
      await page.waitForSelector('#modalSettings', { state: 'detached', timeout: 10_000 });
      const out = await exportBackup(page);
      const m2 = out.json.book.meta;
      check(m2.publisher === 'Harbour Press' && m2.rightsMode === 'pd' && m2.firstPublished === '1900' && !('editionHolder' in m2) && !('ccLicence' in m2) && preview.includes('This work is in the public domain. First published in 1900.'),
        `wave 1a #5: Settings edits are in the export (publisher, rightsMode pd, firstPublished 1900; untouched rights keys absent; preview "${preview.slice(0, 70)}…")`);
      await harvestCsp(page);
      await page.close();
      const seen = await one.evaluate((book) => {
        window.beukLocal.applyBackup(book);
        return window.beukHistory.list().map((s) => ({ name: s.name, auto: s.auto, sections: s.doc.sections.length }));
      }, out.json.book);
      const meta10 = await one.evaluate(() => ({ publisher: state.meta.publisher, mode: rightsModeOf(), line: rightsLine() })); // 1.0's own globals
      check(meta10.publisher === 'Harbour Press' && meta10.mode === 'pd' && meta10.line.includes('First published in 1900.'), `wave 1a #5: 1.0 reads the Settings edits back (${JSON.stringify(meta10)})`);
      const mine = seen.find((s) => s.name === 'Made in 2.0');
      check(!!mine && mine.sections === sectionsOf(out.json.book).length && seen.some((s) => s.name === 'Made in 1.0'),
        `wave 1a #2: after export and import, 1.0's History holds the snapshot made in 2.0, and 1.0's own: ${JSON.stringify(seen.map((s) => s.name || s.auto))}`);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
}

/* ---- wave 1a: one tooltip (1.0's ui.tooltips scan, in a real layout) ---- */
async function tooltipScan(origin) {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, fixtures.find((f) => f.name === 'real/lunas-beach-standalone').file);
    const r = await page.evaluate(() => {
      const T = window.beukTips;
      if (!T) return { missing: true };
      T.flush();
      const desc = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''));
      const left = [...document.querySelectorAll('[title]')].filter((el) => el instanceof HTMLElement && !T.keepsTitle(el)).map(desc);
      let icon = 0;
      const noName = [], noTip = [];
      document.querySelectorAll("button, [role='button'], a[href]").forEach((el) => {
        if (el.closest('.fc-page, .piv-book, [data-keep-titles]') || el.closest('#beukTip')) return;
        if (!T.iconOnly(el)) return;
        icon++;
        if (!T.nameOf(el)) noName.push(desc(el));
        if (!T.textFor(el)) noTip.push(desc(el));
      });
      T.setKeyboard(true);
      const b = document.getElementById('btnTheme');
      b.focus();
      const tip = document.getElementById('beukTip');
      const tr = tip && !tip.hidden ? tip.getBoundingClientRect() : null, br = b.getBoundingClientRect();
      const beside = !!tr && !(tr.left < br.right && br.left < tr.right && tr.top < br.bottom && br.top < tr.bottom);
      const wired = (b.getAttribute('aria-describedby') || '').includes('beukTip');
      b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const hidden = !tip || tip.hidden;
      T.setKeyboard(false);
      b.blur();
      return { left, icon, noName, noTip, beside, wired, hidden };
    });
    check(!r.missing && r.left.length === 0 && r.noName.length === 0 && r.noTip.length === 0,
      `wave 1a ui.tooltips: no help title left (${JSON.stringify(r.left)}); ${r.icon} icon-only controls, each named and tipped (${JSON.stringify(r.noName)} / ${JSON.stringify(r.noTip)})`);
    check(r.beside && r.wired && r.hidden, `wave 1a ui.tooltips: keyboard focus shows the tip beside #btnTheme, wired by aria-describedby (${r.beside}, ${r.wired}); Escape hides it (${r.hidden})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/* ---- wave 1b: split and Undo in the browser, the sample with its pictures under the CSP, the toolbar layout ---- */
async function wave1bChecks(origin) {
  const A = fixtures.find((f) => f.name === 'real/salt-road-standalone');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, A.file);
    const before = await exportBackup(page);
    // the sidebar: groups and counts (1.0's renderSidebar)
    await page.waitForSelector('#structureList .sec-wc', { timeout: 30_000 });
    const groups = await page.$$eval('#structureList .group-toggle', (els) => els.map((e) => e.getAttribute('data-og')));
    check(groups.includes('body') && groups.every((g) => ['front', 'body', 'back'].includes(g)), `wave 1b sidebar: 1.0's group toggles (${groups.join(', ')}), every row with its count`);
    // split the open chapter at its second paragraph, in the browser: menu → Split at cursor
    const idx = before.json.book.sections.findIndex((x) => x.kind === 'body' && typeof x.content === 'string' && !x.content.includes(':::') && x.content.split(/\n\s*\n/).filter((p) => p.trim() && !/^[\[!#>*-]/.test(p.trim())).length >= 3);
    await choose(page, idx);
    const text = before.json.book.sections[idx].content;
    // the caret at the start of the chapter's second block (a block boundary: 1.0 cuts before that paragraph)
    const placed = await page.evaluate(() => {
      const ed = document.getElementById('manuscript').beukEditor;
      const doc = ed.state.doc;
      if (doc.childCount < 2 || !doc.child(1).isTextblock) return false;
      ed.commands.setTextSelection(doc.child(0).nodeSize + 1);
      return true;
    });
    await page.click('#structureList .sec-item.active [data-act="more"]');
    await page.waitForSelector('#chopMenu [data-chop-act="split"]');
    const why = await page.getAttribute('#chopMenu [data-chop-act="split"]', 'aria-disabled');
    if (why !== null) {
      const dbg = await page.evaluate(() => {
        const ed = document.getElementById('manuscript').beukEditor;
        return { reason: document.querySelector('#chopMenu [data-chop-act="split"]').title, sel: ed.state.selection.from, kids: ed.state.doc.childCount, focus: document.activeElement?.className };
      });
      throw new Error(`split refused: ${JSON.stringify({ placed, ...dbg })}`);
    }
    await page.click('#chopMenu [data-chop-act="split"]');
    await page.waitForSelector(`#structureList .sec-item.active[data-index="${idx + 1}"]`, { timeout: 30_000 });
    const mid = await exportBackup(page);
    const a = mid.json.book.sections[idx].content, b = mid.json.book.sections[idx + 1].content;
    check(placed && why === null && mid.json.book.sections.length === before.json.book.sections.length + 1 && a.length > 0 && b.length > 0,
      `wave 1b split: the caret's chapter cut in two in the browser (${a.length} + ${b.length} characters of ${text.length})`);
    await page.click('#toasts .toast-action');
    await page.waitForSelector(`#structureList .sec-item.active[data-index="${idx}"]`, { timeout: 30_000 });
    const back = await exportBackup(page);
    check(JSON.stringify(noHistory(back.json.book)) === JSON.stringify(noHistory(before.json.book)), 'wave 1b split: Undo, then export: the book exactly as before (History aside, key order included)');
    // the toolbar: 1.0's layout ran (rows and fold level set), at a wide and a narrow width
    const wide = await page.evaluate(() => { const tb = document.getElementById('insertToolbar'); return { rows: tb.getAttribute('data-rows'), fold: tb.getAttribute('data-fold') }; });
    await page.setViewportSize({ width: 380, height: 800 });
    await page.waitForTimeout(300);
    const narrow = await page.evaluate(() => { const tb = document.getElementById('insertToolbar'); return tb ? { rows: tb.getAttribute('data-rows'), fold: tb.getAttribute('data-fold') } : null; });
    await page.setViewportSize({ width: 1280, height: 800 });
    check(!!wide.rows && !!wide.fold && !!narrow?.rows, `wave 1b toolbar (wave 2a: four groups now, see wave2aChecks): tbLayout laid the toolbar out (wide: ${JSON.stringify(wide)}, narrow: ${JSON.stringify(narrow)})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
  // the sample: Load from the empty desk, its pictures from /assets/sample/ under the CSP, Remove leaves the empty book
  const ctx2 = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx2, origin);
    await page.waitForSelector('#btnSampleStory', { timeout: 30_000 });
    const label = await page.textContent('#btnSampleStory');
    await page.click('#btnSampleStory');
    await titleIs(page, 'The Lantern Coast');
    let filled = false;
    for (let i = 0; i < 60 && !filled; i++) {
      const out = await exportBackup(page);
      filled = out.json.book.images.every((im) => !String(im.id).startsWith('sample-img') || im.data.length > 1000) && out.json.book.cover && out.json.book.cover.data.length > 1000;
      if (!filled) await page.waitForTimeout(500);
    }
    const pics = state(srvRef).requests.filter((p) => p.startsWith('/assets/sample/')).length;
    check(/25,9\d\d words/.test(label) && filled && pics >= 35, `wave 1b sample: "${label.trim()}" loads the sample; its ${pics} pictures arrive from /assets/sample/ and fill in`);
    await page.click('#btnSampleStory');
    await page.waitForFunction(() => document.getElementById('btnSampleStory')?.textContent.includes('Load the sample'), null, { timeout: 30_000 });
    const empty = await exportBackup(page);
    check(empty.json.book.meta.title === '' && !JSON.stringify(empty.json.book).includes('Lantern Coast') && (await page.$('#modalConfirm')) === null,
      'wave 1b sample: Remove (untouched: no confirm) leaves the empty book, nothing of the sample in it');
    await harvestCsp(page);
  } finally {
    await ctx2.close();
  }
}

/* ---- wave 1c: Story Insights and Names on stage (review focus #1, #2, #5) ---- */
/** A fixture rewritten in another script and language (no such fixture is committed): its body sections hold text in
 *  that script, so the language branches (dialogue quotes, crutch lists, reading ease, casing) are exercised. */
function scriptBook(base, lang, lines) {
  const b = JSON.parse(JSON.stringify(base));
  b.meta.language = lang;
  b.meta.title = lang + ' fixture';
  let k = 0;
  for (const s of b.sections) if (s.kind === 'body' && s.content) s.content = Array.from({ length: 6 }, () => lines[k++ % lines.length]).join('\n\n');
  return b;
}
const SCRIPT_LINES = {
  ar: ['«نبحر عند الفجر»، قالت مارا. رفع القبطان هيل الفانوس فوق الماء.', 'مشت مارا إلى الميناء حيث كان القبطان هيل ينتظر. رفعت مارا الفانوس.', 'كان الضباب كثيفًا فوق الرصيف، والقوارب صامتة.'],
  ja: ['「夜明けに出航する」とマラは言った。ヘイル船長が灯りを掲げた。', 'マラは港へ歩いた。ヘイル船長が待っていた。マラは灯りを掲げた。', '霧が桟橋を覆い、船は静かだった。'],
  hi: ['"हम भोर में निकलेंगे," मारा ने कहा। कप्तान हेल ने लालटेन उठाई।', 'मारा बंदरगाह की ओर चली जहाँ कप्तान हेल इंतज़ार कर रहे थे।', 'घाट पर कोहरा घना था, और नावें चुप थीं।'],
};
/** #insBody as markup to compare: the page count card left out (1.0's desk measures it; 2.0 has no desk yet), the
 *  icons written back as 1.0's placeholders (1.0's lucide and 2.0 draw the same icons as different DOM), and a title
 *  the tooltip layer has already absorbed (BEUK:tips, wave 1a: title → data-tip-text, on its own sweep) put back. */
const insightsMarkup = (page) => page.evaluate(() => {
  const b = document.getElementById('insBody').cloneNode(true);
  b.querySelector('#insGPages')?.remove();
  b.querySelectorAll('svg.lucide').forEach((svg) => {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', [...svg.classList].find((x) => x.startsWith('lucide-')).slice(7));
    svg.replaceWith(i);
  });
  b.querySelectorAll('.is-hot').forEach((n) => n.classList.remove('is-hot'));
  b.querySelectorAll('[data-tip-text]').forEach((n) => {
    if (!n.hasAttribute('title')) n.setAttribute('title', n.getAttribute('data-tip-text'));
    n.removeAttribute('data-tip-text');
  });
  // attributes in a fixed order (the tooltip layer re-adds a title at the end)
  const canon = (n) => n.nodeType === 3 ? n.data.replace(/[&<>]/g, (c) => '&#' + c.charCodeAt(0) + ';') : n.nodeType !== 1 ? '' :
    '<' + n.localName + [...n.attributes].map((a) => ' ' + a.name + '="' + a.value.replace(/[&"<>]/g, (c) => '&#' + c.charCodeAt(0) + ';') + '"').sort().join('') + '>' + [...n.childNodes].map(canon).join('') + '</' + n.localName + '>';
  return { html: [...b.childNodes].map(canon).join(''), w: document.getElementById('insBody').getAttribute('data-w') };
});
/* ---- wave 2a: the insert toolbar against 1.0's own page ----
   The same text and the same selection (as text offsets) in 2.0's editor and in 1.0's textarea at /studio; the same
   button clicked in each (1.0's real click handler and dialogs); the texts must be equal. Then one Ctrl+Z in 2.0 gives
   the original text back. Also: the toolbar's layout at two widths (1.0's editor.toolbar.layout properties), and
   1.0's editor.scroll.steady on Dumas (a toolbar insert and Auto-Format leave the page's scroll where it was). */
const W2A_TEXTS = [
  'First paragraph stands.\n\nA quoted line\nspanning two lines.\n\nLast paragraph rests.',
  'a *b c* d and **strong words** here[^1].\n\nSecond *em\nacross* lines.\n\n[^1]: The note.',
  '::: center\nCentred words.\n\nStill centred.\n:::\n\nTail words "quoted" -- then...',
  '> quoted\n> more\n\n- one\n- two\n\n# Head line\n\nName: hello there\nOther: hi',
];
const W2A_PLAIN = ['redact', 'blockquote', 'attribution', 'ul', 'ol', 'scenebreak', 'emdash', 'columns', 'hanging', 'verse', 'center', 'right', 'texts', 'letter', 'transcript', 'log', 'insert', 'sideways', 'upsidedown'];
const W2A_DIALOGS = [
  { kind: 'endnote', fill: { fnText: 'A note\nover two lines.' }, ok: 'btnDoFootnote' },
  { kind: 'link', fill: { lnkUrl: 'www.example.org/a(b)' }, ok: 'btnDoLink' },
  { kind: 'margin', fill: { mnName: 'Ada', mnText: 'In the margin.' }, ok: 'btnDoMargin' },
];
async function wave2aChecks(origin) {
  const book = {
    meta: { title: 'Toolbar Book', author: 'A. Writer', language: 'en' },
    sections: W2A_TEXTS.map((content, i) => ({ id: 'w' + i, kind: 'body', type: 'chapter', title: 'Chapter ' + (i + 1), content })),
  };
  const file = path.join(OUT, 'wave2a.beuk-backup.json');
  writeFileSync(file, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z', book }));
  // Three passes, each a fresh browser context (a fresh Y.Doc): Yjs's undo slows with every undo on one document (see
  // the wave 2a report), so each pass gives one document ~90 actions and undos, one selection shape per text
  let cases = 0, equal = 0, undone = 0, exact = 0;
  const misses = [];
  for (let pass = 0; pass < 3; pass++) {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, file);
    const before = await exportBackup(page);
    const one = await watch(await ctx.newPage());
    await one.goto(origin + '/studio');
    await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), book);
    const oneRun = (text, s, e, kind, fill, ok) => one.evaluate(({ text, s, e, kind, fill, ok }) => {
      const area = document.getElementById('editorArea');
      area.value = text;
      area.dispatchEvent(new Event('input'));
      area.focus();
      area.setSelectionRange(s, e);
      (kind === 'autoformat' ? document.getElementById('btnBeautify') : document.querySelector(`[data-insert="${kind}"]`)).click();
      if (fill) {
        for (const [id, v] of Object.entries(fill)) document.getElementById(id).value = v;
        document.getElementById(ok).click();
      }
      return { text: area.value, start: area.selectionStart, end: area.selectionEnd };
    }, { text, s, e, kind, fill, ok });
    const probe = (fn, ...args) => page.evaluate(({ fn, args }) => document.getElementById('manuscript').beukText[fn](...args), { fn, args });
    for (const [i, text] of W2A_TEXTS.entries()) {
      await choose(page, i);
      const n = text.length;
      const sels = [[0, 0], [n, n], [Math.floor(n / 2), Math.floor(n / 2)], [text.indexOf('\n\n') - 4, text.indexOf('\n\n') + 6], [3, 12]];
      const runs = [...W2A_PLAIN.map((kind) => ({ kind })), ...W2A_DIALOGS, { kind: 'autoformat' }];
      for (const [s0, e0] of [sels[(i + pass) % sels.length]]) {
        for (const r of runs) {
          const cur = await probe('select', s0, e0);
          const want = await oneRun(text, cur.start, cur.end, r.kind, r.fill, r.ok);
          if (r.kind === 'autoformat') await page.click('#btnBeautify');
          else await page.click(`#insertToolbar [data-insert="${r.kind}"]`);
          if (r.fill) {
            await page.waitForSelector('#' + r.ok);
            for (const [id, v] of Object.entries(r.fill)) await page.fill('#' + id, v);
            await page.click('#' + r.ok);
            await page.waitForSelector('#' + r.ok, { state: 'detached' });
          }
          const got = await probe('read');
          cases++;
          if (got.text === want.text) equal++;
          else if (misses.length < 5) misses.push({ kind: r.kind, s: cur.start, e: cur.end, want: want.text.slice(0, 120), got: got.text.slice(0, 120) });
          if (got.text !== text) {
            await focused(page).catch(() => undefined);
            await page.keyboard.press('Control+z');
            const back = await probe('read');
            if (back.text === text) undone++;
            else if (misses.length < 5) misses.push({ kind: r.kind, undo: back.text.slice(0, 120) });
            if (back.text !== text) await probe('select', 0, 0);
          } else undone++;
        }
      }
    }
    const after = await exportBackup(page);
    if (JSON.stringify(after.json.book) === JSON.stringify(before.json.book)) exact++;
    await one.close();
    if (pass < 2) continue;
    check(cases > 250 && equal === cases, `wave 2a #1: every toolbar action and dialog in 2.0 gives exactly the text 1.0's own page gives for the same text and selection (${equal} of ${cases})${misses.length ? ' ' + JSON.stringify(misses) : ''}`);
    check(undone === cases, `wave 2a #2: one Ctrl+Z after each gives the original text back (${undone} of ${cases})`);
    check(exact === 3, `wave 2a #2: after all of it and their undos, the export is exactly the original (${exact} of 3 passes)`);
    // the layout (1.0's editor.toolbar.layout): each group on one row, no divider at a row's start, folded labels kept
    for (const w of [1440, 1280, 820, 380]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(300);
      const lay = await page.evaluate(() => {
        const tb = document.getElementById('insertToolbar');
        const groups = [...tb.querySelectorAll(':scope > .tool-group')];
        const oneRow = groups.every((g) => new Set([...g.querySelectorAll(':scope > .tool-btn')].map((b) => Math.round(b.getBoundingClientRect().top))).size === 1);
        const sepAtStart = groups.some((g) => g.classList.contains('row-start') && [...g.querySelectorAll(':scope > .tool-sep')].some((s) => getComputedStyle(s).display !== 'none'));
        // a group wider than the toolbar even with every label folded wraps inside itself, in 1.0 too (at 1280 px the
        // centre pane is 472 px and Blocks needs 494 px in 2.0, 503 px in 1.0): one row per group only where it fits
        const cs = getComputedStyle(tb);
        const W = tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        tb.classList.add('tb-measure');
        const was = [...tb.querySelectorAll('.tool-btn[data-collapse]')].map((b) => b.classList.contains('folded'));
        tb.querySelectorAll('.tool-btn[data-collapse]').forEach((b) => b.classList.add('folded'));
        const allFit = groups.every((g) => g.getBoundingClientRect().width <= W + 0.5);
        tb.querySelectorAll('.tool-btn[data-collapse]').forEach((b, i) => b.classList.toggle('folded', was[i]));
        tb.classList.remove('tb-measure');
        const foldedKeep = [...tb.querySelectorAll('.tool-btn.folded')].every((b) => (b.querySelector('.tl')?.textContent || '').trim().length > 0);
        return { rows: tb.getAttribute('data-rows'), fold: tb.getAttribute('data-fold'), W, allFit, oneRow, sepAtStart, foldedKeep, overflow: tb.scrollWidth > tb.clientWidth + 1 };
      });
      check(lay.rows && (lay.oneRow || !lay.allFit) && !lay.sepAtStart && lay.foldedKeep && !lay.overflow, `wave 2a toolbar at ${w} px: 1.0's layout (${JSON.stringify(lay)})`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
  }
  // 1.0's editor.scroll.steady on Dumas: an insert and Auto-Format keep the page's scroll and put the caret where 1.0 does
  const ctx2 = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx2, origin);
    await openBackup(page, DUMAS.file);
    const secs = sectionsOf(expected(DUMAS.book));
    let big = -1;
    secs.forEach((s, i) => { if (typeof s.content === 'string' && (big < 0 || s.content.length > secs[big].content.length)) big = i; });
    await choose(page, big);
    const scrolls = () => page.evaluate(() => {
      const out = [];
      for (let el = document.getElementById('manuscript'); el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 1) out.push(Math.round(el.scrollTop));
      out.push(Math.round(document.scrollingElement.scrollTop));
      return out.join(',');
    });
    await page.evaluate(() => {
      const ms = document.getElementById('manuscript');
      for (let el = ms; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
      document.scrollingElement.scrollTop = Math.floor((document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight) / 2);
    });
    const len = (await page.evaluate(() => document.getElementById('manuscript').beukText.read())).text.length;
    await page.evaluate((mid) => document.getElementById('manuscript').beukText.select(mid, mid), Math.floor(len / 2));
    const s0 = await scrolls();
    // clicked in the page (Playwright's own click would first scroll the toolbar button into view)
    await page.evaluate(() => document.querySelector('#insertToolbar [data-insert="emdash"]').click());
    await page.waitForTimeout(200);
    const s1 = await scrolls();
    const t0 = Date.now();
    await page.evaluate(() => document.getElementById('btnBeautify').click());
    await page.waitForSelector('#toasts .toast', { timeout: 30_000 });
    await page.waitForTimeout(200);
    const autoMs = Date.now() - t0;
    const s2 = await scrolls();
    const cur = await page.evaluate(() => document.getElementById('manuscript').beukText.read());
    check(s0 === s1 && s1 === s2 && s0 !== '0', `wave 2a: editor.scroll.steady on Dumas: an em dash and Auto-Format leave the scroll where it was (${s0} / ${s1} / ${s2})`);
    note(`Auto-Format on Dumas's longest chapter (${len} characters): ${autoMs} ms to the toast; caret at ${cur.start}`);
    await harvestCsp(page);
  } finally {
    await ctx2.close();
  }
}

/* ---- wave 2b: pictures (A6-A8) ---- */
const W2B_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const W2B_TEXTS = [
  'The harbour woke early.\n\nGulls rose over the wall.\n\nThe ferry waited.',
  'One line only',
  'First.\n\n***\n\nSecond part.\n\n***\n\nThird part ends.',
];
/** A PNG-headed picture of n bytes (40 x 30 stated), distinct per seed, as base64. */
function w2bPng(seed, n) {
  const b = Buffer.alloc(n);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]).copy(b);
  let x = seed >>> 0;
  for (let i = 24; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = x >>> 24;
  }
  return b.toString('base64');
}
/** Select the nth scene break node of the open chapter (what a click on the break does). */
async function w2bStandOn(page, nth) {
  return page.evaluate((nth) => {
    const ed = document.getElementById('manuscript').beukEditor;
    let seen = -1, at = -1;
    ed.state.doc.forEach((n, off) => {
      if (n.type.name === 'sceneBreak' && ++seen === nth && at < 0) at = off;
    });
    if (at >= 0) ed.commands.setNodeSelection(at);
    return at;
  }, nth);
}
/** The backup download while a dialog stands over the top bar (the button clicked from the page itself). */
async function w2bExport(page) {
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.evaluate(() => document.getElementById('btnLocalBackup').click()); // wave 5a, round 2: the local pill's
  const d = await dl;
  return JSON.parse(readFileSync(await d.path(), 'utf8'));
}
async function wave2bChecks(origin) {
  const book = {
    meta: { title: 'Picture Book', author: 'A. Writer', language: 'en' },
    images: [
      { id: 'p1', name: 'Harbour-Chart.png', mediaType: 'image/png', ext: 'png', data: w2bPng(1, 6000) },
      { id: 'p2', name: 'second_bay.png', mediaType: 'image/png', ext: 'png', data: w2bPng(2, 5000) },
      { id: 'p3', name: 'Third Bay.png', mediaType: 'image/png', ext: 'png', data: W2B_PNG },
    ],
    sections: W2B_TEXTS.map((content, i) => ({ id: 'q' + i, kind: 'body', type: 'chapter', number: String(i + 1), title: 'Chapter ' + (i + 1), content })),
  };
  const file = path.join(OUT, 'wave2b.beuk-backup.json');
  writeFileSync(file, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z', book }));
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, file);
    const before = await exportBackup(page);
    const one = await watch(await ctx.newPage());
    await one.goto(origin + '/studio');
    await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), book);
    const probe = (fn, ...args) => page.evaluate(({ fn, args }) => document.getElementById('manuscript').beukText[fn](...args), { fn, args });

    /* #A7 Insert Image: 1.0's own page and 2.0, the same text and caret, the same choices: the same text */
    const forms = [
      { id: 'p2', alt: '', cap: '', full: false },
      { id: 'p1', alt: 'The [old] chart', cap: 'A "quoted" cap', full: true },
      { id: 'p3', alt: '   ', cap: '', full: false },
    ];
    let cases = 0, equal = 0, undone = 0;
    const misses = [];
    for (const [i, text] of W2B_TEXTS.entries()) {
      await choose(page, i);
      for (const at of [0, Math.floor(text.length / 2), text.length]) {
        for (const f of forms) {
          const cur = await probe('select', at, at);
          const want = await one.evaluate(({ id, text, s, f }) => {
            selectSection(id);
            const area = document.getElementById('editorArea');
            area.value = text;
            area.dispatchEvent(new Event('input'));
            area.focus();
            area.setSelectionRange(s, s);
            document.getElementById('btnInsertImage').click();
            document.querySelector(`#imgLib [data-libimg="${f.id}"]`).click();
            document.getElementById('imgAlt').value = f.alt;
            document.getElementById('imgCaption').value = f.cap;
            document.querySelector(`[data-imgdisp="${f.full ? 'full' : 'standard'}"]`).click();
            document.getElementById('btnDoInsertImage').click();
            return area.value;
          }, { id: 'q' + i, text: cur.text, s: cur.start, f });
          await page.click('#btnInsertImage');
          await page.waitForSelector(`#imgLib [data-libimg="${f.id}"]`);
          await page.click(`#imgLib [data-libimg="${f.id}"]`);
          await page.fill('#imgAlt', f.alt);
          await page.fill('#imgCaption', f.cap);
          await page.click(`[data-imgdisp="${f.full ? 'full' : 'standard'}"]`);
          await page.click('#btnDoInsertImage');
          await page.waitForSelector('#modalImage', { state: 'detached' });
          const got = await probe('read');
          cases++;
          if (got.text === want) equal++;
          else if (misses.length < 3) misses.push({ text: cur.text, at: cur.start, f, want, got: got.text });
          await page.keyboard.press('Control+z');
          if ((await probe('read')).text === cur.text) undone++;
        }
      }
    }
    check(cases === 27 && equal === cases, `wave 2b #A7 editor.toolbar.image-line: Insert Image in 2.0 places exactly the marker 1.0's own page places for the same text, caret and choices (${equal} of ${cases})${misses.length ? ' ' + JSON.stringify(misses) : ''}`);
    check(undone === cases, `wave 2b #A7: one Ctrl+Z after each placement gives the text back (${undone} of ${cases})`);
    const afterInsert = await exportBackup(page);
    check(JSON.stringify(noHistory(afterInsert.json.book)) === JSON.stringify(noHistory(before.json.book)), 'wave 2b #A7: after the placements and their undos the export is exactly the original');

    /* #A6 scene images: 1.0's picker and 2.0's, the same breaks and choices: the same scene entries; the text unchanged */
    const SC = [
      { nth: 0, img: 'p1', name: 'The First Bay', alt: '', cap: 'The first bay.' },
      { nth: 1, img: 'p2', name: '', alt: 'The second bay at dusk', cap: '' },
      { nth: 0, img: 'p3', name: 'Again', alt: '', cap: '' }, // replace break 0 (the alt it had stays)
    ];
    await choose(page, 2);
    const want = await one.evaluate(({ SC, text }) => {
      selectSection('q2');
      const area = document.getElementById('editorArea');
      area.value = text;
      area.dispatchEvent(new Event('input'));
      const s = activeSection();
      for (const k of SC) {
        let pos = -1;
        for (let i = 0; i <= k.nth; i++) pos = area.value.indexOf('***', pos + 1);
        area.focus();
        area.setSelectionRange(pos + 1, pos + 1);
        sceneBarSig = '';
        updateSceneBar();
        document.getElementById('btnSceneAdd').click();
        document.querySelector(`#sceneLib [data-sceneimg="${k.img}"]`).click();
        document.getElementById('sceneName').value = k.name;
        if (k.alt) document.getElementById('sceneAlt').value = k.alt;
        document.getElementById('sceneCaption').value = k.cap;
        document.getElementById('btnDoScene').click();
      }
      return { scenes: JSON.parse(JSON.stringify(s.scenes || [])), label: document.getElementById('sceneBarLabel').textContent };
    }, { SC, text: W2B_TEXTS[2] });
    for (const k of SC) {
      await w2bStandOn(page, k.nth);
      await page.waitForSelector('#sceneBar.open');
      await page.click('#btnSceneAdd');
      await page.waitForSelector(`#sceneLib [data-sceneimg="${k.img}"]`);
      await page.click(`#sceneLib [data-sceneimg="${k.img}"]`);
      await page.fill('#sceneName', k.name);
      if (k.alt) await page.fill('#sceneAlt', k.alt);
      await page.fill('#sceneCaption', k.cap);
      await page.click('#btnDoScene');
      await page.waitForSelector('#modalScene', { state: 'detached' });
    }
    await page.waitForFunction((l) => document.getElementById('sceneBarLabel').textContent === l, want.label, { timeout: 5000 }).catch(() => undefined);
    const label2 = await page.textContent('#sceneBarLabel');
    const sc = (await exportBackup(page)).json.book;
    const s2 = sc.sections.find((s) => s.id === 'q2');
    check(JSON.stringify(s2.scenes) === JSON.stringify(want.scenes) && s2.content === W2B_TEXTS[2] && label2 === want.label,
      `wave 2b #A6 scene.images.place: the scene entries 2.0 writes equal 1.0's own picker's (${JSON.stringify(s2.scenes)}${JSON.stringify(s2.scenes) === JSON.stringify(want.scenes) ? '' : ' vs 1.0 ' + JSON.stringify(want.scenes)}), the bar reads as 1.0's ("${label2}" / "${want.label}"), the text never changes`);
    await page.click('#btnSceneRemove');
    const s3 = (await exportBackup(page)).json.book.sections.find((s) => s.id === 'q2');
    check(s3.scenes.length === 1 && s3.scenes[0].at === 1, `wave 2b #A6: Remove on the bar takes break 1's picture only (${JSON.stringify(s3.scenes)})`);

    /* #A8 the library: a used picture asks, Remove it everywhere, Undo: back exactly */
    const preLib = await exportBackup(page);
    await choose(page, 0);
    await page.click('#btnInsertImage');
    await page.waitForSelector('#imgLib [data-imgdel="p2"]');
    await page.evaluate(() => document.querySelector('#imgLib [data-imgdel="p2"]').click());
    await page.waitForSelector('#modalImgRemove');
    const uses = await page.textContent('#imgRmUses');
    const focusCancel = await page.evaluate(() => document.activeElement?.id);
    await page.click('#btnImgRmYes');
    await page.waitForSelector('#modalImgRemove', { state: 'detached' });
    const gone = (await w2bExport(page)).book;
    await page.locator('#toasts .toast-action').last().click();
    await page.waitForFunction(() => document.querySelector('#imgLib [data-libimg="p2"]'));
    const back = (await w2bExport(page)).book;
    check(focusCancel === 'btnImgRmCancel' && uses.includes('Chapter 3') && !gone.images.some((x) => x.id === 'p2') && gone.history[0].auto === 'imgremove'
      && JSON.stringify(noHistory(back)) === JSON.stringify(noHistory(preLib.json.book)),
      `wave 2b #A8 images.delete.used-clears-roles in Chromium: the confirm lists "${uses.trim()}" with focus on Cancel (${focusCancel}); Remove it everywhere takes it out (History first); Undo gives the book back exactly`);
    await page.click('#btnCloseImage');
    await one.close();
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }

  /* #4 hostile pictures: a malformed one, a scripted SVG, a pixel bomb, a 12 MB one, HTML: nothing runs, nothing breaks */
  {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1"><script>window.__pwned=2</script><rect width="10" height="10"/></svg>').toString('base64');
    const bombB = Buffer.from(w2bPng(5, 400), 'base64');
    bombB.writeUInt32BE(50000, 16);
    bombB.writeUInt32BE(50000, 20);
    const hostile = {
      meta: { title: 'Hostile Pictures', author: 'X', language: 'en' },
      images: [
        { id: 'h1', name: 'bad.png', mediaType: 'image/png', data: '%%%garbage%%%' },
        { id: 'h2', name: 'evil.svg', mediaType: 'image/svg+xml', ext: 'svg', data: svg },
        { id: 'h3', name: 'bomb.png', mediaType: 'image/png', data: bombB.toString('base64') },
        { id: 'h4', name: 'big.png', mediaType: 'image/png', ext: 'png', data: w2bPng(6, 12 * 1024 * 1024) },
        { id: 'h5', name: 'html.png', mediaType: 'text/html', data: Buffer.from('<img src=x onerror="window.__pwned=3">').toString('base64') },
      ],
      sections: [{ id: 'x1', kind: 'body', type: 'chapter', title: 'One', content: 'Words.\n\n![a](img:h1)\n\n![b](img:h2)\n\n![c](img:h3)\n\n![d](img:h4)\n\n![e](img:h5)\n\n![f](img:nowhere)\n\n***\n\nEnd.', scenes: [{ at: 0, imageId: 'h2', name: '', caption: '', alt: 'x' }], plateId: 'h3', plateAlt: 'p' }],
    };
    const hf = path.join(OUT, 'wave2b-hostile.beuk-backup.json');
    writeFileSync(hf, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z', book: hostile }));
    const ctx3 = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx3, origin);
      await openBackup(page, hf);
      const b0 = await exportBackup(page);
      await page.waitForSelector('#sectionImages .sec-img-row', { timeout: 20_000 });
      const rowsN = await page.$$eval('#sectionImages .sec-img-row', (e) => e.length);
      const missing = await page.$$eval('#sectionImages .si-missing', (e) => e.length);
      await w2bStandOn(page, 0);
      await page.waitForSelector('#sceneBar.open');
      await page.click('#btnInsertImage');
      await page.waitForSelector('#imgLib [data-libimg="h5"]');
      const seen = await page.evaluate(() => {
        const srcOf = (id) => document.querySelector(`#imgLib [data-libimg="${id}"] img`)?.getAttribute('src')?.slice(0, 26) ?? null;
        return {
          src: ['h1', 'h2', 'h3', 'h4', 'h5'].map(srcOf), bar: document.getElementById('sceneBarThumb').getAttribute('src')?.slice(0, 26) ?? null,
          // an inline <svg> that is not one of the studio's own icons, where the book's pictures are drawn
          svgs: document.querySelectorAll('#imgLib svg:not(.lucide), #sectionImages svg:not(.lucide), #sceneBar svg:not(.lucide), #editorMeta svg:not(.lucide)').length,
          pageSvgs: [...document.querySelectorAll('svg:not(.lucide)')].map((x) => (x.id || x.getAttribute('class') || x.parentElement?.id || '?')).join(','),
        };
      });
      await page.waitForTimeout(500);
      const pwned = await page.evaluate(() => window.__pwned ?? null);
      await page.click('#btnCloseImage');
      const b1 = await exportBackup(page);
      check(rowsN === 6 && missing === 4 && JSON.stringify(seen.src) === JSON.stringify([null, 'data:image/svg+xml;base64,', null, 'data:image/png;base64,iVBO', null]) && seen.bar === 'data:image/svg+xml;base64,'
        && seen.svgs === 0 && pwned === null && JSON.stringify(b1.json.book) === JSON.stringify(b0.json.book),
        `wave 2b #4 hostile pictures: the card (${rowsN} rows, ${missing} "missing": malformed, pixel bomb, HTML, not in the library), the library (${JSON.stringify(seen.src)}), the scene bar's SVG only as an <img> (${seen.bar}); no inline SVG made where pictures are drawn (${seen.svgs}; the page's own non-Lucide svgs: ${seen.pageSvgs || 'none'}), nothing ran (${pwned}); the export unchanged`);
      await harvestCsp(page);
    } finally {
      await ctx3.close();
    }
  }

  /* #5 memory, and constraint 16 the stock search, on the sample book */
  const ctx2 = await newContext({ serviceWorkers: 'block' });
  await ctx2.addInitScript(() => {
    window.__blobs = { made: 0, revoked: 0 };
    const mk = URL.createObjectURL.bind(URL), rv = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => {
      window.__blobs.made++;
      return mk(o);
    };
    URL.revokeObjectURL = (u) => {
      window.__blobs.revoked++;
      return rv(u);
    };
  });
  try {
    const page = await openNext(ctx2, origin);
    await page.waitForSelector('#btnSampleStory', { timeout: 30_000 });
    await page.click('#btnSampleStory');
    await titleIs(page, 'The Lantern Coast');
    await page.waitForSelector('#manuscript .ms-editor', { timeout: 30_000 });
    // the sample's own pictures fill in from /assets/sample/ after it lands: wait for them
    for (let i = 0; i < 60; i++) {
      const out = await exportBackup(page);
      if (out.json.book.images.length && out.json.book.images.every((im) => im.data.length > 1000)) break;
      await page.waitForTimeout(500);
    }
    const blobsBefore = await page.evaluate(() => ({ ...window.__blobs }));
    const cdp = await ctx2.newCDPSession(page);
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      return (await cdp.send('Runtime.getHeapUsage')).usedSize;
    };
    const cycle = async () => {
      await page.click('#btnInsertImage');
      await page.waitForSelector('#imgLib [data-libimg] img', { timeout: 30_000 });
      await page.click('#btnCloseImage');
      await page.waitForSelector('#modalImage', { state: 'detached' });
    };
    // warm up (the first opens build the closure's state and the pictures' URLs), let the sample's own arrival settle
    await cycle();
    await cycle();
    await page.waitForTimeout(2000);
    const h0 = await heap();
    const h0b = await heap();
    for (let i = 0; i < 10; i++) await cycle();
    await page.waitForTimeout(2000);
    const h1 = await heap();
    const blobs = await page.evaluate(() => ({ ...window.__blobs }));
    await page.click('#btnInsertImage');
    await page.waitForSelector('#imgLib [data-libimg] img');
    const n = await page.$$eval('#imgLib [data-libimg] img', (e) => e.length);
    const sampleDel = await page.$$eval('#imgLib [data-imgdel^="sample-img"]', (e) => e.length);
    const toolsNote = (await page.textContent('#imgLibTools')) || '';
    await page.click('#btnCloseImage');
    const growth = (h1 - h0) / 1024 / 1024;
    note(`wave 2b #5: heap after 2 opens/closes of Insert Image on the sample (${n} pictures shown): ${(h0 / 1024 / 1024).toFixed(2)} MB (read again: ${(h0b / 1024 / 1024).toFixed(2)} MB); after 10 more: ${(h1 / 1024 / 1024).toFixed(2)} MB (${growth >= 0 ? '+' : ''}${growth.toFixed(2)} MB); blob URLs during the 12 opens: made ${blobs.made - blobsBefore.made}, revoked ${blobs.revoked - blobsBefore.revoked}`);
    check(growth < 2 && n > 0, `wave 2b #5: ten more opens of the library on the sample grow the heap by ${growth.toFixed(2)} MB (gate 2 MB, as Insights)`);
    // (a revoke counted here is the backup download's own object URL, made by the export before and revoked a moment later)
    check(blobs.made - blobsBefore.made === 0, `wave 2b #5: the library makes no blob URL (${blobs.made - blobsBefore.made} made; ${blobs.revoked - blobsBefore.revoked} revoked meanwhile, of ${blobsBefore.made} made before by the exports): its pictures are data: URLs, as 1.0's (the policy's img-src has no blob:)`);
    check(sampleDel === 0 && toolsNote.length > 0, `wave 2b #A8: the sample's pictures carry no delete control while the sample is on the desk; the tools row says "${toolsNote.trim().slice(0, 90)}"`);

    // constraint 16: Suggest by name with no shelf answering: Openverse directly (mocked here), the thumbnail and the pick under the CSP
    let searched = null;
    const fetched = [];
    await page.route('https://api.openverse.org/**', async (route) => {
      const u = route.request().url();
      fetched.push(u);
      if (u.startsWith('https://api.openverse.org/v1/images/?q=')) {
        searched = u;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ title: 'Ferry at dawn', creator: 'Ann', url: 'https://elsewhere.example/full.jpg', thumbnail: 'https://api.openverse.org/v1/images/z/thumb/', foreign_landing_url: 'https://elsewhere.example/p' }] }) });
      }
      if (u === 'https://api.openverse.org/v1/images/z/thumb/') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(w2bPng(9, 4000), 'base64') });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.route('https://elsewhere.example/**', (route) => {
      fetched.push(route.request().url());
      return route.fulfill({ status: 404, body: '' });
    });
    if ((await w2bStandOn(page, 0)) < 0) await page.click('#insertToolbar [data-insert="scenebreak"]'); // no break here: plant one (1.0's caret stands on it)
    await page.waitForSelector('#sceneBar.open', { timeout: 10_000 });
    await page.click('#btnSceneAdd');
    await page.fill('#sceneName', 'The Crossing');
    await page.click('#btnSceneSuggest');
    const q = await page.inputValue('#sceneSuggestQuery');
    await page.click('#btnSceneFind');
    await page.waitForSelector('#sceneSuggestGrid .cm-photo-cell img');
    await page.click('#sceneSuggestGrid .cm-photo-cell');
    await page.waitForFunction(() => document.getElementById('sceneAlt').value === 'Ferry at dawn', null, { timeout: 10_000 });
    const picked = (await w2bExport(page)).book;
    const pic = picked.images[picked.images.length - 1];
    await page.click('#btnCloseScene');
    check(!!searched && q.endsWith('The Crossing') && pic.name === 'Openverse — Ann' && pic.mediaType === 'image/png' && pic.credit.url === 'https://elsewhere.example/p' && !fetched.some((u) => u.startsWith('https://elsewhere.example')),
      `wave 2b constraint 16 scene.images.suggest: no shelf → Openverse directly ("${q}"), the pick joins the library as 1.0 stores it (${pic.name}, ${pic.mediaType}); the photographer's own host never fetched (${fetched.length} requests)`);
    await harvestCsp(page);
  } finally {
    await ctx2.close();
  }
}

/* ---- wave 2c: section types, matter, Add Chapter / Part, a starter, the outline board — against 1.0's own page ---- */
const W2C_SHAPE = (secs) => secs.map((x) => [x.kind, x.type, x.title, x.number, x.included].join('|'));
async function wave2cChecks(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  for (const ui of ['en', 'ar']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    if (ui === 'ar') await ctx.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      const one = await watch(await ctx.newPage());
      await one.goto(origin + '/studio');
      await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      const start = (await exportBackup(page)).json.book;
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      const oneSecs = () => one.evaluate(() => serializeBook().sections);
      if (ui === 'en') {
        // the matter library: every type, in the library's order, in both apps
        await page.click('#btnMatterLib');
        const types = await page.$$eval('[data-matter]', (els) => els.map((e) => e.getAttribute('data-matter')));
        for (const ty of types) {
          await page.click(`[data-matter="${ty}"]`);
          await one.evaluate((t) => insertMatter(t), ty);
        }
        let two = (await exportBackup(page)).json.book;
        check(JSON.stringify(W2C_SHAPE(two.sections)) === JSON.stringify(W2C_SHAPE(await oneSecs())), `wave2c: the matter library, all ${types.length} types clicked in 2.0 and run in 1.0: the same sections (kind, type, title, number, included)`);
        await page.click('#btnAddChapter');
        await page.click('#btnAddPart');
        await one.evaluate(() => { addChapter(); addPart(); });
        two = (await exportBackup(page)).json.book;
        check(JSON.stringify(W2C_SHAPE(two.sections)) === JSON.stringify(W2C_SHAPE(await oneSecs())), 'wave2c: Add Chapter and Add Part: the same sections as 1.0');
        // a section both apps hold under the same id (the pages the two apps just added have ids of their own)
        const id = start.sections.find((x) => x.kind === 'body' && x.type === 'chapter').id;
        await page.click(`#structureList .sec-item[data-sec="${id}"]`);
        await page.waitForFunction((i) => document.querySelector('#structureList .sec-item.active')?.getAttribute('data-sec') === i, id, { timeout: 30_000 });
        await page.selectOption('#secTypeSel', 'back:cta');
        await page.waitForFunction(() => document.getElementById('secTypeSel')?.value === 'back:cta', null, { timeout: 30_000 });
        await one.evaluate((i) => retypeSection(i, 'cta', 'back'), id);
        two = (await exportBackup(page)).json.book;
        { const a1 = W2C_SHAPE(two.sections), b1 = W2C_SHAPE(await oneSecs()); const k = a1.findIndex((x, i) => x !== b1[i]); check(k < 0 && a1.length === b1.length, 'wave2c: a retype (section ' + id + ') to Call to Action through #secTypeSel: the same sections as 1.0' + (k < 0 ? '' : ' — first difference at ' + k + ': 2.0 ' + a1[k] + ' / 1.0 ' + b1[k])); }
        await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), two);
        check(JSON.stringify(W2C_SHAPE(await oneSecs())) === JSON.stringify(W2C_SHAPE(two.sections)), "wave2c: 1.0 opens 2.0's book with the same sections");
        // a starter on an empty About the Author: 2.0's Use writes 1.0's starterText
        const about = two.sections.find((x) => x.type === 'aboutauthor' && !String(x.content || '').trim());
        if (about) {
          await page.click(`#structureList .sec-item[data-sec="${about.id}"]`);
          await page.waitForSelector('#starterBar [data-starter]', { timeout: 30_000 });
          await page.click('#starterBar [data-starter]');
          const sid = await page.$eval('#starterBar [data-starter][aria-pressed="true"]', (e) => e.getAttribute('data-starter'));
          await page.click('#starterUse');
          await page.waitForSelector('#starterNext', { timeout: 30_000 });
          const got = (await exportBackup(page)).json.book.sections.find((x) => x.id === about.id).content;
          const want = await one.evaluate((sx) => starterText(sx, bookLang()), sid);
          check(got === want, `wave2c: the starter ${sid} written by Use equals 1.0's starterText (${got.length} characters)`);
        } else note('wave2c: no empty About the Author page in this book: the starter check did not run');
      }
      // the outline board, by keyboard (Arabic chrome mirrors Alt + Left / Right, 1.0's rule)
      await page.click('#tabBtnOutline');
      await page.waitForSelector('#olRoot .ol-card', { timeout: 60_000 });
      const cards = () => page.$$eval('#olRoot .ol-cards[data-olkind="body"] .ol-card', (els) => els.map((e) => e.getAttribute('data-ol')));
      const ids = await cards();
      await page.focus(`#olRoot [data-ol="${ids[0]}"]`);
      await page.keyboard.press(ui === 'ar' ? 'Alt+ArrowLeft' : 'Alt+ArrowRight');
      await page.waitForFunction((a) => [...document.querySelectorAll('#olRoot .ol-cards[data-olkind="body"] .ol-card')].map((e) => e.getAttribute('data-ol'))[1] === a, ids[0], { timeout: 30_000 });
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-ol'));
      check(focused === ids[0], `wave2c (${ui}): Alt + ${ui === 'ar' ? 'Left' : 'Right'} moves the focused card one place later, and focus stays on it`);
      await page.selectOption(`#olRoot [data-ol="${ids[0]}"] [data-olf="status"]`, 'draft');
      await page.focus(`#olRoot [data-ol="${ids[0]}"] .ol-tagin`);
      await page.keyboard.type('harbour');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-oltag="harbour"]', { timeout: 30_000 });
      await page.focus(`#olRoot [data-ol="${ids[0]}"] [data-olf="synopsis"]`);
      await page.keyboard.type('The lamps are lit.');
      await page.keyboard.press('Tab');
      await page.focus('[data-olview="grid"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#olThreadName', { timeout: 30_000 });
      await page.focus('#olThreadName');
      await page.keyboard.type('The keeper');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-olthname]', { timeout: 30_000 });
      await page.waitForTimeout(500);
      const two = (await exportBackup(page)).json.book;
      const s0 = two.sections.find((x) => x.id === ids[0]);
      const threads = two.outline && Array.isArray(two.outline.threads) ? two.outline.threads.length : 0;
      check(s0.status === 'draft' && JSON.stringify(s0.tags) === '["harbour"]' && s0.synopsis === 'The lamps are lit.' && threads === 1,
        `wave2c (${ui}): status, a tag, a synopsis and a thread, set from the keyboard, are in the export (${JSON.stringify({ status: s0.status, tags: s0.tags, syn: s0.synopsis, threads })})`);
      // 1.0 shows them identically: its own state after applyBookDoc of 2.0's export, and its own serializeBook
      const seen = await one.evaluate(({ b, id }) => {
        applyBookDoc(JSON.parse(JSON.stringify(b)));
        const s = state.sections.find((x) => x.id === id);
        return { status: s.status, tags: s.tags, syn: s.synopsis, tagReg: olBook().tags.map((x) => x.name + ':' + x.colour), threads: olBook().threads.map((x) => x.name), pack: JSON.stringify(serializeBook().outline) };
      }, { b: two, id: ids[0] });
      check(seen.status === 'draft' && JSON.stringify(seen.tags) === '["harbour"]' && seen.syn === 'The lamps are lit.' && seen.threads.join() === 'The keeper' && seen.pack === JSON.stringify(two.outline),
        `wave2c (${ui}): 1.0 reads the board's data back identically (tags ${seen.tagReg.join(',')}, threads ${seen.threads.join(',')}) and serializes the same outline`);
      if (ui === 'ar') {
        // V's decision (2026-11-01), fixed in 1.0 too: on 1.0's own board in Arabic chrome, a real Alt + ArrowDown key
        // press moves the focused card LATER (1.0 used to read it as earlier in RTL)
        const oneDir = await one.evaluate(() => document.documentElement.getAttribute('dir'));
        await one.evaluate(() => olCheckOpen('cards'));
        await one.waitForSelector('#olRoot .ol-cards[data-olkind="body"] .ol-card', { timeout: 30_000 });
        const oneCards = () => one.$$eval('#olRoot .ol-cards[data-olkind="body"] .ol-card', (els) => els.map((e) => e.getAttribute('data-ol')));
        const o0 = await oneCards();
        await one.focus(`#olRoot [data-ol="${o0[0]}"]`);
        await one.keyboard.press('Alt+ArrowDown');
        const moved = await one.waitForFunction((a) => [...document.querySelectorAll('#olRoot .ol-cards[data-olkind="body"] .ol-card')].map((e) => e.getAttribute('data-ol'))[1] === a, o0[0], { timeout: 10_000 }).then(() => true, () => false);
        check(oneDir === 'rtl' && moved, `wave2c (ar): on 1.0's own board (dir ${oneDir}), Alt + ArrowDown moves the first card one place later (${(await oneCards()).slice(0, 2).join(', ')})`);
      }
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
}

async function openInNext(page, file) {
  if (await page.$('#btnOpenBackup')) return openBackup(page, file);
  const title = JSON.parse(readFileSync(file, 'utf8')).book.meta.title;
  await dropOn(page, file);
  await page.waitForFunction(() => !!document.getElementById('modalConfirm') || /Backup opened/.test(document.getElementById('toasts')?.textContent || ''), null, { timeout: 60_000 });
  if (await page.$('#modalConfirm')) await page.click('#modalConfirm #btnConfirmYes');
  await titleIs(page, title);
}

async function insightsChecks(origin) {
  const base = fixtures.find((f) => f.name === 'real/lunas-beach-standalone');
  const books = fixtures.filter((f) => f.name.startsWith('real/')).map((f) => ({ name: f.name, file: f.file, book: f.book }));
  for (const [lang, lines] of Object.entries(SCRIPT_LINES)) {
    const book = scriptBook(base.book, lang, lines);
    const file = path.join(OUT, `insights-${lang}.beuk-backup.json`);
    writeFileSync(file, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book }));
    books.push({ name: `script/${lang}`, file, book });
  }
  // #1 the room equals 1.0's, markup and numbers, on every fixture in its language (and in Arabic chrome for one)
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const one = await watch(await ctx.newPage());
      await one.goto(origin + '/studio');
      await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      const page = await openNext(ctx, origin);
      await page.waitForSelector('#btnOpenBackup, .desk', { timeout: 60_000 });
      const same = [], differ = [];
      for (const b of [...books, { ...books.find((x) => x.name === base.name), name: base.name + ' (Arabic chrome)', ui: 'ar' }]) {
        if (b.ui) {
          await one.evaluate(() => setUiLang('ar', { persist: false }));
          await page.click('#btnUiLang');
          await page.click('#uiLangMenu [data-lang="ar"]');
          await page.waitForFunction(() => document.documentElement.dir === 'rtl');
        }
        await one.evaluate((book) => {
          applyBookDoc(JSON.parse(JSON.stringify(book)));
          window.beukInsights.open();
        }, b.book);
        const html1 = await insightsMarkup(one);
        await one.evaluate(() => document.getElementById('btnCloseInsights').click());
        await openInNext(page, b.file);
        await page.click('#btnInsights');
        await page.waitForSelector('#insBody .ins-sec, #insBody .ins-empty', { timeout: 60_000 });
        const html2 = await insightsMarkup(page);
        await page.click('#btnCloseInsights');
        await page.waitForSelector('#modalInsights', { state: 'detached' });
        if (html1.html === html2.html) same.push(`${b.name} (${html2.html.length} chars at ${html2.w} px)`);
        else {
          let i = 0;
          while (i < html1.html.length && html1.html[i] === html2.html[i]) i++;
          differ.push(`${b.name}: 1.0 ${html1.w}px vs 2.0 ${html2.w}px, first difference at ${i}: 1.0 «${html1.html.slice(Math.max(0, i - 60), i + 80)}» 2.0 «${html2.html.slice(Math.max(0, i - 60), i + 80)}»`);
        }
        if (b.ui) {
          await one.evaluate(() => setUiLang('en', { persist: false }));
          await page.click('#btnUiLang');
          await page.click('#uiLangMenu [data-lang="en"]');
          await page.waitForFunction(() => document.documentElement.dir === 'ltr');
        }
      }
      check(differ.length === 0, `wave 1c #1: Story Insights and Names on stage equal 1.0's room, markup and numbers (page card aside): ${same.length} of ${same.length + differ.length} books${differ.length ? ' — ' + differ.join(' | ') : ''}`);
      note(same.join('; '));
    } finally {
      await ctx.close();
    }
  }
  // #2 keyboard and tooltip in a real layout; #5 Dumas: time to draw, listeners released, no heap growth over 10 reopenings
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, DUMAS.file);
      const cdp = await ctx.newCDPSession(page);
      const listeners = async () => {
        const out = {};
        for (const expr of ['window', 'document']) {
          const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
          const { listeners: l } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
          out[expr] = l.length;
        }
        return out;
      };
      const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const openRoom = async () => {
        const t0 = await page.evaluate(() => performance.now());
        await page.click('#btnInsights');
        await page.waitForSelector('#insBody .cast-sec', { timeout: 60_000 });
        return (await page.evaluate(() => performance.now())) - t0;
      };
      const closeRoom = async () => {
        await page.click('#btnCloseInsights');
        await page.waitForSelector('#modalInsights', { state: 'detached' });
      };
      const before = await listeners();
      const cold = await openRoom();
      // the keyboard: roving focus and the tooltip's first line (1.0's insFactValues)
      const kb = await page.evaluate(() => {
        const marks = [...document.querySelector('#insBody svg.ins-plot').querySelectorAll('.ins-mark')];
        marks[0].focus();
        const tip1 = document.getElementById('insTip').textContent;
        marks[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return { moved: document.activeElement === marks[1], tab: marks[1].getAttribute('tabindex'), tip1, shown: !document.getElementById('insTip').hidden, n: marks.length };
      });
      check(kb.moved && kb.tab === '0' && kb.shown && kb.tip1.length > 0, `wave 1c #2: Dumas, roving focus moves through the ${kb.n} rhythm columns, the tooltip shows ("${kb.tip1.slice(0, 60)}")`);
      await closeRoom();
      const warm = await openRoom();
      await closeRoom();
      const after1 = await listeners();
      const h0 = await heap();
      const times = [];
      for (let i = 0; i < 10; i++) {
        times.push(await openRoom());
        await closeRoom();
      }
      const h1 = await heap();
      const after = await listeners();
      const grow = h1 - h0;
      note(`wave 1c #5: Dumas Insights — first open ${cold.toFixed(0)} ms (cold: computed and drawn), second ${warm.toFixed(0)} ms, ten more: median ${times.slice().sort((a, b) => a - b)[5].toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms`);
      note(`wave 1c #5: heap after one open/close ${(h0 / 1048576).toFixed(2)} MB, after ten more ${(h1 / 1048576).toFixed(2)} MB (${grow >= 0 ? '+' : ''}${(grow / 1048576).toFixed(2)} MB)`);
      check(JSON.stringify(after1) === JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(before), `wave 1c #5: closing Insights releases its listeners (window/document listeners before ${JSON.stringify(before)}, after one ${JSON.stringify(after1)}, after eleven ${JSON.stringify(after)})`);
      check(grow < 2 * 1048576, `wave 1c #5: ten reopenings do not grow the heap past noise (${(grow / 1048576).toFixed(2)} MB, limit 2 MB)`);
      check(!(await page.$('#insTip')), 'wave 1c #5: the tooltip leaves with the room');
    } finally {
      await ctx.close();
    }
  }
}

/* ---- wave 1c: the Notebook and its research files (review focus #4; 1.0's notebook.research.csp) ---- */
async function notebookChecks(origin) {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    const base = fixtures.find((f) => f.name === 'real/lunas-beach-standalone');
    await openBackup(page, base.file);
    await page.click('#btnNotebook');
    await page.waitForSelector('#modalNotebook #nbList', { timeout: 60_000 });
    await page.click('#btnNbNew');
    await page.fill('#nbTitle', 'Made in 2.0');
    await page.fill('#nbBody', 'A note with a recording and a PDF.');
    // a PDF and a recording through the file picker (1.0's notebook.research.csp: frame-src and media-src allow blob:)
    const pdf = path.join(OUT, 'ledger.pdf'), wav = path.join(OUT, 'gulls.wav');
    writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    writeFileSync(wav, Buffer.from([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0, 100, 97, 116, 97, 0, 0, 0, 0]));
    await page.setInputFiles('#rsFileInput', [pdf, wav]);
    await page.waitForFunction(() => document.querySelectorAll('#rsRow [data-rsfile]').length === 2, null, { timeout: 30_000 });
    const viewed = [];
    for (const name of ['ledger.pdf', 'gulls.wav']) {
      await page.locator('[data-rsview]', { hasText: name }).click();
      const el = await page.waitForSelector('#rsView iframe.rs-pdf, #rsView audio.rs-audio', { timeout: 10_000 });
      viewed.push(await el.evaluate((e) => e.tagName.toLowerCase() + ' ' + e.getAttribute('src').slice(0, 5)));
      await page.waitForTimeout(600);
      await page.locator('[data-rsview]', { hasText: name }).click(); // close it again
    }
    const v = await page.evaluate(() => (window.__csp || []).filter((x) => String(x.blocked || '').startsWith('blob')));
    check(v.length === 0 && viewed.join(',') === 'iframe blob:,audio blob:', `wave 1c notebook.research.csp: a PDF frame and a player from object URLs load under the served policy with no violation (${viewed.join(', ')})`);
    await closeByEscape(page, '#modalNotebook');
    const out = await exportBackup(page);
    const nb = out.json.book.notebook, rs = out.json.book.research;
    check(nb && nb.notes.length === 1 && nb.notes[0].title === 'Made in 2.0' && rs && rs.files.length === 2 && rs.files.find((f) => f.name === 'gulls.wav').mediaType === 'audio/wav',
      `wave 1c #4: the note and its two files are in the exported book, as 1.0 writes them (${nb ? nb.notes.length : 0} note, ${rs ? rs.files.length : 0} files)`);
    // a reload keeps them
    await page.reload();
    await page.waitForSelector('.desk', { timeout: 60_000 });
    const again = await exportBackup(page);
    check(JSON.stringify(again.json.book) === JSON.stringify(out.json.book), 'wave 1c #4: after a reload the book (notes and files) exports exactly the same');
    // 1.0 reads them: same notes, same files, and its own save writes them byte for byte
    const one = await watch(await ctx.newPage());
    await one.goto(origin + '/studio');
    await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    const seen = await one.evaluate((book) => {
      applyBookDoc(JSON.parse(JSON.stringify(book)));
      const ser = serializeBook();
      return { notes: nbBook().notes.map((n) => n.title + ':' + (n.files || []).length), files: rsBook().files.map((f) => f.name + ':' + f.mediaType), same: JSON.stringify(ser.notebook) === JSON.stringify(book.notebook) && JSON.stringify(ser.research) === JSON.stringify(book.research) };
    }, out.json.book);
    check(seen.same && seen.notes.join() === 'Made in 2.0:2', `wave 1c #4: 1.0 reads the notebook made in 2.0 (${seen.notes.join(', ')}; ${seen.files.join(', ')}) and saves it byte for byte`);
    await one.close();
    // wave 1c task 4: the sample's text is its own chunk, fetched only when the sample is built
    const chunk = () => page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /closure-sample-/.test(n)).length);
    const beforeLoad = await chunk();
    // and 2.0 reads 1.0's: the sample (1.0's buildSampleBook) with its three notes and their files
    await page.click('#btnSampleStory');
    await page.waitForSelector('#modalConfirm', { timeout: 30_000 });
    await page.click('#modalConfirm #btnConfirmYes');
    await page.waitForFunction(() => document.getElementById('btnSampleStory')?.querySelector('.lucide-book-x'), null, { timeout: 60_000 });
    await page.click('#btnNotebook');
    await page.waitForSelector('#modalNotebook #nbList [data-nb]', { timeout: 60_000 });
    const afterLoad = await chunk();
    check(beforeLoad === 0 && afterLoad === 1, `wave 1c task 4: the sample chunk is not fetched while a book is open, Insights and the Notebook used (${beforeLoad}), and is fetched once by Load sample (${afterLoad})`);
    const listed = await page.$$eval('#nbList [data-nb]', (els) => els.map((e) => e.getAttribute('data-nb')));
    check(listed.length === 3 && listed.includes('sample-nb-depths'), `wave 1c #4: 2.0 shows 1.0's sample notes (${listed.join(', ')})`);
    await closeByEscape(page, '#modalNotebook');
  } finally {
    await ctx.close();
  }
}

/* ---- wave 3a: goals, Zen, Read Aloud, dictation and the language bar, in Chromium ----
   The speech APIs are stubbed in both apps the same way (W3A_SPEECH, before any page script): a fixed list of voices
   that records what is spoken, and a SpeechRecognition that records each recogniser and lets the check speak into it.
   Zen's checks are 1.0's own self-checks (zen.*), re-run against 2.0's page through 1.0's own seams
   (window.beukZen / beukZenSound, which 2.0 publishes over the same lifted code); the page surface is 2.0's
   #manuscript where 1.0 names its #editorArea textarea. */
const W3A_SPEECH = () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US', voiceURI: 'sam', default: true, localService: true },
    { name: 'Daniel', lang: 'en-GB', voiceURI: 'dan', default: false, localService: true },
    { name: 'Anna', lang: 'de-DE', voiceURI: 'anna', default: false, localService: true },
    { name: 'Monica', lang: 'es-ES', voiceURI: 'mon', default: false, localService: true },
  ];
  window.__spoken = [];
  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  const synth = {
    getVoices: () => voices,
    speak: (u) => window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice ? u.voice.name : null }),
    cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
    speaking: false, paused: false, pending: false,
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
  window.SpeechSynthesisUtterance = Utterance;
  window.__recs = [];
  class Recognition {
    constructor() {
      window.__recs.push(this);
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.aborted = false;
    }
    start() {}
    stop() { if (this.onend) this.onend(); }
    abort() { this.aborted = true; if (this.onend) this.onend(); }
    emit(list) {
      if (!this.onresult) return;
      this.onresult({ resultIndex: 0, results: list.map(([s, fin]) => Object.assign([{ transcript: s }], { isFinal: !!fin })) });
    }
  }
  window.SpeechRecognition = Recognition;
  window.webkitSpeechRecognition = Recognition;
};
const W3A_ES = 'El viejo farero subía cada mañana las escaleras de piedra y miraba el mar que brillaba bajo el sol. No hablaba con nadie en el pueblo, pero todos lo conocían y los niños le llevaban pan y cartas. Cuando llegaba el invierno, la niebla cubría el puerto y él encendía la lámpara para los barcos.';
const W3A_EN = 'The lighthouse keeper climbed the stone stairs every morning and looked out over the sea that shone under the sun. He spoke to no one in the village, but everyone knew him, and the children brought him bread and letters.';

/** 1.0's zen self-checks, in the page (2.0 or 1.0): `ed` is the writing surface. Each returns [ok, detail]. */
const ZEN_CHECKS = (edSel) => {
  const $ = (id) => document.getElementById(id);
  const Z = window.beukZen, snd = window.beukZenSound;
  const ed = () => document.querySelector(edSel);
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden'; };
  const out = {};
  const run = (id, fn) => { try { out[id] = fn(); } catch (e) { out[id] = [false, 'threw ' + (e && e.stack ? e.stack : e)]; } finally { try { Z.overrideReducedMotion(null); Z.set(false); Z.settle(); Z.dayClock(null); Z.dayHidden(null); } catch { /* */ } } };
  run('zen.transition.presence', () => {
    Z.set(true);
    const engaged = document.body.classList.contains('zen') && (!!$('zenTitle') || document.body.classList.contains('zen-fading') || document.body.classList.contains('zen-art-in') || Z.transitioning());
    const flash = $('zenFlash');
    const washCrossed = !!flash && (flash.classList.contains('go') || flash.classList.contains('go-out'));
    Z.settle();
    const mark = $('zenMark'), cluster = $('zenCluster');
    let clusterOp = -1;
    if (cluster) { cluster.style.transition = 'none'; clusterOp = parseFloat(getComputedStyle(cluster).opacity); cluster.style.transition = ''; }
    const markVisible = !!mark && getComputedStyle(mark).display !== 'none' && clusterOp > 0;
    const art = $('zenArt');
    const wash = art ? art.querySelector('.zen-wash') : null, vig = art ? art.querySelector('.zen-vig') : null;
    let washOp = -1, vigOp = -1;
    if (wash) { wash.style.transition = 'none'; washOp = parseFloat(getComputedStyle(wash).opacity); wash.style.transition = ''; }
    if (vig) { vig.style.transition = 'none'; vigOp = parseFloat(getComputedStyle(vig).opacity); vig.style.transition = ''; }
    const settled = document.body.classList.contains('zen') && document.body.classList.contains('zen-art-in') && !!$('zenArt');
    Z.set(false); Z.settle();
    const gone = !document.body.classList.contains('zen') && !$('zenMark') && !$('zenCluster') && !$('zenArt') && !$('zenTitle') && !$('zenFlash');
    return [engaged && washCrossed && markVisible && washOp > 0 && vigOp > 0 && settled && gone, `engaged ${engaged}, wash ${washCrossed}, mark ${markVisible} (cluster opacity ${clusterOp}), wash ${washOp} / vignette ${vigOp}, settled ${settled}, gone after exit ${gone}`];
  });
  run('zen.transition.reduced-motion', () => {
    Z.overrideReducedMotion(true);
    Z.set(true);
    const title = $('zenTitle');
    let titleOp = -1;
    if (title) { title.style.transition = 'none'; titleOp = parseFloat(getComputedStyle(title).opacity); title.style.transition = ''; }
    const presented = !!title && title.classList.contains('show') && titleOp > 0.9;
    const opacityOnly = !document.body.classList.contains('zen-fading') && !document.body.classList.contains('zen-breath');
    const art = $('zenArt');
    const stillZen = document.body.classList.contains('zen-art-in') && !!art && !!art.querySelector('.zen-vig') && !!$('zenFlash');
    Z.overrideReducedMotion(null); Z.set(false); Z.settle();
    const gone = !$('zenTitle') && !$('zenArt') && !$('zenFlash');
    return [presented && opacityOnly && stillZen && gone, `title shown at opacity ${titleOp} (${presented}), no settle/breath classes ${opacityOnly}, art and vignette ${stillZen}, gone ${gone}`];
  });
  run('zen.background.art', () => {
    Z.set(true); Z.settle();
    const art = $('zenArt'), paint = $('zenPaint');
    const bg = paint ? getComputedStyle(paint).backgroundImage : '';
    const present = !!art && !!paint && /assets\/zen\/(bliss|calm|mind|sakura)\.webp/.test(bg) && !$('zenArtSvg');
    const noEvents = !!art && getComputedStyle(art).pointerEvents === 'none';
    const behind = !!art && parseInt(getComputedStyle(art).zIndex, 10) < 0;
    const edBg = ed() ? getComputedStyle(ed()).backgroundColor : '';
    const m = edBg.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
    const opaque = parts.length === 3 || (parts.length === 4 && parts[3] >= 0.99);
    Z.set(false); Z.settle();
    const absent = !$('zenArt') && !$('zenArtSvg');
    return [present && noEvents && behind && opaque && absent, `painting ${present} (${bg.slice(0, 70)}), pointer-events none ${noEvents}, behind ${behind}, the page surface ${edBg} (opaque ${opaque}), absent after exit ${absent}`];
  });
  run('zen.calm.manuscript-only', () => {
    Z.set(true); Z.settle();
    const tabsGone = !vis($('tabBtnContent')) && !vis($('tabBtnOutline')) && !vis($('tabBtnType'));
    const det = $('zenDetailsToggle');
    const foldedDetails = !!det && vis(det) && !vis($('secSettings')) && !vis($('editorMeta')) && det.getAttribute('aria-expanded') === 'false';
    if (det) det.click();
    const openDetails = vis($('secSettings')) && det.getAttribute('aria-expanded') === 'true';
    if (det) det.click();
    const noCount = !vis($('editorWordBar')) && getComputedStyle($('zenCount')).opacity === '0';
    const er = ed().getBoundingClientRect(), pill = $('zenPill').getBoundingClientRect(), nav = $('zenNav') ? $('zenNav').getBoundingClientRect() : pill;
    const tall = er.height >= window.innerHeight * 0.55 && er.bottom <= Math.min(pill.top, nav.top) + 1;
    const snug = pill.width < 260;
    const bg1 = $('zenPaint') ? getComputedStyle($('zenPaint')).backgroundImage : '';
    const painted = /assets\/zen\/(bliss|calm|mind|sakura)\.webp/.test(bg1) && !$('zenArtSvg');
    const listed = ['bliss', 'calm', 'mind', 'sakura'].every((k) => !!document.querySelector('#zenScenePop .zs-opt[data-paint="' + k + '"]'));
    const sak = document.querySelector('#zenScenePop .zs-opt[data-paint="sakura"]');
    if (sak) sak.click();
    const chosen = !!sak && /sakura\.webp/.test(getComputedStyle($('zenPaint')).backgroundImage) && sak.getAttribute('aria-checked') === 'true';
    Z.set(false); Z.settle(); Z.set(true); Z.settle();
    const rotates = listed && chosen && /sakura\.webp/.test(getComputedStyle($('zenPaint')).backgroundImage);
    return [tabsGone && foldedDetails && openDetails && noCount && tall && snug && painted && rotates,
      `tabs gone ${tabsGone}, details folded ${foldedDetails} and open on a click ${openDetails}, no count ${noCount}, the page ${Math.round(er.top)}–${Math.round(er.bottom)} vs the bottom controls ${Math.round(Math.min(pill.top, nav.top))} (tall ${tall}), bar ${Math.round(pill.width)} px (snug ${snug}), painted ${painted}, four listed / sakura chosen and remembered ${rotates}`];
  });
  run('zen.day.reduced-motion', () => {
    let t = 9000;
    Z.overrideReducedMotion(true); Z.dayClock(() => t); Z.dayHidden(false);
    Z.set(true); Z.settle();
    Z.setDayPhase(0.1);
    const art = $('zenArt');
    const still = !!art && art.classList.contains('zen-still');
    const POS = ['--zd-gx', '--zd-gy', '--zd-gx2', '--zd-gy2'];
    let posAnimated = 'none';
    if (art) {
      const cs = getComputedStyle(art);
      const props = cs.transitionProperty.split(',').map((x) => x.trim());
      const durs = cs.transitionDuration.split(',').map((x) => parseFloat(x) || 0);
      const hit = props.find((pr, i) => (POS.includes(pr) || pr === 'all') && (durs[i % durs.length] || 0) > 0);
      if (hit) posAnimated = hit;
    }
    const glow = () => { const onB = !!art && art.classList.contains('zd-glow-b'); const g = (k) => (art ? art.style.getPropertyValue(k).trim() : ''); return { onB, vis: onB ? g('--zd-gx2') + ' ' + g('--zd-gy2') : g('--zd-gx') + ' ' + g('--zd-gy') }; };
    const visLayer = () => { const g = (k) => getComputedStyle(art).getPropertyValue(k).trim(); return glow().onB ? g('--zd-gx2') + ' ' + g('--zd-gy2') : g('--zd-gx') + ' ' + g('--zd-gy'); };
    const g0 = glow();
    t += 60; Z.dayTick();
    const smallWaits = glow().onB === g0.onB;
    const visBefore = visLayer();
    const g1 = glow();
    t += 600; Z.dayTick();
    const g2 = glow();
    const g = (k) => (art ? art.style.getPropertyValue(k).trim() : '');
    const oldLayerKept = (g1.onB ? g('--zd-gx2') + ' ' + g('--zd-gy2') : g('--zd-gx') + ' ' + g('--zd-gy')) === g1.vis;
    const crossfaded = g2.onB !== g1.onB && g2.vis !== g1.vis && oldLayerKept && visBefore === g1.vis;
    Z.set(false); Z.settle(); Z.dayClock(null); Z.dayHidden(null);
    return [still && posAnimated === 'none' && smallWaits && crossfaded, `still ${still}, light-position transition ${posAnimated}, a 1-minute step waited ${smallWaits}, crossfade ${g1.vis} → ${g2.vis} (${crossfaded})`];
  });
  run('zen.controls.no-overlap', () => {
    Z.overrideReducedMotion(true);
    Z.set(true); Z.settle();
    const vw = document.documentElement.clientWidth;
    const bad = [];
    if (!/16px/.test(getComputedStyle($('zenCluster')).insetInlineEnd || '')) bad.push('the cluster is not placed by inset-inline-end');
    const v = (el) => el && el.getClientRects().length && getComputedStyle(el).display !== 'none';
    const ctrls = ['zenMark', 'btnZenSound', 'btnZenScenes', 'btnZenDictate'].map((id) => $(id)).filter(v);
    const tabs = [$('zenDetailsToggle')].filter(v);
    if (!ctrls.length || !tabs.length) bad.push("controls or the page's first line not shown");
    for (const c of ctrls) {
      const a = c.getBoundingClientRect();
      if (a.left < -0.5 || a.right > vw + 0.5) bad.push(c.id + ' outside the window');
      for (const tb of tabs) { const b = tb.getBoundingClientRect(); if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bad.push(c.id + ' covers ' + tb.id); }
    }
    const e = ed().getBoundingClientRect();
    if (e.left < -0.5 || e.right > vw + 0.5) bad.push(`the page runs past the window (${Math.round(e.left)}–${Math.round(e.right)})`);
    const cl = $('zenCluster').getBoundingClientRect();
    return [bad.length === 0, `${document.documentElement.lang} at ${window.innerWidth}×${window.innerHeight}: cluster ${Math.round(cl.left)}–${Math.round(cl.right)}${bad.length ? ' — ' + bad.join('; ') : ', no overlap'}`];
  });
  return out;
};

/** 1.0's zen sound checks (zen.sound.*), in the page. Async: the files are fetched and decoded. */
const ZEN_SOUND_CHECKS = async () => {
  const $ = (id) => document.getElementById(id);
  const Z = window.beukZen, snd = window.beukZenSound;
  const out = {};
  // zen.sound.files-decode: every scene's file, same origin, audio/mpeg, sizes, decoded length, seamless loop
  try {
    const files = snd.files();
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const rows = []; let total = 0; let ok = !!OAC;
    for (const s of OAC ? snd.scenes() : []) {
      const f = files[s];
      const res = await fetch(snd.url(s), { credentials: 'same-origin' });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      const bytes = await res.arrayBuffer();
      const size = bytes.byteLength; total += size;
      const ctx = new OAC(2, 1, 44100);
      const buf = await new Promise((resolve, reject) => { try { const p = ctx.decodeAudioData(bytes, resolve, reject); if (p && p.then) p.then(resolve, reject); } catch (e) { reject(e); } });
      const sr = buf.sampleRate, d = buf.getChannelData(0);
      const want = f.pad * 2 + f.loop;
      const durOk = Math.abs(buf.duration - want) < 0.15;
      const a = Math.round(f.pad * sr), b = Math.round((f.pad + f.loop) * sr), n = Math.round(0.05 * sr);
      const rms = (i0, i1) => { let q = 0; for (let i = i0; i < i1; i++) q += d[i] * d[i]; return Math.sqrt(q / Math.max(1, i1 - i0)); };
      const step = 20 * Math.log10((rms(b - n, b) + 1e-9) / (rms(a, a + n) + 1e-9));
      let best = -1;
      for (let lag = -64; lag <= 64; lag++) { let xy = 0, xx = 0, yy = 0; for (let i = 0; i < 8192; i++) { const x = d[a + i], y = d[b + i + lag]; xy += x * y; xx += x * x; yy += y * y; } const c = xy / Math.sqrt(xx * yy + 1e-12); if (c > best) best = c; }
      const jump = Math.abs(d[b] - d[b - 1]);
      let q = 0; for (let i = a + 1; i < a + 4097; i++) q += Math.abs(d[i] - d[i - 1]);
      const seamOk = Math.abs(step) < 3 && best > 0.9 && jump < (q / 4096) * 8 + 1e-4;
      const rowOk = res.ok && type === 'audio/mpeg' && size > 100 * 1024 && size <= 1.5 * 1024 * 1024 && durOk && seamOk;
      ok = ok && rowOk;
      rows.push(`${s}: ${new URL(res.url).pathname} ${res.status} ${type} ${(size / 1024).toFixed(0)} KB, ${buf.duration.toFixed(3)} s (want ${want.toFixed(3)}), seam ${step.toFixed(2)} dB r=${best.toFixed(3)}`);
    }
    ok = ok && total <= 4.5 * 1024 * 1024;
    out['zen.sound.files-decode'] = [ok, (OAC ? '' : 'no OfflineAudioContext; ') + rows.join('; ') + `; total ${(total / 1024).toFixed(0)} KB`];
  } catch (e) {
    out['zen.sound.files-decode'] = [false, 'threw ' + e];
  }
  // zen.sound.opt-in
  try {
    Z.set(true); Z.settle();
    const quietOnEntry = !snd.playing() && !snd.hasContext() && snd.status().status === 'off';
    const btn = $('btnZenSound');
    const offOnEntry = !!btn && btn.getAttribute('aria-pressed') === 'false';
    btn.click();
    const st1 = snd.status().status;
    const honest = (st1 === 'loading' && !snd.playing() && btn.getAttribute('aria-pressed') === 'false' && btn.getAttribute('aria-busy') === 'true') ||
      (st1 === 'on' && snd.playing() && btn.getAttribute('aria-pressed') === 'true') ||
      ((st1 === 'error' || st1 === 'blocked') && !snd.playing() && btn.getAttribute('aria-pressed') === 'false');
    const started = snd.hasContext() || st1 === 'error';
    btn.click();
    const stopped = !snd.playing() && !snd.hasContext() && snd.status().status === 'off' && btn.getAttribute('aria-pressed') === 'false' && !btn.hasAttribute('aria-busy');
    const forgot = snd.pref() === false;
    btn.click();
    const restarted = snd.hasContext() || snd.status().status === 'error';
    Z.set(false); Z.settle();
    const stoppedOnExit = !snd.playing() && !snd.hasContext() && snd.status().status === 'off';
    Z.set(true); Z.settle();
    const noAutoResume = !snd.playing() && !snd.hasContext();
    Z.set(false); Z.settle();
    out['zen.sound.opt-in'] = [quietOnEntry && offOnEntry && started && honest && stopped && forgot && restarted && stoppedOnExit && noAutoResume,
      `entry quiet ${quietOnEntry}/${offOnEntry}; click → ${st1} (honest ${honest}, started ${started}); again → stopped ${stopped}, preference forgotten ${forgot}; again → ${restarted}; exit → ${stoppedOnExit}; re-entry silent ${noAutoResume}`];
  } catch (e) {
    out['zen.sound.opt-in'] = [false, 'threw ' + e];
  }
  // zen.sound.scenes (the in-page half: files, migration, the popover rows, start / switch, no synthesis)
  const AC = window.AudioContext || window.webkitAudioContext;
  const proto = AC ? AC.prototype : null;
  const spied = ['createOscillator', 'createBiquadFilter', 'createBuffer', 'createScriptProcessor', 'createConstantSource', 'createIIRFilter'];
  const calls = {}, orig = {};
  try {
    if (proto) spied.forEach((k) => { if (typeof proto[k] === 'function') { orig[k] = proto[k]; calls[k] = 0; proto[k] = function (...a) { calls[k]++; return orig[k].apply(this, a); }; } });
    const scenes = snd.scenes(), files = snd.files();
    const filesOk = scenes.join(',') === 'rain,waves,wind' && scenes.every((s) => { const f = files[s]; const u = new URL(snd.url(s)); return !!f && f.file === 'assets/sound/' + s + '.mp3' && u.origin === location.origin && /\/assets\/sound\/(rain|waves|wind)\.mp3$/.test(u.pathname) && f.pad > 0 && f.pad < 2 && f.loop >= 45 && f.loop <= 90; });
    const mig = [snd.migrate('rain-drum'), snd.migrate('nonsense'), snd.migrate(null), snd.migrate('waves'), snd.migrate('wind'), snd.migrate('rain')].join(',');
    localStorage.setItem('beuk.zenScene.v1', 'rain-drum');
    const migStored = snd.scene() === 'rain' && localStorage.getItem('beuk.zenScene.v1') === 'rain';
    Z.set(true); Z.settle();
    const silentBefore = !snd.hasContext() && !snd.playing();
    const caret = $('btnZenScenes');
    caret.click();
    const pop = $('zenScenePop');
    const rows = pop ? [...pop.querySelectorAll('.zs-opt[data-scene]')] : [];
    const popOk = !!pop && pop.classList.contains('open') && rows.map((r) => r.getAttribute('data-scene')).join(',') === 'rain,waves,wind';
    rows.find((r) => r.getAttribute('data-scene') === 'waves')?.click();
    const pickedWaves = snd.scene() === 'waves' && !snd.hasContext();
    $('btnZenSound').click();
    const g1 = snd.graph(), st1 = snd.status();
    const targetOk = !!g1 && ((st1.status === 'loading' && st1.pending === 'waves') || (st1.status === 'on' && g1.scene === 'waves') || st1.status === 'error') && !('masterFilterType' in g1);
    caret.click();
    $('zenScenePop').querySelector('[data-scene="wind"]')?.click();
    const st2 = snd.status();
    const switchOk = snd.scene() === 'wind' && (st2.pending === 'wind' || (snd.graph() && snd.graph().scene === 'wind') || st2.status === 'error');
    await snd.settled();
    Z.set(false); Z.settle();
    const stoppedOnExit = !snd.playing() && !snd.hasContext();
    const noSynth = Object.values(calls).every((n) => n === 0);
    out['zen.sound.scenes'] = [filesOk && mig === 'rain,rain,rain,waves,wind,rain' && migStored && silentBefore && popOk && pickedWaves && targetOk && switchOk && stoppedOnExit && noSynth,
      `files ${filesOk} (${scenes.map((s) => new URL(snd.url(s)).pathname).join(', ')}); migration ${mig}, stored ${migStored}; silent before ${silentBefore}; popover ${popOk}; waves ${pickedWaves}, start ${st1.status}/${st1.pending || (g1 && g1.scene)} (${targetOk}); switch to wind ${switchOk}; stopped on exit ${stoppedOnExit}; synthesis calls ${JSON.stringify(calls)}`];
  } catch (e) {
    out['zen.sound.scenes'] = [false, 'threw ' + e];
  } finally {
    if (proto) Object.keys(orig).forEach((k) => { proto[k] = orig[k]; });
    try { Z.set(false); Z.settle(); } catch { /* */ }
  }
  return out;
};

async function wave3aChecks(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  // ---- a small book made by 1.0: an English chapter, one with a Spanish tail, and one all Spanish ----
  let small = null;
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const one = await watch(await ctx.newPage());
      await one.goto(origin + '/studio');
      await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      small = await one.evaluate(([en, es]) => {
        const b = buildEmptyBook();
        b.meta.title = 'Wave Three';
        b.meta.language = 'en';
        b.meta.langSource = 'manual';
        const front = b.sections.filter((s) => s.kind === 'front');
        b.sections = front.concat([
          mkSection('body', 'chapter', 'Harbour', { number: '1', content: [en, en, en, en].join('\n\n') }),
          mkSection('body', 'chapter', 'Puerto', { number: '2', content: [en, es, es, es].join('\n\n') }),
        ]);
        return b;
      }, [W3A_EN, W3A_ES]);
    } finally {
      await ctx.close();
    }
  }
  const smallFile = path.join(OUT, 'wave3a-small.beuk-backup.json');
  writeFileSync(smallFile, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: small }));
  const bodyIds = small.sections.filter((s) => s.kind === 'body').map((s) => s.id);

  for (const ui of ['en', 'ar']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(W3A_SPEECH);
    if (ui === 'ar') await ctx.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      const start = (await exportBackup(page)).json.book;
      const firstCh = start.sections.find((x) => x.kind === 'body' && x.type === 'chapter');
      await page.click(`#structureList .sec-item[data-sec="${firstCh.id}"]`);
      await page.waitForSelector('#manuscript .ms-editor', { timeout: 30_000 });
      await page.waitForFunction(() => !!window.beukZen && !!window.beukZenSound, null, { timeout: 30_000 });

      // ---- Zen: 1.0's self-checks on 2.0's page; 1.0's own run of the same checks, same window, beside them ----
      const zen = await page.evaluate(ZEN_CHECKS, '#manuscript');
      const oneRef = await watch(await ctx.newPage());
      await oneRef.goto(origin + '/studio');
      await oneRef.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      await oneRef.evaluate(([b, id]) => { applyBookDoc(JSON.parse(JSON.stringify(b))); selectSection(id); }, [start, firstCh.id]);
      const oneZen = await oneRef.evaluate((ids) => Object.fromEntries(ids.map((id) => {
        const sc = SELF_CHECKS.find((x) => x.id === id);
        if (!sc) return [id, null];
        try { const v = sc.run(); return [id, [v.pass, v.detail]]; } catch (e) { return [id, [false, 'threw ' + e]]; }
      })), Object.keys(zen));
      await oneRef.close();
      await page.bringToFront();
      for (const [id, [ok, detail]] of Object.entries(zen)) {
        const ref = oneZen[id];
        // gated: 2.0 passes, or 1.0's own check fails as well in this window (then both are printed, and the report says so)
        check(ok || (ref && !ref[0]), `wave3a (${ui}) ${id}: ${ok ? 'passes' : 'FAILS'} in 2.0 — ${detail}` + (ok ? '' : ` || 1.0's own self-check in the same window: ${ref ? (ref[0] ? 'PASSES' : 'fails too') + ' — ' + String(ref[1]).slice(0, 400) : 'not found'}`));
      }
      if (ui === 'en') {
        const sound = await page.evaluate(ZEN_SOUND_CHECKS);
        for (const [id, [ok, detail]] of Object.entries(sound)) check(ok, `wave3a (${ui}) ${id}: ${detail}`);
      }
      // Escape leaves Zen; Alt+Right moves to the next section without leaving
      await page.click('#btnZen');
      await page.waitForFunction(() => document.body.classList.contains('zen'), null, { timeout: 10_000 });
      await page.evaluate(() => window.beukZen.settle());
      const secBefore = await page.$eval('#manuscript', (e) => e.getAttribute('data-section'));
      await page.keyboard.press('Alt+ArrowRight');
      await page.waitForFunction((s) => document.getElementById('manuscript')?.getAttribute('data-section') !== s, secBefore, { timeout: 10_000 }).catch(() => undefined);
      const secAfter = await page.$eval('#manuscript', (e) => e.getAttribute('data-section'));
      check(secAfter !== secBefore && (await page.evaluate(() => document.body.classList.contains('zen'))), `wave3a (${ui}) zen.nav.switch: Alt + Right opened section ${secAfter} after ${secBefore}, still in Zen`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.beukZen.settle());
      check(!(await page.evaluate(() => document.body.classList.contains('zen'))), `wave3a (${ui}) Escape leaves Zen`);
      check(JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), `wave3a (${ui}) Zen entered, browsed and left: the export is unchanged`);

      if (ui === 'en') {
        // ---- per-device keys, both ways, with 1.0 on the same device ----
        await page.evaluate(() => {
          window.beukZen.set(true);
          window.beukZen.settle();
          document.getElementById('btnZenScenes').click();
          document.querySelector('#zenScenePop [data-scene="waves"]').click();
          document.querySelector('#zenScenePop [data-paint="mind"]').click();
          window.beukZen.set(false);
          window.beukZen.settle();
        });
        const one = await watch(await ctx.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        const oneSees = await one.evaluate(() => [zenScenePref(), zenPaintPref()]);
        check(oneSees.join() === 'waves,mind', `wave3a: 1.0 on the same device reads 2.0's beuk.zenScene.v1 / beuk.zen.painting.v1 as ${oneSees.join(' / ')}`);
        await one.evaluate(() => { zenSceneSetPref('wind'); localStorage.setItem(ZEN_PAINT_KEY, 'calm'); });
        const twoSees = await page.evaluate(() => [window.beukZenSound.scene(), localStorage.getItem('beuk.zen.painting.v1')]);
        check(twoSees.join() === 'wind,calm', `wave3a: 2.0 reads 1.0's choices back: ${twoSees.join(' / ')}`);

        // ---- the look in Zen next to 1.0 (reduced motion, settled, the same painting and light): reported ----
        await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
        await one.evaluate((id) => selectSection(id), firstCh.id);
        await page.click(`#structureList .sec-item[data-sec="${firstCh.id}"]`);
        await page.waitForSelector(`#manuscript .ms-editor`, { timeout: 30_000 });
        const zenOn = () => {
          window.beukZen.overrideReducedMotion(true);
          window.beukZen.dayClock(() => 1000);
          window.beukZen.set(true);
          window.beukZen.settle();
          window.beukZen.setDayPhase(0.3);
        };
        await one.evaluate(zenOn);
        await page.evaluate(zenOn);
        for (const p of [one, page]) await p.waitForTimeout(1200);
        const a = await one.screenshot(), b = await page.screenshot();
        writeFileSync(path.join(OUT, 'wave3a-zen-one.png'), a);
        writeFileSync(path.join(OUT, 'wave3a-zen-two.png'), b);
        const dctx = await browser.newContext();
        try {
          const d = await pixelDiff(await dctx.newPage(), a, b);
          note(`wave3a: Zen, the whole window, 1.0 vs 2.0: ${(d.ratio * 100).toFixed(2)}% of pixels differ [${d.size}] (reported, not gated: 1.0's page is a textarea, 2.0's the editor)`);
        } finally {
          await dctx.close();
        }
        const offZen = () => { window.beukZen.set(false); window.beukZen.settle(); window.beukZen.dayClock(null); window.beukZen.overrideReducedMotion(null); };
        await one.evaluate(offZen);
        await page.evaluate(offZen);

        // ---- Read Aloud (stubbed speech): the same first words, language and voice as 1.0 ----
        const readIn = async (p, app) => {
          await p.evaluate(() => { window.__spoken = []; });
          await p.click('#btnReadAloud');
          await p.waitForSelector('#raPop:not([hidden])', { timeout: 10_000 });
          const options = await p.$$eval('#raVoice option', (os) => os.map((o) => o.value));
          await p.click('#raPlay');
          await p.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 10_000 });
          const s = await p.evaluate(() => window.__spoken[0]);
          await p.click('#raStop');
          await p.keyboard.press('Escape');
          return { app, options, ...s };
        };
        const r2 = await readIn(page, '2.0'), r1 = await readIn(one, '1.0');
        check(r2.lang === r1.lang && r2.voice === r1.voice && r2.text === r1.text && r2.options.join() === r1.options.join(),
          `wave3a readaloud.voices / controls: 2.0 spoke "${String(r2.text).slice(0, 40)}…" in ${r2.lang} with ${r2.voice} (options ${r2.options.join(', ')}); 1.0: "${String(r1.text).slice(0, 40)}…" in ${r1.lang} with ${r1.voice}`);
        check(JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), 'wave3a: Read Aloud opened, played and stopped: the export is unchanged');
        await one.close();
      }
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }

  // ---- dictation and the language bar, on the small book, 2.0 next to 1.0 ----
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(W3A_SPEECH);
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, smallFile);
      const start = (await exportBackup(page)).json.book;
      const one = await watch(await ctx.newPage());
      await one.goto(origin + '/studio');
      await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      await page.bringToFront();
      await page.click(`#structureList .sec-item[data-sec="${bodyIds[0]}"]`);
      await page.waitForSelector('#manuscript .ms-editor', { timeout: 30_000 });
      await page.evaluate(() => document.getElementById('manuscript').beukEditor.commands.focus('end'));
      await focused(page);
      // first use: 1.0's intro popover (the privacy line), then Begin; the recogniser hears the book's language
      await page.click('#btnDictate');
      await page.waitForSelector('#dictPop.open #dictPopBegin', { timeout: 10_000 });
      await page.click('#dictPopBegin');
      const recLang = await page.evaluate(() => window.__recs.length && window.__recs[window.__recs.length - 1].lang);
      check(recLang === 'en-US' && (await page.evaluate(() => localStorage.getItem('beuk.dictSeen.v1'))) === '1', `wave3a dictation.controls: Begin starts a recogniser in ${recLang}; beuk.dictSeen.v1 is "1"`);
      await page.evaluate(() => window.__recs[window.__recs.length - 1].emit([['the lamps', false]]));
      await page.evaluate(() => window.__recs[window.__recs.length - 1].emit([['the lamps were lit', true]]));
      await page.click('#btnDictate'); // stop
      const after = (await exportBackup(page)).json.book.sections.find((s) => s.id === bodyIds[0]).content;
      const want = start.sections.find((s) => s.id === bodyIds[0]).content + ' the lamps were lit';
      // 1.0 hears the same phrase into its own textarea
      await one.bringToFront();
      const oneAfter = await one.evaluate((id) => {
        selectSection(id);
        const area = document.getElementById('editorArea');
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
        dict.seen = true;
        window.beukDictation.start();
        const r = window.__recs[window.__recs.length - 1];
        r.emit([['the lamps', false]]);
        r.emit([['the lamps were lit', true]]);
        window.beukDictation.stop();
        return serializeBook().sections.find((s) => s.id === id).content;
      }, bodyIds[0]);
      check(after === want && after === oneAfter, `wave3a dictation.insert: the phrase lands at the caret, interim words never doubled — 2.0 equals 1.0 (${after === oneAfter}), "…${after.slice(-40)}"`);
      // one Undo takes the phrase back
      await page.bringToFront();
      await page.evaluate(() => document.getElementById('manuscript').beukEditor.commands.focus());
      await focused(page);
      await page.keyboard.press('Control+z');
      const undone = (await exportBackup(page)).json.book;
      check(JSON.stringify(undone) === JSON.stringify(start), 'wave3a dictation.insert: one Undo takes the whole phrase back (the export equals the book as opened)');

      // the language bar: the Spanish tail of an English book offers dictation in Spanish; the tap writes what 1.0 writes
      await page.click(`#structureList .sec-item[data-sec="${bodyIds[1]}"]`);
      await page.waitForSelector('#langBar.open[data-kind="section"]', { timeout: 15_000 });
      const code = await page.$eval('#langBar', (e) => e.dataset.code);
      await page.click('#langBar [data-lb="dict"]');
      const tapped = (await exportBackup(page)).json.book;
      const oneTapped = await one.evaluate(([b, id]) => {
        applyBookDoc(JSON.parse(JSON.stringify(b)));
        selectSection(id);
        dictSetLang('es');
        return serializeBook();
      }, [undone, bodyIds[1]]);
      check(code === 'es' && JSON.stringify(tapped.dictation) === JSON.stringify(oneTapped.dictation) && tapped.meta.language === 'en',
        `wave3a dictation.language-suggest: the bar offered ${code}; the tap wrote dictation ${JSON.stringify(tapped.dictation)} (1.0: ${JSON.stringify(oneTapped.dictation)}), the book stays ${tapped.meta.language}`);
      // the picker (right-click): a pick from 1.0's own popover reaches the book, as 1.0's dictSetLang saves it
      await page.click('#btnDictate', { button: 'right' });
      await page.waitForSelector('#dictPop.open #dictLangSel', { timeout: 10_000 });
      await page.selectOption('#dictLangSel', 'fr');
      const picked = (await exportBackup(page)).json.book;
      const onePicked = await one.evaluate(() => { dictSetLang('fr'); return serializeBook().dictation; });
      check(JSON.stringify(picked.dictation) === JSON.stringify(onePicked), `wave3a dictation.language-picker: the pick wrote ${JSON.stringify(picked.dictation)} (1.0: ${JSON.stringify(onePicked)})`);
      await page.keyboard.press('Escape');
      // 1.0 opens 2.0's book with the same dictation choice
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), picked);
      const oneInfo = await one.evaluate(() => dictLangInfo().lang);
      check(oneInfo === 'fr-FR', `wave3a: 1.0 opens 2.0's book and dictates in ${oneInfo}`);
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }

  // ---- goals: the same book and writing log on the same device, 2.0's Goals room next to 1.0's ----
  {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      const start = (await exportBackup(page)).json.book;
      await page.click('#btnGoals');
      await page.waitForSelector('#modalGoals #goalsProgress', { timeout: 30_000 });
      await page.waitForTimeout(500);
      const two = await page.evaluate(() => ({ progress: document.getElementById('goalsProgress')?.innerText ?? '', kept: document.getElementById('goalKept')?.innerText ?? '', lines: document.getElementById('goalLines')?.innerText ?? '' }));
      await page.click('#btnCloseGoals');
      await page.waitForSelector('#modalGoals', { state: 'detached', timeout: 10_000 });
      const one = await watch(await ctx.newPage());
      await one.goto(origin + '/studio');
      await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      await one.click('#btnGoals');
      await one.waitForTimeout(500);
      const oneSaw = await one.evaluate(() => ({ progress: document.getElementById('goalsProgress')?.innerText ?? '', kept: document.getElementById('goalKept')?.innerText ?? '', lines: document.getElementById('goalLines')?.innerText ?? '' }));
      for (const k of ['progress', 'kept', 'lines']) check(two[k] === oneSaw[k], `wave3a goals: #${k === 'progress' ? 'goalsProgress' : k === 'kept' ? 'goalKept' : 'goalLines'} reads the same in 2.0 and 1.0 ("${two[k].replace(/\s+/g, ' ').slice(0, 80)}")${two[k] === oneSaw[k] ? '' : ` — 1.0: "${oneSaw[k].replace(/\s+/g, ' ').slice(0, 80)}"`}`);
      check(JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), 'wave3a goals: the Goals room opened and closed: the export is unchanged');
      // the no-edit gate's rooms (readOnlyRooms, with wave 3a's surfaces), once here on this book, on its first chapter
      await page.bringToFront();
      const ch = start.sections.find((x) => x.kind === 'body' && x.type === 'chapter');
      await page.click(`#structureList .sec-item[data-sec="${ch.id}"]`);
      await page.waitForSelector('#manuscript .ms-editor', { timeout: 30_000 });
      const rooms = await readOnlyRooms(page);
      check(/Goals/.test(rooms) && /Zen, Read Aloud, the dictation picker/.test(rooms) && JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), `wave3a: the no-edit gate's rooms on this book (${rooms}): the export is unchanged`);
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
}

/* ---- step 5 wave 3b: the Covenant (C6) ---- */
/** 1.0 on its own page with this book, that section on its desk, its underline mirror drawn: 1.0's desk hits. */
async function oneDeskHits(one, book, secId) {
  return one.evaluate(([b, id]) => {
    applyBookDoc(JSON.parse(JSON.stringify(b)));
    selectSection(id);
    bibleDeskRender(true);
    return { hits: window.beukBible.desk.hits.map((h) => ({ s: h.s, e: h.e, id: h.id })), text: document.getElementById('editorArea').value };
  }, [book, secId]);
}
/** 2.0's marks on the open chapter, once they have settled (the closure loads, the matcher is read, the plugin draws). */
async function twoRanges(page) {
  await page.waitForFunction(() => !!window.beukCovenant, null, { timeout: 30_000 });
  let last = '', same = 0;
  for (let i = 0; i < 40 && same < 3; i++) {
    const now = JSON.stringify(await page.evaluate(() => window.beukCovenant.ranges()));
    same = now === last ? same + 1 : 0;
    last = now;
    await page.waitForTimeout(100);
  }
  return JSON.parse(last);
}
async function openOne(ctx, origin) {
  const one = await watch(await ctx.newPage());
  await one.goto(origin + '/studio');
  await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
  return one;
}
async function wave3bChecks(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  for (const ui of ['en', 'ar']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    if (ui === 'ar') await ctx.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      const start = (await exportBackup(page)).json.book;
      const one = await openOne(ctx, origin);
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      // ---- the room, beside 1.0's: the list, the first entry's form and mentions, the signed-out series line ----
      await page.bringToFront();
      await page.click('#btnBible');
      await page.waitForSelector('#modalBible #bibList .bib-item', { timeout: 30_000 });
      const read = (p) => p.evaluate(() => ({
        list: document.getElementById('bibList')?.innerText ?? '',
        detail: document.getElementById('bibDetail')?.innerText ?? '',
        series: (() => { const el = document.getElementById('bibSeriesLine'); return el && !el.hidden ? el.textContent : ''; })(),
        marks: document.getElementById('tglBibMarks')?.getAttribute('aria-pressed'),
      }));
      const two = await read(page);
      await one.evaluate(() => openBible());
      const oneSaw = await read(one);
      for (const k of ['list', 'series', 'marks']) check(two[k] === oneSaw[k], `wave3b (${ui}) the room's ${k} reads as 1.0's: "${String(two[k]).replace(/\s+/g, ' ').slice(0, 90)}"${two[k] === oneSaw[k] ? '' : ` — 1.0: "${String(oneSaw[k]).replace(/\s+/g, ' ').slice(0, 90)}"`}`);
      check(!!two.series, `wave3b (${ui}) signed out, a book that names a series says so in one line (1.0's bible.seriesSignIn): "${two.series}"`);
      const firstId = start.bible.entries[0].id;
      await page.click(`.bib-item[data-bib-id="${firstId}"]`);
      await page.waitForSelector('#bibMentions .ins-h', { timeout: 10_000 });
      await one.evaluate((id) => { bibleUi.sel = id; bibleUi.mode = 'entry'; bibleUi.detail = true; bibleRender(); }, firstId);
      const twoD = (await read(page)).detail, oneD = (await read(one)).detail;
      check(twoD === oneD, `wave3b (${ui}) the first entry's form and mentions read as 1.0's (${twoD.length} characters)${twoD === oneD ? '' : ` — 2.0: "${twoD.replace(/\s+/g, ' ').slice(0, 200)}" / 1.0: "${oneD.replace(/\s+/g, ' ').slice(0, 200)}"`}`);
      await closeByEscape(page, '#modalBible');
      await one.evaluate(() => bibleClose());
      check(JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), `wave3b (${ui}) the room opened, browsed and closed: the export is unchanged`);
      // ---- the marks, chapter by chapter, against 1.0's desk ----
      let secs = 0, hits = 0;
      const bad = [];
      for (const [i, s] of start.sections.entries()) {
        if (s.kind !== 'body' || !String(s.content || '').trim()) continue;
        await page.bringToFront();
        await choose(page, i);
        const ranges = await twoRanges(page);
        const ref = await oneDeskHits(one, start, s.id);
        const want = await page.evaluate((h) => window.beukCovenant.expected(h), ref.hits);
        const text = await page.evaluate(() => window.beukCovenant.text());
        secs++;
        hits += ref.hits.length;
        if (text !== ref.text || JSON.stringify(ranges) !== JSON.stringify(want)) bad.push(`${s.id} (2.0 ${ranges.length} / 1.0 ${ref.hits.length}${text === ref.text ? '' : ', TEXT DIFFERS'})`);
      }
      check(!bad.length && hits > 0, `wave3b (${ui}) review focus #2: the marks on all ${secs} chapters are 1.0's desk spans, ${hits} marks${bad.length ? ' — differ: ' + bad.join(', ') : ''}`);
      // ---- the card: hover, a click on a name, Alt+Enter at the caret, Escape ----
      const ch = start.sections.findIndex((s) => s.kind === 'body' && s.type === 'chapter');
      await page.bringToFront();
      await choose(page, ch);
      await twoRanges(page);
      const box = await page.$eval('#manuscript .bm', (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getClientRects()[0]; return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: el.getAttribute('data-bib-id'), bottom: r.bottom, left: r.left }; });
      await page.mouse.move(box.x - 300, box.y);
      await page.mouse.move(box.x, box.y);
      await page.waitForSelector('#bibleCard:not([hidden])', { timeout: 5000 });
      const card = await page.$eval('#bibleCard', (el) => ({ text: el.innerText, how: el.getAttribute('data-how'), top: parseFloat(el.style.top), icons: el.querySelectorAll('svg').length }));
      const oneCard = await one.evaluate(([b, id, secId]) => {
        selectSection(secId); bibleDeskRender(true);
        const i = window.beukBible.desk.hits.findIndex((h) => h.id === id);
        window.beukBible.card(i, false);
        const el = document.getElementById('bibleCard');
        const out = el ? el.innerText : '';
        bibleCardHide();
        return out;
      }, [start, box.id, start.sections[ch].id]);
      check(card.how === 'hover' && card.text === oneCard && card.top >= box.bottom, `wave3b (${ui}) hover on a name: 1.0's card (${card.icons} icons), below the name, the same text as 1.0's ("${card.text.replace(/\s+/g, ' ').slice(0, 80)}")${card.text === oneCard ? '' : ` — 1.0: "${oneCard.replace(/\s+/g, ' ').slice(0, 80)}"`}`);
      await page.mouse.move(5, 5);
      await page.waitForSelector('#bibleCard', { state: 'hidden', timeout: 5000 });
      const ref = await oneDeskHits(one, start, start.sections[ch].id);
      const h0 = ref.hits[0];
      await page.bringToFront();
      await page.evaluate((o) => { const m = document.getElementById('manuscript'); m.beukText.select(o, o); m.beukEditor.view.focus(); }, h0.s + 1);
      await page.keyboard.press('Alt+Enter');
      await page.waitForSelector('#bibleCard:not([hidden])', { timeout: 5000 });
      const how = await page.$eval('#bibleCard', (el) => el.getAttribute('data-how'));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#bibleCard', { state: 'hidden', timeout: 5000 });
      check(how === 'caret', `wave3b (${ui}) Alt+Enter with the caret on a name opens its card (data-how ${how}); Escape closes it`);
      check(JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), `wave3b (${ui}) review focus #5: hovering marks and opening cards: the export is unchanged`);
      if (ui === 'ar') {
        // the no-edit gate's rooms (readOnlyRooms, with the Covenant room and a hovered mark), once here, on this book
        const rooms = await readOnlyRooms(page);
        check(/Covenant/.test(rooms) && JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), `wave3b: the no-edit gate's rooms on this book (${rooms}): the export is unchanged`);
      }
      if (ui === 'en') {
        // ---- Alt+M: a change pinned to a selection near a name, saved as 1.0 saves it; its margin dot opens the entry ----
        await page.evaluate(([s, e]) => { const m = document.getElementById('manuscript'); m.beukText.select(s, e); m.beukEditor.view.focus(); }, [h0.s, h0.e + 12]);
        await page.keyboard.press('Alt+M');
        await page.waitForFunction(() => !document.getElementById('bibleMarkPop')?.hidden || !document.getElementById('bibleMarkMenu')?.hidden, null, { timeout: 5000 });
        if (await page.$('#bibleMarkMenu:not([hidden])')) await page.keyboard.press('Enter');
        await page.waitForSelector('#bibleMarkPop:not([hidden]) #bibMarkText', { timeout: 5000 });
        await page.keyboard.type('w3b change at the quay');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#bibleMarkPop', { state: 'hidden', timeout: 5000 });
        const after = (await exportBackup(page)).json.book;
        const ent = after.bible.entries.find((e) => (e.changes || []).some((c) => c.text === 'w3b change at the quay'));
        const chg = ent && ent.changes.find((c) => c.text === 'w3b change at the quay');
        const oneRead = await one.evaluate(([b, eid]) => {
          applyBookDoc(JSON.parse(JSON.stringify(b)));
          const e = bibleById(eid); const c = e && (e.changes || []).find((x) => x.text === 'w3b change at the quay');
          return { found: !!(c && bibleAnchorFind(c.anchor, state.sections)), same: JSON.stringify(serializeBook().bible) === JSON.stringify(b.bible) };
        }, [after, ent ? ent.id : '']);
        check(!!chg && chg.anchor.sec === start.sections[ch].id && chg.anchor.at === h0.s && oneRead.found && oneRead.same && JSON.stringify(after.sections) === JSON.stringify(start.sections),
          `wave3b Alt+M: the change is saved on ${ent ? ent.name : '(none)'} pinned at ${chg ? chg.anchor.sec + ':' + chg.anchor.at + ' "' + chg.anchor.quote + '"' : '(none)'}; 1.0 finds its passage and serializes the Covenant the same; the text is untouched`);
        await page.waitForSelector('#manuscript .bm-dotmark', { timeout: 5000 });
        await page.click('#manuscript .bm-dotmark');
        await page.waitForSelector('#modalBible #bibFName', { timeout: 10_000 });
        const opened = await page.$eval('#bibFName', (el) => el.value);
        check(opened === (ent ? ent.name : '?'), `wave3b a margin dot stands at the change and opens its entry ("${opened}")`);
        await closeByEscape(page, '#modalBible');
        // ---- a 2.0 edit read back by 1.0; a 1.0 Covenant with links, fields, facts and changes opens in 2.0 unchanged ----
        await page.click('#btnBible');
        await page.waitForSelector('#modalBible #btnBibNew', { timeout: 10_000 });
        await page.click('#btnBibNew');
        await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'bibFName', null, { timeout: 5000 });
        await page.keyboard.type('Wren Tallow');
        await closeByEscape(page, '#modalBible');
        const ed2 = (await exportBackup(page)).json.book;
        const back = await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); return JSON.stringify(serializeBook().bible); }, ed2);
        check(back === JSON.stringify(ed2.bible) && ed2.bible.entries.some((e) => e.name === 'Wren Tallow'), `wave3b review focus #1: an entry made in 2.0's room reads back in 1.0 the same (${ed2.bible.entries.length} entries)`);
        const big = await one.evaluate((b) => {
          applyBookDoc(JSON.parse(JSON.stringify(b)));
          const es = bibleEntries();
          state.bible.fields = { character: [{ id: 'age', label: 'Age' }], place: [{ id: 'pop', label: 'Population' }] };
          es[0].facts = { age: '31' };
          es[0].links = [{ to: es[1].id, label: 'sails with' }];
          const sec = state.sections.find((s) => s.kind === 'body' && String(s.content).length > 200);
          es[0].changes = [{ id: 'w3bc1', anchor: { sec: sec.id, quote: sec.content.slice(40, 70), at: 40 }, text: 'grows up', fact: { field: 'age', value: '32' } }];
          state.bible = bibleNormalize(state.bible);
          return JSON.parse(JSON.stringify(serializeBook()));
        }, start);
        const bigFile = path.join(OUT, 'wave3b-one-covenant.beuk-backup.json');
        writeFileSync(bigFile, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: big }));
        const ctx2 = await newContext({ serviceWorkers: 'block' });
        try {
          const p2 = await openNext(ctx2, origin);
          await openBackup(p2, bigFile);
          const got = (await exportBackup(p2)).json.book;
          check(JSON.stringify(got) === JSON.stringify(expected(big, got)) && !!got.bible.fields && !!got.bible.entries[0].changes, `wave3b review focus #1: a 1.0 Covenant with fields, facts, links and a change opens in 2.0 and exports unchanged (${big.bible.entries.length} entries)`);
          await harvestCsp(p2);
        } finally {
          await ctx2.close();
        }
      }
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
  // ---- Dumas with a full Covenant (constraint 27): the marks equal 1.0's, and typing stays fast ----
  const fullBook = covenantDumas(expected(DUMAS.book));
  const fullFile = path.join(OUT, 'wave3b-dumas-covenant.beuk-backup.json');
  writeFileSync(fullFile, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: fullBook }));
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, fullFile);
    const book = (await exportBackup(page)).json.book;
    check(JSON.stringify(book) === JSON.stringify(expected(fullBook, book)), `wave3b Dumas with the generated Covenant (${fullBook.bible.entries.length} entries) opens and exports unchanged`);
    const secs = sectionsOf(book);
    let big = -1;
    secs.forEach((s, i) => { if (typeof s.content === 'string' && (big < 0 || s.content.length > secs[big].content.length)) big = i; });
    await choose(page, big);
    const ranges = await twoRanges(page);
    const one = await openOne(ctx, origin);
    const ref = await oneDeskHits(one, book, secs[big].id);
    await one.close();
    await page.bringToFront();
    const want = await page.evaluate((h) => window.beukCovenant.expected(h), ref.hits);
    check(JSON.stringify(ranges) === JSON.stringify(want) && ranges.length > 100, `wave3b Dumas, the longest chapter, ${fullBook.bible.entries.length} entries: 2.0's ${ranges.length} marks are 1.0's ${ref.hits.length} desk spans`);
    const dots = await page.$$eval('#manuscript .bm-dotmark', (els) => els.length);
    note(`wave3b Dumas: ${dots} margin dots on the longest chapter`);
    // typing latency, as #5 measures it, with every mark live
    await page.evaluate(() => {
      const ed = document.getElementById('manuscript').beukEditor;
      const doc = ed.state.doc;
      let pos = 1, target = Math.floor(doc.childCount / 2), k = 0;
      doc.forEach((b, off) => { if (k++ === target) pos = off + 1 + Math.floor(b.content.size / 2); });
      ed.commands.setTextSelection(pos);
      ed.commands.focus();
      window.__lat = [];
      document.addEventListener('keydown', (e) => {
        const t0 = e.timeStamp;
        requestAnimationFrame(() => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => window.__lat.push(performance.now() - t0);
          ch.port2.postMessage(0);
        });
      }, true);
    });
    const words = 'the quick brown fox jumps over Athos and the lazy dog keeps on running ';
    await focused(page);
    await page.keyboard.type(words.slice(0, 20), { delay: 30 });
    await page.evaluate(() => { window.__lat = []; });
    let text = '';
    while (text.length < 300) text += words;
    await page.keyboard.type(text.slice(0, 300), { delay: 30 });
    await page.waitForTimeout(400);
    const lat = (await page.evaluate(() => window.__lat)).slice().sort((x, y) => x - y);
    const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)];
    const p50 = q(0.5), p95 = q(0.95), max = lat[lat.length - 1];
    note(`wave3b latency, Dumas section ${big} ("${secs[big].title}"), ${fullBook.bible.entries.length} Covenant entries, ${ranges.length} marks: ${lat.length} keystrokes: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    check(lat.length >= 290 && p95 < 16, `wave3b constraint 27: typing p95 ${p95.toFixed(1)} ms (p50 ${p50.toFixed(1)} ms) with a full Covenant, under 16 ms`);
    const after = await twoRanges(page);
    const ref2 = await (async () => {
      const o = await openOne(ctx, origin);
      const exp2 = (await exportBackup(page)).json.book;
      const r = await oneDeskHits(o, exp2, secs[big].id);
      await o.close();
      return r;
    })();
    await page.bringToFront();
    const want2 = await page.evaluate((h) => window.beukCovenant.expected(h), ref2.hits);
    check(JSON.stringify(after) === JSON.stringify(want2), `wave3b after 320 keystrokes (incremental re-scans only), the marks are still 1.0's spans (${after.length})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/* ---- the bundle: one yjs ---- */
function bundle() {
  const dir = path.join(REPO, 'client', 'next', 'assets');
  const js = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const yjs = js.split('Yjs was already imported').length - 1;
  check(yjs === 1, `bundle: one copy of yjs (${yjs} "already imported" guard${yjs === 1 ? '' : 's'})`);
  check(!/node:crypto/.test(js), 'bundle: no node:crypto');
}

/* ---- wave 4a: the Style tab and themes (D1, D2) ----
   Beside 1.0 with the same book: the tab reads as 1.0's (presets, My themes, pickers, ornaments, swatches) in English
   and Arabic chrome; browsing writes nothing; a preset, a book colour and a theme designed in 2.0 read back in 1.0
   exactly as 2.0 exported them (review focus #1); a book made in 1.0 with an uploaded font, a flourish and a custom
   theme opens in 2.0 and exports exactly, and the font is a FontFace in 2.0's document (CSP: data: fonts); a family
   that is not a CSS identifier ("Garamond 3") registers under exactly that name (fonts.upload.family-names); the tab
   is screenshotted next to 1.0's (reported, not gated). */
const W4_TTF = path.join(REPO, 'client', 'assets', 'fonts', 'pinyonscript', 'Pinyon_Script-normal-400.ttf');
function w4File(name, bytes) {
  const f = path.join(OUT, name);
  writeFileSync(f, bytes);
  return f;
}
async function w4OpenTab(page) {
  await page.click('#tabBtnType');
  await page.waitForFunction(() => document.querySelectorAll('#presetGrid [data-preset]').length === 15, null, { timeout: 60_000 });
}
const w4Read = (p) => p.evaluate(() => ({
  presets: document.getElementById('presetGrid')?.innerText ?? '',
  active: document.querySelector('#presetGrid .preset-card.active')?.getAttribute('data-preset') ?? '',
  mine: document.getElementById('myThemeGrid')?.innerText ?? '',
  body: [...document.querySelectorAll('#selBodyFont option')].map((o) => o.value).join('|'),
  head: [...document.querySelectorAll('#selHeadFont optgroup')].map((g) => g.getAttribute('label') + ':' + [...g.querySelectorAll('option')].map((o) => o.value).join(',')).join('|'),
  values: ['selBodyFont', 'selHeadFont', 'rngSize', 'rngLeading', 'selHeaderStyle', 'selIndentDepth', 'selDropDepth', 'rngSmallCaps'].map((id) => document.getElementById(id)?.value).join('|'),
  ornaments: [...document.querySelectorAll('#ornamentGrid [data-orn]')].map((b) => b.getAttribute('data-orn') + (b.classList.contains('active') ? '*' : '')).join(','),
  swatches: [...document.querySelectorAll('#colourAccentRow [data-colour], #colourTintRow [data-colour]')].map((b) => b.getAttribute('data-colour') + b.getAttribute('aria-pressed')).join(','),
  fonts: document.getElementById('fontList')?.innerText ?? '',
  flourishes: document.getElementById('flourishList')?.innerText ?? '',
}));
async function wave4aChecks(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  for (const ui of ['en', 'ar']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    if (ui === 'ar') await ctx.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      const start = (await exportBackup(page)).json.book;
      const one = await openOne(ctx, origin);
      await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); currentCenterTab = 'type'; setCenterTab('type'); }, start);
      await page.bringToFront();
      await w4OpenTab(page);
      const two = await w4Read(page), oneSaw = await w4Read(one);
      for (const k of Object.keys(two)) check(two[k] === oneSaw[k], `wave4a (${ui}) the tab's ${k} reads as 1.0's: "${String(two[k]).replace(/\s+/g, ' ').slice(0, 80)}"${two[k] === oneSaw[k] ? '' : ` — 1.0: "${String(oneSaw[k]).replace(/\s+/g, ' ').slice(0, 80)}"`}`);
      // browsing writes nothing (review focus #4): every preset hovered, the creator opened, moved, Started from, closed
      for (const b of await page.$$('#presetGrid [data-preset]')) await b.hover();
      await page.click('#btnNewTheme');
      await page.waitForSelector('#tcElements [data-tc-font="title"]', { timeout: 10_000 });
      await page.selectOption('#tcFont-title', 'Cinzel');
      await page.click('[data-tc-case="title"] [data-val="upper"]');
      await page.selectOption('#tcBase', 'preset:noir');
      await page.click('#btnTcBase');
      await page.click('#btnTcClose');
      await page.waitForTimeout(400);
      check(JSON.stringify((await exportBackup(page)).json.book) === JSON.stringify(start), `wave4a (${ui}) the tab browsed (presets hovered, the creator opened and closed): the export is unchanged`);
      if (ui === 'en') {
        // ---- review focus #1: a preset, a colour, a body face, a range and a designed theme, read back in 1.0 ----
        await page.click('#presetGrid [data-preset="noir"]');
        await page.click('#colourAccentRow [data-colour="#1f3a64"]');
        await page.click('#colourTintRow [data-colour="#fbf5e6"]');
        await page.selectOption('#selBodyFont', 'Lora');
        await page.$eval('#rngSize', (el) => { el.value = '18.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.waitForTimeout(400);
        await page.click('#btnNewTheme');
        await page.fill('#tcName', 'Harbour Test');
        await page.selectOption('#tcFont-number', 'Cinzel');
        await page.click('[data-tc-case="title"] [data-val="upper"]');
        await page.click('#btnTcSave');
        await page.click('#btnTcClose');
        const edited = (await exportBackup(page)).json.book;
        const ct = edited.customThemes[0];
        check(edited.customThemes.length === 1 && ct.name === 'Harbour Test' && ct.theme.header.title.casing === 'upper' && ct.theme.header.number.font === 'Cinzel' && edited.activePreset === 'custom:' + ct.id,
          `wave4a the designed theme is saved and worn ("${ct && ct.name}", activePreset ${edited.activePreset})`);
        const back = await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); const s = serializeBook(); return { theme: s.theme, activePreset: s.activePreset, colour: s.colour, customThemes: s.customThemes, mine: (renderMyThemes(), document.getElementById('myThemeGrid').innerText) }; }, edited);
        for (const k of ['theme', 'activePreset', 'colour', 'customThemes']) check(JSON.stringify(back[k]) === JSON.stringify(edited[k]), `wave4a review focus #1: 1.0 reads 2.0's ${k} back exactly (${JSON.stringify(edited[k]).slice(0, 90)})`);
        check(/Harbour Test/.test(back.mine), `wave4a 1.0's My themes lists the theme 2.0 saved`);
        // deleted in 2.0: 1.0 reads it gone, the book keeps its look
        await page.click('#myThemeGrid [data-mine-del]');
        const del = (await exportBackup(page)).json.book;
        const back2 = await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); const s = serializeBook(); return { customThemes: s.customThemes, activePreset: s.activePreset, theme: s.theme }; }, del);
        check(back2.customThemes.length === 0 && back2.activePreset === null && JSON.stringify(back2.theme) === JSON.stringify(edited.theme), 'wave4a a theme deleted in 2.0: 1.0 reads it gone, the book keeps the look it wears');

        // ---- a book made in 1.0: an uploaded font, a flourish, a custom theme, opened in 2.0 ----
        await one.bringToFront();
        await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); currentCenterTab = 'type'; setCenterTab('type'); }, start);
        await one.setInputFiles('#fontFileInput', w4File('Writer-Hand.ttf', readFileSync(W4_TTF)));
        await one.waitForFunction(() => (state.fonts || []).length === 1, null, { timeout: 10_000 });
        await one.fill('#flourishName', 'Harbour star');
        await one.setInputFiles('#flourishFileInput', w4File('star.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24"><path d="M60 3 L66 12 L60 21 L54 12 Z"/></svg>'));
        await one.waitForFunction(() => (state.images || []).some((im) => im.flourish), null, { timeout: 10_000 });
        const madeIn1 = await one.evaluate(() => {
          const fl = state.images.find((im) => im.flourish);
          state.theme.ornament = 'fl:' + fl.id; state.theme.headingFlourish = fl.id; state.theme.headFont = 'Writer Hand';
          openThemeCreator(null); $('tcName').value = 'Made in one'; saveThemeCreator(); closeThemeCreator();
          setBookColour('accent', '#6b2d5c');
          return serializeBook();
        });
        const file1 = w4File('made-in-one.beuk-backup.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: madeIn1 }));
        const ctx2 = await newContext({ serviceWorkers: 'block' });
        try {
          const p2 = await openNext(ctx2, origin);
          await openBackup(p2, file1);
          await w4OpenTab(p2);
          const reg = await p2.evaluate(async () => {
            await new Promise((r) => setTimeout(r, 300));
            const faces = [...document.fonts].filter((x) => x.family.replace(/"/g, '') === 'Writer Hand');
            await Promise.all(faces.map((x) => x.loaded.catch(() => undefined)));
            return { n: faces.length, status: faces.map((x) => x.status).join(','), listed: document.getElementById('fontList').innerText.trim(), head: document.getElementById('selHeadFont').value, orn: document.querySelector('#ornamentGrid .orn-btn.active')?.getAttribute('data-orn') ?? '' };
          });
          check(reg.n >= 1 && /loaded/.test(reg.status) && /Writer Hand/.test(reg.listed) && reg.head === 'Writer Hand' && reg.orn.startsWith('fl:'),
            `wave4a a book made in 1.0 (uploaded font, flourish, theme): the face is a FontFace in 2.0 (${reg.status}), listed, worn; the flourish is the ornament (${reg.orn})`);
          const out = (await exportBackup(p2)).json.book;
          check(JSON.stringify(out) === JSON.stringify(expected(madeIn1, out)), 'wave4a review focus #1: the 1.0-made styled book, opened and its Style tab browsed in 2.0, exports exactly as readBook reads it');
          // fonts.upload.family-names: a family that is not a CSS identifier registers under exactly that name
          await p2.setInputFiles('#fontFileInput', w4File('Garamond 3.ttf', readFileSync(W4_TTF)));
          const fam = await p2.evaluate(async () => {
            for (let i = 0; i < 100; i++) {
              const faces = [...document.fonts].filter((x) => x.family.replace(/"/g, '') === 'Garamond 3');
              if (faces.length) {
                await Promise.all(faces.map((x) => x.loaded.catch(() => undefined)));
                return faces.map((x) => x.status).join(',') + ' / check ' + document.fonts.check("16px 'Garamond 3'");
              }
              await new Promise((r) => setTimeout(r, 100));
            }
            return null;
          });
          check(/loaded/.test(fam), `wave4a fonts.upload.family-names: "Garamond 3" registers under exactly that name (${fam})`);
          const shot = path.join(OUT, 'style-two-made-in-one.png');
          writeFileSync(shot, await p2.locator('#panelType').screenshot());
          note('wave4a screenshot: ' + shot);
          await harvestCsp(p2);
        } finally {
          await ctx2.close();
        }
      }
      // ---- the tab next to 1.0's (reported, not gated: the panes' widths differ until wave 4b brings the preview) ----
      await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); currentCenterTab = 'type'; setCenterTab('type'); }, start);
      await one.addStyleTag({ content: ONE_HIDE });
      const ctxS = await newContext({ serviceWorkers: 'block' });
      if (ui === 'ar') await ctxS.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
      const two2 = await openNext(ctxS, origin);
      await openBackup(two2, f.file);
      await w4OpenTab(two2);
      for (const p of [one, two2]) await p.evaluate(() => document.fonts.ready);
      const a = path.join(OUT, `style-one-${ui}.png`), b = path.join(OUT, `style-two-${ui}.png`);
      writeFileSync(a, await one.locator('#presetGrid').screenshot());
      writeFileSync(b, await two2.locator('#presetGrid').screenshot());
      note(`wave4a (${ui}) the preset grid, 1.0 / 2.0: ${a} / ${b}`);
      for (const p of [page, one, two2]) await harvestCsp(p);
      await ctxS.close();
    } finally {
      await ctx.close();
    }
  }
}

/* ---- wave 4b: the preview (E1, E2) ----
   Beside 1.0 with the same book (1.0's applyBookDoc of the book 2.0 exports): the reading desk's page counts — every
   section, every fixture, every device profile — equal 1.0's (1.0's own computeDeskCountsSync in both, at each
   profile's fixed reading area); the page breaks of the largest chapter on the visible preview (every block's page)
   equal 1.0's on three profiles; the hardcover's print pages equal 1.0's; the preview's chrome reads as 1.0's; the
   preview is isolated from the app (a hostile book changes nothing outside it and sends no request); browsing it
   writes nothing; the preview region is screenshotted next to 1.0's. */
const W4B_DEVICES = ['kindle', 'ipad', 'kobo', 'phone', 'oasis', 'basic', 'colorsoft', 'iphone', 'forma', 'android'];
const w4bParity = { rows: [], breaks: [] };
/** 1.0's desk counts for every profile, through 1.0's own computeDeskCountsSync (a count taken before a picture
 *  decoded is taken again), and the hardcover's print pages. `call` is 1.0's global or 2.0's beukPreview.call. */
const W4B_COUNTS = async ([devs, two]) => {
  const call = two ? (n, ...a) => window.beukPreview.call(n, ...a) : (n, ...a) => window[n](...a);
  await document.fonts.ready;
  // a first pass lays every section out (the faces a section asks for start loading then, pictures decode): wait for
  // them, as 1.0's own count does (pcFontGen, pcWhenDecoded)
  for (const d of devs.slice(0, 2)) {
    call('setDevice', d);
    call('computeDeskCountsSync');
  }
  await document.fonts.ready;
  await new Promise((res) => setTimeout(res, 300));
  const out = {};
  for (const d of devs) {
    call('setDevice', d);
    let r = null;
    for (let i = 0; i < 8; i++) {
      r = call('computeDeskCountsSync');
      if (!r || !r.provisional) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    out[d] = r ? { counts: r.counts, total: r.total, provisional: !!r.provisional } : null;
  }
  try {
    const m = call('hcEnsureModel', true);
    out.hardcover = m ? { total: m.pages.length } : null;
  } catch (e) {
    out.hardcover = { error: String(e) };
  }
  call('setDevice', 'kindle');
  return out;
};
/** The page every typeset block of the visible preview starts on (1.0's previewPageAtX on its first box), and the
 *  page count — on the profile `d`, once 1.0's setDevice has settled (its 330 ms re-measure). */
const W4B_BREAKS = async ([d, two]) => {
  const call = two ? (n, ...a) => window.beukPreview.call(n, ...a) : (n, ...a) => window[n](...a);
  call('setDevice', d);
  await new Promise((r) => setTimeout(r, 700));
  call('measurePages');
  const flow = document.getElementById('pageFlow');
  const blocks = [...flow.querySelectorAll('p, blockquote, h1, h2, h3, figure, .scene-break')];
  const pages = blocks.map((b) => {
    const r = b.getClientRects()[0];
    return r ? call('previewPageAtX', r.left + Math.min(4, r.width / 2)) : 0;
  });
  const st = two ? window.beukPreview.state() : state;
  return { pageCount: st.pageCount, pages };
};
async function wave4bParity(origin) {
  // W4B_FIXTURES=real/x,legacy/y narrows the sweep while working (the gate runs every fixture)
  const narrow = (process.env.W4B_FIXTURES || '').split(',').filter(Boolean);
  const books = fixtures.filter((f) => Array.isArray(f.book.sections) && (!narrow.length || narrow.includes(f.name)));
  for (const f of books) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      await page.waitForFunction(() => !!window.beukPreview, null, { timeout: 60_000 });
      const start = (await exportBackup(page)).json.book;
      const one = await openOne(ctx, origin);
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      await page.bringToFront();
      const two = await page.evaluate(W4B_COUNTS, [W4B_DEVICES, true]);
      await one.bringToFront();
      const oneC = await one.evaluate(W4B_COUNTS, [W4B_DEVICES, false]);
      for (const d of [...W4B_DEVICES, 'hardcover']) {
        const a = oneC[d], b = two[d];
        const same = JSON.stringify(a) === JSON.stringify(b);
        w4bParity.rows.push({ fixture: f.name, device: d, one: a ? a.total : null, two: b ? b.total : null, same, prov: !!(a && a.provisional) || !!(b && b.provisional) });
        if (!same) {
          const diff = a && b && a.counts ? Object.keys(a.counts).filter((k) => a.counts[k] !== b.counts?.[k]).map((k) => `${k}: ${a.counts[k]}/${b.counts?.[k]}`).slice(0, 6) : [];
          check(false, `wave4b page parity ${f.name} on ${d}: 1.0 ${JSON.stringify(a && a.total)} / 2.0 ${JSON.stringify(b && b.total)}${diff.length ? ' — sections (1.0/2.0) ' + diff.join(', ') : ''}${b && b.error ? ' ' + b.error : ''}`);
        }
      }
      const bad = w4bParity.rows.filter((r) => r.fixture === f.name && !r.same).length;
      check(bad === 0, `wave4b review focus #1: ${f.name}: every section's page count on all ${W4B_DEVICES.length} profiles and the hardcover's print pages equal 1.0's (totals ${W4B_DEVICES.map((d) => two[d]?.total).join('/')}, hardcover ${two.hardcover?.total})`);
      // the page breaks of the largest body chapter, on the visible preview
      const secs = sectionsOf(start);
      let big = -1;
      secs.forEach((s, i) => { if (s.kind === 'body' && typeof s.content === 'string' && (big < 0 || s.content.length > secs[big].content.length)) big = i; });
      if (big >= 0) {
        await page.bringToFront();
        await choose(page, big);
        await page.waitForTimeout(300);
        await one.bringToFront();
        await one.evaluate((id) => selectSection(id), secs[big].id);
        for (const d of ['kindle', 'ipad', 'phone']) {
          await one.bringToFront();
          const a = await one.evaluate(W4B_BREAKS, [d, false]);
          await page.bringToFront();
          const b = await page.evaluate(W4B_BREAKS, [d, true]);
          const same = JSON.stringify(a) === JSON.stringify(b);
          w4bParity.breaks.push({ fixture: f.name, device: d, one: a.pageCount, two: b.pageCount, blocks: a.pages.length, same });
          check(same, `wave4b page breaks ${f.name} "${secs[big].title}" on ${d}: ${b.pageCount} pages, ${b.pages.length} blocks — each block's page equals 1.0's${same ? '' : ` (1.0: ${a.pageCount} pages, ${a.pages.length} blocks; first differing block ${a.pages.findIndex((p, i) => p !== b.pages[i])})`}`);
        }
      }
      for (const p of [page, one]) await harvestCsp(p);
    } finally {
      await ctx.close();
    }
  }
  note('wave4b page parity (fixture × device: 1.0 / 2.0 desk total):');
  for (const f of books) note(`  ${f.name}: ` + [...W4B_DEVICES, 'hardcover'].map((d) => { const r = w4bParity.rows.find((x) => x.fixture === f.name && x.device === d); return `${d} ${r?.one}/${r?.two}${r?.same ? '' : ' ≠'}${r?.prov ? ' (provisional)' : ''}`; }).join(', '));
}
/** A book made to attack the preview: markup, script URLs, remote requests and CSS that would close the preview's
 *  scope, in every book value 1.0's preview takes (title, author, the section's names and text, a picture's type and
 *  bytes, the theme's fonts, indent, header style and header design, the book colour). */
function w4bHostileBook(base) {
  const b = JSON.parse(JSON.stringify(base));
  const tag = (n) => `<img src="https://evil.example/${n}.png" onerror="window.__pw=${n}">"'</style><script>window.__pw=${n}</script>`;
  b.meta.title = 'Hostile ' + tag(1);
  b.meta.author = 'Writer ' + tag(2);
  const s = b.sections.find((x) => x.kind === 'body' && x.type === 'chapter');
  s.title = 'Chapter ' + tag(3);
  s.subtitle = 'Sub ' + tag(4);
  s.number = '1' + tag(5);
  s.content = ['A paragraph <script>window.__pw=6</script> and <iframe src="https://evil.example/f"></iframe> and <img src=https://evil.example/i.png onerror=window.__pw=7>.',
    '[click](javascript:window.__pw=8) and [away](https://evil.example/a) and <a href="javascript:window.__pw=9">raw</a>.',
    '<style>#topbar{display:none}</style><link rel="stylesheet" href="https://evil.example/s.css">',
    String(s.content || '')].join('\n\n');
  b.images = [...(b.images || []), { id: 'hostile-pic', name: 'x', mediaType: 'image/png" onerror="window.__pw=10', ext: 'png', data: 'iVBORw0KGgo=" onerror="window.__pw=11' }];
  s.plateId = 'hostile-pic';
  const evil = "EB Garamond'; } body { display: none } #topbar { background: url(https://evil.example/t.png) } .x { font-family: '";
  b.theme = { ...b.theme, bodyFont: evil, headFont: 'x"); background: url(https://evil.example/h.png); x: ("', indentDepth: '1em; } #topbar { background: red } .fc-page p {', headerStyle: 'classic_centered" onmouseover="window.__pw=12',
    // review round 2: the numbers 1.0 interpolates into the CSS as they are
    fontSize: '1px; position: fixed; inset: 0; z-index: 99999; background: #fff', lineHeight: '1.5; position: fixed; inset: 0', dropDepth: '3; } #topbar { display: none } .x { x: 1' };
  if (b.theme.header) for (const k of ['number', 'title', 'subtitle']) if (b.theme.header[k]) b.theme.header[k].font = evil;
  b.colour = { accent: 'red; } #topbar { background: red } x {', tint: 'url(https://evil.example/c.png)' };
  return b;
}
const W4B_LOOK = () => {
  const props = ['display', 'visibility', 'background-color', 'background-image', 'color', 'font-family', 'font-size', 'height', 'width', 'opacity', 'transform'];
  const out = {};
  for (const sel of ['body', '#topbar', '#panes', '#pane-structure', '#pane-center', '.center-tabs', '#btnExport', '#structureList']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    out[sel] = props.map((p) => cs.getPropertyValue(p)).join('|');
  }
  return out;
};
async function wave4bIsolation(origin) {
  const base = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const book = w4bHostileBook(base.book);
  const file = w4File('hostile.beuk-backup.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book }));
  const ctx = await newContext({ serviceWorkers: 'block' });
  const away = [];
  try {
    const page = await openNext(ctx, origin);
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !/^(data|blob):/.test(u)) away.push(u);
    });
    // the app's look on the same book's honest twin, preview drawn (the baseline)
    await openBackup(page, base.file);
    await page.waitForFunction(() => !!window.beukPreview && document.getElementById('pageFlow').childElementCount > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const before = await page.evaluate(W4B_LOOK);
    const ctx2 = await newContext({ serviceWorkers: 'block' });
    try {
      const p2 = await openNext(ctx2, origin);
      p2.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(origin) && !/^(data|blob):/.test(u)) away.push(u);
      });
      await openBackup(p2, file);
      await p2.waitForFunction(() => !!window.beukPreview && document.getElementById('pageFlow').childElementCount > 0, null, { timeout: 60_000 });
      // the hostile chapter on screen, every device, the hardcover opened and turned, full screen on and off
      const i = sectionsOf(expected(book)).findIndex((x) => x.kind === 'body' && x.type === 'chapter');
      await choose(p2, i);
      await p2.waitForTimeout(400);
      await previewBrowse(p2);
      await choose(p2, i);
      await p2.waitForTimeout(400);
      const after = await p2.evaluate(W4B_LOOK);
      const diff = Object.keys(before).filter((k) => before[k] !== after[k]);
      check(diff.length === 0, `wave4b isolation (constraint 36): a hostile book's preview (every device, the hardcover open, full screen) leaves the app's computed styles as an honest book's (${Object.keys(before).length} elements × 11 properties${diff.length ? '; differ: ' + diff.join(', ') : ''})`);
      const dom = await p2.evaluate(() => {
        const roots = [document.getElementById('pane-preview'), document.getElementById('pivMeasure'), ...['bookStyle', 'pivBookStyle'].map((id) => document.getElementById(id))].filter(Boolean);
        const bad = [];
        for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
          // (a book's own https link stays a link, as in 1.0: it goes nowhere unless the writer follows it)
          for (const a of el.attributes) if (/^on/i.test(a.name) || /javascript:/i.test(a.value) || (/evil\.example/.test(a.value) && !(el.tagName === 'A' && a.name === 'href' && /^https:/.test(a.value)))) bad.push(el.tagName + '[' + a.name + ']');
          if (/^(SCRIPT|IFRAME|LINK|OBJECT|EMBED)$/.test(el.tagName)) bad.push(el.tagName);
        }
        const css = ['bookStyle', 'pivBookStyle'].map((id) => document.getElementById(id)?.textContent || '').join('\n');
        const EVIL = /evil\.example|#topbar|(^|[\s,}])body\s*\{/;
        const cssHit = (css.split('\n').find((l) => EVIL.test(l)) || '').slice(0, 300);
        return { bad, cssHit, pw: window.__pw ?? null, cssEvil: EVIL.test(css), title: document.getElementById('rhBook')?.textContent ?? '', dropped: window.beukPreview.safety.droppedRules, flows: document.getElementById('pageFlow').innerHTML.length };
      });
      check(dom.bad.length === 0 && dom.pw === null && !dom.cssEvil, `wave4b isolation: no handler, script URL, remote source or script element in the preview, the print measurer or the book stylesheets (${dom.bad.slice(0, 6).join(', ') || 'none'}); window.__pw ${dom.pw}; the stylesheets name nothing outside the preview (${!dom.cssEvil}${dom.cssEvil ? ': ' + dom.cssHit : ''}); ${dom.dropped} CSS rule(s) dropped at the sink`);
      // the second wall, by itself: hostile theme values put straight into the preview's state (past the safe path) reach
      // only the sinks — the stylesheet's rules outside the preview are dropped, the class attribute's handler removed
      const sink = await p2.evaluate(async () => {
        const P = window.beukPreview;
        const st = P.state();
        const keep = { indent: st.theme.indentDepth, header: st.theme.headerStyle };
        const before = P.safety.droppedRules;
        st.theme.indentDepth = '1em; } #topbar { display: none } body { background: url(https://evil.example/s.png) } .fc-page p { x: y';
        st.theme.headerStyle = 'classic_centered" onmouseover="window.__pw=99';
        keep.size = st.theme.fontSize;
        st.theme.fontSize = '1px; position: fixed; inset: 0; z-index: 99999; background: #fff';
        P.raw('renderPreview');
        await new Promise((r) => setTimeout(r, 300));
        const hd = document.querySelector('#pageFlow header.chapter-opening');
        window.__w4bKeep = keep;
        // the open hardcover's pages (1.0 builds them into elements of its own, through printUnlink)
        P.raw('setDevice', 'hardcover');
        P.raw('hcSetOpen', true, true);
        await new Promise((r) => setTimeout(r, 900));
        const hcPages = document.querySelectorAll('#hcStage .piv-page').length;
        const hcHandler = !!document.querySelector('#hcStage [onmouseover], #pivMeasure [onmouseover], body > [onmouseover]');
        P.raw('hcSetOpen', false, true);
        P.raw('setDevice', 'kindle');
        await new Promise((r) => setTimeout(r, 400));
        return { pw: window.__pw ?? null, dropped: P.safety.droppedRules - before, topbar: getComputedStyle(document.getElementById('topbar')).display, handler: !!document.querySelector('#pageFlow [onmouseover]') || hcHandler, hcPages, cls: hd ? hd.className : null };
      });
      sink.look = JSON.stringify(await p2.evaluate(W4B_LOOK));
      await p2.evaluate(() => {
        const st = window.beukPreview.state();
        st.theme.indentDepth = window.__w4bKeep.indent;
        st.theme.headerStyle = window.__w4bKeep.header;
        st.theme.fontSize = window.__w4bKeep.size;
        window.beukPreview.raw('renderPreview');
      });
      check(sink.dropped > 0 && sink.topbar !== 'none' && !sink.handler && sink.pw === null && sink.hcPages > 0 && sink.look === JSON.stringify(after),
        `wave4b isolation, the sinks by themselves: hostile theme values put past the safe path — ${sink.dropped} stylesheet rule(s) dropped at the sink, the top bar still shown (${sink.topbar}), no handler in the flow (header class "${String(sink.cls).slice(0, 60)}") nor on the open hardcover's ${sink.hcPages} pages, the app's computed styles unchanged (${sink.look === JSON.stringify(after)})`);
      check(/Hostile <img/.test(dom.title), `wave4b isolation: the hostile title is shown as text in the running head ("${dom.title.slice(0, 40)}…")`);
      const out = (await exportBackup(p2)).json.book;
      check(JSON.stringify(out) === JSON.stringify(expected(book, out)), 'wave4b isolation: the hostile book, previewed, exports exactly as readBook reads it (the values are hidden from 1.0\'s code, never rewritten)');
      await harvestCsp(p2);
    } finally {
      await ctx2.close();
    }
    check(away.length === 0, `wave4b isolation: no request leaves the page (${away.length}${away.length ? ': ' + away.slice(0, 4).join(', ') : ''})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/** Wave 4b: the preview's chrome and behaviour beside 1.0's, and 1.0's preview self-checks re-expressed. */
const W4B_DEVICE_LOOK = async ([devs, two]) => {
  const call = two ? (n, ...a) => window.beukPreview.call(n, ...a) : (n, ...a) => window[n](...a);
  const frame = document.getElementById('deviceFrame');
  frame.style.transition = 'none';
  const out = {};
  for (const d of devs) {
    call('setDevice', d);
    const note = document.getElementById('deviceDisplayNote');
    out[d] = {
      cls: frame.className, maxW: getComputedStyle(frame).maxWidth, foot: document.getElementById('footDevice').textContent, display: frame.getAttribute('data-display'),
      filter: getComputedStyle(document.getElementById('deviceScreen')).filter, note: note.hidden ? '' : note.textContent,
      active: document.querySelector('#deviceBar .dev-btn.active')?.getAttribute('data-device'), facts: document.getElementById('deskFacts').textContent,
      hc: { mode: document.getElementById('pane-preview').classList.contains('hc-mode'), stage: !document.getElementById('hcStage').hidden, bar: !document.getElementById('hcBar').hidden, frame: getComputedStyle(frame).display },
    };
  }
  call('setDevice', 'kindle');
  frame.style.transition = '';
  return { bar: [...document.querySelectorAll('#deviceBar .dev-btn')].map((b) => b.getAttribute('data-device') + ':' + b.textContent.trim()), devices: out };
};
/** The hardcover beside 1.0's: closed (its parts, spine, counter, facts), then opened and turned. */
const W4B_HC = async (two) => {
  const call = two ? (n, ...a) => window.beukPreview.call(n, ...a) : (n, ...a) => window[n](...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  call('setDevice', 'hardcover');
  await wait(400);
  const stage = document.getElementById('hcStage');
  const shape = (el) => [...el.querySelectorAll('*')].map((x) => x.tagName + '.' + [...x.classList].sort().join('.')).join(' ');
  const closed = { shape: shape(stage), spine: stage.querySelector('.hc-s-title')?.textContent ?? null, art: !!stage.querySelector('.hc-front img'), counter: document.getElementById('hcCounter').textContent, facts: document.getElementById('hcFacts').textContent, toggle: document.getElementById('hcToggleLabel').textContent, book: document.getElementById('hcBook')?.getAttribute('style') ?? '' };
  document.getElementById('hcToggle').click();
  await wait(900);
  const spreads = [];
  for (let i = 0; i < 3; i++) {
    const pages = document.getElementById('hcPages');
    spreads.push({ counter: document.getElementById('hcCounter').textContent, text: pages ? pages.innerText.replace(/\s+/g, ' ').slice(0, 400) : null, n: pages ? pages.querySelectorAll('.piv-page').length : 0 });
    document.getElementById('hcNext').click();
    await wait(900);
  }
  document.getElementById('hcPrev').click();
  await wait(900);
  const back = document.getElementById('hcCounter').textContent;
  document.getElementById('hcToggle').click();
  await wait(700);
  call('setDevice', 'kindle');
  await wait(400);
  return { closed, spreads, back, after: { mode: document.getElementById('pane-preview').classList.contains('hc-mode'), frame: document.getElementById('deviceFrame').className } };
};
async function wave4bChrome(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-print');
  for (const ui of ['en', 'ar']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    if (ui === 'ar') await ctx.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      await page.waitForFunction(() => !!window.beukPreview, null, { timeout: 60_000 });
      const start = (await exportBackup(page)).json.book;
      const one = await openOne(ctx, origin);
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      // the same section open in both: 2.0's first, picked in 1.0
      await page.bringToFront();
      const id = await page.evaluate(() => window.beukPreview.state().activeId);
      await one.bringToFront();
      await one.evaluate((x) => selectSection(x), id);
      await page.bringToFront();
      const two = await page.evaluate(W4B_DEVICE_LOOK, [W4B_DEVICES, true]);
      await one.bringToFront();
      const oneL = await one.evaluate(W4B_DEVICE_LOOK, [W4B_DEVICES, false]);
      check(JSON.stringify(two.bar) === JSON.stringify(oneL.bar) && two.bar.length === 11, `wave4b (${ui}) preview.devices.expanded: the device bar reads as 1.0's (${two.bar.length} buttons: ${two.bar.map((x) => x.split(':')[0]).join(', ')})`);
      const bad = W4B_DEVICES.filter((d) => JSON.stringify(two.devices[d]) !== JSON.stringify(oneL.devices[d]));
      check(bad.length === 0, `wave4b (${ui}) preview.devices.expanded + preview.devices.display-truth: every profile's frame, size, footer, display type, screen filter, truth note and facts equal 1.0's${bad.length ? ' — differ: ' + bad.map((d) => d + ' ' + JSON.stringify(two.devices[d]).slice(0, 160) + ' / 1.0 ' + JSON.stringify(oneL.devices[d]).slice(0, 160)).join('; ') : ''}`);
      // the visible chrome around the page and the typeset page itself, on the open section
      const chrome = (p) => p.evaluate(() => ({ counter: document.getElementById('pageCounter').textContent, name: document.getElementById('previewSectionName').textContent, rh: document.getElementById('rhBook').textContent + '|' + document.getElementById('rhChapter').textContent, total: document.getElementById('deskTotal').textContent, basis: document.getElementById('deskBasis').textContent, rail: document.getElementById('deskRail').innerText, flow: document.getElementById('pageFlow').innerHTML, prev: document.getElementById('btnPrevPage').disabled, next: document.getElementById('btnNextPage').disabled, dir: document.getElementById('pageFlow').dir, lang: document.getElementById('pageFlow').getAttribute('lang'), statPages: document.getElementById('statPages')?.textContent ?? null, statsNote: document.getElementById('statsNote')?.textContent ?? null }));
      await page.bringToFront();
      await page.waitForTimeout(900);
      const c2 = await chrome(page);
      await one.bringToFront();
      await one.waitForTimeout(900);
      const c1 = await chrome(one);
      const cbad = Object.keys(c1).filter((k) => c1[k] !== c2[k]);
      check(cbad.length === 0, `wave4b (${ui}) look parity: the page counter, section line, running head, desk total, basis and rail, the page flow's typeset HTML (${c2.flow.length} characters) and the page buttons equal 1.0's; the sidebar's pages are the desk's (${c2.statPages}: "${c2.statsNote}")${cbad.length ? ' — differ: ' + cbad.map((k) => `${k} "${String(c2[k]).slice(0, 80)}" / 1.0 "${String(c1[k]).slice(0, 80)}"`).join('; ') : ''}`);
      // every section's typeset page beside 1.0's (generated.*: the generated pages' preview markup — the half title, the
      // title page, the copyright, the contents, the cover), moved to through the desk rail in both (1.0's deskGoToSection)
      if (ui === 'en') {
        const ids = sectionsOf(start).map((s) => s.id);
        const flowOf = async (p, two, id) => {
          await p.bringToFront();
          return p.evaluate(async ([x, t]) => {
            if (t) window.beukPreview.call('deskGoToSection', x);
            else deskGoToSection(x);
            await new Promise((r) => setTimeout(r, 450));
            return { flow: document.getElementById('pageFlow').innerHTML, counter: document.getElementById('pageCounter').textContent, name: document.getElementById('previewSectionName').textContent };
          }, [id, two]);
        };
        const differ = [];
        for (const id of ids) {
          const a = await flowOf(one, false, id), b = await flowOf(page, true, id);
          if (JSON.stringify(a) !== JSON.stringify(b)) differ.push(`${id} (${b.name} / 1.0 ${a.name}; ${b.counter} / ${a.counter})`);
        }
        check(differ.length === 0, `wave4b look parity, every section (${ids.length}, generated.halftitle.editor / generated.cover.editor / generated.no-message-pages: their preview half): the typeset page, its counter and its line equal 1.0's${differ.length ? ' — differ: ' + differ.slice(0, 5).join('; ') : ''}`);
      }
      // E2: the hardcover, closed and open, beside 1.0's
      await page.bringToFront();
      const sheets0 = await page.evaluate(() => ({ d: window.beukPreview.safety.droppedRules, n: window.beukPreview.safety.sheets }));
      const h2 = await page.evaluate(W4B_HC, true);
      const sheets1 = await page.evaluate(() => ({ d: window.beukPreview.safety.droppedRules, n: window.beukPreview.safety.sheets }));
      check(sheets1.n > sheets0.n && sheets1.d === 0, `wave4b (${ui}) review round 2, Minor 4: the honest book's every stylesheet, the open hardcover's included (${sheets1.n} written through the sink, ${sheets1.n - sheets0.n} while it was open), lost ${sheets1.d} rules at the sink`);
      await one.bringToFront();
      const h1 = await one.evaluate(W4B_HC, false);
      const hbad = ['closed', 'spreads', 'back', 'after'].filter((k) => JSON.stringify(h1[k]) !== JSON.stringify(h2[k]));
      check(hbad.length === 0, `wave4b (${ui}) preview.hardcover.device / page-block / binding-look / trim-proportions / spread-print / turn-jump: the closed hardback (its parts, art ${h2.closed.art}, spine "${h2.closed.spine}", "${h2.closed.counter}"), three open spreads (${h2.spreads.map((s) => s.counter).join(' → ')}) and the turn back ("${h2.back}") equal 1.0's${hbad.length ? ' — differ: ' + hbad.map((k) => k + ' ' + JSON.stringify(h2[k]).slice(0, 200) + ' / 1.0 ' + JSON.stringify(h1[k]).slice(0, 200)).join('; ') : ''}`);
      for (const p of [page, one]) await harvestCsp(p);
    } finally {
      await ctx.close();
    }
  }
}

/** 1.0's reader, desk, full-screen and RTL self-checks, re-expressed on 2.0 (driven through its own pane and editor). */
async function wave4bReader(origin) {
  const f = fixtures.find((x) => x.name === 'real/oz-14-glinda');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, f.file);
    await page.waitForFunction(() => !!window.beukPreview, null, { timeout: 60_000 });
    const st = () => page.evaluate(() => { const s = window.beukPreview.state(); return { page: s.page, count: s.pageCount, id: s.activeId, counter: document.getElementById('pageCounter').textContent }; });
    const book = expected(f.book);
    const secs = sectionsOf(book);
    const chapters = secs.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'body' && x.s.type === 'chapter' && String(x.s.content || '').length > 9000);
    const [a, b] = chapters;
    await choose(page, a.i);
    await page.waitForTimeout(500);
    const turn = async (n) => { for (let k = 1; k < n; k++) await page.click('#btnNextPage'); await page.waitForTimeout(450); };
    await turn(4);
    const was = await st();
    await choose(page, b.i);
    await page.waitForTimeout(500);
    const nb = await st();
    await turn(2);
    await choose(page, a.i);
    await page.waitForTimeout(500);
    const na = await st();
    check(was.page === 4 && nb.page === 1 && na.page === 1 && /^\D*1\D/.test(nb.counter), `wave4b preview.new-section-page-one: from page ${was.page} of "${a.s.title}", "${b.s.title}" opens at page ${nb.page} (${nb.counter}); back to the first at page ${na.page}`);
    // preview.keeps-page-on-edit (its style half): on page 4, turned by hand, the base font size raised in the Style
    // tab — the preview stands on the page now holding page 4's first words (1.0's pvPageAnchor)
    await turn(4);
    const anc = await page.evaluate(() => window.beukPreview.call('pvPageAnchor', document.getElementById('pageFlow')));
    await page.click('#tabBtnType');
    await page.waitForFunction(() => document.querySelectorAll('#presetGrid [data-preset]').length === 15, null, { timeout: 60_000 });
    await page.$eval('#rngSize', (el) => { el.value = String(Number(el.value) + 3); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(700);
    const kept = await page.evaluate((x) => ({ want: window.beukPreview.call('pvPageOfAnchor', x), page: window.beukPreview.state().page, count: window.beukPreview.state().pageCount, counter: document.getElementById('pageCounter').textContent }), anc);
    check(!!anc && kept.want > 0 && kept.page === kept.want, `wave4b preview.keeps-page-on-edit (style half): page 4 turned by hand, the font raised 3 px in the Style tab → page ${kept.page} of ${kept.count} ("${kept.counter}"), where page 4's first words now stand (${kept.want})`);
    await page.click('#tabBtnContent');
    // preview.follows-caret: a keystroke at a later paragraph turns the preview to the caret's page
    await choose(page, a.i);
    await page.waitForTimeout(500);
    const target = await page.evaluate(() => {
      const ed = document.getElementById('manuscript').beukEditor;
      const doc = ed.state.doc;
      let pos = 1, k = 0;
      const want = Math.floor(doc.childCount * 0.6);
      doc.forEach((n, off) => { if (k++ === want) pos = off + 1 + Math.floor(n.content.size / 2); });
      ed.commands.setTextSelection(pos);
      ed.commands.focus();
      return pos;
    });
    await focused(page);
    await page.keyboard.type('x');
    await page.waitForTimeout(900);
    const caret = await page.evaluate(() => {
      const st = window.beukPreview.state();
      const s = st.sections.find((x) => x.id === st.activeId);
      const c = window.beukPreview.call('pvCaretAnchor', s);
      return { want: c ? window.beukPreview.call('pvPageOfAnchor', c) : 0, page: window.beukPreview.state().page };
    });
    await page.keyboard.press('Backspace');
    check(caret.want > 1 && caret.page === caret.want, `wave4b preview.follows-caret: a keystroke at a paragraph 60% into "${a.s.title}" (position ${target}) turns the preview to page ${caret.page}, the caret's page (${caret.want})`);
    // preview.desk.totals + desk.rail: the total is the rail's sum on two profiles; a rail row moves the preview there
    for (const d of ['kindle', 'android']) {
      await page.click(`#deviceBar [data-device="${d}"]`);
      await page.waitForFunction((name) => document.getElementById('deskTotal').textContent.includes(name) && window.beukPreview.get('deskState').sig === window.beukPreview.call('deskSignature'), d === 'kindle' ? 'Kindle Paperwhite' : 'Android Tablet', { timeout: 60_000 });
      const t = await page.evaluate(() => ({ total: window.beukPreview.get('deskState').total, sum: Object.values(window.beukPreview.get('deskState').counts).reduce((x, y) => x + y, 0), text: document.getElementById('deskTotal').textContent }));
      check(t.total > 0 && t.total === t.sum && t.text.includes(String(t.total)), `wave4b preview.desk.totals on ${d}: the total (${t.total}) is the sections' sum (${t.sum}) and the desk says it ("${t.text}")`);
    }
    await page.click('#deviceBar [data-device="kindle"]');
    const row = await page.$$('#deskRail .desk-item');
    const pick = row[Math.min(row.length - 1, b.i)];
    const pickId = await pick.getAttribute('data-desk-id');
    await pick.click();
    await page.waitForTimeout(600);
    const railed = await page.evaluate(() => ({ id: window.beukPreview.state().activeId, current: document.querySelector('#deskRail .desk-item.current')?.getAttribute('data-desk-id'), editor: document.getElementById('manuscript')?.getAttribute('data-section') }));
    check(railed.id === pickId && railed.current === pickId, `wave4b preview.desk.rail: a rail row moves the preview to its section (${railed.id === pickId}) and marks it current (${railed.current === pickId}); the editor opened it too (section ${railed.editor})`);
    // preview.pagecount.fixed-geometry + desk.space: the counts do not follow the window; the frame grows with the column
    const counts = () => page.evaluate(() => JSON.stringify(window.beukPreview.call('computeDeskCountsSync')?.counts));
    const w1 = await page.evaluate(() => document.getElementById('deviceFrame').getBoundingClientRect().width);
    const c1 = await counts();
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.waitForTimeout(700);
    const w2 = await page.evaluate(() => document.getElementById('deviceFrame').getBoundingClientRect().width);
    const c2 = await counts();
    await page.setViewportSize({ width: 1100, height: 640 });
    await page.waitForTimeout(700);
    const c3 = await counts();
    await page.setViewportSize({ width: 1280, height: 800 });
    check(c1 === c2 && c2 === c3, 'wave4b preview.pagecount.fixed-geometry: every section\'s count is the same at 1280×800, 1280×1100 and 1100×640');
    check(w2 > w1 + 20, `wave4b preview.desk.space: the frame grows with the column's height (${w1.toFixed(0)} px at 800 tall, ${w2.toFixed(0)} px at 1100)`);
    // fullscreen.controls + fullscreen.fill-window (the device preview's half; the print view's is wave 5)
    const FS = async (two) => {
      const fsState = two ? window.beukPreview.get('fsState') : window.fsState;
      const sync = () => (two ? window.beukPreview.call('syncFsButtons') : window.syncFsButtons());
      const b = document.getElementById('pvFull'), stage = document.getElementById('previewStage');
      const words = { label: b.getAttribute('aria-label'), title: b.getAttribute('title') ?? b.getAttribute('data-tip-text'), pressed: b.getAttribute('aria-pressed'), keys: b.getAttribute('aria-keyshortcuts') };
      fsState.fill = true;
      sync();
      const offer = b.getAttribute('aria-label');
      b.click();
      await new Promise((r) => setTimeout(r, 300));
      const r = stage.getBoundingClientRect();
      const on = { imm: stage.classList.contains('fs-immersive'), pos: getComputedStyle(stage).position, rect: [r.left, r.top, r.width - innerWidth, r.height - innerHeight].map(Math.round).join(','), pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), lock: document.documentElement.classList.contains('fs-lock') };
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise((r2) => setTimeout(r2, 300));
      const off = { imm: stage.classList.contains('fs-immersive'), lock: document.documentElement.classList.contains('fs-lock'), pressed: b.getAttribute('aria-pressed') };
      fsState.fill = false;
      sync();
      return { words, offer, on, off };
    };
    const fs = await page.evaluate(FS, true);
    const one = await openOne(ctx, origin);
    const fs1 = await one.evaluate(FS, false);
    const native = await page.evaluate(() => !!document.fullscreenEnabled);
    check(JSON.stringify(fs.words) === JSON.stringify(fs1.words) && fs.words.pressed === 'false' && fs.words.keys === 'F' && fs.words.label === (native ? 'Full screen' : 'Fill the window') && fs.words.title === fs.words.label + ' (F)',
      `wave4b fullscreen.controls (the device preview's half): aria-pressed false, the F shortcut, "${fs.words.title}" for a browser ${native ? 'with' : 'without'} element full screen, as 1.0's${JSON.stringify(fs.words) === JSON.stringify(fs1.words) ? '' : ' — 1.0: ' + JSON.stringify(fs1.words) + ' 2.0: ' + JSON.stringify(fs.words)}`);
    check(JSON.stringify(fs) === JSON.stringify(fs1) && fs.offer === 'Fill the window' && fs.on.imm && fs.on.pos === 'fixed' && fs.on.pressed === 'true' && fs.on.label === 'Exit full window' && fs.on.lock && !fs.off.imm && !fs.off.lock && fs.off.pressed === 'false',
      `wave4b fullscreen.fill-window (the device preview's half): offered as "${fs.offer}", the stage fixed over the window (offset from the window ${fs.on.rect}), pressed, "${fs.on.label}", the page locked; Escape leaves it and unlocks the page — as 1.0's${JSON.stringify(fs) === JSON.stringify(fs1) ? '' : ' — 1.0: ' + JSON.stringify(fs1) + ' 2.0: ' + JSON.stringify(fs)}`);
    await harvestCsp(one);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/** preview.rtl-ui-same-pages: an Arabic interface lays the pages out as an English one; preview.rtl-book-pages-turn and
 *  pagination.ornament.keep: an Arabic book, and a chapter with pictures beside scene breaks, paginate as in 1.0. */
async function wave4bRtl(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const looks = {};
  for (const ui of ['en', 'ar']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    if (ui === 'ar') await ctx.addInitScript(() => localStorage.setItem('beuk.uiLang.v1', 'ar'));
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      await page.waitForFunction(() => !!window.beukPreview && document.getElementById('pageFlow').childElementCount > 0, null, { timeout: 60_000 });
      await page.waitForTimeout(800);
      looks[ui] = await page.evaluate(() => ({ n: window.beukPreview.state().pageCount, dir: getComputedStyle(document.getElementById('deviceScreen')).direction, x: document.getElementById('flowWrap').scrollLeft, first: document.getElementById('pageFlow').innerText.slice(0, 60), counts: JSON.stringify(window.beukPreview.call('computeDeskCountsSync')?.counts) }));
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  check(looks.en.n > 0 && looks.ar.n === looks.en.n && looks.ar.dir === 'ltr' && looks.ar.x === looks.en.x && looks.ar.first === looks.en.first && looks.ar.counts === looks.en.counts,
    `wave4b preview.rtl-ui-same-pages: English interface ${looks.en.n} pages, Arabic ${looks.ar.n}; the device screen ${looks.ar.dir}; page 1 starts the same; every desk count the same`);
  // an Arabic book, and a chapter whose scene breaks stand beside pictures, against 1.0
  const base = JSON.parse(JSON.stringify(f.book));
  const ar = JSON.parse(JSON.stringify(base));
  ar.meta = { ...ar.meta, language: 'ar' };
  const para = 'كان لجدّتي بيتٌ أبيضُ صغير على صخرةٍ فوق البحر. ';
  const arSec = ar.sections.find((x) => x.kind === 'body');
  arSec.content = Array.from({ length: 30 }, () => para.repeat(4)).join('\n\n');
  arSec.included = true;
  const orn = JSON.parse(JSON.stringify(base));
  const pic = (orn.images || []).find((im) => /^image\/(png|jpeg)$/.test(im.mediaType));
  const ornSec = orn.sections.find((x) => x.kind === 'body');
  const lines = [];
  for (let k = 1; k <= 28; k++) {
    lines.push(Array.from({ length: k % 5 + 1 }, (_, j) => `Paragraph ${k}.${j} runs on for a line or two of plain prose so the page fills at its own pace.`).join('\n\n'));
    lines.push(pic && k % 3 === 0 ? `![a picture](${pic.id})\n\n***` : '***');
  }
  ornSec.content = lines.join('\n\n');
  for (const [name, bk] of [['an Arabic book (preview.rtl-book-pages-turn)', ar], ['scene breaks beside pictures (pagination.ornament.keep)', orn]]) {
    const file = w4File('w4b-' + (bk === ar ? 'ar' : 'orn') + '.beuk-backup.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: bk }));
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await openNext(ctx, origin);
      await openBackup(page, file);
      await page.waitForFunction(() => !!window.beukPreview, null, { timeout: 60_000 });
      const start = (await exportBackup(page)).json.book;
      const one = await openOne(ctx, origin);
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      await page.bringToFront();
      const two = await page.evaluate(W4B_COUNTS, [['kindle', 'phone', 'ipad'], true]);
      await one.bringToFront();
      const oneC = await one.evaluate(W4B_COUNTS, [['kindle', 'phone', 'ipad'], false]);
      check(JSON.stringify(two) === JSON.stringify(oneC), `wave4b ${name}: every section's page count on Kindle, phone and iPad and the hardcover's pages equal 1.0's (${['kindle', 'phone', 'ipad'].map((d) => two[d]?.total + '/' + oneC[d]?.total).join(', ')})`);
      const idx = sectionsOf(start).findIndex((x) => x.kind === 'body');
      await page.bringToFront();
      await choose(page, idx);
      await page.waitForTimeout(400);
      await one.bringToFront();
      await one.evaluate((id) => selectSection(id), sectionsOf(start)[idx].id);
      for (const d of ['kindle', 'phone']) {
        await one.bringToFront();
        const a = await one.evaluate(W4B_BREAKS, [d, false]);
        await page.bringToFront();
        const b = await page.evaluate(W4B_BREAKS, [d, true]);
        check(JSON.stringify(a) === JSON.stringify(b), `wave4b ${name} on ${d}: ${b.pageCount} pages, each block's page equals 1.0's`);
      }
      // every page shows its own text (RTL turns the right way); no ornament stands alone on a page
      await page.bringToFront();
      const pages = await page.evaluate(async () => {
        const P = window.beukPreview;
        P.call('setDevice', 'kindle');
        await new Promise((r) => setTimeout(r, 700));
        const flow = document.getElementById('pageFlow'), wr = document.getElementById('flowWrap').getBoundingClientRect();
        const n = P.state().pageCount, seen = [];
        for (let p = 1; p <= n; p++) {
          P.call('goToPage', p, true);
          let hit = 0;
          for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) { const el = document.elementFromPoint(wr.left + wr.width * i / 6, wr.top + wr.height * j / 6); if (el && el !== flow && flow.contains(el)) hit++; }
          seen.push(hit);
        }
        P.call('goToPage', 1, true);
        const step = parseFloat(flow.style.columnWidth) + 64, fr = flow.getBoundingClientRect(), rtl = flow.dir === 'rtl';
        const scale = fr.width / flow.offsetWidth || 1;
        const colOf = (r) => Math.floor(((rtl ? fr.right - r.right : r.left - fr.left) / scale) / step);
        const alone = [...flow.querySelectorAll('.scene-break')].filter((o) => {
          const r = o.getBoundingClientRect(); if (!r.width && !r.height) return false;
          const c = colOf(r);
          return ![...flow.querySelectorAll('p')].some((p) => !p.closest('.chapter-opening') && [...p.getClientRects()].some((x) => x.width > 0 && colOf(x) === c));
        }).length;
        return { n, empty: seen.filter((h) => h === 0).length, alone, dir: flow.dir };
      });
      check(pages.empty === 0 && pages.alone === 0, `wave4b ${name}: all ${pages.n} pages show the book (${pages.empty} empty, flow ${pages.dir}); ${pages.alone} ornament(s) alone on a page`);
      for (const p of [page, one]) await harvestCsp(p);
    } finally {
      await ctx.close();
    }
  }
}

/** The preview region next to 1.0's (Paper, Candlelight, Arabic): the device frame and the whole pane, gated. */
async function wave4bScreens(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const ctx = await newContext({ serviceWorkers: 'block' });
      await ctx.addInitScript(([t, l]) => { localStorage.setItem('beuk.theme.v1', t); if (l) localStorage.setItem('beuk.uiLang.v1', l); }, [run.theme, run.lang]);
      try {
        const page = await openNext(ctx, origin);
        await openBackup(page, f.file);
        await page.waitForFunction(() => !!window.beukPreview, null, { timeout: 60_000 });
        const start = (await exportBackup(page)).json.book;
        const id = await page.evaluate(() => window.beukPreview.state().activeId);
        const one = await openOne(ctx, origin);
        await one.evaluate(([b, x]) => { applyBookDoc(JSON.parse(JSON.stringify(b))); selectSection(x); }, [start, id]);
        await one.addStyleTag({ content: ONE_HIDE });
        for (const p of [one, page]) {
          await p.bringToFront();
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800);
        }
        for (const [sel, gated] of [['#deviceFrame', true], ['#pane-preview', true]]) {
          await one.bringToFront();
          const a = await one.locator(sel).screenshot();
          await page.bringToFront();
          const b = await page.locator(sel).screenshot();
          writeFileSync(path.join(OUT, `preview-one-${tag}-${sel.slice(1)}.png`), a);
          writeFileSync(path.join(OUT, `preview-two-${tag}-${sel.slice(1)}.png`), b);
          const d = await pixelDiff(diffPage, a, b);
          const msg = `wave4b screenshots ${tag}: ${sel} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}]`;
          if (gated) check(d.ratio <= PIXEL_TOLERANCE, msg + ` (max ${PIXEL_TOLERANCE * 100}%)`);
          else note(msg + ' (reported, not gated)');
        }
        for (const p of [page, one]) await harvestCsp(p);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function wave4bChecks(origin) {
  const only = (process.env.W4B_PARTS || 'parity,chrome,reader,rtl,isolation,gate,screens,latency').split(',');
  if (only.includes('parity')) await wave4bParity(origin);
  if (only.includes('chrome')) await wave4bChrome(origin);
  if (only.includes('reader')) await wave4bReader(origin);
  if (only.includes('rtl')) await wave4bRtl(origin);
  if (only.includes('isolation')) await wave4bIsolation(origin);
  if (only.includes('gate')) {
    // constraint 38: the preview browsed (every device, the hardcover, full screen, a desk row) writes nothing
    for (const name of ['real/lantern-coast-print', 'real/dartagnan-01-three-musketeers']) {
      const ctx = await newContext({ serviceWorkers: 'block' });
      try {
        const f = fixtures.find((x) => x.name === name);
        const page = await openNext(ctx, origin);
        await openBackup(page, f.file);
        const start = (await exportBackup(page)).json.book;
        const did = await previewBrowse(page);
        const out = (await exportBackup(page)).json.book;
        check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(f.book, out)), `wave4b no-edit gate (constraint 38) ${name}: ${did} — the export is unchanged`);
        const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /device|preview|hc|fs/i.test(k)));
        check(keys.length === 0, `wave4b constraint 38: the preview keeps no per-device key, as 1.0 keeps none (state.device is session-only; ${keys.join(', ') || 'none'})`);
        await harvestCsp(page);
      } finally {
        await ctx.close();
      }
    }
  }
  if (only.includes('screens')) await wave4bScreens(origin);
  // constraint 37: the typing latency on Dumas with the preview pane open (#5's measure, run here too)
  if (only.includes('latency') && !(process.env.E2E_ONLY || '').split(',').includes('latency')) {
    const r = await latency(origin);
    note(`wave4b latency with the preview pane open: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
    // typing with pauses past 1.0's 120 ms preview timer: the preview draws between keys (final review, Important 3)
    const r2 = await latency(origin, { delay: 200, count: 60, quick: true });
    note(`wave4b latency with the pane open, 200 ms between keys (the preview redraws between them): p50 ${r2.p50.toFixed(1)} ms, p95 ${r2.p95.toFixed(1)} ms, max ${r2.max.toFixed(1)} ms over ${r2.n} keystrokes`);
    check(r2.p95 < LATENCY_P95_TARGET_MS, `wave4b constraint 37: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas with the pane open while the preview redraws between keys (${r2.p95.toFixed(1)} ms)`);
  }
}

/* ---- wave 4c: the cover maker, spine, back, hardcover flaps and guides, the wrap and its 3D stand (D3, D4) ----
   Beside 1.0 with the same book, in the same browser:
   - pixel parity (constraint 41): for the fixtures with a recipe, every captured wrap-parity patch
     (tests/fixtures/wrap-parity) and a recipe set covering every layout × background type, every texture, every
     binding, the spine's and back's backgrounds, patterns, text, direction and icons: 1.0's drawCoverTo (the front),
     drawWrapTo at the maker's preview size, renderWrapCanvas at 300 DPI (the full wrap) and its spine and back panels
     equal 1.0's pixel for pixel (a hash of every pixel), after a warm-up pass in both; wrapDims for every trim, page
     count, paper and binding equals 1.0's;
   - the no-edit gate (constraint 45): opening the maker, switching its backgrounds and layouts, hovering, searching
     stock photos without choosing one (Openverse answered by the test), turning the 3D book and closing without
     saving leave the export exactly equal;
   - round trip (constraint 42): a recipe edited in 2.0 ("Use as My Cover") reads back in 1.0 exactly;
   - the preview's hardcover follows the new cover (4b reads it);
   - the wrap PDF (constraint 44): POST /api/wrap with the same book and recipe as 1.0's request; signed out and
     offline, 1.0's own messages;
   - the hostile cover (constraint 43): hostile font names, colours, text with markup and picture data in the recipe;
     the app outside the maker is unaffected, no request leaves the page, no handler runs;
   - the maker's dialog screenshotted beside 1.0's (Paper, Candlelight, Arabic: reported). */
/** In a page: each recipe (null: the book's own) painted the four ways, after a warm-up; and the wrap's dims. */
const W4C_PAINT = async ([recipes, two]) => {
  const one = two ? null : { drawCoverTo, drawWrapTo, renderWrapCanvas, wrapDims, normalizeCoverRecipe, defaultCoverRecipe, ensureCoverBgImage, ensureWrapIcons, hcEnsureFlapPhoto };
  const R = (fn) => (two ? window.beukCover.run((a, c) => fn(a, c.getState())) : fn(one, state));
  const hashOf = (cv, x, y, w, h) => {
    x = Math.round(x || 0); y = Math.round(y || 0); w = Math.max(1, Math.round(w || cv.width)); h = Math.max(1, Math.round(h || cv.height));
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    const u = new Uint32Array(d.buffer);
    let a = 0x811c9dc5;
    const tiles = new Array(16).fill(0x811c9dc5);
    for (let i = 0; i < u.length; i++) {
      a = Math.imul(a ^ u[i], 16777619);
      const k = Math.min(3, Math.floor((Math.floor(i / w) * 4) / h)) * 4 + Math.min(3, Math.floor(((i % w) * 4) / w));
      tiles[k] = Math.imul(tiles[k] ^ u[i], 16777619);
    }
    return { size: w + 'x' + h, hash: (a >>> 0).toString(16), tiles: tiles.map((t) => (t >>> 0).toString(16)) };
  };
  const paint = (a, r) => {
    const front = document.createElement('canvas');
    front.width = 800; front.height = 1280;
    const items = a.drawCoverTo(front, r);
    const d = a.wrapDims(r);
    const prev = document.createElement('canvas');
    prev.width = 1240; prev.height = Math.round(1240 * d.totalH / d.totalW);
    const pitems = a.drawWrapTo(prev, r, { guides: true, preview: true });
    const full = a.renderWrapCanvas(r, {});
    const L = d.layout, px = 300;
    return {
      dims: JSON.stringify(d), items: JSON.stringify(items), pitems: JSON.stringify(pitems),
      front: hashOf(front), preview: hashOf(prev), wrap: hashOf(full),
      spine: hashOf(full, L.spineX * px, L.topY * px, Math.max(1, d.spine * px), L.panelH * px),
      back: hashOf(full, L.backX * px, L.topY * px, L.panelW * px, L.panelH * px),
      frontPanel: hashOf(full, L.frontX * px, L.topY * px, L.panelW * px, L.panelH * px),
    };
  };
  const out = [];
  for (const r0 of recipes) {
    const r = R((a, st) => a.normalizeCoverRecipe(JSON.parse(JSON.stringify(r0 || st.coverRecipe || a.defaultCoverRecipe()))));
    await R((a) => Promise.all([a.ensureCoverBgImage(r), a.ensureWrapIcons(r), a.hcEnsureFlapPhoto(r)]));
    R((a) => paint(a, r)); // warm-up: the faces it sets type in start loading
    await document.fonts.ready;
    await new Promise((res) => setTimeout(res, 30));
    R((a) => paint(a, r));
    await document.fonts.ready;
    out.push(R((a) => paint(a, r)));
  }
  return out;
};
const W4C_DIMS = ([two]) => {
  const one = two ? null : { wrapDims, normalizeCoverRecipe, defaultCoverRecipe, TRIM_SIZES, HC_BINDINGS };
  const R = (fn) => (two ? window.beukCover.run((a, c) => fn(a, c.getState())) : fn(one, state));
  return R((a, st) => {
    const base = a.normalizeCoverRecipe(JSON.parse(JSON.stringify(st.coverRecipe || a.defaultCoverRecipe())));
    const rows = [];
    for (const trim of ['', ...a.TRIM_SIZES.map((x) => x.id)])
      for (const pages of [0, 24, 151, 600, 828])
        for (const paper of ['white', 'cream', 'custom'])
          for (const binding of a.HC_BINDINGS)
            for (const hcSpine of [0, 1.25]) {
              const r = JSON.parse(JSON.stringify(base));
              Object.assign(r.wrap, { trim, pages, paper, customFactor: 0.0031, binding, hcSpine });
              rows.push(trim + '|' + pages + '|' + paper + '|' + binding + '|' + hcSpine + '=' + JSON.stringify(a.wrapDims(r)));
            }
    return rows;
  });
};
/** The recipe set: every layout × background type (on the book's own recipe and its pictures), every texture, every
 *  binding, the spine's and back's backgrounds, every pattern, custom spine text both ways, a Lucide and an uploaded
 *  icon, the jacket's flaps with an author photo, other trims and papers, free positions. */
function w4cRecipes(book) {
  const base = JSON.parse(JSON.stringify(book.coverRecipe));
  const pics = (book.images || []).filter((im) => im && !im.flourish && /^image\/(jpeg|png)$/.test(im.mediaType)).map((im) => im.id);
  const pic = pics[0], pic2 = pics[1] || pics[0];
  const out = [];
  const L = ['classic', 'modern', 'editorial', 'banded', 'framed', 'minimal', 'free'];
  const B = ['solid', 'gradient', 'texture', 'image', 'duotone', 'photo'];
  for (const layout of L) for (const bgType of B) out.push({ name: `${layout}/${bgType}`, r: { ...base, layout, bgType, bgImageId: pic, bgColor: '#3b2f63', bgColor2: '#dcb96f' } });
  for (const texture of ['linen', 'speckle', 'vignette']) out.push({ name: `texture ${texture}`, r: { ...base, bgType: 'texture', texture } });
  out.push({ name: 'duotone without art (the harbour scene)', r: { ...base, bgType: 'duotone', bgImageId: null } });
  const free = JSON.parse(JSON.stringify(base));
  free.layout = 'free';
  free.elements.title.pos = { x: 0.3, y: 0.1 };
  free.elements.author.pos = { x: 0.8, y: 0.9 };
  free.tagline = 'A tagline that wraps onto more than one line of the cover, here';
  free.series = 'The Gullwick Books';
  out.push({ name: 'free positions, tagline, series', r: free });
  const w = (patch, name) => out.push({ name, r: { ...base, wrap: { ...base.wrap, ...patch } } });
  w({ binding: 'case', trim: '6x9', pages: 320 }, 'case laminate 6x9 320 pp');
  w({ binding: 'jacket', trim: '6x9', pages: 320, flapFront: 'The front flap tells what the book is about, at some length, so that it wraps.', flapBack: 'About the author: a writer of coasts.', flapPhotoId: pic2 }, 'dust jacket with flaps and photo');
  w({ binding: 'case', hcSpine: 1.1, hcSpineAllow: 0.06, pages: 500 }, 'case from the printer template');
  w({ trim: '5x8', pages: 150, paper: 'cream', blurb: 'A back-cover blurb\n\nwith two paragraphs.', quote: '“A quote.” — Someone', imprint: 'Quiet Shelf Studio' }, '5x8 cream, blurb, quote, imprint');
  w({ trim: '8.5x11', pages: 40, paper: 'custom', customFactor: 0.0042 }, 'narrow spine, custom paper');
  w({ spine: { bg: { mode: 'gradient', color: '#112233', color2: '#ddcc88', dir: 'across' }, show: 'custom', text: 'CUSTOM SPINE', caps: false, dir: 'btt', iconTop: { kind: 'lucide', name: 'Feather' }, iconBottom: { kind: 'upload', picId: pic }, font: 'Lora', color: '#f0e0c0' }, pages: 400 }, 'spine: gradient, custom text, btt, icons');
  w({ spine: { bg: { mode: 'solid', color: '#7a1f1f' }, show: 'title', iconTop: { kind: 'lucide', name: 'Anchor' } }, back: { bg: { mode: 'gradient', color: '#0f4c5c', color2: '#232a33', dir: 'diag-up' }, font: 'Lora', color: '#eeeeee' }, pages: 300 }, 'spine solid title only, back gradient');
  for (const pattern of ['linen', 'speckle', 'vignette', 'dots', 'stripes', 'grid', 'diamonds'])
    w({ spine: { bg: { mode: 'pattern', pattern, color: '#3d2c1e', color2: '#c9a959' }, show: 'author' }, back: { bg: { mode: 'pattern', pattern, color: '#14532d', color2: '#e9e2d0' } }, pages: 360 }, `pattern ${pattern}`);
  return out;
}
/** The captured wrap-parity patches (tests/fixtures/wrap-parity), applied as tests/book-wrap-parity.test.ts does. */
function w4cMerge(a, b) {
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return structuredClone(b);
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? w4cMerge(a[k], b[k]) : structuredClone(b[k]);
  return o;
}
function w4cCaptureBooks() {
  const dir = path.join(REPO, 'tests', 'fixtures', 'wrap-parity');
  const load = (rel) => JSON.parse(readFileSync(path.join(REPO, 'tests', 'fixtures', rel), 'utf8')).book;
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const cap = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const b = structuredClone(load(cap.book));
    const p = cap.patch || {};
    if (p.meta) b.meta = { ...b.meta, ...p.meta };
    if (p.theme) b.theme = structuredClone(p.theme);
    if (p.recipe) b.coverRecipe = w4cMerge(b.coverRecipe, p.recipe);
    if (p.fonts) b.fonts = p.fonts.map((x) => ({ ...load(x.from).fonts[x.index || 0], ...(x.family ? { family: x.family } : {}) }));
    return { name: 'capture ' + cap.name, book: b, lang: cap.lang };
  });
}
function w4cBackup(name, book) {
  return w4File(name.replace(/[^\w.-]+/g, '-') + '.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book }));
}
const w4cParity = { rows: [], dims: [] };
/** 2.0 with a book open and its cover maker wired (the closure loaded, 1.0's initCoverMaker run, Lucide in). */
async function w4cOpen(ctx, origin, file) {
  const page = await openNext(ctx, origin);
  await openBackup(page, file);
  await page.waitForFunction(() => !!window.beukCover && !!window.lucide && document.querySelectorAll('#cmElFont option').length > 10 && document.getElementById('cmSpineBody')?.getAttribute('data-built') === '1', null, { timeout: 60_000 });
  return page;
}
/** Review round 2 (Important 1): Chrome's GPU-accelerated 2D canvas does not paint a 300 DPI wrap alike twice, even in
 *  1.0's own page (±1/255 on the front panel); its software canvas does, every part, every time (measured: 0 of 30 parts
 *  differ, 1.0 against itself). The parity check runs in a browser of its own on the software canvas, bit-exact. */
const W4C_SOFTWARE_ARGS = ['--disable-gpu', '--disable-accelerated-2d-canvas'];
async function wave4cParity(origin) {
  const sw = await pw.chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: W4C_SOFTWARE_ARGS });
  try {
    await wave4cParityOn(sw, origin);
  } finally {
    await sw.close();
  }
}
async function wave4cParityOn(sw, origin) {
  const narrow = (process.env.W4C_BOOKS || '').split(',').filter(Boolean);
  const books = [
    ...fixtures.filter((f) => f.book.coverRecipe).map((f) => ({ name: f.name, book: f.book, file: f.file, set: f.name === 'real/lantern-coast-book-one' })),
    ...w4cCaptureBooks().map((b) => ({ ...b, file: w4cBackup(b.name, b.book), set: false })),
  ].filter((b) => !narrow.length || narrow.some((n) => b.name.includes(n)));
  for (const b of books) {
    const ctx = await newContext({ serviceWorkers: 'block', on: sw });
    try {
      const page = await w4cOpen(ctx, origin, b.file);
      const start = (await exportBackup(page)).json.book;
      const one = await openOne(ctx, origin);
      await one.evaluate((bk) => applyBookDoc(JSON.parse(JSON.stringify(bk))), start);
      await one.waitForFunction(() => !!window.lucide);
      const set = [{ name: "the book's own recipe", r: null }, ...(b.set ? w4cRecipes(start) : [])];
      const recipes = set.map((x) => x.r);
      await one.bringToFront();
      const A = await one.evaluate(W4C_PAINT, [recipes, false]);
      await page.bringToFront();
      const B = await page.evaluate(W4C_PAINT, [recipes, true]);
      // Chrome's own noise at 300 DPI: 1.0 painting the same recipes again, in its own page
      await one.bringToFront();
      const A2 = await one.evaluate(W4C_PAINT, [recipes, false]);
      let bad = 0;
      set.forEach((x, i) => {
        for (const part of ['front', 'preview', 'wrap', 'spine', 'back', 'frontPanel']) {
          const a = A[i][part], c = B[i][part];
          const same = a.size === c.size && a.hash === c.hash;
          const tiles = a.tiles.filter((t, k) => t !== c.tiles[k]).length;
          const selfSame = A2[i][part].hash === a.hash;
          // every part bit-exact (review round 2, Important 1): on Chrome's software canvas (W4C_SOFTWARE_ARGS) 1.0 paints
          // every part alike twice, so nothing needs a tolerance; and 1.0 must reproduce itself, else the run is no proof
          const ok = same && selfSame;
          w4cParity.rows.push({ book: b.name, recipe: x.name, part, size: c.size, same, ok, selfSame, tiles });
          if (!ok) { bad++; check(false, `wave4c pixel parity ${b.name} · ${x.name} · ${part}: 1.0 ${a.size} ${a.hash} / 2.0 ${c.size} ${c.hash} (${tiles} of 16 tiles differ; 1.0 against itself: ${selfSame ? 'equal' : 'NOT equal ' + A2[i][part].hash})`); }
        }
        for (const k of ['dims', 'items', 'pitems']) if (A[i][k] !== B[i][k]) { bad++; check(false, `wave4c ${b.name} · ${x.name}: ${k} differ (1.0 ${A[i][k].slice(0, 160)} / 2.0 ${B[i][k].slice(0, 160)})`); }
      });
      check(bad === 0, `wave4c review focus #1 (constraint 41): ${b.name}: ${set.length} recipe(s) × front, maker preview, 300 DPI wrap, spine, back, front panel — every pixel, wrapDims and the drawn items equal 1.0's`);
      if (b.set || b.name === 'real/lantern-coast-print') {
        await one.bringToFront();
        const da = await one.evaluate(W4C_DIMS, [false]);
        await page.bringToFront();
        const db = await page.evaluate(W4C_DIMS, [true]);
        const diff = da.filter((r, i) => r !== db[i]);
        w4cParity.dims.push({ book: b.name, n: da.length, same: diff.length === 0 && da.length === db.length });
        check(diff.length === 0 && da.length === db.length, `wave4c constraint 41: ${b.name}: wrapDims for every trim (${da.length} trim × page count × paper × binding × template spine combinations) equals 1.0's${diff.length ? ' — first: ' + diff[0].slice(0, 200) : ''}`);
      }
      for (const p of [page, one]) await harvestCsp(p);
    } finally {
      await ctx.close();
    }
  }
  const byBook = {};
  for (const r of w4cParity.rows) (byBook[r.book] ||= { n: 0, bad: 0, parts: {} }), byBook[r.book].n++, (r.same ? 0 : byBook[r.book].bad++), ((byBook[r.book].parts[r.part] ||= [0, 0])[r.same ? 0 : 1]++);
  note('wave4c pixel parity: "equal" counts parts equal to the last bit');
  note('wave4c pixel parity (book: equal/total per part):');
  for (const [k, v] of Object.entries(byBook)) note(`  ${k}: ` + Object.entries(v.parts).map(([p, [s, d]]) => `${p} ${s}/${s + d}`).join(', '));
  const selfNoisy = w4cParity.rows.filter((r) => !r.selfSame);
  note(`  (on the software canvas, ${W4C_SOFTWARE_ARGS.join(' ')}) 1.0 against itself, the same recipes painted again in its page: ${selfNoisy.length} of ${w4cParity.rows.length} parts differ`);
  for (const d of w4cParity.dims) note(`  wrapDims ${d.book}: ${d.n} combinations ${d.same ? 'equal' : 'DIFFER'}`);
}

/** Openverse, answered by the test: a result whose thumbnail the policy allows and one whose does not. */
async function w4cStockRoutes(ctx) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const asked = [];
  await ctx.route('https://api.openverse.org/**', (route) => {
    const u = route.request().url();
    asked.push(u);
    if (/\/v1\/images\/\?/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [
      { title: 'Harbour', creator: 'A Photographer', url: 'https://images.pexels.com/photos/1/harbour.png', thumbnail: 'https://api.openverse.org/v1/images/1/thumb/', foreign_landing_url: 'https://example.org/1' },
      { title: 'Elsewhere', creator: 'B', url: 'https://elsewhere.example/2.png', thumbnail: 'https://elsewhere.example/2-thumb.png' },
    ] }) });
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png });
  });
  await ctx.route('https://images.pexels.com/**', (route) => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png }); });
  return asked;
}
/** The maker browsed: opened from Project Settings, every layout and background, an element, the wrap's binding, a
 *  stock search without a choice, the 3D book turned, Cancel. Returns what was done. */
async function w4cBrowse(page, { search = true } = {}) {
  await page.click('#btnSettings2');
  await page.waitForSelector('#btnCoverMake');
  await page.click('#btnCoverMake');
  await page.waitForFunction(() => document.getElementById('modalCoverMaker').classList.contains('open'));
  for (const l of ['modern', 'banded', 'free']) await page.click(`[data-cmlayout="${l}"]`);
  for (const bg of ['gradient', 'texture', 'image', 'duotone', 'solid', 'photo']) await page.click(`[data-cmbg="${bg}"]`);
  const art = page.locator('#cmArtGrid [data-cmart]');
  if (await art.count()) await art.first().hover();
  await page.selectOption('#cmElement', 'author');
  await page.selectOption('#cmHcBinding', 'jacket');
  await page.selectOption('#cmHcBinding', 'case');
  await page.locator('#cmSpineSec summary').click();
  await page.locator('#cmBackSec summary').click();
  let searched = 0;
  if (search) {
    await page.click('[data-cmbg="photo"]');
    await page.fill('#cmPhotoQuery', 'harbour');
    await page.click('#btnCmPhotoFind');
    await page.waitForFunction(() => document.querySelectorAll('#cmPhotoGrid .cm-photo-cell').length > 0, null, { timeout: 15_000 });
    searched = await page.evaluate(() => document.querySelectorAll('#cmPhotoGrid .cm-photo-cell').length);
    await page.locator('#cmPhotoGrid .cm-photo-cell').first().hover();
  }
  const stage = page.locator('#cmWrap3dStage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('ArrowRight');
  await page.click('#btnCmCancel');
  await page.waitForFunction(() => !document.getElementById('modalCoverMaker').classList.contains('open'));
  await page.keyboard.press('Escape'); // Project Settings, without saving
  return `layouts, backgrounds, an element, two bindings, the spine and back opened, ${search ? `a stock search (${searched} shown, none chosen), ` : ''}the 3D book turned, Cancel`;
}
async function wave4cGate(origin) {
  for (const name of ['real/lantern-coast-print', 'real/salt-road-book-one', 'legacy/theme-missing']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const asked = await w4cStockRoutes(ctx);
      const f = fixtures.find((x) => x.name === name);
      const page = await w4cOpen(ctx, origin, f.file);
      const start = (await exportBackup(page)).json.book;
      const did = await w4cBrowse(page);
      const out = (await exportBackup(page)).json.book;
      check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(f.book, out)), `wave4c no-edit gate (constraint 45) ${name}: ${did} — the export is unchanged`);
      check(!asked.some((u) => /elsewhere\.example/.test(u)), `wave4c constraint 44: ${name}: the stock search asked Openverse (${asked.filter((u) => /\?q=|q=/.test(u)).length} search) and never an address the policy refuses`);
      check(asked.some((u) => /api\.openverse\.org\/v1\/images\/\?q=harbour&page_size=12&license_type=all&filter_dead=false/.test(u)), `wave4c constraint 44: the search is 1.0's (stockDirectUrl: q, page_size=12) — ${asked[0] || 'none'}`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
}
/** "Use as My Cover" in 2.0: the export reads back in 1.0 exactly; the preview's hardcover wears the new cover. */
async function wave4cRoundTrip(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-print');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w4cOpen(ctx, origin, f.file);
    await page.click('#btnSettings2');
    await page.click('#btnCoverMake');
    await page.waitForFunction(() => document.getElementById('modalCoverMaker').classList.contains('open'));
    await page.fill('#cmTitle', 'The Lantern Coast, Again');
    await page.click('[data-cmlayout="banded"]');
    await page.click('[data-cmbg="gradient"]');
    await page.selectOption('#cmHcBinding', 'jacket');
    await page.fill('#cmHcFlapFront', 'A flap of the jacket.');
    await page.click('#btnCmUse');
    await page.waitForFunction(() => !document.getElementById('modalCoverMaker').classList.contains('open'), null, { timeout: 30_000 });
    const thumb = await page.evaluate(() => document.querySelector('#coverThumb img')?.getAttribute('src') || '');
    await page.keyboard.press('Escape');
    const out = (await exportBackup(page)).json.book;
    check(out.coverRecipe.title === 'The Lantern Coast, Again' && out.coverRecipe.layout === 'banded' && out.coverRecipe.bgType === 'gradient' && out.coverRecipe.wrap.binding === 'jacket' && out.cover.mediaType === 'image/jpeg', 'wave4c round trip: "Use as My Cover" in 2.0 wrote the recipe (title, layout, background, binding, flap) and the cover JPEG');
    check(thumb.startsWith('data:image/jpeg') && thumb.length > 1000, `wave4c: Project Settings' cover row shows the new cover (${thumb.length} characters)`);
    const one = await openOne(ctx, origin);
    const back = await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); return JSON.parse(JSON.stringify(serializeBook())); }, out);
    const diffKeys = (x, y) => [...new Set([...Object.keys(x || {}), ...Object.keys(y || {})])].filter((k) => JSON.stringify(x?.[k]) !== JSON.stringify(y?.[k]));
    for (const k of ['cover', 'coverRecipe', 'images']) check(JSON.stringify(back[k]) === JSON.stringify(out[k]), `wave4c review focus #2: 1.0 reads 2.0's ${k} back exactly (applyBookDoc + serializeBook)`);
    // the rest of the book: 1.0 reads it as it reads the book 2.0 opened (1.0's serializeBook orders meta its own way)
    const backStart = await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); return JSON.parse(JSON.stringify(serializeBook())); }, expected(f.book));
    const rest = diffKeys(back, backStart).filter((k) => !['cover', 'coverRecipe', 'history', 'historyPool'].includes(k));
    check(rest.length === 0, `wave4c review focus #2: everything else 1.0 reads from 2.0's export equals what it reads from the book before the edit (${rest.join(', ') || 'no other key differs'})`);
    // 1.0's own adopt on the same recipe: the recipe it writes equals 2.0's (the JPEG bytes are the encoder's)
    const oneRecipe = await one.evaluate((r) => { adoptCoverRecipe(r, renderCoverCanvas(r, COVER_EBOOK_W, COVER_EBOOK_H)); return JSON.parse(JSON.stringify(serializeBook().coverRecipe)); }, out.coverRecipe);
    check(JSON.stringify(oneRecipe) === JSON.stringify(out.coverRecipe), "wave4c: 1.0's adoptCoverRecipe on the same recipe writes the recipe 2.0 wrote");
    // the preview's hardcover (4b) wears the new cover, as a jacket
    await page.bringToFront();
    await page.click('#deviceBar [data-device="hardcover"]');
    await page.waitForFunction((d) => [...document.querySelectorAll('#pane-preview img')].some((i) => i.getAttribute('src') === d), 'data:image/jpeg;base64,' + out.cover.data, { timeout: 20_000 });
    check(true, "wave4c review focus #4: the preview's hardcover wears the cover made in the maker");
    await one.evaluate(() => { const b = document.querySelector('#deviceBar [data-device="hardcover"]'); b.click(); });
    const oneText = await one.evaluate(() => document.getElementById('hcBar')?.innerText || '');
    const twoText = await page.evaluate(() => document.getElementById('hcBar')?.innerText || '');
    check(oneText === twoText && oneText.length > 0, `wave4c: the hardcover's bar names the binding as 1.0's does (${JSON.stringify(twoText.slice(0, 80))})`);
    for (const p of [page, one]) await harvestCsp(p);
  } finally {
    await ctx.close();
  }
}
/** The wrap download: POST /api/wrap as 1.0 sends it; signed out and offline, 1.0's messages. */
async function wave4cWrapPdf(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const routes = async (ctx, signedIn, bodies) => {
    await ctx.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      if (u.pathname === '/api/auth/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: signedIn ? { id: 'u1', email: 'w@example.org' } : null }) });
      if (u.pathname === '/api/wrap') {
        bodies.push(route.request().postData());
        return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': "attachment; filename=\"x.pdf\"; filename*=UTF-8''the-lantern-coast-cover-wrap.pdf" }, body: Buffer.from('%PDF-1.4\n%test\n') });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not here"}' });
    });
  };
  const bodies2 = [], bodies1 = [];
  let ctx = await newContext({ serviceWorkers: 'block' });
  try {
    await routes(ctx, true, bodies2);
    const page = await w4cOpen(ctx, origin, f.file);
    await page.click('#btnSettings2');
    await page.click('#btnCoverMake');
    await page.waitForFunction(() => document.getElementById('modalCoverMaker').classList.contains('open'));
    await page.fill('#cmWrapBlurb', 'The blurb for the wrap.');
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.click('#btnCmWrapPdf');
    const d = await dl;
    check(d.suggestedFilename() === 'the-lantern-coast-cover-wrap.pdf', `wave4c constraint 44: the wrap PDF downloads under the server's name (${d.suggestedFilename()})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
  // 1.0's request, in its own context with the same routes
  ctx = await newContext({ serviceWorkers: 'block' });
  try {
    await routes(ctx, true, bodies1);
    const one = await openOne(ctx, origin);
    await one.waitForFunction(() => typeof cloud !== 'undefined' && cloud.available && !!cloud.user, null, { timeout: 20_000 });
    const dl = one.waitForEvent('download', { timeout: 30_000 });
    await one.evaluate((b) => {
      applyBookDoc(JSON.parse(JSON.stringify(b)));
      openCoverMaker();
      const el = document.getElementById('cmWrapBlurb');
      el.value = 'The blurb for the wrap.';
      el.dispatchEvent(new Event('input'));
      document.getElementById('btnCmWrapPdf').click();
    }, expected(f.book));
    await dl;
    const a = JSON.parse(bodies1[0]), b = JSON.parse(bodies2[0]);
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    const others = [...new Set([...Object.keys(a.book), ...Object.keys(b.book)])].filter((k) => k !== 'meta' && JSON.stringify(a.book[k]) !== JSON.stringify(b.book[k]));
    check(others.length === 0 && sorted(a.book.meta) === sorted(b.book.meta), `wave4c constraint 44: every value of the wrap request's book equals 1.0's (the meta's keys in the book's order: ${JSON.stringify(a.book.meta) === JSON.stringify(b.book.meta) ? 'the same order' : 'another order'}; ${others.join(', ') || 'no other key differs'})`);
    check(a.kind === b.kind && a.lang === b.lang && JSON.stringify(a.book.coverRecipe) === JSON.stringify(b.book.coverRecipe) && JSON.stringify(a.book.images) === JSON.stringify(b.book.images),
      `wave4c constraint 44: POST /api/wrap carries what 1.0's does (kind ${b.kind}, lang ${b.lang}, the maker's recipe, only the pictures the wrap paints: ${b.book.images.length})`);
    const keysA = Object.keys(a.book).sort().join(','), keysB = Object.keys(b.book).sort().join(',');
    check(keysA === keysB, `wave4c: the wrap request's book has 1.0's keys (History, notes, research and audio left home)${keysA === keysB ? '' : ` — 1.0 ${keysA} / 2.0 ${keysB}`}`);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
  // signed out: 1.0's message, nothing sent; no shelf: 1.0's offline message
  for (const [label, signed, health] of [['signed out', false, true], ['no shelf', false, false]]) {
    ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const sent = [];
      if (health) await routes(ctx, signed, sent);
      const page = await w4cOpen(ctx, origin, f.file);
      await page.click('#btnSettings2');
      await page.click('#btnCoverMake');
      await page.waitForFunction(() => document.getElementById('modalCoverMaker').classList.contains('open'));
      await page.click('#btnCmWrapPdf');
      await page.waitForFunction(() => document.querySelectorAll('#toasts .toast').length > 0, null, { timeout: 10_000 });
      const msg = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | '));
      const one = await openOne(ctx, origin);
      const want = await one.evaluate((s) => (s ? t('wrap.signin', { use: t('covermk.use'), signIn: t('top.signIn') }) : t('wrap.offline')), health);
      check(msg.includes(want) && sent.length === 0, `wave4c constraint 44: ${label}: the wrap download says 1.0's words and sends nothing (${JSON.stringify(msg.slice(0, 120))})`);
      check(await page.evaluate(() => document.getElementById('modalCoverMaker').classList.contains('open')), `wave4c: ${label}: the maker stays open (1.0 keeps the unapplied recipe)`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
}
/** A cover recipe made to attack the maker: hostile font names, colours, text with markup, picture data. */
function w4cHostileBook(base) {
  const b = JSON.parse(JSON.stringify(base));
  const tag = (n) => `<img src="https://evil.example/${n}.png" onerror="window.__pw=${n}">"'</style><script>window.__pw=${n}</script>`;
  const evil = "EB Garamond'; } body { display: none } #topbar { background: url(https://evil.example/t.png) } .x { font-family: '";
  const r = b.coverRecipe;
  r.title = 'Hostile ' + tag(1);
  r.subtitle = tag(2);
  r.author = 'Writer ' + tag(3);
  r.tagline = tag(4);
  r.series = tag(5);
  r.bgColor = 'red; background: url(https://evil.example/c.png)';
  r.bgColor2 = '"><script>window.__pw=6</script>';
  for (const k of Object.keys(r.elements)) Object.assign(r.elements[k], { font: evil, color: 'url(https://evil.example/e.png)', size: '1e9; x', pos: { x: 'NaN', y: { toString: 1 } } });
  r.wrap = { ...r.wrap, blurb: tag(7), quote: tag(8), imprint: tag(9), flapFront: tag(10), flapBack: tag(11), binding: 'jacket" onclick="window.__pw=12', trim: '<b>', spine: { font: evil, color: 'red', text: tag(13), iconTop: { kind: 'lucide', name: '__proto__' }, iconBottom: { kind: 'upload', picId: 'constructor' } }, back: { font: evil, color: 'url(x)' } };
  r.bgImageId = 'hostile-pic';
  b.images = [...(b.images || []), { id: 'hostile-pic', name: 'x' + tag(14), mediaType: 'image/png" onerror="window.__pw=15', ext: 'png', data: 'iVBORw0KGgo=" onerror="window.__pw=16' },
    { id: 'x" onclick="window.__pw=17', name: 'n', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' },
    // review, Important 2: ids that would add the maker's own ids to the page
    { id: 'x" id="cmWrapCanvas', name: 'w', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' },
    { id: 'y" id="cmPhotoQuery" value="evil', name: 'q', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }];
  b.cover = { data: '/9j/" onerror="window.__pw=18', mediaType: 'image/jpeg"><script>window.__pw=19</script>', ext: 'jpg', name: tag(20) };
  b.fonts = [{ id: 'fbad', name: 'b.ttf', family: evil, ext: 'ttf', mediaType: 'font/ttf', data: 'AAAA' }];
  return b;
}
async function wave4cHostile(origin) {
  const base = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const hctx = await newContext({ serviceWorkers: 'block' });
    const honest = await w4cOpen(hctx, origin, base.file);
    const lookHonest = await honest.evaluate(W4B_LOOK);
    await hctx.close();
    const hostile = w4cHostileBook(base.book);
    const file = w4File('w4c-hostile.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile }));
    const page = await w4cOpen(ctx, origin, file);
    const foreign = [];
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u); });
    const start = (await exportBackup(page)).json.book;
    await page.click('#btnSettings2');
    await page.click('#btnCoverMake');
    await page.waitForFunction(() => document.getElementById('modalCoverMaker').classList.contains('open'));
    for (const bg of ['image', 'duotone', 'gradient', 'texture', 'photo', 'solid']) await page.click(`[data-cmbg="${bg}"]`);
    for (const l of ['modern', 'free', 'classic']) await page.click(`[data-cmlayout="${l}"]`);
    await page.locator('#cmSpineSec summary').click();
    await page.locator('#cmBackSec summary').click();
    await page.selectOption('#cmElement', 'author');
    await page.waitForTimeout(600);
    const scan = await page.evaluate(() => {
      const root = document.getElementById('modalCoverMaker');
      const row = document.getElementById('coverThumb')?.closest('.full');
      const els = [...root.querySelectorAll('*'), ...(row ? row.querySelectorAll('*') : [])];
      const on = els.flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => el.tagName + ' ' + a.name));
      const src = els.flatMap((el) => [...el.attributes].filter((a) => /^(src|href|srcset|xlink:href)$/i.test(a.name) && !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]*$/.test(a.value) && !/^blob:/.test(a.value)).map((a) => el.tagName + ' ' + a.name + '=' + a.value.slice(0, 60)));
      const scripts = root.querySelectorAll('script, iframe, object, embed, link, style').length;
      const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).filter((x) => /evil\.example/.test(x)).length;
      const dupIds = ['cmWrapCanvas', 'cmPhotoQuery', 'cmCanvas', 'coverThumb'].filter((id) => document.querySelectorAll('#' + id).length > 1);
      return { on, src, scripts, css, dupIds, pw: window.__pw ?? null, fonts: [...document.fonts].filter((f) => /evil|display: none/.test(f.family)).length };
    });
    const look = await page.evaluate(W4B_LOOK);
    check(scan.dupIds.length === 0, `wave4c review (Important 2): no picture id adds an id of the maker's own (${scan.dupIds.join(', ') || 'none doubled'})`);
    check(scan.on.length === 0 && scan.src.length === 0 && scan.scripts === 0 && scan.pw === null, `wave4c constraint 43: the hostile cover (fonts, colours, markup in every text, picture data, the cover itself) gives no handler, no foreign source, no script in the maker or the cover row; nothing ran (${JSON.stringify(scan).slice(0, 300)})`);
    check(scan.css === 0 && scan.fonts === 0, `wave4c constraint 43: no stylesheet and no face names anything of the hostile book (${scan.css} rules, ${scan.fonts} faces)`);
    check(JSON.stringify(look) === JSON.stringify(lookHonest), 'wave4c constraint 43: the app outside the maker looks exactly as with the honest book (8 elements × 11 computed properties)');
    await page.click('#btnCmCancel');
    await page.keyboard.press('Escape');
    const out = (await exportBackup(page)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(hostile, out)), 'wave4c constraint 43: the hostile book exports exactly as readBook reads it (the maker browsed, nothing kept)');
    check(foreign.length === 0, `wave4c constraint 43: no request left the page (${foreign.slice(0, 3).join(', ') || 'none'})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}
async function wave4cScreens(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const ctx = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      await ctx.addInitScript(([t, l]) => { localStorage.setItem('beuk.theme.v1', t); if (l) localStorage.setItem('beuk.uiLang.v1', l); }, [run.theme, run.lang]);
      try {
        const page = await w4cOpen(ctx, origin, f.file);
        const start = (await exportBackup(page)).json.book;
        await page.click('#btnSettings2');
        await page.click('#btnCoverMake');
        await page.waitForFunction(() => document.getElementById('modalCoverMaker').classList.contains('open'));
        const one = await openOne(ctx, origin);
        await one.evaluate((b) => { applyBookDoc(JSON.parse(JSON.stringify(b))); openSettings(); openCoverMaker(); }, start);
        await one.addStyleTag({ content: ONE_HIDE });
        for (const p of [one, page]) {
          await p.bringToFront();
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(1500);
          await p.evaluate(() => { const m = document.querySelector('#modalCoverMaker'); m.scrollTop = 0; });
        }
        for (const [sel, gated] of [['#cmCanvas', true], ['#cmWrapCanvas', true], ['#modalCoverMaker .modal', false]]) {
          await one.bringToFront();
          const a = await one.locator(sel).screenshot();
          await page.bringToFront();
          const b = await page.locator(sel).screenshot();
          const nm = sel.replace(/[^\w]+/g, '-');
          writeFileSync(path.join(OUT, `cover-one-${tag}${nm}.png`), a);
          writeFileSync(path.join(OUT, `cover-two-${tag}${nm}.png`), b);
          const d = await pixelDiff(diffPage, a, b);
          const msg = `wave4c screenshots ${tag}: ${sel} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}]`;
          if (gated) check(d.ratio <= PIXEL_TOLERANCE, msg + ` (max ${PIXEL_TOLERANCE * 100}%)`);
          else note(msg + ' (reported, not gated)');
        }
        for (const p of [page, one]) await harvestCsp(p);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}
async function wave4cChecks(origin) {
  const only = (process.env.W4C_PARTS || 'parity,gate,roundtrip,pdf,hostile,screens,latency').split(',');
  if (only.includes('parity')) await wave4cParity(origin);
  if (only.includes('gate')) await wave4cGate(origin);
  if (only.includes('roundtrip')) await wave4cRoundTrip(origin);
  if (only.includes('pdf')) await wave4cWrapPdf(origin);
  if (only.includes('hostile')) await wave4cHostile(origin);
  if (only.includes('screens')) await wave4cScreens(origin);
  // constraint 45: canvas work stays off the typing path — the editor's p95 on Dumas with the maker closed
  if (only.includes('latency') && !(process.env.E2E_ONLY || '').split(',').includes('latency')) {
    const r = await latency(origin);
    note(`wave4c latency (the cover maker mounted, closed): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
    check(r.p95 < LATENCY_P95_TARGET_MS, `wave4c constraint 45: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas with the cover maker closed (${r.p95.toFixed(1)} ms)`);
  }
}

/* ---- wave 5a: the export modal, EPUB, Markdown/HTML, the validator and inspector, the a11y audit (F1, F7, F8) ----
   Constraint 51 (review focus #1), one builder: for every fixture, the body 2.0 sends to POST /api/epub (1.0's own
   serializeBook on the export's state: window.beukExport.body) equals, byte for byte, the body 1.0 sends (1.0's page:
   applyBookDoc of the same book, then buildEpub's own lines); for one fixture the bodies the two apps really POST are
   captured and are those. 1.0's Markdown and standalone HTML equal 2.0's for every fixture and every preset (hashes
   taken in each page). Constraint 56: Lantern Coast's .epub, .md and .html downloaded in both apps — the EPUB is the
   server's own build (src/book/epub, e2e/server-epub.mjs) of each app's body, served as /api/epub would serve it — are
   the same files (the package's entries and bytes; the one field 1.0 makes differ per build, package.opf's
   dcterms:modified, masked, and the zip's entry dates not compared). Constraint 53: a hostile book through the modal,
   the inspector, the validator, the audit, the .md and .html downloads and the server's build of its body — no
   handler, script or remote request; 1.0's own body of the same book, built by the server, is the reproducing fixture
   of the 1.0 findings. Constraint 54: the modal browsed (presets switched and back, the validator, the inspector, the
   audit) and closed — the export is unchanged (here on two books; readOnlyRooms takes it into the 23-fixture gate).
   Constraint 55: the trial's 402, signed out and no shelf say 1.0's words and nothing is downloaded. The modal's
   regions beside 1.0's in Paper, Candlelight and Arabic (gated). */
/** 2.0 with a book open and its export modal wired (1.0's initExport run). */
async function w5aOpen(ctx, origin, file) {
  const page = await openNext(ctx, origin);
  await openBackup(page, file);
  await page.waitForFunction(() => !!window.beukExport && document.getElementById('btnExport')?.getAttribute('aria-disabled') === null, null, { timeout: 60_000 });
  return page;
}
async function w5aOpenModal(page, opener = '#btnExport') {
  await page.click(opener);
  await page.waitForFunction(() => document.getElementById('modalExport')?.classList.contains('open') && document.querySelectorAll('#platformGrid [data-platform]').length === 11, null, { timeout: 30_000 });
}
/** The modal browsed without exporting: every preset chosen, then the book's own again; the validator, the audit and
 *  the inspector (its first files opened) run; closed. Shared with readOnlyRooms (the 23-fixture gate). */
async function exportBrowse(page) {
  await page.waitForFunction(() => !!window.beukExport && document.getElementById('btnExport')?.getAttribute('aria-disabled') === null, null, { timeout: 60_000 });
  await w5aOpenModal(page);
  const own = await page.$eval('#platformGrid .active', (b) => b.getAttribute('data-platform'));
  const ids = await page.$$eval('#platformGrid [data-platform]', (bs) => bs.map((b) => b.getAttribute('data-platform')));
  for (const id of ids) await page.click(`#platformGrid [data-platform="${id}"]`);
  await page.click(`#platformGrid [data-platform="${own}"]`);
  await page.click('#btnValidate');
  await page.waitForSelector('#validateResults .val-summary', { timeout: 60_000 });
  await page.click('#btnA11y');
  await page.waitForFunction(() => document.getElementById('a11yResults')?.style.display === '' && document.getElementById('a11yResults').children.length > 0, null, { timeout: 60_000 });
  await page.click('#btnInspect');
  await page.waitForFunction(() => document.getElementById('modalInspector')?.classList.contains('open') && document.querySelectorAll('#inspFiles [data-insp]').length > 4, null, { timeout: 60_000 });
  const files = await page.$$('#inspFiles [data-insp]');
  for (const b of files.slice(0, 6)) await b.click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('modalInspector').classList.contains('open'), null, { timeout: 10_000 });
  await page.click('#btnCloseExport');
  await page.waitForFunction(() => !document.getElementById('modalExport').classList.contains('open'), null, { timeout: 10_000 });
  return `the export modal (${ids.length} presets chosen and ${own} again, the validator, the audit, the inspector: ${Math.min(6, files.length)} of ${files.length} files)`;
}
/** Wave 5a, round 2: 1.0's local pill — its popover opened and closed twice (a click outside, Escape). */
async function localPillBrowse(page) {
  await page.click('#localPillBtn');
  await page.waitForSelector('#localPop:not([hidden])', { timeout: 10_000 });
  await page.mouse.click(4, 400);
  await page.waitForSelector('#localPop', { state: 'hidden', timeout: 10_000 });
  await page.click('#localPillBtn');
  await page.waitForSelector('#localPop:not([hidden])', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#localPop', { state: 'hidden', timeout: 10_000 });
  return `the local pill (${await page.$eval('#localPill', (p) => p.getAttribute('data-state'))}; its popover opened and closed)`;
}
/** 1.0's body for a book (its page): applyBookDoc, then buildEpub's own lines (serializeBook less what it leaves home). */
const W5A_ONE_BODY = (b) => {
  applyBookDoc(JSON.parse(JSON.stringify(b)));
  const book = serializeBook();
  ['history', 'historyPool', 'notebook', 'research', 'audio', 'importReport'].forEach((k) => { delete book[k]; });
  return JSON.stringify({ book: book, platform: state.exportPlatform, lang: getUiLang() });
};
/** Each preset's Markdown and standalone HTML, hashed in the page (two 32-bit FNV-style hashes and the length:
 *  synchronous, so 1.0's code runs on one state throughout), in either app (`two`: 2.0's export seam). */
const W5A_FORMATS = (two) => {
  const hash = (s) => {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c ^ (i & 255), 0x5bd1e995) >>> 0;
    }
    return a.toString(16) + '.' + b.toString(16) + '.' + s.length;
  };
  const go = (api, st) => {
    const keep = st.exportPlatform, out = {};
    for (const p of api.PLATFORM_PRESETS) {
      st.exportPlatform = p.id;
      out[p.id] = hash(api.buildMarkdown()) + ' ' + hash(api.buildStandaloneHtml());
    }
    st.exportPlatform = keep;
    return out;
  };
  return two ? window.beukExport.run((api, c) => go(api, c.getState())) : go({ PLATFORM_PRESETS, buildMarkdown, buildStandaloneHtml }, state);
};
function w5aServerBuild(bodies, withText = false) {
  const inF = path.join(OUT, 'w5a-bodies.json'), outF = path.join(OUT, 'w5a-server.json');
  writeFileSync(inF, JSON.stringify(bodies));
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(STUDIO, 'e2e', 'server-epub.mjs'), inF, outF, withText ? '1' : ''], { cwd: REPO, encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || String(r.error || '')).trim().split('\n').slice(-3).join(' | ') };
  return { results: JSON.parse(readFileSync(outF, 'utf8')) };
}
const w5aSame = (a, b) => JSON.stringify(a.files) === JSON.stringify(b.files) && a.filename === b.filename && a.first === b.first;
/** The routes an app with a shelf answers: health, the session, and /api/epub (its bodies recorded; `epub` answers). */
async function w5aRoutes(ctx, { signedIn = true, health = true, epub = null, bodies = [] } = {}) {
  await ctx.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/health' && health) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.pathname === '/api/auth/me' && health) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: signedIn ? { id: 'u1', email: 'w@example.org' } : null }) });
    if (u.pathname === '/api/epub' && route.request().method() === 'POST') {
      bodies.push(route.request().postData());
      if (epub) return route.fulfill(epub(bodies.length - 1));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not here"}' });
  });
}
async function w5aDownload(page, sel) {
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.click(sel);
  const d = await dl;
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

async function wave5aBodies(origin) {
  const c1 = await newContext({ serviceWorkers: 'block' });
  let equal = 0, fmtEqual = 0, n = 0;
  const unequal = [];
  try {
    for (const f of fixtures) {
      if (!Array.isArray(f.book.sections)) continue;
      n++;
      const c2 = await newContext({ serviceWorkers: 'block' });
      let b2, fm2;
      try {
        const two = await w5aOpen(c2, origin, f.file);
        b2 = await two.evaluate(() => window.beukExport.body(document.documentElement.lang === 'ar' ? 'ar' : 'en'));
        fm2 = await two.evaluate(W5A_FORMATS, true);
        await harvestCsp(two);
      } finally {
        await c2.close();
      }
      const one = await openOne(c1, origin);
      const id = JSON.parse(b2).book.meta.bookId;
      const b1 = await one.evaluate(W5A_ONE_BODY, expected(f.book, { meta: { bookId: id } }));
      const fm1 = await one.evaluate(W5A_FORMATS, false);
      await harvestCsp(one);
      await one.close();
      if (b1 === b2) equal++;
      else {
        const A = JSON.parse(b1), B = JSON.parse(b2);
        const k = [...new Set([...Object.keys(A.book), ...Object.keys(B.book)])].find((x) => JSON.stringify(A.book[x]) !== JSON.stringify(B.book[x])) || (Object.keys(A.book).join() !== Object.keys(B.book).join() ? '(key order)' : '(platform/lang)');
        unequal.push(`${f.name}: ${k} (${b1.length} / ${b2.length} bytes)`);
      }
      const fe = JSON.stringify(fm1) === JSON.stringify(fm2) && Object.keys(fm1).length === 11;
      if (fe) fmtEqual++;
      else unequal.push(`${f.name}: Markdown/HTML ${JSON.stringify(fm1).slice(0, 120)} / ${JSON.stringify(fm2).slice(0, 120)}`);
    }
  } finally {
    await c1.close();
  }
  check(equal === n, `wave5a constraint 51: the /api/epub body 2.0 sends equals 1.0's byte for byte for ${equal} of ${n} fixtures${unequal.length ? ' — ' + unequal.slice(0, 4).join('; ') : ''}`);
  check(fmtEqual === n, `wave5a constraint 51: 1.0's Markdown and standalone HTML equal 2.0's for ${fmtEqual} of ${n} fixtures × 11 presets (hashes in each page)`);
}

async function wave5aDownloads(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  // the bodies first (2.0's seam; 1.0's page), then the server's build of each, served as /api/epub would serve it
  let b2, b1;
  {
    const c = await newContext({ serviceWorkers: 'block' });
    try {
      b2 = await (await w5aOpen(c, origin, f.file)).evaluate(() => window.beukExport.body('en'));
      const one = await openOne(c, origin);
      b1 = await one.evaluate(W5A_ONE_BODY, expected(f.book));
    } finally {
      await c.close();
    }
  }
  const built = w5aServerBuild([b1, b2]);
  if (built.error) {
    note(`wave5a: the server's EPUB build could not run here (${built.error}): the EPUB download comparison is NOT RUN — install the server's dependencies (tsx, @xmldom/xmldom) and run again`);
    check(false, 'wave5a constraint 56: the server\'s build of both bodies ran');
    return;
  }
  const [s1, s2] = built.results;
  check(!s1.error && !s2.error && w5aSame(s1, s2) && s1.first === 'mimetype' && s1.files[0].stored === true,
    `wave5a constraint 56: the server builds the same package from 1.0's and 2.0's bodies (${s2.files?.length} entries, ${s2.filename}; mimetype first, stored; dcterms:modified masked)`);
  const serve = (s) => () => ({ status: 200, contentType: 'application/epub+zip', headers: { 'X-Beuk-Notes': encodeURIComponent(JSON.stringify(s.notes || [])) }, body: Buffer.from(s.zip, 'base64') });
  const got = {};
  for (const [app, s] of [['two', s2], ['one', s1]]) {
    const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
    const bodies = [];
    try {
      await w5aRoutes(ctx, { epub: serve(s), bodies });
      let page;
      if (app === 'two') {
        page = await w5aOpen(ctx, origin, f.file);
        await w5aOpenModal(page);
      } else {
        page = await openOne(ctx, origin);
        await page.waitForFunction(() => typeof cloud !== 'undefined' && cloud.available && !!cloud.user, null, { timeout: 20_000 });
        await page.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(f.book));
        await page.click('#btnExport');
        await page.waitForFunction(() => document.getElementById('modalExport').classList.contains('open'));
      }
      const md = await w5aDownload(page, '#btnDownloadMd');
      const html = await w5aDownload(page, '#btnDownloadHtml');
      const epub = await w5aDownload(page, '#btnBuildEpub');
      got[app] = { md, html, epub, body: bodies[0] };
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  check(got.one.body === b1 && got.two.body === b2, `wave5a constraint 51: the bodies the two apps POST are the ones compared above (1.0 ${got.one.body?.length} bytes, 2.0 ${got.two.body?.length} bytes)`);
  for (const k of ['md', 'html']) {
    check(got.one[k].name === got.two[k].name && got.one[k].bytes.equals(got.two[k].bytes), `wave5a constraint 56: the .${k} download is 1.0's (${got.two[k].name}, ${got.two[k].bytes.length} bytes, byte for byte)`);
  }
  check(got.one.epub.name === got.two.epub.name && got.two.epub.name === s2.filename.replace(/\.epub$/, '') + '.epub' && got.one.epub.bytes.equals(Buffer.from(s1.zip, 'base64')) && got.two.epub.bytes.equals(Buffer.from(s2.zip, 'base64')),
    `wave5a constraint 56: the .epub download is the server's file under 1.0's name (${got.two.epub.name}), in both apps`);
}

/** A book made to attack the export (studio/test/export-fixture.ts, the same values). */
function w5aHostileBook(base) {
  const b = JSON.parse(JSON.stringify(base));
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let ttf = '\u0000\u0001\u0000\u0000';
  for (let i = 4; i < 1600; i++) ttf += String.fromCharCode((i * 3 + 13) % 256);
  const TTF = Buffer.from(ttf, 'latin1').toString('base64');
  const tag = (n) => `<img src="https://evil.example/${n}.png" onerror="window.__pw=${n}">"'</style><script>window.__pw=${n}</script>`;
  const evil = "EB Garamond'; } body { display: none } #topbar { background: url(https://evil.example/t.png) } .x { font-family: '";
  Object.assign(b.meta, { title: 'Hostile ' + tag(1), author: 'Writer ' + tag(2), description: 'About ' + tag(13), a11ySummary: 'Summary ' + tag(14), isbn: '978' + tag(15), publisher: 'Pub ' + tag(16) });
  const s = b.sections.find((x) => x.kind === 'body' && x.type === 'chapter');
  s.title = 'Chapter ' + tag(3);
  s.subtitle = 'Sub ' + tag(4);
  s.number = '1' + tag(5);
  s.content = ['A paragraph <script>window.__pw=6</script> and <iframe src="https://evil.example/f"></iframe> and <img src=https://evil.example/i.png onerror=window.__pw=7>.',
    '[click](javascript:window.__pw=8) and [away](https://evil.example/a) and <a href="javascript:window.__pw=9">raw</a>.',
    '<style>#topbar{display:none}</style><link rel="stylesheet" href="https://evil.example/s.css">', '![a picture](img:hostext)', '![another](img:hostmedia)', String(s.content || '')].join('\n\n');
  s.plateId = 'hostdata';
  b.sections.push({ ...JSON.parse(JSON.stringify(s)), id: 'hostsec', type: 'chapter" onclick="window.__pw=17', kind: 'body"><script>window.__pw=18</script>', content: 'A hostile type.', plateId: null, title: 'Typed' });
  b.images = [...(b.images || []),
    { id: 'hostext', name: 'ext', mediaType: 'image/png', ext: 'png" onerror="window.__pw=19', data: PNG },
    { id: 'hostmedia', name: 'media', mediaType: 'image/png" onerror="window.__pw=10', ext: 'png', data: PNG },
    { id: 'hostdata', name: 'data', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgo=" onerror="window.__pw=11' },
    { id: 'host" onload="window.__pw=20', name: 'id', mediaType: 'image/png', ext: 'png', data: PNG }];
  b.cover = { data: PNG, mediaType: 'image/png', ext: 'png"/><item id="x" href="https://evil.example/c.xhtml" media-type="application/xhtml+xml', name: 'cover.png' };
  b.fonts = [{ id: 'f1" onload="window.__pw=21', name: 'Hand.ttf', family: 'Hand', ext: 'ttf', mediaType: 'font/ttf', data: TTF },
    { id: 'f2', name: 'Bad.ttf', family: 'Bad"); src: url(https://evil.example/f.ttf', ext: 'ttf', mediaType: 'font/ttf', data: TTF },
    { id: 'f3', name: 'Data.ttf', family: 'DataFace', ext: 'ttf', mediaType: 'font/ttf', data: 'AAEAAA") format("truetype"); } @import url(https://evil.example/i.css); x {' }];
  b.theme = { ...b.theme, bodyFont: 'Hand', headFont: evil, indentDepth: '1em; } #topbar { background: red } .fc-page p {', headerStyle: 'classic_centered" onmouseover="window.__pw=12',
    fontSize: '1px; position: fixed; inset: 0; z-index: 99999; background: url(https://evil.example/z.png)', lineHeight: '1.5; position: fixed; inset: 0', dropDepth: '3; } #topbar { display: none } .x { x: 1' };
  b.colour = { accent: 'red; } #topbar { background: url(https://evil.example/a.png) } x {', tint: 'url(https://evil.example/c.png)' };
  b.customThemes = [{ id: 'ctx', name: 'Mine ' + tag(22), theme: { ...b.theme, bodyFont: evil } }];
  return b;
}
/** studio/test/hazards.ts, in a page (run through playwright's evaluation, not the page's): what a document could make a
 *  reader run, embed or fetch — parsed the lenient way (text/html), then walked. */
const W5A_HAZARDS = ([docs]) => {
  const RUNS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'form', 'portal', 'foreignobject', 'set', 'animate', 'animatemotion', 'animatetransform']);
  const LOADS = { img: ['src', 'srcset'], audio: ['src'], video: ['src', 'poster'], source: ['src', 'srcset'], track: ['src'], input: ['src'], image: ['href', 'xlink:href'], use: ['href', 'xlink:href'], feimage: ['href', 'xlink:href'], body: ['background'], item: ['href'], content: ['src'] };
  const remote = (v) => !!v && /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(v);
  const cssRemote = (css) => { const c = String(css || '').replace(/\/\*[\s\S]*?\*\//g, ''); const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)|@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)/gi; let m; while ((m = re.exec(c))) { const u = m[2] || m[4] || ''; if (remote(u) || /^\s*(?:javascript|https?):/i.test(u)) return u; } return ''; };
  const out = [];
  for (const [where, text] of Object.entries(docs)) {
    if (where.endsWith('.css')) { if (cssRemote(text)) out.push(where + ': url(' + cssRemote(text) + ')'); continue; }
    const doc = new DOMParser().parseFromString(String(text), 'text/html');
    for (const el of doc.getElementsByTagName('*')) {
      const name = el.localName.toLowerCase();
      if (RUNS.has(name)) out.push(where + ': <' + name + '>');
      if (name === 'link' && /stylesheet|import|preload/i.test(el.getAttribute('rel') || '') && remote(el.getAttribute('href'))) out.push(where + ': remote <link>');
      for (const at of el.attributes) {
        const n = at.name.toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' || /^\s*(?:javascript|vbscript)\s*:/i.test(at.value)) out.push(where + ': <' + name + ' ' + n + '>');
        if (n === 'style' && cssRemote(at.value)) out.push(where + ': style url(' + cssRemote(at.value) + ')');
      }
      for (const a of LOADS[name] || []) if (remote(el.getAttribute(a))) out.push(where + ': remote <' + name + ' ' + a + '>');
      if (name === 'style' && cssRemote(el.textContent)) out.push(where + ': <style> url(' + cssRemote(el.textContent) + ')');
    }
  }
  return out;
};
async function wave5aHostile(origin) {
  const base = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  // the honest twin: the same book with the hostile one's extra chapter in plain words (the outline is as long)
  const twin = JSON.parse(JSON.stringify(base.book));
  const tch = twin.sections.find((x) => x.kind === 'body' && x.type === 'chapter');
  twin.sections.push({ ...JSON.parse(JSON.stringify(tch)), id: 'hostsec', content: 'A plain type.', plateId: null, title: 'Typed' });
  const hctx = await newContext({ serviceWorkers: 'block' });
  // wave 7a: the same shelf as the hostile run's (1.0's account button shows when a shelf answers: the top bar is the same)
  await w5aRoutes(hctx, { bodies: [] });
  const honest = await w5aOpen(hctx, origin, w4File('w5a-twin.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: twin })));
  const lookHonest = await honest.evaluate(W4B_LOOK);
  await hctx.close();
  const hostile = w5aHostileBook(base.book);
  const file = w4File('w5a-hostile.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile }));
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  const bodies = [];
  try {
    await w5aRoutes(ctx, { epub: () => ({ status: 200, contentType: 'application/epub+zip', body: Buffer.from('PK') }), bodies });
    const page = await w5aOpen(ctx, origin, file);
    const foreign = [];
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u); });
    const start = (await exportBackup(page)).json.book;
    const browsed = await exportBrowse(page);
    await w5aOpenModal(page);
    await page.click('#btnValidate');
    await page.click('#btnA11y');
    await page.click('#btnInspect');
    for (const b of await page.$$('#inspFiles [data-insp]')) await b.click();
    const scan = await page.evaluate(() => {
      const els = ['modalExport', 'modalInspector'].flatMap((id) => [...document.getElementById(id).querySelectorAll('*')]);
      const on = els.flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => el.tagName + ' ' + a.name));
      const src = els.flatMap((el) => [...el.attributes].filter((a) => /^(src|srcset|xlink:href)$/i.test(a.name) || (/^href$/i.test(a.name) && !/^\/help\/errors\/BEUK-[A-Z]\d{3}$/.test(a.value))).map((a) => el.tagName + ' ' + a.name + '=' + a.value.slice(0, 60)));
      const scripts = els.filter((el) => /^(SCRIPT|IFRAME|OBJECT|EMBED|LINK|STYLE)$/.test(el.tagName)).length;
      return { on, src, scripts, pw: window.__pw ?? null };
    });
    await page.keyboard.press('Escape');
    const md = await w5aDownload(page, '#btnDownloadMd');
    const html = await w5aDownload(page, '#btnDownloadHtml');
    await page.click('#btnBuildEpub');
    await page.waitForFunction(() => !document.getElementById('btnBuildEpub').disabled && !document.getElementById('modalExport').classList.contains('open'), null, { timeout: 30_000 }).catch(() => undefined);
    await page.evaluate(() => document.getElementById('modalExport').classList.remove('open')); // (1.0 closes it after a download)
    await page.waitForTimeout(500);
    const look = await page.evaluate(W4B_LOOK);
    const htmlHaz = await page.evaluate(W5A_HAZARDS, [{ [html.name]: html.bytes.toString('utf8') }]);
    check(scan.on.length === 0 && scan.src.length === 0 && scan.scripts === 0 && scan.pw === null, `wave5a constraint 53: the hostile book in the modal, the validator's and the audit's results and every file of the inspector: no handler, source, script or style element; nothing ran (${JSON.stringify(scan).slice(0, 240)})`);
    check(htmlHaz.length === 0, `wave5a constraint 53: the hostile book's standalone HTML (${html.bytes.length} bytes, parsed and walked): no script, handler or remote request (${htmlHaz.slice(0, 4).join('; ') || 'none'})`);
    const mdHaz = await page.evaluate(W5A_HAZARDS, [{ [md.name]: md.bytes.toString('utf8') }]);
    note(`wave5a: the hostile book's Markdown carries the writer's text as 1.0 writes it (raw markup in the text stays text in a .md; rendered as HTML it reads as: ${mdHaz.length} hazard(s)${mdHaz.length ? ', e.g. ' + mdHaz.slice(0, 3).join('; ') : ''}) — reported, not gated: 1.0's buildMarkdown writes the words verbatim`);
    const lookDiff = Object.keys(lookHonest).filter((k) => look[k] !== lookHonest[k]).map((k) => `${k}: ${lookHonest[k]} → ${look[k]}`);
    check(lookDiff.length === 0, `wave5a constraint 53: the app outside the modal looks exactly as with the honest book (8 elements × 11 computed properties)${lookDiff.length ? ' — ' + lookDiff.join('; ') : ''}`);
    check(bodies.length === 1, `wave5a: the hostile book's store-ready EPUB was asked for once (${bodies.length})`);
    const out = (await exportBackup(page)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(hostile, out)), `wave5a constraint 54: the hostile book exports exactly as readBook reads it (${browsed}, the .md, .html and .epub downloads)`);
    check(foreign.length === 0, `wave5a constraint 53: no request left the page (${foreign.slice(0, 3).join(', ') || 'none'})`);
    await harvestCsp(page);
    // the body 2.0 sent, built by the server; and the same book as 1.0 sends it — its values uncorrected (1.0's
    // serializeBook escapes none of them) — built by the server: the reproducing fixture. (Not 1.0's page: 1.0 renders
    // the hostile book unescaped and runs it.) The pictures and the font whose data is not base64 are left out of
    // that one: with them the server's build fails outright ("Invalid base64 input"), itself a finding.
    const raw = JSON.parse(JSON.stringify(out));
    raw.images = raw.images.filter((im) => im.id !== 'hostdata');
    raw.fonts = raw.fonts.filter((f) => f.id !== 'f3');
    const b1 = JSON.stringify({ book: raw, platform: 'generic', lang: 'en' });
    const built = w5aServerBuild([bodies[0], b1, JSON.stringify({ book: out, platform: 'generic', lang: 'en' })], true);
    if (built.error) {
      note(`wave5a: the server's EPUB build could not run here (${built.error}): the hostile body's server package is NOT RUN`);
      check(false, "wave5a constraint 53: the server's build of the hostile bodies ran");
    } else {
      const [two, oneB, asStored] = built.results;
      note(`wave5a 1.0 finding: the hostile book as stored (a picture and a font whose data is not base64) — the server's build: ${asStored.error || 'built'}`);
      const h2 = await page.evaluate(W5A_HAZARDS, [two.texts || {}]);
      const h1 = await page.evaluate(W5A_HAZARDS, [oneB.texts || {}]);
      check(!two.error && Object.keys(two.texts || {}).length > 10 && h2.length === 0, `wave5a constraint 53: the server's build of the body 2.0 sends for the hostile book (${two.files?.length} entries): no script, handler or remote request (${h2.slice(0, 4).join('; ') || 'none'})`);
      note(`wave5a 1.0 finding (reproducing fixture: this hostile book, uncorrected, the server's own build): ${h1.length} hazard(s) — ${[...new Set(h1.map((x) => x.replace(/window\.__pw=\d+/g, 'N')))].slice(0, 12).join('; ')}`);
      check(!oneB.error && h1.length > 0, "wave5a: the uncorrected book does carry them through the server's build (the 1.0 finding stands; 1.0 and the server are not changed)");
    }
  } finally {
    await ctx.close();
  }
}

async function wave5aNetwork(origin) {
  const errorsBefore = csp.errors.length;
  try {
    await wave5aNetworkRun(origin);
  } finally {
    // the deliberate 402 (the trial ended) is logged by Chromium as a failed resource: expected here, not a page error
    const mine = csp.errors.splice(errorsBefore);
    const expected402 = mine.filter((e) => /Failed to load resource: the server responded with a status of 402 \(Payment Required\)$/.test(e));
    csp.errors.push(...mine.filter((e) => !expected402.includes(e)));
    note(`wave5a: ${expected402.length} expected 402 resource line(s) from the trial check set aside`);
  }
}
async function wave5aNetworkRun(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const PAUSED = 'Your free trial has ended, so store-ready EPUB files is paused until you choose a plan.';
  for (const [label, opts, key] of [
    ['the trial ended (402)', { epub: () => ({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: PAUSED, paused: true, feature: 'export.epub' }) }) }, 'plan.pausedToast'],
    ['signed out', { signedIn: false }, 'epub.signin'],
    ['no shelf', null, 'epub.offline'],
  ]) {
    const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
    try {
      const bodies = [];
      if (opts) await w5aRoutes(ctx, { ...opts, bodies });
      const page = await w5aOpen(ctx, origin, f.file);
      if (opts) await page.waitForTimeout(800); // the studio's probe of the shelf (pictures/stock.ts) has answered
      await w5aOpenModal(page);
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.click('#btnBuildEpub');
      await page.waitForFunction(() => document.querySelectorAll('#toasts .toast').length > 0, null, { timeout: 30_000 });
      await page.waitForFunction(() => !document.getElementById('btnBuildEpub').disabled, null, { timeout: 30_000 });
      const msg = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent).join(' | '));
      const one = await openOne(ctx, origin);
      const want = await one.evaluate((k) => t(k), key);
      check(msg.includes(want) && downloads === 0 && bodies.length === (key === 'plan.pausedToast' ? 1 : 0), `wave5a constraint 55: ${label}: 1.0's words ("${want.slice(0, 60)}…"), ${bodies.length} request(s), no file (${JSON.stringify(msg.slice(0, 100))})`);
      // wave 7a: signed out, 1.0's buildEpub closes the modal and opens its sign-in dialog (2.0 has it now: 5a's noOpen is
      // gone); otherwise the modal stays open, as in 1.0
      const st = await page.evaluate(() => ({ exp: document.getElementById('modalExport').classList.contains('open'), auth: !!document.getElementById('modalAuth')?.classList.contains('open') }));
      if (label === 'signed out') check(!st.exp && st.auth, `wave5a: ${label}: as 1.0, the modal closes and the sign-in dialog opens (${JSON.stringify(st)})`);
      else check(st.exp, `wave5a: ${label}: the modal stays open, as 1.0's (${JSON.stringify(st)})`);
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
}

async function wave5aGate(origin) {
  for (const name of ['real/lantern-coast-print', 'real/dartagnan-01-three-musketeers']) {
    const f = fixtures.find((x) => x.name === name);
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await w5aOpen(ctx, origin, f.file);
      const before = (await exportBackup(page)).json.book;
      const done = await exportBrowse(page);
      const after = (await exportBackup(page)).json.book;
      check(JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(expected(f.book, after)), `wave5a constraint 54: ${name}: ${done} — the export is unchanged`);
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /export|platform|insp|a11y|valid/i.test(k)));
      check(keys.length === 0, `wave5a constraint 54: no per-device key is written by the modal (1.0 keeps none: ${keys.join(', ') || 'none'})`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  // the top bar keeps its look at a phone's width with the local pill (nothing spills)
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w5aOpen(ctx, origin, fixtures.find((x) => x.name === 'real/lantern-coast-book-one').file);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const fit = await page.evaluate(() => { const t = document.getElementById('topbar'); return [t.scrollWidth, t.clientWidth]; });
    check(fit[0] <= fit[1], `wave5a round 2: at 390 px the top bar holds the local pill and Export without spilling (${fit[0]} / ${fit[1]} px)`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

async function wave5aScreens(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const prep = (ctx) => ctx.addInitScript(([th, l]) => {
        try {
          localStorage.setItem('beuk.theme.v1', th);
          if (l) localStorage.setItem('beuk.uiLang.v1', l);
        } catch {
          /* no storage */
        }
      }, [run.theme, run.lang]);
      const c1 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      const c2 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      await prep(c1);
      await prep(c2);
      try {
        const one = await watch(await c1.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        await one.setInputFiles('#localBackupInput', f.file);
        await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
        await one.addStyleTag({ content: ONE_HIDE });
        const two = await w5aOpen(c2, origin, f.file);
        await w5aOpenModal(one, '#btnExport');
        await w5aOpenModal(two);
        for (const p of [one, two]) {
          await p.click('#btnValidate');
          await p.waitForSelector('#validateResults .val-summary');
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800); // toasts gone
        }
        for (const sel of ['#platformGrid', '#platformDetail', '#exportTree', '#validateResults']) {
          const la = one.locator(sel).first(), lb = two.locator(sel).first();
          const d = await pixelDiff(diffPage, await la.screenshot(), await lb.screenshot());
          check(d.ratio <= PIXEL_TOLERANCE, `wave5a screenshots ${tag}: ${sel} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        }
        for (const p of [one, two]) {
          await p.click('#btnInspect');
          await p.waitForFunction(() => document.getElementById('modalInspector').classList.contains('open'));
          await p.waitForTimeout(300);
        }
        const d = await pixelDiff(diffPage, await one.locator('#inspFiles').screenshot(), await two.locator('#inspFiles').screenshot());
        check(d.ratio <= PIXEL_TOLERANCE, `wave5a screenshots ${tag}: the inspector's #inspFiles differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        // round 2: 1.0's local pill and its open popover beside 2.0's (the inspector and the modal closed first)
        for (const p of [one, two]) {
          await p.evaluate(() => { document.getElementById('modalInspector')?.classList.remove('open'); document.getElementById('modalExport')?.classList.remove('open'); });
          await p.waitForTimeout(400);
        }
        const st1 = await one.$eval('#localPill', (x) => x.getAttribute('data-state') + (x.hasAttribute('data-evictable') ? ' evictable' : ''));
        const st2 = await two.$eval('#localPill', (x) => x.getAttribute('data-state') + (x.hasAttribute('data-evictable') ? ' evictable' : ''));
        check(st1 === st2, `wave5a round 2 ${tag}: the local pill's state is 1.0's (1.0 "${st1}", 2.0 "${st2}")`);
        const dp = await pixelDiff(diffPage, await one.locator('#localPill').screenshot(), await two.locator('#localPill').screenshot());
        check(dp.ratio <= PIXEL_TOLERANCE, `wave5a round 2 screenshots ${tag}: #localPill differs in ${(dp.ratio * 100).toFixed(2)}% of pixels [${dp.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        for (const p of [one, two]) {
          await p.click('#localPillBtn');
          await p.waitForSelector('#localPop:not([hidden])');
          await p.waitForTimeout(300);
        }
        // "Last saved {time}": each app's own last write — the time itself is masked in the pixels and compared as text
        const noTime = (x) => x.replace(/[\d\u0660-\u0669]{1,2}:[\d\u0660-\u0669]{2}:[\d\u0660-\u0669]{2}[\s\u202f\u200f]*(AM|PM|ص|م)?/g, '{time}');
        const [d1, d2] = [await one.$eval('#localPopDetail', (x) => x.textContent), await two.$eval('#localPopDetail', (x) => x.textContent)];
        check(noTime(d1) === noTime(d2) && noTime(d2).includes('{time}'), `wave5a round 2 ${tag}: the popover's words are 1.0's, with the time of the store's last write (${JSON.stringify(noTime(d2).slice(0, 80))})`);
        const mask = (p) => p.locator('#localPop').screenshot({ mask: [p.locator('#localPopDetail')] });
        const dq = await pixelDiff(diffPage, await mask(one), await mask(two));
        check(dq.ratio <= PIXEL_TOLERANCE, `wave5a round 2 screenshots ${tag}: the open #localPop (its time masked) differs in ${(dq.ratio * 100).toFixed(2)}% of pixels [${dq.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        writeFileSync(path.join(OUT, `w5a-one-${tag}.png`), await one.screenshot());
        writeFileSync(path.join(OUT, `w5a-two-${tag}.png`), await two.screenshot());
        await harvestCsp(one);
        await harvestCsp(two);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function wave5aChecks(origin) {
  const only = (process.env.W5A_PARTS || 'bodies,downloads,hostile,network,gate,screens').split(',');
  if (only.includes('bodies')) await wave5aBodies(origin);
  if (only.includes('downloads')) await wave5aDownloads(origin);
  if (only.includes('hostile')) await wave5aHostile(origin);
  if (only.includes('network')) await wave5aNetwork(origin);
  if (only.includes('gate')) await wave5aGate(origin);
  if (only.includes('screens')) await wave5aScreens(origin);
}

/* ---- wave 5b: print (plan 2026-11-02 wave5b, constraints 57-63) ----
   Constraint 57: Download Print HTML is 1.0's file, byte for byte — 1.0's buildPrintHtml (after its press bake) in
   1.0's page and in 2.0's, hashed in each page, for every fixture × every trim × the settings that change it; the
   downloaded files and the print frames compared whole on one book. The Print Interior View's model (every page: its
   number, blank, section, column; the spread count) equals 1.0's in the same browser at the same viewport. 59: a
   hostile book through the print view's frame (its own document walked), the downloaded file, the interior view and
   the preflight: no script, handler or remote request. 60: the print section, the print view, the interior view and
   the preflight browsed — the export unchanged (and readOnlyRooms takes it into the 23-fixture gate). 61: the latency
   line with the interior view closed. Screenshots beside 1.0's in Paper, Candlelight and Arabic. */
/** The print settings each fixture's document is built at (`big`: the three long books, fewer). */
function w5bSets(book, trims, big) {
  const notes = book.printNotes === 'end' ? 'page' : 'end';
  const toggles = [
    { printRecto: !(book.printRecto ?? true) },
    { printLargePrint: true, printPictureBook: false },
    { printPictureBook: true, printLargePrint: false },
    { printBleed: true },
    { printMarginMode: 'custom', printCustomMargins: { inside: 0.9, outside: 0.4, top: 0.5, bottom: 0.8 } },
    { printHeadContent: 'chapter' },
    { printHeadContent: 'none' },
    { printHeadPlace: 'bottom' },
    { printOmitChapterHead: true },
    { printOmitBlankHead: false },
    { printFolio: 'outer' },
    { printFolio: 'none' },
    { printNotes: notes },
  ];
  if (big) return [{}, { printTrim: '5x8' }, toggles[1], toggles[12]];
  return [{}, ...trims.map((id) => ({ printTrim: id })), ...toggles];
}
/** In 1.0's page: the book arrives (applyBookDoc), then each setting's document after the press bake, hashed. */
const W5B_ONE_HTML = async ([b, sets]) => {
  const hash = (s) => {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c ^ (i & 255), 0x5bd1e995) >>> 0;
    }
    return a.toString(16) + '.' + b.toString(16) + '.' + s.length;
  };
  applyBookDoc(JSON.parse(JSON.stringify(b)));
  // the running head's face loaded first (1.0's printFitHead measures on a canvas, with the face once the page has it;
  // a book open in 1.0's studio has it from the preview), and 1.0's measure cache empty
  await document.fonts.load('10pt ' + fontStack(labelFaceOf(state.theme))).catch(() => undefined);
  printHeadFitMemo.clear();
  const out = [];
  for (const set of sets) {
    const keep = {};
    for (const k of Object.keys(set)) keep[k] = JSON.parse(JSON.stringify(state[k] ?? null));
    Object.assign(state, JSON.parse(JSON.stringify(set)));
    try {
      await preparePrintPress();
      out.push(hash(buildPrintHtml()));
    } finally {
      Object.assign(state, keep);
    }
  }
  return out;
};
const W5B_TWO_HTML = async ([sets]) => {
  const hash = (s) => {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c ^ (i & 255), 0x5bd1e995) >>> 0;
    }
    return a.toString(16) + '.' + b.toString(16) + '.' + s.length;
  };
  const out = [];
  for (const set of sets) out.push(hash(await window.beukPrint.html(set)));
  return out;
};
/** The interior view's model in 1.0's page (after a first pass: faces and pictures in). */
const W5B_ONE_MODEL = async ([b, sets]) => {
  applyBookDoc(JSON.parse(JSON.stringify(b)));
  const one = () => { const m = buildPrintViewModel(); return { spreads: m.spreads, pages: m.pages.map((p) => [p.n, p.blank ? 1 : 0, p.section ? p.section.id : '', p.col]) }; };
  one();
  await document.fonts.ready;
  const out = [];
  for (const set of sets) {
    const keep = {};
    for (const k of Object.keys(set)) keep[k] = JSON.parse(JSON.stringify(state[k] ?? null));
    Object.assign(state, JSON.parse(JSON.stringify(set)));
    try {
      out.push(one());
    } finally {
      Object.assign(state, keep);
    }
  }
  return out;
};
const W5B_TWO_MODEL = async ([sets]) => {
  window.beukPrint.model({});
  await document.fonts.ready;
  return sets.map((s) => window.beukPrint.model(s));
};
async function w5bOpen(ctx, origin, file) {
  const page = await w5aOpen(ctx, origin, file);
  await page.waitForFunction(() => !!window.beukPrint, null, { timeout: 60_000 });
  return page;
}

async function wave5bParity(origin) {
  const c1 = await newContext({ serviceWorkers: 'block' });
  let docs = 0, docsEqual = 0, models = 0, modelsEqual = 0, n = 0;
  const unequal = [];
  const table = [];
  try {
    const probe = await openOne(c1, origin);
    const trims = await probe.evaluate(() => TRIM_SIZES.map((x) => x.id));
    await probe.close();
    for (const f of fixtures) {
      if (!Array.isArray(f.book.sections)) continue;
      if (process.env.W5B_FIXTURES && !new RegExp(process.env.W5B_FIXTURES).test(f.name)) continue; // a quick re-run while working
      n++;
      const big = /dartagnan|valois|oz-14/.test(f.name);
      const sets = w5bSets(f.book, trims, big);
      const msets = big ? [{}] : [{}, { printTrim: '5x8' }, { printNotes: f.book.printNotes === 'end' ? 'page' : 'end' }];
      const c2 = await newContext({ serviceWorkers: 'block' });
      let h2, m2, bookId;
      try {
        const two = await w5bOpen(c2, origin, f.file);
        h2 = await two.evaluate(W5B_TWO_HTML, [sets]);

        m2 = await two.evaluate(W5B_TWO_MODEL, [msets]);
        const body = await two.evaluate(() => window.beukExport.body('en'));
        bookId = JSON.parse(body).book.meta.bookId;
        await harvestCsp(two);
      } finally {
        await c2.close();
      }
      const one = await openOne(c1, origin);
      const b = expected(f.book, { meta: { bookId } });
      const h1 = await one.evaluate(W5B_ONE_HTML, [b, sets]);
      const firstBad = sets.findIndex((_, i) => h1[i] !== h2[i]);
      if (firstBad >= 0) {
        // where the two documents part: 1.0's (its page) and 2.0's (a fresh 2.0 page, the same book)
        const doc1 = await one.evaluate(async ([bb, set]) => { applyBookDoc(JSON.parse(JSON.stringify(bb))); await document.fonts.load('10pt ' + fontStack(labelFaceOf(state.theme))).catch(() => undefined); printHeadFitMemo.clear(); Object.assign(state, JSON.parse(JSON.stringify(set))); await preparePrintPress(); return buildPrintHtml(); }, [b, sets[firstBad]]);
        const c3 = await newContext({ serviceWorkers: 'block' });
        try {
          const t3 = await w5bOpen(c3, origin, f.file);
          const doc2 = await t3.evaluate((set) => window.beukPrint.html(set), sets[firstBad]);
          let k = 0;
          while (k < doc1.length && doc1[k] === doc2[k]) k++;
          note(`wave5b: ${f.name} ${JSON.stringify(sets[firstBad])}: the documents part at character ${k}: 1.0 ${JSON.stringify(doc1.slice(Math.max(0, k - 160), k + 140))} | 2.0 ${JSON.stringify(doc2.slice(Math.max(0, k - 160), k + 140))}`);
          await harvestCsp(t3);
        } finally {
          await c3.close();
        }
      }
      const m1 = await one.evaluate(W5B_ONE_MODEL, [b, msets]);
      await harvestCsp(one);
      await one.close();
      sets.forEach((s, i) => {
        docs++;
        if (h1[i] === h2[i]) docsEqual++;
        else unequal.push(`${f.name} ${JSON.stringify(s)}: ${h1[i]} / ${h2[i]}`);
      });
      const cells = [];
      msets.forEach((s, i) => {
        models++;
        const same = JSON.stringify(m1[i]) === JSON.stringify(m2[i]);
        if (same) modelsEqual++;
        else unequal.push(`${f.name} model ${JSON.stringify(s)}: ${m1[i].pages.length}/${m2[i].pages.length} pages, ${m1[i].spreads}/${m2[i].spreads} spreads`);
        cells.push(`${m1[i].pages.length}/${m2[i].pages.length} p, ${m1[i].spreads}/${m2[i].spreads} sp`);
      });
      table.push(`${f.name}: ${cells.join(' | ')}`);
    }
  } finally {
    await c1.close();
  }
  note('wave5b interior view (1.0 / 2.0), [book\'s own trim | 5x8 | notes flipped]:');
  for (const row of table) note('  ' + row);
  check(docsEqual === docs, `wave5b constraint 57: Download Print HTML (1.0's buildPrintHtml after its press bake) equals 1.0's for ${docsEqual} of ${docs} documents (${n} fixtures × every trim × 13 settings; the three long books × 4)${unequal.length ? ' — ' + unequal.slice(0, 4).join('; ') : ''}`);
  check(modelsEqual === models, `wave5b constraint 57: the Print Interior View's pages and spread breaks equal 1.0's for ${modelsEqual} of ${models} models (${n} fixtures)`);
}

async function wave5bDownloads(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const two = await w5bOpen(ctx, origin, f.file);
    await w5aOpenModal(two);
    const d2 = await w5aDownload(two, '#btnDownloadPrintHtml');
    await two.click('#btnOpenPrintView');
    await two.waitForFunction(() => document.getElementById('modalPrint').classList.contains('open') && document.getElementById('printFrame').srcdoc.length > 1000, null, { timeout: 60_000 });
    await two.waitForTimeout(1500); // the press bake's second frame
    const fr2 = await two.$eval('#printFrame', (x) => x.srcdoc);
    const one = await openOne(ctx, origin);
    await one.setInputFiles('#localBackupInput', f.file);
    await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
    await one.click('#btnExport');
    await one.waitForFunction(() => document.getElementById('modalExport').classList.contains('open'));
    const d1 = await w5aDownload(one, '#btnDownloadPrintHtml');
    await one.click('#btnOpenPrintView');
    await one.waitForFunction(() => document.getElementById('modalPrint').classList.contains('open') && document.getElementById('printFrame').srcdoc.length > 1000, null, { timeout: 60_000 });
    await one.waitForTimeout(1500);
    const fr1 = await one.$eval('#printFrame', (x) => x.srcdoc);
    check(d1.name === d2.name && d1.bytes.equals(d2.bytes), `wave5b constraint 57: Download Print HTML in both apps: ${d2.name} ${d2.bytes.length} bytes, byte for byte (1.0: ${d1.name} ${d1.bytes.length})`);
    check(fr1 === fr2 && fr2 === d2.bytes.toString('utf8'), `wave5b constraint 57: the print view's frame shows 1.0's document (${fr2.length} characters), and the downloaded file is that document`);
    const sb = await two.$eval('#printFrame', (x) => x.getAttribute('sandbox'));
    const sb1 = await one.$eval('#printFrame', (x) => x.getAttribute('sandbox'));
    check(sb === sb1, `wave5b constraint 59: the print frame is sandboxed exactly as 1.0's is (1.0: ${sb1 === null ? 'no sandbox' : sb1}; 2.0: ${sb === null ? 'no sandbox' : sb})`);
    // the frame's own document (same origin): what it holds and runs
    const inFrame = await two.evaluate(() => {
      const d = document.getElementById('printFrame').contentDocument;
      return { sections: d.querySelectorAll('section.print-sec').length, scripts: d.querySelectorAll('script').length, on: [...d.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length };
    });
    check(inFrame.sections > 5 && inFrame.scripts === 0 && inFrame.on === 0, `wave5b: the frame's own document: ${inFrame.sections} print sections, ${inFrame.scripts} scripts, ${inFrame.on} handlers`);
    await harvestCsp(two);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

async function wave5bHostile(origin) {
  const base = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const hostile = w5aHostileBook(base.book);
  // second review (Important 1): a title and an author that leave the print CSS's running-head string by a raw newline
  // (1.0's cssStr escapes \ and " only) with a quoted url() carrying ')'
  hostile.meta.title = "x\n}\n}\nbody{background:url('https://evil.example/t)')}" + hostile.meta.title;
  hostile.meta.author = "y\r}\f@media all{p{background-image:url('https://evil.example/a)')}}" + hostile.meta.author;
  const file = w4File('w5b-hostile.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile }));
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const page = await w5bOpen(ctx, origin, file);
    const foreign = [];
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) foreign.push(u); });
    const start = (await exportBackup(page)).json.book;
    await w5aOpenModal(page);
    const file1 = await w5aDownload(page, '#btnDownloadPrintHtml');
    await page.click('#btnOpenPrintView');
    await page.waitForFunction(() => document.getElementById('modalPrint').classList.contains('open') && document.getElementById('printFrame').srcdoc.length > 1000, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const frame = await page.evaluate(() => {
      const d = document.getElementById('printFrame').contentDocument;
      const els = [...d.querySelectorAll('*')];
      return {
        on: els.flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => el.tagName + ' ' + a.name)),
        runs: els.filter((el) => /^(SCRIPT|IFRAME|OBJECT|EMBED|BASE|FORM)$/.test(el.tagName)).length,
        remote: els.flatMap((el) => [...el.attributes].filter((a) => /^(src|srcset|href|xlink:href)$/i.test(a.name) && /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(a.value)).map((a) => el.tagName + ' ' + a.value.slice(0, 50))),
        pw: document.getElementById('printFrame').contentWindow.__pw ?? null,
        srcdoc: document.getElementById('printFrame').srcdoc,
      };
    });
    await page.click('#btnClosePrint');
    await w5aOpenModal(page);
    await page.click('#btnOpenSpreads');
    await page.waitForFunction(() => document.getElementById('modalPrintView').classList.contains('open') && document.querySelectorAll('#pivSpread .piv-page').length > 0, null, { timeout: 60_000 });
    const spreads = await page.evaluate(() => Number((/of (\d+)/.exec(document.getElementById('pivCounter').textContent) || [0, 0])[1]));
    let pivOn = 0;
    for (let i = 0; i < Math.min(spreads, 40); i++) {
      pivOn += await page.evaluate(() => [...document.querySelectorAll('#pivSpread *, #pivMeasure *')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name)) || /^(SCRIPT|IFRAME|OBJECT|EMBED)$/.test(el.tagName)).length);
      if (i < Math.min(spreads, 40) - 1) await page.click('#btnPivNext');
    }
    await page.click('#btnClosePrintView');
    await w5aOpenModal(page);
    await page.click('#btnPreflight');
    await page.waitForFunction(() => document.getElementById('preflightResults').style.display === '', null, { timeout: 30_000 });
    const pf = await page.evaluate(() => [...document.querySelectorAll('#preflightResults *')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name)) || el.tagName === 'SCRIPT').length);
    await page.click('#btnCloseExport');
    const fileHaz = await page.evaluate(W5A_HAZARDS, [{ [file1.name]: file1.bytes.toString('utf8') }]);
    const docHaz = await page.evaluate(W5A_HAZARDS, [{ frame: frame.srcdoc }]);
    check(frame.on.length === 0 && frame.runs === 0 && frame.remote.length === 0 && frame.pw === null && docHaz.length === 0, `wave5b constraint 59: the hostile book in the print view's frame: no handler, script or remote source in its own document; nothing ran (${JSON.stringify({ on: frame.on.slice(0, 3), runs: frame.runs, remote: frame.remote.slice(0, 3), pw: frame.pw, docHaz: docHaz.slice(0, 3) })})`);
    check(fileHaz.length === 0, `wave5b constraint 59: the hostile book's Download Print HTML (${file1.bytes.length} bytes, parsed and walked): no script, handler or remote request (${fileHaz.slice(0, 4).join('; ') || 'none'})`);
    // its stylesheets as a browser reads them as CSS (strings a raw newline does not break masked; a url()'s own quoted
    // address kept): no address of another origin
    const asCss = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
      .replace(/"(?:[^"\\\n\r\f]|\\[\s\S])*"|'(?:[^'\\\n\r\f]|\\[\s\S])*'/g, (m, at, all) => (/url\(\s*$/i.test(all.slice(Math.max(0, at - 12), at)) ? m : '""'));
    check(!/evil\.example/.test(asCss(file1.bytes.toString('utf8'))) && !/evil\.example/.test(asCss(frame.srcdoc)), 'wave5b constraint 59: the hostile title and author (a raw newline out of the running head\'s CSS string, a quoted url() with a ")") load nothing from another origin in the file\'s or the frame\'s stylesheets');
    check(pivOn === 0 && pf === 0 && (await page.evaluate(() => window.__pw ?? null)) === null, `wave5b constraint 59: the hostile book's interior view (${Math.min(spreads, 40)} of ${spreads} spreads) and preflight: no handler or script; nothing ran`);
    const out = (await exportBackup(page)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(hostile, out)), 'wave5b constraint 60: the hostile book exports exactly as readBook reads it (after the print view, the file, the interior view and the preflight)');
    check(foreign.length === 0, `wave5b constraint 59: no request left the page (${foreign.slice(0, 3).join(', ') || 'none'})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/** Wave 5b (constraint 60): the print section, the print view, the interior view and the preflight browsed, every
 *  setting put back where it was. Shared with readOnlyRooms (the 23-fixture gate). */
async function printBrowse(page) {
  await w5aOpenModal(page);
  await page.waitForFunction(() => document.querySelectorAll('#trimGrid [data-trim]').length === 24, null, { timeout: 30_000 });
  const own = await page.$eval('#trimGrid .active', (b) => b.getAttribute('data-trim'));
  for (const id of ['5x8', '8.5x11', own]) await page.click(`#trimGrid [data-trim="${id}"]`);
  // large print and picture book as the book has them (1.0's exclusion: large print on turns picture book off, so a
  // toggle twice is not always the book as it was — they are put back at the end)
  const lp = await page.$eval('#tglLargePrint', (b) => b.getAttribute('aria-pressed'));
  const pb = await page.$eval('#tglPictureBook', (b) => b.getAttribute('aria-pressed'));
  for (const id of ['#tglRecto', '#tglLargePrint', '#tglBleed', '#tglOmitChapter', '#tglOmitBlank']) {
    await page.click(id);
    await page.click(id);
  }
  await page.click('#tglPictureBook');
  await page.click('#tglPictureBook');
  if ((await page.$eval('#tglLargePrint', (b) => b.getAttribute('aria-pressed'))) !== lp) await page.click('#tglLargePrint');
  if ((await page.$eval('#tglPictureBook', (b) => b.getAttribute('aria-pressed'))) !== pb) await page.click('#tglPictureBook');
  for (const [sel, vals] of [['#selHeadContent', ['none', 'chapter']], ['#selHeadPlace', ['bottom']], ['#selFolio', ['none']], ['#selPrintNotes', ['page', 'end']], ['#selMarginMode', ['custom']]]) {
    const was = await page.$eval(sel, (x) => x.value);
    for (const v of vals) await page.selectOption(sel, v);
    await page.selectOption(sel, was);
  }
  await page.click('#btnPreflight');
  await page.waitForFunction(() => document.getElementById('preflightResults').style.display === '', null, { timeout: 60_000 });
  const jump = await page.$('#preflightResults [data-pfjump]');
  if (jump) await jump.click();
  // a section jump is 1.0's audit's "Take me there": the modal closes, the section opens
  if (!(await page.evaluate(() => document.getElementById('modalExport').classList.contains('open')))) await w5aOpenModal(page);
  await page.click('#btnOpenPrintView');
  await page.waitForFunction(() => document.getElementById('modalPrint').classList.contains('open') && document.getElementById('printFrame').srcdoc.length > 500, null, { timeout: 60_000 });
  await page.click('#btnClosePrint');
  await w5aOpenModal(page);
  await page.click('#btnOpenSpreads');
  await page.waitForFunction(() => document.getElementById('modalPrintView').classList.contains('open') && /\d/.test(document.getElementById('pivCounter').textContent), null, { timeout: 120_000 });
  await page.click('#btnPivNext');
  await page.click('#btnPivNext');
  await page.click('#btnPivPrev');
  await page.click('#tglPivGuides');
  await page.click('#tglPivGuides');
  await page.click('#pivZoomActual');
  await page.click('#pivZoomFit');
  const jumpTo = await page.$$eval('#pivJump option', (o) => (o[1] || o[0]).value);
  await page.selectOption('#pivJump', jumpTo);
  const pt = await page.$eval('#pivTrim', (x) => x.value);
  await page.selectOption('#pivTrim', '5x8');
  await page.selectOption('#pivTrim', pt);
  await page.click('#tglPivRecto');
  await page.click('#tglPivRecto');
  await page.click('#btnClosePrintView');
  await page.waitForFunction(() => !document.getElementById('modalPrintView').classList.contains('open'), null, { timeout: 10_000 });
  return `print (3 trims and the book's own again, 6 toggles twice, 5 selects and back, the preflight${jump ? ' and a jump' : ''}, the print view, the interior view paged, guides, zoom, a jump, its trim and recto and back)`;
}

async function wave5bGate(origin) {
  for (const name of ['real/lantern-coast-print', 'real/dartagnan-01-three-musketeers']) {
    const f = fixtures.find((x) => x.name === name);
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const page = await w5bOpen(ctx, origin, f.file);
      const before = (await exportBackup(page)).json.book;
      const done = await printBrowse(page);
      const after = (await exportBackup(page)).json.book;
      check(JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(expected(f.book, after)), `wave5b constraint 60: ${name}: ${done} — the export is unchanged`);
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /print|piv|trim|preflight/i.test(k)));
      check(keys.length === 0, `wave5b constraint 60: no per-device key is written by print (1.0 keeps none: ${keys.join(', ') || 'none'})`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  // a setting left changed is an edit, in 1.0's shape, and 1.0 reads it back
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const page = await w5bOpen(ctx, origin, f.file);
    await w5aOpenModal(page);
    await page.click('#trimGrid [data-trim="5.5x8.5"]');
    await page.click('#tglLargePrint');
    await page.click('#btnCloseExport');
    const out = (await exportBackup(page)).json.book;
    const want = { ...expected(f.book, out), printTrim: '5.5x8.5', printLargePrint: true, printPictureBook: false };
    check(JSON.stringify(out) === JSON.stringify(want), `wave5b constraint 58: a trim and Large Print left changed are 1.0's printTrim / printLargePrint in their places (${out.printTrim}, ${out.printLargePrint})`);
    const file = w4File('w5b-changed.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: out }));
    const one = await openOne(ctx, origin);
    await one.setInputFiles('#localBackupInput', file);
    await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
    const back = await one.evaluate(() => [state.printTrim, state.printLargePrint, state.printPictureBook]);
    check(JSON.stringify(back) === JSON.stringify(['5.5x8.5', true, false]), `wave5b constraint 58: 1.0 reads the setting 2.0 wrote back (${JSON.stringify(back)})`);
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

async function wave5bScreens(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const prep = (ctx) => ctx.addInitScript(([th, l]) => {
        try {
          localStorage.setItem('beuk.theme.v1', th);
          if (l) localStorage.setItem('beuk.uiLang.v1', l);
        } catch {
          /* no storage */
        }
      }, [run.theme, run.lang]);
      const c1 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      const c2 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      await prep(c1);
      await prep(c2);
      try {
        const one = await watch(await c1.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        await one.setInputFiles('#localBackupInput', f.file);
        await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
        await one.addStyleTag({ content: ONE_HIDE });
        const two = await w5bOpen(c2, origin, f.file);
        await w5aOpenModal(one, '#btnExport');
        await w5aOpenModal(two);
        for (const p of [one, two]) {
          await p.click('#btnPreflight');
          await p.waitForFunction(() => document.getElementById('preflightResults').style.display === '');
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800); // toasts gone
        }
        // the export modal's other sections hidden in both (what stands above the print section must be alike, and with
        // it the subpixel position the region is cut at; wave 5d: the store-ready entry is shown in both, as 1.0 has it)
        for (const p of [one, two]) {
          await p.evaluate(() => {
            const keep = document.getElementById('trimGrid').closest('.fmt-sec');
            const pf = document.getElementById('preflightResults').closest('.fmt-sec');
            document.querySelectorAll('#modalExport .fmt-sec').forEach((x) => { if (x !== keep && x !== pf) x.style.display = 'none'; });
          });
          await p.waitForTimeout(300);
        }
        const sec = (p) => p.locator('#trimGrid').locator('xpath=ancestor::div[contains(@class,"fmt-sec")]');
        for (const [label, la, lb] of [['#trimGrid', one.locator('#trimGrid'), two.locator('#trimGrid')], ['the print section', sec(one), sec(two)], ['#preflightResults', one.locator('#preflightResults'), two.locator('#preflightResults')]]) {
          await la.scrollIntoViewIfNeeded();
          await lb.scrollIntoViewIfNeeded();
          const d = await pixelDiff(diffPage, await la.screenshot(), await lb.screenshot());
          check(d.ratio <= PIXEL_TOLERANCE, `wave5b screenshots ${tag}: ${label} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        }
        for (const p of [one, two]) {
          await p.click('#btnOpenPrintView');
          await p.waitForFunction(() => document.getElementById('modalPrint').classList.contains('open') && document.getElementById('printFrame').srcdoc.length > 1000);
          await p.waitForTimeout(2500);
        }
        const d1 = await pixelDiff(diffPage, await one.locator('#printModalBox').screenshot(), await two.locator('#printModalBox').screenshot());
        check(d1.ratio <= PIXEL_TOLERANCE, `wave5b screenshots ${tag}: the print view (#printModalBox, its frame included) differs in ${(d1.ratio * 100).toFixed(2)}% of pixels [${d1.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        for (const p of [one, two]) {
          await p.click('#btnClosePrint');
          await w5aOpenModal(p, '#btnExport');
          await p.click('#btnOpenSpreads');
          await p.waitForFunction(() => document.getElementById('modalPrintView').classList.contains('open') && /\d/.test(document.getElementById('pivCounter').textContent));
          await p.click('#btnPivNext');
          await p.click('#btnPivNext');
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(800);
        }
        const d2 = await pixelDiff(diffPage, await one.locator('#pivModalBox').screenshot(), await two.locator('#pivModalBox').screenshot());
        check(d2.ratio <= PIXEL_TOLERANCE, `wave5b screenshots ${tag}: the Print Interior View (#pivModalBox, spread 3) differs in ${(d2.ratio * 100).toFixed(2)}% of pixels [${d2.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        writeFileSync(path.join(OUT, `w5b-one-${tag}.png`), await one.screenshot());
        writeFileSync(path.join(OUT, `w5b-two-${tag}.png`), await two.screenshot());
        await harvestCsp(one);
        await harvestCsp(two);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function wave5bChecks(origin) {
  const only = (process.env.W5B_PARTS || 'parity,downloads,hostile,gate,screens,latency').split(',');
  if (only.includes('parity')) await wave5bParity(origin);
  if (only.includes('downloads')) await wave5bDownloads(origin);
  if (only.includes('hostile')) await wave5bHostile(origin);
  if (only.includes('gate')) await wave5bGate(origin);
  if (only.includes('screens')) await wave5bScreens(origin);
  // constraint 61: the editor's typing with the interior view closed (#5's measure, and the redraws between keys)
  if (only.includes('latency') && !(process.env.E2E_ONLY || '').split(',').includes('latency')) {
    const r = await latency(origin);
    note(`wave5b latency (the print dialogs mounted, closed): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
    check(r.p95 < LATENCY_P95_TARGET_MS, `wave5b constraint 61: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas with the interior view closed (${r.p95.toFixed(1)} ms)`);
    const r2 = await latency(origin, { delay: 200, count: 60, quick: true });
    note(`wave5b latency with the preview redrawing between keys (200 ms): p50 ${r2.p50.toFixed(1)} ms, p95 ${r2.p95.toFixed(1)} ms, max ${r2.max.toFixed(1)} ms over ${r2.n} keystrokes`);
    check(r2.p95 < LATENCY_P95_TARGET_MS, `wave5b constraint 61: p95 under ${LATENCY_P95_TARGET_MS} ms while the preview redraws between keys (${r2.p95.toFixed(1)} ms)`);
  }
}

/* ---- wave 5c: Word, box sets, the submission manuscript, the ACX script (plan 2026-11-03, constraints 64-70) ----
   Constraint 64: every package is 1.0's — 1.0's builders in 1.0's page (applyBookDoc of the same book) and in 2.0's
   (the seam), every part hashed in each page: for every fixture, the Word document; the manuscript at every paper ×
   font × italics with a contact block; the ACX zip at every format × rights line; the box set (two volumes made by
   1.0's own bookDocToVolume, their generated ids named alike) at three presets. Masked, and shown to vary in 1.0 too:
   the box set's dcterms:modified (the build's time) and a volume's id (uid() at each Add a Book). The real buttons on
   one book in both apps: the same file names and every entry equal. 67: a hostile book and a hostile volume through
   every format, each package walked in the page; the dialogs' DOM. 68: the dialogs in the no-edit gate (and in
   readOnlyRooms, the 23-fixture gate); a box set of three fixtures built. 70: the latency line. Screenshots beside 1.0. */
/** Every package of 1.0's four builders for the book on the page, each part hashed (see above). `two`: 2.0's seam. */
const W5C_PACKAGES = ([two, vols]) => {
  const hash = (s) => {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c ^ (i & 255), 0x5bd1e995) >>> 0;
    }
    return a.toString(16) + '.' + b.toString(16) + '.' + s.length;
  };
  const go = (api, st) => {
    const out = {};
    const put = (k, files) => {
      out[k] = files.map((f) => f.path + '=' + hash(k.startsWith('boxset') && f.path === 'OEBPS/package.opf' ? String(f.content).replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '') : f.content)).join(' ');
    };
    put('docx', api.buildDocxFiles());
    const ms0 = st.manuscript, au0 = st.audio, bv0 = st.boxSetVolumes;
    try {
      for (const paper of ['letter', 'a4']) for (const font of ['times', 'courier']) for (const italics of ['italic', 'underline']) {
        st.manuscript = api.msNormalize(Object.assign({}, ms0, { legalName: 'Ada Quill', address: '1 Harbour Row\nPortsalt', email: 'ada@example.org', paper, font, italics }));
        put('ms ' + paper + ' ' + font + ' ' + italics, api.msFiles(api.msPlan()));
      }
      for (const format of ['both', 'docx', 'txt']) for (const rightsInClosing of [false, true]) {
        st.audio = api.acxNormalize(Object.assign({}, au0, { format, rightsInClosing, narrator: 'Rae North' }));
        out['acx ' + format + ' ' + rightsInClosing] = api.acxZipEntries(api.acxBuildPlan()).map((e) => e.path + '=' + ('text' in e ? hash(e.text) : e.docx.map((f) => f.path + ':' + hash(f.content)).join(','))).join(' ');
      }
      st.boxSetVolumes = vols.map((b, i) => {
        const v = api.bookDocToVolume(JSON.parse(JSON.stringify(b)), 'vol' + i + '.json');
        return JSON.parse(JSON.stringify(v).split(v.id).join('VOL' + i));
      });
      for (const p of ['generic', 'kdp', 'apple']) put('boxset ' + p, api.boxSetFiles(p));
    } finally {
      st.manuscript = ms0;
      st.audio = au0;
      st.boxSetVolumes = bv0;
    }
    return out;
  };
  /* global buildDocxFiles, msNormalize, msFiles, msPlan, acxNormalize, acxZipEntries, acxBuildPlan, bookDocToVolume, boxSetFiles, state */
  return two ? window.beukExport.run((api, c) => go(api, c.getState())) : go({ buildDocxFiles, msNormalize, msFiles, msPlan, acxNormalize, acxZipEntries, acxBuildPlan, bookDocToVolume, boxSetFiles }, state);
};
const W5C_VOLS = () => ['real/reads-you', 'real/four-kitchens-book-one'].map((n) => fixtures.find((x) => x.name === n).book);
async function wave5cParity(origin) {
  const c1 = await newContext({ serviceWorkers: 'block' });
  let n = 0, pk = 0, eq = 0;
  const unequal = [];
  try {
    for (const f of fixtures) {
      if (!Array.isArray(f.book.sections)) continue;
      n++;
      const c2 = await newContext({ serviceWorkers: 'block' });
      let p2, id;
      try {
        const two = await w5aOpen(c2, origin, f.file);
        p2 = await two.evaluate(W5C_PACKAGES, [true, W5C_VOLS()]);
        id = (await exportBackup(two)).json.book.meta.bookId;
        await harvestCsp(two);
      } finally {
        await c2.close();
      }
      const one = await openOne(c1, origin);
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(f.book, { meta: { bookId: id } }));
      const p1 = await one.evaluate(W5C_PACKAGES, [false, W5C_VOLS()]);
      await harvestCsp(one);
      await one.close();
      for (const k of Object.keys(p1)) {
        pk++;
        if (p1[k] === p2[k]) eq++;
        else {
          const a = p1[k].split(' '), b = String(p2[k] || '').split(' ');
          unequal.push(`${f.name} ${k}: ${a.find((x, i) => x !== b[i]) || '(entry count)'}`);
        }
      }
      if (Object.keys(p2).length !== Object.keys(p1).length) unequal.push(`${f.name}: ${Object.keys(p2).length} / ${Object.keys(p1).length} packages`);
    }
  } finally {
    await c1.close();
  }
  check(eq === pk && pk === n * 18 && !unequal.length, `wave5c constraint 64: 1.0's Word, manuscript (8 settings), ACX (6) and box-set (3 presets) packages equal 2.0's part by part: ${eq} of ${pk} packages, ${n} fixtures${unequal.length ? ' — ' + unequal.slice(0, 4).join('; ') : ''}`);
}

/** Unzip in the page (1.0's JSZip there): every entry's text (a picture's base64; a .docx inside, its own entries). */
const W5C_UNZIP = async ([b64]) => {
  const read = async (data, opt) => {
    const z = await window.JSZip.loadAsync(data, opt);
    const out = {};
    for (const [p, f] of Object.entries(z.files)) {
      if (f.dir) continue;
      if (/\.docx$/.test(p)) out[p] = await read(await f.async('uint8array'));
      else out[p] = /\.(png|jpe?g|gif|webp|ttf|otf|woff2?)$/i.test(p) ? 'b64:' + (await f.async('base64')) : await f.async('string');
    }
    return out;
  };
  return read(b64, { base64: true });
};
/** A Word package's parts walked (studio/test/docx-safe.test.ts's rules, in the page's DOMParser). */
const W5C_DOCX_HAZARDS = ([parts, where]) => {
  const EMBEDS = new Set(['object', 'pict', 'imagedata', 'altchunk', 'attachedtemplate', 'frame', 'subdoc', 'control', 'oleobject', 'embed', 'fldsimple', 'shape', 'binarydata']);
  const out = [];
  for (const [p, text] of Object.entries(parts)) {
    if (typeof text !== 'string') continue;
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      out.push(where + ' ' + p + ': not well-formed');
      continue;
    }
    for (const el of doc.getElementsByTagName('*')) {
      const name = el.localName.toLowerCase();
      if (EMBEDS.has(name)) out.push(where + ' ' + p + ': <' + el.tagName + '>');
      if (name === 'instrtext' && (el.textContent || '').trim() !== 'PAGE') out.push(where + ' ' + p + ': field ' + (el.textContent || '').trim().slice(0, 30));
      if (name === 'relationship') {
        const ext = el.getAttribute('TargetMode') === 'External', tg = el.getAttribute('Target') || '';
        if (ext && !(/\/hyperlink$/.test(el.getAttribute('Type') || '') && /^(https?:\/\/|mailto:)/i.test(tg))) out.push(where + ' ' + p + ': external ' + tg.slice(0, 40));
        if (!ext && /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(tg)) out.push(where + ' ' + p + ': unmarked ' + tg.slice(0, 40));
      }
      for (const a of el.attributes) if (/^\s*(?:javascript|vbscript)\s*:/i.test(a.value)) out.push(where + ' ' + p + ': ' + a.name + ' javascript:');
    }
  }
  return out;
};
async function w5cDownloadAll(page, app, vols) {
  const got = {};
  await w5aOpenModal(page, '#btnExport');
  got.docx = await w5aDownload(page, '#btnDownloadDocx');
  await page.setInputFiles('#boxSetFileInput', vols);
  await page.waitForFunction((n) => document.querySelectorAll('#boxSetList .bs-row').length === n, vols.length + 1, { timeout: 30_000 });
  got.volIds = await page.evaluate((two) => (two ? window.beukExport.run((a, c) => c.getState().boxSetVolumes.map((v) => v.id)) : state.boxSetVolumes.map((v) => v.id)), app === 'two'); // eslint-disable-line no-undef
  got.boxset = await w5aDownload(page, '#btnBuildBoxSet');
  await page.click('#btnMsOpen');
  await page.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
  got.ms = await w5aDownload(page, '#btnMsDownload');
  await page.click('#btnMsClose');
  await w5aOpenModal(page, '#btnExport');
  await page.click('#btnAcxOpen');
  await page.waitForFunction(() => document.getElementById('modalAcx').classList.contains('open'));
  got.acx = await w5aDownload(page, '#btnAcxDownload');
  await page.click('#btnAcxClose');
  return got;
}
async function wave5cDownloads(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const vols = ['real/reads-you', 'real/four-kitchens-book-one'].map((n) => fixtures.find((x) => x.name === n).file);
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const two = await w5aOpen(ctx, origin, f.file);
    const start = (await exportBackup(two)).json.book;
    const g2 = await w5cDownloadAll(two, 'two', vols);
    const one = await openOne(ctx, origin);
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(f.book, start)); // eslint-disable-line no-undef
    await one.waitForFunction(() => !!window.JSZip);
    const g1 = await w5cDownloadAll(one, 'one', vols);
    // the fields 1.0 itself makes vary per build, shown varying in 1.0: dcterms:modified (a second apart) and a
    // volume's id (two Add a Book of the same file)
    const vary = await one.evaluate(async (b) => {
      /* global boxSetFiles, bookDocToVolume */
      const opf = () => boxSetFiles().find((x) => x.path === 'OEBPS/package.opf').content.match(/<meta property="dcterms:modified">([^<]*)</)[1];
      const m1 = opf();
      await new Promise((r) => setTimeout(r, 1100));
      return { modified: [m1, opf()], ids: [bookDocToVolume(b, 'a.json').id, bookDocToVolume(b, 'a.json').id] };
    }, fixtures.find((x) => x.name === 'real/reads-you').book);
    check(vary.modified[0] !== vary.modified[1] && vary.ids[0] !== vary.ids[1], `wave5c constraint 64: the two masked fields vary in 1.0 itself: dcterms:modified ${vary.modified.join(' → ')}; a volume's id ${vary.ids.join(' / ')}`);
    const norm = async (g, d, key) => {
      const m = await two.evaluate(W5C_UNZIP, [d.bytes.toString('base64')]);
      if (key !== 'boxset') return m;
      const out = {};
      for (let [k, v] of Object.entries(m)) {
        g.volIds.forEach((id, i) => {
          k = k.split(id).join('VOL' + i);
          v = String(v).split(id).join('VOL' + i);
        });
        if (k === 'OEBPS/package.opf') v = v.replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '');
        out[k] = v;
      }
      return out;
    };
    for (const key of ['docx', 'boxset', 'ms', 'acx']) {
      const a = await norm(g1, g1[key], key), b = await norm(g2, g2[key], key);
      const ka = Object.keys(a), kb = Object.keys(b);
      const diff = ka.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      check(g1[key].name === g2[key].name && ka.join() === kb.join() && !diff.length, `wave5c constraint 64/69: the ${key} download is 1.0's — ${g2[key].name} (1.0: ${g1[key].name}), ${kb.length} entries in 1.0's order, every entry equal${key === 'boxset' ? ' (volume ids and dcterms:modified masked)' : ''}${diff.length ? ' — differs: ' + diff.slice(0, 3).join(', ') : ''}`);
    }
    const out = (await exportBackup(two)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start), 'wave5c constraint 68: after the four downloads (and two volumes added), the book exports exactly as before');
    await harvestCsp(two);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

async function wave5cHostile(origin) {
  const base = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const hostile = w5aHostileBook(base.book);
  const file = w4File('w5c-hostile.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile }));
  const volFile = w4File('w5c-hostile-volume.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: w5aHostileBook(fixtures.find((x) => x.name === 'real/reads-you').book) }));
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const page = await w5aOpen(ctx, origin, file);
    const foreign = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) foreign.push(u);
    });
    const start = (await exportBackup(page)).json.book;
    await w5aOpenModal(page);
    await page.click('#btnMsOpen');
    await page.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
    await page.fill('#msLegal', '<img src=x onerror="window.__pw=51">');
    const domHaz = (sel) => page.evaluate((s) => [...document.querySelectorAll(s + ' *')].flatMap((el) => [
      ...(/^(SCRIPT|IFRAME|OBJECT|EMBED|STYLE|LINK|BASE|FORM)$/.test(el.tagName) ? [el.tagName] : []),
      ...[...el.attributes].filter((a) => /^on/i.test(a.name) || /javascript:/i.test(a.value) || (/^(src|href|srcset)$/i.test(a.name) && /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(a.value))).map((a) => el.tagName + ' ' + a.name)]), sel);
    const msDom = await domHaz('#modalManuscript');
    await page.fill('#msLegal', '');
    await page.click('#btnMsClose');
    await w5aOpenModal(page);
    await page.click('#btnAcxOpen');
    await page.waitForFunction(() => document.getElementById('modalAcx').classList.contains('open'));
    const acxDom = await domHaz('#modalAcx');
    await page.click('#btnAcxClose');
    const g = await w5cDownloadAll(page, 'two', [volFile, fixtures.find((x) => x.name === 'real/reads-you').file]);
    const haz = [];
    for (const key of ['docx', 'ms']) haz.push(...(await page.evaluate(W5C_DOCX_HAZARDS, [await page.evaluate(W5C_UNZIP, [g[key].bytes.toString('base64')]), key])));
    const acx = await page.evaluate(W5C_UNZIP, [g.acx.bytes.toString('base64')]);
    for (const [k, v] of Object.entries(acx)) {
      if (typeof v === 'object') haz.push(...(await page.evaluate(W5C_DOCX_HAZARDS, [v, 'acx ' + k])));
      else if (!/\.txt$/.test(k)) haz.push('acx: ' + k + ' is not a text file');
    }
    const box = await page.evaluate(W5C_UNZIP, [g.boxset.bytes.toString('base64')]);
    const docs = Object.fromEntries(Object.entries(box).filter(([k, v]) => !String(v).startsWith('b64:') && k !== 'mimetype'));
    haz.push(...(await page.evaluate(W5A_HAZARDS, [docs])));
    check(!msDom.length && !acxDom.length, `wave5c constraint 67: the hostile book's manuscript and ACX dialogs (a hostile contact field typed): no script, handler, remote source or javascript: address (${[...msDom, ...acxDom].slice(0, 3).join('; ') || 'none'})`);
    check(!haz.length, `wave5c constraint 67: the hostile book's Word document, manuscript, ACX zip (${Object.keys(acx).length} entries) and the box set with a hostile volume (${Object.keys(box).length} entries), every part parsed and walked: nothing that fetches, runs or leaves the package (${haz.slice(0, 4).join('; ') || 'none'})`);
    check((await page.evaluate(() => window.__pw ?? null)) === null && foreign.length === 0, `wave5c constraint 67: nothing ran, and no request left the page (${foreign.slice(0, 3).join(', ') || 'none'})`);
    const out = (await exportBackup(page)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(hostile, out)), 'wave5c constraint 68: the hostile book exports exactly as readBook reads it (after the dialogs, the four downloads and the volumes)');
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/** Wave 5c (constraint 68): Word, the box set, the manuscript and the ACX script browsed without exporting — a volume
 *  added and removed, the manuscript's paper and a contact field changed and put back, the ACX readiness checks drawn,
 *  its format changed and put back, Listen pressed when the browser can speak — every dialog closed. Shared with
 *  readOnlyRooms (the 23-fixture gate). */
async function msAcxBoxBrowse(page) {
  await w5aOpenModal(page);
  await page.setInputFiles('#boxSetFileInput', fixtures.find((x) => x.name === 'real/reads-you').file);
  await page.waitForFunction(() => document.querySelectorAll('#boxSetList [data-bsremove]').length === 1, null, { timeout: 30_000 });
  await page.click('#boxSetList [data-bsremove]');
  await page.waitForFunction(() => document.querySelectorAll('#boxSetList [data-bsremove]').length === 0);
  await page.click('#btnMsOpen');
  await page.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
  const paper = await page.$eval('#msPaper', (x) => x.value);
  await page.selectOption('#msPaper', paper === 'a4' ? 'letter' : 'a4');
  await page.selectOption('#msPaper', paper);
  const legal = await page.$eval('#msLegal', (x) => x.value);
  await page.fill('#msLegal', legal + ' Zq');
  await page.$eval('#msLegal', (x) => x.dispatchEvent(new Event('change', { bubbles: true })));
  await page.fill('#msLegal', legal);
  await page.$eval('#msLegal', (x) => x.dispatchEvent(new Event('change', { bubbles: true })));
  await page.click('#btnMsClose');
  await w5aOpenModal(page);
  await page.click('#btnAcxOpen');
  await page.waitForFunction(() => document.getElementById('modalAcx').classList.contains('open') && !!document.getElementById('acxWarnings'));
  const fmt = await page.$eval('#acxFormat', (x) => x.value);
  await page.selectOption('#acxFormat', fmt === 'txt' ? 'docx' : 'txt');
  await page.selectOption('#acxFormat', fmt);
  const listen = await page.$('[data-acxlisten]:not([disabled])');
  if (listen) await listen.click();
  const nrows = await page.$$eval('#acxFiles tbody tr', (r) => r.length);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('modalAcx').classList.contains('open'), null, { timeout: 10_000 });
  return `Word / box set / manuscript / ACX (a volume added and removed; paper and a contact field changed and put back; the ACX checks drawn: ${nrows} files${listen ? ', Listen pressed' : ''}; its format changed and put back)`;
}
async function wave5cGate(origin) {
  for (const name of ['real/lantern-coast-print', 'real/dartagnan-01-three-musketeers']) {
    const f = fixtures.find((x) => x.name === name);
    const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
    try {
      const page = await w5aOpen(ctx, origin, f.file);
      const before = (await exportBackup(page)).json.book;
      const done = await msAcxBoxBrowse(page);
      // a box set of three fixtures, built (and downloaded): never an edit
      await w5aOpenModal(page);
      const three = ['real/reads-you', 'real/four-kitchens-book-one', 'real/salt-road-book-one'].map((n) => fixtures.find((x) => x.name === n).file);
      await page.setInputFiles('#boxSetFileInput', three);
      await page.waitForFunction(() => document.querySelectorAll('#boxSetList .bs-row').length === 4, null, { timeout: 30_000 });
      const d = await w5aDownload(page, '#btnBuildBoxSet');
      await page.click('#btnCloseExport');
      const after = (await exportBackup(page)).json.book;
      check(JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(expected(f.book, after)), `wave5c constraint 68: ${name}: ${done}; a box set of three fixtures built (${d.name}, ${d.bytes.length} bytes) — the export is unchanged`);
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /acx|manuscript|boxset|docx/i.test(k)));
      check(keys.length === 0, `wave5c constraint 68: no per-device key is written (1.0 keeps none: ${keys.join(', ') || 'none'})`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  // a setting left changed is an edit, in 1.0's shape, and 1.0 reads it back
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const page = await w5aOpen(ctx, origin, f.file);
    await w5aOpenModal(page);
    await page.click('#btnMsOpen');
    await page.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
    await page.selectOption('#msPaper', 'a4');
    await page.fill('#msByline', 'R. North');
    await page.$eval('#msByline', (x) => x.dispatchEvent(new Event('change', { bubbles: true })));
    await page.click('#btnMsClose');
    await w5aOpenModal(page);
    await page.click('#btnAcxOpen');
    await page.waitForFunction(() => document.getElementById('modalAcx').classList.contains('open'));
    await page.fill('#acxNarrator', 'Rae North');
    await page.$eval('#acxNarrator', (x) => x.dispatchEvent(new Event('change', { bubbles: true })));
    await page.click('#btnAcxClose');
    const out = (await exportBackup(page)).json.book;
    const w = expected(f.book, out);
    check(out.manuscript.paper === 'a4' && out.manuscript.byline === 'R. North' && out.audio.narrator === 'Rae North' && Object.keys(out).join() === Object.keys(w).join(), `wave5c constraint 65: the paper, a pen name and the narrator left changed are 1.0's manuscript / audio in their places (${out.manuscript.paper}, ${out.manuscript.byline}, ${out.audio.narrator})`);
    const file = w4File('w5c-changed.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: out }));
    const one = await openOne(ctx, origin);
    await one.setInputFiles('#localBackupInput', file);
    await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
    const back = await one.evaluate(() => [state.manuscript.paper, state.manuscript.byline, state.audio.narrator]); // eslint-disable-line no-undef
    check(JSON.stringify(back) === JSON.stringify(['a4', 'R. North', 'Rae North']), `wave5c constraint 65: 1.0 reads back what 2.0 wrote (${JSON.stringify(back)})`);
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

async function wave5cScreens(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const vols = ['real/reads-you', 'real/four-kitchens-book-one'].map((n) => fixtures.find((x) => x.name === n).file);
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const prep = (ctx) => ctx.addInitScript(([th, l]) => {
        try {
          localStorage.setItem('beuk.theme.v1', th);
          if (l) localStorage.setItem('beuk.uiLang.v1', l);
        } catch {
          /* no storage */
        }
      }, [run.theme, run.lang]);
      const c1 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      const c2 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      await prep(c1);
      await prep(c2);
      try {
        const one = await watch(await c1.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        await one.setInputFiles('#localBackupInput', f.file);
        await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
        await one.addStyleTag({ content: ONE_HIDE });
        const two = await w5aOpen(c2, origin, f.file);
        for (const p of [one, two]) {
          await w5aOpenModal(p, '#btnExport');
          await p.setInputFiles('#boxSetFileInput', vols);
          await p.waitForFunction(() => document.querySelectorAll('#boxSetList .bs-row').length === 3, null, { timeout: 30_000 });
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800); // toasts gone (wave 5d: the store-ready entry is shown in both, as 1.0 has it)
        }
        const secOf = (p, id) => p.locator('#' + id).locator('xpath=ancestor::div[contains(@class,"fmt-sec")]');
        for (const id of ['btnDownloadDocx', 'btnMsOpen', 'btnAcxOpen', 'boxSetList']) {
          const la = secOf(one, id), lb = secOf(two, id);
          await la.scrollIntoViewIfNeeded();
          await lb.scrollIntoViewIfNeeded();
          const [sa, sb] = [await la.screenshot(), await lb.screenshot()];
          writeFileSync(path.join(OUT, `w5c-sec-${id}-${tag}-one.png`), sa);
          writeFileSync(path.join(OUT, `w5c-sec-${id}-${tag}-two.png`), sb);
          const d = await pixelDiff(diffPage, sa, sb);
          check(d.ratio <= PIXEL_TOLERANCE, `wave5c screenshots ${tag}: the section of #${id} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        }
        for (const [opener, modal] of [['#btnMsOpen', 'modalManuscript'], ['#btnAcxOpen', 'modalAcx']]) {
          for (const p of [one, two]) {
            if (!(await p.evaluate(() => document.getElementById('modalExport').classList.contains('open')))) await w5aOpenModal(p, '#btnExport');
            await p.click(opener);
            await p.waitForFunction((m) => document.getElementById(m).classList.contains('open'), modal);
            await p.evaluate(() => document.fonts.ready);
            await p.waitForTimeout(500);
          }
          const [ma, mb] = [await one.locator('#' + modal + ' .modal').screenshot(), await two.locator('#' + modal + ' .modal').screenshot()];
          writeFileSync(path.join(OUT, `w5c-dlg-${modal}-${tag}-one.png`), ma);
          writeFileSync(path.join(OUT, `w5c-dlg-${modal}-${tag}-two.png`), mb);
          const d = await pixelDiff(diffPage, ma, mb);
          check(d.ratio <= PIXEL_TOLERANCE, `wave5c screenshots ${tag}: #${modal} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
          writeFileSync(path.join(OUT, `w5c-two-${modal}-${tag}.png`), await two.screenshot());
          writeFileSync(path.join(OUT, `w5c-one-${modal}-${tag}.png`), await one.screenshot());
          for (const p of [one, two]) await p.click(modal === 'modalAcx' ? '#btnAcxClose' : '#btnMsClose');
        }
        await harvestCsp(one);
        await harvestCsp(two);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function wave5cChecks(origin) {
  const only = (process.env.W5C_PARTS || 'parity,downloads,hostile,gate,screens,latency').split(',');
  if (only.includes('parity')) await wave5cParity(origin);
  if (only.includes('downloads')) await wave5cDownloads(origin);
  if (only.includes('hostile')) await wave5cHostile(origin);
  if (only.includes('gate')) await wave5cGate(origin);
  if (only.includes('screens')) await wave5cScreens(origin);
  // constraint 70: the editor's typing with these dialogs mounted and closed (#5's measure, and the redraws between keys)
  if (only.includes('latency') && !(process.env.E2E_ONLY || '').split(',').includes('latency')) {
    const r = await latency(origin);
    note(`wave5c latency (the Word, box-set, manuscript and ACX dialogs mounted, closed): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
    check(r.p95 < LATENCY_P95_TARGET_MS, `wave5c constraint 70: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas with these dialogs closed (${r.p95.toFixed(1)} ms)`);
    const r2 = await latency(origin, { delay: 200, count: 60, quick: true });
    note(`wave5c latency with the preview redrawing between keys (200 ms): p50 ${r2.p50.toFixed(1)} ms, p95 ${r2.p95.toFixed(1)} ms, max ${r2.max.toFixed(1)} ms over ${r2.n} keystrokes`);
    check(r2.p95 < LATENCY_P95_TARGET_MS, `wave5c constraint 70: p95 under ${LATENCY_P95_TARGET_MS} ms while the preview redraws between keys (${r2.p95.toFixed(1)} ms)`);
  }
}

/* ---- wave 5d (inventory F10): the store-ready check ----
   1.0's own audit (STORE_RULES, storeAudit) in 1.0's page (applyBookDoc of readBook's book) and in 2.0's (the export
   session): every fixture × store × binding × paper × the print settings that change the verdict — each audit's rows,
   verdict and facts line, and at the book's own settings the report's bytes (the audit's time fixed in both pages:
   a.at, the one field 1.0 varies, shown varying in 1.0 itself). The real buttons beside 1.0's (Download report); a hostile
   book's live modal and report; the modal browsed in the no-edit gate; the shelf-gated server panel — offline, signed
   out, signed in — with 1.0's own words and no request to /api/exports or /api/jobs; the latency line; screenshots. */
const W5D_EN = JSON.parse(readFileSync(path.join(STUDIO, 'src', 'generated', 'packs', 'en.json'), 'utf8'));
const w5dT = (k, p = {}) => String(W5D_EN[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (n in p ? String(p[n]) : m));
const W5D_SETTINGS = [{}, { printTrim: '8x8' }, { printTrim: '8.5x11' }, { printTrim: '5x8' }, { printLargePrint: true, printPictureBook: false }, { printBleed: true },
  { printMarginMode: 'custom', printCustomMargins: { inside: 0.2, outside: 0.2, top: 0.2, bottom: 0.2 } }];
const W5D_AT = Date.UTC(2026, 0, 1, 12, 0, 0);
/** The faces the wrap's read-back measures with, loaded, and its pictures decoded (1.0 measures the spine's text on a
 *  canvas, which uses a face only once the page has it: the same in both pages before they are compared). */
const W5D_WARM = async ([two]) => {
  /* global state, fontStack, ensureWrapIcons, ensureCoverBgImage */
  const st = two ? window.beukExport.run((a, c) => c.getState()) : state;
  const fs = (n) => (two ? window.beukExport.run((a) => a.fontStack(n)) : fontStack(n));
  const r = st.coverRecipe;
  const names = new Set([st.theme && st.theme.headFont, st.theme && st.theme.bodyFont, ...(r ? Object.values(r.elements || {}).map((e) => e && e.font) : []),
    r && r.wrap && r.wrap.spine && r.wrap.spine.font, r && r.wrap && r.wrap.back && r.wrap.back.font].filter(Boolean));
  const loads = [];
  for (const n of names) for (const w of ['600', '700', 'italic 500', '400']) loads.push(document.fonts.load(w + ' 20px ' + fs(n)).catch(() => null));
  await Promise.all(loads);
  if (r) await (two ? window.beukExport.run((a) => Promise.all([a.ensureWrapIcons(r), a.ensureCoverBgImage(r)])) : Promise.all([ensureWrapIcons(r), ensureCoverBgImage(r)]));
  await document.fonts.ready;
  return names.size;
};
/** Every store × binding × paper × setting: the audit as data (its time fixed), its facts line and verdict text, and at
 *  the book's own settings (the first) the report's bytes. In 1.0's page on its globals, in 2.0's in the export session
 *  (the settings put back before the call ends, so nothing is written). */
const W5D_AUDITS = ([two, SETTINGS, AT]) => {
  /* global STORE_RULES, storeAudit, storeFactsLine, storeVerdictText, buildStoreReportHtml */
  const go = (api, st) => {
    const out = [];
    const keep0 = JSON.stringify(st.storeCheck);
    for (const [i, set] of SETTINGS.entries()) {
      const keep = JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(set).map((k) => [k, st[k]]))));
      Object.assign(st, JSON.parse(JSON.stringify(set)));
      try {
        for (const store of ['kdp', 'ingramspark'])
          for (const binding of ['paperback', 'hardcover'])
            for (const ink of api.STORE_RULES[store].inks) {
              const a = api.storeAudit({ store, binding, ink: ink.id });
              a.at = new Date(AT);
              const { rules, at, ...rest } = a; // eslint-disable-line no-unused-vars
              out.push(JSON.stringify({ ...rest, rules: rules.id }) + '\n' + api.storeFactsLine(a) + '\n' + api.storeVerdictText(a) + (i === 0 ? '\n' + api.buildStoreReportHtml(a) : ''));
            }
      } finally {
        Object.assign(st, keep);
      }
    }
    st.storeCheck = JSON.parse(keep0);
    return out;
  };
  if (two) return window.beukExport.run((api, c) => go(api, c.getState()));
  return go({ STORE_RULES, storeAudit, storeFactsLine, storeVerdictText, buildStoreReportHtml }, state);
};
async function wave5dParity(origin) {
  const c1 = await newContext({ serviceWorkers: 'block' });
  let n = 0, total = 0, eq = 0, reports = 0;
  const unequal = [];
  const verdicts = {};
  try {
    for (const f of fixtures) {
      if (!Array.isArray(f.book.sections)) continue;
      n++;
      const c2 = await newContext({ serviceWorkers: 'block' });
      let a2, id, faces;
      try {
        const two = await w5aOpen(c2, origin, f.file);
        const before = (await exportBackup(two)).json.book;
        id = before.meta.bookId;
        faces = await two.evaluate(W5D_WARM, [true]);
        a2 = await two.evaluate(W5D_AUDITS, [true, W5D_SETTINGS, W5D_AT]);
        const after = (await exportBackup(two)).json.book;
        if (JSON.stringify(after) !== JSON.stringify(before)) unequal.push(`${f.name}: the audits wrote to the book`);
        await harvestCsp(two);
      } finally {
        await c2.close();
      }
      const one = await openOne(c1, origin);
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(f.book, { meta: { bookId: id } })); // eslint-disable-line no-undef
      await one.evaluate(W5D_WARM, [false]);
      const a1 = await one.evaluate(W5D_AUDITS, [false, W5D_SETTINGS, W5D_AT]);
      await harvestCsp(one);
      await one.close();
      if (a1.length !== a2.length) unequal.push(`${f.name}: ${a2.length} / ${a1.length} audits`);
      for (let i = 0; i < a1.length; i++) {
        total++;
        if (i < 24) reports++;
        if (a1[i] === a2[i]) eq++;
        else {
          const x = a1[i].split('\n'), y = String(a2[i] || '').split('\n');
          const at = x.findIndex((l, k) => l !== y[k]);
          const lx = x[at] || '', ly = y[at] || '';
          const ch = [...lx].findIndex((c, k) => c !== ly[k]);
          unequal.push(`${f.name} #${i} line ${at}: 1.0 …${lx.slice(Math.max(0, ch - 60), ch + 60)}… / 2.0 …${ly.slice(Math.max(0, ch - 60), ch + 60)}…`);
        }
      }
      const own = JSON.parse(a1[0].split('\n')[0]);
      verdicts[f.name] = own.verdict + ' (' + own.blocking + ' blocking, ' + own.unrun + ' unchecked; ' + faces + ' faces)';
    }
  } finally {
    await c1.close();
  }
  note('wave5d: each fixture\'s own audit (KDP, paperback, white) in 1.0: ' + Object.entries(verdicts).map(([k, v]) => k + ' ' + v).join('; '));
  check(eq === total && total === n * W5D_SETTINGS.length * 24 && !unequal.length, `wave5d constraint 71: 1.0's storeAudit equals 2.0's — rows, verdict, facts line and verdict text — for every fixture × store × binding × paper × ${W5D_SETTINGS.length} print settings: ${eq} of ${total} audits, ${n} fixtures; the report's bytes (the audit's time fixed) among them, ${reports} reports${unequal.length ? ' — ' + unequal.slice(0, 3).join('; ') : ''}`);
}

const W5D_ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
async function w5dOpenStore(page) {
  if (!(await page.evaluate(() => document.getElementById('modalExport')?.classList.contains('open')))) await w5aOpenModal(page, '#btnExport');
  await page.click('#btnStoreReady');
  await page.waitForFunction(() => document.getElementById('modalStore')?.classList.contains('open') && !!document.getElementById('storeVerdict'), null, { timeout: 30_000 });
}
async function wave5dDownloads(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const two = await w5aOpen(ctx, origin, f.file);
    const start = (await exportBackup(two)).json.book;
    await w5dOpenStore(two);
    const d2 = await w5aDownload(two, '#btnStoreDownload');
    const one = await openOne(ctx, origin);
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(f.book, start)); // eslint-disable-line no-undef
    await w5dOpenStore(one);
    const d1 = await w5aDownload(one, '#btnStoreDownload');
    // the field 1.0 varies, shown varying in 1.0 itself: the audit's time (a.at — the report's stamp)
    const vary = await one.evaluate(async () => {
      /* global storeAudit, buildStoreReportHtml */
      const x = storeAudit();
      await new Promise((r) => setTimeout(r, 15));
      const y = storeAudit();
      const hx = buildStoreReportHtml(x), hy = buildStoreReportHtml(y);
      const mask = (h) => h.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'AT');
      return { at: [x.at.toISOString(), y.at.toISOString()], differ: hx !== hy, maskedSame: mask(hx) === mask(hy) };
    });
    check(vary.at[0] !== vary.at[1] && vary.differ && vary.maskedSame, `wave5d constraint 71: the one field 1.0 varies, in 1.0 itself — the audit's time (report stamp ${vary.at.join(' → ')}): two reports of one book differ only there`);
    const t1 = d1.bytes.toString('utf8'), t2 = d2.bytes.toString('utf8');
    const m1 = t1.replace(W5D_ISO, 'AT'), m2 = t2.replace(W5D_ISO, 'AT');
    await two.click('#btnCloseStore');
    await two.click('#btnCloseExport');
    check(d1.name === d2.name && m1 === m2 && t1.length === t2.length, `wave5d constraint 71: Download report is 1.0's file — ${d2.name} (1.0: ${d1.name}), ${d2.bytes.length} bytes (1.0: ${d1.bytes.length}), equal byte for byte but the audit's time${m1 === m2 ? '' : ' — differs at ' + [...m1].findIndex((c, i) => c !== m2[i])}`);
    const out = (await exportBackup(two)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start), 'wave5d constraint 73: after the check opened and its report downloaded, the book exports exactly as before');
    await harvestCsp(two);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

const W5D_DOM_HAZ = (sel) => [...document.querySelectorAll(sel + ' *')].flatMap((el) => [
  ...(/^(SCRIPT|IFRAME|OBJECT|EMBED|STYLE|LINK|BASE|FORM)$/.test(el.tagName) ? [el.tagName] : []),
  ...[...el.attributes].filter((a) => /^on/i.test(a.name) || /javascript:/i.test(a.value) || (/^(src|href|srcset)$/i.test(a.name) && /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(a.value))).map((a) => el.tagName + ' ' + a.name)]);
async function wave5dHostile(origin) {
  const base = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const hostile = w5aHostileBook(base.book);
  const file = w4File('w5d-hostile.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile }));
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const page = await w5aOpen(ctx, origin, file);
    const foreign = [];
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) foreign.push(u);
    });
    const start = (await exportBackup(page)).json.book;
    await w5dOpenStore(page);
    const dom = [];
    for (const [s, b] of [['ingramspark', 'paperback'], ['ingramspark', 'hardcover'], ['kdp', 'hardcover'], ['kdp', 'paperback']]) {
      await page.selectOption('#storeSel', s);
      await page.selectOption('#storeBinding', b);
      dom.push(...(await page.evaluate(W5D_DOM_HAZ, '#modalStore')));
    }
    const rows = await page.$$eval('#storeReport .st-row', (r) => r.length);
    const d = await w5aDownload(page, '#btnStoreDownload');
    const haz = await page.evaluate(W5A_HAZARDS, [{ [d.name]: d.bytes.toString('utf8') }]);
    const shown = d.bytes.toString('utf8').includes('window.__pw=1');
    check(!dom.length, `wave5d constraint 74: the hostile book's live store modal (both stores, both bindings, ${rows} rows): no script, handler, remote source or javascript: address (${dom.slice(0, 3).join('; ') || 'none'})`);
    check(!haz.length && shown, `wave5d constraint 74: the hostile book's downloaded report (${d.bytes.length} bytes), parsed and walked: nothing that fetches or runs (${haz.slice(0, 3).join('; ') || 'none'}); its hostile title is there as text (${shown})`);
    check((await page.evaluate(() => window.__pw ?? null)) === null && foreign.length === 0, `wave5d constraint 74: nothing ran, and no request left the page (${foreign.slice(0, 3).join(', ') || 'none'})`);
    await page.click('#btnCloseStore');
    await page.click('#btnCloseExport');
    const out = (await exportBackup(page)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start) && JSON.stringify(out) === JSON.stringify(expected(hostile, out)), 'wave5d constraint 73: the hostile book exports exactly as readBook reads it (after the stores and bindings switched and back, and the report)');
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/** Wave 5d (constraint 73): the store-ready check browsed without an edit — opened from the export modal, every store,
 *  binding and paper chosen and the book's own put back, Check again, the report downloaded, closed by Escape and
 *  reopened, closed by 1.0's Close. Shared with readOnlyRooms (the 23-fixture gate). */
async function storeBrowse(page) {
  await w5dOpenStore(page);
  const own = await page.evaluate(() => window.beukExport.run((a, c) => JSON.parse(JSON.stringify(c.getState().storeCheck))));
  const papers = {};
  for (const s of ['ingramspark', 'kdp']) {
    await page.selectOption('#storeSel', s);
    for (const b of ['hardcover', 'paperback']) await page.selectOption('#storeBinding', b);
    const inks = await page.$$eval('#storeInk option', (o) => o.map((x) => x.value));
    for (const i of inks) await page.selectOption('#storeInk', i);
    papers[s] = inks.length;
  }
  // the book's own choice again (choosing a store resets the paper and the attestation, as 1.0's listener does)
  await page.selectOption('#storeSel', own.store);
  await page.selectOption('#storeBinding', own.binding);
  if (own.ink) await page.selectOption('#storeInk', own.ink);
  await page.click('#btnStoreRecheck');
  const dl = page.waitForEvent('download', { timeout: 30_000 }).then((d) => d.suggestedFilename(), () => '');
  await page.click('#btnStoreDownload');
  const name = await dl;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('modalStore').classList.contains('open') && document.getElementById('modalExport').classList.contains('open'), null, { timeout: 10_000 });
  await page.click('#btnStoreReady');
  await page.waitForFunction(() => document.getElementById('modalStore').classList.contains('open'), null, { timeout: 10_000 });
  const verdict = await page.$eval('#storeVerdict', (v) => v.getAttribute('data-verdict'));
  await page.click('#btnCloseStore');
  await page.click('#btnCloseExport');
  return `the store-ready check (KDP ${papers.kdp} and IngramSpark ${papers.ingramspark} papers, both bindings, the book's own again, Check again, the report${name ? ' ' + name : ''}; verdict ${verdict})`;
}
async function wave5dGate(origin) {
  for (const name of ['real/lantern-coast-print', 'real/dartagnan-01-three-musketeers']) {
    const f = fixtures.find((x) => x.name === name);
    const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
    try {
      const page = await w5aOpen(ctx, origin, f.file);
      const before = (await exportBackup(page)).json.book;
      const done = await storeBrowse(page);
      const after = (await exportBackup(page)).json.book;
      check(JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(expected(f.book, after)), `wave5d constraint 73: ${name}: ${done} — the export is unchanged`);
      const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /store/i.test(k)));
      check(keys.length === 0, `wave5d constraint 73: no per-device key is written (1.0 keeps none: ${keys.join(', ') || 'none'})`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
  // the actions are edits, in 1.0's shape, and 1.0 reads them back: a trim fix (an 8 × 8 in book, KDP), the wrap's
  // fixes and a paper chosen
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const book = JSON.parse(JSON.stringify(f.book));
  book.printTrim = '8x8';
  const file = w4File('w5d-8x8.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book }));
  const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  try {
    const page = await w5aOpen(ctx, origin, file);
    await w5dOpenStore(page);
    const trimLabel = await page.$eval('#storeReport [data-st-act="trim"]', (b) => b.textContent);
    await page.click('#storeReport [data-st-act="trim"]');
    await page.waitForFunction(() => document.querySelector('#storeReport [data-st-id="trim"]')?.getAttribute('data-st-status') === 'pass', null, { timeout: 10_000 });
    const acts = [];
    for (const id of ['spine', 'wpages', 'wtrim']) {
      const b = await page.$(`#storeReport [data-st-act="${id}"]`);
      if (b) {
        acts.push(id + ': ' + (await b.textContent()));
        await b.click();
        await page.waitForTimeout(200);
      }
    }
    await page.selectOption('#storeInk', 'bw_cream');
    await page.click('#btnCloseStore');
    await page.click('#btnCloseExport');
    const out = (await exportBackup(page)).json.book;
    const w = expected(book, out);
    check(out.printTrim !== '8x8' && out.storeCheck.ink === 'bw_cream' && Object.keys(out).join() === Object.keys(w).join(), `wave5d constraint 72: the trim fix ("${trimLabel}" → ${out.printTrim}), ${acts.join('; ') || 'no wrap fix offered'} and a paper chosen are 1.0's printTrim / coverRecipe.wrap / storeCheck, in their places (wrap ${JSON.stringify({ trim: out.coverRecipe.wrap.trim, pages: out.coverRecipe.wrap.pages, paper: out.coverRecipe.wrap.paper, customFactor: out.coverRecipe.wrap.customFactor })})`);
    const back = w4File('w5d-changed.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: out }));
    const one = await openOne(ctx, origin);
    await one.setInputFiles('#localBackupInput', back);
    await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
    const read = await one.evaluate(() => JSON.stringify([state.printTrim, state.storeCheck, normalizeWrap(state.coverRecipe.wrap)])); // eslint-disable-line no-undef
    const norm = await one.evaluate((w) => JSON.stringify(normalizeWrap(w)), out.coverRecipe.wrap); // eslint-disable-line no-undef
    check(read === JSON.stringify([out.printTrim, out.storeCheck, JSON.parse(norm)]), `wave5d constraint 72: 1.0 reads back what 2.0 wrote (${read.slice(0, 200)}…)`);
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

/** The server panel in each shelf state, with 1.0's own words; no request to /api/exports or /api/jobs (constraint 75). */
async function wave5dShelf(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  for (const st of ['offline', 'signedOut', 'signedIn']) {
    const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
    const shelf = [];
    try {
      if (st !== 'offline') await w5aRoutes(ctx, { signedIn: st === 'signedIn' });
      ctx.on('request', (r) => {
        if (/\/api\/(exports|jobs)/.test(new URL(r.url()).pathname)) shelf.push(r.method() + ' ' + new URL(r.url()).pathname);
      });
      const page = await w5aOpen(ctx, origin, f.file);
      const start = (await exportBackup(page)).json.book;
      await w5dOpenStore(page);
      const look = () => page.evaluate(() => {
        const r = document.querySelector('#storeReport [data-st-id="fonts"]');
        const b = document.getElementById('btnStoreServer');
        return { ev: r?.querySelector('.st-ev')?.textContent || '', act: r?.querySelector('[data-st-act]')?.textContent || '', disabled: b.disabled, title: b.title, note: document.getElementById('storeServerNote').textContent };
      });
      let a = await look();
      let ok, said;
      if (st === 'offline') {
        ok = a.disabled && a.title === w5dT('store.nc.local') && a.ev === w5dT('store.nc.local');
        said = `"${a.ev}"; Run full server check off, its title the same`;
      } else if (st === 'signedOut') {
        ok = a.disabled && a.title === w5dT('store.nc.signin') && a.ev === w5dT('store.nc.signin') && a.act === w5dT('store.act.signin');
        said = `"${a.ev}"; its button "${a.act}"; Run full server check off`;
      } else {
        const before = a;
        await page.click('#btnStoreServer');
        await page.waitForFunction((d) => document.getElementById('storeServerNote').textContent === d, w5dT('store.serverDone'), { timeout: 30_000 });
        await page.click('#btnStoreRecheck');
        await page.waitForTimeout(300);
        a = await look();
        ok = !before.disabled && before.ev === w5dT('store.nc.notRun') && a.ev === w5dT('store.nc.failed', { error: w5dT('store.serverNeedShelf') }) && a.note === w5dT('store.serverDone');
        said = `before: "${before.ev}"; after Run full server check and Check again: "${a.ev}" (${a.note})`;
      }
      await page.click('#btnCloseStore');
      await page.click('#btnCloseExport');
      const out = (await exportBackup(page)).json.book;
      // wave 7b: signed in, 1.0 itself lists the archive when its export modal opens (initExport: renderArchiveList,
      // cloudLoadArchive: GET /api/exports) — the same steps in 1.0's own page, and 2.0's requests must equal its
      let want = [];
      if (st === 'signedIn') {
        const mine = shelf.splice(0);
        const one = await openOne(ctx, origin);
        await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
        await one.waitForFunction(() => typeof cloud !== 'undefined' && !!cloud.user, null, { timeout: 30_000 });
        await one.evaluate(() => document.getElementById('btnExport').click());
        await one.waitForFunction(() => document.getElementById('modalExport').classList.contains('open'));
        await one.click('#btnStoreReady');
        await one.waitForFunction(() => document.getElementById('modalStore')?.classList.contains('open'), null, { timeout: 30_000 });
        await one.click('#btnStoreServer');
        await one.waitForFunction((d) => document.getElementById('storeServerNote').textContent === d, w5dT('store.serverDone'), { timeout: 30_000 });
        await one.click('#btnStoreRecheck');
        await one.waitForTimeout(300);
        want = shelf.splice(0);
        shelf.push(...mine);
        // and 1.0's words in that state, beside 2.0's
        const oneSaw = await one.evaluate(() => {
          const r = document.querySelector('#storeReport [data-st-id="fonts"]');
          return { ev: r?.querySelector('.st-ev')?.textContent || '', note: document.getElementById('storeServerNote').textContent };
        });
        const same = oneSaw.ev === a.ev && oneSaw.note === a.note;
        if (!same) ok = false;
        said += same ? " — 1.0's page says the same" : ' — 1.0 says: "' + oneSaw.ev + '" (' + oneSaw.note + ')';
      }
      check(ok && JSON.stringify(shelf) === JSON.stringify(want) && JSON.stringify(out) === JSON.stringify(start), `wave5d constraint 75: ${st}: 1.0's own words — ${said}; requests to /api/exports or /api/jobs: ${shelf.length}${shelf.length ? ' (' + shelf.join(', ') + ')' : ''}${st === 'signedIn' ? ', 1.0 in its page: ' + JSON.stringify(want) : ''}; the book unchanged`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
}

async function wave5dScreens(origin) {
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const prep = (ctx) => ctx.addInitScript(([th, l]) => {
        try {
          localStorage.setItem('beuk.theme.v1', th);
          if (l) localStorage.setItem('beuk.uiLang.v1', l);
        } catch {
          /* no storage */
        }
      }, [run.theme, run.lang]);
      const c1 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      const c2 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      await prep(c1);
      await prep(c2);
      try {
        const one = await watch(await c1.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        await one.setInputFiles('#localBackupInput', f.file);
        await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
        await one.addStyleTag({ content: ONE_HIDE });
        const two = await w5aOpen(c2, origin, f.file);
        for (const p of [one, two]) {
          await w5aOpenModal(p, '#btnExport');
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800); // toasts gone
        }
        const [ea, eb] = [one.locator('#modalExport .st-entry'), two.locator('#modalExport .st-entry')];
        await ea.scrollIntoViewIfNeeded();
        await eb.scrollIntoViewIfNeeded();
        const [sa, sb] = [await ea.screenshot(), await eb.screenshot()];
        writeFileSync(path.join(OUT, `w5d-entry-${tag}-one.png`), sa);
        writeFileSync(path.join(OUT, `w5d-entry-${tag}-two.png`), sb);
        let d = await pixelDiff(diffPage, sa, sb);
        check(d.ratio <= PIXEL_TOLERANCE, `wave5d screenshots ${tag}: the export modal's Store-ready? entry differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        for (const p of [one, two]) {
          await w5dOpenStore(p);
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(500);
        }
        const [ma, mb] = [await one.locator('#modalStore .modal').screenshot(), await two.locator('#modalStore .modal').screenshot()];
        writeFileSync(path.join(OUT, `w5d-modal-${tag}-one.png`), ma);
        writeFileSync(path.join(OUT, `w5d-modal-${tag}-two.png`), mb);
        d = await pixelDiff(diffPage, ma, mb);
        check(d.ratio <= PIXEL_TOLERANCE, `wave5d screenshots ${tag}: #modalStore differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        writeFileSync(path.join(OUT, `w5d-two-modalStore-${tag}.png`), await two.screenshot());
        writeFileSync(path.join(OUT, `w5d-one-modalStore-${tag}.png`), await one.screenshot());
        await harvestCsp(one);
        await harvestCsp(two);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function wave5dChecks(origin) {
  const only = (process.env.W5D_PARTS || 'parity,downloads,hostile,gate,shelf,screens,latency').split(',');
  if (only.includes('parity')) await wave5dParity(origin);
  if (only.includes('downloads')) await wave5dDownloads(origin);
  if (only.includes('hostile')) await wave5dHostile(origin);
  if (only.includes('gate')) await wave5dGate(origin);
  if (only.includes('shelf')) await wave5dShelf(origin);
  if (only.includes('screens')) await wave5dScreens(origin);
  // constraint 76: the editor's typing with the store modal mounted and closed (#5's measure, and the redraws between keys)
  if (only.includes('latency') && !(process.env.E2E_ONLY || '').split(',').includes('latency')) {
    const r = await latency(origin);
    note(`wave5d latency (the store modal mounted, closed): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
    check(r.p95 < LATENCY_P95_TARGET_MS, `wave5d constraint 76: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas with the store modal closed (${r.p95.toFixed(1)} ms)`);
    const r2 = await latency(origin, { delay: 200, count: 60, quick: true });
    note(`wave5d latency with the preview redrawing between keys (200 ms): p50 ${r2.p50.toFixed(1)} ms, p95 ${r2.p95.toFixed(1)} ms, max ${r2.max.toFixed(1)} ms over ${r2.n} keystrokes`);
    check(r2.p95 < LATENCY_P95_TARGET_MS, `wave5d constraint 76: p95 under ${LATENCY_P95_TARGET_MS} ms while the preview redraws between keys (${r2.p95.toFixed(1)} ms)`);
  }
}

/* ---- wave 6 (G1, G2; plan 2026-11-04, constraints 77-83): the import ----
   Every corpus file imported into 1.0's /studio (1.0's own handleImportFile, its desk holding the same book) and into
   2.0's /next (1.0's Import button: #fileInput, the confirm, the book replaced whole): the books equal (1.0's
   serializeBook read as readBook reads it against 2.0's export), but for what 1.0 itself varies (maskVarying: the fresh
   ids and the times — shown varying in 1.0 itself); the refusals give 1.0's words; the confirm comes exactly when 1.0's
   does; the report's HTML equals 1.0's; each per-item undo, Undo the whole import and Dismiss give 1.0's book; a hostile
   file leaves no script, handler or request; Add a Book leaves the open book alone; the libraries load as 1.0's do. */
const W6C = await import(pathToFileURL(path.join(STUDIO, 'e2e', 'import-corpus.mjs')).href);
const W6F = await import(pathToFileURL(path.join(STUDIO, 'test', 'import-fixture.ts')).href);
// 1.0's vendored JSZip in Node (its UMD: module.exports under require), to build the corpus
const W6Z = (() => {
  const r = createRequire(import.meta.url)(path.join(REPO, 'client', 'assets', 'vendor', 'jszip.min.js'));
  return globalThis.JSZip || r;
})();
const W6_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const w6File = (name, mimeType, data) => ({ name, mimeType, buffer: Buffer.from(data) });
const w6B64 = (f) => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString('base64') });

/** 2.0's EPUB of a book (1.0's buildEpubBlob in the export session, the book opened in /next). */
async function w6EpubOf(origin, book, name) {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w5aOpen(ctx, origin, w4File(name + '.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book })));
    const b64 = await page.evaluate(async () => {
      const blob = await window.beukExport.run((api) => api.buildEpubBlob());
      const u = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    });
    await harvestCsp(page);
    return w6File(name + '.epub', 'application/epub+zip', Buffer.from(b64, 'base64'));
  } finally {
    await ctx.close();
  }
}
/** The print view's PDF of a book (1.0's buildPrintHtml in 1.0's page, printed by Chromium). */
async function w6PdfOf(origin, book, name) {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const one = await openOne(ctx, origin);
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(book)); // eslint-disable-line no-undef
    const html = await one.evaluate(() => buildPrintHtml()); // eslint-disable-line no-undef
    const pp = await ctx.newPage();
    await pp.goto(origin + '/studio');
    await pp.setContent(html, { waitUntil: 'load' });
    await pp.evaluate(() => document.fonts.ready);
    const pdf = await pp.pdf({ preferCSSPageSize: true, printBackground: true });
    await harvestCsp(one);
    return w6File(name + '.pdf', 'application/pdf', pdf);
  } finally {
    await ctx.close();
  }
}
/** An image-only PDF (scanned pages): two pages of a picture, no text layer. */
async function w6ScannedPdf() {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const pp = await ctx.newPage();
    const img = '<div style="width:100%;height:9.5in;background:#777"></div>';
    await pp.setContent(`<html><body style="margin:0">${img}<div style="break-before:page"></div>${img}</body></html>`);
    const pdf = await pp.pdf({ format: 'Letter', printBackground: true });
    return w6File('scanned.pdf', 'application/pdf', pdf);
  } finally {
    await ctx.close();
  }
}

/** The whole corpus of constraint 77 (each { name, mimeType, buffer }, a `kind` and whether 1.0 refuses it). */
async function w6Corpus(origin) {
  const out = [];
  for (const d of await W6C.docxCorpus(W6Z)) out.push({ kind: 'docx', ...w6File(d.name, W6_DOCX, d.bytes) });
  for (const t of W6F.textCorpus()) out.push({ kind: t.name.endsWith('.rtf') ? 'rtf' : 'text', ...w6File(t.name, t.type, Buffer.from(t.text, 'utf8')) });
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const epubBooks = [
    ['dumas', DUMAS.book],
    ['lantern', lan],
    ['hostile', w5aHostileBook(lan)],
    ['arabic', scriptBook(fixtures.find((x) => x.name === 'real/reads-you').book, 'ar', SCRIPT_LINES.ar)],
    ['pictures', fixtures.find((x) => x.name === 'real/lunas-beach-standalone').book],
  ];
  for (const [n, b] of epubBooks) out.push({ kind: 'epub', ...(await w6EpubOf(origin, b, 'w6-' + n)) });
  out.push({ kind: 'epub', ...w6File('plain.epub', 'application/epub+zip', await W6C.plainEpub(W6Z)) });
  out.push({ kind: 'pdf', ...(await w6PdfOf(origin, lan, 'w6-lantern')) });
  out.push({ kind: 'pdf', ...(await w6PdfOf(origin, fixtures.find((x) => x.name === 'real/salt-road-book-one').book, 'w6-salt')) });
  out.push({ kind: 'pdf', ...(await w6ScannedPdf()) });
  const md = W6F.textCorpus().filter((x) => x.name.endsWith('.md'));
  out.push({ kind: 'zip', ...w6File('one-book.zip', 'application/zip', await W6C.makeZip(W6Z, [{ name: 'book/' + md[0].name, text: md[0].text }, { name: '__MACOSX/._x', text: 'x' }])) });
  out.push({ kind: 'zip', ...w6File('two-books.zip', 'application/zip', await W6C.makeZip(W6Z, [{ name: md[0].name, text: md[0].text }, { name: md[1].name, text: md[1].text }])) });
  out.push({ kind: 'zip', ...w6File('bomb.zip', 'application/zip', await W6C.zipBomb(W6Z)) });
  const junk = Buffer.alloc(4096);
  for (let i = 0, x = 7; i < junk.length; i++) junk[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  out.push({ kind: 'refuse', ...w6File('empty.txt', 'text/plain', Buffer.alloc(0)) });
  out.push({ kind: 'refuse', ...w6File('binary.txt', 'text/plain', junk) });
  out.push({ kind: 'refuse', ...w6File('broken.docx', W6_DOCX, junk) });
  out.push({ kind: 'refuse', ...w6File('drm.epub', 'application/epub+zip', await W6C.drmEpub(W6Z)) });
  return out;
}

/** 1.0's page: its desk holds `desk` (null: 1.0's empty book), the file through 1.0's own handleImportFile. */
const W6_ONE = async ([desk, f, deskKind]) => {
  /* global applyBookDoc, buildEmptyBook, serializeBook, handleImportFile, isEmptyDesk, sampleState, deskIsUntouchedSample, applySampleBookSync */
  /* global sampleComparableJson */
  if (deskKind === 'sample') {
    // the untouched sample as 2.0's desk holds it (its own History: wave 1c's), loaded as 1.0 loads it
    applyBookDoc(JSON.parse(JSON.stringify(desk)), { keepHistory: false });
    sampleState.loaded = true;
    sampleState.loadedJson = sampleComparableJson();
  } else applyBookDoc(JSON.parse(JSON.stringify(desk || buildEmptyBook())));
  const bytes = Uint8Array.from(atob(f.b64), (ch) => ch.charCodeAt(0));
  const file = new File([bytes], f.name, { type: f.type });
  const asked = !(isEmptyDesk() || (sampleState.loaded && deskIsUntouchedSample()));
  const before = JSON.stringify(serializeBook());
  const toasts = [];
  const keep = window.toast;
  window.toast = (m) => void toasts.push(String(m));
  const t0 = performance.now();
  try {
    await handleImportFile(file, { replaceOk: true });
  } finally {
    window.toast = keep;
  }
  const ms = performance.now() - t0;
  const after = serializeBook();
  const changed = JSON.stringify(after) !== before;
  const rep = document.getElementById('irBody');
  return { asked, changed, book: changed ? JSON.parse(JSON.stringify(after)) : null, toasts, ms, report: changed && rep ? rep.innerHTML : '', sub: document.getElementById('irSub')?.textContent || '',
    summary: document.getElementById('importSummaryText')?.textContent || '' };
};
/** 2.0's page: the file chosen in 1.0's #fileInput; the confirm answered `answer` when it comes. */
/** 1.0's replace confirm's two answers, in the interface language (the extraction's packs). */
const w6Answers = (lang = 'en') => { const pk = JSON.parse(readFileSync(path.join(STUDIO, 'src', 'generated', 'packs', lang + '.json'), 'utf8')); const en = JSON.parse(readFileSync(path.join(STUDIO, 'src', 'generated', 'packs', 'en.json'), 'utf8')); return { yes: pk['import.replaceYes'] || en['import.replaceYes'], no: pk['import.replaceNo'] || en['import.replaceNo'] }; };
async function w6Two(page, file, answer = 'yes', lang = 'en') {
  const ans = w6Answers(lang);
  const toasts0 = await page.evaluate(() => document.querySelectorAll('#toasts .toast').length);
  await page.evaluate(() => document.getElementById('modalImportReport')?.classList.remove('open'));
  // every toast the import raises, as it appears (a refusal can come and go while pdf.js's "Reading …" stands)
  await page.evaluate(() => {
    window.__w6toasts = [];
    window.__w6mo?.disconnect();
    const box = document.getElementById('toasts');
    window.__w6mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && window.__w6toasts.push(n.textContent || ''))));
    if (box) window.__w6mo.observe(box, { childList: true });
  });
  await page.setInputFiles('#fileInput', file);
  let asked = false;
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(([n, yesText]) => {
      const yes = [...document.querySelectorAll('button')].find((b) => b.textContent === yesText);
      if (yes) return 'confirm';
      if (document.getElementById('modalImportReport')?.classList.contains('open') && !window.beukImport.pending()) return 'report';
      const ts = [...document.querySelectorAll('#toasts .toast')];
      if ((window.__w6toasts || []).some((x) => !/^Reading /.test(x)) && !document.getElementById('modalImportReport')?.classList.contains('open')) return 'toast';
      void ts; void n;
      return null;
    }, [toasts0, ans.yes]);
    if (st === 'confirm') {
      asked = true;
      if (answer === 'yes') await page.click(`button:text-is("${ans.yes}")`);
      else {
        await page.click(`button:text-is("${ans.no}")`);
        await page.waitForTimeout(400);
        return { asked, done: 'cancelled', ms: Date.now() - t0 };
      }
      continue;
    }
    if (st === 'report' || st === 'toast') {
      await page.waitForTimeout(300);
      const toasts = await page.evaluate(() => (window.__w6toasts || []).filter((x) => !/^Reading /.test(x)));
      return { asked, done: st, ms: Date.now() - t0, toasts };
    }
    if (Date.now() - t0 > 120_000) return { asked, done: 'timeout', ms: Date.now() - t0 };
    await page.waitForTimeout(100);
  }
}
/** The backup, with the import report closed first (it is a modal over the page: the local pill sits under it). */
async function w6Backup(page) {
  await page.evaluate(() => {
    const m = document.getElementById('modalImportReport');
    if (m && m.classList.contains('open')) document.getElementById('btnIrClose').click();
  });
  await page.waitForTimeout(150);
  return exportBackup(page);
}
/** The report's HTML, masked: its items' ids and the date in the subtitle. */
const w6MaskReport = (h) => String(h).replace(/data-ir(id|undo)="[^"]*"/g, 'data-ir$1="#"');
async function w6Desk2(ctx, origin, deskKind, deskBook) {
  const page = await openNext(ctx, origin);
  if (deskKind === 'empty') await page.waitForSelector('#btnOpenBackup', { timeout: 30_000 });
  else if (deskKind === 'sample') {
    await page.waitForSelector('#btnSampleStory', { timeout: 30_000 });
    await page.click('#btnSampleStory');
    await page.waitForSelector('#btnOpenBackup', { state: 'detached', timeout: 60_000 });
  } else await openBackup(page, w4File('w6-desk-' + deskKind + '.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: deskBook })));
  await page.waitForFunction(() => !!window.beukImport?.ready && document.getElementById('btnImport')?.getAttribute('aria-disabled') === null, null, { timeout: 60_000 });
  return page;
}

async function wave6Parity(origin) {
  const corpus = await w6Corpus(origin);
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const themed = JSON.parse(JSON.stringify(lan));
  themed.activePreset = 'noir';
  const counts = {};
  for (const f of corpus) counts[f.kind] = (counts[f.kind] || 0) + 1;
  note('wave6 corpus: ' + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ') + ' (' + corpus.length + ' files)');
  check(counts.docx >= 6 && counts.text >= 16 && counts.rtf >= 3 && counts.epub >= 6 && counts.pdf >= 3 && counts.zip === 3 && counts.refuse >= 4, 'wave6 constraint 77: the corpus holds every kind it names');
  const desks = [['empty', null, corpus], ['lantern', lan, corpus],
    ['sample', null, corpus.filter((f) => ['headings.docx', 'frontmatter.md', 'headings.rtf', 'plain.epub', 'one-book.zip'].includes(f.name))],
    ['themed', themed, corpus.filter((f) => ['matter.docx', 'plain-manuscript.txt', 'unicode.rtf'].includes(f.name))]];
  // 1.0 varies only the masked fields: two imports of the same file in 1.0 itself
  {
    const c1 = await newContext({ serviceWorkers: 'block' });
    try {
      const one = await openOne(c1, origin);
      const f = corpus.find((x) => x.name === 'matter.docx');
      const a = await one.evaluate(W6_ONE, [lan, w6B64(f), 'lantern']);
      const b = await one.evaluate(W6_ONE, [lan, w6B64(f), 'lantern']);
      const ma = JSON.stringify(W6F.maskVarying(expected(a.book))), mb = JSON.stringify(W6F.maskVarying(expected(b.book)));
      check(JSON.stringify(a.book) !== JSON.stringify(b.book) && ma === mb, "wave6 constraint 77: 1.0 itself varies only the masked fields (the new book's and the sections' ids, the snapshot's and the report's ids and times): two imports of matter.docx differ raw, equal masked");
    } finally {
      await c1.close();
    }
  }
  const deskOnly = (process.env.W6_DESKS || 'empty,lantern,sample,themed').split(',');
  for (const [deskKind, deskBook, files] of desks) {
    if (!deskOnly.includes(deskKind)) continue;
    let eq = 0, n = 0, askEq = 0, refusedEq = 0, refused = 0;
    const bad = [];
    const c1 = await newContext({ serviceWorkers: 'block' });
    try {
      const one = await openOne(c1, origin);
      const fileOnly = process.env.W6_FILES ? process.env.W6_FILES.split(',') : null;
      for (const f of files) {
        if (fileOnly && !fileOnly.includes(f.name)) continue;
        const c2 = await newContext({ serviceWorkers: 'block' });
        try {
          const two = await w6Desk2(c2, origin, deskKind, deskBook);
          const start = deskKind === 'empty' ? null : (await w6Backup(two)).json.book;
          const r1 = await one.evaluate(W6_ONE, [deskKind === 'sample' ? start : deskBook, w6B64(f), deskKind]);
          const r2 = await w6Two(two, f, 'yes');
          const v1 = await one.evaluate(() => (window.__csp || []).length), v2 = await two.evaluate(() => (window.__csp || []).length);
          note(`wave6 ${deskKind} ${f.name}: 1.0 ${r1.changed ? 'imported' : 'refused'} (${r1.ms.toFixed(0)} ms, CSP events so far ${v1}); 2.0 ${r2.done} (${r2.ms} ms, CSP events ${v2})`);
          n++;
          // 1.0's handleImportFile asks only once the file has been read (a refused file is refused before any confirm)
          const asked1 = r1.asked && r1.changed;
          if (asked1 === r2.asked) askEq++;
          else bad.push(`${f.name}: the confirm 1.0 ${asked1} / 2.0 ${r2.asked}`);
          if (!r1.changed) {
            refused++;
            const msg1 = r1.toasts[r1.toasts.length - 1] || '';
            const msg2 = (r2.toasts || []).slice(-1)[0] || '';
            if (msg2.includes(msg1) && msg1) refusedEq++;
            else bad.push(`${f.name}: 1.0 said "${msg1}" / 2.0 "${msg2}" (2.0's toasts: ${JSON.stringify(r2.toasts || [])})`);
            const after = deskKind === 'empty' ? null : (await w6Backup(two)).json.book;
            if (start && JSON.stringify(after) !== JSON.stringify(start)) bad.push(`${f.name}: 2.0's desk changed after a refusal`);
            continue;
          }
          const out = (await w6Backup(two)).json.book;
          const m1 = JSON.stringify(W6F.maskVarying(expected(r1.book))), m2 = JSON.stringify(W6F.maskVarying(out));
          if (m1 === m2 && r2.done === 'report') eq++;
          else {
            const at = [...m1].findIndex((ch, i) => ch !== m2[i]);
            bad.push(`${f.name}: ${r2.done}; differs at ${at}: 1.0 …${m1.slice(Math.max(0, at - 80), at + 80)}… / 2.0 …${m2.slice(Math.max(0, at - 80), at + 80)}…`);
          }
          if (deskKind === 'lantern' || deskKind === 'themed') {
            const h = (out.history || [])[0];
            if (!h || h.auto !== 'import') bad.push(`${f.name}: History's head is not the import snapshot`);
          }
          await harvestCsp(two);
        } finally {
          await c2.close();
        }
      }
      await harvestCsp(one);
    } finally {
      await c1.close();
    }
    check(!bad.length && eq + refused === n && askEq === n && refusedEq === refused,
      `wave6 constraints 77, 78: onto ${deskKind === 'empty' ? 'an empty desk' : deskKind === 'lantern' ? 'a written book (Lantern Coast)' : deskKind === 'sample' ? 'the untouched sample' : 'a book with a theme preset (noir)'}: ${eq} of ${n - refused} imports give 1.0's book (masked); ${refusedEq} of ${refused} refusals in 1.0's words; the confirm when 1.0's comes: ${askEq} of ${n}${bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''}`);
  }
}

/** Cancel leaves the book; Undo the whole import (History's import snapshot restored) gives the old book back. */
async function wave6Desks(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const f = w6File('plain-manuscript.txt', 'text/plain', Buffer.from(W6F.textCorpus().find((x) => x.name === 'plain-manuscript.txt').text, 'utf8'));
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const two = await w6Desk2(ctx, origin, 'lantern', lan);
    const start = (await w6Backup(two)).json.book;
    const r = await w6Two(two, f, 'no');
    const after = (await w6Backup(two)).json.book;
    check(r.asked && r.done === 'cancelled' && JSON.stringify(after) === JSON.stringify(start), "wave6 constraint 78: 1.0's confirm on a written book; Keep my book leaves the export exactly equal");
    const r2 = await w6Two(two, f, 'yes');
    const imported = (await w6Backup(two)).json.book;
    const snap = imported.history[0];
    check(r2.done === 'report' && snap.auto === 'import', "wave6 constraint 78: after the import, History's head is the import snapshot");
    await two.click('#btnIrReopen');
    await two.click('#btnIrUndoAll');
    await two.click('button:text-is("Undo the import")');
    await two.waitForFunction(() => !document.getElementById('modalImportReport').classList.contains('open') && !window.beukImport.pending(), null, { timeout: 60_000 });
    await two.waitForTimeout(500);
    const back = (await w6Backup(two)).json.book;
    {
      // the import's snapshot is 1.0's chopSnapDoc of 1.0's state of the old book (1.0's arrival: its formatVersion label,
      // its meta in arrival order, its cover recipe normalized); restoring it gives that book back: compared with 1.0's
      // own state of the same book (1.0's page: applyBookDoc, then serializeBook), History and the report aside
      const c1 = await newContext({ serviceWorkers: 'block' });
      let held;
      try {
        const one = await openOne(c1, origin);
        held = await one.evaluate((b0) => { applyBookDoc(JSON.parse(JSON.stringify(b0))); return JSON.parse(JSON.stringify(serializeBook())); }, start); // eslint-disable-line no-undef
      } finally {
        await c1.close();
      }
      note(`wave6: the restored book carries formatVersion ${back.formatVersion} (the stored book before: ${start.formatVersion ?? 'none'}; 1.0's state of it: ${held.formatVersion})`);
      const x = JSON.stringify(noHistory(back)), y = JSON.stringify(noHistory(expected(held)));
      const at = [...x].findIndex((ch, i) => ch !== y[i]);
      check(x === y, `wave6 constraint 78: restoring the import's snapshot (Undo the whole import) gives back the old book exactly as 1.0 holds it (History and the report aside; History gains the restore's own snapshot)${x === y ? '' : ' — at ' + at + ': after …' + x.slice(Math.max(0, at - 120), at + 120) + '… / before …' + y.slice(Math.max(0, at - 120), at + 120) + '…'}`);
    }
    await harvestCsp(two);
  } finally {
    await ctx.close();
  }
}

/** The report beside 1.0's: its HTML; every reversible item's undo, an edited-since refusal, Undo the whole import; Dismiss and the reopen across a reload. */
const w6Diff = (a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); const at = [...x].findIndex((ch, i) => ch !== y[i]); return at < 0 && x.length === y.length ? '' : ` at ${at}: 1.0 …${x.slice(Math.max(0, at - 150), at + 150)}… / 2.0 …${y.slice(Math.max(0, at - 150), at + 150)}…`; };
async function wave6Report(origin) {
  const corpus = await w6Corpus(origin);
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const subset = ['matter.docx', 'footnotes.docx', 'picture-table.docx', 'w6-lantern.epub', 'w6-salt.pdf'].filter((n) => !process.env.W6_FILES || process.env.W6_FILES.split(',').includes(n)).map((n) => corpus.find((x) => x.name === n));
  const bad = [];
  let htmlEq = 0, undoEq = 0, undos = 0, allEq = 0;
  for (const f of subset) {
    const c1 = await newContext({ serviceWorkers: 'block' });
    const c2 = await newContext({ serviceWorkers: 'block' });
    try {
      const one = await openOne(c1, origin);
      const r1 = await one.evaluate(W6_ONE, [lan, w6B64(f), 'lantern']);
      const two = await w6Desk2(c2, origin, 'lantern', lan);
      const r2 = await w6Two(two, f, 'yes');
      const h2 = await two.evaluate(() => document.getElementById('irBody').innerHTML);
      if (r2.done === 'report' && w6MaskReport(h2) === w6MaskReport(r1.report)) htmlEq++;
      else bad.push(`${f.name}: the report's HTML differs`);
      // every reversible item, in order, in both
      const items = await one.evaluate(() => state.importReport.items.map((it) => ({ id: it.id, rev: it.reversible && it.state === 'applied', kind: it.kind }))); // eslint-disable-line no-undef
      // the report's items in the book's order (the dialog draws them by group): the same order as 1.0's state's
      const ids2 = (await w6Backup(two)).json.book.importReport.items.map((it) => it.id);
      await two.click('#btnIrReopen');
      for (const [i, it] of items.entries()) {
        if (!it.rev) continue;
        const has = await two.$(`#irBody [data-irundo="${ids2[i]}"]`);
        if (!has) continue;
        undos++;
        await one.evaluate((id) => irUndoItem(id), it.id); // eslint-disable-line no-undef
        // its group may be folded (1.0 opens a group of six items or fewer): the writer unfolds it; the button's own click
        await two.evaluate((id) => { const b = document.querySelector(`#irBody [data-irundo="${id}"]`); b.closest('details')?.setAttribute('open', ''); b.click(); }, ids2[i]);
        await two.waitForTimeout(250);
        const b1 = await one.evaluate(() => JSON.parse(JSON.stringify(serializeBook()))); // eslint-disable-line no-undef
        const b2 = (await w6Backup(two)).json.book;
        if (JSON.stringify(W6F.maskVarying(expected(b1))) === JSON.stringify(W6F.maskVarying(b2))) undoEq++;
        else bad.push(`${f.name}: item ${i} (${it.kind}) undone differs${w6Diff(W6F.maskVarying(expected(b1)), W6F.maskVarying(b2))}`);
        await two.evaluate(() => document.getElementById('modalImportReport').classList.contains('open') || document.getElementById('btnIrReopen').click());
      }
      // the whole import, undone (both by the import's snapshot)
      await one.evaluate(() => irUndoAll()); // eslint-disable-line no-undef
      await two.evaluate(() => document.getElementById('modalImportReport').classList.contains('open') || document.getElementById('btnIrReopen').click());
      await two.click('#btnIrUndoAll');
      await two.click('button:text-is("Undo the import")');
      await two.waitForFunction(() => !window.beukImport.pending() && !document.getElementById('modalImportReport').classList.contains('open'), null, { timeout: 60_000 });
      await two.waitForTimeout(500);
      const u1 = await one.evaluate(() => JSON.parse(JSON.stringify(serializeBook()))); // eslint-disable-line no-undef
      const u2 = (await w6Backup(two)).json.book;
      // (V, 2026-11-04: History's own snapshots carry 1.0's formatVersion label too: compared as they are)
      const strip = (b) => W6F.maskVarying(JSON.parse(JSON.stringify(b)));
      if (JSON.stringify(strip(expected(u1))) === JSON.stringify(strip(u2))) allEq++;
      else bad.push(`${f.name}: Undo the whole import differs${w6Diff(strip(expected(u1)), strip(u2))}`);
      await harvestCsp(one);
      await harvestCsp(two);
    } finally {
      await c1.close();
      await c2.close();
    }
  }
  check(htmlEq === subset.length, `wave6 constraint 79: the report's HTML equals 1.0's (items' ids masked) for ${htmlEq} of ${subset.length} imports (3 DOCX, 1 EPUB, 1 PDF)${bad.length ? ' — ' + bad.slice(0, 3).join('; ') : ''}`);
  check(undoEq === undos && undos > 0, `wave6 constraint 79: every reversible item's undo gives 1.0's book: ${undoEq} of ${undos}${bad.length ? ' — ' + bad.join(' | ') : ''}`);
  check(allEq === subset.length, `wave6 constraint 79: Undo the whole import gives 1.0's book for ${allEq} of ${subset.length}`);
  // edited since: the text an item names is changed, its undo is refused in 1.0's words; Dismiss and the reopen survive a reload
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const two = await w6Desk2(ctx, origin, 'lantern', lan);
    const f = corpus.find((x) => x.name === 'plain-manuscript.txt');
    await w6Two(two, f, 'yes');
    const ok = await two.evaluate(() => {
      const btn = document.querySelector('#irBody [data-irundo]');
      return !!btn;
    });
    check(ok, 'wave6: the report offers an undo');
    await two.click('#btnIrClose');
    await two.reload();
    await two.waitForFunction(() => !!window.beukImport?.ready, null, { timeout: 60_000 });
    const reopen = await two.evaluate(() => document.getElementById('irReopen').style.display !== 'none');
    await two.click('#btnIrReopen');
    const opened = await two.evaluate(() => document.getElementById('modalImportReport').classList.contains('open') && document.querySelectorAll('#irBody .ir-item').length > 0);
    check(reopen && opened, 'wave6 constraint 79: after a reload the report rides in the book: its reopen button stands and opens it');
    await two.click('#btnIrDismiss');
    await two.click('button:text-is("Dismiss")');
    await two.waitForTimeout(500);
    await two.reload();
    await two.waitForFunction(() => !!window.beukImport?.ready, null, { timeout: 60_000 });
    const gone = await two.evaluate(() => document.getElementById('irReopen').style.display === 'none');
    const book = (await w6Backup(two)).json.book;
    check(gone && book.importReport === null, 'wave6 constraint 79: Dismissed, the report is gone from the book and stays gone across a reload');
    await harvestCsp(two);
  } finally {
    await ctx.close();
  }
}

/** Hostile DOCX, EPUB and MD: no script, handler or remote request anywhere after the import. */
async function wave6Hostile(origin) {
  const evil = '<img src=x onerror="window.__pw=1">';
  const md = `---\ntitle: "${evil}‮Title​"\nauthor: "<script>window.__pw=2</script>"\n---\n\n# Chapter <svg onload=window.__pw=3></svg>\n\n"Quote" -- <a href="javascript:window.__pw=5">link</a> <img src="https://evil.example/x.png" onerror="window.__pw=6">\n\n***\n\n# Two <iframe src=//evil.example></iframe>\n\nText...\n`;
  const docx = await W6C.makeDocx(W6Z, { title: evil + '‮​', creator: '<script>window.__pw=7</script>', body: `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${evil.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</w:t></w:r></w:p><w:p><w:r><w:t>javascript:alert(1) https://evil.example/a.png</w:t></w:r></w:p>` });
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const files = [w6File('evil.md', 'text/markdown', Buffer.from(md, 'utf8')), w6File('evil.docx', W6_DOCX, docx), await w6EpubOf(origin, w5aHostileBook(lan), 'w6-hostile')];
  for (const f of files) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    const outside = [];
    try {
      const two = await w6Desk2(ctx, origin, 'empty', null);
      two.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
      });
      const r = await w6Two(two, f, 'yes');
      await two.waitForTimeout(800);
      const haz = await two.evaluate(W5D_DOM_HAZ, '#modalImportReport');
      const haz2 = await two.evaluate(W5D_DOM_HAZ, '#importSlot');
      const haz3 = await two.evaluate(W5D_DOM_HAZ, '#pane-center');
      const pw = await two.evaluate(() => window.__pw ?? null);
      const out = (await w6Backup(two)).json.book;
      check(r.done === 'report' && !haz.length && !haz2.length && !haz3.length && pw === null && outside.length === 0,
        `wave6 constraint 80: ${f.name} imported — the report, the summary and the editor hold no script, handler or remote source (${[...haz, ...haz2, ...haz3].slice(0, 4).join(', ') || 'none'}), nothing ran, no request left the page (${outside.length})`);
      check(JSON.stringify(out) === JSON.stringify(expected(out, out)), `wave6 constraint 80: the imported ${f.name} is a 1.0 book (readBook reads it exactly)`);
      await harvestCsp(two);
    } finally {
      await ctx.close();
    }
  }
}

/** Add a Book: a .docx, .md and .epub each a volume; the open book's export unchanged; a zip of books as 1.0's. */
async function wave6AddBook(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const docx = (await W6C.docxCorpus(W6Z)).find((x) => x.name === 'matter.docx');
  const md = W6F.textCorpus().find((x) => x.name === 'frontmatter.md');
  const files = [w6File('matter.docx', W6_DOCX, docx.bytes), w6File('frontmatter.md', 'text/markdown', Buffer.from(md.text, 'utf8')), await w6EpubOf(origin, fixtures.find((x) => x.name === 'real/salt-road-book-one').book, 'w6-vol')];
  const zip = w6File('library.zip', 'application/zip', await W6C.makeZip(W6Z, W6F.textCorpus().filter((x) => x.name.endsWith('.md')).slice(0, 3).map((x) => ({ name: x.name, text: x.text }))));
  const c1 = await newContext({ serviceWorkers: 'block' });
  const c2 = await newContext({ serviceWorkers: 'block' });
  try {
    const one = await openOne(c1, origin);
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(lan)); // eslint-disable-line no-undef
    const two = await w5aOpen(c2, origin, w4File('w6-addbook.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: lan })));
    const start = (await w6Backup(two)).json.book;
    for (const p of [one, two]) await w5aOpenModal(p, '#btnExport');
    const titles = async (p) => p.$$eval('#boxSetList .bs-title', (els) => els.map((e) => e.textContent));
    void 0;
    const wait = (p, n) => p.waitForFunction((k) => document.querySelectorAll('#boxSetList .bs-row').length >= k, n, { timeout: 60_000 }).catch(() => undefined);
    // 1.0, as the writer adds them one after the other
    for (const f of [...files, zip]) {
      await one.setInputFiles('#boxSetFileInput', f);
      await one.waitForTimeout(2500);
    }
    const t1 = await titles(one);
    // 1.0, each file on its own (the volume 1.0 makes of it): the zip's three books as three files
    const zipMembers = W6F.textCorpus().filter((x) => x.name.endsWith('.md')).slice(0, 3).map((x) => w6File(x.name, 'text/markdown', Buffer.from(x.text, 'utf8')));
    const single = [];
    for (const f of [...files, ...zipMembers]) {
      await one.evaluate(() => { state.boxSetVolumes = []; renderBoxSetList(); }); // eslint-disable-line no-undef
      await one.setInputFiles('#boxSetFileInput', f);
      await wait(one, 2);
      await one.waitForTimeout(500);
      single.push((await titles(one))[1]);
    }
    // 2.0, one after the other
    let k = 1;
    for (const f of [...files, zip]) {
      k += f === zip ? 3 : 1;
      await two.setInputFiles('#boxSetFileInput', f);
      await wait(two, k);
    }
    const t2 = await titles(two);
    const rep1 = await one.evaluate(() => document.getElementById('modalImportReport')?.classList.contains('open'));
    const rep2 = await two.evaluate(() => document.getElementById('modalImportReport')?.classList.contains('open'));
    note(`wave6 Add a Book: after the volumes, the import report is open in 1.0: ${rep1}, in 2.0: ${rep2} (1.0's importSandboxed: irFinish opens the volume's own report)`);
    note(`wave6 Add a Book: 1.0's list after adding them one after the other: ${JSON.stringify(t1)} — each manuscript volume clears the ones before it (1.0's importSandboxed arrives another book: applyBookDoc's boxSetVolumes rule)`);
    const want = [t2[0], ...single];
    check(JSON.stringify(t2) === JSON.stringify(want) && t2.length === 1 + 3 + 3, `wave6 constraint 81: Add a Book (a .docx, a .md, an .epub, a zip of three books) gives 1.0's volumes, each as 1.0 makes it of that file: ${JSON.stringify(t2)}${JSON.stringify(t2) === JSON.stringify(want) ? '' : ' (1.0, one by one: ' + JSON.stringify(want) + ')'}`);
    for (const p of [one, two]) await p.evaluate(() => document.getElementById('modalImportReport')?.classList.remove('open'));
    await two.click('#btnCloseExport');
    const out = (await w6Backup(two)).json.book;
    check(JSON.stringify(out) === JSON.stringify(start), "wave6 constraint 81: the open book's export is exactly unchanged after every volume");
    await harvestCsp(one);
    await harvestCsp(two);
  } finally {
    await c1.close();
    await c2.close();
  }
}

/** The libraries: none on opening a book; mammoth once on the first .docx (1.0's integrity); pdf.js on the first .pdf. */
async function wave6Libs(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const ctx = await newContext({ serviceWorkers: 'block' });
  const reqs = [];
  try {
    const page = await openNext(ctx, origin);
    page.on('request', (r) => reqs.push(r.url()));
    await openBackup(page, w4File('w6-libs.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: lan })));
    await page.waitForFunction(() => !!window.beukImport?.ready, null, { timeout: 60_000 });
    await page.waitForTimeout(1000);
    const libs = (u) => /mammoth|pdfjs/.test(u);
    check(!reqs.some(libs) && !(await page.evaluate(() => !!window.mammoth || !!window.pdfjsLib)), `wave6 constraint 82: opening a book loads neither mammoth nor pdf.js (${reqs.filter(libs).join(', ') || 'none'})`);
    const docx = (await W6C.docxCorpus(W6Z))[0];
    await w6Two(page, w6File(docx.name, W6_DOCX, docx.bytes), 'yes');
    await w6Two(page, w6File(docx.name, W6_DOCX, docx.bytes), 'yes');
    const m = reqs.filter((u) => /mammoth\.browser\.min\.js$/.test(u));
    const sri = await page.evaluate(() => [...document.querySelectorAll('script[src*="mammoth"]')].map((s) => s.getAttribute('integrity')));
    check(m.length === 1 && sri.length === 1 && sri[0] === MAMMOTH_SRI, `wave6 constraint 82: the first .docx loads mammoth once (${m.length} request), with 1.0's integrity (${sri[0] === MAMMOTH_SRI})`);
    const pdf = await w6PdfOf(origin, fixtures.find((x) => x.name === 'real/salt-road-book-one').book, 'w6-libs');
    const r = await w6Two(page, pdf, 'yes');
    const p = reqs.filter((u) => /pdfjs-6\.4\.299\/pdf(\.worker)?\.min\.mjs$/.test(u));
    check(r.done === 'report' && p.length === 2, `wave6 constraint 82: the first .pdf loads pdf.js (${p.map((u) => u.split('/').pop()).join(', ')}) and imports`);
    const outside = reqs.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    check(outside.length === 0, `wave6 constraint 82: nothing leaves the page (${outside.length})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}
const MAMMOTH_SRI = /<script src="assets\/vendor\/mammoth\.browser\.min\.js" integrity="([^"]+)"><\/script>/.exec(readFileSync(path.join(REPO, 'client', 'index.html'), 'utf8'))[1];

/** Dumas as a Word document (1.0's own Word export of it) imported onto an empty desk: its wall time, both apps. */
async function wave6DumasDocx(origin) {
  const c1 = await newContext({ serviceWorkers: 'block' });
  const c2 = await newContext({ serviceWorkers: 'block' });
  try {
    const one = await openOne(c1, origin);
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(DUMAS.book)); // eslint-disable-line no-undef
    const b64 = await one.evaluate(async () => {
      const blob = await buildDocxBlob(); // eslint-disable-line no-undef
      const u = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const f = w6File('dumas.docx', W6_DOCX, Buffer.from(b64, 'base64'));
    const r1 = await one.evaluate(W6_ONE, [null, w6B64(f), 'empty']);
    const two = await w6Desk2(c2, origin, 'empty', null);
    const r2 = await w6Two(two, f, 'yes');
    // the cost of one event on the report (V, 2026-11-04): a click opens an import session on Dumas (exportBook, 1.0's
    // arrival, History unpacked), 1.0's listener runs, the session ends; Close and the reopen button, five times each
    const cost = await two.evaluate(() => {
      const ms = [];
      for (let i = 0; i < 5; i++) {
        for (const id of ['btnIrClose', 'btnIrReopen']) {
          const t0 = performance.now();
          document.getElementById(id).click();
          ms.push(performance.now() - t0);
        }
      }
      ms.sort((x, y) => x - y);
      return { median: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] };
    });
    note(`wave6: one click on the import report with Dumas on the desk (an import session around 1.0's listener): median ${cost.median.toFixed(1)} ms, max ${cost.max.toFixed(1)} ms over 10 clicks`);
    check(cost.median < 50, `wave6 (V, 2026-11-04): a report event on Dumas costs under ~50 ms (median ${cost.median.toFixed(1)} ms)`);
    const out = (await w6Backup(two)).json.book;
    note(`wave6 constraint 83: Dumas as DOCX (${(f.buffer.length / 1024).toFixed(0)} kB) imported — 2.0 ${r2.ms} ms to the report (1.0's handleImportFile ${r1.ms.toFixed(0)} ms in its page)`);
    check(r2.done === 'report' && JSON.stringify(W6F.maskVarying(expected(r1.book))) === JSON.stringify(W6F.maskVarying(out)), "wave6 constraint 83: the Dumas-as-DOCX import finishes, and its book is 1.0's");
    await harvestCsp(one);
    await harvestCsp(two);
  } finally {
    await c1.close();
    await c2.close();
  }
}

/** 1.0's own box-set volume self-check, in 1.0's own page (the lead from vitest import-selfchecks). */
async function wave6SelfCheck(origin) {
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const one = await openOne(ctx, origin);
    const r = await one.evaluate(async () => {
      const c = window.BEUK_SELF_CHECKS_ASYNC.find((x) => x.id === 'boxset.volumes.whole-books') || window.BEUK_SELF_CHECKS.find((x) => x.id === 'boxset.volumes.whole-books');
      if (!c) return { found: false };
      const v = await c.run();
      return { found: true, pass: !!v.pass, detail: String(v.detail || '').slice(0, 300) };
    });
    note(`wave6: 1.0's own check boxset.volumes.whole-books in 1.0's page: ${JSON.stringify(r)}`);
    check(r.found, "wave6: 1.0's box-set volumes self-check ran in 1.0's page (its result is a note: a 1.0 finding if it fails there)");
  } finally {
    await ctx.close();
  }
}

/** The summary and the report beside 1.0's (Paper, Candlelight, Arabic). */
async function wave6Screens(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const f = w6File('plain-manuscript.txt', 'text/plain', Buffer.from(W6F.textCorpus().find((x) => x.name === 'plain-manuscript.txt').text, 'utf8'));
  const diffCtx = await browser.newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      if (process.env.W6_THEMES && !process.env.W6_THEMES.split(',').includes(tag)) continue;
      const prep = (ctx) => ctx.addInitScript(([th, l]) => {
        try {
          localStorage.setItem('beuk.theme.v1', th);
          if (l) localStorage.setItem('beuk.uiLang.v1', l);
        } catch {
          /* no storage */
        }
      }, [run.theme, run.lang]);
      const c1 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      const c2 = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
      await prep(c1);
      await prep(c2);
      try {
        const one = await watch(await c1.newPage());
        await one.goto(origin + '/studio');
        await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
        await one.setInputFiles('#localBackupInput', lan.file);
        await one.waitForFunction(() => /Lantern/.test(document.getElementById('projectTitleDisplay')?.textContent || ''), null, { timeout: 30_000 });
        await one.addStyleTag({ content: ONE_HIDE });
        await one.evaluate(async (ff) => {
          /* global handleImportFile */
          const bytes = Uint8Array.from(atob(ff.b64), (ch) => ch.charCodeAt(0));
          await handleImportFile(new File([bytes], ff.name, { type: ff.type }), { replaceOk: true });
        }, w6B64(f));
        const two = await w6Desk2(c2, origin, 'lantern', lan.book);
        await w6Two(two, f, 'yes', run.lang || 'en');
        for (const p of [one, two]) {
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800); // toasts gone
        }
        // the report (1.0's date in its subtitle is each app's own: masked by giving both the same)
        for (const p of [one, two]) await p.evaluate(() => { const s = document.getElementById('irSub'); if (s) s.textContent = s.textContent.replace(/·.*$/, '·'); });
        let [ma, mb] = [await one.locator('#modalImportReport .modal').screenshot(), await two.locator('#modalImportReport .modal').screenshot()];
        writeFileSync(path.join(OUT, `w6-report-${tag}-one.png`), ma);
        writeFileSync(path.join(OUT, `w6-report-${tag}-two.png`), mb);
        let d = await pixelDiff(diffPage, ma, mb);
        check(d.ratio <= PIXEL_TOLERANCE, `wave6 screenshots ${tag}: #modalImportReport differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        for (const p of [one, two]) await p.click('#btnIrClose');
        await one.waitForTimeout(300);
        for (const [nm, p] of [['1.0', one], ['2.0', two]]) note(`wave6 screenshots ${tag}: ${nm} #importSummary ${JSON.stringify(await p.evaluate(() => { const e = document.getElementById('importSummary'); const r = e.getBoundingClientRect(); return { display: e.style.display, w: r.width, h: r.height }; }))}`);
        ma = await one.locator('#importSummary').screenshot({ timeout: 10_000 });
        mb = await two.locator('#importSummary').screenshot({ timeout: 10_000 });
        writeFileSync(path.join(OUT, `w6-summary-${tag}-one.png`), ma);
        writeFileSync(path.join(OUT, `w6-summary-${tag}-two.png`), mb);
        d = await pixelDiff(diffPage, ma, mb);
        check(d.ratio <= PIXEL_TOLERANCE, `wave6 screenshots ${tag}: the summary (#importSummary) differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        await harvestCsp(one);
        await harvestCsp(two);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function wave6Checks(origin) {
  const only = (process.env.W6_PARTS || 'parity,desks,report,hostile,addbook,libs,dumas,selfcheck,screens,latency').split(',');
  if (only.includes('parity')) await wave6Parity(origin);
  if (only.includes('desks')) await wave6Desks(origin);
  if (only.includes('report')) await wave6Report(origin);
  if (only.includes('hostile')) await wave6Hostile(origin);
  if (only.includes('addbook')) await wave6AddBook(origin);
  if (only.includes('libs')) await wave6Libs(origin);
  if (only.includes('dumas')) await wave6DumasDocx(origin);
  if (only.includes('selfcheck')) await wave6SelfCheck(origin);
  if (only.includes('screens')) await wave6Screens(origin);
  // constraint 83: the editor's typing with the import wired and no import run (#5's measure, and the redraws between keys)
  if (only.includes('latency') && !(process.env.E2E_ONLY || '').split(',').includes('latency')) {
    const r = await latency(origin);
    note(`wave6 latency (the import wired, none run): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
    check(r.p95 < LATENCY_P95_TARGET_MS, `wave6 constraint 83: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas with the import wired (${r.p95.toFixed(1)} ms)`);
    const r2 = await latency(origin, { delay: 200, count: 60, quick: true });
    note(`wave6 latency with the preview redrawing between keys (200 ms): p50 ${r2.p50.toFixed(1)} ms, p95 ${r2.p95.toFixed(1)} ms, max ${r2.max.toFixed(1)} ms over ${r2.n} keystrokes`);
    check(r2.p95 < LATENCY_P95_TARGET_MS, `wave6 constraint 83: p95 under ${LATENCY_P95_TARGET_MS} ms while the preview redraws between keys (${r2.p95.toFixed(1)} ms)`);
  }
}

/* ---- per-user themes ("My themes", plan 2026-11-02, constraints 46-50) ----
   Signed out (this device only): a theme designed with an uploaded font in book A is kept for every book, applied in
   book B; B exports as a 1.0 book (readBook reads it exactly) and 1.0's own page opens it with the theme worn and the
   face a loaded FontFace; applying again adds nothing (dedupe). The one-time offer: declined once, the export is
   unchanged, and it is never shown again for that book (after a reload). Another device lists nothing.
   Signed in (a mocked account, src/routes/user-themes.ts's answers): the bytes go first, then the theme; a second
   device lists it and applies it with the face fetched from the account's picture store; a 409 from that second
   device keeps both on the first; an offline write survives a reload and is sent when the account answers again.
   A hostile My theme from the account: drawn as text, applied through the safe path — no handler, no script, no
   request leaves the page, the book exports as readBook reads it. */
function themeAccount() {
  const acct = { users: new Map(), log: [], fail: false };
  const of = (uid) => {
    let u = acct.users.get(uid);
    if (!u) acct.users.set(uid, (u = { themes: new Map(), pictures: new Map() }));
    return u;
  };
  acct.of = of;
  acct.sha = (b64) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
  acct.install = (ctx, uid) =>
    ctx.route('**/api/**', (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      const m = req.method();
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body) });
      if (p === '/api/health') return json(200, { ok: true });
      if (p === '/api/auth/me') return json(200, { user: uid ? { id: uid, email: uid + '@example.org' } : null });
      if (!uid || !(p.startsWith('/api/themes') || p.startsWith('/api/pictures'))) return json(404, { error: 'not here' });
      acct.log.push(`${uid} ${m} ${p}`);
      if (acct.fail) return route.abort('internetdisconnected');
      const me = of(uid);
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      const ifm = req.headers()['if-match'];
      const base = ifm ? Number(/\d+/.exec(ifm)[0]) : null;
      if (p === '/api/pictures/missing') return json(200, { missing: body.hashes.filter((h) => !me.pictures.has(h)) });
      let mm = /^\/api\/pictures\/([0-9a-f]{64})$/.exec(p);
      if (mm) {
        if (m === 'PUT') {
          if (acct.sha(body.data) !== mm[1]) return json(400, { error: 'sha256 does not match the data' });
          me.pictures.set(mm[1], { mediaType: body.mediaType, data: body.data });
          return json(201, { picture: { sha256: mm[1], stored: true } });
        }
        const pic = me.pictures.get(mm[1]);
        return pic ? json(200, { picture: { sha256: mm[1], ...pic } }) : json(404, { error: 'picture not found' });
      }
      if (p === '/api/themes') return json(200, { themes: [...me.themes].map(([key, t]) => ({ key, name: t.name, revision: t.revision, updated_at: 'x' })) });
      mm = /^\/api\/themes\/([\w-]+)$/.exec(p);
      if (!mm) return json(404, { error: 'not here' });
      const key = mm[1];
      const row = me.themes.get(key);
      const full = (r) => ({ key, name: r.name, revision: r.revision, updated_at: 'x', doc: r.doc });
      if (m === 'GET') return row ? json(200, { theme: full(row) }) : json(404, { error: 'theme not found' });
      if (m === 'DELETE') {
        if (!row) return json(404, { error: 'theme not found' });
        if (base !== null && base !== row.revision) return json(409, { error: 'revision conflict', code: 'BEUK-C803', theme: full(row) });
        me.themes.delete(key);
        return json(204);
      }
      const missing = (body.doc.assets || []).map((a) => a.sha256).filter((h) => !me.pictures.has(h));
      if (missing.length) return json(422, { error: 'assets not held', missingPictures: missing });
      if (base === null) {
        if (row) return json(428, { error: 'revision required', theme: full(row) });
        const r = { name: body.name, doc: body.doc, revision: 1 };
        me.themes.set(key, r);
        return json(201, { theme: full(r) });
      }
      if (!row) return json(404, { error: 'theme not found' });
      if (row.revision !== base) return json(409, { error: 'revision conflict', code: 'BEUK-C803', theme: full(row) });
      const r = { name: body.name, doc: body.doc, revision: row.revision + 1 };
      me.themes.set(key, r);
      return json(200, { theme: full(r) });
    });
  return acct;
}
const utReady = (p) => p.waitForFunction(() => document.getElementById('mineThemeGrid')?.getAttribute('data-ready') === '1', null, { timeout: 30_000 });
const utCards = (p) => p.$$eval('#mineThemeGrid [data-mine-key]', (els) => els.map((e) => ({ key: e.getAttribute('data-mine-key'), name: e.querySelector('.p-name')?.textContent ?? '' })));
const utCardsAre = (p, n) => p.waitForFunction((k) => document.querySelectorAll('#mineThemeGrid [data-mine-key]').length === k, n, { timeout: 30_000 });
async function utUploadFont(p) {
  await p.setInputFiles('#fontFileInput', w4File('Writer-Hand.ttf', readFileSync(W4_TTF)));
  await p.waitForFunction(() => /Writer Hand/.test(document.getElementById('fontList')?.innerText || ''), null, { timeout: 15_000 });
}
/** The creator, opened on the book's current styling (or on `edit`), its title set in the uploaded face, then 1.0's Save
 *  and "Keep for every book" (btnTcKeep) — or only Save. */
async function utDesign(p, name, { edit = null, keep = true } = {}) {
  await p.click(edit ? `#myThemeGrid [data-mine-edit="${edit}"]` : '#btnNewTheme');
  await p.waitForSelector('#tcElements [data-tc-font="title"]', { timeout: 10_000 });
  await p.fill('#tcName', name);
  await p.selectOption('#tcFont-title', 'Writer Hand');
  await p.click(keep ? '#btnTcKeep' : '#btnTcSave');
  await p.click('#btnTcClose');
}
/** Poll a condition in Node (the mocked account's state) while the page works. */
async function utUntil(p, fn, ms = 20_000) {
  for (let i = 0; i < ms / 100; i++) {
    if (fn()) return true;
    await p.waitForTimeout(100);
  }
  return fn();
}

async function userThemesSignedOut(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const salt = fixtures.find((x) => x.name === 'real/salt-road-standalone');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, lan.file);
    await w4OpenTab(page);
    await utReady(page);
    const where = await page.evaluate(() => [document.getElementById('mineThemeGrid').getAttribute('data-owner'), document.getElementById('mineThemesWhere').textContent]);
    check(where[0] === 'device', `userThemes signed out: My themes are this device's ("${where[1]}")`);
    await utUploadFont(page);
    await utDesign(page, 'Harbour Mine');
    await utCardsAre(page, 1);
    const bookA = (await exportBackup(page)).json.book;
    const ct = bookA.customThemes.find((x) => x.name === 'Harbour Mine');
    const key = ct && ct.id;
    const cards = await utCards(page);
    check(!!key && cards.length === 1 && cards[0].key === key && cards[0].name === 'Harbour Mine', `userThemes the creator's Keep for every book: saved into book A (1.0's Save) and kept (${JSON.stringify(cards)})`);
    check(!(await page.$('#mineThemesOffer')), "userThemes no offer while every theme of the book's is kept");

    // book B: My themes listed, browsing writes nothing; the theme applied with its face
    await openInNext(page, salt.file); // over A: 1.0's History snapshot of A is taken (wave 1a), so B is compared with itself
    const openedB = (await exportBackup(page)).json.book;
    await w4OpenTab(page);
    await utReady(page);
    await utCardsAre(page, 1);
    const startB = (await exportBackup(page)).json.book;
    check(JSON.stringify(startB) === JSON.stringify(openedB), "userThemes review focus #4: book B's Style tab opened with My themes listed: the export is unchanged");
    await page.click(`#mineThemeGrid [data-mine-key="${key}"]`);
    await page.waitForSelector(`#mineThemeGrid .preset-card.active[data-mine-key="${key}"]`, { timeout: 30_000 });
    const B = (await exportBackup(page)).json.book;
    const bCt = (B.customThemes || []).find((x) => x.id === key);
    check(B.activePreset === 'custom:' + key && !!bCt && JSON.stringify(B.theme) === JSON.stringify(bCt.theme) && JSON.stringify(bCt.theme) === JSON.stringify(ct.theme),
      `userThemes applied in book B: the theme copied in and worn (activePreset ${B.activePreset})`);
    check((B.fonts || []).length === 1 && B.fonts[0].family === 'Writer Hand' && B.fonts[0].data === bookA.fonts[0].data, "userThemes the theme's uploaded face is copied into B's fonts (1.0's shape, the same bytes)");
    check(JSON.stringify(B) === JSON.stringify(expected(B, B)), 'userThemes constraint 46: B after the apply is a 1.0 book (readBook reads it exactly, key order included)');
    const otherKeys = Object.keys(startB).filter((k) => !['theme', 'activePreset', 'customThemes', 'fonts', 'history', 'historyPool'].includes(k));
    check(otherKeys.every((k) => JSON.stringify(B[k]) === JSON.stringify(startB[k])), `userThemes the apply changed only the style keys (${otherKeys.length} others equal)`);
    // applying again: the face B holds is reused, nothing added
    await page.click(`#mineThemeGrid [data-mine-key="${key}"]`);
    await page.waitForTimeout(500);
    const B2 = (await exportBackup(page)).json.book;
    check((B2.fonts || []).length === 1 && JSON.stringify(B2) === JSON.stringify(B), 'userThemes dedupe: applying the same theme again adds nothing (the export is unchanged)');

    // 1.0 opens B: the theme worn, its face a loaded FontFace, its CSS in the book's stylesheet
    const one = await openOne(ctx, origin);
    const r1 = await one.evaluate(async (b) => {
      applyBookDoc(JSON.parse(JSON.stringify(b)));
      for (let i = 0; i < 50; i++) {
        if ([...document.fonts].some((x) => x.family.replace(/"/g, '') === 'Writer Hand')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const faces = [...document.fonts].filter((x) => x.family.replace(/"/g, '') === 'Writer Hand');
      await Promise.all(faces.map((x) => x.loaded.catch(() => undefined)));
      const s = serializeBook();
      return { theme: s.theme, activePreset: s.activePreset, customThemes: s.customThemes, fonts: s.fonts, faces: faces.map((x) => x.status).join(','), css: buildBookCss('.fc-page').includes("'Writer Hand'") };
    }, B);
    for (const k of ['theme', 'activePreset', 'customThemes', 'fonts']) check(JSON.stringify(r1[k]) === JSON.stringify(B[k]), `userThemes constraint 46: 1.0 reads B's ${k} back exactly`);
    check(/loaded/.test(r1.faces) && r1.css, `userThemes 1.0 wears the copied theme: its face is a loaded FontFace (${r1.faces}) and in the book's CSS (${r1.css})`);
    await harvestCsp(one);
    await one.close();

    // the one-time offer, on a book with a theme of its own
    const offerBook = structuredClone(lan.book);
    offerBook.meta = { ...offerBook.meta, bookId: '7c1d6a52-2b8f-4e57-9d3a-5f0e1c2b9a71', title: 'The Offer Book' };
    offerBook.customThemes = [{ id: 'ctOffer', name: 'Offer Theme', theme: { ...(offerBook.theme || {}), fontSize: 18 } }];
    const offerFile = w4File('offer.beuk-backup.json', JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date().toISOString(), book: offerBook }));
    await openInNext(page, offerFile);
    await w4OpenTab(page);
    await utReady(page);
    await page.waitForSelector('#mineThemesOffer', { timeout: 15_000 });
    const before = (await exportBackup(page)).json.book;
    await page.click('#btnMineOfferNo');
    await page.waitForSelector('#mineThemesOffer', { state: 'detached', timeout: 10_000 });
    const after = (await exportBackup(page)).json.book;
    check(JSON.stringify(after) === JSON.stringify(before), 'userThemes review focus #4: the offer declined: the export is unchanged');
    const ls = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('beuk.themes.')));
    check(ls.length === 1 && ls[0] === 'beuk.themes.offer.' + after.meta.bookId && !JSON.stringify(after).includes('beuk.themes'), `userThemes the answer is one beuk.* device key, never in the book (${ls.join(', ')})`);
    check((await utCards(page)).length === 1, 'userThemes declining keeps nothing');
    await page.reload();
    await page.waitForSelector('#topbar');
    await titleIs(page, 'The Offer Book');
    await w4OpenTab(page);
    await utReady(page);
    await page.waitForFunction(() => /Offer Theme/.test(document.getElementById('myThemeGrid')?.innerText || ''), null, { timeout: 15_000 });
    check(!(await page.$('#mineThemesOffer')), 'userThemes the offer is never shown twice for a book (after a reload)');
    await harvestCsp(page);

    // another device: nothing (signed out = this device only)
    const ctx2 = await newContext({ serviceWorkers: 'block' });
    try {
      const p2 = await openNext(ctx2, origin);
      await openBackup(p2, lan.file);
      await w4OpenTab(p2);
      await utReady(p2);
      check((await utCards(p2)).length === 0, 'userThemes signed out: another device lists none of them');
      await harvestCsp(p2);
    } finally {
      await ctx2.close();
    }
  } finally {
    await ctx.close();
  }
}

async function userThemesSignedIn(origin) {
  const errorsBefore = csp.errors.length;
  try {
    await userThemesSignedInRun(origin);
  } finally {
    // the deliberate 409 (the conflict below) is logged by Chromium as a failed resource: expected here, not a page error
    const mine = csp.errors.splice(errorsBefore);
    const expected409 = mine.filter((e) => /Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(e));
    csp.errors.push(...mine.filter((e) => !expected409.includes(e)));
    note(`userThemes: ${expected409.length} expected 409 resource line(s) from the conflict check set aside`);
  }
}
async function userThemesSignedInRun(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const salt = fixtures.find((x) => x.name === 'real/salt-road-standalone');
  const acct = themeAccount();
  const s1 = await newContext({ serviceWorkers: 'block' });
  const s2 = await newContext({ serviceWorkers: 'block' });
  try {
    await acct.install(s1, 'u1');
    await acct.install(s2, 'u1');
    const p1 = await openNext(s1, origin);
    await openBackup(p1, lan.file);
    await w4OpenTab(p1);
    await utReady(p1);
    check((await p1.getAttribute('#mineThemeGrid', 'data-owner')) === 'account', 'userThemes signed in: My themes are the account\'s');
    await utUploadFont(p1);
    await utDesign(p1, 'Account Theme');
    await utCardsAre(p1, 1);
    const key = (await utCards(p1))[0].key;
    const sent = await utUntil(p1, () => acct.of('u1').themes.get(key)?.revision === 1);
    const order = acct.log.filter((l) => / PUT /.test(l));
    const fontSha = [...acct.of('u1').pictures.keys()][0];
    check(sent && order.indexOf(`u1 PUT /api/pictures/${fontSha}`) >= 0 && order.indexOf(`u1 PUT /api/pictures/${fontSha}`) < order.indexOf(`u1 PUT /api/themes/${key}`),
      `userThemes signed in: the face's bytes are sent first, then the theme (${order.join(' → ')})`);

    // a second device of the same account: listed, applied with the face from the account's picture store
    const p2 = await openNext(s2, origin);
    await openBackup(p2, salt.file);
    await w4OpenTab(p2);
    await utReady(p2);
    await utCardsAre(p2, 1);
    await p2.click(`#mineThemeGrid [data-mine-key="${key}"]`);
    await p2.waitForSelector(`#mineThemeGrid .preset-card.active[data-mine-key="${key}"]`, { timeout: 30_000 });
    const B = (await exportBackup(p2)).json.book;
    check(acct.log.includes(`u1 GET /api/pictures/${fontSha}`) && (B.fonts || []).length === 1 && acct.sha(B.fonts[0].data) === fontSha && JSON.stringify(B) === JSON.stringify(expected(B, B)),
      'userThemes a second device applies it: the face fetched from the account\'s picture store, checked, copied in; the book a 1.0 book');

    // a 409 from the second context: device 2 changes the theme and keeps it (revision 2); device 1, still at 1, keeps its
    // own change — both are kept on device 1
    await utDesign(p2, 'Account Theme, second device', { edit: key, keep: false });
    await p2.click(`#myThemeGrid [data-mine-keep="${key}"]`);
    check(await utUntil(p2, () => acct.of('u1').themes.get(key)?.revision === 2), 'userThemes device 2 keeps its change (revision 2 on the account)');
    await utDesign(p1, 'Account Theme, first device', { edit: key, keep: false });
    await p1.click(`#myThemeGrid [data-mine-keep="${key}"]`);
    await utCardsAre(p1, 2);
    const both = (await utCards(p1)).map((x) => x.name).sort();
    const server = [...acct.of('u1').themes.values()].map((x) => x.name).sort();
    check(JSON.stringify(both) === JSON.stringify(['Account Theme, first device (this device)', 'Account Theme, second device']), `userThemes constraint 49: a 409 keeps both on device 1 (${both.join(' | ')})`);
    check(await utUntil(p1, () => acct.of('u1').themes.size === 2), `userThemes the kept edit is sent as a theme of its own (${server.join(' | ')} → ${[...acct.of('u1').themes.values()].map((x) => x.name).join(' | ')})`);

    // offline: a kept theme survives a reload and is sent when the account answers again
    acct.fail = true;
    await utDesign(p1, 'Offline Theme');
    await utCardsAre(p1, 3);
    await p1.reload();
    await p1.waitForSelector('#topbar');
    await w4OpenTab(p1);
    await utReady(p1);
    await utCardsAre(p1, 3);
    const listed = (await utCards(p1)).some((x) => x.name === 'Offline Theme');
    check(listed && ![...acct.of('u1').themes.values()].some((x) => x.name === 'Offline Theme'), 'userThemes constraint 49: an offline write survives a reload (listed from the device, not on the account yet)');
    acct.fail = false;
    await p1.evaluate(() => window.dispatchEvent(new Event('online')));
    check(await utUntil(p1, () => [...acct.of('u1').themes.values()].some((x) => x.name === 'Offline Theme')), 'userThemes …and is sent when the browser is back online');
    for (const p of [p1, p2]) await harvestCsp(p);
  } finally {
    await s1.close();
    await s2.close();
  }
}

async function userThemesHostile(origin) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const acct = themeAccount();
  const evilSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pw=1"><script>window.__pw=1</script><path d="M0 0h9"/></svg>').toString('base64');
  const notAFont = Buffer.from('<html><body onload="window.__pw=1"></body></html>' + 'x'.repeat(1500)).toString('base64');
  const name = '<img src=x onerror="window.__pw=1">';
  acct.of('u3').pictures.set(acct.sha(evilSvg), { mediaType: 'image/svg+xml', data: evilSvg });
  acct.of('u3').pictures.set(acct.sha(notAFont), { mediaType: 'font/ttf', data: notAFont });
  acct.of('u3').themes.set('hostile1', {
    name,
    revision: 1,
    doc: {
      id: 'hostile1',
      name,
      theme: {
        bodyFont: "x'}body *{visibility:hidden}.q{font-family:'",
        headFont: 'Bad Face',
        headerStyle: 'classic_centered" onmouseover="window.__pw=1',
        indentDepth: '1em;background:url(https://evil.example/i)',
        fontSize: '18px;background:url(https://evil.example/s)',
        lineHeight: 1.6,
        ornament: 'fl:flH',
        headingFlourish: 'flH',
        header: { title: { font: "a'),url(https://evil.example/f", size: 2, align: 'center', casing: 'asis', above: 0, below: 0 } },
      },
      assets: [
        { kind: 'flourish', sha256: acct.sha(evilSvg), mediaType: 'image/svg+xml', id: 'flH', name: 'h.svg', ext: 'svg' },
        { kind: 'font', sha256: acct.sha(notAFont), mediaType: 'font/ttf', id: 'fB', name: 'bad.ttf', family: 'Bad Face', ext: 'ttf' },
      ],
    },
  });
  const ctx = await newContext({ serviceWorkers: 'block' });
  const outside = [];
  try {
    await acct.install(ctx, 'u3');
    const page = await openNext(ctx, origin);
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
    });
    await openBackup(page, lan.file);
    await w4OpenTab(page);
    await utReady(page);
    await utCardsAre(page, 1);
    const card = (await utCards(page))[0];
    check(card.key === 'hostile1' && card.name === name, 'userThemes constraint 48: a hostile My theme is listed, its name as text');
    await page.click('#mineThemeGrid [data-mine-key="hostile1"]');
    await page.waitForSelector('#mineThemeGrid .preset-card.active[data-mine-key="hostile1"]', { timeout: 30_000 });
    await page.waitForTimeout(600); // the preview's redraw (120 ms) and the desk's
    const seen = await page.evaluate(() => {
      const roots = ['panelType', 'pane-preview'].map((id) => document.getElementById(id)).filter(Boolean);
      const attrs = roots.flatMap((r) => [...r.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name + '=' + a.value)));
      const sheets = [...document.querySelectorAll('style')].map((s) => s.textContent || '').join('\n');
      return {
        pw: window.__pw ?? null,
        handlers: attrs.filter((a) => /^on/i.test(a)).length,
        remote: attrs.filter((a) => /evil\.example|javascript:/i.test(a)).length,
        scripts: roots.reduce((n, r) => n + r.querySelectorAll('script, iframe, object').length, 0),
        sheetEvil: /evil\.example|visibility:\s*hidden/.test(sheets),
      };
    });
    check(seen.pw === null && seen.handlers === 0 && seen.remote === 0 && seen.scripts === 0 && !seen.sheetEvil,
      `userThemes constraint 48: the hostile My theme applied — no handler, script or remote address in the tab or the preview, none in the stylesheets (${JSON.stringify(seen)})`);
    const out = (await exportBackup(page)).json.book;
    const th = out.theme;
    check(th.bodyFont === 'EB Garamond' && th.headerStyle === 'classic_centered' && th.indentDepth === '1.5em' && typeof th.fontSize === 'number' && th.header.title.font === th.headFont,
      `userThemes the hostile values corrected by the safe path before 1.0's code saw them (${JSON.stringify({ body: th.bodyFont, head: th.headFont, hs: th.headerStyle, indent: th.indentDepth, size: th.fontSize })})`);
    check(!(out.images || []).some((im) => im.flourish) && !(out.fonts || []).length, 'userThemes the bytes 1.0\'s uploads would refuse (an SVG with a script, a "font" that is HTML) are never added');
    check(JSON.stringify(out) === JSON.stringify(expected(out, out)), 'userThemes the book after the hostile apply is a 1.0 book (readBook reads it exactly)');
    check(outside.length === 0, `userThemes no request leaves the page (${outside.length}${outside.length ? ': ' + outside.slice(0, 3).join(', ') : ''})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

async function userThemesChecks(origin) {
  const parts = (process.env.UT_PARTS || 'out,in,hostile').split(',');
  if (parts.includes('out')) await userThemesSignedOut(origin);
  if (parts.includes('in')) await userThemesSignedIn(origin);
  if (parts.includes('hostile')) await userThemesHostile(origin);
}

/* ---- wave 7a: sign-in, the shelf, conflicts, account (constraints 84-91) ----
   A server of its own for this step (serve.mjs { api: true }): the REAL app (src/app.ts) on PGlite, mail captured, never
   sent; billing on against a fake Stripe on 127.0.0.1 for the day-22 states. 1.0 (/studio) and 2.0 (/next) run beside
   each other on the same origin, as the same account. 1.0's own functions are called by name in its page (its classic
   script's globals), the way the earlier waves drive it. */
const W7A_PW = 'correct horse battery';
let w7aSeq = 0;
const w7aEmail = (tag) => `w7a-${tag}-${++w7aSeq}-${Date.now()}@example.test`;
async function w7aFakeStripe() {
  const { createServer } = await import('node:http');
  const calls = [];
  const s = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/checkout/sessions')) return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.example.test/1' }));
    if (req.url.startsWith('/v1/billing_portal/sessions')) return res.end(JSON.stringify({ id: 'bps_1', url: 'https://portal.example.test/1' }));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${s.address().port}`, calls, close: () => new Promise((r) => s.close(r)) };
}
/** Sign up `email` in this context (its pages share the session cookie). */
async function w7aSignUp(ctx, origin, email) {
  const r = await ctx.request.post(origin + '/api/auth/register', { data: { email, password: W7A_PW } });
  return r.status();
}
/** Every manuscript write a page sends (method, path, body). */
function w7aWrites(page) {
  const out = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.method() !== 'GET') out.push({ method: r.method(), path: u.pathname + u.search, body: r.postData(), headers: r.headers() });
  });
  return out;
}
const w7aManuscriptWrites = (list) => list.filter((x) => x.path.startsWith('/api/manuscripts') && (x.method === 'PUT' || x.method === 'POST'));
/** 2.0 on the shelf server, signed in, with `file` open (its backup). */
async function w7aNext(ctx, origin, file) {
  const page = await openNext(ctx, origin);
  const seen = [];
  w7aNet.set(page, seen);
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) seen.push({ method: r.request().method(), path: u.pathname, status: r.status() }); });
  page.on("console", (m) => { if (process.env.W7A_CONSOLE) console.log("     [page]", m.type(), m.text().slice(0, 300)); });
  await openBackup(page, file);
  await w7aWait(page, () => window.beukCloud?.cloud?.user && window.beukCloud.cloud.available, null, 30_000);
  return page;
}
async function w7aOne(ctx, origin) {
  const one = await openOne(ctx, origin);
  await w7aWait(one, () => typeof cloud !== 'undefined' && cloud.available && !!cloud.user, null, 30_000);
  return one;
}
/** waitForFunction, which on a timeout says where the shelf stood (the cloud fields, the sync line, the open dialogs). */
const w7aNet = new WeakMap();
async function w7aWait(page, fn, arg, timeout = 60_000) {
  try {
    return await page.waitForFunction(fn, arg, { timeout });
  } catch (e) {
    const at = await page.evaluate(() => { const c = window.beukCloud?.cloud; return JSON.stringify({ user: !!c?.user, available: c?.available, linkState: c?.linkState, linkedId: c?.linkedId, syncStatus: c?.syncStatus, rev: c?.baseRevision, dirty: window.beukCloud?.dirty, arriving: window.beukCloud?.arriving?.(), sync: document.getElementById("syncText")?.textContent, open: [...document.querySelectorAll(".modal-back.open")].map((x) => x.id), confirm: document.getElementById("confirmTitle")?.textContent, toasts: [...document.querySelectorAll("#toasts .toast")].map((x) => x.textContent) }); }).catch(() => "?");
    const net = (w7aNet.get(page) || []).slice(-8).map((x) => x.method + " " + x.path + " " + (x.status ?? ""));
    throw new Error(String(e.message).split(String.fromCharCode(10))[0] + " — the shelf stood: " + at + " — its last requests: " + JSON.stringify(net));
  }
}
const w7aDiffKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])).map((k) => k + (k === 'meta' ? '(' + w7aDiffKeys(a?.[k], b?.[k]).join(',') + ')' : ''));
const w7aId = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');

/* 85: parity beside 1.0 — the shelf copy 2.0 sends equals 1.0's for the same book, and each app opens the other's. */
async function wave7aParity(srv, given = null) {
  const origin = srv.origin;
  const list = (process.env.W7A_FIXTURES || '').split(',').filter(Boolean);
  // a book with no sections array is refused as a backup by both apps (1.0's localParseBackup; #1 holds it): it never
  // reaches a desk, so it never reaches the shelf (wave 7b: `given`, books of its own — the hostile book)
  const books = (given || (list.length ? fixtures.filter((f) => list.includes(f.name)) : fixtures)).filter((f) => Array.isArray(f.book.sections));
  note(`wave7a parity: ${books.length} books (${fixtures.length - books.length} refused as backups by both apps: no sections array)`);
  let same = 0, opened2 = 0, opened1 = 0;
  const bad = [];
  for (const f of books) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      check((await w7aSignUp(ctx, origin, w7aEmail('p'))) === 201, `wave7a parity ${f.name}: signed up`);
      const page = await w7aNext(ctx, origin, f.file);
      const w2 = w7aWrites(page);
      const start = (await exportBackup(page)).json.book;
      await page.click('#btnAccount');
      await page.waitForSelector('#modalShelf.open');
      await page.click('#btnBringBook');
      await w7aWait(page, () => window.beukCloud.cloud.linkState === 'linked', null, 60_000);
      const post2 = w7aManuscriptWrites(w2).find((x) => x.method === 'POST');
      const id2 = await page.evaluate(() => window.beukCloud.cloud.linkedId);
      // 1.0: the same book on its desk, brought to the shelf by its own cloudBringBook
      const one = await w7aOne(ctx, origin);
      const w1 = w7aWrites(one);
      await one.evaluate(async (b) => {
        applyBookDoc(JSON.parse(JSON.stringify(b)));
        await cloudBringBook();
      }, start);
      const post1 = w7aManuscriptWrites(w1).find((x) => x.method === 'POST');
      const id1 = await one.evaluate(() => cloud.linkedId);
      const eq = !!post1 && !!post2 && post1.body === post2.body;
      if (eq) same++;
      else bad.push(f.name + ' (save)');
      // 1.0 opens 2.0's copy: what 1.0 then holds is what it held of its own
      const mine1 = await one.evaluate(() => JSON.stringify(serializeBook()));
      await one.evaluate(async (id) => {
        cloudDirty = false;
        await cloudOpenBook(id);
      }, id2);
      const got1 = await one.evaluate(() => JSON.stringify(serializeBook()));
      // by 1.0's own rule for "the same book" (bookDocsSame: stableJson, key order aside — 1.0's arrival of its own
      // serialized document orders meta's keys differently from its arrival of 2.0's export, OBSERVED: only meta's order)
      if (got1 === mine1 || (await one.evaluate(([a, b]) => bookDocsSame(JSON.parse(a), JSON.parse(b)), [got1, mine1]))) opened1++;
      else bad.push(f.name + " (1.0 opens 2.0's: " + w7aDiffKeys(JSON.parse(got1), JSON.parse(mine1)).join(' ') + ')');
      // 2.0 opens 1.0's copy from its shelf list
      await page.bringToFront();
      await page.evaluate(() => document.getElementById('modalShelf').classList.remove('open'));
      await page.click('#btnAccount');
      await page.waitForSelector(`#shelfList [data-open-book="${id1}"]`, { timeout: 30_000 });
      await page.click(`#shelfList [data-open-book="${id1}"]`);
      await w7aWait(page, (id) => window.beukCloud.cloud.linkedId === id && !window.beukCloud.arriving(), id1, 60_000);
      await page.waitForTimeout(300);
      const back = (await exportBackup(page)).json.book;
      // what 2.0 holds of a shelf copy is readBook's book of it (the 1.0 document 1.0 wrote, its pictures filled in)
      const shelfDoc = (await (await ctx.request.get(origin + '/api/manuscripts/' + id1)).json()).manuscript.doc;
      const want = expected(shelfDoc, back);
      if (JSON.stringify(back) === JSON.stringify(want)) opened2++;
      else bad.push(f.name + " (2.0 opens 1.0's: " + w7aDiffKeys(back, want).join(' ') + ')');
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
  check(same === books.length, `wave7a constraint 85: the shelf copy 2.0 sends equals 1.0's, byte for byte, for ${same} of ${books.length} books${bad.length ? ' — ' + bad.join('; ') : ''}`);
  check(opened1 === books.length, `wave7a constraint 85: 1.0 opens 2.0's shelf copy as its own for ${opened1} of ${books.length}`);
  check(opened2 === books.length, `wave7a constraint 85: 2.0 opens 1.0's shelf copy as readBook reads it for ${opened2} of ${books.length}`);
}

/* 86 + decision 3: two devices raise 1.0's three-way notice; two tabs of one device never do. */
async function wave7aConflict(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const email = w7aEmail('c');
  const devA = await newContext({ serviceWorkers: 'block' });
  const devB = await newContext({ serviceWorkers: 'block' });
  try {
    await w7aSignUp(devA, origin, email);
    const a = await w7aNext(devA, origin, f.file);
    await a.click('#btnAccount');
    await a.waitForSelector('#modalShelf.open');
    await a.click('#btnBringBook');
    await w7aWait(a, () => window.beukCloud.cloud.linkState === 'linked', null, 60_000);
    const id = await a.evaluate(() => window.beukCloud.cloud.linkedId);
    await a.evaluate(() => document.getElementById('modalShelf').classList.remove('open'));
    // device B: the same account, the book opened from its shelf
    const login = await devB.request.post(origin + '/api/auth/login', { data: { email, password: W7A_PW } });
    check(login.status() === 200, 'wave7a constraint 86: device B signed in');
    const b = await openNext(devB, origin);
    await w7aWait(b, () => window.beukCloud?.cloud?.user, null, 30_000);
    await b.click('#btnAccount');
    await b.waitForSelector(`#shelfList [data-open-book="${id}"]`, { timeout: 30_000 });
    await b.click(`#shelfList [data-open-book="${id}"]`);
    await w7aWait(b, (x) => window.beukCloud.cloud.linkedId === x && !window.beukCloud.arriving(), id, 60_000);
    await b.waitForSelector('#manuscript .ms-editor', { timeout: 30_000 });
    // A types and saves; then B types (its base is the older revision)
    for (const [p, word] of [[a, ' Alpha-side.'], [b, ' Beta-side.']]) {
      await p.bringToFront();
      await p.click('#manuscript .ms-editor');
      await focused(p);
      await p.keyboard.press('End');
      await p.keyboard.type(word);
      if (p === a) await w7aWait(a, () => window.beukCloud.cloud.syncStatus === 'saved' && !window.beukCloud.dirty, null, 30_000);
    }
    await b.waitForSelector('#modalConflict.open', { timeout: 30_000 });
    const words = await b.evaluate(() => ({ title: document.getElementById('conflictTitle').textContent, buttons: ['btnConflictShelf', 'btnConflictBoth', 'btnConflictMine'].map((x) => document.getElementById(x).textContent) }));
    // 1.0's own words for the notice, in its page
    const one = await w7aOne(devB, origin);
    const want = await one.evaluate(() => ({ title: t('offline.conflictTitle'), buttons: [t('offline.useShelf'), t('offline.keepBoth'), t('offline.keepMine')] }));
    check(JSON.stringify(words) === JSON.stringify(want), `wave7a constraint 86: device B shows 1.0's three-way notice: ${JSON.stringify(words)}`);
    await b.bringToFront();
    await b.click('#btnConflictBoth');
    await w7aWait(b, () => !document.getElementById('modalConflict').classList.contains('open') && window.beukCloud.cloud.syncStatus === 'saved', null, 30_000);
    const hb = (await exportBackup(b)).json.book;
    check(Array.isArray(hb.history) && hb.history[0] && hb.history[0].auto === 'conflict', `wave7a constraint 86: Keep both — History's newest snapshot is the shelf copy ("${hb.history?.[0]?.name}")`);
    const shelf = await (await devB.request.get(origin + '/api/manuscripts/' + id)).json();
    const text = JSON.stringify(shelf.manuscript.doc.sections);
    check(text.includes('Beta-side.') && !text.includes('Alpha-side.'), 'wave7a constraint 86: Keep both — the shelf holds device B\'s writing; device A\'s is kept in B\'s History');
    await harvestCsp(a);
    await harvestCsp(b);
    await harvestCsp(one);
  } finally {
    await devA.close();
    await devB.close();
  }
  // decision 3: two tabs of one device on the same book — one writer, no conflict
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    await w7aSignUp(ctx, origin, w7aEmail('t'));
    const t1 = await w7aNext(ctx, origin, f.file);
    await t1.click('#btnAccount');
    await t1.waitForSelector('#modalShelf.open');
    await t1.click('#btnBringBook');
    await w7aWait(t1, () => window.beukCloud.cloud.linkState === 'linked', null, 60_000);
    await t1.evaluate(() => document.getElementById('modalShelf').classList.remove('open'));
    const w1 = w7aWrites(t1);
    const t2 = await watch(await ctx.newPage());
    const w2 = w7aWrites(t2);
    await t2.goto(origin + '/next/');
    await w7aWait(t2, () => window.beukCloud?.cloud?.user && window.beukCloud.cloud.linkState === 'linked', null, 30_000);
    const leaders = [await t1.evaluate(() => window.beukCloud.leader()), await t2.evaluate(() => window.beukCloud.leader())];
    check(leaders.filter(Boolean).length === 1, `wave7a decision 3: one writer for the book on this device (leaders ${JSON.stringify(leaders)})`);
    for (const [p, word] of [[t2, ' Tab-two.'], [t1, ' Tab-one.'], [t2, ' Tab-two again.']]) {
      await p.bringToFront();
      await p.click('#manuscript .ms-editor');
      await focused(p);
      await p.keyboard.press('End');
      await p.keyboard.type(word);
      await p.waitForTimeout(3500);
    }
    await t1.waitForTimeout(3000);
    const puts = [...w7aManuscriptWrites(w1), ...w7aManuscriptWrites(w2)];
    const conflicts = [await t1.$('#modalConflict.open'), await t2.$('#modalConflict.open')].filter(Boolean).length;
    const fromFollower = (leaders[0] ? w7aManuscriptWrites(w2) : w7aManuscriptWrites(w1)).length;
    check(conflicts === 0, `wave7a decision 3: two tabs raise no conflict (${conflicts} notices)`);
    check(fromFollower === 0 && puts.length >= 1, `wave7a decision 3: only the writer tab saves (${puts.length} saves, ${fromFollower} from the other tab)`);
    const status = [await t1.evaluate(() => window.beukCloud.cloud.syncStatus), await t2.evaluate(() => window.beukCloud.cloud.syncStatus)];
    note(`wave7a decision 3: the sync status in each tab: ${JSON.stringify(status)}`);
    const id = await t1.evaluate(() => window.beukCloud.cloud.linkedId);
    const shelf = await (await ctx.request.get(origin + '/api/manuscripts/' + id)).json();
    const text = JSON.stringify(shelf.manuscript.doc.sections);
    check(['Tab-two.', 'Tab-one.', 'Tab-two again.'].every((w) => text.includes(w)), 'wave7a decision 3: the shelf holds the writing of both tabs');
    await harvestCsp(t1);
    await harvestCsp(t2);
  } finally {
    await ctx.close();
  }
}

/* 87: opening, switching books, viewing the account, leaving and coming back send no manuscript write. */
async function wave7aNoEdit(srv) {
  const origin = srv.origin;
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    await w7aSignUp(ctx, origin, w7aEmail('g'));
    const page = await w7aNext(ctx, origin, fixtures.find((x) => x.name === 'real/salt-road-book-one').file);
    await page.click('#btnAccount');
    await page.waitForSelector('#modalShelf.open');
    await page.click('#btnBringBook');
    await w7aWait(page, () => window.beukCloud.cloud.linkState === 'linked', null, 60_000);
    const id1 = await page.evaluate(() => window.beukCloud.cloud.linkedId);
    // a second book on the shelf (made through the API, as another device would)
    const made = await (await ctx.request.post(origin + '/api/manuscripts', { data: { title: 'Second', doc: fixtures.find((x) => x.name === 'real/reads-you').book } })).json();
    const writes = w7aWrites(page);
    const steps = [];
    await page.reload();
    await w7aWait(page, () => window.beukCloud?.cloud?.user && window.beukCloud.cloud.linkState === 'linked', null, 30_000);
    steps.push('reload');
    if (process.env.W7A_DEBUG) { for (let i = 0; i < 6; i++) { note('DBG ' + await page.evaluate(() => JSON.stringify({ ls: window.beukCloud.cloud.linkState, id: window.beukCloud.cloud.linkedId, dirty: window.beukCloud.dirty, st: window.beukCloud.cloud.syncStatus, leader: window.beukCloud.leader(), conflict: !!window.beukCloud.cloud.conflict }))); await page.waitForTimeout(700); } }
    for (const id of [made.manuscript.id, id1]) {
      await page.click('#btnAccount');
      await page.waitForSelector(`#shelfList [data-open-book="${id}"]`, { timeout: 30_000 });
      await page.click(`#shelfList [data-open-book="${id}"]`);
      await w7aWait(page, (x) => window.beukCloud.cloud.linkedId === x && !window.beukCloud.arriving(), id, 60_000);
      steps.push('opened ' + w7aId(id));
    }
    await page.click('#btnAccount');
    await page.waitForSelector('#modalShelf.open');
    await page.click('#acctBox summary');
    await page.click('#btnCloseShelf');
    steps.push('account viewed');
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(4000);
    steps.push('hidden and back, 4 s');
    const w = w7aManuscriptWrites(writes);
    check(w.length === 0, `wave7a constraint 87: ${steps.join(', ')} — ${w.length} manuscript writes${w.length ? ' ' + JSON.stringify(w.map((x) => x.method + ' ' + w7aId(x.path))) : ''}`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/* 88 + 89: the day-22 states (trial, paid, day 22 unpaid, signed out, offline) beside 1.0: the plan line, the print-ready
   panel's words and the server's refusal as the only lock; in the paid state the print-ready job's requests equal 1.0's. */
async function wave7aDay22(srv) {
  const origin = srv.origin;
  const db = srv.shelf.db;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  for (const st of ['trial', 'paid', 'day22', 'signedout', 'offline']) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      const email = w7aEmail(st);
      if (st !== 'signedout') await w7aSignUp(ctx, origin, email);
      if (st === 'day22') await db.query("update users set trial_ends_at = now() - interval '1 day' where email = $1", [email]);
      if (st === 'paid') {
        const uid = (await db.query('select id from users where email = $1', [email])).rows[0].id;
        await db.query("update users set trial_ends_at = now() - interval '1 day', stripe_customer_id = $2 where id = $1", [uid, 'cus_' + uid.slice(0, 8)]);
        await db.query("insert into billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, status_since, price_ids, livemode) values ($1, $2, $3, 'active', now(), $4, false)", ['sub_' + uid.slice(0, 8), uid, 'cus_' + uid.slice(0, 8), ['price_fixture']]);
      }
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      await w7aWait(page, (so) => window.beukCloud?.cloud?.available && (so || !!window.beukCloud.cloud.user), st === 'signedout', 30_000);
      const one = await openOne(ctx, origin);
      await w7aWait(one, (so) => typeof cloud !== 'undefined' && cloud.available && (so || !!cloud.user), st === 'signedout', 30_000);
      const start = (await exportBackup(page)).json.book;
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      if (st === 'offline') {
        await ctx.setOffline(true);
        for (const p of [page, one]) await p.evaluate(() => window.dispatchEvent(new Event('offline')));
      }
      // the plan line (signed in)
      if (st !== 'signedout' && st !== 'offline') {
        await page.click('#btnAccount');
        await page.waitForSelector('#modalShelf.open');
        await page.waitForTimeout(800);
        const two = await page.evaluate(() => ({ hidden: document.getElementById('planLine').hidden, text: document.getElementById('planText').textContent, up: document.getElementById('btnPlanUpgrade').hidden, mg: document.getElementById('btnPlanManage').hidden }));
        await one.evaluate(() => { renderShelfList(); $('modalShelf').classList.add('open'); return portalRefresh(); });
        await one.waitForTimeout(800);
        const oneSaw = await one.evaluate(() => ({ hidden: document.getElementById('planLine').hidden, text: document.getElementById('planText').textContent, up: document.getElementById('btnPlanUpgrade').hidden, mg: document.getElementById('btnPlanManage').hidden }));
        check(JSON.stringify(two) === JSON.stringify(oneSaw), `wave7a constraint 88 (${st}): the plan line reads as 1.0's: ${JSON.stringify(two)}${JSON.stringify(two) === JSON.stringify(oneSaw) ? '' : ' — 1.0: ' + JSON.stringify(oneSaw)}`);
        // wave 7b (the 7a gap): the account box in this state, opened, beside 1.0's
        const acct = (p) => p.evaluate(() => {
          document.getElementById('acctBox').open = true;
          const shown = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.style.display !== 'none'; };
          return { box: document.getElementById('acctBox').textContent.replace(/\s+/g, ' ').trim(), email: document.getElementById('shelfEmail').textContent, confirm: shown('portalConfirm'), signOut: shown('btnSignOut') };
        });
        const a2 = await acct(page), a1 = await acct(one);
        check(JSON.stringify(a2) === JSON.stringify(a1), `wave7a constraint 88 (${st}): the account box reads as 1.0's${JSON.stringify(a2) === JSON.stringify(a1) ? '' : ' — 2.0: ' + JSON.stringify(a2).slice(0, 200) + ' — 1.0: ' + JSON.stringify(a1).slice(0, 200)}`);

        await page.click('#btnCloseShelf');
        await one.evaluate(() => $('modalShelf').classList.remove('open'));
      }
      // the print-ready panel: the same button in each app, the words it ends on, the requests it sent
      const w2 = w7aWrites(page), w1 = w7aWrites(one);
      await page.bringToFront();
      await page.click('#btnExport');
      await page.waitForSelector('#modalExport.open #btnPrintReadyPdf', { timeout: 60_000 });
      await page.click('#btnPrintReadyPdf');
      await page.waitForTimeout(6000);
      const twoNote = await page.evaluate(() => document.getElementById('printReadyNote')?.textContent ?? '');
      await one.bringToFront();
      await one.evaluate(() => { $('modalExport').classList.add('open'); $('btnPrintReadyPdf').click(); });
      await one.waitForTimeout(6000);
      const oneNote = await one.evaluate(() => document.getElementById('printReadyNote')?.textContent ?? '');
      check(twoNote === oneNote, `wave7a constraint 88 (${st}): the print-ready panel says 1.0's words: "${twoNote.slice(0, 110)}"${twoNote === oneNote ? '' : ' — 1.0: "' + oneNote.slice(0, 110) + '"'}`);
      const shape = (l) => l.filter((x) => /\/api\/(exports|jobs)/.test(x.path)).map((x) => x.method + ' ' + w7aId(x.path).replace(/filename=[^&]*/, 'filename=<f>') + (x.path.startsWith('/api/jobs') ? ' ' + Object.keys(JSON.parse(x.body || '{}')).join(',') : ''));
      const r2 = shape(w2), r1 = shape(w1);
      check(JSON.stringify(r2) === JSON.stringify(r1), `wave7a constraint ${st === 'paid' ? 89 : 88} (${st}): the server requests equal 1.0's: ${JSON.stringify(r2)}`);
      if (st === 'day22' || st === 'signedout' || st === 'offline') check(r2.length === 0 || st === 'day22', `wave7a constraint 88 (${st}): nothing is sent the server would refuse unless 1.0 sends it too (${r2.length} sent, 1.0 ${r1.length})`);
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
}

/* 90: a hostile display name and a hostile shelf title carry nothing into any modal; no password reaches storage. */
async function wave7aSafety(srv) {
  const origin = srv.origin;
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const email = '"><img src=x onerror=window.__pw=1>' + w7aEmail('h');
    const st = await w7aSignUp(ctx, origin, email);
    note(`wave7a constraint 90: a hostile e-mail address signs up with ${st} (the server's own check)`);
    if (st !== 201) await w7aSignUp(ctx, origin, w7aEmail('h2'));
    const evil = '<img src=x onerror="window.__pw=1"><script>window.__pw=2</script>';
    await ctx.request.post(origin + '/api/manuscripts', { data: { title: evil, doc: { meta: { title: evil }, sections: [{ id: 's1', kind: 'body', type: 'chapter', title: evil, content: 'x' }] } } });
    const page = await w7aNext(ctx, origin, fixtures.find((x) => x.name === 'real/reads-you').file);
    await page.click('#btnAccount');
    await page.waitForSelector('#shelfList .shelf-row', { timeout: 30_000 });
    const live = await page.evaluate(() => ({ pw: window.__pw ?? null, imgs: document.querySelectorAll('#modalShelf img, #btnAccount img').length, scripts: document.querySelectorAll('#modalShelf script').length, handlers: [...document.querySelectorAll('#modalShelf *, #btnAccount *')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length, shown: [...document.querySelectorAll('#shelfList .sh-title')].some((x) => x.textContent.includes('<script>')) }));
    check(live.pw === null && live.imgs === 0 && live.scripts === 0 && live.handlers === 0 && live.shown, `wave7a constraint 90: a hostile title on the shelf: nothing ran, no element or handler carried in (${JSON.stringify(live)})`);
    const store = await page.evaluate(() => JSON.stringify(localStorage));
    check(!store.includes(W7A_PW_PROBE) && !/password/i.test(store), 'wave7a constraint 90: no credential in localStorage');
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}
const W7A_PW_PROBE = W7A_PW;

/* Screenshots (the Finish): the sign-in dialog, the shelf, the account box and the conflict notice beside 1.0's, in Paper,
   Candlelight and Arabic. */
async function wave7aScreens(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await newContext();
  const diffPage = await diffCtx.newPage();
  const out = [];
  try {
    for (const look of ['paper', 'candlelight', 'ar']) {
      const ctx = await newContext({ serviceWorkers: 'block' });
      await ctx.addInitScript((l) => {
        if (l === 'candlelight') localStorage.setItem('beuk.theme.v1', 'candlelight');
        if (l === 'ar') localStorage.setItem('beuk.uiLang.v1', 'ar');
      }, look);
      try {
        const page = await openNext(ctx, origin);
        await openBackup(page, f.file);
        await w7aWait(page, () => window.beukCloud?.cloud?.available, null, 30_000);
        const one = await openOne(ctx, origin);
        await w7aWait(one, () => typeof cloud !== 'undefined' && cloud.available, null, 30_000);
        const shot = async (p, sel) => {
          await p.waitForTimeout(400);
          const el = await p.$(sel);
          return el ? el.screenshot({ animations: 'disabled' }) : null;
        };
        // the sign-in dialog
        await page.click('#btnAccount');
        await one.evaluate(() => openAuth());
        const a2 = await shot(page, '#modalAuth .modal'), a1 = await shot(one, '#modalAuth .modal');
        await page.keyboard.press('Escape');
        await one.evaluate(() => closeAuth());
        // signed in: the shelf and the account box
        const email = w7aEmail('s' + look);
        await w7aSignUp(ctx, origin, email);
        await page.reload();
        await w7aWait(page, () => window.beukCloud?.cloud?.user, null, 30_000);
        await one.reload();
        await w7aWait(one, () => typeof cloud !== 'undefined' && !!cloud.user, null, 30_000);
        // 1.0's desk holds the same book (its reload opened its own device's book)
        const start = (await exportBackup(page)).json.book;
        await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
        await page.click('#btnAccount');
        await page.waitForSelector('#modalShelf.open');
        await one.evaluate(() => $('btnAccount').click());
        // (wave 7b: 2.0 shows 1.0's bulk import block too, G3: compared as it stands in both)

        for (const p of [page, one]) await p.evaluate(() => { document.getElementById('acctBox').open = true; });
        const s2 = await shot(page, '#modalShelf .modal'), s1 = await shot(one, '#modalShelf .modal');
        await page.keyboard.press('Escape');
        await one.evaluate(() => $('modalShelf').classList.remove('open'));
        // the conflict notice, as each app words it for this book
        await page.evaluate(() => window.beukCloud.api.raiseConflict({ doc: {}, updatedAt: '2026-11-01T10:00:00.000Z' }));
        await one.evaluate(() => raiseConflict({ doc: {}, updatedAt: '2026-11-01T10:00:00.000Z' }));
        const c2 = await shot(page, '#modalConflict .modal'), c1 = await shot(one, '#modalConflict .modal');
        for (const [name, x, y] of [['auth', a2, a1], ['shelf', s2, s1], ['conflict', c2, c1]]) {
          if (!x || !y) {
            out.push(`${look} ${name}: not drawn`);
            continue;
          }
          writeFileSync(path.join(OUT, `w7a-${look}-${name}-next.png`), x);
          writeFileSync(path.join(OUT, `w7a-${look}-${name}-1.0.png`), y);
          const d = await pixelDiff(diffPage, x, y);
          out.push(`${look} ${name}: ${(d.ratio * 100).toFixed(2)} %${d.size[0] !== d.size[2] || d.size[1] !== d.size[3] ? ' (sizes ' + d.size.join('×') + ')' : ''}`);
        }
        await harvestCsp(page);
        await harvestCsp(one);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
  note('wave7a screenshots (2.0 against 1.0, pixels over the delta): ' + out.join('; '));
}

/* 91: the Dumas typing measure with the shelf signed in and the autosave running. */
async function wave7aLatency(srv) {
  // wave 7b, the carried latency finding — knobs for the A/B (each reported in step5-wave7b-report.md):
  // W7A_LAT_OUT=1 the same real server, signed out; W7A_LAT_CSS=<css> a style added after the book opens (e.g. the sync
  // dot's pulse switched off); W7A_LAT_DOT=1 one extra element running 1.0's syncPulse (signed out, the pulse alone);
  // LAT_TOP=<n> more lines of the profile
  const out = !!process.env.W7A_LAT_OUT;
  const r = await latency(srv.origin, { prepare: async (ctx) => (out ? undefined : w7aSignUp(ctx, srv.origin, w7aEmail('l'))), afterOpen: async (page) => { await w7aWait(page, out ? () => window.beukCloud?.cloud?.available : () => window.beukCloud?.cloud?.user, null, 30_000); if (process.env.W7A_LAT_CSS) await page.addStyleTag({ content: process.env.W7A_LAT_CSS }); if (process.env.W7A_LAT_DOT) await page.evaluate(() => { const d = document.createElement('span'); d.className = 'sync-dot saving'; d.style.cssText = 'position:fixed;left:4px;top:4px;display:block'; document.body.appendChild(d); }); if (process.env.W7A_LAT_NOOP) await page.evaluate(() => { window.beukCloud.api.noteBookEdited = () => undefined; }); } });
  note(`wave7a latency (signed in, autosave running): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
  check(r.p95 < LATENCY_P95_TARGET_MS, `wave7a constraint 91: p95 under ${LATENCY_P95_TARGET_MS} ms on Dumas, signed in (${r.p95.toFixed(1)} ms)`);
}

async function wave7aChecks() {
  const stripe = await w7aFakeStripe();
  const srv = await startServer({ repo: REPO, api: true, apiConfig: { stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base } });
  note(`wave7a: the real server on ${srv.origin} (PGlite), billing in test mode against a fake Stripe on ${stripe.base}`);
  const only = (process.env.W7A_PARTS || 'parity,conflict,noedit,day22,safety,screens,latency').split(',');
  try {
    if (only.includes('parity')) await wave7aParity(srv);
    if (only.includes('conflict')) await wave7aConflict(srv);
    if (only.includes('noedit')) await wave7aNoEdit(srv);
    if (only.includes('day22')) await wave7aDay22(srv);
    if (only.includes('safety')) await wave7aSafety(srv);
    if (only.includes('screens')) await wave7aScreens(srv);
    if (only.includes('latency')) await wave7aLatency(srv);
    const sent = srv.shelf.mail.sent.length;
    note(`wave7a: ${sent} mail(s) captured by the server, none sent; Stripe calls (all to the fake on 127.0.0.1): ${stripe.calls.length}`);
  } finally {
    await srv.stop().catch(() => undefined);
    await stripe.close();
  }
}

/* ---- wave 7b: beta share, bulk import, the archive, offline and the update bar, error reports (constraints 92-99) ----
   The real server again (serve.mjs { api: true }: src/app.ts on PGlite, mail captured, billing in test mode against a
   fake Stripe on 127.0.0.1). 1.0 (/studio) and 2.0 (/next) beside each other on one origin, each as its own account
   (separate shelves); 1.0's functions called by name in its page. W7B_PARTS picks the parts. */
const w7bMaskIds = (s) => String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>').replace(/\/read\/[A-Za-z0-9_-]{20,64}/g, '/read/<token>');
/** The non-GET /api requests a page sends that match `re`, masked (method, path, body). */
const w7bReq = (list, re) => list.filter((x) => re.test(x.path)).map((x) => x.method + ' ' + w7bMaskIds(x.path) + (x.body && !/^\/api\/exports\?/.test(x.path) ? ' ' + w7bMaskIds(x.body) : ''));
/** Signed in on the shelf server, the book open in 2.0 and brought to the shelf (linked). */
async function w7bNextLinked(ctx, origin, file, tag) {
  await w7aSignUp(ctx, origin, w7aEmail(tag));
  const page = await w7aNext(ctx, origin, file);
  await page.click('#btnAccount');
  await page.waitForSelector('#modalShelf.open');
  await page.click('#btnBringBook');
  await w7aWait(page, () => window.beukCloud.cloud.linkState === 'linked', null, 60_000);
  await page.evaluate(() => document.getElementById('modalShelf').classList.remove('open'));
  return page;
}
/** The same book in 1.0, its own account, brought to its shelf by 1.0's cloudBringBook. */
async function w7bOneLinked(ctx, origin, book) {
  const one = await w7aOne(ctx, origin);
  await one.evaluate(async (b) => {
    applyBookDoc(JSON.parse(JSON.stringify(b)));
    await cloudBringBook();
  }, book);
  await w7aWait(one, () => cloud.linkState === 'linked', null, 60_000);
  return one;
}

/* 92: bulk import beside 1.0 — the same files, the same shelf books (masked), the open book untouched, failures reported
   as 1.0 reports them. */
async function wave7bBulk(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const files = [];
  for (const d of await W6C.docxCorpus(W6Z)) files.push(w6File(d.name, W6_DOCX, d.bytes));
  for (const t of W6F.textCorpus()) files.push(w6File(t.name, t.type, Buffer.from(t.text, 'utf8')));
  files.push(await w6EpubOf(origin, w5aHostileBook(f.book), 'w7b-hostile'));
  files.push(w6File('<img src=x onerror="window.__pw=7">.md', 'text/markdown', Buffer.from('# Hostile name\n\nA book whose file name is markup.\n')));
  files.push(w6File('notes.xyz', 'application/octet-stream', Buffer.from('x')));
  files.push(w6File('blank.md', 'text/markdown', Buffer.from('   \n')));
  files.push(w6File('copy-of-plain.txt', 'text/plain', Buffer.from(W6F.textCorpus().find((t) => t.name === 'plain-manuscript.txt').text, 'utf8')));
  note(`wave7b bulk: ${files.length} files (${files.filter((x) => x.name.endsWith('.docx')).length} DOCX, ${W6F.textCorpus().length} MD/TXT/RTF, the hostile book's EPUB, a hostile file name, an unsupported file, an empty one, a duplicate)`);
  /** The shelf books an account holds but `skipId`: title → its doc. */
  const shelfBooks = async (ctx, skipId) => {
    const list = (await (await ctx.request.get(origin + '/api/manuscripts')).json()).manuscripts.filter((m) => m.id !== skipId);
    const out = {};
    for (const m of list) out[m.title] = (await (await ctx.request.get(origin + '/api/manuscripts/' + m.id)).json()).manuscript.doc;
    return out;
  };
  const runOne = async () => {
    const ctx = await newContext({ serviceWorkers: 'block' });
    try {
      await w7aSignUp(ctx, origin, w7aEmail('b1'));
      const one = await w7aOne(ctx, origin);
      await one.evaluate(() => { document.getElementById('bulkSummary').style.display = 'none'; });
      await one.setInputFiles('#bulkFileInput', files);
      await one.waitForFunction(() => document.getElementById('bulkSummary').style.display === '', null, { timeout: 300_000 });
      await one.waitForTimeout(500);
      const summary = await one.$eval('#bulkSummary', (x) => x.textContent);
      const books = await shelfBooks(ctx, null);
      const live = await one.evaluate(() => ({ pw: window.__pw ?? null }));
      await harvestCsp(one);
      return { summary, books, live };
    } finally {
      await ctx.close();
    }
  };
  const r1 = await runOne();
  const r1b = await runOne();
  // the masks, shown varying in 1.0 itself: two runs of the same batch differ raw and are equal masked
  const titles = Object.keys(r1.books);
  const varied = titles.filter((k) => JSON.stringify(r1.books[k]) !== JSON.stringify(r1b.books[k])).length;
  const maskEq = titles.filter((k) => JSON.stringify(W6F.maskVarying(r1.books[k])) === JSON.stringify(W6F.maskVarying(r1b.books[k]))).length;
  check(titles.length > 0 && varied === titles.length && maskEq === titles.length, `wave7b constraint 92: the masks (maskVarying: the fresh ids and times 1.0 mints) vary in 1.0 itself — two 1.0 runs of the batch: ${varied} of ${titles.length} books differ raw, ${maskEq} of ${titles.length} equal masked`);
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'b2');
    const openId = await page.evaluate(() => window.beukCloud.cloud.linkedId);
    const before = (await exportBackup(page)).json.book;
    const writes = w7aWrites(page);
    await page.click('#btnAccount');
    await page.waitForSelector('#modalShelf.open');
    check(await page.$eval('#shelfBulk', (x) => x.style.display === '' && x.getClientRects().length > 0), "wave7b G3: 1.0's bulk block shows in the shelf dialog, signed in");
    await page.evaluate(() => { document.getElementById('bulkSummary').style.display = 'none'; });
    await page.setInputFiles('#bulkFileInput', files);
    await page.waitForFunction(() => document.getElementById('bulkSummary').style.display === '', null, { timeout: 300_000 });
    await page.waitForTimeout(500);
    const summary = await page.$eval('#bulkSummary', (x) => x.textContent);
    check(summary === r1.summary, `wave7b constraint 92: 2.0's summary is 1.0's, word for word (each failure reported as 1.0 reports it; the queue never stopped)${summary === r1.summary ? '' : ' — 2.0: ' + summary.slice(0, 300) + ' — 1.0: ' + r1.summary.slice(0, 300)}`);
    note('wave7b bulk summary (its last 400 characters: what was skipped and what failed): …' + summary.slice(-400));

    const books = await shelfBooks(ctx, openId);
    const t1 = Object.keys(r1.books).sort(), t2 = Object.keys(books).sort();
    let eq = 0;
    const bad = [];
    for (const title of t1) {
      if (!books[title]) {
        bad.push(title + ' (missing in 2.0)');
        continue;
      }
      if (JSON.stringify(W6F.maskVarying(books[title])) === JSON.stringify(W6F.maskVarying(r1.books[title]))) eq++;
      else bad.push(title + w6Diff(W6F.maskVarying(r1.books[title]), W6F.maskVarying(books[title])));
    }
    check(t1.length > 0 && eq === t1.length && t2.length === t1.length, `wave7b constraint 92: the shelf books 2.0 made are JSON-equal to 1.0's (masked) for ${eq} of ${t1.length} (${t2.length} made by 2.0)${bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('modalShelf').classList.contains('open'));
    const after = (await exportBackup(page)).json.book;
    check(JSON.stringify(after) === JSON.stringify(before), 'wave7b decision 2: the open book is exactly as it was before the bulk import (its backup, byte for byte)');
    check(await page.evaluate((id) => window.beukCloud.cloud.linkedId === id && window.beukCloud.cloud.linkState === 'linked', openId), 'wave7b decision 2: the open book keeps its shelf link');
    const w = w7aManuscriptWrites(writes);
    check(w.filter((x) => x.method === 'PUT').length === 0 && w.filter((x) => x.method === 'POST').length === t2.length, `wave7b decision 2: the bulk import sent ${w.filter((x) => x.method === 'POST').length} POSTs (one per book made) and ${w.filter((x) => x.method === 'PUT').length} PUTs`);
    const live = await page.evaluate(() => ({ pw: window.__pw ?? null, scripts: document.querySelectorAll('#modalShelf script').length, handlers: [...document.querySelectorAll('#modalShelf *')].flatMap((e) => [...e.attributes]).filter((a) => /^on/i.test(a.name)).length }));
    check(live.pw === null && r1.live.pw === null && live.scripts === 0 && live.handlers === 0, `wave7b constraint 97: a hostile file name and the hostile book carry no script or handler into the shelf dialog (${JSON.stringify(live)})`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/* 93: share links beside 1.0 — create, list, expire, revoke with 1.0's requests and rows; comments resolve and jump. */
async function wave7bShare(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  const ctx1 = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 's2');
    const book = (await exportBackup(page)).json.book;
    await w7aSignUp(ctx1, origin, w7aEmail('s1'));
    const one = await w7bOneLinked(ctx1, origin, book);
    const w2 = w7aWrites(page), w1 = w7aWrites(one);
    await w5aOpenModal(page);
    await one.evaluate(() => document.getElementById('btnExport').click());
    for (const p of [page, one]) await p.waitForFunction(() => !!document.getElementById('btnBetaCreate') && /No reading links/.test(document.getElementById('betaSec').textContent), null, { timeout: 30_000 });
    for (const p of [page, one]) {
      await p.selectOption('#betaExpiry', '7');
      await p.click('#btnBetaCreate');
      await p.waitForSelector('#betaNewUrl', { timeout: 30_000 });
      await p.waitForFunction(() => document.querySelectorAll('#betaList .beta-row').length === 1, null, { timeout: 30_000 });
    }
    const rowsOf = (p) => p.$$eval('#betaList .beta-row', (rs) => rs.map((r) => r.textContent));
    const r2 = await rowsOf(page), r1 = await rowsOf(one);
    check(JSON.stringify(r2) === JSON.stringify(r1), `wave7b constraint 93: the list's rows are 1.0's: ${JSON.stringify(r2)}${JSON.stringify(r2) === JSON.stringify(r1) ? '' : ' — 1.0: ' + JSON.stringify(r1)}`);
    const q2 = w7bReq(w2, /^\/api\/shares/), q1 = w7bReq(w1, /^\/api\/shares/);
    check(JSON.stringify(q2) === JSON.stringify(q1), `wave7b constraint 93: create (7 days) sends 1.0's requests: ${JSON.stringify(q2)}${JSON.stringify(q2) === JSON.stringify(q1) ? '' : ' — 1.0: ' + JSON.stringify(q1)}`);
    const tok2 = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('beuk.betaTokens.v1') || '{}'))[0]);
    check((await page.$eval('#betaNewUrl', (x) => x.value)) === origin + '/read/' + tok2, "wave7b constraint 93: the new link is this site's /read/<token>, as 1.0 makes it");
    const elsewhere = await page.evaluate((tk) => Object.keys(localStorage).filter((k) => k !== 'beuk.betaTokens.v1' && String(localStorage.getItem(k)).includes(tk)), tok2);
    check(elsewhere.length === 0, `wave7b constraint 97: the token is kept only in beuk.betaTokens.v1 (${elsewhere.length} other keys hold it)`);
    // a reader's comments: one plain on a passage, one hostile
    const sec = book.sections.find((s) => s.type === 'chapter' && String(s.content || '').split(/\n\s*\n/).length > 2);
    const quote = String(sec.content).split(/\n\s*\n/)[1].split(/\s+/).slice(0, 5).join(' ');
    const evil = '<img src=x onerror="window.__pw=9"><script>window.__pw=10</script>';
    for (const [p, c] of [[page, ctx], [one, ctx1]]) {
      const tk = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('beuk.betaTokens.v1') || '{}'))[0]);
      for (const body of [{ readerName: 'Ann', sectionId: sec.id, paragraph: 1, quote, body: 'This line.' }, { readerName: 'Bo', sectionId: sec.id, paragraph: 2, quote: evil, body: evil }]) {
        const st = (await c.request.post(origin + '/read/' + tk + '/comments', { data: body })).status();
        if (st !== 201) check(false, `wave7b: a reader's comment was refused (${st})`);
      }
    }
    await page.click('#btnCloseExport');
    await one.evaluate(() => document.getElementById('modalExport').classList.remove('open'));
    await page.click('#btnBetaComments');
    await one.evaluate(() => betaOpenComments());
    for (const p of [page, one]) await p.waitForFunction(() => document.querySelectorAll('#betaCBody .bc-item').length === 2, null, { timeout: 30_000 });
    const c2 = await page.$eval('#betaCBody', (x) => x.textContent), c1 = await one.$eval('#betaCBody', (x) => x.textContent);
    check(c2 === c1, `wave7b constraint 93: the comments list reads as 1.0's${c2 === c1 ? '' : ' — 2.0: ' + c2.slice(0, 200) + ' — 1.0: ' + c1.slice(0, 200)}`);
    const safe = await page.evaluate(() => ({ pw: window.__pw ?? null, scripts: document.querySelectorAll('#modalBetaComments script').length, handlers: [...document.querySelectorAll('#modalBetaComments *')].flatMap((e) => [...e.attributes]).filter((a) => /^on/i.test(a.name)).length }));
    check(safe.pw === null && safe.scripts === 0 && safe.handlers === 0, `wave7b constraint 97: a hostile comment carries no script or handler into the comments dialog (${JSON.stringify(safe)})`);
    const n2 = w2.length, n1 = w1.length;
    for (const p of [page, one]) {
      await p.click('#betaCBody .bc-item [data-bc-resolve]');
      await p.waitForFunction(() => document.querySelectorAll('#betaCBody .bc-item').length === 1, null, { timeout: 30_000 });
    }
    const rq2 = w7bReq(w2.slice(n2), /^\/api\/shares/), rq1 = w7bReq(w1.slice(n1), /^\/api\/shares/);
    check(JSON.stringify(rq2) === JSON.stringify(rq1) && rq2.length === 1, `wave7b constraint 93: resolve sends 1.0's request: ${JSON.stringify(rq2)}${JSON.stringify(rq2) === JSON.stringify(rq1) ? '' : ' — 1.0: ' + JSON.stringify(rq1)}`);
    // Jump to paragraph: 2.0's editor, on the passage
    await page.click('#betaShowResolved');
    await page.waitForFunction(() => document.querySelectorAll('#betaCBody .bc-item').length === 2, null, { timeout: 30_000 });
    await page.click('#betaCBody .bc-item [data-bc-jump]');
    const landed = await page.waitForFunction(() => {
      const ms = document.getElementById('manuscript');
      const ed = ms?.beukEditor;
      if (!ed || document.getElementById('modalBetaComments').classList.contains('open')) return null;
      const { from, to } = ed.state.selection;
      const txt = ed.state.doc.textBetween(from, to, ' ');
      return txt ? { txt, section: ms.getAttribute('data-section') } : null;
    }, null, { timeout: 30_000 }).then((h) => h.jsonValue());
    const idx = book.sections.indexOf(sec);
    check(landed.txt === quote && Number(landed.section) === idx, `wave7b constraint 93: Jump to paragraph lands in 2.0's editor on the passage (section ${landed.section} of ${idx}: "${landed.txt}")`);
    // revoke, after 1.0's calm confirm
    await one.evaluate(() => betaCloseComments());
    await w5aOpenModal(page);

    await one.evaluate(() => document.getElementById('btnExport').click());
    const n2b = w2.length, n1b = w1.length;
    for (const p of [page, one]) {
      await p.waitForSelector('#betaList [data-beta-revoke]', { timeout: 30_000 });
      await p.click('#betaList [data-beta-revoke]');
      await p.waitForSelector('#modalConfirm.open #btnConfirmYes', { timeout: 10_000 });
      await p.click('#modalConfirm.open #btnConfirmYes');
      await p.waitForSelector('#betaList .beta-st.revoked', { timeout: 30_000 });
    }
    const v2 = w7bReq(w2.slice(n2b), /^\/api\/shares/), v1 = w7bReq(w1.slice(n1b), /^\/api\/shares/);
    check(JSON.stringify(v2) === JSON.stringify(v1), `wave7b constraint 93: revoke sends 1.0's requests: ${JSON.stringify(v2)}${JSON.stringify(v2) === JSON.stringify(v1) ? '' : ' — 1.0: ' + JSON.stringify(v1)}`);
    const rr2 = await rowsOf(page), rr1 = await rowsOf(one);
    check(JSON.stringify(rr2) === JSON.stringify(rr1), `wave7b constraint 93: the revoked row reads as 1.0's: ${JSON.stringify(rr2)}`);
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx1.close();
    await ctx.close();
  }
}

/* 93, day 22 unpaid: the server's refusal shown as 1.0 shows it (a beta link refused). */
async function wave7bDay22(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  const ctx1 = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'd2');
    const book = (await exportBackup(page)).json.book;
    await w7aSignUp(ctx1, origin, w7aEmail('d1'));
    const one = await w7bOneLinked(ctx1, origin, book);
    for (const c of [ctx, ctx1]) {
      const me = (await (await c.request.get(origin + '/api/auth/me')).json()).user;
      await srv.shelf.db.query("update users set trial_ends_at = now() - interval '1 day' where id = $1", [me.id]);
    }
    const w2 = w7aWrites(page), w1 = w7aWrites(one);
    await w5aOpenModal(page);
    await one.evaluate(() => document.getElementById('btnExport').click());
    for (const p of [page, one]) {
      await p.waitForSelector('#btnBetaCreate', { timeout: 30_000 });
      await p.click('#btnBetaCreate');
      await p.waitForSelector('#betaSec [role="alert"]', { timeout: 30_000 });
    }
    const a2 = await page.$eval('#betaSec [role="alert"]', (x) => x.textContent), a1 = await one.$eval('#betaSec [role="alert"]', (x) => x.textContent);
    check(a2 === a1, `wave7b constraint 93 (day 22): the refused link says 1.0's words for the server's refusal: "${a2.slice(0, 160)}"${a2 === a1 ? '' : ' — 1.0: "' + a1.slice(0, 160) + '"'}`);
    const q2 = w7bReq(w2, /^\/api\/(shares|exports|manuscripts)/), q1 = w7bReq(w1, /^\/api\/(shares|exports|manuscripts)/);
    check(JSON.stringify(q2) === JSON.stringify(q1), `wave7b constraint 93 (day 22): 2.0 sends only what 1.0 sends: ${JSON.stringify(q2)}${JSON.stringify(q2) === JSON.stringify(q1) ? '' : ' — 1.0: ' + JSON.stringify(q1)}`);
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx1.close();
    await ctx.close();
  }
}

/* ---- named reading links (plan 2026-11-08, task 4): namedLinksChecks (E2E_ONLY=namedlinks) ----
   The real server (serve.mjs { api: true }: src/app.ts on PGlite, billing in test mode against a fake Stripe on
   127.0.0.1), as constraint 93 drives it: 1.0 (/studio) and 2.0 (/next) beside each other, each its own account, the
   same book. NL_PARTS picks the parts.
   - Parity: a reading copy made, the Readers disclosure opened, Priya (never ends) and Sam (30 days) added, Priya's link
     closed, then "Close the open link" — each close after the calm confirm. At every step the /api/shares writes
     (method, path, body; ids and tokens masked) and the rows are 1.0's; the confirm dialogs read as 1.0's.
   - Readers, in a browser of their own (one per app's links): each named link opens with its own name in the line
     (the name in <bdi>) and the stamp layer; Sam's page shows none of Priya's comments (nor Priya's his; the open link
     neither); closed, Priya's link gives the 410 page (which never names her) while Sam keeps reading; the open link
     closed gives a 410 and Sam is untouched; Revoke (last) closes Sam's too. Tokens: named ones only under
     beuk.betaReaderTokens.v1.
   - The watermark on Sam's page (2.0's link), in Chromium: with JavaScript off the line and the stamp layer are there;
     at 360 px the line is visible and the page has no horizontal scroll; with colorScheme dark the stamp layer's
     background is not none; printed (page.pdf, A4, a long chapter, ≥ 2 pages), pdf.js (the vendored 6.4.299, 1.0's
     pdfLoadLib) finds "Shared with Sam" in page 1's text, and on EVERY page, rendered to a canvas, finds the stamp's
     ink in the cells with no text (the stamp is an SVG image: its words are not text in the PDF). */
const NL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The stamp's date for a link: the recipient's createdAt as the server gives it (GET /api/shares/:id/readers), in
 *  UTC, `d Mon yyyy` — never the wall clock, never the page under test. */
const nlStampDate = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return `<no createdAt: ${iso}>`;
  return `${d.getUTCDate()} ${NL_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** The reader page as a reader meets it: the line, its <bdi>, the stamp layer and its background, the comments list. */
const NL_READ = () => {
  const k = document.querySelector('.rd-kicker.rd-named');
  const st = document.querySelector('.rd-stamp');
  return {
    title: document.title,
    h1: document.querySelector('h1')?.textContent || '',
    line: k ? k.textContent : null,
    bdi: k?.querySelector('bdi')?.textContent ?? null,
    stamp: !!st,
    stampBg: st ? getComputedStyle(st).backgroundImage.slice(0, 40) : null,
    stampPe: st ? getComputedStyle(st).pointerEvents : null,
    stampPos: st ? getComputedStyle(st).position : null,
    list: document.getElementById('rdList')?.textContent || '',
    section: document.getElementById('rdRoot')?.getAttribute('data-section') || '',
    body: document.body.textContent,
  };
};
/** pdf.js (1.0's pdfLoadLib) over a PDF: every page's text, and the page drawn to a canvas (scale 1.5), split into
 *  16 px cells: the cells clear of every text item, and of those the "stamp cells" (see below). */
const NL_PDF = async ([b64]) => {
  /* global pdfLoadLib */
  const lib = await pdfLoadLib();
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const task = lib.getDocument({ data, verbosity: 0, useWasm: false, isOffscreenCanvasSupported: false });
  const d = await task.promise;
  const pages = [];
  for (let i = 1; i <= d.numPages; i++) {
    const pg = await d.getPage(i);
    const tc = await pg.getTextContent();
    const vp = pg.getViewport({ scale: 1.5 });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
    // every text item's box (ascent 1.0 em above the baseline, 0.35 em below), widened by 3 px: the text mask
    const W = c.width, H = c.height;
    const mask = new Uint8Array(W * H);
    for (const x of tc.items) {
      if (!x.str || !x.str.trim()) continue;
      const m = lib.Util.transform(vp.transform, x.transform);
      const fh = Math.hypot(m[2], m[3]);
      const w = Math.max(x.width * vp.scale, fh * 0.5);
      const x0 = Math.max(0, Math.floor(m[4] - 3)), x1 = Math.min(W, Math.ceil(m[4] + w + 3));
      const y0 = Math.max(0, Math.floor(m[5] - fh * 1.0 - 3)), y1 = Math.min(H, Math.ceil(m[5] + fh * 0.35 + 3));
      for (let y = y0; y < y1; y++) mask.fill(1, y * W + x0, y * W + x1);
    }
    const px = g.getImageData(0, 0, W, H).data;
    // 16 px cells wholly clear of the text mask; a "stamp cell" holds ≥ 4 pixels of the stamp's light, cool ink (every
    // channel 200..249 and blue ≥ green ≥ red, blue > red: #22333a at 11 % on white is ~231,233,233) and no darker
    // pixel (text and drawn rules are darker). Measured: with the stamp's background-image removed, every page of the
    // print has 0 such cells (the page's own light ink, its borders and fields, is warm: blue < red); with it, 17–165.
    const CELL = 16;
    let free = 0, inked = 0, ink = 0;
    for (let y0 = 0; y0 + CELL <= H; y0 += CELL) for (let x0 = 0; x0 + CELL <= W; x0 += CELL) {
      let clear = true;
      for (let y = y0; y < y0 + CELL && clear; y++) for (let x = x0; x < x0 + CELL; x++) if (mask[y * W + x]) { clear = false; break; }
      if (!clear) continue;
      free++;
      let n = 0, dark = 0;
      for (let y = y0; y < y0 + CELL; y++) for (let x = x0; x < x0 + CELL; x++) {
        const o = (y * W + x) * 4;
        const lo = Math.min(px[o], px[o + 1], px[o + 2]), hi = Math.max(px[o], px[o + 1], px[o + 2]);
        if (lo < 200) dark++;
        else if (hi <= 249 && px[o + 2] >= px[o + 1] && px[o + 1] >= px[o] && px[o + 2] > px[o]) n++;
      }
      ink += n;
      if (n >= 4 && dark === 0) inked++;
    }
    pages.push({ text: tc.items.map((x) => x.str).join(' '), free, inked, ink, size: [W, H] });
  }
  await task.destroy();
  return pages;
};
/** The rows of one share's Readers disclosure, and its summary. */
const nlReaderRows = (p, sid) => p.evaluate((id) => {
  const dt = document.getElementById('betaReaders-' + id);
  if (!dt) return null;
  return { open: dt.open, summary: dt.querySelector('summary')?.textContent, rows: [...dt.querySelectorAll('.beta-row')].map((r) => r.textContent) };
}, sid);
/** Each named row: name → its recipient id and the link its Copy button holds. */
const nlLinks = (p, sid) => p.evaluate((id) => Object.fromEntries([...document.querySelectorAll('#betaReaders-' + id + ' .beta-row[data-recipient-id]')].map((r) => [
  r.querySelector('.a-name').childNodes[0].textContent,
  { rid: r.getAttribute('data-recipient-id'), url: r.querySelector('[data-beta-reader-copy]')?.getAttribute('data-beta-reader-copy') || null, st: r.querySelector('.beta-st')?.className },
])), sid);

/** A reader's page watched as watch() does (the browser's own favicon.ico request aside). The one console error it
 *  accepts is the 410 of a navigation the test expects to be closed: nlGone(page, url) marks that url first. */
const nlExpect410 = new WeakMap();
function nlWatchReader(page) {
  nlExpect410.set(page, new Set());
  page.on('crash', () => csp.errors.push(`${page.url()}: the page CRASHED`));
  page.on('pageerror', (e) => csp.errors.push(`${page.url()}: ${e}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const at = (m.location() && m.location().url) || '';
    if (/\/favicon\.ico$/.test(at)) return;
    if (/Failed to load resource: the server responded with a status of 410/.test(m.text()) && nlExpect410.get(page).has(at)) return;
    csp.errors.push(`${page.url()}: ${m.text()} (${at})`);
  });
  return page;
}
/** Go to a link the test expects to be closed (410): only this navigation's 410 is accepted. */
async function nlGone(page, url) {
  nlExpect410.get(page).add(url);
  try {
    return await page.goto(url);
  } finally {
    await page.waitForTimeout(100);
    nlExpect410.get(page).delete(url);
  }
}
async function namedLinksParity(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  const ctx1 = await newContext({ serviceWorkers: 'block' });
  const readers = [];
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'nl2');
    const book = (await exportBackup(page)).json.book;
    await w7aSignUp(ctx1, origin, w7aEmail('nl1'));
    const one = await w7bOneLinked(ctx1, origin, book);
    const w2 = w7aWrites(page), w1 = w7aWrites(one);
    const sides = [[page, w2, '2.0'], [one, w1, '1.0']];
    const marks = () => [w2.length, w1.length];
    /** The /api/shares writes of both apps since `m`, compared. */
    const same = (m, what, want = null) => {
      const q2 = w7bReq(w2.slice(m[0]), /^\/api\/shares/), q1 = w7bReq(w1.slice(m[1]), /^\/api\/shares/);
      const ok = JSON.stringify(q2) === JSON.stringify(q1) && (want === null || q2.length === want);
      check(ok, `namedlinks parity: ${what} sends 1.0's requests: ${JSON.stringify(q2)}${JSON.stringify(q2) === JSON.stringify(q1) ? '' : ' — 1.0: ' + JSON.stringify(q1)}`);
    };
    const confirmOf = (p) => p.evaluate(() => [document.getElementById('confirmTitle').textContent, document.getElementById('confirmBody').textContent, document.getElementById('btnConfirmYes').textContent, document.getElementById('btnConfirmNo').textContent]);

    // a reading copy, made as constraint 93 makes it
    let m = marks();
    await w5aOpenModal(page);
    await one.evaluate(() => document.getElementById('btnExport').click());
    for (const [p] of sides) {
      await p.waitForFunction(() => !!document.getElementById('btnBetaCreate') && /No reading links/.test(document.getElementById('betaSec').textContent), null, { timeout: 30_000 });
      await p.click('#btnBetaCreate');
      await p.waitForSelector('#betaNewUrl', { timeout: 30_000 });
      await p.waitForFunction(() => document.querySelectorAll('#betaList .beta-row[data-share-id]').length === 1, null, { timeout: 30_000 });
    }
    same(m, 'the reading copy made', 1);
    const sid = {};
    for (const [p, , who] of sides) sid[who] = await p.$eval('#betaList .beta-row[data-share-id]', (x) => x.getAttribute('data-share-id'));
    // the Readers disclosure, opened
    for (const [p, , who] of sides) {
      await p.click(`#betaReaders-${sid[who]} > summary`);
      await p.waitForFunction((id) => { const d = document.getElementById('betaReaders-' + id); return d && d.open && !d.querySelector('.shelf-empty'); }, sid[who], { timeout: 30_000 });
    }
    {
      const a = await nlReaderRows(page, sid['2.0']), b = await nlReaderRows(one, sid['1.0']);
      check(JSON.stringify(a) === JSON.stringify(b) && a.open && a.rows.length === 0, `namedlinks parity: the Readers disclosure opens as 1.0's, empty: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' — 1.0: ' + JSON.stringify(b)}`);
    }
    // Priya (never ends), then Sam (30 days)
    m = marks();
    for (const [name, days, n] of [['Priya', '0', 1], ['Sam', '30', 2]]) {
      for (const [p, , who] of sides) {
        const id = sid[who];
        await p.fill(`#betaReaderName-${id}`, name);
        await p.selectOption(`#betaReaderExpiry-${id}`, days);
        await p.click(`[data-beta-reader-add="${id}"]`);
        await p.waitForFunction(([i, k]) => document.querySelectorAll('#betaReaders-' + i + ' .beta-row[data-recipient-id]').length === k && !document.querySelector('[data-beta-reader-add="' + i + '"]').disabled, [id, n], { timeout: 30_000 });
      }
    }
    same(m, 'adding Priya and Sam', 2);
    const q2add = w7bReq(w2.slice(m[0]), /^\/api\/shares/);
    check(q2add[0] === 'POST /api/shares/<id>/readers {"name":"Priya"}' && q2add[1] === 'POST /api/shares/<id>/readers {"name":"Sam","expiresInDays":30}', `namedlinks: the two adds are POST /api/shares/<id>/readers with the name (and Sam's 30 days): ${JSON.stringify(q2add)}`);
    {
      const a = await nlReaderRows(page, sid['2.0']), b = await nlReaderRows(one, sid['1.0']);
      check(JSON.stringify(a) === JSON.stringify(b) && a.rows.length === 2, `namedlinks parity: the two readers' rows read as 1.0's: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' — 1.0: ' + JSON.stringify(b)}`);
    }
    const links = {};
    for (const [p, , who] of sides) {
      const L = await nlLinks(p, sid[who]);
      const store = await p.evaluate(() => ({ named: JSON.parse(localStorage.getItem('beuk.betaReaderTokens.v1') || '{}'), open: JSON.parse(localStorage.getItem('beuk.betaTokens.v1') || '{}') }));
      const id = sid[who];
      const tok = (u) => (u || '').split('/read/')[1];
      const openTok = store.open[id];
      check(!!L.Priya?.url && !!L.Sam?.url && store.named[id + ':' + L.Priya.rid] === tok(L.Priya.url) && store.named[id + ':' + L.Sam.rid] === tok(L.Sam.url) && Object.keys(store.named).length === 2,
        `namedlinks ${who}: each reader's Copy holds this site's /read/<token>, and the tokens are kept under beuk.betaReaderTokens.v1 as "<shareId>:<recipientId>" (${Object.keys(store.named).length} kept)`);
      check(Object.keys(store.open).length === 1 && !!openTok && openTok !== tok(L.Priya?.url) && openTok !== tok(L.Sam?.url) && L.Priya.url.startsWith(origin + '/read/'),
        `namedlinks ${who}: beuk.betaTokens.v1 still holds only the open link's token (shareId → token; ${Object.keys(store.open).length} entry)`);
      const elsewhere = await p.evaluate((tks) => Object.keys(localStorage).filter((k) => k !== 'beuk.betaReaderTokens.v1' && tks.some((t) => String(localStorage.getItem(k)).includes(t))), [tok(L.Priya?.url), tok(L.Sam?.url)]);
      check(elsewhere.length === 0, `namedlinks ${who}: the named tokens are in no other localStorage key (${JSON.stringify(elsewhere)})`);
      // each reader's createdAt, from the server (the writer's own session), for the stamp's expected date
      const listed = (await (await p.context().request.get(origin + '/api/shares/' + encodeURIComponent(id) + '/readers')).json()).readers || [];
      for (const x of [L.Priya, L.Sam]) x.createdAt = listed.find((y) => y.id === x?.rid)?.createdAt ?? null;
      check(!!L.Priya?.createdAt && !!L.Sam?.createdAt, `namedlinks ${who}: the server gives each reader's createdAt (${L.Priya?.createdAt}, ${L.Sam?.createdAt})`);
      links[who] = { priya: L.Priya, sam: L.Sam, open: origin + '/read/' + openTok };
    }

    // the readers: each app's links in a browser of their own
    const rc = {};
    for (const [, , who] of sides) {
      const c = await newContext({ serviceWorkers: 'block' });
      readers.push(c);
      const rp = nlWatchReader(await c.newPage());
      rc[who] = { c, rp };
      const L = links[who];
      const seen = {};
      for (const [k, name] of [['priya', 'Priya'], ['sam', 'Sam']]) {
        const resp = await rp.goto(L[k].url);
        const r = await rp.evaluate(NL_READ);
        seen[k] = r;
        check(resp.status() === 200 && r.line === `Shared with ${name} · ${nlStampDate(L[k].createdAt)}` && r.bdi === name && r.stamp && /^url\("data:image\/svg\+xml/.test(r.stampBg || ''),
          `namedlinks ${who}: ${name}'s link opens with her/his own name on the page: "${r.line}" (the name in <bdi>: "${r.bdi}"), the stamp layer there (${r.stampBg}…) [${resp.status()}]`);
        await harvestCsp(rp);
      }
      check(!seen.sam.body.includes('Priya') && !seen.priya.body.includes('Sam'), `namedlinks ${who}: neither reader's page names the other`);
      const open = await rp.goto(L.open);
      const ro = await rp.evaluate(NL_READ);
      check(open.status() === 200 && ro.line === null && !ro.stamp, `namedlinks ${who}: the open link's page has no name line and no stamp (${open.status()})`);
      // comments: Priya's and Sam's, each through their own link; the open link one of its own
      const sec = seen.priya.section;
      const bodies = { priya: `Priya's note ${who}`, sam: `Sam's note ${who}`, open: `An open-link note ${who}` };
      for (const [k, u] of [['priya', L.priya.url], ['sam', L.sam.url], ['open', L.open]]) {
        const st = (await c.request.post(u + '/comments', { data: { readerName: k === 'open' ? 'Anon' : 'ignored', sectionId: sec, paragraph: 0, quote: '', body: bodies[k] } })).status();
        check(st === 201, `namedlinks ${who}: a comment through the ${k} link is taken (${st})`);
      }
      const lists = {};
      for (const [k, u] of [['priya', L.priya.url], ['sam', L.sam.url], ['open', L.open]]) {
        await rp.goto(u);
        await rp.waitForFunction(() => !/Comments appear here when scripts are allowed/.test(document.getElementById('rdList')?.textContent || ''), null, { timeout: 30_000 });
        await rp.waitForFunction(() => !/Loading/i.test(document.getElementById('rdList')?.textContent || '') && (document.getElementById('rdList')?.textContent || '').length > 0, null, { timeout: 30_000 });
        lists[k] = await rp.$eval('#rdList', (x) => x.textContent);
        await harvestCsp(rp);
      }
      check(lists.sam.includes(bodies.sam) && !lists.sam.includes(bodies.priya) && !lists.sam.includes(bodies.open), `namedlinks ${who}: Sam's page shows his comment and none of Priya's (nor the open link's): "${lists.sam.slice(0, 120)}"`);
      check(lists.priya.includes(bodies.priya) && !lists.priya.includes(bodies.sam) && !lists.priya.includes(bodies.open), `namedlinks ${who}: Priya's page shows only hers: "${lists.priya.slice(0, 120)}"`);
      check(lists.open.includes(bodies.open) && !lists.open.includes(bodies.priya) && !lists.open.includes(bodies.sam), `namedlinks ${who}: the open link's page shows only the open link's: "${lists.open.slice(0, 120)}"`);
    }

    // close Priya, after the calm confirm
    m = marks();
    const conf = {};
    for (const [p, , who] of sides) {
      await p.click(`[data-beta-reader-close="${sid[who]}:${links[who].priya.rid}"]`);
      await p.waitForSelector('#modalConfirm.open #btnConfirmYes', { timeout: 10_000 });
      conf[who] = await confirmOf(p);
      const before = (who === '2.0' ? w2 : w1).length;
      await p.waitForTimeout(300);
      check((who === '2.0' ? w2 : w1).length === before, `namedlinks ${who}: "Close Priya's link" sends nothing until it is confirmed`);
      await p.click('#modalConfirm.open #btnConfirmYes');
      await p.waitForFunction(([i, rid]) => !!document.querySelector('#betaReaders-' + i + ' .beta-row[data-recipient-id="' + rid + '"] .beta-st.revoked'), [sid[who], links[who].priya.rid], { timeout: 30_000 });
    }
    check(JSON.stringify(conf['2.0']) === JSON.stringify(conf['1.0']) && /Priya/.test(conf['2.0'][0]), `namedlinks parity: closing Priya asks first, in 1.0's words: ${JSON.stringify(conf['2.0'])}${JSON.stringify(conf['2.0']) === JSON.stringify(conf['1.0']) ? '' : ' — 1.0: ' + JSON.stringify(conf['1.0'])}`);
    same(m, "closing Priya's link", 1);
    {
      const a = await nlReaderRows(page, sid['2.0']), b = await nlReaderRows(one, sid['1.0']);
      check(JSON.stringify(a) === JSON.stringify(b), `namedlinks parity: after closing Priya the rows read as 1.0's: ${JSON.stringify(a.rows)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' — 1.0: ' + JSON.stringify(b.rows)}`);
    }
    for (const [, , who] of sides) {
      const { rp } = rc[who];
      const L = links[who];
      const gone = await nlGone(rp, L.priya.url);
      const g = await rp.evaluate(NL_READ);
      check(gone.status() === 410 && /This reading copy is closed/.test(g.h1) && !g.body.includes('Priya') && !g.stamp, `namedlinks ${who}: Priya's closed link gives the 410 page, which never names her (${gone.status()}: "${g.h1}")`);
      const sam = await rp.goto(L.sam.url);
      const s = await rp.evaluate(NL_READ);
      check(sam.status() === 200 && s.line === `Shared with Sam · ${nlStampDate(L.sam.createdAt)}`, `namedlinks ${who}: Sam keeps reading (${sam.status()}: "${s.line}")`);
      const open = await rp.goto(L.open);
      check(open.status() === 200, `namedlinks ${who}: the open link keeps working too (${open.status()})`);
    }

    // "Close the open link", after the calm confirm
    m = marks();
    for (const [p, , who] of sides) {
      await p.click(`[data-beta-close-open="${sid[who]}"]`);
      await p.waitForSelector('#modalConfirm.open #btnConfirmYes', { timeout: 10_000 });
      conf[who] = await confirmOf(p);
      await p.click('#modalConfirm.open #btnConfirmYes');
      await p.waitForFunction((i) => !document.querySelector('[data-beta-close-open="' + i + '"]'), sid[who], { timeout: 30_000 });
    }
    check(JSON.stringify(conf['2.0']) === JSON.stringify(conf['1.0']), `namedlinks parity: "Close the open link" asks first, in 1.0's words: ${JSON.stringify(conf['2.0'])}${JSON.stringify(conf['2.0']) === JSON.stringify(conf['1.0']) ? '' : ' — 1.0: ' + JSON.stringify(conf['1.0'])}`);
    same(m, '"Close the open link"', 1);
    {
      const rowsOf = (p) => p.$$eval('#betaList .beta-row[data-share-id]', (rs) => rs.map((r) => r.textContent));
      const a = await rowsOf(page), b = await rowsOf(one);
      check(JSON.stringify(a) === JSON.stringify(b), `namedlinks parity: after closing the open link the copy's row reads as 1.0's: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' — 1.0: ' + JSON.stringify(b)}`);
      const ids = (p) => p.$$eval('#betaList [data-beta-copy]', (bs) => bs.length);
      check((await ids(page)) === 0 && (await ids(one)) === 0, "namedlinks: the closed open link's Copy is gone in both apps");
    }
    for (const [, , who] of sides) {
      const { rp } = rc[who];
      const L = links[who];
      const open = await nlGone(rp, L.open);
      const o = await rp.evaluate(NL_READ);
      check(open.status() === 410 && /This reading copy is closed/.test(o.h1), `namedlinks ${who}: the closed open link gives the 410 page (${open.status()})`);
      const sam = await rp.goto(L.sam.url);
      const s = await rp.evaluate(NL_READ);
      check(sam.status() === 200 && s.line === `Shared with Sam · ${nlStampDate(L.sam.createdAt)}` && s.stamp, `namedlinks ${who}: Sam is unaffected (${sam.status()}: "${s.line}")`);
      const pr = await nlGone(rp, L.priya.url);
      check(pr.status() === 410, `namedlinks ${who}: Priya's link stays closed (${pr.status()})`);
      await harvestCsp(rp);
    }
    // the watermark on Sam's page (2.0's link), while it is open
    if ((process.env.NL_PARTS || 'watermark').split(',').includes('watermark')) await namedLinksWatermark(srv, links['2.0'].sam.url, `Shared with Sam · ${nlStampDate(links['2.0'].sam.createdAt)}`, one);

    // Revoke (the copy as a whole, 1.0's confirm unchanged): every named link closes with it
    m = marks();
    for (const [p, , who] of sides) {
      await p.click(`#betaList [data-beta-revoke="${sid[who]}"]`);
      await p.waitForSelector('#modalConfirm.open #btnConfirmYes', { timeout: 10_000 });
      conf[who] = await confirmOf(p);
      await p.click('#modalConfirm.open #btnConfirmYes');
      await p.waitForSelector('#betaList .beta-st.revoked', { timeout: 30_000 });
    }
    check(JSON.stringify(conf['2.0']) === JSON.stringify(conf['1.0']), `namedlinks parity: Revoke asks in 1.0's words: ${JSON.stringify(conf['2.0'])}${JSON.stringify(conf['2.0']) === JSON.stringify(conf['1.0']) ? '' : ' — 1.0: ' + JSON.stringify(conf['1.0'])}`);
    same(m, 'Revoke', 1);
    for (const [, , who] of sides) {
      const { rp } = rc[who];
      const sam = await nlGone(rp, links[who].sam.url);
      const s = await rp.evaluate(NL_READ);
      check(sam.status() === 410 && /This reading copy is closed/.test(s.h1) && !s.body.includes('Sam'), `namedlinks ${who}: after Revoke, Sam's named link gives the 410 page too (${sam.status()})`);
    }
    same([0, 0], 'the whole run', 6);
    await harvestCsp(page);
    await harvestCsp(one);

  } finally {
    for (const c of readers) await c.close();
    await ctx1.close();
    await ctx.close();
  }
}

/** The watermark on Sam's page, in Chromium (see above). `one`: a 1.0 page on this origin, for its pdf.js. */
async function namedLinksWatermark(srv, samUrl, want, one) {
  // JavaScript off
  {
    const c = await newContext({ serviceWorkers: 'block', javaScriptEnabled: false });
    try {
      const p = await c.newPage();
      const resp = await p.goto(samUrl);
      const r = await p.evaluate(NL_READ);
      check(resp.status() === 200 && /Comments appear here when scripts are allowed/.test(r.list), `namedlinks watermark (JS off): the page's own script did not run — its comments list still says so ("${r.list.slice(0, 60)}")`);
      check(r.line === want && r.bdi === 'Sam', `namedlinks watermark (JS off): the line is there: "${r.line}"`);
      check(r.stamp && /^url\("data:image\/svg\+xml/.test(r.stampBg || '') && r.stampPe === 'none' && r.stampPos === 'fixed', `namedlinks watermark (JS off): the stamp layer is there — fixed, pointer-events ${r.stampPe}, its background ${r.stampBg}…`);
    } finally {
      await c.close();
    }
  }
  // 360 px
  {
    const c = await newContext({ serviceWorkers: 'block', viewport: { width: 360, height: 740 } });
    try {
      const p = await watch(await c.newPage());
      await p.goto(samUrl);
      const r = await p.evaluate(() => {
        const k = document.querySelector('.rd-kicker.rd-named');
        const b = k.getBoundingClientRect();
        const cs = getComputedStyle(k);
        return { box: [b.left, b.top, b.width, b.height].map((x) => Math.round(x * 10) / 10), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth, text: k.textContent };
      });
      const vis = await p.locator('.rd-kicker.rd-named').isVisible();
      check(vis && r.box[2] > 0 && r.box[3] > 0 && r.box[0] >= 0 && r.box[0] + r.box[2] <= 360 && r.display !== 'none' && r.visibility === 'visible' && Number(r.opacity) > 0 && r.text === want,
        `namedlinks watermark (360 px): the line is visible, inside the viewport (box ${JSON.stringify(r.box)}, ${r.display}, opacity ${r.opacity})`);
      check(r.sw <= r.cw && r.bsw <= r.cw, `namedlinks watermark (360 px): no horizontal scroll (scrollWidth ${r.sw} / body ${r.bsw}, clientWidth ${r.cw})`);
      writeFileSync(path.join(OUT, 'nl-sam-360.png'), await p.screenshot());
      await harvestCsp(p);
    } finally {
      await c.close();
    }
  }
  // dark
  {
    const c = await newContext({ serviceWorkers: 'block', colorScheme: 'dark' });
    try {
      const p = await watch(await c.newPage());
      await p.goto(samUrl);
      const dark = await p.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
      const r = await p.evaluate(NL_READ);
      check(dark && r.stamp && r.stampBg && r.stampBg !== 'none' && /^url\("data:image\/svg\+xml/.test(r.stampBg), `namedlinks watermark (colorScheme dark, prefers-color-scheme: dark ${dark}): the stamp layer's background is not none (${r.stampBg}…)`);
      writeFileSync(path.join(OUT, 'nl-sam-dark.png'), await p.screenshot());
      await harvestCsp(p);
    } finally {
      await c.close();
    }
  }
  // print: the longest chapter, through pdf.js
  {
    const c = await newContext({ serviceWorkers: 'block' });
    try {
      let best = { i: 0, len: -1 };
      const n = ((await (await c.request.get(samUrl)).text()).match(/<details class="rd-nav"><summary>Chapters \((\d+)\)/) || [])[1];
      for (let i = 0; i < Number(n || 1); i++) {
        const html = await (await c.request.get(samUrl + '?c=' + i)).text();
        const main = (html.split('id="rdRoot"')[1] || '').split('</main>')[0].replace(/<[^>]+>/g, '');
        if (main.length > best.len) best = { i, len: main.length };
      }
      const p = await watch(await c.newPage());
      await p.goto(samUrl + '?c=' + best.i);
      await p.evaluate(() => document.fonts.ready);
      const pdf = await p.pdf({ format: 'A4' });
      writeFileSync(path.join(OUT, 'nl-sam-print.pdf'), pdf);
      note(`namedlinks watermark (print): chapter ${best.i} of ${n} (${best.len} characters of text), printed A4 by Chromium ${browser.version()} (page.pdf, background graphics off, as a reader's Print would be); pdf.js 6.4.299 in the 1.0 page`);
      const pages = await one.evaluate(NL_PDF, [pdf.toString('base64')]);
      check(pages.length >= 2, `namedlinks watermark (print): the chapter prints to ${pages.length} pages (≥ 2)`);
      check(pages[0] && pages[0].text.includes('Shared with Sam') && pages[0].text.includes(want), `namedlinks watermark (print): pdf.js finds "${want}" in page 1's text`);
      note(`namedlinks watermark (print): per page, cells clear of text / with the stamp's light ink / light-ink pixels: ${pages.map((x, i) => `p${i + 1} ${x.free}/${x.inked}/${x.ink}`).join(', ')}`);
      const bad = pages.map((x, i) => [i + 1, x]).filter(([, x]) => !(x.free > 0 && x.inked >= 8));
      check(pages.length >= 2 && bad.length === 0, `namedlinks watermark (print): on every page (${pages.length}), drawn by pdf.js, the stamp's ink is in the cells with no text (≥ 8 cells of 16 px)${bad.length ? ' — missing on page(s) ' + bad.map(([i, x]) => `${i} (${x.inked} of ${x.free})`).join(', ') : ''}`);
      check(!pages.slice(1).some((x) => x.text.includes(want)), `namedlinks watermark (print): the stamp is an image, not text (no "${want}" in the text after page 1) — the canvas check above is what proves it on every page`);
      await harvestCsp(p);
    } finally {
      await c.close();
    }
  }
}

async function namedLinksChecks() {
  const stripe = await w7aFakeStripe();
  const srv = await startServer({ repo: REPO, api: true, apiConfig: { stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base } });
  note(`namedlinks: the real server on ${srv.origin} (PGlite), billing in test mode against a fake Stripe on ${stripe.base}`);
  try {
    await namedLinksParity(srv);
  } finally {
    await srv.stop().catch(() => undefined);
    await stripe.close();
  }
}

/* 94: the archive beside 1.0 — the list, a file saved there, the EPUBCheck request. */
async function wave7bArchive(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  const ctx1 = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'a2');
    const book = (await exportBackup(page)).json.book;
    await w7aSignUp(ctx1, origin, w7aEmail('a1'));
    const one = await w7bOneLinked(ctx1, origin, book);
    const w2 = w7aWrites(page), w1 = w7aWrites(one);
    await w5aOpenModal(page);
    await one.evaluate(() => document.getElementById('btnExport').click());
    for (const p of [page, one]) await p.waitForFunction(() => document.getElementById('archiveSec')?.style.display === '' && /Nothing archived yet/.test(document.getElementById('archiveList').textContent), null, { timeout: 30_000 });
    for (const [id, n] of [['#btnArcMd', 1], ['#btnArcEpub', 2]])
      for (const p of [page, one]) {
        await p.click(id);
        await p.waitForFunction((k) => document.querySelectorAll('#archiveList .arc-row').length === k, n, { timeout: 60_000 });
      }
    const rowsOf = (p) => p.$$eval('#archiveList .arc-row', (rs) => rs.map((r) => [r.textContent, r.querySelector('a')?.getAttribute('href')?.replace(/[0-9a-f-]{36}/, '<id>') ?? null]));
    const r2 = await rowsOf(page), r1 = await rowsOf(one);
    check(JSON.stringify(r2) === JSON.stringify(r1), `wave7b constraint 94: the archive list is 1.0's: ${JSON.stringify(r2)}${JSON.stringify(r2) === JSON.stringify(r1) ? '' : ' — 1.0: ' + JSON.stringify(r1)}`);
    const q2 = w7bReq(w2, /^\/api\/exports/), q1 = w7bReq(w1, /^\/api\/exports/);
    check(JSON.stringify(q2) === JSON.stringify(q1), `wave7b constraint 94: saving to the archive sends 1.0's requests: ${JSON.stringify(q2)}${JSON.stringify(q2) === JSON.stringify(q1) ? '' : ' — 1.0: ' + JSON.stringify(q1)}`);
    const n2 = w2.length, n1 = w1.length;
    for (const p of [page, one]) {
      await p.click('#archiveList [data-epubcheck]');
      await p.waitForFunction(() => { const b = document.getElementById('epubCheckResult'); return b && b.style.display === '' && !/is reading your book/.test(b.textContent); }, null, { timeout: 90_000 });
    }
    const e2 = w7bReq(w2.slice(n2), /^\/api\/jobs/), e1 = w7bReq(w1.slice(n1), /^\/api\/jobs/);
    check(JSON.stringify(e2) === JSON.stringify(e1) && e2.length === 1, `wave7b constraint 94: Run EPUBCheck sends 1.0's request: ${JSON.stringify(e2)}${JSON.stringify(e2) === JSON.stringify(e1) ? '' : ' — 1.0: ' + JSON.stringify(e1)}`);
    const t2 = await page.$eval('#epubCheckResult', (x) => x.textContent), t1 = await one.$eval('#epubCheckResult', (x) => x.textContent);
    check(t2 === t1, `wave7b constraint 94: the EPUBCheck answer reads as 1.0's: "${t2.slice(0, 160)}"${t2 === t1 ? '' : ' — 1.0: "' + t1.slice(0, 160) + '"'}`);
    note('wave7b archive: EPUBCheck on this server (no Java, no EPUBCHECK_JAR) answers: ' + t2.slice(0, 160) + ' — a real EPUBCheck run is not exercised (named gap)');
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx1.close();
    await ctx.close();
  }
}

/* 95: offline — 1.0's pill and words; an edit stays on the device until the connection returns, then saves once. */
async function wave7bOffline(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'o2');
    const one = await openOne(ctx, origin);
    await page.bringToFront();
    const writes = w7aWrites(page);
    const rev = await page.evaluate(() => window.beukCloud.cloud.baseRevision);
    await ctx.setOffline(true);
    for (const p of [page, one]) await p.waitForFunction(() => document.getElementById('netPill') && !document.getElementById('netPill').hidden, null, { timeout: 10_000 });
    const w2 = await page.$eval('#netPill', (x) => x.textContent), w1 = await one.$eval('#netPill', (x) => x.textContent);
    check(w2 === w1, `wave7b constraint 95: offline, 2.0 shows 1.0's pill and words: "${w2}"${w2 === w1 ? '' : ' — 1.0: "' + w1 + '"'}`);
    const ch = sectionsOf(f.book).findIndex((s) => s.type === 'chapter');
    await choose(page, ch);
    await page.click('#manuscript .ms-editor');
    await page.keyboard.press('End');
    await page.keyboard.type(' Written offline.', { delay: 20 });
    await page.waitForTimeout(4000);
    const off = w7aManuscriptWrites(writes);
    const line = await page.$eval('#syncText', (x) => x.textContent);
    check(off.length === 0, `wave7b constraint 95: an edit offline stays on the device: ${off.length} shelf saves while offline (the shelf line: "${line}")`);
    await ctx.setOffline(false);
    await w7aWait(page, () => window.beukCloud.cloud.syncStatus === 'saved' && !window.beukCloud.dirty, null, 60_000);
    await page.waitForTimeout(1500);
    const on = w7aManuscriptWrites(writes);
    const conflict = await page.evaluate(() => !!window.beukCloud.cloud.conflict || !!document.getElementById('modalConflict')?.classList.contains('open'));
    const rev2 = await page.evaluate(() => window.beukCloud.cloud.baseRevision);
    check(on.length === 1 && on[0].method === 'PUT' && !conflict && rev2 === rev + 1, `wave7b constraint 95: back online it saves once, with no conflict against itself (${on.length} saves, revision ${rev} → ${rev2}, conflict ${conflict})`);
    await harvestCsp(page);
    await harvestCsp(one);
  } finally {
    await ctx.close();
  }
}

/* 95, decision 4: the update bar on a new worker; no page reloads by itself; only the tab that asks reloads. */
async function wave7bUpdate(srv) {
  const origin = srv.origin;
  const swFile = path.join(REPO, 'client', 'next', 'sw.js');
  const orig = readFileSync(swFile);
  const ctx = await newContext();
  const navs = [];
  try {
    const a = await openNext(ctx, origin);
    await a.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30_000 }).catch(async () => {
      await a.reload();
      await a.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
    });
    await a.waitForSelector('#updateBar', { state: 'attached', timeout: 30_000 });
    const scope = await a.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
    check(scope === origin + '/next/', `wave7b decision 4: 2.0's worker is scoped to /next/ (${scope})`);
    const cached = await a.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    check(cached.length > 0 && !cached.some((p) => p.startsWith('/api/') || p.startsWith('/studio')), `wave7b decision 4: the worker's caches hold no /api/ and nothing of 1.0's /studio (${cached.length} entries)`);
    await a.evaluate(() => { window.__mark = 'a'; });
    // decision 4 (the gate of 0850ee1 saw page a navigate here): every navigation of a's main frame from now on is
    // recorded, with Chromium's own reason for it, and any one is a failure
    a.on('framenavigated', (fr) => { if (fr === a.mainFrame()) navs.push('navigated ' + fr.url()); });
    const cdpA = await ctx.newCDPSession(a);
    await cdpA.send('Page.enable');
    cdpA.on('Page.frameRequestedNavigation', (e) => navs.push('requested: ' + e.reason + ' ' + e.disposition + ' ' + e.url));
    cdpA.on('Page.frameScheduledNavigation', (e) => navs.push('scheduled: ' + e.reason + ' ' + e.url));
    a.on('console', (m) => { if (process.env.W7B_DEBUG) console.log('   [a]', m.type(), m.text().slice(0, 200)); });
    writeFileSync(swFile, Buffer.concat([orig, Buffer.from('\n/* wave7b e2e: a new deployment */\n')]));
    await a.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await a.waitForFunction(() => document.getElementById('updateBar') && !document.getElementById('updateBar').hidden, null, { timeout: 30_000 });
    const words = await a.$eval('#updateBar', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    // (the gate's "Execution context was destroyed" was THIS page, 1.0's: on a first visit its worker installs, claims the
    // page, and 1.0's controllerchange listener reloaded it — 1.0 fix below. Its main-frame navigations are recorded.)
    const one = await openOne(ctx, origin);
    const oneNavs = [];
    one.on('framenavigated', (fr) => { if (fr === one.mainFrame()) oneNavs.push(fr.url()); });
    await one.evaluate(() => { window.__mark1 = 1; });
    await one.waitForFunction(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller, null, { timeout: 30_000 }).catch(() => undefined);
    await one.waitForTimeout(2500);
    const kept = await one.evaluate(() => window.__mark1 ?? null).catch(() => null);
    check(kept === 1 && oneNavs.length === 0, `1.0 fix (V, 2026-11-04): 1.0's page is not reloaded when its worker first takes control (navigations ${JSON.stringify(oneNavs)}, controlled ${await one.evaluate(() => !!navigator.serviceWorker.controller).catch(() => '?')})`);
    const want = await one.$eval('#updateBar', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    check(words === want, `wave7b constraint 95: a new worker shows 1.0's update bar: "${words}"${words === want ? '' : ' — 1.0: "' + want + '"'}`);
    await a.waitForTimeout(5000);
    check((await a.evaluate(() => window.__mark)) === 'a', 'wave7b decision 4: the page with the bar never reloads by itself (5 s)');
    await a.click('#btnUpdateLater');
    check(await a.$eval('#updateBar', (x) => x.hidden), 'wave7b constraint 95: Later hides the bar');
    const b = await openNext(ctx, origin);
    await b.waitForFunction(() => document.getElementById('updateBar') && !document.getElementById('updateBar').hidden, null, { timeout: 30_000 });
    await b.evaluate(() => { window.__mark = 'b'; });
    const nav = b.waitForEvent('framenavigated', { timeout: 30_000 });
    await b.click('#btnUpdateReload');
    await nav;
    await b.waitForSelector('#topbar');
    check((await b.evaluate(() => window.__mark ?? null)) === null, 'wave7b constraint 95: Reload takes the new worker and reloads that tab');
    await a.waitForTimeout(2000);
    check((await a.evaluate(() => window.__mark)) === 'a', 'wave7b decision 4: the other tab is not reloaded by it');
    check(navs.length === 0, `wave7b decision 4: page a never navigated from the new worker's arrival to the end (${navs.length}${navs.length ? ': ' + JSON.stringify(navs.slice(0, 4)) : ''})`);
    await harvestCsp(a);
    await harvestCsp(b);
  } catch (e) {
    check(false, `wave7b decision 4: the update part threw (${String(e && e.message).split(String.fromCharCode(10))[0]} at ${String(e && e.stack).split(String.fromCharCode(10)).find((l) => l.includes("book.mjs")) || "?"}) — page a's navigations since the new worker: ${JSON.stringify(navs)}`);
  } finally {
    // the deployed worker is put back whatever happened (a later step and the next run read client/next/sw.js)
    writeFileSync(swFile, orig);
    await ctx.close();
  }
}

/* 96: error reports — off by default; on, one report of 1.0's shape; nothing of the hostile book in it. */
async function wave7bErrors(srv) {
  const origin = srv.origin;
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const hostile = w5aHostileBook(lan);
  const file = { name: 'w7b-hostile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile })) };
  for (const on of [false, true]) {
    const ctx = await newContext({ serviceWorkers: 'block' });
    if (on) await ctx.addInitScript(() => localStorage.setItem('beuk.errors.v1', 'on'));
    try {
      const email = w7aEmail('e');
      await w7aSignUp(ctx, origin, email);
      const page = await w7aNext(ctx, origin, file);
      const sent = [], outside = [];
      page.on('request', (r) => {
        const u = r.url();
        if (new URL(u).pathname === '/api/client-errors') sent.push({ body: r.postData() || '', headers: r.headers() });
        if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
      });
      await page.click('#btnSettings2');
      await page.waitForSelector('#setErrReports');
      check((await page.$eval('#setErrReports', (x) => x.checked)) === on, `wave7b constraint 96: the opt-in reads ${on ? 'on' : 'off (the default)'} in Project Settings`);
      await page.keyboard.press('Escape');
      // an error the page raises while the hostile book is open (this run's own page error, not counted against it)
      w7bProbe.on = true;
      await page.evaluate(() => setTimeout(() => { throw new Error('wave7b-probe: Cannot read properties of null'); }, 0));
      await page.waitForTimeout(1500);
      w7bProbe.on = false;
      if (!on) check(sent.length === 0, `wave7b constraint 96: off by default, an error sends nothing (${sent.length} reports)`);
      else {
        check(sent.length === 1, `wave7b constraint 96: on, one report of the error (${sent.length})`);
        const body = sent[0] ? JSON.parse(sent[0].body) : {};
        check(JSON.stringify(Object.keys(body)) === JSON.stringify(['kind', 'message', 'stack', 'build', 'lang', 'device', 'at']), `wave7b constraint 96: the report is 1.0's shape (${Object.keys(body).join(', ')})`);
        const text = sent[0]?.body || '';
        const leaks = ['Hostile', 'evil.example', '__pw', 'Writer ', 'w7b-hostile', email, W7A_PW].filter((x) => text.includes(x));
        check(leaks.length === 0 && !sent[0]?.headers.cookie, `wave7b decision 5: an error that does not quote the book: the report carries no book text, title, file name, e-mail, password or cookie (${leaks.length ? 'found: ' + leaks.join(', ') : 'none of them'}): ${text.slice(0, 220)}`);
        // review I-2: an error that DOES quote the open book (its title unquoted; a passage in a quote cut off, as a
        // library's content error may write it): since b3d978d nothing of the message is sent
        const n0 = sent.length;
        w7bProbe.on = true;
        await page.evaluate((h) => {
          setTimeout(() => { throw new Error('wave7b-probe: Cannot open ' + h.title + ' (chapter 2)'); }, 0);
          setTimeout(() => { throw new Error('wave7b-probe: Invalid content for node paragraph: <"' + h.para); }, 10);
        }, { title: hostile.meta.title, para: String(hostile.sections.find((s) => String(s.content || '').length > 80).content).slice(0, 50) });
        await page.waitForTimeout(1500);
        w7bProbe.on = false;
        const quoting = sent.slice(n0).map((x) => x.body);
        const qLeaks = ['Hostile', 'evil.example', '__pw', 'Invalid content', 'chapter 2', String(hostile.sections.find((s) => String(s.content || '').length > 80).content).slice(0, 12)].filter((x) => quoting.some((b) => b.includes(x)));
        check(quoting.length === 2 && qLeaks.length === 0, `wave7b decision 5 (V's ruling, review I-2): errors that quote the open book send none of it — ${quoting.length} reports, messages ${JSON.stringify(quoting.map((b) => JSON.parse(b).message))}${qLeaks.length ? ', found: ' + qLeaks.join(', ') : ''}`);

      }
      check(outside.length === 0, `wave7b constraint 96: no request left ${origin} (${outside.length})`);
      await harvestCsp(page);
    } finally {
      await ctx.close();
    }
  }
}
const w7bProbe = { on: false, one: false, oneErrors: [] };

/* 98: opening the share, archive and bulk dialogs, and going offline and back, send no manuscript PUT/POST. */
async function wave7bNoEdit(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/salt-road-book-one');
  const ctx = await newContext({ serviceWorkers: 'block' });
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'g');
    await page.waitForTimeout(3000);
    const writes = w7aWrites(page);
    const steps = [];
    await w5aOpenModal(page);
    await page.waitForSelector('#betaSec', { timeout: 30_000 });
    await page.waitForTimeout(800);
    steps.push('the export modal (the archive and share sections)');
    await page.click('#btnCloseExport');
    await page.click('#btnBetaComments');
    await page.waitForSelector('#modalBetaComments.open');
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    steps.push('the reader comments');
    await page.click('#btnAccount');
    await page.waitForSelector('#modalShelf.open #shelfBulk');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    steps.push('the shelf dialog (the bulk block)');
    await ctx.setOffline(true);
    await page.waitForTimeout(1500);
    await ctx.setOffline(false);
    await page.waitForTimeout(3500);
    steps.push('offline and back');
    const w = w7aManuscriptWrites(writes);
    check(w.length === 0, `wave7b constraint 98: ${steps.join(', ')} — ${w.length} manuscript writes${w.length ? ' ' + JSON.stringify(w.map((x) => x.method + ' ' + w7aId(x.path))) : ''}`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}

/* Screenshots beside 1.0 (Paper, Candlelight, Arabic): the share section, the bulk block, the archive section, the net
   pill, the update bar. */
async function wave7bScreens(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await newContext();
  const diffPage = await diffCtx.newPage();
  const out = [];
  try {
    for (const look of ['paper', 'candlelight', 'ar']) {
      const ctx = await newContext({ serviceWorkers: 'block' });
      await ctx.addInitScript((l) => {
        if (l === 'candlelight') localStorage.setItem('beuk.theme.v1', 'candlelight');
        if (l === 'ar') localStorage.setItem('beuk.uiLang.v1', 'ar');
      }, look);
      try {
        const page = await w7bNextLinked(ctx, origin, f.file, 'x' + look);
        const book = (await exportBackup(page)).json.book;
        const id = await page.evaluate(() => window.beukCloud.cloud.linkedId);
        const one = await w7aOne(ctx, origin);
        // 1.0's desk holds the same book, linked to the same shelf copy (the same account)
        await one.evaluate(([b, i]) => { applyBookDoc(JSON.parse(JSON.stringify(b))); cloud.linkedId = i; cloud.linkState = 'linked'; cloudDirty = false; renderCloudChrome(); }, [book, id]);
        const shot = async (p, sel) => {
          await p.waitForTimeout(400);
          const el = await p.$(sel);
          return el ? el.screenshot({ animations: 'disabled' }) : null;
        };
        const pairs = [];
        await w5aOpenModal(page);
        await one.evaluate(() => document.getElementById('btnExport').click());
        for (const p of [page, one]) await p.waitForFunction(() => !!document.getElementById('betaSec') && document.getElementById('archiveSec').style.display === '' && !!document.querySelector('#betaList .shelf-empty') && !!document.querySelector('#archiveList .shelf-empty'), null, { timeout: 30_000 });
        await page.waitForTimeout(800);

        for (const p of [page, one]) await p.$eval('#archiveSec', (x) => x.scrollIntoView());
        pairs.push(['archive', await shot(page, '#archiveSec'), await shot(one, '#archiveSec')]);
        for (const p of [page, one]) await p.$eval('#betaSec', (x) => x.scrollIntoView());
        pairs.push(['share', await shot(page, '#betaSec'), await shot(one, '#betaSec')]);
        await page.click('#btnCloseExport');
        await one.evaluate(() => document.getElementById('modalExport').classList.remove('open'));
        await page.click('#btnAccount');
        await page.waitForSelector('#modalShelf.open');
        await one.evaluate(() => $('btnAccount').click());
        for (const p of [page, one]) await p.$eval('#shelfBulk', (x) => x.scrollIntoView());
        pairs.push(['bulk', await shot(page, '#shelfBulk'), await shot(one, '#shelfBulk')]);
        await page.keyboard.press('Escape');
        await one.evaluate(() => $('modalShelf').classList.remove('open'));
        await page.evaluate(() => window.beukCloud.api.showUpdateBar({}));
        await one.evaluate(() => showUpdateBar({}));
        pairs.push(['update', await shot(page, '#updateBar'), await shot(one, '#updateBar')]);
        await page.evaluate(() => window.beukCloud.api.setConnectivity(false));
        await one.evaluate(() => setConnectivity(false));
        pairs.push(['netPill', await shot(page, '#netPill'), await shot(one, '#netPill')]);
        for (const [name, x, y] of pairs) {
          if (!x || !y) {
            out.push(`${look} ${name}: not drawn`);
            continue;
          }
          writeFileSync(path.join(OUT, `w7b-${look}-${name}-next.png`), x);
          writeFileSync(path.join(OUT, `w7b-${look}-${name}-1.0.png`), y);
          const d = await pixelDiff(diffPage, x, y);
          out.push(`${look} ${name}: ${(d.ratio * 100).toFixed(2)} %${d.size[0] !== d.size[2] || d.size[1] !== d.size[3] ? ' (sizes ' + d.size.join('×') + ')' : ''}`);
        }
        await harvestCsp(page);
        await harvestCsp(one);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
  note('wave7b screenshots (2.0 against 1.0, pixels over the delta): ' + out.join('; '));
}

/* V's ruling (2026-11-04, review I-3): 1.0's own page with 5a's hostile book on its desk runs nothing — no script ran
   (window.__pw stays undefined) and no handler attribute stands anywhere in the DOM — after the book arrives and after its
   chapters, the preview and the Style tab have drawn it. Its page errors are listed (the SyntaxError lead). */
async function wave7bOneXss(srv) {
  const origin = srv.origin;
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const hostile = w5aHostileBook(lan);
  const ctx = await newContext({ serviceWorkers: 'block' });
  const errs = [];
  try {
    const one = await ctx.newPage();
    one.on('pageerror', (e) => errs.push(String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)));
    one.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-9]/.test(m.text())) errs.push('console: ' + m.text() + ' ' + JSON.stringify(m.location())); });
    await one.goto(origin + '/studio');
    await one.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
    await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), hostile);
    await one.waitForTimeout(1500);
    // every section drawn in 1.0's editor and preview, then the Style tab
    const n = await one.evaluate(() => state.sections.length);
    for (let i = 0; i < n; i++) {
      await one.evaluate((k) => { try { selectSection(state.sections[k].id); } catch (e) { window.__w7bSel = String(e); } }, i);
      await one.waitForTimeout(120);
    }
    await one.evaluate(() => { try { document.querySelector('[data-ctab="style"], #tabStyle')?.click(); } catch (e) {} });
    await one.waitForTimeout(1500);
    const seen = await one.evaluate(() => ({
      pw: window.__pw ?? null,
      handlers: [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((a) => /^on/i.test(a.name)).map((a) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).slice(0, 40) + ' ' + a.name)),
      scripts: [...document.querySelectorAll('script')].filter((s) => /__pw/.test(s.textContent)).length,
    }));
    check(seen.pw === null && seen.handlers.length === 0 && seen.scripts === 0, `1.0 fix (review I-3): 1.0's page with the hostile book runs nothing — __pw ${seen.pw}, ${seen.handlers.length} handler attribute(s)${seen.handlers.length ? ' ' + JSON.stringify(seen.handlers.slice(0, 6)) : ''}, ${seen.scripts} hostile script element(s)`);
    note(`1.0's page with the hostile book: page errors ${JSON.stringify(errs.slice(0, 6))}`);
  } finally {
    await ctx.close();
  }
}

/* The 7a gap: the hostile book through the shelf parity run (constraint 85). */
async function wave7bHostileParity(srv) {
  const lan = fixtures.find((x) => x.name === 'real/lantern-coast-book-one').book;
  const hostile = w5aHostileBook(lan);
  const file = path.join(OUT, 'w7b-hostile-book.json');
  writeFileSync(file, JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: new Date(0).toISOString(), book: hostile }));
  w7bProbe.one = true;
  try {
    await wave7aParity(srv, [{ name: 'hostile (5a)', file, book: hostile }]);
  } finally {
    w7bProbe.one = false;
  }
  note(`wave7b (7a gap): 1.0's own page with the hostile book on its desk logged ${w7bProbe.oneErrors.length} error(s), not 2.0's: ${JSON.stringify(w7bProbe.oneErrors.slice(0, 3))}`);
}

async function wave7bChecks() {
  const stripe = await w7aFakeStripe();
  const srv = await startServer({ repo: REPO, api: true, apiConfig: { stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base } });
  note(`wave7b: the real server on ${srv.origin} (PGlite), billing in test mode against a fake Stripe on ${stripe.base}`);
  const only = (process.env.W7B_PARTS || 'bulk,share,day22,archive,offline,update,errors,noedit,onexss,hostile,screens,latency').split(',');
  try {
    if (only.includes('bulk')) await wave7bBulk(srv);
    if (only.includes('share')) await wave7bShare(srv);
    if (only.includes('day22')) await wave7bDay22(srv);
    if (only.includes('archive')) await wave7bArchive(srv);
    if (only.includes('offline')) await wave7bOffline(srv);
    if (only.includes('update')) await wave7bUpdate(srv);
    if (only.includes('errors')) await wave7bErrors(srv);
    if (only.includes('noedit')) await wave7bNoEdit(srv);
    if (only.includes('onexss')) await wave7bOneXss(srv);
    if (only.includes('hostile')) await wave7bHostileParity(srv);

    if (only.includes('screens')) await wave7bScreens(srv);
    if (only.includes('latency')) await wave7aLatency(srv);
    note(`wave7b: ${srv.shelf.mail.sent.length} mail(s) captured by the server, none sent; Stripe calls (all to the fake on 127.0.0.1): ${stripe.calls.length}`);
  } finally {
    await srv.stop().catch(() => undefined);
    await stripe.close();
  }
}

/* ---- locked review copy (design 2026-11-06, task 4): lockcopyChecks (E2E_ONLY=lockcopy) ----
   The real server (serve.mjs { api: true }: src/app.ts on PGlite, billing in test mode against a fake Stripe on
   127.0.0.1). 1.0 (/studio) and 2.0 (/next) side by side, each as its own account, the same book on each desk.
   - Parity: the three locked paths (the export dialog's Word file, the submission manuscript, the print-ready PDF's
     "Download locked copy") in both apps — the same controls, words, filenames and requests (method and path). Each
     locked file goes through its oracle: the DOCX through msoffcrypto-tool (e2e/oracles/docx-decrypt.py, its venv), the
     PDF through the vendored pdf.js in Chromium (1.0's own pdfLoadLib). The decrypted DOCX equals that side's unlocked
     file byte for byte, the zip's entry dates masked (JSZip stamps each build with the time); the locked PDF opens with
     the password to the unlocked PDF's pages (count, every page's text, page 1's pixels), is refused without it and
     with a wrong one. The unlocked files are equal across the apps.
   - The print-ready PDF: the pdfx job needs the renderer and Ghostscript, which this server has not. The job is NOT
     run: the app's own requests go to the real server (the print interior uploaded, the job made), the job's poll is
     answered "done" by the test (page route), and the finished file is a real archive row seeded on the real server
     with the committed real Ghostscript output (studio/test/fixtures/pdfx-sample.pdf), downloaded through the real
     /api/exports/<id>/download.
   - No leak: every request of the context, from page load through all three locked downloads — its URL, every header
     and the body: the password, its UTF-8 bytes in base64 and hex (and the password URL-encoded and UTF-16LE) appear
     nowhere. Nor in localStorage, sessionStorage or a console line.
   - 2.0's dialog stack: the PDF dialog keeps Tab inside it, Escape closes only it, focus returns to the link.
   - Day 22 (7a's server states): trial and paid show the lock controls; day 22 hides them (after the plan is known:
     the account box) and the unlocked downloads work. The hide is client-side only (no server request to refuse).
   - Lock off: the downloads are 920efea's, byte for byte (dates masked), when LOCKCOPY_BASE names a checkout of 920efea
     with its client/next built (a second static server serves it); without it, that comparison is reported NOT RUN.
   - Latency: the Dumas p95 with a PDF lock and a DOCX lock started as the measured typing starts.
   - Screenshots: the fieldset and the PDF dialog beside 1.0's, Paper, Candlelight and Arabic (gated as 5c's). */
const LC_PW = 'Lantern-Ünlock ζ7!';
const LC_FIXTURE = path.join(STUDIO, 'test', 'fixtures', 'pdfx-sample.pdf');
const LC_ORACLE = path.join(STUDIO, 'e2e', 'oracles', 'docx-decrypt.py');
const LC_PY = path.join(STUDIO, 'e2e', 'oracles', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const lcSha = (b) => createHash('sha256').update(b).digest('hex');
let lcSeq = 0;
/** msoffcrypto-tool through the oracle script: { status: 'ok', bytes } | { status: 'refused' } | { status: 'missing' | 'error', detail }. */
function lcDocxDecrypt(bytes, pw) {
  if (!existsSync(LC_PY)) return { status: 'missing', detail: 'no venv at ' + LC_PY };
  const n = ++lcSeq, inF = path.join(OUT, `lc-oracle-in-${n}.docx`), outF = path.join(OUT, `lc-oracle-out-${n}.docx`);
  writeFileSync(inF, bytes);
  const r = spawnSync(LC_PY, [LC_ORACLE, inF, outF, pw], { encoding: 'utf8', timeout: 120_000 });
  if (r.status === 0) return { status: 'ok', bytes: readFileSync(outF) };
  if (r.status === 1) return { status: 'refused', detail: (r.stderr || '').trim() };
  return { status: r.status === 3 ? 'missing' : 'error', detail: ((r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '')).trim().slice(0, 200) };
}
function lcOracleVersion() {
  if (!existsSync(LC_PY)) return null;
  const r = spawnSync(LC_PY, [LC_ORACLE, '--probe'], { encoding: 'utf8', timeout: 60_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
/** A zip with every entry's DOS time and date zeroed (central directory and local headers): what JSZip stamps per build. */
function lcZipMaskDates(buf) {
  const b = Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) return null;
    b.writeUInt32LE(0, p + 12); // time, date
    const local = b.readUInt32LE(p + 42);
    if (b.readUInt32LE(local) !== 0x04034b50) return null;
    b.writeUInt32LE(0, local + 10);
    p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return b;
}
const lcSameZip = (a, b) => {
  const x = lcZipMaskDates(a), y = lcZipMaskDates(b);
  return !!x && !!y && x.equals(y);
};
/** Every request a context sends (URL, method, all headers, body), from its first page on. */
function lcRecord(ctx) {
  const reqs = [];
  ctx.on('request', (r) => {
    const e = { url: r.url(), method: r.method(), headers: r.headers(), body: r.postDataBuffer(), at: Date.now() };
    reqs.push(e);
    e.ready = r.allHeaders().then((h) => { e.headers = h; }, () => undefined);
  });
  return reqs;
}
/** Where the password (or a form of it) appears in the recorded requests. */
async function lcLeaks(reqs, pw) {
  await Promise.all(reqs.map((r) => r.ready));
  const u8 = Buffer.from(pw, 'utf8');
  const texts = [pw, u8.toString('base64'), u8.toString('hex'), u8.toString('hex').toUpperCase(), encodeURIComponent(pw), Buffer.from(pw, 'utf16le').toString('base64')];
  const bins = [u8, Buffer.from(pw, 'utf16le'), ...texts.map((t) => Buffer.from(t, 'utf8'))];
  const hits = [];
  for (const r of reqs) {
    let url = r.url;
    try { url += ' ' + decodeURIComponent(r.url); } catch { /* not decodable */ }
    if (texts.some((t) => url.includes(t))) hits.push('URL ' + r.method + ' ' + r.url.slice(0, 80));
    for (const [k, v] of Object.entries(r.headers || {})) if (texts.some((t) => (k + ': ' + v).includes(t))) hits.push('header ' + k + ' of ' + r.method + ' ' + r.url.slice(0, 60));
    if (r.body && bins.some((n) => r.body.indexOf(n) >= 0)) hits.push('body of ' + r.method + ' ' + r.url.slice(0, 60));
  }
  return hits;
}
const lcApi = (reqs, from = 0) => reqs.slice(from).filter((r) => /\/api\/(exports|jobs)/.test(new URL(r.url).pathname)).map((r) => r.method + ' ' + w7aId(new URL(r.url).pathname));
async function lcDownload(page, click, timeout = 180_000) {
  const dl = page.waitForEvent('download', { timeout });
  await click();
  const d = await dl;
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
/** The controls of a fieldset or dialog, as the writer meets them (icons left out). */
const LC_DESCRIBE = (sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  return [...root.querySelectorAll('*')].filter((e) => !e.closest('svg') && !['svg', 'i'].includes(e.tagName.toLowerCase())).map((e) =>
    [e.tagName.toLowerCase(), e.id, e.getAttribute('name') || '', e.getAttribute('type') || '', e.getAttribute('autocomplete') || '', e.getAttribute('data-i18n') || '', e.hidden ? 'hidden' : '', e.disabled ? 'disabled' : '', e.checked ? 'checked' : '', e.children.length ? '' : (e.textContent || '').trim()].join('|'));
};
async function lcOpenExport(p, app) {
  if (app === 'two') return w5aOpenModal(p);
  await p.evaluate(() => document.getElementById('btnExport').click());
  await p.waitForFunction(() => document.getElementById('modalExport')?.classList.contains('open') && document.querySelectorAll('#platformGrid [data-platform]').length === 11 && !!window.JSZip, null, { timeout: 30_000 });
}
/** The print-ready job's poll answered "done" (the job is NOT run here: see above), its file a real archive row seeded on
 *  the real server with the committed Ghostscript output. Returns the seeded row's facts. */
async function lcFakePdfxDone(ctx, origin, reqs) {
  const seeded = { id: null, filename: null };
  await ctx.route(/\/api\/jobs\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!seeded.id) {
      const up = reqs.filter((x) => x.method === 'POST' && /\/api\/exports\?/.test(x.url) && /format=print-html/.test(x.url)).pop();
      if (!up) return route.continue();
      const q = new URL(up.url).searchParams;
      seeded.filename = q.get('filename').replace(/\.[^.]*$/, '') + '-pdfx.pdf';
      const r = await ctx.request.post(origin + '/api/exports?manuscriptId=' + encodeURIComponent(q.get('manuscriptId')) + '&format=pdfx&filename=' + encodeURIComponent(seeded.filename), { data: readFileSync(LC_FIXTURE), headers: { 'content-type': 'application/octet-stream' } });
      seeded.id = (await r.json()).export?.id ?? null;
    }
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: { id, kind: 'pdfx', sourceExportId: null, artifactExportId: seeded.id, status: 'done', result: { tool: 'ghostscript', artifactExportId: seeded.id }, createdAt: new Date().toISOString(), startedAt: null, finishedAt: new Date().toISOString() } }) });
  });
  return seeded;
}
/** Download print-ready PDF in the open export modal, through to the finished panel (its two links). */
async function lcPrintReadyDone(p, app) {
  if (app === 'two') await p.click('#btnPrintReadyPdf');
  else await p.evaluate(() => document.getElementById('btnPrintReadyPdf').click());
  await p.waitForSelector('#printReadyNote [data-pr-download]', { timeout: 120_000 });
}
/** One app through the three paths, lock off then on (the same book, the same password). */
async function lcPaths(p, app, reqs) {
  const out = { marks: {}, files: {}, controls: {}, stack: null };
  await lcOpenExport(p, app);
  out.files.docx = await lcDownload(p, () => p.click('#btnDownloadDocx'));
  await p.check('#lockDocxOn');
  out.controls.docx = await p.evaluate(LC_DESCRIBE, '#lockDocx');
  await p.fill('#lockDocxPw', LC_PW);
  await p.fill('#lockDocxPw2', LC_PW);
  out.marks.docx = reqs.length;
  out.files.docxLocked = await lcDownload(p, () => p.click('#btnDownloadDocx'));
  await p.waitForFunction(() => !document.getElementById('btnDownloadDocx').disabled);
  out.marks.docxEnd = reqs.length;
  out.after = { docx: await p.evaluate(() => [document.getElementById('lockDocxPw').value, document.getElementById('lockDocxPw2').value, document.getElementById('lockDocxOn').checked]) };
  await p.click('#btnMsOpen');
  await p.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
  out.files.ms = await lcDownload(p, () => p.click('#btnMsDownload'));
  await p.check('#lockMsOn');
  out.controls.ms = await p.evaluate(LC_DESCRIBE, '#lockMs');
  await p.fill('#lockMsPw', LC_PW);
  await p.fill('#lockMsPw2', LC_PW);
  out.marks.ms = reqs.length;
  out.files.msLocked = await lcDownload(p, () => p.click('#btnMsDownload'));
  await p.waitForFunction(() => !document.getElementById('btnMsDownload').disabled);
  out.marks.msEnd = reqs.length;
  out.after.ms = await p.evaluate(() => [document.getElementById('lockMsPw').value, document.getElementById('lockMsPw2').value, document.getElementById('lockMsOn').checked]);
  await p.click('#btnMsClose');
  await lcOpenExport(p, app);
  out.marks.pr = reqs.length;
  await lcPrintReadyDone(p, app);
  out.files.pdf = await lcDownload(p, () => p.click('#printReadyNote [data-pr-download]'));
  out.prLinks = await p.evaluate(() => [...document.querySelectorAll('#printReadyNote a')].map((a) => [a.textContent, a.getAttribute('href').replace(/[0-9a-f-]{36}/, '<id>'), a.hidden ? 'hidden' : '']));
  await p.click('#printReadyNote [data-pr-locked]');
  await p.waitForSelector('#modalLockPdf.open');
  out.controls.pdf = await p.evaluate(LC_DESCRIBE, '#modalLockPdf .modal');
  if (app === 'two') {
    // 2.0's dialog stack (the fix in this task): Tab stays inside, Escape closes only this dialog, focus returns to the link
    const where = () => p.evaluate(() => ({ inside: !!document.getElementById('modalLockPdf')?.contains(document.activeElement), id: document.activeElement?.id || document.activeElement?.getAttribute('data-pr-locked') && 'link' || document.activeElement?.tagName }));
    const seen = [await where()];
    for (let i = 0; i < 5; i++) {
      await p.keyboard.press('Tab');
      seen.push(await where());
    }
    for (let i = 0; i < 3; i++) {
      await p.keyboard.press('Shift+Tab');
      seen.push(await where());
    }
    await p.fill('#lockPdfPw', 'typed then escaped');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    const after = await p.evaluate(() => ({ lock: document.getElementById('modalLockPdf').classList.contains('open'), exp: document.getElementById('modalExport').classList.contains('open'), pw: document.getElementById('lockPdfPw').value, focus: document.activeElement?.getAttribute('data-pr-locked') ? 'link' : document.activeElement?.id || document.activeElement?.tagName }));
    out.stack = { seen, after };
    await p.click('#printReadyNote [data-pr-locked]');
    await p.waitForSelector('#modalLockPdf.open');
  }
  // final review F1/F3: a password SASLprep deletes (soft hyphen; joiner + BOM) is refused up front, in lock.pdfEmpty, with no request and no file
  {
    const before = reqs.length;
    out.empty = [];
    for (const junk of ['\u00AD', '\u200D\uFEFF']) {
      await p.fill('#lockPdfPw', junk);
      await p.fill('#lockPdfPw2', junk);
      await p.click('#btnLockPdfGo');
      await p.waitForTimeout(150);
      out.empty.push(await p.evaluate(() => ({ err: document.getElementById('lockPdfErr').textContent, open: document.getElementById('modalLockPdf').classList.contains('open'), pw: [document.getElementById('lockPdfPw').value, document.getElementById('lockPdfPw2').value] })));
    }
    out.emptyReqs = reqs.length - before;
  }
  await p.fill('#lockPdfPw', LC_PW);
  await p.fill('#lockPdfPw2', LC_PW);
  out.marks.pdf = reqs.length;
  out.files.pdfLocked = await lcDownload(p, () => p.click('#btnLockPdfGo'));
  await p.waitForFunction(() => !document.getElementById('modalLockPdf').classList.contains('open'), null, { timeout: 60_000 });
  out.marks.pdfEnd = reqs.length;
  out.after.pdf = await p.evaluate(() => [document.getElementById('lockPdfPw').value, document.getElementById('lockPdfPw2').value]);
  out.store = await p.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  return out;
}
/** pdf.js 6.4.299 (vendored, 1.0's pdfLoadLib) in the 1.0 page: opens `b64` without a password, with a wrong one and with
 *  `pw`; the page count, every page's text (hashed), page 1 drawn (its PNG). */
const LC_PDFJS = async ([b64, pw, canvasId]) => {
  /* global pdfLoadLib */
  const lib = await pdfLoadLib();
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const hash = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0; return a.toString(16) + '.' + s.length; };
  const open = async (password) => {
    try {
      const task = lib.getDocument({ data: data.slice(), password, verbosity: 0, useWasm: false, isOffscreenCanvasSupported: false });
      const d = await task.promise;
      return { ok: true, d, task };
    } catch (e) {
      return { ok: false, name: e && e.name, code: e && e.code };
    }
  };
  const res = {};
  for (const [k, v] of [['none', undefined], ['wrong', pw ? pw + 'x' : undefined]]) {
    const r = await open(v);
    res[k] = r.ok ? 'opened' : r.name + ' ' + r.code;
    if (r.ok) await r.task.destroy();
  }
  const r = await open(pw || undefined);
  if (!r.ok) return { ...res, right: r.name + ' ' + r.code };
  res.right = 'opened';
  res.pages = r.d.numPages;
  const texts = [];
  for (let i = 1; i <= r.d.numPages; i++) {
    const pg = await r.d.getPage(i);
    const tc = await pg.getTextContent();
    texts.push(hash(tc.items.map((x) => x.str).join(' ')));
  }
  res.texts = texts;
  const p1 = await r.d.getPage(1);
  const vp = p1.getViewport({ scale: 1 });
  let c = document.getElementById(canvasId);
  if (!c) {
    c = document.createElement('canvas');
    c.id = canvasId;
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff';
    document.body.appendChild(c);
  }
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  await p1.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: vp }).promise;
  res.png = c.toDataURL('image/png').split(',')[1];
  res.size = [c.width, c.height];
  await r.task.destroy();
  return res;
};

async function lockcopyParity(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const c2 = await newContext({ serviceWorkers: 'block', acceptDownloads: true }), c1 = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
  const r2 = lcRecord(c2), r1 = lcRecord(c1);
  const consoleLines = [];
  const diffCtx = await newContext();
  const diffPage = await diffCtx.newPage();
  try {
    await lcFakePdfxDone(c2, origin, r2);
    await lcFakePdfxDone(c1, origin, r1);
    const two = await w7bNextLinked(c2, origin, f.file, 'lc2');
    const book = (await exportBackup(two)).json.book;
    await w7aSignUp(c1, origin, w7aEmail('lc1'));
    const one = await w7bOneLinked(c1, origin, book);
    for (const p of [two, one]) p.on('console', (m) => consoleLines.push(m.text()));
    const g2 = await lcPaths(two, 'two', r2);
    const g1 = await lcPaths(one, 'one', r1);
    // the same controls, words and filenames
    for (const k of ['docx', 'ms', 'pdf']) check(JSON.stringify(g2.controls[k]) === JSON.stringify(g1.controls[k]) && !!g1.controls[k]?.length, `lockcopy parity ${k}: 2.0's controls and words are 1.0's (${(g2.controls[k] || []).length} elements)${JSON.stringify(g2.controls[k]) === JSON.stringify(g1.controls[k]) ? '' : ' — 2.0: ' + JSON.stringify(g2.controls[k]).slice(0, 300) + ' — 1.0: ' + JSON.stringify(g1.controls[k]).slice(0, 300)}`);
    check(JSON.stringify(g2.prLinks) === JSON.stringify(g1.prLinks), `lockcopy parity pdf: the finished panel's links are 1.0's: ${JSON.stringify(g2.prLinks)}${JSON.stringify(g2.prLinks) === JSON.stringify(g1.prLinks) ? '' : ' — 1.0: ' + JSON.stringify(g1.prLinks)}`);
    const names = (g) => Object.fromEntries(Object.entries(g.files).map(([k, v]) => [k, v.name]));
    check(JSON.stringify(names(g2)) === JSON.stringify(names(g1)), `lockcopy parity: the filenames are 1.0's: ${JSON.stringify(names(g2))}${JSON.stringify(names(g2)) === JSON.stringify(names(g1)) ? '' : ' — 1.0: ' + JSON.stringify(names(g1))}`);
    const base = (n) => n.replace(/\.(docx|pdf)$/, '');
    for (const g of [g2, g1]) {
      check(g.files.docxLocked.name === base(g.files.docx.name) + '-locked.docx' && g.files.msLocked.name === base(g.files.ms.name) + '-locked.docx' && g.files.pdfLocked.name === base(g.files.pdf.name) + '-locked.pdf', `lockcopy ${g === g2 ? '2.0' : '1.0'}: each locked file is <the unlocked name>-locked (${g.files.docxLocked.name}, ${g.files.msLocked.name}, ${g.files.pdfLocked.name})`);
      check(JSON.stringify(g.after) === JSON.stringify({ docx: ['', '', true], ms: ['', '', true], pdf: ['', ''] }), `lockcopy ${g === g2 ? '2.0' : '1.0'}: after each locked download both fields are empty and the box is kept (${JSON.stringify(g.after)})`);
    }
    // the requests: none during the two Word locks; the PDF path's are 1.0's (method and path)
    for (const [g, r, who] of [[g2, r2, '2.0'], [g1, r1, '1.0']]) {
      const during = [...r.slice(g.marks.docx, g.marks.docxEnd), ...r.slice(g.marks.ms, g.marks.msEnd)].filter((x) => new URL(x.url).origin === origin);
      check(during.length === 0, `lockcopy ${who}: the Word and manuscript locks send no request (${during.length}${during.length ? ': ' + during.map((x) => x.method + ' ' + new URL(x.url).pathname).slice(0, 4).join(', ') : ''})`);
    }
    const q2 = lcApi(r2, g2.marks.pr), q1 = lcApi(r1, g1.marks.pr);
    check(JSON.stringify(q2) === JSON.stringify(q1) && q2.filter((x) => /\/download$/.test(x)).length === 2, `lockcopy parity pdf: the print-ready path's requests are 1.0's (method and path): ${JSON.stringify(q2)}${JSON.stringify(q2) === JSON.stringify(q1) ? '' : ' — 1.0: ' + JSON.stringify(q1)}`);
    for (const [g, r, who] of [[g2, r2, '2.0'], [g1, r1, '1.0']]) {
      const lockReq = r.slice(g.marks.pdf, g.marks.pdfEnd).filter((x) => new URL(x.url).origin === origin).map((x) => x.method + ' ' + w7aId(new URL(x.url).pathname));
      check(JSON.stringify(lockReq) === JSON.stringify(['GET /api/exports/<id>/download']), `lockcopy ${who}: "Download locked copy" sends one request, GET /api/exports/<id>/download (${JSON.stringify(lockReq)})`);
    }
    // no leak
    const l2 = await lcLeaks(r2, LC_PW), l1 = await lcLeaks(r1, LC_PW);
    check(l2.length === 0 && l1.length === 0, `lockcopy no leak: the password, its UTF-8 in base64 and hex (and URL-encoded, UTF-16LE) are in no URL, header or body of ${r2.length} (2.0) + ${r1.length} (1.0) requests from page load through the three locked downloads${l2.length + l1.length ? ' — ' + [...l2, ...l1].slice(0, 4).join('; ') : ''}`);
    const pwForms = [LC_PW, Buffer.from(LC_PW).toString('base64'), Buffer.from(LC_PW).toString('hex')];
    check(![g2.store, g1.store].some((s) => pwForms.some((x) => s.includes(x))), 'lockcopy no leak: nor in localStorage or sessionStorage (both apps)');
    check(!consoleLines.some((s) => pwForms.some((x) => s.includes(x))), `lockcopy no leak: nor in a console line (${consoleLines.length} lines)`);
    // the oracles
    note('lockcopy oracles: ' + (lcOracleVersion() || 'msoffcrypto-tool NOT FOUND') + '; pdf.js 6.4.299 (client/assets/vendor/pdfjs-6.4.299) in ' + browser.version());
    for (const [g, who] of [[g2, '2.0'], [g1, '1.0']]) {
      for (const k of ['docx', 'ms']) {
        const locked = g.files[k + 'Locked'].bytes, plain = g.files[k].bytes;
        const cfb = locked.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
        const ok = lcDocxDecrypt(locked, LC_PW), wrong = lcDocxDecrypt(locked, LC_PW + 'x');
        check(cfb && ok.status === 'ok' && wrong.status === 'refused', `lockcopy ${who} ${k}: the locked file is a compound file that msoffcrypto-tool opens with the password and refuses with a wrong one (${ok.status}${ok.detail ? ' ' + ok.detail : ''} / ${wrong.status})`);
        if (ok.status === 'ok') check(lcSameZip(ok.bytes, plain), `lockcopy ${who} ${k}: decrypted, it is this side's unlocked file byte for byte, entry dates masked (${ok.bytes.length} / ${plain.length} bytes; unmasked ${ok.bytes.equals(plain) ? 'equal too' : 'differ only where masked'})`);
        if (who === '2.0') writeFileSync(path.join(OUT, `lc-sample-${g.files[k + 'Locked'].name}`), locked);
      }
    }
    for (const k of ['docx', 'ms']) check(lcSameZip(g2.files[k].bytes, g1.files[k].bytes), `lockcopy parity ${k}: the unlocked files are equal across the apps, byte for byte, entry dates masked (${g2.files[k].bytes.length} / ${g1.files[k].bytes.length} bytes)`);
    const fx = readFileSync(LC_FIXTURE);
    check(g2.files.pdf.bytes.equals(fx) && g1.files.pdf.bytes.equals(fx), `lockcopy parity pdf: the unlocked print-ready PDF is the stored file in both apps, byte for byte (sha256 ${lcSha(fx).slice(0, 16)}…, ${fx.length} bytes)`);
    writeFileSync(path.join(OUT, `lc-sample-${g2.files.pdfLocked.name}`), g2.files.pdfLocked.bytes);
    // pdf.js in Chromium
    const plainR = await one.evaluate(LC_PDFJS, [fx.toString('base64'), '', 'lcCanvasPlain']);
    check(plainR.none === 'opened' && plainR.pages > 0, `lockcopy pdf.js: the unlocked fixture opens (${plainR.pages} pages)`);
    for (const [g, who] of [[g2, '2.0'], [g1, '1.0']]) {
      const b = g.files.pdfLocked.bytes;
      const head = b.toString('latin1');
      check(/\/Filter\s*\/Standard/.test(head) && /\/V\s+5/.test(head) && /\/R\s+6/.test(head) && /\/AESV3/.test(head) && !/\/RC4/.test(head), `lockcopy ${who} pdf: the locked copy declares the standard handler, /V 5 /R 6, AESV3 (${b.length} bytes)`);
      const r = await one.evaluate(LC_PDFJS, [b.toString('base64'), LC_PW, 'lcCanvas']);
      check(r.none === 'PasswordException 1' && r.wrong === 'PasswordException 2', `lockcopy ${who} pdf.js: refused without the password (${r.none}) and with a wrong one (${r.wrong})`);
      check(r.right === 'opened' && r.pages === plainR.pages && JSON.stringify(r.texts) === JSON.stringify(plainR.texts), `lockcopy ${who} pdf.js: with the password it opens to the unlocked file's pages: ${r.pages} pages (unlocked ${plainR.pages}), every page's text the same (${r.texts ? r.texts.filter((x, i) => x === plainR.texts[i]).length : 0} of ${plainR.texts.length})`);
      if (r.png) {
        const shot = await one.locator('#lcCanvas').screenshot();
        writeFileSync(path.join(OUT, `lc-pdfjs-page1-${who}.png`), shot);
        const d = await pixelDiff(diffPage, Buffer.from(r.png, 'base64'), Buffer.from(plainR.png, 'base64'));
        check(d.ratio === 0 && r.size.join() === plainR.size.join(), `lockcopy ${who} pdf.js: page 1 renders exactly as the unlocked file's (${(d.ratio * 100).toFixed(3)} % of pixels differ, ${r.size.join('×')}); screenshot lc-pdfjs-page1-${who}.png`);
      }
    }
    await one.evaluate(() => { for (const id of ['lcCanvas', 'lcCanvasPlain']) document.getElementById(id)?.remove(); });
    // 2.0's dialog stack
    const s = g2.stack;
    check(!!s && s.seen.every((x) => x.inside) && s.seen[0].id === 'lockPdfPw', `lockcopy 2.0 dialog stack: focus starts on the password and Tab / Shift+Tab stay inside the PDF dialog (${s ? s.seen.map((x) => x.id).join(' → ') : 'not run'})`);
    check(!!s && !s.after.lock && s.after.exp && s.after.pw === '' && s.after.focus === 'link', `lockcopy 2.0 dialog stack: Escape closes only the PDF dialog, empties it, and focus returns to the link (${JSON.stringify(s && s.after)})`);
    for (const [who, g] of [['2.0', g2], ['1.0', g1]]) {
      check(g.emptyReqs === 0 && g.empty.length === 2 && g.empty.every((x) => x.err === 'Type a password for the locked copy.' && x.open && x.pw.join('') === ''), `lockcopy ${who} pdf: a password SASLprep deletes (soft hyphen; joiner + BOM) is refused in the dialog's own words, nothing is requested, the dialog stays open and empty (${JSON.stringify(g.empty)}; ${g.emptyReqs} requests)`);
    }
    await harvestCsp(two);
    await harvestCsp(one);
  } finally {
    await diffCtx.close();
    await c1.close();
    await c2.close();
  }
}

/* Day 22 (7a's server states): one account, both apps on its desk (as wave7aDay22). */
async function lockcopyDay22(srv) {
  const origin = srv.origin;
  const db = srv.shelf.db;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  for (const st of ['trial', 'paid', 'day22']) {
    const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
    const reqs = lcRecord(ctx);
    try {
      const email = w7aEmail('lc' + st);
      await w7aSignUp(ctx, origin, email);
      if (st === 'day22') await db.query("update users set trial_ends_at = now() - interval '1 day' where email = $1", [email]);
      if (st === 'paid') {
        const uid = (await db.query('select id from users where email = $1', [email])).rows[0].id;
        await db.query("update users set trial_ends_at = now() - interval '1 day', stripe_customer_id = $2 where id = $1", [uid, 'cus_' + uid.slice(0, 8)]);
        await db.query("insert into billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, status_since, price_ids, livemode) values ($1, $2, $3, 'active', now(), $4, false)", ['sub_' + uid.slice(0, 8), uid, 'cus_' + uid.slice(0, 8), ['price_fixture']]);
      }
      await lcFakePdfxDone(ctx, origin, reqs);
      const page = await openNext(ctx, origin);
      await openBackup(page, f.file);
      await w7aWait(page, () => window.beukCloud?.cloud?.available && !!window.beukCloud.cloud.user, null, 30_000);
      const one = await openOne(ctx, origin);
      await w7aWait(one, () => typeof cloud !== 'undefined' && cloud.available && !!cloud.user, null, 30_000);
      const start = (await exportBackup(page)).json.book;
      await one.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), start);
      const shown = (p) => p.evaluate(() => ({ docx: !document.getElementById('lockDocx').hidden, ms: !document.getElementById('lockMs').hidden, link: [...document.querySelectorAll('#printReadyNote [data-pr-locked]')].filter((a) => !a.hidden).length, access: document.documentElement.getAttribute('data-plan-access') }));
      // straight after boot and sign-in, before any #btnAccount click: GET /api/auth/me's access already says the state
      const before = { two: await shown(page), one: await shown(one) };
      for (const app of ['two', 'one']) {
        const b = before[app];
        const hide = st === 'day22';
        check(b.docx === !hide && b.ms === !hide, `lockcopy day 22 (${st}) ${app === 'two' ? '2.0' : '1.0'}: straight after boot, before the account box, the Word and manuscript lock controls are ${hide ? 'hidden' : 'shown'} (Word ${b.docx}, manuscript ${b.ms}; plan access "${b.access}")`);
      }
      // the plan, as each app learns it (the account box: 1.0's portalRefresh)
      await page.bringToFront();
      await page.click('#btnAccount');
      await page.waitForSelector('#modalShelf.open');
      await page.waitForFunction(() => !!document.documentElement.getAttribute('data-plan-access'), null, { timeout: 30_000 });
      await page.click('#btnCloseShelf');
      await one.bringToFront();
      await one.evaluate(() => { $('btnAccount').click(); }); // eslint-disable-line no-undef
      await one.waitForFunction(() => !!document.documentElement.getAttribute('data-plan-access'), null, { timeout: 30_000 });
      await one.evaluate(() => $('modalShelf').classList.remove('open')); // eslint-disable-line no-undef
      const res = {};
      for (const [p, app] of [[page, 'two'], [one, 'one']]) {
        await p.bringToFront();
        await lcOpenExport(p, app);
        const plain = await lcDownload(p, () => p.click('#btnDownloadDocx'));
        await p.click('#btnMsOpen');
        await p.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
        const plainMs = await lcDownload(p, () => p.click('#btnMsDownload'));
        await p.click('#btnMsClose');
        await lcOpenExport(p, app);
        if (app === 'two') await p.click('#btnPrintReadyPdf');
        else await p.evaluate(() => document.getElementById('btnPrintReadyPdf').click());
        await p.waitForTimeout(300);
        await p.waitForFunction(() => !document.getElementById('btnPrintReadyPdf').disabled && !document.getElementById('printReadyNote').hidden, null, { timeout: 120_000 });
        res[app] = { ...(await shown(p)), files: [plain.name, plain.bytes.subarray(0, 2).toString('latin1'), plainMs.name, plainMs.bytes.subarray(0, 2).toString('latin1')], note: await p.evaluate(() => document.getElementById('printReadyNote').textContent.slice(0, 90)) };
      }
      const want = st === 'day22' ? { docx: false, ms: false, link: 0 } : { docx: true, ms: true, link: 1 };
      for (const app of ['two', 'one']) {
        const r = res[app];
        check(r.docx === want.docx && r.ms === want.ms && r.link === want.link, `lockcopy day 22 (${st}) ${app === 'two' ? '2.0' : '1.0'}: the lock controls are ${st === 'day22' ? 'hidden' : 'shown'} (Word ${r.docx}, manuscript ${r.ms}, locked-PDF links shown ${r.link}; plan access "${r.access}"; panel: "${r.note}")`);
        check(r.files[1] === 'PK' && r.files[3] === 'PK' && !/locked/.test(r.files[0] + r.files[2]), `lockcopy day 22 (${st}) ${app === 'two' ? '2.0' : '1.0'}: the unlocked Word and manuscript downloads work (${r.files[0]}, ${r.files[2]})`);
      }
      check(JSON.stringify({ ...res.two, note: 0 }) === JSON.stringify({ ...res.one, note: 0 }) && res.two.note === res.one.note, `lockcopy day 22 (${st}): 2.0 shows what 1.0 shows${JSON.stringify(res.two) === JSON.stringify(res.one) ? '' : ' — 2.0: ' + JSON.stringify(res.two) + ' — 1.0: ' + JSON.stringify(res.one)}`);
      await harvestCsp(page);
      await harvestCsp(one);
    } finally {
      await ctx.close();
    }
  }
}

/* Day 22, signed in inside the tab (fix round 2): an account past its trial signs in through each app's own sign-in
   dialog, no reload, no account box. The Word and manuscript lock controls are hidden at once (1.0's cloudAuthSubmit
   re-reads GET /api/auth/me and mirrors its access). That request carries no password. */
async function lockcopySignIn(srv) {
  const origin = srv.origin;
  const db = srv.shelf.db;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const email = w7aEmail('lcsi');
  const made = await newContext({ serviceWorkers: 'block' });
  try {
    await w7aSignUp(made, origin, email);
  } finally {
    await made.close();
  }
  await db.query("update users set trial_ends_at = now() - interval '1 day' where email = $1", [email]);
  for (const app of ['two', 'one']) {
    const who = app === 'two' ? '2.0' : '1.0';
    const ctx = await newContext({ serviceWorkers: 'block' });
    const reqs = lcRecord(ctx);
    try {
      let p;
      if (app === 'two') {
        p = await openNext(ctx, origin);
        await openBackup(p, f.file);
        await w7aWait(p, () => window.beukCloud?.cloud?.available, null, 30_000);
      } else {
        p = await openOne(ctx, origin);
        await w7aWait(p, () => typeof cloud !== 'undefined' && cloud.available, null, 30_000);
      }
      const shown = () => p.evaluate(() => ({ docx: !document.getElementById('lockDocx').hidden, ms: !document.getElementById('lockMs').hidden, access: document.documentElement.getAttribute('data-plan-access') }));
      const before = await shown();
      if (app === 'two') await p.click('#btnAccount');
      else await p.evaluate(() => openAuth()); // eslint-disable-line no-undef
      await p.waitForSelector('#modalAuth.open');
      await p.fill('#authEmail', email);
      await p.fill('#authPassword', W7A_PW);
      const mark = reqs.length;
      await p.click('#btnAuthSubmit');
      if (app === 'two') await w7aWait(p, () => !!window.beukCloud?.cloud?.user, null, 30_000);
      else await w7aWait(p, () => typeof cloud !== 'undefined' && !!cloud.user, null, 30_000);
      await p.waitForFunction(() => !!document.documentElement.getAttribute('data-plan-access'), null, { timeout: 15_000 }).catch(() => undefined);
      await p.waitForTimeout(500);
      const after = await shown();
      const shelfOpened = await p.evaluate(() => !!document.getElementById('modalShelf')?.classList.contains('open'));
      check(before.docx && before.ms && !after.docx && !after.ms && !shelfOpened, `lockcopy day 22, signed in inside the tab (${who}): the Word and manuscript lock controls are hidden at once, no reload, no account box (before ${JSON.stringify(before)}, after ${JSON.stringify(after)}, shelf opened ${shelfOpened})`);
      const since = reqs.slice(mark).filter((r) => new URL(r.url).origin === origin);
      const me = since.filter((r) => new URL(r.url).pathname === '/api/auth/me');
      const leaks = await lcLeaks(since.filter((r) => !/\/api\/auth\/(login|register)$/.test(new URL(r.url).pathname)), W7A_PW);
      check(me.length >= 1 && me.every((r) => r.method === 'GET' && !r.body) && leaks.length === 0, `lockcopy day 22, signed in inside the tab (${who}): GET /api/auth/me is re-read after the sign-in (${me.length}), with no body, and no request after the sign-in POST carries the account password (${since.length} requests${leaks.length ? ' — ' + leaks.slice(0, 3).join('; ') : ''})`);
      await harvestCsp(p);
    } finally {
      await ctx.close();
    }
  }
}

/* Lock off against 920efea: the same book's Word file and manuscript, lock off, from this build and from 920efea's (a
   second static server on LOCKCOPY_BASE), in each app. The print-ready PDF's unlocked link is the server's stored file
   (no server change on this branch; the parity part shows it byte-equal to the stored fixture). */
async function lockcopyLockOff(origin) {
  const baseRepo = process.env.LOCKCOPY_BASE;
  if (!baseRepo) {
    note('lockcopy lock off vs 920efea: NOT RUN (LOCKCOPY_BASE unset) — not a pass');
    return;
  }
  const base = await startServer({ repo: path.resolve(baseRepo) });
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const head = spawnSync('git', ['-C', path.resolve(baseRepo), 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  note(`lockcopy lock off: 920efea's build (checkout ${head} at ${baseRepo}) on ${base.origin}, this build on ${origin}`);
  try {
    const got = {};
    for (const [o, tag] of [[origin, 'head'], [base.origin, 'base']]) {
      for (const app of ['two', 'one']) {
        const ctx = await newContext({ serviceWorkers: 'block', acceptDownloads: true });
        try {
          let p;
          if (app === 'two') p = await w5aOpen(ctx, o, f.file);
          else {
            const two = await w5aOpen(ctx, o, f.file);
            const start = (await exportBackup(two)).json.book;
            await two.close();
            p = await openOne(ctx, o);
            await p.evaluate((b) => applyBookDoc(JSON.parse(JSON.stringify(b))), expected(f.book, start)); // eslint-disable-line no-undef
          }
          await lcOpenExport(p, app);
          const docx = await lcDownload(p, () => p.click('#btnDownloadDocx'));
          await p.click('#btnMsOpen');
          await p.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
          const ms = await lcDownload(p, () => p.click('#btnMsDownload'));
          got[tag + ' ' + app] = { docx, ms };
          await harvestCsp(p);
        } finally {
          await ctx.close();
        }
      }
    }
    for (const app of ['two', 'one'])
      for (const k of ['docx', 'ms']) {
        const a = got['head ' + app][k], b = got['base ' + app][k];
        check(a.name === b.name && lcSameZip(a.bytes, b.bytes), `lockcopy lock off ${app === 'two' ? '2.0' : '1.0'} ${k}: this build's download is 920efea's, byte for byte, entry dates masked (${a.name} ${a.bytes.length} bytes; 920efea ${b.name} ${b.bytes.length})`);
      }
  } finally {
    await base.stop().catch(() => undefined);
  }
}

/* Latency (fix round 2's ruling): a lock runs only from a click inside a dialog over the editor, so the writer cannot be
   typing during one. The measure: in the Dumas book, 5 rounds of locks through the studio's own controls (the export
   dialog's Word file and the manuscript, lock on, each downloaded) and the PDF lock of the real fixture, 50 ms apart,
   all finished; the dialogs closed; then the Dumas typing run. The longest main-thread block of one Word-file lock
   (Long Tasks) is a note, not a check. */
async function lockcopyLatency(origin) {
  const fx = readFileSync(LC_FIXTURE).toString('base64');
  const info = {};
  const r = await latency(origin, {
    quick: true,
    afterOpen: async (page) => {
      await page.waitForFunction(() => !!window.beukExport && document.getElementById('btnExport')?.getAttribute('aria-disabled') === null, null, { timeout: 60_000 });
      await page.evaluate(() => {
        window.__lcLong = [];
        try {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcLong.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: false });
        } catch { /* no Long Tasks */ }
      });
      const docxBlocks = [], pdfMs = [], rounds = 5;
      for (let i = 0; i < rounds; i++) {
        await w5aOpenModal(page);
        if (!(await page.isChecked('#lockDocxOn'))) await page.check('#lockDocxOn');
        await page.fill('#lockDocxPw', LC_PW);
        await page.fill('#lockDocxPw2', LC_PW);
        const t0 = await page.evaluate(() => performance.now());
        const d = await lcDownload(page, () => page.click('#btnDownloadDocx'));
        await page.waitForFunction(() => !document.getElementById('btnDownloadDocx').disabled);
        await page.waitForTimeout(50);
        const t1 = await page.evaluate(() => performance.now());
        docxBlocks.push(await page.evaluate(([x, y]) => Math.max(0, ...window.__lcLong.filter((e) => e.at >= x && e.at <= y).map((e) => e.ms)), [t0, t1]));
        if (!/-locked\.docx$/.test(d.name)) throw new Error('not a locked download: ' + d.name);
        await page.click('#btnMsOpen');
        await page.waitForFunction(() => document.getElementById('modalManuscript').classList.contains('open'));
        if (!(await page.isChecked('#lockMsOn'))) await page.check('#lockMsOn');
        await page.fill('#lockMsPw', LC_PW);
        await page.fill('#lockMsPw2', LC_PW);
        const m = await lcDownload(page, () => page.click('#btnMsDownload'));
        await page.waitForFunction(() => !document.getElementById('btnMsDownload').disabled);
        if (!/-locked\.docx$/.test(m.name)) throw new Error('not a locked download: ' + m.name);
        await page.click('#btnMsClose');
        // the PDF lock (the panel's needs the shelf server; this static run calls 1.0's encryptor, as its click would)
        pdfMs.push(await page.evaluate(async (b64) => {
          const pdf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const t = performance.now();
          await window.beukExport.run((api) => api.lockPdfBytes(pdf, 'p'));
          return performance.now() - t;
        }, fx));
        await page.waitForTimeout(50);
      }
      // every dialog closed: the editor next
      await page.evaluate(() => { for (const id of ['modalExport', 'modalManuscript', 'modalLockPdf']) document.getElementById(id)?.classList.remove('open'); });
      await page.waitForTimeout(300);
      info.rounds = rounds;
      info.docxBlocks = docxBlocks;
      info.pdfMs = pdfMs;
      info.open = await page.evaluate(() => [...document.querySelectorAll('.modal-back.open')].map((x) => x.id));
    },
  });
  const maxBlock = Math.max(...(info.docxBlocks || [0]));
  note(`lockcopy latency: ${info.rounds} rounds of locks before the typing (each: the Word file and the manuscript locked through their dialogs, and the PDF fixture locked in ${(info.pdfMs || []).map((x) => x.toFixed(0)).join('/')} ms), then the dialogs closed (${JSON.stringify(info.open)} open): p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms over ${r.n} keystrokes`);
  note(`lockcopy latency: a DOCX lock stalls the page for about ${maxBlock.toFixed(0)} ms (the longest Long Task during each Word-file lock: ${(info.docxBlocks || []).map((x) => x.toFixed(0)).join(', ')} ms) — a note, not a check`);
  check(info.rounds === 5 && Array.isArray(info.open) && info.open.length === 0, `lockcopy latency: ${info.rounds} rounds of locks ran to the end and every dialog was closed before the typing`);
  check(r.p95 < LATENCY_P95_TARGET_MS, `lockcopy latency: Dumas p95 under ${LATENCY_P95_TARGET_MS} ms after the locks (${r.p95.toFixed(1)} ms)`);
}

/* Screenshots: the Word file's fieldset (ticked: its fields shown) and the print-ready PDF's dialog, beside 1.0's, in
   Paper, Candlelight and Arabic (gated as wave 5c's). */
async function lockcopyScreens(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const diffCtx = await newContext();
  const diffPage = await diffCtx.newPage();
  try {
    for (const run of [{ theme: 'paper' }, { theme: 'candlelight' }, { theme: 'paper', lang: 'ar' }]) {
      const tag = run.theme + (run.lang ? '-' + run.lang : '');
      const mk = async () => {
        const c = await newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
        await c.addInitScript(([th, l]) => {
          try {
            localStorage.setItem('beuk.theme.v1', th);
            if (l) localStorage.setItem('beuk.uiLang.v1', l);
          } catch {
            /* no storage */
          }
        }, [run.theme, run.lang]);
        return c;
      };
      const c1 = await mk(), c2 = await mk();
      const r1 = lcRecord(c1), r2 = lcRecord(c2);
      try {
        await lcFakePdfxDone(c1, origin, r1);
        await lcFakePdfxDone(c2, origin, r2);
        const two = await w7bNextLinked(c2, origin, f.file, 'lcs2');
        const book = (await exportBackup(two)).json.book;
        await w7aSignUp(c1, origin, w7aEmail('lcs1'));
        const one = await w7bOneLinked(c1, origin, book);
        const shots = {};
        for (const [p, app] of [[two, 'two'], [one, 'one']]) {
          await p.bringToFront();
          await lcOpenExport(p, app);
          await p.check('#lockDocxOn');
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800);
          await p.locator('#lockDocx').scrollIntoViewIfNeeded();
          shots[app + ' fieldset'] = await p.locator('#lockDocx').screenshot();
          await lcPrintReadyDone(p, app);
          await p.click('#printReadyNote [data-pr-locked]');
          await p.waitForSelector('#modalLockPdf.open');
          await p.evaluate(() => document.fonts.ready);
          await p.waitForTimeout(3800);
          shots[app + ' dialog'] = await p.locator('#modalLockPdf .modal').screenshot();
          await p.click('#btnLockPdfClose');
        }
        for (const k of ['fieldset', 'dialog']) {
          const a = shots['one ' + k], b = shots['two ' + k];
          writeFileSync(path.join(OUT, `lc-${k}-${tag}-one.png`), a);
          writeFileSync(path.join(OUT, `lc-${k}-${tag}-two.png`), b);
          const d = await pixelDiff(diffPage, a, b);
          check(d.ratio <= PIXEL_TOLERANCE, `lockcopy screenshots ${tag}: the ${k === 'fieldset' ? 'Word fieldset (#lockDocx)' : 'PDF dialog (#modalLockPdf)'} differs in ${(d.ratio * 100).toFixed(2)}% of pixels [${d.size}] (max ${PIXEL_TOLERANCE * 100}%)`);
        }
        await harvestCsp(two);
        await harvestCsp(one);
      } finally {
        await c1.close();
        await c2.close();
      }
    }
  } finally {
    await diffCtx.close();
  }
}

async function lockcopyChecks(staticOrigin) {
  const stripe = await w7aFakeStripe();
  const srv = await startServer({ repo: REPO, api: true, apiConfig: { stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base } });
  note(`lockcopy: the real server on ${srv.origin} (PGlite), billing in test mode against a fake Stripe on ${stripe.base}; the print-ready pdfx job is NOT run (no renderer, no Ghostscript here): its poll is answered "done" and its file is the committed real output, seeded`);
  const only = (process.env.LOCKCOPY_PARTS || 'parity,day22,signin,lockoff,latency,screens').split(',');
  try {
    if (only.includes('parity')) await lockcopyParity(srv);
    if (only.includes('day22')) await lockcopyDay22(srv);
    if (only.includes('signin')) await lockcopySignIn(srv);
    if (only.includes('lockoff')) await lockcopyLockOff(staticOrigin);
    if (only.includes('latency')) await lockcopyLatency(staticOrigin);
    if (only.includes('screens')) await lockcopyScreens(srv);
  } finally {
    await srv.stop().catch(() => undefined);
    await stripe.close();
  }
}


/* ---- locked backups and the authorship record (plan 2026-11-09, task 4): authorshipChecks (E2E_ONLY=authorship) ----
   The real server (serve.mjs { api: true }: src/app.ts on PGlite, billing in test mode against a fake Stripe on
   127.0.0.1), 2.0 (/next) signed in, its book brought to the shelf. Every expected date and fingerprint comes from the
   server's answers or the downloaded file, never the wall clock; the pages run in UTC and the dates are formatted here
   in the studio's format ("en", short month), in UTC.
   - A locked backup (password AU_PW) from the save popover: the file is the envelope (its keys exactly, nothing about
     the book outside the ciphertext, the title absent from the bytes); decrypted here (node:crypto, PBKDF2-SHA-256
     600 000 → AES-256-GCM) it is a plain backup whose fingerprint is its book's. No request carries the password.
   - That file opened on an empty desk: the wrong password says backup.pwWrong (the field emptied, the desk still
     empty); the right one opens it, and the desk's title and sections are the file's.
   - A plain backup, signed in: recorded is the server's stamp; opened again, the toast says "Untouched since" (the
     file's savedAt) and "On Beuk's record since" (GET /api/authorship/check's oldest createdAt).
   - The same file with one chapter word changed (authorship kept): the "changed" confirm, before any other; No leaves
     the desk exactly as it was.
   - A named reader (Priya) added through the existing reading-copy UI; the Authorship record lists every stamp the
     server holds for the book (kind, date, 12-hex fingerprint; the plain backup's among them) and Priya under
     "Shared with" (her added date from GET /api/shares/:id/readers).
   - Day 22 (an account past its trial): the save popover's lock box is hidden, and a plain export still downloads, its
     authorship block recorded null (the stamp is refused). */
const AU_PW = 'tide and lantern';
const AU_EN = {
  pwWrong: "That password doesn't open this backup",
  changedTitle: 'This backup was changed',
  changedBody: 'This backup was changed after it was saved. Open it anyway?',
  replaceTitle: 'Open this backup?',
};
const auDate = (iso) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
const auSha = (book) => createHash('sha256').update(Buffer.from(JSON.stringify(book), 'utf8')).digest('hex');
/** The envelope opened here, independently of the studio (node:crypto). */
async function auUnlock(env, pw) {
  const { pbkdf2Sync, createDecipheriv } = await import('node:crypto');
  const salt = Buffer.from(env.kdf.salt, 'base64'), iv = Buffer.from(env.cipher.iv, 'base64'), data = Buffer.from(env.data, 'base64');
  const key = pbkdf2Sync(Buffer.from(pw.normalize('NFC'), 'utf8'), salt, env.kdf.iterations, 32, 'sha256');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(data.subarray(data.length - 16));
  return { salt, iv, text: Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8') };
}
async function auPop(page) {
  await page.click('#localPillBtn');
  await page.waitForSelector('#localPop:not([hidden])', { timeout: 10_000 });
}
/** The first toast whose words match `re`. */
async function auToast(page, re, timeout = 30_000) {
  const h = await page.waitForFunction((src) => [...document.querySelectorAll('#toasts .toast span')].map((x) => x.textContent).find((s) => new RegExp(src).test(s)) || null, re.source, { timeout });
  return h.jsonValue();
}
/** The desk's book, as a plain export downloads it (less History). */
const auDesk = async (page) => noHistory((await exportBackup(page)).json.book);
async function authorshipMain(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
  const reqs = lcRecord(ctx);
  const ctx2 = await newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
  const reqs2 = lcRecord(ctx2);
  try {
    const page = await w7bNextLinked(ctx, origin, f.file, 'au');
    const api = (p) => ctx.request.get(origin + p).then((r) => r.json());
    const title = f.book.meta.title;

    // 1. the locked backup
    await auPop(page);
    await page.check('#lockBackupOn');
    await page.waitForSelector('#lockBackupFields:not([hidden])');
    await page.fill('#lockBackupPw', AU_PW);
    await page.fill('#lockBackupPw2', AU_PW);
    const locked = await lcDownload(page, () => page.click('#btnLocalBackup'), 60_000);
    const lockedPath = path.join(OUT, 'au-locked.beuk-backup.json');
    writeFileSync(lockedPath, locked.bytes);
    const raw = locked.bytes.toString('utf8');
    const env = JSON.parse(raw);
    const keys = JSON.stringify(Object.keys(env)) + JSON.stringify(Object.keys(env.kdf || {})) + JSON.stringify(Object.keys(env.cipher || {}));
    check(env.format === 'beuk-backup-locked' && env.version === 1 && keys === '["format","version","kdf","cipher","data"]["name","hash","iterations","salt"]["name","iv"]' && env.kdf.name === 'PBKDF2' && env.kdf.hash === 'SHA-256' && env.kdf.iterations === 600000 && env.cipher.name === 'AES-GCM',
      `authorship: the locked backup is the envelope, its keys exactly (${keys}; format "${env.format}", ${env.kdf?.iterations} iterations)`);
    check(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.beuk-backup\.json$/.test(locked.name), `authorship: the locked backup keeps the backup's filename (${locked.name})`);
    const outside = [title, 'Lantern', 'Mara', 'ferry', f.book.meta.bookId, f.book.meta.author].filter((s) => s && raw.includes(s));
    check(outside.length === 0, `authorship: nothing about the book is outside the ciphertext — the title "${title}", the author, the bookId and chapter words are not in the file's ${locked.bytes.length} bytes${outside.length ? ' (found: ' + JSON.stringify(outside) + ')' : ''}`);
    let inner = null;
    try {
      const u = await auUnlock(env, AU_PW);
      inner = JSON.parse(u.text);
      check(u.salt.length === 16 && u.iv.length === 12, `authorship: the salt is 16 bytes and the IV 12 (${u.salt.length}, ${u.iv.length})`);
    } catch (e) {
      check(false, `authorship: the locked backup decrypts here with the password (${e.message})`);
    }
    if (inner) {
      check(inner.format === 'beuk-backup' && inner.version === 1 && inner.book?.meta?.title === title && inner.authorship?.sha256 === auSha(inner.book) && typeof inner.authorship?.recorded === 'string',
        `authorship: decrypted here, it is the plain backup ("${inner.book?.meta?.title}"), its authorship.sha256 the SHA-256 of its book (${inner.authorship?.sha256?.slice(0, 12)}…), recorded ${inner.authorship?.recorded}`);
    }
    const leaks1 = await lcLeaks(reqs, AU_PW);
    check(leaks1.length === 0, `authorship: no request carries the backup password (${reqs.length} requests${leaks1.length ? ' — ' + leaks1.slice(0, 3).join('; ') : ''})`);

    // 2. opened on an empty desk: the wrong password, then the right one
    const p2 = await openNext(ctx2, origin);
    await p2.waitForSelector('#btnOpenBackup', { timeout: 15_000 });
    await p2.setInputFiles('#btnOpenBackup + input', lockedPath);
    await p2.waitForSelector('#modalBackupPw.open', { timeout: 30_000 });
    await p2.fill('#backupPw', 'tide and lanterns');
    await p2.click('#btnBackupPwOpen');
    await p2.waitForSelector('#backupPwErr:not([hidden])', { timeout: 60_000 });
    const wrong = { err: await p2.$eval('#backupPwErr', (x) => x.textContent), field: await p2.$eval('#backupPw', (x) => x.value), open: await p2.$eval('#modalBackupPw', (x) => x.classList.contains('open')), empty: !!(await p2.$('#btnOpenBackup')) };
    check(wrong.err === AU_EN.pwWrong && wrong.field === '' && wrong.open && wrong.empty, `authorship: a wrong password says "${wrong.err}", empties the field (${JSON.stringify(wrong.field)}), keeps the dialog open (${wrong.open}) and the desk empty (${wrong.empty})`);
    await p2.fill('#backupPw', AU_PW);
    await p2.click('#btnBackupPwOpen');
    await p2.waitForSelector('#btnOpenBackup', { state: 'detached', timeout: 60_000 });
    const d2 = await auDesk(p2);
    check(d2.meta?.title === title && !!inner && JSON.stringify(d2.sections) === JSON.stringify(inner.book.sections) && !(await p2.$('#modalBackupPw')),
      `authorship: the right password opens it — the desk's title is "${d2.meta?.title}" and its ${d2.sections?.length} sections are the file's; the dialog is gone`);
    const leaks2 = await lcLeaks(reqs2, AU_PW);
    check(leaks2.length === 0, `authorship: opening it sends no request carrying the password (${reqs2.length} requests${leaks2.length ? ' — ' + leaks2.slice(0, 3).join('; ') : ''})`);
    await harvestCsp(p2);

    // 3. a plain backup, signed in, opened again
    // the lock box keeps its tick when the popover closes (only the passwords are emptied, as BEUK:lockcopy's): untick it
    await page.bringToFront();
    await auPop(page);
    const kept = await page.$eval('#lockBackupOn', (x) => x.checked);
    const emptied = await page.$$eval('#lockBackupPw, #lockBackupPw2', (xs) => xs.every((x) => x.value === ''));
    check(emptied, 'authorship: after the locked export the popover kept no password (both fields empty; the tick kept: ' + kept + ')');
    await page.uncheck('#lockBackupOn');
    await page.click('#localPillBtn');
    await page.waitForSelector('#localPop', { state: 'hidden', timeout: 10_000 });
    const plain = await exportBackup(page);
    const plainPath = path.join(OUT, 'au-plain.beuk-backup.json');
    writeFileSync(plainPath, plain.text);
    const a = plain.json.authorship || {};
    const sha = auSha(plain.json.book);
    check(Object.keys(plain.json).join() === 'format,version,exportedAt,book,authorship' && a.sha256 === sha && a.savedAt === plain.json.exportedAt && a.author === String(plain.json.book.meta.author || '') && typeof a.recorded === 'string',
      `authorship: the plain backup carries its authorship block — sha256 is its book's (${sha.slice(0, 12)}…), savedAt ${a.savedAt}, author "${a.author}", recorded ${a.recorded}`);
    const rec = await api('/api/authorship/check?sha256=' + sha);
    const first = rec.recorded?.[0]?.createdAt;
    check(Array.isArray(rec.recorded) && rec.recorded.some((x) => x.createdAt === a.recorded && x.kind === 'backup'), `authorship: the server holds the stamp the file says (check: ${JSON.stringify(rec.recorded)})`);
    await page.setInputFiles('#localBackupInput', plainPath);
    await page.waitForSelector('#modalConfirm', { timeout: 30_000 });
    const t3 = await page.$eval('#confirmTitle', (x) => x.textContent);
    await page.click('#modalConfirm #btnConfirmYes');
    const wantToast = `Backup opened — “${title}” Untouched since ${auDate(a.savedAt)}. On Beuk's record since ${first ? auDate(first) : '?'}.`;
    // (the fixture's own "Backup opened" toast, from the first open, may still stand: wait for this open's words)
    const got3 = await auToast(page, /Untouched since/).catch(async () => 'none of ' + JSON.stringify(await page.$$eval('#toasts .toast span', (xs) => xs.map((x) => x.textContent))));
    check(t3 === AU_EN.replaceTitle && got3 === wantToast, `authorship: opened again (after "${t3}"), the toast reads "${got3}"${got3 === wantToast ? '' : ' — want "' + wantToast + '"'}`);

    // 4. one chapter word changed by hand, the authorship block kept
    const before = await auDesk(page);
    // (the desk's fingerprint after this open is a new one: the export's book is not the file's byte for byte — said, not gated)
    note(`authorship: after opening the plain backup, the desk's book differs from the file's in: ${JSON.stringify(w7aDiffKeys(plain.json.book, before))} (History left out of the desk side); its fingerprint ${auSha((await exportBackup(page)).json.book).slice(0, 12)}… vs the file's ${sha.slice(0, 12)}…`);
    const ed = JSON.parse(plain.text);
    const ch = ed.book.sections.find((s) => s.type === 'chapter' && /\bharbour\b/.test(s.content || ''));
    ch.content = ch.content.replace(/\bharbour\b/, 'harbor');
    const edPath = path.join(OUT, 'au-changed.beuk-backup.json');
    writeFileSync(edPath, JSON.stringify(ed));
    await page.setInputFiles('#localBackupInput', edPath);
    await page.waitForSelector('#modalConfirm', { timeout: 30_000 });
    const c4 = await page.evaluate(() => [document.getElementById('confirmTitle').textContent, document.getElementById('confirmBody').textContent]);
    await page.click('#modalConfirm #btnConfirmNo');
    await page.waitForSelector('#modalConfirm', { state: 'detached', timeout: 10_000 });
    await page.waitForTimeout(1500);
    const again = !!(await page.$('#modalConfirm'));
    check(c4[0] === AU_EN.changedTitle && c4[1] === AU_EN.changedBody && !again, `authorship: a backup changed after it was saved asks first: "${c4[0]}" / "${c4[1]}"; after No, no other dialog follows (${again})`);
    const after = await auDesk(page);
    const sec = after.sections.find((s) => s.id === ch.id);
    check(JSON.stringify(after) === JSON.stringify(before) && /\bharbour\b/.test(sec?.content || '') && !/\bharbor\b/.test(sec?.content || ''), `authorship: No leaves the desk exactly as it was (the book JSON-identical, "${ch.title}" still says "harbour")`);

    // 5. a named reader through the reading-copy UI, then the record
    await w5aOpenModal(page);
    await page.waitForFunction(() => !!document.getElementById('btnBetaCreate') && /No reading links/.test(document.getElementById('betaSec').textContent), null, { timeout: 30_000 });
    await page.click('#btnBetaCreate');
    await page.waitForSelector('#betaNewUrl', { timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll('#betaList .beta-row[data-share-id]').length === 1, null, { timeout: 30_000 });
    const sid = await page.$eval('#betaList .beta-row[data-share-id]', (x) => x.getAttribute('data-share-id'));
    await page.click(`#betaReaders-${sid} > summary`);
    await page.waitForFunction((id) => { const d = document.getElementById('betaReaders-' + id); return d && d.open && !d.querySelector('.shelf-empty'); }, sid, { timeout: 30_000 });
    await page.fill(`#betaReaderName-${sid}`, 'Priya');
    await page.selectOption(`#betaReaderExpiry-${sid}`, '0');
    await page.click(`[data-beta-reader-add="${sid}"]`);
    await page.waitForFunction((i) => document.querySelectorAll('#betaReaders-' + i + ' .beta-row[data-recipient-id]').length === 1, sid, { timeout: 30_000 });
    await page.click('#btnCloseExport');
    const priya = ((await api('/api/shares/' + encodeURIComponent(sid) + '/readers')).readers || []).find((x) => x.name === 'Priya');
    await auPop(page);
    const recBtn = await page.$eval('#btnAuthorshipRecord', (x) => !x.hidden);
    await page.click('#btnAuthorshipRecord');
    await page.waitForSelector('#modalAuthorship.open', { timeout: 15_000 });
    await page.waitForFunction(() => {
      const s = document.getElementById('authStamps'), h = document.getElementById('authShared');
      return !!s && !!h && !!s.querySelector('[data-stamp-id],[data-auth-empty],[role=alert]') && !!h.querySelector('[data-auth-share],[data-auth-empty],[role=alert]');
    }, null, { timeout: 30_000 });
    const shown = await page.evaluate(() => ({
      title: document.getElementById('authTitle').textContent,
      stamps: [...document.querySelectorAll('#authStamps [data-stamp-id]')].map((r) => ({ id: r.getAttribute('data-stamp-id'), kind: r.querySelector('.a-name').textContent, meta: r.querySelector('.a-meta').textContent })),
      readers: [...document.querySelectorAll('#authShared [data-auth-reader]')].map((r) => ({ id: r.getAttribute('data-auth-reader'), name: r.querySelector('b')?.textContent, text: r.textContent })),
      open: [...document.querySelectorAll('#authShared [data-auth-open]')].map((r) => r.textContent),
      empty: [...document.querySelectorAll('#modalAuthorship [data-auth-empty]')].map((r) => r.getAttribute('data-auth-empty')),
    }));
    const held = (await api('/api/authorship/stamps?bookId=' + encodeURIComponent(plain.json.book.meta.bookId))).stamps || [];
    const want = held.map((s) => ({ id: s.id, kind: s.kind === 'docx' ? 'Word file' : 'Backup', meta: auDate(s.createdAt) + ' · ' + s.sha256.slice(0, 12) }));
    check(recBtn && shown.title === `Authorship record — “${title}”` && held.length >= 2 && JSON.stringify(shown.stamps) === JSON.stringify(want) && held.some((s) => s.sha256 === sha && s.kind === 'backup' && s.createdAt === a.recorded),
      `authorship record: "${shown.title}" lists the server's ${held.length} stamps, newest first, each kind · date · 12-hex fingerprint, the plain backup's among them: ${JSON.stringify(shown.stamps.map((s) => s.kind + ' ' + s.meta))}${JSON.stringify(shown.stamps) === JSON.stringify(want) ? '' : ' — want ' + JSON.stringify(want.map((s) => s.kind + ' ' + s.meta))}`);
    const wantReader = priya ? `Priya · Added ${nlStampDate(priya.createdAt)} · Not opened yet` : '?';
    check(!!priya && shown.readers.length === 1 && shown.readers[0].id === priya.id && shown.readers[0].name === 'Priya' && shown.readers[0].text === wantReader && JSON.stringify(shown.open) === JSON.stringify(['Open link: 0 readers']) && !shown.empty.includes('shared'),
      `authorship record: "Shared with" names Priya, added through the reading-copy UI: ${JSON.stringify(shown.readers.map((r) => r.text))} (want "${wantReader}"); the open link counted, not named: ${JSON.stringify(shown.open)}`);
    await page.click('#btnAuthClose');
    await page.waitForSelector('#modalAuthorship.open', { state: 'detached', timeout: 10_000 });
    await harvestCsp(page);
  } finally {
    await ctx2.close();
    await ctx.close();
  }
}
async function authorshipDay22(srv) {
  const origin = srv.origin;
  const f = fixtures.find((x) => x.name === 'real/lantern-coast-book-one');
  const ctx = await newContext({ serviceWorkers: 'block', timezoneId: 'UTC' });
  const reqs = lcRecord(ctx);
  try {
    const email = w7aEmail('au22');
    await w7aSignUp(ctx, origin, email);
    await srv.shelf.db.query("update users set trial_ends_at = now() - interval '1 day' where email = $1", [email]);
    const page = await openNext(ctx, origin);
    await openBackup(page, f.file);
    await w7aWait(page, () => window.beukCloud?.cloud?.available && !!window.beukCloud.cloud.user, null, 30_000);
    await page.waitForFunction(() => !!document.documentElement.getAttribute('data-plan-access'), null, { timeout: 30_000 });
    await auPop(page);
    const box = await page.evaluate(() => ({ hidden: document.getElementById('lockBackup').hidden, access: document.documentElement.getAttribute('data-plan-access'), record: !document.getElementById('btnAuthorshipRecord').hidden }));
    check(box.hidden && box.access === 'paused', `authorship day 22: the save popover's lock box is hidden (hidden ${box.hidden}; plan access "${box.access}"; the record button shown ${box.record})`);
    await page.click('#localPillBtn');
    await page.waitForSelector('#localPop', { state: 'hidden', timeout: 10_000 });
    const mark = reqs.length;
    const b = await exportBackup(page);
    const posts = reqs.slice(mark).filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/api/authorship/stamps');
    check(b.json.format === 'beuk-backup' && b.json.authorship?.recorded === null && b.json.authorship?.sha256 === auSha(b.json.book) && /\.beuk-backup\.json$/.test(b.name),
      `authorship day 22: a plain export still downloads (${b.name}), its authorship block recorded null (sha256 ${b.json.authorship?.sha256?.slice(0, 12)}…; the stamp asked ${posts.length} time(s), refused)`);
    await harvestCsp(page);
  } finally {
    await ctx.close();
  }
}
async function authorshipChecks() {
  const stripe = await w7aFakeStripe();
  const srv = await startServer({ repo: REPO, api: true, apiConfig: { stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base } });
  note(`authorship: the real server on ${srv.origin} (PGlite), billing in test mode against a fake Stripe on ${stripe.base}`);
  try {
    await authorshipMain(srv);
    await authorshipDay22(srv);
  } finally {
    await srv.stop().catch(() => undefined);
    await stripe.close();
  }
}

const srv = await startServer({ repo: REPO });
const srvRef = srv;
const state = (x) => x.state;
const t0 = Date.now();
let lat = null;
try {
  // E2E_ONLY=historyChecks,tooltipScan runs just those steps (a quick re-run while working; the gate runs them all)
  const only = (process.env.E2E_ONLY || '').split(',').filter(Boolean);
  const run = (name) => !only.length || only.includes(name);
  if (run('bundle')) bundle();
  if (run('noEditGate')) await noEditGate(srv.origin);
  if (run('editAndPersist')) await editAndPersist(srv.origin);
  if (run('oneSafety')) await oneSafety(srv.origin);
  if (run('oneSafety')) await onePackedPics(srv.origin);
  if (run('historyChecks')) await historyChecks(srv.origin);
  if (run('tooltipScan')) await tooltipScan(srv.origin);
  if (run('wave1b')) await wave1bChecks(srv.origin);
  if (run('wave2a')) await wave2aChecks(srv.origin);
  if (run('wave2b')) await wave2bChecks(srv.origin);
  if (run('wave2c')) await wave2cChecks(srv.origin);
  if (run('wave3a')) await wave3aChecks(srv.origin);
  if (run('wave3b')) await wave3bChecks(srv.origin);
  if (run('wave4a')) await wave4aChecks(srv.origin);
  if (run('wave4b')) await wave4bChecks(srv.origin);
  if (run('wave4c')) await wave4cChecks(srv.origin);
  if (run('userThemes')) await userThemesChecks(srv.origin);
  if (run('wave5a')) await wave5aChecks(srv.origin);
  if (run('wave5b')) await wave5bChecks(srv.origin);
  if (run('wave5c')) await wave5cChecks(srv.origin);
  if (run('wave5d')) await wave5dChecks(srv.origin);
  if (run('wave6')) await wave6Checks(srv.origin);
  if (run('wave7a')) await wave7aChecks();
  if (run('wave7b')) await wave7bChecks();
  if (run('lockcopy')) await lockcopyChecks(srv.origin);
  if (run('namedlinks')) await namedLinksChecks();
  if (run('authorship')) await authorshipChecks();
  if (run('insights')) await insightsChecks(srv.origin);
  if (run('notebook')) await notebookChecks(srv.origin);
  if (run('latency')) lat = await latency(srv.origin);
  if (run('screenshots')) await screenshots(srv.origin);
} catch (e) {
  check(false, `the run threw: ${e && e.stack ? e.stack : e}`);
} finally {
  check(csp.violations.length <= MAX_CSP_VIOLATIONS, `CSP: ${csp.violations.length} securitypolicyviolation events (max ${MAX_CSP_VIOLATIONS})${csp.violations.length ? ' ' + JSON.stringify(csp.violations.slice(0, 5)) : ''}`);
  check(csp.errors.length === 0, `no page errors${csp.errors.length ? ': ' + csp.errors.slice(0, 5).join(' | ') : ''}`);
  await browser.close();
  await srv.stop().catch(() => undefined);
}
writeFileSync(path.join(OUT, 'book-e2e.json'), JSON.stringify({ failures, latency: lat }, null, 1));
console.log(`\n${failures.length ? 'FAILED' : 'PASSED'}: ${failures.length} failing check(s), ${((Date.now() - t0) / 1000).toFixed(0)} s; output in ${OUT}`);
process.exit(failures.length ? 1 : 0);
