import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import ar from '../src/generated/packs/ar.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { fixtures } from './fixtures';

/* Wave 2c, task 3 in the studio: the outline board (1.0's olRender
   markup and keys, initOutline's events).
   Review focus #4 — opening the board, switching Cards / List / Grid, the
   matter chip and every filter chip, without editing, leave the export
   exactly equal.
   Review focus #5 — keyboard: every control on the board is a native
   focusable control (or a tabbable card / row); Alt + arrows move the
   focused card (mirrored in Arabic chrome: Alt + ArrowLeft is "later"),
   focus stays on the moved card, Enter opens it on the desk; status, tags
   (Enter), a tag's delete and its Undo, a saved filter — all by keyboard
   events, in English and in Arabic chrome. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const A = ar as Record<string, string>;

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
async function openStudio(book: Rec, ui: 'en' | 'ar' = 'en') {
  if (ui !== 'en') await loadPack(ui);
  render(
    <LocaleProvider initial={ui}>
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
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
const press = async (el: Element, key: string, extra: Rec = {}) => {
  await act(async () => {
    fireEvent.keyDown(el, { key, ...extra });
  });
};
async function openBoard() {
  const tab = document.getElementById('tabBtnOutline')!;
  // a button: Enter / Space activate it, which a click event stands for in jsdom
  expect(tab.tagName).toBe('BUTTON');
  await act(async () => {
    fireEvent.click(tab);
  });
  await waitFor(() => expect(document.getElementById('olTitle')).not.toBeNull(), { timeout: 10_000 });
}
const card = (id: string) => document.querySelector<HTMLElement>(`#olRoot [data-ol="${id}"]`)!;
const bodyIds = async () => ((await exported()).sections as Rec[]).filter((s) => s.kind === 'body' && s.type !== 'part').map((s) => String(s.id));

describe('the no-edit gate (review focus #4)', () => {
  it('opening the board, every view, the matter chip and every filter chip leave the export exactly equal', async () => {
    for (const name of ['real/lantern-coast-book-one', 'real/salt-road-standalone']) {
      const f = fixtures('real').find((x) => x.name === name)!;
      await openStudio(f.book);
      const before = JSON.stringify(await exported());
      await openBoard();
      expect(document.getElementById('panelOutline')!.style.display).toBe('');
      expect(document.getElementById('panelContent')!.style.display).toBe('none');
      for (const v of ['list', 'grid', 'cards']) {
        await act(async () => {
          fireEvent.click(document.querySelector(`[data-olview="${v}"]`)!);
        });
        expect(document.querySelector(`[data-olview="${v}"]`)!.getAttribute('aria-pressed')).toBe('true');
        if (v === 'grid') expect(document.querySelector('[data-olmatter]')).toBeNull();
      }
      await act(async () => {
        fireEvent.click(document.querySelector('[data-olmatter]')!);
      });
      for (const chip of Array.from(document.querySelectorAll<HTMLElement>('[data-olst]'))) {
        await act(async () => {
          fireEvent.click(chip);
        });
        await act(async () => {
          fireEvent.click(document.querySelector(`[data-olst="${chip.getAttribute('data-olst')}"]`)!);
        });
      }
      expect(JSON.stringify(await exported())).toBe(before);
      // the view is kept per device in 1.0's shape
      expect(JSON.parse(localStorage.getItem('beuk.outline.v1')!)).toEqual({ view: 'cards', matter: true });
      cleanup();
      for (const d of await indexedDB.databases()) if (d.name) await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = () => res(); });
      localStorage.clear();
    }
  }, 120_000);
});

describe('keyboard (review focus #5)', () => {
  for (const ui of ['en', 'ar'] as const) {
    it(`every board control is reachable without a mouse; Alt + arrows move, Enter opens (${ui} chrome)`, async () => {
      const S = ui === 'ar' ? A : E;
      const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
      await openStudio(f.book, ui);
      expect(document.documentElement.getAttribute('dir')).toBe(ui === 'ar' ? 'rtl' : 'ltr');
      await openBoard();
      expect(document.getElementById('olTitle')!.textContent).toBe(S['ol.title']);
      expect(document.getElementById('olKbdHint')!.textContent).toBe(S['ol.kbdHint']);
      // every control: a native focusable element, or a card / row / band with tabindex 0
      const root = document.getElementById('olRoot')!;
      const odd = Array.from(root.querySelectorAll<HTMLElement>('[data-ol], button, input, select, textarea, summary, [data-olg]')).filter((el) => {
        if (el.hasAttribute('data-ol') && el.tagName !== 'TR') return el.tabIndex !== 0;
        return !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'TR'].includes(el.tagName);
      });
      expect(odd.map((x) => x.outerHTML.slice(0, 80))).toEqual([]);
      const ids = await bodyIds();
      const [a, b] = ids as [string, string];
      // Alt + "later" on the first card: ArrowRight in LTR, ArrowLeft in RTL (1.0's mirror); ArrowDown in both
      card(a).focus();
      await press(card(a), ui === 'ar' ? 'ArrowLeft' : 'ArrowRight', { altKey: true });
      await waitFor(async () => expect((await bodyIds()).slice(0, 2)).toEqual([b, a]));
      await waitFor(() => expect(document.activeElement).toBe(card(a)));
      expect(Array.from(document.querySelectorAll('#toasts .toast')).some((x) => x.textContent?.includes(S['chop.undo']!))).toBe(true);
      await waitFor(() => expect(document.getElementById('olLive')!.textContent).not.toBe(''));
      await press(card(a), 'ArrowUp', { altKey: true });
      await waitFor(async () => expect((await bodyIds()).slice(0, 2)).toEqual([a, b]));
      // the move buttons are buttons (Enter / Space); the first card cannot go earlier
      expect(card(a).querySelector<HTMLButtonElement>('[data-olmv="-1"]')!.disabled).toBe(true);
      // status by keyboard (a select)
      const sel = card(a).querySelector<HTMLSelectElement>('[data-olf="status"]')!;
      await act(async () => {
        fireEvent.change(sel, { target: { value: 'revised' } });
      });
      await waitFor(async () => expect(((await exported()).sections as Rec[]).find((s) => s.id === a)!.status).toBe('revised'));
      // a tag by Enter, then its chip, the manager's delete and the Undo button of its toast
      const tagin = card(a).querySelector<HTMLInputElement>('.ol-tagin')!;
      await act(async () => {
        fireEvent.change(tagin, { target: { value: 'harbour' } });
      });
      await press(tagin, 'Enter');
      await waitFor(async () => expect(((await exported()).sections as Rec[]).find((s) => s.id === a)!.tags).toEqual(['harbour']));
      await waitFor(() => expect(document.querySelector('[data-oltag="harbour"]')).not.toBeNull());
      await act(async () => {
        fireEvent.click(document.querySelector('[data-oltag="harbour"]')!);
      });
      expect(document.querySelector('[data-oltag="harbour"]')!.getAttribute('aria-pressed')).toBe('true');
      await act(async () => {
        fireEvent.click(document.querySelector('[data-oltagdel="harbour"]')!);
      });
      await waitFor(async () => expect(((await exported()).sections as Rec[]).find((s) => s.id === a)!.tags).toBeUndefined());
      // the newest toast's Undo (the move's own Undo toast may still stand before it)
      const undo = Array.from(document.querySelectorAll<HTMLButtonElement>('#toasts .toast button')).filter((x) => x.textContent === S['chop.undo']).pop()!;
      expect(undo).toBeTruthy();
      await act(async () => {
        fireEvent.click(undo);
      });
      await waitFor(async () => expect(((await exported()).sections as Rec[]).find((s) => s.id === a)!.tags).toEqual(['harbour']));
      // Enter on a card opens it on the desk
      card(b).focus();
      await press(card(b), 'Enter');
      await waitFor(() => expect(document.getElementById('panelContent')!.style.display).toBe(''));
      await waitFor(() => expect(document.querySelector('#structureList .sec-item.active')!.getAttribute('data-sec')).toBe(b));
    }, 120_000);
  }

  it('a drop across front / body / back is refused with toast.moveTier and nothing moves', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    await openStudio(f.book);
    await openBoard();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-olmatter]')!);
    });
    const before = JSON.stringify(await exported());
    const s = (JSON.parse(before) as Rec).sections as Rec[];
    const body = s.find((x) => x.kind === 'body' && x.type !== 'part')!, back = s.find((x) => x.kind === 'back')!;
    const dt = { effectAllowed: '', setData: () => undefined, types: [] };
    await act(async () => {
      fireEvent.dragStart(card(String(body.id)), { dataTransfer: dt });
    });
    await act(async () => {
      fireEvent.drop(card(String(back.id)), { dataTransfer: dt });
    });
    expect(Array.from(document.querySelectorAll('#toasts .toast')).some((x) => x.textContent?.includes(E['toast.moveTier']!))).toBe(true);
    expect(JSON.stringify(await exported())).toBe(before);
  }, 60_000);
});

describe('fix round 1', () => {
  it('a draft is written when its field goes away within 300 ms (the board left for the desk)', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    await openStudio(f.book);
    await openBoard();
    const [a] = await bodyIds();
    const syn = card(a!).querySelector<HTMLTextAreaElement>('[data-olf="synopsis"]')!;
    await act(async () => {
      fireEvent.change(syn, { target: { value: 'Typed just now.' } });
      // at once (well inside 300 ms): the board is left, its fields unmount with no blur
      fireEvent.click(document.getElementById('tabBtnContent')!);
    });
    expect(document.querySelector('#olRoot [data-olf="synopsis"]')).toBeNull();
    expect(((await exported()).sections as Rec[]).find((s) => s.id === a)!.synopsis).toBe('Typed just now.');
  }, 60_000);

  it('Draft: unmount and pagehide flush; a field re-rendered for another book still writes to the book it was typed in', async () => {
    const { Draft } = await import('../src/outline/OutlineBoard');
    const toOld: string[] = [], toNew: string[] = [];
    const r = render(<Draft value="" onCommit={(v: string) => toOld.push(v)} data-t="d" />);
    const el = () => document.querySelector<HTMLInputElement>('[data-t="d"]')!;
    fireEvent.change(el(), { target: { value: 'one' } });
    // another book's render of the same field (a book replace reusing the ids), before the 300 ms
    r.rerender(<Draft value="" onCommit={(v: string) => toNew.push(v)} data-t="d" />);
    r.unmount();
    expect(toOld).toEqual(['one']);
    expect(toNew).toEqual([]);
    // pagehide
    const got: string[] = [];
    render(<Draft value="" onCommit={(v: string) => got.push(v)} data-t="d" />);
    fireEvent.change(el(), { target: { value: 'two' } });
    window.dispatchEvent(new Event('pagehide'));
    expect(got).toEqual(['two']);
    // a commit that throws (its section gone) does not throw out of the cleanup
    const r3 = render(<Draft value="" onCommit={() => { throw new Error('gone'); }} data-t="e" />);
    fireEvent.change(document.querySelector('[data-t="e"]')!, { target: { value: 'x' } });
    expect(() => r3.unmount()).not.toThrow();
  });

  it('a filter saved under a name is the one on: its chip stays pressed (1.0 marks it active)', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    await openStudio(f.book);
    await openBoard();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-olst="none"]')!);
    });
    const name = document.getElementById('olSaveName') as HTMLInputElement;
    name.value = 'Unmarked';
    await act(async () => {
      fireEvent.click(document.getElementById('olSaveDo')!);
    });
    const saved = await exported();
    const id = ((saved.outline as Rec).filters as Rec[])[0]!.id as string;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400)); // past the board's 120 ms re-read
    });
    expect(document.querySelector(`[data-olsaved="${id}"]`)!.getAttribute('aria-pressed')).toBe('true');
  }, 60_000);

  for (const ui of ['en', 'ar'] as const) {
    it(`all four Alt + arrows move the card the right way (${ui} chrome): Up earlier, Down later; Left / Right mirrored in RTL`, async () => {
      if (ui !== 'en') await loadPack(ui);
      const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
      await openStudio(f.book, ui);
      await openBoard();
      const ids = await bodyIds();
      const [a, b] = ids as [string, string];
      // b stands second; each key moves it one place, and the opposite key brings it back
      const later = ['ArrowDown', ui === 'ar' ? 'ArrowLeft' : 'ArrowRight'];
      const earlier = ['ArrowUp', ui === 'ar' ? 'ArrowRight' : 'ArrowLeft'];
      for (const k of earlier) {
        await press(card(b), k, { altKey: true });
        await waitFor(async () => expect((await bodyIds()).slice(0, 2), k).toEqual([b, a]));
        await press(card(b), 'ArrowDown', { altKey: true });
        await waitFor(async () => expect((await bodyIds()).slice(0, 2), k + ' back').toEqual([a, b]));
      }
      for (const k of later) {
        await press(card(a), k, { altKey: true });
        await waitFor(async () => expect((await bodyIds()).slice(0, 2), k).toEqual([b, a]));
        await press(card(a), 'ArrowUp', { altKey: true });
        await waitFor(async () => expect((await bodyIds()).slice(0, 2), k + ' back').toEqual([a, b]));
      }
    }, 120_000);
  }
});
