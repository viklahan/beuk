// Writes client/assets/fonts/README.md from MANIFEST.tsv (written by
// vendor-web-fonts.mjs). Every number in it comes from the manifest.
// Usage: node tools/fonts/write-fonts-readme.mjs <repo root>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join(process.argv[2] || '.', 'client', 'assets', 'fonts');
const rows = (await readFile(path.join(dir, 'MANIFEST.tsv'), 'utf8')).trim().split('\n').slice(1).map((l) => l.split('\t'));
const fonts = rows.filter((r) => r[1].endsWith('.woff2'));
const lic = rows.filter((r) => r[1].endsWith('OFL.txt'));
const families = [...new Set(fonts.map((r) => r[0]))].sort();
const total = fonts.reduce((a, r) => a + Number(r[2]), 0);
const kib = (n) => (n / 1024).toFixed(1) + ' KiB';
const css = await readFile(path.join(dir, 'fonts.css'));

let md = `# Beuk web fonts (self-hosted)

Every web font the studio, help, support, thanks and warmth pages use is
served from this directory, from Beuk's own origin. No page asks
fonts.googleapis.com or fonts.gstatic.com for anything, and the
Content-Security-Policy (Caddyfile) no longer allows either host.

- **What:** ${families.length} families, ${fonts.length} WOFF2 files, ${total} bytes (${kib(total)}) in total;
  \`fonts.css\` is ${css.length} bytes. A page downloads only the files whose
  family, weight, style and \`unicode-range\` it actually uses.
- **Source:** the WOFF2 files are the bytes the Google Fonts CSS2 API serves
  (fonts.gstatic.com) for exactly the families, axes, weights and styles the
  pages requested before; fetched once by a maintainer with
  \`node tools/fonts/vendor-web-fonts.mjs .\` (desktop Chrome user agent). The
  font files are not modified. \`fonts.css\` holds the same \`@font-face\` blocks
  that API returned, with \`url()\` pointing at the local file.
- **Subsets kept:** latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext,
  vietnamese (only those each family offers). Dropped: Lora's \`math\` and
  \`symbols\` subsets. Arabic, Japanese and Chinese text uses system fonts, as
  before (no family here covers those scripts).
- **Licence:** every family is SIL Open Font License 1.1. Each family's
  \`OFL.txt\` sits beside its fonts; it is the file from the google/fonts
  repository at commit \`e7db6ca603fd4862010383ff17ffd6cc4ffac1c0\` (the same
  commit deploy/renderer/fonts.lock pins), and that family's \`METADATA.pb\`
  at the same commit says \`license: "OFL"\`.
- **Machine-readable:** \`MANIFEST.tsv\` (family, file, bytes, sha256, source URL).
  Regenerate this README with \`node tools/fonts/write-fonts-readme.mjs .\`.

## Families

| Family | Directory | Google Fonts version | Files | Bytes | Licence | Reserved Font Name (from OFL.txt) | Licence source |
|---|---|---|---|---|---|---|---|
`;
for (const f of families) {
  const fs = fonts.filter((r) => r[0] === f);
  const l = lic.find((r) => r[0] === f);
  const ver = [...new Set(fs.map((r) => (/\/s\/[a-z0-9]+\/(v\d+)\//.exec(r[4]) || [])[1]))].join(', ');
  const rfn = /no Reserved Font Name/.test(l[5]) ? 'none' : l[5].replace(/^METADATA\.pb license: OFL; /, '');
  md += `| ${f} | \`${path.dirname(fs[0][1])}/\` | ${ver} | ${fs.length} | ${fs.reduce((a, r) => a + Number(r[2]), 0)} | OFL 1.1 | ${rfn.replace(/\|/g, '/')} | [OFL.txt](${l[4]}) (sha256 \`${l[3]}\`) |\n`;
}
md += `
## Files (sha256)

| File | Bytes | sha256 | Source |
|---|---|---|---|
`;
for (const r of fonts) md += `| \`${r[1]}\` | ${r[2]} | \`${r[3]}\` | ${r[4]} |\n`;
await writeFile(path.join(dir, 'README.md'), md);
console.log('README.md: ' + families.length + ' families, ' + fonts.length + ' files, ' + total + ' bytes');
