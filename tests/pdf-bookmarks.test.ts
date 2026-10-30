import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:pdfmarks — The Cheese Bandit Diaries sets its 42 dated entries 14.5
   against a 12.5 text: no size or bold rule made them headings, and the
   book came in as four month-long chapters. The Frost Line's part page
   right after the contents was taken for more contents and lost. Both
   books name every one of these in their bookmarks; the import now reads
   them. The studio runs two self-checks (one on laid-out pages, one on a
   PDF written in the check); server side: their registration and guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['pdf.bookmarks.name-the-headings', 'pdf.bookmarks.read-with-their-pages'];

test('pdf bookmarks: both self-checks exist and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), id);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, id);
    assert.equal(c!.kind, 'client-only');
    assert.ok(c!.reason && c!.reason.length > 10);
  }
});

test('pdf bookmarks: the reader keeps them and the layout uses them', async () => {
  const html = await clientHtml();
  assert.match(html, /out\.outline = await pdfWait\(pdfOutline\(doc\)/, 'pdfExtract reads the bookmarks');
  const lay = html.slice(html.indexOf('function pdfLayout(ext)'), html.indexOf('function pdfIdentity('));
  assert.match(lay, /\(ext\.outline \|\| \[\]\)\.forEach/, 'the layout reads the bookmarks');
  assert.match(lay, /markPages\.has\(p\.n\) \|\| display/, 'a bookmarked page or a display heading ends the contents');
  assert.doesNotMatch(lay, /_pages: pages/, 'no debugging hook left in the layout');
});
