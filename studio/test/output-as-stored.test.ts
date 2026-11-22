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

/* The owner's ruling (2026-11-22), the second half: "just switch, remove it everywhere." Nothing that builds a view or a
   file from the book may change, add or remove a non-whitespace character of the writer's text. Until now every
   surface ran the book's text through beautifyText as it set it, so a book that stored a straight quote, "--" or "..."
   showed a curly quote, a dash and an ellipsis in the preview, the EPUB, the Markdown and the Word file — characters
   the book did not hold. Now each surface sets the characters that are stored. The tidying is the writer's own
   Auto-Format button, and nothing else: the same text after it holds the tidied characters, and every surface then
   shows those.

   1.0's own builders, lifted from client/index.html (the text 2.0 lifts): the preview's and the EPUB page's
   contentBlocksToHtml, epubFiles, buildMarkdown, buildDocxDocumentXml. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
const HTML = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
type Api = Record<string, (...a: unknown[]) => unknown>;
type Sec = Rec & { id: string; kind: string; type: string; title: string; content: string };
type Doc = Rec & { sections: Sec[]; meta: Rec };
let make: (env: Rec) => { api: Api; getState: () => Rec };
const noop = () => undefined;
function env(): Rec {
  const e: Rec = { state: {}, toast: noop, samplePicsRequire: async () => undefined, JSZip: (globalThis as Rec).JSZip, t, UI_STRINGS: {}, getUiLang: () => 'en',
    uiLangState: { lang: 'en' }, fmtDateIntl: (d: Date) => d.toISOString(), icons: noop, cloudConfirm: async () => true, cloud: { user: null, available: false, shelf: [] },
    net: { online: false }, apiFetch: async () => null, cloudDirty: false, $: (id: string) => document.getElementById(id), document: globalThis.document, window: globalThis };
  for (const n of [...ORACLE_STUBS, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf']) if (!(n in e)) e[n] = noop;
  return e;
}

/* What the writer typed: straight double and single quotes, an apostrophe, two and three hyphens, three dots, a range
   of years, a spaced range of pages, a spaced hyphen between words. */
const LINE = '"Go," she said -- \'now\'... It ran 1914-1918, pages 12 - 15; a - b, and it\'s done---almost.';
const POLISHED = '“Go,” she said — ‘now’… It ran 1914–1918, pages 12–15; a — b, and it’s done—almost.';
const NOTE = 'A "wet" one -- truly...';
const NOTE_POLISHED = 'A “wet” one — truly…';
const CONTENT = [LINE + '[^1]', '***', '> "To be" -- or not...\n> -- The Clerk', '[^1]: ' + NOTE].join('\n\n');

/** every surface's text of the one chapter, as a reader of that surface gets it */
function surfaces(content: string): Record<string, string> {
  const m = make(env());
  const doc = m.api.buildEmptyBook() as Doc;
  const ch = doc.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
  ch.title = 'Dawn';
  ch.content = content;
  doc.meta.title = 'As Stored'; doc.meta.author = 'A. Writer'; doc.meta.language = 'en';
  m.api.applyBookDoc(doc);
  const sec = (m.getState().sections as Sec[]).find((s) => s.id === ch.id)!;
  const textOf = (html: string) => { const el = document.createElement('div'); el.innerHTML = html; return (el.textContent || '').replace(/\s+/g, ' '); };
  const files = m.api.epubFiles('generic') as { path: string; content: string }[];
  const page = files.filter((f) => /\.xhtml$/.test(f.path) && String(f.content).indexOf('Dawn') !== -1 && /she said/.test(String(f.content)))[0];
  const docx = String(m.api.buildDocxDocumentXml());
  const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return {
    preview: textOf(String(m.api.contentBlocksToHtml(sec.content, sec, true, false))),
    epub: page ? textOf(String(page.content).replace(/^[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '')) : '(no chapter page found in the EPUB)',
    markdown: String(m.api.buildMarkdown()).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\s+/g, ' '), /* less its YAML block, whose fences are three hyphens */
    word: unxml((docx.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join(' ')).replace(/\s+/g, ' '),
  };
}
let polish: (s: string) => string;

describe('every surface sets the characters the book stores: no output changes a quote, a dash or an ellipsis', () => {
  beforeAll(async () => {
    const epub = readFileSync(path.join(import.meta.dirname, '..', '..', 'src', 'book', 'epub', 'closure.ts'), 'utf8');
    const stubs = ORACLE_STUBS.filter((n) => !['applySampleBookSync', 'irOpenReport', 'bibleBookArrived', 'markWritingActivity', 'noteBookEdited'].includes(n));
    const out = await buildTestModule(HTML, epub, { roots: ['applyBookDoc', 'buildEmptyBook', 'epubFiles', 'buildMarkdown', 'buildDocxDocumentXml', 'contentBlocksToHtml', 'beautifyText', 'sceneBreakCount', 'SAMPLE_SECTIONS'], supplied: [...new Set([...stubs, 'cloudHeartbeat', 'localMarkDirty', 'cloudAutosaveTick', 'renderShelfList', 'cloudLoadShelf'])], what: 'output-as-stored', fileReaders: ['bulkFileToData', 'samplePicB64'], prefix: 'OUTPUT_AS_STORED', fn: 'createOutputAsStored', title: "1.0's builders, setting the book's characters as stored (tests only)" });
    const code = (out.code as string).replace(/^export (const|function) /gm, '$1 ') + '\nreturn createOutputAsStored(env);';
    make = (e: Rec) => new Function('env', code)(e) as { api: Api; getState: () => Rec };
    polish = (s: string) => { const m = make(env()); m.api.applyBookDoc(m.api.buildEmptyBook()); return String(m.api.beautifyText(s)); }; /* the tidier reads the book's language for its quote marks */
  }, 180_000);

  it.each(['preview', 'epub', 'markdown', 'word'])('%s: the line, the note and the quotation are set as stored, with no curly quote, dash or ellipsis the book does not hold', (surface) => {
    const said = surfaces(CONTENT)[surface]!;
    expect(said, surface).toContain(LINE);
    expect(said, surface).toContain(NOTE);
    expect(said, surface).toContain('"To be" -- or not...');
    expect(said, surface + ': the attribution\'s dash as the writer typed it').toContain('-- The Clerk');
    expect(said.match(/[“”‘’—–…]/g) || [], surface + ': characters the book does not hold').toEqual([]);
  }, 120_000);

  it.each(['preview', 'epub', 'markdown', 'word'])('%s: after Auto-Format the same text is set tidied, because the book now stores it so', (surface) => {
    const polished = polish(CONTENT);
    expect(polished).toContain(POLISHED);
    const said = surfaces(polished)[surface]!;
    expect(said, surface).toContain(POLISHED);
    expect(said, surface).toContain(NOTE_POLISHED);
    expect(said, surface).toContain('— The Clerk');
    expect(said, surface).not.toContain('--');
    expect(said, surface).not.toContain('...');
  }, 120_000);

  it('Auto-Format does everything it did: quotes, apostrophes, dashes, the ellipsis, a range of numbers, and a code or a date left alone', () => {
    expect(polish(LINE)).toBe(POLISHED);
    expect(polish('code VIE-04-10 on 2026-11-21, ISBN 978-0-9984120-7-4')).toBe('code VIE-04-10 on 2026-11-21, ISBN 978-0-9984120-7-4');
    expect(polish('He said "no"\n\n---\n\n[^1]: a note\n[^2]: another')).toBe('He said “no”\n\n***\n\n[^1]: a note\n\n[^2]: another');
  });

  it('what a surface needs to read the book is still read: a typed break is a scene break, a note is a note', () => {
    const m = make(env());
    m.api.applyBookDoc(m.api.buildEmptyBook());
    expect(m.api.sceneBreakCount('One.\n\n---\n\nTwo.\n\n#\n\nThree.\n\n***\n\nFour.')).toBe(3);
    const said = surfaces(CONTENT);
    expect(said.preview).not.toContain('***');
    expect(said.preview).not.toContain('[^1]');
  }, 120_000);

  it('Beuk\'s own sample book is stored already tidied (its text was typed with straight quotes and leaned on every surface to tidy it): the tidier finds nothing left to change in it', () => {
    const m = make(env());
    m.api.applyBookDoc(m.api.buildEmptyBook());
    const secs = (m.api as unknown as { SAMPLE_SECTIONS: { type: string; content: string }[] }).SAMPLE_SECTIONS;
    expect(secs.length).toBe(32);
    /* the one image marker that carries a caption keeps its two straight quotes: they are Beuk's markup around the
       caption, not prose, so each block is read here without its markers */
    const MARKER = /!\[[^\]\n]*\]\(img:[^)\n]*\)/g;
    expect((secs.map((s) => s.content).join('\n').match(MARKER) || []).filter((x) => x.indexOf('"') !== -1).length).toBe(1);
    const blocksOf = (c: string) => c.split(/\n\s*\n/).map((b) => b.replace(MARKER, '').trim()).filter(Boolean);
    const all = secs.flatMap((s) => blocksOf(s.content)).join('\n');
    expect({ straightDouble: (all.match(/"/g) || []).length, straightSingle: (all.match(/'/g) || []).length, twoHyphens: (all.match(/--/g) || []).length, threeDots: (all.match(/\.\.\./g) || []).length })
      .toEqual({ straightDouble: 0, straightSingle: 0, twoHyphens: 0, threeDots: 0 });
    expect((all.match(/[“”]/g) || []).length).toBe(522);
    /* the tidier, run over a whole section, changes nothing but that one marker's two quotes */
    for (const s of secs) if (s.content) expect(String(m.api.beautifyText(s.content)).replace(MARKER, ''), s.type).toBe(s.content.replace(MARKER, ''));
    /* and each section is set exactly as its fully tidied text is set, which is what every surface made of it before:
       the sample reads as it always did */
    for (const s of secs) if (s.content) {
      const sec = { ...s, id: 'sample-' + s.type } as Rec;
      expect(String(m.api.contentBlocksToHtml(s.content, sec, false, true)), s.type).toBe(String(m.api.contentBlocksToHtml(String(m.api.beautifyText(s.content)), sec, false, true)));
    }
  }, 120_000);
});
