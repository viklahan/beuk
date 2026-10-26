// Writes client/assets/fonts/README.md from MANIFEST.tsv (written by
// vendor-web-fonts.mjs). Every number in it comes from the manifest.
// Usage: node tools/fonts/write-fonts-readme.mjs <repo root>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.join(process.argv[2] || '.', 'client', 'assets', 'fonts');
const rows = (await readFile(path.join(dir, 'MANIFEST.tsv'), 'utf8')).trim().split('\n').slice(1).map((l) => l.split('\t'));
const fonts = rows.filter((r) => r[1].endsWith('.woff2'));
const lic = rows.filter((r) => r[1].endsWith('OFL.txt'));
const ttfs = rows.filter((r) => r[1].endsWith('.ttf'));
const ttfTotal = ttfs.reduce((a, r) => a + Number(r[2]), 0);
const families = [...new Set(fonts.map((r) => r[0]))].sort();
const total = fonts.reduce((a, r) => a + Number(r[2]), 0);
const kib = (n) => (n / 1024).toFixed(1) + ' KiB';
const css = await readFile(path.join(dir, 'fonts.css'));
const helpCss = await readFile(path.join(dir, 'fonts-help.css'));
const scriptCss = await readFile(path.join(dir, 'fonts-scripts.css'));
const displayCss = await readFile(path.join(dir, 'fonts-display.css'));
const displayFamilies = [...new Set([...displayCss.toString('utf8').matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]))].sort();
const scriptFamilies = [...new Set(ttfs.map((r) => r[0]))].filter((f) => !displayFamilies.includes(f)).sort();
const scriptTtfs = ttfs.filter((r) => scriptFamilies.includes(r[0]));
const scriptTtfTotal = scriptTtfs.reduce((a, r) => a + Number(r[2]), 0);
const displayRows = fonts.filter((r) => displayFamilies.includes(r[0]));
const displayTtfs = ttfs.filter((r) => displayFamilies.includes(r[0]));
const displayWeb = displayRows.reduce((a, r) => a + Number(r[2]), 0);
const displayTtfTotal = displayTtfs.reduce((a, r) => a + Number(r[2]), 0);

let md = `# Beuk web fonts (self-hosted)

Every web font the studio, help, support, thanks and warmth pages use is
served from this directory, from Beuk's own origin. No page asks
fonts.googleapis.com or fonts.gstatic.com for anything, and the
Content-Security-Policy (Caddyfile) no longer allows either host.

- **What:** ${families.length} families, ${fonts.length} WOFF2 files, ${total} bytes (${kib(total)}) in total;
  \`fonts.css\` (${css.length} bytes) is linked by every page; \`fonts-help.css\`
  (${helpCss.length} bytes) adds Literata 700 and italic 500, which only the help and
  warmth pages ever asked for — the studio keeps exactly its old Literata faces
  (400–600, italic 400), the same ones the print renderer installs, so the
  preview still matches the PDF. \`fonts-scripts.css\` (${scriptCss.length} bytes), linked by
  the studio only, adds the book's script faces (${scriptFamilies.join(', ')}; see
  *Script faces* below), and \`fonts-display.css\` (${displayCss.length} bytes), also
  studio only, adds the heading-only display faces (${displayFamilies.join(', ')};
  see *Display faces* below). A page downloads only the files whose family,
  weight, style and \`unicode-range\` it actually uses.
- **Source:** the WOFF2 files are the bytes the Google Fonts CSS2 API serves
  (fonts.gstatic.com) for exactly the families, axes, weights and styles the
  pages requested before; fetched once by a maintainer with
  \`node tools/fonts/vendor-web-fonts.mjs .\` (desktop Chrome user agent). The
  font files are not modified. The two stylesheets hold the same \`@font-face\`
  blocks that API returned, with \`url()\` pointing at the local file.
- **Subsets:** every subset the API returned — latin, latin-ext, cyrillic,
  cyrillic-ext, greek, greek-ext, vietnamese (only those each family offers),
  plus Lora's \`math\` and \`symbols\` (Lora has no \`greek\` subset; its basic
  Greek letters live in \`math\`). The studio page declares exactly the same
  @font-face set (family, style, weight, unicode-range) it got from Google
  before. Arabic-script and Devanagari text is set in the script faces below;
  Hebrew, Japanese, Chinese and the other scripts no family here covers use
  system fonts, as before.
- **Licence:** every family is SIL Open Font License 1.1. Each family's
  \`OFL.txt\` sits beside its fonts; it is the file from the google/fonts
  repository at commit \`e7db6ca603fd4862010383ff17ffd6cc4ffac1c0\` (the same
  commit deploy/renderer/fonts.lock pins), and that family's \`METADATA.pb\`
  at the same commit says \`license: "OFL"\`.
- **Machine-readable:** \`MANIFEST.tsv\` (family, file, bytes, sha256, source URL).
  Regenerate this README with \`node tools/fonts/write-fonts-readme.mjs .\`.

## Script faces (Arabic, Devanagari)

Vendored by \`node tools/fonts/vendor-script-fonts.mjs .\` the same way, from the
same sources, on 2026-10-26. A book's Latin text stays in the Latin face the
writer chose; the font stacks name these faces right after it, so Arabic-script
and Devanagari characters — a whole Hindi or Arabic book, or one passage in a
Latin book — are set in them, with no choice to make.

- **Web (live preview):** only each family's own script subset (Amiri:
  \`arabic\`; Noto Serif Devanagari: \`devanagari\`), declared in
  \`fonts-scripts.css\` with the \`unicode-range\` Google returned, so a book
  with no such text never downloads them.
- **EPUB:** ${scriptTtfs.length} static TrueType files (${scriptTtfTotal} bytes, ${kib(scriptTtfTotal)}) —
  each family's regular and bold — kept here so the studio can embed them in
  an EPUB whose book needs them (TrueType, \`font/ttf\`: an EPUB 3 core media
  type, and the format Beuk's uploaded fonts already ship in). They are the
  same bytes, same sha256, as the print renderer installs
  (deploy/renderer/fonts.lock), which also installs the other weights and
  styles (Amiri italic 400/700, Noto Serif Devanagari 500/600).
- **Emphasis:** Amiri has a true slanted style (italic 400 and 700). Devanagari
  has no italic tradition and Noto Serif Devanagari has none: italic Hindi
  text is slanted by the browser or reader; bold is a real bold.
- **Licence:** SIL OFL 1.1, no Reserved Font Name (OFL.txt beside the files;
  METADATA.pb at the pinned commit says \`license: "OFL"\`). An EPUB carries
  each embedded family's OFL.txt as a comment in its stylesheet.

## Display faces (headings only)

Vendored by \`node tools/fonts/vendor-display-fonts.mjs .\` the same way, from the
same sources, on 2026-10-26: ${displayFamilies.join(', ')}. The studio offers them as
heading fonts only — chapter titles and numbers, part and title pages, drop
caps — never as body text: a script or poster face is not built for running
text, so no body-font picker lists them and a book document that names one as
its body face is read back with the default body face.

- **Weights:** each family has one weight (400) and no italic; the studio
  sets every heading in them at 400, so no browser or reader fakes a bold.
- **Web (live preview):** ${displayRows.length} WOFF2 files (${displayWeb} bytes, ${kib(displayWeb)}) in
  \`fonts-display.css\`, the subsets each family offers (latin, latin-ext, and
  vietnamese where it has one), by \`unicode-range\`.
- **Print and EPUB:** ${displayTtfs.length} static TrueType files (${displayTtfTotal} bytes, ${kib(displayTtfTotal)}),
  one per family, the same bytes and sha256 the print renderer installs
  (deploy/renderer/fonts.lock). An EPUB whose headings are set in a display
  face embeds that face's file and carries its OFL.txt as a comment in the
  stylesheet; no reading system has these faces of its own.
- **Licence:** SIL OFL 1.1 (OFL.txt beside the files; METADATA.pb at the
  pinned commit says \`license: "OFL"\`). Abril Fatface carries the Reserved
  Font Names "Abril" and "Abril Fatface": Beuk ships and embeds the files
  unmodified and unsubset, which the licence allows under those names.

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
for (const r of fonts.concat(ttfs)) md += `| \`${r[1]}\` | ${r[2]} | \`${r[3]}\` | ${r[4]} |\n`;
await writeFile(path.join(dir, 'README.md'), md);
console.log('README.md: ' + families.length + ' families, ' + fonts.length + ' files, ' + total + ' bytes');
