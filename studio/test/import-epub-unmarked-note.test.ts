// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, blocksOf, epub, figures, importFile, setupImport, written, type Got } from './import-given';

/* The owner's rule (2026-11-22): "We do not change anything from what the writer gives us."

   An EPUB's note that nothing in the book marks (no reference points to its block) stays where its block stood, as a
   plain paragraph. One that has no number either was written "[?] …": a "?" that is in no file, and one character
   more in the book than in the file by the tally's count (seen in the code by the first sweep, measured here: the
   case below failed on the page before the change, with "?" the one character the book held and the file did not).
   It is now a paragraph of its own text, under no mark of Beuk's, as a web page's unmarked note is
   (BEUK:notesstood, 73562f5; import-notes-where-they-stood.test.ts). The report still names it "?": the file gives
   it no name. A note a reference reaches is the note it was. Every text here is made up. */

const PAGES = (notes: string) => [
  { title: 'One', body: '<h1>Chapter 1</h1><p>The pans lay white.<a epub:type="noteref" href="#fn1">1</a></p><p>Nobody spoke.</p><aside epub:type="footnote" id="fn1"><p>A marked note.</p></aside>' + notes },
  { title: 'Two', body: '<h1>Chapter 2</h1><p>The second chapter stands here.</p>' },
];
const one = (g: Got) => blocksOf((written(g).find((s) => s.type === 'chapter' && s.number === '1') || { content: '' }).content);
const orphans = (g: Got) => g.rep.items.filter((i) => i.kind === 'noteOrphan').map((i) => ({ n: (i.data || {}).n, text: i.before }));

beforeAll(async () => { await setupImport('import-epub-unmarked-note'); }, 180_000);

describe('an EPUB\'s note that nothing marks and that has no number stands as its own text, under no "?" of Beuk\'s', () => {
  it('the note stays where its block stood, as a paragraph of its words; the marked note is the note it was; nothing differs', async () => {
    const g = await importFile('unmarked.epub', await epub(PAGES('<aside epub:type="footnote" id="fnx"><p>A note nothing marks.</p></aside>')), '');
    expect(one(g)).toEqual(['The pans lay white.[^1]', 'Nobody spoke.', 'A note nothing marks.', '[^1]: A marked note.']);
    expect(one(g).join('\n')).not.toContain('?');
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('the report names it, with its words', async () => {
    const g = await importFile('unmarked.epub', await epub(PAGES('<aside epub:type="footnote" id="fnx"><p>A note nothing marks.</p></aside>')), '');
    expect(orphans(g)).toEqual([{ n: '?', text: 'A note nothing marks.' }]);
  }, 120_000);

  it('an EPUB whose notes are all marked comes in as it did', async () => {
    const g = await importFile('marked.epub', await epub(PAGES('')), '');
    expect(one(g)).toEqual(['The pans lay white.[^1]', 'Nobody spoke.', '[^1]: A marked note.']);
    expect(orphans(g)).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
