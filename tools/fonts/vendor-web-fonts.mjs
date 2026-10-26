// Maintainer-only (never runs in a visitor's browser, never at app start):
// vendors the studio's web fonts into client/assets/fonts/ so no page
// ever asks Google for a font again (V, 2026-10-26; LG München I,
// 20.01.2022, 3 O 17493/20 — dynamic Google Fonts embedding sends the
// visitor's IP to Google).
//
// What it does, and nothing more:
//  1. asks the Google Fonts CSS2 API — ONCE, from the maintainer's
//     machine — for exactly the families/axes/weights/styles the pages
//     used to request (CSS2_URL below = the union of the old <link>s in
//     client/index.html, src/help/render.ts, src/warmth/pages.ts,
//     client/thanks + client/support), with a desktop Chrome UA so the
//     answer is WOFF2 with per-subset unicode-range;
//  2. keeps only the subsets in KEEP_SUBSETS (logs every one dropped);
//  3. downloads each distinct file once, writes it under
//     client/assets/fonts/<family dir>/, and records its sha256;
//  4. downloads each family's licence file from the google/fonts
//     repository at a pinned commit (the same commit the renderer's
//     fonts.lock uses), refuses anything that is not the SIL OFL 1.1;
//  5. writes client/assets/fonts/fonts.css (the same @font-face blocks
//     Google returned, url() rewritten to the local file) and
//     client/assets/fonts/MANIFEST.tsv (family, file, bytes, sha256,
//     source URL) for the README.
// The fonts are not modified: the files are the bytes Google Fonts serves.
//
// Usage: node tools/fonts/vendor-web-fonts.mjs <repo root>
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: node vendor-web-fonts.mjs <repo root>'); process.exit(2); }
const OUT = path.join(root, 'client', 'assets', 'fonts');

const CSS2_URL = 'https://fonts.googleapis.com/css2?' + [
  'Alegreya:ital,wght@0,400;0,500;0,700;1,400',
  'Cinzel:wght@500;600;700',
  'Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500',
  'Crimson+Pro:ital,wght@0,400;0,500;0,600;1,400',
  'EB+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500',
  'Gentium+Book+Plus:ital,wght@0,400;0,700;1,400',
  'IBM+Plex+Mono:wght@400;500',
  'Inter:wght@400;500;600;700',
  'Karla:ital,wght@0,400;0,500;0,600;0,700;1,400',
  'Libre+Baskerville:ital,wght@0,400;0,700;1,400',
  'Libre+Caslon+Text:ital,wght@0,400;0,700;1,400',
  // studio asked 0:400-600 + 1:400; help asked 0:400-700 + 1:400,500
  'Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;0,7..72,600;0,7..72,700;1,7..72,400;1,7..72,500',
  'Lora:ital,wght@0,400;0,500;0,600;1,400',
  'Merriweather:ital,wght@0,400;0,700;0,900;1,400',
  'Montserrat:wght@500;600;700',
  'Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500',
  'Oswald:wght@500;600',
  'Playfair+Display:ital,wght@0,500;0,600;0,700;1,500',
  'PT+Serif:ital,wght@0,400;0,700;1,400',
  'Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400',
  'Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400',
  'Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500'
].map((f) => 'family=' + f).join('&') + '&display=swap';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const KEEP_SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'];
const GF_COMMIT = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const dirOf = (family) => family.toLowerCase().replace(/[^a-z0-9]/g, '');

async function get(url, asText) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return asText ? await res.text() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw new Error(url + ': ' + err.message);
    }
  }
}
const sha = (b) => createHash('sha256').update(b).digest('hex');

const css = await get(CSS2_URL, true);
const blockRe = /\/\* ([a-z0-9-]+) \*\/\s*@font-face \{([^}]*)\}/g;
const blocks = [];
const dropped = {};
for (let m; (m = blockRe.exec(css)); ) {
  const subset = m[1], body = m[2];
  const prop = (k) => { const r = new RegExp(k + ':\\s*([^;]+);').exec(body); return r ? r[1].trim() : null; };
  const family = prop('font-family').replace(/^'|'$/g, '');
  const src = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\) format\('woff2'\)/.exec(body);
  if (!src) { console.error('unexpected src in block for ' + family + ' ' + subset); process.exit(1); }
  if (!KEEP_SUBSETS.includes(subset)) { (dropped[family] = dropped[family] || new Set()).add(subset); continue; }
  blocks.push({ subset, family, style: prop('font-style'), weight: prop('font-weight'), range: prop('unicode-range'), url: src[1] });
}
const totalBlocks = (css.match(/@font-face/g) || []).length;
console.log('css2 blocks: ' + totalBlocks + ', kept: ' + blocks.length);
for (const [f, s] of Object.entries(dropped)) console.log('dropped subsets for ' + f + ': ' + [...s].join(', '));

// one local file per distinct remote URL
const byUrl = new Map();
for (const b of blocks) {
  if (!byUrl.has(b.url)) byUrl.set(b.url, { family: b.family, subset: b.subset, style: b.style, weights: [] });
  byUrl.get(b.url).weights.push(b.weight);
}
const manifest = [];
for (const [url, f] of byUrl) {
  const dir = dirOf(f.family);
  const name = dir + '-' + f.subset + '-' + f.style + '-' + f.weights.join('_') + '.woff2';
  const body = await get(url, false);
  if (body.subarray(0, 4).toString('latin1') !== 'wOF2') { console.error('not WOFF2: ' + url); process.exit(1); }
  await mkdir(path.join(OUT, dir), { recursive: true });
  await writeFile(path.join(OUT, dir, name), body);
  f.local = dir + '/' + name;
  manifest.push([f.family, f.local, body.length, sha(body), url]);
}

// licences: google/fonts at a pinned commit; SIL OFL 1.1 only
const families = [...new Set(blocks.map((b) => b.family))];
for (const family of families) {
  const dir = dirOf(family);
  const url = 'https://raw.githubusercontent.com/google/fonts/' + GF_COMMIT + '/ofl/' + dir + '/OFL.txt';
  const body = await get(url, false);
  const text = body.toString('utf8');
  if (!/SIL OPEN FONT LICENSE Version 1\.1/i.test(text)) { console.error('not OFL 1.1: ' + url); process.exit(1); }
  await writeFile(path.join(OUT, dir, 'OFL.txt'), body);
  const meta = await get('https://raw.githubusercontent.com/google/fonts/' + GF_COMMIT + '/ofl/' + dir + '/METADATA.pb', true);
  const lic = /license:\s*"([^"]+)"/.exec(meta);
  if (!lic || lic[1] !== 'OFL') { console.error('METADATA.pb licence is not OFL for ' + family); process.exit(1); }
  // the copyright header only — the licence body defines the term itself
  const rfn = (text.split(/PREAMBLE/)[0].match(/Reserved Font Names?[^\r\n]*/gi) || []).join(' | ');
  manifest.push([family, dir + '/OFL.txt', body.length, sha(body), url, 'METADATA.pb license: ' + lic[1] + (rfn ? '; ' + rfn : '; no Reserved Font Name')]);
}

const faces = blocks.map((b) =>
  '/* ' + b.subset + ' */\n@font-face {\n  font-family: \'' + b.family + '\';\n  font-style: ' + b.style + ';\n  font-weight: ' + b.weight +
  ';\n  font-display: swap;\n  src: url(' + byUrl.get(b.url).local + ') format(\'woff2\');\n  unicode-range: ' + b.range + ';\n}');
await writeFile(path.join(OUT, 'fonts.css'),
  '/* Beuk web fonts, self-hosted (tools/fonts/vendor-web-fonts.mjs; provenance,\n' +
  '   licences and sha256 in README.md beside this file). No request leaves\n' +
  '   this origin. URLs are relative to this stylesheet. */\n' + faces.join('\n') + '\n');
await writeFile(path.join(OUT, 'MANIFEST.tsv'),
  'family\tfile\tbytes\tsha256\tsource\tnote\n' + manifest.map((r) => r.join('\t')).join('\n') + '\n');
console.log('families: ' + families.length + ', font files: ' + byUrl.size + ', bytes: ' +
  manifest.filter((r) => r[1].endsWith('.woff2')).reduce((a, r) => a + r[2], 0));
