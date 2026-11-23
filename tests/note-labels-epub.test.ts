import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadEpubClosure } from '../src/book/epub/closure.js';
import { epubState } from '../src/book/epub/state.js';
import { notesAsShown } from '../src/book/notes.js';
import { readBook } from '../src/book/read.js';
import { fixturePath } from './book-fixtures.js';

/* BEUK:notelabels — the store-ready EPUB is built on the server by the studio's own code, lifted out of
   client/index.html. A note is stored under the label the writer typed and the EPUB shows the number worked out from
   it. Held here on a whole package: a book whose notes stand under labels of the writer's own builds the very chapter
   pages of the same book with each label written as the number it shows. That number is worked out twice over, by
   two copies of the rule: the studio's (noteBookShown, inside the lifted code) and the server's
   (src/book/notes.ts, which writes the second book here). Made-up text, set into a fixture book's chapters. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
const base = readBook((JSON.parse(readFileSync(fixturePath('real', 'salt-road-standalone.json'), 'utf8')) as { book: unknown }).book).book;

const NAMED = [
  'The caravan left[^salt] at dawn, and again[^salt].\n\nA mark with no note[^nowhere].\n\n[^salt]: Salt, by the sack.',
  'The pans lay white[^fn.2-a] and[^1], see[^007].\n\n[^fn.2-a]: The pans of the coast.\n\n[^1]: The writer\'s own number.\n\n[^007]: As typed.',
  'One[^a] and again[^a].\n\n[^a]: First.\n\nTwo[^a].\n\n[^a]: Second.',
  'One more[^a].\n\n[^a]: The label again, in a later chapter.',
];
/** the fixture book with its chapters' text replaced, in order (a chapter past the list holds one plain line) */
function bookWith(texts: string[]): typeof base {
  const b = structuredClone(base);
  let k = 0;
  for (const s of b.sections as { type: string; content: string }[]) if (s.type === 'chapter') s.content = texts[k++] ?? 'A plain chapter.';
  return b;
}
const pages = (files: { path: string; content: string }[]) => files.filter((f) => f.path.startsWith('OEBPS/Text/')).map((f) => [f.path, f.content] as [string, string]);

test('the EPUB: a book under the writer\'s labels builds the very chapter pages of the same book under the numbers it shows', async () => {
  const sb = loadEpubClosure(html, CLIENT);
  const named = bookWith(NAMED);
  // the second book: every section's text as a reader is shown its notes (the server's copy of the numbering)
  const numbered = structuredClone(named);
  const shown = notesAsShown((named.sections as { content: string }[]).map((s) => String(s.content ?? '')));
  (numbered.sections as { content: string }[]).forEach((s, i) => { s.content = shown[i]!; });
  const chapters = (b: typeof base) => (b.sections as { type: string; content: string }[]).filter((s) => s.type === 'chapter').map((s) => s.content);
  // by hand, from the rule: the writer's own numbers are 1 and 7 ("007"), so salt 2, nowhere 3, fn.2-a 4, the two "a" of chapter 3 are 5 and 6, and chapter 4's is 8
  assert.deepEqual(chapters(numbered).slice(0, 4), [
    'The caravan left[^2] at dawn, and again[^2].\n\nA mark with no note[^3].\n\n[^2]: Salt, by the sack.',
    'The pans lay white[^4] and[^1], see[^007].\n\n[^4]: The pans of the coast.\n\n[^1]: The writer\'s own number.\n\n[^007]: As typed.',
    'One[^5] and again[^5].\n\n[^5]: First.\n\nTwo[^6].\n\n[^6]: Second.',
    'One more[^8].\n\n[^8]: The label again, in a later chapter.',
  ]);
  const a = await sb.files(epubState(named, 'generic'), { lang: 'en' });
  const b = await sb.files(epubState(numbered, 'generic'), { lang: 'en' });
  const pa = pages(a.files), pb = pages(b.files);
  assert.ok(pa.length >= 8, 'the package\'s pages');
  assert.deepEqual(pa.map((p) => p[0]), pb.map((p) => p[0]));
  for (let i = 0; i < pa.length; i++) assert.equal(pa[i]![1], pb[i]![1], pa[i]![0]);
  // and the pages say what the rule says: linked under the number, the label nowhere
  const all = pa.map((p) => p[1]).join('\n');
  for (const label of ['salt]', 'nowhere]', 'fn.2-a]', '[^a]', '[a]']) assert.equal(all.includes(label), false, `"${label}" reached a page`);
  assert.match(all, /<a class="noteref" epub:type="noteref" id="s\d+-fnref2" href="#s\d+-fn2"><sup class="endnote-ref">\[2\]<\/sup><\/a> at dawn, and again<a class="noteref" epub:type="noteref" href="#s\d+-fn2"><sup class="endnote-ref">\[2\]<\/sup><\/a>\./);
  assert.match(all, /no note<sup class="endnote-ref">\[3\]<\/sup>\./);
  assert.match(all, /see<a class="noteref" epub:type="noteref" id="s\d+-fnref007" href="#s\d+-fn007"><sup class="endnote-ref">\[007\]<\/sup><\/a>\./);
  assert.match(all, /<p class="endnote" id="s\d+-fn5" epub:type="endnote">[\s\S]*?First\.<\/p><p class="endnote" id="s\d+-fn6" epub:type="endnote">[\s\S]*?Second\.<\/p>/);
  assert.match(all, /<p class="endnote" id="s\d+-fn8" epub:type="endnote">/);
});
