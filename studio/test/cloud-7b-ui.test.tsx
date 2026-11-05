import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { closureIfLoaded, loadClosure, resetCloudFacts, setClosureLang, setClosureT, cloudFacts } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { cloudReset, cloudUi } from '../src/cloud/cloud';
import { resetCloudProbe } from '../src/pictures/stock';
import { exportBook } from '../../src/book/editor/index';
import { live } from '../src/history/history';
import { fixtures } from './fixtures';
import { installCanvas } from './print-fixture';
import { hazards } from './hazards';
import { browser, fakeStripe, startShelf, type Shelf } from './cloud-server';

/* Wave 7b in the studio (the harness is cloud-ui.test.tsx's, wave 7a): 1.0's archive section, bulk import's block and
   doors, against the REAL server (test/cloud-server.ts: src/app.ts on PGlite in this process; mail captured, never sent; billing on only against
   a fake Stripe on 127.0.0.1). Every word asserted is 1.0's (its keys, or its own hard-coded English). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const PASSWORD = 'correct horse battery';
let off: Shelf;
const realFetch = globalThis.fetch;
let net: ReturnType<typeof browser>;
beforeAll(async () => {
  // jsdom lays nothing out: the editor's scroll-into-view after 1.0's focusEditor reads these
  for (const P of [Range.prototype, Element.prototype, Text.prototype] as unknown as Record<string, unknown>[]) {
    if (typeof P.getClientRects !== 'function') P.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    if (typeof P.getBoundingClientRect !== 'function') P.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  }
  // jsdom draws no canvas and decodes no picture: wave 5b's stand-ins, before print's module takes the page's Image
  installCanvas();
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  off = await startShelf();
}, 60_000);
afterAll(async () => {
  await off.close();
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
  resetCloudFacts();
  cloudReset();
  resetCloudProbe();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  cloudReset();
  resetCloudFacts();
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
const type = (id: string, v: string) => act(() => void fireEvent.input(Object.assign($(id) as HTMLInputElement, { value: v })));
const manuscripts = () => net.requests.filter((r) => r.path.startsWith('/api/manuscripts') && (r.method === 'PUT' || r.method === 'POST'));
let seq = 0;
const email = () => `w${++seq}-${Date.now()}@example.test`;

async function studio(shelf: Shelf, doc: Rec = LANTERN()) {
  net = browser(shelf.base);
  globalThis.fetch = net.fetch;
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnAccount')?.style.display).toBe(''), { timeout: 20_000 });
  return r;
}
/** Sign up through 1.0's dialog; the bring offer answered `bring`. */
async function signUp(addr: string, bring: boolean) {
  await click($('btnAccount'));
  await waitFor(() => expect(isOpen('modalAuth')).toBe(true));
  await click($('authToggle'));
  expect($('authTitle').textContent).toBe(t('auth.titleRegister'));
  await type('authEmail', addr);
  await type('authPassword', PASSWORD);
  await click($('btnAuthSubmit'));
  await waitFor(() => expect(toasts()).toContain(t('auth.welcomeNew')));
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
  expect($('confirmTitle').textContent).toBe(t('shelf.bringTitle'));
  await click(bring ? $('btnConfirmYes') : $('btnConfirmNo'));
}

/* ---- wave 7b in the studio: the archive buttons, bulk import's doors, the update bar's place ---- */
const pick = async (id: string, files: File[]) => {
  const inp = $(id) as HTMLInputElement;
  Object.defineProperty(inp, 'files', { value: files, configurable: true });
  await act(() => void fireEvent.change(inp));
};

describe('wave 7b in the studio', () => {
  it("bulk import: 1.0's block in the shelf dialog, its file picker feeds 1.0's queue, and the open book stays as it was", async () => {
    await studio(off);
    expect($('bulkHint').style.display).toBe('');
    await signUp(email(), true);
    await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
    expect($('bulkHint').style.display).toBe('none');
    await click($('btnAccount'));
    await waitFor(() => expect(isOpen('modalShelf')).toBe(true));
    expect($('shelfBulk').style.display).toBe('');
    expect($('btnBulkFiles').textContent).toBe(t('bulk.filesBtn'));
    const before = JSON.stringify(exportBook(desk.ydoc!));
    const n = net.requests.length;
    await pick('bulkFileInput', [new File(['# One\n\nThe first book.\n'], 'one.md', { type: 'text/markdown' }), new File(['Two\n\nThe second book.\n'], 'two.txt', { type: 'text/plain' })]);
    await waitFor(() => expect($('bulkSummary').style.display).toBe(''), { timeout: 20_000 });
    expect($('bulkSummary').textContent).toContain(t('bulk.added', { n: 2 }));
    expect(net.requests.slice(n).filter((r) => r.method === 'POST' && r.path === '/api/manuscripts').length).toBe(2);
    expect(net.requests.slice(n).filter((r) => r.method === 'PUT')).toEqual([]);
    expect(JSON.stringify(exportBook(desk.ydoc!))).toBe(before);
    await waitFor(() => expect($('shelfList').querySelectorAll('.shelf-row').length).toBe(3));
    expect(hazards($('modalShelf').innerHTML)).toEqual([]);
  }, 90_000);

  it("the archive: 1.0's section in the export modal, signed in; Save Markdown archives the open book's Markdown", async () => {
    await studio(off);
    await signUp(email(), true);
    await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
    await waitFor(() => expect($('btnExport').getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    await click($('btnExport'));
    await waitFor(() => expect(isOpen('modalExport')).toBe(true));
    expect($('archiveSec').style.display).toBe('');
    await waitFor(() => expect($('archiveList').textContent).toContain('Nothing archived yet.'));
    await click($('btnArcMd'));
    await waitFor(() => expect(toasts().some((x) => x.startsWith('Saved to your archive — '))).toBe(true), { timeout: 20_000 });
    const post = net.requests.find((r) => r.method === 'POST' && r.path.startsWith('/api/exports'))!;
    expect(post.path).toMatch(/^\/api\/exports\?manuscriptId=[0-9a-f-]{36}&format=markdown&filename=[^&]+\.md$/);
    await waitFor(() => expect($('archiveList').querySelectorAll('.arc-row').length).toBe(1));
  }, 90_000);

  it('signed out: the archive section stays hidden in the export modal', async () => {
    await studio(off);
    await waitFor(() => expect($('btnExport').getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    await click($('btnExport'));
    await waitFor(() => expect(isOpen('modalExport')).toBe(true));
    expect($('archiveSec').style.display).toBe('none');
  }, 60_000);
});
