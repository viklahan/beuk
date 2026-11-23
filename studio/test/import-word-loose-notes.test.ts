// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, W_NS, blocksOf, docx, english, figures, importFile, setupImport, written, wp, type Got } from './import-given';

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." "Log and show everything."

   A Word file keeps its footnotes and endnotes in parts of their own (word/footnotes.xml, word/endnotes.xml). The
   conversion the import reads Word through (Mammoth) hands on only the notes a reference in the text reaches. A note
   no reference points to (its reference deleted, the note left behind) never arrived: its words were in the file
   and nowhere in the book, the tally showed them unaccounted for, and no line of the report named them.

   Now (BEUK:notesstood, a Word file): such a note is read from the package's own notes part and kept. A Word note
   stands at no place in the text, and nothing says which chapter it is of, so it is kept as a plain paragraph at
   the end of the book's text, under no number of Beuk's, with its italic and bold; the report names it with its
   words whole and says where it was put and why, as the Markdown and web-page readers do for a note nothing marks
   (import-notes-where-they-stood.test.ts). Every text here is made up. */

const fnParts = (kind: 'footnote' | 'endnote', notes: string) => '<?xml version="1.0" encoding="UTF-8"?><w:' + kind + 's ' + W_NS + '><w:' + kind + ' w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:' + kind + '>'
  + '<w:' + kind + ' w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:' + kind + '>' + notes + '</w:' + kind + 's>';
const t = (s: string) => '<w:r><w:t xml:space="preserve">' + s + '</w:t></w:r>';
const BODY = wp('Chapter 1', true) + '<w:p>' + t('The pans lay white under the low sun.') + '<w:r><w:footnoteReference w:id="2"/></w:r></w:p>' + wp('Nobody on the quay spoke of the ledger.') + wp('Chapter 2', true) + wp('The second chapter stands here.');
const FOOTNOTES = fnParts('footnote',
  '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>' + t(' A marked note.') + '</w:p></w:footnote>'
  + '<w:footnote w:id="3"><w:p><w:r><w:footnoteRef/></w:r>' + t(' A note ') + '<w:r><w:rPr><w:i/></w:rPr><w:t>nothing</w:t></w:r>' + t(' points to.') + '</w:p></w:footnote>');
const ENDNOTES = fnParts('endnote', '<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r>' + t(' An endnote left over.') + '</w:p></w:endnote>');
const loose = (g: Got) => g.rep.items.filter((i) => i.kind === 'noteOrphan').map((i) => ({ text: i.before, data: i.data, where: i.where && i.where.label }));

beforeAll(async () => { await setupImport('import-word-loose-notes'); }, 180_000);

describe('a Word footnote or endnote that no reference points to is kept, and named in the report with its words', () => {
  it('each is a plain paragraph at the end of the book\'s text, with its italic, under no number; the marked note is the note it was; nothing is unaccounted for', async () => {
    const g = await importFile('loose-notes.docx', await docx(BODY, { 'word/footnotes.xml': FOOTNOTES, 'word/endnotes.xml': ENDNOTES }), '');
    const ch = written(g).filter((s) => s.type === 'chapter');
    expect(blocksOf(ch[0].content)).toEqual(['The pans lay white under the low sun.[^1]', 'Nobody on the quay spoke of the ledger.', '[^1]: A marked note.']);
    expect(blocksOf(ch[1].content)).toEqual(['The second chapter stands here.', 'A note *nothing* points to.', 'An endnote left over.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('the report lists each with its words whole, says it is a note no reference points to, and where it was put', async () => {
    const g = await importFile('loose-notes.docx', await docx(BODY, { 'word/footnotes.xml': FOOTNOTES, 'word/endnotes.xml': ENDNOTES }), '');
    const where = (written(g).filter((s) => s.type === 'chapter')[1] as { title: string }).title;
    expect(loose(g)).toEqual([
      { text: 'A note *nothing* points to.', data: { n: '?', loose: 'footnote' }, where: expect.stringContaining(where) },
      { text: 'An endnote left over.', data: { n: '?', loose: 'endnote' }, where: expect.stringContaining(where) },
    ]);
    /* what the line says (English is final; the other twelve packs are unsigned drafts) */
    expect(english('ir.k.noteLoose')).toBe('A note in the Word file that no reference in the text points to. A Word note has no place of its own in the text, so it is kept as a plain paragraph at the end of the book’s text');
    /* the tally's row for notes: three in the file, one in the book, and the two set apart are its reason */
    const row = g.tally.rows.find((r) => r.key === 'noteDefs') as unknown as { file: number; book: number; why: { k: string; n: number }[] };
    expect([row.file, row.book, row.why.map((w) => [w.k, w.n])]).toEqual([3, 1, [['notesOrphan', 2]]]);
    /* and the two are paragraphs of the book that are no paragraphs of the file: the Paragraphs row says that too */
    const para = g.tally.rows.find((r) => r.key === 'paragraphs') as unknown as { file: number; book: number; why: { k: string; n: number }[] };
    expect([para.file, para.book, para.why.map((w) => [w.k, w.n])]).toEqual([3, 5, [['notesOrphan', 2]]]);
  }, 120_000);

  it('a long note is listed whole, not cut short', async () => {
    const long = 'A long note left behind when its reference was deleted, which runs on well past a hundred and forty characters so that a clipped line of the report would lose its end, and this is that end.';
    const g = await importFile('loose-long.docx', await docx(BODY.replace('<w:r><w:footnoteReference w:id="2"/></w:r>', ''), { 'word/footnotes.xml': fnParts('footnote', '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>' + t(' ' + long) + '</w:p></w:footnote>') }), '');
    expect(loose(g).map((x) => x.text)).toEqual([long]);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);

  it('a file whose notes are all marked comes in as it did: no note is set apart', async () => {
    const g = await importFile('marked.docx', await docx(BODY, { 'word/footnotes.xml': fnParts('footnote', '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>' + t(' A marked note.') + '</w:p></w:footnote>') }), '');
    expect(loose(g)).toEqual([]);
    expect(blocksOf(written(g).filter((s) => s.type === 'chapter')[1].content)).toEqual(['The second chapter stands here.']);
    expect(figures(g)).toEqual(CLEAR);
  }, 120_000);
});
