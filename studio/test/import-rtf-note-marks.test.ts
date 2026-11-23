// @vitest-environment node
import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, figures, importFile, rtfDoc, rtfEsc, rtfH, rtfP, rw, setupImport, type Api, type Got, type Sec } from './import-given';

/* An RTF note keeps the mark the writer gave it (BEUK:notemarks). The owner, on a note shown under a number Beuk made
   up: "WHY ARE WE INVENTING NUMBERS?"

   RTF writes a footnote the application numbers with \chftn where its number is drawn, in the text and at the head
   of the note. A footnote the writer gave a mark of their own has no \chftn: the mark is typed as text straight
   before the \footnote group and again as the note's first characters. A document so marked shows 1, *, 2.

   Before: every note was numbered in order and the writer's mark stayed as text beside the number, in the text and
   at the head of the note: the book showed [1], *[2], [3].

   Now: the mark is the note's label ("[^*]", shown "*"), no number of Beuk's stands beside it, and the notes the
   application numbers are numbered in order among themselves: 1, *, 2. Every text here is made up. */

const DUMP = process.env.BEUK_NOTEMARKS_DUMP || '';
const dump = (name: string, v: unknown) => { if (DUMP) appendFileSync(DUMP, '=== ' + name + '\n' + JSON.stringify(v, null, 1) + '\n'); };
const auto = (text: string) => '{' + rw('super') + rw('chftn') + '}{' + rw('footnote') + rw('pard') + rw('plain') + '{' + rw('super') + rw('chftn') + '} ' + rtfEsc(text) + '}';
/** a note under a mark of the writer's own, the mark raised in both places (as a word processor writes it) */
const own = (mark: string, text: string) => '{' + rw('super') + ' ' + rtfEsc(mark) + '}{' + rw('footnote') + rw('pard') + rw('plain') + '{' + rw('super') + ' ' + rtfEsc(mark) + '} ' + rtfEsc(text) + '}';
/** the same, the mark typed plainly in both places (no raising) */
const plain = (mark: string, text: string) => rtfEsc(mark) + '{' + rw('footnote') + rw('pard') + rw('plain') + ' ' + rtfEsc(mark) + ' ' + rtfEsc(text) + '}';
const para = (inner: string) => rw('pard') + rw('s0') + ' ' + inner + rw('par') + '\n';
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
  await setupImport('import-rtf-note-marks', ['contentBlocksToHtml', 'notesAsShown', 'rtfRead', 'rtfToManuscriptText']);
}, 180_000);

describe('an RTF note keeps the mark the writer gave it; the notes the application numbers are counted among themselves', () => {

  it('1, *, 2 in the file is 1, *, 2 in the book: no number stands beside the mark, the mark is no word, and it is no raised passage left out', async () => {
    const g = await importFile('notes.rtf', null, rtfDoc(rtfH('Chapter 1: Dawn') + para('The caravan left' + auto('Salt, by the sack.') + ' at dawn, and' + own('*', 'The pans of the coast.') + ' on, and' + auto('The last, automatic again.') + '.')));
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and[^*] on, and[^2].', '[^1]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^2]: The last, automatic again.'],
      marks: ['[1]', '[*]', '[2]'], notes: ['[1] Salt, by the sack.', '[*] The pans of the coast.', '[2] The last, automatic again.'] });
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 3, refs: 3, mapped: 3, orphans: 0 });
    expect(items(g, 'subsup')).toEqual([]);
    expect(items(g, 'noteMark')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('two "†" notes in one paragraph and a "*" typed plainly: each mark its own note in order, each mark set aside twice', async () => {
    const g = await importFile('daggers.rtf', null, rtfDoc(rtfH('Chapter 1: Dawn') + para('Left' + own('†', 'The first dagger.') + ' and on' + own('†', 'The second dagger.') + ', past' + plain('*', 'A star, typed plainly.') + ' the gate' + auto('Numbered by the application.') + '.')));
    const s = only(g);
    dump('rtf-daggers', { stored: blocksOf(s.content), figures: figures(g), aside: g.tally.aside, items: g.rep.items.map((it) => [it.kind, it.data]) });
    expect(blocksOf(s.content)).toEqual(['Left[^†] and on[^†], past[^*] the gate[^1].', '[^†]: The first dagger.', '[^†]: The second dagger.', '[^*]: A star, typed plainly.', '[^1]: Numbered by the application.']);
    const p = page(g.api, s);
    expect(p.marks).toEqual(['[†]', '[†]', '[*]', '[1]']);
    expect(p.hrefs).toEqual(['fnm2020-1', 'fnm2020-2', 'fnm2a-1', 'fn1']);
    expect(p.notes).toEqual(['[†] The first dagger.', '[†] The second dagger.', '[*] A star, typed plainly.', '[1] Numbered by the application.']);
    expect(items(g, 'subsup')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    // four "†" (an asterisk is never a counted character)
    expect(g.tally.aside.noteMarks).toBe(4);
    // the two "†" marks of the one paragraph are two references, on both sides of the tally
    expect(rows(g).filter((r) => /^note/.test(r.key))).toEqual([{ key: 'noteRefs', file: 4, book: 4, why: [] }, { key: 'noteDefs', file: 4, book: 4, why: [] }]);
  }, 120_000);

  it('what is no mark stays the text it is: a raised passage before a note the application numbers; a note with no \\chftn whose words do not open with what stands before it; a letter (left as it was: OPEN)', async () => {
    const bare = (text: string) => '{' + rw('footnote') + rw('pard') + rw('plain') + ' ' + rtfEsc(text) + '}';
    const g = await importFile('not.rtf', null, rtfDoc(rtfH('Chapter 1: Dawn') + para('The 2{' + rw('super') + ' nd}' + auto('An ordinal, then a numbered note.') + ' gate, the sea' + bare('sea, as the sailors say.') + ' and one' + own('a', 'The lettered note.') + ' more.')));
    const b = both(g);
    dump('rtf-not', { b, figures: figures(g), items: g.rep.items.map((it) => [it.kind, it.data]) });
    // OPEN: a mark that is a letter is left as text beside the number, in the text and at the note's head, as every mark was before
    expect(b.stored).toEqual(['The 2nd[^1] gate, the sea[^2] and onea[^3] more.', '[^1]: An ordinal, then a numbered note.', '[^2]: sea, as the sailors say.', '[^3]: a The lettered note.']);
    expect(b.marks).toEqual(['[1]', '[2]', '[3]']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a file in which no note has a mark of its own is read as it always was', async () => {
    const g = await importFile('plain.rtf', null, rtfDoc(rtfH('Chapter 1: Dawn') + para('One' + auto('First.') + ' two' + auto('Second.') + '.')));
    expect(both(g)).toEqual({ stored: ['One[^1] two[^2].', '[^1]: First.', '[^2]: Second.'], marks: ['[1]', '[2]'], notes: ['[1] First.', '[2] Second.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('the readers that take text only (the shelf\'s bulk import, a box set\'s volumes) write the same labels', async () => {
    const g = await importFile('seed.rtf', null, rtfDoc(rtfH('Chapter 1: Seed') + para('Seed.')));
    const rd = g.api.rtfRead!(rtfDoc(rtfH('Chapter 1: Dawn') + para('Left' + auto('One.') + ' and' + own('*', 'Star.') + ' on' + auto('Two.') + '.')));
    expect(String(g.api.rtfToManuscriptText!(rd))).toBe('# Chapter 1: Dawn\n\nLeft[^1] and[^*] on[^2].\n\n[^1]: One.\n\n[^*]: Star.\n\n[^2]: Two.');
  }, 120_000);

  it('a tally whose totals differ still gives its reasons: a title page the import sets aside, then a "†" note in a paragraph, beside a table', async () => {
    const cell = (s: string) => rw('pard') + rw('intbl') + ' ' + s + rw('cell');
    const table = rw('trowd') + rw('cellx3000') + rw('cellx6000') + cell('Tide') + cell('Hour') + rw('row') + '\n' + rw('trowd') + rw('cellx3000') + rw('cellx6000') + cell('Low') + cell('Dawn') + rw('row') + '\n';
    const g = await importFile('differ.rtf', null, rtfDoc(rtfP('The Salt Road') + rtfP('by A. Writer') + rtfH('Chapter 1: Dawn') + para('One' + own('†', 'The dagger.') + ' two three.') + table + para('After the table.')));
    dump('rtf-differ', { stored: g.secs.map((s) => [s.type, blocksOf(s.content)]), rows: rows(g), figures: figures(g) });
    expect(g.secs.map((s) => blocksOf(s.content)).filter((b) => b.length && /\[\^†\]/.test(b[0]!))[0]![0]).toBe('One[^†] two three.');
    expect(g.tally.unaccounted).toBe(0);
    expect(g.tally.chars.same).toBe(true);
    expect(rows(g).filter((r) => r.file !== r.book).length, 'a row whose totals differ').toBeGreaterThan(0);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);
});
