import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:roundtrip — The Lantern Coast carries every chapter feature Beuk
   sets (Parts, letter, texts, verse, lists, transcript, log, insert,
   margin note, columns, sideways, upside-down, hanging, centre and right,
   quotes with attribution, sub-headings, redaction, links, footnotes, a
   plate caption, a dated diary inside a chapter). It goes out and comes
   back in: to Word in the studio (sample.roundtrip.word) and to print PDF
   through Chromium in tools/roundtrip, both judged by one comparison.
   Server side: the registration, the shared comparison and the tool. */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const clientHtml = () => readFile(path.join(root, 'client', 'index.html'), 'utf8');

test('sample round trip: the Word check is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('{ id: "sample.roundtrip.word"'));
  const c = SELF_CHECK_CASES.find((x) => x.id === 'sample.roundtrip.word');
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('sample round trip: one comparison serves the Word check and the print tool', async () => {
  const html = await clientHtml();
  assert.match(html, /window\.beukSampleRoundTrip = \{ shape: sampleRtShape, diff: sampleRtDiff \}/);
  const tool = await readFile(path.join(root, 'tools', 'roundtrip', 'sample-pdf.mjs'), 'utf8');
  assert.match(tool, /window\.beukSampleRoundTrip\.shape/);
  assert.match(tool, /window\.beukSampleRoundTrip\.diff/);
  assert.match(tool, /preparePrintPress\(\)/, 'the tool prints what the Print Interior export prints');
  assert.ok(existsSync(path.join(root, 'tools', 'roundtrip', 'run.mjs')));
});

test('sample round trip: the sample carries the features it is meant to carry', async () => {
  const html = await clientHtml();
  const at = html.indexOf('const SAMPLE_SECTIONS = ') + 'const SAMPLE_SECTIONS = '.length;
  const line = html.slice(at, html.indexOf('\n', at)).replace(/;\s*$/, '');
  const sections = JSON.parse(line) as Array<{ type: string; content: string }>;
  const text = sections.map((s) => s.content).join('\n');
  assert.equal(sections.filter((s) => s.type === 'part').length, 3, 'three Parts');
  for (const kind of ['letter', 'texts', 'verse', 'transcript', 'log', 'insert', 'margin', 'columns', 'sideways', 'upside-down', 'hanging', 'center', 'right'])
    assert.match(text, new RegExp('^::: ' + kind + '\\b', 'm'), kind);
  assert.match(text, /^- /m, 'a bulleted list');
  assert.match(text, /^1\. /m, 'a numbered list');
  assert.match(text, /^> — /m, 'a quote with its attribution');
  assert.match(text, /^# /m, 'a sub-heading');
  assert.match(text, /\|\|[^|]+\|\|/, 'a redaction');
  assert.match(text, /\]\(https:\/\//, 'a link');
  assert.match(text, /^\[\^\d+\]:/m, 'a footnote');
  assert.match(text, /img:sample-img-chart\|full "/, 'a plate caption');
});
