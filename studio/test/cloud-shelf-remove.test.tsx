import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudBootHook, cloudFacts, loadClosure, resetCloudFacts, setClosureLang, setClosureT } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { cloudReset, cloudSeam, cloudUi, deskBookId } from '../src/cloud/cloud';
import { resetCloudProbe } from '../src/pictures/stock';
import { fixtures } from './fixtures';
import { installCanvas } from './print-fixture';
import { hazards } from './hazards';
import { browser, startShelf, type Shelf } from './cloud-server';

/* BEUK:shelfremove — a signed-in writer removes a book from the shelf (client/index.html cloudRemoveBook, lifted into
   closure-cloud.js), against the REAL server (test/cloud-server.ts: src/app.ts on PGlite in this process). The control
   in every row, the calm confirm naming the book, exactly one DELETE, the row leaving, a refusal said out loud, and the
   book open on the desk: kept on this device, let go of the shelf ("declined"), never saved back unasked — not after a
   reload either — until the writer brings it to the shelf again. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const PASSWORD = 'correct horse battery';
let off: Shelf;
const realFetch = globalThis.fetch;
let net: ReturnType<typeof browser>;
beforeAll(async () => {
  for (const P of [Range.prototype, Element.prototype, Text.prototype] as unknown as Record<string, unknown>[]) {
    if (typeof P.getClientRects !== 'function') P.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    if (typeof P.getBoundingClientRect !== 'function') P.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  }
  installCanvas();
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  off = await startShelf();
}, 60_000);
afterAll(async () => {
  await off.close();
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
  resetCloudFacts();
  cloudReset();
  resetCloudProbe();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  cloudReset();
  resetCloudFacts();
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
const LANTERN_TITLE = String((LANTERN().meta as Rec).title);
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!$(id) && $(id).classList.contains('open');
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
const type = (id: string, v: string) => act(() => void fireEvent.input(Object.assign($(id) as HTMLInputElement, { value: v })));
const saves = () => net.requests.filter((r) => r.path.startsWith('/api/manuscripts') && (r.method === 'PUT' || r.method === 'POST'));
const deletes = () => net.requests.filter((r) => r.method === 'DELETE').map((r) => r.path);
const rows = () => Array.from(document.querySelectorAll('#shelfList .shelf-row'));
const removeBtn = (id: string) => document.querySelector(`#shelfList [data-remove-book="${id}"]`) as HTMLButtonElement | null;
const onServer = async () => ((await (await net.fetch('/api/manuscripts')).json()) as { manuscripts: { id: string; title: string }[] }).manuscripts.map((m) => m.id);
const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));
let seq = 0;
const email = () => `rm${++seq}-${Date.now()}@example.test`;

function mount() {
  return render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
}
async function studio(shelf: Shelf, doc: Rec = LANTERN()) {
  net = browser(shelf.base);
  globalThis.fetch = net.fetch;
  await importToDevice(doc);
  const r = mount();
  await waitFor(() => expect($('btnAccount')?.style.display).toBe(''), { timeout: 20_000 });
  return r;
}
/** Sign up through 1.0's dialog and bring the desk's book to the shelf: the desk is linked. */
async function signUpLinked(): Promise<string> {
  await click($('btnAccount'));
  await waitFor(() => expect(isOpen('modalAuth')).toBe(true));
  await click($('authToggle'));
  await type('authEmail', email());
  await type('authPassword', PASSWORD);
  await click($('btnAuthSubmit'));
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
  expect($('confirmTitle').textContent).toBe(t('shelf.bringTitle'));
  await click($('btnConfirmYes'));
  await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
  await waitFor(() => expect($('syncText').textContent).toBe(t('sync.onShelf')));
  return cloudFacts.linkedId!;
}
/** Another book put on the shelf (as another device would): its id. */
async function another(title: string): Promise<string> {
  const r = await net.fetch('/api/manuscripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, doc: { meta: { title, bookId: 'urn:uuid:' + crypto.randomUUID() }, sections: [{ id: 's1', kind: 'body', type: 'chapter', title: 'One', content: 'Hello.' }] } }),
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as { manuscript: { id: string } }).manuscript.id;
}
async function openShelf(n: number) {
  await click($('btnAccount'));
  await waitFor(() => expect(isOpen('modalShelf')).toBe(true));
  await waitFor(() => expect(rows().length).toBe(n));
}
/** An edit of the desk's book, as the writer typing: the title changed. */
function edit(title: string) {
  const y = cloudUi.ydoc()!;
  act(() => void y.getMap('meta').set('meta', { ...(y.getMap('meta').get('meta') as Rec), title }));
}

describe('removing a book from the shelf', () => {
  it('every row has a labelled Remove button; a hostile title carries nothing in; Keep it sends nothing and changes nothing', async () => {
    await studio(off);
    const deskId = await signUpLinked();
    const evil = '<img src=x onerror="window.__rm=1">Evil "title" & co';
    const otherId = await another(evil);
    await openShelf(2);
    for (const id of [deskId, otherId]) {
      const b = removeBtn(id)!;
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
      expect(b.disabled).toBe(false);
      expect(b.textContent).toBe(t('shelf.removeBtn'));
    }
    expect(removeBtn(otherId)!.getAttribute('aria-label')).toBe(t('shelf.removeAria', { title: evil }));
    expect(removeBtn(deskId)!.getAttribute('aria-label')).toBe(t('shelf.removeAria', { title: LANTERN_TITLE }));
    expect(hazards($('modalShelf').outerHTML, 'shelf')).toEqual([]);
    expect((window as unknown as { __rm?: unknown }).__rm).toBeUndefined();

    await click(removeBtn(otherId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    expect($('confirmTitle').textContent).toBe(t('shelf.removeTitle'));
    expect($('confirmBody').textContent).toBe(t('shelf.removeBody', { title: evil }));
    expect($('confirmBody').querySelector('img')).toBe(null);
    expect($('btnConfirmYes').textContent).toBe(t('shelf.removeYes'));
    expect($('btnConfirmNo').textContent).toBe(t('shelf.removeKeep'));
    expect((window as unknown as { __rm?: unknown }).__rm).toBeUndefined();
    await click($('btnConfirmNo'));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(false));
    await pause(300);
    expect(deletes()).toEqual([]);
    expect(rows().length).toBe(2);
    expect(removeBtn(otherId)!.disabled).toBe(false);
    expect((await onServer()).sort()).toEqual([deskId, otherId].sort());
    expect(cloudFacts.linkedId).toBe(deskId);
    expect(cloudFacts.linkState).toBe('linked');
  }, 90_000);

  it('Remove it for good sends exactly one DELETE (a second click sends nothing); the row leaves and a toast says so', async () => {
    await studio(off);
    const deskId = await signUpLinked();
    const otherId = await another('Salt & Tide');
    await openShelf(2);
    const b = removeBtn(otherId)!;
    await click(b);
    await click(b); // the question already stands: a second click asks nothing more
    const api = cloudSeam.api!;
    expect(await api.cloudRemoveBook!(otherId)).toBe(false);
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    const yes = $('btnConfirmYes');
    await click(yes);
    await click(yes);
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemoved', { title: 'Salt & Tide' })));
    expect(deletes()).toEqual(['/api/manuscripts/' + otherId]);
    expect(rows().length).toBe(1);
    expect(removeBtn(otherId)).toBe(null);
    expect(removeBtn(deskId)!.disabled).toBe(false);
    expect(await onServer()).toEqual([deskId]);
    // the desk's own book is as it was: linked, on the shelf
    expect(cloudFacts.linkedId).toBe(deskId);
    expect(cloudFacts.linkState).toBe('linked');
    expect($('syncText').textContent).toBe(t('sync.onShelf'));
    await pause(300);
    expect(deletes().length).toBe(1);
  }, 90_000);

  it('a book already gone from the shelf (404) leaves the list too', async () => {
    await studio(off);
    await signUpLinked();
    const otherId = await another('Gone Elsewhere');
    await openShelf(2);
    expect((await net.fetch('/api/manuscripts/' + otherId, { method: 'DELETE' })).status).toBe(204); // another device removed it
    await click(removeBtn(otherId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemoved', { title: 'Gone Elsewhere' })));
    expect(rows().length).toBe(1);
    expect(removeBtn(otherId)).toBe(null);
  }, 90_000);

  it("a refusal or an unreachable shelf leaves the row and says so (the API's own error where it gives one)", async () => {
    await studio(off);
    const deskId = await signUpLinked();
    const otherId = await another('Stays Put');
    await openShelf(2);
    // the shelf refuses: 500 with its own words
    let stubbed = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method || 'GET').toUpperCase() === 'DELETE') {
        stubbed++;
        return new Response(JSON.stringify({ error: 'the shelf is resting' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return net.fetch(input, init);
    }) as typeof fetch;
    await click(removeBtn(otherId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemoveFailWhy', { title: 'Stays Put', reason: 'the shelf is resting' })));
    expect(stubbed).toBe(1);
    expect(rows().length).toBe(2);
    expect(removeBtn(otherId)!.disabled).toBe(false);
    // no answer at all: the network fails
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method || 'GET').toUpperCase() === 'DELETE') {
        stubbed++;
        throw new TypeError('Failed to fetch');
      }
      return net.fetch(input, init);
    }) as typeof fetch;
    await click(removeBtn(otherId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemoveFail', { title: 'Stays Put' })));
    expect(stubbed).toBe(2);
    expect(rows().length).toBe(2);
    expect(toasts()).not.toContain(t('toast.shelfRemoved', { title: 'Stays Put' }));
    globalThis.fetch = net.fetch;
    expect(deletes()).toEqual([]);
    expect((await onServer()).sort()).toEqual([deskId, otherId].sort());
    expect(cloudFacts.linkedId).toBe(deskId);
    expect(cloudFacts.linkState).toBe('linked');
  }, 90_000);
});

describe('removing the shelf book that is open on the desk', () => {
  it('a refused removal of the desk book leaves it linked, and writing typed meanwhile is still saved to the shelf', async () => {
    await studio(off);
    const deskId = await signUpLinked();
    await openShelf(1);
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if ((init.method || 'GET').toUpperCase() === 'DELETE') return new Response(JSON.stringify({ error: 'not today' }), { status: 503, headers: { 'content-type': 'application/json' } });
      return net.fetch(input, init);
    }) as typeof fetch;
    await click(removeBtn(deskId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    expect($('confirmBody').textContent).toBe(t('shelf.removeBodyDesk', { title: LANTERN_TITLE }));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemoveFailWhy', { title: LANTERN_TITLE, reason: 'not today' })));
    expect(cloudFacts.linkedId).toBe(deskId);
    expect(cloudFacts.linkState).toBe('linked');
    const before = saves().length;
    edit('Still On The Shelf');
    await waitFor(() => expect(saves().length).toBe(before + 1), { timeout: 10_000 });
    expect(saves().at(-1)!.method + ' ' + saves().at(-1)!.path).toBe('PUT /api/manuscripts/' + deskId);
    await waitFor(() => expect($('syncText').textContent).toBe(t('sync.onShelf')));
  }, 90_000);

  it('the desk keeps the book on this device only: nothing saves it back, not after a reload either, until the writer brings it', async () => {
    await studio(off);
    const deskId = await signUpLinked();
    const bookId = deskBookId()!;
    await openShelf(1);
    await click(removeBtn(deskId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    expect($('confirmTitle').textContent).toBe(t('shelf.removeTitle'));
    expect($('confirmBody').textContent).toBe(t('shelf.removeBodyDesk', { title: LANTERN_TITLE }));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemovedDesk', { title: LANTERN_TITLE })));
    expect(deletes()).toEqual(['/api/manuscripts/' + deskId]);
    expect(await onServer()).toEqual([]);
    // the shelf is empty; the desk still holds the book, let go of the shelf
    expect(rows().length).toBe(0);
    expect($('shelfList').textContent).toBe(t('shelf.empty'));
    expect(cloudFacts.linkedId).toBe(null);
    expect(cloudFacts.linkState).toBe('declined');
    expect($('syncText').textContent).toBe(t('sync.onDevice'));
    expect($('shelfSyncLine').textContent).toBe(t('sync.onDevice'));
    expect($('shelfBring').style.display).toBe('');
    expect(cloudUi.ydoc()).not.toBe(null);
    expect(deskBookId()).toBe(bookId);
    expect($('projectTitleDisplay').textContent).toBe(LANTERN_TITLE);
    expect(cloudSeam.link(bookId)).toMatchObject({ linkedId: null, linkState: 'declined' });
    // the writer writes on: nothing goes to the shelf
    const before = saves().length;
    edit('Device Only');
    await waitFor(() => expect($('projectTitleDisplay').textContent).toBe('Device Only'));
    await pause(4000);
    expect(saves().length).toBe(before);
    expect(await onServer()).toEqual([]);
    expect($('syncText').textContent).toBe(t('sync.onDevice'));
    await waitFor(() => expect(cloudSeam.link(bookId)).toMatchObject({ linkedId: null, linkState: 'declined' }));

    // a reload: the page again, the same device (its storage) and the same session (its cookie)
    cleanup();
    cloudReset();
    resetCloudFacts();
    resetCloudProbe();
    desk.ydoc = null;
    desk.active = null;
    mount();
    await waitFor(() => expect($('btnAccount')?.style.display).toBe(''), { timeout: 20_000 });
    await waitFor(() => expect(cloudFacts.user).not.toBe(null), { timeout: 20_000 });
    await cloudBootHook.p;
    expect(deskBookId()).toBe(bookId);
    expect($('projectTitleDisplay').textContent).toBe('Device Only');
    expect(cloudFacts.linkState).toBe('declined');
    expect(cloudFacts.linkedId).toBe(null);
    await waitFor(() => expect($('syncText').textContent).toBe(t('sync.onDevice')));
    edit('Device Only, Still');
    await waitFor(() => expect($('projectTitleDisplay').textContent).toBe('Device Only, Still'));
    await pause(4000);
    expect(saves().length).toBe(before);
    expect(await onServer()).toEqual([]);

    // the writer's own choice puts it on the shelf again: a new shelf book
    await click($('btnAccount'));
    await waitFor(() => expect(isOpen('modalShelf')).toBe(true));
    expect($('shelfBring').style.display).toBe('');
    await click($('btnBringBook'));
    await waitFor(() => expect(cloudFacts.linkState).toBe('linked'), { timeout: 10_000 });
    expect(saves().length).toBe(before + 1);
    expect(saves().at(-1)!.method + ' ' + saves().at(-1)!.path).toBe('POST /api/manuscripts');
    const now = await onServer();
    expect(now.length).toBe(1);
    expect(now[0]).not.toBe(deskId);
    expect(now[0]).toBe(cloudFacts.linkedId);
  }, 120_000);

  it("a real browser's order at a reload: the account known before the boot answers, then the writer lock granted — the stored link is not written over, and the book stays off the shelf", async () => {
    await studio(off);
    const deskId = await signUpLinked();
    const bookId = deskBookId()!;
    await openShelf(1);
    await click(removeBtn(deskId));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(toasts()).toContain(t('toast.shelfRemovedDesk', { title: LANTERN_TITLE })));
    await waitFor(() => expect(cloudSeam.link(bookId)).toMatchObject({ linkedId: null, linkState: 'declined' }));
    const me = ((await (await net.fetch('/api/auth/me')).json()) as { user: Rec }).user;
    const before = saves().length;

    // the reload, in the order a real browser was seen to run it (headless Chromium, 2026-11-20):
    // 1. the page starts and asks for the book's writer lock (Web Locks answer later; jsdom has none, so one is put in);
    // 2. who is signed in becomes known before the shelf's boot has its own answer (pictures/stock.ts probeCloud);
    // 3. the lock is granted, and lead() writes the link;  4. the boot's /api/auth/me answers.
    cleanup();
    cloudReset();
    resetCloudFacts();
    resetCloudProbe();
    desk.ydoc = null;
    desk.active = null;
    const grants: (() => void)[] = [];
    const locks = {
      request(_name: string, a: unknown, b?: unknown) {
        const cb = (typeof a === 'function' ? a : b) as (l: unknown) => unknown;
        return new Promise((res, rej) => {
          grants.push(() => {
            try {
              res(cb({ name: _name }));
            } catch (e) {
              rej(e);
            }
          });
        });
      },
    };
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    const heldMe: (() => void)[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (raw.includes('/api/auth/me')) await new Promise<void>((r) => heldMe.push(r));
      return net.fetch(input, init);
    }) as typeof fetch;
    try {
      mount();
      await waitFor(() => expect(grants.length).toBeGreaterThan(0), { timeout: 20_000 }); // 1: the lock is asked for
      await waitFor(() => expect(heldMe.length).toBeGreaterThan(0), { timeout: 20_000 }); // the boot's answer is still out
      expect(cloudSeam.leader()).toBe(false);
      expect(deskBookId()).toBe(bookId);
      act(() => {
        cloudFacts.available = true; // 2: stock.ts probeCloud's two lines
        cloudFacts.user = me;
      });
      act(() => grants.splice(0).forEach((g) => g())); // 3
      await pause(300);
      expect(cloudSeam.leader()).toBe(true);
      // the device's stored link is still the one the removal left
      expect(cloudSeam.link(bookId)).toMatchObject({ linkedId: null, linkState: 'declined' });
      for (let i = 0; i < 40 && !cloudBootHook.p; i++) await pause(50);
      const boot = cloudBootHook.p!;
      const release = setInterval(() => heldMe.splice(0).forEach((r) => r()), 20); // 4
      try {
        await boot;
      } finally {
        clearInterval(release);
      }
      expect(cloudFacts.linkState).toBe('declined');
      expect(cloudFacts.linkedId).toBe(null);
      await waitFor(() => expect($('syncText').textContent).toBe(t('sync.onDevice')));
      edit('Device Only, In A Browser');
      await waitFor(() => expect($('projectTitleDisplay').textContent).toBe('Device Only, In A Browser'));
      await pause(4000);
      expect(saves().length).toBe(before);
      expect(await onServer()).toEqual([]);
      expect(cloudSeam.link(bookId)).toMatchObject({ linkedId: null, linkState: 'declined' });
    } finally {
      heldMe.splice(0).forEach((r) => r());
      cleanup();
      cloudReset();
      delete (navigator as unknown as { locks?: unknown }).locks;
    }
  }, 120_000);
});
