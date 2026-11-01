/* The import-shapes grid, run: every generated file is imported through
   the 1.0 studio the way a writer does it — /studio served with the
   Caddyfile's real security headers, a fresh browser context per file,
   the Import button, the replace prompt answered — and the book 1.0
   saves is compared with the shape's expected structure. A fail stays a
   fail; nothing here retries or skips.

     CHROMIUM=<chrome executable>  PLAYWRIGHT_CORE=<playwright-core package dir>
     npm run import-shapes:run [-- --only <shape id>]
     (IMPORT_SHAPES_OUT=<dir> keeps results.md / results.json there)

   Not part of npm test: it needs Chromium. Exit 1 on any fail, 2 when
   the run itself could not start. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareBook, type Book10 } from './compare.js';
import { FORMATS, loadShapes, OUT_DIR, type Format, type Shape } from './shape.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPORT_TIMEOUT_MS = 60_000;
const SETTLE_MS = 1500; // 1.0's local save is debounced (studio/e2e/book.mjs waits the same)

export type CellResult = { shape: string; format: Format | 'boxset'; status: 'pass' | 'fail' | 'na'; diff?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any; type Browser = any;

/* Toasts, recorded as they appear: an import that is refused says so in an alert toast. */
const TOAST_SPY = () => {
  const w = window as unknown as { __toasts: { text: string; alert: boolean }[] };
  w.__toasts = [];
  new MutationObserver((ms) => {
    for (const m of ms) m.addedNodes.forEach((n) => {
      const el = n as HTMLElement;
      if (el.classList && el.classList.contains('toast')) w.__toasts.push({ text: el.textContent || '', alert: /alert-triangle/.test(el.innerHTML) });
    });
  }).observe(document, { childList: true, subtree: true });
};

const READ_SAVED = async () => {
  const db = await new Promise<IDBDatabase | null>((res) => { const q = indexedDB.open('beuk-local'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  if (!db || !db.objectStoreNames.contains('kv')) { db?.close(); return null; }
  const rec = await new Promise<{ savedAt: string; json: string } | null>((res) => {
    const g = db.transaction('kv', 'readonly').objectStore('kv').get('book'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null);
  });
  db.close();
  return rec;
};

export async function openStudio(browser: Browser, origin: string) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(TOAST_SPY);
  const page: Page = await ctx.newPage();
  await page.goto(origin + '/studio');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-local-restore') !== 'pending', null, { timeout: 30_000 });
  return { ctx, page };
}

/** Import one file through the Import button; the saved book, or why there is none. */
export async function importThroughButton(page: Page, file: string): Promise<{ book: Book10 } | { error: string }> {
  const t0 = Date.now();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnImport')]);
  await chooser.setFiles(file);
  try {
    await page.waitForSelector('#btnConfirmYes', { state: 'visible', timeout: 3000 });
    await page.click('#btnConfirmYes');
  } catch { /* an empty desk or the untouched sample: 1.0 does not ask */ }
  const deadline = Date.now() + IMPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const refused = await page.evaluate(() => (window as unknown as { __toasts: { text: string; alert: boolean }[] }).__toasts.filter((t) => t.alert).map((t) => t.text));
    if (refused.length) return { error: `import refused: ${refused[0].trim()}` };
    const rec = await page.evaluate(READ_SAVED);
    if (rec && Date.parse(rec.savedAt) > t0) {
      await page.waitForTimeout(SETTLE_MS);
      const last = await page.evaluate(READ_SAVED);
      return { book: JSON.parse(last.json).book as Book10 };
    }
    await page.waitForTimeout(300);
  }
  return { error: `no book saved within ${IMPORT_TIMEOUT_MS / 1000} s` };
}

async function runCell(browser: Browser, origin: string, s: Shape, f: Format): Promise<CellResult> {
  const { ctx, page } = await openStudio(browser, origin);
  try {
    const got = await importThroughButton(page, path.join(OUT_DIR, `${s.id}.${f}`));
    if ('error' in got) return { shape: s.id, format: f, status: 'fail', diff: got.error };
    const r = compareBook(s.expected, got.book);
    return r.ok ? { shape: s.id, format: f, status: 'pass' } : { shape: s.id, format: f, status: 'fail', diff: r.diff ?? '' };
  } catch (e) {
    return { shape: s.id, format: f, status: 'fail', diff: `harness: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}` };
  } finally {
    await ctx.close();
  }
}

export function resultsMarkdown(cells: CellResult[], ran: string, base: string): string {
  const rows = new Map<string, Map<string, CellResult>>();
  for (const c of cells) { if (!rows.has(c.shape)) rows.set(c.shape, new Map()); rows.get(c.shape)!.set(c.format, c); }
  const mark = (c?: CellResult) => (!c ? '' : c.status === 'fail' ? 'FAIL' : c.status);
  const count = (st: string) => cells.filter((c) => c.status === st).length;
  const lines = [
    `# Import shapes — ${ran} (${base})`, '',
    `pass ${count('pass')} · fail ${count('fail')} · na ${count('na')}`, '',
    '| shape | ' + FORMATS.join(' | ') + ' | box set |', '|---|' + FORMATS.map(() => '---|').join('') + '---|',
    ...[...rows].map(([shape, m]) => `| ${shape} | ` + FORMATS.map((f) => mark(m.get(f))).join(' | ') + ` | ${mark(m.get('boxset'))} |`),
    '', '## Fails', '',
    ...cells.filter((c) => c.status === 'fail').map((c) => `- **${c.shape} · ${c.format}**: ${c.diff}`),
  ];
  return lines.join('\n') + '\n';
}

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const shapes = loadShapes().filter((s) => !only || s.id === only);
  if (!shapes.length) { console.error(`no shape "${only}"`); process.exit(2); }
  const OUT = process.env.IMPORT_SHAPES_OUT ? path.resolve(process.env.IMPORT_SHAPES_OUT) : mkdtempSync(path.join(os.tmpdir(), 'beuk-import-shapes-'));
  mkdirSync(OUT, { recursive: true });

  let browser: Browser, srv: { origin: string; stop: () => Promise<void> };
  try {
    const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href : 'playwright-core');
    browser = await pw.chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
    const serve = await import(pathToFileURL(path.join(REPO, 'studio', 'e2e', 'serve.mjs')).href);
    srv = await serve.startServer({ repo: REPO });
  } catch (e) {
    console.error('could not start: ' + (e instanceof Error ? e.message : String(e)));
    process.exit(2);
  }

  const cells: CellResult[] = [];
  try {
    for (const s of shapes) {
      for (const f of FORMATS) {
        const c = s.formats.includes(f) ? await runCell(browser, srv.origin, s, f) : { shape: s.id, format: f, status: 'na' as const };
        cells.push(c);
        if (c.status !== 'na') console.log(`${c.status === 'pass' ? 'pass' : 'FAIL'} ${s.id}.${f}${c.diff ? ' — ' + c.diff : ''}`);
      }
    }
  } finally {
    await browser.close();
    await srv.stop();
  }

  const ran = new Date().toISOString();
  const base = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim();
  const md = resultsMarkdown(cells, ran, base);
  writeFileSync(path.join(OUT, 'results.md'), md);
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ran, base, cells }, null, 2) + '\n');
  console.log('\n' + md + `\nresults: ${OUT}`);
  process.exit(cells.some((c) => c.status === 'fail') ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
