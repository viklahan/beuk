import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { exportBook, importBook, sectionAt } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import ar from '../src/generated/packs/ar.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/print-markup.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { loadClosure, setClosureLang, setClosureT, stateFromBook, type Closure } from '../src/closure/index';
import { EditorMeta } from '../src/editor/EditorMeta';
import { arriveForExport } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { loadPreview, type PreviewClosure } from '../src/preview/preview';
import { loadPrint, type PrintClosure } from '../src/print/print';
import { ToastProvider } from '../src/shell/Toasts';
import { installCanvas } from './print-fixture';

/* Task 3 of "Beuk 2.0 becomes the studio": 1.0's chapter heading block, #editorMeta (client/index.html: the markup
   above #insertToolbar; syncEditor shows it; initEditor's chNumber / chTitle / chSubtitle / chRunHead "input"
   listeners and the tglDropCap / tglSmallCaps bindSwitch write it).
   1.0 self-checks re-expressed here:
   - print.runheads.meta: its meta half (the beuk-heads meta names each section's head; openings bare; omit, place and
     none reach the meta), with the chapters' titles typed into the block. Its Print Interior View half (the pages a
     head is drawn on) needs layout: the e2e's.
   - print.headfit: the halves this block owns (the short head replaces the title in the meta; a blank one is dropped;
     the field shows the short head with the title as its hint). The fitting to one line is the print module's (its
     own canvas measure), not this block's.
   - chapter.backdrop.render: its DOM half (the backdrop picker sits in #editorMeta with the plate picker).
   - a11y.metadata is the EPUB package's accessibility metadata (re-expressed in test/export-selfchecks.test.ts); it
     touches none of these ids. The brief's "a11y labels" are checked here as the block's own accessible names: each
     field's <label for>, each switch's aria-label, all 1.0's keys. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const A = ar as Record<string, string>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);

const BOOK = (): Rec => ({
  meta: { title: 'Heading Book', author: 'A. Writer', language: 'en' },
  images: [],
  sections: [
    { id: 's1', kind: 'body', type: 'chapter', number: '1', title: 'The Ferry Crossing', subtitle: '', content: 'Opening words stand here, at the start of the crossing.\n\nA second paragraph follows the first.', smallCaps: false },
    { id: 's2', kind: 'body', type: 'part', number: 'One', title: 'The Harbour', content: '' },
    { id: 's3', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the ferrymen.' },
    { id: 's4', kind: 'back', type: 'acknowledgments', title: 'Acknowledgments', content: 'Thanks to the harbour master.' },
    { id: 's5', kind: 'front', type: 'toc', title: 'Contents', content: '' },
  ],
});
const onDoc = (book: Rec = BOOK()) => {
  const y = new Y.Doc();
  importBook(structuredClone(book), y);
  return y;
};
const sec = (y: Y.Doc, i: number) => (exportBook(y).sections as Rec[])[i]!;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement | null;
/** On the page and not inside anything hidden (1.0's syncEditor hides with style.display). */
function shown(id: string): boolean {
  let el = document.getElementById(id) as HTMLElement | null;
  if (!el) return false;
  for (; el; el = el.parentElement) if (el.style.display === 'none') return false;
  return true;
}
function mount(y: Y.Doc, i: number, lang = 'en') {
  const section = sectionAt(y, i) as Y.Map<unknown>;
  return render(
    <LocaleProvider initial={lang}>
      <ToastProvider>
        <EditorMeta ydoc={y} section={section} />
      </ToastProvider>
    </LocaleProvider>,
  );
}
const typeIn = (id: string, value: string) =>
  act(() => {
    fireEvent.change($(id)!, { target: { value } });
  });
const press = (id: string) =>
  act(() => {
    fireEvent.click($(id)!);
  });
const FIELDS = ['chNumber', 'chTitle', 'chSubtitle', 'chRunHead'];
const SWITCHES = ['tglDropCap', 'tglSmallCaps'];

beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

describe("#editorMeta shows what 1.0's syncEditor shows", () => {
  it('a chapter: number, title, subtitle, running head, both switches and the art rows (the backdrop beside the plate)', async () => {
    mount(onDoc(), 0);
    await waitFor(() => expect($('chPlate')).not.toBeNull(), { timeout: 20_000 });
    for (const id of [...FIELDS, ...SWITCHES, 'chPlate', 'chBackdrop']) expect(shown(id), id).toBe(true);
    // chapter.backdrop.render, its DOM half
    expect($('chBackdrop')!.closest('#editorMeta')).toBe($('chPlate')!.closest('#editorMeta'));
    expect($('chPlate')!.closest('#bodyArtRows')).not.toBeNull();
    // 1.0's order: the four fields, then the switches, then the art rows
    const order = [...FIELDS, ...SWITCHES, 'chPlate'].map((id) => $(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, order[i]!.id).toBeTruthy();
  });

  it('a Part: number, title, subtitle and running head; no switches, no art rows', async () => {
    mount(onDoc(), 1);
    for (const id of FIELDS) expect(shown(id), id).toBe(true);
    for (const id of [...SWITCHES, 'chPlate', 'chBackdrop', 'bodyArtRows']) expect(shown(id), id).toBe(false);
    expect($('chNumber')!.value).toBe('One');
    expect($('chTitle')!.value).toBe('The Harbour');
  });

  it('front and back matter: the block is hidden (it stays on the page for the Zen fold to name)', () => {
    for (const i of [2, 3, 4]) {
      mount(onDoc(), i);
      expect(document.getElementById('editorMeta'), String(i)).not.toBeNull();
      expect(shown('editorMeta')).toBe(false);
      for (const id of [...FIELDS, ...SWITCHES]) expect(shown(id), `${i} ${id}`).toBe(false);
      cleanup();
    }
  });
});

describe("each field writes 1.0's section field", () => {
  it('number, title, subtitle as typed; the running head only when it has a letter; the switches toggle what they show', async () => {
    const y = onDoc();
    mount(y, 0);
    expect([$('chNumber')!.value, $('chTitle')!.value, $('chSubtitle')!.value, $('chRunHead')!.value]).toEqual(['1', 'The Ferry Crossing', '', '']);
    typeIn('chNumber', 'Seven');
    typeIn('chTitle', 'The Long Ferry');
    typeIn('chSubtitle', 'In which the tide turns');
    expect([sec(y, 0).number, sec(y, 0).title, sec(y, 0).subtitle]).toEqual(['Seven', 'The Long Ferry', 'In which the tide turns']);
    expect($('chTitle')!.value).toBe('The Long Ferry');
    // print.headfit (editor half): the short head, the title as its hint; a blank one is no head
    expect($('chRunHead')!.placeholder).toBe('The Long Ferry');
    expect($('chRunHead')!.maxLength).toBe(120);
    typeIn('chRunHead', 'The Ferry');
    expect(sec(y, 0).runHead).toBe('The Ferry');
    expect($('chRunHead')!.value).toBe('The Ferry');
    typeIn('chRunHead', '   ');
    expect('runHead' in sec(y, 0)).toBe(false);
    expect($('chRunHead')!.value).toBe('   '); // 1.0's field keeps what was typed
    typeIn('chRunHead', '');
    expect('runHead' in sec(y, 0)).toBe(false);
    // the switches: the book's dropCap (true by default) and smallCaps (false here)
    expect($('tglDropCap')!.getAttribute('aria-pressed')).toBe('true');
    expect($('tglSmallCaps')!.getAttribute('aria-pressed')).toBe('false');
    press('tglDropCap');
    press('tglSmallCaps');
    expect([sec(y, 0).dropCap, sec(y, 0).smallCaps]).toEqual([false, true]);
    expect($('tglDropCap')!.getAttribute('aria-pressed')).toBe('false');
    expect($('tglSmallCaps')!.getAttribute('aria-pressed')).toBe('true');
    press('tglDropCap');
    expect(sec(y, 0).dropCap).toBe(true);
  });

  it('a change made elsewhere (another tab, an undo) shows in the fields', () => {
    const y = onDoc();
    mount(y, 0);
    act(() => {
      (sectionAt(y, 0) as Y.Map<unknown>).set('title', 'From Elsewhere');
    });
    expect($('chTitle')!.value).toBe('From Elsewhere');
    expect($('chRunHead')!.placeholder).toBe('From Elsewhere');
  });
});

describe('the block names itself (its labels, 1.0’s keys)', () => {
  it('each field has its <label for>, each switch its aria-label, the placeholders 1.0’s', () => {
    mount(onDoc(), 0);
    const labels: Record<string, string> = { chNumber: 'editor.chapterNumber', chTitle: 'editor.chapterTitle', chSubtitle: 'editor.chapterSubtitle', chRunHead: 'editor.runHead' };
    for (const [id, key] of Object.entries(labels)) {
      const lab = document.querySelector(`label[for="${id}"]`);
      expect(lab, id).not.toBeNull();
      expect(lab!.className).toBe('field-lab');
      expect(lab!.textContent).toBe(E[key]);
    }
    expect($('chNumber')!.placeholder).toBe(E['editor.chNumberPh']);
    expect($('chTitle')!.placeholder).toBe(E['editor.chTitlePh']);
    expect($('chSubtitle')!.placeholder).toBe(E['editor.chSubtitlePh']);
    expect($('tglDropCap')!.getAttribute('aria-label')).toBe(E['editor.dropCapAria']);
    expect($('tglSmallCaps')!.getAttribute('aria-label')).toBe(E['editor.smallCapsAria']);
    expect($('tglDropCap')!.className).toBe('switch');
    const rows = [...document.querySelectorAll('#bodyArtRows .switch-row .sw-txt')].slice(0, 2).map((x) => [x.querySelector('b')!.textContent, x.querySelector('span')!.textContent]);
    expect(rows).toEqual([
      [E['editor.dropCap'], E['editor.dropCapDesc']],
      [E['editor.smallCaps'], E['editor.smallCapsDesc']],
    ]);
  });
});

describe('under ar, the block mirrors', () => {
  it('it takes the page’s right-to-left direction (no direction of its own) and speaks Arabic', async () => {
    await loadPack('ar');
    mount(onDoc(), 0, 'ar');
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('rtl'));
    const block = document.getElementById('editorMeta')!;
    expect(block.closest('[dir]')).toBe(document.documentElement);
    expect(block.querySelectorAll('[dir]').length).toBe(0);
    expect(document.querySelector('label[for="chTitle"]')!.textContent).toBe(A['editor.chapterTitle']);
    expect($('tglDropCap')!.getAttribute('aria-label')).toBe(A['editor.dropCapAria']);
    expect($('chTitle')!.placeholder).toBe(A['editor.chTitlePh']);
  });
});

describe('the sidebar follows the title (through the whole studio)', () => {
  beforeAll(() => {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect as DOMRect;
    Element.prototype.scrollIntoView = () => undefined;
    document.elementFromPoint = () => null;
  });
  const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });

  it('typing the number and title renames the outline row (1.0’s renderSidebar rule); the running head’s hint follows', async () => {
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
    await act(async () => {
      fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(BOOK())] } });
    });
    await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
    await act(async () => {
      fireEvent.click(document.querySelector('#structureList .sec-item[data-index="0"]')!);
    });
    await waitFor(() => expect(document.querySelector('#manuscript[data-section="0"] .ms-editor')).not.toBeNull());
    const name = () => document.querySelector('#structureList .sec-item[data-index="0"] .sec-name')!.textContent;
    expect(name()).toBe(E['side.chapterAbbr'] + ' 1 — The Ferry Crossing');
    typeIn('chTitle', 'The Long Ferry');
    await waitFor(() => expect(name()).toBe(E['side.chapterAbbr'] + ' 1 — The Long Ferry'));
    typeIn('chNumber', '7');
    await waitFor(() => expect(name()).toBe(E['side.chapterAbbr'] + ' 7 — The Long Ferry'));
    expect($('chRunHead')!.placeholder).toBe('The Long Ferry');
    typeIn('chTitle', '');
    await waitFor(() => expect(name()).toBe(E['side.chapterAbbr'] + ' 7 — ' + E['side.untitled']));
    // the field stayed mounted through it all (one TipTap editor, the same section)
    expect(document.querySelector('#manuscript[data-section="0"] .ms-editor')).not.toBeNull();
  });
});

describe("the block reaches 1.0's own render functions", () => {
  let c: Closure;
  let pv: PreviewClosure;
  let pc: PrintClosure;
  beforeAll(async () => {
    c = await loadClosure();
    pv = await loadPreview();
    pc = await loadPrint();
    setClosureT(t);
    setClosureLang('en');
    installCanvas();
    document.body.insertAdjacentHTML('beforeend', markup.view + markup.measure);
  });

  /** 1.0's preview state of the book as it stands, in the preview module (as test/preview-safe.test.ts reads it). */
  const previewOf = (y: Y.Doc) => {
    const st = stateFromBook(c, exportBook(y)) as unknown as Rec & { sections: Rec[] };
    pv.setState(st);
    return (i: number) => String(pv.api.sectionHtml(st.sections[i]));
  };

  it('the drop cap and small-caps switches: the preview’s chapter opening (contentBlocksToHtml) and its stylesheet (buildBookCss)', () => {
    const y = onDoc();
    mount(y, 0);
    let html = previewOf(y)(0);
    expect(html).toContain('<p class="first has-dropcap">');
    expect(html).toContain('<span class="dropcap">');
    expect(html).not.toContain('class="leadin"');
    press('tglSmallCaps');
    html = previewOf(y)(0);
    expect(html).toContain('<span class="leadin">');
    expect(html).toContain('has-dropcap');
    press('tglDropCap');
    html = previewOf(y)(0);
    expect(html).not.toContain('has-dropcap');
    expect(html).not.toContain('class="dropcap"');
    expect(html).toContain('<p class="first"><span class="leadin">');
    const css = String(pv.api.buildBookCss('.fc-page'));
    expect(css).toContain('.fc-page .dropcap {');
    expect(css).toContain('.fc-page .leadin {');
  });

  it('the number, title and subtitle: the preview’s chapter opening and the contents page', () => {
    const y = onDoc();
    mount(y, 0);
    typeIn('chNumber', '7');
    typeIn('chTitle', 'The Long Ferry');
    typeIn('chSubtitle', 'In which the tide turns');
    const html = previewOf(y);
    const opening = html(0);
    expect(opening).toContain('<p class="chapter-number">Chapter 7</p>');
    expect(opening).toContain('<h1 class="chapter-title">The Long Ferry</h1>');
    expect(opening).toContain('<p class="chapter-subtitle">In which the tide turns</p>');
    const toc = html(4);
    expect(toc).toContain('The Long Ferry');
    expect(toc).not.toContain('The Ferry Crossing');
  });

  it('print.runheads.meta (its meta half) and print.headfit (the short head): the titles and heads typed here are the print file’s beuk-heads', () => {
    const para = 'The tide came in over the mud flats and the gulls rose all at once, crying over the harbour while the ferry sounded its horn twice for the far shore.';
    const y = onDoc({
      meta: { title: 'Head Fixture', author: 'Fixture Author', language: 'en' },
      images: [],
      sections: [
        { id: 'tp', kind: 'front', type: 'titlepage', title: 'Title Page', content: '' },
        { id: 'fw', kind: 'front', type: 'foreword', title: 'Foreword', content: para },
        { id: 'ch1', kind: 'body', type: 'chapter', number: '1', title: 'Draft One', content: para },
        { id: 'ch2', kind: 'body', type: 'chapter', number: '2', title: 'Draft Two', content: para },
        { id: 'ack', kind: 'back', type: 'acknowledgments', title: 'Acknowledgments', content: para },
      ],
    });
    mount(y, 2);
    typeIn('chTitle', 'The Crossing');
    cleanup();
    mount(y, 3);
    typeIn('chTitle', 'The Return');

    type Cfg = { box: string; style: string; omitOpenings: boolean; omitBlank: boolean; heads: Record<string, string> };
    const a = pc.api as unknown as { printHeadsConfig: () => Cfg | null; buildPrintCss: (id: string, recto: boolean) => string };
    const printOn = () => {
      const book = exportBook(y);
      const st = arriveForExport(c, structuredClone(book)) as unknown as Rec & { meta: Rec };
      exportSafe(c, st as never, book);
      Object.assign(st, { printTrim: '6x9', printRecto: true, printMarginMode: 'auto', printHeadContent: 'chapter', printHeadPlace: 'top', printFolio: 'centre', printOmitChapterHead: true, printOmitBlankHead: true });
      pc.setState(st);
      return st;
    };
    /** The print file's beuk-heads meta, read as the renderer reads it (deploy/renderer/heads.mjs): one JSON value. */
    const metaOf = (): Cfg | null => {
      const doc = new DOMParser().parseFromString(String(pc.vars.buildPrintHtml()), 'text/html');
      const m = doc.querySelector('meta[name="beuk-heads"]');
      return m ? (JSON.parse(m.getAttribute('content') || 'null') as Cfg) : null;
    };

    const st = printOn();
    const cfg = a.printHeadsConfig();
    expect(cfg).not.toBeNull();
    expect([cfg!.box, cfg!.omitOpenings, cfg!.omitBlank]).toEqual(['top-center', true, true]);
    expect(a.buildPrintCss('6x9', true)).toContain('string(chapterTitle); ' + cfg!.style);
    // front matter carries none before the first chapter; back matter carries its own (BEUK:headfit)
    const want = { 'ps-0': '', 'ps-1': '', 'ps-2': 'The Crossing', 'ps-3': 'The Return', 'ps-4': 'Acknowledgments' };
    expect(cfg!.heads).toEqual(want);
    expect(metaOf()).toEqual(cfg);
    st.printOmitChapterHead = false;
    expect(metaOf()!.omitOpenings).toBe(false);
    st.printHeadPlace = 'bottom';
    expect(metaOf()!.box).toBe('bottom-center');
    st.printHeadContent = 'none';
    expect(a.printHeadsConfig()).toBeNull();
    expect(metaOf()).toBeNull();

    // print.headfit: the short head typed here replaces the title in the head; a blank one gives the title back
    typeIn('chRunHead', 'The Ferry');
    printOn();
    expect(a.printHeadsConfig()!.heads['ps-3']).toBe('The Ferry');
    expect(metaOf()!.heads['ps-3']).toBe('The Ferry');
    typeIn('chRunHead', '  ');
    printOn();
    expect(a.printHeadsConfig()!.heads['ps-3']).toBe('The Return');
  });
});

describe('1.0 bug (fixed in client/index.html): the drop cap and small-caps switches mark the book edited', () => {
  it('both bindSwitch handlers call noteBookEdited(), as every other chapter control does (the plate, the backdrop, the fields’ input)', () => {
    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
    for (const id of SWITCHES) {
      const line = html.split('\n').find((l) => l.includes(`bindSwitch($("${id}")`));
      expect(line, id).toBeDefined();
      expect(line, id).toMatch(/noteBookEdited\(\)/);
    }
  });
});
