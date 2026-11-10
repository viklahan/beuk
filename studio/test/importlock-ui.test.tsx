import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
import { exportReset } from '../src/export/state';
import { importPending } from '../src/import/import';
import { readBook } from '../../src/book/read';
import { exportBook } from '../../src/book/editor/index';
import { fixtures } from './fixtures';
import { maskVarying } from './import-fixture';
import { createImportOracle } from './import-oracle';
import { loadMammoth } from './vendor';

/* Opening locked files on import (design 2026-11-10), task 2: every way in asks for the password. 1.0's own reader
   (readImportFile, BEUK:importlock in client/index.html, lifted into the main closure) asks through 1.0's one password
   dialog (passwordAsk, premium 3's backup dialog made general), in the studio as the writer uses it: the Import button's
   #fileInput, a zip of one manuscript, Bulk import's reader and queue (the shelf's write stubbed: there is no server
   here), and a box set's Add a Book.
   pdf.js is the real one: 1.0's vendored 6.4.299 (client/assets/vendor/pdfjs-6.4.299/), loaded with Node's require of
   an ES module (jsdom loads no module <script>; Vite may not serve files outside the studio), its two globals set as the
   worker-first build sets them, so 2.0's loadPdfjs and 1.0's pdfLoadLib find them and load nothing.
   The locked fixtures are third-party output (test/fixtures/locked/README.md): msoffcrypto-tool's Agile DOCX, pypdf's
   RC4-128 / AES-128 / AES-256 PDFs. The "older lock" is the Agile fixture's EncryptionInfo with version 3.2 written by
   1.0's own lockCfb, as importlock-docx.test.ts does. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const req = createRequire(path.join(import.meta.dirname, 'importlock-ui.cjs'));
req('../../client/assets/vendor/jszip.min.js'); // its UMD sets the global JSZip
loadMammoth();
const PDFJS = path.join(import.meta.dirname, '..', '..', 'client', 'assets', 'vendor', 'pdfjs-6.4.299');
const g = globalThis as Rec;
g.pdfjsWorker ??= req(path.join(PDFJS, 'pdf.worker.min.mjs'));
g.pdfjsLib ??= req(path.join(PDFJS, 'pdf.min.mjs'));

const DIR = path.join(import.meta.dirname, 'fixtures', 'locked');
const fx = (n: string) => new Uint8Array(readFileSync(path.join(DIR, n)));
const PW = 'correct horse';
const PW_UNICODE = 'pässwörd\u{1F600}';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fileOf = (bytes: Uint8Array | string, name: string, type = '') => new File([bytes as BlobPart], name, { type });
const docx = (fixture: string, name = fixture) => fileOf(fx(fixture), name, DOCX_TYPE);
const pdf = (fixture: string, name = fixture) => fileOf(fx(fixture), name, 'application/pdf');

let c: Closure;
/** 1.0's bulk reader, batch context and summary (lifted in wave 7b; not in the Closure type) */
type Bulk = {
  bulkPrepareEntries: (entries: { file: File; path: string }[], onProgress: null, cb: (prep: Rec) => void) => void;
  bulkBatchContext: (items: unknown[], opts: Rec) => unknown;
  renderBulkSummary: (summary: Rec) => void;
};
const bulk = () => c.api as unknown as Bulk;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
}, 120_000);

/* every toast and every password dialog the page ever shows (toasts fade; the count of dialogs is the point) */
let seen: { toasts: string[]; dialogs: number };
let watch: MutationObserver | null = null;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
  exportReset();
  cloudFacts.available = false;
  cloudFacts.user = null;
  seen = { toasts: [], dialogs: 0 };
  watch = new MutationObserver((muts) => {
    for (const m of muts)
      for (const n of Array.from(m.addedNodes)) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.id === 'modalPasswordAsk') seen.dialogs++;
        if (n.classList.contains('toast')) seen.toasts.push(n.textContent || '');
      }
  });
  watch.observe(document.body, { childList: true, subtree: true });
});
afterEach(async () => {
  watch?.disconnect();
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const id of ['modalPasswordAsk', 'modalBackupPw', 'bulkSummary']) document.getElementById(id)?.remove();
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
const LANTERN = () => book('real/lantern-coast-book-one');
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const inp = (id: string) => document.getElementById(id) as HTMLInputElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!document.getElementById(id) && $(id).classList.contains('open');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((x) => x.textContent === label) as HTMLElement | undefined;
const live = () => exportBook(desk.ydoc!) as Rec;
/** The toasts were only 1.0's own note after an import ("Imported <name> — <what it recognised>"): no error, no other. */
const onlyImported = (name: string) => {
  expect(seen.toasts.length, JSON.stringify(seen.toasts)).toBe(1);
  expect(seen.toasts[0]!.startsWith(t('import.imported', { name }) + ' — '), seen.toasts[0]).toBe(true);
};
const stored = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;

async function studioWith(doc: Rec) {
  await importToDevice(doc);
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('btnImport')?.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  await waitFor(() => expect(desk.ydoc).not.toBeNull());
}
async function settle() {
  for (let i = 0; i < 4; i++) await act(() => tick(5));
  const p = importPending();
  if (p) await act(() => p);
  for (let i = 0; i < 3; i++) await act(() => tick(5));
}
/** The file chosen in 1.0's #fileInput, as the browser fires change. */
async function choose(file: File) {
  const input = inp('fileInput');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => void fireEvent.change(input));
}
async function asked() {
  await waitFor(() => expect(isOpen('modalPasswordAsk'), 'the password dialog (toasts: ' + JSON.stringify(seen.toasts) + ')').toBe(true), { timeout: 20_000 });
}
async function typeAndOpen(pw: string) {
  await act(async () => {
    inp('passwordAskField').value = pw;
    fireEvent.input(inp('passwordAskField'));
  });
  await click($('btnPasswordAskOpen'));
}
async function replaceYes() {
  await waitFor(() => expect(document.body.textContent).toContain(t('import.replaceTitle')), { timeout: 60_000 });
  await click(button(t('import.replaceYes'))!);
  await settle();
}
/** 1.0's own import of `file` onto `deskBook`, in Node (the oracle), as 2.0 stores it. */
async function oracleBook(deskBook: Rec, file: File): Promise<Rec> {
  const o = await createImportOracle(t, { mammoth: g.mammoth, pdfLoadLib: async () => g.pdfjsLib });
  o.api.applyBookDoc(structuredClone(deskBook) as never);
  const run = (await o.api.readImportFile(file as never)) as () => void;
  run();
  return stored(JSON.parse(JSON.stringify(o.api.serializeBook())) as Rec);
}
/** Everything the device keeps: localStorage, and every IndexedDB store's records (bytes read as UTF-8 too). */
async function deviceText(): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < localStorage.length; i++) parts.push(localStorage.key(i)!, localStorage.getItem(localStorage.key(i)!) || '');
  const dec = new TextDecoder();
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === 'string') parts.push(v);
    else if (v instanceof Uint8Array || v instanceof ArrayBuffer) parts.push(dec.decode(v));
    else if (ArrayBuffer.isView(v)) parts.push(dec.decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
    else if (v instanceof Blob) return;
    else if (typeof v === 'object') for (const x of Object.values(v as Rec)) walk(x);
  };
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(d.name!);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    for (const s of Array.from(db.objectStoreNames)) {
      const all = await new Promise<unknown[]>((res) => {
        const r = db.transaction(s, 'readonly').objectStore(s).getAll();
        r.onsuccess = () => res(r.result as unknown[]);
        r.onerror = () => res([]);
      });
      walk(all);
    }
    db.close();
  }
  return parts.join('\n');
}
/** The Agile fixture with its EncryptionInfo's version made 3.2 (Standard encryption), written by 1.0's lockCfb. */
function olderLock(): Uint8Array {
  const s = c.api.cfbStreams(fx('agile-sha512.docx'));
  const info = s.get('EncryptionInfo')!.slice();
  info.set([3, 0, 2, 0], 0);
  const NOSTREAM = 0xffffffff;
  return c.api.lockCfb([
    { name: 'Root Entry', type: 5, color: 1, left: NOSTREAM, right: NOSTREAM, child: 1, data: new Uint8Array(0) },
    { name: 'EncryptionInfo', type: 2, color: 1, left: NOSTREAM, right: 2, child: NOSTREAM, data: info },
    { name: 'EncryptedPackage', type: 2, color: 0, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, data: s.get('EncryptedPackage')! },
  ]);
}

describe('a locked Word file through the Import button (task 2)', { timeout: 180_000 }, () => {
  it('a locked .docx asks for its password, never "damaged"', async () => {
    await studioWith(LANTERN());
    await choose(docx('agile-sha512.docx'));
    await asked();
    expect($('modalPasswordAsk').textContent).toContain('agile-sha512.docx');
    expect($('passwordAskH').textContent).toBe(t('importLock.title'));
    expect($('passwordAskH').querySelector('span')!.hasAttribute('data-i18n')).toBe(false); // (its lead names the file: the words come in whole)
    expect($('passwordAskLead').textContent).toBe(t('importLock.lead', { name: 'agile-sha512.docx' }));
    expect($('btnPasswordAskOpen').textContent).toBe(t('backup.pwOpen'));
    expect($('btnPasswordAskCancel').textContent).toBe(t('backup.pwCancel'));
    expect(inp('passwordAskField').type).toBe('password');
    expect(seen.toasts.join('\n')).not.toContain('could not be read as a Word document');
    await click($('btnPasswordAskCancel'));
  });

  it('right password imports the book: the same book 1.0 makes of the plain file', async () => {
    const deskBook = LANTERN();
    await studioWith(deskBook);
    await choose(docx('agile-sha512.docx'));
    await asked();
    await typeAndOpen(PW);
    await replaceYes();
    await waitFor(() => expect(document.getElementById('modalPasswordAsk')).toBeNull());
    const want = await oracleBook(deskBook, docx('plain.docx', 'agile-sha512.docx'));
    expect(maskVarying(live())).toEqual(maskVarying(want));
    expect(((want.sections as Rec[]) || []).some((s) => String(s.content || '').trim().length > 20)).toBe(true);
  });

  it('wrong then right in one dialog: the wrong one says so and empties the field; then it imports, one dialog, no toast', async () => {
    await studioWith(LANTERN());
    await choose(docx('agile-sha512.docx'));
    await asked();
    await typeAndOpen('not it');
    await waitFor(() => expect($('passwordAskErr').hidden).toBe(false), { timeout: 30_000 });
    expect($('passwordAskErr').textContent).toBe(t('importLock.wrong'));
    expect(isOpen('modalPasswordAsk')).toBe(true);
    expect(inp('passwordAskField').value).toBe('');
    expect((inp('btnPasswordAskOpen') as unknown as HTMLButtonElement).disabled).toBe(false);
    // typing again clears the message
    await typeAndOpen(PW);
    await replaceYes();
    await waitFor(() => expect(String((live().meta as Rec).title)).not.toBe(String((LANTERN().meta as Rec).title)), { timeout: 30_000 });
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    expect(seen.dialogs).toBe(1);
    onlyImported('agile-sha512.docx');
  });

  it('Cancel leaves the desk alone: the same book, no confirm, no toast', async () => {
    await studioWith(LANTERN());
    const before = JSON.stringify(live()), doc0 = desk.ydoc;
    await choose(docx('agile-sha512.docx'));
    await asked();
    await click($('btnPasswordAskCancel'));
    await waitFor(() => expect(document.getElementById('modalPasswordAsk')).toBeNull());
    await settle();
    for (let i = 0; i < 20; i++) await act(() => tick(10));
    expect(desk.ydoc).toBe(doc0);
    expect(JSON.stringify(live())).toBe(before);
    expect(isOpen('modalConfirm')).toBe(false);
    expect(seen.toasts).toEqual([]);
  });

  it('Cancel while the password is checked: the ask ends at once, the late answer is dropped, the desk is left alone', async () => {
    await studioWith(LANTERN());
    const before = JSON.stringify(live()), doc0 = desk.ydoc;
    await choose(docx('agile-sha512.docx'));
    await asked();
    await act(async () => {
      inp('passwordAskField').value = PW;
      fireEvent.input(inp('passwordAskField'));
      fireEvent.click($('btnPasswordAskOpen'));
      // busy: Open is disabled and says it is working; Cancel stays usable
      expect(($('btnPasswordAskOpen') as HTMLButtonElement).disabled).toBe(true);
      expect($('btnPasswordAskOpen').getAttribute('aria-busy')).toBe('true');
      expect(($('btnPasswordAskCancel') as HTMLButtonElement).disabled).toBe(false);
      expect(inp('passwordAskField').value).toBe('');
      fireEvent.click($('btnPasswordAskCancel'));
    });
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    for (let i = 0; i < 30; i++) await act(() => tick(100)); // well past the check (SHA-512, 100 000 rounds)
    await settle();
    expect(isOpen('modalConfirm')).toBe(false);
    expect(desk.ydoc).toBe(doc0);
    expect(JSON.stringify(live())).toBe(before);
    expect(seen.toasts).toEqual([]);
  });

  it('a Unicode password opens its file (UTF-16LE of the string as typed)', async () => {
    await studioWith(LANTERN());
    await choose(docx('agile-unicode.docx'));
    await asked();
    await typeAndOpen(PW_UNICODE);
    await replaceYes();
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    onlyImported('agile-unicode.docx');
  });

  it('older lock: EncryptionInfo 3.2 gives importLock.old and no dialog', async () => {
    await studioWith(LANTERN());
    const before = JSON.stringify(live());
    await choose(fileOf(olderLock(), 'standard.docx', DOCX_TYPE));
    await waitFor(() => expect(seen.toasts).toContain(t('importLock.old')), { timeout: 20_000 });
    expect(seen.dialogs).toBe(0);
    expect(JSON.stringify(live())).toBe(before);
  });

  it('a compound file without the two streams keeps the damaged-Word words (a .doc renamed)', async () => {
    await studioWith(LANTERN());
    const NOSTREAM = 0xffffffff;
    const doc = c.api.lockCfb([
      { name: 'Root Entry', type: 5, color: 1, left: NOSTREAM, right: NOSTREAM, child: 1, data: new Uint8Array(0) },
      { name: 'WordDocument', type: 2, color: 1, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, data: new Uint8Array(600) },
    ]);
    await choose(fileOf(doc, 'renamed.docx', DOCX_TYPE));
    await waitFor(() => expect(seen.toasts.join('\n')).toContain('could not be read as a Word document'), { timeout: 20_000 });
    expect(seen.dialogs).toBe(0);
  });

  it('zip of one locked docx asks, and its password imports it', async () => {
    await studioWith(LANTERN());
    const JSZip = g.JSZip as { new (): { file: (n: string, d: Uint8Array) => void; generateAsync: (o: Rec) => Promise<Uint8Array> } };
    const z = new JSZip();
    z.file('drafts/agile-sha512.docx', fx('agile-sha512.docx'));
    await choose(fileOf(await z.generateAsync({ type: 'uint8array' }), 'manuscript.zip', 'application/zip'));
    await asked();
    expect($('passwordAskLead').textContent).toBe(t('importLock.lead', { name: 'agile-sha512.docx' }));
    await typeAndOpen(PW);
    await replaceYes();
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    onlyImported('agile-sha512.docx');
  });

  it('the password is not kept: not in the book, its History, localStorage or IndexedDB', async () => {
    const pw = 'unique-' + PW; // not this fixture's password: tried first, then the right one
    await studioWith(LANTERN());
    await choose(docx('agile-sha512.docx'));
    await asked();
    await typeAndOpen(pw);
    await waitFor(() => expect($('passwordAskErr').hidden).toBe(false), { timeout: 30_000 });
    await typeAndOpen(PW);
    await replaceYes();
    await waitFor(() => expect(document.getElementById('modalPasswordAsk')).toBeNull());
    for (let i = 0; i < 10; i++) await act(() => tick(50));
    const b = JSON.stringify(live());
    expect(Array.isArray(live().history) && (live().history as unknown[]).length).toBeTruthy();
    expect(b).not.toContain(pw);
    expect(b).not.toContain(PW);
    const kept = await deviceText();
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).not.toContain(pw);
    expect(kept).not.toContain(PW);
    expect(seen.toasts.join('\n')).not.toContain(PW);
  });
});

describe('a locked PDF through the Import button (task 2), with the real pdf.js', { timeout: 180_000 }, () => {
  it('aes-256.pdf asks; its password imports the same book 1.0 makes of the plain PDF', async () => {
    const deskBook = LANTERN();
    await studioWith(deskBook);
    await choose(pdf('aes-256.pdf'));
    await asked();
    expect($('passwordAskLead').textContent).toBe(t('importLock.lead', { name: 'aes-256.pdf' }));
    expect(seen.toasts.join('\n')).not.toContain(t('pdf.password'));
    await typeAndOpen('not it');
    await waitFor(() => expect($('passwordAskErr').textContent).toBe(t('importLock.wrong')), { timeout: 30_000 });
    expect(inp('passwordAskField').value).toBe('');
    await typeAndOpen(PW);
    await replaceYes();
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    const want = await oracleBook(deskBook, pdf('plain.pdf', 'aes-256.pdf'));
    expect(maskVarying(live())).toEqual(maskVarying(want));
    expect(JSON.stringify(live())).toContain('The Harbour');
    expect(seen.dialogs).toBe(1);
  });

  for (const [name, pw] of [['rc4-128.pdf', PW], ['aes-128.pdf', PW], ['aes-256-unicode.pdf', PW_UNICODE]] as const)
    it(`${name} opens with its password`, async () => {
      await studioWith(LANTERN());
      await choose(pdf(name));
      await asked();
      await typeAndOpen(pw);
      await replaceYes();
      expect(document.getElementById('modalPasswordAsk')).toBeNull();
      expect(JSON.stringify(live())).toContain('The Harbour');
    });

  it('owner-only.pdf (a permissions lock) imports with no dialog', async () => {
    await studioWith(LANTERN());
    await choose(pdf('owner-only.pdf'));
    await replaceYes();
    expect(seen.dialogs).toBe(0);
    expect(JSON.stringify(live())).toContain('The Harbour');
  });

  it('Cancel on a locked PDF leaves the desk alone and says nothing but the reading note', async () => {
    await studioWith(LANTERN());
    const before = JSON.stringify(live());
    await choose(pdf('aes-128.pdf'));
    await asked();
    await click($('btnPasswordAskCancel'));
    await settle();
    expect(JSON.stringify(live())).toBe(before);
    expect(isOpen('modalConfirm')).toBe(false);
    expect(seen.toasts).toEqual([t('pdf.reading', { name: 'aes-128.pdf' })]);
  });
});

describe('Bulk import and Add a Book (task 2)', { timeout: 180_000 }, () => {
  it("bulk: a locked file, Cancel — the other files import, and the summary row reads bulk.locked", async () => {
    await studioWith(LANTERN());
    const entries = [
      fileOf('# The First\n\nIt began with a lighthouse and a long walk home.\n', 'plain.md'),
      docx('agile-sha512.docx'),
      fileOf('# The Second\n\nThe tide came in twice that evening, and nobody minded.\n', 'plain2.md'),
    ].map((file) => ({ file, path: file.name }));
    // 1.0's bulk reader and queue (startBulkImport's two steps), the shelf's write answered here: there is no server
    const prepared = new Promise<Rec>((res) => bulk().bulkPrepareEntries(entries, null, res));
    await asked();
    expect($('passwordAskLead').textContent).toBe(t('importLock.lead', { name: 'agile-sha512.docx' }));
    await click($('btnPasswordAskCancel'));
    const prep = await prepared;
    const items = prep.items as Rec[];
    expect(items.map((x) => [x.name, x.error ?? null])).toEqual([['plain.md', null], ['agile-sha512.docx', 'locked'], ['plain2.md', null]]);
    const ctx = bulk().bulkBatchContext(items, { images: prep.imageMap });
    const created: string[] = [];
    const summary = await new Promise<Rec>((res) =>
      c.api.bulkRunQueue(items, { ctx, shelfFingerprints: new Set(), createBook: (_d: unknown, title: string, cb: (e: unknown) => void) => (created.push(title), cb(null)) }, null, res),
    );
    expect(created.length).toBe(2);
    document.body.insertAdjacentHTML('beforeend', '<div id="bulkSummary" style="display:none"></div>');
    bulk().renderBulkSummary(summary);
    const sum = $('bulkSummary').textContent!;
    expect(sum).toContain(t('bulk.added', { n: 2 }));
    expect(sum).toContain('agile-sha512.docx — ' + t('bulk.locked'));
    expect(sum).not.toContain(t('bulk.reasonUnreadable'));
    expect(seen.dialogs).toBe(1);
  });

  it('bulk: a locked file opened with its password is read like any other', async () => {
    await studioWith(LANTERN());
    const prepared = new Promise<Rec>((res) => bulk().bulkPrepareEntries([{ file: docx('agile-sha512.docx'), path: 'agile-sha512.docx' }], null, res));
    await asked();
    await typeAndOpen(PW);
    const items = (await prepared).items as Rec[];
    expect(items.length).toBe(1);
    expect(items[0]!.error).toBeUndefined();
    expect(typeof items[0]!.run).toBe('function');
  });

  it('box set Add a Book: Cancel — no volume is added, and the message says it is locked', async () => {
    await studioWith(LANTERN());
    await click($('btnExport'));
    await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
    const list0 = $('boxSetList').textContent;
    const input = inp('boxSetFileInput');
    Object.defineProperty(input, 'files', { value: [docx('agile-sha512.docx')], configurable: true });
    await act(async () => void fireEvent.change(input));
    await asked();
    // above the export modal, the password dialog is the top of 2.0's dialog stack: Tab from its last control wraps to
    // its first, not into the export modal
    await waitFor(() => expect(document.activeElement).toBe($('passwordAskField')));
    $('btnPasswordAskOpen').focus();
    await act(async () => void fireEvent.keyDown(document.activeElement!, { key: 'Tab' }));
    expect(document.activeElement).toBe($('passwordAskField'));
    expect(isOpen('modalExport')).toBe(true);
    await click($('btnPasswordAskCancel'));
    await waitFor(() => expect(seen.toasts).toContain('Could not add agile-sha512.docx: ' + t('bulk.locked')), { timeout: 20_000 });
    expect($('boxSetList').textContent).toBe(list0);
    expect(isOpen('modalExport')).toBe(true); // the box set's modal stays where it was
  });
});

describe('the one password dialog (passwordAsk)', { timeout: 60_000 }, () => {
  const ask = <T,>(tryOpen: (pw: string) => Promise<T>) => c.api.passwordAsk({ title: 'T', lead: 'L', wrong: 'W', tryOpen });
  const coded = (code: string) => Object.assign(new Error(code), { code });
  const enter = async (pw: string) => {
    await act(async () => {
      inp('passwordAskField').value = pw;
      fireEvent.input(inp('passwordAskField'));
      fireEvent.click($('btnPasswordAskOpen'));
    });
  };

  it('a wrong-password keeps it open; another error closes it and rejects with that error, once', async () => {
    let calls = 0;
    const p = ask(async (pw) => {
      calls++;
      if (pw === 'a') throw coded('wrong-password');
      throw coded('damaged');
    });
    const out = p.then((v) => ({ v }), (e: unknown) => ({ e }));
    await enter('a');
    await waitFor(() => expect($('passwordAskErr').textContent).toBe('W'));
    expect(isOpen('modalPasswordAsk')).toBe(true);
    await enter('b');
    const r = (await out) as { e?: { code?: string } };
    expect(r.e?.code).toBe('damaged');
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    expect(calls).toBe(2);
  });

  it('an empty field never calls tryOpen; Escape is Cancel (null); a second ask ends the first', async () => {
    const tried = vi.fn(async () => 1);
    const first = ask(tried);
    await enter('');
    expect(tried).not.toHaveBeenCalled();
    expect($('passwordAskErr').textContent).toBe('W');
    const second = ask(tried);
    expect(await first).toBeNull();
    expect(document.querySelectorAll('#modalPasswordAsk').length).toBe(1);
    await act(async () => void fireEvent.keyDown(inp('passwordAskField'), { key: 'Escape' }));
    expect(await second).toBeNull();
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
  });

  it('busy while tryOpen runs; Cancel then resolves null at once and the late result is dropped', async () => {
    let finish!: (v: string) => void;
    const p = ask(() => new Promise<string>((r) => (finish = r)));
    await enter('pw');
    expect(($('btnPasswordAskOpen') as HTMLButtonElement).disabled).toBe(true);
    expect($('btnPasswordAskOpen').getAttribute('aria-busy')).toBe('true');
    await click($('btnPasswordAskCancel'));
    expect(await p).toBeNull();
    finish('late');
    await tick(5);
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
  });

  it('no lead, no paragraph: the backup ask keeps premium 3\'s ids and words', async () => {
    const env = await c.api.backupLock('{"format":"x"}', 'right pw');
    const envelope = ((await c.api.backupRead(env)) as { envelope: object } | null)?.envelope;
    const p = c.api.backupPasswordAsk(envelope ?? JSON.parse(env));
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true));
    expect($('backupPwH').textContent).toBe(t('backup.pwTitle'));
    expect($('backupPwH').querySelector('span')!.getAttribute('data-i18n')).toBe('backup.pwTitle'); // premium 3's title follows a language change
    expect(document.getElementById('backupPwLead')).toBeNull();
    expect($('modalBackupPw').querySelectorAll('p.m-sub').length).toBe(0);
    expect(inp('backupPw').name).toBe('lockcopy-backup-open-pw');
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    await click($('btnBackupPwCancel'));
    expect(await p).toBeNull();
  });
});

/** The Agile fixture behind a valid verifier, its EncryptedPackage changed in one byte past the size: the right password
 *  passes the verifier and the dataIntegrity HMAC then fails — officeUnlock's "damaged". Written by 1.0's lockCfb. */
function damagedLock(): Uint8Array {
  const s = c.api.cfbStreams(fx('agile-sha512.docx'));
  const pkg = s.get('EncryptedPackage')!.slice();
  pkg[8 + 100] ^= 0xff;
  const NOSTREAM = 0xffffffff;
  return c.api.lockCfb([
    { name: 'Root Entry', type: 5, color: 1, left: NOSTREAM, right: NOSTREAM, child: 1, data: new Uint8Array(0) },
    { name: 'EncryptionInfo', type: 2, color: 1, left: NOSTREAM, right: 2, child: NOSTREAM, data: s.get('EncryptionInfo')! },
    { name: 'EncryptedPackage', type: 2, color: 0, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, data: pkg },
  ]);
}

describe('Task 2 review fixes', { timeout: 180_000 }, () => {
  it('finding 1: every pdf.js loading task that failed (no password, a wrong one) is destroyed', async () => {
    type Task = { destroy: () => Promise<void>; promise: Promise<unknown> };
    const real = g.pdfjsLib as Rec & { getDocument: (p: Rec) => Task };
    const tasks: { failed: boolean; destroyed: boolean; withPassword: boolean }[] = [];
    g.pdfjsLib = {
      ...real,
      getDocument: (p: Rec) => {
        const task = real.getDocument(p);
        const rec = { failed: false, destroyed: false, withPassword: typeof p.password === 'string' };
        tasks.push(rec);
        const destroy = task.destroy.bind(task);
        task.destroy = () => ((rec.destroyed = true), destroy());
        task.promise.catch(() => (rec.failed = true));
        return task;
      },
    };
    try {
      await studioWith(LANTERN());
      await choose(pdf('aes-256.pdf'));
      await asked();
      await typeAndOpen('not it');
      await waitFor(() => expect($('passwordAskErr').hidden).toBe(false), { timeout: 30_000 });
      await typeAndOpen(PW);
      await replaceYes();
    } finally {
      g.pdfjsLib = real;
    }
    expect(tasks.map((x) => [x.withPassword, x.failed])).toEqual([[false, true], [true, true], [true, false]]);
    expect(tasks.filter((x) => x.failed).map((x) => x.destroyed)).toEqual([true, true]);
  });

  it("finding 2: Escape with the focus outside the dialog cancels the ask (1.0's page Escape never hides it unsettled)", async () => {
    // 1.0's page handler (initCloud's document keydown: the top .modal-back loses "open"), in the shape it has there
    let pageHid = 0;
    const page = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelectorAll('.modal-back.open');
      if (!open.length) return;
      open[open.length - 1]!.classList.remove('open');
      pageHid++;
    };
    document.addEventListener('keydown', page);
    try {
      const entries = [docx('agile-sha512.docx'), fileOf('# After\n\nThe batch goes on after the locked one.\n', 'after.md')].map((file) => ({ file, path: file.name }));
      const prepared = new Promise<Rec>((res) => bulk().bulkPrepareEntries(entries, null, res));
      await asked();
      inp('passwordAskField').blur();
      expect($('modalPasswordAsk').contains(document.activeElement)).toBe(false);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      const got = (await Promise.race([prepared, tick(5000).then(() => ({ items: [{ name: 'stalled' }] }))])) as Rec;
      const items = got.items as Rec[];
      expect(items.map((x) => [x.name, x.error ?? null])).toEqual([['agile-sha512.docx', 'locked'], ['after.md', null]]);
      expect(document.getElementById('modalPasswordAsk')).toBeNull();
      expect(pageHid).toBe(0); // the ask took that Escape: the page's handler never saw it
    } finally {
      document.removeEventListener('keydown', page);
      document.getElementById('modalPasswordAsk')?.remove();
    }
  });

  it('finding 4: the lead describes the dialog (aria-describedby); the backup ask, with no lead, has none', async () => {
    const p = c.api.passwordAsk({ title: 'T', lead: 'Lead words', wrong: 'W', tryOpen: async () => 1 });
    const box = $('modalPasswordAsk').querySelector('.modal')!;
    expect(box.getAttribute('aria-describedby')).toBe('passwordAskLead');
    expect($('passwordAskLead').textContent).toBe('Lead words');
    await click($('btnPasswordAskCancel'));
    expect(await p).toBeNull();
    const env = await c.api.backupLock('{"format":"x"}', 'right pw');
    const q = c.api.backupPasswordAsk(JSON.parse(env));
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true));
    expect($('modalBackupPw').querySelector('.modal')!.hasAttribute('aria-describedby')).toBe(false);
    await click($('btnBackupPwCancel'));
    expect(await q).toBeNull();
  });

  it('finding 6a: a damaged locked .docx says importLock.damaged once and closes the dialog; the desk is left alone', async () => {
    await studioWith(LANTERN());
    const before = JSON.stringify(live());
    await choose(fileOf(damagedLock(), 'damaged.docx', DOCX_TYPE));
    await asked();
    await typeAndOpen(PW);
    await waitFor(() => expect(seen.toasts).toContain(t('importLock.damaged')), { timeout: 30_000 });
    for (let i = 0; i < 10; i++) await act(() => tick(20));
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    expect(seen.toasts).toEqual([t('importLock.damaged')]);
    expect(seen.dialogs).toBe(1);
    expect(isOpen('modalConfirm')).toBe(false);
    expect(JSON.stringify(live())).toBe(before);
  });

  it('finding 6b (final review 1): in Bulk, a damaged or an older-lock file says why — importLock.damaged / importLock.old, never "unreadable" or "locked"', async () => {
    const entries = [fileOf(damagedLock(), 'damaged.docx', DOCX_TYPE), fileOf(olderLock(), 'standard.docx', DOCX_TYPE)].map((file) => ({ file, path: file.name }));
    const prepared = new Promise<Rec>((res) => bulk().bulkPrepareEntries(entries, null, res));
    await asked(); // the damaged one asks (its verifier is sound); the older lock never does
    await typeAndOpen(PW);
    const items = (await prepared).items as Rec[];
    expect(items.map((x) => [x.name, x.error])).toEqual([['damaged.docx', 'lockDamaged'], ['standard.docx', 'lockOld']]);
    expect(seen.dialogs).toBe(1);
    document.body.insertAdjacentHTML('beforeend', '<div id="bulkSummary" style="display:none"></div>');
    bulk().renderBulkSummary({ added: [], skipped: [], failed: items.map((x) => ({ name: x.name, reason: x.error })), vault: false, total: 2 });
    const rows = Array.from($('bulkSummary').querySelectorAll('li')).map((li) => li.textContent);
    expect(rows).toEqual(['damaged.docx — ' + t('importLock.damaged'), 'standard.docx — ' + t('importLock.old')]);
    expect($('bulkSummary').textContent).not.toContain(t('bulk.reasonUnreadable'));
    expect($('bulkSummary').textContent).not.toContain(t('bulk.locked'));
  });

  it('finding 6c: Escape on the password dialog above the export modal closes only the dialog', async () => {
    await studioWith(LANTERN());
    await click($('btnExport'));
    await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
    const input = inp('boxSetFileInput');
    Object.defineProperty(input, 'files', { value: [docx('agile-sha512.docx')], configurable: true });
    await act(async () => void fireEvent.change(input));
    await asked();
    await waitFor(() => expect(document.activeElement).toBe($('passwordAskField')));
    await act(async () => void fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    await waitFor(() => expect(document.getElementById('modalPasswordAsk')).toBeNull());
    await waitFor(() => expect(seen.toasts).toContain('Could not add agile-sha512.docx: ' + t('bulk.locked')), { timeout: 20_000 });
    for (let i = 0; i < 10; i++) await act(() => tick(20));
    expect(isOpen('modalExport')).toBe(true);
  });
});

describe('final review fixes', { timeout: 180_000 }, () => {
  /** `f`, its every read recorded: the buffer each arrayBuffer() handed back */
  const counted = (f: File) => {
    const reads: ArrayBuffer[] = [];
    const real = f.arrayBuffer.bind(f);
    Object.defineProperty(f, 'arrayBuffer', { configurable: true, value: async () => { const b = await real(); reads.push(b); return b; } });
    return reads;
  };
  /** pdf.js with each getDocument's `data` buffer recorded as it was given (pdf.js may hand it to its worker after) */
  async function withGetDocumentSeen(run: (given: ArrayBufferLike[]) => Promise<void>) {
    const real = g.pdfjsLib as Rec & { getDocument: (p: Rec) => unknown };
    const given: ArrayBufferLike[] = [];
    g.pdfjsLib = { ...real, getDocument: (p: Rec) => (given.push((p.data as Uint8Array).buffer), real.getDocument(p)) };
    try { await run(given); } finally { g.pdfjsLib = real; }
  }

  it('finding 2: an unlocked PDF is read once and that one buffer goes to pdf.js — no second copy', async () => {
    await withGetDocumentSeen(async (given) => {
      await studioWith(LANTERN());
      const f = pdf('plain.pdf');
      const reads = counted(f);
      await choose(f);
      await replaceYes();
      expect(seen.dialogs).toBe(0);
      expect(JSON.stringify(live())).toContain('The Harbour');
      expect(reads.length).toBe(1);
      expect(given.length).toBe(1);
      expect(given[0] === reads[0]).toBe(true);
    });
  });

  it('finding 2: a locked PDF re-reads the File for each attempt (first, wrong, right); each read goes to pdf.js as it is', async () => {
    await withGetDocumentSeen(async (given) => {
      await studioWith(LANTERN());
      const f = pdf('aes-256.pdf');
      const reads = counted(f);
      await choose(f);
      await asked();
      await typeAndOpen('not it');
      await waitFor(() => expect($('passwordAskErr').textContent).toBe(t('importLock.wrong')), { timeout: 30_000 });
      await typeAndOpen(PW);
      await replaceYes();
      expect(JSON.stringify(live())).toContain('The Harbour');
      expect(reads.length).toBe(3);
      expect(given.length).toBe(3);
      expect(given.map((b, i) => b === reads[i])).toEqual([true, true, true]);
    });
  });

  it('finding 3: day 22 (data-plan-access=paused) — a locked file still asks and imports', async () => {
    try {
      await studioWith(LANTERN());
      document.documentElement.setAttribute('data-plan-access', 'paused');
      expect(((c.api as unknown as Rec).lockCopyAllowed as () => boolean)()).toBe(false); // the lock family's own gate reads it as paused
      await choose(docx('agile-sha512.docx'));
      await asked();
      await typeAndOpen(PW);
      await replaceYes();
      expect(document.getElementById('modalPasswordAsk')).toBeNull();
      onlyImported('agile-sha512.docx');
      expect(seen.dialogs).toBe(1);
    } finally {
      document.documentElement.removeAttribute('data-plan-access');
    }
  });

  it("finding 4: Beuk's own locked PDF (lockPdfBytes, R6) over plain.pdf comes back: a wrong password keeps the dialog, the right one brings the text", async () => {
    const pw = 'beuk own lock';
    const locked = await c.api.lockPdfBytes(fx('plain.pdf'), pw);
    const deskBook = LANTERN();
    await studioWith(deskBook);
    await choose(fileOf(locked, 'review-copy.pdf', 'application/pdf'));
    await asked();
    await typeAndOpen('not it');
    await waitFor(() => expect($('passwordAskErr').textContent).toBe(t('importLock.wrong')), { timeout: 30_000 });
    expect(isOpen('modalPasswordAsk')).toBe(true);
    await typeAndOpen(pw);
    await replaceYes();
    expect(document.getElementById('modalPasswordAsk')).toBeNull();
    expect(seen.dialogs).toBe(1);
    // the text: the same sections 1.0 makes of the plain PDF. (Only the sections: plain.pdf's /Info is a dictionary
    // written inline in its trailer, and lockPdfBytes carries an /Info across only when it is an indirect reference, so
    // the locked copy has no Title / Author for the import to read — premium 1's writer, reported, not this import's.)
    const want = await oracleBook(deskBook, pdf('plain.pdf', 'review-copy.pdf'));
    const got = maskVarying(live()) as Rec;
    expect(got.sections).toEqual((maskVarying(want) as Rec).sections);
    expect(JSON.stringify(got.sections)).toContain('The Harbour');
  });

  it('finding 5: importPdfData(name, data, {password}) — right opens, wrong is refused, none is refused with pdf.password', async () => {
    const o = await createImportOracle(t, { mammoth: g.mammoth, pdfLoadLib: async () => g.pdfjsLib });
    o.api.applyBookDoc(structuredClone(LANTERN()) as never);
    const importData = o.api.importPdfData as unknown as (name: string, data: Uint8Array, opts?: Rec) => Promise<Rec>;
    const none = await importData('aes-256.pdf', fx('aes-256.pdf'));
    expect([none.ok, none.why, none.message]).toEqual([false, 'password', t('pdf.password')]);
    const wrong = await importData('aes-256.pdf', fx('aes-256.pdf'), { password: 'not it' });
    expect([wrong.ok, wrong.why]).toEqual([false, 'password']);
    const right = await importData('aes-256.pdf', fx('aes-256.pdf'), { password: PW });
    expect(right.ok).toBe(true);
    expect(JSON.stringify(o.api.serializeBook())).toContain('The Harbour');
  });
});

describe("the dialog's words in every interface language (task 2)", () => {
  it('the six keys stand in all 13 packs, each one its own', async () => {
    const keys = ['importLock.title', 'importLock.lead', 'importLock.wrong', 'importLock.old', 'importLock.damaged', 'bulk.locked'];
    const dir = path.join(import.meta.dirname, '..', 'src', 'generated', 'packs');
    const langs = ['en', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru', 'tr', 'zh-Hans'];
    for (const l of langs) {
      const pack = JSON.parse(readFileSync(path.join(dir, l + '.json'), 'utf8')) as Record<string, string>;
      for (const k of keys) {
        expect(typeof pack[k], l + ' ' + k).toBe('string');
        if (l !== 'en') expect(pack[k], l + ' ' + k).not.toBe((en as Record<string, string>)[k]);
      }
      expect(pack['importLock.lead'], l).toContain('{name}');
    }
    expect((en as Record<string, string>)['importLock.wrong']).toBe("That password doesn't open this file");
    expect((en as Record<string, string>)['bulk.locked']).toBe("Left out — it's locked and no password was given");
  });
});
