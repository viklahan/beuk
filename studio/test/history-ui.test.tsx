import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { importToDevice } from '../src/book/store';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { fixtures } from './fixtures';

/* Task 3 through the studio: review focus #1 in the interface. Opening a
   backup over the open book asks first with 1.0's confirm (keys
   local.backupConfirm*), "Keep writing" leaves the book as it was, "Open
   the backup" replaces it; History then lists "Before opening a backup",
   and "Restore the whole book" (1.0's confirm again) brings the old book
   back, export-equal. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;

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

const backupFile = (book: unknown, name: string) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], name, { type: 'application/json' });
const toastText = () => document.getElementById('toasts')?.textContent ?? '';

/** Click Export and read the backup the studio hands the browser. */
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fireEvent.click(document.getElementById('btnLocalBackup')!);
  expect(blob).not.toBeNull();
  const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
  vi.restoreAllMocks();
  return out.book;
}
const strip = (x: Rec) => {
  const o = { ...x };
  delete o.history;
  delete o.historyPool;
  delete o.importReport;
  delete o.formatVersion; // 1.0's label: a snapshot carries it as 1.0's do (V, 2026-11-04), so a restored book carries it as 1.0's restore writes it
  return o;
};

describe('the backup replace and History, in the studio (review focus #1)', () => {
  it('asks first; Keep writing changes nothing; Open replaces; History restores the old book exactly', async () => {
    const all = fixtures('real');
    const A = all.find((f) => f.name === 'real/lunas-beach-standalone')!, B = all.find((f) => f.name === 'real/bookbinders-letter')!;
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
    // the empty desk: a backup opens without asking (1.0: nothing to keep)
    const input = document.querySelector('#btnOpenBackup + input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [backupFile(A.book, 'a.beuk-backup.json')] } });
    });
    await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
    expect(document.getElementById('modalConfirm')).toBeNull();
    const oldBook = await exported();

    // a second backup dropped on the desk: 1.0's confirm
    const drop = async (file: File) =>
      act(async () => {
        const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
        ev.dataTransfer = { files: [file], types: ['Files'] };
        document.querySelector('.desk')!.dispatchEvent(ev);
      });
    await drop(backupFile(B.book, 'b.beuk-backup.json'));
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull(), { timeout: 20_000 });
    expect(document.getElementById('confirmTitle')!.textContent).toBe(E['local.backupConfirmTitle']);
    expect(document.getElementById('confirmBody')!.textContent).toBe(E['local.backupConfirmBody']!.replace('{title}', String((oldBook.meta as Rec).title)));
    expect(document.getElementById('btnConfirmYes')!.textContent).toBe(E['local.backupConfirmYes']);
    expect(document.getElementById('btnConfirmNo')!.textContent).toBe(E['confirm.keep']);
    // Keep writing: nothing changes
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmNo')!);
    });
    expect(document.getElementById('modalConfirm')).toBeNull();
    expect(JSON.stringify(await exported())).toBe(JSON.stringify(oldBook));

    // again, and this time open it
    await drop(backupFile(B.book, 'b.beuk-backup.json'));
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull(), { timeout: 20_000 });
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmYes')!);
    });
    await waitFor(() => expect(document.getElementById('projectTitleDisplay')!.textContent).toBe((B.book.meta as Rec).title), { timeout: 20_000 });
    const replaced = await exported();
    expect((replaced.meta as Rec).title).toBe((B.book.meta as Rec).title);
    expect((replaced.sections as Rec[]).length).toBe((B.book.sections as Rec[]).length);

    // History: "Before opening a backup" stands first; restore it whole
    await act(async () => {
      fireEvent.click(document.getElementById('btnHistory')!);
    });
    await waitFor(() => expect(document.querySelector('#historyList [data-hopen]')).not.toBeNull(), { timeout: 20_000 });
    const first = document.querySelector('#historyList .hist-row')!;
    expect(first.querySelector('.hist-name')!.textContent).toContain(E['history.auto.backup']);
    expect(first.querySelector('.hist-auto')!.textContent).toBe(E['history.autoTag']);
    await act(async () => {
      fireEvent.click(first.querySelector('[data-hopen]')!);
    });
    expect(document.getElementById('histDiff')).not.toBeNull();
    // reading a section changes nothing
    const peek = document.querySelector('#historyDetail [data-hpeek]') as HTMLElement;
    await act(async () => {
      fireEvent.click(peek);
    });
    expect(document.querySelector('#historyDetail .hist-peek')).not.toBeNull();
    expect(JSON.stringify(await exported())).toBe(JSON.stringify(replaced));
    await act(async () => {
      fireEvent.click(document.querySelector('#historyDetail [data-hrestore]')!);
    });
    await waitFor(() => expect(document.getElementById('confirmTitle')?.textContent).toBe(E['history.restoreTitle']), { timeout: 10_000 });
    expect(document.getElementById('confirmBody')!.textContent).toBe(E['history.restoreBody']!.replace('{name}', E['history.auto.backup']!));
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmYes')!);
    });
    await waitFor(() => expect(toastText()).toContain(E['history.restoredToast']), { timeout: 20_000 });
    expect(document.getElementById('projectTitleDisplay')!.textContent).toBe((oldBook.meta as Rec).title);
    expect(document.getElementById('modalHistory')).toBeNull();
    const back = await exported();
    expect(JSON.stringify(strip(back))).toBe(JSON.stringify(strip(oldBook)));
    // focus is not lost in a closed dialog
    expect(document.querySelector('.modal-back.open')).toBeNull();
  }, 120_000);
});

describe('fix round 1: a whole restore never overwrites a newer generation', () => {
  it('another tab opens a backup of the book while the Restore confirm waits: Yes then replaces nothing, the newer generation stays', async () => {
    const A = fixtures('real').find((f) => f.name === 'real/lunas-beach-standalone')!;
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
    await act(async () => {
      fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(A.book, 'a.beuk-backup.json')] } });
    });
    await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
    const mine = await exported();
    // a named snapshot to restore
    await act(async () => {
      fireEvent.click(document.getElementById('btnHistory')!);
    });
    await waitFor(() => expect(document.getElementById('btnHistSave')).not.toBeNull());
    await waitFor(() => expect((document.getElementById('btnHistSave') as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });
    await act(async () => {
      fireEvent.change(document.getElementById('histNameInput')!, { target: { value: 'Mine' } });
    });
    await act(async () => {
      fireEvent.click(document.getElementById('btnHistSave')!);
    });
    await waitFor(() => expect(document.querySelector('#historyList [data-hopen]')).not.toBeNull());
    await act(async () => {
      fireEvent.click(document.querySelector('#historyList [data-hopen]')!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('#historyDetail [data-hrestore]')!);
    });
    await waitFor(() => expect(document.getElementById('btnConfirmYes')).not.toBeNull());

    // "tab 2" (another OpenBook in this process, over Node's BroadcastChannel) opens a newer copy of the same book
    const newer = JSON.parse(JSON.stringify(mine)) as Rec;
    (newer.meta as Rec).title = 'Written in tab 2';
    const tab2 = await importToDevice(newer);
    try {
      await waitFor(() => expect(document.getElementById('projectTitleDisplay')!.textContent).toBe('Written in tab 2'), { timeout: 20_000 });
      // the confirm is still waiting; tab 1 says yes
      await act(async () => {
        fireEvent.click(document.getElementById('btnConfirmYes')!);
      });
      await waitFor(() => expect(toastText()).toContain(E['next.snapshotGone'] ?? 'That snapshot is no longer here'), { timeout: 10_000 });
      expect(document.getElementById('projectTitleDisplay')!.textContent).toBe('Written in tab 2');
      const now = await exported();
      expect(JSON.stringify(now)).toBe(JSON.stringify(tab2.export()));
      const gens = (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith('beuk-next-book-'));
      expect(gens).toEqual([`beuk-next-book-${tab2.id}-${tab2.epoch}`]); // the newer generation, and no other
    } finally {
      await tab2.close();
    }
  }, 120_000);
});
