// Maintainer-only (never runs in a visitor's browser, never at app start):
// vendors the book's SCRIPT faces — the typefaces Beuk sets Devanagari
// (Hindi) and Arabic-script text in — the same legal way as the Latin
// families (tools/fonts/vendor-web-fonts.mjs), and records them in the
// same places:
//
//  1. Web (live preview): asks the Google Fonts CSS2 API — once, from the
//     maintainer's machine, desktop Chrome UA — for exactly the families,
//     weights and styles below and keeps ONLY each family's own script
//     subset (Amiri: arabic; Noto Serif Devanagari: devanagari). The Latin
//     text of a book stays with the book's chosen Latin face; these faces
//     only ever draw their script (unicode-range). Written under
//     client/assets/fonts/<dir>/ and declared in fonts-scripts.css.
//  2. Print renderer: the static TrueType instances the same API serves a
//     plain client for the same request (STATIC on purpose — Chromium
//     embeds variable fonts in a PDF as Type 3; see deploy/renderer/
//     fonts.lock), pinned by sha256 in deploy/renderer/fonts.lock, with
//     each family's OFL.txt.
//  3. EPUB embedding: the regular (400) and bold (700) upright TrueType
//     files are also kept under client/assets/fonts/<dir>/ — the same
//     bytes as the renderer's, same sha256 — so the studio can put them
//     into an EPUB (TrueType, font/ttf: an EPUB 3 core media type and the
//     format Beuk's uploaded fonts already ship in).
//  4. Licences: OFL.txt from the google/fonts repository at the commit
//     the rest of Beuk pins; refuses anything that is not SIL OFL 1.1 or
//     whose METADATA.pb does not say license: "OFL".
//  5. MANIFEST.tsv: this script's rows replace its own families' rows and
//     leave every other family's rows exactly as they are.
// The fonts are not modified: the files are the bytes Google Fonts serves.
//
// Usage: node tools/fonts/vendor-script-fonts.mjs <repo root>
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: node vendor-script-fonts.mjs <repo root>'); process.exit(2); }
const OUT = path.join(root, 'client', 'assets', 'fonts');
const LOCK = path.join(root, 'deploy', 'renderer', 'fonts.lock');

const FAMILIES = [
  // Arabic script (Arabic, Persian, Urdu text): Amiri, a Naskh book face
  // revived from the Bulaq Press type — upright and slanted, 400 and 700.
  { family: 'Amiri', query: 'Amiri:ital,wght@0,400;0,700;1,400;1,700', subset: 'arabic' },
  // Devanagari (Hindi): Noto Serif Devanagari — a contrasted book serif
  // with real weights for headings and bold; Devanagari has no italic.
  { family: 'Noto Serif Devanagari', query: 'Noto+Serif+Devanagari:wght@400;500;600;700', subset: 'devanagari' }
];
const EPUB_FACES = (b) => b.style === 'normal' && (b.weight === '400' || b.weight === '700');
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

  // 1. WOFF2, script subset only
  const css = await get(cssUrl, true, UA);
  const byUrl = new Map();
  const blockRe = /\/\* ([a-z0-9-]+) \*\/\s*@font-face \{([^}]*)\}/g;
  for (let m; (m = blockRe.exec(css)); ) {
    if (m[1] !== F.subset) { console.log('dropped subset ' + m[1] + ' of ' + F.family); continue; }
    const body = m[2];
    const src = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\) format\('woff2'\)/.exec(body);
    if (!src || prop(body, 'font-family').replace(/^'|'$/g, '') !== F.family) { console.error('unexpected block for ' + F.family); process.exit(1); }
    const b = { family: F.family, subset: m[1], style: prop(body, 'font-style'), weight: prop(body, 'font-weight'), range: prop(body, 'unicode-range'), url: src[1] };
    faces.push(b);
    if (!byUrl.has(b.url)) byUrl.set(b.url, { style: b.style, weights: [] });
    byUrl.get(b.url).weights.push(b.weight);
  }
  if (!byUrl.size) { console.error('no ' + F.subset + ' subset for ' + F.family); process.exit(1); }
  for (const [url, f] of byUrl) {
    const name = dir + '-' + F.subset + '-' + f.style + '-' + f.weights.join('_') + '.woff2';
    const body = await get(url, false, UA);
    if (body.subarray(0, 4).toString('latin1') !== 'wOF2') { console.error('not WOFF2: ' + url); process.exit(1); }
    await writeFile(path.join(OUT, dir, name), body);
    f.local = dir + '/' + name;
    manifest.push([F.family, f.local, body.length, sha(body), url, 'web: ' + F.subset + ' subset']);
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
    if (EPUB_FACES(b)) {
      await writeFile(path.join(OUT, dir, name), ttf);
      manifest.push([F.family, dir + '/' + name, ttf.length, sha(ttf), src[1], 'EPUB embedding + renderer: static TrueType ' + b.style + ' ' + b.weight]);
    }
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

// fonts-scripts.css — linked by the studio only
const face = (b) =>
  '/* ' + b.subset + ' */\n@font-face {\n  font-family: \'' + b.family + '\';\n  font-style: ' + b.style + ';\n  font-weight: ' + b.weight +
  ';\n  font-display: swap;\n  src: url(' + b.local + ') format(\'woff2\');\n  unicode-range: ' + b.range + ';\n}';
await writeFile(path.join(OUT, 'fonts-scripts.css'),
  '/* Beuk web fonts, self-hosted: the book\'s script faces — Amiri (Arabic\n' +
  '   script) and Noto Serif Devanagari (Hindi) — linked by the studio.\n' +
  '   Only each family\'s own script subset: a book\'s Latin text stays with\n' +
  '   its chosen Latin face, these draw only their script\n' +
  '   (tools/fonts/vendor-script-fonts.mjs; provenance, licences and sha256\n' +
  '   in README.md beside this file). No request leaves this origin. URLs\n' +
  '   are relative to this stylesheet. */\n' + faces.map(face).join('\n') + '\n');

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

console.log('script families: ' + FAMILIES.length + ', web files: ' + manifest.filter((r) => r[1].endsWith('.woff2')).length +
  ' (' + manifest.filter((r) => r[1].endsWith('.woff2')).reduce((a, r) => a + r[2], 0) + ' bytes), EPUB TrueType: ' +
  manifest.filter((r) => r[1].endsWith('.ttf')).length + ' (' + manifest.filter((r) => r[1].endsWith('.ttf')).reduce((a, r) => a + r[2], 0) +
  ' bytes), renderer lock lines: ' + lock.length);
