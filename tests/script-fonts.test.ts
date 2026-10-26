// BEUK:scriptfonts — the book's script faces: Amiri (Arabic script) and
// Noto Serif Devanagari (Hindi), self-hosted for the preview, installed in
// the print renderer, embedded in an EPUB that needs them. Every file is
// on disk with the sha256 MANIFEST.tsv records, its SIL OFL 1.1 licence
// beside it, and the renderer lock pins the same bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = path.join(ROOT, 'client', 'assets', 'fonts');
const GF_COMMIT = 'e7db6ca603fd4862010383ff17ffd6cc4ffac1c0';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const FACES = [
  {
    family: 'Amiri',
    dir: 'amiri',
    script: 'arabic',
    // regular + bold TrueType for the EPUB; the renderer also has the slanted styles
    epub: ['Amiri-normal-400.ttf', 'Amiri-normal-700.ttf'],
    lock: ['Amiri-italic-400.ttf', 'Amiri-italic-700.ttf', 'Amiri-normal-400.ttf', 'Amiri-normal-700.ttf'],
    webFaces: ['italic 400', 'italic 700', 'normal 400', 'normal 700'],
    sample: 0x0627, // ARABIC LETTER ALEF
  },
  {
    family: 'Noto Serif Devanagari',
    dir: 'notoserifdevanagari',
    script: 'devanagari',
    epub: ['Noto_Serif_Devanagari-normal-400.ttf', 'Noto_Serif_Devanagari-normal-700.ttf'],
    lock: [
      'Noto_Serif_Devanagari-normal-400.ttf',
      'Noto_Serif_Devanagari-normal-500.ttf',
      'Noto_Serif_Devanagari-normal-600.ttf',
      'Noto_Serif_Devanagari-normal-700.ttf',
    ],
    webFaces: ['normal 400', 'normal 500', 'normal 600', 'normal 700'],
    sample: 0x0915, // DEVANAGARI LETTER KA
  },
];

type Row = { family: string; file: string; bytes: number; sha256: string; source: string; note: string };
const manifest = (): Row[] =>
  readFileSync(path.join(FONTS, 'MANIFEST.tsv'), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t'))
    .map(([family, file, bytes, sha256, source, note]) => ({ family, file, bytes: Number(bytes), sha256, source, note: note || '' }));
type LockLine = { sha256: string; dest: string; url: string };
const lockLines = (): LockLine[] =>
  readFileSync(path.join(ROOT, 'deploy', 'renderer', 'fonts.lock'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = /^([0-9a-f]{64}) {2}([a-z0-9]+\/[A-Za-z0-9_.-]+) {2}(\S+)$/.exec(l);
      assert.ok(m, `fonts.lock line reads: ${l}`);
      return { sha256: m[1], dest: m[2], url: m[3] };
    });

/** unicode-range → [lo, hi] pairs */
function ranges(r: string): Array<[number, number]> {
  return r.split(',').map((p) => {
    const [a, b] = p.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)] as [number, number];
  });
}

test('every script-face file is on disk with the size and sha256 MANIFEST.tsv records, from Google Fonts / google-fonts at the pinned commit', () => {
  const rows = manifest();
  for (const F of FACES) {
    const mine = rows.filter((r) => r.family === F.family);
    const files = mine.map((r) => r.file).sort();
    assert.ok(files.includes(`${F.dir}/OFL.txt`), `${F.family}: OFL.txt row`);
    for (const t of F.epub) assert.ok(files.includes(`${F.dir}/${t}`), `${F.family}: ${t} row`);
    assert.ok(files.some((f) => f.endsWith('.woff2')), `${F.family}: web rows`);
    for (const r of mine) {
      const body = readFileSync(path.join(FONTS, r.file));
      assert.equal(body.length, r.bytes, `${r.file} size`);
      assert.equal(sha(body), r.sha256, `${r.file} sha256`);
      if (r.file.endsWith('.woff2')) {
        assert.equal(body.subarray(0, 4).toString('latin1'), 'wOF2', `${r.file} is WOFF2`);
        assert.match(r.source, new RegExp(`^https://fonts\\.gstatic\\.com/s/${F.dir}/v\\d+/`), `${r.file} source`);
      } else if (r.file.endsWith('.ttf')) {
        assert.equal(body.subarray(0, 4).toString('hex'), '00010000', `${r.file} is TrueType`);
        assert.match(r.source, new RegExp(`^https://fonts\\.gstatic\\.com/s/${F.dir}/v\\d+/.+\\.ttf$`), `${r.file} source`);
      } else {
        assert.equal(r.source, `https://raw.githubusercontent.com/google/fonts/${GF_COMMIT}/ofl/${F.dir}/OFL.txt`);
      }
    }
  }
});

test('each script face carries the SIL OFL 1.1 with no Reserved Font Name, and its TrueType files name the copyright and the licence', () => {
  const rows = manifest();
  for (const F of FACES) {
    const lic = readFileSync(path.join(FONTS, F.dir, 'OFL.txt'), 'utf8');
    assert.match(lic, /SIL OPEN FONT LICENSE Version 1\.1/i, `${F.family} is OFL 1.1`);
    assert.doesNotMatch(lic.split(/PREAMBLE/)[0], /Reserved Font Name/i, `${F.family}: no Reserved Font Name`);
    const row = rows.find((r) => r.file === `${F.dir}/OFL.txt`);
    assert.equal(row?.note, 'METADATA.pb license: OFL; no Reserved Font Name');
    for (const t of F.epub) {
      // name table, as UTF-16BE: the copyright line of OFL.txt and the licence URL
      const ttf = readFileSync(path.join(FONTS, F.dir, t));
      const firstLine = lic.split(/\r?\n/)[0].replace(/ \(https?:[^)]+\)\.?$/, '');
      const utf16 = (s: string) => Buffer.from(s, 'utf16le').swap16();
      assert.ok(ttf.includes(utf16(firstLine)), `${t} names "${firstLine}"`);
      assert.ok(ttf.includes(utf16('openfontlicense.org')) || ttf.includes(utf16('scripts.sil.org/OFL')), `${t} names the licence`);
    }
  }
});

test('fonts-scripts.css: only each face\'s own script subset, local files, swap, and its ranges cover the script and no Latin letter', () => {
  const css = readFileSync(path.join(FONTS, 'fonts-scripts.css'), 'utf8');
  assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face \{([^}]*)\}/g)];
  assert.equal(blocks.length, (css.match(/@font-face/g) || []).length, 'every face is labelled with its subset');
  for (const F of FACES) {
    const mine = blocks.filter((b) => b[2].includes(`font-family: '${F.family}';`));
    assert.ok(mine.length > 0, `${F.family} declared`);
    const keys = mine.map((b) => `${/font-style: (\w+)/.exec(b[2])![1]} ${/font-weight: (\d+)/.exec(b[2])![1]}`).sort();
    assert.deepEqual(keys, F.webFaces, `${F.family}: the weights/styles the renderer installs`);
    for (const b of mine) {
      assert.equal(b[1], F.script, `${F.family}: ${F.script} subset only`);
      assert.match(b[2], /font-display: swap;/);
      const url = /src: url\(([^)]+)\) format\('woff2'\);/.exec(b[2])![1];
      assert.match(url, new RegExp(`^${F.dir}/[a-z0-9_-]+\\.woff2$`));
      assert.ok(existsSync(path.join(FONTS, url)), url);
      const rs = ranges(/unicode-range: ([^;]+);/.exec(b[2])![1]);
      assert.ok(rs.some(([lo, hi]) => F.sample >= lo && F.sample <= hi), `${F.family} covers U+${F.sample.toString(16)}`);
      for (const c of [0x41, 0x61, 0x30, 0xe9]) assert.ok(!rs.some(([lo, hi]) => c >= lo && c <= hi), `${F.family} never draws U+${c.toString(16)}`);
    }
  }
});

test('the print renderer pins the same faces: every weight/style, the EPUB files byte-identical, each OFL.txt, from the allowed hosts', () => {
  const lines = lockLines();
  const rows = manifest();
  for (const F of FACES) {
    const mine = lines.filter((l) => l.dest.startsWith(`${F.dir}/`));
    assert.deepEqual(mine.map((l) => l.dest.slice(F.dir.length + 1)).sort(), [...F.lock, 'OFL.txt'].sort(), `${F.family} lock lines`);
    for (const l of mine) {
      assert.ok(l.url.startsWith('https://fonts.gstatic.com/') || l.url.startsWith(`https://raw.githubusercontent.com/google/fonts/${GF_COMMIT}/`), l.url);
      const row = rows.find((r) => r.file === l.dest);
      if (row) {
        assert.equal(l.sha256, row.sha256, `${l.dest}: the renderer and the studio pin the same bytes`);
        assert.equal(l.url, row.source, `${l.dest}: same source`);
      }
    }
    for (const t of F.epub) assert.ok(mine.some((l) => l.dest === `${F.dir}/${t}`), `${t} in the lock`);
  }
  // the build-time fetcher accepts these lines as they are (same pattern, same hosts)
  const fetcher = readFileSync(path.join(ROOT, 'deploy', 'renderer', 'fetch-fonts.mjs'), 'utf8');
  assert.ok(fetcher.includes("'https://fonts.gstatic.com/', 'https://raw.githubusercontent.com/google/fonts/'"));
});

test('the studio links fonts-scripts.css, names the faces in its font stacks, embeds them in EPUBs, and registers its self-checks', () => {
  const html = readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  assert.ok(html.includes('<link rel="stylesheet" href="assets/fonts/fonts-scripts.css" />'));
  assert.ok(html.includes(`const SCRIPT_STACK = "'Noto Serif Devanagari', 'Amiri'";`));
  assert.ok(html.includes(`const SERIF_STACK = (f) => "'" + f + "', " + SCRIPT_STACK + ", Georgia, 'Times New Roman', serif";`));
  assert.ok(html.includes(`const SANS_STACK = (f) => "'" + f + "', " + SCRIPT_STACK + ", 'Helvetica Neue', Helvetica, Arial, sans-serif";`));
  // the EPUB code pins the same sha256 as MANIFEST.tsv
  const rows = manifest();
  for (const F of FACES) {
    for (const t of F.epub) {
      const row = rows.find((r) => r.file === `${F.dir}/${t}`)!;
      assert.ok(html.includes(`file: "${t}", sha256: "${row.sha256}"`), `${t}: the studio checks the same sha256`);
    }
  }
  for (const id of ['fonts.script.preview-faces', 'epub.fonts.script-embedded']) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c.kind, 'client-only');
  }
});
