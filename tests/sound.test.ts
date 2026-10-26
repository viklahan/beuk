import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* BEUK:sound — the zen ambient recordings ship with a credits file that
   names, for every shipped file, its source, licence and the sha256 of
   the SHIPPED bytes. This keeps CREDITS.md and client/assets/sound/ in
   lock-step: nothing ships unlisted, nothing listed is missing, and a
   re-encoded file cannot slip in under an old entry. */

const here = path.dirname(fileURLToPath(import.meta.url));
const soundDir = path.join(here, '..', 'client', 'assets', 'sound');
const MB = 1024 * 1024;

type Row = { file: string; sha256: string };

/* The "Shipped files" table: | `rain.mp3` | `<sha256>` | … */
async function shippedRows(): Promise<{ rows: Row[]; credits: string }> {
  const credits = await readFile(path.join(soundDir, 'CREDITS.md'), 'utf8');
  const rows: Row[] = [];
  for (const m of credits.matchAll(/^\|\s*`([a-z0-9-]+\.mp3)`\s*\|\s*`([0-9a-f]{64})`\s*\|/gm)) {
    rows.push({ file: m[1], sha256: m[2] });
  }
  return { rows, credits };
}

test('sound credits: every shipped file is listed, exists, and matches its recorded sha256', async () => {
  const { rows } = await shippedRows();
  assert.ok(rows.length >= 1, 'CREDITS.md lists at least one shipped file');
  const listed = new Set(rows.map((r) => r.file));
  assert.equal(listed.size, rows.length, 'no file is listed twice');
  for (const r of rows) {
    const bytes = await readFile(path.join(soundDir, r.file));
    const sha = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha, r.sha256, `${r.file}: shipped sha256 must equal the one recorded in CREDITS.md`);
  }
  const onDisk = (await readdir(soundDir)).filter((f) => f !== 'CREDITS.md');
  for (const f of onDisk) assert.ok(listed.has(f), `${f} is in client/assets/sound/ but not listed in CREDITS.md`);
});

test('sound credits: each shipped file names a CC0 or public-domain source, its licence line and its edits', async () => {
  const { rows, credits } = await shippedRows();
  const renderer = await readFile(path.join(here, '..', 'tools', 'sound', 'render_ambience.py'), 'utf8');
  for (const r of rows) {
    const start = credits.indexOf(`## ${r.file}`);
    assert.ok(start !== -1, `${r.file} has its own "## ${r.file}" section`);
    const next = credits.indexOf('\n## ', start + 4);
    const section = credits.slice(start, next === -1 ? undefined : next);
    assert.match(section, /Licence line seen: “[^”]{3,}”/, `${r.file}: the exact licence line quoted`);
    assert.match(section, /Edits:/, `${r.file}: the edits made`);
    assert.doesNotMatch(section, /CC[- ]BY|Attribution 4\.0|royalty[- ]free/i, `${r.file}: no attribution-required or custom licence`);
    /* A Public Domain Mark labels a work as already free of copyright; it is not the
       creator's own waiver, so a recent recording under it cannot ship (round 6). */
    assert.doesNotMatch(section, /Public Domain Mark/i, `${r.file}: not shipped under a Public Domain Mark`);
    if (/^- Made for Beuk/m.test(section)) {
      /* Our own offline render: CC0 by us, and the exact command that re-renders it. */
      assert.match(section, /Licence: CC0 1\.0/, `${r.file}: our own render is released CC0 1.0`);
      const scene = r.file.replace(/\.mp3$/, '');
      const cmd = /Render: `python3 -I tools\/sound\/render_ambience\.py ([a-z]+) \S+ (\d+)`/.exec(section);
      assert.ok(cmd, `${r.file}: the render command is recorded`);
      assert.equal(cmd[1], scene, `${r.file}: rendered as its own scene`);
      const seeds = /\{"rain": (\d+), "wind": (\d+)\}\[scene\]/.exec(renderer);
      assert.ok(seeds, 'render_ambience.py declares its default seeds');
      assert.equal(cmd[2], scene === 'rain' ? seeds[1] : seeds[2], `${r.file}: recorded seed is the script's default seed`);
    } else {
      assert.match(section, /Source page: https:\/\/\S+/, `${r.file}: source page URL`);
      assert.match(section, /Direct download: https:\/\/\S+/, `${r.file}: direct download URL`);
      assert.match(section, /Licence: (CC0 1\.0|Public domain)/, `${r.file}: licence is CC0 or public domain`);
      assert.match(section, /Retrieved: 2026-10-2[56]/, `${r.file}: retrieval date`);
      assert.match(section, /Original sha256: `[0-9a-f]{64}`/, `${r.file}: sha256 of the original download`);
    }
  }
});

test('sound files: each is at most 1.5 MB and all together at most 4.5 MB', async () => {
  const { rows } = await shippedRows();
  let total = 0;
  for (const r of rows) {
    const size = (await readFile(path.join(soundDir, r.file))).byteLength;
    assert.ok(size <= 1.5 * MB, `${r.file}: ${size} bytes exceeds 1.5 MB`);
    total += size;
  }
  assert.ok(total <= 4.5 * MB, `total ${total} bytes exceeds 4.5 MB`);
});

test('sound files: the studio plays exactly the scenes that ship, from same-origin assets/sound/', async () => {
  const { rows } = await shippedRows();
  const html = await readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
  const scenes = /const ZEN_SCENES = \[([^\]]*)\];/.exec(html);
  assert.ok(scenes, 'ZEN_SCENES is declared');
  const names = [...scenes[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names.map((n) => `${n}.mp3`).sort(), rows.map((r) => r.file).sort(), 'one shipped file per scene, no more, no fewer');
  for (const n of names) assert.ok(html.includes(`file: "assets/sound/${n}.mp3"`), `${n} plays assets/sound/${n}.mp3`);
  // The synthesized ambience is gone for good.
  for (const gone of ['function zenNoiseBuffer', 'function zenDroplet', 'function zenDrumHit', 'zenSound.masterFilter', 'mf.frequency.value = 1100']) {
    assert.ok(!html.includes(gone), `${gone} must not return`);
  }
});

test('sound files: both service-worker twins runtime-cache the recordings, never precache them, and share one cache name', async () => {
  for (const p of ['sw.js', path.join('assets', 'sw.js')]) {
    const sw = await readFile(path.join(here, '..', 'client', p), 'utf8');
    assert.match(sw, /const BEUK_CACHE = "beuk-shell-v6";/, `${p}: shell cache at v6`);
    /* v2: rain and wind were replaced under the same names (round 6); the cache is
       cache-first, so the name had to move or returning writers keep the old files. */
    assert.match(sw, /const BEUK_SOUND_CACHE = "beuk-sound-v2";/, `${p}: sound cache`);
    assert.ok(!sw.includes('beuk-sound-v1'), `${p}: the old sound cache name is not kept anywhere`);
    assert.match(sw, /\/\^beuk-sound-v\(\\d\+\)\$\/[\s\S]*parseInt\(s\[1\], 10\) < mySound/, `${p}: older beuk-sound-v<N> caches are retired`);
    const shell = /const BEUK_SHELL = \[([\s\S]*?)\];/.exec(sw);
    assert.ok(shell && !/sound/.test(shell[1]), `${p}: recordings are not in the precache list`);
    assert.match(sw, /k !== BEUK_CACHE && k !== BEUK_SOUND_CACHE/, `${p}: activate keeps the sound cache`);
    assert.match(sw, /\/assets\/sound\//, `${p}: has the sound fetch rule`);
  }
});
