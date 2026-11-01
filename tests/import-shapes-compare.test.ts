import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareBoxSetNav } from '../scripts/import-shapes/boxset.js';
import { compareBook, countBreaks, readNumber, type Book10 } from '../scripts/import-shapes/compare.js';
import type { Expected } from '../scripts/import-shapes/shape.js';

/* The import-shapes comparator: a 1.0 book (serializeBook's output, as the
   studio saves it) against a shape's expected structure. Pure; the grid
   itself runs in Chromium (npm run import-shapes:run). */

const sec = (kind: string, type: string, title: string, number = '', content = 'Some text.') => ({ kind, type, title, number, content });
const scaffold = () => [sec('front', 'titlepage', 'Title Page', '', ''), sec('front', 'copyright', 'Copyright', '', '')];
const book = (sections: Book10['sections'], meta: Record<string, unknown> = {}): Book10 => ({ meta: { title: 'Salt and Rope', author: 'A. Writer', ...meta }, sections });
const twoChapters: Expected = {
  meta: { title: 'Salt and Rope', author: 'A. Writer' },
  sections: [
    { kind: 'body', type: 'chapter', number: 1, title: 'The Harbour', breaks: 1 },
    { kind: 'body', type: 'chapter', number: 2, title: '' },
  ],
};

test('identical book passes', () => {
  const r = compareBook(twoChapters, book([...scaffold(), sec('body', 'chapter', 'the harbour ', '1', 'a\n\n***\n\nb'), sec('body', 'chapter', '', '2')]));
  assert.deepEqual(r, { ok: true, diff: null });
});

test('stored "Chapter 3" fails expected "" (untitled)', () => {
  const r = compareBook(twoChapters, book([sec('body', 'chapter', 'The Harbour', '1', 'a\n\n***\n\nb'), sec('body', 'chapter', 'Chapter 2', '2')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /untitled/);
  assert.match(r.diff ?? '', /Chapter 2/);
});

test('extra body section fails', () => {
  const r = compareBook(twoChapters, book([sec('body', 'chapter', 'The Harbour', '1', '***'), sec('body', 'chapter', '', '2'), sec('body', 'chapter', 'O', '3')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /extra/);
});

test('filled front section not in expected fails', () => {
  const r = compareBook(twoChapters, book([sec('front', 'toc', 'Contents', '', 'Chapter 1 .... 3'), sec('body', 'chapter', 'The Harbour', '1', '***'), sec('body', 'chapter', '', '2')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /front/);
});

test('empty scaffold front sections are ignored', () => {
  const r = compareBook({ sections: [{ kind: 'body', title: 'Only' }] }, book([...scaffold(), sec('body', 'chapter', 'Only'), sec('back', 'aboutauthor', 'About the Author', '', '  ')]));
  assert.equal(r.ok, true, r.diff ?? '');
});

test('an expected front section is compared even when empty', () => {
  const r = compareBook({ sections: [{ kind: 'front', type: 'dedication' }, { kind: 'body' }] }, book([sec('front', 'dedication', 'Dedication', '', ''), sec('body', 'chapter', 'X')]));
  assert.equal(r.ok, true, r.diff ?? '');
});

test('number "ONE", "I.", "21", "Twenty-One" read as 1, 1, 21, 21', () => {
  assert.deepEqual(['ONE', 'I.', '21', 'Twenty-One', 'xlii', ''].map(readNumber), [1, 1, 21, 21, 42, null]);
  assert.ok(Number.isNaN(readNumber('Chapter')));
});

test('breaks counted only for whole-block markers', () => {
  assert.equal(countBreaks('a\n\n***\n\nb\n\n❦\n\nc'), 2);
  assert.equal(countBreaks('a *** b'), 0);
  assert.equal(countBreaks('a\n  \n⁂\n\nb'), 1);
});

test('mustNotAppear found in content fails', () => {
  const r = compareBook({ sections: [{ kind: 'body' }], mustNotAppear: ['Contents'] }, book([sec('body', 'chapter', 'X', '1', 'CONTENTS\nOne ..... 1')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /Contents/);
});

test('seriesLine matches subtitle or series', () => {
  const e: Expected = { meta: { seriesLine: 'A Moss & Wren Story' }, sections: [{ kind: 'body' }] };
  assert.equal(compareBook(e, book([sec('body', 'chapter', 'X')], { subtitle: 'a moss & wren story' })).ok, true);
  assert.equal(compareBook(e, book([sec('body', 'chapter', 'X')], { series: 'A Moss & Wren Story' })).ok, true);
  assert.equal(compareBook(e, book([sec('body', 'chapter', 'X')])).ok, false);
});

test('field left out is not compared', () => {
  const r = compareBook({ sections: [{ kind: 'front', title: 'A Note from the Author' }, { kind: 'body' }] }, book([sec('front', 'preface', 'A note from the author'), sec('body', 'chapter', 'X')]));
  assert.equal(r.ok, true, r.diff ?? '');
});

test('meta author mismatch fails', () => {
  const r = compareBook({ meta: { author: 'B. Other' }, sections: [{ kind: 'body' }] }, book([sec('body', 'chapter', 'X')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /author/);
});

/* ---- the box set cell: the combined EPUB's nav, one part per book ---- */

const nav = (vols: [string, string[]][]) =>
  '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Table of Contents</title></head><body>\n'
  + '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n'
  + vols.map(([t, entries]) => `  <li><a href="d.xhtml">${t}</a><ol>\n` + ['Title Page', ...entries].map((e) => `    <li><a href="x.xhtml">${e}</a></li>`).join('\n') + '\n  </ol></li>').join('\n')
  + '\n</ol></nav>\n<nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="toc" href="nav.xhtml">Contents</a></li></ol></nav>\n</body></html>';
const vol = (title: string, chapters: string[]): Expected => ({ meta: { title }, sections: chapters.map((c, i) => ({ kind: 'body', type: 'chapter', number: i + 1, title: c })) });
const VOLS = [vol('One', ['The Harbour', 'The Storm']), vol('Two', ['The Field']), vol('Three', ['The Harbour'])];

test('box set nav with three volumes in order passes', () => {
  const r = compareBoxSetNav(nav([['One', ['Chapter 1 · The Harbour', 'Chapter 2 · The Storm', 'About the Author']], ['Two', ['Chapter 1 · The Field']], ['Three', ['A Note', 'Chapter 1 · The Harbour']]]), VOLS);
  assert.deepEqual(r, { ok: true, diff: null });
});

test('a chapter under the wrong volume fails', () => {
  const r = compareBoxSetNav(nav([['One', ['Chapter 1 · The Harbour']], ['Two', ['Chapter 1 · The Storm', 'Chapter 2 · The Field']], ['Three', ['Chapter 1 · The Harbour']]]), VOLS);
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /book 1/);
});

test('a missing volume fails', () => {
  const r = compareBoxSetNav(nav([['One', ['Chapter 1 · The Harbour', 'Chapter 2 · The Storm']], ['Two', ['Chapter 1 · The Field']]]), VOLS);
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /3 books/);
});

test('a volume titled from its file name fails', () => {
  const r = compareBoxSetNav(nav([['One', ['Chapter 1 · The Harbour', 'Chapter 2 · The Storm']], ['dropcap', ['Chapter 1 · The Field']], ['Three', ['Chapter 1 · The Harbour']]]), VOLS);
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /dropcap/);
});

/* ---- content checks (final review: a cell must not pass on a book that lost its text) ---- */
test('contains: a named front section left empty fails', () => {
  const e: Expected = { sections: [{ kind: 'front', type: 'dedication', contains: ['For my sister'] }, { kind: 'body' }] };
  const r = compareBook(e, book([sec('front', 'dedication', 'Dedication', '', ''), sec('body', 'chapter', 'X', '1', 'For my sister, who kept the lamp lit.')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /For my sister/);
});

test('contains matches across rewrapped lines', () => {
  const e: Expected = { sections: [{ kind: 'body', contains: ['How many have no sail at all? ____'] }] };
  assert.equal(compareBook(e, book([sec('body', 'chapter', 'X', '1', 'How many have\nno sail at all?  ____')])).ok, true);
});

test('contains: blanks stripped from a worksheet fail', () => {
  const e: Expected = { sections: [{ kind: 'body', contains: ['painted ____ and ____.'] }] };
  assert.equal(compareBook(e, book([sec('body', 'chapter', 'X', '1', 'The lighthouse is painted and .')])).ok, false);
});

test('lacks: the dedication left inside chapter 1 fails', () => {
  const e: Expected = { sections: [{ kind: 'body', lacks: ['For my sister'] }] };
  const r = compareBook(e, book([sec('body', 'chapter', 'The Orchard', '1', 'For my sister, who kept the lamp lit.\n\nThe orchard...')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /must not hold/);
});

test('an empty no-headings import fails its contains', () => {
  const e: Expected = { sections: [{ kind: 'body', type: 'chapter', title: '', breaks: 0, contains: ['first sentence here'] }] };
  assert.equal(compareBook(e, book([sec('body', 'chapter', '', '', '')])).ok, false);
});

test('minWords: a section that lost most of its text fails', () => {
  const e: Expected = { sections: [{ kind: 'body', minWords: 5 }] };
  assert.equal(compareBook(e, book([sec('body', 'chapter', 'X', '1', 'one two three four five')])).ok, true);
  const r = compareBook(e, book([sec('body', 'chapter', 'X', '1', 'one two')]));
  assert.equal(r.ok, false);
  assert.match(r.diff ?? '', /2 words/);
});

test('box set: a stray part or untitled body entry under a volume fails', () => {
  const ok = [['One', ['Chapter 1 · The Harbour', 'Chapter 2 · The Storm']], ['Two', ['Chapter 1 · The Field']], ['Three', ['Chapter 1 · The Harbour']]] as [string, string[]][];
  const withPart = ok.map(([t, e], i) => [t, i === 1 ? ['Part 1 · Stray', ...e] : e]) as [string, string[]][];
  assert.equal(compareBoxSetNav(nav(withPart), VOLS).ok, false);
  const withUntitled = ok.map(([t, e], i) => [t, i === 1 ? [...e, 'Chapter 2 · Untitled'] : e]) as [string, string[]][];
  assert.equal(compareBoxSetNav(nav(withUntitled), VOLS).ok, false);
});
