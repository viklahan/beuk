import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:importzones — a book that numbers its chapters says what a chapter
   is: its title-page headings, dedication, author's note and introduction
   are front matter, its appendix and sneak peek back matter. The parser
   runs in the studio (three self-checks); server side: their registration
   and static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['import.zones.numbered-book', 'import.zones.back-order', 'import.zones.unnumbered-book-unchanged'];

test('import zones: the self-checks exist in the client and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, `${id} has a reason`);
  }
});

test('import zones: only numbered books are zoned, and a contents line is no anchor', async () => {
  const html = await clientHtml();
  const parse = html.slice(html.indexOf('function parseManuscript('), html.indexOf('function importFoundList('));
  assert.match(parse, /if \(zoneNumbered\.length >= 2\)/);
  assert.match(parse, /it\.cls === "chapter" && it\.head\.number && it\.bodyText/);
});

test('import zones: Appendix is a back-matter type with a label in all thirteen language packs and an EPUB type', async () => {
  const html = await clientHtml();
  assert.equal((html.match(/"import\.type\.appendix": "/g) || []).length, 13);
  assert.match(html, /"appendix": \{ kind: "back", type: "appendix", title: "Appendix" \}/);
  assert.match(html, /appendix: "appendix"/);
  assert.match(html, /back: \{ appendix: 0, acknowledgments: 1/);
});

test('import zones: the copyright page keeps its disclaimer, edition line and printer\'s key', async () => {
  const html = await clientHtml();
  const cp = html.slice(html.indexOf('function isCopyrightBlock('), html.indexOf('const isQuoteBlock'));
  assert.match(cp, /work of fiction/);
  assert.match(cp, /edition\|printing\|published/);
});
