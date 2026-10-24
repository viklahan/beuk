import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ghostscriptPdfxArgs, pdfxIccPath } from '../src/jobs/tools.js';
import type { Config } from '../src/config.js';

/**
 * Ghostscript 9.50+ runs SAFER by default, so the PDF/X def file's read
 * of its ICC profile needs an explicit --permit-file-read for exactly
 * that one path (observed on GPL Ghostscript 10.00.0: /invalidfileaccess
 * without it). These cases pin the argument shape; the real binary run
 * is recorded in the store-ready unit's evidence.
 */

test('the shipped PDF/X def declares PDF/X-1a:2001 conformance and names an ICC path', () => {
  const def = readFileSync(path.join(process.cwd(), 'tools', 'PDFX_def.ps'), 'latin1');
  assert.match(def, /\/GTS_PDFXVersion \(PDF\/X-1:2001\)/);
  assert.match(def, /\/GTS_PDFXConformance \(PDF\/X-1a:2001\)/);
  assert.equal(pdfxIccPath(path.join(process.cwd(), 'tools', 'PDFX_def.ps')), '/usr/share/color/icc/PDFX_ICC_PROFILE.icc');
});

test('ghostscript args permit reading exactly the def file ICC profile, first, and nothing when none is named', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-pdfxdef-'));
  const withIcc = path.join(dir, 'with.ps');
  writeFileSync(withIcc, '%!PS\n/BeukICCPath (/opt/icc/press.icc) def\n');
  const args = ghostscriptPdfxArgs({ pdfxDefPath: withIcc } as Config, '/in.pdf', '/out.pdf');
  assert.equal(args[0], '--permit-file-read=/opt/icc/press.icc');
  assert.equal(args.filter((a) => a.startsWith('--permit-file-read')).length, 1);
  assert.deepEqual(args.slice(-2), [withIcc, '/in.pdf']);

  const without = path.join(dir, 'without.ps');
  writeFileSync(without, '%!PS\n% no profile line\n');
  const bare = ghostscriptPdfxArgs({ pdfxDefPath: without } as Config, '/in.pdf', '/out.pdf');
  assert.equal(bare.some((a) => a.startsWith('--permit-file-read')), false);
  assert.equal(pdfxIccPath(path.join(dir, 'missing.ps')), null);
});
