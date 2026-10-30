import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:importclean — empty, binary and broken files are refused in plain
   words with the desk left as it was; control characters, stray byte-order
   marks, bidi overrides and invisible joiners never reach a title or the
   text; Volume / Book / Part headings become Part dividers. The studio runs
   two async self-checks that feed such files through the Import door;
   server side: their registration and static guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['import.malformed.refused-desk-kept', 'import.weird-chars.clean'];

test('import clean: both self-checks exist in the client and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, `${id} has a reason`);
  }
});

test('import clean: every format is cleaned at the parser door, and the joiners stay in the prose', async () => {
  const html = await clientHtml();
  const parse = html.slice(html.indexOf('function parseManuscript('), html.indexOf('function importFoundList('));
  assert.match(parse, /text = irCleanText\(text\);/);
  const clean = html.slice(html.indexOf('function irCleanText('), html.indexOf('const PART_HEAD_RE'));
  assert.match(clean, /\.replace\(IR_CONTROLS, ""\)/);
  assert.match(clean, /isSegmentBoundary\(bare\)/, 'invisible characters are taken only from heading lines');
});

test('import clean: an empty or binary text file and a broken Word file are refused in plain words', async () => {
  const html = await clientHtml();
  const door = html.slice(html.indexOf('const IMPORT_DOCX_BROKEN'), html.indexOf('function initImport(')); /* BEUK:onereader — the refusals live in the one reader now */
  assert.match(door, /That file is empty/);
  assert.match(door, /does not look like text/);
  assert.match(door, /could not be read as a Word document/);
});

/* BEUK:importreplace — an import clears everything old, and asks first. */
test('import replace: the self-check is registered, the desk is cleared whole, and the warning reads in all thirteen packs', async () => {
  const html = await clientHtml();
  const id = 'import.replace.warns-and-clears';
  assert.ok(html.includes(`{ id: "${id}"`));
  const c = SELF_CHECK_CASES.find((x) => x.id === id);
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
  const repl = html.slice(html.indexOf('function replaceBodyChapters('), html.indexOf('async function readDocxCoreIdentity('));
  assert.match(repl, /autoSnapshot\("import"\);[\s\S]{0,700}applyBookDoc\(buildEmptyBook\(\), \{ keepHistory: true \}\);/);
  assert.doesNotMatch(repl, /displacingSample/, 'no path merges an import into an old desk');
  for (const k of ['import.replaceTitle', 'import.replaceBody', 'import.replaceYes', 'import.replaceNo']) {
    assert.equal((html.match(new RegExp(`"${k.replace('.', '\.')}": "`, 'g')) || []).length, 13, k);
  }
  const door = html.slice(html.indexOf('async function readImportFile('), html.indexOf('function initImport(')); /* BEUK:onereader — the refusals live in the one reader now */
  assert.match(door, /askFirst\(\)/);
});

test('import replace: the look (typography) is the writer\'s and stays through an import', async () => {
  const html = await clientHtml();
  const repl = html.slice(html.indexOf('function replaceBodyChapters('), html.indexOf('async function readDocxCoreIdentity('));
  assert.match(repl, /const keepLook = \{ theme: Object\.assign\(\{\}, state\.theme\), activePreset: state\.activePreset \}/);
  assert.match(repl, /state\.theme = keepLook\.theme; state\.activePreset = keepLook\.activePreset;/);
});
