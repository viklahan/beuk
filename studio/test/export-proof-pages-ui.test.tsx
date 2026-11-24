import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { accessSummary, PAUSABLE_FEATURES, type AccessState, type AccountAccess } from '../../src/access.js';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, loadClosure, previewEnv, setClosureLang, setClosureT } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { entitled, LOCKED_ATTR, lockedHeld, PROOF_PAGES, proofPagesNow } from '../src/export/entitled';
import { hardcoverEnv, hardcoverUsable } from '../src/export/hardcover';
import { PAGES_STYLE_ATTR } from '../src/export/pages';
import { previewStarted } from '../src/preview/preview';
import { cloudReset, loadCloud } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { installCanvas } from './print-fixture';

/* The page-by-page views of the whole book in Export (V, 2026-11-24), in the studio:
   - who gets them: the table V approved, row by row, from the answer the server really gives (src/access.ts
     accessSummary) through 1.0's lockAccessNote, which is where the studio mirrors it;
   - "Read the whole book on screen" for an account that has them: the same frame of the same string, paged from the
     page around it, with a Pages / Scroll switch, a counter, a slider and two buttons; one more sentence in the note;
   - "Flip through the printed book": 1.0's Hardcover view, full screen; where the preview pane is not on screen, the
     old words and the Print Interior View;
   - for everyone else, what test/export-proof-ui.test.tsx asserts is unchanged (that file runs signed out). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const shownWas = hardcoverEnv.shown;
beforeAll(async () => {
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  (globalThis as unknown as { JSZip: unknown }).JSZip = createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
  installCanvas();
  Range.prototype.getClientRects = function () {
    return [] as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  };
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
  cloudFacts.available = false;
  cloudFacts.user = null;
  document.documentElement.removeAttribute(LOCKED_ATTR);
  document.documentElement.removeAttribute('data-plan-access');
  setClosureT(t);
  setClosureLang('en');
  document.documentElement.setAttribute('dir', 'ltr');
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  hardcoverEnv.shown = shownWas;
  cloudReset();
  cloudFacts.user = null;
  document.documentElement.removeAttribute(LOCKED_ATTR);
  document.documentElement.removeAttribute('data-plan-access');
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
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
async function studioWith(doc: Rec) {
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnExport')?.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openExport() {
  await click($('btnExport'));
  await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
  expect(isOpen()).toBe(true);
  await tick();
}
function blobs() {
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:proof-' + ++n);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}
const frame = () => document.querySelector<HTMLIFrameElement>('#modalProof iframe');
const box = () => document.querySelector<HTMLElement>('#modalProof .modal')!;

/** The answer GET /api/auth/me gives an account in `state`: the server's own accessSummary (src/access.ts). */
function meFor(state: AccessState): Rec {
  const access = { billingOn: state !== 'open', state, trial: { startedAt: '', endsAt: '', active: state === 'trial', daysLeft: state === 'trial' ? 9 : 0 }, subscription: {}, priceLabel: null } as unknown as AccountAccess;
  return { user: { id: 'u1', email: 'w@example.org' }, access: accessSummary(access) };
}
/** Sign `me` in as the studio does: the account set, then 1.0's lockAccessNote on the answer (null: signed out). */
async function account(me: Rec | null) {
  const cloud = await loadCloud();
  await act(async () => {
    cloudFacts.user = me ? (me.user as Rec | null) : null;
    (cloud.api.lockAccessNote as (m: unknown) => void)(me);
  });
  await tick();
}

describe('who gets the page-by-page views (the table V approved, 2026-11-24)', () => {
  it('the rule: signed in, an answer held, and the answer does not lock proof.pages', () => {
    const all = Object.keys(PAUSABLE_FEATURES);
    expect(all).toContain(PROOF_PAGES);
    expect(entitled(PROOF_PAGES, true, [])).toBe(true); // billing off, in the trial, subscribed, in payment grace
    expect(entitled(PROOF_PAGES, true, all)).toBe(false); // trial ended, not paying
    expect(entitled(PROOF_PAGES, true, ['shelf.add'])).toBe(true); // a list that does not name it
    expect(entitled(PROOF_PAGES, false, [])).toBe(false); // signed out (an answer left behind does not count)
    expect(entitled(PROOF_PAGES, false, null)).toBe(false); // signed out
    expect(entitled(PROOF_PAGES, true, null)).toBe(false); // unknown: no answer yet
  });

  it("row by row, from the server's own answer through 1.0's lockAccessNote", async () => {
    await loadCloud();
    const rows: [AccessState, boolean][] = [['open', true], ['trial', true], ['subscribed', true], ['grace', true], ['paused', false]];
    for (const [state, want] of rows) {
      const me = meFor(state);
      // the server lists every pausable feature while paused, and nothing otherwise
      expect((me.access as { locked: string[] }).locked, state).toEqual(state === 'paused' ? Object.keys(PAUSABLE_FEATURES) : []);
      await account(me);
      expect(lockedHeld(), state).toEqual((me.access as { locked: string[] }).locked);
      expect(document.documentElement.getAttribute('data-plan-access'), state).toBe(state);
      expect(proofPagesNow(), state).toBe(want);
    }
    // signed out: nothing is held
    await account(null);
    expect(lockedHeld()).toBeNull();
    expect(proofPagesNow()).toBe(false);
    // the server says nobody is signed in
    await account({ user: null });
    expect(lockedHeld()).toBeNull();
    expect(proofPagesNow()).toBe(false);
    // unknown: an account is set but no answer has been mirrored yet (a sign-in in this tab, before its /api/auth/me)
    await act(async () => void (cloudFacts.user = { id: 'u1' }));
    expect(lockedHeld()).toBeNull();
    expect(proofPagesNow()).toBe(false);
    // an answer without the list, or with something that is not a list: unknown, never a yes
    await account({ user: { id: 'u1' } });
    expect(proofPagesNow()).toBe(false);
    await account({ user: { id: 'u1' }, access: { state: 'open', daysLeft: 0 } });
    expect(proofPagesNow()).toBe(false);
    await account({ user: { id: 'u1' }, access: { state: 'open', daysLeft: 0, locked: 'none' } });
    expect(proofPagesNow()).toBe(false);
    // an answer left on the page with nobody signed in: no
    await account(meFor('open'));
    expect(proofPagesNow()).toBe(true);
    await act(async () => void (cloudFacts.user = null));
    expect(lockedHeld()).toEqual([]);
    expect(proofPagesNow()).toBe(false);
  });
});

/** The frame's document as jsdom leaves it, with a small book in it whose boxes the test says: an element with
 *  data-page="n" (or data-pages="a-b") stands on page n of a frame 600 px wide. Then the frame's load is fired. */
async function bookArrives(f: HTMLIFrameElement) {
  const doc = f.contentDocument!;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  if (!doc.head) doc.documentElement.appendChild(doc.createElement('head'));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
  const body = doc.body;
  body.innerHTML =
    '<section class="book-section" data-pages="1-2"><p id="one" data-page="1">One<a id="ref" data-page="2" href="#fn1"><sup>1</sup></a></p>' +
    '<p><a id="out" data-page="2" href="https://example.org/a">a site</a></p></section>' +
    '<section class="book-section" data-pages="3-5"><p id="fn1" data-page="5">A note <a id="back" data-page="5" href="#ref">back</a></p></section>';
  const win = doc.defaultView as unknown as { Element: typeof Element };
  let left = 0;
  Object.defineProperty(body, 'scrollLeft', { configurable: true, get: () => left, set: (v: number) => void (left = v) });
  const rect = (x: number, w: number): DOMRect => ({ x, y: 40, top: 40, bottom: 60, width: w, height: 20, toJSON: () => ({}), ...{ left: x, right: x + w } }) as DOMRect;
  win.Element.prototype.getClientRects = function (this: Element) {
    if (this === body) return [] as unknown as DOMRectList;
    const pages = (this.getAttribute('data-pages') ?? this.getAttribute('data-page') ?? '').split('-').filter(Boolean).map(Number);
    const out: DOMRect[] = [];
    for (let p = pages[0] ?? 1; pages.length && p <= (pages[1] ?? pages[0]!); p++) out.push(rect((p - 1) * 600 + 22 - left, 10));
    return out as unknown as DOMRectList;
  };
  win.Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this === body) return rect(0, 600);
    return (this.getClientRects()[0] as DOMRect | undefined) ?? rect(0, 0);
  };
  await act(async () => void fireEvent.load(f));
  return { doc, body };
}
const pagingStyles = (doc: Document) => doc.querySelectorAll(`style[${PAGES_STYLE_ATTR}]`).length;
const keyOn = (el: Element, key: string, init: KeyboardEventInit = {}) => act(async () => void fireEvent.keyDown(el, { key, ...init }));

describe('"Read the whole book on screen", for an account that has the page-by-page views', { timeout: 120_000 }, () => {
  it('opens the same frame in pages: the switch, the counter, the slider, the two buttons, one more sentence; no script in the frame', async () => {
    blobs();
    await studioWith(LANTERN());
    await account(meFor('trial'));
    await openExport();
    // the same button, the same words; nothing near it speaks of plans
    expect($('btnProofRead').textContent).toBe(t('proof.read'));
    expect(document.querySelector('.exp-proof')!.textContent).not.toMatch(/plan|paid|trial|subscri|upgrade/i);
    await click($('btnProofRead'));
    expect(box().className).toBe('modal wide proof-modal proof-paged is-pages');
    await waitFor(() => expect(frame()).not.toBeNull());
    const f = frame()!;
    // the same frame as everyone's: sandboxed to the studio's own origin and nothing more, from a blob: address
    expect(f.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(f.hasAttribute('srcdoc')).toBe(false);
    expect(f.getAttribute('src')).toMatch(/^blob:/);
    // the note stays what it was, and says one thing more while the book is in pages
    expect($('proofNote').textContent).toBe(t('proof.note') + ' ' + t('proof.pagesNote'));
    expect(t('proof.pagesNote')).toMatch(/belong to this window/);
    expect($('proofNote').textContent).not.toMatch(/the EPUB a page at a time|this is the EPUB/i);
    // the switch: two real buttons in a named group, Pages pressed
    const group = document.querySelector('#modalProof .proof-view')!;
    expect([group.getAttribute('role'), group.getAttribute('aria-label')]).toEqual(['group', t('proof.view')]);
    expect([$('btnProofPages').textContent, $('btnProofPages').getAttribute('aria-pressed'), $('btnProofScroll').textContent, $('btnProofScroll').getAttribute('aria-pressed')]).toEqual([t('proof.viewPages'), 'true', t('proof.viewScroll'), 'false']);
    // jsdom has no element full screen, so the button is not offered (the dialog already fills the window)
    expect($('btnProofFull')).toBeNull();
    // until the book is in the frame and counted there is no number to say: "Page 1 of 1" over a book still loading
    // would be untrue (seen in Chromium on a long book, 2026-11-24)
    expect([$('proofCount').textContent, ($('proofSlider') as HTMLInputElement).disabled, $('btnProofNext').getAttribute('aria-disabled')]).toEqual(['', true, 'true']);
    const { doc, body } = await bookArrives(f);
    expect(pagingStyles(doc)).toBe(1);
    expect(doc.querySelectorAll('script').length).toBe(0);
    // the counter is a polite live region; the slider is named and says the same words
    const count = $('proofCount');
    expect([count.textContent, count.getAttribute('role'), count.getAttribute('aria-live')]).toEqual([t('preview.pageOf', { page: 1, count: 5 }), 'status', 'polite']);
    const slider = $('proofSlider') as HTMLInputElement;
    expect([slider.type, slider.min, slider.max, slider.value, slider.getAttribute('aria-label'), slider.getAttribute('aria-valuetext')]).toEqual(['range', '1', '5', '1', t('proof.slider'), t('preview.pageOf', { page: 1, count: 5 })]);
    expect([$('btnProofPrev').getAttribute('aria-label'), $('btnProofNext').getAttribute('aria-label')]).toEqual([t('proof.prev'), t('proof.next')]);
    expect([$('btnProofPrev').getAttribute('aria-disabled'), $('btnProofNext').getAttribute('aria-disabled')]).toEqual(['true', 'false']);
    // Tab's list: the switch, the frame, the pager, Close; no stop before the frame (the switch stands there)
    const { focusablesIn } = await import('../src/shell/Dialog');
    expect(focusablesIn(box()).map((e) => e.id || e.tagName)).toEqual(['btnProofPages', 'btnProofScroll', 'IFRAME', 'btnProofPrev', 'proofSlider', 'btnProofNext', 'btnProofClose']);
    expect(document.querySelector('#modalProof .proof-guard')).toBeNull();
    // the buttons, the slider, and the keys with the focus on the dialog (in the book they are the frame's: export-pages.test.ts)
    await click($('btnProofNext'));
    expect([count.textContent, body.scrollLeft]).toEqual([t('preview.pageOf', { page: 2, count: 5 }), 600]);
    await click($('btnProofPrev'));
    expect(count.textContent).toBe(t('preview.pageOf', { page: 1, count: 5 }));
    await act(async () => void fireEvent.change(slider, { target: { value: '4' } }));
    expect([count.textContent, body.scrollLeft, slider.value]).toEqual([t('preview.pageOf', { page: 4, count: 5 }), 1800, '4']);
    await keyOn(box(), 'ArrowRight');
    expect(count.textContent).toBe(t('preview.pageOf', { page: 5, count: 5 }));
    expect($('btnProofNext').getAttribute('aria-disabled')).toBe('true');
    await keyOn(box(), 'ArrowRight'); // held at the last page
    await keyOn(box(), 'Home');
    await keyOn(box(), 'PageDown');
    await keyOn(box(), ' ');
    expect(count.textContent).toBe(t('preview.pageOf', { page: 3, count: 5 }));
    await keyOn(box(), ' ', { shiftKey: true });
    await keyOn(box(), 'End');
    await keyOn(box(), 'PageUp');
    expect(count.textContent).toBe(t('preview.pageOf', { page: 4, count: 5 }));
    // Space on a button presses the button and turns nothing; a key in the slider is the slider's own
    await keyOn($('btnProofPages'), ' ');
    await keyOn(slider, 'ArrowRight');
    await keyOn(slider, 'Home');
    expect(count.textContent).toBe(t('preview.pageOf', { page: 4, count: 5 }));
    // an arrow with the focus on a button still turns
    await keyOn($('btnProofClose'), 'ArrowLeft');
    expect(count.textContent).toBe(t('preview.pageOf', { page: 3, count: 5 }));
    // a key outside the dialog is not this view's
    await keyOn($('btnExport'), 'ArrowRight');
    expect(count.textContent).toBe(t('preview.pageOf', { page: 3, count: 5 }));
    expect(doc.querySelectorAll('script').length).toBe(0);
    // Escape closes the proof and only the proof
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect($('modalProof')).toBeNull();
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe($('btnProofRead'));
  });

  it('a link inside the book turns to its page; a link out of it stays stopped, with the dialog saying so; Escape in the book closes', async () => {
    blobs();
    await studioWith(LANTERN());
    await account(meFor('open'));
    await openExport();
    await click($('btnProofRead'));
    await waitFor(() => expect(frame()).not.toBeNull());
    const f = frame()!;
    const { doc, body } = await bookArrives(f);
    const W = doc.defaultView as unknown as typeof globalThis;
    const press = async (id: string, type = 'click', init: MouseEventInit = {}) => {
      const ev = new W.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
      await act(async () => void doc.getElementById(id)!.dispatchEvent(ev));
      return ev;
    };
    await click($('btnProofNext'));
    expect((await press('ref')).defaultPrevented).toBe(true);
    expect([$('proofCount').textContent, body.scrollLeft]).toEqual([t('preview.pageOf', { page: 5, count: 5 }), 2400]);
    await press('back');
    expect($('proofCount').textContent).toBe(t('preview.pageOf', { page: 2, count: 5 }));
    expect(document.querySelector('#modalProof .proof-off')).toBeNull();
    // out of the book: stopped, the reader on the same page, the dialog's own line; by the middle button too
    for (const type of ['click', 'auxclick']) {
      expect((await press('out', type, { clientX: 590, button: type === 'auxclick' ? 1 : 0 })).defaultPrevented, type).toBe(true);
      expect($('proofCount').textContent, type).toBe(t('preview.pageOf', { page: 2, count: 5 }));
      expect(document.querySelector('#modalProof .proof-off')!.textContent, type).toBe(t('proof.linkOff'));
    }
    expect(frame()).toBe(f);
    // in pages the line is laid over the page's foot, inside the frame's own place (under the frame it would make the
    // page shorter and page the whole book again), and it goes with the next turn
    expect(document.querySelector('#modalProof .proof-off')!.className).toBe('proof-off proof-over');
    expect(document.querySelector('#modalProof .proof-off')!.parentElement).toBe(f.parentElement);
    expect(f.parentElement!.className).toBe('proof-stage');
    await click($('btnProofNext'));
    expect($('proofCount').textContent).toBe(t('preview.pageOf', { page: 3, count: 5 }));
    expect(document.querySelector('#modalProof .proof-off')).toBeNull();
    const esc = new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => void doc.getElementById('one')!.dispatchEvent(esc));
    expect($('modalProof')).toBeNull();
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe($('btnProofRead'));
  });

  it('the switch: Scroll takes the paging away in the same frame and the note loses its sentence; Pages puts both back; each opening starts in Pages', async () => {
    blobs();
    await studioWith(LANTERN());
    await account(meFor('subscribed'));
    await openExport();
    await click($('btnProofRead'));
    await waitFor(() => expect(frame()).not.toBeNull());
    const f = frame()!;
    const { doc, body } = await bookArrives(f);
    const before = doc.body.innerHTML;
    await click($('btnProofNext'));
    expect(body.scrollLeft).toBe(600);
    await click($('btnProofScroll'));
    expect(box().className).toBe('modal wide proof-modal proof-paged is-scroll');
    expect([$('btnProofPages').getAttribute('aria-pressed'), $('btnProofScroll').getAttribute('aria-pressed')]).toEqual(['false', 'true']);
    expect(frame()).toBe(f); // the same frame, not framed again
    expect(pagingStyles(doc)).toBe(0);
    expect(doc.querySelectorAll('style, script').length).toBe(0);
    expect(body.scrollLeft).toBe(0);
    expect(doc.body.innerHTML).toBe(before);
    expect($('proofNote').textContent).toBe(t('proof.note'));
    for (const id of ['proofCount', 'proofSlider', 'btnProofPrev', 'btnProofNext']) expect($(id), id).toBeNull();
    // in the scroll a link inside the book is the browser's own jump again, and the page keys are the browser's
    const W = doc.defaultView as unknown as typeof globalThis;
    const ev = new W.MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => void doc.getElementById('ref')!.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    const k = new W.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    await act(async () => void doc.body.dispatchEvent(k));
    expect(k.defaultPrevented).toBe(false);
    // pressing the side that is already chosen changes nothing
    await click($('btnProofScroll'));
    expect(pagingStyles(doc)).toBe(0);
    await click($('btnProofPages'));
    expect(box().className).toBe('modal wide proof-modal proof-paged is-pages');
    expect(pagingStyles(doc)).toBe(1);
    expect(doc.querySelectorAll('script').length).toBe(0);
    expect($('proofNote').textContent).toBe(t('proof.note') + ' ' + t('proof.pagesNote'));
    expect($('proofCount').textContent).toBe(t('preview.pageOf', { page: 1, count: 5 }));
    // closed in Scroll, opened again: Pages
    await click($('btnProofScroll'));
    await click($('btnProofClose'));
    expect($('modalProof')).toBeNull();
    await click($('btnProofRead'));
    expect(box().className).toBe('modal wide proof-modal proof-paged is-pages');
  });

  it('the states are said in words as before: preparing, then nothing to show for an empty book', async () => {
    blobs();
    const doc = LANTERN();
    for (const s of doc.sections as Rec[]) s.included = false;
    await studioWith(doc);
    await account(meFor('grace'));
    await openExport();
    await click($('btnProofRead'));
    expect(document.querySelector('#modalProof .proof-state')!.textContent).toBe(t('proof.preparing'));
    await waitFor(() => expect(document.querySelector('#modalProof .proof-state')!.textContent).toBe(t('proof.empty')));
    expect(frame()).toBeNull();
    expect($('proofCount')).toBeNull();
    expect(box().className).toBe('modal wide proof-modal proof-paged is-pages');
  });

  it("a paused account, and an account whose answer has not come, get the dialog as it was: the same classes, the same stop, the same note", async () => {
    blobs();
    await studioWith(LANTERN());
    for (const me of [meFor('paused'), null]) {
      await account(me);
      if (!me) await act(async () => void (cloudFacts.user = { id: 'u1' })); // signed in, no answer mirrored yet
      await openExport();
      expect([$('btnProofRead').textContent, $('btnProofPrint').textContent]).toEqual([t('proof.read'), t('proof.print')]);
      expect(document.querySelector('.exp-proof')!.textContent).not.toMatch(/plan|paid|trial|subscri|upgrade|locked/i);
      await click($('btnProofRead'));
      expect(box().className).toBe('modal wide proof-modal');
      await waitFor(() => expect(frame()).not.toBeNull());
      expect($('proofNote').textContent).toBe(t('proof.note'));
      const { focusablesIn } = await import('../src/shell/Dialog');
      expect(focusablesIn(box()).map((e) => e.id || e.tagName)).toEqual(['IFRAME', 'btnProofClose']);
      expect(document.querySelector('#modalProof .proof-guard')).not.toBeNull();
      expect(Array.from(box().children).map((x) => x.tagName + '.' + x.className)).toEqual(['H2.', 'P.m-sub', 'SPAN.proof-guard', 'IFRAME.proof-frame', 'DIV.modal-actions']);
      const { doc } = await bookArrives(frame()!);
      expect(doc.querySelectorAll('style, script').length).toBe(0);
      for (const id of ['btnProofPages', 'btnProofScroll', 'btnProofFull', 'proofCount', 'proofSlider', 'btnProofPrev', 'btnProofNext']) expect($(id), id).toBeNull();
      // a link inside the book is the browser's own, and no key turns anything
      const W = doc.defaultView as unknown as typeof globalThis;
      const ev = new W.MouseEvent('click', { bubbles: true, cancelable: true });
      await act(async () => void doc.getElementById('ref')!.dispatchEvent(ev));
      expect(ev.defaultPrevented).toBe(false);
      await click($('btnProofClose'));
      await click($('btnCloseExport'));
    }
  });
});

describe('"Flip through the printed book": 1.0\'s Hardcover view, full screen', { timeout: 120_000 }, () => {
  const stage = () => $('previewStage');
  const device = () => previewEnv.device();
  it('with the page-by-page views and the preview on screen: the button says so, opens the Hardcover view, and leaving it brings the export screen back', async () => {
    await studioWith(LANTERN());
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    hardcoverEnv.shown = () => true; // jsdom lays nothing out: the preview pane is on screen
    await account(meFor('open'));
    expect(hardcoverUsable()).toBe(true);
    await openExport();
    expect($('btnProofPrint').textContent).toBe(t('proof.flip'));
    expect(t('proof.flip')).toBe('Flip through the printed book');
    expect(device()).toBe('kindle');
    const opened = vi.spyOn($('btnOpenSpreads'), 'click');
    await click($('btnProofPrint'));
    // the export screen closed; 1.0's own view: the device, the book open at its first spread, the stage filling the
    // window (jsdom has no element full screen, so 1.0 fills the window: its own fallback)
    expect(isOpen()).toBe(false);
    expect(opened).not.toHaveBeenCalled();
    expect(isOpen('modalPrintView')).toBe(false);
    expect(device()).toBe('hardcover');
    expect(document.querySelector('#deviceBar .dev-btn.active')!.getAttribute('data-device')).toBe('hardcover');
    expect($('hcStage').hidden).toBe(false);
    expect(stage().classList.contains('fs-immersive')).toBe(true);
    const hc = (window as unknown as { beukPreview: { get: (n: string) => { open: boolean; spread: number; model: { pages: unknown[] } | null } } }).beukPreview.get('hc');
    expect(hc.spread).toBe(0);
    expect(hc.open).toBe(!!hc.model && hc.model.pages.length > 0);
    // leaving full screen by 1.0's own button: the device the preview had, the export screen again, focus on the button
    await click($('hcFull'));
    await tick();
    expect(stage().classList.contains('fs-immersive')).toBe(false);
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(device()).toBe('kindle');
    await waitFor(() => expect(document.activeElement).toBe($('btnProofPrint')));
    expect($('btnProofPrint').textContent).toBe(t('proof.flip'));
    // the watch is over: 1.0's own full screen later leaves the export screen alone
    await click($('btnCloseExport'));
    await click($('hcFull'));
    await click($('hcFull'));
    await tick();
    expect(isOpen()).toBe(false);
  });

  it('the preview pane not on screen (folded, a narrow window, Zen): the old words, and the Print Interior View as before', async () => {
    await studioWith(LANTERN());
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    await account(meFor('open'));
    expect(hardcoverUsable()).toBe(false); // jsdom lays nothing out: the stage has no box
    await openExport();
    expect($('btnProofPrint').textContent).toBe(t('proof.print'));
    await click($('btnProofPrint'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    expect(isOpen()).toBe(false);
    expect(device()).toBe('kindle');
    await click($('btnClosePrintView'));
    await waitFor(() => expect(isOpen()).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe($('btnProofPrint')));
  });

  it('the pane went out of sight after the words were read: the press opens the Print Interior View, and the words follow', async () => {
    await studioWith(LANTERN());
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    hardcoverEnv.shown = () => true;
    await account(meFor('open'));
    await openExport();
    expect($('btnProofPrint').textContent).toBe(t('proof.flip'));
    hardcoverEnv.shown = () => false;
    await click($('btnProofPrint'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    expect(device()).toBe('kindle');
    expect(stage().classList.contains('fs-immersive')).toBe(false);
    await click($('btnClosePrintView'));
    await waitFor(() => expect(isOpen()).toBe(true));
    expect($('btnProofPrint').textContent).toBe(t('proof.print'));
  });

  it('without the page-by-page views the button is as it was, whatever the preview shows: paused, signed out', async () => {
    await studioWith(LANTERN());
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    hardcoverEnv.shown = () => true;
    for (const me of [meFor('paused'), null]) {
      await account(me);
      await openExport();
      expect($('btnProofPrint').textContent).toBe(t('proof.print'));
      await click($('btnProofPrint'));
      await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
      expect(device()).toBe('kindle');
      expect(stage().classList.contains('fs-immersive')).toBe(false);
      await click($('btnClosePrintView'));
      await waitFor(() => expect(isOpen()).toBe(true));
      await click($('btnCloseExport'));
    }
  });

  it('the words follow the account without a reload: signed in, then signed out', async () => {
    await studioWith(LANTERN());
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    hardcoverEnv.shown = () => true;
    await openExport();
    expect($('btnProofPrint').textContent).toBe(t('proof.print'));
    await account(meFor('trial'));
    await waitFor(() => expect($('btnProofPrint').textContent).toBe(t('proof.flip')));
    // the plan line drawn later (1.0's billingPlanRender, which hands its plan to lockPlanNote) changes the state it
    // mirrors and never the list: with billing off it even takes the state away, and the list stays
    const cloud = await loadCloud();
    for (const plan of [{ billingOn: true, access: 'trial', trialEndsAt: '2026-12-01T00:00:00Z' }, { billingOn: false }]) {
      await act(async () => void (cloud.api.billingPlanRender as (p: unknown) => void)(plan));
      await tick();
      expect(document.documentElement.getAttribute('data-plan-access'), JSON.stringify(plan)).toBe(plan.billingOn ? 'trial' : null);
      expect(lockedHeld(), JSON.stringify(plan)).toEqual([]);
      expect($('btnProofPrint').textContent, JSON.stringify(plan)).toBe(t('proof.flip'));
    }
    await account(null);
    await waitFor(() => expect($('btnProofPrint').textContent).toBe(t('proof.print')));
  });
});
