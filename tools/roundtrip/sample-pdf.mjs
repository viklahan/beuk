// The sample's print round trip (inside the pinned Playwright image; host
// side: node tools/roundtrip/run.mjs). The studio loads The Lantern Coast,
// prepares and builds its print interior exactly as the Print Interior PDF
// export does, Chromium prints it to PDF (the browser's own print, as a
// writer's Save as PDF would), and the studio's PDF import reads it back.
// The comparison is the studio's own (window.beukSampleRoundTrip, the same
// one the in-studio check sample.roundtrip.word uses): every body section in
// order with its type, title and footnotes, words within 2%, nothing extra.
// Output: out/sample-pdf.json; the exit code is 0 only when nothing differs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/');
const { chromium } = require('playwright');
const BASE = process.env.RT_BASE || 'http://localhost:8090';

const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block' });
let pdf = null, sheetHtml = '';
await ctx.route('**/__roundtrip/sample.pdf', (r) => r.fulfill({ body: pdf, contentType: 'application/pdf' }));
/* The print interior is printed from the studio's own origin, as the
   studio prints it, so its fonts and pictures load exactly as a writer's do. */
await ctx.route('**/__roundtrip-sheet.html', (r) => r.fulfill({ body: sheetHtml, contentType: 'text/html; charset=utf-8' }));
const studio = await ctx.newPage();
const errors = [];
studio.on('pageerror', (e) => errors.push(String(e.message || e)));
await studio.goto(BASE + '/studio');
await studio.waitForFunction(() => window.beukSampleRoundTrip && window.beukPdfImport && typeof buildSampleBook === 'function', null, { timeout: 60000 });

const { want, html, pictures } = await studio.evaluate(async () => {
  /* The sample's pictures are files of their own, fetched as Load fetches them. */
  const pictures = await samplePicsEnsure();
  applyBookDoc(buildSampleBook());
  const want = window.beukSampleRoundTrip.shape(state.sections);
  await preparePrintPress();
  return { want, html: buildPrintHtml(), pictures };
});
sheetHtml = html;
const sheet = await ctx.newPage();
await sheet.goto(BASE + '/__roundtrip-sheet.html', { waitUntil: 'load' });
await sheet.evaluate(() => document.fonts.ready);
pdf = await sheet.pdf({ preferCSSPageSize: true, printBackground: true });
await sheet.close();

const result = await studio.evaluate(async (want) => {
  applyBookDoc(buildEmptyBook());
  const data = new Uint8Array(await (await fetch('/__roundtrip/sample.pdf')).arrayBuffer());
  const res = await window.beukPdfImport.importData('the-lantern-coast.pdf', data);
  const got = window.beukSampleRoundTrip.shape(state.sections);
  return { imported: !!res.ok, why: res.why || '', got, differences: res.ok ? window.beukSampleRoundTrip.diff(want, got) : ['the PDF did not import: ' + (res.why || '')] };
}, want);
await browser.close();

const out = { at: new Date().toISOString(), base: BASE, pictures, pdfBytes: pdf.length, sent: want.length, got: result.got.length, differences: result.differences, pageErrors: errors, want, gotSections: result.got };
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
if (process.env.RT_KEEP_PDF) writeFileSync(new URL('./out/sample.pdf', import.meta.url), pdf);
writeFileSync(new URL('./out/sample-pdf.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(result.differences.length ? `sample PDF round trip: ${result.differences.length} difference(s)\n  ` + result.differences.join('\n  ') : `sample PDF round trip: all ${want.length} body sections came back whole`);
process.exit(result.differences.length || errors.length ? 1 : 0);
