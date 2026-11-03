import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { statsOf } from '../src/book/stats';
import { importToDevice } from '../src/book/store';
import { loadClosure, loadSample, setClosureLang, setClosureT, type Closure, type Note } from '../src/closure/index';
import { live, restoreDoc, saveNamed } from '../src/history/history';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { addRead, nbState, placeKey, writeNotebook, writeNotes } from '../src/notebook/notebook';
import { buildSample } from '../src/sample/sample';
import { fixtures } from './fixtures';

/* Wave 1c, task 3: the Notebook and its research files (inventory C7).
   1.0 self-checks re-expressed: notebook.notes, notebook.research (the
   export halves — EPUB, print, Word — are wave 5's outputs: a note never
   reaches the book's text here because it is not a section, and the word
   counts are checked), notebook.research.csp in e2e/book.mjs (the served
   policy). Review focus #4: notes, pins and files survive reload and
   export→import; using the notebook without editing leaves the export
   exactly equal. Constraint 10: the files live where 1.0 keeps them, in
   the book's `research` key (base64), named once; History names them. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  await loadSample(); // the sample chunk (wave 1c task 4): buildSample needs it
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
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
const b64 = (txt: string) => btoa(String.fromCharCode(...new TextEncoder().encode(txt)));
const LUNA = () => fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
/** Luna's Beach with a two-entry Covenant (Mara, Gullwick), as 1.0's notebook.notes check builds its book. */
const withCovenant = (): Rec => ({ ...structuredClone(LUNA().book), bible: { entries: [{ id: 'nbk-m', type: 'character', name: 'Mara' }, { id: 'nbk-g', type: 'place', name: 'Gullwick' }] } });

describe('the data, 1.0\'s rules', () => {
  it('a book without notes writes no notebook key; the first note puts the key where 1.0\'s serializeBook writes it', () => {
    const y = open(LUNA().book);
    expect('notebook' in exportBook(y)).toBe(false);
    const s = nbState(c, y);
    writeNotes(c, y, s, [{ id: 'n1', title: 'A', body: 'b' }]);
    const keys = Object.keys(exportBook(y));
    // right after the key 1.0 writes closest before it (this book: importReport, no bible), before audio
    expect(keys.indexOf('notebook')).toBe(keys.indexOf('importReport') + 1);
    expect(keys.indexOf('notebook')).toBeLessThan(keys.indexOf('audio'));
    writeNotes(c, y, nbState(c, y), []);
    expect('notebook' in exportBook(y)).toBe(false);
  });

  it('a pin to a missing section, a file name for a missing file and a junk file are dropped on read (1.0\'s nbNormalize / rsNormalize), and nothing is written by reading', () => {
    const book = structuredClone(LUNA().book) as Rec;
    const secId = (book.sections as Rec[])[2]!.id as string;
    book.research = { files: [{ id: 'f1', name: 'a.txt', mediaType: 'text/plain', data: b64('hello'), bytes: 5 }, { id: 'f2', name: 'x.html', mediaType: 'text/html', data: b64('<b>x</b>'), bytes: 8 }, { id: 'f3', name: 'x.txt', mediaType: 'text/plain', data: '!!!!' }] };
    book.notebook = { notes: [{ id: 'n1', title: 'T', body: 'B', secs: ['no-such', secId], files: ['f1', 'f2', 'f3', 'nope'] }] };
    const y = open(book);
    const before = JSON.stringify(exportBook(y));
    const s = nbState(c, y);
    expect(s.notebook.notes[0]!.secs).toEqual([secId]);
    expect(s.notebook.notes[0]!.files).toEqual(['f1']);
    expect(s.research.files.map((f) => f.id)).toEqual(['f1']);
    expect(JSON.stringify(exportBook(y))).toBe(before);
  });

  it('notebook.research: 5 kinds kept (m4a as audio/mp4), a web page, an oversized and an empty file refused; an untitled note takes its first file\'s name; each file written once, as base64 in the book', () => {
    const y = open(LUNA().book);
    const pdf = b64('%PDF-1.4\n%%EOF\n');
    const txt = b64('Rsmark soundings: ' + 'six fathoms, called every mark true. '.repeat(40));
    const items = [
      { name: 'Rsmark soundings.txt', type: 'text/plain', data: txt },
      { name: 'chart.png', type: 'image/png', data: b64('png-bytes') },
      { name: 'ledger.pdf', type: 'application/pdf', data: pdf },
      { name: 'gulls.m4a', type: 'audio/x-m4a', data: b64('rs-audio-bytes') },
      { name: 'tide.webm', type: 'video/webm', data: b64('rs-video-bytes') },
      { name: 'page.html', type: 'text/html', data: b64('<!doctype html><p>a web page</p>') },
      { name: 'huge.pdf', type: 'application/pdf', data: b64('x'), size: c.api.rsLimits().file + 1 },
      { name: 'empty.txt', type: 'text/plain', data: '', size: 0 },
    ].map((it) => ({ size: it.data ? atob(it.data).length : 0, ...it }));
    const s = nbState(c, y);
    const r = addRead(c, s, null, items, t);
    expect(r.added.length).toBe(5);
    expect(r.refused.length).toBe(3);
    expect(r.note!.title).toBe('Rsmark soundings');
    expect(r.files.find((f) => f.name === 'gulls.m4a')!.mediaType).toBe('audio/mp4');
    writeNotebook(c, y, r.notes, r.files);
    const doc = exportBook(y) as Rec & { research: { files: Rec[] } };
    expect(doc.research.files.length).toBe(5);
    expect(JSON.stringify(doc).split(txt).length - 1).toBe(1);
    // and it round-trips byte for byte
    expect(JSON.stringify(exportBook(open(doc)))).toBe(JSON.stringify(doc));
  });

  it('History names the files (histPack); a file dropped afterwards is written once, in historyPool, and a restore brings it back', () => {
    const y = open(LUNA().book);
    const txt = b64('Rsmark soundings: six fathoms.');
    const r = addRead(c, nbState(c, y), null, [{ name: 'soundings.txt', type: 'text/plain', size: atob(txt).length, data: txt }, { name: 'chart.png', type: 'image/png', size: 9, data: b64('png-bytes') }], t);
    writeNotebook(c, y, r.notes, r.files);
    const snap = saveNamed(c, y, 'Rscheck');
    const ser1 = exportBook(y) as Rec & { history: Rec[]; historyPool: Rec };
    const packed = (ser1.history[0]!.chopDoc as Rec).research as { files: Rec[] };
    expect(packed.files.length).toBe(2);
    expect(packed.files.every((o) => typeof o.ref === 'string' && !('data' in o) && !('pool' in o))).toBe(true);
    expect(JSON.stringify(ser1).split(txt).length - 1).toBe(1);
    // the text file taken off its note: no longer written in research, written once in historyPool
    const s2 = nbState(c, y);
    const fid = s2.research.files.find((f) => f.name === 'soundings.txt')!.id;
    writeNotebook(c, y, s2.notebook.notes.map((n) => ({ ...n, files: (n.files || []).filter((x) => x !== fid) })), s2.research.files);
    const ser2 = exportBook(y) as Rec & { research: { files: Rec[] }; historyPool: { research: Rec[] } };
    expect(ser2.research.files.length).toBe(1);
    expect(ser2.historyPool.research.length).toBe(1);
    expect(ser2.historyPool.research[0]!.data).toBe(txt);
    expect(JSON.stringify(ser2).split(txt).length - 1).toBe(1);
    const back = restoreDoc(c, y, snap.id)!;
    const files = (back.research as { files: Rec[] }).files;
    expect(files.find((f) => f.id === fid)!.data).toBe(txt);
    expect(((back.notebook as { notes: Note[] }).notes[0]!.files || []).includes(fid)).toBe(true);
  });

  it('a book with History made before its notebook keeps packing the same way (live() reads it back)', () => {
    const y = open(LUNA().book);
    saveNamed(c, y, 'first');
    writeNotes(c, y, nbState(c, y), [{ id: 'n1', title: 'x', body: '' }]);
    expect(live(c, y).state.history.length).toBe(1);
  });

  it('the sample\'s notes and research files come through as 1.0 builds them (pins, link, files)', () => {
    const y = open(buildSample(c, null));
    const s = nbState(c, y);
    const title = (id: string) => (s.sections.find((x) => x.id === id) || ({} as Rec)).title;
    const pins = s.notebook.notes.map((x) => x.id + ':' + (x.secs || []).map(title).join('+')).join(' | ');
    expect(pins).toBe('sample-nb-depths:The Tide Table for Next Year+Soundings at Low Water+What the Chart Cost | sample-nb-notices:What the Chart Cost | sample-nb-keepers:The Harbourmaster\'s Ledger');
    const dn = s.notebook.notes.find((n) => n.id === 'sample-nb-depths')!;
    expect((dn.files || []).map((id) => s.research.files.find((f) => f.id === id)!.name).join(' | ')).toBe('Soundings, as the chapters give them.txt | East Bank sketch.svg');
    expect(s.notebook.notes.find((n) => n.id === 'sample-nb-notices')!.url).toBe('https://en.wikipedia.org/wiki/Notice_to_mariners');
  });

  it('placeKey puts a new key after the nearest key 1.0 writes before it', () => {
    const y = open(LUNA().book);
    y.transact(() => placeKey(y, 'research'));
    const keys = y.getMap<unknown>('layout').get('keys') as string[];
    const at = keys.indexOf('research');
    expect(at).toBeGreaterThan(keys.indexOf('importReport'));
  });
});

/* ---- the room ---- */

async function studioWith(book: Rec) {
  await importToDevice(book);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnNotebook')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  return r;
}
async function openNotebook() {
  fireEvent.click(document.getElementById('btnNotebook')!);
  await waitFor(() => expect(document.getElementById('nbList')).not.toBeNull(), { timeout: 20_000 });
}
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
  ];
  fireEvent.click(document.getElementById('btnLocalBackup')!);
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec }).book;
}
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const typeIn = (id: string, v: string, ev: 'input' | 'change' = 'input') =>
  act(() => {
    const el = $(id);
    el.value = v;
    el.dispatchEvent(new Event(ev, { bubbles: true }));
  });

describe('the Notebook in the studio', { timeout: 30_000 }, () => {
  it('notebook.notes: a note from the Notes tool takes its title, folder and text, finds the Covenant\'s names, pins to a chapter and comes first there; search narrows; it rides the book file byte for byte; delete comes with Undo; word counts never move', async () => {
    const book = withCovenant();
    await studioWith(book);
    const words0 = c.api.fmtNum(statsOf(c, open(book)).words);
    await waitFor(() => expect(document.getElementById('statWords')?.textContent).toBe(words0));
    await openNotebook();
    act(() => $('btnNbNew').click());
    await waitFor(() => expect(document.activeElement?.id).toBe('nbTitle'), { timeout: 5000 });
    typeIn('nbTitle', 'Nbmarktitle tides');
    typeIn('nbBody', 'Nbmarkbody: Mara sounds the gut at Gullwick. Mara again.');
    typeIn('nbFolder', 'Research', 'change');
    let doc = await exported();
    const notes = (doc.notebook as { notes: Note[] }).notes;
    expect(notes.length).toBe(1);
    expect([notes[0]!.title, notes[0]!.folder]).toEqual(['Nbmarktitle tides', 'Research']);
    expect(notes[0]!.body).toContain('Mara sounds');
    await waitFor(() => expect(document.querySelector('#nbNames [data-nbcov="nbk-m"]')).not.toBeNull(), { timeout: 3000 });
    expect([...document.querySelectorAll('#nbNames [data-nbcov]')].map((b) => b.textContent)).toEqual([t('nb.nameN', { name: 'Mara', n: '2' }), t('nb.nameN', { name: 'Gullwick', n: '1' })]);
    // pin to a chapter (the second body chapter)
    const secs = book.sections as Rec[];
    const ch2 = secs.filter((s) => s.kind === 'body')[1]!;
    const sel = document.getElementById('nbPin') as HTMLSelectElement;
    act(() => {
      sel.value = ch2.id as string;
    });
    act(() => $('nbPinDo').click());
    doc = await exported();
    const n1 = (doc.notebook as { notes: Note[] }).notes[0]!;
    expect(n1.secs).toEqual([ch2.id]);
    // a second, loose note
    act(() => $('btnNbNew').click());
    typeIn('nbTitle', 'Loose idea');
    // search
    act(() => fireEvent.change($('nbSearch'), { target: { value: 'loose' } }));
    expect([...document.querySelectorAll('#nbList [data-nb]')].length).toBe(1);
    act(() => fireEvent.change($('nbSearch'), { target: { value: '' } }));
    // with chapter 2 on the desk, its pinned note comes first
    fireEvent.click(document.getElementById('btnCloseNotebook')!);
    const row = document.querySelector(`#structureList .sec-item[data-index="${secs.indexOf(ch2)}"]`) as HTMLElement;
    act(() => row.click());
    await openNotebook();
    const first = document.querySelector('#nbList .nb-group')!;
    expect(first.getAttribute('data-nbgroup')).toBe('here');
    expect(first.querySelector(`[data-nb="${n1.id}"]`)).not.toBeNull();
    // the book file: byte for byte through export → import
    doc = await exported();
    const y2 = open(doc);
    expect(JSON.stringify(exportBook(y2))).toBe(JSON.stringify(doc));
    // delete, then Undo
    act(() => (document.querySelector(`[data-nb="${n1.id}"]`) as HTMLElement).click());
    act(() => $('nbDelete').click());
    expect(((await exported()).notebook as { notes: Note[] }).notes.some((n) => n.id === n1.id)).toBe(false);
    const undo = [...document.querySelectorAll('#toasts .toast button')].pop() as HTMLElement;
    act(() => undo.click());
    expect(((await exported()).notebook as { notes: Note[] }).notes.some((n) => n.id === n1.id)).toBe(true);
    fireEvent.click(document.getElementById('btnCloseNotebook')!);
    await waitFor(() => expect(document.getElementById('statWords')?.textContent).toBe(words0));
  });

  it('the source link keeps http(s) only: one typed without a scheme becomes https; javascript: is refused and not kept', async () => {
    await studioWith(LUNA().book);
    await openNotebook();
    act(() => $('btnNbNew').click());
    await waitFor(() => expect(document.querySelector('#nbDetail [data-note] #nbUrl')).not.toBeNull(), { timeout: 5000 });
    typeIn('nbUrl', 'example.org/tides', 'change');
    await waitFor(() => expect(document.getElementById('nbUrlGo')).not.toBeNull(), { timeout: 5000 });
    const go = document.getElementById('nbUrlGo') as HTMLAnchorElement;
    expect(go.getAttribute('href')).toBe('https://example.org/tides');
    expect(go.getAttribute('rel')).toContain('noopener');
    typeIn('nbUrl', 'javascript:alert(1)', 'change');
    expect($('nbUrl').getAttribute('aria-invalid')).toBe('true');
    expect(((await exported()).notebook as { notes: Note[] }).notes[0]!.url).toBe('https://example.org/tides');
  });

  it('research files open inside the Notebook — text as text, a picture as <img data:>, a PDF in a frame, players for sound and clips — from one object URL at a time, revoked on switching and closing; an SVG never as a document', async () => {
    const urls: string[] = [], revoked: string[] = [];
    let k = 0;
    await studioWith(LUNA().book);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = 'blob:rs-' + ++k;
      urls.push(u);
      return u;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    await openNotebook();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><scr' + 'ipt>window.__rsEvil=1</scr' + 'ipt></svg>';
    const list = [
      new File(['Rsmark soundings: six fathoms'], 'soundings.txt', { type: 'text/plain' }),
      new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' }),
      new File(['%PDF-1.4\n%%EOF\n'], 'ledger.pdf', { type: 'application/pdf' }),
      new File(['rs-audio'], 'gulls.m4a', { type: 'audio/x-m4a' }),
      new File(['rs-video'], 'tide.webm', { type: 'video/webm' }),
      new File([svg], 'evil.svg', { type: 'image/svg+xml' }),
    ];
    await act(async () => {
      fireEvent.change(document.getElementById('rsFileInput')!, { target: { files: list } });
    });
    await waitFor(() => expect(document.querySelectorAll('#rsRow [data-rsfile]').length).toBe(6), { timeout: 5000 });
    const view = (name: string) => {
      const b = [...document.querySelectorAll('[data-rsview]')].find((x) => x.textContent === name) as HTMLElement;
      if (b.getAttribute('aria-expanded') !== 'true') act(() => b.click());
      return document.getElementById('rsView')!;
    };
    let v = view('tide.webm');
    expect(v.querySelector('video.rs-video')!.getAttribute('src')).toMatch(/^blob:rs-/);
    const clip = v.querySelector('video')!.getAttribute('src')!;
    v = view('soundings.txt');
    expect(v.querySelector('pre.rs-text')!.textContent).toBe('Rsmark soundings: six fathoms');
    expect(revoked).toContain(clip);
    v = view('chart.png');
    expect(v.querySelector('img.rs-img')!.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    v = view('ledger.pdf');
    expect(v.querySelector('iframe.rs-pdf')!.getAttribute('src')).toMatch(/^blob:rs-/);
    expect(v.querySelector('[data-rstab]')).not.toBeNull();
    v = view('gulls.m4a');
    expect(v.querySelector('audio.rs-audio')!.getAttribute('src')).toMatch(/^blob:rs-/);
    v = view('evil.svg');
    expect(v.querySelector('img.rs-img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(v.querySelector('[data-rstab], iframe, object, embed')).toBeNull();
    expect((window as unknown as { __rsEvil?: number }).__rsEvil).toBeUndefined();
    // found by a file's name
    act(() => fireEvent.change($('nbSearch'), { target: { value: 'ledger.pdf' } }));
    expect(document.querySelectorAll('#nbList [data-nb]').length).toBe(1);
    act(() => fireEvent.change($('nbSearch'), { target: { value: '' } }));
    // closing the Notebook lets go of every object URL it made
    fireEvent.click(document.getElementById('btnCloseNotebook')!);
    expect(urls.every((u) => revoked.includes(u))).toBe(true);
    const doc = await exported();
    expect((doc.research as { files: Rec[] }).files.length).toBe(6);
    expect((doc.research as { files: Rec[] }).files.find((f) => f.name === 'gulls.m4a')!.mediaType).toBe('audio/mp4');
  });

  it('a file removed comes back with Undo', async () => {
    await studioWith(LUNA().book);
    await openNotebook();
    await act(async () => {
      fireEvent.change(document.getElementById('rsFileInput')!, { target: { files: [new File(['abc'], 'a.txt', { type: 'text/plain' })] } });
    });
    await waitFor(() => expect(document.querySelector('[data-rsdel]')).not.toBeNull());
    act(() => (document.querySelector('[data-rsdel]') as HTMLElement).click());
    let doc = await exported();
    expect('research' in doc).toBe(false);
    const undo = [...document.querySelectorAll('#toasts .toast button')].pop() as HTMLElement;
    act(() => undo.click());
    doc = await exported();
    expect((doc.research as { files: Rec[] }).files.map((f) => f.name)).toEqual(['a.txt']);
  });

  it('review focus #4: browsing the notebook (choosing notes, opening files, searching) without editing leaves the export exactly equal; notes and files survive a reload', async () => {
    const y = open(buildSample(c, null));
    const sample = exportBook(y);
    const ob = await importToDevice(sample);
    const before = JSON.stringify(ob.export());
    await ob.close();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const r = render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnNotebook')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    await openNotebook();
    for (const b of [...document.querySelectorAll<HTMLElement>('#nbList [data-nb]')]) act(() => b.click());
    for (const b of [...document.querySelectorAll<HTMLElement>('[data-rsview]')]) act(() => b.click());
    act(() => fireEvent.change($('nbSearch'), { target: { value: 'sound' } }));
    fireEvent.click(document.getElementById('btnCloseNotebook')!);
    vi.restoreAllMocks();
    expect(JSON.stringify(await exported())).toBe(before);
    r.unmount();
    // a reload: the same notes and files
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnNotebook')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
    await openNotebook();
    expect(document.querySelectorAll('#nbList [data-nb]').length).toBe(3);
    expect(JSON.stringify(await exported())).toBe(before);
  });
});
