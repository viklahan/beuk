// @vitest-environment node
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, docx, english as t, epub, figures, importFile, odt, oh, page as webPage, rtfDoc, rtfH, rw, setupImport, wp, W_NS, type Api, type Got, type Rec, type Sec } from './import-given';

/* A footnote keeps the label the writer typed; the number a reader sees is worked out when the book is shown
   (BEUK:notelabels). The owner, 2026-11-22, on finding a note shown as "[110]", a number Beuk had made up: "WHY ARE WE
   INVENTING NUMBERS?" and then "yes, do it, keep the writer's labels… KEEP WHAT THE WRITER GIVES US."

   Before: a Markdown file's notes may carry any label ("[^1]", "[^fn-9]", "[^salt]"). A file whose labels were all
   numbers of one to three digits was left as typed; any other file had its notes NUMBERED in the order of first
   reference and the stored text rewritten: "The caravan left[^salt] at dawn." was stored "The caravan left[^1] at
   dawn.", and "[^salt]: Salt, by the sack." was stored "[^1]: Salt, by the sack.". The writer's label was gone from
   the book, and every surface read a note mark as digits only.

   Now: the book stores "[^salt]" and "[^salt]: …". Every surface reads a note by its label and works out the number
   it shows: a label that is itself a number shows that number, as typed; any other label takes, in the order of first
   reference through the book, the next number that no numeric label in the book uses. The Markdown export writes the
   label as stored. A book of numbers reads exactly as it did.

   Every text here is made up. */

type Case = { name: string; sections: string[]; shown: string[] };
const FIXTURE = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'note-labels.json'), 'utf8')) as { cases: Case[] };

const P2 = '\n\n';
const md = (...blocks: string[]) => blocks.join(P2) + '\n';
const chapter = (g: Got, n: string) => g.secs.find((s) => s.type === 'chapter' && s.number === n)!;
const stored = (g: Got, n: string) => blocksOf(chapter(g, n).content);
const whole = (g: Got) => g.secs.map((s) => s.content).join('\n');
/** the section's text as a reader is shown its notes */
const shown = (g: Got, n: string) => blocksOf(String(g.api.notesAsShown!(null, chapter(g, n).content)));
/** the typeset page of a section: the marks it shows in order (an unlinked one with "~" before it), the numbers its Notes list shows, and the ids its notes carry */
function page(g: Got, s: Sec): { marks: string[]; notes: string[]; ids: string[]; html: string } {
  const html = String(g.api.contentBlocksToHtml!(s.content, s, false, true));
  return {
    html,
    marks: [...html.matchAll(/(<a class="noteref"[^>]*>)?<sup class="endnote-ref">([^<]*)<\/sup>/g)].map((x) => (x[1] ? '' : '~') + x[2]),
    notes: [...html.matchAll(/<p class="endnote" id="[^"]*"[^>]*><a class="note-back"[^>]*><sup>([^<]*)<\/sup><\/a> ([^<]*)/g)].map((x) => x[1] + ' ' + x[2]),
    ids: [...html.matchAll(/ id="s\d+-(fn(?:ref)?[^"]*)"/g)].map((x) => x[1]!),
  };
}
const items = (g: Got, kind: string) => g.rep.items.filter((it) => it.kind === kind);
const row = (g: Got, key: string) => { const r = (g.tally.rows as { key: string; file: number; book: number; why?: { k: string; n: number }[] }[]).find((x) => x.key === key)!; return { file: r.file, book: r.book, why: (r.why || []).map((y) => [y.k, y.n]) }; };
/** a book of these chapters, set straight into the studio (no import): the module's functions, and each chapter as the book holds it */
async function bookOf(contents: string[]): Promise<{ api: Api; secs: Sec[] }> {
  const g = await importFile('seed.md', null, '# Chapter 1: Seed\n\nSeed.\n');
  const doc = g.api.snapshotBookDoc!() as Rec & { sections: Sec[] };
  doc.sections = contents.map((content, i) => ({ id: 'made-' + i, kind: 'body', type: 'chapter', number: String(i + 1), title: 'Made ' + (i + 1), content }));
  g.api.applyBookDoc!(doc);
  return { api: g.api, secs: (g.api.snapshotBookDoc!() as { sections: Sec[] }).sections };
}

beforeAll(async () => {
  await setupImport('note-labels-as-typed', ['contentBlocksToHtml', 'notesAsShown', 'buildMarkdown', 'buildDocxDocumentXml', 'msPlan', 'msDocumentXml', 'acxSectionLines', 'acxPlainInline', 'countWords', 'countWordsClean', 'insCleanText', 'nextFootnoteNumber', 'chopMergePlan', 'irItemLabel']);
}, 180_000);

describe('a footnote keeps the label the writer typed; the number a reader sees is worked out when the book is shown', () => {

  it('the numbering itself: every case of the table the server\'s copy is held to (tests/fixtures/note-labels.json)', async () => {
    expect(FIXTURE.cases.length).toBeGreaterThanOrEqual(13);
    for (const c of FIXTURE.cases) {
      const b = await bookOf(c.sections);
      expect(b.secs.map((s) => s.content), c.name + ': the book holds the text as given').toEqual(c.sections);
      expect(b.secs.map((s) => String(b.api.notesAsShown!(null, s.content))), c.name).toEqual(c.shown);
    }
  }, 240_000);

  it('Markdown, named labels: the book stores the label the file typed, and every surface shows the number worked out from it', async () => {
    const g = await importFile('salt.md', null, md('# Chapter 1: Dawn', 'The caravan left[^salt] at dawn.', '[^salt]: Salt, by the sack.',
      '# Chapter 2: Noon', 'The pans lay white[^pans], and whiter[^pans].', '[^pans]: The pans of the coast.'));
    // stored: the writer's labels, where Beuk used to write "[^1]" and "[^2]" over them
    expect(stored(g, '1')).toEqual(['The caravan left[^salt] at dawn.', '[^salt]: Salt, by the sack.']);
    expect(stored(g, '2')).toEqual(['The pans lay white[^pans], and whiter[^pans].', '[^pans]: The pans of the coast.']);
    expect(whole(g).match(/\[\^?\d+\]/g) || [], 'a number of Beuk\'s in the stored text').toEqual([]);
    // shown: 1 and 2, in the order the notes are first marked
    expect(shown(g, '1')).toEqual(['The caravan left[^1] at dawn.', '[^1]: Salt, by the sack.']);
    expect(shown(g, '2')).toEqual(['The pans lay white[^2], and whiter[^2].', '[^2]: The pans of the coast.']);
    // the typeset page (the preview, the reading views, the EPUB, the standalone HTML and the print interior are built from it)
    const p1 = page(g, chapter(g, '1')), p2 = page(g, chapter(g, '2'));
    expect({ marks: p1.marks, notes: p1.notes, ids: p1.ids }).toEqual({ marks: ['[1]'], notes: ['[1] Salt, by the sack.'], ids: ['fnref1', 'fn1'] });
    expect({ marks: p2.marks, notes: p2.notes, ids: p2.ids }).toEqual({ marks: ['[2]', '[2]'], notes: ['[2] The pans of the coast.'], ids: ['fnref2', 'fn2'] });
    for (const html of [p1.html, p2.html]) expect(html).not.toMatch(/salt\]|pans\]/);
    // the Word export: the mark raised as "[n]", and the note among the Endnotes under that number
    const docx = String(g.api.buildDocxDocumentXml!());
    expect((docx.match(/>\[1\]<\/w:t>/g) || []).length).toBe(1);
    expect((docx.match(/>\[2\]<\/w:t>/g) || []).length).toBe(2);
    expect((docx.match(/>\[1\] <\/w:t>/g) || []).length).toBe(1);
    expect((docx.match(/>\[2\] <\/w:t>/g) || []).length).toBe(1);
    expect(docx).not.toMatch(/salt\]|pans\]/);
    // the submission manuscript: its Notes numbered the same
    const ms = String(g.api.msDocumentXml!(g.api.msPlan!()));
    expect((ms.match(/>1\. <\/w:t>/g) || []).length).toBe(1);
    expect((ms.match(/>2\. <\/w:t>/g) || []).length).toBe(1);
    expect((ms.match(/>\[2\]<\/w:t>/g) || []).length).toBe(2);
    expect(ms).not.toMatch(/salt\]|pans\]/);
    // the narration script: the note said after its paragraph, under the number
    const lines = g.api.acxSectionLines!(chapter(g, '2')) as { k: string; n?: string; text: string }[];
    expect(lines.filter((l) => l.k === 'note').map((l) => [l.n, l.text])).toEqual([['2', 'The pans of the coast.']]);
    expect(lines.filter((l) => l.k === 'para').map((l) => String(g.api.acxPlainInline!(l.text)))).toEqual(['The pans lay white [NOTE 2], and whiter [NOTE 2].']);
    // the Markdown export: the label as stored
    const out = String(g.api.buildMarkdown!());
    expect(out).toContain('The caravan left[^salt] at dawn.\n\n[^salt]: Salt, by the sack.');
    expect(out).toContain('The pans lay white[^pans], and whiter[^pans].\n\n[^pans]: The pans of the coast.');
    // word counts and Story Insights: a mark is no word, whatever its label ("left[^salt]" is the one word "left")
    expect(String(g.api.countWordsClean!(chapter(g, '1').content)).replace(/\s+/g, ' ').trim()).toBe('The caravan left at dawn. Salt, by the sack.');
    expect(g.api.countWords!(chapter(g, '1').content)).toBe(9);
    expect(String(g.api.insCleanText!(chapter(g, '1').content)).replace(/\s+/g, ' ').trim()).toBe('The caravan left at dawn. Salt, by the sack.');
    // the report and the tally: two notes found and linked, nothing unaccounted
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 2, refs: 3, mapped: 2, orphans: 0 });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a mixed file: a number shows as typed, and a named note takes the next number the writer has not used', async () => {
    const g = await importFile('mixed.md', null, md('# Chapter 1: Dawn', 'One[^1] two[^salt] three[^3] four[^pans].', '[^1]: First.', '[^salt]: Salt.', '[^3]: Third.', '[^pans]: Pans.'));
    expect(stored(g, '1')).toEqual(['One[^1] two[^salt] three[^3] four[^pans].', '[^1]: First.', '[^salt]: Salt.', '[^3]: Third.', '[^pans]: Pans.']);
    expect(shown(g, '1')).toEqual(['One[^1] two[^2] three[^3] four[^4].', '[^1]: First.', '[^2]: Salt.', '[^3]: Third.', '[^4]: Pans.']);
    const p = page(g, chapter(g, '1'));
    expect(p.marks).toEqual(['[1]', '[2]', '[3]', '[4]']);
    expect(p.notes).toEqual(['[1] First.', '[2] Salt.', '[3] Third.', '[4] Pans.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a label defined in two chapters (notes that start again in every chapter): each chapter keeps the label and has its own note', async () => {
    const g = await importFile('again.md', null, md('# Chapter 1: The Harbour', 'One[^a].', '[^a]: The harbour\'s note.', '# Chapter 2: The Crossing', 'Two[^a].', '[^a]: The crossing\'s note.'));
    expect(stored(g, '1')).toEqual(['One[^a].', '[^a]: The harbour\'s note.']);
    expect(stored(g, '2')).toEqual(['Two[^a].', '[^a]: The crossing\'s note.']);
    expect(shown(g, '1')).toEqual(['One[^1].', '[^1]: The harbour\'s note.']);
    expect(shown(g, '2')).toEqual(['Two[^2].', '[^2]: The crossing\'s note.']);
    expect(page(g, chapter(g, '2')).notes).toEqual(['[2] The crossing\'s note.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a label defined twice in ONE chapter: a mark means the next definition of its label at or after it, else the last one before; each definition is set after its own last mark so the stored text still says which is which', async () => {
    const g = await importFile('twice.md', null, md('# Chapter 1: Dawn', 'One[^a] and again[^a].', '[^a]: First.', 'Two[^a].', '[^a]: Second.', 'After the last[^a].', 'A plain note[^b].', '[^b]: Plain.', '# Chapter 2: Noon', 'Noon.'));
    // the first "[^a]" definition answers the two marks before it; the second answers the mark between them and the one after it
    expect(stored(g, '1')).toEqual(['One[^a] and again[^a].', '[^a]: First.', 'Two[^a].', 'After the last[^a].', '[^a]: Second.', 'A plain note[^b].', '[^b]: Plain.']);
    expect(shown(g, '1')).toEqual(['One[^1] and again[^1].', '[^1]: First.', 'Two[^2].', 'After the last[^2].', '[^2]: Second.', 'A plain note[^3].', '[^3]: Plain.']);
    const p = page(g, chapter(g, '1'));
    expect(p.marks).toEqual(['[1]', '[1]', '[2]', '[2]', '[3]']);
    expect(p.notes).toEqual(['[1] First.', '[2] Second.', '[3] Plain.']);
    expect(p.ids).toEqual(['fnref1', 'fnref2', 'fnref3', 'fn1', 'fn2', 'fn3']);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 3, mapped: 3, orphans: 0 });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  /* Two notes of one label are told apart by where their definitions stand. A definition typed between two lines of
     one paragraph parts that paragraph where it stood (the import takes the definition's line out and leaves the
     line's place empty, as it always did), so the two marks are never left in one block with nothing between them. */
  it('a label defined twice, the first definition typed between two lines of one paragraph: the lines are parted where it stood, and each mark keeps its own note', async () => {
    const g = await importFile('between.md', null, md('# Chapter 1: Dawn', 'One[^a]\n[^a]: First.\nTwo[^a].', '[^a]: Second.', '# Chapter 2: Noon', 'Noon.'));
    expect(stored(g, '1')).toEqual(['One[^a]', '[^a]: First.', 'Two[^a].', '[^a]: Second.']);
    expect(shown(g, '1')).toEqual(['One[^1]', '[^1]: First.', 'Two[^2].', '[^2]: Second.']);
    expect(page(g, chapter(g, '1')).notes).toEqual(['[1] First.', '[2] Second.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a label with punctuation, an underscore or an asterisk is kept to the character; a number with leading zeros is stored as typed and shows as typed', async () => {
    const g = await importFile('marks.md', null, md('# Chapter 1: Dawn', 'A[^fn.2-a] b[^007] c[^fn_3] d[^fn_4] e[^a*b] f[^c*d].',
      '[^fn.2-a]: Dotted.', '[^007]: Bond.', '[^fn_3]: Third.', '[^fn_4]: Fourth.', '[^a*b]: Starred.', '[^c*d]: Starred again.'));
    expect(stored(g, '1')).toEqual(['A[^fn.2-a] b[^007] c[^fn_3] d[^fn_4] e[^a*b] f[^c*d].', '[^fn.2-a]: Dotted.', '[^007]: Bond.', '[^fn_3]: Third.', '[^fn_4]: Fourth.', '[^a*b]: Starred.', '[^c*d]: Starred again.']);
    // "007" is a number: it shows as the writer typed it, and 7 is never given to another note (none reaches 7 here)
    expect(shown(g, '1')).toEqual(['A[^1] b[^007] c[^2] d[^3] e[^4] f[^5].', '[^1]: Dotted.', '[^007]: Bond.', '[^2]: Third.', '[^3]: Fourth.', '[^4]: Starred.', '[^5]: Starred again.']);
    const p = page(g, chapter(g, '1'));
    expect(p.marks).toEqual(['[1]', '[007]', '[2]', '[3]', '[4]', '[5]']);
    expect(p.notes).toEqual(['[1] Dotted.', '[007] Bond.', '[2] Third.', '[3] Fourth.', '[4] Starred.', '[5] Starred again.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('round trip: the Markdown export writes the labels as stored, and the exported file imported again is the same book and exports the same file', async () => {
    const first = await importFile('trip.md', null, md('# Chapter 1: Dawn', 'The caravan left[^salt] at dawn, by[^2] the gate[^fn.2-a].', '[^salt]: Salt, by the sack.', '[^2]: The writer\'s own number.', '[^fn.2-a]: Dotted.',
      '# Chapter 2: Noon', 'The pans lay white[^salt].', '[^salt]: The pans\' own salt.'));
    const out1 = String(first.api.buildMarkdown!());
    const second = await importFile('trip-again.md', null, out1);
    const out2 = String(second.api.buildMarkdown!());
    const chapters = (g: Got) => g.secs.filter((s) => s.type === 'chapter').map((s) => [s.number, s.title, s.content]);
    expect(chapters(second)).toEqual(chapters(first));
    expect(stored(second, '1')).toEqual(['The caravan left[^salt] at dawn, by[^2] the gate[^fn.2-a].', '[^salt]: Salt, by the sack.', '[^2]: The writer\'s own number.', '[^fn.2-a]: Dotted.']);
    expect(stored(second, '2')).toEqual(['The pans lay white[^salt].', '[^salt]: The pans\' own salt.']);
    expect(out2).toBe(out1);
    // and what a reader is shown is the same both times: 2 is the writer's, so the named notes take 1, 3 and 4
    for (const g of [first, second]) {
      expect(shown(g, '1')).toEqual(['The caravan left[^1] at dawn, by[^2] the gate[^3].', '[^1]: Salt, by the sack.', '[^2]: The writer\'s own number.', '[^3]: Dotted.']);
      expect(shown(g, '2')).toEqual(['The pans lay white[^4].', '[^4]: The pans\' own salt.']);
    }
  }, 240_000);

  it('the report and the tally on a file whose totals differ: a note nothing marks and a mark with no note are named by the writer\'s label, and the rows say why they differ', async () => {
    const g = await importFile('differ.md', null, md('# Chapter 1: Dawn', 'The caravan left[^salt] at dawn.', '[^salt]: Salt, by the sack.', '[^telex-a]: Sent from Vienna, unmarked.',
      '# Chapter 2: Noon', 'The pans lay white[^pans] and lost[^nowhere].', '[^pans]: The pans of the coast.'));
    expect(stored(g, '1')).toEqual(['The caravan left[^salt] at dawn.', 'Sent from Vienna, unmarked.', '[^salt]: Salt, by the sack.']);
    expect(stored(g, '2')).toEqual(['The pans lay white[^pans] and lost[^nowhere].', '[^pans]: The pans of the coast.']);
    // shown: "[^nowhere]" answers to no note, so it is no note: set as the writer typed it, under no number (it was raised as "[3]")
    const p2 = page(g, chapter(g, '2'));
    expect(p2.marks).toEqual(['[2]']);
    expect(p2.html).toContain('The pans lay white<a class="noteref"');
    expect(p2.html).toContain(' and lost[^nowhere].</p>');
    const lostNote = items(g, 'noteOrphan'), lostMark = items(g, 'refOrphan');
    expect(lostNote.map((it) => [it.data!.n, it.where!.secId, it.before])).toEqual([['telex-a', chapter(g, '1').id, 'Sent from Vienna, unmarked.']]);
    expect(lostMark.map((it) => [it.data!.n, it.before])).toEqual([['nowhere', '[^nowhere]']]);
    expect(lostMark.map((it) => String(g.api.irItemLabel!(it)))).toEqual([t('ir.k.refOrphan', { n: 'nowhere' })]);
    expect(lostNote.map((it) => String(g.api.irItemLabel!(it)))).toEqual([t('ir.k.noteOrphan', { n: 'telex-a' })]);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 3, refs: 3, mapped: 2, orphans: 2 });
    // the tally: three definitions in the file and two in the book, the third kept as text; three marks on each side
    expect(row(g, 'noteDefs')).toEqual({ file: 3, book: 2, why: [['notesOrphan', 1]] });
    expect(row(g, 'noteRefs')).toEqual({ file: 3, book: 3, why: [] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  /* The owner's rule, ruled on 2026-11-22 after the first pass: "Beuk does not invent a number for something that is
     not a note." A mark under a label of the writer's own that no definition anywhere in the book answers was raised
     under the next free number, linked to nothing (main did the same after its import). It is now the writer's text:
     exactly as typed on every surface, taking no number, so the notes after it are numbered as if it were not there.
     The report still names it, by its label, as a mark with no note. A NUMBER with no note is left as main has it (a
     book made before labels were kept must read as before): raised as "[n]", linked to nothing. */
  it('a mark under a label that no note answers is no note: every surface sets it exactly as typed, under no number; a NUMBER with no note is raised as it always was', async () => {
    const g = await importFile('nonote.md', null, md('# Chapter 1: Dawn', 'The caravan left[^salt] at dawn, lost[^nowhere] and[^7].', '[^salt]: Salt, by the sack.',
      '# Chapter 2: Noon', 'The pans lay white[^pans], and[^nowhere] again.', '[^pans]: The pans of the coast.'));
    expect(stored(g, '1')).toEqual(['The caravan left[^salt] at dawn, lost[^nowhere] and[^7].', '[^salt]: Salt, by the sack.']);
    expect(stored(g, '2')).toEqual(['The pans lay white[^pans], and[^nowhere] again.', '[^pans]: The pans of the coast.']);
    // shown: salt 1 and pans 2 ("nowhere" takes none; 7 is the writer's)
    expect(shown(g, '1')).toEqual(['The caravan left[^1] at dawn, lost[^nowhere] and[^7].', '[^1]: Salt, by the sack.']);
    expect(shown(g, '2')).toEqual(['The pans lay white[^2], and[^nowhere] again.', '[^2]: The pans of the coast.']);
    // the typeset page
    const p1 = page(g, chapter(g, '1')), p2 = page(g, chapter(g, '2'));
    expect(p1.marks).toEqual(['[1]', '~[7]']);
    expect(p1.html).toContain(' at dawn, lost[^nowhere] and<sup class="endnote-ref">[7]</sup>.</p>');
    expect(p2.marks).toEqual(['[2]']);
    expect(p2.html).toContain(', and[^nowhere] again.</p>');
    // the Word export and the submission manuscript: plain text, not a raised mark
    for (const xml of [String(g.api.buildDocxDocumentXml!()), String(g.api.msDocumentXml!(g.api.msPlan!()))]) {
      expect((xml.match(/\[\^nowhere\]/g) || []).length).toBe(2);
      expect(xml).not.toMatch(/>\[nowhere\]</);
      expect((xml.match(/>\[7\]<\/w:t>/g) || []).length).toBe(1);
    }
    // the narration script: no "[NOTE nowhere]", and no note said for it
    const lines = g.api.acxSectionLines!(chapter(g, '1')) as { k: string; n?: string; text: string }[];
    expect(lines.filter((l) => l.k === 'para').map((l) => String(g.api.acxPlainInline!(l.text)))).toEqual(['The caravan left [NOTE 1] at dawn, lost[^nowhere] and [NOTE 7].']);
    expect(lines.filter((l) => l.k === 'note').map((l) => [l.n, l.text])).toEqual([['1', 'Salt, by the sack.'], ['7', '']]);
    // a mark is no word under any label, with a note or without: the counts are as they were
    expect(g.api.countWords!('lost[^nowhere] and[^7].')).toBe(2);
    // the report names each, by what the writer typed; the characters are all accounted for
    expect(items(g, 'refOrphan').map((it) => [it.data!.n, it.before])).toEqual([['nowhere', '[^nowhere]'], ['7', '[^7]'], ['nowhere', '[^nowhere]']]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a mark with a colon after it in the middle of a line is the writer\'s mark and colon, stored as typed, and the tally counts both sides alike', async () => {
    const g = await importFile('colon.md', null, md('# Chapter 1: Dawn', 'Text[^a] and see[^a]: more, and[^9]: nine.', '[^a]: A.'));
    // (main stored "Text[^1] and see[^a]: more": the mark renumbered, the one before a colon left as the label)
    expect(stored(g, '1')).toEqual(['Text[^a] and see[^a]: more, and[^9]: nine.', '[^a]: A.']);
    expect(page(g, chapter(g, '1')).marks).toEqual(['[1]', '[1]', '~[9]']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a note marked only in its chapter\'s heading has no section text to join: it is kept at the end of the text as its words, under no number, and the report names it by the writer\'s label', async () => {
    const g = await importFile('heading.md', null, md('# Chapter 1: Dawn[^h]', 'Text[^t].', '[^h]: Head note.', '[^t]: Text note.', '# Chapter 2: Noon', 'Noon.'));
    // (main: the title held "Dawn[^1]", and the note stood at the end as "[1] Head note." under Beuk's number)
    expect(chapter(g, '1').title).toBe('Dawn[^h]');
    expect(stored(g, '1')).toEqual(['Text[^t].', '[^t]: Text note.']);
    expect(stored(g, '2')).toEqual(['Noon.', 'Head note.']);
    expect(JSON.stringify(g.secs).match(/\[\^?\d+\]/g) || [], 'a number of Beuk\'s anywhere in the book').toEqual([]);
    expect(items(g, 'noteOrphan').map((it) => [it.data!.n, it.where!.secId, it.before])).toEqual([['h', chapter(g, '2').id, 'Head note.']]);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 2, mapped: 1, orphans: 1 });
    // OPEN (found, not changed, the same on main): a heading that carries a mark is not matched to its chapter by the tally: its "Chapter" and ":" are 8 characters unaccounted
    expect(figures(g)).toMatchObject({ counted: true, unaccounted: 8 });
  }, 120_000);

  /* The owner's rule, ruled on 2026-11-22 after the first pass: text inside a fenced code block is the writer's literal
     text. A "[^1]" or "[^label]" there is never read as a mark: not at import, not in the tally, not at display.
     (Main LINKED a fenced "[^1]" to whichever note Beuk had numbered 1; the first pass of this branch reported it as
     a mark with no note. Both were wrong.)
     The book's text has one form for text that is the writer's to the character: the log container (a typewriter
     face, every line as typed, no mark of the book's read in it). A fenced block that holds something the book would
     read as a note's mark is stored as one. A fenced block that holds none is stored as it always was: its lines as
     paragraphs, the typewriter face counted as left out. */
  it('a fenced code block that holds a "[^1]" or a "[^label]" is the writer\'s literal text: stored as typed in a log container, read as no mark at import, in the tally or on any surface', async () => {
    const g = await importFile('fence.md', null, md('# Chapter 1: Dawn', 'Text[^x] here.', '```\ncode [^1] and [^x] stay\n```', 'More[^1] text.', '[^x]: X.', '[^1]: One.'));
    // stored: the code line to the character, between the container's marks where the fence's stood
    expect(stored(g, '1')).toEqual(['Text[^x] here.', '::: log\ncode [^1] and [^x] stay\n:::', 'More[^1] text.', '[^x]: X.', '[^1]: One.']);
    // at import: two notes, two marks, nothing lost and nothing named as a mark with no note
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 2, refs: 2, mapped: 2, orphans: 0 });
    expect(items(g, 'refOrphan')).toEqual([]);
    // shown: the writer's 1 is 1 and "x" takes 2; the code line is untouched by the numbering
    expect(shown(g, '1')).toEqual(['Text[^2] here.', '::: log\ncode [^1] and [^x] stay\n:::', 'More[^1] text.', '[^2]: X.', '[^1]: One.']);
    // the typeset page: the two marks of the text, and the code line as typed (main raised its "[^1]" and linked it to a note)
    const p = page(g, chapter(g, '1'));
    expect(p.marks).toEqual(['[2]', '[1]']);
    expect(p.html).toContain('<div class="log"><p class="lg" dir="ltr">code [^1] and [^x] stay</p></div>');
    // the Word export and the narration script
    const docx = String(g.api.buildDocxDocumentXml!());
    expect(docx).toContain('code [^1] and [^x] stay');
    expect((docx.match(/>\[1\]<\/w:t>/g) || []).length).toBe(1);
    expect((docx.match(/>\[2\]<\/w:t>/g) || []).length).toBe(1);
    const lines = g.api.acxSectionLines!(chapter(g, '1')) as { k: string; n?: string; text: string; typed?: boolean }[];
    expect(lines.filter((l) => l.k === 'para').map((l) => String(g.api.acxPlainInline!(l.text, l.typed)))).toEqual(['Text [NOTE 2] here.', 'code [^1] and [^x] stay', 'More [NOTE 1] text.']);
    expect(lines.filter((l) => l.k === 'note').map((l) => l.n)).toEqual(['2', '1']);
    // the Markdown export writes the container as the book stores it
    expect(String(g.api.buildMarkdown!())).toContain('::: log\ncode [^1] and [^x] stay\n:::');
    // the tally: the code line's characters are counted on both sides ("1" and "x" among them), and it is no mark on either
    expect(row(g, 'noteRefs')).toEqual({ file: 2, book: 2, why: [] });
    expect(row(g, 'noteDefs')).toEqual({ file: 2, book: 2, why: [] });
    // paragraphs: the code line is one on each side (the file's other two are its two definitions' lines, which the book holds as notes: the row's own reason)
    expect(row(g, 'paragraphs')).toMatchObject({ file: 5, book: 3 });
    expect(row(g, 'paragraphs').why.map((y) => y[0])).not.toContain('none');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a fenced block keeps its lines, its indents and its empty line; a bare "[0]" in one is code, not a note\'s number; a file whose notes are all numbers is held the same way', async () => {
    const g = await importFile('code.md', null, md('# Chapter 1: Dawn', 'Text[^1] here.', '```js\nif (a[0]) {\n    b = "[^1]";\n\n}\n```', '[^1]: One.'));
    expect(chapter(g, '1').content).toBe('Text[^1] here.\n\n::: log\nif (a[0]) {\n    b = "[^1]";\n\n}\n:::\n\n[^1]: One.');
    const p = page(g, chapter(g, '1'));
    expect(p.marks).toEqual(['[1]']);
    expect(p.html).not.toMatch(/<sup class="endnote-ref">\[0\]/);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 1, refs: 1, mapped: 1, orphans: 0 });
    expect(items(g, 'refOrphan')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a fenced block that holds no mark is stored as it always was: its lines as text, no container, the typewriter face counted as left out', async () => {
    const g = await importFile('plain-code.md', null, md('# Chapter 1: Dawn', 'Text[^x] here.', '```\nplain code line\n```', '[^x]: X.'));
    expect(stored(g, '1')).toEqual(['Text[^x] here.', 'plain code line', '[^x]: X.']);
    expect(items(g, 'mono').map((it) => it.data!.n)).toEqual([1]);
    expect(figures(g)).toEqual(CLEAR);
    // and the block that is held as a log is not counted as a typewriter face left out: the log sets it in one
    const held = await importFile('held-code.md', null, md('# Chapter 1: Dawn', 'Text[^x] here.', '```\ncode [^x] line\n```', '[^x]: X.'));
    expect(items(held, 'mono')).toEqual([]);
  }, 240_000);

  it('a log the writer typed as one in a Markdown file: nothing in it is a mark or a definition at import or on the page', async () => {
    const g = await importFile('typed-log.md', null, md('# Chapter 1: Dawn', 'Text[^x].', '::: log\n09:14 [^x] raw [^1] and [^nope]\n[^y]: no definition here\n:::', '[^x]: X.'));
    expect(stored(g, '1')).toEqual(['Text[^x].', '::: log\n09:14 [^x] raw [^1] and [^nope]\n[^y]: no definition here\n:::', '[^x]: X.']);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 1, refs: 1, mapped: 1, orphans: 0 });
    expect(items(g, 'refOrphan')).toEqual([]);
    expect(items(g, 'noteOrphan')).toEqual([]);
    const p = page(g, chapter(g, '1'));
    expect(p.marks).toEqual(['[1]']);
    expect(p.html).toContain('09:14 [^x] raw [^1] and [^nope]');
  }, 120_000);

  /* An inline code span (`…` between backticks). The book's stored text has NO notion of one: the import takes the
     backticks off, keeps the words and counts the typewriter face as left out (irMdMarkup), so nothing in the book
     says where the span was. A mark inside one is therefore still read as a mark, at import and on the page. Measured
     and pinned as it is (OPEN): it is not what the rule asks of a fenced block, and it cannot be had without the
     book's text gaining a mark for a code span. */
  it('OPEN — an inline code span: the stored text has no notion of one, so a mark inside it is still read as a mark', async () => {
    const g = await importFile('span.md', null, md('# Chapter 1: Dawn', 'Write `[^x]` to mark a note, as here[^x], and `a[1]` for the first.', '[^x]: X.'));
    expect(stored(g, '1')).toEqual(['Write [^x] to mark a note, as here[^x], and a[1] for the first.', '[^x]: X.']);
    expect(page(g, chapter(g, '1')).marks).toEqual(['[2]', '[2]', '~[1]']);
    expect(items(g, 'mono').map((it) => it.data!.n)).toEqual([2]);
  }, 120_000);

  it('a note marked only from inside another note\'s text is kept where it stood as its words (as before); its mark there, which now answers to no note, stays as typed', async () => {
    const inNote = await importFile('innote.md', null, md('# Chapter 1: Dawn', 'Text[^a].', '[^a]: See also[^b] and[^1].', '[^b]: Marked only from a note.'));
    // "b" is marked only from inside another note: the import takes it for a note nothing marks and keeps it where it stood, as its words
    expect(stored(inNote, '1')).toEqual(['Text[^a].', 'Marked only from a note.', '[^a]: See also[^b] and[^1].']);
    const p = page(inNote, chapter(inNote, '1'));
    expect(p.marks).toEqual(['[2]', '~[1]']);
    expect(p.html).toContain('See also[^b] and<sup class="endnote-ref">[1]</sup>.</p>');
    expect(items(inNote, 'noteOrphan').map((it) => it.data!.n)).toEqual(['b']);
    expect(figures(inNote)).toEqual(CLEAR);
  }, 120_000);

  it('a note marked only in a table\'s cell, and a mark set the HTML way, keep the label the file typed', async () => {
    const g = await importFile('cell.md', null, md('# Chapter 1: Dawn', 'Before.', '| Tide | Hour |\n| --- | --- |\n| Low[^gauge] | Dawn<a href="#fn-8"><sup>8</sup></a> |', 'After.', '[^gauge]: Read at the north pier.', '[^fn-8]: By the vane.'));
    const c = chapter(g, '1').content;
    expect(c).toContain('| Low[^gauge] | Dawn[^fn-8] |');
    expect(blocksOf(c).slice(-2)).toEqual(['[^gauge]: Read at the north pier.', '[^fn-8]: By the vane.']);
    expect(c.match(/\[\^?\d+\]/g) || []).toEqual([]);
    const table = items(g, 'table')[0]!;
    expect(JSON.stringify(table), 'the report\'s record of the table holds the label too (its undo matches the page by it)').not.toMatch(/\[\^\d+\]/);
    expect(page(g, chapter(g, '1')).notes).toEqual(['[1] Read at the north pier.', '[2] By the vane.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a file whose labels are all numbers is stored as typed and read exactly as stored: the shown text is the stored string itself', async () => {
    const g = await importFile('numbers.md', null, md('# Chapter 1: Dawn', 'One[^2] two[^1].', '[^1]: First.', '[^2]: Second.', '# Chapter 2: Noon', 'Again[^1].', '[^1]: From one again.'));
    expect(stored(g, '1')).toEqual(['One[^2] two[^1].', '[^1]: First.', '[^2]: Second.']);
    expect(stored(g, '2')).toEqual(['Again[^1].', '[^1]: From one again.']);
    for (const n of ['1', '2']) expect(g.api.notesAsShown!(null, chapter(g, n).content)).toBe(chapter(g, n).content);
    expect(page(g, chapter(g, '1')).marks).toEqual(['[2]', '[1]']);
    expect(page(g, chapter(g, '2')).notes).toEqual(['[1] From one again.']);
  }, 120_000);

  it('the writer adding a note in the editor is given a number, one past the highest number the section shows', async () => {
    const b = await bookOf(['The caravan left[^salt] at dawn.\n\n[^salt]: Salt, by the sack.', 'The pans lay white[^pans] and[^7].\n\n[^pans]: The pans of the coast.\n\n[^7]: Seven.', 'One[^2] two[^1].\n\n[^1]: First.\n\n[^2]: Second.']);
    // the writer's own numbers in the book are 1, 2 and 7, so "salt" shows 3 and "pans" shows 4:
    // chapter 1 shows 3; chapter 2 shows 4 and the writer's 7; chapter 3 is all numbers, as before
    expect(b.secs.map((s) => String(b.api.notesAsShown!(null, s.content)).split('\n')[0])).toEqual(['The caravan left[^3] at dawn.', 'The pans lay white[^4] and[^7].', 'One[^2] two[^1].']);
    expect(b.secs.map((s) => b.api.nextFootnoteNumber!(s.content))).toEqual([4, 8, 3]);
    expect(b.api.nextFootnoteNumber!('No notes yet.')).toBe(1);
    // the new note takes "[^4]" in chapter 1: a number is the writer's, so the named note that showed 4 moves on to 5
    const doc = b.api.snapshotBookDoc!() as Rec & { sections: Sec[] };
    doc.sections[0]!.content = 'The caravan left[^salt] at dawn, late[^4].\n\n[^salt]: Salt, by the sack.\n\n[^4]: A new note.';
    b.api.applyBookDoc!(doc);
    const after = (b.api.snapshotBookDoc!() as { sections: Sec[] }).sections;
    expect(after.map((s) => String(b.api.notesAsShown!(null, s.content)).split('\n')[0])).toEqual(['The caravan left[^3] at dawn, late[^4].', 'The pans lay white[^5] and[^7].', 'One[^2] two[^1].']);
  }, 120_000);

  it('joining two chapters: a named label both define is rewritten in neither, and each mark keeps its own note; two chapters numbered from 1 are joined as they always were', async () => {
    const b = await bookOf(['Seed.']);
    const named = b.api.chopMergePlan!({ content: 'One[^a].\n\n[^a]: The harbour\'s note.', scenes: [] }, { content: 'Two[^a] and[^b].\n\n[^a]: The crossing\'s note.\n\n[^b]: Its own.', scenes: [] }) as { content: string; relabelled: number };
    expect(named).toMatchObject({ content: 'One[^a].\n\n[^a]: The harbour\'s note.\n\n***\n\nTwo[^a] and[^b].\n\n[^a]: The crossing\'s note.\n\n[^b]: Its own.', relabelled: 0 });
    expect(String(b.api.notesAsShown!(null, named.content))).toBe('One[^1].\n\n[^1]: The harbour\'s note.\n\n***\n\nTwo[^2] and[^3].\n\n[^2]: The crossing\'s note.\n\n[^3]: Its own.');
    const numbers = b.api.chopMergePlan!({ content: 'One[^1].\n\n[^1]: A.', scenes: [] }, { content: 'Two[^1] and[^x].\n\n[^1]: B.\n\n[^x]: X.', scenes: [] }) as { content: string; relabelled: number };
    expect(numbers).toMatchObject({ content: 'One[^1].\n\n***\n\nTwo[^2] and[^x].\n\n[^1]: A.\n\n[^2]: B.\n\n[^x]: X.', relabelled: 1 });
  }, 120_000);
});

/* ---- Notes from formats with no typed label: what each stores today, MEASURED 2026-11-22 and NOT changed by this
   piece (the label change touches none of these readers). A Word, OpenDocument, RTF, web-page or EPUB note has no
   "[^label]" of the writer's; what the source showed the writer beside it is either a number the source app drew
   itself (Word's automatic footnotes) or a number or mark of the writer's own (a web page's or an EPUB's visible
   number; a custom mark like "*" or "†"). Pinned here so that none of it moves unseen and so the owner can rule on
   each. Where the writer's own number or mark is not what the book shows, the line says so: those are open, not
   passed. ---- */
describe('notes from formats with no typed label: what each stores and shows today (measured, not changed by this piece)', () => {
  const only = (g: Got) => { const s = g.secs.filter((x) => String(x.content || '').trim()); expect(s.length).toBe(1); return s[0]!; };
  const both = (g: Got) => { const s = only(g); const p = page(g, s); return { stored: blocksOf(s.content), marks: p.marks, notes: p.notes }; };
  const WREF = (id: number, custom?: string) => '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference ' + (custom ? 'w:customMarkFollows="1" ' : '') + 'w:id="' + id + '"/>' + (custom ? '<w:t>' + custom + '</w:t>' : '') + '</w:r>';
  const WT = (s: string) => '<w:r><w:t xml:space="preserve">' + s + '</w:t></w:r>';

  it('Word: automatic footnotes are numbered in order (Word draws those numbers itself); a custom mark ("*", "†") stays as text beside the number Beuk adds', async () => {
    const body = wp('Chapter 1: Dawn', true) + '<w:p>' + WT('The caravan left') + WREF(2) + WT(' at dawn, and') + WREF(3, '*') + WT(' on, and') + WREF(4, '†') + WT(' again, and') + WREF(5) + WT('.') + '</w:p>';
    const notes = '<?xml version="1.0" encoding="UTF-8"?><w:footnotes ' + W_NS + '><w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
      + '<w:footnote w:id="2"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' + WT(' Salt, by the sack.') + '</w:p></w:footnote>'
      + '<w:footnote w:id="3"><w:p>' + WT('*') + WT(' The pans of the coast.') + '</w:p></w:footnote>'
      + '<w:footnote w:id="4"><w:p>' + WT('†') + WT(' The dagger note.') + '</w:p></w:footnote>'
      + '<w:footnote w:id="5"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' + WT(' The last, automatic again.') + '</w:p></w:footnote></w:footnotes>';
    const g = await importFile('notes.docx', await docx(body, { 'word/footnotes.xml': notes }), '');
    // OPEN: Word shows the writer "1, *, †, 2". The book shows "[1], [2]*, [3]†, [4]": the writer's marks are kept as text, a number of Beuk's stands beside each, and the last automatic note is 4 where Word drew 2.
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and[^2]* on, and[^3]† again, and[^4].', '[^1]: Salt, by the sack.', '[^2]: * The pans of the coast.', '[^3]: † The dagger note.', '[^4]: The last, automatic again.'],
      marks: ['[1]', '[2]', '[3]', '[4]'], notes: ['[1] Salt, by the sack.', '[2] * The pans of the coast.', '[3] † The dagger note.', '[4] The last, automatic again.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('OpenDocument: every note is numbered in order; the writer\'s own mark (text:label "*") is set aside with the citations and a number shown in its place', async () => {
    const note = (id: string, cite: string, label: string | null, text: string) => '<text:note text:id="' + id + '" text:note-class="footnote"><text:note-citation' + (label ? ' text:label="' + label + '"' : '') + '>' + cite + '</text:note-citation><text:note-body><text:p>' + text + '</text:p></text:note-body></text:note>';
    const body = oh('Chapter 1: Dawn') + '<text:p>The caravan left' + note('ftn1', '1', null, 'Salt, by the sack.') + ' at dawn, and' + note('ftn2', '*', '*', 'The pans of the coast.') + ' on, and' + note('ftn3', '2', null, 'The last, automatic again.') + '.</text:p>';
    const g = await importFile('notes.odt', await odt(body), '');
    // OPEN: the file shows the writer "1, *, 2". The book shows "[1], [2], [3]": the writer's "*" is replaced by 2, and the last note is 3 where the file showed 2.
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and[^2] on, and[^3].', '[^1]: Salt, by the sack.', '[^2]: The pans of the coast.', '[^3]: The last, automatic again.'],
      marks: ['[1]', '[2]', '[3]'], notes: ['[1] Salt, by the sack.', '[2] The pans of the coast.', '[3] The last, automatic again.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('RTF: automatic footnotes are numbered in order; a mark the writer typed ("*") stays as text beside the number Beuk adds', async () => {
    const auto = (text: string) => '{' + rw('super') + rw('chftn') + '}{' + rw('footnote') + rw('pard') + rw('plain') + '{' + rw('super') + rw('chftn') + '} ' + text + '}';
    const own = (mark: string, text: string) => '{' + rw('super') + ' ' + mark + '}{' + rw('footnote') + rw('pard') + rw('plain') + '{' + rw('super') + ' ' + mark + '} ' + text + '}';
    const body = rtfH('Chapter 1: Dawn') + rw('pard') + rw('s0') + ' The caravan left' + auto('Salt, by the sack.') + ' at dawn, and' + own('*', 'The pans of the coast.') + ' on, and' + auto('The last, automatic again.') + '.' + rw('par') + '\n';
    const g = await importFile('notes.rtf', null, rtfDoc(body));
    // OPEN: a word processor shows the writer "1, *, 2". The book shows "[1], *[2], [3]": the "*" kept as text, a number of Beuk's beside it, and the last note 3 where the file's own count gives 2.
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and*[^2] on, and[^3].', '[^1]: Salt, by the sack.', '[^2]: * The pans of the coast.', '[^3]: The last, automatic again.'],
      marks: ['[1]', '[2]', '[3]'], notes: ['[1] Salt, by the sack.', '[2] * The pans of the coast.', '[3] The last, automatic again.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a web page: the page\'s own visible numbers and marks (5, "*", 9) are set aside and the notes numbered 1, 2, 3 in order', async () => {
    const html = webPage('<h1>Chapter 1: Dawn</h1><p>The caravan left<a href="#fn5" id="r5"><sup>5</sup></a> at dawn, and<a href="#fna" id="ra"><sup>*</sup></a> on, and<a href="#fn9" id="r9"><sup>9</sup></a>.</p>'
      + '<div class="footnotes"><p id="fn5" class="footnote"><sup>5</sup> Salt, by the sack. <a href="#r5">↩</a></p><p id="fna" class="footnote"><sup>*</sup> The pans of the coast. <a href="#ra">↩</a></p><p id="fn9" class="footnote"><sup>9</sup> Nine. <a href="#r9">↩</a></p></div>');
    const g = await importFile('notes.html', null, html);
    // OPEN: the page shows the writer "5, *, 9" (the writer's own). The book shows "[1], [2], [3]": all three replaced by numbers of Beuk's.
    expect(both(g)).toEqual({
      stored: ['The caravan left[^1] at dawn, and[^2] on, and[^3].', '[^1]: Salt, by the sack.', '[^2]: The pans of the coast.', '[^3]: Nine.'],
      marks: ['[1]', '[2]', '[3]'], notes: ['[1] Salt, by the sack.', '[2] The pans of the coast.', '[3] Nine.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('EPUB: a note keeps the number its page showed (5, 9); a mark that is no number ("*") takes the next free number, its "*" left in the note\'s text', async () => {
    const body = '<h1>Chapter 1: Dawn</h1><p>The caravan left<a epub:type="noteref" href="#fn5" id="r5"><sup>5</sup></a> at dawn, and<a epub:type="noteref" href="#fna" id="ra"><sup>*</sup></a> on, and<a epub:type="noteref" href="#fn9" id="r9"><sup>9</sup></a>.</p>'
      + '<aside epub:type="footnote" id="fn5"><p>5. Salt, by the sack.</p></aside><aside epub:type="footnote" id="fna"><p>* The pans of the coast.</p></aside><aside epub:type="footnote" id="fn9"><p>9. Nine.</p></aside>';
    const g = await importFile('notes.epub', await epub([{ title: 'Chapter 1: Dawn', body }]), '');
    // The writer's 5 and 9 are what the book shows. OPEN: the writer's "*" is shown as "[1]" (the mark itself gone from the text, the "*" that opens the note kept).
    expect(both(g)).toEqual({
      stored: ['The caravan left[^5] at dawn, and[^1] on, and[^9].', '[^5]: Salt, by the sack.', '[^1]: * The pans of the coast.', '[^9]: Nine.'],
      marks: ['[5]', '[1]', '[9]'], notes: ['[5] Salt, by the sack.', '[1] * The pans of the coast.', '[9] Nine.'] });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('plain text: a FOOTNOTES block\'s own numbers are kept ([5], [9]); a bracketed number with no entry stays the text it is', async () => {
    const g = await importFile('notes.txt', null, 'Chapter 1: Dawn\n\nThe caravan left[5] at dawn, and[9] on, and a stray[3].\n\nNOTES\n\n[5] Salt, by the sack.\n[9] The pans of the coast.\n');
    expect(both(g)).toEqual({
      stored: ['The caravan left[^5] at dawn, and[^9] on, and a stray[3].', '[^5]: Salt, by the sack.', '[^9]: The pans of the coast.'],
      // the stray "[3]" is stored as typed; the typeset page raises a bare "[n]" as a mark with no note, as it always did
      marks: ['[5]', '[9]', '~[3]'], notes: ['[5] Salt, by the sack.', '[9] The pans of the coast.'] });
    // OPEN (found, not changed): the tally counts the stray "3" in the file and not in the book, whose count takes a bare "[3]" for a note's mark: 1 unaccounted
    expect(figures(g)).toEqual({ counted: true, unaccounted: 1, same: false, fileOnly: [['3', 1]], bookOnly: [] });
  }, 120_000);
});
