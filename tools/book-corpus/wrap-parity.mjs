#!/usr/bin/env node
/* Capture what the STUDIO's cover-wrap painter makes for each fixture
 * wrap, so the server render (src/book/wrap) can be held to it without a
 * browser (tests/book-wrap-parity.test.ts).
 *
 *   node tools/book-corpus/wrap-parity.mjs                 every wrap below -> tests/fixtures/wrap-parity/
 *   ... --only <name-substring>                            just the matching wraps
 *
 * Needs playwright-core: PLAYWRIGHT_CORE=<path to the playwright-core
 * package> (else it is imported by name), and optionally CHROMIUM=<path
 * to a chrome executable>. One local static server for client/ on
 * 127.0.0.1, one browser, one wrap at a time; both are closed at the end.
 *
 * Per wrap the studio opens the book the way every arrival does
 * (applyBookDoc), waits for the pictures downloadWrap waits for
 * (ensureCoverBgImage, hcEnsureFlapPhoto, ensureWrapIcons), loads every
 * face of the families the recipe sets type in (canvas text never waits
 * for a face), and runs renderWrapCanvas, keeping what its drawWrapTo
 * returns. Written per wrap:
 *   - items and dims, as the studio's numbers;
 *   - glyph-width probes: measureText of sample text in each recipe face
 *     at 400, 700 and italic 600, plus the wrap's own extra probes;
 *   - the render as downloaded (JPEG 0.92), decoded and box-averaged to
 *     600 px wide (downsample below: the test averages the server's JPEG
 *     the same way), as a PNG in base64.
 * A wrap is a fixture book plus a patch (applyPatch below; the test
 * applies the same patch, read from the capture). The source books are
 * only read. */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT = path.join(ROOT, 'client');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const OUT = path.join(FIXTURES, 'wrap-parity');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only');
const WIDTH = 600;

const PRINT = 'books/real/lantern-coast-print.json';
const BOOK_ONE = 'books/real/lantern-coast-book-one.json';
const UPLOAD = 'epub-parity/books/uploaded-font.json';
/* a spine wide enough for its text and icons */
const WIDE = { pages: 420 };

/* name: the capture's file name (<book>--<binding>); book: the fixture
   book; patch: what changes on it (applyPatch); extra: probes beyond the
   standard ones, { lead, family, text }, family a face the recipe sets
   type in (the server registers only those). */
const WRAPS = [
  { name: 'lantern-coast-print--paperback', book: PRINT, patch: {} },
  { name: 'lantern-coast-print--case', book: PRINT, patch: { recipe: { wrap: { binding: 'case' } } } },
  { name: 'lantern-coast-print--jacket', book: PRINT, patch: { recipe: { wrap: { binding: 'jacket', flapPhotoId: 'sample-img-cover-art' } } } },
  { name: 'lantern-coast-book-one--paperback', book: BOOK_ONE, patch: {} },
  /* the cover maker's display-weight faces; Abril Fatface asked for on an element (COVER_FONTS has no display face, so
     normalizeCoverRecipe sets the default there instead); letters from latin-ext and vietnamese, one of them (Đ) in both subsets */
  {
    name: 'faces--paperback', book: BOOK_ONE,
    patch: { recipe: {
      subtitle: 'Đặng Thị Łódź', tagline: 'Abril asked',
      elements: { title: { font: 'Cinzel' }, author: { font: 'Playfair Display' }, subtitle: { font: 'EB Garamond' }, tagline: { font: 'Abril Fatface' } },
      wrap: { ...WIDE, quote: '“Đđ Łł — a chart of Gullwick.” — Đặng Review', spine: { font: 'Lora', iconTop: { kind: 'lucide', name: 'anchor' } } },
    } },
    extra: [
      { lead: '400', family: 'EB Garamond', text: 'ĐđĐđĐđ' },
      { lead: '700', family: 'EB Garamond', text: 'ĐđĐđĐđ' },
      { lead: '400', family: 'Lora', text: 'ĐđĐđĐđ' },
      { lead: '400', family: 'EB Garamond', text: 'Đặng Thị Łódź Żółć' },
    ],
  },
  /* an Arabic title: the recipe's face has no Arabic, so the stack's script face (Amiri) sets it */
  {
    name: 'arabic--paperback', book: BOOK_ONE,
    patch: { meta: { language: 'ar' }, recipe: { title: 'فانوس الساحل', author: 'أبريل كاروك', subtitle: 'رواية قصيرة', wrap: { ...WIDE } } },
    extra: [
      { lead: '400', family: 'Libre Baskerville', text: 'فانوس الساحل' },
      { lead: '700', family: 'Libre Baskerville', text: 'فانوس الساحل' },
    ],
  },
  /* the writer's own face on the title, author and spine */
  {
    name: 'uploaded-font--paperback', book: BOOK_ONE,
    patch: { fonts: [{ from: UPLOAD }], recipe: { elements: { title: { font: 'Writer Hand' }, author: { font: 'Writer Hand' } }, wrap: { ...WIDE } } },
  },
  /* an upload named like a built-in face (its bytes are Patrick Hand): which one the studio sets */
  {
    name: 'upload-collision--paperback', book: BOOK_ONE,
    patch: { fonts: [{ from: UPLOAD, family: 'Libre Baskerville' }], recipe: { wrap: { ...WIDE } } },
  },
  /* a theme with no heading face and a display body face, and element fonts that are not faces: the recipe falls back to
     defaultCoverRecipe, which reads the theme applyBookDoc merged over PRESETS[0].theme */
  {
    name: 'theme-defaults--paperback', book: BOOK_ONE,
    patch: { theme: { bodyFont: 'Abril Fatface', fontSize: 17 }, recipe: { elements: { title: { font: 'Not A Face' }, author: { font: 'Comic Sans MS' }, subtitle: { font: 'Abril Fatface' } } } },
  },
];

/* ---- shared with tests/book-wrap-parity.test.ts (the same steps there) ---- */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  if (!isObj(a) || !isObj(b)) return structuredClone(b);
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : structuredClone(b[k]);
  return o;
}
/** The fixture book with the wrap's patch: meta merged, theme replaced, the recipe merged deep, fonts taken from another fixture book. */
function applyPatch(book, patch, load) {
  const b = structuredClone(book);
  if (patch.meta) b.meta = { ...b.meta, ...patch.meta };
  if (patch.theme) b.theme = structuredClone(patch.theme);
  if (patch.recipe) b.coverRecipe = merge(b.coverRecipe, patch.recipe);
  if (patch.fonts) b.fonts = patch.fonts.map((f) => ({ ...load(f.from).fonts[f.index || 0], ...(f.family ? { family: f.family } : {}) }));
  return b;
}
/** Box average to `tw` wide: every source pixel adds to the target pixel its position falls in. RGB only (the wrap is opaque). */
function downsample(src, W, H, tw) {
  const th = Math.round(tw * H / W);
  const sum = new Float64Array(tw * th * 3), cnt = new Uint32Array(tw * th);
  const bx = new Int32Array(W);
  for (let x = 0; x < W; x++) bx[x] = Math.min(tw - 1, Math.floor(x * tw / W));
  for (let y = 0; y < H; y++) {
    const row = Math.min(th - 1, Math.floor(y * th / H)) * tw;
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      const t = row + bx[x];
      sum[t * 3] += src[i]; sum[t * 3 + 1] += src[i + 1]; sum[t * 3 + 2] += src[i + 2]; cnt[t]++;
    }
  }
  const data = new Uint8ClampedArray(tw * th * 4);
  for (let t = 0; t < tw * th; t++) {
    data[t * 4] = Math.round(sum[t * 3] / cnt[t]); data[t * 4 + 1] = Math.round(sum[t * 3 + 1] / cnt[t]);
    data[t * 4 + 2] = Math.round(sum[t * 3 + 2] / cnt[t]); data[t * 4 + 3] = 255;
  }
  return { data, w: tw, h: th };
}
/* ---- /shared ---- */

const loadBook = (rel) => JSON.parse(readFileSync(path.join(FIXTURES, rel), 'utf8')).book;
const todo = WRAPS.filter((w) => !only || w.name.includes(only));

/* One static server for client/ (closed at the end). */
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
  mkdirSync(OUT, { recursive: true });
  for (const w of todo) {
    /* a fresh page per wrap: an uploaded face registered by one book never reaches the next */
    await page.goto(base + 'index.html');
    await page.waitForFunction(() => typeof applyBookDoc === 'function' && typeof renderWrapCanvas === 'function' && typeof drawWrapTo === 'function', null, { timeout: 60000 });
    /* the tool's own averaging, given to the page as a script (CDP evaluates it; the page's CSP does not apply) */
    await page.evaluate(`window.__wrapDownsample = ${downsample.toString()};`);
    const doc = applyPatch(loadBook(w.book), w.patch, loadBook);
    try {
      const r = await page.evaluate(async ({ doc, extra, width }) => {
        /* applyBookDoc, state, normalizeWrap, CM_ELEMENTS, fontStack, ensure*, wrapDims, renderWrapCanvas, drawWrapTo, uiLangState: the studio's own globals */
        const downsample = window.__wrapDownsample;
        applyBookDoc(JSON.parse(JSON.stringify(doc)));
        const recipe = state.coverRecipe;
        if (!recipe) throw new Error('the book has no cover recipe');
        await Promise.all([ensureCoverBgImage(recipe), hcEnsureFlapPhoto(recipe), ensureWrapIcons(recipe)]);
        const wr = normalizeWrap(recipe.wrap);
        const fams = [...new Set(CM_ELEMENTS.map((k) => recipe.elements[k].font).concat([wr.spine.font, wr.back.font]).filter(Boolean))];
        const unq = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
        const names = new Set(fams.flatMap((f) => fontStack(f).split(',').map(unq)));
        await document.fonts.ready;
        const loads = [];
        document.fonts.forEach((f) => { if (names.has(unq(f.family))) loads.push(f.load().catch(() => null)); });
        await Promise.all(loads);
        await document.fonts.ready;

        const SAMPLE = 'The Lantern Coast, Hamburgefonstiv';
        const probes = [];
        for (const f of fams) for (const lead of ['400', '700', 'italic 600']) probes.push({ font: lead + ' 40px ' + fontStack(f), text: SAMPLE });
        for (const x of extra) probes.push({ font: x.lead + ' 40px ' + fontStack(x.family), text: x.text });
        const pc = document.createElement('canvas').getContext('2d');
        for (const p of probes) { pc.font = p.font; p.width = pc.measureText(p.text).width; }

        const draw = drawWrapTo;
        let items = null;
        drawWrapTo = function (c, r, o) { items = draw(c, r, o); return items; };
        let c;
        try { c = renderWrapCanvas(recipe, {}); } finally { drawWrapTo = draw; }
        /* as downloaded: JPEG at 0.92, decoded again */
        const img = new Image();
        await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('the wrap JPEG did not decode')); img.src = c.toDataURL('image/jpeg', 0.92); });
        const full = document.createElement('canvas');
        full.width = c.width; full.height = c.height;
        const fx = full.getContext('2d');
        fx.drawImage(img, 0, 0);
        const small = downsample(fx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, width);
        const out = document.createElement('canvas');
        out.width = small.w; out.height = small.h;
        out.getContext('2d').putImageData(new ImageData(small.data, small.w, small.h), 0, 0);
        return {
          items, dims: wrapDims(recipe), size: { w: c.width, h: c.height }, probes, uiLang: uiLangState,
          faces: fams, png: out.toDataURL('image/png').split(',')[1],
        };
      }, { doc, extra: w.extra || [], width: WIDTH });
      const capture = { name: w.name, book: w.book, patch: w.patch, lang: r.uiLang, faces: r.faces, size: r.size, dims: r.dims, items: r.items, probes: r.probes, png: r.png };
      writeFileSync(path.join(OUT, w.name + '.json'), JSON.stringify(capture, null, 1) + '\n');
      console.log(`ok   ${w.name}: ${r.size.w}x${r.size.h}, ${r.probes.length} probes, png ${Math.round(r.png.length * 0.75 / 1024)} KB`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${w.name}: ${e.message.split('\n')[0]}`);
    }
  }
  if (errors.length) console.log(`page errors (${errors.length}):\n  ` + errors.slice(0, 10).join('\n  '));
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
