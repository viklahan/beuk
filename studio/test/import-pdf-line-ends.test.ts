// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, english, figures, importFile, pdf, setupImport, written, type Got, type PdfLine } from './import-given';

/* The owner's rule (2026-11-22): "We do not assume, infer, or conclude — we validate and report." Two more places
   where a PDF's line end was closed up by a guess (BEUK:lineendsgiven), settled as the hyphen rule settles a hyphen
   (BEUK:hyphensgiven, import-pdf-hyphens.test.ts): by what the PDF's own text shows elsewhere, and where it shows
   nothing the page's own reading stays and the place is listed for the writer.

   - "pre-" at a line's end before "and post-war": the hyphen is left open on purpose and a space follows it. The
     hyphen rule knew two readings, "pre-and" and "preand", and kept the first: the writer's space was lost. Where
     the PDF sets that piece open elsewhere, in mid-line ("pre- and post-war"), and neither whole word stands
     anywhere, the space is the writer's and is kept. Where nothing shows it, the lines stay closed up and the word
     is listed, as it was.
   - "1914–" at a line's end before "1918": after a letter a dash was always closed up; after a digit the two lines
     were closed with a space of Beuk's own ("1914– 1918"). Now a dash straight after a letter or a digit, the next
     line opening on one, is closed where the pair stands closed elsewhere ("1914–1918") or the text sets that dash
     closed wherever else it stands in mid-line; set with a space where the piece stands open elsewhere ("1914– ")
     or the text sets that dash open everywhere else; and where the text shows nothing, or both, the lines are
     closed up with no space of Beuk's and the place is listed.
   A space is not a character of the import tally, which is why this is held here directly. Every text is made up. */

const FILL = 'and the tide kept its own count of the days while the salt answered to no clerk on the quay';
const pg = (n: string, lines: string[]): PdfLine[] => [{ text: 'Chapter ' + n, size: 20, gap: 40 }, ...lines.map((text) => ({ text, size: 11, gap: 15 })), ...Array.from({ length: 10 }, (x, k) => ({ text: FILL + (k % 3 === 2 ? '.' : ','), size: 11, gap: 15 }))];
const first = (g: Got, n: number) => blocksOf(written(g).filter((s) => s.type === 'chapter')[n].content)[0];
const item = (g: Got, kind: string) => g.rep.items.filter((i) => i.kind === kind).map((i) => ({ n: (i.data || {}).n, words: (i.data || {}).words, before: i.before }));
const asked = (g: Got) => g.rep.items.filter((i) => i.kind === 'pdfHyphenAsk').map((i) => [(i.data || {}).kept, (i.data || {}).offered, (i.data || {}).why]);

beforeAll(async () => { await setupImport('import-pdf-line-ends'); }, 180_000);

describe('a hyphen left open at a line\'s end ("pre-" before "and post-war")', () => {
  it('where the PDF sets "pre-" open elsewhere, the space after it is kept, and the report says so', async () => {
    const g = await importFile('open.pdf', await pdf([
      ...pg('One', ['The clerk kept the estimates for the pre-', 'and post-war years apart in the ledger that year.']),
      { page: true }, ...pg('Two', ['He wrote of pre- and post-war prices in the same hand.']),
    ]), '');
    expect(first(g, 0)).toContain('for the pre- and post-war years apart');
    expect(item(g, 'pdfHyphenOpen')).toEqual([{ n: 1, words: ['pre- and'], before: '“pre- and”' }]);
    expect(asked(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('where the PDF shows nothing, the lines stay closed up as the page has them and the word is listed for the writer, as before', async () => {
    const g = await importFile('open-unknown.pdf', await pdf([
      ...pg('One', ['The clerk kept the estimates for the pre-', 'and post-war years apart in the ledger that year.']),
      { page: true }, ...pg('Two', ['The second chapter stands here with its own plain lines.']),
    ]), '');
    expect(first(g, 0)).toContain('for the pre-and post-war years apart');
    expect(item(g, 'pdfHyphenOpen')).toEqual([]);
    expect(asked(g)).toEqual([['pre-and', 'preand', 'neither']]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});

describe('a dash at a line\'s end straight after a letter or a digit ("1914–" before "1918")', () => {
  it('closed up where the pair stands closed elsewhere: no space of Beuk\'s (it was "1914– 1918")', async () => {
    const g = await importFile('dash-closed.pdf', await pdf([
      ...pg('One', ['The clerk said that the war of 1914–', '1918 left the pans untended for a season.']),
      { page: true }, ...pg('Two', ['He wrote of 1914–1918 again in the same hand.']),
    ]), '');
    expect(first(g, 0)).toContain('the war of 1914–1918 left the pans');
    expect(item(g, 'pdfDashKept')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('closed up where the text sets that dash closed wherever else it stands', async () => {
    const g = await importFile('dash-closed-general.pdf', await pdf([
      ...pg('One', ['The clerk said that the war of 1914–', '1918 left the pans untended for a season.']),
      { page: true }, ...pg('Two', ['He wrote of 1920–1925 and of 1930–1935 in the same hand.']),
    ]), '');
    expect(first(g, 0)).toContain('the war of 1914–1918 left the pans');
    expect(item(g, 'pdfDashKept')).toEqual([]);
  }, 120_000);

  it('set with a space where the text sets that dash open wherever else it stands', async () => {
    const g = await importFile('dash-open.pdf', await pdf([
      ...pg('One', ['The clerk said that the war of 1914–', '1918 left the pans untended for a season.']),
      { page: true }, ...pg('Two', ['He wrote of 1920– 1925 and of 1930– 1935 in the same hand.']),
    ]), '');
    expect(first(g, 0)).toContain('the war of 1914– 1918 left the pans');
    expect(item(g, 'pdfDashKept')).toEqual([]);
  }, 120_000);

  it('where the text shows nothing: closed up as the page has it, no space added, and listed for the writer (a number and a word alike)', async () => {
    const g = await importFile('dash-unknown.pdf', await pdf([
      ...pg('One', ['The clerk said that the war of 1914–', '1918 left the pans untended for a season, he said—', 'nobody answered him.']),
      { page: true }, ...pg('Two', ['The second chapter stands here with its own plain lines.']),
    ]), '');
    expect(first(g, 0)).toContain('the war of 1914–1918 left the pans untended for a season, he said—nobody answered him.');
    expect(item(g, 'pdfDashKept')).toEqual([{ n: 2, words: ['1914–1918', 'said—nobody'], before: '“1914–1918” · “said—nobody”' }]);
    expect(english('ir.k.pdfDashKeptPlural', { n: 2 })).toBe('2 lines of the PDF end on a dash straight after a word or a number, and nothing in the PDF’s text shows whether a space follows that dash. Your book keeps each closed up, as the page shows it: no space is added.');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
