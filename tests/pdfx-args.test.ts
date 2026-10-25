import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ghostscriptPdfxArgs, pdfxIccPath, pdfxProblem, pdfxRevertMessage } from '../src/jobs/tools.js';
import { checkPdfxProfile, iccProfileId, PDFX_PROFILE } from '../src/jobs/iccprofile.js';
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
  // The pinned IDEAlliance SWOP2006_Coated3v2 profile the tools image
  // installs (deploy/Dockerfile.tools), named with its registered
  // characterisation CGATS TR 003 (src/jobs/iccprofile.ts cites both).
  assert.equal(pdfxIccPath(path.join(process.cwd(), 'tools', 'PDFX_def.ps')), '/usr/share/color/icc/beuk/SWOP2006_Coated3v2.icc');
  assert.match(def, /\/OutputConditionIdentifier \(CGATS TR 003\)/);
  assert.match(def, /\/RegistryName \(http:\/\/www\.color\.org\)/);
  assert.doesNotMatch(def, /PDFX_ICC_PROFILE|CGATS TR 001/);
});

test('ghostscript args keep SAFER first, permit reading exactly the def file ICC profile, and nothing when none is named', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-pdfxdef-'));
  const withIcc = path.join(dir, 'with.ps');
  writeFileSync(withIcc, '%!PS\n/BeukICCPath (/opt/icc/press.icc) def\n');
  const args = ghostscriptPdfxArgs({ pdfxDefPath: withIcc } as Config, '/in.pdf', '/out.pdf');
  assert.equal(args[0], '-dSAFER');
  assert.equal(args[1], '--permit-file-read=/opt/icc/press.icc');
  assert.equal(args.filter((a) => a.startsWith('--permit-file-read')).length, 1);
  assert.deepEqual(args.slice(-2), [withIcc, '/in.pdf']);

  const without = path.join(dir, 'without.ps');
  writeFileSync(without, '%!PS\n% no profile line\n');
  const bare = ghostscriptPdfxArgs({ pdfxDefPath: without } as Config, '/in.pdf', '/out.pdf');
  assert.equal(bare.some((a) => a.startsWith('--permit-file-read')), false);
  assert.equal(pdfxIccPath(path.join(dir, 'missing.ps')), null);
});

test('a def file whose CMYK profile is missing reads as "not configured", not a Ghostscript crash', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-pdfxicc-'));
  const def = path.join(dir, 'def.ps');
  // node answers --version, so it stands in for a working gs binary here.
  const cfg = (pdfxDefPath: string) => ({ gsBin: process.execPath, pdfxDefPath }) as Config;
  writeFileSync(def, `%!PS
/BeukICCPath (${path.join(dir, 'absent.icc')}) def
`);
  assert.match(String(pdfxProblem(cfg(def))), /no CMYK press colour profile/);
  writeFileSync(path.join(dir, 'absent.icc'), 'profile bytes');
  assert.equal(pdfxProblem(cfg(def)), null);
});
test('ghostscript drops annotations so PDF/X is not silently abandoned, and the revert notice is recognised', () => {
  const args = ghostscriptPdfxArgs({ pdfxDefPath: path.join(process.cwd(), 'tools', 'PDFX_def.ps') } as Config, '/in.pdf', '/out.pdf');
  assert.ok(args.includes('-dShowAnnots=false'));
  assert.ok(args.includes('-dPreserveAnnots=false'));
  assert.ok(args.includes('-dPDFX'));
  // Ghostscript 10.00.0's real output (observed 2026-10-24), two lines.
  const real =
    'Processing pages 1 through 81.\nPage 1\nPage 2\n' +
    'GPL Ghostscript 10.00.0: Annotation (not TrapNet or PrinterMark) on page,\n' +
    ' not permitted in PDF/X, reverting to normal PDF output\nPage 3\n';
  assert.equal(
    pdfxRevertMessage(real),
    'GPL Ghostscript 10.00.0: Annotation (not TrapNet or PrinterMark) on page, not permitted in PDF/X, reverting to normal PDF output',
  );
  assert.equal(pdfxRevertMessage('Processing pages 1 through 81.\nPage 1\n'), null);
});

test('the ICC profile ID is the ICC.1 MD5 with flags, intent and ID zeroed', () => {
  const a = Buffer.alloc(200, 7);
  const b = Buffer.from(a);
  b.fill(1, 44, 48); // flags
  b.fill(2, 64, 68); // rendering intent
  b.fill(3, 84, 100); // stored ID
  assert.equal(iccProfileId(a), iccProfileId(b));
  b[120] = 9; // any other byte changes it
  assert.notEqual(iccProfileId(a), iccProfileId(b));
});

test('the shipped def file agrees with the pinned profile; a drifted def is caught; a missing file is required only on request', () => {
  const shipped = { pdfxDefPath: path.join(process.cwd(), 'tools', 'PDFX_def.ps') };
  const lax = checkPdfxProfile(shipped, false);
  // The test host has no tools image; the file is only checked when present.
  if (!lax.fileVerified) assert.match(lax.detail, /NOT checked/);
  assert.equal(lax.ok, true, lax.detail);
  const strict = checkPdfxProfile(shipped, true);
  if (!lax.fileVerified) {
    assert.equal(strict.ok, false);
    assert.match(strict.detail, /no profile installed at \/usr\/share\/color\/icc\/beuk\/SWOP2006_Coated3v2\.icc/);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-pdfxprof-'));
  const drifted = path.join(dir, 'def.ps');
  writeFileSync(
    drifted,
    readFileSync(shipped.pdfxDefPath, 'latin1').replace('(CGATS TR 003)', '(CGATS TR 001)'),
    'latin1',
  );
  const bad = checkPdfxProfile({ pdfxDefPath: drifted }, false);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /OutputConditionIdentifier is not \(CGATS TR 003\)/);
  assert.equal(PDFX_PROFILE.outputConditionIdentifier, 'CGATS TR 003');
});
