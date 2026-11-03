import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
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
import { exportReset, exportRun } from '../src/export/state';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';

/* Wave 5a, task 2 (inventory F1, F7, F8): 1.0's export modal in the studio — its markup, wired by 1.0's own initExport,
   opened from the top bar's Export (1.0's #btnExport), every handler run in the export session. Review
   focus #3 (constraint 54): opening, switching presets, the validator, the inspector, the audit and closing write
   nothing but the preset (and switching back gives the book back exactly); #5: each test waits for what its action
   needs (the closure loaded and the modal wired: the opener enabled, 1.0's presets drawn). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  // 1.0's vendored JSZip, as the page loads it (jsdom runs no <script src>)
  (globalThis as unknown as { JSZip: unknown }).JSZip = createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
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
const isOpen = (id = 'modalExport') => !!$(id) && $(id).classList.contains('open');
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
async function studioWith(doc: Rec) {
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  // the modal's markup is in place and 1.0's initExport has wired it: the top bar's opener is enabled
  await waitFor(() => expect($('btnExport')?.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openExport() {
  await click($('btnExport'));
  // 1.0's refreshExportTree drew the presets and the tree, and the modal is open
  await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
  expect(isOpen()).toBe(true);
}
/** The download the click starts: 1.0's downloadBlob (the blob, the file name). */
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

describe('the export modal in the studio', { timeout: 90_000 }, () => {
  it("opens from the top bar with 1.0's presets, detail, package tree and words; Escape closes it", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    const grid = $('platformGrid');
    expect(Array.from(grid.querySelectorAll('[data-platform]')).map((b) => b.getAttribute('data-platform'))).toEqual(c.api.PLATFORM_PRESETS.map((p) => p.id));
    expect(grid.querySelector('.active')!.getAttribute('data-platform')).toBe('generic');
    const file = c.api.slug((doc.meta as Rec).title) + '.epub';
    expect($('platformDetail').textContent).toContain('Downloads as ' + file);
    expect($('exportTree').textContent!.split('\n')[0]).toBe(file);
    expect($('exportTree').textContent).toContain('OEBPS/');
    expect($('btnBuildEpub').textContent).toBe('Download for Generic (.epub)');
    expect($('expH').textContent).toBe(t('exp.title'));
    expect($('btnValidate').textContent).toBe(t('exp.validateBtn'));
    // the sections of later waves are hidden
    for (const id of ['btnPreflight', 'btnDownloadDocx', 'btnMsOpen', 'btnAcxOpen', 'btnOpenPrintView', 'btnBuildBoxSet']) expect(($(id).closest('.fmt-sec') as HTMLElement).style.display, id).toBe('none');
    expect(($('btnStoreReady').closest('.st-entry') as HTMLElement).style.display).toBe('none');
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(isOpen()).toBe(false);
    expect(await backup()).toEqual(want(doc));
  });

  it("choosing a preset is 1.0's: the grid, detail and file name follow, and the book carries it; the first again gives the book back", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    await click(document.querySelector('[data-platform="kdp"]'));
    expect(document.querySelector('#platformGrid .active')!.getAttribute('data-platform')).toBe('kdp');
    expect(document.querySelector('#platformGrid [data-platform="kdp"]')!.getAttribute('aria-checked')).toBe('true');
    expect($('platformDetail').textContent).toContain('-kdp.epub');
    expect($('exportTree').textContent).toContain('(+ <guide>)');
    expect((await backup()).exportPlatform).toBe('kdp');
    await click(document.querySelector('[data-platform="generic"]'));
    expect(await backup()).toEqual(want(doc));
  });

  it('the validator, the inspector and the audit: 1.0 draws them, the inspector on top (Escape closes only it); nothing is written', async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    await click($('btnValidate'));
    expect($('validateResults').style.display).toBe('');
    const v = exportRun((cc) => cc.api.validateEpubPackage(cc.api.epubFiles()))!;
    expect($('validateResults').querySelector('.val-summary')!.textContent).toContain(v.passes + ' passed');
    expect($('validateResults').querySelectorAll('li').length).toBe(v.results.length);
    // a line that is not a pass keeps 1.0's link to the error dictionary (through the cleaner)
    const failing = v.results.filter((r) => r.level !== 'pass');
    expect($('validateResults').querySelectorAll('a.v-code[href^="/help/errors/BEUK-"]').length).toBe(failing.filter((r) => c.api.BEUK_VALIDATOR_CODES[r.id]).length);
    await click($('btnA11y'));
    expect($('a11yResults').style.display).toBe('');
    expect($('a11yResults').textContent!.length).toBeGreaterThan(20);
    await click($('btnInspect'));
    expect(isOpen('modalInspector')).toBe(true);
    const files = exportRun((cc) => cc.api.epubFiles())!;
    expect(Array.from(document.querySelectorAll('#inspFiles [data-insp]')).map((b) => b.getAttribute('data-insp'))).toEqual(files.map((f) => f.path));
    expect($('inspPath').textContent).toBe(files[1]!.path);
    await click(document.querySelector('#inspFiles [data-insp="OEBPS/package.opf"]'));
    expect($('inspPath').textContent).toBe('OEBPS/package.opf');
    expect($('inspCode').textContent).toBe(files.find((f) => f.path === 'OEBPS/package.opf')!.content);
    expect($('inspCode').querySelector('.tok-tag')).toBeTruthy();
    // 1.0 indents each file by its depth (the cleaner keeps its padding)
    expect((document.querySelector('#inspFiles [data-insp="OEBPS/package.opf"] .f-name') as HTMLElement).style.paddingLeft).toBe('12px');
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(isOpen('modalInspector')).toBe(false);
    expect(isOpen()).toBe(true);
    await click($('btnCloseExport'));
    expect(isOpen()).toBe(false);
    expect(await backup()).toEqual(want(doc));
  });

  it("Markdown and HTML download as 1.0's files (name, type, bytes: 1.0's builders on the book)", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    const md = await downloaded(() => click($('btnDownloadMd')));
    const html = await downloaded(() => click($('btnDownloadHtml')));
    const slug = c.api.slug((doc.meta as Rec).title);
    expect(md.map((d) => [d.name, d.blob.type])).toEqual([[slug + '.md', 'text/markdown;charset=utf-8']]);
    expect(html.map((d) => [d.name, d.blob.type])).toEqual([[slug + '.html', 'text/html;charset=utf-8']]);
    expect(await md[0]!.blob.text()).toBe(exportRun((cc) => cc.api.buildMarkdown()));
    expect(await html[0]!.blob.text()).toBe(exportRun((cc) => cc.api.buildStandaloneHtml()));
    await waitFor(() => expect(toasts()).toEqual(expect.arrayContaining([t('toast.mdDownloaded'), t('toast.htmlDownloaded')])));
    expect(await backup()).toEqual(want(doc));
  });

  it("the store-ready EPUB with no shelf or signed out: 1.0's own words, nothing sent, the modal stays open", async () => {
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await click($('btnBuildEpub'));
    await waitFor(() => expect(toasts()).toContain(t('epub.offline')));
    cloudFacts.available = true;
    await click($('btnBuildEpub'));
    await waitFor(() => expect(toasts()).toContain(t('epub.signin')));
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/epub'))).toEqual([]);
    expect(isOpen()).toBe(true);
    expect(($('btnBuildEpub') as HTMLButtonElement).disabled).toBe(false);
  });
});
