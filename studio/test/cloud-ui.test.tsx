import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { closureIfLoaded, loadClosure, resetCloudFacts, setClosureLang, setClosureT, cloudFacts } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { cloudReset, cloudUi } from '../src/cloud/cloud';
import { resetCloudProbe } from '../src/pictures/stock';
import { exportBook } from '../../src/book/editor/index';
import { live } from '../src/history/history';
import { fixtures } from './fixtures';
import { hazards } from './hazards';
import { browser, fakeStripe, startShelf, type Shelf } from './cloud-server';

/* Wave 7a, tasks 2 and 3 (H2, H3, H1): 1.0's sign-in dialog, shelf dialog and account in the studio, against the REAL
   server (test/cloud-server.ts: src/app.ts on PGlite in this process; mail captured, never sent; billing on only against
   a fake Stripe on 127.0.0.1). Every word asserted is 1.0's (its keys, or its own hard-coded English). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const PASSWORD = 'correct horse battery';
let off: Shelf;
const realFetch = globalThis.fetch;
let net: ReturnType<typeof browser>;
beforeAll(async () => {
  // jsdom lays nothing out: the editor's scroll-into-view after 1.0's focusEditor reads these
  for (const P of [Range.prototype, Element.prototype, Text.prototype] as unknown as Record<string, unknown>[]) {
    if (typeof P.getClientRects !== 'function') P.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    if (typeof P.getBoundingClientRect !== 'function') P.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  }
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
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!$(id) && $(id).classList.contains('open');
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
const type = (id: string, v: string) => act(() => void fireEvent.input(Object.assign($(id) as HTMLInputElement, { value: v })));
const manuscripts = () => net.requests.filter((r) => r.path.startsWith('/api/manuscripts') && (r.method === 'PUT' || r.method === 'POST'));
let seq = 0;
const email = () => `w${++seq}-${Date.now()}@example.test`;

async function studio(shelf: Shelf, doc: Rec = LANTERN()) {
  net = browser(shelf.base);
  globalThis.fetch = net.fetch;
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnAccount')?.style.display).toBe(''), { timeout: 20_000 });
  return r;
}
/** Sign up through 1.0's dialog; the bring offer answered `bring`. */
async function signUp(addr: string, bring: boolean) {
  await click($('btnAccount'));
  await waitFor(() => expect(isOpen('modalAuth')).toBe(true));
  await click($('authToggle'));
  expect($('authTitle').textContent).toBe(t('auth.titleRegister'));
  await type('authEmail', addr);
  await type('authPassword', PASSWORD);
  await click($('btnAuthSubmit'));
  await waitFor(() => expect(toasts()).toContain(t('auth.welcomeNew')));
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
  expect($('confirmTitle').textContent).toBe(t('shelf.bringTitle'));
  await click(bring ? $('btnConfirmYes') : $('btnConfirmNo'));
}

describe('the sign-in dialog (H2)', () => {
  it("signed out: 1.0's Sign in button; the dialog in its three modes; register brings the book to the shelf", async () => {
    await studio(off);
    expect($('btnAccount').textContent).toBe(t('top.signIn'));
    await click($('btnAccount'));
    await waitFor(() => expect(isOpen('modalAuth')).toBe(true));
    expect($('authTitle').textContent).toBe(t('auth.titleLogin'));
    expect($('authSubmitLabel').textContent).toBe(t('auth.signIn'));
    await click($('authForgot'));
    expect($('authTitle').textContent).toBe(t('acct.forgotTitle'));
    await click($('authToggle'));
    expect($('authTitle').textContent).toBe(t('auth.titleLogin'));
    await click($('btnCloseAuth'));
    expect(isOpen('modalAuth')).toBe(false);
    expect(manuscripts()).toEqual([]);
    const addr = email();
    await signUp(addr, true);
    await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
    await waitFor(() => expect(toasts()).toContain(t('toast.onShelfBook', { title: String((LANTERN().meta as Rec).title) })));
    expect(manuscripts().map((r) => r.method + ' ' + r.path)).toEqual(['POST /api/manuscripts']);
    expect($('btnAccount').querySelector('.acct-avatar')!.textContent).toBe(addr[0]!.toUpperCase());
    await waitFor(() => expect($('syncText').textContent).toBe(t('sync.onShelf')));
    expect($('syncRow').style.display).toBe('flex');
  }, 60_000);

  it('Not now: the book stays on this device (declined); a wrong password and an unreachable shelf say 1.0\'s words', async () => {
    const addr = email();
    await studio(off);
    await signUp(addr, false);
    await waitFor(() => expect(cloudFacts.linkState).toBe('declined'));
    expect(manuscripts()).toEqual([]);
    // sign out, then a wrong password: 401
    await click($('btnAccount'));
    await waitFor(() => expect(isOpen('modalShelf')).toBe(true));
    await click($('btnSignOut'));
    await waitFor(() => expect(toasts()).toContain('Signed out — your books stay safely on your shelf'));
    await click($('btnAccount'));
    await type('authEmail', addr);
    await type('authPassword', 'not the password');
    await click($('btnAuthSubmit'));
    await waitFor(() => expect($('authError').style.display).toBe('block'));
    expect($('authError').textContent).toBe('That email and password don’t match a shelf we know — check them and try again.');
    // the network goes: 1.0's "out of reach"
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await click($('btnAuthSubmit'));
    await waitFor(() => expect($('authError').textContent).toBe('The shelf is out of reach just now — your writing is safe here on this device. Try again in a moment.'));
  }, 60_000);

  it('forgot password: one honest confirmation; the reset mail is captured, never sent', async () => {
    const addr = email();
    await studio(off);
    await signUp(addr, false);
    await click($('btnAccount'));
    await click($('btnSignOut'));
    await click($('btnAccount'));
    await click($('authForgot'));
    await type('authEmail', 'not an address');
    await click($('btnAuthSubmit'));
    expect($('authError').textContent).toBe(t('acct.emailInvalid'));
    await type('authEmail', addr);
    const before = off.mail.sent.length;
    await click($('btnAuthSubmit'));
    await waitFor(() => expect($('authNote').style.display).toBe('block'));
    expect($('authNote').textContent).toBe(t('acct.forgotSent'));
    expect($('btnAuthSubmit').style.display).toBe('none');
    await waitFor(() => expect(off.mail.sent.length).toBe(before + 1));
    expect(off.mail.sent.at(-1)!.to).toBe(addr);
  }, 60_000);
});

describe('the account (H3)', () => {
  it('change password, the unconfirmed address and its resend, sign out everywhere', async () => {
    const addr = email();
    await studio(off);
    await signUp(addr, false);
    await click($('btnAccount'));
    await waitFor(() => expect(isOpen('modalShelf')).toBe(true));
    expect($('shelfEmail').textContent).toBe(addr);
    // the portal line: not confirmed yet, with 1.0's resend
    await waitFor(() => expect(($('portalConfirm') as HTMLElement).hidden).toBe(false));
    const before = off.mail.sent.length;
    await click($('btnPortalResend'));
    await waitFor(() => expect($('portalNote').textContent).toBe(t('portal.sent')));
    expect(off.mail.sent.length).toBeGreaterThan(before);
    // the plan line stays hidden while plans are off on the server
    expect(($('planLine') as HTMLElement).hidden).toBe(true);
    // change password
    ($('acctBox') as HTMLDetailsElement).open = true;
    await type('acctCurrent', 'wrong one');
    await type('acctNew', 'a brand new password');
    await click($('btnAcctChange'));
    await waitFor(() => expect($('acctMsg').textContent).toBe(t('acct.wrongCurrent')));
    await type('acctCurrent', PASSWORD);
    await click($('btnAcctChange'));
    await waitFor(() => expect($('acctMsg').textContent).toBe(t('acct.changed', { n: 0 })));
    expect(($('acctCurrent') as HTMLInputElement).value).toBe('');
    // the password never reaches localStorage, the console or the book
    expect(JSON.stringify(localStorage)).not.toContain('a brand new password');
    // sign out everywhere: 1.0's confirm, then signed out
    await click($('btnAcctEverywhere'));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    expect($('confirmTitle').textContent).toBe(t('acct.everywhereConfirmTitle'));
    await click($('btnConfirmYes'));
    await waitFor(() => expect(cloudFacts.user).toBe(null));
    expect(net.requests.some((r) => r.method === 'POST' && r.path === '/api/auth/sessions/revoke-all')).toBe(true);
    expect($('btnAccount').textContent).toBe(t('top.signIn'));
  }, 60_000);

  it('billing on (a fake Stripe on 127.0.0.1): the plan line in the trial and on day 22; Choose a plan is a redirect only', async () => {
    const stripe = await fakeStripe();
    const on = await startShelf({ stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base });
    try {
      const go = vi.fn();
      const addr = email();
      await studio(on);
      cloudUi.go = go;
      await signUp(addr, false);
      await click($('btnAccount'));
      await waitFor(() => expect(($('planLine') as HTMLElement).hidden).toBe(false));
      expect($('planText').textContent).toMatch(/^Free trial until .+\. \(test payments only\)$/);
      expect(($('btnPlanUpgrade') as HTMLElement).hidden).toBe(false);
      await click($('btnPlanUpgrade'));
      await waitFor(() => expect(go).toHaveBeenCalledWith('https://checkout.example.test/1'));
      expect(stripe.calls.some((c) => c.startsWith('POST /v1/checkout/sessions'))).toBe(true);
      // day 22, unpaid: 1.0's paused line
      await on.db.query("update users set trial_ends_at = now() - interval '1 day' where email = $1", [addr]);
      await click($('btnCloseShelf'));
      await click($('btnAccount'));
      await waitFor(() => expect($('planText').textContent).toBe(t('plan.paused') + ' (' + t('plan.test') + ')'));
    } finally {
      cloudUi.go = (url) => window.location.assign(url);
      cleanup();
      globalThis.fetch = realFetch;
      await on.close();
      await stripe.close();
    }
  }, 60_000);
});

describe('the shelf (H1) and safety (constraint 90)', () => {
  it("a hostile title on the shelf carries no script or handler into the list; opening it asks 1.0's guard first", async () => {
    const addr = email();
    await studio(off);
    await signUp(addr, true);
    await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
    const evil = '<img src=x onerror="window.__pw=1">Evil "title" & co';
    const r = await net.fetch('/api/manuscripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: evil, doc: { meta: { title: evil, bookId: 'urn:uuid:0b0c7c6e-2f7b-4d36-9c2d-6f1f8f0f0a01' }, sections: [{ id: 's1', kind: 'body', type: 'chapter', title: evil, content: 'Hello.' }] } }) });
    const evilId = ((await r.json()) as { manuscript: { id: string } }).manuscript.id;
    // an edit the shelf has not seen yet: the desk holds unshelved work
    await click($('btnAccount'));
    await waitFor(() => expect(document.querySelectorAll('#shelfList .shelf-row').length).toBe(2));
    expect(hazards($('modalShelf').outerHTML, 'shelf')).toEqual([]);
    expect(Array.from(document.querySelectorAll('#shelfList .sh-title')).map((x) => x.textContent)).toContain(evil);
    const before = manuscripts().length;
    // the desk's book is linked and clean: no guard, the shelf book opens (a new generation)
    await click(document.querySelector(`[data-open-book="${evilId}"]`));
    await waitFor(() => expect(cloudFacts.linkedId).toBe(evilId));
    await waitFor(() => expect(toasts()).toContain(t('toast.bookOpened', { title: evil })));
    await waitFor(() => expect($('projectTitleDisplay').textContent).toBe(evil));
    expect((window as unknown as { __pw?: unknown }).__pw).toBeUndefined();
    // opening and viewing send no save (constraint 87)
    await new Promise((res) => setTimeout(res, 3000));
    expect(manuscripts().length).toBe(before);
  }, 60_000);
});

describe('the three-way conflict (H4, constraint 86)', () => {
  /** Linked on the shelf; another device then saves its own version over the shelf copy; this desk edits too. */
  async function twoPlaces(): Promise<{ id: string; rev: number }> {
    await studio(off);
    await signUp(email(), true);
    await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
    const id = cloudFacts.linkedId!, rev = cloudFacts.baseRevision!;
    // the other device: its own copy of the book, its title changed, saved on the same revision
    const got = (await (await net.fetch('/api/manuscripts/' + id)).json()) as { manuscript: { doc: Rec } };
    const theirs = structuredClone(got.manuscript.doc);
    (theirs.meta as Rec).title = 'Shelf side';
    const put = await net.fetch('/api/manuscripts/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': '"' + rev + '"' }, body: JSON.stringify({ title: 'Shelf side', doc: theirs }) });
    expect(put.status).toBe(200);
    // this desk: an edit of its own
    const y = cloudUi.ydoc()!;
    act(() => y.getMap('meta').set('meta', { ...(y.getMap('meta').get('meta') as Rec), title: 'Desk side' }));
    await waitFor(() => expect(isOpen('modalConflict')).toBe(true), { timeout: 8000 });
    expect($('conflictBody').textContent).toMatch(/^.*Desk side.*$/);
    expect(cloudFacts.conflict).not.toBe(null);
    return { id, rev };
  }
  const shelfDoc = async (id: string) => ((await (await net.fetch('/api/manuscripts/' + id)).json()) as { manuscript: { doc: Rec; revision: number } }).manuscript;
  const historyNames = () => {
    const h = (exportBookOf().history as { name?: string; auto?: string }[] | undefined) ?? [];
    return h.map((x) => (x.auto || '') + ':' + (x.name || ''));
  };
  const exportBookOf = () => exportBook(cloudUi.ydoc()!) as Rec;
  /** History as 1.0 holds it (unpacked: each snapshot's whole book). */
  const unpacked = () => live(closureIfLoaded()!, cloudUi.ydoc()!).state.history;

  it('Keep mine: the shelf copy is replaced by this desk', async () => {
    const { id, rev } = await twoPlaces();
    await click($('btnConflictMine'));
    expect(isOpen('modalConflict')).toBe(false);
    await waitFor(() => expect(toasts()).toContain(t('offline.resolvedMine')));
    await waitFor(async () => expect((await shelfDoc(id)).revision).toBe(rev + 2));
    expect(((await shelfDoc(id)).doc.meta as Rec).title).toBe('Desk side');
    expect((exportBookOf().meta as Rec).title).toBe('Desk side');
  }, 60_000);

  it("Use the shelf copy: the desk becomes it, and this desk's writing is History's newest snapshot", async () => {
    const { id, rev } = await twoPlaces();
    await click($('btnConflictShelf'));
    await waitFor(() => expect(toasts()).toContain(t('offline.resolvedShelf')));
    await waitFor(() => expect(($('projectTitleDisplay').textContent)).toBe('Shelf side'));
    expect(historyNames()[0]).toBe('conflict:' + t('offline.snapshotLocalName'));
    expect((unpacked()[0]!.doc.meta as Rec).title).toBe('Desk side');
    // the merged History rides the next save (1.0: cloudDirty = true)
    await waitFor(async () => expect((await shelfDoc(id)).revision).toBe(rev + 2), { timeout: 8000 });
    const s = await shelfDoc(id);
    expect((s.doc.meta as Rec).title).toBe('Shelf side');
    expect(((s.doc.history as { name: string }[])[0]!).name).toBe(t('offline.snapshotLocalName'));
  }, 60_000);

  it('Keep both: this desk stands, and the shelf copy is kept word for word as a History snapshot', async () => {
    const { id, rev } = await twoPlaces();
    await click($('btnConflictBoth'));
    await waitFor(() => expect(toasts()).toContain(t('offline.resolvedBoth')));
    expect((exportBookOf().meta as Rec).title).toBe('Desk side');
    expect(historyNames()[0]).toBe('conflict:' + t('offline.snapshotShelfName'));
    expect((unpacked()[0]!.doc.meta as Rec).title).toBe('Shelf side');
    await waitFor(async () => expect((await shelfDoc(id)).revision).toBe(rev + 2), { timeout: 8000 });
    expect(((await shelfDoc(id)).doc.meta as Rec).title).toBe('Desk side');
  }, 60_000);
});
