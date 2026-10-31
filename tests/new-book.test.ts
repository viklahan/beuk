import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:newbook — Start a new book: the desk is cleared for a new book, the
   old one kept in History first and left on the shelf, never saved over.
   The studio runs book.new.keeps-the-old-in-history; server side: the
   registration, the command's order of steps, and its words in every pack. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');

test('new book: the self-check exists and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('{ id: "book.new.keeps-the-old-in-history"'));
  const c = SELF_CHECK_CASES.find((x) => x.id === 'book.new.keeps-the-old-in-history');
  assert.ok(c);
  assert.equal(c!.kind, 'client-only');
});

test('new book: History first, then unlink from the shelf, then the empty desk', async () => {
  const html = await clientHtml();
  const fn = html.slice(html.indexOf('function startNewBookNow()'), html.indexOf('function startNewBook()'));
  const snap = fn.indexOf('takeSnapshot('), unlink = fn.indexOf('cloud.linkedId = null'), empty = fn.indexOf('applyBookDoc(buildEmptyBook(), { keepHistory: true })');
  assert.ok(snap !== -1 && unlink !== -1 && empty !== -1, 'all three steps are there');
  assert.ok(snap < unlink && unlink < empty, 'the snapshot is taken before anything changes, and the desk is unlinked before it is emptied');
  assert.match(html, /id="btnNewBook"/);
});

test('new book: its words are in all thirteen language packs', async () => {
  const html = await clientHtml();
  for (const key of ['newbook.btn', 'newbook.title', 'newbook.confirmTitle', 'newbook.confirmBody', 'newbook.confirmBodyShelf', 'newbook.yes', 'newbook.no', 'newbook.done', 'newbook.already', 'newbook.snap'])
    assert.equal((html.match(new RegExp(`"${key.replace('.', '\\.')}": "[^"]+"`, 'g')) ?? []).length, 13, key);
});
