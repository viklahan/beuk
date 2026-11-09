import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import en from '../src/generated/packs/en.json';
import stringsMeta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { cloudBootHook, cloudFacts, fmtDateIntl, loadClosure, resetCloudFacts, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleReset } from '../src/style/session';
import { exportReset } from '../src/export/state';
import { cloudReset } from '../src/cloud/cloud';
import { resetCloudProbe } from '../src/pictures/stock';
import { exportBook } from '../../src/book/editor/index';
import { fixtures } from './fixtures';
import { parseBackup } from '../src/book/backup';

/* Fix round 1: 2.0's export when the closure is not there (never loaded, or its chunk would not load) — the export
   must still download. Off by default: the closure is the real one. */
const gate = vi.hoisted(() => ({ off: false, loadOff: false }));
vi.mock('../src/closure/index', async (orig) => {
  const m = (await orig()) as typeof import('../src/closure/index');
  return {
    ...m,
    closureIfLoaded: () => (gate.off ? null : m.closureIfLoaded()),
    // final fix I2: loadOff — only loadClosure refuses (the open book's own redraws keep the closure they hold)
    loadClosure: () => (gate.off || gate.loadOff ? Promise.reject(new Error('the closure could not load')) : m.loadClosure()),
  };
});

/* Locked backups and the authorship record (design 2026-11-09), task 3: the studio's half, run in 2.0 as 1.0's own code
   (BEUK:authorship, lifted). "Export a backup" carries the authorship block, is stamped when signed in (4 s at most,
   never failing over it) and is locked when the popover's lock box is on; "Open a backup…" asks a locked backup's
   password, warns when a backup was changed after it was saved, and says "Untouched since …" / "On Beuk's record
   since …"; a Word download stamps the desk's fingerprint; Add a Book asks a locked volume's password; the Authorship
   record lists the stamps and the named readers. The password never leaves the device. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: stringsMeta.pluralForms as PluralForms }, 'en', k, p);
createRequire(import.meta.url)('../../client/assets/vendor/jszip.min.js'); // its UMD sets the global JSZip
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
  resetCloudFacts();
  cloudReset();
  resetCloudProbe();
});
afterEach(async () => {
  gate.off = false;
  gate.loadOff = false;
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  cloudReset();
  resetCloudFacts();
  localStorage.clear();
  document.documentElement.removeAttribute('data-plan-access');
  for (const id of ['modalBackupPw', 'modalAuthorship']) document.getElementById(id)?.remove();
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

const book = (name: string) => structuredClone(fixtures('real').find((f) => f.name === name)!.book) as Rec;
const LANTERN = () => book('real/lantern-coast-book-one');
const KITCHENS = () => book('real/four-kitchens-book-one');
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const inp = (id: string) => document.getElementById(id) as HTMLInputElement;
const click = (el: Element | null) => act(() => void fireEvent.click(el!));
const isOpen = (id: string) => !!document.getElementById(id) && $(id).classList.contains('open');
const toasts = () => Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent || '');
const tick = () => new Promise<void>((r) => setImmediate(r));
async function type(el: HTMLElement, value: string) {
  await act(async () => {
    (el as HTMLInputElement).value = value;
    fireEvent.input(el);
  });
}
const deskBook = () => exportBook(desk.ydoc!) as Rec;
const deskTitle = () => (deskBook().meta as Rec).title;

/** Every request the studio makes: `/api/authorship/*` and the share reads answered by `routes` (by path, without the
 *  query), every other /api path a 404 (no shelf), anything else passed through. */
type Call = { url: string; method: string; body: string };
function stub(routes: Record<string, (u: URL, init?: RequestInit) => Response | Promise<Response>> = {}) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(href, 'http://studio.test');
    if (u.pathname.startsWith('/api/')) {
      calls.push({ url: u.pathname + u.search, method: String(init?.method || 'GET'), body: typeof init?.body === 'string' ? init.body : '' });
      const r = routes[u.pathname];
      if (r) return r(u, init);
      return new Response(JSON.stringify({ error: 'not here' }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  });
  return { calls, spy, stamps: () => calls.filter((x) => x.url === '/api/authorship/stamps' && x.method === 'POST') };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

async function studioWith(doc: Rec) {
  await importToDevice(doc);
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect($('localPill').getAttribute('data-state')).not.toBe('checking'), { timeout: 20_000 });
  await waitFor(() => expect($('btnExport')?.getAttribute('aria-disabled')).toBeNull(), { timeout: 20_000 });
  // the shelf's boot (no shelf here: the probe's 404) has settled before a test signs in
  await waitFor(() => expect(cloudBootHook.p).not.toBeNull(), { timeout: 20_000 });
  await cloudBootHook.p;
}
function signIn(linkedId: string | null = null) {
  cloudFacts.available = true;
  cloudFacts.user = { id: 'u-writer', email: 'writer@example.test' };
  if (linkedId) {
    cloudFacts.linkedId = linkedId;
    cloudFacts.linkState = 'linked';
  }
}
async function openPop() {
  if (!$('localPop').hidden) await click($('localPillBtn'));
  await click($('localPillBtn'));
  await waitFor(() => expect($('localPop').hidden).toBe(false));
}
/** The downloads 1.0's / 2.0's backup and Word buttons start (URL.createObjectURL + a link's click). */
function catchDownloads() {
  const got: { blob: Blob; name: string }[] = [];
  let last: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((last = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (last) got.push({ blob: last, name: this.download });
    }),
  ];
  return { got, off: () => sp.forEach((s) => s.mockRestore()) };
}
async function exportBackup(): Promise<string> {
  const d = catchDownloads();
  try {
    await click($('btnLocalBackup'));
    await waitFor(() => expect(d.got.length).toBe(1), { timeout: 30_000 });
    return await d.got[0]!.blob.text();
  } finally {
    d.off();
  }
}
async function openFile(file: File) {
  const input = inp('localBackupInput');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => void fireEvent.change(input));
}
const fileOf = (text: string, name = 'four-kitchens-2026-11-09.beuk-backup.json') => new File([text], name, { type: 'application/json' });
async function answer(yes: boolean, title: string) {
  await waitFor(() => expect(isOpen('modalConfirm')).toBe(true), { timeout: 20_000 });
  expect($('confirmTitle').textContent).toBe(title);
  await click($(yes ? 'btnConfirmYes' : 'btnConfirmNo'));
  await waitFor(() => expect(document.getElementById('confirmTitle')?.textContent ?? '').not.toBe(title));
}
async function openExport() {
  await click($('btnExport'));
  await waitFor(() => expect(document.querySelectorAll('#platformGrid [data-platform]').length).toBe(11));
}

describe('locked backups and the authorship record: the studio (task 3)', { timeout: 120_000 }, () => {
  it('export unlocked, signed out: no fetch; file parses with backupRead, intact true, recorded null', async () => {
    const net = stub();
    await studioWith(LANTERN());
    await openPop();
    expect($('lockBackup')).toBeTruthy();
    expect(inp('lockBackupOn').checked).toBe(false);
    expect($('lockBackupFields').hidden).toBe(true);
    const before = net.calls.length;
    const text = await exportBackup();
    expect(net.calls.slice(before).filter((x) => x.url.startsWith('/api/authorship'))).toEqual([]);
    const r = (await c.api.backupRead(text)) as Rec;
    expect(r.locked).toBe(false);
    expect(r.intact).toBe(true);
    expect((r.authorship as Rec).recorded).toBeNull();
    expect((JSON.parse(text) as Rec).format).toBe('beuk-backup');
  });

  it('export signed in: one POST /api/authorship/stamps {bookId,title,sha256,kind:"backup"}; file\'s recorded = server createdAt', async () => {
    const at = '2026-11-09T10:11:12.000Z';
    const net = stub({ '/api/authorship/stamps': () => json({ id: 's-1', createdAt: at }, 201) });
    const doc = LANTERN();
    await studioWith(doc);
    signIn();
    await openPop();
    const text = await exportBackup();
    const posts = net.stamps();
    expect(posts.length).toBe(1);
    const body = JSON.parse(posts[0]!.body) as Rec;
    const a = (JSON.parse(text) as { authorship: Rec }).authorship;
    expect(Object.keys(body).sort()).toEqual(['bookId', 'kind', 'sha256', 'title']);
    expect(body).toEqual({ bookId: (doc.meta as Rec).bookId, title: String((doc.meta as Rec).title).trim(), sha256: a.sha256, kind: 'backup' });
    expect(a.recorded).toBe(at);
    expect(((await c.api.backupRead(text)) as Rec).intact).toBe(true);
  });

  it('export with server hanging: file still downloads after ≤ 4.5 s (fake timers) with recorded null; 429 and paused body → recorded null, no toast', async () => {
    let mode: 'hang' | '429' | '402' = 'hang';
    const net = stub({
      '/api/authorship/stamps': () =>
        mode === 'hang'
          ? new Promise<Response>(() => undefined)
          : mode === '429'
            ? json({ error: 'too many authorship stamps in the last hour' }, 429)
            : json({ error: 'paused', paused: true, feature: 'authorship.stamp' }, 402),
    });
    await studioWith(LANTERN());
    signIn();
    await openPop();
    const d = catchDownloads();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await click($('btnLocalBackup'));
      for (let i = 0; i < 2000 && net.stamps().length === 0; i++) await tick();
      expect(net.stamps().length).toBe(1);
      await vi.advanceTimersByTimeAsync(3900);
      for (let i = 0; i < 50; i++) await tick();
      expect(d.got.length).toBe(0); // still waiting on the stamp
      await vi.advanceTimersByTimeAsync(600);
      for (let i = 0; i < 2000 && d.got.length === 0; i++) await tick();
      expect(d.got.length).toBe(1);
    } finally {
      vi.useRealTimers();
      d.off();
    }
    expect((JSON.parse(await d.got[0]!.blob.text()) as { authorship: Rec }).authorship.recorded).toBeNull();
    for (const m of ['429', '402'] as const) {
      mode = m;
      const said = toasts();
      await openPop();
      const text = await exportBackup();
      expect((JSON.parse(text) as { authorship: Rec }).authorship.recorded, m).toBeNull();
      expect(toasts(), m).toEqual(said);
    }
    expect(net.stamps().length).toBe(3);
  });

  it('export locked: envelope downloads; password in no fetch body, console call, localStorage/sessionStorage, toast; fields empty after', async () => {
    const PW = 'quiet-harbour-77-ÅÉ';
    const net = stub({ '/api/authorship/stamps': () => json({ id: 's-2', createdAt: '2026-11-09T00:00:00.000Z' }, 201) });
    const logs: string[] = [];
    for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    await studioWith(LANTERN());
    signIn();
    await openPop();
    await click($('lockBackupOn'));
    expect($('lockBackupFields').hidden).toBe(false);
    expect($('lockBackup').textContent).toContain(t('backup.lockNote'));
    expect($('lockBackup').textContent).not.toContain(t('lock.note'));
    await type($('lockBackupPw'), PW);
    await type($('lockBackupPw2'), PW);
    const text = await exportBackup();
    const env = JSON.parse(text) as Rec;
    expect(env.format).toBe('beuk-backup-locked');
    expect(Object.keys(env)).toEqual(['format', 'version', 'kdf', 'cipher', 'data']);
    const plain = await c.api.backupUnlock(env, PW);
    const r = (await c.api.backupRead(plain)) as Rec;
    expect(r.locked).toBe(false);
    expect(r.intact).toBe(true);
    expect(((r.authorship as Rec).recorded)).toBe('2026-11-09T00:00:00.000Z');
    expect(net.stamps().length).toBe(1);
    for (const x of net.calls) expect(x.url + x.body).not.toContain(PW);
    for (const l of logs) expect(l).not.toContain(PW);
    const stores = [localStorage, sessionStorage].flatMap((s) => Object.keys(s).map((k) => k + '=' + s.getItem(k)));
    for (const s of stores) expect(s).not.toContain(PW);
    for (const x of toasts()) expect(x).not.toContain(PW);
    expect(text).not.toContain(PW);
    expect([inp('lockBackupPw').value, inp('lockBackupPw2').value, inp('lockBackupOn').checked]).toEqual(['', '', true]);
  });

  it('lock mismatch → #lockBackupErr shows lock.mismatch, nothing downloads', async () => {
    stub();
    await studioWith(LANTERN());
    await openPop();
    await click($('lockBackupOn'));
    await type($('lockBackupPw'), 'one');
    await type($('lockBackupPw2'), 'two');
    const d = catchDownloads();
    try {
      await click($('btnLocalBackup'));
      for (let i = 0; i < 100; i++) await tick();
      expect(d.got.length).toBe(0);
    } finally {
      d.off();
    }
    expect($('lockBackupErr').hidden).toBe(false);
    expect($('lockBackupErr').textContent).toBe(t('lock.mismatch'));
    expect($('localPop').hidden).toBe(false); // the message stays where the writer reads it
    expect([inp('lockBackupPw').value, inp('lockBackupPw2').value]).toEqual(['', '']);
  });

  it('day 22 (data-plan-access=paused): #lockBackup hidden; plain export works', async () => {
    stub();
    await studioWith(LANTERN());
    await openPop();
    await click($('lockBackupOn'));
    await type($('lockBackupPw'), 'left behind');
    await type($('lockBackupPw2'), 'left behind');
    document.documentElement.setAttribute('data-plan-access', 'paused');
    await click($('localPillBtn')); // closed
    await openPop();
    expect($('lockBackup').hidden).toBe(true);
    expect(inp('lockBackupPw').value).toBe('');
    const text = await exportBackup();
    expect((JSON.parse(text) as Rec).format).toBe('beuk-backup');
    expect(((await c.api.backupRead(text)) as Rec).intact).toBe(true);
  });

  it('open locked: wrong password → backup.pwWrong, desk unchanged; right password → desk is the backup; cancel → desk unchanged', async () => {
    stub();
    await studioWith(LANTERN());
    const title0 = deskTitle();
    const kit = KITCHENS();
    const locked = await c.api.backupLock((await c.api.backupPayload(kit, null)).text, 'right pw');
    // cancel
    await openFile(fileOf(locked));
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true), { timeout: 20_000 });
    expect($('backupPwH').textContent).toBe(t('backup.pwTitle'));
    expect($('btnBackupPwOpen').textContent).toBe(t('backup.pwOpen'));
    expect($('btnBackupPwCancel').textContent).toBe(t('backup.pwCancel'));
    expect(t('backup.pwCancel')).toBe('Cancel');
    await click($('btnBackupPwCancel'));
    await waitFor(() => expect(document.getElementById('modalBackupPw')).toBeNull());
    for (let i = 0; i < 50; i++) await tick();
    expect(isOpen('modalConfirm')).toBe(false);
    expect(deskTitle()).toBe(title0);
    // wrong, then right
    await openFile(fileOf(locked));
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true), { timeout: 20_000 });
    await type($('backupPw'), 'wrong pw');
    await click($('btnBackupPwOpen'));
    await waitFor(() => expect($('backupPwErr').textContent).toBe(t('backup.pwWrong')), { timeout: 30_000 });
    expect($('backupPwErr').hidden).toBe(false);
    expect(isOpen('modalBackupPw')).toBe(true);
    expect(inp('backupPw').value).toBe('');
    expect(deskTitle()).toBe(title0);
    await type($('backupPw'), 'right pw');
    await click($('btnBackupPwOpen'));
    await answer(true, t('local.backupConfirmTitle'));
    await waitFor(() => expect(deskTitle()).toBe((kit.meta as Rec).title), { timeout: 30_000 });
    expect(document.getElementById('modalBackupPw')).toBeNull();
  });

  it('open tampered plain: changed confirm; No → desk unchanged (sections deep-equal before/after); Yes → applied', async () => {
    stub();
    await studioWith(LANTERN());
    const before = deskBook().sections;
    const kit = KITCHENS();
    const d = JSON.parse((await c.api.backupPayload(kit, null)).text) as { book: { sections: Rec[] }; authorship: Rec };
    const s = d.book.sections.find((x) => /\w{4,}/.test(String(x.content || '')))!;
    const word = /\w{4,}/.exec(String(s.content))![0];
    s.content = String(s.content).replace(word, word + 'x'); // one word changed, the authorship block kept
    const tampered = JSON.stringify(d);
    expect(((await c.api.backupRead(tampered)) as Rec).intact).toBe(false);
    await openFile(fileOf(tampered));
    await answer(false, t('backup.changedTitle'));
    for (let i = 0; i < 50; i++) await tick();
    expect(isOpen('modalConfirm')).toBe(false);
    expect(deskBook().sections).toEqual(before);
    await openFile(fileOf(tampered));
    await waitFor(() => expect(isOpen('modalConfirm')).toBe(true), { timeout: 20_000 });
    expect($('confirmBody').textContent).toBe(t('backup.changedBody'));
    expect($('btnConfirmYes').textContent).toBe(t('backup.changedYes'));
    await answer(true, t('backup.changedTitle'));
    await answer(true, t('local.backupConfirmTitle'));
    await waitFor(() => expect(deskTitle()).toBe((kit.meta as Rec).title), { timeout: 30_000 });
    const opened = t('local.backupOpened', { title: (kit.meta as Rec).title });
    await waitFor(() => expect(toasts()).toContain(opened));
    expect(toasts().some((x) => x.includes('Untouched since'))).toBe(false); // a changed backup claims nothing
  });

  it('open intact signed in with check hit: toast contains backup.untouched and backup.onRecord', async () => {
    const first = '2026-10-01T10:00:00.000Z';
    let answerCheck: () => void = () => undefined;
    const net = stub({
      // held until the test answers: the book reaches the desk while the check is still out
      '/api/authorship/check': () =>
        new Promise<Response>((res) => {
          answerCheck = () => res(json({ recorded: [{ createdAt: first, kind: 'backup', title: 'Four Kitchens' }, { createdAt: '2026-10-05T00:00:00.000Z', kind: 'docx', title: 'x' }] }));
        }),
    });
    await studioWith(LANTERN());
    signIn();
    const kit = KITCHENS();
    const plain = (await c.api.backupPayload(kit, null)).text;
    const a = (JSON.parse(plain) as { authorship: { savedAt: string; sha256: string } }).authorship;
    await openFile(fileOf(plain));
    await answer(true, t('local.backupConfirmTitle'));
    await waitFor(() => expect(net.calls.some((x) => x.url.startsWith('/api/authorship/check'))).toBe(true), { timeout: 30_000 });
    await waitFor(() => expect(deskTitle()).toBe((kit.meta as Rec).title), { timeout: 30_000 }); // applied, the check unanswered
    answerCheck();
    const want =
      t('local.backupOpened', { title: (kit.meta as Rec).title }) +
      '. ' + t('backup.untouched', { date: fmtDateIntl(new Date(a.savedAt)) }) + // final fix M1: joined with ". "
      ' ' + t('backup.onRecord', { date: fmtDateIntl(new Date(first)) });
    await waitFor(() => expect(toasts()).toContain(want), { timeout: 30_000 });
    const checks = net.calls.filter((x) => x.url.startsWith('/api/authorship/check'));
    expect(checks.map((x) => x.url)).toEqual(['/api/authorship/check?sha256=' + a.sha256]);
  });

  it('old backup (no authorship): today\'s toast text exactly', async () => {
    const net = stub({ '/api/authorship/check': () => json({ recorded: [{ createdAt: '2026-10-01T10:00:00.000Z', kind: 'backup', title: '' }] }) });
    await studioWith(LANTERN());
    signIn();
    const kit = KITCHENS();
    await openFile(fileOf(JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-01T00:00:00.000Z', book: kit })));
    await answer(true, t('local.backupConfirmTitle'));
    const opened = t('local.backupOpened', { title: (kit.meta as Rec).title });
    await waitFor(() => expect(toasts()).toContain(opened), { timeout: 30_000 });
    for (let i = 0; i < 50; i++) await tick();
    expect(toasts().filter((x) => x.startsWith(opened))).toEqual([opened]);
    expect(net.calls.filter((x) => x.url.startsWith('/api/authorship'))).toEqual([]);
  });

  it('docx download signed in: one stamp kind docx after the download; signed out none', async () => {
    const net = stub({ '/api/authorship/stamps': () => json({ id: 's-3', createdAt: '2026-11-09T00:00:00.000Z' }, 201) });
    const doc = LANTERN();
    await studioWith(doc);
    await openExport();
    const run = async () => {
      const d = catchDownloads();
      try {
        await click($('btnDownloadDocx'));
        await waitFor(() => expect(d.got.length).toBe(1), { timeout: 60_000 });
        await waitFor(() => expect($('btnDownloadDocx').textContent).toBe(t('exp.downloadDocx')), { timeout: 30_000 });
      } finally {
        d.off();
      }
    };
    await run();
    for (let i = 0; i < 200; i++) await tick();
    expect(net.stamps()).toEqual([]);
    signIn();
    await run();
    await waitFor(() => expect(net.stamps().length).toBe(1), { timeout: 20_000 });
    const body = JSON.parse(net.stamps()[0]!.body) as Rec;
    expect(body.kind).toBe('docx');
    expect(body.bookId).toBe((doc.meta as Rec).bookId);
    // final fix I1: the Word file's stamp is the very fingerprint the next plain backup carries (nothing edited between)
    await click($('btnCloseExport'));
    await waitFor(() => expect(isOpen('modalExport')).toBe(false));
    await openPop();
    const text = await exportBackup();
    await waitFor(() => expect(net.stamps().length).toBe(2), { timeout: 20_000 });
    const a = (JSON.parse(text) as { authorship: Rec }).authorship;
    expect(body.sha256).toBe(a.sha256);
    expect(JSON.parse(net.stamps()[1]!.body).sha256).toBe(a.sha256);
  });

  it('box set: locked volume asks; cancel → that volume refused with the loader\'s message, others load', async () => {
    stub();
    await studioWith(LANTERN());
    await openExport();
    const kit = KITCHENS(), salt = book('real/salt-road-book-one');
    const locked = await c.api.backupLock((await c.api.backupPayload(kit, null)).text, 'volume pw');
    const plain = (await c.api.backupPayload(salt, null)).text;
    const add = async (files: File[]) => {
      const input = inp('boxSetFileInput');
      Object.defineProperty(input, 'files', { value: files, configurable: true });
      await act(async () => void fireEvent.change(input));
    };
    await add([fileOf(locked, 'kitchens-locked.beuk-backup.json'), fileOf(plain, 'salt-road.beuk-backup.json')]);
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true), { timeout: 20_000 });
    // above the export modal, the password dialog is the top of the dialog stack: Tab from its last control wraps to its
    // first, not into the export modal
    await waitFor(() => expect(document.activeElement).toBe($('backupPw')));
    $('btnBackupPwOpen').focus();
    await act(async () => void fireEvent.keyDown(document.activeElement!, { key: 'Tab' }));
    expect(document.activeElement).toBe($('backupPw'));
    expect(isOpen('modalExport')).toBe(true);
    await click($('btnBackupPwCancel'));
    await waitFor(() => expect(toasts()).toContain('Could not add kitchens-locked.beuk-backup.json: this is not a Beuk backup file'), { timeout: 20_000 });
    await waitFor(() => expect(toasts().some((x) => x.startsWith('Added as Book ') && x.endsWith(String((salt.meta as Rec).title)))).toBe(true), { timeout: 20_000 });
    // the same locked volume, opened: its password resolves the crypto in the export and import sessions
    await add([fileOf(locked, 'kitchens-locked.beuk-backup.json')]);
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true), { timeout: 20_000 });
    await type($('backupPw'), 'volume pw');
    await click($('btnBackupPwOpen'));
    await waitFor(() => expect(toasts().some((x) => x.startsWith('Added as Book ') && x.endsWith(String((kit.meta as Rec).title)))).toBe(true), { timeout: 30_000 });
    expect($('boxSetList').textContent).toContain(String((kit.meta as Rec).title));
    expect($('boxSetList').textContent).toContain(String((salt.meta as Rec).title));
  });

  /* Fix round 1 (Global constraint 8): the export always downloads. */
  it('export always downloads: crypto.subtle.digest throwing → today\'s payload, no toast (signed in too); the inline emergency backup too', async () => {
    const net = stub({ '/api/authorship/stamps': () => json({ id: 's-9', createdAt: '2026-11-09T00:00:00.000Z' }, 201) });
    const doc = LANTERN();
    await studioWith(doc);
    signIn();
    const said = toasts();
    const dg = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('no digest here'));
    await openPop();
    const text = await exportBackup();
    expect(parseBackup(text)).not.toBeNull();
    const d = JSON.parse(text) as Rec;
    expect(Object.keys(d)).toEqual(['format', 'version', 'exportedAt', 'book']);
    expect(d.format).toBe('beuk-backup');
    expect(toasts()).toEqual(said);
    expect(net.stamps()).toEqual([]);
    // the inline offer beside a failed device save is the same path (plain, never locked)
    const dl = catchDownloads();
    try {
      await act(async () => void fireEvent.click($('btnLocalBackupInline')));
      await waitFor(() => expect(dl.got.length).toBe(1), { timeout: 30_000 });
      expect(parseBackup(await dl.got[0]!.blob.text())).not.toBeNull();
    } finally {
      dl.off();
    }
    expect(toasts()).toEqual(said);
    dg.mockRestore();
  });

  it('export always downloads: the stamp failing after the fingerprint worked keeps the authorship block, recorded null', async () => {
    stub({ '/api/authorship/stamps': () => { throw new Error('the network went away'); } });
    await studioWith(LANTERN());
    signIn();
    await openPop();
    const text = await exportBackup();
    const r = (await c.api.backupRead(text)) as Rec;
    expect(r.intact).toBe(true);
    expect((r.authorship as Rec).recorded).toBeNull();
  });

  it('export always downloads (2.0): the closure not loaded and its chunk refusing → today\'s payload; a ticked lock is refused, never a plain file', async () => {
    stub();
    const doc = LANTERN();
    await studioWith(doc);
    await openPop();
    const said = toasts();
    gate.off = true;
    const text = await exportBackup();
    gate.off = false;
    expect(parseBackup(text)).not.toBeNull();
    expect(Object.keys(JSON.parse(text) as Rec)).toEqual(['format', 'version', 'exportedAt', 'book']);
    expect(toasts()).toEqual(said);
    // the lock ticked while the closure is away: refused with lock.failed, nothing downloads, the fields emptied
    await openPop();
    await click($('lockBackupOn'));
    await type($('lockBackupPw'), 'never plain');
    await type($('lockBackupPw2'), 'never plain');
    const d = catchDownloads();
    try {
      gate.off = true;
      await click($('btnLocalBackup'));
      gate.off = false;
      for (let i = 0; i < 100; i++) await tick();
      expect(d.got.length).toBe(0);
    } finally {
      gate.off = false;
      d.off();
    }
    expect(toasts().some((x) => x.startsWith(t('lock.failed', { error: '' })))).toBe(true);
    for (const x of toasts()) expect(x).not.toContain('never plain');
    expect([inp('lockBackupPw').value, inp('lockBackupPw2').value]).toEqual(['', '']);
  });

  /* Final fix I2: opening a backup never fails silently when 1.0's closure will not load. */
  it('open with the closure refusing to load: a plain backup opens on an empty desk with today\'s toast (no claim); a locked one says local.backupBad, desk unchanged', async () => {
    const net = stub();
    render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 20_000 });
    const kit = KITCHENS();
    const plain = (await c.api.backupPayload(kit, null)).text; // a new backup, its authorship block intact
    const locked = await c.api.backupLock(plain, 'no closure');
    gate.loadOff = true;
    const input = document.querySelector('#btnOpenBackup + input') as HTMLInputElement;
    await act(async () => void fireEvent.change(input, { target: { files: [fileOf(plain)] } }));
    await waitFor(() => expect(desk.ydoc && deskTitle()).toBe((kit.meta as Rec).title), { timeout: 30_000 });
    const opened = t('local.backupOpened', { title: (kit.meta as Rec).title });
    await waitFor(() => expect(toasts()).toContain(opened), { timeout: 20_000 });
    for (let i = 0; i < 50; i++) await tick();
    expect(toasts().filter((x) => x.startsWith(opened))).toEqual([opened]); // today's wording: no claim either way
    expect(net.calls.filter((x) => x.url.startsWith('/api/authorship'))).toEqual([]);
    // a locked one, the closure still away: refused with local.backupBad, no password asked, the desk as it was
    const before = deskBook().sections;
    const said = toasts().length;
    await openFile(fileOf(locked));
    await waitFor(() => expect(toasts().slice(said)).toContain(t('local.backupBad')), { timeout: 20_000 });
    expect(document.getElementById('modalBackupPw')).toBeNull();
    expect(isOpen('modalConfirm')).toBe(false);
    expect(deskTitle()).toBe((kit.meta as Rec).title);
    expect(deskBook().sections).toEqual(before);
  });

  it('a second locked backup opened while the first asks: the first ask ends (as Cancel), the second opens', async () => {
    stub();
    await studioWith(LANTERN());
    const title0 = deskTitle();
    const kit = KITCHENS();
    const locked = await c.api.backupLock((await c.api.backupPayload(kit, null)).text, 'two asks');
    const firstAsk = c.api.backupPasswordAsk(JSON.parse(locked) as object);
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true));
    await openFile(fileOf(locked));
    expect(await firstAsk).toBeNull(); // resolved, not left hanging
    await waitFor(() => expect(isOpen('modalBackupPw')).toBe(true), { timeout: 20_000 });
    expect(document.querySelectorAll('#modalBackupPw').length).toBe(1);
    expect(deskTitle()).toBe(title0);
    await type($('backupPw'), 'two asks');
    await click($('btnBackupPwOpen'));
    await answer(true, t('local.backupConfirmTitle'));
    await waitFor(() => expect(deskTitle()).toBe((kit.meta as Rec).title), { timeout: 30_000 });
  });

  it('record dialog: hidden signed out; lists stamps newest first with kind labels and 12-hex; shared-with lists named readers of the linked shelf book\'s shares; empty states', async () => {
    const doc = LANTERN();
    const id = String((doc.meta as Rec).bookId);
    let full = true;
    let sharesDown = false;
    const net = stub({
      '/api/authorship/stamps': (u) =>
        json({
          stamps: full
            ? [
                { id: 'st-old', kind: 'backup', title: 'T\u0007<b>x</b>', sha256: 'a'.repeat(12) + '0'.repeat(52), createdAt: '2026-11-01T09:00:00.000Z' },
                { id: 'st-new', kind: 'docx', title: 'T', sha256: 'b'.repeat(12) + '1'.repeat(52), createdAt: '2026-11-05T09:00:00.000Z' },
              ]
            : [],
          q: u.search,
        }),
      '/api/shares': (u) =>
        json({
          shares:
            full && u.searchParams.get('manuscriptId') === 'shelf-m1'
              ? [
                  { id: 'sh-a1', manuscriptId: 'shelf-m1', status: 'active', title: '<i>Lantern</i>', readerCount: 3, commentCount: 0, openCommentCount: 0, publishedAt: '2026-11-02T00:00:00.000Z' },
                  { id: 'sh-a2', manuscriptId: 'shelf-m1', status: 'revoked', title: 'Older copy', readerCount: 1, commentCount: 0, openCommentCount: 0, publishedAt: '2026-10-02T00:00:00.000Z' },
                  // another book's copy in the answer: never this book's record
                  { id: 'sh-zz', manuscriptId: 'shelf-other', status: 'active', title: 'Another book', readerCount: 9, commentCount: 0, openCommentCount: 0, publishedAt: '2026-11-02T00:00:00.000Z' },
                ]
              : sharesDown
                ? null
                : [],
        }, sharesDown ? 500 : 200),
      '/api/shares/sh-zz/readers': () =>
        json({ readers: [{ id: 'rd-zz', name: 'Zed', status: 'active', createdAt: '2026-11-02T10:00:00.000Z', firstOpenedAt: null, lastOpenedAt: null, commentCount: 0 }] }),
      '/api/shares/sh-a1/readers': () =>
        json({
          readers: [
            { id: 'rd-1', name: '<img src=x onerror=alert(1)>Ann', status: 'active', createdAt: '2026-11-02T10:00:00.000Z', firstOpenedAt: '2026-11-03T10:00:00.000Z', lastOpenedAt: null, commentCount: 0 },
            { id: 'rd-2', name: 'Bo', status: 'active', createdAt: '2026-11-04T10:00:00.000Z', firstOpenedAt: null, lastOpenedAt: null, commentCount: 0 },
          ],
        }),
      '/api/shares/sh-a2/readers': () =>
        json({ readers: [{ id: 'rd-3', name: 'Cy', status: 'revoked', createdAt: '2026-10-03T10:00:00.000Z', firstOpenedAt: null, lastOpenedAt: null, commentCount: 0 }] }),
    });
    await studioWith(doc);
    await openPop();
    expect($('btnAuthorshipRecord').hidden).toBe(true);
    signIn('shelf-m1');
    await openPop();
    expect($('btnAuthorshipRecord').hidden).toBe(false);
    expect($('btnAuthorshipRecord').textContent).toBe(t('auth.record'));
    await click($('btnAuthorshipRecord'));
    await waitFor(() => expect(isOpen('modalAuthorship')).toBe(true), { timeout: 20_000 });
    expect($('localPop').hidden).toBe(true);
    await waitFor(() => expect($('authStamps').querySelectorAll('[data-stamp-id]').length).toBe(2), { timeout: 20_000 });
    await waitFor(() => expect($('authShared').querySelectorAll('[data-auth-reader]').length).toBe(3), { timeout: 20_000 });
    expect($('authTitle').textContent).toBe(t('auth.title', { title: String((doc.meta as Rec).title).trim() }));
    expect(net.calls.some((x) => x.url === '/api/authorship/stamps?bookId=' + encodeURIComponent(id))).toBe(true);
    const rows = Array.from($('authStamps').querySelectorAll('[data-stamp-id]')) as HTMLElement[];
    expect(rows.map((r) => r.getAttribute('data-stamp-id'))).toEqual(['st-new', 'st-old']);
    expect(rows[0]!.textContent).toBe(t('auth.kindDocx') + fmtDateIntl(new Date('2026-11-05T09:00:00.000Z')) + ' · ' + 'b'.repeat(12));
    expect(rows[1]!.textContent).toBe(t('auth.kindBackup') + fmtDateIntl(new Date('2026-11-01T09:00:00.000Z')) + ' · ' + 'a'.repeat(12));
    const modal = $('modalAuthorship');
    expect(modal.querySelector('img, b > b, i:not([data-lucide])')).toBeNull();
    const reader = (rid: string) => modal.querySelector(`[data-auth-reader="${rid}"]`)!.textContent;
    expect(reader('rd-1')).toBe('<img src=x onerror=alert(1)>Ann · ' + t('beta.added', { date: '2 Nov 2026' }) + ' · ' + t('auth.firstOpened', { date: fmtDateIntl(new Date('2026-11-03T10:00:00.000Z')) }));
    expect(reader('rd-2')).toBe('Bo · ' + t('beta.added', { date: '4 Nov 2026' }) + ' · ' + t('beta.notOpened'));
    expect(reader('rd-3')).toContain('Cy · ');
    const opens = Array.from(modal.querySelectorAll('[data-auth-open]')).map((x) => x.textContent);
    expect(opens).toEqual([t('auth.openLink', { n: 3 }), t('auth.openLink', { n: 1 })]);
    expect(opens).toEqual(['Open link: 3 readers', 'Open link: 1 reader']); // plural-aware, as beta.readers is
    expect(modal.querySelector('[data-auth-share="sh-zz"]')).toBeNull();
    expect(modal.querySelector('[data-auth-reader="rd-zz"]')).toBeNull();
    expect(modal.textContent).not.toContain('Another book');
    expect(modal.querySelector('[data-auth-share="sh-a1"] .a-name')!.textContent).toBe('<i>Lantern</i>');
    expect(modal.querySelector('[data-auth-empty]')).toBeNull();
    await click($('btnAuthClose'));
    expect(isOpen('modalAuthorship')).toBe(false);
    // another shelf book linked, and its shares fail to load: the last book's copies (still in the share list) never show
    cloudFacts.linkedId = 'shelf-m2';
    sharesDown = true;
    full = false;
    await openPop();
    await click($('btnAuthorshipRecord'));
    await waitFor(() => expect(modal.querySelector('[data-auth-empty="shared"]')?.textContent).toBe(t('auth.noShared')), { timeout: 20_000 });
    expect(modal.querySelector('[data-auth-share]')).toBeNull();
    await click($('btnAuthClose'));
    cloudFacts.linkedId = 'shelf-m1';
    sharesDown = false;
    full = true;
    // empty states
    full = false;
    await openPop();
    await click($('btnAuthorshipRecord'));
    await waitFor(() => expect(modal.querySelector('[data-auth-empty="stamps"]')?.textContent).toBe(t('auth.noStamps')), { timeout: 20_000 });
    await waitFor(() => expect(modal.querySelector('[data-auth-empty="shared"]')?.textContent).toBe(t('auth.noShared')), { timeout: 20_000 });
    // signed out again: the button goes
    cloudFacts.user = null;
    await openPop();
    expect($('btnAuthorshipRecord').hidden).toBe(true);
  });
});
