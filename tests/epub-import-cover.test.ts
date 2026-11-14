import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* BEUK:epubcover — Beuk's EPUB export ships the cover as Images/cover.ext
   with properties="cover-image", a cover page and a nav landmark; but the
   EPUB reader skipped the cover page (EPUBIN_SKIP) and never set book.cover,
   so a round trip (or any EPUB with a cover) lost its cover. The import now
   lifts the declared cover-image back into book.cover. Source assertions,
   the studio's idiom; the behavior is exercised by the round-trip self-check. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('epubcover: epubRead extracts the declared cover-image and returns it', async () => {
  const html = await clientHtml();
  const fn = html.slice(html.indexOf('async function epubRead('), html.indexOf('function epubBlocks('));
  assert.ok(fn.length > 0, 'epubRead present');
  assert.match(fn, /cover-image/, 'epubRead locates the declared cover-image item');
  assert.match(fn, /return \{ meta, docs, images, cover \}/, 'epubRead returns the extracted cover alongside pages and images');
});

test('epubcover: importEpubRead sets book.cover from the extracted cover', async () => {
  const html = await clientHtml();
  const fn = html.slice(html.indexOf('function importEpubRead('), html.indexOf('/* ==== /BEUK:epubimport ==== */'));
  assert.ok(fn.length > 0, 'importEpubRead present');
  assert.match(fn, /rd\.cover/, 'importEpubRead reads the extracted cover');
  assert.match(fn, /state\.cover = \{/, 'and sets it as the book cover');
});
