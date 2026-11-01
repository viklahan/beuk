import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { loadClosure, setClosureT, type Closure, type TourStep } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { sampleShippedWords } from '../src/sample/sample';
import { tour, tourAct, tourAvailable, tourEnd, tourGo, tourInit, tourStart, tourTeardown, tourTick, type TourHost } from '../src/tour/tour';

/* Wave 1c, task 1: the quick tour (inventory I7), 1.0's BEUK:tour.
   1.0 self-checks re-expressed here: tour.fresh-device-only,
   tour.never-over-dialog-or-zen, tour.skip-ends-for-good (with 2.0's last
   step: the ways in 2.0 can act on). tour.targets-visible and
   tour.no-overflow-rtl-phone need a real layout: e2e/shell.mjs. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});
beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  tourTeardown();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.body.className = '';
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

/** 2.0's shell, as far as the tour's targets go: Import (disabled until wave 6), the sample, Export. */
function shellTargets() {
  document.body.innerHTML =
    '<button id="btnImport" aria-disabled="true">Import</button><nav id="mobileTabs"><button data-mpane="structure"></button><button data-mpane="center" data-mstyle="1"></button><button data-mpane="preview"></button></nav>' +
    '<button id="btnSampleStory">Sample</button><button id="tabBtnContent">Content</button><button id="btnExport">Export</button><button id="btnTourAgain" class="tour-again">Show</button>';
}

function host(over: Partial<TourHost> = {}): TourHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    steps: c.api.TOUR_STEPS,
    decide: c.api.tourDecide,
    key: c.api.TOUR_KEY,
    deskKey: c.api.TOUR_DESK_KEY,
    t,
    emptyDesk: () => true,
    edits: () => 0,
    restoring: () => false,
    sampleLoaded: () => false,
    importReady: () => false,
    canWrite: () => false,
    loadSample: () => void calls.push('sample'),
    write: () => void calls.push('write'),
    toast: (m) => void calls.push('toast:' + m),
    calls,
    ...over,
  };
}

describe('the tour is 1.0\'s: its steps, keys and decision come from 1.0 (the closure)', () => {
  it('tour.fresh-device-only: offered only on a fresh device; never once finished or skipped, never where beuk.desk is set or a book is on the desk, not at all without storage', () => {
    const cases: [Rec, boolean, string][] = [
      [{ storage: true, stored: null, desk: null, empty: true }, true, 'fresh device'],
      [{ storage: true, stored: 'done', desk: null, empty: true }, false, 'finished before'],
      [{ storage: true, stored: 'skipped', desk: null, empty: true }, false, 'skipped before'],
      [{ storage: true, stored: null, desk: '1', empty: true }, false, 'beuk.desk set'],
      [{ storage: true, stored: null, desk: null, empty: false }, false, 'a book on the desk'],
      [{ storage: false, stored: null, desk: null, empty: true }, false, 'no storage'],
    ];
    for (const [d, want, why] of cases) expect(c.api.tourDecide(d as never), why).toBe(want);
    expect(c.api.TOUR_KEY).toBe('beuk.tour.v1');
    expect(c.api.TOUR_DESK_KEY).toBe('beuk.desk');
    // the sample on the desk reads as a book
    expect(sampleShippedWords(c)).toBeGreaterThan(0);
  });

  it('2.0 shows the steps whose control it has (1.0\'s missing-target test on each anchor\'s first selector): Bring your book in, Export', () => {
    shellTargets();
    const ids = tourAvailable(c.api.TOUR_STEPS).map((s) => s.id);
    expect(c.api.TOUR_STEPS.map((s: TourStep) => s.id)).toEqual(['start', 'write', 'type', 'export']);
    expect(ids).toEqual(['start', 'export']);
    // a control arriving later brings its step back by itself
    const dev = document.createElement('div');
    dev.id = 'deviceBar';
    document.body.appendChild(dev);
    expect(tourAvailable(c.api.TOUR_STEPS).map((s) => s.id)).toEqual(['start', 'write', 'export']);
  });
});

describe('the card (1.0\'s tourBuild / tourRender)', () => {
  it('1.0\'s ids, roles and texts; Step n of total counts 2.0\'s steps; Back hidden on the first, Next hidden on the last', () => {
    shellTargets();
    const off = tourInit(host());
    tourStart({ replay: true, dry: true });
    const card = document.getElementById('tourCard')!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('false');
    expect(card.getAttribute('data-step')).toBe('start');
    expect(document.getElementById('tourCount')!.textContent).toBe(t('tour.count', { step: '1', total: '2' }));
    expect(document.getElementById('tourTitle')!.textContent).toBe(t('tour.s1t'));
    expect(document.getElementById('tourBody')!.textContent).toBe(t('tour.s1b', { import: t('side.import'), studio: t('tab.type'), export: t('top.export') }));
    expect(document.getElementById('tourBack')!.hidden).toBe(true);
    expect(document.getElementById('tourLive')!.textContent).toBe(t('tour.live', { step: '1', total: '2', title: t('tour.s1t') }));
    expect(document.activeElement).toBe(document.getElementById('tourTitle'));
    tourGo(1, 'next');
    expect(card.getAttribute('data-step')).toBe('export');
    expect(document.getElementById('tourNext')!.hidden).toBe(true);
    expect(document.getElementById('tourActs')!.hidden).toBe(false);
    off();
    expect(document.getElementById('tourCard')).toBeNull();
  });

  it('tour.never-over-dialog-or-zen: hidden while a dialog is open and in Zen, back at the same step after both; not modal, no backdrop', () => {
    shellTargets();
    const off = tourInit(host());
    tourStart({ replay: true, dry: true });
    tourGo(1, '');
    const card = () => document.getElementById('tourCard')!;
    const ringsShown = () => tour.rings.filter((r) => !r.hidden).length;
    expect(card().hidden).toBe(false);
    const m = document.createElement('div');
    m.className = 'modal-back open';
    m.id = 'modalSettings';
    document.body.appendChild(m);
    tourTick();
    expect(card().hidden).toBe(true);
    expect(ringsShown()).toBe(0);
    m.classList.remove('open');
    tourTick();
    expect(card().hidden).toBe(false);
    document.body.classList.add('zen');
    tourTick();
    expect(card().hidden).toBe(true);
    document.body.classList.remove('zen');
    tourTick();
    expect(card().hidden).toBe(false);
    expect(tour.step).toBe(1);
    // not modal, and nothing drawn behind it: the tour adds only its card, its live region and its rings
    expect(card().getAttribute('aria-modal')).toBe('false');
    expect(document.querySelectorAll('.modal-back.open').length).toBe(0);
    off();
  });

  it('tour.skip-ends-for-good: Esc and Skip store "skipped" (never offered again); Esc closing an open menu leaves the tour; the last step offers the ways in and no Next, focus in the card', () => {
    shellTargets();
    const h = host({ canWrite: () => true });
    const off = tourInit(h);
    tourStart({ replay: true, dry: true });
    tourGo(1, 'next');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(tour.active).toBe(false);
    expect(tour.wouldStore).toBe('skipped');
    tourStart({ replay: true, dry: true });
    document.getElementById('tourSkip')!.click();
    expect(tour.active).toBe(false);
    expect(tour.wouldStore).toBe('skipped');
    expect(c.api.tourDecide({ storage: true, stored: 'skipped', desk: null, empty: true })).toBe(false);
    // the language menu open, focus outside the card: Esc closes the menu, not the tour
    tourStart({ replay: true, dry: true });
    const menu = document.createElement('div');
    menu.id = 'uiLangMenu';
    menu.getClientRects = () => [{ width: 10, height: 10 }] as unknown as DOMRectList;
    document.body.appendChild(menu);
    (document.activeElement as HTMLElement).blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(tour.active).toBe(true);
    menu.remove();
    tourGo(1, 'next');
    const acts = [...document.querySelectorAll<HTMLElement>('#tourActs [data-tour-act]')].filter((b) => !b.hidden).map((b) => b.getAttribute('data-tour-act'));
    expect(document.getElementById('tourNext')!.hidden).toBe(true);
    // Import waits for its wave (aria-disabled): 2.0 offers the two ways it can act on
    expect(acts).toEqual(['sample', 'write']);
    expect(document.getElementById('tourCard')!.contains(document.activeElement)).toBe(true);
    off();
  });

  it('a real Skip stores "skipped" in 1.0\'s shape, says so with 1.0\'s toast, and gives focus back; an act stores "done" and then acts', () => {
    shellTargets();
    const h = host({ importReady: () => true });
    const off = tourInit(h);
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 1280, configurable: true });
    const opener = document.getElementById('btnExport')!;
    opener.getClientRects = () => [{}] as unknown as DOMRectList;
    opener.getBoundingClientRect = () => ({ left: 10, right: 60, top: 10, bottom: 30, width: 50, height: 20 }) as DOMRect;
    opener.focus();
    tourStart({ replay: true });
    document.getElementById('tourSkip')!.focus();
    tourEnd('skipped');
    expect(localStorage.getItem('beuk.tour.v1')).toBe('skipped');
    expect(h.calls).toContain('toast:' + t('tour.skipped'));
    expect(document.activeElement).toBe(opener);
    localStorage.clear();
    tourStart({ replay: true });
    tourGo(1, 'next');
    tourAct('sample');
    expect(localStorage.getItem('beuk.tour.v1')).toBe('done');
    expect(h.calls).toContain('sample');
    expect(tour.active).toBe(false);
    off();
  });

  it('it ends at the writer\'s first action: a real edit, or a book arriving on a desk that was empty; a replay over a book ends only at a real edit', () => {
    shellTargets();
    let edits = 0, empty = true;
    const off = tourInit(host({ edits: () => edits, emptyDesk: () => empty }));
    tourStart({});
    edits = 1;
    tourTick();
    expect(tour.active).toBe(false);
    expect(localStorage.getItem('beuk.tour.v1')).toBe('done');
    localStorage.clear();
    edits = 0;
    tourStart({});
    empty = false;
    tourTick();
    expect(tour.active).toBe(false);
    // over a book: opening it again changes nothing, an edit ends it
    tourStart({ replay: true });
    tourTick();
    expect(tour.active).toBe(true);
    edits = 2;
    tourTick();
    expect(tour.active).toBe(false);
    off();
  });
});

describe('in the studio', () => {
  it('a fresh device with an empty desk is offered the tour at a quiet moment; "Show the quick tour" brings it back after Skip', async () => {
    const r = render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('tourCard')).not.toBeNull(), { timeout: 5000 });
    expect(document.getElementById('tourCard')!.getAttribute('data-step')).toBe('start');
    act(() => document.getElementById('tourSkip')!.click());
    expect(localStorage.getItem('beuk.tour.v1')).toBe('skipped');
    expect(document.getElementById('tourCard')).toBeNull();
    await waitFor(() => expect(document.getElementById('btnTourAgain')).not.toBeNull());
    act(() => document.getElementById('btnTourAgain')!.click());
    expect(document.getElementById('tourCard')).not.toBeNull();
    r.unmount();
  });

  it('never offered once finished: beuk.tour.v1 = "done" written by 1.0 keeps it away', async () => {
    localStorage.setItem('beuk.tour.v1', 'done');
    const r = render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnTourAgain')).not.toBeNull());
    await new Promise((res) => setTimeout(res, 1200));
    expect(document.getElementById('tourCard')).toBeNull();
    r.unmount();
  });
});
