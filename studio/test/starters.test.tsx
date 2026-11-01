import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { loadClosure, stateFromBook, type Closure } from '../src/closure/index';
import { editorText } from '../src/editor/insert';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/* Wave 2c, task 2: the back-matter starters (inventory B4).
   Review focus #2 — the [[blanks]] text equals 1.0's (starterText, run on
   the book's own state), shown in the book's language; Use writes exactly
   that text; "empty pages left out" follows 1.0's emptyOut (the sidebar
   says Empty until the first words). Every interface language carries
   every starter (1.0's own check: STARTER_TEXT per pack, and the button
   labels starter.k.* in every 2.0 pack, which are 1.0's).
   1.0 self-check re-expressed: starters.picker (its "opened page shows its
   own word count" half needs the editor word bar, not in 2.0 yet).
   Not here: starters.empty-left-out and starters.blanks-flagged are export
   checks (EPUB, print preflight: wave 5); their sidebar half is below. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
async function wipe() {
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
}
afterEach(wipe);

const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
async function openStudio(book: Rec, ui = 'en') {
  render(
    <LocaleProvider initial={ui as 'en'}>
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fireEvent.click(document.getElementById('btnExport')!);
  const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
  vi.restoreAllMocks();
  return out.book;
}
const editor = () => (document.getElementById('manuscript') as HTMLElement & { beukEditor?: Editor }).beukEditor!;
const bar = () => document.getElementById('starterBar')!;
async function open(id: string) {
  await act(async () => {
    fireEvent.click(document.querySelector(`#structureList .sec-item[data-sec="${id}"]`)!);
  });
  await waitFor(() => expect(document.querySelector('#manuscript')?.closest('.desk')).not.toBeNull());
  await waitFor(() => expect(bar()).not.toBeNull());
}
/** 1.0's buildEmptyBook with the self-check's names (starters.picker). */
function ledgerBook(over: Rec = {}): Rec {
  const b = c.api.buildEmptyBook() as unknown as Rec & { meta: Rec };
  Object.assign(b.meta, { author: 'Zoey Suzuki', title: "The Devil's Ledger", series: 'The Carrion', seriesNumber: '2', language: 'en' }, over);
  return b;
}
const secOf = (b: Rec, type: string) => (b.sections as Rec[]).find((s) => s.type === type)!;
/** 1.0's starterText for this book (its own state: meta, theme, language). */
const oracle = (book: Rec, id: string) => {
  c.setState(stateFromBook(c, JSON.parse(JSON.stringify(book))));
  return c.api.starterText(id, c.api.bookLang());
};

describe('starters in every language (review focus #2)', () => {
  it("every interface language's starter texts are 1.0's (STARTER_TEXT carries every key in all 13 packs) and every pack names every starter button", () => {
    const keys = Object.keys(c.api.STARTER_TEXT.en!);
    const order = (meta as { order: string[] }).order;
    expect(order.length).toBe(13);
    for (const l of order) {
      expect(c.api.STARTER_TEXT[l], l).toBeTruthy();
      expect(keys.filter((k) => !c.api.STARTER_TEXT[l]![k]), l).toEqual([]);
    }
    const packs = path.join(import.meta.dirname, '..', 'src', 'generated', 'packs');
    const ids = Object.values(c.api.STARTERS_FOR).flat();
    for (const f of readdirSync(packs)) {
      const p = JSON.parse(readFileSync(path.join(packs, f), 'utf8')) as Record<string, string>;
      for (const k of ['starter.heading', 'starter.hint', 'starter.use', 'starter.cancel', 'starter.emptyOut', 'starter.blanks', 'starter.next', ...ids.map((i) => 'starter.k.' + i)]) expect(p[k], f + ' ' + k).toBeTruthy();
    }
  });

  it('a book in each of the 13 languages: the preview shows 1.0\'s text in that language, Use writes it exactly', async () => {
    const order = (meta as { order: string[] }).order;
    for (const lang of order) {
      const book = ledgerBook({ language: lang });
      await openStudio(book);
      await open(secOf(book, 'aboutauthor').id as string);
      await act(async () => {
        fireEvent.click(bar().querySelector('[data-starter="about.third"]')!);
      });
      const want = oracle(book, 'about.third');
      const pv = document.getElementById('starterPreview')!;
      expect(pv.getAttribute('lang')).toBe(lang);
      expect(pv.getAttribute('dir')).toBe(c.api.isRtlLang(lang) ? 'rtl' : 'ltr');
      expect(pv.innerHTML.replace(/<br>/g, '\n').replace(/<\/?mark>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).toBe(want);
      await act(async () => {
        fireEvent.click(document.getElementById('starterUse')!);
      });
      const out = await exported();
      expect(secOf(out, 'aboutauthor').content, lang).toBe(want);
      await wipe();
      resetSidePrefsCache();
    }
  }, 300_000);
});

describe("1.0's starters.picker, re-expressed", () => {
  it('offers, previews without touching the page, Use fills it and selects the first blank, Next goes on, gone once filled; none on a chapter', async () => {
    const book = ledgerBook();
    await openStudio(book);
    const about = secOf(book, 'aboutauthor');
    await open(about.id as string);
    expect(bar().style.display).not.toBe('none');
    expect(bar().textContent).toContain(E['starter.emptyOut']);
    expect(Array.from(bar().querySelectorAll('[data-starter]')).map((b) => b.getAttribute('data-starter'))).toEqual(['about.third', 'about.first']);
    const before = JSON.stringify(await exported());
    await act(async () => {
      fireEvent.click(bar().querySelector('[data-starter="about.third"]')!);
    });
    expect(bar().querySelector('[data-starter="about.third"]')!.getAttribute('aria-pressed')).toBe('true');
    const pv = document.getElementById('starterPreview')!;
    expect(pv.textContent).toMatch(/Zoey Suzuki/);
    expect(pv.textContent).toMatch(/The Devil's Ledger/);
    expect(pv.querySelectorAll('mark').length).toBeGreaterThan(0);
    // nothing on the page until Use (export unchanged by picking); Cancel forgets the pick
    expect(JSON.stringify(await exported())).toBe(before);
    await act(async () => {
      fireEvent.click(document.getElementById('starterCancel')!);
    });
    expect(document.getElementById('starterPreview')).toBeNull();
    await act(async () => {
      fireEvent.click(bar().querySelector('[data-starter="about.third"]')!);
    });
    await act(async () => {
      fireEvent.click(document.getElementById('starterUse')!);
    });
    const content = secOf(await exported(), 'aboutauthor').content as string;
    expect(content).toBe(oracle(book, 'about.third'));
    const blanks = c.api.starterBlanks(content);
    expect(blanks.length).toBe(5);
    let cur = editorText(editor());
    expect(cur.text.slice(cur.start, cur.end)).toBe(blanks[0]);
    await waitFor(() => expect(bar().textContent).toContain(E['starter.blanksPlural']!.replace('{n}', '5').replace('{list}', blanks.join(', '))));
    // Next, from just after the first blank: the second
    const at = content.indexOf(blanks[0]!) + blanks[0]!.length;
    editor().commands.setTextSelection(editor().state.selection.to);
    await act(async () => {
      fireEvent.click(document.getElementById('starterNext')!);
    });
    cur = editorText(editor());
    expect(cur.start).toBeGreaterThanOrEqual(at);
    expect(cur.text.slice(cur.start, cur.end)).toBe(blanks[1]);
    // every blank filled: the strip is gone
    await act(async () => {
      const ed = editor();
      const filled = content.replace(new RegExp(c.api.STARTER_BLANK_RE.source, 'g'), 'filled');
      ed.commands.setContent({ type: 'doc', content: filled.split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await waitFor(() => expect(bar().style.display).toBe('none'));
    // a chapter shows no strip
    await open((book.sections as Rec[]).find((s) => s.kind === 'body')!.id as string);
    expect(bar().style.display).toBe('none');
  }, 120_000);

  it('the series list (this book at its place) is offered only with a series; the colophon names the typefaces; a missing author is a blank', async () => {
    const book = ledgerBook();
    c.setState(stateFromBook(c, JSON.parse(JSON.stringify(book))));
    expect(c.api.starterIds(secOf(book, 'alsoby'))).toEqual(['also.series', 'also.list']);
    expect(oracle(book, 'also.series')).toMatch(/^The Carrion\n\n1\. \[\[[^\]]+\]\]\n2\. The Devil's Ledger\n3\. \[\[/);
    const st = stateFromBook(c, JSON.parse(JSON.stringify(book)));
    expect(oracle(book, 'colo.fonts')).toContain(String((st.theme as Rec).bodyFont));
    expect(oracle(ledgerBook({ author: '' }), 'about.third').indexOf('[[' + c.api.STARTER_TEXT.en!._author + ']]')).toBe(0);
    expect(oracle(ledgerBook({ language: 'fr' }), 'about.third')).toMatch(/écrit/);
    // the strip offers what 1.0 offers: without a series, only the plain list
    await openStudio(ledgerBook({ series: '' }));
    const out = await exported();
    await open(secOf(out, 'alsoby').id as string);
    expect(Array.from(bar().querySelectorAll('[data-starter]')).map((b) => b.getAttribute('data-starter'))).toEqual(['also.list']);
  }, 60_000);

  it('an empty page is left out: the sidebar says Empty; its first words bring it back', async () => {
    const book = ledgerBook();
    await openStudio(book);
    const about = secOf(book, 'aboutauthor').id as string;
    const wc = () => document.getElementById('wc-' + about)?.textContent;
    await waitFor(() => expect(wc()).toBe(E['side.emptyOutShort']), { timeout: 5000 });
    await open(about);
    await act(async () => {
      fireEvent.click(bar().querySelector('[data-starter="about.first"]')!);
    });
    await act(async () => {
      fireEvent.click(document.getElementById('starterUse')!);
    });
    await waitFor(() => expect(wc()).not.toBe(E['side.emptyOutShort']), { timeout: 5000 });
  }, 60_000);
});
