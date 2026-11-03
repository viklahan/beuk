import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { bookOf, importToDevice } from '../src/book/store';

/* The store's import, passed through — except when a test makes the device refuse it (as IndexedDB answers a full
   device: a QuotaExceededError). (Failing indexedDB.open itself also leaves y-indexeddb's own promise chains rejected
   unhandled, which the run would count; the store's import is where BookProvider sees the refusal.) */
const refuse: { error: DOMException | null } = { error: null };
vi.mock('../src/book/store', async (orig) => {
  const m = (await orig()) as typeof import('../src/book/store');
  return { ...m, importToDevice: (doc: unknown) => (refuse.error ? Promise.reject(refuse.error) : m.importToDevice(doc)) };
});
import { loadClosure, setClosureLang, setClosureT } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';

/* Wave 5a, round 2 (V overruled ruling 1): 1.0's layout — ONE Export button, #btnExport, which opens 1.0's export
   modal as 1.0's does (client/index.html #btnExport, initExport); the backup lives where 1.0 keeps it, the "Saving on
   this device" pill (BEUK:local: #localPill, its popover's Export a backup / Open a backup…, the inline backup offer
   when not saved). The pill's state is what 2.0's book store knows: checking while the desk starts, saved once the
   store holds the book, not saved (blocked / quota / error, by the error's name as 1.0's localClassifyError) when
   storing failed; "back up" (evictable) from navigator.storage's standing answer. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
beforeAll(async () => {
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
const storage0 = Object.getOwnPropertyDescriptor(navigator, 'storage');
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  if (storage0) Object.defineProperty(navigator, 'storage', storage0);
  else delete (navigator as unknown as { storage?: unknown }).storage;
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

const book = (name: string) => structuredClone(fixtures('real').find((f) => f.name === name)!.book) as Rec;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
function persisted(answer: boolean | null) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: answer === null ? undefined : { persisted: async () => answer, persist: async () => answer },
  });
}
async function studioWith(doc: Rec | null) {
  if (doc) await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('localPill').getAttribute('data-state')).not.toBe('checking'), { timeout: 20_000 });
  return r;
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

describe("one Export button, 1.0's", { timeout: 60_000 }, () => {
  it("#btnExport is 1.0's (top.export, aria-label 'Export book', tips.export, primary) and opens the export modal; there is no second one", async () => {
    await studioWith(book('real/lantern-coast-book-one'));
    expect(document.getElementById('btnExportBook')).toBeNull();
    const b = $('btnExport');
    expect(b.classList.contains('primary')).toBe(true);
    expect(b.getAttribute('aria-label')).toBe('Export book');
    expect(b.getAttribute('data-tip')).toBe('tips.export');
    expect(b.textContent).toBe(t('top.export'));
    expect(Array.from(document.querySelectorAll('#topbar .tb-btn')).filter((x) => x.textContent === t('top.export')).length).toBe(1);
    await waitFor(() => expect(b.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    const d = await downloaded(() => click(b));
    expect(d).toEqual([]); // no backup any more
    await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
    expect($('modalExport').classList.contains('open')).toBe(true);
  });
});

describe("the backup, in 1.0's local pill", { timeout: 60_000 }, () => {
  it("the popover: 1.0's words; Export a backup downloads the book (readBook reads it) and closes the popover; Escape closes it", async () => {
    persisted(true);
    const doc = book('real/lantern-coast-book-one');
    await studioWith(doc);
    const pill = $('localPill');
    expect(pill.getAttribute('data-state')).toBe('saved');
    expect(pill.hasAttribute('data-evictable')).toBe(false);
    expect($('localPillShort').textContent).toBe(t('local.savedShort'));
    expect($('localPop').hidden).toBe(true);
    await click($('localPillBtn'));
    expect($('localPop').hidden).toBe(false);
    expect($('localPillBtn').getAttribute('aria-expanded')).toBe('true');
    expect($('localPopTitle').textContent).toBe(t('local.saved'));
    // reopened from this device, nothing written yet this time: 1.0's sentence without a time
    expect($('localPopDetail').textContent).toBe(t('local.detailSavedNoTime') + ' ' + t('local.detailPersisted'));
    // a write that completes (a change stored by y-indexeddb): "Last saved {time}", 1.0's words and time format
    act(() => desk.ydoc!.getMap('meta').set('zzProbe', 1));
    await waitFor(() => expect($('localPopDetail').textContent).toMatch(/\d{1,2}:\d{2}:\d{2}/));
    const at = $('localPopDetail').textContent!;
    const time = /(\d{1,2}:\d{2}:\d{2}\s?[AP]M)/.exec(at)?.[1];
    expect(at).toBe(t('local.detailSaved', { time }) + ' ' + t('local.detailPersisted'));
    act(() => desk.ydoc!.getMap('meta').delete('zzProbe'));
    expect($('btnLocalBackup').textContent).toBe(t('local.backup'));
    expect($('btnLocalOpenBackup').textContent).toBe(t('local.openBackup'));
    const d = await downloaded(() => click($('btnLocalBackup')));
    expect(d.length).toBe(1);
    expect(d[0]!.name).toMatch(/\.beuk-backup\.json$/);
    const out = (JSON.parse(await d[0]!.blob.text()) as { book: Rec }).book;
    expect(out).toEqual(JSON.parse(JSON.stringify(readBook(doc).book))); // (the probe key was set and taken away)
    expect($('localPop').hidden).toBe(true);
    await click($('localPillBtn'));
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect($('localPop').hidden).toBe(true);
  });

  it('Open a backup… asks before replacing the book on the desk, then opens it', async () => {
    persisted(false);
    await studioWith(book('real/lantern-coast-book-one'));
    expect($('localPill').hasAttribute('data-evictable')).toBe(true); // the browser has not granted lasting storage
    expect($('localPillShort').textContent).toBe(t('local.savedRiskShort'));
    await click($('localPillBtn'));
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await click($('btnLocalOpenBackup'));
    expect(pick).toHaveBeenCalled();
    pick.mockRestore();
    expect($('localPop').hidden).toBe(true);
    const other = book('real/salt-road-book-one');
    const input = $('localBackupInput') as HTMLInputElement;
    const file = new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '', book: other })], 'salt.beuk-backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => void fireEvent.change(input));
    await waitFor(() => expect(document.body.textContent).toContain(t('local.backupConfirmTitle')));
    const yes = Array.from(document.querySelectorAll('button')).find((x) => x.textContent === t('local.backupConfirmYes'))!;
    await click(yes);
    await waitFor(() => expect($('projectTitleDisplay').textContent).toBe(String((other.meta as Rec).title)), { timeout: 20_000 });
  });

  it('the states follow the store: checking while it starts; not saved (quota) with the inline backup when storing fails', async () => {
    persisted(null); // no navigator.storage: 1.0's "unsupported" — saved, but "back up"
    const r = render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    expect($('localPill').getAttribute('data-state')).toBe('checking');
    expect($('localPillShort').textContent).toBe(t('local.checkingShort'));
    await waitFor(() => expect($('localPill').getAttribute('data-state')).toBe('saved'), { timeout: 20_000 });
    expect($('localPill').hasAttribute('data-evictable')).toBe(true);
    expect($('btnLocalBackupInline').hidden).toBe(true);
    // a store that refuses the next book: QuotaExceededError → 1.0's "quota"
    refuse.error = new DOMException('full', 'QuotaExceededError');
    const input = $('localBackupInput') as HTMLInputElement;
    const file = new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '', book: book('real/salt-road-book-one') })], 'salt.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => void fireEvent.change(input));
    await waitFor(() => expect($('localPill').getAttribute('data-state')).toBe('quota'), { timeout: 20_000 });
    expect($('localPillShort').textContent).toBe(t('local.notSavedShort'));
    expect($('localPillText').textContent).toBe(t('local.quota'));
    expect($('btnLocalBackupInline').hidden).toBe(false);
    expect(toasts()).toContain(t('local.blocked'));
    refuse.error = null;
    r.unmount();
  });

  it("a write the store's database refuses (its transaction aborts with QuotaExceededError) is 1.0's quota; the next write that completes is saved again", async () => {
    persisted(true);
    await studioWith(book('real/lantern-coast-book-one'));
    const ydoc = desk.ydoc!;
    await new Promise((res) => setTimeout(res, 1500)); // the writes that follow an opening have ended
    // the failure as the store reports an aborted readwrite transaction (bookOf: the open book of a Y.Doc)
    act(() => bookOf(ydoc)!.writeDone(new DOMException('full', 'QuotaExceededError')));
    expect($('localPill').getAttribute('data-state')).toBe('quota');
    expect($('btnLocalBackupInline').hidden).toBe(false);
    // the next write that really completes (a change of the book, stored by y-indexeddb) is saved again
    act(() => ydoc.getMap('meta').set('zzProbe', 1));
    await waitFor(() => expect($('localPill').getAttribute('data-state')).toBe('saved'), { timeout: 10_000 });
    act(() => ydoc.getMap('meta').delete('zzProbe'));
  });
});
