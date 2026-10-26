// BEUK:fonts — every web font is self-hosted under client/assets/fonts/;
// no page, worker, server template or CSP may name Google's font hosts
// again (V, 2026-10-26; LG München I, 20.01.2022, 3 O 17493/20).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestDb, startTestServer } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = path.join(ROOT, 'client', 'assets', 'fonts');
const GOOGLE = /fonts\.googleapis\.com|fonts\.gstatic\.com/;
// Provenance records only (never loaded by a page): they cite where each
// vendored file came from.
const ALLOW = new Set(['client/assets/fonts/README.md', 'client/assets/fonts/MANIFEST.tsv']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

test('no file in client/, src/ or the Caddyfile names a Google font host', () => {
  const files = [...walk(path.join(ROOT, 'client')), ...walk(path.join(ROOT, 'src')), path.join(ROOT, 'Caddyfile')];
  assert.ok(files.length > 50, 'the walk found the tree');
  const hits = files.filter((f) => !ALLOW.has(rel(f)) && GOOGLE.test(readFileSync(f, 'latin1'))).map(rel);
  assert.deepEqual(hits, []);
});

test('the Caddyfile CSP: style-src and font-src are own-origin only, no Google host anywhere', () => {
  const caddy = readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8');
  const m = /header \?Content-Security-Policy "([^"]+)"/.exec(caddy);
  assert.ok(m, 'the CSP header line is there');
  const dirs = Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dirs['style-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(dirs['font-src'], ["'self'", 'data:']);
  assert.doesNotMatch(m[1], /google/i);
});

test('fonts.css + fonts-help.css + fonts-scripts.css + fonts-display.css reference only files that exist, and every shipped font file is referenced', () => {
  const studioCss = readFileSync(path.join(FONTS, 'fonts.css'), 'utf8');
  const helpCss = readFileSync(path.join(FONTS, 'fonts-help.css'), 'utf8');
  // fonts-help.css holds exactly Literata 700 + italic 500 (help/warmth asked
  // for them, the studio never did — its preview must match the print faces)
  const faceKeys = (c: string) => [...c.matchAll(/font-family: '([^']+)';\s*font-style: (\w+);\s*font-weight: (\d+);/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  assert.deepEqual([...new Set(faceKeys(helpCss))].sort(), ['Literata italic 500', 'Literata normal 700']);
  assert.ok(!faceKeys(studioCss).includes('Literata normal 700') && !faceKeys(studioCss).includes('Literata italic 500'));
  // fonts-scripts.css: the book's script faces (Amiri, Noto Serif Devanagari), studio only
  // fonts-display.css: the heading-only display faces (Pinyon Script, Patrick Hand, Abril Fatface), studio only
  const css = studioCss + helpCss + readFileSync(path.join(FONTS, 'fonts-scripts.css'), 'utf8') + readFileSync(path.join(FONTS, 'fonts-display.css'), 'utf8');
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((x) => x[1]);
  assert.ok(urls.length > 0);
  for (const u of urls) {
    assert.match(u, /^[a-z0-9]+\/[a-z0-9_-]+\.woff2$/, `relative, local: ${u}`);
    const f = path.join(FONTS, u);
    assert.ok(existsSync(f), `missing ${u}`);
    assert.equal(readFileSync(f).subarray(0, 4).toString('latin1'), 'wOF2', `${u} is WOFF2`);
  }
  const shipped = walk(FONTS).filter((f) => f.endsWith('.woff2')).map((f) => rel(f).replace('client/assets/fonts/', ''));
  assert.deepEqual([...new Set(urls)].sort(), shipped.sort());
  // every face swaps, and every face is subset by unicode-range
  const faces = css.split('@font-face').length - 1;
  assert.equal((css.match(/font-display: swap;/g) || []).length, faces);
  assert.equal((css.match(/unicode-range: /g) || []).length, faces);
});

test('every font family directory carries its SIL OFL 1.1 licence', () => {
  const dirs = readdirSync(FONTS).filter((d) => statSync(path.join(FONTS, d)).isDirectory());
  assert.equal(dirs.length, 27); // 22 Latin/Greek/Cyrillic families + 2 script faces + 3 display faces
  for (const d of dirs) {
    const lic = path.join(FONTS, d, 'OFL.txt');
    assert.ok(existsSync(lic), `${d}/OFL.txt`);
    assert.match(readFileSync(lic, 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/i, `${d} is OFL 1.1`);
  }
});

test('every shipped file matches the sha256 recorded in MANIFEST.tsv (and the README)', () => {
  const rows = readFileSync(path.join(FONTS, 'MANIFEST.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const readme = readFileSync(path.join(FONTS, 'README.md'), 'utf8');
  const onDisk = walk(FONTS).map(rel).filter((f) => /\.woff2$|\.ttf$|OFL\.txt$/.test(f)).map((f) => f.replace('client/assets/fonts/', ''));
  assert.deepEqual(rows.map((r) => r[1]).sort(), onDisk.sort());
  for (const [, file, bytes, sha] of rows) {
    const body = readFileSync(path.join(FONTS, file));
    assert.equal(body.length, Number(bytes), `${file} size`);
    assert.equal(createHash('sha256').update(body).digest('hex'), sha, `${file} sha256`);
    assert.ok(readme.includes(sha), `README lists ${file}`);
  }
});

test('the studio, thanks and support pages link the self-hosted stylesheet; preloads exist', () => {
  const pages: Array<[string, string]> = [
    ['client/index.html', 'assets/fonts/'],
    ['client/thanks/index.html', '/assets/fonts/'],
    ['client/support/index.html', '/assets/fonts/'],
  ];
  for (const [p, prefix] of pages) {
    const html = readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(html.includes(`<link rel="stylesheet" href="${prefix}fonts.css" />`), `${p} links fonts.css`);
    assert.equal(html.includes('fonts-help.css'), p !== 'client/index.html', `${p}: fonts-help.css on help/warmth pages only`);
    for (const m of html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin \/>/g)) {
      assert.ok(m[1].startsWith(prefix), `${p}: ${m[1]}`);
      assert.ok(existsSync(path.join(ROOT, 'client', m[1].replace(/^\//, ''))), `${p} preloads a real file: ${m[1]}`);
    }
  }
});

test('server-rendered help, warmth, thanks and support pages carry the self-hosted fonts only', async () => {
  const db = await createTestDb();
  // KOFI_URL set: /support is served only when a tip jar is configured.
  const server = await startTestServer(db, undefined, { kofiUrl: 'https://ko-fi.com/fontscheck' });
  try {
    for (const page of ['/help/', '/help/typeset-a-chapter.html', '/help/errors/', '/help/search?q=epub', '/roadmap', '/changelog', '/thanks', '/support']) {
      const res = await fetch(`${server.base}${page}`);
      const html = await res.text();
      assert.equal(res.status, 200, page);
      assert.doesNotMatch(html, GOOGLE, `${page} names no Google font host`);
      assert.ok(html.includes('<link rel="stylesheet" href="/assets/fonts/fonts.css" />'), `${page} links fonts.css`);
      assert.ok(html.includes('<link rel="stylesheet" href="/assets/fonts/fonts-help.css" />'), `${page} links fonts-help.css`);
      const pre = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)].map((m) => m[1]);
      assert.ok(pre.length >= 1 && pre.length <= 3, `${page}: 1–3 preloads (${pre.length})`);
      for (const u of pre) assert.ok(existsSync(path.join(ROOT, 'client', u.replace(/^\//, ''))), `${page} preloads a real file: ${u}`);
    }
  } finally {
    await server.close();
  }
});

// BEUK:displayfaces — three heading-only display faces, vendored the same
// way (tools/fonts/vendor-display-fonts.mjs): WOFF2 for the preview, one
// static TrueType per family for the print renderer and the EPUB, OFL.txt.
const DISPLAY = [
  { family: 'Pinyon Script', dir: 'pinyonscript', ttf: 'Pinyon_Script-normal-400.ttf', rfn: null },
  { family: 'Patrick Hand', dir: 'patrickhand', ttf: 'Patrick_Hand-normal-400.ttf', rfn: null },
  { family: 'Abril Fatface', dir: 'abrilfatface', ttf: 'Abril_Fatface-normal-400.ttf', rfn: 'Reserved Font Names "Abril" and "Abril Fatface"' },
];
const GF_COMMIT = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const manifestRows = () =>
  readFileSync(path.join(FONTS, 'MANIFEST.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const lockLines = () =>
  readFileSync(path.join(ROOT, 'deploy', 'renderer', 'fonts.lock'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = /^([0-9a-f]{64}) {2}([a-z0-9]+\/[A-Za-z0-9_.-]+) {2}(\S+)$/.exec(l);
      assert.ok(m, `fonts.lock line reads: ${l}`);
      return { sha256: m[1], dest: m[2], url: m[3] };
    });

test('display faces: SIL OFL 1.1 from google/fonts at the pinned commit, Reserved Font Names recorded, one weight (400), files on disk with their MANIFEST sha256', () => {
  const rows = manifestRows();
  for (const D of DISPLAY) {
    const lic = readFileSync(path.join(FONTS, D.dir, 'OFL.txt'), 'utf8');
    assert.match(lic, /SIL OPEN FONT LICENSE Version 1\.1/i, `${D.family} is OFL 1.1`);
    const head = lic.split(/PREAMBLE/)[0];
    if (D.rfn) assert.ok(head.includes(D.rfn), `${D.family}: ${D.rfn}`);
    else assert.doesNotMatch(head, /Reserved Font Name/i, `${D.family}: no Reserved Font Name`);
    const mine = rows.filter((r) => r[0] === D.family);
    const licRow = mine.find((r) => r[1] === `${D.dir}/OFL.txt`);
    assert.ok(licRow, `${D.family}: OFL.txt row`);
    assert.equal(licRow![4], `https://raw.githubusercontent.com/google/fonts/${GF_COMMIT}/ofl/${D.dir}/OFL.txt`);
    assert.equal(licRow![5], 'METADATA.pb license: OFL; ' + (D.rfn ?? 'no Reserved Font Name'));
    const web = mine.filter((r) => r[1].endsWith('.woff2'));
    assert.ok(web.length >= 2, `${D.family}: latin + latin-ext at least`);
    for (const r of web) {
      assert.match(r[1], new RegExp(`^${D.dir}/${D.dir}-[a-z-]+-normal-400\\.woff2$`), `${r[1]}: normal 400 only`);
      assert.match(r[4], new RegExp(`^https://fonts\\.gstatic\\.com/s/${D.dir}/v\\d+/`), `${r[1]} source`);
    }
    const ttfRows = mine.filter((r) => r[1].endsWith('.ttf'));
    assert.deepEqual(ttfRows.map((r) => r[1]), [`${D.dir}/${D.ttf}`], `${D.family}: one static TrueType`);
    for (const r of mine) {
      const body = readFileSync(path.join(FONTS, r[1]));
      assert.equal(body.length, Number(r[2]), `${r[1]} size`);
      assert.equal(sha(body), r[3], `${r[1]} sha256`);
    }
    const ttf = readFileSync(path.join(FONTS, D.dir, D.ttf));
    assert.equal(ttf.subarray(0, 4).toString('hex'), '00010000', `${D.ttf} is TrueType`);
    const utf16 = (x: string) => Buffer.from(x, 'utf16le').swap16();
    assert.ok(ttf.includes(utf16(D.family)), `${D.ttf} names the family ${D.family}`);
  }
});

test('display faces: fonts-display.css declares only normal 400, local files, swap and unicode-range; the renderer lock pins the same TrueType bytes and each OFL.txt', () => {
  const css = readFileSync(path.join(FONTS, 'fonts-display.css'), 'utf8');
  assert.doesNotMatch(css, GOOGLE);
  const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face \{([^}]*)\}/g)];
  assert.equal(blocks.length, (css.match(/@font-face/g) || []).length, 'every face is labelled with its subset');
  assert.deepEqual([...new Set(blocks.map((b) => /font-family: '([^']+)'/.exec(b[2])![1]))].sort(), DISPLAY.map((D) => D.family).sort());
  for (const b of blocks) {
    assert.match(b[2], /font-style: normal;\s*font-weight: 400;\s*font-display: swap;/);
    assert.match(b[2], /unicode-range: /);
  }
  const lines = lockLines();
  const rows = manifestRows();
  for (const D of DISPLAY) {
    const mine = lines.filter((l) => l.dest.startsWith(`${D.dir}/`));
    assert.deepEqual(mine.map((l) => l.dest).sort(), [`${D.dir}/${D.ttf}`, `${D.dir}/OFL.txt`].sort(), `${D.family} lock lines`);
    for (const l of mine) {
      const row = rows.find((r) => r[1] === l.dest)!;
      assert.ok(row, `${l.dest} in MANIFEST.tsv`);
      assert.equal(l.sha256, row[3], `${l.dest}: the renderer and the studio pin the same bytes`);
      assert.equal(l.url, row[4], `${l.dest}: same source`);
    }
  }
  const readme = readFileSync(path.join(FONTS, 'README.md'), 'utf8');
  assert.ok(readme.includes('## Display faces (headings only)'));
  assert.ok(readme.includes('`fonts-display.css`'));
});

test('the studio links fonts-display.css, offers the display faces as headings only, and pins the EPUB TrueType sha256 it checks', () => {
  const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  assert.ok(html.includes('<link rel="stylesheet" href="assets/fonts/fonts-display.css" />'));
  const body = /const BODY_FONTS = \[([^\]]*)\];/.exec(html)![1];
  const rows = manifestRows();
  for (const D of DISPLAY) {
    assert.ok(!body.includes(`"${D.family}"`), `${D.family} is not a body face`);
    const row = rows.find((r) => r[1] === `${D.dir}/${D.ttf}`)!;
    assert.ok(html.includes(`{ family: "${D.family}", dir: "${D.dir}", file: "${D.ttf}", sha256: "${row[3]}"`), `${D.family}: DISPLAY_FONTS pins ${row[3]}`);
  }
  assert.ok(html.includes('HEAD_FONTS.push.apply(HEAD_FONTS, DISPLAY_FAMILIES);'));
  assert.ok(html.includes('const bodyFaceOf = (fam) => (displayFontOf(fam) ? PRESETS[0].theme.bodyFont : fam);'));
  assert.ok(html.includes('const bodyFf = fontStack(bodyFaceOf(t.bodyFont)), headFf = fontStack(t.headFont);'));
  assert.ok(html.includes('state.theme.bodyFont = bodyFaceOf(state.theme.bodyFont);'));
  assert.ok(html.includes('.concat(displayFontsFor()); /* BEUK:displayfaces */'));
});

test('the cover maker keeps the heading list from before the display faces joined it', () => {
  const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  // the copy is taken before the push, and the cover list is built from the copy
  const iCopy = html.indexOf('const TEXT_HEAD_FONTS = HEAD_FONTS.slice();');
  const iPush = html.indexOf('HEAD_FONTS.push.apply(HEAD_FONTS, DISPLAY_FAMILIES);');
  assert.ok(iCopy !== -1 && iPush > iCopy, 'TEXT_HEAD_FONTS is copied before the display faces are pushed');
  assert.ok(html.includes('const COVER_FONTS = TEXT_HEAD_FONTS.concat(BODY_FONTS.filter((f) => !TEXT_HEAD_FONTS.includes(f)));'));
  // a new cover, or a cover whose uploaded face is removed, never falls back to a display face
  assert.ok(html.includes('const hf = (!displayFontOf(state.theme.headFont) && state.theme.headFont) || "Libre Baskerville";'));
  assert.ok(html.includes('if (e && e.font === family) e.font = displayFontOf(state.theme.headFont) ? "Libre Baskerville" : state.theme.headFont; });'));
  assert.ok(html.includes('if (COVER_FONTS.indexOf(d.family) !== -1) bad.push(d.family + " is offered on covers (unchecked there)");'));
});
