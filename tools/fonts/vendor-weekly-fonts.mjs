// Maintainer-only (never runs in a visitor's browser, never at app start):
// vendors Beuk Weekly's newspaper face — Old Standard TT, a 19th-century
// news roman for the masthead and the running text — the same legal way as
// the other families (tools/fonts/vendor-display-fonts.mjs), and writes
// fonts-weekly.css, which only the Weekly pages link:
//
//  1. Web: asks the Google Fonts CSS2 API — once, from the maintainer's
//     machine, desktop Chrome UA — for Old Standard TT 400, 700 and italic
//     400, keeping every subset it offers among latin, latin-ext, cyrillic,
//     cyrillic-ext, greek, greek-ext, vietnamese. Written under
//     client/assets/fonts/oldstandardtt/.
//  2. The Weekly's other two faces are already here (the studio ships them
//     for its themes): Oswald for the headlines and Playfair Display for the
//     decks. fonts-weekly.css repeats their @font-face blocks exactly as
//     fonts.css declares them, so the Weekly downloads only the files it
//     uses and never links the studio's whole stylesheet.
//  3. Licence: OFL.txt from the google/fonts repository at the commit the
//     rest of Beuk pins; refuses anything that is not SIL OFL 1.1 or whose
//     METADATA.pb does not say license: "OFL".
//  4. MANIFEST.tsv: this script's rows replace its own family's rows and
//     leave every other family's rows exactly as they are.
// Web only: the printed edition of an issue (when it exists) will need the
// static TrueType for the renderer, vendored the way the display faces are.
//
// Usage: node tools/fonts/vendor-weekly-fonts.mjs <repo root>
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: node vendor-weekly-fonts.mjs <repo root>'); process.exit(2); }
const OUT = path.join(root, 'client', 'assets', 'fonts');
const F = { family: 'Old Standard TT', query: 'Old+Standard+TT:ital,wght@0,400;0,700;1,400' };
const REUSED = ['Oswald', 'Playfair Display'];
const KEEP_SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'vietnamese'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GF_COMMIT = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const dir = F.family.toLowerCase().replace(/[^a-z0-9]/g, '');
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

await mkdir(path.join(OUT, dir), { recursive: true });
const cssUrl = 'https://fonts.googleapis.com/css2?family=' + F.query + '&display=swap';
const css = await get(cssUrl, true, UA);
const manifest = [];
const faces = [];
const byUrl = new Map();
const blockRe = /\/\* ([a-z0-9-]+) \*\/\s*@font-face \{([^}]*)\}/g;
for (let m; (m = blockRe.exec(css)); ) {
  if (!KEEP_SUBSETS.includes(m[1])) { console.log('dropped subset ' + m[1]); continue; }
  const body = m[2];
  const src = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\) format\('woff2'\)/.exec(body);
  if (!src || prop(body, 'font-family').replace(/^'|'$/g, '') !== F.family) { console.error('unexpected block'); process.exit(1); }
  const b = { subset: m[1], style: prop(body, 'font-style'), weight: prop(body, 'font-weight'), range: prop(body, 'unicode-range'), url: src[1] };
  faces.push(b);
  if (!byUrl.has(b.url)) byUrl.set(b.url, { subset: b.subset, style: b.style, weights: [] });
  byUrl.get(b.url).weights.push(b.weight);
}
if (!byUrl.size) { console.error('no web faces'); process.exit(1); }
for (const [url, f] of byUrl) {
  const name = dir + '-' + f.subset + '-' + f.style + '-' + f.weights.join('_') + '.woff2';
  const body = await get(url, false, UA);
  if (body.subarray(0, 4).toString('latin1') !== 'wOF2') { console.error('not WOFF2: ' + url); process.exit(1); }
  await writeFile(path.join(OUT, dir, name), body);
  f.local = dir + '/' + name;
  manifest.push([F.family, f.local, body.length, sha(body), url, 'web: Beuk Weekly, ' + f.subset + ' subset']);
}
for (const b of faces) b.local = byUrl.get(b.url).local;

const licUrl = 'https://raw.githubusercontent.com/google/fonts/' + GF_COMMIT + '/ofl/' + dir + '/OFL.txt';
const lic = await get(licUrl, false, null);
const text = lic.toString('utf8');
if (!/SIL OPEN FONT LICENSE Version 1\.1/i.test(text)) { console.error('not OFL 1.1: ' + licUrl); process.exit(1); }
await writeFile(path.join(OUT, dir, 'OFL.txt'), lic);
const meta = await get('https://raw.githubusercontent.com/google/fonts/' + GF_COMMIT + '/ofl/' + dir + '/METADATA.pb', true, null);
const ml = /license:\s*"([^"]+)"/.exec(meta);
if (!ml || ml[1] !== 'OFL') { console.error('METADATA.pb licence is not OFL'); process.exit(1); }
const rfn = (text.split(/PREAMBLE/)[0].match(/Reserved Font Names?[^\r\n]*/gi) || []).join(' | ');
manifest.push([F.family, dir + '/OFL.txt', lic.length, sha(lic), licUrl, 'METADATA.pb license: ' + ml[1] + (rfn ? '; ' + rfn : '; no Reserved Font Name')]);

// The reused faces: their @font-face blocks exactly as fonts.css has them.
const studioCss = (await readFile(path.join(OUT, 'fonts.css'), 'utf8')).replace(/\r\n/g, '\n');
const reused = [];
for (const m of studioCss.matchAll(/(\/\* [a-z0-9-]+ \*\/\n)?@font-face \{[^}]*\}/g)) {
  const fam = /font-family: '([^']+)'/.exec(m[0])?.[1];
  if (fam && REUSED.includes(fam)) reused.push(m[0]);
}
for (const fam of REUSED) if (!reused.some((b) => b.includes(`'${fam}'`))) { console.error('fonts.css has no ' + fam); process.exit(1); }

const face = (b) =>
  '/* ' + b.subset + ' */\n@font-face {\n  font-family: \'' + F.family + '\';\n  font-style: ' + b.style + ';\n  font-weight: ' + b.weight +
  ';\n  font-display: swap;\n  src: url(' + b.local + ') format(\'woff2\');\n  unicode-range: ' + b.range + ';\n}';
await writeFile(path.join(OUT, 'fonts-weekly.css'),
  '/* Beuk web fonts, self-hosted: Beuk Weekly\'s newspaper faces — Old Standard TT\n' +
  '   (masthead and text), Oswald (headlines) and Playfair Display (decks) —\n' +
  '   linked by the Weekly pages only (tools/fonts/vendor-weekly-fonts.mjs;\n' +
  '   provenance, licences and sha256 in README.md beside this file). No\n' +
  '   request leaves this origin. URLs are relative to this stylesheet. */\n' +
  faces.map(face).join('\n') + '\n' + reused.join('\n') + '\n');

const old = (await readFile(path.join(OUT, 'MANIFEST.tsv'), 'utf8')).trim().split('\n');
const kept = old.slice(1).filter((l) => l.split('\t')[0] !== F.family);
await writeFile(path.join(OUT, 'MANIFEST.tsv'), old[0] + '\n' + kept.concat(manifest.map((r) => r.join('\t'))).join('\n') + '\n');

const web = manifest.filter((r) => r[1].endsWith('.woff2'));
console.log(F.family + ': ' + web.length + ' web files (' + web.reduce((a, r) => a + r[2], 0) + ' bytes); reused ' + reused.length + ' blocks; ' + manifest[manifest.length - 1][5]);
