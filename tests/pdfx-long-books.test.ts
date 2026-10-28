import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { testConfig } from './helpers.js';
// A namespace import, so on a build without the page runs the cases fail
// on their assertions (what the finding was), not on a missing export.
import * as tools from '../src/jobs/tools.js';

const { ghostscriptPdfxArgs, runPdfx } = tools;
const pdfxPageRanges = (n: number | null, c: number) => tools.pdfxPageRanges(n, c);
const ghostscriptPdfxJoinArgs: typeof tools.ghostscriptPdfxJoinArgs = (...a) => tools.ghostscriptPdfxJoinArgs(...a);

/**
 * PDF/X on long books (sim finding limit.pdfx-long-book). On the sim
 * stack a 241,642-word d'Artagnan volume (873 pages at 6x9) failed with
 * "Ghostscript exited with code null": GPL Ghostscript 10.00.0 grew to
 * 6.0 GB resident converting it and the kernel's out-of-memory killer
 * sent SIGKILL (dmesg: "Out of memory: Killed process … (gs)
 * anon-rss:6039076kB"); node reports a signal death as code null, and
 * the job said nothing more. These cases run runPdfx against a stub gs
 * (the real binary is not on the test host): a signal death is named as
 * one, and a long book is converted in page runs joined by a last pass
 * that leaves the colour unchanged.
 */

function stubGs(): { dir: string; gs: string; calls: () => string[][]; killOn: (pattern: string | null) => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-pdfx-long-'));
  const gs = path.join(dir, 'gs.sh');
  writeFileSync(
    gs,
    `#!/bin/sh
# Stub Ghostscript: --version answers; every other call is logged (one
# line, arguments joined by a TAB) and writes a small file to its
# -sOutputFile= target — unless its arguments contain the text in
# ./kill-on, when it dies of SIGKILL the way the OOM killer ends it.
if [ "$1" = "--version" ]; then echo "10.00.0-stub"; exit 0; fi
here="$(dirname "$0")"
line=""
for a in "$@"; do line="$line$a	"; done
printf '%s\\n' "$line" >> "$here/calls.log"
if [ -f "$here/kill-on" ] && printf '%s' "$line" | grep -q -- "$(cat "$here/kill-on")"; then kill -9 $$; fi
out=""
for a in "$@"; do case "$a" in -sOutputFile=*) out="\${a#-sOutputFile=}" ;; esac; done
printf '%%PDF-1.3 stub\\n' > "$out"
exit 0
`,
  );
  chmodSync(gs, 0o755);
  return {
    dir,
    gs,
    calls: () =>
      existsSync(path.join(dir, 'calls.log'))
        ? readFileSync(path.join(dir, 'calls.log'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => l.split('\t').filter(Boolean))
        : [],
    killOn: (pattern) => {
      if (pattern === null) rmSync(path.join(dir, 'kill-on'), { force: true });
      else writeFileSync(path.join(dir, 'kill-on'), pattern);
    },
  };
}

function setup(chunkPages = 40) {
  const stub = stubGs();
  const def = path.join(stub.dir, 'PDFX_def.ps');
  writeFileSync(def, '%!PS\n% stub definition file, no profile line\n');
  const input = path.join(stub.dir, 'rendered.pdf');
  writeFileSync(input, '%PDF-1.4 stub\n');
  const config = testConfig({ gsBin: stub.gs, pdfxDefPath: def, pdfxChunkPages: chunkPages, pdfxTimeoutMs: 60_000 });
  return { stub, config, def, input, output: path.join(stub.dir, 'converted.pdf') };
}

test('page runs cover every page once, in order, at most PDFX_CHUNK_PAGES each; a short book is one run', () => {
  assert.deepEqual(pdfxPageRanges(95, 40), [
    { first: 1, last: 40 },
    { first: 41, last: 80 },
    { first: 81, last: 95 },
  ]);
  assert.deepEqual(pdfxPageRanges(873, 40)!.length, 22);
  assert.deepEqual(pdfxPageRanges(873, 40)!.at(-1), { first: 841, last: 873 });
  assert.equal(pdfxPageRanges(40, 40), null);
  assert.equal(pdfxPageRanges(12, 40), null);
  assert.equal(pdfxPageRanges(null, 40), null);
});

test('a Ghostscript run killed by a signal is reported as that, never as "exited with code null"', { skip: process.platform === 'win32' }, async () => {
  const { stub, config, input, output } = setup();
  stub.killOn('-sDEVICE=pdfwrite');
  const outcome = await runPdfx(config, input, output, { pageCount: 12 });
  assert.equal(outcome.ok, false);
  const error = outcome.ok ? '' : outcome.error;
  assert.doesNotMatch(error, /code null/);
  assert.match(error, /Ghostscript was killed by SIGKILL while converting the whole book/);
  assert.match(error, /runs out of memory/);
  assert.match(error, /PDFX_CHUNK_PAGES/);
});

test('a long book is converted in page runs, then joined with its colour left unchanged', { skip: process.platform === 'win32' }, async () => {
  const { stub, config, def, input, output } = setup(40);
  const outcome = await runPdfx(config, input, output, { pageCount: 95, workDir: stub.dir });
  assert.equal(outcome.ok, true, outcome.ok ? '' : outcome.error);
  const calls = stub.calls();
  assert.equal(calls.length, 4, 'three page runs and one join');
  const ranges = calls.slice(0, 3).map((c) => [c.find((a) => a.startsWith('-dFirstPage=')), c.find((a) => a.startsWith('-dLastPage='))]);
  assert.deepEqual(ranges, [
    ['-dFirstPage=1', '-dLastPage=40'],
    ['-dFirstPage=41', '-dLastPage=80'],
    ['-dFirstPage=81', '-dLastPage=95'],
  ]);
  for (const c of calls.slice(0, 3)) {
    assert.ok(c.includes('-sColorConversionStrategy=CMYK'), 'each page run converts colour');
    assert.ok(c.includes('-dPDFX'));
    assert.equal(c.at(-1), input);
  }
  const join = calls[3];
  assert.ok(join.includes('-sColorConversionStrategy=LeaveColorUnchanged'));
  assert.ok(!join.includes('-sColorConversionStrategy=CMYK'));
  assert.ok(join.includes('-dPDFX') && join.includes('-dSAFER') && join.includes('-dShowAnnots=false'));
  assert.ok(join.includes(`-sOutputFile=${output}`));
  const parts = join.slice(join.indexOf(def) + 1);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => path.basename(p)), ['part-000001.pdf', 'part-000041.pdf', 'part-000081.pdf']);
  assert.ok(!existsSync(path.join(stub.dir, 'pdfx-parts')), 'the parts are removed afterwards');
  if (outcome.ok) {
    assert.equal(outcome.value.conversion.parts, 3);
    assert.equal(outcome.value.conversion.chunkPages, 40);
    assert.equal(outcome.value.conversion.partMs.length, 3);
    assert.equal(typeof outcome.value.conversion.joinMs, 'number');
  }
});

test('a page run killed by a signal names the pages it was converting', { skip: process.platform === 'win32' }, async () => {
  const { stub, config, input, output } = setup(40);
  stub.killOn('-dFirstPage=41');
  const outcome = await runPdfx(config, input, output, { pageCount: 95, workDir: stub.dir });
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? '' : outcome.error, /killed by SIGKILL while converting pages 41–80 of 95/);
  assert.equal(stub.calls().length, 2, 'it stops at the failed run');
  stub.killOn('LeaveColorUnchanged');
  const joined = await runPdfx(config, input, output, { pageCount: 95, workDir: stub.dir });
  assert.match(joined.ok ? '' : joined.error, /killed by SIGKILL while converting the last pass that joins the 3 converted parts/);
});

test('the join pass keeps every PDF/X argument of a page run except the colour conversion', () => {
  const cfg = testConfig({ pdfxDefPath: '/defs/PDFX_def.ps', pdfxIccDir: '/icc/' });
  const run = ghostscriptPdfxArgs(cfg, '/w/in.pdf', '/w/out.pdf');
  const join = ghostscriptPdfxJoinArgs(cfg, ['/w/a.pdf', '/w/b.pdf'], '/w/out.pdf');
  assert.deepEqual(join.slice(-3), ['/defs/PDFX_def.ps', '/w/a.pdf', '/w/b.pdf']);
  assert.deepEqual(
    join.slice(0, -2),
    run.slice(0, -1).map((a) => (a === '-sColorConversionStrategy=CMYK' ? '-sColorConversionStrategy=LeaveColorUnchanged' : a)),
  );
  const ranged = ghostscriptPdfxArgs(cfg, '/w/in.pdf', '/w/out.pdf', { first: 41, last: 80 });
  assert.deepEqual(ranged.slice(-2), ['/defs/PDFX_def.ps', '/w/in.pdf']);
  assert.ok(ranged.includes('-dFirstPage=41') && ranged.includes('-dLastPage=80'));
});
