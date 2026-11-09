import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { closureShare, cloudFacts, fmtDateIntl, loadClosure, resetCloudFacts, setClosureLang, setClosureT, type Closure, type State } from '../src/closure/index';
import { createOracle } from '../src/generated/closure-oracle.js';
import { arriveForExport } from '../src/export/state';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { fixtures } from './fixtures';

/* Final fix I3 (BEUK:authorship): 1.0's own save-popover glue, run on 1.0's own markup. client/index.html's
   localBackupWire (localInit's backup buttons), localExportBackup, localOpenBackupFile and toggleLocalPop are lifted
   into the test oracle (studio/scripts/extract-closure.mjs ORACLE_ROOTS, src/generated/closure-oracle.js); everything
   they reach of 1.0 is the main closure's own (the lock box, the backup's text, the reader, the password dialog, the
   opened note), and what they reach outside 1.0's code is handed in here: the book (serializeBook), its download, the
   toast, the calm confirm and the arrival on the desk (applyBookDoc). Running 1.0's whole page in jsdom is not done:
   the root has no jsdom (only studio/ installs it), and 1.0's boot (service worker, IndexedDB restore, fonts, the
   73 000-line script) is far past what these six behaviours need. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const REPO = path.join(import.meta.dirname, '..', '..') + path.sep;
const HTML = readFileSync(REPO + 'client/index.html', 'utf8');
/** 1.0's save-popover markup, exactly as client/index.html has it (between its BEUK:local markers in the header). */
const POPOVER = (() => {
  const a = HTML.indexOf('<!-- ==== BEUK:local ==== -->'), b = HTML.indexOf('<!-- ==== /BEUK:local ==== -->', a);
  if (a < 0 || b < 0) throw new Error('client/index.html: the BEUK:local markup markers are gone');
  return HTML.slice(a, b);
})();
const book = (name: string) => structuredClone(fixtures('real').find((f) => f.name === name)!.book) as Rec;
const LANTERN = () => book('real/lantern-coast-book-one');
const KITCHENS = () => book('real/four-kitchens-book-one');
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const inp = (id: string) => document.getElementById(id) as HTMLInputElement;
const tick = () => new Promise<void>((r) => setImmediate(r));
async function until(ok: () => boolean, what: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});

type Page = {
  o: Record<string, (...a: any[]) => any>;
  downloads: { blob: Blob; name: string }[];
  toasts: string[];
  confirms: Rec[];
  applied: Rec[];
  answers: boolean[];
  state: State & Rec;
};
let page: Page;
/** 1.0's popover on the page, 1.0's state of `deskDoc` in the closure, and 1.0's glue wired (localBackupWire). */
function open1(deskDoc: Rec): Page {
  document.body.innerHTML = '<header>' + POPOVER + '</header>';
  const state = arriveForExport(c, deskDoc) as State & Rec;
  c.setState(state);
  const p = { downloads: [], toasts: [], confirms: [], applied: [], answers: [], state } as unknown as Page;
  p.o = createOracle(closureShare()!, {
    $: (id: string) => document.getElementById(id),
    icons: () => undefined,
    document,
    serializeBook: () => structuredClone({ meta: state.meta, sections: state.sections }),
    downloadBlob: (blob: Blob, name: string) => void p.downloads.push({ blob, name }),
    samplePicsHold: () => false,
    toast: (msg: string) => void p.toasts.push(msg),
    cloudConfirm: (o: Rec) => (p.confirms.push(o), Promise.resolve(p.answers.shift() ?? false)),
    FileReader: globalThis.FileReader,
    applyBookDoc: (doc: Rec) => {
      p.applied.push(doc);
      state.meta = doc.meta as State['meta'];
      state.sections = doc.sections as State['sections'];
      return true;
    },
    autoSnapshot: () => null,
    noteBookEdited: () => undefined,
    renderSampleButton: () => undefined,
    deskIsUntouchedSample: () => false,
    authorshipRecordOpen: () => undefined,
  });
  p.o.localBackupWire!();
  return p;
}
const click = (id: string) => $(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
function tickLock(pw: string, pw2 = pw) {
  inp('lockBackupOn').checked = true;
  inp('lockBackupOn').dispatchEvent(new Event('change', { bubbles: true }));
  inp('lockBackupPw').value = pw;
  inp('lockBackupPw2').value = pw2;
}
function pick(text: string) {
  const input = inp('localBackupInput');
  Object.defineProperty(input, 'files', { value: [new File([text], 'x.beuk-backup.json', { type: 'application/json' })], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => resetCloudFacts()); // signed out: no stamp, no check
afterEach(() => {
  document.getElementById('modalBackupPw')?.remove();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-plan-access');
});

describe("1.0's save-popover glue (BEUK:authorship, final fix I3)", { timeout: 120_000 }, () => {
  it('Export a backup with the lock ticked: the locked envelope downloads, the popover closes, the fields are emptied', async () => {
    page = open1(LANTERN());
    page.o.toggleLocalPop!(true);
    expect($('localPop').hidden).toBe(false);
    tickLock('harbour pw');
    click('btnLocalBackup');
    expect($('localPop').hidden).toBe(true); // localExportBackup said yes: 1.0's listener closed it
    await until(() => page.downloads.length === 1, 'the download');
    const env = JSON.parse(await page.downloads[0]!.blob.text()) as Rec;
    expect(env.format).toBe('beuk-backup-locked');
    expect(page.downloads[0]!.name).toMatch(/\.beuk-backup\.json$/);
    const r = (await c.api.backupRead(await c.api.backupUnlock(env, 'harbour pw'))) as Rec;
    expect(r.intact).toBe(true);
    expect(((r.book as Rec).meta as Rec).title).toBe((LANTERN().meta as Rec).title);
    expect([inp('lockBackupPw').value, inp('lockBackupPw2').value]).toEqual(['', '']);
  });

  it('final fix M3: Export a backup and the inline offer are disabled until the download has happened — a double click makes one file and one stamp', async () => {
    const posts: string[] = [];
    let answer: () => void = () => undefined;
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href, 'http://studio.test').pathname !== '/api/authorship/stamps') return real(input, init);
      posts.push(String(init?.body ?? ''));
      // held until the test answers: the download waits on the stamp
      return new Promise<Response>((res) => (answer = () => res(new Response(JSON.stringify({ id: 's-1', createdAt: '2026-11-09T00:00:00.000Z' }), { status: 201, headers: { 'content-type': 'application/json' } }))));
    });
    try {
      cloudFacts.user = { id: 'u-writer', email: 'writer@example.test' };
      page = open1(LANTERN());
      page.o.toggleLocalPop!(true);
      click('btnLocalBackup');
      expect((document.getElementById('btnLocalBackup') as HTMLButtonElement).disabled).toBe(true);
      expect((document.getElementById('btnLocalBackupInline') as HTMLButtonElement).disabled).toBe(true);
      page.o.toggleLocalPop!(true);
      click('btnLocalBackup'); // the double click
      $('btnLocalBackupInline').hidden = false;
      click('btnLocalBackupInline');
      await until(() => posts.length === 1, 'the stamp');
      for (let i = 0; i < 50; i++) await tick();
      expect(page.downloads.length).toBe(0); // still waiting on the stamp
      answer();
      await until(() => page.downloads.length === 1, 'the download');
      for (let i = 0; i < 100; i++) await tick();
      expect(page.downloads.length).toBe(1);
      expect(posts.length).toBe(1);
      expect((document.getElementById('btnLocalBackup') as HTMLButtonElement).disabled).toBe(false);
      expect((document.getElementById('btnLocalBackupInline') as HTMLButtonElement).disabled).toBe(false);
      // and again, once the first has downloaded: a second file
      click('btnLocalBackupInline');
      await until(() => posts.length === 2, 'the second stamp');
      answer();
      await until(() => page.downloads.length === 2, 'the second download');
    } finally {
      spy.mockRestore();
    }
  });

  it('lock mismatch: refused with lock.mismatch, the popover stays open, nothing downloads', async () => {
    page = open1(LANTERN());
    page.o.toggleLocalPop!(true);
    tickLock('one', 'two');
    click('btnLocalBackup');
    for (let i = 0; i < 100; i++) await tick();
    expect(page.downloads).toEqual([]);
    expect($('localPop').hidden).toBe(false);
    expect($('lockBackupErr').hidden).toBe(false);
    expect($('lockBackupErr').textContent).toBe(t('lock.mismatch'));
  });

  it('the inline offer beside a failed save writes the plain backup even with the box ticked', async () => {
    page = open1(LANTERN());
    page.o.toggleLocalPop!(true);
    tickLock('never used');
    page.o.toggleLocalPop!(false);
    inp('lockBackupOn').checked = true; // still ticked (1.0 keeps the tick; a closed popover keeps no password)
    inp('lockBackupPw').value = inp('lockBackupPw2').value = 'never used';
    $('btnLocalBackupInline').hidden = false;
    click('btnLocalBackupInline');
    await until(() => page.downloads.length === 1, 'the download');
    const text = await page.downloads[0]!.blob.text();
    expect((JSON.parse(text) as Rec).format).toBe('beuk-backup');
    expect(((await c.api.backupRead(text)) as Rec).intact).toBe(true);
    expect(text).not.toContain('never used');
  });

  it('Open a locked backup: the password is asked; Cancel leaves the desk unchanged', async () => {
    page = open1(LANTERN());
    const before = JSON.stringify(page.state.sections);
    const locked = await c.api.backupLock((await c.api.backupPayload(KITCHENS(), null)).text, 'kitchen pw');
    pick(locked);
    await until(() => !!document.getElementById('modalBackupPw'), 'the password dialog');
    expect($('backupPwH').textContent).toBe(t('backup.pwTitle'));
    click('btnBackupPwCancel');
    await until(() => !document.getElementById('modalBackupPw'), 'the dialog to close');
    for (let i = 0; i < 50; i++) await tick();
    expect(page.confirms).toEqual([]);
    expect(page.applied).toEqual([]);
    expect(page.toasts).toEqual([]);
    expect(JSON.stringify(page.state.sections)).toBe(before);
  });

  it('Open a changed backup: 1.0 asks; No leaves the desk unchanged', async () => {
    page = open1(LANTERN());
    const before = JSON.stringify(page.state.sections);
    const d = JSON.parse((await c.api.backupPayload(KITCHENS(), null)).text) as { book: { meta: Rec } };
    d.book.meta.title = String(d.book.meta.title) + ' (changed)';
    page.answers.push(false);
    pick(JSON.stringify(d));
    await until(() => page.confirms.length === 1, 'the confirm');
    for (let i = 0; i < 50; i++) await tick();
    expect(page.confirms[0]!.title).toBe(t('backup.changedTitle'));
    expect(page.confirms[0]!.body).toBe(t('backup.changedBody'));
    expect(page.confirms.length).toBe(1); // No: not on to the replace confirm
    expect(page.applied).toEqual([]);
    expect(JSON.stringify(page.state.sections)).toBe(before);
  });

  it('Open an untouched backup (final fix M1): the parts joined with ". " — Backup opened — “X”. Untouched since …', async () => {
    page = open1(LANTERN());
    const kit = KITCHENS();
    const plain = (await c.api.backupPayload(kit, null)).text;
    const savedAt = (JSON.parse(plain) as { authorship: { savedAt: string } }).authorship.savedAt;
    page.answers.push(true);
    pick(plain);
    await until(() => page.toasts.length > 0, 'the toast');
    expect(page.toasts).toEqual([
      t('local.backupOpened', { title: (kit.meta as Rec).title }) + '. ' + t('backup.untouched', { date: fmtDateIntl(new Date(savedAt)) }),
    ]);
    expect(page.toasts[0]).toBe('Backup opened — “' + String((kit.meta as Rec).title) + '”. Untouched since ' + fmtDateIntl(new Date(savedAt)) + '.');
  });

  it("Open an old backup (no authorship block): today's toast, exactly", async () => {
    page = open1(LANTERN());
    const kit = KITCHENS();
    page.answers.push(true); // the replace confirm
    pick(JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-01T00:00:00.000Z', book: kit }));
    await until(() => page.toasts.length > 0, 'the toast');
    for (let i = 0; i < 50; i++) await tick();
    expect(page.confirms.map((x) => x.title)).toEqual([t('local.backupConfirmTitle')]);
    expect(page.applied.length).toBe(1);
    expect(page.toasts).toEqual([t('local.backupOpened', { title: (kit.meta as Rec).title })]);
  });
});
