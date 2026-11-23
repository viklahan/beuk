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
  // by hand, from the rule: the writer's own numbers are 1 and 7 ("007"), so salt 2, fn.2-a 3, the two "a" of chapter 3 are 4 and 5, and chapter 4's is 6.
  // "[^nowhere]" answers to no note anywhere in the book: it is no note, takes no number and stays exactly as typed.
  assert.deepEqual(chapters(numbered).slice(0, 4), [
    'The caravan left[^2] at dawn, and again[^2].\n\nA mark with no note[^nowhere].\n\n[^2]: Salt, by the sack.',
    'The pans lay white[^3] and[^1], see[^007].\n\n[^3]: The pans of the coast.\n\n[^1]: The writer\'s own number.\n\n[^007]: As typed.',
    'One[^4] and again[^4].\n\n[^4]: First.\n\nTwo[^5].\n\n[^5]: Second.',
    'One more[^6].\n\n[^6]: The label again, in a later chapter.',
  ]);
  const a = await sb.files(epubState(named, 'generic'), { lang: 'en' });
  const b = await sb.files(epubState(numbered, 'generic'), { lang: 'en' });
  const pa = pages(a.files), pb = pages(b.files);
  assert.ok(pa.length >= 8, 'the package\'s pages');
  assert.deepEqual(pa.map((p) => p[0]), pb.map((p) => p[0]));
  for (let i = 0; i < pa.length; i++) assert.equal(pa[i]![1], pb[i]![1], pa[i]![0]);
  // and the pages say what the rule says: a note linked under its number, its label nowhere; the mark with no note as the writer typed it
  const all = pa.map((p) => p[1]).join('\n');
  for (const label of ['salt]', 'fn.2-a]', '[^a]', '[a]']) assert.equal(all.includes(label), false, `"${label}" reached a page`);
  assert.match(all, /<a class="noteref" epub:type="noteref" id="s\d+-fnref2" href="#s\d+-fn2"><sup class="endnote-ref">\[2\]<\/sup><\/a> at dawn, and again<a class="noteref" epub:type="noteref" href="#s\d+-fn2"><sup class="endnote-ref">\[2\]<\/sup><\/a>\./);
  assert.match(all, /<p>A mark with no note\[\^nowhere\]\.<\/p>/);
  assert.match(all, /see<a class="noteref" epub:type="noteref" id="s\d+-fnref007" href="#s\d+-fn007"><sup class="endnote-ref">\[007\]<\/sup><\/a>\./);
  assert.match(all, /<p class="endnote" id="s\d+-fn4" epub:type="endnote">[\s\S]*?First\.<\/p><p class="endnote" id="s\d+-fn5" epub:type="endnote">[\s\S]*?Second\.<\/p>/);
  assert.match(all, /<p class="endnote" id="s\d+-fn6" epub:type="endnote">/);
});

/* BEUK:notemarks — a note under a mark of the writer's ("*", "†": a label with no letter and no digit) is shown under
   that mark, and takes no number. Two "*" notes of one chapter are two notes, each mark linked to its own; the ids
   are made from the mark's code points, so they are names an EPUB allows and no two are alike. Made-up text. */
test('the EPUB: a note the writer marked "*" is shown as "*", each mark linked to its own note by an id an EPUB allows', async () => {
  const sb = loadEpubClosure(html, CLIENT);
  const marked = bookWith([
    'The caravan left[^1] at dawn, and[^*] on *in a hurry*, and[^†] again, and[^*] once more, by[^salt] the gate.\n\n[^1]: Salt, by the sack.\n\n[^*]: The pans of the coast.\n\n[^†]: The dagger note.\n\n[^*]: The second star.\n\n[^salt]: The gate has its own.',
    'Noon[^*] and lost[^‡].\n\n[^*]: The star of noon.',
  ]);
  const out = await sb.files(epubState(marked, 'generic'), { lang: 'en' });
  const all = pages(out.files);
  const one = all.find((p) => p[1].includes('The second star.'))![1], two = all.find((p) => p[1].includes('The star of noon.'))![1];
  const marks = (x: string) => [...x.matchAll(/<a class="noteref" epub:type="noteref"(?: id="[^"]*")? href="#s\d+-([^"]*)"><sup class="endnote-ref">([^<]*)<\/sup><\/a>/g)].map((m) => [m[2], m[1]]);
  // the writer's 1, the writer's marks as typed, and the one name ("salt") under 2, the next number, as if the marks were not there
  assert.deepEqual(marks(one), [['[1]', 'fn1'], ['[*]', 'fnm2a-1'], ['[†]', 'fnm2020-1'], ['[*]', 'fnm2a-2'], ['[2]', 'fn2']]);
  assert.deepEqual([...one.matchAll(/<p class="endnote" id="s\d+-([^"]*)" epub:type="endnote"><a class="note-back" href="#s\d+-([^"]*)"[^>]*><sup>([^<]*)<\/sup><\/a> ([^<]*)/g)].map((m) => [m[1], m[2], m[3], m[4]]), [
    ['fn1', 'fnref1', '[1]', 'Salt, by the sack.'], ['fnm2a-1', 'fnrefm2a-1', '[*]', 'The pans of the coast.'], ['fnm2020-1', 'fnrefm2020-1', '[†]', 'The dagger note.'],
    ['fnm2a-2', 'fnrefm2a-2', '[*]', 'The second star.'], ['fn2', 'fnref2', '[2]', 'The gate has its own.']]);
  // the next chapter's "*" starts again; its "‡", which no note answers, is the writer's text as typed
  assert.deepEqual(marks(two), [['[*]', 'fnm2a-1']]);
  assert.match(two, / lost\[\^‡\]\.<\/p>/);
  assert.deepEqual([...one.matchAll(/<em>([^<]*)<\/em>/g)].map((m) => m[1]), ['in a hurry']);
  for (const [name, page] of all) {
    const ids = [...page.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]!);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id used twice`);
    for (const id of ids) assert.match(id, /^[A-Za-z_][A-Za-z0-9._-]*$/, `${name}: "${id}" is no name an XML id allows`);
    for (const h of [...page.matchAll(/ href="#([^"]*)"/g)].map((m) => m[1]!)) assert.ok(ids.includes(h), `${name}: a link to "#${h}", which is on no page`);
    assert.equal(page.includes('\uE080'), false, `${name}: the working key reached a page`);
  }
});
