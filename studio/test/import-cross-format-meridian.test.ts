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

/* The same book from every format (BEUK:importtally, gap 3). The Meridian Ledger stress book is one manuscript in seven
   formats; each is imported by 1.0's own readImportFile and the book's words are read as the tally reads them (the
   studio's own rule, irTallyWordsOf over irTallyBook's text; a word here has a letter or a digit in it, so a sign
   standing alone is none, as this test has always counted). The tally itself now counts characters: its figures
   below are characters, and the whole inventory of what differs is import-tally-meridian.test.ts's. The rich formats must give the same book word for word as
   the Word file, so that a reader that drops, repeats, glues or mis-decodes words in one format shows up here as a
   difference from the others. What differs for a reason that is the file's own is allowed by name, with its count:

   - Markdown and EPUB: "Front Matter" (2 words). The Markdown file sets it in the heading with a colon of its own
     ("## Front Matter: Editorial Brief & Chronology": the book's words "Front" and "Matter:"); the EPUB sets it as a
     label element before the heading, which the import reads with the heading and joins with a space ("Front" and
     "Matter": no colon of the import's, BEUK:joinsgiven); the Word, RTF, OpenDocument and web-page files set it as a
     kicker line above the heading ("Front Matter" over "Editorial Brief & Chronology"), which the import lifts with
     the title page's lines (set aside, counted by the tally). Same words, three shapes of source, two outcomes:
     reported to the owner as a possible import change, not made here.
   - Markdown: "A:" and "B:". Its two appendix headings are typed with a colon ("## Appendix A: Master Chronology …"),
     which the book keeps; every other format sets "Appendix A" on a line of its own over the name, and the import
     joins the two with a space, so its book reads "A" and "B". Two words differ in their colon, none in number.
   - Markdown: 48 words in capitals (the first four of each of the 12 chapters, "BEFORE THE MORNING TRAM") where the
     other formats set small capitals; Markdown has no small capitals, so the file types them as capitals. Compared
     without case, they are the same words.
   - Plain text is a rendering of the book, not the book: its file holds 287 words fewer than the Word file's (its
     tables abridged, long cells cut with "…", a nested table and a coordinate table left out, "[STRUCK: …]" written
     for struck-through words, labels such as "Note:" and "Plate:" added), and it types note numbers ("[2]", 229
     words) and notes labels (13) that the import sets aside, where the Word file's 12 running-header words are set
     aside instead: 287 + 229 + 13 − 12 = 517 fewer in the book. Each figure is pinned below, so a change in the text
     reader shows.

   The book is the owner's untracked folder (tools/Testbooks): BEUK_TESTBOOKS names it, else the default below is
   tried, and where neither holds it the test is skipped and says so. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
const DIR = process.env.BEUK_TESTBOOKS || path.join(import.meta.dirname, '..', '..', 'tools', 'Testbooks', 'The_Meridian_Ledger_TestSuite');
const FILES: [string, string][] = [
  ['docx', 'The_Meridian_Ledger.docx'], ['rtf', 'The_Meridian_Ledger.rtf'], ['odt', 'The_Meridian_Ledger.odt'], ['html', 'The_Meridian_Ledger.html'],
  ['md', 'The_Meridian_Ledger.md'], ['epub', 'The_Meridian_Ledger_Reference.epub'], ['txt', 'The_Meridian_Ledger.txt'],
];
const present = existsSync(path.join(DIR, FILES[0][1]));

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

type Read = { book: string[]; file: number; aside: Record<string, number>; unaccounted: number };
const reads: Record<string, Read> = {};
/** a's words less b's, as a multiset: { word: count } of the words a has more of (and, negative, fewer of) */
function less(a: string[], b: string[], fold: boolean): Map<string, number> {
  const m = new Map<string, number>();
  const k = (w: string) => (fold ? w.toLowerCase() : w);
  a.forEach((w) => m.set(k(w), (m.get(k(w)) || 0) + 1));
  b.forEach((w) => m.set(k(w), (m.get(k(w)) || 0) - 1));
  for (const [w, n] of m) if (!n) m.delete(w);
  return m;
}
const show = (m: Map<string, number>) => [...m].sort((x, y) => (x[0] < y[0] ? -1 : 1)).slice(0, 40).map(([w, n]) => `${w} ${n > 0 ? '+' : ''}${n}`).join(', ');

describe.skipIf(!present)('the same book from every format: the Meridian stress book word for word' + (present ? '' : ' — SKIPPED: the book is not in this checkout (tools/Testbooks is the owner\'s untracked folder; set BEUK_TESTBOOKS to run it)'), () => {
  beforeAll(async () => {
    loadMammoth();
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const roots = ['applyBookDoc', 'buildEmptyBook', 'readImportFile', 'irTallyWordsOf', 'irTallyLast'];
    const out = await buildTestModule(HTML, epub, { roots, supplied: [...new Set([...stubs, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'import-cross-format', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'IMPORT_CROSS', fn: 'createImportCross', title: "1.0's import, the same book from every format (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createImportCross(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api };
    for (const [kind, name] of FILES) {
      document.body.innerHTML = markup.summary + markup.reopen + markup.report + markup.fileInput;
      const m = make(env());
      m.api.applyBookDoc(m.api.buildEmptyBook());
      const bytes = readFileSync(path.join(DIR, name));
      const buf = () => { const ab = new ArrayBuffer(bytes.length); new Uint8Array(ab).set(bytes); return ab; };
      const file = { name, arrayBuffer: async () => buf(), text: async () => new TextDecoder('utf-8').decode(bytes) };
      const rep = ((await m.api.readImportFile(file)) as () => { tally: { file: number; aside: Record<string, number>; unaccounted: number } })();
      const last = m.api.irTallyLast() as { book: { text: string } };
      reads[kind] = { book: (m.api.irTallyWordsOf(last.book.text) as string[]).filter((w) => /[\p{L}\p{N}]/u.test(w)), file: rep.tally.file, aside: rep.tally.aside, unaccounted: rep.tally.unaccounted };
    }
  }, 600_000);

  it.each(['rtf', 'odt', 'html'])('%s: the book is the Word file\'s book, word for word', (kind) => {
    const d = less(reads[kind].book, reads.docx.book, false);
    expect(show(d), `${kind}: words that differ from the Word file's book`).toBe('');
    expect(reads[kind].book.length).toBe(reads.docx.book.length);
  });

  it('md: the Word file\'s book, the heading\'s "Front Matter:" and the colon the file types after "Appendix A" and "Appendix B", nothing else', () => {
    const d = less(reads.md.book, reads.docx.book, true);
    // "a" and "b" are the Word book's "Appendix A" and "Appendix B" (joined to their names with a space); "a:" and "b:" the Markdown file's own
    expect(show(d), 'md: words that differ from the Word file\'s book (case aside)').toBe('a -1, a: +1, b -1, b: +1, front +1, matter: +1');
    expect(reads.md.book.length - reads.docx.book.length).toBe(2);
  });

  it('epub: the Word file\'s book and the label "Front Matter" (a label element before the heading, read with it and joined with a space), nothing else', () => {
    const d = less(reads.epub.book, reads.docx.book, true);
    expect(show(d), 'epub: words that differ from the Word file\'s book (case aside)').toBe('front +1, matter +1');
    expect(reads.epub.book.length - reads.docx.book.length).toBe(2);
  });

  it('md: the only other difference is case — 48 words typed in capitals where the other formats set small capitals (the first four words of each of the 12 chapters)', () => {
    const exact = less(reads.md.book, reads.docx.book, false);
    const more = [...exact.values()].filter((n) => n > 0).reduce((a, n) => a + n, 0);
    expect(more - 4).toBe(48); // less "Front", "Matter:", "A:" and "B:"
  });

  it('txt: a rendering of the book, its differences each the file\'s own and counted', () => {
    // The tally counts characters now. What is unaccounted for in each file, character by character, is the pinned
    // inventory of import-tally-meridian.test.ts: none in the text file (its 12 headings "CHAPTER I — …": the word and the dash
    // are each heading's own label and mark, counted in the headingMarks row as the Markdown file's "Chapter" and colon are;
    // they were a difference of capitals and 12 dashes unaccounted for while the book's side counted Beuk's own "Chapter I"),
    // and none in the Word file (its two appendix headings are joined to their names with a space, no colon of the import's).
    expect(reads.txt.unaccounted).toBe(0);
    expect(reads.txt.aside.headingMarks, 'the text file\'s 12 headings: "CHAPTER" 7 and the dash 1, each').toBe(96);
    expect(reads.docx.aside.headingMarks, 'the Word file\'s 12 label lines "Chapter I" over the heading: "Chapter" 7, each').toBe(84);
    expect(reads.docx.unaccounted).toBe(0);
    expect(reads.txt.file - reads.docx.file, 'the text file holds more characters than the Word file (its typed rules, labels and note numbers)').toBe(17078); /* 17182 until BEUK:listnumbersdrawn: the Word file's count now holds the 104 bullets its lists draw, as the text file's always did */
    expect(reads.txt.aside.noteMarks, 'note numbers typed in the text, set aside (characters)').toBe(484);
    expect(reads.txt.aside.labels, 'notes labels typed, set aside (characters)').toBe(988);
    expect(reads.docx.aside.headers, 'the Word file\'s running headers, set aside (characters)').toBe(78);
    // The book's words, as this test has always counted them: 517 fewer than the Word file's book (the file holds 287
    // fewer, and 229 typed note numbers and 13 label words are set aside where the Word file's 12 header words are).
    expect(reads.txt.book.length - reads.docx.book.length).toBe(-287 - (229 + 13 - 12));
  });
});
