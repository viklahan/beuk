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
    expect(blocks(c1)).toEqual(['The caravan left[^1] at dawn.', 'Sent from Vienna, unmarked.', 'The last line of dawn.', '[^1]: Salt, by the sack.']);
    expect(blocks(c2)).toEqual(['The pans lay white[^2].', 'Sent from Graz, unmarked.', '[^2]: The pans of the coast.']);
    // no number made up for an unmarked note, anywhere in the book
    const all = secs.map((s) => s.content).join('\n');
    expect(all.match(/\[\^?[34]\]/g) || [], 'a number the file never wrote').toEqual([]);
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
    // no number made up for them: the book's note numbers stop at 109
    const all = secs.map((s) => s.content).join('\n');
    expect((all.match(/\[\^?(\d{1,3})\]/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((n) => n > 109)).toEqual([]);
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
