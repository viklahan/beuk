import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
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
  fireEvent.click(document.getElementById('btnExport')!);
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
