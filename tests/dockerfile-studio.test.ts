import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/* Final review C1: the image's studio stage (Dockerfile, "FROM node:24-slim AS studio") runs `npm run build` in
   studio/, and that build reads files outside studio/. Every one of them must be COPYed into the stage, or the
   image doesn't build (a clean docker build failed on vite.config.ts's beuk-zen-media, ENOENT; and tsc on
   test/cloud-server.ts, which imports server code the stage doesn't have). No Docker here: the Dockerfile is read. */

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

/** Every path outside studio/ that `cd studio && npm run build` reads (repo-relative, '/'-separated):
 *  - scripts/extract-studio.mjs: client/index.html, client/assets/vendor/lucide.min.js, src/book/studio/closure.ts;
 *  - scripts/extract-closure.mjs: client/index.html, src/book/epub/closure.ts, src/book/studio/closure.ts;
 *  - vite.config.ts: the @book alias (src/book), beuk-zen-media (client/assets/zen/*.webp, client/assets/sound/*.mp3);
 *  - studio/src: imports outside studio/ only through @book (src/book). */
const STUDIO_BUILD_READS = [
  'studio',
  'client/index.html',
  'client/assets/vendor/lucide.min.js',
  'client/assets/zen',
  'client/assets/sound',
  'src/book',
];

/** The studio stage's COPY sources (build-context paths), from its FROM line to the next FROM. */
function studioStageCopies(dockerfile: string): string[] {
  const lines = dockerfile.split('\n');
  const start = lines.findIndex((l) => /^FROM \S+ AS studio\s*$/.test(l));
  assert.ok(start !== -1, 'the Dockerfile has a studio stage');
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^FROM /.test(l)) break;
    const m = /^COPY (?!--from)(.+)$/.exec(l.trim());
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/);
    out.push(...parts.slice(0, -1).map((p) => p.replace(/^\.\//, '').replace(/\/$/, '')));
  }
  return out;
}

const covered = (copies: string[], p: string) => copies.some((c) => p === c || p.startsWith(c + '/'));

test("the Dockerfile's studio stage copies every path the studio build reads", () => {
  const copies = studioStageCopies(read('Dockerfile'));
  const missing = STUDIO_BUILD_READS.filter((p) => !covered(copies, p));
  assert.deepEqual(missing, [], `missing from the studio stage's COPY lines: ${missing.join(', ')}`);
  // and nothing it needs is dropped by .dockerignore (tests/ is, which is why the build doesn't typecheck test/)
  const ignore = read('.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
  for (const p of STUDIO_BUILD_READS) {
    for (const i of ignore) assert.ok(!(p === i || p.startsWith(i + '/')), `${p} is excluded by .dockerignore (${i})`);
  }
});

test('the list is whole: every literal repo path the build scripts and vite.config.ts read is on it', () => {
  const found = new Set<string>();
  // path.join(REPO, 'a', 'b', …) in the extract scripts
  for (const f of ['studio/scripts/extract-studio.mjs', 'studio/scripts/extract-closure.mjs']) {
    for (const m of read(f).matchAll(/path\.join\(REPO,\s*((?:'[^']+'\s*,?\s*)+)\)/g)) {
      found.add([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/'));
    }
  }
  // here('../…') in vite.config.ts, and the Zen media it copies from ../client/assets/
  const vite = read('studio/vite.config.ts');
  // (client/next is the build's output, outDir, written not read)
  for (const m of vite.matchAll(/here\('\.\.\/([^']+)'\)/g)) if (m[1] !== 'client/next') found.add(m[1]);
  assert.match(vite, /outDir: here\('\.\.\/client\/next'\)/);
  assert.ok(vite.includes("copyFileSync(here('../client/assets/' + f), to)"), 'beuk-zen-media copies from client/assets/');
  const zen = /export const ZEN_MEDIA = \[([^\]]+)\]/.exec(vite);
  assert.ok(zen, 'ZEN_MEDIA');
  for (const m of zen[1].matchAll(/'([^']+)'/g)) found.add('client/assets/' + m[1]);
  // studio/src leaves studio/ only through @book
  assert.match(vite, /\{ find: '@book', replacement: here\('\.\.\/src\/book'\) \}/);
  assert.ok(found.size > 5, [...found].join(', '));
  const notListed = [...found].filter((p) => !covered(STUDIO_BUILD_READS, p));
  assert.deepEqual(notListed, [], `read by the build but not on STUDIO_BUILD_READS: ${notListed.join(', ')}`);
});

test("the image's build typechecks the app only (tsconfig.build.json); npm run typecheck still covers the tests", () => {
  const pkg = JSON.parse(read('studio/package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.build, 'node scripts/extract-studio.mjs && tsc --noEmit -p tsconfig.build.json && vite build');
  assert.equal(pkg.scripts.typecheck, 'node scripts/extract-studio.mjs && tsc --noEmit -p tsconfig.json');
  const build = JSON.parse(read('studio/tsconfig.build.json')) as { extends: string; include: string[] };
  assert.equal(build.extends, './tsconfig.json');
  assert.deepEqual(build.include, ['src', 'vite.config.ts']);
  const full = JSON.parse(read('studio/tsconfig.json')) as { include: string[] };
  assert.ok(full.include.includes('test'));
});
