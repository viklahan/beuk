// Maintainer-only (never runs in a visitor's browser, never at app start):
// vendors the book's DISPLAY faces — typefaces for chapter titles, the
// title page and drop caps, never for running text — the same legal way
// as the Latin families (tools/fonts/vendor-web-fonts.mjs) and the script
// faces (tools/fonts/vendor-script-fonts.mjs), and records them in the
// same places:
//
//  1. Web (live preview): asks the Google Fonts CSS2 API — once, from the
//     maintainer's machine, desktop Chrome UA — for exactly the families
//     below and keeps the same subsets the Latin families keep (every
//     subset each family offers among latin, latin-ext, cyrillic,
//     cyrillic-ext, greek, greek-ext, vietnamese). Written under
//     client/assets/fonts/<dir>/ and declared in fonts-display.css, which
//     only the studio links.
//  2. Print renderer: the static TrueType instance the same API serves a
//     plain client for the same request (STATIC on purpose — Chromium
//     embeds variable fonts in a PDF as Type 3; see deploy/renderer/
//     fonts.lock), pinned by sha256 in deploy/renderer/fonts.lock, with
//     each family's OFL.txt.
//  3. EPUB embedding: the same TrueType file is kept under
//     client/assets/fonts/<dir>/ — same bytes, same sha256 — so the
//     studio can embed it in an EPUB whose headings are set in it (a
//     display face is not on any reader, so without it the reader would
//     set the headings in its own default face).
//  4. Licences: OFL.txt from the google/fonts repository at the commit
//     the rest of Beuk pins; refuses anything that is not SIL OFL 1.1 or
//     whose METADATA.pb does not say license: "OFL". Reserved Font Names
//     are recorded in MANIFEST.tsv; the files are never modified or
//     subset, so the names may be kept.
//  5. MANIFEST.tsv: this script's rows replace its own families' rows and
//     leave every other family's rows exactly as they are.
//
// Usage: node tools/fonts/vendor-display-fonts.mjs <repo root>
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: node vendor-display-fonts.mjs <repo root>'); process.exit(2); }
const OUT = path.join(root, 'client', 'assets', 'fonts');
const LOCK = path.join(root, 'deploy', 'renderer', 'fonts.lock');

// Each family has one weight (400) and no italic: Google Fonts serves no
// other. The studio sets headings in them at weight 400 so no browser or
// reader fakes a bold.
const FAMILIES = [
  // A formal copperplate script, for poetry, romance and wedding-book titles.
  { family: 'Pinyon Script', query: 'Pinyon+Script' },
  // A clear, upright print-handwriting face (unjoined letters) for
  // children's books.
  { family: 'Patrick Hand', query: 'Patrick+Hand' },
  // A heavy, high-contrast poster serif for travel, food and thriller titles.
  { family: 'Abril Fatface', query: 'Abril+Fatface' }
];
const KEEP_SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GF_COMMIT = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const dirOf = (family) => family.toLowerCase().replace(/[^a-z0-9]/g, '');
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function get(url, asText, ua) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: ua ? { 'user-agent': ua } : {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return asText ? await res.text() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw new Error(url + ': ' + err.message);
    }
  }
}
const prop = (body, k) => { const r = new RegExp(k + ':\\s*([^;]+);').exec(body); return r ? r[1].trim() : null; };

const manifest = [];
const faces = [];
const lock = [];
for (const F of FAMILIES) {
  const dir = dirOf(F.family);
  await mkdir(path.join(OUT, dir), { recursive: true });
  const cssUrl = 'https://fonts.googleapis.com/css2?family=' + F.query + '&display=swap';

  // 1. WOFF2, every kept subset
  const css = await get(cssUrl, true, UA);
  const byUrl = new Map();
  const blockRe = /\/\* ([a-z0-9-]+) \*\/\s*@font-face \{([^}]*)\}/g;
  for (let m; (m = blockRe.exec(css)); ) {
    if (!KEEP_SUBSETS.includes(m[1])) { console.log('dropped subset ' + m[1] + ' of ' + F.family); continue; }
    const body = m[2];
    const src = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\) format\('woff2'\)/.exec(body);
    if (!src || prop(body, 'font-family').replace(/^'|'$/g, '') !== F.family) { console.error('unexpected block for ' + F.family); process.exit(1); }
    const b = { family: F.family, subset: m[1], style: prop(body, 'font-style'), weight: prop(body, 'font-weight'), range: prop(body, 'unicode-range'), url: src[1] };
    faces.push(b);
    if (!byUrl.has(b.url)) byUrl.set(b.url, { subset: b.subset, style: b.style, weights: [] });
    byUrl.get(b.url).weights.push(b.weight);
  }
  if (!byUrl.size) { console.error('no web faces for ' + F.family); process.exit(1); }
  for (const [url, f] of byUrl) {
    const name = dir + '-' + f.subset + '-' + f.style + '-' + f.weights.join('_') + '.woff2';
    const body = await get(url, false, UA);
    if (body.subarray(0, 4).toString('latin1') !== 'wOF2') { console.error('not WOFF2: ' + url); process.exit(1); }
    await writeFile(path.join(OUT, dir, name), body);
    f.local = dir + '/' + name;
    manifest.push([F.family, f.local, body.length, sha(body), url, 'web: display face, ' + f.subset + ' subset']);
  }
  for (const b of faces.filter((x) => x.family === F.family)) b.local = byUrl.get(b.url).local;

  // 2 + 3. static TrueType (plain client), renderer + EPUB
  const ttfCss = await get(cssUrl, true, null);
  const ttfRe = /@font-face \{([^}]*)\}/g;
  for (let m; (m = ttfRe.exec(ttfCss)); ) {
    const body = m[1];
    const src = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\) format\('truetype'\)/.exec(body);
    if (!src) { console.error('unexpected TrueType block for ' + F.family); process.exit(1); }
    const b = { style: prop(body, 'font-style'), weight: prop(body, 'font-weight') };
    const ttf = await get(src[1], false, null);
    const magic = ttf.subarray(0, 4).toString('hex');
    if (magic !== '00010000' && magic !== '74727565') { console.error('not TrueType: ' + src[1]); process.exit(1); }
    const name = F.family.replace(/ /g, '_') + '-' + b.style + '-' + b.weight + '.ttf';
    lock.push(sha(ttf) + '  ' + dir + '/' + name + '  ' + src[1]);
    await writeFile(path.join(OUT, dir, name), ttf);
    manifest.push([F.family, dir + '/' + name, ttf.length, sha(ttf), src[1], 'EPUB embedding + renderer: static TrueType ' + b.style + ' ' + b.weight]);
  }

  // 4. licence
  const licUrl = 'https://raw.githubusercontent.com/google/fonts/' + GF_COMMIT + '/ofl/' + dir + '/OFL.txt';
  const lic = await get(licUrl, false, null);
  const text = lic.toString('utf8');
  if (!/SIL OPEN FONT LICENSE Version 1\.1/i.test(text)) { console.error('not OFL 1.1: ' + licUrl); process.exit(1); }
  await writeFile(path.join(OUT, dir, 'OFL.txt'), lic);
  const meta = await get('https://raw.githubusercontent.com/google/fonts/' + GF_COMMIT + '/ofl/' + dir + '/METADATA.pb', true, null);
  const ml = /license:\s*"([^"]+)"/.exec(meta);
  if (!ml || ml[1] !== 'OFL') { console.error('METADATA.pb licence is not OFL for ' + F.family); process.exit(1); }
  const rfn = (text.split(/PREAMBLE/)[0].match(/Reserved Font Names?[^\r\n]*/gi) || []).join(' | ');
  manifest.push([F.family, dir + '/OFL.txt', lic.length, sha(lic), licUrl, 'METADATA.pb license: ' + ml[1] + (rfn ? '; ' + rfn : '; no Reserved Font Name')]);
  lock.push(sha(lic) + '  ' + dir + '/OFL.txt  ' + licUrl);
}

// fonts-display.css — linked by the studio only
const face = (b) =>
  '/* ' + b.subset + ' */\n@font-face {\n  font-family: \'' + b.family + '\';\n  font-style: ' + b.style + ';\n  font-weight: ' + b.weight +
  ';\n  font-display: swap;\n  src: url(' + b.local + ') format(\'woff2\');\n  unicode-range: ' + b.range + ';\n}';
await writeFile(path.join(OUT, 'fonts-display.css'),
  '/* Beuk web fonts, self-hosted: the book\'s display faces — ' + FAMILIES.map((F) => F.family).join(', ') + ' —\n' +
  '   for chapter titles, the title page and drop caps only, linked by the\n' +
  '   studio (tools/fonts/vendor-display-fonts.mjs; provenance, licences and\n' +
  '   sha256 in README.md beside this file). No request leaves this origin.\n' +
  '   URLs are relative to this stylesheet. */\n' + faces.map(face).join('\n') + '\n');

// MANIFEST.tsv: replace this script's families' rows, keep every other row
const mine = new Set(FAMILIES.map((F) => F.family));
const old = (await readFile(path.join(OUT, 'MANIFEST.tsv'), 'utf8')).trim().split('\n');
const kept = old.slice(1).filter((l) => !mine.has(l.split('\t')[0]));
await writeFile(path.join(OUT, 'MANIFEST.tsv'), old[0] + '\n' + kept.concat(manifest.map((r) => r.join('\t'))).join('\n') + '\n');

// fonts.lock: replace this script's lines (by destination directory), keep the rest
const dirs = FAMILIES.map((F) => dirOf(F.family) + '/');
const lockOld = (await readFile(LOCK, 'utf8')).replace(/\r\n/g, '\n').split('\n');
const lockKept = lockOld.filter((l) => !(/^[0-9a-f]{64} {2}/.test(l) && dirs.some((d) => l.split('  ')[1].startsWith(d))));
while (lockKept.length && lockKept[lockKept.length - 1] === '') lockKept.pop();
await writeFile(LOCK, lockKept.concat(lock).join('\n') + '\n');

const web = manifest.filter((r) => r[1].endsWith('.woff2'));
const ttfs = manifest.filter((r) => r[1].endsWith('.ttf'));
console.log('display families: ' + FAMILIES.length + ', web files: ' + web.length + ' (' + web.reduce((a, r) => a + r[2], 0) +
  ' bytes), TrueType: ' + ttfs.length + ' (' + ttfs.reduce((a, r) => a + r[2], 0) + ' bytes), renderer lock lines: ' + lock.length);
for (const r of manifest.filter((x) => x[1].endsWith('OFL.txt'))) console.log(r[0] + ': ' + r[5]);
