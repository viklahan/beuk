import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadEpubClosure, type EpubFile } from '../src/book/epub/closure.js';
import { epubState } from '../src/book/epub/state.js';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';
import { readBook } from '../src/book/read.js';

/* BEUK:poemmode — Poem Mode on the server. The store-ready EPUB is built
   here, by the studio's own code lifted out of client/index.html
   (src/book/epub/closure.ts), so a chapter marked as a poem
   (section.mode "verse") must come out of THIS build as verse too: a line
   for every new line of its text, a stanza for every blank line, with the
   class of its alignment, and with the same book's prose chapter untouched.

   The lines of the test book were made up for the test. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');

const PROSE = 'The ferry left the harbour at first light.\nMara stood at the rail.\n\nShe had not meant to come back.';
const POEM = 'The tide comes in on quiet feet.\nIt counts the stones along the street.\n\nThe gulls wake up and start to call.\nThe morning light is on the wall.';
const sec = (id: string, kind: string, type: string, title: string, extra: Record<string, unknown> = {}) => ({ id, kind, type, title, subtitle: '', number: '', content: '', ...extra });
const book = (poems: boolean, more: Record<string, unknown>[] = []) => ({
  meta: { title: 'Three Chapters', author: 'A. Writer', language: 'en', bookId: 'urn:uuid:0f0e0d0c-0b0a-4908-8706-050403020100' },
  sections: [
    sec('sfront01', 'front', 'titlepage', 'Title Page'),
    sec('schap001', 'body', 'chapter', 'The Ferry', { number: '1', content: PROSE }),
    sec('schap002', 'body', 'chapter', 'Tide', { number: '2', content: POEM, ...(poems ? { mode: 'verse' } : {}) }),
    sec('schap003', 'body', 'chapter', 'Tide Again', { number: '3', content: POEM, ...(poems ? { mode: 'verse', verseAlign: 'left' } : {}) }),
    ...more,
  ],
});

async function build(raw: unknown): Promise<EpubFile[]> {
  const read = readBook(raw);
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.warnings.filter((w) => /mode|verseAlign/.test(w.path)), [], 'the fields read without a warning');
  const { files } = await loadEpubClosure(html, CLIENT).files(epubState(read.book, 'generic'), { lang: 'en' });
  return files;
}
const chapters = (files: EpubFile[]) => files.filter((f) => /^OEBPS\/Text\/chapter_.*\.xhtml$/.test(f.path)).map((f) => String(f.content));
const STANZAS =
  '<p class="stanza"><span class="vl">The tide comes in on quiet feet.</span><br/><span class="vl">It counts the stones along the street.</span></p>' +
  '<p class="stanza"><span class="vl">The gulls wake up and start to call.</span><br/><span class="vl">The morning light is on the wall.</span></p></div>';

test('poem mode: the self-check exists in the client and is registered client-only with a reason', () => {
  assert.ok(html.includes('{ id: "chapter.poem"'), 'chapter.poem present in the client self-checks');
  const c = SELF_CHECK_CASES.find((x) => x.id === 'chapter.poem');
  assert.ok(c, 'chapter.poem registered');
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10, 'it has a reason');
});

test('poem mode: the server\'s EPUB sets a poem chapter as verse, centred or left, and leaves the prose chapter as it was', async () => {
  const withPoems = chapters(await build(book(true)));
  const allProse = chapters(await build(book(false)));
  assert.equal(withPoems.length, 3);
  assert.equal(allProse.length, 3);

  // the exact markup, for each alignment
  assert.ok(withPoems[1]!.includes('<div class="verse poem poem-center">' + STANZAS), 'the centred poem: ' + withPoems[1]!.slice(withPoems[1]!.indexOf('<div class="verse'), withPoems[1]!.indexOf('<div class="verse') + 300));
  assert.ok(withPoems[2]!.includes('<div class="verse poem poem-left">' + STANZAS), 'the left poem');
  for (const c of [withPoems[1]!, withPoems[2]!]) {
    assert.equal((c.match(/<span class="vl">/g) ?? []).length, 4, 'four lines');
    assert.equal((c.match(/<p class="stanza">/g) ?? []).length, 2, 'two stanzas');
    assert.ok(!/dropcap|class="first/.test(c), 'no drop cap, no opening paragraph');
  }

  // the prose chapter is byte for byte what it is in the book with no poem, and carries no verse
  assert.equal(withPoems[0], allProse[0]);
  assert.ok(!withPoems[0]!.includes('class="verse'));
  assert.ok(withPoems[0]!.includes('at first light. Mara stood at the rail.'), 'a prose paragraph\'s new line is the space it always was');

  // the same text with Poem Mode off is prose: its lines run on in one paragraph
  for (const c of [allProse[1]!, allProse[2]!]) {
    assert.ok(!c.includes('class="verse'));
    assert.ok(c.includes('quiet feet. It counts the stones along the street.'));
  }
});

test('poem mode: the EPUB stylesheet has both alignments and asks no e-reader to shrink a block to its lines', async () => {
  const files = await build(book(true));
  const css = String(files.find((f) => f.path === 'OEBPS/Styles/blitz.css')!.content);
  assert.ok(css.includes('.verse.poem { margin: 1em 0; }'));
  assert.ok(css.includes('.verse.poem-center, .verse.poem-center p.stanza { text-align: center; }'));
  assert.ok(css.includes('.verse.poem-center .vl { padding-left: 0; padding-right: 0; text-indent: 0; }'));
  // left: the verse block's own rules (flush, a turn-over hung 1.5em, a stanza kept whole, never justified or hyphenated)
  assert.ok(css.includes('.verse .vl { display: block; padding-left: 1.5em; text-indent: -1.5em; }'));
  assert.ok(css.includes('.verse p.stanza { margin: 0 0 0.9em 0; text-indent: 0; text-align: left; hyphens: manual; -webkit-hyphens: manual; break-inside: avoid; page-break-inside: avoid; }'));
  assert.ok(!css.includes('fit-content'));
});

test('poem mode: an empty poem chapter puts nothing of the editor\'s starter lines into the EPUB', async () => {
  const files = await build(book(true, [sec('schap004', 'body', 'chapter', '', { number: '4', content: '', mode: 'verse' })]));
  const all = files.filter((f) => !f.binary).map((f) => String(f.content)).join('\n');
  for (const ghost of ['Write your first line', 'press Enter for the next one', 'a blank line starts a new stanza', 'Name your poem']) assert.ok(!all.includes(ghost), ghost);
  const last = chapters(files).find((c) => !c.includes('The Ferry') && !c.includes('Tide'));
  if (last) assert.ok(!last.includes('class="verse'), 'the empty chapter carries no verse block');
});

test('poem mode: only a body chapter is a poem (a mode stored on a Part or on front matter is not read)', async () => {
  const b = book(false, [sec('sback001', 'back', 'acknowledgments', 'Acknowledgments', { content: 'Thanks to the harbour master,\nand to the ferrymen.', mode: 'verse' })]);
  const files = await build(b);
  const all = files.filter((f) => !f.binary && /\.xhtml$/.test(f.path)).map((f) => String(f.content)).join('\n');
  assert.ok(!all.includes('class="verse'), 'no verse anywhere');
  assert.ok(all.includes('harbour master, and to the ferrymen.'));
});
