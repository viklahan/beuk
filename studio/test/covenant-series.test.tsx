import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { cloudFacts, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { covReset, covRun } from '../src/covenant/covenant';
import { installSeriesNet, installSeriesRetry, seriesRetryTick, setCovenantFetch } from '../src/covenant/net';
import { SeriesConflict } from '../src/covenant/CovenantDialog';

/* Wave 3b, task 3 (inventory C6, review focus #4): the series Covenant — one Covenant shared by every book of a
   series, kept on the shelf (/api/series-covenants/<key>), with 1.0's own sync, join, merge, leave and conflict code,
   run on 2.0's book. 1.0's self-checks re-expressed: bible.series.signin, bible.series.crossbook (its core),
   bible.series.conflict (its core), bible.series.join, bible.series.merge, bible.series.leave (its core). Each
   check drives 1.0's code through a mocked shelf (1.0's own BIBLE_SX books) as 1.0's checks do; what 2.0 adds is
   checked here: what reaches the BOOK (the Y.Doc's export) and what reaches the network, through 2.0's apiFetch. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
const cloud = cloudFacts as unknown as { available: boolean; user: unknown; shelf?: unknown; linkedId?: unknown; baseUpdatedAt?: unknown };
type Net = Closure['api']['bibleSeriesNet'];
let keepNet: Net;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  keepNet = { ...c.api.bibleSeriesNet };
});
beforeEach(() => {
  localStorage.clear();
  covReset();
  const a = c.api;
  Object.assign(a.bibleUi, { sel: null, mode: 'entry', query: '', detail: false, filter: 'all', merge: null });
  Object.assign(a.bibleSeriesMem, { user: null, gone: [], dismissed: [], shelf: {}, ids: null, scanning: false, scanWait: null, absent: null });
  Object.assign(a.bibleSeriesSync, { userId: null, kept: null, dirty: false, editAt: 0, pending: 0, conflict: null, syncedJson: null, running: false, again: false, timer: null, stepTimer: null, seq: 0, last: null, refused: 0 });
  c.vars.bibleSeries = null;
  cloud.user = null;
  cloud.available = false;
  cloud.shelf = undefined;
  cloud.linkedId = undefined;
});
afterEach(() => {
  cleanup();
  Object.assign(c.api.bibleSeriesNet, keepNet);
  setCovenantFetch(null);
  desk.ydoc = null;
  cloud.user = null;
  cloud.available = false;
});

const SECS = (): Rec[] => [
  { id: 'bibc1', kind: 'body', type: 'chapter', number: '1', title: 'The Quay', subtitle: '', content: "Slowly the fog held. At dawn Mara walked to the quay where Captain Hale was waiting. The ferry from Gullwick was late again. Slowly nobody spoke. Mara's lantern hissed in the damp, and the dog barked at Captain Hale." },
  { id: 'bibc2', kind: 'body', type: 'chapter', number: '2', title: 'Crossing', subtitle: '', content: 'Slowly the sea turned grey. They left Gullwick behind, and Mara watched the gulls. Later Captain Hale said nothing at all. Slowly, the wind rose. By noon Mara was asleep and Gullwick was only a smudge on the line of the sea.' },
];
/* 1.0's BIBLE_SX: Book Two of "Salt Road" on the desk; Book One of it and a book of another series on a mocked shelf */
const SX = {
  user: { id: 'sx-user', email: 'check@beuk.invalid' },
  shelf: () => [
    { id: 'm-one', title: 'Book One', revision: 3, updatedAt: '2026-05-01T00:00:00.000Z' },
    { id: 'm-two', title: 'Book Two', revision: 8, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'm-other', title: 'Glass Kings', revision: 2, updatedAt: '2026-02-01T00:00:00.000Z' },
  ],
  one: (): Rec => ({
    meta: { title: 'Book One', author: 'Fixture', language: 'en', series: 'salt  ROAD', seriesNumber: 1, bookId: 'sx-one' },
    sections: [{ id: 's1c1', kind: 'body', type: 'chapter', number: '1', title: 'Harbour', subtitle: '', content: 'Mara climbed the mast while Charles watched. Old Wren mended the nets.' }],
    bible: {
      entries: [
        { id: 'o-mara', type: 'character', name: 'Mara', aliases: ['Mara Q', 'Quill'], tags: ['crew'], facts: { age: '19' }, changes: [{ id: 'oc1', anchor: { sec: 's1c1', quote: 'Mara climbed the mast', at: 0 }, text: 'learns the ropes' }] },
        { id: 'o-charles', type: 'character', name: 'Charles', description: 'the harbour master' },
        { id: 'o-wren', type: 'character', name: 'Wren' },
        { id: 'o-tam', type: 'character', name: 'Bosun Tam', aliases: ['Tam', 'Old Tom'] },
      ],
      fields: { character: [{ id: 'age', label: 'Age' }] },
      counts: { 'o-mara': [1], 'o-charles': [1] },
    },
  }),
  other: (): Rec => ({ meta: { title: 'Glass Kings', series: 'Glass Kings', seriesNumber: 1, bookId: 'sx-glass' }, sections: [], bible: { entries: [{ id: 'g-mara', type: 'character', name: 'Mara' }] } }),
  two: (bible?: Rec): Rec => ({
    meta: { title: 'Book Two', author: 'Fixture', language: 'en', langSource: 'manual', series: 'Salt Road', seriesNumber: 2, bookId: 'sx-two' },
    sections: SECS().concat([{ id: 'bibc3', kind: 'body', type: 'chapter', number: '3', title: 'Oars', subtitle: '', content: 'Charles rowed out to meet Mara. Charles said the tide was turning.' }]),
    bible: bible || {
      entries: [
        { id: 't-mara', type: 'character', name: 'Mara', aliases: ['Mara Q'], tags: ['captain-to-be'], facts: { age: '17' }, changes: [{ id: 'tc1', anchor: { sec: 'bibc2', quote: 'Mara watched the gulls', at: 0 }, text: 'watches the gulls' }] },
        { id: 't-charles', type: 'character', name: 'Charles', description: 'the ferryman' },
        { id: 't-hale', type: 'character', name: 'Captain Hale', aliases: ['Hale'] },
        { id: 't-gull', type: 'place', name: 'Gullwick', scope: 'book' },
        { id: 't-pip', type: 'thing', name: 'Pip lantern' },
        { id: 't-tam', type: 'character', name: 'Tam' },
        { id: 't-tom', type: 'character', name: 'Old Tom' },
      ],
      fields: { character: [{ id: 'age', label: 'Age' }] },
    },
  }),
  /** 1.0's mocked shelf: `answer` may answer first; otherwise the series row is absent and the books are as above. */
  net: (calls: string[], answer?: (m: string, path: string, opts: Rec, body: Rec | null) => unknown) => (path: string, opts: Rec) => {
    const m = (opts && (opts.method as string)) || 'GET', im = opts && opts.headers && (opts.headers as Rec)['If-Match'], body = opts && opts.body ? (JSON.parse(opts.body as string) as Rec) : null;
    calls.push(m + ' ' + path + (im ? ' ' + String(im) : ''));
    const own = answer && answer(m, path, opts, body);
    if (own !== undefined) return own;
    if (m === 'GET' && path === '/api/manuscripts/m-one') return { manuscript: { id: 'm-one', title: 'Book One', doc: SX.one(), revision: 3, updatedAt: '2026-05-01T00:00:00.000Z' } };
    if (m === 'GET' && path === '/api/manuscripts/m-other') return { manuscript: { id: 'm-other', title: 'Glass Kings', doc: SX.other(), revision: 2, updatedAt: '2026-02-01T00:00:00.000Z' } };
    if (m === 'GET' && path.indexOf('/api/series-covenants/') === 0) return { __status: 404, __error: 'series not found', __body: { error: 'series not found' } };
    return null;
  },
};
/** Book Two on the desk, signed in, linked to its shelf copy and saved, the series row absent (1.0's BIBLE_SX.desk). */
function deskTwo(bible?: Rec): Y.Doc {
  const y = new Y.Doc();
  importBook(SX.two(bible), y);
  desk.ydoc = y;
  desk.active = null;
  covReset();
  installSeriesNet(c);
  cloud.user = SX.user;
  cloud.available = true;
  cloud.shelf = SX.shelf();
  cloud.linkedId = 'm-two';
  cloud.baseUpdatedAt = '2026-01-01T00:00:00.000Z';
  return y;
}
const stub = (n: Partial<Net>) => Object.assign(c.api.bibleSeriesNet, { store: () => null, load: () => null, pref: () => null, ask: () => false }, n);

describe('the series Covenant, signed out and signed in', () => {
  it('bible.series.signin: signed out, a book that names a series fetches nothing and reads nothing from the device; everything else works on the book alone, and nothing is written', () => {
    const y = deskTwo();
    cloud.user = null;
    const calls: string[] = [];
    let loads = 0;
    stub({ fetch: SX.net(calls) as Net['fetch'], load: () => (loads++, null) });
    const before = JSON.stringify(exportBook(y));
    covRun((cc) => cc.api.bibleSeriesRefresh(true));
    expect([calls, loads, c.vars.bibleSeries]).toEqual([[], 0, null]);
    expect(covRun((cc) => cc.api.bibleAllEntries().length)).toBe(7);
    expect(JSON.stringify(exportBook(y))).toBe(before);
    // and 2.0's transport itself refuses, signed out: no request leaves the page
    let fetched = 0;
    setCovenantFetch((async () => (fetched++, new Response('{}'))) as typeof fetch);
    Object.assign(c.api.bibleSeriesNet, keepNet);
    installSeriesNet(c);
    covRun((cc) => cc.api.bibleSeriesRefresh(true));
    expect(fetched).toBe(0);
  });

  it("signed in, the series row is read through 2.0's apiFetch (1.0's request: GET /api/series-covenants/<key>, same-origin): its entries join the book's in scope, an edit to one lands in the series doc and never in the book, and the save goes on the revision it was based on (If-Match)", async () => {
    const y = deskTwo({ entries: [{ id: 'own-gull', type: 'place', name: 'Gullwick' }] });
    const seen: { url: string; method: string; ifMatch: string | null; body: Rec | null }[] = [];
    let rev = 3;
    setCovenantFetch((async (url: string, init?: RequestInit) => {
      const h = (init?.headers || {}) as Record<string, string>;
      seen.push({ url, method: init?.method || 'GET', ifMatch: h['If-Match'] ?? null, body: init?.body ? (JSON.parse(String(init.body)) as Rec) : null });
      if ((init?.method || 'GET') === 'GET') return new Response(JSON.stringify({ series: { key: 'salt road', name: 'Salt Road', revision: rev, doc: { entries: [{ id: 'sx-mara', type: 'character', name: 'Mara' }] } } }), { status: 200 });
      rev++;
      return new Response(JSON.stringify({ series: { key: 'salt road', name: 'Salt Road', revision: rev, doc: (JSON.parse(String(init!.body)) as Rec).doc } }), { status: 200 });
    }) as typeof fetch);
    Object.assign(c.api.bibleSeriesNet, keepNet, { store: () => null, load: () => null });
    (c.api.bibleSeriesNet as unknown as { __beuk?: boolean }).__beuk = false;
    installSeriesNet(c);
    const before = JSON.stringify(exportBook(y));
    covRun((cc) => cc.api.bibleSeriesRefresh(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.map((x) => x.method + ' ' + x.url)).toEqual(['GET /api/series-covenants/salt%20road']);
    expect(c.vars.bibleSeries?.revision).toBe(3);
    expect(covRun((cc) => cc.api.bibleAllEntries().map((e) => e.id))).toEqual(['sx-mara', 'own-gull']);
    expect(JSON.stringify(exportBook(y))).toBe(before); // reading the series writes nothing
    // an edit to the series entry: the series doc changes, the book does not
    covRun((cc) => {
      cc.api.bibleById('sx-mara')!.description = 'Keeper of the light';
      cc.api.bibleTouched(false);
    });
    expect(JSON.stringify(exportBook(y))).toBe(before);
    expect(c.vars.bibleSeries?.doc.entries[0]!.description).toBe('Keeper of the light');
    // 1.0's pause (300 ms) and save (2.5 s), taken over by covRun's timers
    await new Promise((r) => setTimeout(r, 3100));
    const put = seen.find((x) => x.method === 'PUT');
    expect(put?.url).toBe('/api/series-covenants/salt%20road');
    expect(put?.ifMatch).toBe('"3"');
    expect(((put?.body?.doc as Rec).entries as Rec[])[0]!.description).toBe('Keeper of the light');
    expect(c.vars.bibleSeries?.revision).toBe(4);
    expect(JSON.stringify(exportBook(y))).toBe(before);
  }, 15_000);
});

describe('joining and merging (1.0\'s mocked shelf)', () => {
  it('bible.series.join + bible.series.merge: two shelf books of the series (any case or spacing) and no row: the offer counts two books; Yes reads them and asks; Save stays disabled until every shared name is answered; Same in both makes one series entry; the book keeps only what it did not give (its "only this book" entry), written as 1.0 writes it; the other book gives its entries through the shelf', () => {
    const y = deskTwo();
    const calls: string[] = [];
    stub({
      fetch: SX.net(calls, (m, path, _o, body) => {
        if (m === 'PUT' && path === '/api/series-covenants/salt%20road') return { series: { key: 'salt road', name: 'Salt Road', revision: 1, doc: body!.doc } };
        if (m === 'PUT' && path === '/api/manuscripts/m-one') return { manuscript: { id: 'm-one', revision: 4 } };
        return undefined;
      }) as Net['fetch'],
    });
    const start = exportBook(y) as Rec & { bible: { entries: Rec[] } };
    covRun((cc) => cc.api.bibleSeriesRefresh(true)); // the row is absent: the offer may ask
    covRun((cc) => cc.api.bibleShelfScan());
    expect(calls).toContain('GET /api/manuscripts/m-one');
    expect(calls).not.toContain('GET /api/manuscripts/m-two'); // the open book's own shelf copy is never read
    expect(covRun((cc) => cc.api.bibleJoinOffered())).toBe(2);
    covRun((cc) => cc.api.bibleJoinStart());
    const plan = c.api.bibleUi.merge as { asks: { answer?: string; onlyDiff?: boolean }[] };
    expect(plan.asks.length).toBeGreaterThan(0);
    expect(covRun((cc) => cc.api.bibleMergeSave())).toBeNull(); // not every name answered: nothing saved
    expect(calls.some((x) => x.startsWith('PUT'))).toBe(false);
    plan.asks.forEach((a) => (a.answer = a.onlyDiff ? 'diff' : 'same'));
    covRun((cc) => cc.api.bibleMergeSave());
    expect(calls).toContain('PUT /api/series-covenants/salt%20road');
    expect(calls.some((x) => x.startsWith('PUT /api/manuscripts/m-one'))).toBe(true);
    const ser = c.vars.bibleSeries!;
    expect(ser.doc.entries.filter((e) => e.name === 'Mara').length).toBe(1);
    const book = exportBook(y) as Rec & { bible: { entries: Rec[] } };
    // what stays in the book: the entry kept "only this book"; the rest went to the series
    expect(book.bible.entries.map((e) => e.name)).toEqual(['Gullwick']);
    expect(start.bible.entries.length).toBe(7);
    // and 1.0's serializeBook of the same state writes exactly that (bibleNormalize, the counts it holds)
    expect(JSON.stringify(book.bible)).toBe(JSON.stringify(covRun((cc) => (cc.api.bibleCountsNow(), cc.api.bibleNormalize((cc.getState() as Rec).bible)))));
  });

  it("bible.series.leave (its core): leaving copies into the book the series entries it mentions, keeps its own, drops the series name; the book is written as 1.0 saves it", () => {
    const y = deskTwo({ entries: [{ id: 'own-gull', type: 'place', name: 'Gullwick' }] });
    stub({ fetch: SX.net([]) as Net['fetch'] });
    covRun((cc) => cc.api.bibleSeriesSet({ key: 'salt road', name: 'Salt Road', revision: 2, doc: { entries: [{ id: 'sx-mara', type: 'character', name: 'Mara' }, { id: 'sx-zed', type: 'character', name: 'Zed Nobody' }] } }, SX.user.id, false));
    covRun((cc) => cc.api.bibleSeriesLeave(''));
    const book = exportBook(y) as Rec & { meta: Rec; bible: { entries: Rec[] } };
    expect(book.bible.entries.map((e) => e.name)).toEqual(['Gullwick', 'Mara']);
    expect('series' in book.meta).toBe(false);
    expect(c.vars.bibleSeries).toBeNull();
  });
});

describe('the conflict notice', () => {
  it("bible.series.conflict (its core): a 409 on the series save raises 1.0's notice in the series' words (Keep both not offered), nothing is re-sent while it waits; Keep mine saves on the shelf's revision", () => {
    render(
      <LocaleProvider initial="en">
        <SeriesConflict />
      </LocaleProvider>,
    );
    const y = deskTwo({ entries: [] });
    const calls: string[] = [];
    let phase = 0;
    stub({
      fetch: SX.net(calls, (m, path, _o, body) => {
        if (m !== 'PUT' || !path.startsWith('/api/series-covenants/')) return undefined;
        if (phase++ === 0) return { __status: 409, __error: 'conflict', __body: { series: { name: 'Salt Road', revision: 7, doc: { entries: [{ id: 'sx-mara', type: 'character', name: 'Mara', description: 'theirs' }] } } } };
        return { series: { name: 'Salt Road', revision: 8, doc: body!.doc } };
      }) as Net['fetch'],
    });
    const before = JSON.stringify(exportBook(y));
    covRun((cc) => cc.api.bibleSeriesSet({ key: 'salt road', name: 'Salt Road', revision: 6, doc: { entries: [{ id: 'sx-mara', type: 'character', name: 'Mara' }] } }, SX.user.id, false));
    covRun((cc) => {
      cc.api.bibleById('sx-mara')!.description = 'mine';
      cc.api.bibleSeriesStep();
      cc.api.bibleSeriesSaveNow();
    });
    expect(calls.filter((x) => x.startsWith('PUT'))).toEqual(['PUT /api/series-covenants/salt%20road "6"']);
    const m = document.getElementById('modalConflict')!;
    expect(m.classList.contains('open')).toBe(true);
    expect(document.getElementById('conflictTitle')!.textContent).toBe(t('bible.seriesConflictTitle'));
    expect((document.getElementById('btnConflictBoth') as HTMLElement).hidden).toBe(true);
    covRun((cc) => cc.api.bibleSeriesSaveNow()); // waiting on the writer: nothing re-sent
    expect(calls.filter((x) => x.startsWith('PUT')).length).toBe(1);
    act(() => (document.getElementById('btnConflictMine') as HTMLElement).click());
    expect(calls.filter((x) => x.startsWith('PUT'))).toEqual(['PUT /api/series-covenants/salt%20road "6"', 'PUT /api/series-covenants/salt%20road "7"']);
    expect(m.classList.contains('open')).toBe(false);
    expect(c.vars.bibleSeries?.revision).toBe(8);
    expect(JSON.stringify(exportBook(y))).toBe(before); // the series is not the book
  });
});

describe('Project Settings and the series Covenant', () => {
  it("R24 (bible.series.leave, signed-out half): signed out, a book whose Covenant leans on its series (it holds the series' counts) cannot change its series name: Save keeps the name, 1.0's note says why beside the field and Project Settings stays open on it (a free change: settings.test.tsx)", async () => {
    const { App } = await import('../src/App');
    const { importToDevice } = await import('../src/book/store');
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const book = SX.two({ entries: [{ id: 't-mara', type: 'character', name: 'Mara' }], counts: { 't-mara': [2, 2, 1] } });
    await importToDevice(book);
    localStorage.setItem('beuk.tour.v1', 'done');
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
    await waitFor(() => expect($('btnSettings2')).not.toBeNull(), { timeout: 20_000 });
    await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
    await act(async () => fireEvent.click($('btnSettings2')));
    await waitFor(() => expect($('setSeries')).not.toBeNull(), { timeout: 10_000 });
    fireEvent.change($('setSeries'), { target: { value: 'Another Road' } });
    await act(async () => fireEvent.click($('btnSaveSettings')));
    expect($('setSeriesNote').hidden).toBe(false);
    expect($('setSeriesNote').textContent).toBe(t('bible.seriesHeld'));
    expect($('setSeries').value).toBe('Another Road'); // the typed name kept in the field
    const y = desk.ydoc!;
    expect((exportBook(y).meta as Rec).series).toBe('Salt Road');
  }, 60_000);
});

describe('a series save that failed (review of wave 3b, should-fix 1)', () => {
  it('a PUT lost to the network waits counted, goes again when the browser is back online (and on the 30 s retry), and an edit in its pause goes when the page hides', async () => {
    deskTwo({ entries: [{ id: 'own-gull', type: 'place', name: 'Gullwick' }] });
    const puts: string[] = [];
    let fail = true;
    let rev = 3;
    setCovenantFetch((async (_url: string, init?: RequestInit) => {
      if ((init?.method || 'GET') === 'GET') return new Response(JSON.stringify({ series: { key: 'salt road', name: 'Salt Road', revision: rev, doc: { entries: [{ id: 'sx-mara', type: 'character', name: 'Mara' }] } } }), { status: 200 });
      const d = ((JSON.parse(String(init!.body)) as Rec).doc as { entries: Rec[] }).entries[0]!.description as string;
      puts.push(d + (fail ? ' (lost)' : ''));
      if (fail) throw new TypeError('Failed to fetch');
      rev++;
      return new Response(JSON.stringify({ series: { key: 'salt road', name: 'Salt Road', revision: rev, doc: (JSON.parse(String(init!.body)) as Rec).doc } }), { status: 200 });
    }) as typeof fetch);
    Object.assign(c.api.bibleSeriesNet, keepNet, { store: () => null, load: () => null });
    (c.api.bibleSeriesNet as unknown as { __beuk?: boolean }).__beuk = false;
    installSeriesNet(c);
    const un = installSeriesRetry();
    try {
      covRun((cc) => cc.api.bibleSeriesRefresh(true));
      await new Promise((r) => setTimeout(r, 30));
      covRun((cc) => {
        cc.api.bibleById('sx-mara')!.description = 'one';
        cc.api.bibleTouched(false);
      });
      await new Promise((r) => setTimeout(r, 3100));
      expect(puts).toEqual(['one (lost)']);
      expect(c.api.bibleSeriesSync.pending).toBeGreaterThan(0);
      // still out of reach: the 30 s retry sends it, and it is lost again (still counted)
      seriesRetryTick();
      await new Promise((r) => setTimeout(r, 30));
      expect(puts).toEqual(['one (lost)', 'one (lost)']);
      expect(c.api.bibleSeriesSync.pending).toBeGreaterThan(0);
      // back online: it goes, and nothing waits
      fail = false;
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 30));
      expect(puts).toEqual(['one (lost)', 'one (lost)', 'one']);
      expect(c.api.bibleSeriesSync.pending).toBe(0);
      expect(c.vars.bibleSeries?.revision).toBe(4);
      // an edit in its 300 ms pause, then the page hides: it goes at once
      covRun((cc) => {
        cc.api.bibleById('sx-mara')!.description = 'two';
        cc.api.bibleTouched(false);
      });
      window.dispatchEvent(new Event('pagehide'));
      await new Promise((r) => setTimeout(r, 30));
      expect(puts.at(-1)).toBe('two');
      // nothing waiting: a retry sends nothing
      const n = puts.length;
      seriesRetryTick();
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 30));
      expect(puts.length).toBe(n);
    } finally {
      un();
    }
  }, 15_000);
});
