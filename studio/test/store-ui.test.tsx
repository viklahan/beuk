import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, loadClosure, setClosureLang, setClosureT, shelf, type Closure, type StoreAudit } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset, exportRun } from '../src/export/state';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { hostileExportBook } from './export-fixture';
import { hazards } from './hazards';
import { installCanvas } from './print-fixture';

/* Wave 5d, task 2 (inventory F10): 1.0's store-ready check in the studio — its entry in the export modal (where 1.0 puts
   it: the export modal's "Store-ready?" box, #btnStoreReady), its modal (#modalStore, 1.0's markup verbatim, wired by
   1.0's own initStoreReady), every handler in the export session. Review focus #2-#6: the actions are 1.0's edits, the
   report downloads as 1.0's, the server panel is shelf-gated with 1.0's own words and no request; opening, switching
   stores, the server panel and the report write nothing; one control, one meaning. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  (globalThis as unknown as { JSZip: unknown }).JSZip = createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
  // jsdom draws no canvas: the wrap's read-back (drawWrapTo) and the cover maker draw on a stand-in (cover-ui's fakeCtx)
  installCanvas();
  HTMLCanvasElement.prototype.getContext = function () {
    const target: Rec = {
      measureText: (s: string) => ({ width: String(s).length * 10 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      createPattern: () => ({}),
      canvas: null,
    };
    return new Proxy(target, { get: (o, k) => (k in o ? o[k as string] : () => undefined), set: (o, k, v) => ((o[k as string] = v), true) }) as never;
  } as never;
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {};
  (window as unknown as { lucide: unknown }).lucide = { icons: {} };
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
  cloudFacts.available = false;
  cloudFacts.user = null;
  exportRun((cc) => ((cc.api.storeUi as Rec).server = null));
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
const change = (el: Element | null, value: string) =>
  act(() => {
    (el as HTMLSelectElement).value = value;
    fireEvent.change(el!);
  });
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
async function openStore() {
  await click($('btnExport'));
  await waitFor(() => expect(isOpen('modalExport')).toBe(true));
  await click($('btnStoreReady'));
  await waitFor(() => expect(isOpen('modalStore')).toBe(true));
}
async function downloaded(fn: () => Promise<void> | void): Promise<{ blob: Blob; name: string }[]> {
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
  sp.forEach((s) => s.mockRestore());
  return got;
}
async function backup(): Promise<Rec> {
  const d = await downloaded(() => click($('btnLocalBackup')));
  return (JSON.parse(await d[0]!.blob.text()) as { book: Rec }).book;
}
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const rowsOf = () => Array.from(document.querySelectorAll('#storeReport .st-row')).map((li) => (li as HTMLElement).dataset.stId + ':' + (li as HTMLElement).dataset.stStatus);
const lastAudit = () => exportRun((cc) => cc.api.storeUi.last as StoreAudit)!;

describe('the store-ready check in the studio', { timeout: 120_000 }, () => {
  it("opens where 1.0 opens it (the export modal's Store-ready? box), on top, with 1.0's verdict, rows and words; Escape closes only it", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await click($('btnExport'));
    await waitFor(() => expect(isOpen('modalExport')).toBe(true));
    const entry = $('btnStoreReady').closest('.st-entry') as HTMLElement;
    expect(entry.style.display).toBe('');
    expect(entry.querySelector('h3')!.textContent).toBe(t('store.secH'));
    expect($('btnStoreReady').textContent).toBe(t('store.btn'));
    // one control, one meaning: one "Store-ready?" opener in the page
    expect(Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === t('store.btn')).length).toBe(1);
    await click($('btnStoreReady'));
    await waitFor(() => expect(isOpen('modalStore')).toBe(true));
    expect($('storeH').textContent).toBe(t('store.title'));
    expect(Array.from(($('storeSel') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['kdp', 'ingramspark']);
    expect(($('storeInk') as HTMLSelectElement).options.length).toBe(5); // KDP's five papers (1.0's storeInk, drawn by renderStoreReport)
    const a = lastAudit();
    expect($('storeVerdict').getAttribute('data-verdict')).toBe(a.verdict);
    expect($('storeVerdict').textContent).toContain(c.api.storeVerdictText(a));
    expect(rowsOf()).toEqual(a.groups.interior.concat(a.groups.cover, a.groups.ebook).map((r) => r.id + ':' + r.status));
    // every icon 1.0 names in the entry, the modal and its rows is drawn (none left as an empty <i data-lucide>)
    expect(Array.from(document.querySelectorAll('#modalStore i[data-lucide], #modalExport .st-entry i[data-lucide]')).map((i) => i.getAttribute('data-lucide'))).toEqual([]);
    // the store modal is the top of the dialog stack: Escape closes it and leaves the export modal open
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(isOpen('modalStore')).toBe(false);
    expect(isOpen('modalExport')).toBe(true);
    // 1.0's Close
    await click($('btnStoreReady'));
    await waitFor(() => expect(isOpen('modalStore')).toBe(true));
    await click($('btnCloseStore'));
    expect(isOpen('modalStore')).toBe(false);
    expect(await backup()).toEqual(want(doc));
  });

  it("the selects are 1.0's: the papers follow the store, the report follows; left changed the book carries storeCheck; put back, the book is as it was", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openStore();
    await change($('storeSel'), 'ingramspark');
    await waitFor(() => expect(($('storeInk') as HTMLSelectElement).options.length).toBe(7));
    expect(lastAudit().sc.store).toBe('ingramspark');
    await change($('storeBinding'), 'hardcover');
    await change($('storeInk'), 'bw_cream');
    expect(lastAudit().sc).toEqual({ store: 'ingramspark', binding: 'hardcover', ink: 'bw_cream', attestSpine: false });
    expect((await backup()).storeCheck).toEqual({ store: 'ingramspark', binding: 'hardcover', ink: 'bw_cream', attestSpine: false });
    await change($('storeSel'), 'kdp');
    await change($('storeBinding'), 'paperback');
    expect(await backup()).toEqual(want(doc));
  });

  it("a row's button is 1.0's edit: the trim fix sets the trim and the line passes; the book carries it", async () => {
    const doc = LANTERN();
    doc.printTrim = '8x8';
    await studioWith(doc);
    await openStore();
    const btn = document.querySelector('#storeReport [data-st-act="trim"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    const act0 = lastAudit().groups.interior.find((r) => r.id === 'trim')!.action!;
    expect(btn.textContent).toBe(act0.label);
    await click(btn);
    await waitFor(() => expect(rowsOf()).toContain('trim:pass'));
    expect((await backup()).printTrim).toBe(act0.trim);
    expect(isOpen('modalStore')).toBe(true);
  });

  it('"Open the cover maker" closes both modals and opens 1.0\'s cover maker on the book', async () => {
    const doc = LANTERN();
    delete doc.coverRecipe;
    await studioWith(doc);
    await openStore();
    const btn = document.querySelector('#storeReport [data-st-act="wrap"]') as HTMLButtonElement;
    expect(btn.textContent).toBe(t('store.act.cover'));
    await click(btn);
    await waitFor(() => expect(isOpen('modalCoverMaker')).toBe(true));
    expect(isOpen('modalStore')).toBe(false);
    expect(isOpen('modalExport')).toBe(false);
  });

  it("Download report is 1.0's file: its name, type and text (buildStoreReportHtml of the audit on screen)", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openStore();
    const a = lastAudit();
    const d = await downloaded(() => click($('btnStoreDownload')));
    expect(d.length).toBe(1);
    expect(d[0]!.name).toBe(c.api.slug((doc.meta as Rec).title) + '-store-ready-kdp-' + a.at.toISOString().slice(0, 10) + '.html');
    expect(d[0]!.blob.type).toBe('text/html;charset=utf-8');
    const text = await d[0]!.blob.text();
    expect(text).toBe(exportRun((cc) => cc.api.buildStoreReportHtml(a)));
    expect(text).toContain(t('store.reportStamp', { when: a.at.toISOString() }));
    expect(hazards(text, 'report')).toEqual([]);
    expect(await backup()).toEqual(want(doc));
  });

  it("the server panel is shelf-gated: offline, signed out and signed in each show 1.0's own words; nothing is sent; the book is unchanged", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const doc = LANTERN();
    await studioWith(doc);
    const sent = () => fetchSpy.mock.calls.filter((x) => /\/api\/(exports|jobs)/.test(String(x[0]))).length;
    const fonts = () => document.querySelector('#storeReport [data-st-id="fonts"]') as HTMLElement;
    // offline
    await openStore();
    expect(($('btnStoreServer') as HTMLButtonElement).disabled).toBe(true);
    expect($('btnStoreServer').title).toBe(t('store.nc.local'));
    expect(fonts().querySelector('.st-ev')!.textContent).toBe(t('store.nc.local'));
    expect(fonts().querySelector('.st-fix')!.textContent).toContain(t('store.fix.local'));
    await click($('btnCloseStore'));
    // signed out
    cloudFacts.available = true;
    await click($('btnStoreReady'));
    expect(($('btnStoreServer') as HTMLButtonElement).disabled).toBe(true);
    expect($('btnStoreServer').title).toBe(t('store.nc.signin'));
    expect(fonts().querySelector('.st-ev')!.textContent).toBe(t('store.nc.signin'));
    expect(fonts().querySelector('[data-st-act]')!.textContent).toBe(t('store.act.signin'));
    // review (Important 1): 2.0 has no sign-in dialog before wave 7 — 1.0's Sign in keeps both modals open and says
    // 1.0's own words for the state, as 5a's buildEpub.noOpen does; it never closes everything and opens nothing
    // wave 7a: 1.0's Sign in closes the store and export modals and opens the sign-in dialog (5d's stand-in is gone)
    await click(fonts().querySelector('[data-st-act]'));
    expect(isOpen('modalStore')).toBe(false);
    expect(isOpen('modalExport')).toBe(false);
    await waitFor(() => expect(document.getElementById('modalAuth')?.classList.contains('open')).toBe(true));
    document.getElementById('modalAuth')!.classList.remove('open');
    await click($('btnExport'));
    await waitFor(() => expect(isOpen('modalExport')).toBe(true));
    // signed in: the run asks the shelf seam once; 1.0's own answer for a book not on the shelf
    cloudFacts.user = { id: 'u', email: 'u@beuk.test' };
    await click($('btnStoreReady'));
    expect(($('btnStoreServer') as HTMLButtonElement).disabled).toBe(false);
    expect(fonts().querySelector('.st-ev')!.textContent).toBe(t('store.nc.notRun'));
    const asked = shelf.asked;
    await click($('btnStoreServer'));
    await waitFor(() => expect($('storeServerNote').textContent).toBe(t('store.serverDone')));
    expect(shelf.asked).toBe(asked + 1);
    expect(fonts().querySelector('.st-ev')!.textContent).toBe(t('store.nc.failed', { error: t('store.serverNeedShelf') }));
    await click($('btnStoreRecheck'));
    expect(shelf.refused).toEqual([]);
    expect(sent()).toBe(0);
    expect(isOpen('modalStore')).toBe(true);
    expect(await backup()).toEqual(want(doc));
  });

  it("a hostile book: the live modal carries no script, handler or remote source, and nothing ran", async () => {
    const doc = hostileExportBook();
    await studioWith(doc);
    await openStore();
    for (const s of ['kdp', 'ingramspark']) {
      await change($('storeSel'), s);
      expect(hazards($('modalStore').outerHTML, 'modal ' + s)).toEqual([]);
    }
    expect((window as unknown as { __pw?: unknown }).__pw).toBeUndefined();
  });
});
