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
  return page.$$eval('#structureList .sec-item', (els) => els.map((e, i) => ({ i, editable: e.getAttribute('aria-disabled') !== 'true', name: e.textContent })));
}
async function choose(page, i) {
  await page.locator('#structureList .sec-item').nth(i).click();
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
      const out = await exportBackup(page);
      const want = expected(f.book, out.json.book);
      const same = JSON.stringify(out.json.book) === JSON.stringify(want);
      check(same, `#1 ${f.name}: ${mounted} chapter editors mounted, nothing typed — the export equals readBook's book`);
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
    await page.waitForFunction(() => /Backup opened/.test(document.getElementById('toasts')?.textContent || ''), null, { timeout: 60_000 });
    const wantBackup = expected(DUMAS.book);
    let r1, r2;
    for (let tries = 0; tries < 12; tries++) { // tab 2 reopens the new generation on its own
      await page.waitForTimeout(500);
      r1 = await exportBackup(page);
      r2 = await exportBackup(tab2);
      if (JSON.stringify(r2.json.book) === JSON.stringify(wantBackup)) break;
    }
    check(sectionsOf(r1.json.book).length === sectionsOf(DUMAS.book).length && JSON.stringify(r1.json.book) === JSON.stringify(wantBackup),
      `fix 1: a backup opened in tab 1 while tab 2 holds the book exports exactly the backup (${sectionsOf(r1.json.book).length} sections, backup ${sectionsOf(DUMAS.book).length})`);
    check(JSON.stringify(r2.json.book) === JSON.stringify(wantBackup), `fix 1: tab 2 moved to the new generation (${sectionsOf(r2.json.book).length} sections)`);
    const gens = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n.startsWith('beuk-next-book-')));
    check(gens.length === 1, `fix 1: one generation left on the device (${JSON.stringify(gens)})`);
    await page.reload();
    await page.waitForSelector('#manuscript .ms-editor', { timeout: 60_000 });
    const r3 = await exportBackup(page);
    check(JSON.stringify(r3.json.book) === JSON.stringify(wantBackup), 'fix 1: and after a reload, still exactly the backup');
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

/* ---- #5 latency ---- */
async function latency(origin) {
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
    await page.keyboard.type(text.slice(0, 300), { delay: 30 });
    await page.waitForTimeout(300);
    const lat = (await page.evaluate(() => window.__lat)).slice().sort((x, y) => x - y);
    const q = (p) => lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)];
    const p50 = q(0.5), p95 = q(0.95), max = lat[lat.length - 1];
    note(`latency: section ${big} ("${secs[big].title}"), ${size.blocks} blocks, ${size.chars} characters; ${lat.length} keystrokes: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
    check(lat.length >= 290, `#5 ${lat.length} keystrokes measured`);
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
  '.local-wrap, #netPill, #btnAccount, #btnSupport, #updateBar, #tabBtnType, #tabBtnOutline, .pane-fold, #tipLayer, .beuk-tip,' +
  ' .sample-bar, #bulkHint, #importSummary, #irReopen { display: none !important; }' +
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
        for (const [sel, sel2] of [['#topbar'], ['.side-actions'], ['.center-tabs'], ['#editorArea', '#manuscript']]) {
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

/* ---- the bundle: one yjs ---- */
function bundle() {
  const dir = path.join(REPO, 'client', 'next', 'assets');
  const js = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const yjs = js.split('Yjs was already imported').length - 1;
  check(yjs === 1, `bundle: one copy of yjs (${yjs} "already imported" guard${yjs === 1 ? '' : 's'})`);
  check(!/node:crypto/.test(js), 'bundle: no node:crypto');
}

const srv = await startServer({ repo: REPO });
const t0 = Date.now();
let lat = null;
try {
  bundle();
  await noEditGate(srv.origin);
  await editAndPersist(srv.origin);
  await oneSafety(srv.origin);
  lat = await latency(srv.origin);
  await screenshots(srv.origin);
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
