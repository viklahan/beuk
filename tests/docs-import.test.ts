import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:docsimport — OpenDocument (.odt) and web-page (.html, alone or
   zipped with its pictures) manuscripts: the two downloads Google Docs
   offers that Beuk could not read. Each is turned into the HTML a Word file
   becomes and goes down the Word import, so it follows every rule that
   import follows. The readers need a browser's DOM, so their behaviour is
   checked by two studio self-checks; server side: their registration and
   static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['import.odt.reads-as-word', 'import.html.google-docs-page'];

test('docs import: both self-checks exist in the client and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, `${id} has a reason`);
  }
});

test('docs import: neither format has a parser of its own — both go down the Word import, named as the file they were', async () => {
  const html = await clientHtml();
  const door = html.slice(html.indexOf('async function readImportFile('), html.indexOf('const ZIP_MAX_FILES'));
  assert.match(door, /if \(lower\.endsWith\("\.odt"\)\) \{[\s\S]{0,900}rd = await odtRead\(await file\.arrayBuffer\(\)\);[\s\S]{0,900}return \(\) => importDocxConverted\(name, rd\.html, rd\.messages, rd\.scan, rd\.identity, det, "odt"\);/);
  assert.match(door, /if \(lower\.endsWith\("\.html"\) \|\| lower\.endsWith\("\.htm"\)\) \{[\s\S]{0,600}rd = await htmlRead\(await file\.text\(\), file\.beukAssets \|\| \[\]\);[\s\S]{0,600}return \(\) => importDocxConverted\(name, rd\.html, rd\.messages, rd\.scan, rd\.identity, det, "html"\);/);
  const block = /\/\* ==== BEUK:docsimport ==== \*\/([\s\S]*?)\/\* ==== \/BEUK:docsimport ==== \*\//.exec(html);
  assert.ok(block, 'the BEUK:docsimport block is in the studio');
  assert.doesNotMatch(block[1], /parseManuscript\(|splitSegments\(|replaceBodyChapters\(/, 'the readers only convert; the import is the Word one');
  assert.match(html, /const ir = irBegin\(name, format \|\| "docx"\);/);
  /* a refused file leaves the desk alone, in plain words: never a zip or XML library's own */
  assert.match(door, /could not be read as an OpenDocument text file/);
  assert.match(door, /locked with a password/);
});

test('docs import: every studio file picker, the bulk reader and a zip take the new formats', async () => {
  const html = await clientHtml();
  for (const id of ['fileInput', 'bulkFileInput', 'boxSetFileInput']) {
    const m = new RegExp(`id="${id}" accept="([^"]*)"`).exec(html);
    assert.ok(m, id);
    for (const ext of ['.odt', '.html', '.htm']) assert.ok(m[1].split(',').includes(ext), `${id} takes ${ext}`);
  }
  assert.match(html, /const BULK_MANUSCRIPT_EXT = \[[^\]]*"\.odt", "\.html", "\.htm"/);
  /* a zipped web page is opened with its pictures, which ride on the file to the reader */
  assert.match(html, /importExpandZips\(\[\{ file, path: name \}\], \{ accept: \(nm\) => bulkIsManuscript\(nm\) \|\| bulkIsImage\(nm\) \}\)/);
  assert.match(html, /if \(\/\\\.html\?\$\/i\.test\(name\)\) target\.beukAssets = ex\.entries\.filter\(\(e\) => bulkIsImage\(e\.file\.name\)\);/);
  assert.match(html, /That zip holds no manuscript Beuk can read \(\.docx, \.odt, \.rtf, \.html, \.pdf, \.epub, \.md or \.txt\)\./);
});

test('docs import: the report names the file it was, and the bulk lists name the formats, in all 13 locales', async () => {
  const html = await clientHtml();
  const vals = (k: string) => [...html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "([^"]+)"`, 'g'))].map((m) => m[1]);
  for (const [k, word] of [['ir.why.sourceOdt', 'OpenDocument'], ['ir.why.sourceHtml', 'HTML'], ['ir.k.commentsOdt', 'OpenDocument'], ['ir.k.commentsOdtPlural', 'OpenDocument']] as const) {
    const v = vals(k);
    assert.equal(v.length, 13, `${k} in 13 locales`);
    for (const s of v) {
      assert.ok(s.includes(word), `${k}: ${s}`);
      assert.doesNotMatch(s, /RTF|Word/, `${k}: ${s}`);
      if (k.startsWith('ir.k.')) assert.ok(s.includes('{n}'), `${k} keeps {n}`);
    }
  }
  for (const k of ['bulk.reasonUnsupported', 'bulk.emptyBatch']) {
    const v = vals(k);
    assert.equal(v.length, 13, `${k} in 13 locales`);
    for (const s of v) assert.ok(s.includes('.odt') && s.includes('.html'), `${k}: ${s}`);
  }
  assert.match(html, /d\.rtf \? "ir\.k\.commentsRtf" : d\.odt \? "ir\.k\.commentsOdt" : "ir\.k\.comments"/);
});
