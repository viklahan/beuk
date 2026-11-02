// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import { EPUB_CLOSURE, EPUB_ROOTS, EPUB_SUPPLIED, extractEpubSource } from '../../src/book/epub/closure';
import { epubState } from '../../src/book/epub/state';
import { readBook } from '../../src/book/read';
// @ts-expect-error — a plain .mjs build script, no types
import { buildClosureModule, EXTRA_ROOTS } from '../scripts/extract-closure.mjs';
import { CLOSURE_NAMES, CLOSURE_ROOTS, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { SAMPLE_NAMES } from '../src/generated/closure-sample.js';
import { bookState, loadClosure, type Closure } from '../src/closure/index';
import { fixtures } from './fixtures';
import { studioHtml } from './one-source';

/* Task 2: the browser copy of 1.0's render closure (spec decision 3).
   Review focus #3: countWords and buildBookCss, run through the browser
   module on every fixture, return exactly what the SERVER closure returns
   (the EPUB build's own lifted code, string tables and all, in a vm
   context exactly as src/book/epub/worker.ts builds it). Plus: the module
   breaks loudly. */

const epubSource = () => readFileSync(fileURLToPath(new URL('../../src/book/epub/closure.ts', import.meta.url)), 'utf8');

type Server = { countWords: (t: unknown, l?: unknown) => number; sectionWords: (s: unknown) => number; buildBookCss: (scope: string) => string };
let serverCode: string | null = null;
/** The server's EPUB closure for one book: worker.ts's steps (state parsed inside the context, setUiLang, arrive). */
function serverFor(book: Record<string, unknown>): Server {
  serverCode ??= extractEpubSource(studioHtml()).code + '\n;globalThis.__parity = { countWords, sectionWords, buildBookCss };';
  /* src/book/epub/sandbox.ts makeSandbox's context, less the two shims these functions never call (its DOMParser needs
     @xmldom/xmldom, which the studio does not install; fetch serves fonts to the EPUB build) */
  const ctx = vm.createContext(
    { URL, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout, queueMicrotask, btoa, atob,
      document: { baseURI: 'https://studio.beuk.invalid/', getElementById: () => null }, toast: () => undefined, samplePicsRequire: async () => undefined },
    { name: 'beuk-epub', codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext('var window = globalThis, self = globalThis;', ctx);
  new vm.Script(serverCode).runInContext(ctx);
  const read = readBook(book);
  if (read.status !== 'ok') throw new Error('fixture did not read');
  ctx.__beukStateJson = JSON.stringify(epubState(read.book, String(read.book.exportPlatform ?? 'generic')));
  vm.runInContext('globalThis.state = JSON.parse(globalThis.__beukStateJson); delete globalThis.__beukStateJson;', ctx);
  const api = ctx.__beukEpub as { setUiLang: (l: string) => void; arrive: (s: unknown) => unknown };
  api.setUiLang('en');
  api.arrive(ctx.state);
  return ctx.__parity as Server;
}

describe('the browser closure (spec decision 3)', () => {
  it('lifts the EPUB build\'s roots plus the wave-1a roots, supplies what the EPUB build supplies plus t and UI_STRINGS', () => {
    for (const r of [...EPUB_ROOTS, ...EXTRA_ROOTS]) expect(CLOSURE_ROOTS).toContain(r);
    for (const s of EPUB_SUPPLIED) expect(CLOSURE_SUPPLIED).toContain(s);
    expect(CLOSURE_SUPPLIED).toEqual(expect.arrayContaining(['t', 'UI_STRINGS']));
    // every EPUB declaration except the string machinery the studio supplies itself
    const own = ['t', 'tCountForm', 'UI_STRINGS', 'UI_PLURAL_FORMS', 'uiLangState', 'uiPluralCategory', 'uiPluralRulesCache'];
    /* wave 3a: and 1.0's `$` (1.0: `(id) => document.getElementById(id)`), which the studio supplies itself
       (src/environment/page.ts) — getElementById, except 1.0's #editorArea / #panelContent / #app, which 2.0's page
       does not have as 1.0 does. Supplied, never lifted: */
    const page = ['$'];
    expect(CLOSURE_SUPPLIED).toEqual(expect.arrayContaining(page));
    expect(EPUB_CLOSURE.filter((n) => !own.includes(n) && !page.includes(n) && !CLOSURE_NAMES.includes(n))).toEqual([]);
    expect(CLOSURE_NAMES.filter((n) => own.includes(n) || page.includes(n))).toEqual([]);
  });

  const books = fixtures('real');
  it(`review focus #3: countWords, sectionWords and buildBookCss equal the server closure's on every fixture (${books.length})`, async () => {
    const c: Closure = await loadClosure();
    let words = 0;
    for (const f of books) {
      const server = serverFor(f.book);
      const ydoc = new Y.Doc();
      importBook(f.book, ydoc);
      c.setState(null as never); // nothing left over from the last book: arriving must not lean on a previous state
      const { state } = bookState(c, ydoc);
      c.setState(state);
      const lang = state.meta.language;
      for (const [i, s] of state.sections.entries()) {
        const text = String(s.content ?? '');
        const ours = c.api.countWords(text, lang);
        expect(ours, `${f.name} section ${i} countWords`).toBe(server.countWords(text, lang));
        expect(c.api.sectionWords(s), `${f.name} section ${i} sectionWords`).toBe(server.sectionWords(JSON.parse(JSON.stringify(s))));
        words += ours;
      }
      expect(c.api.buildBookCss('.fc-page'), `${f.name} buildBookCss(.fc-page)`).toBe(server.buildBookCss('.fc-page'));
      expect(c.api.buildBookCss(''), `${f.name} buildBookCss("")`).toBe(server.buildBookCss(''));
      ydoc.destroy();
    }
    expect(words).toBeGreaterThan(100_000); // the gallery is really counted (Dumas alone is far past this)
  }, 240_000);

  it('the module is static code: no eval, no new Function, no string tables (the sample chunk too)', () => {
    for (const file of ['closure.js', 'closure-sample.js']) {
      const code = readFileSync(fileURLToPath(new URL('../src/generated/' + file, import.meta.url)), 'utf8');
      expect(code).not.toMatch(/\beval\s*\(/);
      expect(code).not.toMatch(/new\s+Function\s*\(/);
      expect(code).not.toMatch(/\bUI_STRINGS\s*=\s*\{/);
      expect(code).not.toMatch(/Object\.assign\(UI_STRINGS/);
    }
  });

  it('wave 1c: the sample\'s text is its own chunk — the main module holds no SAMPLE_SECTIONS, the sample module holds it and nothing the main one has', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/generated/closure.js', import.meta.url)), 'utf8');
    const sample = readFileSync(fileURLToPath(new URL('../src/generated/closure-sample.js', import.meta.url)), 'utf8');
    expect(CLOSURE_NAMES).not.toContain('SAMPLE_SECTIONS');
    expect(CLOSURE_NAMES).not.toContain('buildSampleBook');
    expect(main).not.toMatch(/const SAMPLE_SECTIONS\s*=/);
    expect(sample).toMatch(/const SAMPLE_SECTIONS\s*=/);
    expect(SAMPLE_NAMES).toContain('buildSampleBook');
    expect(SAMPLE_NAMES.filter((n) => CLOSURE_NAMES.includes(n))).toEqual([]);
  });
});

describe('the closure extraction breaks loudly', () => {
  it('a renamed root fails, naming it', async () => {
    const html = studioHtml().replace('function countWords(text, langCode) {', 'function countWordz(text, langCode) {');
    await expect(buildClosureModule(html, epubSource())).rejects.toThrow(/countWords/);
  }, 60_000);

  it('lifted code that reaches the interface language machinery fails, naming it', async () => {
    /* wave 3b: uiLangState itself is SUPPLIED (read live: 1.0's Covenant and Names on stage caches key on it), never
       lifted; the plural machinery still may not be reached */
    expect(CLOSURE_SUPPLIED).toContain('uiLangState');
    expect(CLOSURE_NAMES).not.toContain('uiLangState');
    const html = studioHtml().replace('function rightsYear(m) { return', 'function rightsYear(m) { void uiPluralCategory; return');
    await expect(buildClosureModule(html, epubSource())).rejects.toThrow(/uiPluralCategory/);
  }, 60_000);

  it('a lifted function that reads UI_STRINGS (other than imIsPlaceholderTitle) fails, naming it', async () => {
    const html = studioHtml().replace('function rightsYear(m) { return', 'function rightsYear(m) { void UI_STRINGS.en; return');
    await expect(buildClosureModule(html, epubSource())).rejects.toThrow(/rightsYear/);
  }, 60_000);

  it('an EPUB build without ARRIVE (or its roots) fails, naming it', async () => {
    await expect(buildClosureModule(studioHtml(), epubSource().replace('const ARRIVE =', 'const ARRIVED ='))).rejects.toThrow(/ARRIVE/);
    await expect(buildClosureModule(studioHtml(), epubSource().replace('export const EPUB_ROOTS', 'export const EPUB_ROOTZ'))).rejects.toThrow(/EPUB_ROOTS/);
  }, 60_000);
});
