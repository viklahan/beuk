import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { resetSidePrefsCache, SIDE_PREFS_KEY } from '../src/book/sidePrefs';
import { statsOf, statsPages } from '../src/book/stats';
import { bookState, loadClosure } from '../src/closure/index';
import { fmtNum } from '../src/history/HistoryDialog';
import { buildSample } from '../src/sample/sample';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { fixtures } from './fixtures';

/* Wave 1b, task 2: the sidebar (inventory B1, C1).
   Review focus #5: the words, characters, pages and reading time per
   section and per book equal 1.0's, on every fixture — read through 1.0's
   own statsCells arithmetic (bookWordTotal, sectionWords, sectionChars,
   READ_WPM, the 250-words page fallback) in the closure. The collapse
   preference is beuk.sidebar.v1 in 1.0's shape.
   1.0 self-checks re-expressed: ui.sidebar.collapse, ui.outline.groups
   (the folding half; Add Chapter, Add a page, drag and move are wave 2). */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;

beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  resetSidePrefsCache();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

describe('the counts equal 1.0\'s (review focus #5)', () => {
  it('per book and per section, on every fixture, through 1.0\'s own functions', async () => {
    const c = await loadClosure();
    for (const f of fixtures('all')) {
      const ydoc = new Y.Doc();
      try {
        importBook(f.book, ydoc);
      } catch {
        continue; // a fixture readBook refuses never opens
      }
      const st = statsOf(c, ydoc);
      // 1.0's statsCells, line for line, on its own state
      const { state } = bookState(c, ydoc);
      c.setState(state);
      const inc = state.sections.filter((s) => s.included);
      const total = c.api.bookWordTotal();
      expect(st.words, f.name).toBe(total);
      expect(st.words, f.name).toBe(inc.reduce((n, s) => n + c.api.sectionWords(s), 0));
      expect(st.chars, f.name).toBe(inc.reduce((n, s) => n + c.api.sectionChars(s), 0));
      expect(st.pages, f.name).toBe(total > 0 ? Math.ceil(total / 250) : 0);
      expect(st.minutes, f.name).toBe(Math.round(total / 238));
      expect(st.readWpm).toBe(238);
      state.sections.forEach((s, i) => {
        const key = typeof s.id === 'string' && s.id ? s.id : String(i);
        const row = st.sections.get(key)!;
        expect(row.words, `${f.name} ${key}`).toBe(c.api.sectionWords(s));
        expect(row.inBook).toBe(c.api.inBook(s));
        expect(row.emptyOut).toBe(!!s.included && c.api.emptyOut(s));
      });
    }
  });

  it('statsPages without a reading desk is 1.0\'s fallback', () => {
    expect(statsPages(0)).toBe(0);
    expect(statsPages(1)).toBe(1);
    expect(statsPages(250)).toBe(1);
    expect(statsPages(251)).toBe(2);
  });

  it('the sample-scale book counts 1.0\'s SAMPLE_WORDS', async () => {
    const c = await loadClosure();
    const ydoc = new Y.Doc();
    importBook(buildSample(c, null), ydoc);
    expect(statsOf(c, ydoc).words).toBe(c.api.SAMPLE_WORDS);
  });
});

const backupFile = (book: unknown, name: string) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], name, { type: 'application/json' });

async function openStudio(book: Rec) {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  const input = document.querySelector('#btnOpenBackup + input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [backupFile(book, 'a.beuk-backup.json')] } });
  });
  await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
  await waitFor(() => expect(document.querySelector('.sec-wc')).not.toBeNull(), { timeout: 20_000 });
}

describe('the outline and the statistics disclosure, in the studio', () => {
  it('ui.sidebar.collapse: one tools row; the disclosure toggles, is closed by default, remembered in beuk.sidebar.v1; the summary carries the counts', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const row = document.getElementById('sideTools')!, body = document.getElementById('sideStatusBody')!, head = document.getElementById('btnSideStatus')!;
    for (const id of ['btnInsights', 'btnGoals', 'btnHistory']) {
      const b = document.getElementById(id)!;
      expect(b.parentElement).toBe(row);
      expect(body.contains(b)).toBe(false);
      expect(b.querySelector('.side-tool-lab')!.textContent!.trim()).not.toBe('');
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('data-tip')).toBeTruthy(); // 2.0 names the tooltip by key (BEUK:tips), not by title
      expect(b.querySelector('svg')).not.toBeNull();
    }
    expect(head.tagName).toBe('BUTTON');
    expect(head.getAttribute('aria-controls')).toBe('sideStatusBody');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem(SIDE_PREFS_KEY)!)).toEqual({ statusOpen: true, groups: { front: false, body: false, back: false } });
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem(SIDE_PREFS_KEY)!).statusOpen).toBe(false);

    const c = await loadClosure();
    const y = new Y.Doc();
    importBook(f.book, y);
    const total = statsOf(c, y).words;
    const sum = document.getElementById('sideStatusSummary')!.textContent!;
    expect(sum).toContain(fmtNum(total, 'en'));
    expect(sum).toContain(fmtNum(statsPages(total), 'en'));
    expect(document.getElementById('statWords')!.textContent).toBe(fmtNum(total, 'en'));
    expect(document.getElementById('statsNote')!.textContent).toBe(E['stats.pagesNote']!.replace('{a}', '250').replace('{b}', '238'));
  });

  it('ui.outline.groups: three toggles with counts; folding hides rows but never the active one; choosing a folded section opens its group; rows carry 1.0\'s word counts', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    const c = await loadClosure();
    const y = new Y.Doc();
    importBook(f.book, y);
    const { state } = bookState(c, y);
    const list = document.getElementById('structureList')!;
    const tog = (g: string) => list.querySelector<HTMLButtonElement>(`.group-toggle[data-og="${g}"]`)!;
    const rowsOf = (g: string) => Array.from(list.querySelectorAll<HTMLElement>(`#og-${g} .sec-item`));
    const shown = (el: Element | null) => !!el && !el.classList.contains('og-hidden');
    const kindOf = (k: unknown) => (k === 'front' ? 'front' : k === 'body' ? 'body' : 'back');
    for (const g of ['front', 'body', 'back']) {
      const n = state.sections.filter((s) => kindOf(s.kind) === g).length;
      if (!n && g !== 'body') {
        expect(tog(g)).toBeNull();
        continue;
      }
      expect(tog(g).getAttribute('aria-expanded')).toBe('true');
      expect(tog(g).getAttribute('aria-controls')).toBe('og-' + g);
      expect(document.getElementById('og-' + g)).not.toBeNull();
      expect(tog(g).querySelector('.og-count')!.textContent).toBe(fmtNum(n, 'en'));
      expect(tog(g).getAttribute('aria-label')).toBe(E[`side.group${g[0]!.toUpperCase()}${g.slice(1)}`] + ' — ' + (n === 1 ? E['side.groupCount'] : E['side.groupCountPlural'])!.replace('{n}', String(n)));
      expect(rowsOf(g).length).toBe(n);
    }
    // each row: 1.0's count text ("Empty" for a page left out, else "<n> w"), .excluded when not in the book
    c.setState(state);
    state.sections.forEach((s) => {
      const el = list.querySelector<HTMLElement>(`.sec-item[data-sec="${String(s.id)}"]`)!;
      const wc = el.querySelector('.sec-wc')!.textContent;
      const out = !!s.included && c.api.emptyOut(s);
      const w = c.api.sectionWords(s);
      expect(wc).toBe(out ? E['side.emptyOutShort'] : fmtNum(w, 'en') + ' ' + E['side.wordUnit']);
      expect(el.classList.contains('excluded')).toBe(!c.api.inBook(s));
    });
    // fold front: its rows hide (the active row is a body chapter), body stays
    fireEvent.click(tog('front'));
    expect(tog('front').getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf('front').some(shown)).toBe(false);
    expect(rowsOf('body').every(shown)).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDE_PREFS_KEY)!).groups.front).toBe(true);
    // arriving at a folded section opens its group
    const fsec = rowsOf('front').find((r) => r.getAttribute('aria-disabled') !== 'true')!;
    await act(async () => {
      fireEvent.click(fsec);
    });
    await waitFor(() => expect(tog('front').getAttribute('aria-expanded')).toBe('true'));
    expect(shown(fsec)).toBe(true);
    // folding the active group keeps the active row
    fireEvent.click(tog('front'));
    const act0 = list.querySelector('.sec-item.active')!;
    expect(shown(act0)).toBe(true);
    expect(rowsOf('front').filter((r) => !r.classList.contains('active')).some(shown)).toBe(false);
  });

  it('reads a fold saved by 1.0 (beuk.sidebar.v1) and keeps unknown keys out, as 1.0 does', async () => {
    localStorage.setItem(SIDE_PREFS_KEY, JSON.stringify({ statusOpen: true, groups: { back: true, front: 'yes' }, extra: 1 }));
    resetSidePrefsCache();
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await openStudio(f.book);
    expect(document.getElementById('btnSideStatus')!.getAttribute('aria-expanded')).toBe('true');
    const back = document.querySelector('.group-toggle[data-og="back"]');
    if (back) expect(back.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.group-toggle[data-og="front"]')?.getAttribute('aria-expanded') ?? 'true').toBe('true');
  });
});
