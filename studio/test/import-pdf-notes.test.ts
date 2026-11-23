// @vitest-environment node
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, figures, importFile, pdf, setupImport, written, type Got, type PdfLine } from './import-given';

/* A footnote in a PDF comes in as a footnote (BEUK:pdfnotes, 2026-11-23).
   A PDF holds no note, only a small number set above the line and, somewhere, a block of text that opens on the same
   number. The reader knew the raised number (it keeps it a word of its own) and made nothing of it: the number stayed
   a number in the text ("…witness seal. 8"), the note's text came in as ordinary paragraphs opening on its number
   (a chapter's ten notes as one paragraph, in the Meridian test book), and the report and the tally said nothing of
   notes. Measured on that book's two PDFs against its Word file's 121 notes: none linked.

   The rule now, on what the page shows and nothing else:
   - a note's text is a block that opens on a number (the number and a stop, "7. …", or the number raised and small
     before the text), set smaller than the book's text, and standing where notes stand: at the foot of a page, under
     that page's text, or in a run of such blocks at the end of a chapter or of the book;
   - a raised number in the text is that note's mark where the note stands at the foot of the mark's own page, or is
     the nearest note of that number after the mark in the mark's own chapter: the text then holds "[^n]", n the
     number the PDF shows, and the note's text is the note "[^n]: …" of the section the mark stands in;
   - a raised number with no such block stays the number it was (an exponent, a unit): nothing is made of it;
   - a note's block that no raised number marks stays a paragraph where it stood, its number with it, and the report
     names it;
   - a note cut by the page turn goes on where the next page shows it does; where the page does not show it, the lines
     stay where they stand and the report names the note;
   - a rule of characters above a page's notes is the typesetter's: set aside, in a row of the tally of its own;
   - the tally counts the marks and the notes on both sides, and each note's two numbers (the mark's and the one its
     block opens on) among the footnote numbers set aside.
   Every text here is made up. pdf(): a run with a `rise` is a raised number; a line with a `y` stands at that height. */

const SIZE = 11, SMALL = 8.5, UP = 7.5;
const TIDE = 'and the tide kept its own count of the days while the salt answered to no clerk on the quay';
const t = (text: string, gap = 15, size = SIZE): PdfLine => ({ text, size, gap });
/** a line of the text with a raised number set against a word of it */
const up = (before: string, n: string, after = '', gap = 15): PdfLine => ({ size: SIZE, gap, runs: [{ text: before }, { text: n, size: UP, rise: 0.4 }, ...(after ? [{ text: after }] : [])] });
/** a line of a note: set smaller than the text */
const note = (text: string, gap = 11, y?: number): PdfLine => ({ text, size: SMALL, gap, ...(y == null ? {} : { y }) });
const head = (s: string): PdfLine => ({ text: s, size: 20, gap: 40 });
const fill = (n: number, last = 30): PdfLine[] => Array.from({ length: n }, (x, k) => t(TIDE + (k % 3 === 2 ? '.' : ','), k === n - 1 ? last : 15));
const FILLED = (n: number) => Array.from({ length: n }, (x, k) => TIDE + (k % 3 === 2 ? '.' : ',')).join(' ');

const chapters = (g: Got) => written(g).filter((s) => s.type === 'chapter');
const blocks = (g: Got, n = 0) => blocksOf(chapters(g)[n].content);
const defs = (g: Got, n = 0) => blocks(g, n).filter((b) => /^\[\^[^\]]+\]:/.test(b));
const text = (g: Got, n = 0) => blocks(g, n).filter((b) => !/^\[\^[^\]]+\]:/.test(b));
const all = (g: Got) => g.secs.map((s) => s.content).join('\n\n');
type Row = { key: string; file: number; book: number; why?: { k: string; n: number; side: number }[] };
const row = (g: Got, key: string) => { const r = (g.tally.rows as Row[]).find((x) => x.key === key); return r ? { file: r.file, book: r.book, why: (r.why || []).map((y) => [y.k, y.n, y.side]) } : null; };
const item = (g: Got, kind: string) => g.rep.items.filter((i) => i.kind === kind).map((i) => ({ ...(i.data || {}), before: i.before }));
const notesSaid = (g: Got) => { const i = g.rep.items.find((x) => x.kind === 'notes'); return i ? i.data : null; };
/* BEUK_NOTES_OUT names a file to write what a case gives into (vitest hides the console) */
const seen = (name: string, g: Got) => { if (process.env.BEUK_NOTES_OUT) appendFileSync(process.env.BEUK_NOTES_OUT, JSON.stringify({ name, chapters: chapters(g).map((s) => blocksOf(s.content)), aside: g.tally.aside, rows: g.tally.rows, figures: figures(g), items: g.rep.items.filter((i) => /note|Note/.test(i.kind)) }) + String.fromCharCode(10)); };

beforeAll(async () => { await setupImport('import-pdf-notes'); }, 180_000);

describe('notes gathered at a chapter\'s end', () => {
  /* two chapters numbered through (1, 2 | 3); "10" with a raised 3 stands in the first, and note 3 is the second's */
  const through = (): PdfLine[] => [
    head('Chapter One'),
    up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
    t('year to whoever would pay for them in kind.', 30),
    ...fill(3),
    up('A heap of 10', '3', ' sacks stood on the mole when the ferry came in at the turn of the'),
    t('tide, and nobody counted them twice.'),
    up('The gate was shut at dusk.', '2', '', 30),
    note('1. A sack held two bushels of coarse salt.'),
    note('2. The gate stood at the east mole, and its keeper'),
    note('was paid by the year.'),
    { page: true },
    head('Chapter Two'),
    up('The ferry ran at the turn of the tide', '3', ' and carried the post.', 30),
    ...fill(3),
    note('3. It carried no passengers in winter.'),
  ];

  it('each raised number carries its note: the text holds "[^n]" against its word, and the note\'s text is that note of its own chapter', async () => {
    const g = await importFile('chapter-end.pdf', await pdf(through()), '');
    seen('chapter-end', g);
    expect(text(g, 0)).toEqual([
      'The salt was taxed by the sack at the quay gate[^1] and the pans were let by the year to whoever would pay for them in kind.',
      FILLED(3),
      'A heap of 10 3 sacks stood on the mole when the ferry came in at the turn of the tide, and nobody counted them twice.',
      'The gate was shut at dusk.[^2]',
    ]);
    expect(defs(g, 0)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole, and its keeper was paid by the year.']);
    expect(text(g, 1)).toEqual(['The ferry ran at the turn of the tide[^3] and carried the post.', FILLED(3)]);
    expect(defs(g, 1)).toEqual(['[^3]: It carried no passengers in winter.']);
  }, 120_000);

  it('the report says the notes, and the tally counts them on both sides: three marks and three notes, their six numbers among the footnote numbers set aside', async () => {
    const g = await importFile('chapter-end.pdf', await pdf(through()), '');
    expect(notesSaid(g)).toEqual({ found: 3, refs: 3, mapped: 3, orphans: 0 });
    expect(row(g, 'noteRefs')).toEqual({ file: 3, book: 3, why: [] });
    expect(row(g, 'noteDefs')).toEqual({ file: 3, book: 3, why: [] });
    // the three raised numbers (3 characters) and "1.", "2.", "3." (6): the book writes each as its own mark
    expect(g.tally.aside.noteMarks).toBe(9);
    expect(figures(g)).toEqual(CLEAR);
    expect(item(g, 'noteOrphan')).toEqual([]);
  }, 120_000);

  it('a raised number that is an exponent stays the number it was: "10" and "3" where its chapter has no note 3, though the next chapter has', async () => {
    const g = await importFile('chapter-end.pdf', await pdf(through()), '');
    expect(all(g)).toContain('A heap of 10 3 sacks stood');
    expect(all(g).match(/\[\^3\](?!:)/g)).toEqual(['[^3]']);
    expect(chapters(g)[0].content).not.toContain('[^3]');
  }, 120_000);

  it('numbers that begin again in every chapter: each mark means the note of its own chapter', async () => {
    const g = await importFile('restart.pdf', await pdf([
      head('Chapter One'),
      up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
      t('year to whoever would pay for them in kind.', 30),
      ...fill(3),
      up('The gate was shut at dusk.', '2', '', 30),
      note('1. A sack held two bushels of coarse salt.'),
      note('2. The gate stood at the east mole.'),
      { page: true },
      head('Chapter Two'),
      up('The ferry ran at the turn of the tide', '1', ' and carried the post.', 30),
      ...fill(3),
      up('The lamp was lit at the mole.', '2', '', 30),
      note('1. It carried no passengers in winter.'),
      note('2. The lamp burned whale oil until the year of the fire.'),
    ]), '');
    seen('restart', g);
    expect(text(g, 0)[0]).toBe('The salt was taxed by the sack at the quay gate[^1] and the pans were let by the year to whoever would pay for them in kind.');
    expect(text(g, 0)[2]).toBe('The gate was shut at dusk.[^2]');
    expect(defs(g, 0)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole.']);
    expect(text(g, 1)[0]).toBe('The ferry ran at the turn of the tide[^1] and carried the post.');
    expect(text(g, 1)[2]).toBe('The lamp was lit at the mole.[^2]');
    expect(defs(g, 1)).toEqual(['[^1]: It carried no passengers in winter.', '[^2]: The lamp burned whale oil until the year of the fire.']);
    expect(notesSaid(g)).toEqual({ found: 4, refs: 4, mapped: 4, orphans: 0 });
    expect(row(g, 'noteRefs')).toEqual({ file: 4, book: 4, why: [] });
    expect(row(g, 'noteDefs')).toEqual({ file: 4, book: 4, why: [] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a note that runs over the page turn in its chapter\'s run of notes is one note', async () => {
    const g = await importFile('run-turn.pdf', await pdf([
      head('Chapter One'),
      up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
      t('year to whoever would pay for them in kind.', 30),
      ...fill(3),
      up('The gate was shut at dusk.', '2', '', 30),
      note('1. A sack held two bushels of coarse salt.'),
      note('2. The gate stood at the east mole, and its keeper'),
      { page: true },
      note('was paid by the year, in salt.'),
      { page: true },
      head('Chapter Two'),
      ...fill(3),
    ]), '');
    seen('run-turn', g);
    expect(defs(g, 0)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole, and its keeper was paid by the year, in salt.']);
    expect(text(g, 1)).toEqual([FILLED(3)]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a note\'s block that no raised number marks stays a paragraph where it stood, its number with it; the report names it and the tally\'s two totals differ by it', async () => {
    const g = await importFile('unmarked.pdf', await pdf([
      head('Chapter One'),
      up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
      t('year to whoever would pay for them in kind.', 30),
      ...fill(3),
      up('The gate was shut at dusk.', '3', '', 30),
      note('1. A sack held two bushels of coarse salt.'),
      note('2. The pans lay beyond the mole, and nothing in the'),
      note('text points to this note.'),
      note('3. The gate stood at the east mole.'),
    ]), '');
    seen('unmarked', g);
    expect(text(g)).toEqual([
      'The salt was taxed by the sack at the quay gate[^1] and the pans were let by the year to whoever would pay for them in kind.',
      FILLED(3),
      'The gate was shut at dusk.[^3]',
      '2. The pans lay beyond the mole, and nothing in the text points to this note.',
    ]);
    expect(defs(g)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^3]: The gate stood at the east mole.']);
    expect(item(g, 'noteOrphan')).toEqual([{ n: '2', before: '2. The pans lay beyond the mole, and nothing in the text points to this note.' }]);
    expect(g.rep.items.find((i) => i.kind === 'noteOrphan')!.where!.secId).toBe(chapters(g)[0].id);
    expect(notesSaid(g)).toEqual({ found: 3, refs: 2, mapped: 2, orphans: 1 });
    // the file holds three notes, the book two: the third is named, kept as text
    expect(row(g, 'noteDefs')).toEqual({ file: 3, book: 2, why: [['notesOrphan', 1, 1]] });
    expect(row(g, 'noteRefs')).toEqual({ file: 2, book: 2, why: [] });
    // "1", "3", "1." and "3.": the unmarked note keeps its "2." in the text
    expect(g.tally.aside.noteMarks).toBe(6);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a numbered line in the text\'s own size at a chapter\'s end is not set as notes are set: the raised number stays a number and the line a line of the text', async () => {
    const g = await importFile('same-size.pdf', await pdf([
      head('Chapter One'),
      up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
      t('year to whoever would pay for them in kind.', 30),
      ...fill(3),
      t('1. A sack held two bushels of coarse salt.', 30),
    ]), '');
    seen('same-size', g);
    expect(text(g)).toEqual([
      'The salt was taxed by the sack at the quay gate 1 and the pans were let by the year to whoever would pay for them in kind.',
      FILLED(3),
      '1. A sack held two bushels of coarse salt.',
    ]);
    expect(defs(g)).toEqual([]);
    expect(notesSaid(g)).toBeNull();
    expect(row(g, 'noteRefs')).toBeNull();
    expect(g.tally.aside.noteMarks).toBeUndefined();
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('small numbered lines in the middle of a chapter, the text going on after them, are not a chapter\'s notes', async () => {
    const g = await importFile('mid-chapter.pdf', await pdf([
      head('Chapter One'),
      up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
      t('year to whoever would pay for them in kind.', 30),
      note('1. A sack held two bushels of coarse salt.', 30),
      ...fill(3),
    ]), '');
    seen('mid-chapter', g);
    expect(all(g)).not.toContain('[^');
    expect(text(g)).toEqual([
      'The salt was taxed by the sack at the quay gate 1 and the pans were let by the year to whoever would pay for them in kind.',
      '1. A sack held two bushels of coarse salt.',
      FILLED(3),
    ]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('a raised number inside a table\'s cell', () => {
  const A = 60, B = 150, C = 330;
  const cells = (a: string, b: string, c: PdfLine | string, gap: number): PdfLine[] => [
    { text: a, x: A, size: SIZE, gap: 0 }, { text: b, x: B, size: SIZE, gap: 0 },
    typeof c === 'string' ? { text: c, x: C, size: SIZE, gap } : { ...c, x: C, gap },
  ];
  it('is its note\'s mark as in the text: the cell holds "[^n]" against its word, and the note stands in the table\'s chapter', async () => {
    const g = await importFile('cell.pdf', await pdf([
      head('Chapter One'),
      ...fill(3),
      ...cells('Code', 'Office', 'Note', 24),
      ...cells('VIE-04', 'Vienna harbour office', 'held over until the spring tides had run', 14),
      { text: 'their course and the pans were dry again', x: C, size: SIZE, gap: 24 },
      ...cells('GRZ-02', 'Graz siding office', 'closed for the season', 24),
      ...cells('VCE-01', 'Venice bindery', { size: SIZE, runs: [{ text: 'open' }, { text: '1', size: UP, rise: 0.4 }] }, 30),
      ...fill(3),
      up('The gate was shut at dusk.', '2', '', 30),
      note('1. The bindery kept no ledger of its own.'),
      note('2. The gate stood at the east mole.'),
    ]), '');
    seen('cell', g);
    const table = blocks(g).filter((b) => /^::: table/.test(b)).map((b) => b.split('\n').filter((l) => /^\|/.test(l)).map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())));
    expect(table).toEqual([[
      ['Code', 'Office', 'Note'],
      ['VIE-04', 'Vienna harbour office', 'held over until the spring tides had run their course and the pans were dry again'],
      ['GRZ-02', 'Graz siding office', 'closed for the season'],
      ['VCE-01', 'Venice bindery', 'open[^1]'],
    ]]);
    expect(defs(g)).toEqual(['[^1]: The bindery kept no ledger of its own.', '[^2]: The gate stood at the east mole.']);
    expect(notesSaid(g)).toEqual({ found: 2, refs: 2, mapped: 2, orphans: 0 });
    expect(row(g, 'noteRefs')).toEqual({ file: 2, book: 2, why: [] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('with no note of its number it stays the number it was, a word of its own in its cell', async () => {
    const g = await importFile('cell-bare.pdf', await pdf([
      head('Chapter One'),
      ...fill(3),
      ...cells('Code', 'Office', 'Note', 24),
      ...cells('VIE-04', 'Vienna harbour office', 'held over until the spring tides had run', 14),
      { text: 'their course and the pans were dry again', x: C, size: SIZE, gap: 24 },
      ...cells('GRZ-02', 'Graz siding office', 'closed for the season', 24),
      ...cells('VCE-01', 'Venice bindery', { size: SIZE, runs: [{ text: 'open' }, { text: '1', size: UP, rise: 0.4 }] }, 30),
      ...fill(3),
    ]), '');
    seen('cell-bare', g);
    expect(all(g)).toContain('| VCE-01 | Venice bindery | open 1 |');
    expect(all(g)).not.toContain('[^');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('notes at the foot of a page', () => {
  const RULE = '____________';
  /* a full page of the text (twelve lines) whose last line the page turn cuts, and its notes at the page's foot */
  const pageOne = (foot: PdfLine[]): PdfLine[] => [
    head('Chapter One'),
    up('The salt was taxed by the sack at the quay gate', '1', ' and the pans were let by the'),
    t('year to whoever would pay for them in kind.', 30),
    ...fill(8, 15),
    up('The gate was shut at dusk', '2', ' and the harbour master wrote the weights of every load'),
    t('into the long book that he kept on the high desk by the window of the weigh house,'),
    ...foot,
    { page: true },
  ];
  const pageTwo = (foot: PdfLine[]): PdfLine[] => [
    t('which nobody else was ever allowed to open or to read while he lived.', 30),
    ...fill(9, 15),
    up('The ferry ran at the turn of the tide', '3', ' and carried the post.', 30),
    t('It was the last boat of the day.'),
    ...foot,
  ];
  const TURNED = FILLED(8) + ' The gate was shut at dusk[^2] and the harbour master wrote the weights of every load into the long book that he kept on the high desk by the window of the weigh house, which nobody else was ever allowed to open or to read while he lived.';

  it('under a rule: each raised number carries the note at the foot of its own page, the rule is set aside, and the paragraph the page turn cut goes on over the notes', async () => {
    const g = await importFile('foot.pdf', await pdf([
      ...pageOne([note(RULE, 12, 120), note('1. A sack held two bushels of coarse salt.'), note('2. The gate stood at the east mole, and its keeper'), note('was paid by the year.')]),
      ...pageTwo([note(RULE, 12, 120), note('3. It carried no passengers in winter.')]),
    ]), '');
    seen('foot', g);
    expect(text(g)).toEqual([
      'The salt was taxed by the sack at the quay gate[^1] and the pans were let by the year to whoever would pay for them in kind.',
      TURNED,
      FILLED(9) + ' The ferry ran at the turn of the tide[^3] and carried the post.',
      'It was the last boat of the day.',
    ]);
    expect(defs(g)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole, and its keeper was paid by the year.', '[^3]: It carried no passengers in winter.']);
    expect(all(g)).not.toContain('_');
    // the two rules, twelve characters each, in a row of their own; the three marks and "1.", "2.", "3."
    expect(g.tally.aside.noteRules).toBe(24);
    expect(g.tally.aside.noteMarks).toBe(9);
    expect(item(g, 'pdfNoteRules')).toEqual([{ n: 2, before: undefined }]);
    expect(notesSaid(g)).toEqual({ found: 3, refs: 3, mapped: 3, orphans: 0 });
    expect(row(g, 'noteRefs')).toEqual({ file: 3, book: 3, why: [] });
    expect(row(g, 'noteDefs')).toEqual({ file: 3, book: 3, why: [] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('with no rule, each note under its number raised and small: the same notes', async () => {
    const raised = (n: string, s: string, y?: number): PdfLine => ({ size: SMALL, gap: 11, ...(y == null ? {} : { y }), runs: [{ text: n, size: 6, rise: 0.35 }, { text: ' ' + s }] });
    const g = await importFile('foot-raised.pdf', await pdf([
      ...pageOne([raised('1', 'A sack held two bushels of coarse salt.', 108), raised('2', 'The gate stood at the east mole, and its keeper'), note('was paid by the year.')]),
      ...pageTwo([raised('3', 'It carried no passengers in winter.', 108)]),
    ]), '');
    seen('foot-raised', g);
    expect(text(g)[1]).toBe(TURNED);
    expect(defs(g)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole, and its keeper was paid by the year.', '[^3]: It carried no passengers in winter.']);
    // the three marks and the three numbers the notes open on
    expect(g.tally.aside.noteMarks).toBe(6);
    expect(g.tally.aside.noteRules).toBeUndefined();
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a note the page turn cuts goes on at the foot of the next page, above that page\'s own notes, where the page shows it: under the rule, or its sentence still open', async () => {
    for (const rule of [true, false]) {
      const g = await importFile('foot-turn.pdf', await pdf([
        ...pageOne([...(rule ? [note(RULE, 12, 120)] : []), note('1. A sack held two bushels of coarse salt.', 11, 108), note('2. The gate stood at the east mole, and its keeper was a man the')]),
        ...pageTwo([...(rule ? [note(RULE, 12, 120)] : []), note('harbour master paid by the year, in salt.', 11, 108), note('3. It carried no passengers in winter.')]),
      ]), '');
      seen('foot-turn ' + rule, g);
      expect(defs(g), rule ? 'under a rule' : 'no rule').toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole, and its keeper was a man the harbour master paid by the year, in salt.', '[^3]: It carried no passengers in winter.']);
      expect(text(g)[1]).toBe(TURNED);
      expect(text(g).length).toBe(4);
      expect(item(g, 'pdfNoteUnsure')).toEqual([]);
      expect(figures(g)).toEqual(CLEAR);
    }
  }, 240_000);

  it('where the page does not show whether a note goes on (no rule, its sentence closed), the lines above the next page\'s notes stay where they stand and the report names the note', async () => {
    const g = await importFile('foot-doubt.pdf', await pdf([
      ...pageOne([note('1. A sack held two bushels of coarse salt.', 11, 108), note('2. The gate stood at the east mole.')]),
      ...pageTwo([note('Its keeper was paid by the year, in salt.', 11, 108), note('3. It carried no passengers in winter.')]),
    ]), '');
    seen('foot-doubt', g);
    expect(defs(g)).toEqual(['[^1]: A sack held two bushels of coarse salt.', '[^2]: The gate stood at the east mole.', '[^3]: It carried no passengers in winter.']);
    expect(text(g)).toContain('Its keeper was paid by the year, in salt.');
    expect(item(g, 'pdfNoteUnsure')).toEqual([{ n: 1, notes: ['2'], before: '“2”' }]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
