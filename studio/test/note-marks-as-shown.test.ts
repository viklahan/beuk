// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { blocksOf, CLEAR, figures, importFile, setupImport, type Api, type Got, type Rec, type Sec } from './import-given';

/* A note keeps the mark the writer's document shows for it (BEUK:notemarks). The owner, 2026-11-22, on a note shown
   under a number Beuk had made up: "WHY ARE WE INVENTING NUMBERS?"

   Before: a label that was not a number took "the next number no typed number uses", whatever it was. A note the
   writer marked "*" was shown as "[1]".

   Now, which labels a reader is shown as typed:
     - a NUMBER (digits and nothing else): as typed;
     - a MARK (no letter and no digit in it: "*", "**", "†", "‡", "§"): as typed, on every surface, and it takes no
       number;
     - a NAME (anything else: "salt", "fn-7", "a", "1a"): a number, as before.
   Two notes of one mark in a section: each mark means its own note, in order.

   This file holds the showing itself, from a book's stored text, and the Markdown import (the one format whose file
   types a label). The other formats' readers have a file each. Every text here is made up. */

const K = String.fromCharCode(0xE080); /* NOTE_KEY: never stored, never shown */
const P2 = '\n\n';
const md = (...blocks: string[]) => blocks.join(P2) + '\n';
const chapter = (g: { secs: Sec[] }, n: string) => g.secs.find((s) => s.type === 'chapter' && s.number === n)!;
/** the typeset page of a section: the marks it shows in order (an unlinked one with "~" before it), where each links, the Notes list, and the ids */
function page(api: Api, s: Sec): { marks: string[]; hrefs: string[]; notes: string[]; ids: string[]; html: string } {
  const html = String(api.contentBlocksToHtml!(s.content, s, false, true));
  return {
    html,
    marks: [...html.matchAll(/(<a class="noteref"[^>]*>)?<sup class="endnote-ref">([^<]*)<\/sup>/g)].map((x) => (x[1] ? '' : '~') + x[2]),
    hrefs: [...html.matchAll(/<a class="noteref"[^>]* href="#s\d+-([^"]*)">/g)].map((x) => x[1]!),
    notes: [...html.matchAll(/<p class="endnote" id="[^"]*"[^>]*><a class="note-back"[^>]*><sup>([^<]*)<\/sup><\/a> ([^<]*)/g)].map((x) => x[1] + ' ' + x[2]),
    ids: [...html.matchAll(/ id="s\d+-(fn(?:ref)?[^"]*)"/g)].map((x) => x[1]!),
  };
}
/** a book of these chapters, set straight into the studio (no import) */
async function bookOf(contents: string[]): Promise<{ api: Api; secs: Sec[] }> {
  const g = await importFile('seed.md', null, '# Chapter 1: Seed\n\nSeed.\n');
  const doc = g.api.snapshotBookDoc!() as Rec & { sections: Sec[] };
  doc.sections = contents.map((content, i) => ({ id: 'made-' + i, kind: 'body', type: 'chapter', number: String(i + 1), title: 'Made ' + (i + 1), content }));
  g.api.applyBookDoc!(doc);
  return { api: g.api, secs: (g.api.snapshotBookDoc!() as { sections: Sec[] }).sections };
}
const items = (g: Got, kind: string) => g.rep.items.filter((it) => it.kind === kind);
const noteRows = (g: Got) => (g.tally.rows as { key: string; file: number; book: number; why?: { k: string; n: number }[] }[]).filter((r) => r.key === 'noteRefs' || r.key === 'noteDefs').map((r) => [r.key, r.file, r.book, (r.why || []).map((y) => [y.k, y.n])]);

beforeAll(async () => {
  await setupImport('note-marks-as-shown', ['contentBlocksToHtml', 'inlineMd', 'notesAsShown', 'buildMarkdown', 'buildDocxDocumentXml', 'msPlan', 'msDocumentXml', 'acxSectionLines', 'acxPlainInline', 'acxLineTxt', 'acxDocxXml', 'countWords', 'countWordsClean', 'insCleanText', 'nextFootnoteNumber', 'chopMergePlan']);
}, 180_000);

const BOOK = ['The caravan left[^1] at dawn, and[^*] on *in a hurry*, and[^†] again, and[^*] once more, by[^salt] the gate.',
  '[^1]: Salt, by the sack.', '[^*]: The pans of the coast.', '[^†]: The dagger note.', '[^*]: The second star.', '[^salt]: The gate has its own.'].join(P2);

describe('a note the writer marked "*" shows "*", in the text and at the note, on every surface', () => {

  it('the typeset page (the preview, the reading views, the EPUB, the standalone HTML and the print interior are built from it): the mark as typed where a number would stand, each "*" linked to its own note, every id valid and its own', async () => {
    const b = await bookOf([BOOK]);
    const p = page(b.api, b.secs[0]!);
    // the writer's 1, the writer's marks, and the one name ("salt") under the next number: 2, as if the marks were not there
    expect(p.marks).toEqual(['[1]', '[*]', '[†]', '[*]', '[2]']);
    expect(p.notes).toEqual(['[1] Salt, by the sack.', '[*] The pans of the coast.', '[†] The dagger note.', '[*] The second star.', '[2] The gate has its own.']);
    // each mark links to its own note: the first "*" to the first "*" note, the second to the second
    expect(p.hrefs).toEqual(['fn1', 'fnm2a-1', 'fnm2020-1', 'fnm2a-2', 'fn2']);
    expect(p.ids).toEqual(['fnref1', 'fnrefm2a-1', 'fnrefm2020-1', 'fnrefm2a-2', 'fnref2', 'fn1', 'fnm2a-1', 'fnm2020-1', 'fnm2a-2', 'fn2']);
    expect(new Set(p.ids).size, 'every id its own').toBe(p.ids.length);
    const allIds = [...p.html.matchAll(/ id="([^"]*)"/g)].map((x) => x[1]!);
    for (const id of allIds) expect(id, 'an id an XHTML page and an EPUB allow').toMatch(/^[A-Za-z][A-Za-z0-9._-]*$/);
    for (const h of [...p.html.matchAll(/ href="#([^"]*)"/g)].map((x) => x[1]!)) expect(allIds, 'a link with no target: ' + h).toContain(h);
    // the "*" of a mark is never an italic's: the one italic is the writer's
    expect([...p.html.matchAll(/<em>([^<]*)<\/em>/g)].map((x) => x[1])).toEqual(['in a hurry']);
    // nothing of the working key, and no label left in brackets, reaches the page
    expect(p.html).not.toContain(K);
    expect(p.html).not.toContain('[^');
  }, 120_000);

  it('a note at the foot of a printed page is called by the bare mark, as a number is by the bare figure', async () => {
    const b = await bookOf([BOOK]);
    const ctx = (foot: boolean) => ({ prefix: 's0-', defined: new Set(['*' + K + '1', '7']), seen: new Set(), foot });
    expect(String(b.api.inlineMd!('on[^*' + K + '1] and[^7].', ctx(true)))).toBe('on<a class="noteref" epub:type="noteref" id="s0-fnrefm2a-1" href="#s0-fnm2a-1"><sup class="endnote-ref">*</sup></a> and<a class="noteref" epub:type="noteref" id="s0-fnref7" href="#s0-fn7"><sup class="endnote-ref">7</sup></a>.');
    expect(String(b.api.inlineMd!('on[^*' + K + '1] and[^7].', ctx(false)))).toBe('on<a class="noteref" epub:type="noteref" id="s0-fnrefm2a-1" href="#s0-fnm2a-1"><sup class="endnote-ref">[*]</sup></a> and<a class="noteref" epub:type="noteref" id="s0-fnref7" href="#s0-fn7"><sup class="endnote-ref">[7]</sup></a>.');
  }, 120_000);

  it('the Word export and the submission manuscript: the mark raised as "[*]" where "[n]" would stand, and the note listed under its mark', async () => {
    const b = await bookOf([BOOK]);
    const docx = String(b.api.buildDocxDocumentXml!());
    const count = (xml: string, s: string) => xml.split(s).length - 1;
    // in the text (raised) and in the Endnotes (bold, with a space): "[1]", "[*]" twice, "[†]", "[2]"
    expect([count(docx, '>[1]</w:t>'), count(docx, '>[*]</w:t>'), count(docx, '>[†]</w:t>'), count(docx, '>[2]</w:t>')]).toEqual([1, 2, 1, 1]);
    expect([count(docx, '>[1] </w:t>'), count(docx, '>[*] </w:t>'), count(docx, '>[†] </w:t>'), count(docx, '>[2] </w:t>')]).toEqual([1, 2, 1, 1]);
    // the Endnotes list them in the book's order, so the two "*" notes stay in the order of their marks
    expect([...docx.matchAll(/>\[([^\]<]*)\] <\/w:t>/g)].map((x) => x[1])).toEqual(['1', '*', '†', '*', '2']);
    expect(docx.indexOf('The pans of the coast.')).toBeLessThan(docx.indexOf('The second star.'));
    expect(docx).toContain('<w:i/>');
    expect(count(docx, 'in a hurry')).toBe(1);
    expect(docx).not.toContain(K);
    expect(docx).not.toContain('[^');
    const ms = String(b.api.msDocumentXml!(b.api.msPlan!()));
    expect([count(ms, '>[1]</w:t>'), count(ms, '>[*]</w:t>'), count(ms, '>[†]</w:t>'), count(ms, '>[2]</w:t>')]).toEqual([1, 2, 1, 1]);
    // its Notes: a number with its point, as before; a mark as typed, with no point of Beuk's
    expect([count(ms, '>1. </w:t>'), count(ms, '>* </w:t>'), count(ms, '>† </w:t>'), count(ms, '>2. </w:t>')]).toEqual([1, 2, 1, 1]);
    expect(ms).not.toContain(K);
    expect(ms).not.toContain('[^');
  }, 120_000);

  it('the narration script: the cue names the note as the page shows it, "[NOTE *]", and the note\'s own line follows its paragraph under that mark', async () => {
    const b = await bookOf([BOOK]);
    const lines = b.api.acxSectionLines!(b.secs[0]!) as { k: string; n?: string; text: string }[];
    expect(lines.filter((l) => l.k === 'note').map((l) => [l.n, l.text])).toEqual([['1', 'Salt, by the sack.'], ['*', 'The pans of the coast.'], ['†', 'The dagger note.'], ['*', 'The second star.'], ['2', 'The gate has its own.']]);
    expect(lines.filter((l) => l.k === 'para').map((l) => String(b.api.acxPlainInline!(l.text)))).toEqual(['The caravan left [NOTE 1] at dawn, and [NOTE *] on in a hurry, and [NOTE †] again, and [NOTE *] once more, by [NOTE 2] the gate.']);
    const txt = lines.map((l) => String(b.api.acxLineTxt!(l)));
    expect(txt.filter((l) => l.startsWith('[NARRATOR DECISION — footnote')).map((l) => l.slice(0, l.indexOf('”') + 1))).toEqual([
      '[NARRATOR DECISION — footnote 1: “Salt, by the sack.”', '[NARRATOR DECISION — footnote *: “The pans of the coast.”', '[NARRATOR DECISION — footnote †: “The dagger note.”',
      '[NARRATOR DECISION — footnote *: “The second star.”', '[NARRATOR DECISION — footnote 2: “The gate has its own.”']);
    const xml = String(b.api.acxDocxXml!(lines));
    expect([...xml.matchAll(/>\[NOTE ([^\]<]*)\]<\/w:t>/g)].map((x) => x[1])).toEqual(['1', '*', '†', '*', '2']);
    for (const out of [txt.join('\n'), xml]) { expect(out).not.toContain(K); expect(out).not.toContain('[^'); }
  }, 120_000);

  it('the Markdown export writes the stored text; a mark is no word in any count; a new note still takes a number', async () => {
    const b = await bookOf([BOOK]);
    expect(String(b.api.buildMarkdown!())).toContain(BOOK);
    const plain = 'The caravan left at dawn, and on in a hurry, and again, and once more, by the gate. Salt, by the sack. The pans of the coast. The dagger note. The second star. The gate has its own.';
    expect(String(b.api.countWordsClean!(BOOK)).replace(/\*/g, '').replace(/\s+/g, ' ').trim()).toBe(plain);
    expect(b.api.countWords!(BOOK)).toBe(38);
    expect(b.api.countWords!(BOOK)).toBe(b.api.countWords!(plain));
    // (Story Insights sets a space where an emphasis mark stood, as it always did: "hurry*," is "hurry ,")
    expect(String(b.api.insCleanText!(BOOK)).replace(/\s+/g, ' ').replace(/ ,/g, ',').trim()).toBe(plain);
    // the section shows the numbers 1 and 2 (the name's), so the next note the editor adds is 3: a mark takes no number
    expect(b.api.nextFootnoteNumber!(BOOK)).toBe(3);
  }, 120_000);

  it('the line between a number, a mark and a name, label by label', async () => {
    const one = async (label: string) => { const b = await bookOf(['Text[^' + label + '].' + P2 + '[^' + label + ']: Note.']); const p = page(b.api, b.secs[0]!); return [p.marks[0], p.notes[0]]; };
    // a number: as typed
    for (const l of ['1', '007', '2024']) expect(await one(l), l).toEqual(['[' + l + ']', '[' + l + '] Note.']);
    // a mark (no letter and no digit): as typed
    for (const l of ['*', '**', '***', '†', '‡', '§', '¶', '‖', '#', '*†', '+', '~']) expect(await one(l), l).toEqual(['[' + l + ']', '[' + l + '] Note.']);
    // a name (a letter, or a digit beside something else): a number, as before
    for (const l of ['a', 'A', 'i', 'salt', 'fn-7', '1a', '7*', 'x*', '1.2', 'é', 'ⅳ', '¹', '注']) expect(await one(l), l).toEqual(['[1]', '[1] Note.']);
  }, 240_000);

  it('a mark no note answers is the writer\'s text, exactly as typed, on every surface; its "*" opens no italic', async () => {
    const text = 'First.' + P2 + 'Lost[^*] and *found* here[^*], and[^†] too.';
    const b = await bookOf([text]);
    const p = page(b.api, b.secs[0]!);
    expect(p.marks).toEqual([]);
    expect(p.html).toContain('Lost[^*] and <em>found</em> here[^*], and[^†] too.</p>');
    const docx = String(b.api.buildDocxDocumentXml!());
    expect(docx.replace(/<[^>]+>/g, '')).toContain('Lost[^*] and found here[^*], and[^†] too.');
    expect(docx).not.toContain('>[*]</w:t>');
    const lines = b.api.acxSectionLines!(b.secs[0]!) as { k: string; text: string }[];
    expect(lines.filter((l) => l.k === 'note')).toEqual([]);
    expect(lines.filter((l) => l.k === 'para').map((l) => String(b.api.acxPlainInline!(l.text)))).toEqual(['First.', 'Lost[^*] and found here[^*], and[^†] too.']);
  }, 120_000);

  it('a mark of "&" or "<" finds its note and is set escaped', async () => {
    const b = await bookOf(['Text[^&] and[^<].' + P2 + '[^&]: Ampersand.' + P2 + '[^<]: Less.']);
    const p = page(b.api, b.secs[0]!);
    expect(p.marks).toEqual(['[&amp;]', '[&lt;]']);
    expect(p.hrefs).toEqual(['fnm26-1', 'fnm3c-1']);
    expect(p.notes).toEqual(['[&amp;] Ampersand.', '[&lt;] Less.']);
  }, 120_000);

  it('joining two chapters that each hold a "*" note: neither is rewritten, and each mark keeps its own note', async () => {
    const b = await bookOf(['Seed.']);
    const plan = b.api.chopMergePlan!({ content: 'One[^*].' + P2 + '[^*]: The harbour.', scenes: [] }, { content: 'Two[^*].' + P2 + '[^*]: The crossing.', scenes: [] }) as { content: string; relabelled: number };
    expect(plan).toMatchObject({ content: 'One[^*].' + P2 + '[^*]: The harbour.' + P2 + '***' + P2 + 'Two[^*].' + P2 + '[^*]: The crossing.', relabelled: 0 });
    expect(String(b.api.notesAsShown!(null, plan.content))).toBe('One[^*' + K + '1].' + P2 + '[^*' + K + '1]: The harbour.' + P2 + '***' + P2 + 'Two[^*' + K + '2].' + P2 + '[^*' + K + '2]: The crossing.');
  }, 120_000);
});

describe('Markdown: a file that marks its notes "*" is stored as typed and each mark keeps its own note', () => {

  it('two "*" notes in one paragraph, a "†", a number and a name: stored as the file typed them, shown as typed, nothing unaccounted', async () => {
    const g = await importFile('stars.md', null, md('# Chapter 1: Dawn', 'The caravan left[^*] at dawn, and on[^*], past[^†] the gate[^1], by[^salt] the wall.',
      '[^*]: The first star.', '[^*]: The second star.', '[^†]: The dagger.', '[^1]: One.', '[^salt]: Salt.', '# Chapter 2: Noon', 'Noon[^*].', '[^*]: Noon\'s own star.'));
    // the two "*" definitions stand in the order of their marks, straight after the paragraph that holds both marks
    expect(blocksOf(chapter(g, '1').content)).toEqual(['The caravan left[^*] at dawn, and on[^*], past[^†] the gate[^1], by[^salt] the wall.',
      '[^*]: The first star.', '[^*]: The second star.', '[^†]: The dagger.', '[^1]: One.', '[^salt]: Salt.']);
    expect(blocksOf(chapter(g, '2').content)).toEqual(['Noon[^*].', '[^*]: Noon\'s own star.']);
    const p1 = page(g.api, chapter(g, '1')), p2 = page(g.api, chapter(g, '2'));
    expect(p1.marks).toEqual(['[*]', '[*]', '[†]', '[1]', '[2]']);
    expect(p1.hrefs).toEqual(['fnm2a-1', 'fnm2a-2', 'fnm2020-1', 'fn1', 'fn2']);
    expect(p1.notes).toEqual(['[*] The first star.', '[*] The second star.', '[†] The dagger.', '[1] One.', '[2] Salt.']);
    expect(p2.marks).toEqual(['[*]']);
    expect(p2.notes).toEqual(['[*] Noon\'s own star.']);
    expect(items(g, 'notes')[0]!.data).toMatchObject({ found: 6, refs: 6, mapped: 6, orphans: 0 });
    expect(items(g, 'noteOrphan')).toEqual([]);
    expect(items(g, 'refOrphan')).toEqual([]);
    expect(figures(g)).toEqual(CLEAR);
    // the two "*" marks of the one paragraph are two references, on both sides of the tally
    expect(noteRows(g)).toEqual([['noteRefs', 6, 6, []], ['noteDefs', 6, 6, []]]);
  }, 120_000);

  it('one mark through a chapter, each note typed after its own paragraph; a note marked twice; the file exported and read again is the same book', async () => {
    const first = await importFile('through.md', null, md('# Chapter 1: Dawn', 'One[^*] and again[^*].', '[^*]: First.', 'Two[^*] three[^*].', '[^*]: Second.', '[^*]: Third.', '# Chapter 2: Noon', 'Noon.'));
    expect(blocksOf(chapter(first, '1').content)).toEqual(['One[^*] and again[^*].', '[^*]: First.', 'Two[^*] three[^*].', '[^*]: Second.', '[^*]: Third.']);
    const p = page(first.api, chapter(first, '1'));
    expect(p.marks).toEqual(['[*]', '[*]', '[*]', '[*]']);
    expect(p.hrefs).toEqual(['fnm2a-1', 'fnm2a-1', 'fnm2a-2', 'fnm2a-3']);
    expect(p.notes).toEqual(['[*] First.', '[*] Second.', '[*] Third.']);
    expect(figures(first)).toEqual(CLEAR);
    const out1 = String(first.api.buildMarkdown!());
    const second = await importFile('through-again.md', null, out1);
    expect(second.secs.filter((s) => s.type === 'chapter').map((s) => [s.number, s.title, s.content])).toEqual(first.secs.filter((s) => s.type === 'chapter').map((s) => [s.number, s.title, s.content]));
    expect(String(second.api.buildMarkdown!())).toBe(out1);
  }, 240_000);

  it('a tally whose totals differ still gives its reasons: a "*" note nothing marks is kept as its words and named, and a "†" mark with no note is named as typed', async () => {
    const g = await importFile('differ.md', null, md('# Chapter 1: Dawn', 'The caravan left[^*] at dawn and lost[^†].', '[^*]: The star.', '# Chapter 2: Noon', 'Noon.', '[^‡]: Nobody points here.'));
    expect(blocksOf(chapter(g, '1').content)).toEqual(['The caravan left[^*] at dawn and lost[^†].', '[^*]: The star.']);
    expect(blocksOf(chapter(g, '2').content)).toEqual(['Noon.', 'Nobody points here.']);
    const p = page(g.api, chapter(g, '1'));
    expect(p.marks).toEqual(['[*]']);
    expect(p.html).toContain(' at dawn and lost[^†].</p>');
    expect(items(g, 'noteOrphan').map((it) => [it.data!.n, it.before])).toEqual([['‡', 'Nobody points here.']]);
    expect(items(g, 'refOrphan').map((it) => [it.data!.n, it.before])).toEqual([['†', '[^†]']]);
    expect(g.tally.unaccounted).toBe(0);
    expect(g.tally.chars.same).toBe(true);
  }, 120_000);
});
