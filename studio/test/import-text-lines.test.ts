// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, english, figures, importFile, setupImport, written, type Got } from './import-given';

/* BEUK:textlines — a plain-text file marks nothing. A newline inside one of its paragraphs is a line the writer ended
   (verse, an address, a list of short lines, a letter's salutation) or a line the file's width broke (prose wrapped
   at a column), and only the file's own shape says which. The import reads that shape the way the PDF reader reads a
   page (BEUK:pdfparas): a line the width broke runs to it, so the next line's first word would not have fitted
   beside it; a line the writer ended stops with room for that word.

   What the book then stores (BEUK:breaksshown): a line end the writer made is MARKED (a backslash straight before the
   newline), which every surface sets as a line break; a line end the width made stays the bare newline the file
   gave, which every surface sets as a space, as it always did. Where the file does not show which, the newline
   stays bare, and the import report names the section and counts the paragraphs.

   Held here, every text made up for the test:
   - a file whose paragraphs stand on one long line each (no width): an address, a stanza and a list of short lines
     keep their lines;
   - a file wrapped at a column: its prose stays as the file has it (no mark); an address and a stanza in it keep
     their lines; a letter set in from both margins and wrapped inside them keeps the lines the writer ended (its
     salutation, its sign-off) and no other;
   - a file wrapped by hand, its lines ending anywhere near the edge: no width is shown, nothing is marked, and the
     report says so;
   - a backslash the file has at a line's end is kept and shown;
   - the tally counts none of this as a character (it stays clear), and its Paragraphs row gives a reason for every
     paragraph in a book whose two totals differ. */

const BS = String.fromCharCode(92);
const BR = BS + '\n';
const ADDRESS = ['Ada Wren', '12 Salt Road', 'Harbour Town', 'HT1 2AB'];
const STANZA = ['The tide keeps its own count,', 'and the lamps along the wall', 'come on one by one,', 'whoever is watching.'];
const SHORT = ['two lanterns', 'a coil of tarred rope', 'salt for a month', 'the ledger'];
const LAST = 'The second chapter stands here so that the book has two.';

/* made-up prose, every sentence different, so that no two lines of the file are the same */
const A = ['harbour master', 'salt merchant', 'night clerk', 'ferryman', 'lamplighter', 'cooper', 'pilot', 'chandler', 'customs officer', 'boatwright', 'net mender', 'tally keeper'];
const B = ['counted', 'weighed', 'entered', 'measured', 'crossed out', 'copied', 'questioned', 'sealed', 'carried', 'unloaded', 'recorded', 'compared'];
const C = ['barrels', 'ledgers', 'sacks of grey salt', 'tarred crates', 'manifests', 'lanterns', 'bundles of receipts', 'coils of rope', 'pans', 'casks', 'tide tables', 'bills of lading'];
const D = ['before the evening tide came in over the flats', 'while the wind turned round to the north', 'as nobody on the quay had asked him to do', 'long after the last cart had gone up the hill', 'because the figures of the year did not agree',
  'although the rain had not stopped since morning', 'when the lamps along the wall were lit', 'until the bell rang twice from the customs house'];
const sentence = (k: number) => 'The ' + A[k % A.length] + ' ' + B[(k * 5 + 1) % B.length] + ' the ' + C[(k * 7 + 2) % C.length] + ' ' + D[(k * 3) % D.length] + '.';
const para = (from: number, n: number) => Array.from({ length: n }, (_, i) => sentence(from + i)).join(' ');
/** the lines a text of one line is broken into at a column, the next word taken while it fits */
function wrap(text: string, at: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) { if (cur && (cur + ' ' + w).length > at) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if (cur) out.push(cur);
  return out;
}
const chapter1 = (g: Got) => blocksOf((written(g).find((s) => s.type === 'chapter' && s.number === '1') || { content: '' }).content);
/* a block as stored, each line without the space a set-in line keeps at its head */
const flat = (b: string) => b.split('\n').map((l) => l.trim()).join('\n');
const said = (g: Got, kind: string) => g.rep.items.filter((it) => it.kind === kind).map((it) => ({ n: (it.data as { n: number }).n, where: it.where && it.where.label }));
type Row = { key: string; file: number; book: number; why?: { k: string; n: number }[] };

beforeAll(async () => { await setupImport('import-text-lines', ['irItemLabel']); }, 180_000);

describe('a text file whose paragraphs each stand on one long line: the lines of a short block are lines the writer ended', () => {
  let g: Got;
  beforeAll(async () => {
    g = await importFile('long-lines.txt', null, ['The Salt Road', 'by Ada Wren', 'Chapter 1', para(0, 5), ADDRESS.join('\n'), para(5, 6), STANZA.join('\n'), para(11, 4), SHORT.join('\n'), 'Chapter 2', LAST].join('\n\n') + '\n');
  }, 120_000);

  it('an address, a stanza and a list of short lines are stored with each line end marked; a long paragraph is the one line it was', () => {
    const blocks = chapter1(g);
    expect(blocks).toContain(ADDRESS.join(BR));
    expect(blocks).toContain(STANZA.join(BR));
    expect(blocks).toContain(SHORT.join(BR));
    expect(blocks).toContain(para(0, 5));
  });

  it('the tally is clear (the mark is no character of the book), and its Paragraphs row leaves no paragraph unexplained though its totals differ', () => {
    expect(figures(g)).toEqual(CLEAR);
    const row = (g.tally as unknown as { rows: Row[] }).rows.find((r) => r.key === 'paragraphs')!;
    expect(row.file, 'the totals differ (the title page\'s lines are set aside), so the row gives its reasons').not.toBe(row.book);
    expect((row.why || []).filter((y) => y.k === 'none')).toEqual([]);
  });

  it('the report says, for the chapter, how many paragraphs keep the line ends the file typed, and names none as not shown', () => {
    const kept = said(g, 'txtLinesKept');
    expect(kept.map((x) => x.n)).toEqual([3]);
    expect(g.api.irItemLabel(g.rep.items.find((it) => it.kind === 'txtLinesKept'))).toBe(english('ir.k.txtLinesKept', { n: 3 }));
    expect(said(g, 'txtLinesUnsure')).toEqual([]);
  });
});

describe('a text file wrapped at a column: prose stays as the file has it, and only a line that stops short of the width is a line the writer ended', () => {
  const W = 64;
  const P = [para(0, 6), para(6, 7), para(13, 6), para(19, 8), para(27, 6)];
  const LETTER_BODY = para(33, 5);
  /* a letter set in four columns from each margin, its paragraph wrapped inside them */
  const LETTER = ['Salt Quay, the ninth of March', 'My dear Ada,', ...wrap(LETTER_BODY, W - 8), 'Yours ever,', 'Tom'].map((l) => '    ' + l);
  /* a line left longer than the width the rest of the file is wrapped at, and the line after it */
  const PAST = ['Manifest of the brig Good Intent, cleared outward from the salt quay on the ninth of March with:', 'forty casks, and nothing else declared.'];
  let g: Got;
  beforeAll(async () => {
    g = await importFile('wrapped.txt', null, ['Chapter 1', wrap(P[0]!, W).join('\n'), ADDRESS.join('\n'), wrap(P[1]!, W).join('\n'), STANZA.join('\n'), wrap(P[2]!, W).join('\n'), LETTER.join('\n'),
      wrap(P[3]!, W).join('\n'), ['Dear Sir,', ...wrap(P[4]!, W)].join('\n'), PAST.join('\n'), 'Chapter 2', LAST].join('\n\n') + '\n');
  }, 120_000);

  it('a line that runs past the file\'s width was not broken by it: the file does not show who ended it, so it is left as the file has it and the report counts its paragraph', () => {
    expect(PAST[0]!.length).toBeGreaterThan(W + 10);
    expect(chapter1(g)).toContain(PAST.join('\n'));
    expect(said(g, 'txtLinesUnsure').map((x) => x.n)).toEqual([1]);
  });

  it('each wrapped paragraph is stored line for line as the file has it, with no mark', () => {
    const blocks = chapter1(g);
    for (const p of P.slice(0, 4)) {
      const lines = wrap(p, W);
      expect(lines.length, 'the made-up paragraph is wrapped over several lines').toBeGreaterThan(4);
      expect(blocks).toContain(lines.join('\n'));
    }
  });

  it('the address and the stanza keep their lines', () => {
    const blocks = chapter1(g);
    expect(blocks).toContain(ADDRESS.join(BR));
    expect(blocks).toContain(STANZA.join(BR));
  });

  it('a salutation typed on a line of its own above its wrapped paragraph ends on a mark; the paragraph\'s own wrapped lines do not', () => {
    const b = chapter1(g).find((x) => x.indexOf('Dear Sir,') === 0)!;
    const lines = b.split('\n');
    expect(lines[0]).toBe('Dear Sir,' + BS);
    /* every line the width broke (all but the paragraph's last) is as the file has it */
    expect(lines.slice(1, -1).filter((l) => l.endsWith(BS))).toEqual([]);
    expect(lines.slice(1).map((l) => l.replace(/\\$/, ''))).toEqual(wrap(P[4]!, W));
  });

  it('a letter set in from both margins: the lines the writer ended are marked (its date, its salutation, its sign-off); the lines wrapped inside the narrower measure are not', () => {
    const b = flat(chapter1(g).find((x) => x.indexOf('Salt Quay') === 0)!);
    const lines = b.split('\n'), body = wrap(LETTER_BODY, W - 8);
    expect(lines.map((l) => l.replace(/\\$/, ''))).toEqual(['Salt Quay, the ninth of March', 'My dear Ada,', ...body, 'Yours ever,', 'Tom']);
    expect(lines[0]!.endsWith(BS)).toBe(true);
    expect(lines[1]!.endsWith(BS)).toBe(true);
    expect(lines[lines.length - 2]).toBe('Yours ever,' + BS);
    /* the body's lines the measure broke: none marked, though each stops short of the FILE's width */
    expect(lines.slice(2, 2 + body.length - 1).filter((l) => l.endsWith(BS))).toEqual([]);
    expect(body.length, 'the made-up letter is wrapped over several lines').toBeGreaterThan(4);
    expect(body.every((l) => l.length + 4 <= W - 4), 'the made-up letter\'s lines all stop four columns or more short of the file\'s width').toBe(true);
  });

  it('the tally is clear and the report counts the four paragraphs that keep line ends', () => {
    expect(figures(g)).toEqual(CLEAR);
    expect(said(g, 'txtLinesKept').map((x) => x.n)).toEqual([4]);
  });
});

describe('a text file wrapped by hand, its lines ending anywhere near the edge: the file does not show which line ends are the writer\'s', () => {
  /* each line broken at a width of its own: no one width broke most of them, and none stops far short */
  const ragged = (text: string, from: number) => {
    const widths = [58, 71, 63, 76, 60, 68, 74, 56, 66, 79, 62, 70];
    const out: string[] = [];
    let cur = '', k = from;
    for (const w of text.split(' ')) { if (cur && (cur + ' ' + w).length > widths[k % widths.length]!) { out.push(cur); cur = w; k++; } else cur = cur ? cur + ' ' + w : w; }
    if (cur) out.push(cur);
    return out;
  };
  const P = [para(0, 7), para(7, 8), para(15, 7), para(22, 8)];
  let g: Got;
  beforeAll(async () => {
    g = await importFile('ragged.txt', null, ['Chapter 1', ...P.map((p, i) => ragged(p, i * 5).join('\n')), 'Chapter 2', LAST].join('\n\n') + '\n');
  }, 120_000);

  it('every paragraph is left exactly as the file has it: its lines, and no mark', () => {
    const blocks = chapter1(g);
    P.forEach((p, i) => expect(blocks).toContain(ragged(p, i * 5).join('\n')));
    expect(blocks.join('\n').indexOf(BS)).toBe(-1);
    expect(figures(g)).toEqual(CLEAR);
  });

  it('the report names the chapter and counts its paragraphs whose line ends the file does not show', () => {
    expect(said(g, 'txtLinesUnsure').map((x) => x.n)).toEqual([4]);
    expect(g.api.irItemLabel(g.rep.items.find((it) => it.kind === 'txtLinesUnsure'))).toBe(english('ir.k.txtLinesUnsure', { n: 4 }));
    expect(said(g, 'txtLinesKept')).toEqual([]);
  });
});

describe('a backslash the file itself has at a line\'s end is the writer\'s character', () => {
  it('it is kept, with the mark after it, so the page shows the backslash and ends the line where the file did; the tally is clear', async () => {
    const g = await importFile('slash.txt', null, ['Chapter 1', para(0, 5), 'He typed the first half ' + BS + '\nand then the rest of it.', 'Chapter 2', LAST].join('\n\n') + '\n');
    expect(chapter1(g)).toContain('He typed the first half ' + BS + BR + 'and then the rest of it.');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
