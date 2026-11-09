import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { textOffsetToPos } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { toBook } from '../src/editor/bridge';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { fixtures } from './fixtures';
import { backupClicked } from './backup-wait';

/* Wave 1b, task 3 in the studio: the row menu (1.0's chopOpenMenu,
   chopMenuPick, chopPlaceMenu keys), the refusal toast, the Undo toast
   (focus on Undo after a keyboard pick), and review focus #3 with the
   operation's chapter editor open: split at the editor's caret, Undo,
   export-equal. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;

beforeAll(() => {
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

const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
async function openStudio(book: Rec) {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.chop-more')).not.toBeNull(), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await backupClicked(() => fireEvent.click(document.getElementById('btnLocalBackup')!));
  const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
  vi.restoreAllMocks();
  const b = out.book;
  delete b.history;
  delete b.historyPool;
  return b;
}
const editor = () => (document.getElementById('manuscript') as HTMLElement & { beukEditor?: Editor }).beukEditor!;
const activeRow = () => document.querySelector<HTMLElement>('#structureList .sec-item.active')!;
const moreOf = (row: HTMLElement) => row.querySelector<HTMLButtonElement>('[data-act="more"]')!;

describe('the row menu (1.0 chopOpenMenu / chopMenuPick)', () => {
  it('opens on the row button, focuses the first usable item, moves with the arrows, Escape returns to the button; refused items say why', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    // the open chapter: every item offered
    const row = activeRow();
    const btn = moreOf(row);
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('title')).toBe(E['chop.more']);
    expect(btn.getAttribute('aria-label')).toMatch(/^More actions for /);
    await act(async () => {
      fireEvent.click(btn);
    });
    const menu = document.getElementById('chopMenu')!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(row.classList.contains('chop-open')).toBe(true);
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role=menuitem]'));
    expect(items.map((i) => i.getAttribute('data-chop-act'))).toEqual(['dup', 'split', 'merge', 'del']);
    expect(menu.querySelector('.chop-sep')).not.toBeNull();
    expect(document.activeElement).toBe(items.find((i) => i.getAttribute('aria-disabled') !== 'true'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[3]);
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.getElementById('chopMenu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    // split on a row that is not open: refused with 1.0's reason, in the item and as a toast
    const other = Array.from(document.querySelectorAll<HTMLElement>('#og-body .sec-item')).find((r) => !r.classList.contains('active') && r.getAttribute('aria-disabled') !== 'true')!;
    await act(async () => {
      fireEvent.click(moreOf(other));
    });
    const split = document.querySelector<HTMLElement>('#chopMenu [data-chop-act="split"]')!;
    expect(split.getAttribute('aria-disabled')).toBe('true');
    expect(split.title).toBe(E['chop.splitNeedsActive']);
    expect(document.getElementById(split.getAttribute('aria-describedby')!)!.textContent).toBe(E['chop.splitNeedsActive']);
    await act(async () => {
      fireEvent.click(split);
    });
    expect(document.getElementById('toasts')!.textContent).toContain(E['chop.splitNeedsActive']);
    expect(document.getElementById('chopMenu')).not.toBeNull(); // a refused pick leaves the menu open
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(document.getElementById('chopMenu')).toBeNull();
  });

  it('a keyboard pick puts focus on the toast\'s Undo; Undo brings the book back exactly and says so', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const before = JSON.stringify(await exported());
    const row = activeRow();
    const n = document.querySelectorAll('#structureList .sec-item').length;
    await act(async () => {
      fireEvent.click(moreOf(row));
    });
    const dup = document.querySelector<HTMLElement>('#chopMenu [data-chop-act="dup"]')!;
    await act(async () => {
      fireEvent.click(dup, { detail: 0 }); // the keyboard's click
    });
    await waitFor(() => expect(document.querySelectorAll('#structureList .sec-item').length).toBe(n + 1));
    const undo = document.querySelector<HTMLButtonElement>('#toasts .toast-action')!;
    expect(undo.textContent).toBe(E['chop.undo']);
    expect(document.activeElement).toBe(undo);
    expect(document.getElementById('toasts')!.textContent).toContain(E['chop.duplicated']!.split('{name}')[0]!);
    expect(activeRow().querySelector('.sec-name')!.textContent).toContain('(copy)');
    await act(async () => {
      fireEvent.click(undo);
    });
    await waitFor(() => expect(document.querySelectorAll('#structureList .sec-item').length).toBe(n));
    expect(document.getElementById('toasts')!.textContent).toContain(E['chop.undone']);
    expect(JSON.stringify(await exported())).toBe(before);
  });
});

describe('split at the caret with the chapter editor open, Undo (review focus #3)', () => {
  it('cuts where the editor\'s caret stands, the second part opens; Undo returns the export exactly', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const before = await exported();
    const ed = editor();
    const activeIndex = Number(activeRow().getAttribute('data-index'));
    const text = String((before.sections as Rec[])[activeIndex]!.content);
    // the caret at the start of the second paragraph
    const cut = text.indexOf('\n\n') + 2;
    expect(cut).toBeGreaterThan(2);
    const pos = textOffsetToPos(toBook(ed.state.doc), cut);
    await act(async () => {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    });
    const row = activeRow();
    await act(async () => {
      fireEvent.click(moreOf(row));
    });
    const split = document.querySelector<HTMLElement>('#chopMenu [data-chop-act="split"]')!;
    expect(split.getAttribute('aria-disabled')).toBeNull();
    await act(async () => {
      fireEvent.click(split, { detail: 1 });
    });
    await waitFor(() => expect(Number(activeRow().getAttribute('data-index'))).toBe(activeIndex + 1));
    const mid = await exported();
    const A = (mid.sections as Rec[])[activeIndex]!, B = (mid.sections as Rec[])[activeIndex + 1]!;
    expect(String(A.content) + '\n\n' + String(B.content)).toBe(text.split(/\n\s*\n/).filter((b) => b.trim()).join('\n\n'));
    // the second part's editor is open
    await waitFor(() => expect(document.querySelector(`#manuscript[data-section="${activeIndex + 1}"] .ms-editor`)).not.toBeNull());
    const undo = document.querySelector<HTMLButtonElement>('#toasts .toast-action')!;
    expect(document.activeElement).not.toBe(undo); // a mouse pick leaves focus alone
    await act(async () => {
      fireEvent.click(undo);
    });
    await waitFor(() => expect(Number(activeRow().getAttribute('data-index'))).toBe(activeIndex));
    await waitFor(() => expect(document.querySelector(`#manuscript[data-section="${activeIndex}"] .ms-editor`)).not.toBeNull());
    expect(JSON.stringify(await exported())).toBe(JSON.stringify(before));
  });
});
