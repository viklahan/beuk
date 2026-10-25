import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';
import {
  contentTokens,
  neutralizeContent,
  neutralRgbToGray,
  parsePam,
  tacFromPam,
  textInkFacts,
  transparencyFacts,
} from '../src/jobs/pdfpress.js';
import { ghostscriptPdfxArgs, pdfxIccDirArgs, pdfxProblem } from '../src/jobs/tools.js';
import { inspectPdf } from '../src/jobs/pdfinspect.js';
import type { Config } from '../src/config.js';

/* Print for press (unit "print"): the pdfx job's own fix-up (neutral
   RGB → DeviceGray before Ghostscript) and the facts it reads back from
   the converted file (text ink per run, transparency, total ink). The
   real-binary run is recorded in the unit's evidence; these cases pin
   the readers on hand-built PDFs whose answers are known. */

const here = path.dirname(fileURLToPath(import.meta.url));

/** A one-page PDF with a classic xref whose offsets are real. */
function onePagePdf(content: string, opts: { compress?: boolean; extra?: string[] } = {}): Buffer {
  const objs: string[] = [];
  const parts: Buffer[] = [];
  const body = opts.compress ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 432 648] >>');
  objs.push('<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>');
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  const offsets: number[] = [];
  const add = (b: Buffer) => {
    parts.push(b);
  };
  add(out);
  let at = out.length;
  const emit = (num: number, text: Buffer) => {
    offsets[num] = at;
    const head = Buffer.from(`${num} 0 obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    add(head);
    add(text);
    add(tail);
    at += head.length + text.length + tail.length;
  };
  objs.forEach((o, i) => emit(i + 1, Buffer.from(o, 'latin1')));
  emit(
    4,
    Buffer.concat([
      Buffer.from(`<< /Length ${body.length}${opts.compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'),
      body,
      Buffer.from('\nendstream', 'latin1'),
    ]),
  );
  const form = 'BT 0.2 0.2 0.2 rg (F) Tj ET';
  emit(5, Buffer.from(`<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length ${form.length} >>\nstream\n${form}\nendstream`, 'latin1'));
  let n = 6;
  for (const e of opts.extra ?? []) emit(n++, Buffer.from(e, 'latin1'));
  const xrefAt = at;
  let xref = `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  add(Buffer.from(xref, 'latin1'));
  out = Buffer.concat(parts);
  return out;
}

test('content tokens never read operators out of strings, hex strings or inline images', () => {
  const toks = contentTokens('(0 0 0 rg) Tj <30203020> Tj BI /W 1 /H 1 ID \x00 0 0 0 rg EI 1 1 1 rg % 0 0 0 rg\n');
  const ops = toks.filter((t) => t.kind === 'op').map((t) => t.text);
  assert.deepEqual(ops, ['Tj', 'Tj', 'rg']);
});

test('neutral RGB becomes DeviceGray; coloured and near-neutral values are untouched', () => {
  const r = neutralizeContent('0 0 0 rg .5 .5 .5 RG 0.5 0.5 0.51 rg 1 0 0 rg q 1 1 1 rg Q');
  assert.equal(r.text, '0 g .5 G 0.5 0.5 0.51 rg 1 0 0 rg q 1 g Q');
  assert.equal(r.rewritten, 3);
  assert.deepEqual(neutralizeContent('0.2 0.1 0 rg'), { text: '0.2 0.1 0 rg', rewritten: 0 });
});

test('the rewrite is an incremental update over the untouched original, and an unchanged file is returned as-is', () => {
  const pdf = onePagePdf('BT /F1 11 Tf 0 0 0 rg (A) Tj ET', { compress: true });
  const out = neutralRgbToGray(pdf);
  assert.equal(out.skipped, null);
  assert.equal(out.streams, 2, 'the page content and the form XObject were both rewritten');
  assert.equal(out.operators, 2);
  assert.ok(out.pdf.subarray(0, pdf.length).equals(pdf));
  const tail = out.pdf.subarray(pdf.length).toString('latin1');
  assert.match(tail, /\/Prev \d+/);
  assert.match(tail, /startxref\n\d+\n%%EOF\n$/);
  // The appended xref points at the new objects.
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(tail)![1]);
  assert.equal(out.pdf.subarray(xrefAt, xrefAt + 4).toString('latin1'), 'xref');
  for (const m of tail.matchAll(/^(\d+) 1\n(\d{10}) 00000 n /gm)) {
    assert.equal(out.pdf.subarray(Number(m[2]), Number(m[2]) + m[1].length + 6).toString('latin1'), `${m[1]} 0 obj`);
  }
  const plain = onePagePdf('BT 0.3 0.1 0 rg (A) Tj ET');
  const form = neutralRgbToGray(plain);
  assert.equal(form.operators, 1, 'only the form (0.2 grey) is neutral');
  const none = neutralRgbToGray(Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1'));
  assert.equal(none.operators, 0);
  assert.match(String(none.skipped), /no classic xref table/);
});

test('text ink is read per text run, through q/Q, Tr and form XObjects', () => {
  const pdf = onePagePdf(
    'q 0 0 0 1 k BT (A) Tj ET Q BT 0.25 g (B) Tj 0 0 0 0.6 k [(C)] TJ 0.1 0.9 0.9 0 k (D) Tj 3 Tr 1 0 0 0 k (E) Tj 0 Tr ET /Fm1 Do',
  );
  // As rendered, the form's 0.2 grey is DeviceRGB: not black-plate ink.
  const raw = textInkFacts(pdf);
  assert.deepEqual(raw.otherColours, { '0.1 0.9 0.9 0 k': 1, '0.2 0.2 0.2 rg': 1 });
  // After the neutral rewrite the form's run is an 80% K tint.
  const f = textInkFacts(neutralRgbToGray(pdf).pdf);
  assert.equal(f.textShows, 5, 'A B C D and the form run; the invisible E puts no ink down');
  assert.equal(f.kOnly, 4);
  assert.deepEqual(f.kValues, { '100': 1, '75': 1, '60': 1, '80': 1 });
  assert.deepEqual(f.otherColours, { '0.1 0.9 0.9 0 k': 1 });
  assert.deepEqual(f.pagesWithText, [1]);
});

test('transparency facts count what PDF/X-1a forbids', () => {
  const pdf = onePagePdf('q /G3 gs Q', {
    extra: [
      '<< /Type /ExtGState /ca .8 /CA 1 >>',
      '<< /Type /ExtGState /SMask << /S /Luminosity >> /BM /Multiply >>',
      '<< /Type /ExtGState /SMask /None /BM /Normal >>',
      '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /SMask 9 0 R /Length 0 >>\nstream\n\nendstream',
      '<< /Group << /S /Transparency >> >>',
    ],
  });
  assert.deepEqual(transparencyFacts(pdf), { constantAlpha: 1, softMasks: 1, imageSoftMasks: 1, blendModes: 1, groups: 1 });
});

test('total ink is the highest per-pixel C+M+Y+K of a CMYK PAM; a non-CMYK raster is no measurement', () => {
  const head = (w: number, h: number, type: string, depth = 4) =>
    Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH ${depth}\nMAXVAL 255\nTUPLTYPE ${type}\nENDHDR\n`, 'latin1');
  const px = Buffer.from([0, 0, 0, 255, 184, 172, 171, 225, 10, 10, 10, 10]);
  const img = parsePam(Buffer.concat([head(3, 1, 'CMYK'), px]));
  assert.ok(img);
  assert.equal(tacFromPam(img!), 294.9);
  assert.equal(tacFromPam(parsePam(Buffer.concat([head(1, 1, 'RGB', 3), Buffer.from([1, 2, 3])]))!), null);
  assert.equal(parsePam(Buffer.from('P6\n1 1\n255\n')), null);
  assert.equal(parsePam(Buffer.concat([head(4, 4, 'CMYK'), px])), null, 'a truncated raster is rejected');
});

test('the conversion profile directory is read-permitted and passed as ICCProfilesDir, and a half-built one is "not configured"', () => {
  const def = path.join(process.cwd(), 'tools', 'PDFX_def.ps');
  assert.deepEqual(pdfxIccDirArgs({ pdfxIccDir: null }), []);
  assert.deepEqual(pdfxIccDirArgs({ pdfxIccDir: '/usr/share/color/icc/beuk/gs' }), [
    '--permit-file-read=/usr/share/color/icc/beuk/gs/',
    '-sICCProfilesDir=/usr/share/color/icc/beuk/gs/',
  ]);
  const args = ghostscriptPdfxArgs({ pdfxDefPath: def, pdfxIccDir: '/opt/gs/' } as Config, '/in.pdf', '/out.pdf');
  assert.equal(args[0], '-dSAFER');
  assert.ok(args.indexOf('-sICCProfilesDir=/opt/gs/') < args.indexOf('-sDEVICE=pdfwrite'));
  assert.deepEqual(args.slice(-2), [def, '/in.pdf']);

  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-iccdir-'));
  const icc = path.join(dir, 'press.icc');
  writeFileSync(icc, 'profile');
  const defFile = path.join(dir, 'def.ps');
  writeFileSync(defFile, `%!PS\n/BeukICCPath (${icc}) def\n`);
  const cfg = { gsBin: process.execPath, pdfxDefPath: defFile, pdfxIccDir: dir } as Config;
  assert.match(String(pdfxProblem(cfg)), /no default_cmyk\.icc/);
  writeFileSync(path.join(dir, 'default_cmyk.icc'), 'profile');
  assert.equal(pdfxProblem(cfg), null);
});

test('inspection still reads a file whose objects carry generation numbers', () => {
  const r = inspectPdf(onePagePdf('BT (A) Tj ET'));
  assert.equal(r.pageCount, 1);
});

test('print: every client print.press.* self-check is registered server-side as client-only with a reason', async () => {
  const html = await readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
  const clientIds = [...html.matchAll(/id: "(print\.press\.[a-z0-9.-]+)"/g)].map((m) => m[1]);
  assert.ok(clientIds.length >= 3, `expected the print.press self-checks in the client, found ${clientIds.length}`);
  const serverIds = SELF_CHECK_CASES.filter((c) => c.id.startsWith('print.press.')).map((c) => c.id);
  assert.deepEqual([...serverIds].sort(), [...new Set(clientIds)].sort());
  for (const c of SELF_CHECK_CASES.filter((x) => x.id.startsWith('print.press.'))) {
    assert.equal(c.kind, 'client-only', c.id);
    assert.ok((c.reason ?? '').length > 10, `${c.id} must carry a reason`);
  }
});

test('print: every new press string ships in all 13 locales', async () => {
  const html = await readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
  for (const key of [
    'store.c.textK.name',
    'store.c.textK.ok',
    'store.c.textK.tints',
    'store.c.textK.fail',
    'store.c.textK.none',
    'store.nc.textK',
    'store.c.tac.ok',
    'store.c.tac.over',
    'store.c.tac.fix',
    'store.nc.tac',
    'store.nc.tacFail',
  ]) {
    const n = html.split(`"${key}":`).length - 1;
    assert.equal(n, 13, `${key} appears in ${n} locales, not 13`);
  }
});
