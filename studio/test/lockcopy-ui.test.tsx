import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
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
import { loadPrint, printRun } from '../src/print/print';
import { loadCloud } from '../src/cloud/cloud';
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* Locked review copy (design 2026-11-06), task 3: 1.0's lock controls and its three download points, run in the
   studio as 1.0's own code (BEUK:lockcopy, lifted): the Word document (#lockDocx beside #btnDownloadDocx), the
   submission manuscript (#lockMs beside #btnMsDownload) and the print-ready PDF (a separate link, [data-pr-locked],
   beside [data-pr-download], opening the same fieldset in a small dialog). Lock off, every download is today's. The
   password never leaves the device: no request, console line, storage, toast or error report carries it, and the
   fields are empty after every attempt. Day 22 (access "paused") hides the controls; the unlocked exports stay. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js'); // its UMD sets the global JSZip
const JSZip = (globalThis as unknown as { JSZip: { loadAsync: (b: ArrayBuffer | Uint8Array) => Promise<{ files: Record<string, { dir: boolean; async: (t: string) => Promise<string> }> }> } }).JSZip;
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
  document.documentElement.removeAttribute('data-plan-access');
  document.getElementById('modalLockPdf')?.remove();
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

const LANTERN = () => structuredClone(fixtures('all').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const inp = (id: string) => document.getElementById(id) as HTMLInputElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!$(id) && $(id).classList.contains('open');
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
async function type(el: HTMLElement, value: string) {
  await act(async () => {
    (el as HTMLInputElement).value = value;
    fireEvent.input(el);
  });
}
/** Every download started (1.0's downloadBlob) while `fn` runs and `settle` waits. */
async function downloads(fn: () => Promise<void> | void, settle: (got: { blob: Blob; name: string }[]) => Promise<void>): Promise<{ blob: Blob; name: string }[]> {
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
  await settle(got);
  sp.forEach((s) => s.mockRestore());
  return got;
}
/** The book as 1.0's backup holds it (the desk's Y.Doc, History included): the lock writes nothing into it. */
async function backupText(): Promise<string> {
  const d = await downloads(() => click($('btnLocalBackup')), (got) => waitFor(() => expect(got.length).toBeGreaterThan(0), { timeout: 30_000 }));
  return d[0]!.blob.text();
}
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
const asMap = (files: { path: string; content: string }[]) => Object.fromEntries(files.map((f) => [f.path, f.content]));
async function entries(blob: Blob): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Record<string, string> = {};
  for (const [p, f] of Object.entries(z.files)) if (!f.dir) out[p] = await f.async('string');
  return out;
}
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const utf16 = (s: string) => Buffer.from(s, 'utf16le');
const has = (hay: Uint8Array, needle: Uint8Array) => Buffer.from(hay).indexOf(Buffer.from(needle)) >= 0;
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const slugTitle = () => c.api.slug((LANTERN().meta as Rec).title) as string;

/** A one-page PDF, a classic xref (the lock's own tests use this shape). */
function onePagePdf(): Uint8Array {
  const cat = (...parts: string[]) => Buffer.from(parts.join(''), 'latin1');
  const content = 'BT /F1 12 Tf 20 100 Td (A review copy) Tj ET';
  const objs = [
    cat('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    cat('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    cat('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'),
    cat(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`),
    cat('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'),
  ];
  const head = cat('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offs: number[] = [];
  let pos = head.length;
  for (const o of objs) {
    offs.push(pos);
    pos += o.length;
  }
  const xref = 'xref\n0 6\n0000000000 65535 f\r\n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n\r\n').join('');
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([head, ...objs, cat(xref, trailer)]));
}

/** The print-ready panel with a finished job (1.0's printReadyUi, as printReadyPdf leaves it when the job is done). */
async function printReadyDone(exportId = 'exp-42') {
  await loadPrint();
  await act(async () => {
    printRun((p) => {
      Object.assign(p.api.printReadyUi as unknown as Rec, { running: false, state: 'done', msg: t('pr.ready'), exportId, paused: false });
      (p.api.printReadyRender as () => void)();
    });
  });
}
/** fetch, answering the export's download with `body` (the rest passes through). */
function fetchPdf(body: Uint8Array | null, status = 200) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/\/api\/exports\/[^/]+\/download$/.test(u)) {
      return new Response(status === 200 ? (body as BodyInit | null) : JSON.stringify({ error: 'export not found' }), {
        status,
        headers: status === 200 ? { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="lantern-print-6x9-pdfx.pdf"' } : { 'content-type': 'application/json' },
      });
    }
    return real(input, init);
  });
}
async function lockPdfWith(pw: string, pw2 = pw) {
  await click(document.querySelector('#printReadyNote [data-pr-locked]'));
  await waitFor(() => expect(isOpen('modalLockPdf')).toBe(true));
  await type($('lockPdfPw'), pw);
  await type($('lockPdfPw2'), pw2);
  await click($('btnLockPdfGo'));
}
const settled = (fn: () => void) => () => waitFor(fn, { timeout: 30_000 });

describe('locked review copy: the controls and the three download points (task 3)', { timeout: 120_000 }, () => {
  it("lock off is unchanged: Download .docx and the manuscript hand downloadBlob the builder's file, with today's names", async () => {
    await studioWith(LANTERN());
    await openExport();
    expect($('lockDocx')).toBeTruthy();
    expect(inp('lockDocxOn').checked).toBe(false);
    expect($('lockDocxFields').hidden).toBe(true);
    const files = exportRun((cc) => asMap(cc.api.buildDocxFiles()))!;
    const d = await downloads(() => click($('btnDownloadDocx')), settled(() => expect($('btnDownloadDocx').textContent).toBe('Download .docx')));
    expect(d.map((x) => x.name)).toEqual([slugTitle() + '.docx']);
    expect(d[0]!.blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(await entries(d[0]!.blob)).toEqual(files);
    expect(toasts()).toContain('Word document downloaded — headings, scene breaks and endnotes included');
    await click($('btnMsOpen'));
    expect(inp('lockMsOn').checked).toBe(false);
    const ms = exportRun((cc) => asMap(cc.api.msFiles(cc.api.msPlan())))!;
    const m = await downloads(() => click($('btnMsDownload')), settled(() => expect(toasts().some((x) => x.startsWith('Submission manuscript downloaded — '))).toBe(true)));
    expect(m.map((x) => x.name)).toEqual([exportRun((cc) => cc.api.msFilename())]);
    expect(await entries(m[0]!.blob)).toEqual(ms);
  });

  it('lock on: the Word file and the manuscript are the locked bytes, named <base>-locked.docx; a mismatch or an empty password downloads nothing and says so inline', async () => {
    await studioWith(LANTERN());
    await openExport();
    await click($('lockDocxOn'));
    expect($('lockDocxFields').hidden).toBe(false);
    expect($('lockDocx').textContent).toContain(t('lock.note'));
    // a mismatch
    await type($('lockDocxPw'), 'one-pass');
    await type($('lockDocxPw2'), 'two-pass');
    let d = await downloads(() => click($('btnDownloadDocx')), async () => void (await new Promise((r) => setTimeout(r, 300))));
    expect(d).toEqual([]);
    expect($('lockDocxErr').hidden).toBe(false);
    expect($('lockDocxErr').textContent).toBe(t('lock.mismatch'));
    expect([inp('lockDocxPw').value, inp('lockDocxPw2').value, inp('lockDocxOn').checked]).toEqual(['', '', true]);
    // empty
    d = await downloads(() => click($('btnDownloadDocx')), async () => void (await new Promise((r) => setTimeout(r, 300))));
    expect(d).toEqual([]);
    expect($('lockDocxErr').textContent).toBe(t('lock.empty'));
    // locked
    await type($('lockDocxPw'), 'Review-Copy 1');
    await type($('lockDocxPw2'), 'Review-Copy 1');
    expect($('lockDocxErr').hidden).toBe(true); // typing again puts the message away
    d = await downloads(() => click($('btnDownloadDocx')), settled(() => expect(toasts()).toContain(t('lock.done'))));
    expect(d.map((x) => x.name)).toEqual([slugTitle() + '-locked.docx']);
    const b = await bytesOf(d[0]!.blob);
    expect(Array.from(b.subarray(0, 8))).toEqual(CFB);
    expect(has(b, utf16('EncryptionInfo')) && has(b, utf16('EncryptedPackage'))).toBe(true);
    expect([inp('lockDocxPw').value, inp('lockDocxPw2').value, inp('lockDocxOn').checked]).toEqual(['', '', true]);
    await waitFor(() => expect($('btnDownloadDocx').textContent).toBe('Download .docx'));
    // the manuscript
    await click($('btnMsOpen'));
    await click($('lockMsOn'));
    await type($('lockMsPw'), 'abc');
    await type($('lockMsPw2'), 'abd');
    d = await downloads(() => click($('btnMsDownload')), async () => void (await new Promise((r) => setTimeout(r, 300))));
    expect(d).toEqual([]);
    expect($('lockMsErr').textContent).toBe(t('lock.mismatch'));
    d = await downloads(() => click($('btnMsDownload')), async () => void (await new Promise((r) => setTimeout(r, 300))));
    expect(d).toEqual([]);
    expect($('lockMsErr').textContent).toBe(t('lock.empty'));
    await type($('lockMsPw'), 'Manuscript pw');
    await type($('lockMsPw2'), 'Manuscript pw');
    const before = toasts().filter((x) => x === t('lock.done')).length;
    d = await downloads(() => click($('btnMsDownload')), settled(() => expect(toasts().filter((x) => x === t('lock.done')).length).toBe(before + 1)));
    expect(d.map((x) => x.name)).toEqual([String(exportRun((cc) => cc.api.msFilename())).replace(/\.docx$/, '-locked.docx')]);
    expect(Array.from((await bytesOf(d[0]!.blob)).subarray(0, 8))).toEqual(CFB);
    expect([inp('lockMsPw').value, inp('lockMsPw2').value, inp('lockMsOn').checked]).toEqual(['', '', true]);
    await waitFor(() => expect($('btnMsDownload').textContent).toBe(t('ms.download')));
    // nothing of the lock is written into the book
    await act(async () => void $('modalManuscript').classList.remove('open'));
    expect((JSON.parse(await backupText()) as { book: Rec }).book).toEqual(want(LANTERN()));
  });

  it('no double run: a second click while locking makes no second file', async () => {
    await studioWith(LANTERN());
    await openExport();
    await click($('lockDocxOn'));
    await type($('lockDocxPw'), 'twice');
    await type($('lockDocxPw2'), 'twice');
    const d = await downloads(async () => {
      await click($('btnDownloadDocx'));
      expect(($('btnDownloadDocx') as HTMLButtonElement).disabled).toBe(true);
      await click($('btnDownloadDocx'));
      await waitFor(() => expect($('btnDownloadDocx').textContent).toBe(t('lock.working')), { timeout: 20_000 });
      await click($('btnDownloadDocx'));
    }, settled(() => expect($('btnDownloadDocx').textContent).toBe('Download .docx')));
    expect(d.length).toBe(1);
    expect(toasts().filter((x) => x === t('lock.done')).length).toBe(1);
    expect(toasts().filter((x) => x === t('lock.empty') || x === t('lock.mismatch')).length).toBe(0);
    expect($('lockDocxErr').hidden).toBe(true);
  });

  it('the PDF locked copy: a separate link beside the print-ready one; it fetches the export (same-origin) and downloads the locked PDF as <base>-locked.pdf', async () => {
    await studioWith(LANTERN());
    await openExport();
    await printReadyDone('exp-42');
    const note = $('printReadyNote');
    const dl = note.querySelector('[data-pr-download]') as HTMLAnchorElement;
    const locked = note.querySelector('[data-pr-locked]') as HTMLAnchorElement;
    expect(dl.textContent).toBe(t('pr.btn'));
    expect(dl.getAttribute('href')).toBe('/api/exports/exp-42/download');
    expect(locked).toBeTruthy();
    expect(locked.textContent).toBe(t('lock.pdf'));
    expect(locked.hidden).toBe(false);
    expect(locked).not.toBe(dl);
    const pdf = onePagePdf();
    const f = fetchPdf(pdf);
    // a mismatch first: nothing fetched, the dialog stays with the message
    await lockPdfWith('aa', 'ab');
    expect($('lockPdfErr').textContent).toBe(t('lock.mismatch'));
    expect(f.mock.calls.filter((x) => /download$/.test(String(x[0]))).length).toBe(0);
    expect([inp('lockPdfPw').value, inp('lockPdfPw2').value]).toEqual(['', '']);
    expect(inp('lockPdfOn').checked).toBe(true);
    await type($('lockPdfPw'), 'pdf pass');
    await type($('lockPdfPw2'), 'pdf pass');
    const d = await downloads(() => click($('btnLockPdfGo')), settled(() => expect(toasts()).toContain(t('lock.done'))));
    const calls = f.mock.calls.filter((x) => /\/api\/exports\//.test(String(x[0])));
    expect(calls.length).toBe(1);
    expect(String(calls[0]![0])).toBe('/api/exports/exp-42/download');
    const init = (calls[0]![1] || {}) as RequestInit;
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBeUndefined();
    expect(d.map((x) => x.name)).toEqual(['lantern-print-6x9-pdfx-locked.pdf']);
    expect(d[0]!.blob.type).toBe('application/pdf');
    const s = latin1(await bytesOf(d[0]!.blob));
    expect(s).toMatch(/\/Filter\s*\/Standard/);
    expect(s).toMatch(/\/R\s+6/);
    expect(s).not.toContain('A review copy');
    expect(isOpen('modalLockPdf')).toBe(false);
    expect([inp('lockPdfPw').value, inp('lockPdfPw2').value]).toEqual(['', '']);
    // the print-ready link is today's, untouched
    expect((note.querySelector('[data-pr-download]') as HTMLAnchorElement).getAttribute('href')).toBe('/api/exports/exp-42/download');
  });

  it('fields cleared: after success, a mismatch, a thrown lock error and closing the dialog both inputs are empty; the checkbox keeps its state', async () => {
    await studioWith(LANTERN());
    await openExport();
    await printReadyDone('exp-7');
    // a thrown lock error: the server's file is no PDF
    fetchPdf(new Uint8Array(Buffer.from('not a pdf at all')));
    await lockPdfWith('thrown pw');
    await waitFor(() => expect(toasts().some((x) => x.startsWith(t('lock.failed', { error: '' })))).toBe(true), { timeout: 20_000 });
    expect([inp('lockPdfPw').value, inp('lockPdfPw2').value, inp('lockPdfOn').checked]).toEqual(['', '', true]);
    await waitFor(() => expect(($('btnLockPdfGo') as HTMLButtonElement).disabled).toBe(false));
    // closed with Close, then with Escape: the fields typed into are emptied
    await type($('lockPdfPw'), 'half typed');
    await click($('btnLockPdfClose'));
    expect(isOpen('modalLockPdf')).toBe(false);
    expect([inp('lockPdfPw').value, inp('lockPdfPw2').value]).toEqual(['', '']);
    await click(document.querySelector('#printReadyNote [data-pr-locked]'));
    await type($('lockPdfPw2'), 'half typed');
    await act(async () => void fireEvent.keyDown($('lockPdfPw2'), { key: 'Escape' }));
    expect(isOpen('modalLockPdf')).toBe(false);
    expect(isOpen('modalExport')).toBe(true); // Escape closed the top dialog only
    expect([inp('lockPdfPw').value, inp('lockPdfPw2').value]).toEqual(['', '']);
    // unticking empties them too
    await click($('lockDocxOn'));
    await type($('lockDocxPw'), 'kept?');
    await click($('lockDocxOn'));
    expect([inp('lockDocxPw').value, inp('lockDocxOn').checked, $('lockDocxFields').hidden]).toEqual(['', false, true]);
  });

  /* Fix round 1 (I1): the export modal and the manuscript dialog, closed by Close, the backdrop and Escape with a
     password typed, are empty when they open again (and the box keeps its state). */
  it('fields cleared on every close: the export modal and the manuscript dialog, by Close, backdrop and Escape, reopen with both inputs empty', async () => {
    await studioWith(LANTERN());
    await openExport();
    await click($('lockDocxOn'));
    const fill = async (scope: 'Docx' | 'Ms') => {
      await type($('lock' + scope + 'Pw'), 'typed then closed');
      await type($('lock' + scope + 'Pw2'), 'typed then closed');
    };
    const empty = (scope: 'Docx' | 'Ms') => [inp('lock' + scope + 'Pw').value, inp('lock' + scope + 'Pw2').value, inp('lock' + scope + 'On').checked];
    const closes: [string, (id: string, btn: string) => Promise<void>][] = [
      ['Close', async (_id, btn) => void (await click($(btn)))],
      ['backdrop', async (id) => void (await click($(id)))],
      ['Escape', async () => void (await act(async () => void fireEvent.keyDown(document, { key: 'Escape' })))],
    ];
    for (const [how, close] of closes) {
      await fill('Docx');
      await close('modalExport', 'btnCloseExport');
      expect(isOpen('modalExport'), how).toBe(false);
      await openExport();
      expect(empty('Docx'), 'export modal, ' + how).toEqual(['', '', true]);
    }
    await click($('btnMsOpen'));
    await click($('lockMsOn'));
    for (const [how, close] of closes) {
      await fill('Ms');
      await close('modalManuscript', 'btnMsClose');
      expect(isOpen('modalManuscript'), how).toBe(false);
      await openExport();
      await click($('btnMsOpen'));
      expect(empty('Ms'), 'manuscript dialog, ' + how).toEqual(['', '', true]);
    }
  });

  /* Fix round 1 (I2): what is typed while a lock runs does not survive the run — success or throw, on all three paths.
     The lock is held mid-run at its crypto step (the DOCX lock's HMAC sign; the PDF's download), released after typing. */
  it('fields cleared after every run: text typed while a lock runs is gone when it finishes, on success and on a throw', async () => {
    await studioWith(LANTERN());
    await openExport();
    const subtle = globalThis.crypto.subtle;
    const realSign = subtle.sign.bind(subtle);
    let gate: { release: (fail: boolean) => void } | null = null;
    let held = 0;
    vi.spyOn(subtle, 'sign').mockImplementation((alg, key, data) => {
      held++;
      return new Promise<ArrayBuffer>((res, rej) => {
        gate = { release: (fail) => (fail ? rej(new Error('held lock refused')) : res(realSign(alg as AlgorithmIdentifier, key, data as BufferSource))) };
      });
    });
    const midRun = async (scope: 'Docx' | 'Ms', btn: string, fail: boolean) => {
      gate = null;
      const before = held;
      await type($('lock' + scope + 'Pw'), 'run pw');
      await type($('lock' + scope + 'Pw2'), 'run pw');
      await click($(btn));
      await waitFor(() => expect(held).toBe(before + 1), { timeout: 20_000 });
      await type($('lock' + scope + 'Pw'), 'typed mid-run');
      await type($('lock' + scope + 'Pw2'), 'typed mid-run');
      await act(async () => gate!.release(fail));
      await waitFor(() => expect(($(btn) as HTMLButtonElement).disabled).toBe(false), { timeout: 20_000 });
      expect([inp('lock' + scope + 'Pw').value, inp('lock' + scope + 'Pw2').value], scope + (fail ? ' throw' : ' success')).toEqual(['', '']);
    };
    await click($('lockDocxOn'));
    await downloads(() => midRun('Docx', 'btnDownloadDocx', false), async () => undefined);
    await midRun('Docx', 'btnDownloadDocx', true);
    expect(toasts().some((x) => x === t('lock.failed', { error: 'held lock refused' }))).toBe(true);
    await click($('btnMsOpen'));
    await click($('lockMsOn'));
    await downloads(() => midRun('Ms', 'btnMsDownload', false), async () => undefined);
    await midRun('Ms', 'btnMsDownload', true);
    // the PDF: held at its download
    await act(async () => void $('modalManuscript').classList.remove('open'));
    await openExport();
    await printReadyDone('exp-run');
    const real = globalThis.fetch;
    let release: ((ok: boolean) => void) | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!/\/download$/.test(u)) return real(input, init);
      const ok = await new Promise<boolean>((r) => (release = r));
      return new Response((ok ? onePagePdf() : new Uint8Array(Buffer.from('not a pdf'))) as BodyInit, { status: 200 });
    });
    for (const ok of [true, false]) {
      release = null;
      await lockPdfWith('pdf run');
      await waitFor(() => expect(release).not.toBeNull(), { timeout: 20_000 });
      await type($('lockPdfPw'), 'typed mid-run');
      await type($('lockPdfPw2'), 'typed mid-run');
      await downloads(async () => {
        await act(async () => release!(ok));
        await waitFor(() => expect(($('btnLockPdfGo') as HTMLButtonElement).disabled).toBe(false), { timeout: 20_000 });
      }, async () => undefined);
      expect([inp('lockPdfPw').value, inp('lockPdfPw2').value], 'pdf ' + (ok ? 'success' : 'throw')).toEqual(['', '']);
    }
  });

  it('no leak: the password, its base64 and its hex are in no request, console line, storage write, beacon or toast, on all three paths and a failing one', async () => {
    const PW = 'Zq7-unique-pw';
    const forms = [PW, Buffer.from(PW, 'utf8').toString('base64'), Buffer.from(PW, 'utf8').toString('hex'), Buffer.from(PW, 'utf16le').toString('base64'), Buffer.from(PW, 'utf16le').toString('hex')];
    const seen: string[] = [];
    const str = (v: unknown): string => {
      if (v == null) return String(v);
      if (typeof v === 'string') return v;
      if (v instanceof Uint8Array || v instanceof ArrayBuffer) return Buffer.from(v as Uint8Array).toString('latin1');
      if (v instanceof URL) return v.href;
      if (typeof Request !== 'undefined' && v instanceof Request) return v.url + ' ' + JSON.stringify([...v.headers]);
      if (v instanceof Headers) return JSON.stringify([...v.entries()]);
      try { return JSON.stringify(v, (_k, x) => (x instanceof Headers ? [...x.entries()] : x instanceof Uint8Array ? Buffer.from(x).toString('latin1') : x)); } catch { return String(v); }
    };
    await studioWith(LANTERN());
    await openExport();
    const pdf = onePagePdf();
    let bad = false;
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push('fetch ' + str(input) + ' ' + str(init));
      if (init && init.body instanceof Blob) seen.push('fetch body ' + (await init.body.text()));
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/api\/exports\/[^/]+\/download$/.test(u)) return new Response((bad ? new Uint8Array(Buffer.from('<html>no</html>')) : pdf) as BodyInit, { status: 200, headers: { 'content-type': 'application/pdf' } });
      return real(input, init);
    });
    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (body?: Document | XMLHttpRequestBodyInit | null) {
      seen.push('xhr ' + str(body));
    });
    const beacon = vi.fn((url: string | URL, data?: unknown) => (seen.push('beacon ' + str(url) + ' ' + str(data)), true));
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void seen.push('console ' + a.map(str).join(' ')));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      seen.push('storage ' + k + ' ' + v);
    });
    const errs: string[] = [];
    const onErr = (e: ErrorEvent) => errs.push(String(e.message));
    const onRej = (e: PromiseRejectionEvent) => errs.push(str(e.reason && (e.reason as Error).message));
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    try {
      // the Word file
      await click($('lockDocxOn'));
      await type($('lockDocxPw'), PW);
      await type($('lockDocxPw2'), PW);
      await downloads(() => click($('btnDownloadDocx')), settled(() => expect(toasts().filter((x) => x === t('lock.done')).length).toBe(1)));
      // the manuscript
      await click($('btnMsOpen'));
      await click($('lockMsOn'));
      await type($('lockMsPw'), PW);
      await type($('lockMsPw2'), PW);
      await downloads(() => click($('btnMsDownload')), settled(() => expect(toasts().filter((x) => x === t('lock.done')).length).toBe(2)));
      // the print-ready PDF, then the same with a file the lock refuses (it throws)
      await act(async () => void $('modalManuscript').classList.remove('open'));
      await openExport();
      await printReadyDone('exp-leak');
      await downloads(() => lockPdfWith(PW), settled(() => expect(toasts().filter((x) => x === t('lock.done')).length).toBe(3)));
      bad = true;
      await lockPdfWith(PW);
      await waitFor(() => expect(toasts().some((x) => x.startsWith(t('lock.failed', { error: '' })))).toBe(true), { timeout: 20_000 });
      // (1.0's error-report sender, beukReportError, posts through fetch: the fetch spy above is its spy too, and the
      // page's error and rejection events are recorded beside it)
    } finally {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
      delete (navigator as unknown as Rec).sendBeacon;
    }
    await act(async () => void $('modalExport').classList.remove('open'));
    const book = await backupText(); // the book on the desk (its Y.Doc, its History): no password either
    const all = seen.join('\n') + '\n' + errs.join('\n') + '\n' + toasts().join('\n') + '\n' + book;
    for (const f of forms) expect(all.includes(f), f).toBe(false);
    const failed = toasts().find((x) => x.startsWith(t('lock.failed', { error: '' })))!;
    expect(failed).not.toContain(PW);
    expect(seen.some((x) => x.startsWith('fetch /api/exports/exp-leak/download'))).toBe(true); // the spy saw the requests
    for (const id of ['lockDocxPw', 'lockDocxPw2', 'lockMsPw', 'lockMsPw2', 'lockPdfPw', 'lockPdfPw2']) expect(inp(id).value, id).toBe('');
  });

  it("autofill safety: new-password inputs whose name and id match no field of the sign-in form", async () => {
    await studioWith(LANTERN());
    await openExport();
    await printReadyDone();
    await click(document.querySelector('#printReadyNote [data-pr-locked]'));
    const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'client', 'index.html'), 'utf8');
    const auth = html.slice(html.indexOf('id="modalAuth"'), html.indexOf('class="modal-back"', html.indexOf('id="modalAuth"') + 10));
    const authNames = new Set([...auth.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1]!));
    expect(authNames.has('authPassword')).toBe(true);
    for (const id of ['lockDocxPw', 'lockDocxPw2', 'lockMsPw', 'lockMsPw2', 'lockPdfPw', 'lockPdfPw2']) {
      const el = inp(id);
      expect(el.type, id).toBe('password');
      expect(el.getAttribute('autocomplete'), id).toBe('new-password');
      expect(el.name, id).toMatch(/^lockcopy-/);
      expect(authNames.has(el.id), id).toBe(false);
      expect(authNames.has(el.name), id).toBe(false);
      expect(['password', 'current-password', 'email', 'username']).not.toContain(el.name);
    }
  });

  it('day 22: access "paused" hides the lock controls and the locked PDF link, and the unlocked downloads still work; trial, subscribed, grace and billing off show them', async () => {
    await studioWith(LANTERN());
    await openExport();
    await printReadyDone('exp-22');
    const cloud = await loadCloud();
    const plan = (p: Rec) => act(async () => void (cloud.api.billingPlanRender as (p: Rec) => void)(p));
    const shown = () => [!$('lockDocx').hidden, !$('lockMs').hidden, !(document.querySelector('#printReadyNote [data-pr-locked]') as HTMLElement).hidden];
    await click($('lockDocxOn'));
    await type($('lockDocxPw'), 'left behind');
    await plan({ billingOn: true, access: 'paused' });
    expect(shown()).toEqual([false, false, false]);
    expect(inp('lockDocxPw').value).toBe(''); // nothing typed stays behind a hidden control
    // the unlocked downloads, as today (the box ticked before the plan arrived does not lock)
    const d = await downloads(() => click($('btnDownloadDocx')), settled(() => expect($('btnDownloadDocx').textContent).toBe('Download .docx')));
    expect(d.map((x) => x.name)).toEqual([slugTitle() + '.docx']);
    expect((await entries(d[0]!.blob))['word/document.xml']).toBeTruthy();
    expect((document.querySelector('#printReadyNote [data-pr-download]') as HTMLElement).hidden).toBe(false);
    // the panel drawn again while paused: still hidden
    await act(async () => void printRun((p) => (p.api.printReadyRender as () => void)()));
    expect(shown()[2]).toBe(false);
    for (const p of [{ billingOn: true, access: 'trial', trialEndsAt: '2026-12-01T00:00:00Z' }, { billingOn: true, access: 'subscribed' }, { billingOn: true, access: 'grace', graceEndsAt: '2026-12-01T00:00:00Z' }, { billingOn: false }]) {
      await plan({ billingOn: true, access: 'paused' });
      await plan(p);
      expect(shown(), JSON.stringify(p)).toEqual([true, true, true]);
    }
    await act(async () => void (cloud.api.billingPlanRender as (p: unknown) => void)(null)); // signed out
    expect(shown()).toEqual([true, true, true]);
  });

  it("day 22 from boot (task 4, fix 1): GET /api/auth/me's access, mirrored, hides the lock before any plan is drawn; signed out or no access shows it; a later plan overrides it", async () => {
    await studioWith(LANTERN());
    await openExport();
    const cloud = await loadCloud();
    const me = (m: unknown) => act(async () => void (cloud.api.lockAccessNote as (m: unknown) => void)(m));
    const shown = () => [!$('lockDocx').hidden, !$('lockMs').hidden];
    await click($('lockDocxOn'));
    await type($('lockDocxPw'), 'left behind');
    await me({ user: { id: 'u1' }, access: { state: 'paused', daysLeft: 0, locked: ['exports'] } });
    expect(shown()).toEqual([false, false]);
    expect(document.documentElement.getAttribute('data-plan-access')).toBe('paused');
    expect(inp('lockDocxPw').value).toBe('');
    await me({ user: { id: 'u1' }, access: { state: 'trial', daysLeft: 9, locked: [] } });
    expect(shown()).toEqual([true, true]);
    await me({ user: { id: 'u1' }, access: { state: 'paused', daysLeft: 0, locked: [] } });
    await me({ user: { id: 'u1' } }); // billing off: no access in the answer
    expect(shown()).toEqual([true, true]);
    await me({ user: { id: 'u1' }, access: { state: 'paused', daysLeft: 0, locked: [] } });
    await me(null); // signed out
    expect(shown()).toEqual([true, true]);
    await me({ user: { id: 'u1' }, access: { state: 'paused', daysLeft: 0, locked: [] } });
    await act(async () => void (cloud.api.billingPlanRender as (p: unknown) => void)({ billingOn: true, access: 'subscribed' }));
    expect(shown()).toEqual([true, true]);
  });

  it('all 13 locales have the 10 keys (English verbatim; every {error} slot kept)', async () => {
    const KEYS: Record<string, string> = {
      'lock.toggle': 'Lock with a password',
      'lock.pw': 'Password',
      'lock.pw2': 'Type it again',
      'lock.note': 'Your reader needs this password to open the file. Send it separately, by text or a call, not in the same email.',
      'lock.mismatch': "The two passwords don't match.",
      'lock.empty': 'Type a password, or turn the lock off.',
      'lock.pdf': 'Download locked copy',
      'lock.working': 'Locking…',
      'lock.failed': 'The copy could not be locked: {error}',
      'lock.done': 'Locked copy downloaded.',
    };
    for (const [k, v] of Object.entries(KEYS)) expect((en as Rec)[k], k).toBe(v);
    for (const lang of ['ar', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru', 'tr', 'zh-Hans']) {
      const pack = (await import(`../src/generated/packs/${lang}.json`)).default as Rec;
      for (const k of Object.keys(KEYS)) {
        expect(typeof pack[k] === 'string' && (pack[k] as string).trim().length > 0, lang + ' ' + k).toBe(true);
        // (Italian writes "Password" as English does)
        if (!(lang === 'it' && k === 'lock.pw')) expect(pack[k], lang + ' ' + k + ' is a translation').not.toBe(KEYS[k]);
      }
      expect(pack['lock.failed'] as string, lang).toContain('{error}');
    }
  });
});

/* Task 4: 2.0's dialog stack. The print-ready PDF's password dialog (#modalLockPdf) is made by 1.0's own lockPdfDialog,
   appended to <body>; in the studio it takes its place on the dialog stack (src/shell/Dialog.tsx), as the export,
   manuscript, ACX and store dialogs do: Tab stays inside it, focus moves in and returns to the link that opened it, and
   Escape closes only it. And Escape on the export modal or the manuscript dialog (the stack's close) empties their
   password fields at once, as 1.0's Escape handler does (not only on the next open). */
describe("locked review copy: 2.0's dialog stack (task 4)", { timeout: 120_000 }, () => {
  const tab = (shift = false) => act(async () => void fireEvent.keyDown(document.activeElement || document.body, { key: 'Tab', shiftKey: shift }));
  const esc = () => act(async () => void fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' }));
  const lockedLink = () => document.querySelector('#printReadyNote [data-pr-locked]') as HTMLAnchorElement;
  async function openLockPdf() {
    const a = lockedLink();
    a.focus();
    expect(document.activeElement).toBe(a);
    await click(a);
    await waitFor(() => expect(isOpen('modalLockPdf')).toBe(true));
    await waitFor(() => expect($('modalLockPdf').contains(document.activeElement)).toBe(true));
  }

  it('#modalLockPdf is on the stack: Tab and Shift+Tab stay inside it, focus outside comes back in, and focus returns to the link on Close and on Escape', async () => {
    await studioWith(LANTERN());
    await openExport();
    await printReadyDone('exp-stack');
    await openLockPdf();
    expect(document.activeElement).toBe($('lockPdfPw'));
    // the last control, Tab: back to the first (the box is fixed on, so the first is the password)
    $('btnLockPdfGo').focus();
    await tab();
    expect(document.activeElement, 'Tab from the last control').toBe($('lockPdfPw'));
    await tab(true);
    expect(document.activeElement, 'Shift+Tab from the first control').toBe($('btnLockPdfGo'));
    // focus somewhere under the dialog (the export modal's close button): Tab brings it back inside
    $('btnCloseExport').focus();
    await tab();
    expect($('modalLockPdf').contains(document.activeElement), 'Tab from outside').toBe(true);
    // Close: closed, emptied, focus back on the link
    await type($('lockPdfPw'), 'typed then closed');
    await click($('btnLockPdfClose'));
    expect(isOpen('modalLockPdf')).toBe(false);
    expect(inp('lockPdfPw').value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(lockedLink()));
    // Escape: closes the PDF dialog only — the export modal under it stays open; focus back on the link
    await openLockPdf();
    await type($('lockPdfPw2'), 'typed then escaped');
    await esc();
    expect(isOpen('modalLockPdf')).toBe(false);
    expect(isOpen('modalExport'), 'the export modal stays open').toBe(true);
    expect(inp('lockPdfPw2').value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(lockedLink()));
    // Escape with focus outside the dialog (the stack's own close): closed and emptied too
    await openLockPdf();
    await type($('lockPdfPw'), 'typed, focus moved out');
    (document.activeElement as HTMLElement).blur();
    await esc();
    expect(isOpen('modalLockPdf')).toBe(false);
    expect(isOpen('modalExport')).toBe(true);
    expect(inp('lockPdfPw').value).toBe('');
  });

  it('Escape on the export modal and the manuscript dialog empties their password fields at once (as 1.0), the box keeping its state', async () => {
    await studioWith(LANTERN());
    await openExport();
    await click($('lockDocxOn'));
    await type($('lockDocxPw'), 'typed then escaped');
    await type($('lockDocxPw2'), 'typed then escaped');
    await esc();
    expect(isOpen('modalExport')).toBe(false);
    expect([inp('lockDocxPw').value, inp('lockDocxPw2').value, inp('lockDocxOn').checked]).toEqual(['', '', true]);
    await openExport();
    await click($('btnMsOpen'));
    await waitFor(() => expect(isOpen('modalManuscript')).toBe(true));
    await click($('lockMsOn'));
    await type($('lockMsPw'), 'typed then escaped');
    await type($('lockMsPw2'), 'typed then escaped');
    await esc();
    expect(isOpen('modalManuscript')).toBe(false);
    expect([inp('lockMsPw').value, inp('lockMsPw2').value, inp('lockMsOn').checked]).toEqual(['', '', true]);
  });
});
