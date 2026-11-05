import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/cloud-markup.json';
import exportMarkup from '../src/generated/export-markup.json';
import { cloudFacts, loadClosure, pageToast, resetCloudFacts, setClosureLang, setClosureT } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { bootCloud, cloudReset, cloudUi, deskChanged, loadCloud, type CloudClosure } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { hazards } from './hazards';
import { browser, startShelf, type Shelf } from './cloud-server';

/* Wave 7b: the shelf's remaining parts (the archive list, beta links, bulk import, offline, error reports), 1.0's own
   code in the shelf's module, against the REAL server (test/cloud-server.ts). The harness is wave 7a's review harness
   (cloud-review.test.ts): a desk is a Y.Doc, a second tab of this device is a fake Web Locks manager. */

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

/* ---- a fake LockManager (cloud-review.test.ts's) ---- */
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

let replaces: Rec[] = [];
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
let net: ReturnType<typeof browser>;
let seq = 0;
async function signUp(): Promise<void> {
  const r = await net.fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `b${++seq}-${Date.now()}@example.test`, password: 'correct horse battery' }) });
  cloudFacts.user = ((await r.json()) as Rec).user;
}
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
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const paths = (re: RegExp) => net.requests.filter((r) => re.test(r.path)).map((r) => r.method + ' ' + r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>'));

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
  document.body.innerHTML = markup.auth + markup.shelf + markup.account + markup.syncRow + markup.netPill + exportMarkup.modal + '<div class="modal-back" id="modalConflict"><p id="conflictBody"></p></div>';
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

describe('carried from 7a', () => {
  it("the double toast: a shelf book another tab writes says only 1.0's honest words (no \"opened\" first)", async () => {
    await linked(SALT());
    const r = READS();
    const other = await postBook(r);
    toasts.length = 0;
    otherTabHolds(idOf(r));
    await cm.api.cloudOpenBook(other);
    await tick(300);
    expect(replaces).toEqual([]);
    expect(toasts).toEqual([t('toast.bookOpenFail')]);
  }, 30_000);

  it('a shelf book that does open still says 1.0\'s "opened" words, once', async () => {
    await linked(SALT());
    const r = READS();
    const other = await postBook(r);
    toasts.length = 0;
    await cm.api.cloudOpenBook(other);
    await tick(300);
    expect(replaces.length).toBe(1);
    expect(toasts).toEqual([t('toast.bookOpened', { title: String((r.meta as Rec).title) })]);
  }, 30_000);
});

describe('the archive list (H1)', () => {
  it("signed in: 1.0's archive section shows; a file saved there is POSTed as 1.0 posts it and listed as 1.0 lists it", async () => {
    const { id } = await linked(SALT());
    cm.api.renderCloudChrome();
    expect($('archiveSec').style.display).toBe('');
    cm.api.renderArchiveList();
    expect($('archiveList').textContent).toBe('Nothing archived yet. Save a finished file here and it will be waiting on your shelf, on any device.');
    await cm.api.cloudArchiveExport('markdown', new Blob(['# Salt Road\n\nText.'], { type: 'text/markdown;charset=utf-8' }), 'salt-road.md', null);
    expect(toasts).toContain('Saved to your archive — salt-road.md');
    const post = net.requests.find((r) => r.method === 'POST' && r.path.startsWith('/api/exports'))!;
    expect(post.path).toBe('/api/exports?manuscriptId=' + id + '&format=markdown&filename=salt-road.md');
    expect(post.headers['content-type']).toBe('application/octet-stream');
    await tick(200);
    expect(paths(/^\/api\/exports$/)).toEqual(['GET /api/exports']);
    const rows = $('archiveList').querySelectorAll('.arc-row');
    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelector('.a-name')!.textContent).toBe('salt-road.md');
    expect(rows[0]!.querySelector('.a-meta')!.textContent).toMatch(/^Markdown · \d+ B · /);
    expect(rows[0]!.querySelector('a')!.getAttribute('href')).toMatch(/^\/api\/exports\/[0-9a-f-]{36}\/download$/);
    expect(rows[0]!.querySelector('[data-epubcheck]')).toBe(null);
  }, 30_000);

  it('an archived EPUB gets 1.0\'s Run EPUBCheck: the job is asked for as 1.0 asks, and the answer is shown in 1.0\'s words', async () => {
    await linked(SALT());
    await cm.api.cloudArchiveExport('epub', new Blob(['PK'], { type: 'application/epub+zip' }), 'salt-road.epub', 'kdp');
    await tick(200);
    const post = net.requests.find((r) => r.method === 'POST' && r.path.startsWith('/api/exports'))!;
    expect(post.path).toMatch(/&format=epub&filename=salt-road\.epub&preset=kdp$/);
    const btn = $('archiveList').querySelector<HTMLButtonElement>('[data-epubcheck]')!;
    expect(btn.textContent).toBe('Run EPUBCheck');
    const exportId = btn.getAttribute('data-epubcheck');
    btn.click();
    expect($('epubCheckResult').textContent).toBe('EPUBCheck is reading your book — the full, unforgiving read. This can take a little while…');
    await tick(100);
    const job = net.requests.find((r) => r.path === '/api/jobs/epubcheck')!;
    expect(JSON.parse(job.body!)).toEqual({ exportId });
  }, 30_000);

  it('a hostile file name in the archive is text: no element, handler or script carried in', async () => {
    await linked(SALT());
    const evil = '<img src=x onerror="window.__pw=1">.md';
    await cm.api.cloudArchiveExport('markdown', new Blob(['x']), evil, null);
    await tick(200);
    // (the server keeps the name as its own rules clean it: shown as that text)
    const kept = String(((cloudFacts as unknown as { archive: Rec[] }).archive[0] as Rec).filename);
    expect(kept).toContain('<img src=x onerror=');
    expect($('archiveList').querySelector('.a-name')!.textContent).toBe(kept);
    expect(hazards($('archiveList').innerHTML)).toEqual([]);
  }, 30_000);

  it('signed out: the archive section is hidden, and nothing is asked of the server', async () => {
    desk(SALT());
    await bootCloud();
    cm.api.renderCloudChrome();
    expect($('archiveSec').style.display).toBe('none');
    expect(cm.api.cloudLoadArchive()).toBe(null);
    expect(paths(/^\/api\/exports/)).toEqual([]);
  }, 30_000);
});
