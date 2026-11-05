import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/cloud-markup.json';
import { cloudFacts, loadClosure, pageToast, resetCloudFacts, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { bootCloud, cloudReset, cloudSeam, cloudUi, deskChanged, loadCloud, LINKS_KEY, storedLink, type CloudClosure } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { browser, startShelf, type Shelf } from './cloud-server';

/* Wave 7a, the review's findings (Critical C1-C3, Important I1-I6, Minor M1-M5), each held by a test written before its
   fix, against the real server (test/cloud-server.ts). A second tab of this device is a fake Web Locks manager (jsdom
   has none) whose locks "another tab" can hold. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let cm: CloudClosure;
let shelf: Shelf;
const realFetch = globalThis.fetch;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const BOOK = (name: string) => structuredClone(fixtures('real').find((f) => f.name === name)!.book) as Rec;
const SALT = () => BOOK('real/salt-road-book-one');
const READS = () => BOOK('real/reads-you');
const idOf = (b: Rec) => (b.meta as Rec).bookId as string;

/* ---- a fake LockManager: locks held by this tab or by "another tab" ---- */
type Waiter = { name: string; cb: (l: unknown) => unknown; resolve: (v: unknown) => void; signal?: AbortSignal };
const locks = {
  held: new Map<string, 'other' | Promise<unknown>>(),
  queue: [] as Waiter[],
  grant(w: Waiter) {
    const p = Promise.resolve(w.cb({ name: w.name }));
    locks.held.set(w.name, p);
    void p.finally(() => {
      if (locks.held.get(w.name) === p) locks.held.delete(w.name);
      locks.next(w.name);
    });
    w.resolve(p);
  },
  next(name: string) {
    if (locks.held.has(name)) return;
    const i = locks.queue.findIndex((q) => q.name === name);
    if (i >= 0) locks.grant(locks.queue.splice(i, 1)[0]!);
  },
  request(name: string, a: unknown, b?: unknown): Promise<unknown> {
    const opts = (typeof a === 'function' ? {} : a) as { ifAvailable?: boolean; signal?: AbortSignal };
    const cb = (typeof a === 'function' ? a : b) as (l: unknown) => unknown;
    return new Promise((resolve, reject) => {
      const w: Waiter = { name, cb, resolve, signal: opts.signal };
      if (!locks.held.has(name)) return locks.grant(w);
      if (opts.ifAvailable) return resolve(Promise.resolve(cb(null)));
      opts.signal?.addEventListener('abort', () => {
        const i = locks.queue.indexOf(w);
        if (i >= 0) locks.queue.splice(i, 1);
        reject(new DOMException('aborted', 'AbortError'));
      });
      locks.queue.push(w);
    });
  },
};
const otherTabHolds = (bookId: string) => locks.held.set('beuk-next-shelf-' + bookId, 'other');
const otherTabLeaves = (bookId: string) => {
  locks.held.delete('beuk-next-shelf-' + bookId);
  locks.next('beuk-next-shelf-' + bookId);
};

let replaces: Rec[] = [];
/** The desk holds `book`; replace() opens a new generation the way BookProvider + CloudHost do (async, then shown). */
function desk(book: Rec): Y.Doc {
  const y = new Y.Doc();
  importBook(structuredClone(book), y);
  cloudUi.ydoc = () => y;
  cloudUi.replace = async (doc) => {
    replaces.push(structuredClone(doc));
    await tick(0);
    const y2 = new Y.Doc();
    importBook(structuredClone(doc), y2);
    cloudUi.ydoc = () => y2;
    deskChanged(y2);
    return y2;
  };
  deskChanged(y);
  return y;
}
const edit = (y: Y.Doc, title: string) => y.getMap('meta').set('meta', { ...(y.getMap('meta').get('meta') as Rec), title });
let net: ReturnType<typeof browser>;
const writes = () => net.requests.filter((r) => r.path.startsWith('/api/manuscripts') && (r.method === 'PUT' || r.method === 'POST'));
let seq = 0;
async function signUp(): Promise<void> {
  const r = await net.fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `r${++seq}-${Date.now()}@example.test`, password: 'correct horse battery' }) });
  cloudFacts.user = ((await r.json()) as Rec).user;
}
/** Signed in with `book` on the desk, brought to the shelf (linked, clean). */
async function linked(book: Rec): Promise<{ y: Y.Doc; id: string }> {
  const y = desk(book);
  await bootCloud();
  await signUp();
  await cm.api.cloudBringBook();
  expect(cloudFacts.linkState).toBe('linked');
  return { y, id: cloudFacts.linkedId! };
}
async function postBook(book: Rec): Promise<string> {
  const r = await net.fetch('/api/manuscripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', doc: book }) });
  return ((await r.json()) as { manuscript: { id: string } }).manuscript.id;
}

beforeAll(async () => {
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
  cm = await loadCloud();
  shelf = await startShelf();
}, 60_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await shelf.close();
});
const toasts: string[] = [];
beforeEach(() => {
  net = browser(shelf.base);
  globalThis.fetch = net.fetch;
  document.body.innerHTML = markup.auth + markup.shelf + markup.account + markup.syncRow + markup.netPill;
  replaces = [];
  toasts.length = 0;
  pageToast.fn = (m) => void toasts.push(m);
  locks.held.clear();
  locks.queue.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cloudReset();
  resetCloudFacts();
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('Critical', () => {
  it('C1: a shelf open whose new generation fails leaves the desk on its own link (no PUT of X over Y)', async () => {
    const { y, id } = await linked(SALT());
    const other = await postBook(READS());
    cloudUi.replace = async (doc) => (replaces.push(doc), null);
    await cm.api.cloudOpenBook(other);
    await tick(300);
    expect(cloudFacts.linkedId).toBe(id);
    expect(storedLink(idOf(SALT()))!.linkedId).toBe(id);
    edit(y, 'Salt Road, edited');
    await tick(2900);
    expect(writes().filter((w) => w.path.includes(other))).toEqual([]);
  }, 30_000);

  it('C2: a save while the desk is between generations waits for the book (never sends doc {})', async () => {
    const { y } = await linked(SALT());
    edit(y, 'Edited');
    const live = cloudUi.ydoc;
    cloudUi.ydoc = () => null; // stale: the next generation not shown yet
    await tick(2900);
    const sent = writes().filter((w) => w.method === 'PUT');
    expect(sent.map((w) => JSON.parse(w.body!).doc).filter((d: Rec) => !Array.isArray(d.sections))).toEqual([]);
    cloudUi.ydoc = live;
    for (let i = 0; i < 40 && !writes().some((w) => w.method === 'PUT'); i++) await tick(100);
    const put = writes().find((w) => w.method === 'PUT')!;
    expect(Array.isArray(JSON.parse(put.body!).doc.sections)).toBe(true);
  }, 30_000);

  it('C3: an edit while signed out marks the stored link as having writing the shelf has not seen', async () => {
    const { y } = await linked(SALT());
    await cm.api.cloudSignOut();
    expect(storedLink(idOf(SALT()))).toBe(null); // 1.0: signed out, the link record is cleared
    // a book whose link this device stored, opened signed out (as after a reload): its link carried, then an edit
    cloudReset();
    resetCloudFacts();
    const all = { [idOf(SALT())]: { savedAt: '', link: { userId: 'u', linkedId: 'm1', linkState: 'linked', baseUpdatedAt: null, baseRevision: 3, shelfDirty: false } } };
    localStorage.setItem(LINKS_KEY, JSON.stringify(all));
    const y2 = desk(SALT());
    void y;
    edit(y2, 'Signed-out edit');
    await tick(300);
    expect(storedLink(idOf(SALT()))!.shelfDirty).toBe(true);
  }, 30_000);
});

describe('Important', () => {
  it('I1: after signing out on one book, another book opened keeps the link this device stored for it', async () => {
    await linked(SALT());
    await cm.api.cloudSignOut();
    const r = READS();
    const all = JSON.parse(localStorage.getItem(LINKS_KEY) || '{}');
    all[idOf(r)] = { savedAt: '', link: { userId: 'u', linkedId: 'm2', linkState: 'linked', baseUpdatedAt: null, baseRevision: 2, shelfDirty: false } };
    localStorage.setItem(LINKS_KEY, JSON.stringify(all));
    desk(r);
    await tick(300);
    expect(storedLink(idOf(r))).toMatchObject({ linkedId: 'm2', baseRevision: 2 });
  }, 30_000);

  it('I2: writing on one book signed out does not mark another book dirty', async () => {
    const r = READS();
    localStorage.setItem(LINKS_KEY, JSON.stringify({ [idOf(r)]: { savedAt: '', link: { userId: 'u', linkedId: 'm2', linkState: 'linked', baseUpdatedAt: null, baseRevision: 2, shelfDirty: false } } }));
    const y = desk(SALT());
    await bootCloud();
    edit(y, 'Salt edited');
    expect(cloudFacts.sessionEdited).toBe(true);
    desk(r);
    await tick(300);
    expect(cloudFacts.sessionEdited).toBe(false);
    expect(storedLink(idOf(r))!.shelfDirty).toBe(false);
  }, 30_000);

  it('I3: a POST in flight when the desk changes to another unlinked book never links the new book to it', async () => {
    const y = desk(SALT());
    await bootCloud();
    await signUp();
    const slow = net.fetch;
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      if (String(u) === '/api/manuscripts' && init?.method === 'POST') await tick(400);
      return slow(u, init);
    }) as typeof fetch;
    void y;
    const bring = cm.api.cloudBringBook();
    await tick(50);
    desk(READS()); // another unlinked book arrives while the POST is in flight
    await bring;
    await tick(200);
    expect(cloudFacts.linkedId).toBe(null);
    expect(storedLink(idOf(READS()))?.linkedId ?? null).toBe(null);
  }, 30_000);

  it('I4: opening from the shelf a book another tab of this device is writing is refused with 1.0\'s words', async () => {
    const { id } = await linked(SALT());
    const r = READS();
    const other = await postBook(r);
    otherTabHolds(idOf(r));
    await cm.api.cloudOpenBook(other);
    await tick(300);
    expect(replaces).toEqual([]);
    expect(toasts).toContain(t('toast.bookOpenFail'));
    expect(cloudFacts.linkedId).toBe(id);
  }, 30_000);

  it('I5: a follower tab never saves; a sign-in in another tab reaches this one', async () => {
    const y = desk(SALT());
    await bootCloud();
    otherTabHolds(idOf(SALT()));
    deskChanged(null);
    deskChanged(y);
    await tick(20);
    expect(cloudSeam.leader()).toBe(false);
    // signed in from the other tab: this one hears of it and asks who is signed in
    const r = await net.fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `tab-${Date.now()}@example.test`, password: 'correct horse battery' }) });
    expect(r.status).toBe(201);
    const ch = new BroadcastChannel('beuk-next-shelf-auth');
    ch.postMessage({ auth: 'in' });
    ch.close();
    for (let i = 0; i < 30 && !cloudFacts.user; i++) await tick(50);
    expect(cloudFacts.user).not.toBe(null);
    // a save asked for in this (follower) tab waits for the writer's lock
    cm.vars.cloudDirty = true;
    await cm.api.cloudSaveRun();
    expect(writes()).toEqual([]);
    otherTabLeaves(idOf(SALT()));
    for (let i = 0; i < 40 && !writes().length; i++) await tick(100);
    expect(writes().map((w) => w.method)).toEqual(['POST']);
  }, 30_000);

  it('I6: a link write still in its 120 ms pause is written as the page goes', async () => {
    await linked(SALT());
    localStorage.removeItem(LINKS_KEY);
    cm.api.setSyncStatus('saved'); // 1.0's localNoteLinkChanged: written after its pause
    window.dispatchEvent(new Event('pagehide'));
    expect(storedLink(idOf(SALT()))).not.toBe(null);
  }, 30_000);
});

describe('Minor', () => {
  it('M1: a conflict snapshot whose arrival was refused never leads the next book that arrives', async () => {
    const { id } = await linked(SALT());
    cloudFacts.conflict = { doc: { formatVersion: 999, meta: {}, sections: [] }, updatedAt: null, revision: null };
    cm.api.resolveConflict('shelf');
    await tick(50);
    const other = await postBook(READS());
    cloudFacts.linkedId = id;
    cm.vars.cloudDirty = false;
    await cm.api.cloudOpenBook(other);
    await tick(100);
    const arrived = replaces.at(-1)!;
    expect(JSON.stringify(arrived.history ?? [])).not.toContain(t('offline.snapshotLocalName'));
  }, 30_000);

  it('M2: signed in, a book reaching an empty desk takes the link this device stored for it', async () => {
    await linked(SALT());
    const r = READS();
    const all = JSON.parse(localStorage.getItem(LINKS_KEY) || '{}');
    all[idOf(r)] = { savedAt: '', link: { userId: (cloudFacts.user as Rec).id, linkedId: 'm9', linkState: 'linked', baseUpdatedAt: null, baseRevision: 4, shelfDirty: false } };
    localStorage.setItem(LINKS_KEY, JSON.stringify(all));
    deskChanged(null);
    desk(r);
    await tick(50);
    expect(cloudFacts.linkedId).toBe('m9');
  }, 30_000);

  it('M3: a follower that moves to another book leaves no lock request waiting', async () => {
    desk(SALT());
    otherTabHolds(idOf(SALT()));
    deskChanged(null);
    desk(SALT());
    await tick(20);
    expect(locks.queue.length).toBe(1);
    desk(READS());
    await tick(20);
    expect(locks.queue.filter((q) => q.name === 'beuk-next-shelf-' + idOf(SALT())).length).toBe(0);
  });

  it('M4: cloudReset drops a link write still waiting', async () => {
    await linked(SALT());
    localStorage.removeItem(LINKS_KEY);
    cm.api.setSyncStatus('saved');
    cloudReset();
    await tick(200);
    expect(localStorage.getItem(LINKS_KEY)).toBe(null);
  }, 30_000);

  it('M5 (1.0 fix): a successful sign-in clears the password field', async () => {
    desk(SALT());
    await bootCloud();
    cloudUi.confirm = async () => false;
    cm.api.openAuth();
    cm.api.setAuthMode('register');
    (document.getElementById('authEmail') as HTMLInputElement).value = `m5-${Date.now()}@example.test`;
    (document.getElementById('authPassword') as HTMLInputElement).value = 'correct horse battery';
    await cm.api.cloudAuthSubmit();
    expect(cloudFacts.user).not.toBe(null);
    expect((document.getElementById('authPassword') as HTMLInputElement).value).toBe('');
  }, 30_000);
});
