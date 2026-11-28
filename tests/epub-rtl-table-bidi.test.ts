import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadEpubClosure } from '../src/book/epub/closure.js';
import { epubState } from '../src/book/epub/state.js';
import { readBook } from '../src/book/read.js';

/* BEUK:table — a right-to-left book's EPUB passes EPUBCheck (2026-11-27).
   EPUB 3.3 6.3.1.2: a CSS style sheet "MUST NOT include the direction
   property" nor "the unicode-bidi property" (EPUBCheck CSS-001). The
   table rules once set `unicode-bidi: plaintext` on a figure column of a
   right-to-left book, and every such book's EPUB failed. A figure is now
   isolated in the markup instead: its words in <span dir="auto">, so
   "+4%" still reads left to right inside a right-to-left table. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');

const TABLE = (head: string[], rows: string[][]) => '::: table header\n' + [head, ...rows].map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n:::';
const book = (language: string, content: string) => ({
  meta: { title: 'Tables', author: 'A. Writer', language, bookId: 'urn:uuid:00000000-0000-4000-8000-000000000451' },
  sections: [
    { id: 't', type: 'titlepage', kind: 'front', title: 'Title Page', content: '' },
    { id: 'ch1', type: 'chapter', kind: 'body', title: 'One', number: '1', content },
  ],
  images: [], cover: null,
});
async function files(raw: unknown) {
  const read = readBook(raw);
  assert.equal(read.status, 'ok');
  return (await loadEpubClosure(html, CLIENT).files(epubState(read.book, 'generic'), { lang: 'en' })).files as { path: string; content: string; binary?: boolean }[];
}
/* the property itself, not flex-direction / animation-direction / a word in a comment */
const FORBIDDEN = /(?:^|[{;\s])(?:unicode-bidi|direction)\s*:/;
const forbiddenIn = (fs: { path: string; content: string }[]) => fs.filter((f) => /\.css$/i.test(f.path))
  .flatMap((f) => String(f.content).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l, i) => [f.path + ':' + (i + 1), l] as const).filter(([, l]) => FORBIDDEN.test(l)).map(([w, l]) => w + ' ' + l.trim()));
const chapter = (fs: { path: string; content: string }[]) => String(fs.find((f) => /Text\/chapter_01\.xhtml$/.test(f.path))?.content ?? '');
const numCells = (x: string) => x.match(/<t[hd][^>]*class="num[^"]*"[^>]*>.*?<\/t[hd]>/g) ?? [];

const RTL_BOOKS: [string, string, string[], string[][]][] = [
  ['ar', 'Arabic', ['المدينة', 'التغيّر (%)', 'السعر'], [['القاهرة', '+4%', '1,200'], ['عمّان', '-2.5%', '950'], ['بيروت', '(12%)', '$1,200.50']]],
  ['he', 'Hebrew', ['עיר', 'שינוי', 'מחיר'], [['חיפה', '+4%', '1,200'], ['אילת', '−3%', '8,750']]],
];

for (const [lang, name, head, rows] of RTL_BOOKS) {
  test(`a right-to-left (${name}) book's EPUB: no unicode-bidi or direction in any style sheet; each figure isolated in <span dir="auto">, as written`, async () => {
    const fs = await files(book(lang, 'Before.\n\n' + TABLE(head, rows) + '\n\nAfter.'));
    assert.ok(fs.some((f) => /\.css$/.test(f.path)), 'the EPUB carries a style sheet');
    assert.deepEqual(forbiddenIn(fs), []);
    const x = chapter(fs);
    assert.match(x, /<html[^>]* dir="rtl"/, 'the chapter is right to left');
    const cells = numCells(x);
    /* two figure columns: the header cell and every body cell of each */
    assert.equal(cells.length, 2 * (rows.length + 1), `figure cells: ${cells.join(' ')}`);
    const want = [head.slice(1), ...rows.map((r) => r.slice(1))].flat();
    assert.deepEqual(cells.map((c) => c.replace(/^<t[hd][^>]*>|<\/t[hd]>$/g, '')), want.map((w) => '<span dir="auto">' + w + '</span>'));
    /* the cell itself carries no dir (it would turn its logical padding round) */
    assert.ok(cells.every((c) => !/^<t[hd][^>]* dir=/.test(c)), 'a figure cell carries dir itself');
    /* the words column is not isolated, and the writer's figures are verbatim */
    assert.equal((x.match(/<span dir="auto">/g) ?? []).length, cells.length);
    for (const r of rows) assert.ok(x.includes(`<td class="nb">${r[0]}</td>`), `words cell ${r[0]}`);
  });
}

test('an empty figure cell gets no empty span; a left-to-right book is set as before (no span, no dir)', async () => {
  const ar = chapter(await files(book('ar', TABLE(['المدينة', 'العدد'], [['القاهرة', '14'], ['عمّان', ''], ['بيروت', '—']]))));
  assert.deepEqual(numCells(ar), ['<th scope="col" class="num nb"><span dir="auto">العدد</span></th>', '<td class="num"><span dir="auto">14</span></td>', '<td class="num"></td>', '<td class="num"><span dir="auto">—</span></td>']);
  const fs = await files(book('en', TABLE(['Port', 'Ships'], [['Leith', '+4%'], ['Hull', '22']])));
  const en = chapter(fs);
  assert.deepEqual(numCells(en), ['<th scope="col" class="num nb">Ships</th>', '<td class="num">+4%</td>', '<td class="num">22</td>']);
  assert.ok(!/dir="auto"/.test(en));
  assert.deepEqual(forbiddenIn(fs), []);
});
