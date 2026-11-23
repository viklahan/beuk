import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
// @ts-expect-error — a plain .mjs build script, no types
import { buildTestModule } from '../scripts/extract-closure.mjs';
import { ORACLE_STUBS } from './import-oracle';
import { loadMammoth } from './vendor';
import markup from '../src/generated/import-markup.json';

/* A note the file defines and never marks (the owner, 2026-11-22: "trace the 12 footnotes and fix it"; "We do not
   change anything from what the writer gives us" — where the words sit matters too). A Markdown file may define a note
   under a label ("[^fn-7]: …") that no reference in the file points to. Before, the import lifted every definition out
   of the text, numbered the unmarked ones after all the others, found no section holding such a number, and set each
   at the end of the LAST chapter as "[110] …": the note moved chapters away from where the writer put it, under a
   number that is nowhere in the file, and the report named that number.

   Now such a note stays where the file wrote it: its text is a paragraph at the place its definition stood, in its
   own chapter. Beuk gives it no number. Its label is the file's markup, as every definition's is. The report names it
   by the writer's own label and the section it stands in. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const DIR = process.env.BEUK_TESTBOOKS || path.join(import.meta.dirname, '..', '..', 'tools', 'Testbooks', 'The_Meridian_Ledger_TestSuite');
const MERIDIAN = path.join(DIR, 'The_Meridian_Ledger.md');
type Api = Record<string, (...a: unknown[]) => unknown>;
let make: (env: Rec) => { api: Api };
const noop = () => undefined;
function env(): Rec {
  const e: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis,
    mammoth: (globalThis as Rec).mammoth };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}
type Sec = { id: string; type: string; kind?: string; title: string; content: string; number?: string };
type Item = { kind: string; where: { secId: string | null; label: string }; before?: string; data: Rec };
type Tally = { counted: boolean; unaccounted: number; chars: { same: boolean; fileOnly: unknown[]; bookOnly: unknown[] }; rows: { key: string; file: number; book: number; why: { k: string; n: number }[] }[] };
type Rep = { tally: Tally; items: Item[] };
let lastModule: { api: Api } | null = null;
async function importText(name: string, text: string): Promise<{ rep: Rep; secs: Sec[] }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  lastModule = m;
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const bytes = new TextEncoder().encode(text);
  const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Rep)();
  return { rep, secs: (m.api.snapshotBookDoc() as { sections: Sec[] }).sections };
}
const chapter = (secs: Sec[], n: string) => secs.find((s) => s.type === 'chapter' && s.number === n)!;
const blocks = (s: Sec) => s.content.split(/\n\s*\n/).map((b) => b.trim());

describe('a note the file defines and never marks stays where the file wrote it, under no number of Beuk\'s', () => {
  beforeAll(async () => {
    loadMammoth();
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'irItemLabel'], supplied: [...new Set([...stubs, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-notes-stood', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_NOTES_STOOD', fn: 'createImportNotesStood', title: "1.0's import, a note kept where it stood (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportNotesStood(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  it('Markdown, named labels: each unmarked note is a paragraph in its own chapter, at the place its definition stood; the marked notes link as before', async () => {
    const md = ['# Chapter 1: Dawn', 'The caravan left[^salt] at dawn.', '[^salt]: Salt, by the sack.', '[^telex-a]: Sent from Vienna, unmarked.', 'The last line of dawn.',
      '# Chapter 2: Noon', 'The pans lay white[^pans].', '[^pans]: The pans of the coast.', '[^telex-b]: Sent from Graz, unmarked.'].join('\n\n') + '\n';
    const { rep, secs } = await importText('unmarked.md', md);
    const c1 = chapter(secs, '1'), c2 = chapter(secs, '2');
    // each chapter: its text, the unmarked note where its definition stood, the marked note linked (Beuk sets a linked note's definition at the section's end)
    // BEUK:notelabels — under the label the file typed: these two lines held "[^1]" and "[^2]", the numbers the import used to write over the labels
    expect(blocks(c1)).toEqual(['The caravan left[^salt] at dawn.', 'Sent from Vienna, unmarked.', 'The last line of dawn.', '[^salt]: Salt, by the sack.']);
    expect(blocks(c2)).toEqual(['The pans lay white[^pans].', 'Sent from Graz, unmarked.', '[^pans]: The pans of the coast.']);
    // no number made up for any note, anywhere in the book
    const all = secs.map((s) => s.content).join('\n');
    expect(all.match(/\[\^?\d+\]/g) || [], 'a number the file never wrote').toEqual([]);
    expect(all).not.toMatch(/telex-[ab]/);
    // the report: one item per unmarked note, by the writer's own label and the chapter it stands in
    const orphans = rep.items.filter((it) => it.kind === 'noteOrphan');
    expect(orphans.map((it) => [it.data.n, it.where.secId, it.before])).toEqual([['telex-a', c1.id, 'Sent from Vienna, unmarked.'], ['telex-b', c2.id, 'Sent from Graz, unmarked.']]);
    expect(orphans.map((it) => String(lastModule!.api.irItemLabel(it)))).toEqual([t('ir.k.noteOrphan', { n: 'telex-a' }), t('ir.k.noteOrphan', { n: 'telex-b' })]);
    const notes = rep.items.find((it) => it.kind === 'notes')!;
    expect(notes.data).toMatchObject({ found: 4, mapped: 2, orphans: 2 });
    // the tally: 4 definitions in the file, 2 linked in the book, the other 2 kept as text; nothing unaccounted, the characters the same
    const row = rep.tally.rows.find((r) => r.key === 'noteDefs')!;
    expect({ file: row.file, book: row.book, why: row.why.map((y) => [y.k, y.n]) }).toEqual({ file: 4, book: 2, why: [['notesOrphan', 2]] });
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same, fileOnly: rep.tally.chars.fileOnly, bookOnly: rep.tally.chars.bookOnly }).toEqual({ unaccounted: 0, same: true, fileOnly: [], bookOnly: [] });
  }, 120_000);

  /* A file whose labels are all Beuk's own numbers is left exactly as typed (irMdNotes returns it untouched): an
     unmarked definition stays the definition it is, where it is, under the writer's own number. That was so before
     this change and is kept: nothing is moved and nothing is renumbered. The report names it by that number and its
     chapter. */
  it('Markdown, Beuk\'s own numbers: an unmarked definition stays as typed, where it stands, under the writer\'s number', async () => {
    const md = ['# Chapter 1: Dawn', 'The caravan left[^1] at dawn.', '[^1]: Salt, by the sack.', '[^7]: Sent from Vienna, unmarked.',
      '# Chapter 2: Noon', 'The pans lay white[^2].', '[^2]: The pans of the coast.'].join('\n\n') + '\n';
    const { rep, secs } = await importText('own-numbers.md', md);
    const c1 = chapter(secs, '1'), c2 = chapter(secs, '2');
    expect(blocks(c1)).toEqual(['The caravan left[^1] at dawn.', '[^1]: Salt, by the sack.', '[^7]: Sent from Vienna, unmarked.']);
    expect(blocks(c2)).toEqual(['The pans lay white[^2].', '[^2]: The pans of the coast.']);
    expect(rep.items.filter((it) => it.kind === 'noteOrphan').map((it) => [it.data.n, it.where.secId])).toEqual([['7', c1.id]]);
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same }).toEqual({ unaccounted: 0, same: true });
  }, 120_000);

  /* ---- A web page (the owner, 2026-11-22: the same rule for every reader that knows where the note stood) ----
     A page's note is a block (an item of a notes list, an <aside>, a paragraph) that a link in the text points at. A
     block the page calls a note that no link points at was lifted out with the others, handed on after them, found no
     mark in any chapter and was set at the end of the LAST chapter as "[?] …": chapters away from where the page wrote
     it, under a "?" that is in no file (the tally counted that "?" as a character the book holds and the file does
     not). Now it stays where its block stood, as its text, under no number. What the page shows it under (the number
     its list draws, a raised number, a typed number its own id ends in) is the file's markup, set aside and counted
     with every other note's; the report names the note by that, or by its id. */
  const page = (body: string) => '<!doctype html><html><head><title>The Salt Road</title></head><body>' + body + '</body></html>';
  const ref = (n: number) => '<a href="#fn' + n + '" id="r' + n + '"><sup>' + n + '</sup></a>';
  const back = (n: number) => ' <a href="#r' + n + '">↩</a>';
  const C1 = '<h1>Chapter 1: Dawn</h1><p>The caravan left' + ref(1) + ' at dawn.</p><p>The last line of dawn.</p>';
  const C2 = '<h1>Chapter 2: Noon</h1><p>The pans lay white' + ref(3) + '.</p>';
  const DAWN = ['The caravan left[^1] at dawn.', 'The last line of dawn.'], SALT = '[^1]: Salt, by the sack.', NOON = 'The pans lay white[^3].', PANS = '[^3]: The pans of the coast.'; /* BEUK:notemarks — the page shows this note as 3, and so does the book (it was "[^2]", the second in Beuk's own count) */
  const VIENNA = 'Sent from Vienna, unmarked.', GRAZ = 'Sent from Graz, unmarked.';
  const orphansOf = (rep: Rep) => rep.items.filter((it) => it.kind === 'noteOrphan');
  const named = (rep: Rep) => orphansOf(rep).map((it) => [it.data.n, it.where.secId, it.before]);
  const clean = (rep: Rep) => ({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same, fileOnly: rep.tally.chars.fileOnly, bookOnly: rep.tally.chars.bookOnly });
  const CLEAN = { unaccounted: 0, same: true, fileOnly: [], bookOnly: [] };
  /** no "[?]", and no note number but the two the page shows for its marked notes, 1 and 3 */
  const madeUp = (secs: Sec[]) => secs.map((s) => s.content).join('\n').match(/\[\?\]|\[\^?(?:2|[4-9]|\d{2,3})\]/g) || [];

  it('a web page, each chapter\'s notes in a block at that chapter\'s end: each unmarked note is a paragraph in its own chapter where its block stood; the marked notes link as before', async () => {
    const html = page(C1 + '<section class="footnotes"><ol><li id="fn1">Salt, by the sack.' + back(1) + '</li><li id="fn2">' + VIENNA + '</li></ol></section>'
      + C2 + '<section class="footnotes"><ol start="3"><li id="fn3">The pans of the coast.' + back(3) + '</li><li id="fn4">' + GRAZ + '</li></ol></section>');
    const { rep, secs } = await importText('unmarked.html', html);
    const c1 = chapter(secs, '1'), c2 = chapter(secs, '2');
    // each chapter: its text, the unmarked note where its notes block stood, the marked note linked (Beuk sets a linked note's definition at the section's end)
    expect(blocks(c1)).toEqual([...DAWN, VIENNA, SALT]);
    expect(blocks(c2)).toEqual([NOON, GRAZ, PANS]);
    expect(madeUp(secs), 'a number the page never wrote').toEqual([]);
    // the report: one item per unmarked note, by the number the page's own list draws beside it (2, and 4 in the list that starts at 3) and the chapter it stands in
    expect(named(rep)).toEqual([['2', c1.id, VIENNA], ['4', c2.id, GRAZ]]);
    expect(orphansOf(rep).map((it) => String(lastModule!.api.irItemLabel(it)))).toEqual([t('ir.k.noteOrphan', { n: '2' }), t('ir.k.noteOrphan', { n: '4' })]);
    expect(rep.items.find((it) => it.kind === 'notes')!.data).toMatchObject({ found: 4, mapped: 2, orphans: 2 });
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  /* The end of the page is where this file wrote the note: the last chapter's end. It is not moved from there to the
     chapter whose notes stand beside it in the list: nothing in the page says which chapter an unmarked note is of. */
  it('a web page, one notes list at the END of the page: the unmarked note stays there, which is the end of the last chapter, under no number', async () => {
    const html = page(C1 + C2 + '<section class="footnotes"><ol><li id="fn1">Salt, by the sack.' + back(1) + '</li><li id="fn2">' + VIENNA + '</li><li id="fn3">The pans of the coast.' + back(3) + '</li></ol></section>');
    const { rep, secs } = await importText('end-of-page.html', html);
    const c1 = chapter(secs, '1'), c2 = chapter(secs, '2');
    expect(blocks(c1)).toEqual([...DAWN, SALT]);
    expect(blocks(c2)).toEqual([NOON, VIENNA, PANS]);
    expect(madeUp(secs)).toEqual([]);
    expect(named(rep)).toEqual([['2', c2.id, VIENNA]]);
    expect(rep.items.find((it) => it.kind === 'notes')!.data).toMatchObject({ found: 3, mapped: 2, orphans: 1 });
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  it('a web page: the number a note prints is the file\'s markup only where the page sets it as a mark (raised) or its own id ends in it; any other opening is the note\'s words and stays', async () => {
    const notes = (unmarked: string) => page(C1 + '<div class="footnotes"><p id="fn1" class="footnote"><sup>1</sup> Salt, by the sack.' + back(1) + '</p>' + unmarked + '</div>'
      + C2 + '<div class="footnotes"><p id="fn3" class="footnote"><sup>3</sup> The pans of the coast.' + back(3) + '</p></div>');
    // a raised number: set aside, and the report names the note by it
    let r = await importText('raised.html', notes('<p id="note-b" class="footnote"><sup>2</sup> ' + VIENNA + '</p>'));
    expect(blocks(chapter(r.secs, '1'))).toEqual([...DAWN, VIENNA, SALT]);
    expect(named(r.rep)).toEqual([['2', chapter(r.secs, '1').id, VIENNA]]);
    expect(clean(r.rep)).toEqual(CLEAN);
    const marks = (rep: Rep) => (rep.tally as unknown as { aside: Record<string, number> }).aside.noteMarks;
    // the two references' numbers, the two return links, the two marked notes' raised numbers, and this one's raised "2"
    expect(marks(r.rep)).toBe(7);
    // a typed number the note's own id ends in ("2. " in the block id="fn2"): set aside (a number that heads a line is a list's marker by the studio's rule, counted on neither side)
    r = await importText('typed.html', notes('<p id="fn2" class="footnote">2. ' + VIENNA + '</p>'));
    expect(blocks(chapter(r.secs, '1'))).toEqual([...DAWN, VIENNA, SALT]);
    expect(named(r.rep)).toEqual([['2', chapter(r.secs, '1').id, VIENNA]]);
    expect(clean(r.rep)).toEqual(CLEAN);
    // a typed number nothing ties to the note: it may be the note's own words, so it stays as typed, and the note is named by its id
    r = await importText('untied.html', notes('<aside role="doc-footnote" id="telex-a">12. ' + VIENNA + '</aside>'));
    expect(blocks(chapter(r.secs, '1'))).toEqual([...DAWN, '12. ' + VIENNA, SALT]);
    expect(named(r.rep)).toEqual([['telex-a', chapter(r.secs, '1').id, '12. ' + VIENNA]]);
    expect(clean(r.rep)).toEqual(CLEAN);
    expect(madeUp(r.secs)).toEqual([]);
    // neither a number nor an id: the report has no name for it, and says "?" rather than make one
    r = await importText('unnamed.html', notes('<aside role="doc-footnote">' + VIENNA + '</aside>'));
    expect(blocks(chapter(r.secs, '1'))).toEqual([...DAWN, VIENNA, SALT]);
    expect(named(r.rep)).toEqual([['?', chapter(r.secs, '1').id, VIENNA]]);
    expect(madeUp(r.secs)).toEqual([]);
  }, 240_000);

  it('a web page: an unmarked note among items the list keeps stays between them (the list is closed and opened again around it, its numbers running on)', async () => {
    const html = page(C1 + '<ol class="footnotes"><li>An item with no id, first.</li><li id="fn1">Salt, by the sack.' + back(1) + '</li><li id="fn2">' + VIENNA + '</li><li>An item with no id, last.</li></ol>'
      + C2 + '<ol class="footnotes"><li id="fn3">The pans of the coast.' + back(3) + '</li></ol>');
    const { rep, secs } = await importText('kept-items.html', html);
    expect(blocks(chapter(secs, '1'))).toEqual([...DAWN, '1. An item with no id, first.', VIENNA, '2. An item with no id, last.', SALT]);
    expect(named(rep)).toEqual([['3', chapter(secs, '1').id, VIENNA]]);
    expect(madeUp(secs)).toEqual([]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  it('a web page: a note whose only mark stands where the import keeps no text (a <nav>) stays where its block stood too, named by the page\'s own mark', async () => {
    const html = page('<nav><a href="#fn9"><sup>9</sup></a></nav>' + C1 + '<section class="footnotes"><ol><li id="fn1">Salt, by the sack.' + back(1) + '</li><li id="fn9">Marked only in the nav.</li></ol></section>'
      + C2 + '<section class="footnotes"><ol><li id="fn3">The pans of the coast.' + back(3) + '</li></ol></section>');
    const { rep, secs } = await importText('nav-mark.html', html);
    expect(blocks(chapter(secs, '1'))).toEqual([...DAWN, 'Marked only in the nav.', SALT]);
    expect(blocks(chapter(secs, '2'))).toEqual([NOON, PANS]);
    expect(named(rep)).toEqual([['9', chapter(secs, '1').id, 'Marked only in the nav.']]);
    expect(madeUp(secs)).toEqual([]);
    // the nav's "9" is set aside once, with the nav's own text (it was counted there and again as a note's mark)
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  it('a web page: a note standing among the loose words of a box parts them only when it stays; a note a reference reaches leaves the paragraph whole, as before', async () => {
    const html = page(C1 + '<div>Loose words before. <aside id="fn1" role="doc-footnote">Salt, by the sack.' + back(1) + '</aside> Loose words between. <aside role="doc-footnote" id="telex-a">' + VIENNA + '</aside> Loose words after.</div>'
      + C2 + '<p id="fn3" class="footnote">3. The pans of the coast.' + back(3) + '</p>');
    const { rep, secs } = await importText('loose-words.html', html);
    expect(blocks(chapter(secs, '1'))).toEqual([...DAWN, 'Loose words before. Loose words between.', VIENNA, 'Loose words after.', SALT]);
    expect(blocks(chapter(secs, '2'))).toEqual([NOON, PANS]);
    expect(named(rep)).toEqual([['telex-a', chapter(secs, '1').id, VIENNA]]);
    expect(madeUp(secs)).toEqual([]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  /* Said plainly: where the note's block stood inside something the reader reads as one line (here an item of a list
     that is no notes list), the reader has no place between blocks to give it. The note is kept at the end of the text,
     under no number, and the report says which chapter that is. It is not where the block stood. */
  it('a web page: an unmarked note standing inside a list item has no place of its own among the blocks: it is kept at the end of the text, under no number, and the report says where', async () => {
    const html = page(C1 + '<ul><li>An item.<div class="footnotes"><p id="fn1" class="footnote">1. Salt, by the sack.' + back(1) + '</p><p id="fn2" class="footnote">2. ' + VIENNA + '</p></div></li></ul>'
      + C2 + '<p id="fn3" class="footnote">3. The pans of the coast.' + back(3) + '</p>');
    const { rep, secs } = await importText('in-an-item.html', html);
    expect(blocks(chapter(secs, '1'))).toEqual([...DAWN, 'An item.', SALT]);
    expect(blocks(chapter(secs, '2'))).toEqual([NOON, VIENNA, PANS]);
    expect(named(rep)).toEqual([['2', chapter(secs, '2').id, VIENNA]]);
    expect(madeUp(secs)).toEqual([]);
    expect(clean(rep)).toEqual(CLEAN);
  }, 120_000);

  it.skipIf(!existsSync(MERIDIAN))('the Meridian Markdown file: 109 notes linked, and each of its 12 unmarked "Teletype Provenance" notes in the chapter whose station code it carries' + (existsSync(MERIDIAN) ? '' : ' — SKIPPED: the book is not in this checkout (set BEUK_TESTBOOKS)'), async () => {
    const { rep, secs } = await importText('The_Meridian_Ledger.md', readFileSync(MERIDIAN, 'utf8'));
    const notes = rep.items.find((it) => it.kind === 'notes')!;
    expect(notes.data).toMatchObject({ found: 121, mapped: 109, orphans: 12 });
    const stations = ['VIE-04', 'GRZ-02', 'TRS-07', 'VCE-01', 'GTH-09', 'ZRH-03', 'BRN-05', 'BSL-08', 'GVA-06', 'INN-10', 'PRG-11', 'BER-12'];
    const chapters = secs.filter((s) => s.type === 'chapter' && s.kind === 'body');
    expect(chapters.length).toBe(12);
    // one in each chapter, the one of its own station; none anywhere else
    const where = stations.map((code) => secs.filter((s) => s.content.indexOf('Teletype Provenance (' + code + ')') !== -1).map((s) => s.id));
    expect(where).toEqual(chapters.map((c) => [c.id]));
    expect(chapters.map((c) => (c.content.match(/Teletype Provenance \(/g) || []).length)).toEqual(new Array(12).fill(1));
    // no number made up for them. BEUK:notelabels — nor for any other note: the book stores the file's own labels
    // ("[^fn-1]" …), 109 of them marked and defined, and no "[^n]" of Beuk's (this line asked that the numbers stop at 109)
    const all = secs.map((s) => s.content).join('\n');
    expect(all.match(/\[\^\d+\]/g) || []).toEqual([]);
    expect(new Set(all.match(/\[\^fn-\d+\](?!:)/g) || []).size).toBe(109);
    expect((all.match(/^\[\^fn-\d+\]:/gm) || []).length).toBe(109);
    expect(all).not.toMatch(/\[1(?:1\d|20|21)\] \*\*Teletype/);
    // the report names each by the writer's own label and its chapter
    const orphans = rep.items.filter((it) => it.kind === 'noteOrphan');
    expect(orphans.map((it) => it.data.n)).toEqual([7, 17, 27, 37, 47, 57, 67, 77, 87, 97, 107, 117].map((n) => 'fn-' + n));
    expect(orphans.map((it) => it.where.secId)).toEqual(chapters.map((c) => c.id));
    const row = rep.tally.rows.find((r) => r.key === 'noteDefs')!;
    expect({ file: row.file, book: row.book, why: row.why.map((y) => [y.k, y.n]) }).toEqual({ file: 121, book: 109, why: [['notesOrphan', 12]] });
    expect({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same }).toEqual({ unaccounted: 0, same: true });
  }, 600_000);
});
