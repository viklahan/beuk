import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { loadClosure, loadSample, setClosureT, type Closure } from '../src/closure/index';
import { live, restoreDoc } from '../src/history/history';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { buildSample, preRenameArrival, resetSamplePictures, sampleLoaded, staleSweep, sweepFor } from '../src/sample/sample';
import { fixtures } from './fixtures';

/* Wave 1c, task 4b (wave 1b deferred it): 1.0's arrival sweep of old sample
   copies, sampleSweepPreRename / sampleSweepStaleCover, and its self-check
   sample.legacy-salt-meridian. Fail-safe (1b's rule): only a book 1.0's own
   tests identify as the sample is touched; anything unreadable or unknown
   is left alone; a writer's own book never is. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const UNTITLED = t('misc.untitledBook');
const OLD_TITLE = 'The Salt Meridian';
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  await loadSample();
  setClosureT(t);
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  resetSamplePictures();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const open = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  return y;
};
/** 1.0's check's oldDoc: the sample under its old title and an id, its About the Author holding fixture words. */
function oldDoc(id: string): Rec & { sections: Rec[]; meta: Rec } {
  const d = buildSample(c, null);
  d.meta.title = OLD_TITLE;
  d.meta.bookId = id;
  const ab = d.sections.find((x) => x.type === 'aboutauthor') || d.sections[d.sections.length - 1]!;
  ab.content = 'Fixture words only the old copy carries — ' + OLD_TITLE + ' — kept verbatim.';
  return d;
}
const texts = (b: Rec) => (b.sections as Rec[]).map((x) => x.content).join('\n');

describe('sample.legacy-salt-meridian', () => {
  it('1. the pre-UUID old id (migrated on arrival): recognised, put into History ("Before sample update"), replaced by the current sample; not swapped again; restoring gives the old text back exactly, as the writer\'s own book', () => {
    const d1 = oldDoc('urn:uuid:beuk-sample-salt-meridian');
    const oldText = texts(d1);
    const y = open(d1);
    const m = exportBook(y).meta as Rec;
    // 2.0 opens it the way 1.0's applyBookDoc does: the old id migrated to its UUIDv5, the old one kept
    expect(m.bookId).toBe(c.api.bookIdMigrated('urn:uuid:beuk-sample-salt-meridian'));
    expect(m.legacyBookIds).toContain('urn:uuid:beuk-sample-salt-meridian');
    const sw = sweepFor(c, y, UNTITLED);
    expect(sw).toEqual({ kind: 'prerename', oldTitle: OLD_TITLE });
    const arrived = open(preRenameArrival(c, y));
    const am = exportBook(arrived).meta as Rec;
    expect(am.title).toBe(buildSample(c, null).meta.title);
    expect(am.bookId).toBe(c.api.SAMPLE_BOOK_ID);
    const hist = live(c, arrived).state.history;
    expect(hist[0]!.auto).toBe('sampleupdate');
    expect((hist[0]!.doc.meta as Rec).title).toBe(OLD_TITLE);
    expect(sweepFor(c, arrived, UNTITLED)).toBeNull();
    const back = restoreDoc(c, arrived, hist[0]!.id)!;
    expect(texts(back)).toBe(oldText);
    expect((back.meta as Rec).title).toBe(OLD_TITLE);
    expect(c.api.isSampleBookId((back.meta as Rec).bookId)).toBe(false);
    expect(((back.meta as Rec).legacyBookIds as unknown[] | undefined)?.length ?? 0).toBe(0);
    expect(sweepFor(c, open(back), UNTITLED)).toBeNull();
  });

  it('2. the fixed sample id with the old title is recognised', () => {
    expect(sweepFor(c, open(oldDoc(c.api.SAMPLE_BOOK_ID)), UNTITLED)?.kind).toBe('prerename');
  });

  it('3. never touched: the current sample, an unrelated book with the old title, the old id retitled and re-authored, every fixture book, and a book that cannot be read', () => {
    expect(sweepFor(c, open(buildSample(c, null)), UNTITLED)).toBeNull();
    expect(sweepFor(c, open(oldDoc(c.api.newBookId())), UNTITLED)).toBeNull();
    const mine = oldDoc('urn:uuid:beuk-sample-salt-meridian');
    mine.meta.title = 'My Own Novel';
    mine.meta.author = 'A. Writer';
    expect(sweepFor(c, open(mine), UNTITLED)).toBeNull();
    for (const f of fixtures('all')) expect(sweepFor(c, open(f.book), UNTITLED), f.name).toBeNull();
    // fail-safe: a book whose meta is not an object, or whose tests throw, is left alone
    const odd = new Y.Doc();
    odd.getMap('meta').set('meta', 'not an object');
    expect(sweepFor(c, odd, UNTITLED)).toBeNull();
    expect(c.api.isSampleBookId('urn:uuid:beuk-sample-salt-meridian')).toBe(true);
    // the packaged cover is not a stale one, and a same-length look-alike is not either
    expect(c.api.sampleCoverIsStale(c.sample!.sampleCoverDoc())).toBe(false);
    expect(c.api.SAMPLE_COVER_STALE.some((s) => c.api.sampleCoverIsStale({ data: 'A'.repeat(s.len) }))).toBe(false);
  });

  it('4. the sample saved under its old author, edited: renamed everywhere, the writer\'s words kept, "Before sample update" first; not swept again; a book that is not the sample keeps that author', () => {
    const OLD = c.api.SAMPLE_OLD_AUTHOR, NEW = c.api.SAMPLE_AUTHOR;
    const d = buildSample(c, null);
    d.meta.author = OLD;
    (d.coverRecipe as Rec).author = OLD;
    for (const x of d.sections) {
      if (x.type === 'aboutauthor') x.content = String(x.content).split(NEW).join(OLD);
      if (x.type === 'chapter' && x.number === 'One') x.content += '\n\nA line the writer added.';
    }
    for (const im of d.images as Rec[]) if (im.id === 'sample-img-portrait') im.name = String(im.name).split(NEW).join(OLD);
    const y = open(d);
    const histBefore = live(c, y).state.history.length;
    const sw = sweepFor(c, y, UNTITLED);
    expect(sw).toEqual({ kind: 'stale', staleCover: false, oldAuthor: true });
    expect(staleSweep(c, y, sw as { staleCover: boolean; oldAuthor: boolean }, false)).toBe(true);
    const b = exportBook(y) as Rec & { sections: Rec[]; images: Rec[] };
    const flat = JSON.stringify({ m: (b.meta as Rec).author, r: (b.coverRecipe as Rec).author, s: b.sections.map((x) => x.content), i: b.images.map((im) => im.name) });
    expect(flat.includes(OLD)).toBe(false);
    expect((b.meta as Rec).author).toBe(NEW);
    expect(String(b.sections.find((x) => x.type === 'chapter' && x.number === 'One')!.content)).toContain('A line the writer added.');
    const hist = live(c, y).state.history;
    expect(hist.length).toBe(histBefore + 1);
    expect(hist[0]!.auto).toBe('sampleupdate');
    expect((hist[0]!.doc.meta as Rec).author).toBe(OLD);
    expect(sweepFor(c, y, UNTITLED)).toBeNull();
    const notSample = buildSample(c, null);
    notSample.meta.bookId = c.api.newBookId();
    notSample.meta.legacyBookIds = [];
    notSample.meta.author = OLD;
    expect(sweepFor(c, open(notSample), UNTITLED)).toBeNull();
  });

  it('in the studio: a backup of a pre-rename copy opens as the current sample, says so with 1.0\'s toast, and keeps the copy in History', async () => {
    const d1 = oldDoc('urn:uuid:beuk-sample-salt-meridian');
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
    const input = document.querySelector('#btnOpenBackup + input') as HTMLInputElement;
    const file = new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book: d1 })], 'old.beuk-backup.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const now = buildSample(c, null).meta.title as string;
    await waitFor(() => expect(document.getElementById('projectTitleDisplay')!.textContent).toBe(now), { timeout: 20_000 });
    await waitFor(() => expect(document.getElementById('toasts')!.textContent).toContain(t('sample.legacyUpdated', { old: OLD_TITLE })), { timeout: 10_000 });
    await waitFor(() => expect(document.querySelector('#btnSampleStory .lucide-book-x')).not.toBeNull());
    fireEvent.click(document.getElementById('btnHistory')!);
    await waitFor(() => expect(document.getElementById('historyList')!.textContent).toContain(t('history.auto.sampleupdate')));
  });

  it('in the studio: a writer\'s own book arriving (a backup, then this device restoring it) is never touched', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const ob = await importToDevice(f.book);
    const before = JSON.stringify(ob.export());
    await ob.close();
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
    await new Promise((r) => setTimeout(r, 300));
    let blob: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(document.getElementById('btnLocalBackup')!);
    expect(JSON.stringify((JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec }).book)).toBe(before);
    expect(sampleLoaded(null)).toBe(false);
  });
});
