import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { printIfLoaded, printJobs, printListeners, printRun } from '../src/print/print';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { hazards } from './hazards';
import { installCanvas } from './print-fixture';

/* Wave 5b, task 2 (inventory F2): 1.0's print family in the studio — the export modal's print section (1.0's
   initPrint and renderPrintControls: the trims, the margins, the heads and folios, the notes, large print, picture
   book, bleed, the omit toggles), the print view (#modalPrint: the paginated interior in a frame, the browser's own
   print), Download Print HTML, and the print-ready PDF's panel (shelf-gated: 1.0's own words, nothing uploaded).
   Every handler runs in the export session; a setting changed is 1.0's shape in the book, put back it is the book as
   it was (constraint 60). Tests wait for what their action needs (the modal wired, 1.0's trims drawn). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  installCanvas();
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
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
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
  // 1.0's renderPrintControls (initExport's #btnExport click) drew the trims
  await waitFor(() => expect(document.querySelectorAll('#trimGrid [data-trim]').length).toBeGreaterThan(10));
  expect(isOpen('modalExport')).toBe(true);
}
async function downloaded(fn: () => Promise<void> | void, until: () => boolean): Promise<{ blob: Blob; name: string }[]> {
  const got: { blob: Blob; name: string }[] = [];
  let last: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((last = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (last) got.push({ blob: last, name: this.download });
    }),
  ];
  await fn();
  await waitFor(() => expect(until() || got.length > 0).toBe(true), { timeout: 10_000 });
  sp.forEach((s) => s.mockRestore());
  return got;
}
async function backup(): Promise<Rec> {
  const d = await downloaded(() => click($('btnLocalBackup')), () => false);
  return (JSON.parse(await d[0]!.blob.text()) as { book: Rec }).book;
}
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const pressed = (id: string) => $(id).getAttribute('aria-pressed');

describe("1.0's print section, print view and print-ready panel in the studio", { timeout: 120_000 }, () => {
  it("the print section is 1.0's: its trims (by group), its note, its toggles' state, the book's own settings", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    const sizes = c.api.TRIM_SIZES as unknown as { id: string }[];
    expect(Array.from(document.querySelectorAll('#trimGrid [data-trim]')).map((b) => b.getAttribute('data-trim'))).toEqual(
      ['pocket', 'trade', 'large', 'square'].flatMap((g) => (sizes as unknown as { id: string; group: string }[]).filter((s) => s.group === g).map((s) => s.id)),
    );
    expect(document.querySelectorAll('#trimGrid .trim-group-label').length).toBe(4);
    expect($('trimGrid').querySelector('.active')!.getAttribute('data-trim')).toBe('6x9');
    expect($('printNote').textContent).toMatch(/^6 × 9 in trim · about \d+ pages at this trim\. Margins — top /);
    expect([pressed('tglRecto'), pressed('tglLargePrint'), pressed('tglPictureBook'), pressed('tglBleed'), pressed('tglOmitChapter'), pressed('tglOmitBlank')]).toEqual(['true', 'false', 'false', 'false', 'false', 'true']);
    expect(($('selMarginMode') as HTMLSelectElement).value).toBe('auto');
    expect($('pmFields').hidden).toBe(true);
    expect(($('selPrintNotes') as HTMLSelectElement).value).toBe(doc.printNotes === 'end' ? 'end' : 'page');
    expect($('btnOpenPrintView').textContent).toBe(t('exp.openPrint'));
    expect($('btnDownloadPrintHtml').textContent).toBe(t('exp.downloadPrintHtml'));
    expect(($('btnPreflight').closest('.fmt-sec') as HTMLElement).style.display).toBe('');
  });

  it("a trim and a toggle chosen are 1.0's shape in the book; chosen back, the book is exactly as it was (constraint 60)", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    await click(document.querySelector('#trimGrid [data-trim="5x8"]'));
    expect($('trimGrid').querySelector('.active')!.getAttribute('data-trim')).toBe('5x8');
    await click($('tglLargePrint'));
    expect(pressed('tglLargePrint')).toBe('true');
    await click($('tglPictureBook')); // 1.0: picture book replaces large print
    expect([pressed('tglPictureBook'), pressed('tglLargePrint')]).toEqual(['true', 'false']);
    let out = await backup();
    expect([out.printTrim, out.printLargePrint, out.printPictureBook]).toEqual(['5x8', false, true]);
    expect(Object.keys(out)).toEqual(Object.keys(want(doc)));
    // custom margins: 1.0 clamps to 0–3 in
    const mm = $('selMarginMode') as HTMLSelectElement;
    await act(async () => {
      mm.value = 'custom';
      fireEvent.change(mm);
    });
    expect($('pmFields').hidden).toBe(false);
    const pin = $('pmIn') as HTMLInputElement;
    await act(async () => {
      pin.value = '5';
      fireEvent.change(pin);
    });
    out = await backup();
    expect([out.printMarginMode, (out.printCustomMargins as Rec).inside]).toEqual(['custom', 3]);
    // all back where they were
    await act(async () => {
      pin.value = '0.625';
      fireEvent.change(pin);
    });
    await click($('btnMarginReset'));
    await click($('tglPictureBook'));
    await click(document.querySelector('#trimGrid [data-trim="6x9"]'));
    expect(await backup()).toEqual(want(doc));
  });

  it('Open Print View: the interior in the frame (no script, handler or remote request), 1.0\'s line; its own print once; Close', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    await click($('btnOpenPrintView'));
    expect(isOpen('modalPrint')).toBe(true);
    expect(isOpen('modalExport')).toBe(false);
    const fr = $('printFrame') as HTMLIFrameElement;
    const html = fr.srcdoc;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    const title = String((doc.meta as Rec).title);
    expect(html).toContain('<title>' + title + ' — Print Interior (6 × 9 in)</title>');
    expect(hazards(html, 'frame')).toEqual([]);
    expect(html).toBe(printRun((p) => p.vars.buildPrintHtml()));
    // the frame is sandboxed exactly as 1.0's is: not at all (ruled in the report)
    expect(fr.hasAttribute('sandbox')).toBe(false);
    expect($('printSub').textContent!.startsWith(title + ' · 6 × 9 in trim · chapters open on recto (right-hand) pages. To make the PDF: ')).toBe(true);
    const win = fr.contentWindow!;
    const pr = vi.spyOn(win, 'print').mockImplementation(() => undefined);
    await click($('btnDoPrint'));
    expect(pr).toHaveBeenCalledTimes(1);
    await click($('btnClosePrint'));
    expect(isOpen('modalPrint')).toBe(false);
  });

  it("Download Print HTML: 1.0's file name and type, the document the frame shows, 1.0's toast", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    const d = await downloaded(() => click($('btnDownloadPrintHtml')), () => false);
    expect(d.length).toBe(1);
    expect(d[0]!.name).toBe(c.api.slug((doc.meta as Rec).title) + '-print-6x9.html');
    expect(d[0]!.blob.type).toBe('text/html;charset=utf-8');
    const text = await d[0]!.blob.text();
    expect(text).toBe(printRun((p) => p.vars.buildPrintHtml()));
    expect(hazards(text, 'file')).toEqual([]);
    await waitFor(() => expect(toasts().some((x) => x.includes('Print preview downloaded — open it and Print → Save as PDF at the 6 × 9 in trim'))).toBe(true));
    expect(await backup()).toEqual(want(doc));
  });

  it("the print-ready PDF stays shelf-gated: offline, signed out and signed in each say 1.0's own words; nothing is sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await studioWith(LANTERN());
    await openExport();
    const sent = () => fetchSpy.mock.calls.filter((x) => /\/api\/(exports|jobs)/.test(String(x[0]))).length;
    await click($('btnPrintReadyPdf'));
    await waitFor(() => expect($('printReadyNote').textContent).toBe(t('store.nc.local')));
    cloudFacts.available = true;
    await click($('btnPrintReadyPdf'));
    await waitFor(() => expect($('printReadyNote').textContent).toBe(t('pr.signin')));
    // wave 7a: as 1.0, the export modal closes and the sign-in dialog opens; the modal is opened again for the next step
    expect(isOpen('modalExport')).toBe(false);
    await waitFor(() => expect(document.getElementById('modalAuth')?.classList.contains('open')).toBe(true));
    document.getElementById('modalAuth')!.classList.remove('open');
    await openExport();
    cloudFacts.user = { id: 'u', email: 'u@beuk.test' };
    const made = printJobs.made;
    await click($('btnPrintReadyPdf'));
    await waitFor(() => expect($('printReadyNote').textContent).toBe(t('store.serverNeedShelf')));
    expect(printJobs.made).toBe(made + 1);
    expect(sent()).toBe(0);
    expect(($('btnPrintReadyPdf') as HTMLButtonElement).disabled).toBe(false);
  });

  /* Second review (Minor 2): 1.0's interior-view resize listener (initPrintView, on the window) outlived the print
     dialogs: after they went, every resize read $("modalPrintView") as null and threw. */
  it('the print dialogs gone, their window listeners go with them: a resize afterwards throws nothing', async () => {
    await studioWith(LANTERN());
    expect(printListeners()).toBeGreaterThan(0);
    const errors: unknown[] = [];
    const onErr = (e: unknown) => errors.push(e);
    const onWinErr = (e: ErrorEvent) => errors.push(e.error ?? e.message);
    process.on('uncaughtException', onErr);
    window.addEventListener('error', onWinErr);
    try {
      cleanup();
      expect(printListeners()).toBe(0);
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 300));
      expect(errors.map(String)).toEqual([]);
    } finally {
      process.off('uncaughtException', onErr);
      window.removeEventListener('error', onWinErr);
    }
  });

  it('a second book: the print dialogs keep one set of listeners (one print per click), the new export modal is wired', async () => {
    await studioWith(LANTERN());
    const n = printListeners();
    cleanup();
    await studioWith(structuredClone(fixtures('real').find((f) => f.name === 'real/salt-road-book-one')!.book) as Rec);
    expect(printListeners()).toBe(n);
    await openExport();
    await click($('btnOpenPrintView'));
    const pr = vi.spyOn(($('printFrame') as HTMLIFrameElement).contentWindow!, 'print').mockImplementation(() => undefined);
    await click($('btnDoPrint'));
    expect(pr).toHaveBeenCalledTimes(1);
    expect(printIfLoaded()).toBeTruthy();
  });
});
