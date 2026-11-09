import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook, META } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import es from '../src/generated/packs/es.json';
import { App } from '../src/App';
import { loadClosure, type Closure } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { resetServerFacts } from '../src/settings/SettingsDialog';
import { formFromMeta, metaFromForm, settingsChange, supportEmailFrom } from '../src/settings/settings';
import { fixtures } from './fixtures';
import { backupClicked } from './backup-wait';

/* Task 4: Project Settings and Rights. Re-expresses 1.0's rights.settings.form
   and settings.title.placeholder-not-stored, and review focus #5: edits go
   to `meta` and the export; a field left untouched stays absent (no default
   is written); Save with no change writes nothing. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
});

describe('the Save rules (1.0 btnSaveSettings), on the meta object', () => {
  it('Save with nothing changed changes nothing, on every fixture (so nothing is written)', () => {
    for (const f of fixtures('real')) {
      const y = new Y.Doc();
      importBook(f.book, y);
      const meta = y.getMap(META).get('meta') as Rec;
      expect(settingsChange(c, meta, formFromMeta(c, meta)), f.name).toBeNull();
    }
  });

  it('one field changed: only that field (and what 1.0 ties to it) changes; nothing untouched gains a key', () => {
    const f = fixtures('real').find((x) => x.name === 'real/bookbinders-letter')!;
    const y = new Y.Doc();
    importBook(f.book, y);
    const meta = y.getMap(META).get('meta') as Rec;
    const form = { ...formFromMeta(c, meta), publisher: 'Harbour Press' };
    const next = settingsChange(c, meta, form)!;
    expect(next).not.toBeNull();
    expect({ ...next, publisher: meta.publisher }).toEqual(meta);
    expect(Object.keys(next).sort()).toEqual(Object.keys(meta).sort());
    // the title changed: it becomes the writer's (titleSource), as 1.0's importmeta rule says
    const t2 = metaFromForm(c, meta, { ...formFromMeta(c, meta), title: 'A New Name' });
    expect(t2.title).toBe('A New Name');
    expect(t2.titleSource).toBe('writer');
  });

  it("settings.title.placeholder-not-stored: a blank title is stored blank (and stops being the import's); a stored placeholder in any language shows as a blank field", () => {
    const meta: Rec = { title: 'THE LONG WAY HOME', titleSource: 'import', subtitle: '', author: '', language: 'en', langSource: 'auto', langGuess: '', year: '', rights: '', description: '', a11ySummary: '', publisher: '', isbn: '' };
    const next = metaFromForm(c, meta, { ...formFromMeta(c, meta), title: '' });
    expect(next.title).toBe('');
    expect('titleSource' in next).toBe(false);
    for (const placeholder of [(es as Record<string, string>)['misc.untitledBook']!, 'Untitled Book'])
      expect(formFromMeta(c, { ...meta, title: placeholder }).title).toBe('');
  });

  it('the support address: only a plain address from /api/config/public', () => {
    expect(supportEmailFrom({ support: { email: ' help@beuk.studio ' } })).toBe('help@beuk.studio');
    for (const bad of [null, {}, { support: {} }, { support: { email: 'not an address' } }, { support: { email: '<x@y>' } }, { support: { email: 'a@b" onmouseover="x' } }])
      expect(supportEmailFrom(bad)).toBeNull();
  });
});

/* ---- through the studio ---- */

const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], 'b.beuk-backup.json', { type: 'application/json' });
let fetches: string[] = [];
let answers: Record<string, unknown> = {};
beforeEach(() => {
  resetServerFacts();
  fetches = [];
  answers = {};
  vi.stubGlobal('fetch', async (url: string) => {
    fetches.push(String(url));
    const a = answers[String(url)];
    return a === undefined ? new Response('{"error":"not found"}', { status: 404 }) : new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

async function studioWith(book: unknown) {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('.desk')).not.toBeNull(), { timeout: 20_000 });
}
const $ = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
const vis = (id: string) => !!$(id) && !$(id).hidden && $(id).style.display !== 'none';
async function openSettings() {
  await act(async () => {
    fireEvent.click($('btnSettings2'));
  });
  await waitFor(() => expect($('setTitle')).not.toBeNull(), { timeout: 10_000 });
}
const change = (id: string, value: string) => fireEvent.change($(id), { target: { value } });
const save = async () =>
  act(async () => {
    fireEvent.click($('btnSaveSettings'));
  });

describe('Project Settings in the studio', () => {
  it('rights.settings.form: each choice shows only its own rows, the preview follows the form, Save stores the choice and Custom alone keeps a typed line; reopening shows the saved choice', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/bookbinders-letter')!;
    const book = JSON.parse(JSON.stringify(f.book)) as Rec;
    const m = book.meta as Rec;
    m.rights = '';
    for (const k of ['rightsMode', 'ccLicence', 'firstPublished', 'editionHolder']) delete m[k];
    await studioWith(book);
    await openSettings();
    expect($('modalSettings').querySelector('.modal')!.getAttribute('aria-labelledby')).toBe('setH');
    expect($('setRightsMode').value).toBe('reserved');
    expect(vis('rowRightsCustom') || vis('rowRightsCc') || vis('rowRightsPdYear')).toBe(false);
    change('setRightsMode', 'pd');
    change('setFirstPublished', '1900');
    expect(vis('rowRightsPdYear') && vis('rowRightsPdEd') && !vis('rowRightsCustom')).toBe(true);
    expect($('rightsPreview').textContent).toContain('This work is in the public domain. First published in 1900.');
    change('setRights', 'typed but not chosen');
    await save();
    const exported = async () => {
      let blob: Blob | null = null;
      vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
        blob = b as Blob;
        return 'blob:x';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      await backupClicked(() => fireEvent.click($('btnLocalBackup')));
      const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
      vi.restoreAllMocks();
      return out.book;
    };
    let meta = (await exported()).meta as Rec;
    expect([meta.rightsMode, meta.firstPublished, meta.rights, 'editionHolder' in meta, 'ccLicence' in meta]).toEqual(['pd', '1900', '', false, false]);
    expect(document.getElementById('toasts')!.textContent).toContain(E['toast.settingsSaved']);
    await openSettings();
    expect([$('setRightsMode').value, $('setFirstPublished').value]).toEqual(['pd', '1900']);
    change('setRightsMode', 'cc');
    change('setCcLicence', 'by-nc');
    expect(vis('rowRightsCc') && !vis('rowRightsPdYear')).toBe(true);
    expect($('rightsPreview').textContent).toContain(c.api.CC_LICENCES['by-nc']!.url);
    await save();
    meta = (await exported()).meta as Rec;
    expect([meta.rightsMode, meta.ccLicence, 'firstPublished' in meta]).toEqual(['cc', 'by-nc', false]);
    await openSettings();
    change('setRightsMode', 'custom');
    change('setRights', 'Text licensed by arrangement.');
    await save();
    meta = (await exported()).meta as Rec;
    expect(c.api.rightsModeOf(meta)).toBe('custom');
    expect('rightsMode' in meta).toBe(false);
    expect(c.api.rightsLine(meta)).toBe('Text licensed by arrangement.');
  }, 120_000);

  it('review focus #5: an edit is written to meta and exported; Cancel, Escape and an unchanged Save write nothing; the language select switches the interface', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await studioWith(f.book);
    const exportNow = async () => {
      let blob: Blob | null = null;
      vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
        blob = b as Blob;
        return 'blob:x';
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      await backupClicked(() => fireEvent.click($('btnLocalBackup')));
      const out = JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec };
      vi.restoreAllMocks();
      return out.book;
    };
    const before = await exportNow();
    await openSettings();
    change('setPublisher', 'Thrown away');
    await act(async () => {
      fireEvent.click($('btnCloseSettings'));
    });
    expect(JSON.stringify(await exportNow())).toBe(JSON.stringify(before));
    await openSettings();
    change('setIsbn', 'also thrown away');
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    });
    expect($('modalSettings')).toBeNull();
    expect(JSON.stringify(await exportNow())).toBe(JSON.stringify(before));
    await openSettings();
    await save();
    expect(JSON.stringify(await exportNow())).toBe(JSON.stringify(before)); // unchanged Save: the book is exactly as it was
    await openSettings();
    change('setPublisher', 'Harbour Press');
    change('setSeries', 'The Shore Books');
    change('setSeriesNumber', '2');
    await save();
    const after = await exportNow();
    const bm = before.meta as Rec, am = after.meta as Rec;
    expect(am).toEqual({ ...bm, publisher: 'Harbour Press', series: 'The Shore Books', seriesNumber: 2 });
    expect({ ...after, meta: null }).toEqual({ ...before, meta: null });
    expect(document.getElementById('projectTitleDisplay')!.textContent).toBe(String(bm.title));
    // the legal links and the support line stay hidden with no server (every /api/* answered 404 here)
    await openSettings();
    expect($('legalLinksSettings').hidden).toBe(true);
    expect($('supportLineSettings').hidden).toBe(true);
    expect(fetches).toEqual(expect.arrayContaining(['/api/health', '/api/config/public']));
    // the interface language select is the studio's language
    await act(async () => {
      change('uiLangSelect', 'de');
    });
    await waitFor(() => expect(document.documentElement.getAttribute('lang')).toBe('de'));
    expect(localStorage.getItem('beuk.uiLang.v1')).toBe('de');
  }, 120_000);

  it('with a server: the legal links show, and the support address is a mailto link built from the address alone', async () => {
    answers['/api/health'] = { ok: true };
    answers['/api/config/public'] = { support: { email: 'help@beuk.studio' } };
    const f = fixtures('real').find((x) => x.name === 'real/lunas-beach-standalone')!;
    await studioWith(f.book);
    await openSettings();
    await waitFor(() => expect($('legalLinksSettings').hidden).toBe(false));
    const links = Array.from($('legalLinksSettings').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/privacy', '/terms']);
    await waitFor(() => expect($('supportLineSettings').hidden).toBe(false));
    const a = $('supportLineSettings').querySelector('a')!;
    expect(a.getAttribute('href')).toBe('mailto:help@beuk.studio');
    expect($('supportLineSettings').textContent).toBe(E['support.settingsLine']!.replace('{email}', 'help@beuk.studio'));
  }, 60_000);
});

describe('History and Settings leave the book alone', () => {
  it('importBook → exportBook still equal after formFromMeta (reading the form writes nothing)', () => {
    const f = fixtures('real')[0]!;
    const y = new Y.Doc();
    importBook(f.book, y);
    let n = 0;
    y.on('update', () => n++);
    formFromMeta(c, y.getMap(META).get('meta') as Rec);
    expect(n).toBe(0);
    expect(exportBook(y).meta).toEqual(y.getMap(META).get('meta'));
  });
});
