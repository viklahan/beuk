import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { loadClosure, resetCloudFacts, setClosureLang, setClosureT, cloudFacts } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { cloudIfLoaded, cloudReset } from '../src/cloud/cloud';
import { resetCloudProbe } from '../src/pictures/stock';
import { exportBook } from '../../src/book/editor/index';
import { fixtures } from './fixtures';
import { installCanvas } from './print-fixture';
import { hazards } from './hazards';
import { browser, fakeStripe, startShelf, type Shelf } from './cloud-server';

/* Named reading links (premium 2, task 3): 1.0's writer UI in the share section (BEUK:named-links) — a Readers
   disclosure in each active reading-copy row, an Add a reader field, Copy/Close per reader, Close the open link — run
   in the studio through the closure, against the REAL server (test/cloud-server.ts). Harness: cloud-7b-ui.test.tsx. */

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
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!$(id) && $(id).classList.contains('open');
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
const type = (id: string, v: string) => act(() => void fireEvent.input(Object.assign($(id) as HTMLInputElement, { value: v })));
const choose = (id: string, v: string) => act(() => void fireEvent.change(Object.assign($(id) as HTMLSelectElement, { value: v })));
let seq = 0;
const email = () => `n${++seq}-${Date.now()}@example.test`;

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
async function signUp(addr: string) {
  await click($('btnAccount'));
  await waitFor(() => expect(isOpen('modalAuth')).toBe(true));
  await click($('authToggle'));
  await type('authEmail', addr);
  await type('authPassword', PASSWORD);
  await click($('btnAuthSubmit'));
  await waitFor(() => expect(toasts()).toContain(t('auth.welcomeNew')));
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
  await click($('btnConfirmYes'));
}
/** Signed up, the book on the shelf, the export modal open, one reading link made through 1.0's button. */
async function ready(shelf: Shelf = off) {
  await studio(shelf);
  const addr = email();
  await signUp(addr);
  await waitFor(() => expect(cloudFacts.linkState).toBe('linked'));
  await waitFor(() => expect($('btnExport').getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  await click($('btnExport'));
  await waitFor(() => expect(isOpen('modalExport')).toBe(true));
  await waitFor(() => expect($('betaSec').textContent).toContain(t('beta.none')));
  await click($('btnBetaCreate'));
  await waitFor(() => expect($('betaSec').querySelectorAll('[data-share-id]').length).toBe(1), { timeout: 20_000 });
  const shareId = $('betaSec').querySelector('[data-share-id]')!.getAttribute('data-share-id')!;
  return { addr, shareId };
}
const shareRow = (sid: string) => $('betaSec').querySelector(`[data-share-id="${sid}"]`) as HTMLElement;
const readerRows = (sid: string) => Array.from($(`betaReaders-${sid}`).querySelectorAll('[data-recipient-id]')) as HTMLElement[];
const readerRow = (sid: string, name: string) => readerRows(sid).find((r) => r.querySelector('.a-name')?.firstChild?.textContent === name)!;
/** The share row's own buttons (its open link), not its readers'. */
const shareBtns = (sid: string) => shareRow(sid).querySelector(':scope > .beta-btns') as HTMLElement;
async function openReaders(sid: string) {
  await waitFor(() => expect($(`betaReaders-${sid}`)).not.toBe(null));
  if (!$(`betaReaders-${sid}`).hasAttribute('open')) await click($(`betaReaders-${sid}`).querySelector('summary'));
  await waitFor(() => expect($(`betaReaderName-${sid}`)).not.toBe(null));
}
async function addReader(sid: string, name: string, days?: string) {
  await openReaders(sid);
  await type(`betaReaderName-${sid}`, name);
  if (days) await choose(`betaReaderExpiry-${sid}`, days);
  await click($('betaSec').querySelector(`[data-beta-reader-add="${sid}"]`));
}
/** 1.0's calm confirm (2.0's useConfirm, the one Revoke uses): answered yes or no. */
async function answer(yes: boolean) {
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
  await click($(yes ? 'btnConfirmYes' : 'btnConfirmNo'));
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(false));
}
const readerTokens = () => JSON.parse(localStorage.getItem('beuk.betaReaderTokens.v1') || '{}') as Record<string, string>;
const alertIn = (sid: string) => $(`betaReaders-${sid}`).querySelector('[role="alert"]');
/** Close the export modal and open it again: the list comes from the server afresh. */
async function reopen() {
  await click($('btnCloseExport'));
  await click($('btnExport'));
  await waitFor(() => expect(isOpen('modalExport')).toBe(true));
}

describe('named reading links in the share section (1.0, BEUK:named-links)', () => {
  it('adds a reader: POST body {name, expiresInDays}, token remembered under beuk.betaReaderTokens.v1 only, beuk.betaTokens.v1 unchanged', async () => {
    const { shareId } = await ready();
    const openTokens = localStorage.getItem('beuk.betaTokens.v1');
    expect(Object.keys(JSON.parse(openTokens!))).toEqual([shareId]);
    const n = net.requests.length;
    await addReader(shareId, 'Priya', '7');
    await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
    const post = net.requests.slice(n).filter((r) => r.method === 'POST');
    expect(post.map((r) => r.path)).toEqual([`/api/shares/${shareId}/readers`]);
    expect(JSON.parse(post[0]!.body!)).toEqual({ name: 'Priya', expiresInDays: 7 });
    const rid = readerRows(shareId)[0]!.getAttribute('data-recipient-id')!;
    const tokens = readerTokens();
    expect(Object.keys(tokens)).toEqual([`${shareId}:${rid}`]);
    expect(tokens[`${shareId}:${rid}`]).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(localStorage.getItem('beuk.betaTokens.v1')).toBe(openTokens);
    // the reader's Copy carries the reader's own link; the field is empty for the next reader
    expect(readerRows(shareId)[0]!.querySelector('[data-beta-reader-copy]')!.getAttribute('data-beta-reader-copy')).toBe(location.origin + '/read/' + tokens[`${shareId}:${rid}`]);
    expect(($(`betaReaderName-${shareId}`) as HTMLInputElement).value).toBe('');
    expect($(`betaReaders-${shareId}`).textContent).toContain(t('beta.readerNote'));
    expect($(`betaReaders-${shareId}`).querySelector('summary')!.textContent).toBe(t('beta.namedReaders', { n: 1 }));
    // the expiry choice stays for the next reader (as the copy's own expiry does); Never sends no expiresInDays
    expect(($(`betaReaderExpiry-${shareId}`) as HTMLSelectElement).value).toBe('7');
    const m = net.requests.length;
    await addReader(shareId, 'Sam', '0');
    await waitFor(() => expect(readerRows(shareId).length).toBe(2), { timeout: 20_000 });
    expect(JSON.parse(net.requests.slice(m).find((r) => r.method === 'POST')!.body!)).toEqual({ name: 'Sam' });
  }, 90_000);

  it('row shows name, status, "Not opened yet" / first+last opened, comment count', async () => {
    const { shareId } = await ready();
    await addReader(shareId, 'Priya');
    await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
    let row = readerRow(shareId, 'Priya');
    expect(row.querySelector('.beta-st')!.textContent).toBe(t('beta.stActive'));
    expect(row.textContent).toContain(t('beta.notOpened'));
    expect(row.textContent).toContain(t('beta.comments', { n: 0 }));
    const rid = row.getAttribute('data-recipient-id')!;
    const token = readerTokens()[`${shareId}:${rid}`]!;
    expect((await net.fetch('/read/' + token)).status).toBe(200);
    const book = exportBook(desk.ydoc!) as Rec;
    const sec = (book.sections as Rec[]).find((s) => s.type === 'chapter')!;
    const c = await net.fetch('/read/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readerName: 'x', sectionId: sec.id, paragraph: 0, body: 'Lovely.' }) });
    expect(c.status).toBe(201);
    await reopen();
    await openReaders(shareId);
    await waitFor(() => expect(readerRow(shareId, 'Priya').textContent).toContain(t('beta.comments', { n: 1 })), { timeout: 20_000 });
    row = readerRow(shareId, 'Priya');
    expect(row.textContent).not.toContain(t('beta.notOpened'));
    expect(row.textContent).toMatch(/First opened .+ · last .+/);
  }, 90_000);

  it("copy and close labels name the reader (Copy Priya's link / Close Priya's link)", async () => {
    const { shareId } = await ready();
    await addReader(shareId, 'Priya');
    await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
    const row = readerRow(shareId, 'Priya');
    expect(t('beta.copyFor', { name: 'Priya' })).toBe("Copy Priya's link");
    expect(row.querySelector('[data-beta-reader-copy]')!.textContent).toBe("Copy Priya's link");
    expect(row.querySelector('[data-beta-reader-close]')!.textContent).toBe("Close Priya's link");
    expect(shareRow(shareId).querySelector('[data-beta-close-open]')!.textContent).toBe(t('beta.closeOpen'));
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (s: string) => void writes.push(s) }, configurable: true });
    await click(row.querySelector('[data-beta-reader-copy]'));
    await waitFor(() => expect(writes).toEqual([row.querySelector('[data-beta-reader-copy]')!.getAttribute('data-beta-reader-copy')]));
  }, 90_000);

  it('close: row turns closed and loses Copy without reload', async () => {
    const { shareId } = await ready();
    await addReader(shareId, 'Priya');
    await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
    const rid = readerRow(shareId, 'Priya').getAttribute('data-recipient-id')!;
    const n = net.requests.length;
    // it asks first, as Revoke does; Keep leaves everything as it was and asks nothing of the server
    await click($('betaSec').querySelector(`[data-beta-reader-close="${shareId}:${rid}"]`));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    expect($('confirmTitle').textContent).toBe(t('beta.closeForTitle', { name: 'Priya' }));
    expect($('confirmBody').textContent).toBe(t('beta.closeForBody', { name: 'Priya' }));
    expect($('btnConfirmYes').textContent).toBe("Close Priya's link");
    expect($('btnConfirmNo').textContent).toBe(t('confirm.keep'));
    await answer(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(net.requests.slice(n).filter((r) => r.method !== 'GET')).toEqual([]);
    expect(readerRow(shareId, 'Priya').querySelector('.beta-st')!.textContent).toBe(t('beta.stActive'));
    expect(readerRow(shareId, 'Priya').querySelector('[data-beta-reader-copy]')).not.toBe(null);
    // asked again and confirmed: the one POST
    await click($('betaSec').querySelector(`[data-beta-reader-close="${shareId}:${rid}"]`));
    await answer(true);
    await waitFor(() => expect(readerRow(shareId, 'Priya').querySelector('.beta-st')!.textContent).toBe(t('beta.stRevoked')), { timeout: 20_000 });
    expect(net.requests.slice(n).filter((r) => r.method === 'POST').map((r) => r.path)).toEqual([`/api/shares/${shareId}/readers/${rid}/revoke`]);
    expect(readerRow(shareId, 'Priya').querySelector('[data-beta-reader-copy]')).toBe(null);
    expect(readerRow(shareId, 'Priya').querySelector('[data-beta-reader-close]')).toBe(null);
    const token = readerTokens()[`${shareId}:${rid}`]!;
    expect((await net.fetch('/read/' + token)).status).toBe(410);
  }, 90_000);

  it('duplicate and cap 409s show their messages and keep the typed name', async () => {
    const { shareId } = await ready();
    await addReader(shareId, 'Priya');
    await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
    await addReader(shareId, ' priya ');
    await waitFor(() => expect(alertIn(shareId)?.textContent).toBe(t('beta.readerDup')), { timeout: 20_000 });
    expect(($(`betaReaderName-${shareId}`) as HTMLInputElement).value).toBe(' priya ');
    expect(readerRows(shareId).length).toBe(1);
    // up to 50, closed ones counted: 49 more through the API, then the 51st through the field
    for (let i = 2; i <= 50; i++) {
      const r = await net.fetch(`/api/shares/${shareId}/readers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Reader ' + i }) });
      expect(r.status).toBe(201);
    }
    await addReader(shareId, 'Fifty-one');
    await waitFor(() => expect(alertIn(shareId)?.textContent).toBe(t('beta.readerCap')), { timeout: 20_000 });
    expect(($(`betaReaderName-${shareId}`) as HTMLInputElement).value).toBe('Fifty-one');
    expect(readerRows(shareId).length).toBe(50);
    // a name the server refuses (400): its own words, the name kept
    await addReader(shareId, 'a\u0007b');
    await waitFor(() => expect(alertIn(shareId)?.textContent).toContain('1 to 60 characters'), { timeout: 20_000 });
    expect(($(`betaReaderName-${shareId}`) as HTMLInputElement).value).toBe('a\u0007b');
  }, 120_000);

  it("close-open shows only when ≥1 named link exists; after it the open link's Copy is gone", async () => {
    const { shareId } = await ready();
    expect(shareBtns(shareId).querySelector('[data-beta-copy]')).not.toBe(null);
    expect(shareRow(shareId).querySelector('[data-beta-close-open]')).toBe(null);
    await addReader(shareId, 'Priya');
    await waitFor(() => expect(shareRow(shareId).querySelector(`[data-beta-close-open="${shareId}"]`)).not.toBe(null), { timeout: 20_000 });
    const n = net.requests.length;
    await click(shareRow(shareId).querySelector(`[data-beta-close-open="${shareId}"]`));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true));
    expect($('confirmTitle').textContent).toBe(t('beta.closeOpenTitle'));
    expect($('confirmBody').textContent).toBe(t('beta.closeOpenBody'));
    expect($('btnConfirmYes').textContent).toBe(t('beta.closeOpen'));
    await answer(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(net.requests.slice(n).filter((r) => r.method !== 'GET')).toEqual([]);
    expect(shareRow(shareId).textContent).not.toContain(t('beta.openClosed'));
    expect($('betaNewLink')).not.toBe(null);
    expect(shareBtns(shareId).querySelector('[data-beta-copy]')).not.toBe(null);
    await click(shareRow(shareId).querySelector(`[data-beta-close-open="${shareId}"]`));
    await answer(true);
    await waitFor(() => expect(shareRow(shareId).textContent).toContain(t('beta.openClosed')), { timeout: 20_000 });
    expect(net.requests.slice(n).filter((r) => r.method === 'POST').map((r) => r.path)).toEqual([`/api/shares/${shareId}/close-open`]);
    // nowhere in the section: not the row's Copy, nor the new-link box's (the link just made is the closed one)
    expect($('betaSec').querySelector('[data-beta-copy]')).toBe(null);
    expect($('betaNewLink')).toBe(null);
    expect(shareRow(shareId).querySelector('[data-beta-close-open]')).toBe(null);
    expect(shareRow(shareId).textContent).not.toContain(t('beta.linkElsewhere'));
    // the reader's link still copies; the open token is closed on the server
    const rid = readerRow(shareId, 'Priya').getAttribute('data-recipient-id')!;
    expect(readerRow(shareId, 'Priya').querySelector('[data-beta-reader-copy]')).not.toBe(null);
    const openToken = (JSON.parse(localStorage.getItem('beuk.betaTokens.v1')!) as Record<string, string>)[shareId]!;
    expect((await net.fetch('/read/' + openToken)).status).toBe(410);
    expect((await net.fetch('/read/' + readerTokens()[`${shareId}:${rid}`])).status).toBe(200);
    // after a reload it still says so
    await reopen();
    await waitFor(() => expect(shareRow(shareId)?.textContent).toContain(t('beta.openClosed')), { timeout: 20_000 });
    expect($('betaSec').querySelector('[data-beta-copy]')).toBe(null);
  }, 90_000);

  it("a readers list that fails to load says so (no Loading… beside it), and a later load clears it", async () => {
    const { shareId } = await ready();
    const real = globalThis.fetch;
    let fail = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (fail && /\/api\/shares\/[^/]+\/readers$/.test(u) && (!init || !init.method || init.method === 'GET'))
        return new Response(JSON.stringify({ error: 'the readers list broke' }), { status: 500, headers: { 'content-type': 'application/json' } });
      return real(input, init);
    }) as typeof fetch;
    // this copy's readers never loaded yet (1.0's state as a fresh page holds it)
    delete (cloudIfLoaded()!.api.beta as { named: Record<string, unknown> }).named[shareId];
    await reopen();
    await openReaders(shareId);
    await waitFor(() => expect(alertIn(shareId)?.textContent).toBe(t('beta.failed', { error: 'the readers list broke' })), { timeout: 20_000 });
    expect($(`betaReaders-${shareId}`).textContent).not.toContain(t('beta.loading'));
    fail = false;
    await reopen();
    await waitFor(() => expect(alertIn(shareId)).toBe(null), { timeout: 20_000 });
    globalThis.fetch = real;
  }, 90_000);

  it('a hostile name renders as text in the row', async () => {
    const { shareId } = await ready();
    const name = '<img src=x onerror="globalThis.__pwn=1">"P\'</b>&amp;';
    await addReader(shareId, name);
    await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
    const row = readerRows(shareId)[0]!;
    expect(row.querySelector('.a-name')!.firstChild!.textContent).toBe(name);
    expect(row.querySelector('img')).toBe(null);
    expect(row.querySelector('[data-beta-reader-copy]')!.textContent).toBe(t('beta.copyFor', { name }));
    expect(row.querySelector('[data-beta-reader-close]')!.textContent).toBe(t('beta.closeFor', { name }));
    expect(hazards($('betaSec').innerHTML)).toEqual([]);
    expect((globalThis as Rec).__pwn).toBe(undefined);
  }, 90_000);

  describe('day 22 unpaid', () => {
    let stripe: Awaited<ReturnType<typeof fakeStripe>>;
    let on: Shelf;
    beforeAll(async () => {
      stripe = await fakeStripe();
      on = await startShelf({ stripeWebhookSecret: 'whsec_test_placeholder', stripeSecretKey: 'sk_test_placeholder', stripePriceId: 'price_fixture', stripeApiBase: stripe.base });
    }, 60_000);
    afterAll(async () => {
      await on.close();
      await stripe.close();
    });

    it('day 22: the add field is hidden or refused like betaCreate; existing readers still list and close', async () => {
      const { addr, shareId } = await ready(on);
      await addReader(shareId, 'Priya');
      await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
      await on.db.query("update users set trial_ends_at = now() - interval '1 day' where email = $1", [addr]);
      await reopen();
      await openReaders(shareId);
      await waitFor(() => expect(readerRows(shareId).length).toBe(1), { timeout: 20_000 });
      // the add goes to the server, which refuses; its words stay in the section until the next try
      const n = net.requests.length;
      await addReader(shareId, 'Sam');
      await waitFor(() => expect(alertIn(shareId)).not.toBe(null), { timeout: 20_000 });
      expect(net.requests.slice(n).filter((r) => r.method !== 'GET').map((r) => r.method + ' ' + r.path)).toEqual([`POST /api/shares/${shareId}/readers`]);
      expect(alertIn(shareId)!.textContent!.startsWith(t('beta.failed', { error: '' }))).toBe(true);
      expect(alertIn(shareId)!.textContent).toContain('paused');
      expect(($(`betaReaderName-${shareId}`) as HTMLInputElement).value).toBe('Sam');
      expect(readerRows(shareId).length).toBe(1);
      // closing still works on day 22
      const rid = readerRow(shareId, 'Priya').getAttribute('data-recipient-id')!;
      await click($('betaSec').querySelector(`[data-beta-reader-close="${shareId}:${rid}"]`));
      await answer(true);
      await waitFor(() => expect(readerRow(shareId, 'Priya').querySelector('.beta-st')!.textContent).toBe(t('beta.stRevoked')), { timeout: 20_000 });
    }, 120_000);
  });
});
