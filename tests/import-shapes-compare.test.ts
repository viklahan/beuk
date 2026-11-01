import assert from 'node:assert/strict';
import { test } from 'node:test';
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
