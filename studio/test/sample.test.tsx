import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { readRegistry } from '../src/book/store';
import { statsOf } from '../src/book/stats';
import { loadClosure, loadSample, setClosureT, type Closure } from '../src/closure/index';
import { live } from '../src/history/history';
import { snapshotLabel } from '../src/history/HistoryDialog';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import {
  buildSample, emptyAfterSample, ensureSamplePictures, fillSamplePictures, newBookArrival, resetSamplePictures, sampleArrival, samplePicsMissing,
  deskIsUntouchedSample, sampleLoaded, sampleRecord, sampleShippedWords, sampleSigOf, SAMPLE_MAP, SAMPLE_PIC_DIR, setSampleRecord,
} from '../src/sample/sample';
import { BOOKS, fixtures } from './fixtures';

/* Wave 1b, task 4: the sample book and New book (inventory I8).
   Review focus #4 — the sample book is a replace: Load goes through 1.0's
   confirm (over the writer's own book), then a snapshot, then a new
   generation; Remove and New book follow 1.0's removeSampleStory and
   startNewBookNow; the pictures come from /assets/sample/ (1.0's files,
   checked against 1.0's byte lengths and SHA-256).
   1.0 self-checks re-expressed: sample.book.scale-words-chapters,
   sample.toggle.empty-to-sample-to-empty, sample.load.idempotent-double-load,
   sample.remove.leaves-nothing (book and device halves), sample.count.truthful,
   sample.empty-desk.no-figures (the sidebar half), and the sample halves of
   history.autosafety and history.restore.snapshot-always. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const ASSETS = path.join(BOOKS, '..', '..', '..', 'client', 'assets', 'sample');
let c: Closure;

/** fetch for /assets/sample/<file>: 1.0's files from the repo (as Caddy serves client/), else 404. */
const diskFetch = (async (url: string) => {
  const u = String(url);
  if (!u.startsWith(SAMPLE_PIC_DIR)) return new Response('not found', { status: 404 });
  try {
    return new Response(readFileSync(path.join(ASSETS, u.slice(SAMPLE_PIC_DIR.length))), { status: 200 });
  } catch {
    return new Response('not found', { status: 404 });
  }
}) as unknown as typeof fetch;

beforeAll(async () => {
  c = await loadClosure();
  await loadSample(); // the sample chunk (wave 1c task 4): buildSample needs it
  setClosureT(t);
});
beforeEach(() => {
  localStorage.clear();
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

describe('the sample is 1.0\'s, at its scale (sample.book.scale-words-chapters, sample.count.truthful)', () => {
  it('measures 24,000–26,500 words by 1.0\'s counter, 12–16 chapters, a prologue, an epilogue, three or more note definitions; the button\'s count is SAMPLE_WORDS', () => {
    const book = buildSample(c, null);
    const y = open(book);
    const words = statsOf(c, y).words;
    expect(words).toBeGreaterThanOrEqual(24000);
    expect(words).toBeLessThanOrEqual(26500);
    expect(words).toBe(c.api.SAMPLE_WORDS);
    expect(sampleShippedWords(c)).toBe(c.api.SAMPLE_WORDS);
    const secs = exportBook(y).sections as Rec[];
    const ch = secs.filter((s) => s.type === 'chapter').length;
    expect(ch).toBeGreaterThanOrEqual(12);
    expect(ch).toBeLessThanOrEqual(16);
    expect(secs.some((s) => s.type === 'prologue')).toBe(true);
    expect(secs.some((s) => s.type === 'epilogue')).toBe(true);
    expect(secs.reduce((n, s) => n + (String(s.content).match(/^\[\^?\d{1,3}\]:/gm) || []).length, 0)).toBeGreaterThanOrEqual(3);
    // the pictures are entries waiting for their data, never inlined
    expect(samplePicsMissing(c, exportBook(y))).toBe(c.api.SAMPLE_IMAGE_FILES.length + 1);
    expect((meta as Rec).sampleSections).toBeUndefined();
  });
});

describe('wave 1c: the sample from its own chunk', () => {
  it('built afresh against the main closure\'s current state (1.0\'s normalizeCoverRecipe reads state.theme), equal build after build; the button states SAMPLE_WORDS, the real count', async () => {
    const a = JSON.stringify(buildSample(c, null));
    const b = JSON.stringify(buildSample(c, null));
    expect(a).toBe(b);
    expect(sampleShippedWords(c)).toBe(c.api.SAMPLE_WORDS);
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnSampleStory')).not.toBeNull(), { timeout: 10_000 });
    expect(document.getElementById('btnSampleStory')!.textContent).toContain(t('side.sampleLoad', { n: c.api.fmtNum(c.api.SAMPLE_WORDS), count: c.api.SAMPLE_WORDS }));
  });
});

describe('the books the replace path opens (review focus #4)', () => {
  it('Load over the writer\'s book: "Before the sample story" snapshot of it, the draft snapshot first, the desk\'s History kept (history.autosafety, the sample half)', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const y = open(f.book);
    const mine = exportBook(y);
    const doc = sampleArrival(c, y, false);
    const arrived = open(doc);
    const h = live(c, arrived).state.history;
    expect(h[0]!.id).toBe(c.api.SAMPLE_DRAFT_SNAP_ID);
    expect(h[0]!.name).toBe('Chapter One, an earlier draft');
    expect(h[1]!.auto).toBe('sample');
    expect(snapshotLabel(h[1]!, t as never)).toBe(E['history.auto.sample']);
    expect(JSON.stringify(h[1]!.doc.sections)).toBe(JSON.stringify(mine.sections));
    expect((exportBook(arrived).meta as Rec).title).toBe('The Lantern Coast');
    // an untouched sample or an empty desk takes no snapshot
    const again = live(c, open(sampleArrival(c, arrived, true))).state.history;
    expect(again.filter((s) => s.auto === 'sample').length).toBe(1);
    expect(again.filter((s) => s.id === c.api.SAMPLE_DRAFT_SNAP_ID).length).toBe(1);
    expect(live(c, open(sampleArrival(c, null, false))).state.history.map((s) => s.id)).toEqual([c.api.SAMPLE_DRAFT_SNAP_ID]);
  });

  it('Remove: the empty book, 0 words, nothing of the sample in its History (sample.remove.leaves-nothing, the book half)', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const sample = open(sampleArrival(c, open(f.book), false));
    const empty = open(emptyAfterSample(c, sample));
    const out = exportBook(empty);
    const m = out.meta as Rec;
    expect([m.title, m.author]).toEqual(['', '']);
    expect((out.sections as Rec[]).every((s) => !String(s.content || '').trim())).toBe(true);
    expect(statsOf(c, empty).words).toBe(0);
    const h = live(c, empty).state.history;
    expect(h.some((s) => s.id === c.api.SAMPLE_DRAFT_SNAP_ID)).toBe(false);
    expect(h.some((s) => c.api.isSampleBookId((s.doc.meta as Rec | undefined)?.bookId))).toBe(false);
    expect(h.some((s) => s.auto === 'sample')).toBe(true); // the writer's own book, snapshotted before the sample, stays
    const text = JSON.stringify(out);
    for (const word of ['Lantern Coast', 'Carooke', 'sample-img-', c.api.SAMPLE_BOOK_ID]) expect(text.includes(word), word).toBe(false);
  });

  it('New book: a NAMED "Before starting a new book" snapshot, then the empty book with the History kept', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    const y = open(f.book);
    const { doc, snap } = newBookArrival(c, y, t('newbook.snap'));
    const b = open(doc);
    const h = live(c, b).state.history;
    expect(h[0]!.id).toBe(snap.id);
    expect(h[0]!.name).toBe(E['newbook.snap']);
    expect(h[0]!.auto).toBeNull();
    expect(statsOf(c, b).words).toBe(0);
    expect(((exportBook(b).meta as Rec).bookId)).not.toBe((exportBook(y).meta as Rec).bookId);
  });
});

describe('the sample\'s pictures (BEUK:slim)', () => {
  it('fetched from /assets/sample/, checked against 1.0\'s length and SHA-256, filled in the book and its History in one transaction, History repacked', async () => {
    const y = open(sampleArrival(c, null, false));
    expect(await ensureSamplePictures(c, diskFetch)).toBe(true);
    let n = 0;
    y.on('update', () => n++);
    const r = fillSamplePictures(c, y);
    expect(r.missing).toBe(0);
    expect(r.filled).toBe(c.api.SAMPLE_IMAGE_FILES.length + 1);
    expect(n).toBe(1);
    const out = exportBook(y);
    expect(samplePicsMissing(c, out)).toBe(0);
    const portrait = (out.images as Rec[]).find((im) => im.id === 'sample-img-portrait')!;
    const disk = readFileSync(path.join(ASSETS, 'sample-img-portrait.jpg')).toString('base64');
    expect(portrait.data).toBe(disk);
    // the draft snapshot's pictures are named against the book now, never copied
    const stored = (out.history as Rec[])[0]!;
    expect(JSON.stringify(stored).includes(disk)).toBe(false);
    expect(samplePicsMissing(c, live(c, y).state.history[0]!.doc as Rec)).toBe(0);
    // nothing waits: nothing is written
    let m = 0;
    y.on('update', () => m++);
    fillSamplePictures(c, y);
    expect(m).toBe(0);
  });

  it('a file that does not match its manifest is refused', async () => {
    const bad = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch;
    expect(await ensureSamplePictures(c, bad)).toBe(false);
  });
});

describe('fix round 1: the sample record lives with the book, and fails safe', () => {
  it('the record is in the book’s Y.Doc, never exported; a new import starts without it; a missing fingerprint reads as edited', () => {
    const y = open(sampleArrival(c, null, false));
    expect(sampleLoaded(y)).toBe(false);
    setSampleRecord(y, sampleSigOf(c, y));
    expect(sampleLoaded(y)).toBe(true);
    expect(deskIsUntouchedSample(c, y)).toBe(true);
    expect(JSON.stringify(exportBook(y)).includes(SAMPLE_MAP)).toBe(false);
    expect(Object.keys(exportBook(y))).not.toContain('sample');
    expect(sampleLoaded(open(exportBook(y)))).toBe(false); // a backup of it arrives as the writer's own book
    setSampleRecord(y, null);
    expect(sampleLoaded(y)).toBe(true);
    expect(deskIsUntouchedSample(c, y)).toBe(false); // unknown fingerprint: edited, Remove asks
    y.getMap(SAMPLE_MAP).set('sample', 'garbage');
    expect(deskIsUntouchedSample(c, y)).toBe(false);
  });

  it('the snapshot taken before the sample survives Remove sample in every case, also when the replaced book carried the sample’s id', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    // (1) the writer's own book
    const own = open(f.book);
    const ownSecs = JSON.stringify(exportBook(own).sections);
    // (2) an edited sample whose record was lost: it reads as the writer's book (bookId = the sample's)
    const lost = open(sampleArrival(c, null, false));
    lost.transact(() => {
      const m = { ...(exportBook(lost).meta as Rec), publisher: 'Edited after the record was lost' };
      lost.getMap('meta').set('meta', m);
    });
    expect(sampleLoaded(lost)).toBe(false);
    const lostSecs = JSON.stringify(exportBook(lost).sections);
    for (const [desk, secs] of [[own, ownSecs], [lost, lostSecs]] as const) {
      const sample = open(sampleArrival(c, desk, deskIsUntouchedSample(c, desk)));
      setSampleRecord(sample, sampleSigOf(c, sample));
      expect(deskIsUntouchedSample(c, sample)).toBe(true); // Remove would not ask
      const empty = open(emptyAfterSample(c, sample));
      const kept = live(c, empty).state.history.filter((h) => h.auto === 'sample');
      expect(kept.length).toBe(1);
      expect(JSON.stringify(kept[0]!.doc.sections)).toBe(secs);
    }
    // the edited copy is recoverable whole from that snapshot
    const sample = open(sampleArrival(c, lost, false));
    const empty = open(emptyAfterSample(c, sample));
    const snap = live(c, empty).state.history.find((h) => h.auto === 'sample')!;
    expect((snap.doc.meta as Rec).publisher).toBe('Edited after the record was lost');
  });
});

/* ---- in the studio ---- */

const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
async function studio() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(diskFetch as never);
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnSampleStory')).not.toBeNull(), { timeout: 10_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const a = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob;
    return 'blob:test';
  });
  const b = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const cl = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fireEvent.click(document.getElementById('btnLocalBackup')!);
  const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
  a.mockRestore();
  b.mockRestore();
  cl.mockRestore();
  return out.book;
}
const strip = (x: Rec) => {
  const o = { ...x };
  delete o.history;
  delete o.historyPool;
  delete o.importReport;
  delete o.formatVersion; // 1.0's label: a snapshot carries it as 1.0's do (V, 2026-11-04), so a restored book carries it as 1.0's restore writes it
  return o;
};
/** The open book's Y.Doc, reached through the open chapter editor's collaboration binding. */
const openYdoc = (): Y.Doc => {
  const ed = (document.getElementById('manuscript') as unknown as { beukEditor: { extensionManager: { extensions: { name: string; options: { fragment?: Y.XmlFragment } }[] } } }).beukEditor;
  return ed.extensionManager.extensions.find((e) => e.name === 'collaboration')!.options.fragment!.doc!;
};
const btn = () => document.getElementById('btnSampleStory')!;
const title = () => document.getElementById('projectTitleDisplay')!.textContent;
const words = () => document.getElementById('statWords')!.textContent;

describe('the sample bar in the studio', () => {
  it('sample.toggle.empty-to-sample-to-empty, idempotent load, Remove leaves nothing (device half)', async () => {
    await studio();
    // the empty desk: Load says the bundled count, and lands without asking
    expect(btn().textContent).toBe(E['side.sampleLoad']!.replace('{n}', c.api.SAMPLE_WORDS.toLocaleString('en')));
    expect(document.getElementById('btnNewBook')).toBeNull();
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(title()).toBe('The Lantern Coast'), { timeout: 20_000 });
    expect(document.getElementById('modalConfirm')).toBeNull();
    await waitFor(() => expect(words()).toBe(c.api.SAMPLE_WORDS.toLocaleString('en')), { timeout: 10_000 });
    expect(btn().textContent).toBe(E['side.sampleRemove']);
    expect(document.getElementById('sampleNote')!.textContent).toBe(E['side.sampleNoteLoaded']!.replace('{n}', c.api.SAMPLE_WORDS.toLocaleString('en')));
    expect(document.getElementById('toasts')!.textContent).toContain('Sample story loaded');
    expect(document.getElementById('btnNewBook')).toBeNull(); // the sample keeps its own Remove
    expect(sampleRecord(openYdoc())?.sig).toBeTruthy(); // the record lives in the book's own Y.Doc
    expect(Object.keys(localStorage).some((k) => k.includes('sample'))).toBe(false);
    // the pictures arrive and fill in; the sample stays untouched
    await waitFor(async () => expect(samplePicsMissing(c, await exported())).toBe(0), { timeout: 20_000 });
    const loaded = await exported();
    expect(readRegistry().books.some((b) => b.id === c.api.SAMPLE_BOOK_ID)).toBe(true);
    // Remove an untouched sample: no confirm, the genuine empty state, nothing of the sample left on the device
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(btn().textContent).toContain('Load the sample story'), { timeout: 20_000 });
    expect(document.getElementById('modalConfirm')).toBeNull();
    expect(document.getElementById('toasts')!.textContent).toContain(E['toast.sampleRemoved']);
    await waitFor(() => expect(words()).toBe('0'));
    const empty = await exported();
    expect(((empty.meta as Rec).title)).toBe('');
    expect(JSON.stringify(empty).includes('Lantern Coast')).toBe(false);
    await waitFor(async () => {
      const names = (await indexedDB.databases()).map((d) => d.name ?? '');
      expect(names.some((n) => n.includes(c.api.SAMPLE_BOOK_ID))).toBe(false);
    });
    expect(readRegistry().books.some((b) => b.id === c.api.SAMPLE_BOOK_ID)).toBe(false);
    expect(sampleRecord(openYdoc())).toBeNull();
    // the empty desk reports nothing (sample.empty-desk.no-figures, the sidebar half)
    for (const id of ['progFrontPct', 'progBodyPct', 'progBackPct']) expect(document.getElementById(id)!.textContent).toBe('0%');
    // Load again lands the same count
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(title()).toBe('The Lantern Coast'), { timeout: 20_000 });
    await waitFor(() => expect(words()).toBe(c.api.SAMPLE_WORDS.toLocaleString('en')), { timeout: 10_000 });
    expect(JSON.stringify(strip(await exported()).sections)).toBe(JSON.stringify(strip(loaded).sections));
  }, 120_000);

  it('fix round 1: a sample whose fingerprint is unknown reads as edited — Remove asks first', async () => {
    await studio();
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(title()).toBe('The Lantern Coast'), { timeout: 20_000 });
    await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
    await act(async () => {
      setSampleRecord(openYdoc(), null);
    });
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull());
    expect(document.getElementById('confirmTitle')!.textContent).toBe(E['sample.confirmRemoveTitle']);
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmNo')!);
    });
    expect(title()).toBe('The Lantern Coast');
  }, 120_000);

  it('Load over the writer\'s book asks first (1.0\'s keys); Yes replaces; History gives the book back exactly (history.restore.snapshot-always, the sample half); an edited sample asks before Remove', async () => {
    await studio();
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await act(async () => {
      fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(f.book)] } });
    });
    await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
    await waitFor(() => expect(document.getElementById('btnNewBook')).not.toBeNull(), { timeout: 10_000 });
    const mine = strip(await exported());
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull());
    expect(document.getElementById('confirmTitle')!.textContent).toBe(E['sample.confirmLoadTitle']);
    expect(document.getElementById('confirmBody')!.textContent).toBe(E['sample.confirmLoadBody']!.replace('{title}', String((mine.meta as Rec).title)));
    expect(document.getElementById('btnConfirmYes')!.textContent).toBe(E['sample.confirmLoadYes']);
    expect(document.getElementById('btnConfirmNo')!.textContent).toBe(E['confirm.keep']);
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmNo')!);
    });
    expect(JSON.stringify(strip(await exported()))).toBe(JSON.stringify(mine));
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull());
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmYes')!);
    });
    await waitFor(() => expect(title()).toBe('The Lantern Coast'), { timeout: 20_000 });
    // History → the "Before the sample story" snapshot → Restore the whole book: the writer's book, exactly
    fireEvent.click(document.getElementById('btnHistory')!);
    await waitFor(() => expect(document.getElementById('historyList')).not.toBeNull(), { timeout: 10_000 });
    await waitFor(() => expect(document.querySelector('#historyList [data-hopen]')).not.toBeNull(), { timeout: 10_000 });
    const item = Array.from(document.querySelectorAll<HTMLElement>('#historyList [data-hopen]')).find((el) => el.closest('.hist-row')!.textContent!.includes(E['history.auto.sample']!))!;
    expect(item).toBeTruthy();
    await act(async () => {
      fireEvent.click(item);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('#historyDetail [data-hrestore]')!);
    });
    await waitFor(() => expect(document.getElementById('btnConfirmYes')).not.toBeNull());
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmYes')!);
    });
    await waitFor(() => expect(title()).toBe(String((mine.meta as Rec).title)), { timeout: 20_000 });
    expect(JSON.stringify(strip(await exported()))).toBe(JSON.stringify(mine));
  }, 120_000);

  it('Remove an edited sample asks first (sample.confirmRemove*); New book asks (newbook.*), keeps the book in History by name', async () => {
    await studio();
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(title()).toBe('The Lantern Coast'), { timeout: 20_000 });
    // edit the sample: Settings' publisher (a meta write the fingerprint sees)
    fireEvent.click(document.getElementById('btnSettings2')!);
    await waitFor(() => expect(document.getElementById('modalSettings')).not.toBeNull());
    const pub = document.getElementById('setPublisher') as HTMLInputElement | null;
    expect(pub).not.toBeNull();
    fireEvent.change(pub!, { target: { value: 'My Own Press' } });
    await act(async () => {
      fireEvent.click(document.getElementById('btnSaveSettings')!);
    });
    await act(async () => {
      fireEvent.click(btn());
    });
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull());
    expect(document.getElementById('confirmTitle')!.textContent).toBe(E['sample.confirmRemoveTitle']);
    expect(document.getElementById('btnConfirmNo')!.textContent).toBe(E['sample.keepReading']);
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmNo')!);
    });
    expect(title()).toBe('The Lantern Coast');

    // a book of one's own: New book
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await act(async () => {
      const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
      ev.dataTransfer = { files: [backupFile(f.book)], types: ['Files'] };
      document.querySelector('.desk')!.dispatchEvent(ev);
    });
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull(), { timeout: 10_000 }); // an edited sample is the writer's: 1.0 asks
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmYes')!);
    });
    await waitFor(() => expect(document.getElementById('btnNewBook')).not.toBeNull(), { timeout: 20_000 });
    expect(btn().textContent).toContain('Load the sample story'); // a backup over the sample: the sample flag goes (1.0)
    await act(async () => {
      fireEvent.click(document.getElementById('btnNewBook')!);
    });
    await waitFor(() => expect(document.getElementById('modalConfirm')).not.toBeNull());
    expect(document.getElementById('confirmTitle')!.textContent).toBe(E['newbook.confirmTitle']);
    expect(document.getElementById('confirmBody')!.textContent).toBe(E['newbook.confirmBody']);
    expect(document.getElementById('btnConfirmYes')!.textContent).toBe(E['newbook.yes']);
    expect(document.getElementById('btnConfirmNo')!.textContent).toBe(E['newbook.no']);
    await act(async () => {
      fireEvent.click(document.getElementById('btnConfirmYes')!);
    });
    await waitFor(() => expect(document.getElementById('toasts')!.textContent).toContain(E['newbook.done']), { timeout: 20_000 });
    await waitFor(() => expect(words()).toBe('0'));
    const out = await exported();
    expect((out.history as Rec[])[0]!.name).toBe(E['newbook.snap']);
    expect(document.getElementById('btnNewBook')).toBeNull(); // an empty desk has nothing to clear
  }, 120_000);
});
