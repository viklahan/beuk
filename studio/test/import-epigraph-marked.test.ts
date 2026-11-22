import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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

/* An epigraph is found only where the file marks one (the owner, 2026-11-22: "Treat what the writer's ingestion as the
   document we live by"; "KEEP WHAT THE WRITER GIVES US").

   From the repo's first commit the import took a chapter's opening for an epigraph whenever it opened on a quotation
   mark and the next short paragraph began with a capital and did not close on ". ! ?". A chapter that opens on a line
   of dialogue answered by a short paragraph ending in dialogue ("Mara laughed. \"Never.\"") is exactly that shape: its
   first two paragraphs were lifted out of the chapter and set on a page of their own called "Epigraph". The same loose
   test ran over everything standing before Chapter One, and over the whole of a file with no headings at all, where it
   took the first such pair from wherever it stood in the story.

   The rule now: the attribution must be marked as one. It is a short line that opens on a dash and does not end a
   sentence ("— Rumi", "-- Oscar Wilde, Lady Windermere's Fan"). At a chapter's head nothing else is an epigraph. In
   the pages before the first chapter a marked epigraph is found when no prose stands before it; a quotation followed
   by a bare name is still read as an epigraph there, but only when the book has chapters and those pages hold no
   prose at all (so the choice is between two names for one short page, and no line leaves the text it stood in). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
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
type Item = { kind: string; where: { secId: string | null; label: string }; data: Rec; reversible?: boolean };
type Rep = { tally: { unaccounted: number; chars: { same: boolean } }; items: Item[] };
async function importText(name: string, text: string): Promise<{ rep: Rep; secs: Sec[] }> {
  document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
  const m = make(env());
  m.api.applyBookDoc(m.api.buildEmptyBook());
  const bytes = new TextEncoder().encode(text);
  const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
  const rep = ((await m.api.readImportFile({ name, arrayBuffer: async () => buf(), text: async () => text })) as () => Rep)();
  return { rep, secs: (m.api.snapshotBookDoc() as { sections: Sec[] }).sections };
}
const chapter = (secs: Sec[], n: string) => secs.find((s) => s.type === 'chapter' && s.number === n)!;
const blocks = (s: Sec) => s.content.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
const epigraphs = (secs: Sec[]) => secs.filter((s) => s.type === 'epigraph' && s.content.trim());
const whole = (rep: Rep) => ({ unaccounted: rep.tally.unaccounted, same: rep.tally.chars.same });
const md = (...b: string[]) => b.join('\n\n') + '\n';
const PROSE = 'The harbour at dawn was a held breath, and the tide had not yet decided which way to run. The pilots stood along the wall with their hands in their coats and said nothing to one another, because there was nothing yet to say. Out past the second buoy a ferry showed its lights and then thought better of it, and the gulls went up off the fish quay all at once, as they did when the wind came round.';

describe('an epigraph is found only where the file marks one', () => {
  beforeAll(async () => {
    loadMammoth();
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'snapshotBookDoc', 'readImportFile', 'irItemLabel'], supplied: [...new Set([...stubs, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-epigraph-marked', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_EPIGRAPH_MARKED', fn: 'createImportEpigraphMarked', title: "1.0's import, an epigraph only where the file marks one (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportEpigraphMarked(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
  }, 180_000);

  /* ---- a chapter's head: what must stay in the chapter ---- */

  it('a chapter that opens on dialogue, answered by a short paragraph ending in dialogue, keeps its opening', async () => {
    const c1 = ['"Where is he?"', 'Mara laughed. "Never"', 'She put the chart case down on the wet boards and looked along the quay for the harbourmaster.'];
    const c2 = ['"You came back."', 'Old Tam said it flat', 'The ferry was already casting off, and neither of them moved to stop it.'];
    const { rep, secs } = await importText('dialogue.md', md('# Chapter 1: Dawn', ...c1, '# Chapter 2: Noon', ...c2));
    expect(epigraphs(secs).map((s) => s.content), 'no page of Beuk\'s making').toEqual([]);
    expect(blocks(chapter(secs, '1'))).toEqual(c1);
    expect(blocks(chapter(secs, '2'))).toEqual(c2);
    expect(rep.items.filter((it) => it.kind === 'matter' && it.data.via === 'chapter-head')).toEqual([]);
    expect(whole(rep)).toEqual({ unaccounted: 0, same: true });
  }, 120_000);

  it('a chapter of two paragraphs and a note the file never marks keeps all three (the path the unmarked-note change opened)', async () => {
    const { secs } = await importText('two-and-a-note.md', md('# Chapter 1: Dawn', '"Where is he?"', 'Mara laughed. "Never"', '[^telex-a]: Sent from Vienna, unmarked.',
      '# Chapter 2: Noon', 'The pans lay white.'));
    expect(epigraphs(secs)).toEqual([]);
    expect(blocks(chapter(secs, '1'))).toEqual(['"Where is he?"', 'Mara laughed. "Never"', 'Sent from Vienna, unmarked.']);
  }, 120_000);

  it('a line of dialogue set with a dash is a sentence, not an attribution', async () => {
    const c1 = ['"Where is he?"', '— Gone, said the pilot.', 'She put the chart case down on the wet boards.'];
    const c2 = ['"You came back."', '— Did you think I would not?', 'The ferry was already casting off.'];
    const { secs } = await importText('dash-dialogue.md', md('# Chapter 1: Dawn', ...c1, '# Chapter 2: Noon', ...c2));
    expect(epigraphs(secs)).toEqual([]);
    expect(blocks(chapter(secs, '1'))).toEqual(c1);
    expect(blocks(chapter(secs, '2'))).toEqual(c2);
  }, 120_000);

  it('lines of verse at a chapter\'s head whose last line is a short capitalised one stay in the chapter', async () => {
    const verse = '"O the tide is out\nand the boats lie over\nMara Of Harbour Wall';
    const { secs } = await importText('verse.md', md('# Chapter 1: Dawn', verse, 'She put the chart case down on the wet boards.', '# Chapter 2: Noon', 'The pans lay white.'));
    expect(epigraphs(secs)).toEqual([]);
    expect(blocks(chapter(secs, '1'))[0]).toBe(verse);
  }, 120_000);

  /* ---- a chapter's head: what is still found ---- */

  it('a quotation with a dash-marked attribution at a chapter\'s head is that chapter\'s epigraph, as typed, and the report can put it back', async () => {
    const { rep, secs } = await importText('marked.md', md('# Chapter 1: Dawn', '"We are all in the gutter, but some of us are looking at the stars."', '-- Oscar Wilde, Lady Windermere\'s Fan',
      'She put the chart case down on the wet boards.', '# Chapter 2: Noon', '"The sea is looking at no one."\n— T. S. Eliot', 'The pans lay white.'));
    const eps = epigraphs(secs);
    expect(eps.map((s) => blocks(s))).toEqual([['"We are all in the gutter, but some of us are looking at the stars."', '-- Oscar Wilde, Lady Windermere\'s Fan'], ['"The sea is looking at no one."\n— T. S. Eliot']]);
    expect(blocks(chapter(secs, '1'))).toEqual(['She put the chart case down on the wet boards.']);
    expect(blocks(chapter(secs, '2'))).toEqual(['The pans lay white.']);
    // each stands just before its own chapter, and the report says so and can undo it
    expect(secs.indexOf(eps[0])).toBe(secs.indexOf(chapter(secs, '1')) - 1);
    expect(secs.indexOf(eps[1])).toBe(secs.indexOf(chapter(secs, '2')) - 1);
    const recs = rep.items.filter((it) => it.kind === 'matter' && it.data.via === 'chapter-head');
    expect(recs.map((r) => [r.where.secId, r.data.chapterId, r.reversible])).toEqual([[eps[0].id, chapter(secs, '1').id, true], [eps[1].id, chapter(secs, '2').id, true]]);
    expect(whole(rep)).toEqual({ unaccounted: 0, same: true });
  }, 120_000);

  /* ---- before the first chapter ---- */

  it('before Chapter One, prose with dialogue in it stays whole and in order: no pair of lines is lifted out of it', async () => {
    const front = [PROSE, '"Where is he?"', 'Mara laughed. "Never"', 'She put the chart case down on the wet boards and looked along the quay.'];
    const { secs } = await importText('front-prose.md', md(...front, '# Chapter 1: Dawn', 'The pans lay white.', '# Chapter 2: Noon', 'The ferry was already casting off.'));
    expect(epigraphs(secs)).toEqual([]);
    const holder = secs.filter((s) => s.content.includes('held breath'));
    expect(holder.length).toBe(1);
    expect(blocks(holder[0])).toEqual(front);
  }, 120_000);

  it('before Chapter One, a marked epigraph standing after prose stays where the file wrote it, after that prose', async () => {
    const front = [PROSE, '"The sea is looking at no one."', '— Oscar Wilde'];
    const { secs } = await importText('front-prose-then-epigraph.md', md(...front, '# Chapter 1: Dawn', 'The pans lay white.', '# Chapter 2: Noon', 'The ferry was already casting off.'));
    expect(epigraphs(secs)).toEqual([]);
    const holder = secs.filter((s) => s.content.includes('held breath'));
    expect(holder.length).toBe(1);
    expect(blocks(holder[0])).toEqual(front);
  }, 120_000);

  it('before Chapter One, a marked epigraph ahead of the prose is the epigraph, and the prose follows it', async () => {
    const { secs } = await importText('front-epigraph-then-prose.md', md('"The sea is looking at no one."', '— Oscar Wilde', PROSE, '# Chapter 1: Dawn', 'The pans lay white.', '# Chapter 2: Noon', 'The ferry was already casting off.'));
    const eps = epigraphs(secs);
    expect(eps.map((s) => blocks(s))).toEqual([['"The sea is looking at no one."', '— Oscar Wilde']]);
    const holder = secs.find((s) => s.content.includes('held breath'))!;
    expect(blocks(holder)).toEqual([PROSE]);
    expect(secs.indexOf(eps[0])).toBeLessThan(secs.indexOf(holder));
  }, 120_000);

  it('before Chapter One, with no prose there, a quotation followed by a bare name is still read as the epigraph', async () => {
    const { secs } = await importText('front-bare-name.md', md('For Anna, who waited by the harbour wall.', '"The sea is looking at no one."', 'Oscar Wilde', '# Chapter 1: Dawn', 'The pans lay white.', '# Chapter 2: Noon', 'The ferry was already casting off.'));
    expect(epigraphs(secs).map((s) => blocks(s))).toEqual([['"The sea is looking at no one."', 'Oscar Wilde']]);
    expect(secs.filter((s) => s.type === 'dedication' && s.content.trim()).map((s) => blocks(s))).toEqual([['For Anna, who waited by the harbour wall.']]);
  }, 120_000);

  /* ---- a file with no headings: the text is the book ---- */

  it('a story with no headings keeps every line where it stood: dialogue in it is not an epigraph', async () => {
    const story = [PROSE, '"Where is he?"', 'Mara laughed. "Never"', 'She put the chart case down on the wet boards and looked along the quay.', '"Then we wait."', 'Old Tam said it flat'];
    const { rep, secs } = await importText('story.md', md(...story));
    expect(epigraphs(secs)).toEqual([]);
    const holder = secs.filter((s) => s.content.includes('held breath'));
    expect(holder.length).toBe(1);
    expect(blocks(holder[0])).toEqual(story);
    expect(whole(rep)).toEqual({ unaccounted: 0, same: true });
  }, 120_000);

  it('a story with no headings that opens on a marked epigraph: the epigraph is found, and the story is whole after it', async () => {
    const story = [PROSE, '"Where is he?"', 'Mara laughed. "Never"'];
    const { secs } = await importText('story-with-epigraph.md', md('"The sea is looking at no one."', '— Oscar Wilde', ...story));
    expect(epigraphs(secs).map((s) => blocks(s))).toEqual([['"The sea is looking at no one."', '— Oscar Wilde']]);
    const holder = secs.find((s) => s.content.includes('held breath'))!;
    expect(blocks(holder)).toEqual(story);
  }, 120_000);
});
