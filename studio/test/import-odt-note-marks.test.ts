// @vitest-environment node
import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, figures, importFile, odt, oh, setupImport, type Api, type Got, type Sec } from './import-given';

/* An OpenDocument note keeps the mark the writer gave it (BEUK:notemarks). The owner, on a note shown under a number
   Beuk made up: "WHY ARE WE INVENTING NUMBERS?"

   An OpenDocument text numbers a note itself unless the writer gives it a character of their own (LibreOffice: Insert
   Footnote, Character). The file then says so on the note's citation:
     <text:note-citation text:label="*">*</text:note-citation>
   A citation with no text:label holds a number the application drew. A document so marked shows 1, *, 2.

   Before: every note was numbered in order, the writer's "*" replaced by 2: the book showed [1], [2], [3].

   Now: the label is the note's label in the book ("[^*]", shown "*"), and the notes the application numbers are
   numbered in order among themselves: 1, *, 2. Every text here is made up. */

const DUMP = process.env.BEUK_NOTEMARKS_DUMP || '';
const dump = (name: string, v: unknown) => { if (DUMP) appendFileSync(DUMP, '=== ' + name + '\n' + JSON.stringify(v, null, 1) + '\n'); };
const note = (id: string, cite: string, label: string | null, text: string) => '<text:note text:id="' + id + '" text:note-class="footnote"><text:note-citation' + (label ? ' text:label="' + label + '"' : '') + '>' + cite + '</text:note-citation><text:note-body><text:p>' + text + '</text:p></text:note-body></text:note>';
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
  await setupImport('import-odt-note-marks', ['contentBlocksToHtml', 'notesAsShown', 'irItemLabel']);
}, 180_000);

describe('an OpenDocument note keeps the label the writer gave it; the notes the application numbers are counted among themselves', () => {

  it('1, *, 2 in the file is 1, *, 2 in the book', async () => {
    const body = oh('Chapter 1: Dawn') + '<text:p>The caravan left' + note('ftn1', '1', null, 'Salt, by the sack.') + ' at dawn, and' + note('ftn2', '*', '*', 'The pans of the coast.') + ' on, and' + note('ftn3', '2', null, 'The last, automatic again.') + '.</text:p>';
    const g = await importFile('notes.odt', await odt(body), '');
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and[^*] on, and[^2].', '[^1]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^2]: The last, automatic again.'],
      marks: ['[1]', '[*]', '[2]'], notes: ['[1] Salt, by the sack.', '[*] The pans of the coast.', '[2] The last, automatic again.'] });
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 3, refs: 3, mapped: 3, orphans: 0 });
    expect(items(g, 'noteMark')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('two "*" notes in one paragraph, a "†" and a third "*" further on: each mark its own note, in order', async () => {
    const body = oh('Chapter 1: Dawn') + '<text:p>Left' + note('f1', '*', '*', 'The first star.') + ' and on' + note('f2', '*', '*', 'The second star.') + ', past' + note('f3', '†', '†', 'The dagger.') + ' the gate' + note('f4', '1', null, 'Numbered by the application.') + '.</text:p>'
      + '<text:p>Later' + note('f5', '*', '*', 'The third star.') + ' still.</text:p>';
    const g = await importFile('stars.odt', await odt(body), '');
    const s = only(g);
    expect(blocksOf(s.content)).toEqual(['Left[^*] and on[^*], past[^†] the gate[^1].', '[^*]: The first star.', '[^*]: The second star.', 'Later[^*] still.', '[^*]: The third star.', '[^†]: The dagger.', '[^1]: Numbered by the application.']);
    const p = page(g.api, s);
    expect(p.marks).toEqual(['[*]', '[*]', '[†]', '[1]', '[*]']);
    expect(p.hrefs).toEqual(['fnm2a-1', 'fnm2a-2', 'fnm2020-1', 'fn1', 'fnm2a-3']);
    expect(p.notes).toEqual(['[*] The first star.', '[*] The second star.', '[*] The third star.', '[†] The dagger.', '[1] Numbered by the application.']);
    // each "†" and "*" citation is set aside as a note's mark, as every citation always was; nothing unaccounted
    expect(figures(g)).toEqual(CLEAR);
    // the two "*" marks of the one paragraph are two references, on both sides of the tally
    expect(rows(g).filter((r) => /^note/.test(r.key))).toEqual([{ key: 'noteRefs', file: 5, book: 5, why: [] }, { key: 'noteDefs', file: 5, book: 5, why: [] }]);
  }, 120_000);

  it('a label that is a name (a letter) is kept as the note\'s label, shown under a number, and named in the report; a label that cannot be one (it holds a space) is said too', async () => {
    const body = oh('Chapter 1: Dawn') + '<text:p>One' + note('f1', '1', null, 'First.') + ' two' + note('f2', 'a', 'a', 'The lettered note.') + ' three' + note('f3', 'see end', 'see end', 'The worded note.') + ' four' + note('f4', '2', null, 'Second.') + '.</text:p>';
    const g = await importFile('letter.odt', await odt(body), '');
    const b = both(g);
    dump('odt-letter', { b, items: items(g, 'noteMark'), figures: figures(g) });
    // the application's own numbers are 1 and 2 among themselves; the worded label cannot be a label, so that note is numbered with them: 1, a, 2, 3
    expect(b.stored).toEqual(['One[^1] two[^a] three[^2] four[^3].', '[^1]: First.', '[^a]: The lettered note.', '[^2]: The worded note.', '[^3]: Second.']);
    // "a" is a name: it takes the next number no numbered note uses, 4
    expect(b.marks).toEqual(['[1]', '[4]', '[2]', '[3]']);
    expect(items(g, 'noteMark').map((it) => [it.data, it.before])).toEqual([[{ why: 'name', mark: 'a' }, 'The lettered note.'], [{ why: 'unread', mark: '' }, 'The worded note.']]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a file in which no note has a label of its own is read as it always was', async () => {
    const body = oh('Chapter 1: Dawn') + '<text:p>One' + note('f1', '1', null, 'First.') + ' two' + note('f2', '2', null, 'Second.') + '.</text:p>';
    const g = await importFile('plain.odt', await odt(body), '');
    expect(both(g)).toEqual({ stored: ['One[^1] two[^2].', '[^1]: First.', '[^2]: Second.'], marks: ['[1]', '[2]'], notes: ['[1] First.', '[2] Second.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a tally whose totals differ still gives its reasons: a title page the import sets aside, then a lettered note and a "†" note in a paragraph, and a list', async () => {
    const body = '<text:p>The Salt Road</text:p><text:p>by A. Writer</text:p>' + oh('Chapter 1: Dawn') + '<text:p>One' + note('f1', 'a', 'a', 'The lettered note.') + ' two' + note('f2', '†', '†', 'The dagger.') + ' three.</text:p>'
      + '<text:list><text:list-item><text:p>Salt</text:p><text:list><text:list-item><text:p>Coarse</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>Bread</text:p></text:list-item></text:list>';
    const g = await importFile('differ.odt', await odt(body), '');
    dump('odt-differ', { stored: g.secs.map((s) => [s.type, blocksOf(s.content)]), rows: rows(g), figures: figures(g) });
    expect(g.secs.map((s) => blocksOf(s.content)).filter((b) => b.length && /\[\^a\]/.test(b[0]!))[0]![0]).toBe('One[^a] two[^†] three.');
    expect(g.tally.unaccounted).toBe(0);
    expect(g.tally.chars.same).toBe(true);
    expect(rows(g).filter((r) => r.file !== r.book).length, 'a row whose totals differ').toBeGreaterThan(0);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);
});
