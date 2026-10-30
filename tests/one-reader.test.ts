import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:onereader — every way a manuscript arrives (the Import button, a box
   set, a bulk import, a zip) reads it the same way: one reader opens and
   checks the file, the single import's own pipeline makes the book (in a
   sandbox for bulk and box sets), and a zip opens into its files. The
   studio runs five self-checks; server side: registration and guards. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['import.onereader.bulk-parity', 'import.zip.mixed-bulk', 'boxset.zip-and-pdf', 'import.zip.single', 'import.short-note.is-the-text'];

test('one reader: the self-checks exist and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), id);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, id);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, id);
  }
});

test('one reader: bulk and box sets make books through the Import button\'s own reader, never the old splitter', async () => {
  const html = await clientHtml();
  const prep = html.slice(html.indexOf('function bulkPrepareEntries('), html.indexOf('function bulkShelfFingerprints('));
  assert.ok(prep.includes('readImportFile(file)'));
  const build = html.slice(html.indexOf('function bulkBuildBook('), html.indexOf('function bulkRunQueue('));
  assert.ok(build.includes('importSandboxed('));
  assert.ok(!build.includes('splitIntoChapters('));
  const vol = html.slice(html.indexOf('async function manuscriptFileToVolume('), html.indexOf('/* ==== /BEUK:boxsetvols ==== */'));
  assert.ok(vol.includes('manuscriptFileToBookDoc(file)'));
  assert.ok(!vol.includes('splitIntoChapters('));
});

test('one reader: the sandbox quiets saving, writing credit, toasts and History, and restores them', async () => {
  const html = await clientHtml();
  const sb = html.slice(html.indexOf('function importSandboxed('), html.indexOf('async function manuscriptFileToBookDoc('));
  for (const h of ['toast', 'noteBookEdited', 'markWritingActivity', 'autoSnapshot']) assert.ok(sb.includes(`"${h}"`), h);
  assert.ok(sb.includes('applyBookDoc(keepDoc, { keepHistory: true });'));
  assert.ok(sb.includes('cloudDirty = keepDirty;'));
});

test('one reader: zips are accepted by all three pickers and opened with limits', async () => {
  const html = await clientHtml();
  for (const id of ['fileInput', 'bulkFileInput', 'boxSetFileInput']) {
    const m = html.match(new RegExp(`id="${id}" accept="([^"]+)"`));
    assert.ok(m && m[1].includes('.zip') && m[1].includes('.pdf'), id);
  }
  assert.ok(html.includes('const ZIP_MAX_FILES = 500, ZIP_MAX_BYTES = 400 * 1024 * 1024;'));
  assert.ok(html.includes('__MACOSX'));
});
