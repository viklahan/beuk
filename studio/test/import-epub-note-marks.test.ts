// @vitest-environment node
import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, epub, figures, importFile, setupImport, type Api, type Got, type Sec } from './import-given';

/* An EPUB's note keeps the mark its reference shows (BEUK:notemarks). The owner, on a note shown under a number Beuk
   made up: "WHY ARE WE INVENTING NUMBERS?"

   Before: a note kept the number its reference showed (5, 9); a reference that showed a mark ("*") took the next free
   number, and the "*" that opened the note stayed in its text: a book that showed 5, *, 9 came out [5], [1], [9],
   the note reading "* The pans…".

   Now: the mark is the note's label ("[^*]", shown "*"), and the mark printed before the note's words is set aside
   with the notes' numbers. A note that cannot keep what its reference shows (a number another note of the chapter
   has) takes the next free number as before, and the report now names it. Every text here is made up. */

const DUMP = process.env.BEUK_NOTEMARKS_DUMP || '';
const dump = (name: string, v: unknown) => { if (DUMP) appendFileSync(DUMP, '=== ' + name + '\n' + JSON.stringify(v, null, 1) + '\n'); };
const ref = (id: string, shown: string) => '<a epub:type="noteref" href="#fn' + id + '" id="r' + id + '"><sup>' + shown + '</sup></a>';
/** a note: its own block, the mark or number it prints standing before its words (`p`: its words in a paragraph of their own inside the block) */
const fn = (id: string, lead: string, text: string, p = false) => '<aside epub:type="footnote" id="fn' + id + '">' + (p ? '<p>' : '') + lead + text + (p ? '</p>' : '') + '</aside>';
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
const book = (body: string) => epub([{ title: 'Chapter 1: Dawn', body: '<h1>Chapter 1: Dawn</h1>' + body }]);

beforeAll(async () => {
  await setupImport('import-epub-note-marks', ['contentBlocksToHtml', 'notesAsShown', 'irItemLabel']);
}, 180_000);

describe('an EPUB\'s note keeps the mark its reference shows', () => {

  it('5, *, 9 in the EPUB is 5, *, 9 in the book; the "*" that opens the note is its mark, not a word of it', async () => {
    const g = await importFile('notes.epub', await book('<p>The caravan left' + ref('5', '5') + ' at dawn, and' + ref('a', '*') + ' on, and' + ref('9', '9') + '.</p>'
      + fn('5', '5. ', 'Salt, by the sack.', true) + fn('a', '* ', 'The pans of the coast.', true) + fn('9', '9. ', 'Nine.', true)), '');
    expect(both(g)).toEqual({
      stored: ['The caravan left[^5] at dawn, and[^*] on, and[^9].', '[^5]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^9]: Nine.'],
      marks: ['[5]', '[*]', '[9]'], notes: ['[5] Salt, by the sack.', '[*] The pans of the coast.', '[9] Nine.'] });
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 3, refs: 3, mapped: 3, orphans: 0 });
    expect(items(g, 'noteMark')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('two "†" notes in one paragraph, their marks raised at the head of each note, and a "*": each mark its own note, in order', async () => {
    const g = await importFile('daggers.epub', await book('<p>Left' + ref('d1', '†') + ' and on' + ref('d2', '†') + ', past' + ref('s1', '*') + ' the gate, and further still' + ref('1', '1') + '.</p>'
      + fn('d1', '<sup>†</sup> ', 'The first dagger.') + fn('d2', '<sup>†</sup> ', 'The second dagger.') + fn('s1', '[*] ', 'A star.') + fn('1', '1. ', 'One.')), '');
    const s = only(g);
    dump('epub-daggers', { stored: blocksOf(s.content), figures: figures(g), rows: rows(g), items: g.rep.items.map((it) => [it.kind, it.data]) });
    expect(blocksOf(s.content)).toEqual(['Left[^†] and on[^†], past[^*] the gate, and further still[^1].', '[^†]: The first dagger.', '[^†]: The second dagger.', '[^*]: A star.', '[^1]: One.']);
    const p = page(g.api, s);
    expect(p.marks).toEqual(['[†]', '[†]', '[*]', '[1]']);
    expect(p.hrefs).toEqual(['fnm2020-1', 'fnm2020-2', 'fnm2a-1', 'fn1']);
    expect(p.notes).toEqual(['[†] The first dagger.', '[†] The second dagger.', '[*] A star.', '[1] One.']);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 4, refs: 4, mapped: 4, orphans: 0 });
    expect(items(g, 'subsup')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);

  it('a "*" note marked again after another "*" note: the book could not say which is which, so only the first keeps the mark; the other takes a number and the report names it', async () => {
    const g = await importFile('again.epub', await book('<p>One' + ref('a', '*') + ' two' + ref('b', '*') + ' and the first again' + ref('a', '*') + '.</p>' + fn('a', '* ', 'The first star.') + fn('b', '* ', 'The second star.')), '');
    const b = both(g);
    dump('epub-again', { b, items: items(g, 'noteMark') });
    expect(b).toEqual({ stored: ['One[^*] two[^1] and the first again[^*].', '[^*]: The first star.', '[^1]: The second star.'], marks: ['[*]', '[1]', '[*]'], notes: ['[*] The first star.', '[1] The second star.'] });
    expect(items(g, 'noteMark').map((it) => [it.data, it.before])).toEqual([[{ why: 'taken', mark: '*', n: '1' }, 'The second star.']]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a number two notes of one chapter both show: the later one takes the next free number, as before, and is now named; a letter is kept as the label, shown under a number, and named', async () => {
    const g = await importFile('twice.epub', await book('<p>One' + ref('a', '5') + ' two' + ref('b', '5') + ' three' + ref('c', 'a') + '.</p>' + fn('a', '5. ', 'The first 5.') + fn('b', '5. ', 'The second 5.') + fn('c', 'a. ', 'The lettered note.')), '');
    const b = both(g);
    dump('epub-twice', { b, items: items(g, 'noteMark') });
    expect(b.stored).toEqual(['One[^5] two[^1] three[^a].', '[^5]: The first 5.', '[^1]: The second 5.', '[^a]: The lettered note.']);
    // "a" is a name: the next number no numbered note of the book uses, 2
    expect(b.marks).toEqual(['[5]', '[1]', '[2]']);
    expect(items(g, 'noteMark').map((it) => [it.data, it.before]).sort()).toEqual([[{ why: 'name', mark: 'a' }, 'The lettered note.'], [{ why: 'taken', mark: '5', n: '1' }, 'The second 5.']].sort());
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a tally whose totals differ still gives its reasons: marked notes in a paragraph, and a note of the book that nothing marks', async () => {
    /* the marks stand past the paragraph's first six words, which is what a row pairs a paragraph by */
    const g = await importFile('differ.epub', await book('<p>One two three four five six seven' + ref('5', '5') + ' eight' + ref('d', '†') + ' nine.</p>' + fn('5', '5. ', 'Five.') + fn('d', '† ', 'The dagger.') + fn('8', '8. ', 'Nobody points here.')), '');
    dump('epub-differ', { stored: blocksOf(only(g).content), rows: rows(g), figures: figures(g), items: g.rep.items.filter((it) => /note|Orphan/i.test(it.kind)).map((it) => [it.kind, it.data, it.before]) });
    expect(blocksOf(only(g).content)).toEqual(['One two three four five six seven[^5] eight[^†] nine.', '[8] Nobody points here.', '[^5]: Five.', '[^†]: The dagger.']);
    expect(g.tally.unaccounted).toBe(0);
    expect(g.tally.chars.same).toBe(true);
    expect(rows(g).filter((r) => r.file !== r.book).length, 'a row whose totals differ').toBeGreaterThan(0);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);
});
