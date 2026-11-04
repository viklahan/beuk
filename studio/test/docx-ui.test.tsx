import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudFacts, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset, exportRun } from '../src/export/state';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';

/* Wave 5c, task 2 (inventory F3, F4): 1.0's Word document and box set in the studio — the export modal's own sections,
   shown where 1.0 has them, wired by 1.0's own initExport (#btnDownloadDocx, #btnBoxSetAdd, #boxSetFileInput,
   #btnBuildBoxSet, the list's Remove). The downloads are 1.0's (name, type, every entry), built on the open book's
   state even when another part of the studio sets its own state into the closure while 1.0's code waits; nothing is
   written into the book. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
// 1.0's vendored JSZip, as the page loads it (jsdom runs no <script src>): its UMD sets the global JSZip (require's own
// exports are empty here)
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
import { loadMammoth } from './vendor';
loadMammoth();
const JSZip = (globalThis as unknown as { JSZip: { loadAsync: (b: ArrayBuffer) => Promise<{ files: Record<string, { dir: boolean; async: (t: string) => Promise<string> }> }> } }).JSZip;
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
  cloudFacts.available = false;
  cloudFacts.user = null;
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
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

const book = (name: string) => structuredClone(fixtures('all').find((f) => f.name === name)!.book) as Rec;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
async function studioWith(doc: Rec) {
  await importToDevice(doc);
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnExport')?.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
}
async function openExport() {
  await click($('btnExport'));
  await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
}
/** Every download the action starts (1.0's downloadBlob), waited for until `n` have come. */
async function downloads(fn: () => Promise<void> | void, n = 1): Promise<{ blob: Blob; name: string }[]> {
  const got: { blob: Blob; name: string }[] = [];
  let last: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((last = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (last) got.push({ blob: last, name: this.download });
    }),
  ];
  await fn();
  await waitFor(() => expect(got.length, toasts().join(" / ")).toBeGreaterThanOrEqual(n), { timeout: 30_000 });
  sp.forEach((s) => s.mockRestore());
  return got;
}
async function backup(): Promise<Rec> {
  const d = await downloads(() => click($('btnLocalBackup')));
  return (JSON.parse(await d[0]!.blob.text()) as { book: Rec }).book;
}
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
/** A zip's entries, each as text (the box set's pictures as their base64, as 1.0's file list holds them). */
async function entries(blob: Blob, binary: Set<string> = new Set()): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const [p, f] of Object.entries(z.files)) if (!f.dir) out[p] = await f.async(binary.has(p) ? 'base64' : 'string');
  return out;
}
const asMap = (files: { path: string; content: string }[]) => Object.fromEntries(files.map((f) => [f.path, f.content]));
const backupFile = (b: Rec, name: string) => new File([JSON.stringify({ format: 'beuk-backup', book: b })], name, { type: 'application/json' });
async function addBooks(files: File[]) {
  const input = $('boxSetFileInput') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => void fireEvent.change(input));
}

describe('Word and the box set in the studio (F3, F4)', { timeout: 120_000 }, () => {
  it("Word: 1.0's section, where 1.0 has it; Download .docx is 1.0's file (name, type, every part), even when another state stands in the closure meanwhile; nothing is written", async () => {
    const doc = book('real/lantern-coast-book-one');
    await studioWith(doc);
    await openExport();
    const sec = $('btnDownloadDocx').closest('.fmt-sec') as HTMLElement;
    expect(sec.style.display).toBe('');
    expect(sec.querySelector('h3')!.textContent).toBe(t('exp.docxH'));
    expect($('btnDownloadDocx').textContent).toBe(t('exp.downloadDocx'));
    // 1.0's own order: Standalone HTML, then Word, then the manuscript
    const order = Array.from(document.querySelectorAll('#modalExport .fmt-sec h3')).map((h) => h.getAttribute('data-i18n'));
    expect(order.indexOf('exp.docxH')).toBe(order.indexOf('exp.htmlH') + 1);
    const files = exportRun((cc) => asMap(cc.api.buildDocxFiles()))!;
    const other = exportRun((cc) => ({ ...(cc.getState() as Rec), meta: { ...((cc.getState() as Rec).meta as Rec), title: 'Another state' } }))!;
    const d = await downloads(async () => {
      await click($('btnDownloadDocx'));
      c.setState(other as never); // another session's state, set while 1.0's code waits on the zip
    });
    expect(d.map((x) => x.name)).toEqual([c.api.slug((doc.meta as Rec).title) + '.docx']);
    expect(d[0]!.blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(await entries(d[0]!.blob)).toEqual(files);
    await waitFor(() => expect($('btnDownloadDocx').textContent).toBe('Download .docx'));
    expect(toasts()).toContain('Word document downloaded — headings, scene breaks and endnotes included');
    expect(await backup()).toEqual(want(doc));
  });

  it("the box set: 1.0's list (Book One in the studio), its words when empty; Add a Book reads a Beuk backup as Book Two; Build is 1.0's file; Remove takes it out; nothing is written", async () => {
    const doc = book('real/salt-road-book-one');
    const v2 = book('real/reads-you'), v3 = book('real/four-kitchens-book-one');
    await studioWith(doc);
    await openExport();
    expect(($('btnBuildBoxSet').closest('.fmt-sec') as HTMLElement).style.display).toBe('');
    expect($('boxSetList').querySelector('.bs-row .bs-title')!.textContent).toBe((doc.meta as Rec).title);
    expect($('boxSetList').textContent).toContain('IN STUDIO');
    expect($('boxSetList').querySelector('.bs-empty')!.textContent).toMatch(/^No further books yet\./);
    // Build with Book One alone: 1.0's own words, no file
    await click($('btnBuildBoxSet'));
    expect(toasts()).toContain('Add at least one more book to make a box set — this book alone is Book One');
    await addBooks([backupFile(v2, 'reads-you.beuk-backup.json'), backupFile(v3, 'four-kitchens.json'), new File(['x'], 'draft.docx')]);
    await waitFor(() => expect($('boxSetList').querySelectorAll('.bs-row').length).toBe(3));
    const rows = Array.from($('boxSetList').querySelectorAll('.bs-row'));
    expect(rows.map((r) => r.querySelector('.bs-vol')!.textContent)).toEqual(['BOOK ONE', 'BOOK TWO', 'BOOK THREE']);
    expect(rows.map((r) => r.querySelector('.bs-title')!.textContent)).toEqual([(doc.meta as Rec).title, (v2.meta as Rec).title, (v3.meta as Rec).title]);
    expect(toasts()).toContain('Added as Book Two: ' + (v2.meta as Rec).title);
    expect(toasts().some((x) => x.startsWith('Could not add draft.docx: '))).toBe(true);
    const files = exportRun((cc) => cc.api.boxSetFiles())!;
    const binary = new Set(files.filter((f) => f.binary).map((f) => f.path));
    const other = exportRun((cc) => ({ ...(cc.getState() as Rec), boxSetVolumes: [] }))!;
    const d = await downloads(async () => {
      await click($('btnBuildBoxSet'));
      c.setState(other as never);
    });
    expect(d.map((x) => x.name)).toEqual([c.api.slug((doc.meta as Rec).title) + '-box-set.epub']);
    expect(d[0]!.blob.type).toBe('application/epub+zip');
    const got = await entries(d[0]!.blob, binary);
    // dcterms:modified is the build's time (1.0's own: new Date() in boxSetFiles), masked
    const mask = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k === 'OEBPS/package.opf' ? v.replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '') : v]));
    expect(mask(got)).toEqual(mask(asMap(files)));
    expect(Object.keys(got).filter((p) => /vol0[123]-divider/.test(p))).toEqual(['OEBPS/Text/vol01-divider.xhtml', 'OEBPS/Text/vol02-divider.xhtml', 'OEBPS/Text/vol03-divider.xhtml']);
    await waitFor(() => expect(toasts().some((x) => x.startsWith('Box set exported — 3 books, ')), toasts().join(' | ')).toBe(true));
    // Remove Book Two: 1.0's list again
    await click($('boxSetList').querySelectorAll('[data-bsremove]')[0]!);
    expect(Array.from($('boxSetList').querySelectorAll('.bs-title')).map((x) => x.textContent)).toEqual([(doc.meta as Rec).title, (v3.meta as Rec).title]);
    expect(toasts()).toContain('Book removed from the box set');
    // the list stays with the book while the modal is closed and opened again
    await click($('btnCloseExport'));
    await openExport();
    expect($('boxSetList').querySelectorAll('.bs-row').length).toBe(2);
    expect(await backup()).toEqual(want(doc));
  });
});

describe('review of 5c (Minor 2): the box set waits on its script faces', { timeout: 120_000 }, () => {
  it("another state set while 1.0's ensureScriptFonts reads a face's bytes (a native wait after a fetch): the box set is still the open book's, with its volumes", async () => {
    const doc = book('real/salt-road-book-one');
    const ch = (doc.sections as Rec[]).find((x) => x.kind === 'body' && x.type === 'chapter')!;
    ch.content = 'नमस्ते दुनिया, यह एक पंक्ति है।\n\n' + String(ch.content || '');
    await studioWith(doc);
    await openExport();
    await addBooks([backupFile(book('real/reads-you'), 'reads-you.json')]);
    await waitFor(() => expect($('boxSetList').querySelectorAll('.bs-row').length).toBe(2));
    const other = exportRun((cc) => ({ ...(cc.getState() as Rec), boxSetVolumes: [] }))!;
    const FONTS = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'fonts');
    let displaced = 0;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (!u.pathname.startsWith('/assets/fonts/')) return real(input);
      const bytes = readFileSync(path.join(FONTS, decodeURIComponent(u.pathname.slice('/assets/fonts/'.length))));
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        ok: true,
        status: 200,
        text: async () => bytes.toString('utf8'),
        blob: async () => new Blob([buf]),
        // the face's bytes arrive later, and another part of the studio sets its state meanwhile
        arrayBuffer: () => new Promise<ArrayBuffer>((r) => setTimeout(() => {
          displaced++;
          c.setState(other as never);
          r(buf);
        }, 5)),
      } as unknown as Response;
    });
    await downloads(() => click($('btnBuildBoxSet')));
    expect(displaced).toBeGreaterThan(0);
    await waitFor(() => expect(toasts().some((x) => x.startsWith('Box set exported — ')), toasts().join(' | ')).toBe(true));
    expect(toasts().filter((x) => x.startsWith('Box set exported — ')).every((x) => x.startsWith('Box set exported — 2 books, '))).toBe(true);
  });
});
