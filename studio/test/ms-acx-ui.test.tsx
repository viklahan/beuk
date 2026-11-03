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
import { readBook } from '../../src/book/read';
import { fixtures } from './fixtures';
import { hostileExportBook } from './export-fixture';

/* Wave 5c, task 3 (inventory F5, F6): 1.0's submission manuscript and ACX audio script in the studio — their sections in
   the export modal where 1.0 has them, their dialogs (#modalManuscript, #modalAcx) verbatim, wired by 1.0's own msInit
   and acxInit, drawn by msRender and acxRender (through the cleaner), every event in the export session. A field
   changed is 1.0's state.manuscript / state.audio in the book; put back, the book is as it was (constraint 68); the
   readiness checks, Listen and closing write nothing. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js'); // its UMD sets the global JSZip
const JSZip = (globalThis as unknown as { JSZip: { loadAsync: (b: ArrayBuffer | Uint8Array) => Promise<{ files: Record<string, { dir: boolean; async: (t: string) => Promise<unknown> }> }> } }).JSZip;
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
  await waitFor(() => expect(got.length, toasts().join(' / ')).toBeGreaterThanOrEqual(n), { timeout: 30_000 });
  sp.forEach((s) => s.mockRestore());
  return got;
}
async function backup(): Promise<Rec> {
  const d = await downloads(() => click($('btnLocalBackup')));
  return (JSON.parse(await d[0]!.blob.text()) as { book: Rec }).book;
}
const want = (doc: Rec) => JSON.parse(JSON.stringify(readBook(doc).book)) as Rec;
async function entries(data: Blob | Uint8Array): Promise<Record<string, unknown>> {
  const z = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data);
  const out: Record<string, unknown> = {};
  for (const [p, f] of Object.entries(z.files)) {
    if (f.dir) continue;
    if (/\.docx$/.test(p)) out[p] = await entries((await f.async('uint8array')) as Uint8Array);
    else out[p] = await f.async('string');
  }
  return out;
}
/** Type into one of 1.0's fields as a writer does: input events, then the change. */
async function type(el: HTMLElement, value: string) {
  await act(async () => {
    (el as HTMLInputElement).value = value;
    fireEvent.input(el);
    fireEvent.change(el);
  });
}

describe('the submission manuscript and the ACX script in the studio (F5, F6)', { timeout: 120_000 }, () => {
  it("their sections stand where 1.0 has them, with 1.0's words; each opens its own dialog (the export modal closes), Escape closes it", async () => {
    await studioWith(book('real/lantern-coast-book-one'));
    await openExport();
    for (const id of ['btnMsOpen', 'btnAcxOpen']) expect(($(id).closest('.fmt-sec') as HTMLElement).style.display, id).toBe('');
    expect($('btnMsOpen').textContent).toBe(t('ms.open'));
    expect($('btnAcxOpen').textContent).toBe(t('acx.open'));
    const order = Array.from(document.querySelectorAll('#modalExport .fmt-sec h3')).map((h) => h.getAttribute('data-i18n'));
    expect(order.slice(order.indexOf('exp.docxH'), order.indexOf('exp.docxH') + 4)).toEqual(['exp.docxH', 'ms.secH', 'acx.secH', 'exp.printH']);
    // one control, one meaning: each label once in the studio
    for (const k of ['ms.open', 'acx.open', 'ms.download', 'acx.download']) expect(document.querySelectorAll(`[data-i18n="${k}"]`).length, k).toBe(1);
    await click($('btnMsOpen'));
    expect([isOpen('modalExport'), isOpen('modalManuscript')]).toEqual([false, true]);
    expect($('msH').textContent).toBe(t('ms.title'));
    expect(($('msLegal') as HTMLInputElement).value).toBe('');
    expect($('msTitlePage').textContent).toContain(String((book('real/lantern-coast-book-one').meta as Rec).title).toLocaleUpperCase('en'));
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    expect(isOpen('modalManuscript')).toBe(false);
    await openExport();
    await click($('btnAcxOpen'));
    expect([isOpen('modalExport'), isOpen('modalAcx')]).toEqual([false, true]);
    expect($('acxH').textContent).toBe(t('acx.title'));
    expect($('acxFiles').querySelectorAll('tbody tr').length).toBe(exportRun((cc) => cc.api.acxBuildPlan().files.length));
    await click($('btnAcxClose'));
    expect(isOpen('modalAcx')).toBe(false);
  });

  it("the manuscript: a field typed is 1.0's state.manuscript in the book; the download is 1.0's file; every field put back, the book is as it was", async () => {
    const doc = book('real/lantern-coast-book-one');
    await studioWith(doc);
    await openExport();
    await click($('btnMsOpen'));
    await type($('msLegal'), 'Ada Quill');
    await type($('msEmail'), 'ada@example.org');
    await act(async () => {
      ($('msPaper') as HTMLSelectElement).value = 'a4';
      fireEvent.change($('msPaper'));
    });
    expect($('msTitlePage').textContent).toContain('Ada Quill');
    let out = await backup();
    expect([(out.manuscript as Rec).legalName, (out.manuscript as Rec).email, (out.manuscript as Rec).paper]).toEqual(['Ada Quill', 'ada@example.org', 'a4']);
    expect(Object.keys(out)).toEqual(Object.keys(want(doc)));
    const files = exportRun((cc) => Object.fromEntries(cc.api.msFiles(cc.api.msPlan()).map((f) => [f.path, f.content])))!;
    const d = await downloads(() => click($('btnMsDownload')));
    expect(d.map((x) => x.name)).toEqual([c.api.slug((doc.meta as Rec).title) + '-manuscript.docx']);
    expect(d[0]!.blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(await entries(d[0]!.blob)).toEqual(files);
    const mp = exportRun((cc) => cc.api.msPlan())!;
    await waitFor(() => expect(toasts()).toContain(t('ms.done', { sections: c.api.fmtNum(mp.body.length), words: c.api.fmtNum(mp.rounded) })));
    await type($('msLegal'), '');
    await type($('msEmail'), '');
    await act(async () => {
      ($('msPaper') as HTMLSelectElement).value = 'letter';
      fireEvent.change($('msPaper'));
    });
    out = await backup();
    expect(out).toEqual(want(doc));
  });

  it("the ACX script: the readiness checks, Listen and closing write nothing; the narrator, a section switched off and on, the format and a pronunciation are 1.0's state.audio; the zip is 1.0's; put back, the book is as it was", async () => {
    const doc = book('real/lantern-coast-book-one');
    await studioWith(doc);
    await openExport();
    await click($('btnAcxOpen'));
    // the readiness checks as 1.0 shows them: the plan's warnings, the file table, the sample, the guide
    const plan = exportRun((cc) => cc.api.acxBuildPlan())!;
    expect($('acxWarnings').querySelectorAll('li').length).toBe(plan.warnings.length + 1);
    expect($('acxWarnings').textContent).toContain(t('acx.warn.noNarrator'));
    const listen = document.querySelector('[data-acxlisten]');
    if (listen) await click(listen);
    await click($('btnAcxClose'));
    expect(await backup()).toEqual(want(doc));
    await openExport();
    await click($('btnAcxOpen'));
    await type($('acxNarrator'), 'Rae North');
    expect($('acxWarnings').textContent).not.toContain(t('acx.warn.noNarrator'));
    await act(async () => {
      ($('acxFormat') as HTMLSelectElement).value = 'txt';
      fireEvent.change($('acxFormat'));
    });
    const first = document.querySelector<HTMLInputElement>('[data-acxinc]')!;
    const secId = first.getAttribute('data-acxinc')!;
    await act(async () => {
      first.checked = false;
      fireEvent.change(first);
    });
    let out = await backup();
    expect([(out.audio as Rec).narrator, (out.audio as Rec).format, ((out.audio as Rec).include as Rec)[secId]]).toEqual(['Rae North', 'txt', false]);
    expect(Object.keys(out)).toEqual(Object.keys(want(doc)));
    const zipFiles = exportRun((cc) => cc.api.acxZipEntries(cc.api.acxBuildPlan()))!;
    const d = await downloads(() => click($('btnAcxDownload')));
    expect(d.map((x) => x.name)).toEqual([c.api.slug((doc.meta as Rec).title) + '-audio-script.zip']);
    expect(d[0]!.blob.type).toBe('application/zip');
    const got = await entries(d[0]!.blob);
    expect(Object.keys(got)).toEqual(zipFiles.map((e) => e.path));
    for (const e of zipFiles) expect(got[e.path], e.path).toEqual('text' in e ? e.text : Object.fromEntries(e.docx.map((f) => [f.path, f.content])));
    await waitFor(() => expect(toasts()).toContain(t('acx.done', { n: exportRun((cc) => cc.api.acxBuildPlan().files.length) })));
    // put back: the narrator emptied, the format both, the section on again ("Narrate anyway")
    await type($('acxNarrator'), '');
    await act(async () => {
      ($('acxFormat') as HTMLSelectElement).value = 'both';
      fireEvent.change($('acxFormat'));
    });
    await click(document.querySelector(`[data-acxon="${secId}"]`));
    out = await backup();
    // 1.0's own "Narrate anyway" writes include[id] = true: a switch, not the absence it started from (1.0's shape)
    expect(((out.audio as Rec).include as Rec)[secId]).toBe(true);
    expect({ ...out, audio: { ...(out.audio as Rec), include: {} } }).toEqual({ ...want(doc), audio: { ...(want(doc).audio as Rec), include: {} } });
  });

  it("a hostile book's dialogs: 1.0's HTML through the cleaner — no handler, script, remote source or javascript: address in either", async () => {
    await studioWith(hostileExportBook());
    await openExport();
    await click($('btnMsOpen'));
    await type($('msLegal'), '<img src=x onerror="window.__pw=1">');
    const bad = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('*')).flatMap((el) => [
        ...(/^(script|iframe|object|embed|style|link)$/i.test(el.tagName) ? [el.tagName] : []),
        ...Array.from(el.attributes).filter((a) => /^on/i.test(a.name) || /javascript:/i.test(a.value) || (a.name === 'src' && !/^data:/.test(a.value))).map((a) => el.tagName + ' ' + a.name),
      ]);
    expect(bad($('modalManuscript'))).toEqual([]);
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    await openExport();
    await click($('btnAcxOpen'));
    await type($('acxNarrator'), '"><img src=x onerror="window.__pw=2">');
    expect(bad($('modalAcx'))).toEqual([]);
    expect((window as unknown as { __pw?: unknown }).__pw).toBeUndefined();
  });
});
