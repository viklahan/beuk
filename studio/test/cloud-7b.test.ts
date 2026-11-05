import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/cloud-markup.json';
import exportMarkup from '../src/generated/export-markup.json';
import { closureIfLoaded, cloudFacts, loadClosure, pageToast, resetCloudFacts, setClosureLang, setClosureT } from '../src/closure/index';
import { desk as pageDesk } from '../src/environment/page';
import { importWire } from '../src/import/import';
import { exportBook } from '../../src/book/editor/index';
import { textCorpus } from './import-fixture';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { bootCloud, cloudReset, cloudUi, deskChanged, loadCloud, type CloudClosure } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { hazards } from './hazards';
import { browser, fakeStripe, startShelf, type Shelf } from './cloud-server';

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
  pageDesk.ydoc = null;

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

describe('bulk import to the shelf (G3)', () => {
  const file = (name: string, text: string, type = 'text/plain') => new File([text], name, { type });
  /** 1.0's startBulkImport on `entries`, in the studio's import wiring; resolves when 1.0's summary is shown. */
  async function bulk(entries: { file: File; path: string }[]) {
    const c = await importWire();
    $('bulkSummary').style.display = 'none';
    c.api.startBulkImport(entries);
    for (let i = 0; i < 300 && $('bulkSummary').style.display === 'none'; i++) await tick(50);
    expect($('bulkSummary').style.display).toBe('');
  }

  it("signed in: 1.0's bulk block shows (and the sidebar's hint does not); signed out the hint shows, the block does not", async () => {
    document.body.insertAdjacentHTML('beforeend', '<p id="bulkHint" style="display:none;"></p>');
    desk(SALT());
    await bootCloud();
    cm.api.renderCloudChrome();
    expect($('shelfBulk').style.display).toBe('none');
    expect($('bulkHint').style.display).toBe('');
    await signUp();
    cm.api.renderCloudChrome();
    expect($('shelfBulk').style.display).toBe('');
    expect($('bulkHint').style.display).toBe('none');
  }, 30_000);

  it('many files become shelf books (POST /api/manuscripts each, as 1.0 posts them); the open book is untouched (decision 2)', async () => {
    const { y } = await linked(SALT());
    pageDesk.ydoc = y;
    const before = { update: Y.encodeStateAsUpdate(y), book: JSON.stringify(exportBook(y)) };
    const corpus = textCorpus().filter((f) => /^(frontmatter\.md|plain-manuscript\.txt|headings\.rtf)$/.test(f.name));
    expect(corpus.length).toBe(3);
    const entries = corpus.map((f) => ({ file: file(f.name, f.text, f.type), path: f.name }));
    // a duplicate in the batch, a file Beuk cannot read, and an empty one: each reported, none stops the queue
    entries.push({ file: file('copy.txt', corpus.find((f) => f.name === 'plain-manuscript.txt')!.text), path: 'copy.txt' });
    entries.push({ file: file('notes.xyz', 'x'), path: 'notes.xyz' });
    entries.push({ file: file('blank.md', '   \n'), path: 'blank.md' });
    const writesBefore = net.requests.length;
    await bulk(entries);
    const posts = net.requests.slice(writesBefore).filter((r) => r.path === '/api/manuscripts' && r.method === 'POST');
    if (posts.length !== 3) console.log("SUMMARY", $("bulkSummary").textContent, JSON.stringify(net.requests.slice(writesBefore).map((r) => r.method + " " + r.path)));
    expect(posts.length).toBe(3);
    for (const p of posts) {
      const body = JSON.parse(p.body!) as Rec;
      expect(Object.keys(body)).toEqual(['title', 'doc']);
      expect(Array.isArray((body.doc as Rec).sections)).toBe(true);
    }
    expect(net.requests.slice(writesBefore).filter((r) => r.method === 'PUT')).toEqual([]);
    const sum = $('bulkSummary').textContent!;
    expect(sum).toContain(t('bulk.summaryTitle'));
    expect(sum).toContain(t('bulk.added', { n: 3 }));
    expect(sum).toContain('copy.txt — ' + t('bulk.reasonDuplicate'));
    expect(sum).toContain('notes.xyz — ' + t('bulk.reasonUnsupported'));
    expect(sum).toContain('blank.md — ' + t('bulk.reasonUnreadable')); // (1.0's reader refuses a file with no text)
    // decision 2: the desk, its Y.Doc and its History are byte-equal before and after
    expect(Buffer.from(Y.encodeStateAsUpdate(y)).equals(Buffer.from(before.update))).toBe(true);
    expect(JSON.stringify(exportBook(y))).toBe(before.book);
    // the shelf list carries them (1.0's cloud.shelf.unshift, then cloudLoadShelf)
    await tick(300);
    expect((cloudFacts as unknown as { shelf: Rec[] }).shelf.length).toBe(4);
  }, 60_000);

  it('a file already on the shelf is skipped as 1.0 skips it; a refused POST is reported and the queue goes on', async () => {
    const { y } = await linked(SALT());
    pageDesk.ydoc = y;
    const txt = textCorpus().find((f) => f.name === 'plain-manuscript.txt')!;
    await bulk([{ file: file(txt.name, txt.text), path: txt.name }]);
    // again: the shelf's own copy has the same title and words
    const real = globalThis.fetch;
    let refused = 0;
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      if (String(u) === '/api/manuscripts' && init?.method === 'POST' && refused++ === 0) return new Response(JSON.stringify({ error: 'nope' }), { status: 500 });
      return real(u, init);
    }) as typeof fetch;
    const fm = textCorpus().find((f) => f.name === 'frontmatter.md')!;
    const rtf = textCorpus().find((f) => f.name === 'headings.rtf')!;
    await bulk([{ file: file(txt.name, txt.text), path: txt.name }, { file: file(fm.name, fm.text), path: fm.name }, { file: file(rtf.name, rtf.text), path: rtf.name }]);
    const sum = $('bulkSummary').textContent!;
    expect(sum).toContain(txt.name + ' — ' + t('bulk.reasonShelved'));
    expect(sum).toContain(fm.name + ' — ' + t('bulk.reasonShelf'));
    expect(sum).toContain(t('bulk.added', { n: 1 }));
  }, 60_000);

  it('a hostile file name is text in the summary: no element, handler or script', async () => {
    const { y } = await linked(SALT());
    pageDesk.ydoc = y;
    const evil = '<img src=x onerror="window.__pw=1">.xyz';
    await bulk([{ file: file(evil, 'x'), path: evil }]);
    expect($('bulkSummary').textContent).toContain(evil);
    expect(hazards($('bulkSummary').innerHTML)).toEqual([]);
    expect((window as unknown as { __pw?: unknown }).__pw).toBe(undefined);
  }, 30_000);

  it('signed out, 1.0 imports nothing (no request)', async () => {
    desk(SALT());
    await bootCloud();
    const c = await importWire();
    const n = net.requests.length;
    c.api.startBulkImport([{ file: file('a.md', '# A\n\nText.'), path: 'a.md' }]);
    await tick(300);
    expect(net.requests.slice(n)).toEqual([]);
    void closureIfLoaded;
  }, 30_000);
});

describe('beta readers: share links and comments (H7)', () => {
  const sec = () => $('betaSec');
  const tokens = () => JSON.parse(localStorage.getItem('beuk.betaTokens.v1') || '{}') as Record<string, string>;
  async function ready() {
    const r = await linked(SALT());
    cm.api.betaInjectDom();
    cm.api.renderCloudChrome();
    return r;
  }
  async function create(days = '0') {
    const b = cm.vars.beta ?? cm.api.beta;
    b.opts.days = days;
    await cm.api.betaCreate();
    await tick(50);
  }

  it("signed out, 1.0's section says so and offers 1.0's sign-in; nothing is asked of the server", async () => {
    desk(SALT());
    await bootCloud();
    cm.api.betaInjectDom();
    cm.api.renderCloudChrome();
    expect(sec().querySelector('[data-beta-gate]')!.getAttribute('data-beta-gate')).toBe('signedOut');
    expect(sec().textContent).toContain(t('beta.signedOut'));
    expect(paths(/^\/api\/shares/)).toEqual([]);
  }, 30_000);

  it("create: 1.0's POST /api/shares body, the token kept only in beuk.betaTokens.v1, the link shown once, the list as 1.0 lists it", async () => {
    const { id } = await ready();
    await create();
    const post = net.requests.find((r) => r.method === 'POST' && r.path === '/api/shares')!;
    expect(JSON.parse(post.body!)).toEqual({ manuscriptId: id, allowComments: true, readerNameRequired: true });
    const tk = tokens();
    expect(Object.keys(tk).length).toBe(1);
    const token = Object.values(tk)[0]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(($('betaNewUrl') as HTMLInputElement).value).toBe(location.origin + '/read/' + token);
    const rows = sec().querySelectorAll('.beta-row');
    expect(rows.length).toBe(1);
    expect(rows[0]!.querySelector('.beta-st')!.textContent).toBe(t('beta.stActive'));
    expect(rows[0]!.querySelector('[data-beta-copy]')).not.toBe(null);
    expect(paths(/^\/api\/shares/)).toEqual(['POST /api/shares', 'GET /api/shares?manuscriptId=<id>']);
    // the token is nowhere else this device keeps (the book, the shelf link store)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k !== 'beuk.betaTokens.v1') expect(localStorage.getItem(k)).not.toContain(token);
    }
  }, 30_000);

  it('a link that expires: 1.0 sends expiresInDays and lists its expiry; revoke asks first, then POSTs revoke as 1.0 does', async () => {
    await ready();
    await create('7');
    const post = net.requests.find((r) => r.method === 'POST' && r.path === '/api/shares')!;
    expect((JSON.parse(post.body!) as Rec).expiresInDays).toBe(7);
    expect(sec().querySelector('.beta-row .a-meta')!.textContent).toContain(t('beta.expires', { date: '' }).trim().split(' ')[0]!);
    const asked: Rec[] = [];
    cloudUi.confirm = async (o) => (asked.push(o), true);
    const shareId = sec().querySelector('.beta-row')!.getAttribute('data-share-id')!;
    (sec().querySelector('[data-beta-revoke]') as HTMLElement).click();
    for (let i = 0; i < 40 && !toasts.includes(t('beta.revokedToast')); i++) await tick(50);
    expect(asked[0]!.title).toBe(t('beta.revokeTitle'));
    expect(net.requests.find((r) => r.path === '/api/shares/' + shareId + '/revoke')!.body).toBe('{}');
    expect(toasts).toContain(t('beta.revokedToast'));
    await tick(100);
    expect(sec().querySelector('.beta-st')!.textContent).toBe(t('beta.stRevoked'));
  }, 30_000);

  it("a reader's comments: listed as 1.0 groups them, resolved as 1.0 resolves them; a hostile comment is text", async () => {
    await ready();
    await create();
    const token = Object.values(tokens())[0]!;
    const book = SALT();
    const s0 = (book.sections as Rec[]).find((s) => s.type === 'chapter')!;
    const evil = '<img src=x onerror="window.__pw=1"><script>window.__pw=2</script>';
    const leave = (body: Rec) => net.fetch('/read/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await leave({ readerName: 'Ann', sectionId: s0.id, paragraph: 0, quote: '', body: 'Lovely opening.' })).status).toBe(201);
    expect((await leave({ readerName: '<b onmouseover="window.__pw=3">x</b>', sectionId: s0.id, paragraph: 1, quote: evil, body: evil })).status).toBe(201);

    document.body.insertAdjacentHTML('beforeend', '');
    cm.api.betaOpenComments();
    for (let i = 0; i < 40 && !$('betaCBody').querySelector('.bc-item'); i++) await tick(50);
    expect(paths(/^\/api\/shares\/comments/)).toEqual(['GET /api/shares/comments?manuscriptId=<id>']);
    const items = $('betaCBody').querySelectorAll('.bc-item');
    expect(items.length).toBe(2);
    expect($('betaCBody').querySelector('.bc-sec')!.textContent).toBe([s0.number, s0.title].filter(Boolean).join(' · ') || String(s0.type));
    expect(hazards($('modalBetaComments').innerHTML)).toEqual([]);
    expect((window as unknown as { __pw?: unknown }).__pw).toBe(undefined);
    expect(items[1]!.querySelector('.bc-body')!.textContent).toBe(evil);
    const first = items[0]!.getAttribute('data-comment-id')!;
    (items[0]!.querySelector('[data-bc-resolve]') as HTMLElement).click();
    for (let i = 0; i < 40 && $('betaCBody').querySelectorAll('.bc-item').length !== 1; i++) await tick(50);
    expect(net.requests.some((r) => r.method === 'POST' && r.path.endsWith('/comments/' + first + '/resolve'))).toBe(true);
    expect($('betaCBody').querySelectorAll('.bc-item').length).toBe(1); // resolved ones hidden, as 1.0 shows them
  }, 30_000);

  it('Jump to paragraph: 1.0 closes the comments and 2.0 opens that chapter (betaJump is 2.0\'s, through the studio)', async () => {
    await ready();
    await create();
    const token = Object.values(tokens())[0]!;
    const s0 = (SALT().sections as Rec[]).find((s) => s.type === 'chapter')!;
    await net.fetch('/read/' + token + '/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ readerName: 'Ann', sectionId: s0.id, paragraph: 0, quote: '', body: 'Here.' }) });
    const jumped: unknown[] = [];
    cloudUi.jump = async (c) => void jumped.push(c);
    cm.api.betaOpenComments();
    for (let i = 0; i < 40 && !$('betaCBody').querySelector('[data-bc-jump]'); i++) await tick(50);
    ($('betaCBody').querySelector('[data-bc-jump]') as HTMLElement).click();
    await tick(50);
    expect(jumped.length).toBe(1);
    expect((jumped[0] as Rec).sectionId).toBe(s0.id);
  }, 30_000);
});
