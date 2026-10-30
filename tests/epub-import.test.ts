import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:epubimport — Beuk had no way to bring an EPUB in, so its own EPUB
   could not be checked by a round trip. The Import button now reads one:
   the package for the credit and reading order, each page by what it says
   it is (Beuk's own markup exactly), the rest by its headings. The studio
   runs sample.roundtrip.epub and import.epub.reads-any-epub; server side:
   registration and guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['sample.roundtrip.epub', 'import.epub.reads-any-epub'];

test('epub import: both self-checks exist and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), id);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, id);
    assert.equal(c!.kind, 'client-only');
    assert.ok(c!.reason && c!.reason.length > 10);
  }
});

test('epub import: the Import button takes an EPUB and reads it through the import report', async () => {
  const html = await clientHtml();
  assert.match(html, /id="fileInput" accept="[^"]*\.epub[^"]*application\/epub\+zip/, 'the file picker offers .epub');
  assert.match(html, /if \(lower\.endsWith\("\.epub"\)\) \{ \/\* BEUK:epubimport \*\//, 'readImportFile reads an EPUB');
  assert.match(html, /return \(\) => importEpubRead\(name, rd\);/, 'the import runs through the report and its undo');
  assert.match(html, /const ir = irBegin\(name, "epub"\);/);
  assert.match(html, /protected by DRM/, 'a book under DRM is refused, never read as garbage');
});

test('epub import: the round-trip comparison counts words as Beuk does', async () => {
  const html = await clientHtml();
  assert.match(html, /words: countWords\(String\(s\.content \|\| ""\)\)/);
});
