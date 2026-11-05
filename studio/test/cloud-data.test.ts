import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/cloud-markup.json';
import { cloudFacts, loadClosure, resetCloudFacts, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { bootCloud, cloudReset, cloudUi, deskChanged, deskSerialize, loadCloud, storedLink, type CloudClosure } from '../src/cloud/cloud';
import { fixtures } from './fixtures';
import { createImportOracle } from './import-oracle';
import { browser, startShelf, type Shelf } from './cloud-server';

/* Wave 7a — the shelf's data side, against the REAL server (src/app.ts on PGlite, in this process; test/cloud-server.ts).
   1.0's own cloud code (closure-cloud.js) runs unchanged; its relative "/api/…" requests reach the server through a
   browser-like fetch with a cookie jar. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let cm: CloudClosure;
let shelf: Shelf;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  cm = await loadCloud();
  shelf = await startShelf();
}, 60_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await shelf.close();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cloudReset();
  resetCloudFacts();
  document.body.innerHTML = '';
  localStorage.clear();
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** The desk holds `book` (a fresh Y.Doc), and 1.0's shelf markup is on the page. */
function desk(book: Rec): Y.Doc {
  const y = new Y.Doc();
  importBook(structuredClone(book), y);
  cloudUi.ydoc = () => y;
  cloudUi.replace = async (doc) => {
    const y2 = new Y.Doc();
    importBook(structuredClone(doc), y2);
    cloudUi.ydoc = () => y2;
    return y2;
  };
  document.body.innerHTML = markup.auth + markup.shelf + markup.account + markup.syncRow + markup.netPill;
  deskChanged(y);
  return y;
}
/** 1.0 (the oracle): the same book arrived on its desk, its serializeBook — the body 1.0 sends to the shelf. */
async function body10(book: Rec): Promise<Rec> {
  const o = await createImportOracle(t);
  o.api.applyBookDoc(structuredClone(book) as never);
  return JSON.parse(JSON.stringify(o.api.serializeBook()));
}
/** What 1.0 itself mints afresh for a book that lacks it: shown varying in 1.0 (two arrivals of the same book). */
function mask(doc: Rec): Rec {
  const d = structuredClone(doc);
  const m = d.meta as Rec | undefined;
  if (m && typeof m.bookId === 'string' && /^bk-|^[0-9a-f-]{36}$/.test(m.bookId)) m.bookId = '<id>';
  return d;
}

describe('the body a shelf save sends is 1.0\'s (decision 2, constraint 85)', () => {
  const all = fixtures('all');
  it(`serializeBook of the desk equals 1.0's own for the same book, every fixture (${all.length})`, async () => {
    // "the same book": the book as this device holds it (2.0's readBook has upgraded a legacy shape on the way in:
    // section ids, the scaffold, a legacy id's migration — 1.0 does the same work with fresh random ids, see below)
    const differ: string[] = [];
    for (const f of all) {
      const y = desk(f.book);
      const ours = JSON.parse(JSON.stringify(deskSerialize())) as Rec;
      const theirs = await body10(exportBook(y) as Rec);
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        differ.push(f.name);
        if (process.env.CLOUD_DIFF) for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) if (JSON.stringify(ours[k]) !== JSON.stringify(theirs[k])) console.log(f.name, k, JSON.stringify(ours[k]).slice(0, 300), '|||', JSON.stringify(theirs[k]).slice(0, 300));
      }
    }
    expect(differ).toEqual([]);
    expect(all.length).toBeGreaterThanOrEqual(23);
  }, 120_000);
  it('and for the stored fixture as 1.0 reads it (the real books, and every legacy shape 1.0 reads without minting)', async () => {
    const differ: string[] = [];
    for (const f of all) {
      desk(f.book);
      const ours = JSON.parse(JSON.stringify(deskSerialize())) as Rec;
      if (JSON.stringify(ours) !== JSON.stringify(await body10(f.book))) differ.push(f.name);
    }
    // OBSERVED (CLOUD_DIFF=1): the four where 1.0 mints afresh what the fixture lacks — a new bookId (bookid-missing),
    // new section ids and its scaffold (sections-missing, sections-split), a "bookid" History snapshot as it migrates a
    // legacy id (bookid-legacy) — and 2.0's readBook did the same once, deterministically, on the way in
    expect(differ).toEqual(['legacy/bookid-legacy', 'legacy/bookid-missing', 'legacy/sections-missing', 'legacy/sections-split']);
  }, 120_000);
});

describe('signed out: no API call but the probe and who is signed in', () => {
  it('boot → /api/health, /api/auth/me; an edit sends nothing', async () => {
    const b = browser(shelf.base);
    globalThis.fetch = b.fetch;
    const y = desk(fixtures('real')[0]!.book);
    await bootCloud();
    expect(cloudFacts.available).toBe(true);
    expect(cloudFacts.user).toBe(null);
    y.getMap('meta').set('meta', { ...(y.getMap('meta').get('meta') as Rec), title: 'Edited' });
    await tick(2700);
    expect(b.requests.map((r) => r.method + ' ' + r.path)).toEqual(['GET /api/health', 'GET /api/auth/me']);
  }, 20_000);
});

describe('register, bring the book, save, edit, autosave (H1, H2)', () => {
  it('the same requests 1.0 sends; the link is per device beside the book, never in it', async () => {
    const b = browser(shelf.base);
    globalThis.fetch = b.fetch;
    const lantern = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book;
    const y = desk(lantern);
    await bootCloud();
    // the sign-in dialog, register mode, as the writer types
    cm.api.openAuth();
    cm.api.setAuthMode('register');
    (document.getElementById('authEmail') as HTMLInputElement).value = 'w1@example.test';
    (document.getElementById('authPassword') as HTMLInputElement).value = 'correct horse battery';
    const asked: Rec[] = [];
    cloudUi.confirm = async (o) => {
      asked.push(o);
      return true; // "Bring it to my shelf"
    };
    await cm.api.cloudAuthSubmit();
    for (let i = 0; i < 40 && cloudFacts.linkState !== 'linked'; i++) await tick(50);
    expect((cloudFacts.user as Rec).email).toBe('w1@example.test');
    expect(asked.map((o) => o.title)).toEqual([t('shelf.bringTitle')]);
    expect(cloudFacts.linkState).toBe('linked');
    const post = b.requests.find((r) => r.method === 'POST' && r.path === '/api/manuscripts')!;
    expect(post.headers['beuk-pictures']).toBe('ref');
    expect(post.headers.prefer).toBe('return=minimal');
    const sent = JSON.parse(post.body!) as { title: string; doc: Rec };
    expect(sent.title).toBe((lantern.meta as Rec).title);
    // the doc as 1.0 sends it, its pictures named (BEUK:pics) — filled back in, it is 1.0's own body
    const filled = (await cm.api.picHydrate(sent.doc)) as Rec;
    expect(mask(filled)).toEqual(mask(await body10(lantern)));
    // the link: beside the book on this device (decision 2), never in the book
    const id = (lantern.meta as Rec).bookId as string;
    expect(storedLink(id)).toMatchObject({ linkedId: cloudFacts.linkedId, baseRevision: cloudFacts.baseRevision, shelfDirty: false });
    expect(JSON.stringify(y.getMap('meta').toJSON())).not.toContain(String(cloudFacts.linkedId));
    // an edit: 1.0's 2.5 s debounce, then PUT with If-Match on the revision
    const rev = cloudFacts.baseRevision;
    b.requests.length = 0;
    y.getMap('meta').set('meta', { ...(y.getMap('meta').get('meta') as Rec), title: 'The Lantern Coast, revised' });
    expect(cm.vars.cloudDirty).toBe(true);
    await tick(1000);
    expect(b.requests.filter((r) => r.path.startsWith('/api/manuscripts')).length).toBe(0);
    for (let i = 0; i < 60 && cloudFacts.baseRevision === rev; i++) await tick(100);
    const put = b.requests.find((r) => r.method === 'PUT')!;
    expect(put.path).toBe('/api/manuscripts/' + cloudFacts.linkedId);
    expect(put.headers['if-match']).toBe('"' + rev + '"');
    expect(cloudFacts.syncStatus).toBe('saved');
    expect(document.getElementById('syncText')!.textContent).toBe(t('sync.onShelf'));
  }, 40_000);
});

describe('opening a shelf book of another book id keeps its link (found by the e2e)', () => {
  it("the studio's own redraw sees the new generation before applyBookDoc's promise settles: the link is the opened book's", async () => {
    const b = browser(shelf.base);
    globalThis.fetch = b.fetch;
    const [one, two] = [fixtures('real').find((f) => f.name === 'real/salt-road-book-one')!.book, fixtures('real').find((f) => f.name === 'real/reads-you')!.book];
    desk(one);
    await bootCloud();
    const reg = await b.fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'race@example.test', password: 'correct horse battery' }) });
    cloudFacts.user = ((await reg.json()) as Rec).user;
    await cm.api.cloudBringBook();
    expect(cloudFacts.linkState).toBe('linked');
    const made = (await (await b.fetch('/api/manuscripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Two', doc: two }) })).json()) as { manuscript: { id: string } };
    // as BookProvider + CloudHost do it: the new generation is shown (and its effect runs) before replace() resolves
    cloudUi.replace = async (doc) => {
      await tick(0); // the device store writes first (importToDevice awaits)
      const y2 = new Y.Doc();
      importBook(structuredClone(doc), y2);
      cloudUi.ydoc = () => y2;
      deskChanged(y2);
      return y2;
    };
    await cm.api.cloudOpenBook(made.manuscript.id);
    await tick(50);
    expect(cloudFacts.linkedId).toBe(made.manuscript.id);
    expect(cloudFacts.linkState).toBe('linked');
  }, 30_000);
});

describe('1.0 fix (V, 2026-11-04): the account button is redrawn only when what it shows changes', () => {
  it('an edit while signed in (setSyncStatus "saving" again) writes nothing into #btnAccount', async () => {
    desk(fixtures('real')[0]!.book);
    cloudFacts.available = true;
    cloudFacts.user = { id: 'u', email: 'writer@example.test' };
    cm.api.setSyncStatus('saving');
    const btn = document.getElementById('btnAccount')!;
    expect(btn.querySelector('.acct-avatar')!.textContent).toBe('W');
    const seen: MutationRecord[] = [];
    const mo = new MutationObserver((r) => seen.push(...r));
    mo.observe(btn, { attributes: true, childList: true, subtree: true, characterData: true });
    for (let i = 0; i < 5; i++) cm.api.noteBookEdited();
    await tick(0);
    mo.disconnect();
    expect(seen.map((r) => r.type + ':' + (r.attributeName ?? ''))).toEqual([]);
    // what it shows changes: it is drawn again
    cm.api.setSyncStatus('saved');
    expect(btn.querySelector('.sync-dot')!.className).toBe('sync-dot');
  });
});
