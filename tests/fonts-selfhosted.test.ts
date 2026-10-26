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

test('fonts.css + fonts-help.css reference only files that exist, and every shipped font file is referenced', () => {
  const studioCss = readFileSync(path.join(FONTS, 'fonts.css'), 'utf8');
  const helpCss = readFileSync(path.join(FONTS, 'fonts-help.css'), 'utf8');
  // fonts-help.css holds exactly Literata 700 + italic 500 (help/warmth asked
  // for them, the studio never did — its preview must match the print faces)
  const faceKeys = (c: string) => [...c.matchAll(/font-family: '([^']+)';\s*font-style: (\w+);\s*font-weight: (\d+);/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);
  assert.deepEqual([...new Set(faceKeys(helpCss))].sort(), ['Literata italic 500', 'Literata normal 700']);
  assert.ok(!faceKeys(studioCss).includes('Literata normal 700') && !faceKeys(studioCss).includes('Literata italic 500'));
  const css = studioCss + helpCss;
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
  assert.equal(dirs.length, 22);
  for (const d of dirs) {
    const lic = path.join(FONTS, d, 'OFL.txt');
    assert.ok(existsSync(lic), `${d}/OFL.txt`);
    assert.match(readFileSync(lic, 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/i, `${d} is OFL 1.1`);
  }
});

test('every shipped file matches the sha256 recorded in MANIFEST.tsv (and the README)', () => {
  const rows = readFileSync(path.join(FONTS, 'MANIFEST.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const readme = readFileSync(path.join(FONTS, 'README.md'), 'utf8');
  const onDisk = walk(FONTS).map(rel).filter((f) => /\.woff2$|OFL\.txt$/.test(f)).map((f) => f.replace('client/assets/fonts/', ''));
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
