// @vitest-environment node
import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, docx, english as t, figures, importFile, setupImport, wp, W_NS, type Api, type Got, type Rec, type Sec } from './import-given';

/* A Word note keeps the mark the writer gave it (BEUK:notemarks). The owner, on a note shown under a number Beuk made
   up: "WHY ARE WE INVENTING NUMBERS?"

   Word numbers a footnote itself unless the writer gives it a mark of their own (Insert Footnote, Custom mark):
     <w:footnoteReference w:customMarkFollows="1" w:id="3"/><w:t>*</w:t>
   and the note opens with the mark again. A document so marked shows its reader 1, *, †, 2: the automatic notes are
   counted among themselves.

   Before: every note was numbered in order and the writer's mark was kept as text beside the number, in the text
   and at the head of the note: the book showed [1], [2]*, [3]†, [4].

   Now: the mark is the note's label. The book stores "[^*]" and "[^*]: …", shows "*", and adds no number beside it;
   the notes Word numbers itself are numbered in order among themselves, as Word counts them: 1, *, †, 2. A mark that
   is a name (a letter) is kept as the label and shown under a number, and the report names it with its note.

   Every text here is made up. */

const DUMP = process.env.BEUK_NOTEMARKS_DUMP || '';
const dump = (name: string, v: unknown) => { if (DUMP) appendFileSync(DUMP, '=== ' + name + '\n' + JSON.stringify(v, null, 1) + '\n'); };
const WT = (s: string) => '<w:r><w:t xml:space="preserve">' + s + '</w:t></w:r>';
/** a reference: Word's own number, or the writer's mark (as text in the reference's run; `sym`: as a symbol-font character instead) */
const REF = (id: number, custom?: string, kind = 'footnote', sym = false) => '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:' + kind + 'Reference ' + (custom ? 'w:customMarkFollows="1" ' : '') + 'w:id="' + id + '"/>'
  + (custom ? (sym ? '<w:sym w:font="Symbol" w:char="F02A"/>' : '<w:t>' + custom + '</w:t>') : '') + '</w:r>';
/** a note: Word's own number at its head (w:footnoteRef), or the writer's mark as text */
const NOTE = (id: number, text: string, custom?: string, kind = 'footnote') => '<w:' + kind + ' w:id="' + id + '"><w:p>' + (custom ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:t>' + custom + '</w:t></w:r>' : '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:' + kind + 'Ref/></w:r>') + WT(' ' + text) + '</w:p></w:' + kind + '>';
const notesPart = (kind: string, notes: string) => '<?xml version="1.0" encoding="UTF-8"?><w:' + kind + 's ' + W_NS + '><w:' + kind + ' w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:' + kind + '>' + notes + '</w:' + kind + 's>';
const only = (g: Got) => { const s = g.secs.filter((x) => String(x.content || '').trim()); expect(s.length).toBe(1); return s[0]!; };
function page(api: Api, s: Sec) {
  const html = String(api.contentBlocksToHtml!(s.content, s, false, true));
  return {
    marks: [...html.matchAll(/(<a class="noteref"[^>]*>)?<sup class="endnote-ref">([^<]*)<\/sup>/g)].map((x) => (x[1] ? '' : '~') + x[2]),
    hrefs: [...html.matchAll(/<a class="noteref"[^>]* href="#s\d+-([^"]*)">/g)].map((x) => x[1]!),
    notes: [...html.matchAll(/<p class="endnote" id="[^"]*"[^>]*><a class="note-back"[^>]*><sup>([^<]*)<\/sup><\/a> ([^<]*)/g)].map((x) => x[1] + ' ' + x[2]),
  };
}
const both = (g: Got) => { const s = only(g); const p = page(g.api, s); return { stored: blocksOf(s.content), marks: p.marks, notes: p.notes }; };
const items = (g: Got, kind: string) => g.rep.items.filter((it) => it.kind === kind);
const rows = (g: Got) => (g.tally.rows as { key: string; file: number; book: number; why?: { k: string; n: number }[] }[]).map((r) => ({ key: r.key, file: r.file, book: r.book, why: (r.why || []).map((y) => [y.k, y.n]) }));

beforeAll(async () => {
  await setupImport('import-word-note-marks', ['contentBlocksToHtml', 'notesAsShown', 'buildMarkdown', 'buildDocxFiles', 'irItemLabel']);
}, 180_000);

describe('a Word note keeps the mark the writer gave it; the notes Word numbers itself are counted among themselves', () => {

  it('1, *, †, 2 in Word is 1, *, †, 2 in the book: the mark is the label, no number stands beside it, and it is no word of the text or of the note', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('The caravan left') + REF(2) + WT(' at dawn, and') + REF(3, '*') + WT(' on, and') + REF(4, '†') + WT(' again, and') + REF(5) + WT('.') + '</w:p>';
    const g = await importFile('notes.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'Salt, by the sack.') + NOTE(3, 'The pans of the coast.', '*') + NOTE(4, 'The dagger note.', '†') + NOTE(5, 'The last, automatic again.')) }), '');
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and[^*] on, and[^†] again, and[^2].', '[^1]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^†]: The dagger note.', '[^2]: The last, automatic again.'],
      marks: ['[1]', '[*]', '[†]', '[2]'], notes: ['[1] Salt, by the sack.', '[*] The pans of the coast.', '[†] The dagger note.', '[2] The last, automatic again.'] });
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 4, refs: 4, mapped: 4, orphans: 0 });
    expect(items(g, 'noteMark')).toEqual([]);
    expect(items(g, 'refOrphan')).toEqual([]);
    // each mark stands twice in the file, beside its reference and at its note's head, and is set aside as a note's mark both times; none is unaccounted.
    // (The count is 2: the two "†". An asterisk is never a counted character, in any text: the tally takes emphasis marks off before it counts.)
    expect(figures(g)).toEqual(CLEAR);
    expect(g.tally.aside.noteMarks).toBe(2);
  }, 120_000);

  it('two "*" notes marked in one paragraph and a third further on: three notes under "*", each mark its own note, in order', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('Left') + REF(2, '*') + WT(' and on') + REF(3, '*') + WT(', by') + REF(4) + WT(' the gate.') + '</w:p><w:p>' + WT('Later') + REF(5, '*') + WT(' still.') + '</w:p>';
    const g = await importFile('stars.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'The first star.', '*') + NOTE(3, 'The second star.', '*') + NOTE(4, 'Numbered by Word.') + NOTE(5, 'The third star.', '*')) }), '');
    const s = only(g);
    // each "*" definition stands after the block of its own mark, the two of the first paragraph in the order of their marks
    expect(blocksOf(s.content)).toEqual(['Left[^*] and on[^*], by[^1] the gate.', '[^*]: The first star.', '[^*]: The second star.', 'Later[^*] still.', '[^*]: The third star.', '[^1]: Numbered by Word.']);
    const p = page(g.api, s);
    expect(p.marks).toEqual(['[*]', '[*]', '[1]', '[*]']);
    expect(p.hrefs).toEqual(['fnm2a-1', 'fnm2a-2', 'fn1', 'fnm2a-3']);
    expect(p.notes).toEqual(['[*] The first star.', '[*] The second star.', '[*] The third star.', '[1] Numbered by Word.']);
    expect(figures(g)).toEqual(CLEAR);
    // the two "*" marks of the one paragraph are two references, on both sides of the tally
    expect(rows(g).filter((r) => /^note/.test(r.key))).toEqual([{ key: 'noteRefs', file: 4, book: 4, why: [] }, { key: 'noteDefs', file: 4, book: 4, why: [] }]);
  }, 120_000);

  it('an endnote under a mark of the writer\'s beside footnotes: the same, and the numbered notes keep the one count the book has always given them', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('One') + REF(2) + WT(' two') + REF(1, '‡', 'endnote') + WT(' three') + REF(2, undefined, 'endnote') + WT(' four') + REF(3, '*') + WT('.') + '</w:p>';
    const g = await importFile('ends.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'A footnote.') + NOTE(3, 'A starred footnote.', '*')),
      'word/endnotes.xml': notesPart('endnote', NOTE(1, 'A daggered endnote.', '‡', 'endnote') + NOTE(2, 'An endnote Word numbers.', undefined, 'endnote')) }), '');
    const b = both(g);
    dump('endnotes', b);
    expect(b.marks).toEqual(['[1]', '[‡]', '[2]', '[*]']);
    expect(b.stored[0]).toBe('One[^1] two[^‡] three[^2] four[^*].');
    expect([...b.stored.slice(1)].sort()).toEqual(['[^*]: A starred footnote.', '[^1]: A footnote.', '[^2]: An endnote Word numbers.', '[^‡]: A daggered endnote.'].sort());
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  /* BEUK:noteletters — V, 2026-11-23: "Show letter". Before, the letter was kept as the label and shown under 3. */
  it('a mark that is one letter is shown as typed, in the text and at the note, and nothing is named; a mark of two letters is a name: kept as the label, shown under a number, and named with its note', async () => {
    const file = async (mark: string) => {
      const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('One') + REF(2) + WT(' two') + REF(3, mark) + WT(' three') + REF(4) + WT('.') + '</w:p>';
      return importFile('letter.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'First.') + NOTE(3, 'The lettered note.', mark) + NOTE(4, 'Second.')) }), '');
    };
    // Word shows 1, a, 2, and so does the book
    const g = await file('a');
    expect(both(g)).toEqual({ stored: ['One[^1] two[^a] three[^2].', '[^1]: First.', '[^a]: The lettered note.', '[^2]: Second.'],
      marks: ['[1]', '[a]', '[2]'], notes: ['[1] First.', '[a] The lettered note.', '[2] Second.'] });
    expect(items(g, 'noteMark')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    // Word shows 1, ab, 2. The book keeps "ab" as the label; a name takes the next number no numbered note uses: 3
    const n = await file('ab');
    expect(both(n)).toEqual({ stored: ['One[^1] two[^ab] three[^2].', '[^1]: First.', '[^ab]: The lettered note.', '[^2]: Second.'],
      marks: ['[1]', '[3]', '[2]'], notes: ['[1] First.', '[3] The lettered note.', '[2] Second.'] });
    const named = items(n, 'noteMark');
    expect(named.map((it) => [it.data, it.before, it.group])).toEqual([[{ why: 'name', mark: 'ab' }, 'The lettered note.', 'notes']]);
    expect(String(n.api.irItemLabel!(named[0]))).toBe(t('ir.k.noteMark.name', { mark: 'ab' }));
    expect(String(n.api.irItemLabel!(named[0]))).toBe('A note the file marks “ab” is shown under a number: Beuk shows a note’s own mark when it is a number, a single letter or a symbol such as * or †');
    expect(figures(n)).toEqual(CLEAR);
  }, 240_000);

  it('a mark set as a symbol-font character (w:sym), which is no text the file types: the note is numbered, and the report says its mark could not be read', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('One') + REF(2) + WT(' two') + REF(3, '*', 'footnote', true) + WT(' three.') + '</w:p>';
    const g = await importFile('sym.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'First.') + NOTE(3, 'The symbol note.', '*')) }), '');
    const b = both(g);
    dump('sym', { b, figures: figures(g), items: g.rep.items.filter((it) => /note|mammoth/i.test(it.kind)) });
    expect(b.marks).toEqual(['[1]', '[2]']);
    expect(items(g, 'noteMark').map((it) => [it.data, it.before])).toEqual([[{ why: 'unread', mark: '' }, '* The symbol note.']]);
    expect(String(g.api.irItemLabel!(items(g, 'noteMark')[0]))).toBe('A note’s own mark could not be read from the file: the note is shown under a number');
  }, 120_000);

  it('a file in which no note has a mark of its own is read as it always was', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('One') + REF(2) + WT(' two') + REF(3) + WT('.') + '</w:p>';
    const g = await importFile('plain.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'First.') + NOTE(3, 'Second.')) }), '');
    expect(both(g)).toEqual({ stored: ['One[^1] two[^2].', '[^1]: First.', '[^2]: Second.'], marks: ['[1]', '[2]'], notes: ['[1] First.', '[2] Second.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a tally whose totals differ still gives its reasons: a starred note of two paragraphs, closed up as one note, and a note no reference points to', async () => {
    const two = '<w:footnote w:id="3"><w:p><w:r><w:t>*</w:t></w:r>' + WT(' The pans of the coast.') + '</w:p><w:p>' + WT('And a second paragraph of the same note.') + '</w:p></w:footnote>';
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('The caravan left') + REF(2) + WT(' at dawn, and') + REF(3, '*') + WT(' on.') + '</w:p>';
    const g = await importFile('two.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'Salt, by the sack.') + two + NOTE(6, 'Nobody points here.', '†')) }), '');
    dump('two', { b: both(g), rows: rows(g), figures: figures(g), aside: g.tally.aside });
    // the note nothing marks is kept as its words at the end of the text, its own "†" with it: no reference says it is a mark of anything
    expect(both(g).stored).toEqual(['The caravan left[^1] at dawn, and[^*] on.', '[^1]: Salt, by the sack.', '[^*]: The pans of the coast. And a second paragraph of the same note.', '† Nobody points here.']);
    expect(figures(g)).toEqual(CLEAR);
    const differing = rows(g).filter((r) => r.file !== r.book);
    expect(differing.map((r) => [r.key, r.file, r.book, r.why])).toEqual([['paragraphs', 1, 2, [['notesOrphan', 1]]], ['noteDefs', 3, 2, [['notesOrphan', 1]]]]);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);
});

describe('the tally of a Word file whose note carries a mark that is a letter', () => {
  it('totals that differ (a note no reference points to): the paragraph that holds the lettered note is still paired with the book\'s by its own words, and every difference has its reason', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('One') + REF(2) + WT(' two') + REF(3, 'a') + WT(' three.') + '</w:p>';
    const g = await importFile('letter-loose.docx', await docx(body, { 'word/footnotes.xml': notesPart('footnote', NOTE(2, 'First.') + NOTE(3, 'The lettered note.', 'a') + NOTE(6, 'Nobody points here.')) }), '');
    dump('letter-loose', { b: both(g), rows: rows(g), figures: figures(g), aside: g.tally.aside });
    expect(both(g).stored).toEqual(['One[^1] two[^a] three.', '[^1]: First.', '[^a]: The lettered note.', 'Nobody points here.']);
    // the file's paragraph is "One twoa three." to the character (the "a" is the mark, set aside twice: beside its reference and at its note's head)
    expect(figures(g)).toEqual(CLEAR);
    expect(g.tally.aside.noteMarks).toBe(2);
    expect(rows(g).filter((r) => r.file !== r.book).map((r) => [r.key, r.file, r.book, r.why])).toEqual([['paragraphs', 1, 2, [['notesOrphan', 1]]], ['noteDefs', 3, 2, [['notesOrphan', 1]]]]);
  }, 120_000);
});

describe('the Word export read back: a note under a mark of the writer\'s is the same note again', () => {
  async function exported(api: Api): Promise<Uint8Array> {
    const files = api.buildDocxFiles!() as { path: string; content: string }[];
    const z = new ((globalThis as Rec).JSZip as new () => { file: (p: string, s: string) => void; generateAsync: (o: Rec) => Promise<Uint8Array> })();
    files.forEach((f) => z.file(f.path, f.content));
    return z.generateAsync({ type: 'uint8array' });
  }
  const chapters = (g: Got) => g.secs.filter((s) => s.type === 'chapter').map((s) => [s.number, s.title, blocksOf(s.content)]);

  it('a book of "1, *, †, *" exported to Word and read again holds the same marks on the same notes', async () => {
    const md = ['# Chapter 1: Dawn', 'The caravan left[^1] at dawn, and[^*] on, and[^†] again, and[^*] once more.', '[^1]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^†]: The dagger note.', '[^*]: The second star.',
      '# Chapter 2: Noon', 'Noon[^*] came.', '[^*]: The star of noon.'].join('\n\n') + '\n';
    const first = await importFile('book.md', null, md);
    const back = await importFile('book.docx', await exported(first.api), '');
    dump('roundtrip', { first: chapters(first), back: chapters(back), items: back.rep.items.filter((it) => /note|Orphan|subsup/i.test(it.kind)), figures: figures(back) });
    expect(chapters(back)).toEqual(chapters(first));
    const p = page(back.api, back.secs.find((s) => s.type === 'chapter' && s.number === '1')!);
    expect(p.marks).toEqual(['[1]', '[*]', '[†]', '[*]']);
    expect(p.hrefs).toEqual(['fn1', 'fnm2a-1', 'fnm2020-1', 'fnm2a-2']);
    // (the two "*" notes stand straight after the paragraph of their marks, where the Markdown import set them: two notes of one label)
    expect(p.notes).toEqual(['[*] The pans of the coast.', '[*] The second star.', '[1] Salt, by the sack.', '[†] The dagger note.']);
    expect(items(back, 'subsup')).toEqual([]);
    // FOUND, NOT CHANGED: the tally of Beuk's own Word export read back is not clear, for a book of numbers as for this one: the Endnotes'
    // "(Chapter 1 · Dawn)" labels and each raised mark and Endnotes mark are characters of the file that the book does not hold as characters.
    const numbered = await importFile('numbers.md', null, md.replace(/\[\^\*\]/g, '[^2]').replace(/\[\^†\]/g, '[^3]').replace('and[^2] once more', 'and[^4] once more').replace('[^2]: The second star.', '[^4]: The second star.'));
    const backNumbered = await importFile('numbers.docx', await exported(numbered.api), '');
    dump('roundtrip-numbers', { first: chapters(numbered), back: chapters(backNumbered), figures: figures(backNumbered) });
    expect(chapters(backNumbered)).toEqual(chapters(numbered));
    expect(figures(backNumbered).unaccounted).toBeGreaterThan(0);
    expect(figures(back).unaccounted).toBeGreaterThan(0);
  }, 240_000);
});
