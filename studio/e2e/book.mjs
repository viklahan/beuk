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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, deviceScaleFactor: 1, ...opts });
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
  page.on('pageerror', (e) => csp.errors.push(`${page.url()}: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 404|net::ERR_INTERNET_DISCONNECTED/.test(m.text())) csp.errors.push(`${page.url()}: ${m.text()}`);
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
  await page.click('#btnExport');
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
  try {
    const page = await openNext(ctx, origin);
    await openBackup(page, DUMAS.file);
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
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 6);
    note('profile, 100 keystrokes, top self time: ' + top.map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(' | '));
    await harvestCsp(page);
    return { p50, p95, max, n: lat.length, section: big, ...size, top };
  } finally {
    await ctx.close();
  }
}

/* ---- screenshots, next to 1.0 ---- */
const ONE_HIDE =
  '.local-wrap, #netPill, #btnAccount, #btnSupport, #updateBar, .pane-fold, #tipLayer, .beuk-tip,' +
  ' #bulkHint, #importSummary, #irReopen { display: none !important; }' + // wave 1c: the sample bar and its tour link are in both
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
      check(JSON.stringify(noHistory(back.json.book)) === JSON.stringify(noHistory(old.json.book)), 'wave 1a #1: "Restore the whole book" brings the old book back exactly (export-equal, key order included, History aside)');
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
  await page.evaluate(() => document.getElementById('btnExport').click());
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
      // the 300 DPI wrap box-averaged to 600 px wide (as tests/book-wrap-parity.test.ts compares the server's): where
      // Chrome itself does not paint the same 300 DPI canvas twice alike, the closeness is measured on this
      down: (() => {
        const W = full.width, H = full.height, tw = 600, th = Math.round(tw * H / W);
        const d = full.getContext('2d').getImageData(0, 0, W, H).data;
        const sum = new Float64Array(tw * th * 3), cnt = new Uint32Array(tw * th);
        for (let y = 0; y < H; y++) {
          const row = Math.min(th - 1, Math.floor(y * th / H)) * tw;
          for (let x = 0, i = y * W * 4; x < W; x++, i += 4) { const t = row + Math.min(tw - 1, Math.floor(x * tw / W)); sum[t * 3] += d[i]; sum[t * 3 + 1] += d[i + 1]; sum[t * 3 + 2] += d[i + 2]; cnt[t]++; }
        }
        let s = '';
        for (let t = 0; t < tw * th; t++) for (let k = 0; k < 3; k++) s += String.fromCharCode(Math.round(sum[t * 3 + k] / cnt[t]));
        return btoa(s);
      })(),
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
/** Two 600 px box-averaged renders (RGB bytes, base64): mean and max absolute channel difference. */
function w4cNear(a, b) {
  const x = Buffer.from(a, 'base64'), y = Buffer.from(b, 'base64');
  if (x.length !== y.length) return { mean: Infinity, max: 255 };
  let sum = 0, max = 0;
  for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); sum += d; if (d > max) max = d; }
  return { mean: sum / x.length, max };
}
/** 2.0 with a book open and its cover maker wired (the closure loaded, 1.0's initCoverMaker run, Lucide in). */
async function w4cOpen(ctx, origin, file) {
  const page = await openNext(ctx, origin);
  await openBackup(page, file);
  await page.waitForFunction(() => !!window.beukCover && !!window.lucide && document.querySelectorAll('#cmElFont option').length > 10 && document.getElementById('cmSpineBody')?.getAttribute('data-built') === '1', null, { timeout: 60_000 });
  return page;
}
async function wave4cParity(origin) {
  const narrow = (process.env.W4C_BOOKS || '').split(',').filter(Boolean);
  const books = [
    ...fixtures.filter((f) => f.book.coverRecipe).map((f) => ({ name: f.name, book: f.book, file: f.file, set: f.name === 'real/lantern-coast-book-one' })),
    ...w4cCaptureBooks().map((b) => ({ ...b, file: w4cBackup(b.name, b.book), set: false })),
  ].filter((b) => !narrow.length || narrow.some((n) => b.name.includes(n)));
  for (const b of books) {
    const ctx = await newContext({ serviceWorkers: 'block' });
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
        const near = w4cNear(A[i].down, B[i].down), noise = w4cNear(A[i].down, A2[i].down);
        for (const part of ['front', 'preview', 'wrap', 'spine', 'back', 'frontPanel']) {
          const a = A[i][part], c = B[i][part];
          const same = a.size === c.size && a.hash === c.hash;
          const tiles = a.tiles.filter((t, k) => t !== c.tiles[k]).length;
          const selfSame = A2[i][part].hash === a.hash;
          // exact where 1.0 paints the part alike twice; where it does not (Chrome's 300 DPI canvas), 2.0's distance
          // from 1.0 is held to 1.0's distance from itself
          // (measured: 1.0 against itself differs at 300 DPI in 130 of 141 front-panel renders, by at most 1 in 255 at
          // 600 px, mean 0.000; never at the maker's sizes, nor in the spine or back panels)
          const ok = same || (a.size === c.size && (part === 'wrap' || part === 'frontPanel') && near.max <= 1 && near.mean <= 0.01);
          w4cParity.rows.push({ book: b.name, recipe: x.name, part, size: c.size, same, ok, selfSame, tiles, near, noise });
          if (!ok) { bad++; check(false, `wave4c pixel parity ${b.name} · ${x.name} · ${part}: 1.0 ${a.size} ${a.hash} / 2.0 ${c.size} ${c.hash} (${tiles} of 16 tiles differ; 600 px: mean ${near.mean.toFixed(3)} max ${near.max}; 1.0 against itself: ${selfSame ? 'equal' : `mean ${noise.mean.toFixed(3)} max ${noise.max}`})`); }
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
  const near = w4cParity.rows.filter((r) => !r.same && r.ok);
  const selfNoisy = w4cParity.rows.filter((r) => !r.selfSame);
  note(`  1.0 against itself (the same recipes painted again in its page): ${selfNoisy.length} of ${w4cParity.rows.length} parts differ — ` + ([...new Set(selfNoisy.map((r) => r.part))].join(', ') || 'none') + (selfNoisy.length ? `; worst 600 px distance mean ${Math.max(...selfNoisy.map((r) => r.noise.mean)).toFixed(3)} max ${Math.max(...selfNoisy.map((r) => r.noise.max))}` : ''));
  if (near.length) note(`  2.0 not equal to the last bit but within Chrome's 300 DPI noise: ${near.length} — ` + [...new Set(near.map((r) => r.part))].join(', ') + `; worst 600 px distance mean ${Math.max(...near.map((r) => r.near.mean)).toFixed(3)} max ${Math.max(...near.map((r) => r.near.max))}`);
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
    { id: 'x" onclick="window.__pw=17', name: 'n', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }];
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
      return { on, src, scripts, css, pw: window.__pw ?? null, fonts: [...document.fonts].filter((f) => /evil|display: none/.test(f.family)).length };
    });
    const look = await page.evaluate(W4B_LOOK);
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
