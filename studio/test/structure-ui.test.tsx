import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { fixtures } from './fixtures';

/* Wave 2c, task 1 in the studio: the row's move and eye buttons, Add
   Chapter / Add Part, the matter library, the section type select and the
   sidebar drop (1.0's renderSidebar, renderMatterLib, renderSecTypeControl
   markup and keys). Each check reads the exported book. */

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
  await waitFor(() => expect(document.getElementById('btnMatterLib')).not.toBeNull(), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fireEvent.click(document.getElementById('btnLocalBackup')!);
  const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
  vi.restoreAllMocks();
  const b = out.book;
  delete b.history;
  delete b.historyPool;
  return b;
}
const secs = async () => (await exported()).sections as Rec[];
const row = (id: string) => document.querySelector<HTMLElement>(`#structureList .sec-item[data-sec="${id}"]`)!;
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent ?? '');

describe('the sidebar structure controls', () => {
  it('row tools: move up / down (side.moveUp/Down) and the eye (side.includeInExport) act on the book', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const body = (await secs()).filter((s) => s.kind === 'body');
    const second = body[1]!.id as string, first = body[0]!.id as string;
    const up = row(second).querySelector<HTMLButtonElement>('[data-act="up"]')!;
    expect(up.getAttribute('aria-label')).toBe(E['side.moveUp']);
    expect(row(second).querySelector('[data-act="down"]')!.getAttribute('aria-label')).toBe(E['side.moveDown']);
    expect(row(second).querySelector('[data-act="eye"]')!.getAttribute('aria-label')).toBe(E['side.includeInExport']);
    await act(async () => {
      fireEvent.click(up);
    });
    const after = (await secs()).filter((s) => s.kind === 'body').map((s) => s.id);
    expect(after.slice(0, 2)).toEqual([second, first]);
    await act(async () => {
      fireEvent.click(row(second).querySelector('[data-act="eye"]')!);
    });
    expect((await secs()).find((s) => s.id === second)!.included).toBe(false);
    await waitFor(() => expect(row(second).querySelector('[data-act="eye"] svg')!.getAttribute('class')).toContain('lucide-eye-off'));
  }, 60_000);

  it('Add Chapter and Add Part (under the body) add 1.0\'s sections and open them', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const n = (await secs()).length;
    const add = document.getElementById('btnAddChapter')!;
    expect(add.closest('.og-extra')!.parentElement!.id).toBe('og-body');
    await act(async () => {
      fireEvent.click(add);
    });
    let s = await secs();
    expect(s.length).toBe(n + 1);
    const ch = s.find((x) => x.title === 'New Chapter')!;
    await waitFor(() => expect(document.querySelector('#structureList .sec-item.active')!.getAttribute('data-sec')).toBe(ch.id));
    expect(toasts().some((x) => x.includes('Chapter added'))).toBe(true);
    await act(async () => {
      fireEvent.click(document.getElementById('btnAddPart')!);
    });
    s = await secs();
    expect(s.filter((x) => x.type === 'part').length).toBeGreaterThan(0);
    expect(toasts().some((x) => x.includes(E['toast.partAdded']!))).toBe(true);
  }, 60_000);

  it('the matter library: toggle, a page added in its tier, a standing singleton marked and jumped to', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const tog = document.getElementById('btnMatterLib')!;
    expect(tog.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      fireEvent.click(tog);
    });
    expect(tog.getAttribute('aria-expanded')).toBe('true');
    const types = Array.from(document.querySelectorAll('[data-matter]')).map((b) => b.getAttribute('data-matter'));
    expect(types.length).toBe(14);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-matter="foreword"]')!);
    });
    const s = await secs();
    const fw = s.find((x) => x.type === 'foreword')!;
    expect(fw.kind).toBe('front');
    await waitFor(() => expect(document.querySelector('#structureList .sec-item.active')!.getAttribute('data-sec')).toBe(fw.id));
    const before = JSON.stringify(s);
    const tp = s.find((x) => x.type === 'titlepage');
    if (tp) {
      expect(document.querySelector('[data-matter="titlepage"]')!.classList.contains('exists')).toBe(true);
      await act(async () => {
        fireEvent.click(document.querySelector('[data-matter="titlepage"]')!);
      });
      expect(JSON.stringify(await secs())).toBe(before);
      await waitFor(() => expect(document.querySelector('#structureList .sec-item.active')!.getAttribute('data-sec')).toBe(tp.id));
    }
  }, 60_000);

  it('the section type select: 1.0\'s groups; a retype moves the section to its tier and keeps it open', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const sel = document.getElementById('secTypeSel') as HTMLSelectElement;
    expect(sel.getAttribute('aria-label')).toBe(E['editor.sectionType']);
    expect(Array.from(sel.querySelectorAll('optgroup')).map((g) => g.label)).toEqual([E['side.groupFront'], E['side.groupBody'], E['side.groupBack']]);
    const id = document.querySelector('#structureList .sec-item.active')!.getAttribute('data-sec')!;
    await act(async () => {
      fireEvent.change(sel, { target: { value: 'back:cta' } });
    });
    const s = await secs();
    const moved = s.find((x) => x.id === id)!;
    expect(moved).toMatchObject({ kind: 'back', type: 'cta' });
    await waitFor(() => expect(document.querySelector('#structureList .sec-item.active')!.getAttribute('data-sec')).toBe(id));
    await waitFor(() => expect((document.getElementById('secTypeSel') as HTMLSelectElement).value).toBe('back:cta'));
  }, 60_000);

  it('a drop across tiers is refused with toast.moveTier and nothing moves; within the tier it moves', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    await openStudio(f.book);
    const s = await secs();
    const body = s.filter((x) => x.kind === 'body');
    const back = s.find((x) => x.kind === 'back')!;
    const a = row(body[0]!.id as string);
    const dt = { effectAllowed: '', setData: () => undefined, types: [] };
    await act(async () => {
      fireEvent.dragStart(a, { dataTransfer: dt });
    });
    await act(async () => {
      fireEvent.drop(row(back.id as string), { dataTransfer: dt, clientY: 0 });
    });
    expect(JSON.stringify(await secs())).toBe(JSON.stringify(s));
    expect(toasts().some((x) => x.includes(E['toast.moveTier']!))).toBe(true);
    await act(async () => {
      fireEvent.dragStart(row(body[0]!.id as string), { dataTransfer: dt });
    });
    await act(async () => {
      fireEvent.drop(row(body[2]!.id as string), { dataTransfer: dt, clientY: 0 });
    });
    const ids = (await secs()).filter((x) => x.kind === 'body').map((x) => x.id);
    // jsdom's drag events carry no clientY: 1.0's test (clientY - top >= height / 2) reads false, a drop "before"
    expect(ids.slice(0, 3)).toEqual([body[1]!.id, body[0]!.id, body[2]!.id]);
  }, 60_000);
});
