import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, loadSerialize } from '../src/export/state';
import { loadPrint, printRun, printSinks, type PrintClosure } from '../src/print/print';
import { cleanPrintDoc, printSafety } from '../src/print/safe';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';
import { hostileExportBook, hostileNonStringBook } from './export-fixture';
import { hazards } from './hazards';
import { CSS_AUTHOR, CSS_COMMENT_TITLE, CSS_COMMENT_TITLE_SQ, CSS_TITLE, cssAsBrowser, cssOutsideStrings, installCanvas, styleText } from './print-fixture';

/* Wave 5b, task 1 — constraint 59 (review focus #3): safety, print's turn. The print document (1.0's buildPrintHtml)
   is a file the writer opens and the print frame's srcdoc. A hostile book (test/export-fixture.ts: 5a's) through it:
   with the export's corrections in the state and print's sinks (src/print/print.ts, safe.ts), no script, handler or
   remote request (parsed text/html and walked: test/hazards.ts), every trim and the toggles that change the document;
   1.0's own build of the same book is the reproducing fixture of the 1.0 finding. An honest book's document passes
   the sinks unchanged, byte for byte. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let pc: PrintClosure;
beforeAll(async () => {
  c = await loadClosure();
  await loadSerialize();
  pc = await loadPrint();
  installCanvas();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
  printSinks.on = true;
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  exportReset();
  return y;
};
const TOGGLES: ((st: Rec) => void)[] = [
  () => undefined,
  (st) => (st.printLargePrint = true),
  (st) => ((st.printPictureBook = true), (st.printLargePrint = false)),
  (st) => (st.printBleed = true),
  (st) => (st.printNotes = 'page'),
  (st) => ((st.printHeadContent = 'chapter'), (st.printHeadPlace = 'bottom'), (st.printFolio = 'outer')),
  (st) => ((st.printMarginMode = 'custom'), (st.printOmitChapterHead = true), (st.printOmitBlankHead = false), (st.printRecto = false)),
];
/** buildPrintHtml on print's state of the open book, after `fn` (a copy of the state: the book is not written). */
const build = (fn: (st: Rec) => void, trim?: string): string =>
  printRun((p) => {
    const st = p.getState() as Rec;
    const keep = structuredClone(Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('print'))));
    fn(st);
    if (trim) st.printTrim = trim;
    try {
      return String(p.vars.buildPrintHtml());
    } finally {
      Object.assign(st, keep);
    }
  })!;

describe("wave 5b: the print document is safe (constraint 59)", () => {
  it('a hostile book: no script, handler or remote request in its print document — every trim, every toggle', () => {
    for (const b of [hostileExportBook(), hostileNonStringBook()]) {
      const y = onDesk(b);
      const trims = (pc.api.TRIM_SIZES as unknown as { id: string }[]).map((x) => x.id);
      for (const trim of trims) expect(hazards(build(() => undefined, trim), trim)).toEqual([]);
      for (const [i, fn] of TOGGLES.entries()) expect(hazards(build(fn), 'toggle ' + i)).toEqual([]);
      y.destroy();
    }
  }, 240_000);

  it("1.0's own build of the hostile book (no corrections, no sinks) carries them: the 1.0 finding's fixture", () => {
    const y = onDesk(hostileExportBook());
    printSinks.on = false;
    const st = arriveForExport(c, exportBook(y) as Rec);
    pc.setState(st);
    const raw = String(pc.vars.buildPrintHtml());
    const found = hazards(raw, 'print');
    expect(found.length).toBeGreaterThan(0);
    // and the document sink alone takes them out
    expect(hazards(cleanPrintDoc(raw), 'cleaned')).toEqual([]);
    y.destroy();
  });

  /* Review (Critical 1): words in the book that read like CSS or script names, inside the stylesheet's strings (the
     running head is the title and author as a CSS string) or in an attribute that is not an address, are the book's
     words: the document is handed on as 1.0 built it. */
  it('an honest title and author that read like CSS ("Behavior:", "JavaScript:", "@import") and a picture described "JavaScript: …" pass unchanged', () => {
    const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { meta: Rec };
    b.meta.title = 'Animal Behavior: JavaScript @import expression(s) -moz-binding';
    b.meta.author = 'VBScript: A. Writer';
    const y = onDesk(b);
    printSinks.on = false;
    const raw = build(() => undefined);
    printSinks.on = true;
    expect(raw).toContain('Animal Behavior: JavaScript @import');
    expect(cleanPrintDoc(raw) === raw).toBe(true);
    const alt = '<!DOCTYPE html>\n<html><head><style>p { color: #000; }</style></head><body><p><img src="data:image/png;base64,AAAA" alt="JavaScript: The Good Parts" title="vbscript: notes"></p></body></html>';
    expect(cleanPrintDoc(alt)).toBe(alt);
    y.destroy();
  });

  /* The coordinator's note (an automated review of the scheme check, which ran on address attributes only): each of
     these in a print document, by itself and as a book's words through 1.0's build — no element, attribute or value
     with a javascript: scheme survives. */
  const JS_CASES: [string, string][] = [
    ['svg animate values', '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>'],
    ['svg set to', '<svg><a><set attributeName="href" to="javascript:alert(2)"/><text>x</text></a></svg>'],
    ['xlink:href with a tab', '<svg><a xlink:href="java&#x09;script:alert(3)"><text>x</text></a></svg>'],
    ['math href', '<math href="javascript:alert(4)"><mi>x</mi></math>'],
    ['button formaction', '<button formaction="javascript:alert(5)">go</button>'],
    ['a href, mixed case and a space', '<a href=" JaVaScRiPt:alert(6)">x</a>'],
    ['an attribute outside the address list', '<span data-href="javascript:alert(7)" itemid="vbscript:alert(8)">x</span>'],
  ];
  const noScheme = (html: string): string[] => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const out: string[] = [];
    for (const el of Array.from(d.getElementsByTagName('*'))) {
      if (/^(animate|set|animatemotion|animatetransform|script)$/i.test(el.localName)) out.push('<' + el.localName + '>');
      for (const at of Array.from(el.attributes)) if (/^(?:javascript|vbscript):/i.test(at.value.replace(/[\u0000- ]/g, ''))) out.push(el.localName + ' ' + at.name);
    }
    return out;
  };
  it('a javascript: scheme in any element, attribute or animation value does not survive the print document', () => {
    for (const [name, frag] of JS_CASES) {
      const doc = '<!DOCTYPE html>\n<html><head><style>p { color: #000; }</style></head><body><section class="print-sec">' + frag + '</section></body></html>';
      expect(noScheme(cleanPrintDoc(doc)), name).toEqual([]);
    }
    // and as a book's words, through 1.0's own build and every wall
    const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { sections: Rec[] };
    const ch = b.sections.find((s) => s.kind === 'body' && s.type === 'chapter')!;
    ch.content = JS_CASES.map((c) => c[1]).join('\n\n') + '\n\n' + String(ch.content);
    const y = onDesk(b);
    const html = build(() => undefined);
    expect(noScheme(html)).toEqual([]);
    expect(hazards(html, 'print')).toEqual([]);
    y.destroy();
  });

  /* Second review (Important 1): a raw newline in the title or author ends 1.0's CSS string (cssStr escapes \ and "
     only); with a quoted url() carrying ')' the stylesheet loaded from another origin and the walk saw nothing. */
  it('a title and an author with a raw newline and a quoted url() carrying ")" cannot load from another origin', () => {
    for (const [title, author] of [[CSS_TITLE, 'A. Writer'], ['A Title', CSS_AUTHOR], [CSS_TITLE, CSS_AUTHOR]]) {
      const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { meta: Rec };
      b.meta.title = title;
      b.meta.author = author;
      const y = onDesk(b);
      printSinks.on = false;
      const raw = build(() => undefined);
      printSinks.on = true;
      expect(cssOutsideStrings(styleText(raw)), '1.0 builds it into its stylesheet, as CSS').toMatch(/evil.example/);
      for (const [name, html] of [['the document', build(() => undefined)], ['the walk alone', cleanPrintDoc(raw)]] as const) expect(cssOutsideStrings(styleText(html)), name).not.toMatch(/evil.example/);
      for (const [name, fn] of TOGGLES.entries()) expect(cssOutsideStrings(styleText(build(fn))), 'toggle ' + name).not.toMatch(/evil.example/);
      y.destroy();
    }
  });

  /* Third review: a comment opener inside the running-head string. Stripping comments before reading strings took the
     newline away with the "comment"; a browser ends the string at the newline, and the rule after it is live. */
  it('a /* inside the title or author does not hide a newline that carries CSS out of the running-head string', () => {
    for (const [title, author] of [[CSS_COMMENT_TITLE, 'A. Writer'], ['A Title', CSS_COMMENT_TITLE], [CSS_COMMENT_TITLE_SQ, CSS_COMMENT_TITLE_SQ]]) {
      const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { meta: Rec };
      b.meta.title = title;
      b.meta.author = author;
      const y = onDesk(b);
      printSinks.on = false;
      const raw = build(() => undefined);
      printSinks.on = true;
      expect(cssAsBrowser(styleText(raw)).bad, '1.0 builds a broken string into its stylesheet').toBeGreaterThan(0);
      for (const [name, html] of [['the document', build(() => undefined)], ['the walk alone', cleanPrintDoc(raw)]] as const) {
        const r = cssAsBrowser(styleText(html));
        expect(r.bad, name + ': broken strings').toBe(0);
        expect(r.live, name).not.toMatch(/evil.example/);
      }
      y.destroy();
    }
  });

  /* Review (Important 2): CSS that loads from elsewhere without url() — image-set() with a bare string. */
  it('image-set() and -webkit-image-set() of another origin are taken out of the stylesheet and of a style attribute', () => {
    const doc = '<!DOCTYPE html>\n<html><head><style>body { background-image: image-set("https://evil.example/a.png" 1x); } p { background: -webkit-image-set(\'//evil.example/b.png\' 1x); }</style></head><body><p style="background-image: image-set(&quot;https://evil.example/c.png&quot; 1x)">x</p></body></html>';
    const out = cleanPrintDoc(doc);
    expect(out).not.toMatch(/evil\.example/);
    // a picture's own bytes stay
    const own = '<!DOCTYPE html>\n<html><head><style>body { background-image: image-set("data:image/png;base64,AAAA" 1x); }</style></head><body></body></html>';
    expect(cleanPrintDoc(own)).toBe(own);
  });

  it("an honest book's print document passes the sinks unchanged, byte for byte (every fixture, every trim, every toggle)", () => {
    const before = printSafety.cleaned;
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const y = onDesk(structuredClone(f.book));
      const big = /dartagnan|valois|oz-14/.test(f.name);
      const trims = big ? ['6x9'] : (pc.api.TRIM_SIZES as unknown as { id: string }[]).map((x) => x.id);
      const runs: [string, (st: Rec) => void, string | undefined][] = [...trims.map((tr) => [tr, () => undefined, tr] as [string, (st: Rec) => void, string]), ...(big ? TOGGLES.slice(0, 2) : TOGGLES).map((fn, i) => ['toggle ' + i, fn, undefined] as [string, (st: Rec) => void, undefined])];
      for (const [name, fn, trim] of runs) {
        printSinks.on = false;
        const one = build(fn, trim);
        printSinks.on = true;
        const mine = build(fn, trim);
        expect(mine === one, `${f.name} ${name}`).toBe(true);
      }
      y.destroy();
    }
    expect(printSafety.cleaned).toBe(before);
  }, 600_000);
});
