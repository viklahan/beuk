import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, loadClosure, setClosureLang, setClosureT } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { previewStarted } from '../src/preview/preview';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { installCanvas } from './print-fixture';
import { PNG_1PX } from './style-fixture';

/* Wave 5b, task 3 (inventory F2, F9): 1.0's Print Interior View (#modalPrintView: 1.0's initPrintView, its spreads
   paginated by buildPrintViewModel from the very section HTML the print document carries) and the print preflight
   (1.0's runPrintPreflight: its findings and their jumps) in the studio, and 4b's full-screen halves for the two print
   dialogs (fullscreen.controls, fullscreen.fill-window, fullscreen.dialog-close: the preview's own fsInit wires them).
   Browsing the view and running the preflight write nothing (constraint 60); the view's trim, a setting, is written
   as 1.0's, and put back is the book as it was; a preflight jump moves the editor's selection only. jsdom lays no
   columns out (each section is one page here): the view's page counts and spread breaks are the e2e's, beside 1.0's. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
beforeAll(async () => {
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  installCanvas();
  Element.prototype.scrollIntoView = function () {} as never; // jsdom has none (1.0's preflight print jump scrolls)
  // jsdom measures no text: 1.0's notes-at-the-foot layout (pivFootnoteLayout) reads a range's boxes
  Range.prototype.getClientRects = function () {
    return [] as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  };
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
  cloudFacts.available = false;
  cloudFacts.user = null;
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  desk.ydoc = null;
  desk.active = null;
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const LANTERN = () => structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!$(id) && $(id).classList.contains('open');
async function studioWith(doc: Rec) {
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnExport')?.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openExport() {
  await click($('btnExport'));
  await waitFor(() => expect(document.querySelectorAll('#trimGrid [data-trim]').length).toBeGreaterThan(10));
}
async function backup(): Promise<Rec> {
  let last: Blob | null = null;
  const got: Blob[] = [];
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((last = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => void (last && got.push(last))),
  ];
  await click($('btnLocalBackup'));
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await got[0]!.text()) as { book: Rec }).book;
}
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const pressed = (id: string) => $(id).getAttribute('aria-pressed');

describe("1.0's Print Interior View and print preflight in the studio", { timeout: 120_000 }, () => {
  it("the view opens with 1.0's spreads, line, trims, jump list and counter; paging, guides and zoom write nothing", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    await click($('btnOpenSpreads'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    expect(isOpen('modalExport')).toBe(false);
    expect($('pivSub').textContent).toMatch(new RegExp('^' + String((doc.meta as Rec).title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · 6 × 9 in trim · '));
    expect(($('pivTrim') as HTMLSelectElement).options.length).toBe(24);
    expect(($('pivTrim') as HTMLSelectElement).value).toBe('6x9');
    expect(($('pivJump') as HTMLSelectElement).options.length).toBeGreaterThan(3);
    expect($('pivCounter').textContent).toMatch(/^Spread 1 of \d+ · Page 1$/);
    expect(document.querySelectorAll('#pivSpread .piv-page').length).toBe(1);
    await click($('btnPivNext'));
    expect($('pivCounter').textContent).toMatch(/^Spread 2 of \d+ · Pages 2–3$/);
    expect(document.querySelectorAll('#pivSpread .piv-page').length).toBe(2);
    expect(pressed('tglPivGuides')).toBe('true');
    expect(document.querySelectorAll('#pivSpread .piv-guide').length).toBeGreaterThan(0);
    await click($('tglPivGuides'));
    expect(pressed('tglPivGuides')).toBe('false');
    expect(document.querySelectorAll('#pivSpread .piv-guide').length).toBe(0);
    await click($('pivZoomActual'));
    expect($('pivZoomActual').classList.contains('active')).toBe(true);
    await click($('btnPivPrev'));
    expect($('pivCounter').textContent).toMatch(/^Spread 1 of /);
    // the book's words, through the flow sink, in the leaf (no handler, no script)
    expect(document.querySelector('#pivSpread [onerror], #pivSpread [onclick], #pivSpread script')).toBeNull();
    await click($('btnClosePrintView'));
    expect(isOpen('modalPrintView')).toBe(false);
    expect(await backup()).toEqual(want(doc));
  });

  it("the view's trim and recto are 1.0's settings (the export modal follows); put back, the book is as it was", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    await click($('btnOpenSpreads'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    const sel = $('pivTrim') as HTMLSelectElement;
    await act(async () => {
      sel.value = '5x8';
      fireEvent.change(sel);
    });
    expect($('pivSub').textContent).toContain('5 × 8 in trim');
    expect($('trimGrid').querySelector('.active')!.getAttribute('data-trim')).toBe('5x8');
    await click($('tglPivRecto'));
    expect(pressed('tglPivRecto')).toBe('false');
    let out = await backup();
    expect([out.printTrim, out.printRecto]).toEqual(['5x8', false]);
    await click($('tglPivRecto'));
    await act(async () => {
      sel.value = '6x9';
      fireEvent.change(sel);
    });
    out = await backup();
    expect(out).toEqual(want(doc));
  });

  it("full screen for the two print dialogs is the preview's own (fullscreen.controls, fill-window, dialog-close)", async () => {
    await studioWith(LANTERN());
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    await openExport();
    await click($('btnOpenSpreads'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    // jsdom has no Fullscreen API: 1.0 fills the window (its fs-immersive class) and says so on the control
    expect($('btnPivFull').hidden).toBe(false);
    expect($('btnPivFull').querySelector('.fs-lbl')!.textContent).toBe(t('fs.fill'));
    await click($('btnPivFull'));
    expect($('pivModalBox').classList.contains('fs-immersive')).toBe(true);
    expect($('btnPivFull').getAttribute('aria-pressed')).toBe('true');
    // the dialog closes: its full screen goes with it (1.0's MutationObserver in fsInit)
    await click($('btnClosePrintView'));
    await waitFor(() => expect($('pivModalBox').classList.contains('fs-immersive')).toBe(false));
    await click($('btnOpenSpreads'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    await click($('btnClosePrintView'));
    // the print view's control too
    await click($('btnExport'));
    await click($('btnOpenPrintView'));
    expect($('btnPrintFull').querySelector('.fs-lbl')!.textContent).toBe(t('fs.fill'));
    await click($('btnPrintFull'));
    expect($('printModalBox').classList.contains('fs-immersive')).toBe(true);
    await click($('btnPrintFull'));
    expect($('printModalBox').classList.contains('fs-immersive')).toBe(false);
  });

  it("the preflight: 1.0's facts line; a finding's jump moves the editor's selection only; running it writes nothing", async () => {
    const doc = LANTERN();
    const ch = (doc.sections as Rec[]).filter((s) => s.kind === 'body')[1]!;
    ch.content = String(ch.content) + '\n\n![A tiny chart](img:scpfimg1|full)';
    (doc.images as Rec[]).push({ id: 'scpfimg1', name: 'Tiny Chart.png', mediaType: 'image/png', ext: 'png', data: PNG_1PX });
    await studioWith(doc);
    const before = await backup();
    await openExport();
    await click($('btnPreflight'));
    const box = $('preflightResults');
    expect(box.style.display).toBe('');
    expect(box.textContent).toContain('6 × 9 in');
    expect(box.textContent).toContain(t('preflight.pdfxNote'));
    const jumps = Array.from(box.querySelectorAll<HTMLButtonElement>('[data-pfjump]'));
    expect(jumps.length).toBeGreaterThan(0);
    const toSection = jumps.find((b) => b.textContent === t('preflight.fix') && (b.closest('li')?.textContent || '').includes('Tiny Chart'))!;
    expect(toSection).toBeTruthy();
    const target = (doc.sections as Rec[]).indexOf(ch);
    await click(toSection);
    await waitFor(() => expect(desk.active).toBe(target));
    expect(await backup()).toEqual(before);
  });
});
