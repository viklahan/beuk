import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:pdfback — The sample's print round trip (tools/roundtrip) found the
   PDF import losing what Beuk itself prints: a chapter's italic subtitle
   (read as its first line), a sub-heading (read as a chapter), the notes
   under NOTES at a chapter's end (left as paragraphs, their raised marks as
   digits), the monospace log (taken for a table and left out) and the
   sideways tide table (turned text, dropped). The studio runs
   pdf.beuk-print-back on laid-out pages; server side: registration,
   guards, and the tool printing what the studio prints. */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const clientHtml = () => readFile(path.join(root, 'client', 'index.html'), 'utf8');

test('pdf print back: the self-check is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('{ id: "pdf.beuk-print-back"'));
  const c = SELF_CHECK_CASES.find((x) => x.id === 'pdf.beuk-print-back');
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('pdf print back: the reader and the layout carry each piece', async () => {
  const html = await clientHtml();
  assert.match(html, /\(pg\.turned = pg\.turned \|\| \[\]\)\.push/, 'turned text is kept aside, not dropped');
  assert.match(html, /mono: \/mono\|courier\|consol\|menlo\|typewriter\/i/, 'monospace is known');
  const lay = html.slice(html.indexOf('function pdfLayout(ext)'), html.indexOf('function pdfIdentity('));
  assert.match(lay, /!ls\[r\]\.head && !ls\[r\]\.mono\) r\+\+/, 'a monospace run is never a table');
  assert.match(lay, /\/\^notes\$\/i\.test\(l\.text\.replace/, 'the NOTES block is read');
  assert.match(lay, /kind: "subtitle"/, 'a subtitle is read');
  assert.match(lay, /b\.kind = "sub";/, 'a smaller mid-chapter heading is a sub-heading');
  assert.match(html, /else if \(b\.kind === "sub"\) \{ ir\.subs\.push/, 'the import keeps sub-headings inside their chapter');
});

test('pdf print back: the round-trip tool prints the sample as the studio does', async () => {
  const tool = await readFile(path.join(root, 'tools', 'roundtrip', 'sample-pdf.mjs'), 'utf8');
  assert.match(tool, /await samplePicsEnsure\(\)/, "the sample's pictures are fetched first");
  assert.match(tool, /BASE \+ '\/__roundtrip-sheet\.html'/, "the sheet is printed from the studio's own origin, at its root");
});
