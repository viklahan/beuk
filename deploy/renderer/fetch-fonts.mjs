// Build-time only (deploy/renderer/Dockerfile): install the book's
// typefaces into the renderer image so Chromium sets the print interior
// in the faces the studio shows, not a system fallback (the image used
// to have only DejaVu, so every server PDF came out in DejaVu Serif).
//
// Reads fonts.lock (a google/fonts commit + "sha256  path" lines),
// downloads each file from raw.githubusercontent.com at that exact
// commit, and writes it under the target directory ONLY if its sha256
// matches the pinned value — any other bytes fail the build. Nothing
// here runs at render time: the renderer container has no network.
//
// Usage: node fetch-fonts.mjs fonts.lock /usr/share/fonts/truetype/beuk
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [lockPath, target] = process.argv.slice(2);
if (!lockPath || !target) {
  console.error('usage: node fetch-fonts.mjs <fonts.lock> <target dir>');
  process.exit(2);
}
const lines = (await readFile(lockPath, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const commitLine = lines.find((l) => l.startsWith('commit '));
const commit = commitLine ? commitLine.slice(7).trim() : '';
if (!/^[0-9a-f]{40}$/.test(commit)) {
  console.error('fonts.lock names no 40-hex google/fonts commit');
  process.exit(1);
}
const entries = lines
  .filter((l) => l !== commitLine)
  .map((l) => {
    const m = /^([0-9a-f]{64}) {2}(ofl\/[a-z0-9]+\/[A-Za-z0-9_\-[\],.]+)$/.exec(l);
    if (!m) {
      console.error(`fonts.lock: unreadable line: ${l}`);
      process.exit(1);
    }
    return { sha256: m[1], file: m[2] };
  });
let bytes = 0;
for (const e of entries) {
  const url = `https://raw.githubusercontent.com/google/fonts/${commit}/${e.file.split('/').map(encodeURIComponent).join('/')}`;
  let body = null;
  for (let attempt = 1; attempt <= 3 && !body; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) {
        console.error(`download failed: ${url}: ${err.message}`);
        process.exit(1);
      }
    }
  }
  const sha = createHash('sha256').update(body).digest('hex');
  if (sha !== e.sha256) {
    console.error(`sha256 mismatch for ${e.file}: got ${sha}, pinned ${e.sha256}`);
    process.exit(1);
  }
  const out = path.join(target, e.file.slice('ofl/'.length));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, body, { mode: 0o644 });
  bytes += body.length;
}
console.log(`installed ${entries.length} files (${bytes} bytes) from google/fonts@${commit}`);
