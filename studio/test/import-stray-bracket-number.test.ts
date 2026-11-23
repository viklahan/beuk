// @vitest-environment node
import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, docx, epub, figures, importFile, setupImport, wp, type Api, type Got, type Sec } from './import-given';

/* A number in brackets that is no note's is the writer's text, and both sides of the tally count it (BEUK:notemarks).

   A plain-text file marks its notes "[5]" and lists them under NOTES; a "[3]" with no entry there is not a note: it
   is stored as typed and stays text.

   Before: the tally's file side counted that "3" as a character of the file, and its book side took every bare "[n]"
   for a note's mark and counted none of it: "1 character of the file unaccounted", for a character that is in the
   book.

   Now: the book's side reads a bare "[n]" that no note of its section answers as the number it is. The number Beuk
   sets before a note it found and could not link ("[5] The note…") is still not counted there: the file's side has
   set it aside with the notes' own numbers. Every text here is made up. */

const DUMP = process.env.BEUK_NOTEMARKS_DUMP || '';
const dump = (name: string, v: unknown) => { if (DUMP) appendFileSync(DUMP, '=== ' + name + '\n' + JSON.stringify(v, null, 1) + '\n'); };
const only = (g: Got) => { const s = g.secs.filter((x) => String(x.content || '').trim()); expect(s.length).toBe(1); return s[0]!; };
function page(api: Api, s: Sec) {
  const html = String(api.contentBlocksToHtml!(s.content, s, false, true));
  return { marks: [...html.matchAll(/(<a class="noteref"[^>]*>)?<sup class="endnote-ref">([^<]*)<\/sup>/g)].map((x) => (x[1] ? '' : '~') + x[2]) };
}
const rows = (g: Got) => (g.tally.rows as { key: string; file: number; book: number; why?: { k: string; n: number }[] }[]).map((r) => ({ key: r.key, file: r.file, book: r.book, why: (r.why || []).map((y) => [y.k, y.n]) }));
const items = (g: Got, kind: string) => g.rep.items.filter((it) => it.kind === kind);
const WT = (s: string) => '<w:r><w:t xml:space="preserve">' + s + '</w:t></w:r>';

beforeAll(async () => {
  await setupImport('import-stray-bracket-number', ['contentBlocksToHtml', 'notesAsShown']);
}, 180_000);

describe('a bracketed number with no note under it is the writer\'s text: stored as typed, and counted on both sides of the tally', () => {

  it('plain text: "[5]" and "[9]" have entries under NOTES and are notes; the stray "[3]" stays text, and its "3" is accounted for (it was 1 unaccounted)', async () => {
    const g = await importFile('notes.txt', null, 'Chapter 1: Dawn\n\nThe caravan left[5] at dawn, and[9] on, and a stray[3].\n\nNOTES\n\n[5] Salt, by the sack.\n[9] The pans of the coast.\n');
    const s = only(g);
    expect(blocksOf(s.content)).toEqual(['The caravan left[^5] at dawn, and[^9] on, and a stray[3].', '[^5]: Salt, by the sack.', '[^9]: The pans of the coast.']);
    // the typeset page raises a bare "[n]" as a mark with no note, as it always did
    expect(page(g.api, s).marks).toEqual(['[5]', '[9]', '~[3]']);
    expect(items(g, 'txtMarks').map((it) => it.data)).toEqual([{ n: 1 }]);
    dump('txt-stray', { rows: rows(g), figures: figures(g) });
    expect(figures(g)).toEqual(CLEAR);
    // the rows read the file with the stray "[3]" as they read the same file with a plain "3" there: the stray number changes no row and no reason
    const plain = await importFile('notes-plain.txt', null, 'Chapter 1: Dawn\n\nThe caravan left[5] at dawn, and[9] on, and a stray 3.\n\nNOTES\n\n[5] Salt, by the sack.\n[9] The pans of the coast.\n');
    expect(figures(plain)).toEqual(CLEAR);
    expect(rows(g)).toEqual(rows(plain));
  }, 120_000);

  it('plain text with no notes at all: every bracketed number is text, at the head of a paragraph too, and all are accounted for', async () => {
    const g = await importFile('none.txt', null, 'Chapter 1: Dawn\n\n[1] is the first lot and [2] the second, see lot[12].\n\nThe rest.\n');
    expect(blocksOf(only(g).content)).toEqual(['[1] is the first lot and [2] the second, see lot[12].', 'The rest.']);
    dump('txt-none', { rows: rows(g), figures: figures(g) });
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('Markdown and Word: a bracketed number typed in the text, with no note of that number, is counted alike', async () => {
    const m = await importFile('stray.md', null, '# Chapter 1: Dawn\n\nA note[^1] and a stray[3] here.\n\n[^1]: One.\n');
    expect(blocksOf(only(m).content)).toEqual(['A note[^1] and a stray[3] here.', '[^1]: One.']);
    dump('md-stray', { rows: rows(m), figures: figures(m) });
    expect(figures(m)).toEqual(CLEAR);
    const w = await importFile('stray.docx', await docx(wp('Chapter 1: Dawn', true) + '<w:p>' + WT('A stray[3] here and lot [12].') + '</w:p>'), '');
    expect(blocksOf(only(w).content)).toEqual(['A stray[3] here and lot [12].']);
    dump('docx-stray', { rows: rows(w), figures: figures(w) });
    expect(figures(w)).toEqual(CLEAR);
  }, 120_000);

  it('the number Beuk sets before a note it found and could not link is still set aside, not counted twice (an EPUB note nothing marks)', async () => {
    const body = '<h1>Chapter 1: Dawn</h1><p>One two three four five six seven<a epub:type="noteref" href="#fn5" id="r5"><sup>5</sup></a> eight, and a stray [3].</p><aside epub:type="footnote" id="fn5">5. Five.</aside><aside epub:type="footnote" id="fn8">8. Nobody points here.</aside>';
    const g = await importFile('orphan.epub', await epub([{ title: 'Chapter 1: Dawn', body }]), '');
    dump('epub-orphan', { stored: blocksOf(only(g).content), rows: rows(g), figures: figures(g) });
    expect(blocksOf(only(g).content)).toEqual(['One two three four five six seven[^5] eight, and a stray [3].', '[8] Nobody points here.', '[^5]: Five.']);
    expect(figures(g)).toEqual(CLEAR);
    for (const r of rows(g)) expect(r.why.filter((y) => y[0] === 'none'), r.key + ': a difference with no reason').toEqual([]);
  }, 120_000);
});
