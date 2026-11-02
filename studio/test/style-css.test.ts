// @vitest-environment node
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import { extractEpubSource } from '../../src/book/epub/closure';
import { epubState } from '../../src/book/epub/state';
import { readBook } from '../../src/book/read';
import { CLOSURE_NAMES } from '../src/generated/closure.js';
import { bookState, loadClosure, type Closure } from '../src/closure/index';
import { fixtures } from './fixtures';
import { studioHtml } from './one-source';
import { styledBook } from './style-fixture';

/* Wave 4a, task 1 — review focus #2 (constraint 31): the book's CSS is 1.0's code. buildBookCss, run through the
   browser closure on every fixture's own theme, on every one of 1.0's presets, on every custom theme a book carries,
   on a header design set in uploaded and display faces, a flourish ornament and heading flourish, and on book colours
   (accent, tint, print in black ink), equals the SERVER closure's output (the EPUB build's lifted code, string tables
   and all, in a vm context as src/book/epub/worker.ts builds it), byte for byte, for the preview's scope, the EPUB's
   (no scope), zen's and print's. Plus the closure facts wave 4a leans on: HEAD_FONTS carries the display faces where
   1.0 pushes them (TEXT_HEAD_FONTS before, ALL_LIBRARY_FONTS after). */

type Rec = Record<string, unknown>;
type Server = { buildBookCss: (scope: string) => string; state: () => Rec; set: (json: string) => void };
let serverCode: string | null = null;
function serverFor(book: Rec): Server {
  serverCode ??=
    extractEpubSource(studioHtml()).code +
    '\n;globalThis.__parity = { buildBookCss, state: () => state, set: (j) => { const o = JSON.parse(j); for (const k of Object.keys(o)) state[k] = o[k]; } };';
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

const SCOPES = ['.fc-page', '', '.zen-book', '.print-flow'];

describe('wave 4a: the theme CSS is 1.0\'s (constraint 31, review focus #2)', () => {
  it('HEAD_FONTS carries the display faces where 1.0 pushes them; the cover list and the creator list follow 1.0', async () => {
    const c = await loadClosure();
    const a = c.api;
    const disp = a.DISPLAY_FONTS.map((d) => d.family);
    expect(disp).toEqual(['Pinyon Script', 'Patrick Hand', 'Abril Fatface']);
    expect(a.HEAD_FONTS.slice(-3)).toEqual(disp);
    expect(a.TEXT_HEAD_FONTS.some((f) => disp.includes(f))).toBe(false); // taken before the push (1.0: the cover's list)
    for (const f of disp) expect(a.ALL_LIBRARY_FONTS).toContain(f); // taken after it (1.0: the creator's list)
    expect(a.PRESETS.length).toBe(15);
    expect(CLOSURE_NAMES).toEqual(expect.arrayContaining(['initStudio', 'renderStudio', 'saveThemeCreator', 'handleFontFile', 'handleFlourishFile', 'setBookColour']));
  });

  const books = [...fixtures('all').filter((f) => readBook(f.book).status === 'ok').map((f) => ({ name: f.name, book: f.book })), { name: 'styled (uploaded font, flourish, custom themes, colour)', book: styledBook() }];
  it(`buildBookCss equals the server closure's on every fixture × every preset, custom theme and colour (${books.length} books)`, async () => {
    const c: Closure = await loadClosure();
    let compared = 0;
    for (const f of books) {
      const server = serverFor(f.book);
      const ydoc = new Y.Doc();
      importBook(f.book, ydoc);
      c.setState(null as never);
      const { state } = bookState(c, ydoc);
      c.setState(state);
      const st = state as unknown as Rec;
      const own = JSON.stringify({ theme: st.theme, bookColour: st.bookColour ?? null });
      const custom = Array.isArray(f.book.customThemes) ? (f.book.customThemes as Rec[]).map((ct) => (c.api.normalizeCustomTheme(ct) as Rec).theme) : [];
      const variants: { what: string; patch: Rec }[] = [
        { what: 'own theme', patch: {} },
        ...c.api.PRESETS.map((p) => ({ what: 'preset ' + p.id, patch: { theme: Object.assign({}, p.theme) } })),
        ...custom.map((th, i) => ({ what: 'custom theme ' + i, patch: { theme: th } })),
        { what: 'accent', patch: { bookColour: { accent: '#7a1f2b', tint: '' } } },
        { what: 'accent + tint + print black', patch: { bookColour: { accent: '#1f62a8', tint: '#fbf5e6', printBlack: true } } },
        { what: 'display head + header design', patch: { theme: Object.assign({}, c.api.PRESETS[2]!.theme, { headFont: 'Pinyon Script', header: c.api.defaultHeaderDesign(Object.assign({}, c.api.PRESETS[2]!.theme, { headFont: 'Pinyon Script' })) }), bookColour: null } },
      ];
      for (const v of variants) {
        const base = JSON.parse(own) as Rec;
        const next = { ...base, ...JSON.parse(JSON.stringify(v.patch)) } as Rec;
        if (next.bookColour === null) next.bookColour = undefined;
        Object.assign(st, JSON.parse(JSON.stringify(next)));
        if (next.bookColour === undefined) st.bookColour = undefined;
        server.set(JSON.stringify(next));
        if (next.bookColour === undefined) server.state().bookColour = undefined;
        for (const sc of SCOPES) {
          expect(c.api.buildBookCss(sc), `${f.name} · ${v.what} · buildBookCss(${JSON.stringify(sc)})`).toBe(server.buildBookCss(sc));
          compared++;
        }
      }
      ydoc.destroy();
    }
    expect(compared).toBeGreaterThan(books.length * 19 * SCOPES.length - 1);
  }, 240_000);
});
