// Build-time only (deploy/renderer/Dockerfile): install the book's
// typefaces into the renderer image so Chromium sets the print interior
// in the faces the studio shows, not a system fallback (the image used
// to have only DejaVu, so every server PDF came out in DejaVu Serif).
//
// Reads fonts.lock ("sha256  destination  URL" lines; see its header),
// downloads each URL, and writes it under the target directory ONLY if
// its sha256 matches the pinned value — any other bytes fail the build.
// Nothing here runs at render time: the renderer container has no
// network at all.
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
const ALLOWED = ['https://fonts.gstatic.com/', 'https://raw.githubusercontent.com/google/fonts/'];
const entries = (await readFile(lockPath, 'utf8'))
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const m = /^([0-9a-f]{64}) {2}([a-z0-9]+\/[A-Za-z0-9_.-]+) {2}(\S+)$/.exec(l);
    if (!m || !ALLOWED.some((p) => m[3].startsWith(p))) {
      console.error(`fonts.lock: unreadable or off-source line: ${l}`);
      process.exit(1);
    }
    return { sha256: m[1], dest: m[2], url: m[3] };
  });
let bytes = 0;
for (const e of entries) {
  let body = null;
  for (let attempt = 1; attempt <= 3 && !body; attempt += 1) {
    try {
      const res = await fetch(e.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) {
        console.error(`download failed: ${e.url}: ${err.message}`);
        process.exit(1);
      }
    }
  }
  const sha = createHash('sha256').update(body).digest('hex');
  if (sha !== e.sha256) {
    console.error(`sha256 mismatch for ${e.dest} (${e.url}): got ${sha}, pinned ${e.sha256}`);
    process.exit(1);
  }
  const out = path.join(target, e.dest);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, body, { mode: 0o644 });
  bytes += body.length;
}
console.log(`installed ${entries.length} files (${bytes} bytes)`);
