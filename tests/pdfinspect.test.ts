import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { inspectPdf, pdfStringAfter } from '../src/jobs/pdfinspect.js';

/**
 * Store-ready tie-in: the converted-PDF reader. Fixtures are built
 * byte by byte here so every expectation traces to a line below — the
 * reader states what a file declares and contains, nothing more.
 */

type Obj = { num: number; dict: string; stream?: Buffer };

function buildPdf(objs: Obj[], header = '%PDF-1.3'): Buffer {
  const parts: Buffer[] = [Buffer.from(header + '\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  for (const o of objs) {
    if (o.stream) {
      parts.push(Buffer.from(`${o.num} 0 obj\n<< ${o.dict} /Length ${o.stream.length} >>\nstream\n`, 'latin1'));
      parts.push(o.stream);
      parts.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else {
      parts.push(Buffer.from(`${o.num} 0 obj\n${o.dict}\nendobj\n`, 'latin1'));
    }
  }
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R /Info 9 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(parts);
}

test('a PDF/X-1a-shaped file: pages, inherited MediaBox, TrimBox, declaration, OutputIntent, embedded fonts, no RGB', () => {
  const pdf = buildPdf([
    { num: 1, dict: '<< /Type /Catalog /Pages 2 0 R /OutputIntents [8 0 R] >>' },
    { num: 2, dict: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 432 648] >>' },
    { num: 3, dict: '<< /Type /Page /Parent 2 0 R /TrimBox [0 0 432 648] /Contents 5 0 R >>' },
    { num: 4, dict: '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>' },
    { num: 5, dict: '', stream: Buffer.from('BT /F1 11 Tf 0 0 0 1 k (Hello) Tj ET', 'latin1') },
    { num: 6, dict: '<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+EBGaramond-Regular /FontDescriptor 7 0 R >>' },
    { num: 7, dict: '<< /Type /FontDescriptor /FontName /ABCDEF+EBGaramond-Regular /FontFile2 10 0 R >>' },
    {
      num: 8,
      dict: '<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (CGATS TR 001) /DestOutputProfile 11 0 R >>',
    },
    { num: 9, dict: '<< /GTS_PDFXVersion (PDF/X-1:2001) /GTS_PDFXConformance (PDF/X-1a:2001) /Trapped /False >>' },
    { num: 12, dict: '<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0] >>' },
  ]);
  const r = inspectPdf(pdf);
  assert.equal(r.headerVersion, '1.3');
  assert.equal(r.pageCount, 2);
  assert.deepEqual(r.firstPage.mediaBox, { w: 6, h: 9 });
  assert.deepEqual(r.firstPage.trimBox, { w: 6, h: 9 });
  assert.equal(r.firstPage.bleedBox, null);
  assert.deepEqual(r.pdfx, {
    version: 'PDF/X-1:2001',
    conformance: 'PDF/X-1a:2001',
    outputIntent: true,
    outputCondition: 'CGATS TR 001',
  });
  assert.equal(r.fonts.length, 2);
  assert.deepEqual(r.fonts[0], { name: 'ABCDEF+EBGaramond-Regular', subtype: 'TrueType', embedded: true });
  assert.equal(r.fonts[1].subtype, 'Type3');
  assert.equal(r.fontsAllEmbedded, true);
  assert.deepEqual(r.rgb, { colourSpaceRefs: 0, rgbOperators: 0 });
  assert.equal(r.encrypted, false);
});

test('an unembedded font and RGB in a Flate-compressed content stream are reported, not hidden', () => {
  const content = deflateSync(Buffer.from('q 1 0 0 rg 0 0 10 10 re f Q BT /F1 9 Tf (x) Tj ET', 'latin1'));
  const pdf = buildPdf(
    [
      { num: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
      { num: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      {
        num: 3,
        dict: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 396 612] /Resources << /ColorSpace << /CS0 /DeviceRGB >> >> /Contents 4 0 R >>',
      },
      { num: 4, dict: '/Filter /FlateDecode', stream: content },
      { num: 5, dict: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ],
    '%PDF-1.4',
  );
  const r = inspectPdf(pdf);
  assert.equal(r.pageCount, 1);
  assert.deepEqual(r.firstPage.mediaBox, { w: 5.5, h: 8.5 });
  assert.equal(r.pdfx.version, null);
  assert.equal(r.pdfx.outputIntent, false);
  assert.deepEqual(r.fonts, [{ name: 'Helvetica', subtype: 'Type1', embedded: false }]);
  assert.equal(r.fontsAllEmbedded, false);
  assert.equal(r.rgb.rgbOperators, 1);
  assert.equal(r.rgb.colourSpaceRefs, 1);
});

test('objects packed in a compressed object stream are read; hex UTF-16 strings decode', () => {
  const inner = [
    '<< /Type /Font /Subtype /Type0 /BaseFont /XYZ+Inter /DescendantFonts [21 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /XYZ+Inter /FontDescriptor 22 0 R >>',
    '<< /Type /FontDescriptor /FontName /XYZ+Inter >>',
  ];
  let offs = '';
  let body = '';
  inner.forEach((s, i) => {
    offs += `${20 + i} ${body.length} `;
    body += s + '\n';
  });
  const objstm = Buffer.from(offs + body, 'latin1');
  const first = offs.length;
  const hexVersion = Buffer.from('﻿PDF/X-3:2002', 'utf16le');
  hexVersion.swap16();
  const pdf = buildPdf([
    { num: 1, dict: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, dict: '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>' },
    { num: 3, dict: '<< /Type /Page /Parent 2 0 R >>' },
    { num: 9, dict: `<< /GTS_PDFXVersion <${hexVersion.toString('hex')}> >>` },
    { num: 30, dict: `/Type /ObjStm /N 3 /First ${first} /Filter /FlateDecode`, stream: deflateSync(objstm) },
  ]);
  const r = inspectPdf(pdf);
  assert.equal(r.pdfx.version, 'PDF/X-3:2002');
  // Type0 is skipped in favour of its descendant, whose descriptor has
  // no font file: unembedded, and said so.
  assert.deepEqual(r.fonts, [{ name: 'XYZ+Inter', subtype: 'CIDFontType2', embedded: false }]);
  assert.equal(r.fontsAllEmbedded, false);
  assert.deepEqual(r.firstPage.mediaBox, { w: 8.5, h: 11 });
});

test('no fonts is unknown (null), and non-PDF bytes never throw or pass', () => {
  const r = inspectPdf(buildPdf([{ num: 1, dict: '<< /Type /Catalog >>' }]));
  assert.equal(r.fontsAllEmbedded, null);
  assert.equal(r.pageCount, 0);
  const junk = inspectPdf(Buffer.from('<html>not a pdf</html>'));
  assert.equal(junk.headerVersion, null);
  assert.equal(junk.pageCount, 0);
  assert.equal(junk.fontsAllEmbedded, null);
  assert.equal(junk.pdfx.outputIntent, false);
});

test('literal strings honour nested parentheses and escapes', () => {
  assert.equal(pdfStringAfter('<< /Title (A \\(b\\) (c)) >>', 'Title'), 'A (b) (c)');
  assert.equal(pdfStringAfter('<< /Other 1 >>', 'Title'), null);
});
