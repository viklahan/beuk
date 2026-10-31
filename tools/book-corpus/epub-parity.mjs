#!/usr/bin/env node
/* Capture what the STUDIO's EPUB builder makes for each book, so the
 * server build (src/book/epub) can be held to it without a browser
 * (tests/book-epub-parity.test.ts).
 *
 *   node tools/book-corpus/epub-parity.mjs                 the committed books -> tests/fixtures/epub-parity/
 *   node tools/book-corpus/epub-parity.mjs --corpus <dir>  every *.beuk-backup.json under <dir>
 *                                                         -> $BEUK_EPUB_PARITY_OUT (default .scratch/epub-parity-corpus)
 *   ... --only <name-substring>                            just the matching books
 *
 * Needs playwright-core: PLAYWRIGHT_CORE=<path to the playwright-core
 * package> (else it is imported by name), and optionally CHROMIUM=<path
 * to a chrome executable>. One local static server for client/ on
 * 127.0.0.1, one browser, one book at a time; both are closed at the end.
 *
 * Per book the studio opens it the way every arrival does
 * (applyBookDoc), fetches its script and display faces
 * (ensureScriptFonts), and runs epubFiles(platform). Each file is
 * written as its path and the sha256 of its content (binary files: of
 * their base64 text) with two things masked, the only two the server may
 * differ on: the dcterms:modified time, and a book id the studio had to
 * mint because the book had none (or a pre-UUID one it migrated). The
 * source book is only read. */
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT = path.join(ROOT, 'client');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const corpus = opt('--corpus');
const only = opt('--only');

/* Which books, at which platforms. The committed set: every real and
   legacy fixture at "generic", the constructed epub-parity books, and
   the store presets that add files on one book. */
const jobs = [];
if (corpus) {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const full = path.join(d, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith('.beuk-backup.json') ? [full] : [];
  });
  for (const file of walk(corpus)) jobs.push({ file, rel: path.relative(corpus, file).split(path.sep).join('/'), platform: 'generic' });
} else {
  const fx = (sub) => readdirSync(path.join(ROOT, 'tests', 'fixtures', sub)).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: path.join(ROOT, 'tests', 'fixtures', sub, f), rel: `${sub}/${f}`, platform: 'generic' }));
  jobs.push(...fx('books/real'), ...fx('books/legacy'), ...fx('epub-parity/books'));
  for (const platform of ['kdp', 'apple', 'd2d']) jobs.push({ file: path.join(ROOT, 'tests/fixtures/books/real/salt-road-standalone.json'), rel: 'books/real/salt-road-standalone.json', platform });
}
const outDir = corpus ? path.resolve(process.env.BEUK_EPUB_PARITY_OUT || path.join(ROOT, '.scratch', 'epub-parity-corpus')) : path.join(ROOT, 'tests', 'fixtures', 'epub-parity');
const todo = jobs.filter((j) => !only || j.rel.includes(only));
const captureName = (j) => j.rel.replace(/\.beuk-backup\.json$|\.json$/, '').replace(/[\\/]/g, '__') + '--' + j.platform + '.json';

/* One static server for client/ (killed at the end). */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
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
const base = `http://127.0.0.1:${server.address().port}/`;

const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href : 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
let failures = 0;
try {
  const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  mkdirSync(outDir, { recursive: true });
  const boot = async () => {
    await page.goto(base + 'index.html');
    await page.waitForFunction(() => typeof applyBookDoc === 'function' && typeof epubFiles === 'function' && typeof ensureScriptFonts === 'function', null, { timeout: 60000 });
  };
  await boot();
  let n = 0;
  for (const j of todo) {
    /* a fresh page every 8 books, so a long corpus run does not pile up the books' pictures */
    if (n++ % 8 === 0 && n > 1) await boot();
    const env = JSON.parse(readFileSync(j.file, 'utf8'));
    const doc = env.book;
    try {
      const r = await page.evaluate(async ({ doc, platform }) => {
        /* uiLangState, applyBookDoc, ensureScriptFonts, epubFiles, state: the studio's own globals */
        const inId = doc && doc.meta ? doc.meta.bookId : undefined;
        applyBookDoc(JSON.parse(JSON.stringify(doc)));
        await ensureScriptFonts(state.sections, state.meta.language, state.meta);
        const files = epubFiles(platform);
        const id = state.meta.bookId;
        const minted = id !== inId;
        const out = [];
        for (const f of files) {
          let c = String(f.content);
          c = c.replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '<meta property="dcterms:modified">MASKED</meta>');
          if (minted && id) c = c.split(id).join('MINTED-BOOK-ID');
          const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c));
          out.push({ path: f.path, binary: !!f.binary, sha256: Array.from(new Uint8Array(h)).map((x) => x.toString(16).padStart(2, '0')).join('') });
        }
        return { minted, uiLang: uiLangState, files: out };
      }, { doc, platform: j.platform });
      const capture = { book: j.rel, platform: j.platform, lang: r.uiLang, mintedBookId: r.minted, files: r.files };
      writeFileSync(path.join(outDir, captureName(j)), JSON.stringify(capture, null, 1) + '\n');
      console.log(`ok   ${j.rel} ${j.platform}: ${r.files.length} files${r.minted ? ' (minted id masked)' : ''}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${j.rel} ${j.platform}: ${e.message.split('\n')[0]}`);
    }
  }
  if (errors.length) console.log(`page errors (${errors.length}):\n  ` + errors.slice(0, 10).join('\n  '));
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
