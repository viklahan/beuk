// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, english, figures, importFile, setupImport, type Got } from './import-given';

/* "Log and show everything" (the owner, 2026-11-22). Found on a real manuscript, by counts only: the import card said
   every character was accounted for while a row of the tally under it ended "N in the file not explained", and a
   file with no headings showed "Headings: 0 in the file, 1 in the book, 1 in the book not explained".

   Held here (BEUK:tallysaid):
   - the chapter Beuk names after a file that has no heading is one more heading in the book than in the file, and
     the Headings row says exactly that, where it said "not explained";
   - a web page's page break, written as a rule the page hides (a word processor's web export writes it so), is
     counted as a page break, which the book sets its own of: the reader never took it for a scene break, and the
     tally did;
   - a line that is only "#" marks. In a Markdown file it is a heading's mark with no words (an export writes an empty
     styled paragraph so): the reader left it out and said nothing, while the tally counted it as an ornament on the
     file's side, so the row ended "not explained". It is still left out, the report names it, and the tally reads it
     as the reader does. In a plain-text file a lone "#" is the scene break of standard manuscript format, the
     writer's own: it is kept as the book's break and listed with the others;
   - a Part's own heading is counted among the book's headings, as it is among the file's;
   - when any row of the tally still ends "not explained", the card says so, with how many rows, beside its line
     about the characters: a count that differs with no reason found is never left for the writer to come upon.
     (The second case sets such a row into a report by hand: it holds what the card does with one, whatever made it.) */

const P = (k: number) => 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year, part ' + k + '.';
type Row = { key: string; file: number; book: number; why: { k: string; n: number; side: number; row?: string }[] };
const rows = (g: Got) => g.tally.rows as unknown as Row[];

beforeAll(async () => { await setupImport('import-tally-said', ['irCardHtml', 'irTallyWhyLine']); }, 180_000);

describe('the tally says what it knows, and the card says what the tally could not explain', () => {
  it('a file with no headings: the Headings row is 0 in the file and 1 in the book, and its reason is the chapter Beuk named after the file', async () => {
    const g = await importFile('no-headings.md', null, [P(1), P(2), P(3)].join('\n\n') + '\n');
    const row = rows(g).find((r) => r.key === 'headings')!;
    expect([row.file, row.book, row.why]).toEqual([0, 1, [{ k: 'fileNamed', n: 1, side: -1 }]]);
    expect(g.api.irTallyWhyLine(row.why[0])).toBe('1 that Beuk named after the file, which has no heading for it');
    expect(figures(g)).toEqual(CLEAR);
    /* nothing is unexplained, so the card adds no line */
    expect(g.api.irCardHtml(g.rep) as string).not.toContain('found no reason');
  }, 120_000);

  it('a web page\'s page break, written as a rule the page hides, is counted as a page break (it was counted as a scene break the book did not have, "not explained")', async () => {
    const pb = '<hr style="page-break-before:always;display:none;">';
    const g = await importFile('pages.html', null, '<!doctype html><html><head><meta charset="utf-8"><title>Pages</title></head><body><h1>Chapter 1</h1><p>' + P(1) + '</p><hr><p>' + P(2) + '</p>' + pb + '<h1>Chapter 2</h1><p>' + P(3) + '</p>' + pb + '<h1>Chapter 3</h1><p>' + P(4) + '</p></body></html>');
    const pick = (key: string) => rows(g).filter((r) => r.key === key).map((r) => [r.file, r.book, r.why]);
    /* the rule the writer drew is the one scene break, in the file and in the book */
    expect(pick('breaks')).toEqual([[1, 1, []]]);
    /* the two hidden rules are two page breaks, which the book sets its own of */
    expect(pick('pageBreaks')).toEqual([[2, 0, [{ k: 'pageBreaks', n: 2, side: 1 }]]]);
    expect(rows(g).some((r) => (r.why || []).some((y) => y.k === 'none')), 'no row ends "not explained"').toBe(false);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('Markdown: a line that is only a heading\'s mark ("#", "##") is left out, as it was, and the report now names it; the tally no longer counts it as an ornament the book lacks', async () => {
    /* measured before the change: "Scene breaks and ornaments: 1 in the file, 0 in the book, 1 in the file not explained", and no line of the report */
    const g = await importFile('bare.md', null, ['# Chapter 1', P(1), '#', P(2), '##', '# Chapter 2', P(3)].join('\n\n') + '\n');
    expect(g.secs.map((x) => x.content).join('\n')).not.toMatch(/^(#+|\*\*\*)$/m);
    expect(g.rep.items.filter((i) => i.kind === 'bareHeading').map((i) => i.data)).toEqual([{ n: 2 }]);
    expect(english('ir.k.bareHeadingPlural', { n: 2 })).toBe('2 lines that are only a heading’s mark (“#”), with no words, were left out');
    expect(rows(g).filter((r) => r.key === 'breaks')).toEqual([]);
    expect(rows(g).some((r) => (r.why || []).some((y) => y.k === 'none')), 'no row ends "not explained"').toBe(false);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('plain text: a lone "#" is the scene break of standard manuscript format, the writer\'s: it is kept as the book\'s break and listed (it was left out, "1 in the file not explained")', async () => {
    const g = await importFile('bare.txt', null, ['Chapter 1', P(1), '#', P(2), 'Chapter 2', P(3)].join('\n\n') + '\n');
    const one = g.secs.find((x) => x.type === 'chapter' && x.number === '1')!.content;
    expect(one.split(/\n\s*\n/)).toEqual([P(1), '***', P(2)]);
    expect(g.rep.items.filter((i) => i.kind === 'break').map((i) => i.before)).toEqual(['#']);
    expect(rows(g).filter((r) => r.key === 'breaks').map((r) => [r.file, r.book, r.why])).toEqual([[1, 1, []]]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a Part\'s heading is a heading of the book: a file with a Part has as many headings in the book as in the file (the Part was counted on the file\'s side only: "1 in the file not explained")', async () => {
    const g = await importFile('parts.md', null, ['# Part One: Ebb', '# Chapter 1: Dawn', P(1), '# Chapter 2: Dusk', P(2)].join('\n\n') + '\n');
    expect(rows(g).filter((r) => r.key === 'headings').map((r) => [r.file, r.book, r.why])).toEqual([[3, 3, []]]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a row that ends "not explained" is said on the card, with how many rows there are', async () => {
    const g = await importFile('rows.md', null, ['# Chapter 1', P(1), '# Chapter 2', P(2)].join('\n\n') + '\n');
    expect(g.api.irCardHtml(g.rep) as string).not.toContain('found no reason');
    /* a row the tally could not explain, set in by hand: 25 scene breaks in the file, 1 in the book, 1 set aside, 23 unexplained */
    rows(g).push({ key: 'breaks', file: 25, book: 1, why: [{ k: 'aside', row: 'titlePage', n: 1, side: 1 }, { k: 'none', n: 23, side: 1 }] });
    expect(g.api.irCardHtml(g.rep) as string).toContain(english('ir.tally.cardRows', { n: 1 }));
    expect(english('ir.tally.cardRows', { n: 1 })).toBe('1 count in the tally differs between your file and your book, and Beuk found no reason for it.');
    rows(g).push({ key: 'listItems', file: 9, book: 4, why: [{ k: 'none', n: 5, side: 1 }] });
    expect(g.api.irCardHtml(g.rep) as string).toContain('2 counts in the tally differ between your file and your book, and Beuk found no reason for them.');
  }, 120_000);
});
