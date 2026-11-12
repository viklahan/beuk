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
import { loadClosure, setClosureLang, setClosureT, type Closure, type ResearchFile, type RsDocReply } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { addRead, docView, nbState } from '../src/notebook/notebook';
import { fixtures } from './fixtures';
import { backupClicked } from './backup-wait';
import { docxBytes, mhtmlText, rsWorkers, vmWorkerClass } from './rsdoc-worker';

/* BEUK:webword in the 2.0 Notebook: a Word document (.docx) and a saved web page (.html, .htm, .mhtml, .mht) kept
   as research under 1.0's types, opened in 1.0's worker (client/assets/rsdoc.js, run as it is with its own vendored
   JSZip and mammoth: test/rsdoc-worker.ts) before they are kept, and read in 1.0's reader view — its sanitizer, its
   note and fidelity lines, its errors, its time limit. 1.0's self-check notebook.research.webword, re-expressed. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
const RS_WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const RS_WEB = 'application/vnd.beuk.webpage';
const g = globalThis as unknown as { Worker?: unknown; __rsPwned?: number };
const realWorker = g.Worker;

beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  // a fresh worker and an empty view cache for each test (1.0's rsDocStop: the next job starts a fresh worker)
  c.api.rsDocStop('test');
  c.api.rsDocW.cache.clear();
  rsWorkers.length = 0;
  g.Worker = vmWorkerClass();
  delete g.__rsPwned;
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  c.api.rsDocStop('test');
  g.Worker = realWorker;
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
const b64 = (u: Uint8Array | string) => {
  const bytes = typeof u === 'string' ? new TextEncoder().encode(u) : u;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const LUNA = () => fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
const item = (name: string, type: string, data: string, check?: RsDocReply) => ({ name, type, size: data ? atob(data).length : 0, data, ...(check ? { check } : {}) });

describe("1.0's rules for Word documents and saved pages", () => {
  it("rsAccept and rsTypeOf are 1.0's: .docx, .html, .htm, .mhtml and .mht offered; a page is kept as Beuk's own type, never text/html", () => {
    const acc = c.api.rsAccept().split(',');
    for (const x of ['.docx', '.html', '.htm', '.mhtml', '.mht', 'text/html', 'multipart/related', RS_WORD, RS_WEB]) expect(acc).toContain(x);
    expect(c.api.rsTypeOf('notes.docx', '')).toBe(RS_WORD);
    expect(c.api.rsTypeOf('notes.docx', 'application/zip')).toBe(RS_WORD);
    expect(c.api.rsTypeOf('page.mhtml', 'multipart/related')).toBe(RS_WEB);
    expect(c.api.rsTypeOf('page.mht', 'message/rfc822')).toBe(RS_WEB);
    expect(c.api.rsTypeOf('page.html', 'text/html')).toBe(RS_WEB);
    expect(c.api.rsTypeOf('old.doc', 'application/msword')).toBeNull();
    expect(c.api.rsTypeOf('page.webarchive', 'application/x-webarchive')).toBeNull();
    expect(c.api.rsKinds()[RS_WORD]).toBe('word');
    expect(c.api.rsKinds()[RS_WEB]).toBe('web');
  });

  it("a .docx and an .mhtml the worker opened are kept under 1.0's types, the note taking the document's title and the page's address; an old .doc and a Safari .webarchive are refused by name with 1.0's keys, and so is anything the worker could not open", () => {
    const y = open(LUNA().book);
    const s = nbState(c, y);
    const docx = b64('PK-docx-bytes'), page = b64('MIME-mhtml-bytes');
    const r = addRead(c, s, null, [
      item('Tides.docx', '', docx, { ok: true, title: 'Harbour &amp; Tides‮' }),
      item('today.mhtml', 'multipart/related', page, { ok: true, kind: 'mhtml', url: 'https://example.org/tides/today', title: 'Tide' }),
      item('old.doc', 'application/msword', b64('old')),
      item('Saved.webarchive', 'application/x-webarchive', b64('bplist')),
      item('renamed.docx', '', b64('old'), { ok: false, reason: 'old-doc' }),
      item('broken.docx', '', b64('nope'), { ok: false, reason: 'no-document' }),
      item('safari.html', 'text/html', b64('bplist'), { ok: false, reason: 'webarchive' }),
      item('binary.html', 'text/html', b64('\u0000\u0001'), { ok: false, reason: 'not-html' }),
      item('slow.docx', '', b64('PK'), { ok: false, reason: 'timeout' }),
      item('unopened.html', 'text/html', b64('<p>x</p>')),
    ], t);
    expect(r.added.map((f) => [f.name, f.mediaType])).toEqual([['Tides.docx', RS_WORD], ['today.mhtml', RS_WEB]]);
    expect(r.added[0]!.data).toBe(docx); // byte for byte, as it came
    expect(r.refused).toEqual([
      t('rs.docOld', { name: 'old.doc' }),
      t('rs.webarchive', { name: 'Saved.webarchive' }),
      t('rs.docOld', { name: 'renamed.docx' }),
      t('rs.notWord', { name: 'broken.docx' }),
      t('rs.webarchive', { name: 'safari.html' }),
      t('rs.notWeb', { name: 'binary.html' }),
      t('rs.readFail', { name: 'slow.docx' }),
      t('rs.notWeb', { name: 'unopened.html' }),
    ]);
    // 1.0's rsPlainTitle: entities read, a right-to-left override gone; the address held to http(s) (rsUrl)
    expect(r.note!.title).toBe('Harbour & Tides');
    expect(r.note!.url).toBe('https://example.org/tides/today');
  });

  it('a reader job over 1.0\'s time limit stops the worker and the view says rs.docBig', async () => {
    g.Worker = vmWorkerClass({ hang: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f: ResearchFile = { id: 'slow', name: 'slow.docx', mediaType: RS_WORD, data: b64('PK'), bytes: 2 };
    const p = docView(c, f);
    vi.advanceTimersByTime(c.api.RS_DOC_MS - 1);
    expect(rsWorkers[0]!.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await p).toEqual({ error: 'rs.docBig' });
    expect(rsWorkers[0]!.terminated).toBe(true);
  });
});

/* ---- the room ---- */

async function studioWith(book: Rec) {
  await importToDevice(book);
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnNotebook')!.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
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
  await backupClicked(() => fireEvent.click(document.getElementById('btnLocalBackup')!));
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec }).book;
}
const addFiles = async (list: File[]) => {
  await act(async () => {
    fireEvent.change(document.getElementById('rsFileInput')!, { target: { files: list } });
  });
};
const viewOf = (name: string) => {
  const b = [...document.querySelectorAll('[data-rsview]')].find((x) => x.textContent === name) as HTMLElement;
  if (b.getAttribute('aria-expanded') !== 'true') act(() => b.click());
  return document.getElementById('rsView')!;
};
/** Nothing in the reader view can run: no script, no frame or object, no on* attribute, no link or source but http(s), mailto and data: pictures. */
function inert(root: Element) {
  expect(root.querySelector('script, iframe, frame, object, embed, form, input, svg, style, meta, base, link')).toBeNull();
  for (const el of root.querySelectorAll('*')) {
    for (const a of el.attributes) {
      expect(a.name.startsWith('on'), `${el.tagName} ${a.name}`).toBe(false);
      if (a.name === 'href') expect(a.value).toMatch(/^(https?:|mailto:)/);
      if (a.name === 'src') expect(a.value).toMatch(/^data:image\/(png|jpeg|gif|webp);base64,/);
    }
  }
}

describe('the reader in the Notebook', { timeout: 60_000 }, () => {
  it('a .docx and an .mhtml are opened by 1.0\'s worker from /assets/rsdoc.js and kept; the Word view shows the opening state, then 1.0\'s note, "every word shown" and the words', async () => {
    await studioWith(LUNA().book);
    await openNotebook();
    const docx = await docxBytes(['Every tide'], 'Harbour &amp; Tides');
    const page = mhtmlText('<!doctype html><html><head><title>Tide</title></head><body><h1>Pier</h1><p>Wmark the pier.</p></body></html>', 'https://example.org/tides/today');
    await addFiles([new File([docx as BlobPart], 'Tides.docx', { type: RS_WORD }), new File([page], 'today.mhtml', { type: 'multipart/related' })]);
    await waitFor(() => expect(document.querySelectorAll('#rsRow [data-rsfile]').length).toBe(2), { timeout: 20_000 });
    // the worker, from the site's root where 1.0's own is (its importScripts then reach /assets/vendor/)
    expect(rsWorkers.length).toBeGreaterThan(0);
    expect(rsWorkers.every((w) => w.url === '/assets/rsdoc.js')).toBe(true);
    expect([...document.querySelectorAll('#rsRow .rs-meta')].map((m) => m.textContent!.split(' · ')[0])).toEqual([t('rs.kind.word'), t('rs.kind.web')]);
    expect(($('nbTitle') as HTMLInputElement).value).toBe('Harbour & Tides');
    // the last file added is open: the page
    let v = document.getElementById('rsView')!;
    expect(v.getAttribute('data-rsopen')).toBe(document.querySelectorAll('#rsRow [data-rsfile]')[1]!.getAttribute('data-rsfile'));
    // the Word document
    v = viewOf('Tides.docx');
    const slot = v.querySelector('.rs-doc[data-rsdoc]')!;
    expect(slot.getAttribute('aria-busy')).toBe('true');
    expect(slot.textContent).toBe(t('rs.opening'));
    await waitFor(() => expect(v.querySelector('.rs-doc-body')).not.toBeNull(), { timeout: 20_000 });
    expect(slot.hasAttribute('aria-busy')).toBe(false);
    expect(v.querySelector('.rs-doc-note')!.textContent).toBe(t('rs.wordNote'));
    const fid = v.querySelector('.rs-doc-fidelity')!;
    expect(fid.textContent).toBe(t('rs.allShown'));
    expect(fid.classList.contains('is-partial')).toBe(false);
    // rsSanitize's own root (a <div>) imported as it is, as 1.0's rsDocFill appends it
    expect(v.querySelector('.rs-doc-body')!.innerHTML).toBe('<div><p>Every tide</p></div>');
    expect(v.querySelector('.rs-doc-body')!.getAttribute('dir')).toBe('auto');
    // the page: 1.0's web note, its heading as h3
    v = viewOf('today.mhtml');
    await waitFor(() => expect(v.querySelector('.rs-doc-body')).not.toBeNull(), { timeout: 20_000 });
    expect(v.querySelector('.rs-doc-note')!.textContent).toBe(t('rs.webNote'));
    expect(v.querySelector('.rs-doc-body h3')!.textContent).toBe('Pier');
    expect(v.querySelector('.rs-doc-fidelity')!.textContent).toBe(t('rs.allShown'));
    // no new tab for either (1.0's rsTabOk), and the book keeps both under 1.0's types, byte for byte
    expect(document.querySelector('[data-rstab]')).toBeNull();
    const files = ((await exported()).research as { files: ResearchFile[] }).files;
    expect(files.map((f) => [f.name, f.mediaType])).toEqual([['Tides.docx', RS_WORD], ['today.mhtml', RS_WEB]]);
    expect(files[0]!.data).toBe(b64(docx));
  });

  it("an old .doc and a Safari .webarchive are refused by name with 1.0's keys; a renamed picture is refused by what the worker found", async () => {
    await studioWith(LUNA().book);
    await openNotebook();
    const toasts: string[] = [];
    await addFiles([
      new File(['ÐÏ\u0011à'], 'old.doc', { type: 'application/msword' }),
      new File(['bplist00'], 'Saved.webarchive', { type: 'application/x-webarchive' }),
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'chart.docx', { type: '' }),
    ]);
    await waitFor(() => expect(document.querySelector('#toasts .toast')).not.toBeNull(), { timeout: 20_000 });
    for (const el of document.querySelectorAll('#toasts .toast')) toasts.push(el.textContent || '');
    const all = toasts.join(' ');
    expect(all).toContain(t('rs.docOld', { name: 'old.doc' }));
    expect(all).toContain(t('rs.webarchive', { name: 'Saved.webarchive' }));
    expect(all).toContain(t('rs.notWord', { name: 'chart.docx' }));
    expect(document.querySelectorAll('#rsRow [data-rsfile]').length).toBe(0);
    expect('research' in (await exported())).toBe(false);
  });

  it("a page's scripts, handlers, frames, forms and javascript: links never reach the DOM; the view says what it left out, by kind and number", async () => {
    await studioWith(LUNA().book);
    await openNotebook();
    const html = '<!doctype html><html><head><title>Trap</title><scr' + 'ipt>window.__rsPwned=1</scr' + 'ipt></head><body>' +
      '<h1 onclick="window.__rsPwned=2">Wmark the pier</h1><p>By the <a href="https://example.org/pier">pier</a>, <a href="javascript:window.__rsPwned=3">bad</a>.</p>' +
      '<img src="x" onerror="window.__rsPwned=4"><iframe src="https://evil.example"></iframe><svg onload="window.__rsPwned=5"><circle r="5"/></svg>' +
      '<form action="https://evil.example"><input name="q"></form><scr' + 'ipt>window.__rsPwned=6</scr' + 'ipt></body></html>';
    await addFiles([new File([html], 'trap.html', { type: 'text/html' })]);
    await waitFor(() => expect(document.querySelectorAll('#rsRow [data-rsfile]').length).toBe(1), { timeout: 20_000 });
    const v = viewOf('trap.html');
    await waitFor(() => expect(v.querySelector('.rs-doc-body')).not.toBeNull(), { timeout: 20_000 });
    inert(v);
    expect(g.__rsPwned).toBeUndefined();
    const body = v.querySelector('.rs-doc-body')!;
    expect(body.querySelector('h3')!.textContent).toBe('Wmark the pier');
    const a = body.querySelector('a[href]')!;
    expect([a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]).toEqual(['https://example.org/pier', '_blank', 'noopener noreferrer nofollow']);
    expect(body.textContent).toContain('bad'); // its words stay; only where it led is left out
    expect(body.querySelector('.rs-gone')!.textContent).toBe(t('rs.webPicMark'));
    const fid = v.querySelector('.rs-doc-fidelity')!;
    expect(fid.classList.contains('is-partial')).toBe(true);
    const list = [
      t('rs.g.form', { n: '1', w: '0' }), t('rs.g.media', { n: '1', w: '0' }), t('rs.g.drawing', { n: '1', w: '0' }),
      t('rs.g.webPic', { n: '1', w: '0' }), t('rs.g.link', { n: '1', w: '0' }), t('rs.g.code', { n: '2', w: '0' }),
    ];
    expect(fid.textContent).toBe(t('rs.notShown', { list: list.join('; ') }));
  });

  it('a job over 1.0\'s time limit shows rs.docBig in the view', async () => {
    await studioWith(LUNA().book);
    await openNotebook();
    await addFiles([new File([await docxBytes(['Slow tide'])] as BlobPart[], 'slow.docx', { type: RS_WORD })]);
    await waitFor(() => expect(document.querySelectorAll('#rsRow [data-rsfile]').length).toBe(1), { timeout: 20_000 });
    // close it, make the next worker one that never answers, and open it again
    act(() => (document.querySelector('[data-rsview]') as HTMLElement).click());
    expect(document.getElementById('rsView')).toBeNull();
    c.api.rsDocStop('test');
    c.api.rsDocW.cache.clear();
    g.Worker = vmWorkerClass({ hang: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => (document.querySelector('[data-rsview]') as HTMLElement).click());
    const slot = document.querySelector('#rsView .rs-doc')!;
    expect(slot.textContent).toBe(t('rs.opening'));
    await act(async () => {
      vi.advanceTimersByTime(c.api.RS_DOC_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(document.querySelector('#rsView .rs-doc')!.textContent).toBe(t('rs.docBig')), { timeout: 5000 });
    expect(document.querySelector('#rsView .rs-doc-body')).toBeNull();
    expect(document.querySelector('#rsView .rs-doc')!.hasAttribute('aria-busy')).toBe(false);
  });
});

const $ = (id: string) => document.getElementById(id);
