// @vitest-environment node
import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, figures, importFile, page as webPage, setupImport, type Api, type Got, type Sec } from './import-given';

/* A web page's note keeps the number or mark the page shows for it (BEUK:notemarks). The owner, on a note shown under
   a number Beuk made up: "WHY ARE WE INVENTING NUMBERS?"

   A web page has no application drawing its note numbers: the visible text of a note's reference ("5", "*", "[9]")
   is what the writer put there.

   Before: the page's own numbers and marks were set aside and the notes numbered 1, 2, 3 in order: a page that
   showed 5, *, 9 became a book that showed [1], [2], [3].

   Now: what the reference shows is the note's label in the book, less the brackets a page may dress it in: 5, *, 9.
   The return links and the number repeated at the head of the note are markup, set aside and counted as before.
   Every text here is made up. */

const DUMP = process.env.BEUK_NOTEMARKS_DUMP || '';
const dump = (name: string, v: unknown) => { if (DUMP) appendFileSync(DUMP, '=== ' + name + '\n' + JSON.stringify(v, null, 1) + '\n'); };
/** a reference as a page sets one (its visible text raised inside the link), and its note in a notes block with the same text at its head and a way back */
const ref = (id: string, shown: string) => '<a href="#fn' + id + '" id="r' + id + '"><sup>' + shown + '</sup></a>';
const fn = (id: string, shown: string, text: string) => '<p id="fn' + id + '" class="footnote"><sup>' + shown + '</sup> ' + text + ' <a href="#r' + id + '">↩</a></p>';
const notes = (...ps: string[]) => '<div class="footnotes">' + ps.join('') + '</div>';
const chapters = (g: Got) => g.secs.filter((s) => s.type === 'chapter');
const only = (g: Got) => { const s = g.secs.filter((x) => String(x.content || '').trim()); expect(s.length).toBe(1); return s[0]!; };
function page(api: Api, s: Sec) {
  const html = String(api.contentBlocksToHtml!(s.content, s, false, true));
  return {
    marks: [...html.matchAll(/(<a class="noteref"[^>]*>)?<sup class="endnote-ref">([^<]*)<\/sup>/g)].map((x) => (x[1] ? '' : '~') + x[2]),
    hrefs: [...html.matchAll(/<a class="noteref"[^>]* href="#s\d+-([^"]*)">/g)].map((x) => x[1]!),
    notes: [...html.matchAll(/<p class="endnote" id="[^"]*"[^>]*><a class="note-back"[^>]*><sup>([^<]*)<\/sup><\/a> ([^<]*)/g)].map((x) => x[1] + ' ' + x[2]),
  };
}
const both = (g: Got, s = only(g)) => { const p = page(g.api, s); return { stored: blocksOf(s.content), marks: p.marks, notes: p.notes }; };
const items = (g: Got, kind: string) => g.rep.items.filter((it) => it.kind === kind);
const rows = (g: Got) => (g.tally.rows as { key: string; file: number; book: number; why?: { k: string; n: number }[] }[]).map((r) => ({ key: r.key, file: r.file, book: r.book, why: (r.why || []).map((y) => [y.k, y.n]) }));

beforeAll(async () => {
  await setupImport('import-web-note-marks', ['contentBlocksToHtml', 'notesAsShown', 'irItemLabel']);
}, 180_000);

describe('a web page\'s note keeps the number or mark its reference shows', () => {

  it('5, *, 9 on the page is 5, *, 9 in the book', async () => {
    const g = await importFile('notes.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>The caravan left' + ref('5', '5') + ' at dawn, and' + ref('a', '*') + ' on, and' + ref('9', '9') + '.</p>'
      + notes(fn('5', '5', 'Salt, by the sack.'), fn('a', '*', 'The pans of the coast.'), fn('9', '9', 'Nine.'))));
    expect(both(g)).toEqual({
      stored: ['The caravan left[^5] at dawn, and[^*] on, and[^9].', '[^5]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^9]: Nine.'],
      marks: ['[5]', '[*]', '[9]'], notes: ['[5] Salt, by the sack.', '[*] The pans of the coast.', '[9] Nine.'] });
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 3, refs: 3, mapped: 3, orphans: 0 });
    expect(items(g, 'noteMark')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a page numbered 1, 2, 3, 4 in order reads as it always did; a number dressed in brackets or followed by its point is that number', async () => {
    const g = await importFile('plain.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>One' + ref('1', '1') + ' two' + ref('2', '[2]') + ' three' + ref('3', '(3)') + ' four' + ref('4', '4.') + '.</p>'
      + notes(fn('1', '1', 'First.'), fn('2', '[2]', 'Second.'), fn('3', '(3)', 'Third.'), fn('4', '4.', 'Fourth.'))));
    expect(both(g)).toEqual({ stored: ['One[^1] two[^2] three[^3] four[^4].', '[^1]: First.', '[^2]: Second.', '[^3]: Third.', '[^4]: Fourth.'], marks: ['[1]', '[2]', '[3]', '[4]'], notes: ['[1] First.', '[2] Second.', '[3] Third.', '[4] Fourth.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('notes that start again from 1 in every chapter keep their numbers, chapter by chapter', async () => {
    const g = await importFile('again.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>One' + ref('a1', '1') + ' two' + ref('a2', '2') + '.</p><h1>Chapter 2: Noon</h1><p>Three' + ref('b1', '1') + ' four' + ref('b2', '2') + '.</p>'
      + notes(fn('a1', '1', 'Dawn, first.'), fn('a2', '2', 'Dawn, second.'), fn('b1', '1', 'Noon, first.'), fn('b2', '2', 'Noon, second.'))));
    const [one, two] = chapters(g);
    dump('web-again', { one: both(g, one), two: both(g, two), figures: figures(g) });
    expect(both(g, one)).toEqual({ stored: ['One[^1] two[^2].', '[^1]: Dawn, first.', '[^2]: Dawn, second.'], marks: ['[1]', '[2]'], notes: ['[1] Dawn, first.', '[2] Dawn, second.'] });
    // Before: [3] and [4], numbers the page never showed
    expect(both(g, two)).toEqual({ stored: ['Three[^1] four[^2].', '[^1]: Noon, first.', '[^2]: Noon, second.'], marks: ['[1]', '[2]'], notes: ['[1] Noon, first.', '[2] Noon, second.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('the same number on two notes of one chapter cannot be both notes\' label: the first keeps it, the later one takes the next number free, and the report names it with its note', async () => {
    const g = await importFile('twice.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>One' + ref('a1', '1') + ' two' + ref('a2', '2') + '.</p><p>Three' + ref('b1', '1') + ' four.</p>'
      + notes(fn('a1', '1', 'The first 1.'), fn('a2', '2', 'The 2.'), fn('b1', '1', 'The second 1.'))));
    const b = both(g);
    dump('web-twice', { b, items: items(g, 'noteMark'), figures: figures(g) });
    expect(b).toEqual({ stored: ['One[^1] two[^2].', 'Three[^3] four.', '[^1]: The first 1.', '[^2]: The 2.', '[^3]: The second 1.'], marks: ['[1]', '[2]', '[3]'], notes: ['[1] The first 1.', '[2] The 2.', '[3] The second 1.'] });
    const named = items(g, 'noteMark');
    expect(named.map((it) => [it.data, it.before])).toEqual([[{ why: 'taken', mark: '1', n: '3' }, 'The second 1.']]);
    expect(String(g.api.irItemLabel!(named[0]))).toBe('Two notes of one chapter are both marked “1” in the file: the later one is shown under 3');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('two "*" notes in one paragraph and a "†": each mark its own note, in order', async () => {
    const g = await importFile('stars.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>Left' + ref('s1', '*') + ' and on' + ref('s2', '*') + ', past' + ref('d1', '†') + ' the gate.</p>'
      + notes(fn('s1', '*', 'The first star.'), fn('s2', '*', 'The second star.'), fn('d1', '†', 'The dagger.'))));
    const s = only(g);
    expect(blocksOf(s.content)).toEqual(['Left[^*] and on[^*], past[^†] the gate.', '[^*]: The first star.', '[^*]: The second star.', '[^†]: The dagger.']);
    const p = page(g.api, s);
    expect(p.marks).toEqual(['[*]', '[*]', '[†]']);
    expect(p.hrefs).toEqual(['fnm2a-1', 'fnm2a-2', 'fnm2020-1']);
    expect(p.notes).toEqual(['[*] The first star.', '[*] The second star.', '[†] The dagger.']);
    expect(figures(g)).toEqual(CLEAR);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);

  it('a mark that is a name (a letter) is kept as the label, shown under a number, and named in the report', async () => {
    const g = await importFile('letter.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>One' + ref('1', '1') + ' two' + ref('x', 'a') + '.</p>' + notes(fn('1', '1', 'First.'), fn('x', 'a', 'The lettered note.'))));
    expect(both(g)).toEqual({ stored: ['One[^1] two[^a].', '[^1]: First.', '[^a]: The lettered note.'], marks: ['[1]', '[2]'], notes: ['[1] First.', '[2] The lettered note.'] });
    expect(items(g, 'noteMark').map((it) => [it.data, it.before])).toEqual([[{ why: 'name', mark: 'a' }, 'The lettered note.']]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a reference the page calls a note whose text is not on the page keeps the number the page shows, raised and linked to nothing, and is named', async () => {
    const g = await importFile('lost.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>One' + ref('5', '5') + ' two<a href="#gone" role="doc-noteref"><sup>7</sup></a> three.</p>' + notes(fn('5', '5', 'Five.'))));
    const b = both(g);
    dump('web-lost', { b, items: g.rep.items.filter((it) => /note|Orphan/i.test(it.kind)), figures: figures(g) });
    expect(b.stored).toEqual(['One[^5] two[^7] three.', '[^5]: Five.']);
    expect(b.marks).toEqual(['[5]', '~[7]']);
    expect(items(g, 'refOrphan').map((it) => [it.data, it.before])).toEqual([[{ n: '7' }, '[7]']]);
    // the "7" the page shows is the mark's label in the book, set aside with the other notes' marks: nothing unaccounted
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a tally whose totals differ still gives its reasons: numbered notes in a paragraph, and a note of the page that nothing marks', async () => {
    /* each note a block the page calls a footnote (the tally's file side reads such a block as a note, its number aside); the marks stand
       past the paragraph's first six words, which is what a row pairs a paragraph by */
    const note = (id: string, shown: string, text: string, back: boolean) => '<div class="footnote" id="fn' + id + '"><sup>' + shown + '</sup> ' + text + (back ? ' <a href="#r' + id + '">↩</a>' : '') + '</div>';
    const g = await importFile('differ.html', null, webPage('<h1>Chapter 1: Dawn</h1><p>One two three four five six seven' + ref('5', '5') + ' eight' + ref('d', '†') + ' nine.</p>'
      + notes(note('5', '5', 'Five.', true), note('d', '†', 'The dagger.', true), note('8', '8', 'Nobody points here.', false))));
    dump('web-differ', { stored: blocksOf(only(g).content), rows: rows(g), figures: figures(g), items: g.rep.items.filter((it) => /note|Orphan/i.test(it.kind)).map((it) => [it.kind, it.data, it.before]) });
    expect(blocksOf(only(g).content)).toEqual(['One two three four five six seven[^5] eight[^†] nine.', 'Nobody points here.', '[^5]: Five.', '[^†]: The dagger.']);
    expect(g.tally.unaccounted).toBe(0);
    expect(g.tally.chars.same).toBe(true);
    expect(rows(g).filter((r) => r.file !== r.book).length, 'a row whose totals differ').toBeGreaterThan(0);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);
});
