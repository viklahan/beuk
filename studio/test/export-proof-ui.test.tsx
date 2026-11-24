import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset, exportRun } from '../src/export/state';
import { EXPORT_GROUPS } from '../src/export/groups';
import { cloudReset, loadCloud } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { installCanvas } from './print-fixture';

/* The export screen in the studio (V, 2026-11-23): a proof of the whole book offered first — an offer, never a gate —
   then the formats in six groups with only the chosen one open (src/export/groups.ts, src/export/Proof.tsx).
   - "Read the whole book on screen" frames exactly what 1.0's buildStandaloneHtml() returns for the open book, built in
     the export session, in a frame with no script and no same-origin, on the dialog stack. Its states are said in
     words: preparing, nothing to show, the error.
   - "Turn the print pages" is 1.0's own Print Interior View (#btnOpenSpreads); closing it brings the writer back to the
     export screen (1.0's view closes the export screen as it opens: that is unchanged).
   - 1.0's handlers still hear their buttons inside the groups, and what 1.0 shows or scrolls to opens its group. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  (globalThis as unknown as { JSZip: unknown }).JSZip = createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
  installCanvas();
  // jsdom measures no text: 1.0's notes-at-the-foot layout (pivFootnoteLayout) reads a range's boxes
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
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  cloudReset();
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
const head = (id: string) => document.querySelector<HTMLButtonElement>(`#modalExport [data-exg="${id}"] .exg-head`)!;
const body = (id: string) => document.querySelector<HTMLElement>(`#modalExport [data-exg="${id}"] .exg-body`)!;
const openIds = () => EXPORT_GROUPS.map((g) => g.id).filter((id) => head(id).getAttribute('aria-expanded') === 'true');
const groupOf = (el: Element | null): string | null => el?.closest('[data-exg]')?.getAttribute('data-exg') ?? null;
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
/** What the proof's frame holds: the blobs handed to URL.createObjectURL, by the address each was given. */
function blobs() {
  const made = new Map<string, Blob>();
  const revoked: string[] = [];
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    const u = 'blob:proof-' + ++n;
    made.set(u, b as Blob);
    return u;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
  return { made, revoked };
}
const frame = () => document.querySelector<HTMLIFrameElement>('#modalProof iframe');
const state = () => document.querySelector<HTMLElement>('#modalProof .proof-state');

describe('the export screen: a proof first, then the formats in groups', { timeout: 120_000 }, () => {
  it('opens short: the proof offered above Store-ready, six closed groups under real buttons, Close below; nothing waits on the proof', async () => {
    await studioWith(LANTERN());
    await openExport();
    const box = document.querySelector('#modalExport .modal')!;
    expect(Array.from(box.children).map((x) => x.id || x.className)).toEqual(['expH', 'm-sub', 'exp-proof', 'st-entry', 'exg-list', 'modal-actions']);
    // the proof: a heading, one plain sentence, two buttons
    const proof = box.querySelector('.exp-proof')!;
    expect(proof.querySelector('h3')!.textContent).toBe(t('proof.h'));
    expect(proof.querySelector('p')!.textContent).toBe(t('proof.sub'));
    expect(Array.from(proof.querySelectorAll('button')).map((b) => [b.id, b.textContent, b.type])).toEqual([['btnProofRead', t('proof.read'), 'button'], ['btnProofPrint', t('proof.print'), 'button']]);
    // the groups: closed, named in the interface's words, with their one line
    expect(openIds()).toEqual([]);
    for (const g of EXPORT_GROUPS) {
      expect(head(g.id).querySelector('.exg-title')!.textContent, g.id).toBe(t(g.title));
      expect(head(g.id).querySelector('.exg-sub')!.textContent, g.id).toBe(t(g.sub));
      expect(head(g.id).querySelectorAll('svg').length, g.id).toBe(2);
      expect(body(g.id).hidden, g.id).toBe(true);
    }
    // signed out, no shelf: 1.0 hides the archive, and nothing else is in its group, so its header is hidden too
    expect($('archiveSec').style.display).toBe('none');
    expect((document.querySelector('[data-exg="archive"]') as HTMLElement).hidden).toBe(!$('betaSec'));
    // an offer, never a gate: before the proof was ever opened, every export's own button is there and enabled
    for (const id of ['btnStoreReady', 'btnBuildEpub', 'btnInspect', 'btnValidate', 'btnA11y', 'btnPreflight', 'btnOpenPrintView', 'btnOpenSpreads', 'btnDownloadPrintHtml', 'btnPrintReadyPdf', 'btnDownloadMd', 'btnCopyMd',
      'btnDownloadHtml', 'btnDownloadDocx', 'btnMsOpen', 'btnAcxOpen', 'btnBoxSetAdd', 'btnBuildBoxSet', 'btnCloseExport']) {
      expect(($(id) as HTMLButtonElement).disabled, id).toBe(false);
    }
    // the keyboard's way through the open screen: the proof, Store-ready, the six headers that show, Close (a closed group's controls are not in it)
    const { focusablesIn } = await import('../src/shell/Dialog');
    const shownHeads = EXPORT_GROUPS.filter((g) => !(document.querySelector(`[data-exg="${g.id}"]`) as HTMLElement).hidden).map((g) => 'exgHead-' + g.id);
    expect(focusablesIn(box as HTMLElement).map((e) => e.id)).toEqual(['btnProofRead', 'btnProofPrint', 'btnStoreReady', ...shownHeads, 'btnCloseExport']);
  });

  it("1.0's own handlers hear their buttons inside a group; one group is open at a time; the screen opens closed again", async () => {
    await studioWith(LANTERN());
    await openExport();
    await click(head('ebook'));
    expect(openIds()).toEqual(['ebook']);
    // 1.0's runValidation, on 1.0's own button
    await click($('btnValidate'));
    expect($('validateResults').style.display).toBe('');
    expect($('validateResults').textContent!.length).toBeGreaterThan(20);
    // 1.0's preset buttons, drawn by 1.0 into the grid inside the group
    await click(document.querySelector('[data-platform="kdp"]'));
    expect(document.querySelector('#platformGrid .active')!.getAttribute('data-platform')).toBe('kdp');
    await click(document.querySelector('[data-platform="generic"]'));
    await click(head('print'));
    expect(openIds()).toEqual(['print']);
    // 1.0's runPrintPreflight (print's module), on 1.0's own button
    await click($('btnPreflight'));
    expect($('preflightResults').style.display).toBe('');
    expect($('preflightResults').textContent!.length).toBeGreaterThan(20);
    await click(head('files'));
    expect(openIds()).toEqual(['files']);
    await click($('btnCloseExport'));
    expect(isOpen()).toBe(false);
    await openExport();
    expect(openIds()).toEqual([]);
  });

  it("what 1.0 shows or scrolls to from outside a group opens it: the store check's Validate and its print link", async () => {
    await studioWith(LANTERN());
    await openExport();
    expect(openIds()).toEqual([]);
    // 1.0's storeAct, as the store-ready check's own links call it: "validate" runs the validator into #validateResults
    await act(async () => void exportRun((cc) => cc.api.storeAct({ kind: 'validate' })));
    await tick();
    expect($('validateResults').style.display).toBe('');
    expect(openIds()).toEqual(['ebook']);
    // "print": 1.0's preflightJumpTo scrolls to the trim sizes (jsdom has no scrollIntoView: the group opens all the same)
    await act(async () => void exportRun((cc) => cc.api.storeAct({ kind: 'print' })));
    expect(openIds()).toEqual(['print']);
    expect($('trimGrid').closest('[hidden]')).toBeNull();
  });

  it("\"Read the whole book on screen\" frames exactly 1.0's buildStandaloneHtml(), with no script and no same-origin, on the dialog stack", async () => {
    const { made, revoked } = blobs();
    await studioWith(LANTERN());
    await openExport();
    await click($('btnProofRead'));
    // said in words while it builds: never a blank frame
    expect(isOpen('modalProof')).toBe(true);
    expect($('proofH').textContent).toBe(t('proof.title'));
    expect(state()!.textContent).toBe(t('proof.preparing'));
    expect(state()!.getAttribute('role')).toBe('status');
    expect(frame()).toBeNull();
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(state()).toBeNull();
    const f = frame()!;
    // the frame: sandboxed with nothing allowed (no script, no same-origin), named for a screen reader
    expect(f.hasAttribute('sandbox')).toBe(true);
    expect(f.getAttribute('sandbox')).toBe('');
    expect(f.hasAttribute('srcdoc')).toBe(false);
    expect(f.getAttribute('title')).toBe(t('proof.frame'));
    // what it holds is 1.0's standalone page for the open book, to the character, as an HTML document
    const blob = made.get(f.getAttribute('src')!)!;
    expect(blob.type).toBe('text/html;charset=utf-8');
    const want = exportRun((cc) => cc.api.buildStandaloneHtml() as string)!;
    expect(want.length).toBeGreaterThan(5000);
    expect(want.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(await blob.text()).toBe(want);
    // what this view is, said in the dialog
    expect(document.querySelector('#modalProof .m-sub')!.textContent).toBe(t('proof.note'));
    // on the dialog stack: the export screen stays open under it; Escape closes only the proof; focus returns to its button
    expect(isOpen()).toBe(true);
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect($('modalProof')).toBeNull();
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe($('btnProofRead'));
    expect(revoked).toEqual([f.getAttribute('src')]);
    // opened again, it is built again from the book as it now stands
    await click($('btnProofRead'));
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(await made.get(frame()!.getAttribute('src')!)!.text()).toBe(want);
    await click(document.querySelector('#modalProof #btnProofClose'));
    expect($('modalProof')).toBeNull();
    expect(isOpen()).toBe(true);
  });

  it('a book with nothing in it says so in words, and no frame is shown', async () => {
    blobs();
    const doc = LANTERN();
    for (const s of doc.sections as Rec[]) s.included = false;
    await studioWith(doc);
    await openExport();
    await click($('btnProofRead'));
    await waitFor(() => expect(state()!.textContent).toBe(t('proof.empty')));
    expect(frame()).toBeNull();
    expect(exportRun((cc) => (cc.getState().sections as Rec[]).filter((s) => cc.api.inBook(s)).length)).toBe(0);
  });

  it('when building the page throws, the error is shown in words, and no frame', async () => {
    blobs();
    await studioWith(LANTERN());
    await openExport();
    vi.spyOn(c.api, 'buildStandaloneHtml').mockImplementation(() => {
      throw new Error('the page fell over at section 7');
    });
    await click($('btnProofRead'));
    await waitFor(() => expect(state()!.textContent).toBe(t('proof.failed', { error: 'the page fell over at section 7' })));
    expect(state()!.getAttribute('role')).toBe('alert');
    expect(frame()).toBeNull();
  });

  it('a link followed inside the frame never leaves it blank: the book is framed again, and the dialog says why', async () => {
    const { made } = blobs();
    await studioWith(LANTERN());
    await openExport();
    await click($('btnProofRead'));
    await waitFor(() => expect(frame()).not.toBeNull());
    const first = frame()!;
    const url = first.getAttribute('src')!;
    await act(async () => void fireEvent.load(first)); // the book arrives
    expect(frame()).toBe(first);
    expect(document.querySelector('#modalProof .proof-off')).toBeNull();
    await act(async () => void fireEvent.load(first)); // the frame went somewhere else (a link in the book)
    const again = frame()!;
    expect(again).not.toBe(first);
    expect(again.getAttribute('src')).toBe(url);
    expect(again.getAttribute('sandbox')).toBe('');
    expect(made.size).toBe(1);
    expect(document.querySelector('#modalProof .proof-off')!.textContent).toBe(t('proof.linkOff'));
  });

  it("\"Turn the print pages\" is 1.0's Print Interior View; closing it brings the writer back to the export screen", async () => {
    await studioWith(LANTERN());
    await openExport();
    await click(head('files'));
    await click($('btnProofPrint'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    // 1.0's openPrintInteriorView closes the export screen as the view opens (unchanged)
    expect(isOpen()).toBe(false);
    expect($('pivCounter').textContent).toMatch(/^Spread 1 of \d+ · Page 1$/);
    const topFocus = vi.spyOn($('btnExport'), 'focus');
    await click($('btnClosePrintView'));
    expect(isOpen('modalPrintView')).toBe(false);
    await waitFor(() => expect(isOpen()).toBe(true));
    await tick();
    expect(openIds()).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe($('btnProofPrint')));
    // the top bar's Export held the focus as the screen opened again, so the screen's close returns it there: Escape
    // closes the export screen and the dialog stack focuses the top bar's Export a second time. (Where focus then
    // RESTS is not asserted here: jsdom lays nothing out, so React's own after-commit restore can focus a control inside
    // the closed, hidden modal, which a browser cannot.)
    expect(topFocus).toHaveBeenCalledTimes(1);
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(isOpen()).toBe(false);
    expect(topFocus).toHaveBeenCalledTimes(2);
    // 1.0's own button for the view (in the Print group) is as it was: closing the view leaves the studio, not the export screen
    await openExport();
    await click(head('print'));
    await click($('btnOpenSpreads'));
    await waitFor(() => expect(isOpen('modalPrintView')).toBe(true));
    await click($('btnClosePrintView'));
    await tick();
    expect(isOpen('modalPrintView')).toBe(false);
    expect(isOpen()).toBe(false);
  });

  it("the share section 1.0's cloud module injects lands in the archive group, and again when the modal is built for another book", async () => {
    await studioWith(LANTERN());
    const cm = await loadCloud();
    await act(async () => void cm.api.betaInjectDom());
    await openExport();
    expect($('betaSec')).not.toBeNull();
    expect($('archiveSec').nextElementSibling).toBe($('betaSec'));
    expect(groupOf($('betaSec'))).toBe('archive');
    expect(groupOf($('archiveSec'))).toBe('archive');
    // the share section shows (signed out: its sign-in line), so the group's header does
    expect((document.querySelector('[data-exg="archive"]') as HTMLElement).hidden).toBe(false);
    await click($('btnCloseExport'));
    // another book: the modal's markup is placed anew, and the export modal itself runs 1.0's betaInjectDom on it
    // (ExportModal, once the modal is built: after the grouping)
    const first = $('modalExport');
    cleanup();
    expect($('betaSec')).toBeNull();
    await studioWith(structuredClone(fixtures('real').find((f) => f.name === 'real/salt-road-book-one')!.book) as Rec);
    await waitFor(() => expect($('betaSec')).not.toBeNull());
    expect($('modalExport')).not.toBe(first);
    await openExport();
    expect(groupOf($('betaSec'))).toBe('archive');
    expect($('archiveSec').nextElementSibling).toBe($('betaSec'));
    expect(openIds()).toEqual([]);
  });
});

describe('the words of the export screen (drafts in 12 languages, for V to sign off)', () => {
  const KEYS = [
    ...EXPORT_GROUPS.flatMap((g) => [g.title, g.sub]),
    'proof.h', 'proof.sub', 'proof.read', 'proof.print', 'proof.title', 'proof.note', 'proof.preparing', 'proof.empty', 'proof.failed', 'proof.frame', 'proof.linkOff',
  ];
  const PACKS = path.join(import.meta.dirname, '..', 'src', 'generated', 'packs');
  const pack = (code: string): Record<string, string> => JSON.parse(readFileSync(path.join(PACKS, `${code}.json`), 'utf8'));
  const holes = (s: string): string[] => [...s.matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0]).sort();
  it('there are 23, all in the English pack, and nothing else is under expg. or proof.', () => {
    expect(KEYS.length).toBe(23);
    expect(Object.keys(en).filter((k) => k.startsWith('expg.') || k.startsWith('proof.')).sort()).toEqual([...KEYS].sort());
  });
  it('every interface language has every key, as text of its own, with the English placeholders', () => {
    const e = pack('en');
    // the same letters as English in some languages (the word is the same there)
    const SAME: Record<string, string[]> = { it: ['expg.ebook'], pl: ['expg.ebook'] };
    for (const code of meta.order) {
      const p = pack(code);
      for (const k of KEYS) {
        expect(typeof p[k] === 'string' && p[k] !== '', `${code} ${k}`).toBe(true);
        expect(holes(p[k]!), `${code} ${k}`).toEqual(holes(e[k]!));
        if (code !== 'en' && !(SAME[code] || []).includes(k)) expect(p[k], `${code} ${k} is still the English`).not.toBe(e[k]);
        expect(p[k], `${code} ${k}`).not.toMatch(/!/);
      }
    }
  });
  it('docs/strings-pending-signoff.md lists every key as a draft, and approves none', () => {
    const doc = readFileSync(path.join(import.meta.dirname, '..', '..', 'docs', 'strings-pending-signoff.md'), 'utf8');
    expect(doc.toLowerCase()).toContain('not approved');
    for (const k of KEYS) expect(doc, k).toContain('`' + k + '`');
  });
});
