import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import markup from '../src/generated/import-markup.json';
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
import { hazards } from './hazards';
import { maskVarying, textCorpus } from './import-fixture';
import { createImportOracle, type Oracle } from './import-oracle';
import { createRequire } from 'node:module';
import { loadMammoth } from './vendor';
// @ts-expect-error — a plain .mjs module, no types
import { docxCorpus } from '../e2e/import-corpus.mjs';
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js');
loadMammoth();

/* Wave 6, tasks 2 and 3 (G1, G2; constraints 77–80, decisions 4, 5, 7): 1.0's Import button and its report in the studio.
   - The sidebar's Import Document is 1.0's #btnImport, wired by 1.0's own initImport: it opens 1.0's #fileInput (1.0's
     accept list); the file chosen goes through 1.0's handleImportFile: on a written book 1.0's confirm first (its words),
     then the book is replaced whole (a new generation), History holding the "import" snapshot.
   - 1.0's "Recognised in your manuscript" summary under the button, and its close; another book opening hides it.
   - The report (#modalImportReport, 1.0's markup) opens over the new book, on the dialog stack; each per-item undo, Undo
     the whole import, Dismiss and Keep all give the book 1.0's own code gives (the oracle, test/import-oracle.ts); the
     reopen button follows the book's report.
   - The report's HTML (through the cleaner) holds no script, handler or remote source for a hostile manuscript. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
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
const LANTERN = 'real/lantern-coast-book-one';
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
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
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((x) => x.textContent === label) as HTMLElement | undefined;
/** The open book as the device would back it up (exportBook of the live generation). */
const live = () => exportBook(desk.ydoc!) as Rec;
async function settle() {
  for (let i = 0; i < 4; i++) await act(() => tick(5));
  const p = importPending();
  if (p) await act(() => p);
  for (let i = 0; i < 3; i++) await act(() => tick(5));
}
/** The file chosen in 1.0's #fileInput (as the browser fires change), the confirm answered when it comes. */
async function choose(file: File, answer: 'yes' | 'no' | null) {
  const input = $('fileInput') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => void fireEvent.change(input));
  if (answer) {
    await waitFor(() => expect(document.body.textContent).toContain(t('import.replaceTitle')));
    await click(button(answer === 'yes' ? t('import.replaceYes') : t('import.replaceNo'))!);
  }
  await settle();
}
const fileOf = (name: string) => {
  const f = textCorpus().find((x) => x.name === name)!;
  return new File([f.text], f.name, { type: f.type });
};
async function oracleImport(deskBook: Rec, file: File): Promise<Oracle> {
  const o = await createImportOracle(t, { mammoth: (globalThis as Rec).mammoth });
  o.api.applyBookDoc(structuredClone(deskBook) as never);
  const run = (await o.api.readImportFile(file as never)) as () => void;
  run();
  return o;
}
const ser = (o: Oracle) => JSON.parse(JSON.stringify(o.api.serializeBook())) as Rec;
const stored = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;

describe("wave 6: 1.0's Import button, the replace and the summary (task 2)", () => {
  it("Import Document is 1.0's: wired, it opens 1.0's #fileInput with 1.0's accept list; one Import button", async () => {
    await studioWith(book(LANTERN));
    expect(document.querySelectorAll('#btnImport').length).toBe(1);
    expect(($('fileInput') as HTMLInputElement).accept).toBe(/accept="([^"]*)"/.exec(markup.fileInput)![1]);
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await click($('btnImport'));
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.instances[0]).toBe($('fileInput'));
  });

  it("a manuscript onto a written book: 1.0's confirm, then 1.0's book whole (History's import snapshot), the summary, the report", async () => {
    const deskBook = book(LANTERN);
    await studioWith(deskBook);
    const old = live();
    const oldDoc = desk.ydoc;
    // cancelled: nothing changes
    await choose(fileOf('plain-manuscript.txt'), 'no');
    expect(desk.ydoc).toBe(oldDoc);
    expect(live()).toEqual(old);
    expect($('importSummary').style.display).toBe('none');
    // accepted
    await choose(fileOf('plain-manuscript.txt'), 'yes');
    expect(desk.ydoc).not.toBe(oldDoc);
    const o = await oracleImport(deskBook, fileOf('plain-manuscript.txt'));
    expect(maskVarying(live())).toEqual(maskVarying(stored(ser(o))));
    const h = (live().history as Rec[])[0]!;
    expect(h.auto).toBe('import');
    // the summary: 1.0's words, as 1.0's renderImportSummary wrote them
    expect($('importSummary').style.display).toBe('');
    expect(c.vars.lastImportFound.length).toBeGreaterThan(0);
    expect($('importSummaryText').textContent).toBe(c.vars.lastImportFound.join(' · '));
    expect(c.vars.lastImportFound).toContain(t('import.chaptersCount', { n: 2 }));
    expect($('importSummary').textContent).toContain(t('import.recognised'));
    // the report, open over the new book, on the dialog stack; the reopen button shown
    expect($('modalImportReport').classList.contains('open')).toBe(true);
    expect($('irSub').textContent).toContain('plain-manuscript.txt');
    expect($('irReopen').style.display).toBe('');
    // its close; then the summary's close
    await click($('btnIrClose'));
    expect($('modalImportReport').classList.contains('open')).toBe(false);
    await click($('btnImportSummaryClose'));
    expect($('importSummary').style.display).toBe('none');
    // the reopen button opens it again
    await click($('btnIrReopen'));
    expect($('modalImportReport').classList.contains('open')).toBe(true);
  }, 60_000);

  it('onto an empty desk: no confirm; the summary hides when another book opens (1.0 applyBookDoc)', async () => {
    await studioWith(c.api.buildEmptyBook() as Rec);
    await choose(fileOf('frontmatter.md'), null);
    expect((live().meta as Rec).title).toBe('The Salt Road');
    expect($('importSummary').style.display).toBe('');
    // another book opens (a backup)
    await click($('localPillBtn'));
    const input = $('localBackupInput') as HTMLInputElement;
    const other = book('real/salt-road-book-one');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '', book: other })], 'b.json')] });
    await act(async () => void fireEvent.change(input));
    await waitFor(() => expect(document.body.textContent).toContain(t('local.backupConfirmTitle')));
    await click(button(t('local.backupConfirmYes'))!);
    await waitFor(() => expect((live().meta as Rec).title).toBe((other.meta as Rec).title), { timeout: 20_000 });
    await settle();
    expect($('importSummary').style.display).toBe('none');
    // the backup carries no report: the reopen button goes
    expect($('irReopen').style.display).toBe('none');
  }, 60_000);
});

describe("wave 6: the import report (task 3, constraint 79)", () => {
  for (const name of ['plain-manuscript.txt', 'picture-table.docx'])
  it(`${name}: every reversible item's undo gives 1.0's book; then Undo the whole import gives 1.0's book back`, async () => {
    const deskBook = book(LANTERN);
    await studioWith(deskBook);
    const file = async () => {
      if (!name.endsWith('.docx')) return fileOf(name);
      const d = ((await docxCorpus((globalThis as Rec).JSZip)) as { name: string; bytes: Uint8Array }[]).find((x) => x.name === name)!;
      return new File([d.bytes as BlobPart], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    };
    await choose(await file(), 'yes');
    const o = await oracleImport(deskBook, await file());
    const repO = o.getState().importReport as { items: Rec[] };
    const rep2 = () => live().importReport as { items: Rec[] };
    expect(rep2().items.map((x) => x.kind)).toEqual(repO.items.map((x) => x.kind));
    const reversible = repO.items.map((x, i) => [x, i] as const).filter(([x]) => x.reversible);
    expect(reversible.length).toBeGreaterThan(0);
    for (const [itO, i] of reversible) {
      const id2 = String(rep2().items[i]!.id);
      const btn = document.querySelector(`#irBody [data-irundo="${id2}"]`);
      if (btn) btn.closest('details')?.setAttribute('open', '');
      expect(btn, `item ${i} (${itO.kind}) has 1.0's undo button`).not.toBeNull();
      await click(btn);
      await settle();
      o.api.irUndoItem(String(itO.id) as never);
      expect(maskVarying(live()), `after undoing item ${i} (${itO.kind})`).toEqual(maskVarying(stored(ser(o))));
    }
    // Undo the whole import (by its snapshot): 1.0's confirm, then the book before the import
    const before = live();
    await click($('btnIrUndoAll'));
    await waitFor(() => expect(document.body.textContent).toContain(t('ir.confirmUndoAllTitle')));
    await click(button(t('ir.confirmUndoAllYes'))!);
    await settle();
    o.api.irUndoAll();
    // the whole book is 1.0's but for one label: History's own restore (wave 1a, history.ts restoreDoc) takes its
    // "Before restore" snapshot without formatVersion, as every 2.0 History snapshot is taken (1.0's carries it)
    const restoreSnap = (d: Rec) => { const h = (d.history as Rec[]).find((x) => x.auto === 'restore')!; return { doc: (h.doc ?? h.chopDoc) as Rec }; };
    expect('formatVersion' in (restoreSnap(stored(ser(o))).doc as Rec)).toBe(true);
    expect('formatVersion' in (restoreSnap(live()).doc as Rec)).toBe(false);
    const noLabel = (d: Rec) => {
      const x = structuredClone(d);
      delete (restoreSnap(x).doc as Rec).formatVersion;
      return maskVarying(x);
    };
    expect(noLabel(live())).toEqual(noLabel(stored(ser(o))));
    expect(live().importReport).toBeNull();
    expect(live()).not.toEqual(before);
    expect((live().meta as Rec).title).toBe((deskBook.meta as Rec).title);
    expect($('modalImportReport').classList.contains('open')).toBe(false);
    expect($('irReopen').style.display).toBe('none');
  }, 120_000);

  it("Undo the whole import onto an empty desk (its kept copy) and Dismiss give 1.0's books; Keep all closes and keeps", async () => {
    const empty = c.api.buildEmptyBook() as Rec;
    await studioWith(empty);
    await choose(fileOf('headings.rtf'), null);
    let o = await oracleImport(empty, fileOf('headings.rtf'));
    expect(maskVarying(live())).toEqual(maskVarying(stored(ser(o))));
    await click($('btnIrKeep'));
    await settle();
    o.getState().importReport && Object.assign(o.getState().importReport as Rec, { kept: true });
    expect(maskVarying(live())).toEqual(maskVarying(stored(ser(o))));
    expect($('modalImportReport').classList.contains('open')).toBe(false);
    // Dismiss: 1.0's confirm, then no report
    await click($('btnIrReopen'));
    await click($('btnIrDismiss'));
    await waitFor(() => expect(document.body.textContent).toContain(t('ir.confirmDismissTitle')));
    await click(button(t('ir.confirmDismissYes'))!);
    await settle();
    o.api.irDismiss();
    expect(maskVarying(live())).toEqual(maskVarying(stored(ser(o))));
    expect($('irReopen').style.display).toBe('none');
    // a fresh import onto the same kind of desk, undone whole: its kept copy (preDoc)
    cleanup();
    desk.ydoc = null;
    await studioWith(empty);
    await choose(fileOf('unicode.rtf'), null);
    o = await oracleImport(empty, fileOf('unicode.rtf'));
    await click($('btnIrUndoAll'));
    await waitFor(() => expect(document.body.textContent).toContain(t('ir.confirmUndoAllTitle')));
    await click(button(t('ir.confirmUndoAllYes'))!);
    await settle();
    o.api.irUndoAll();
    expect(maskVarying(live())).toEqual(maskVarying(stored(ser(o))));
  }, 120_000);

  it('a hostile manuscript: the report and the summary hold no script, handler or remote source; nothing ran', async () => {
    await studioWith(c.api.buildEmptyBook() as Rec);
    const evil =
      '---\ntitle: "<img src=x onerror=window.__pw=1>‮Title​"\nauthor: "<script>window.__pw=2</script>"\n---\n\n# Chapter <svg onload=window.__pw=3><script>window.__pw=4</script></svg>\n\n' +
      '"Quote" -- <a href="javascript:window.__pw=5">link</a> <img src="https://evil.example/x.png" onerror="window.__pw=6">\n\n***\n\n# <iframe src=//evil.example></iframe> Two\n\nText...\n';
    await choose(new File([evil], 'evil.md', { type: 'text/markdown' }), null);
    expect((window as unknown as { __pw?: unknown }).__pw).toBeUndefined();
    for (const id of ['modalImportReport', 'importSummary', 'irReopen']) expect(hazards($(id).outerHTML), id).toEqual([]);
  }, 60_000);
});
