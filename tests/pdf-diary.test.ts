import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:pdfdiary — The Raven from Darkness quotes a diary in 13.5 point
   against an 11 point text: every line was a "big" heading and chapter 26
   became nine chapters. A larger size alone never makes a heading of
   running text: a wrapped sentence, a line carried over a page break, or a
   full sentence stays text. The studio runs one self-check on a synthetic
   PDF of that shape; server side: its registration and guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const ID = 'pdf.diary.larger-text-is-prose';

test('pdf diary: the self-check exists and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes(`{ id: "${ID}"`));
  const c = SELF_CHECK_CASES.find((x) => x.id === ID);
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('pdf diary: a big line is a heading only when it is not running text', async () => {
  const html = await clientHtml();
  const lay = html.slice(html.indexOf('function pdfLayout(ext)'), html.indexOf('function pdfIdentity('));
  assert.match(lay, /const runningText = \(l, q, c\) =>/, 'the layout judges a big line as running text first');
  assert.match(lay, /!runningText\(l, q, c\) && l\.size >= body \* 1\.22/, 'only a big line that is not running text is a heading');
});
