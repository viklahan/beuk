import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook, shaOfData } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { cloudFacts, loadClosure, setClosureLang, setClosureT } from '../src/closure/index';
import { setCovenantFetch } from '../src/covenant/net';
import { NEXT_STRINGS } from '../src/i18n/next-strings';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleRelease, styleReset, styleRoot, styleRun, styleUi } from '../src/style/session';
import { StyleFrame } from '../src/style/StyleTab';
import { offerKey, moveKey } from '../src/style/MyThemes';
import { mineList, mineLoad, mineReset, mineSave, type Bytes } from '../src/style/mine';
import { fixtures } from './fixtures';
import { styledBook, ttfData } from './style-fixture';

/* Per-user themes, task 3: the Style tab's "Themes for every book" — the list, keep (from a book theme's card and
   from the creator), apply, remove, the one-time offer (answered once per book, declining writes nothing), the
   sign-in move offer, and a hostile theme drawn as text. */

type Rec = Record<string, unknown>;
const pack = { ...en, ...NEXT_STRINGS.en } as Pack;
const t = (k: string, p?: Rec) => translate({ packs: { en: pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const toasts: string[] = [];

class FakeFace {
  family: string;
  status = 'loaded';
  constructor(family: string) {
    this.family = family;
  }
  load() {
    return Promise.resolve(this);
  }
}
beforeAll(async () => {
  await loadClosure();
  setClosureT(t);
  setClosureLang('en');
  (globalThis as unknown as { FontFace: unknown }).FontFace = FakeFace;
  const faces = new Set<unknown>();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (f: unknown) => faces.add(f), delete: (f: unknown) => faces.delete(f), has: (f: unknown) => faces.has(f), [Symbol.iterator]: () => faces.values() } });
});
beforeEach(async () => {
  styleRelease();
  mineReset();
  localStorage.clear();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase('beuk-mythemes');
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  cloudFacts.available = false;
  cloudFacts.user = null;
  await mineLoad();
  toasts.length = 0;
  styleUi.toast = (m) => toasts.push(m);
});
afterEach(() => {
  cleanup();
  styleRoot.el = null;
  desk.ydoc = null;
  mineReset();
  setCovenantFetch(null);
  cloudFacts.available = false;
  cloudFacts.user = null;
});

const LANTERN = () => structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
function open(doc: Rec) {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  const view = render(<StyleFrame t={t as never} />);
  styleRoot.el = view.container;
  act(() => {
    styleRun((cc) => {
      cc.vars.fontPickerSig = null;
      cc.api.initStudio();
      cc.api.syncStudioControls();
    });
  });
  return { y, root: view.container, unmount: view.unmount };
}
const sv = (y: Y.Doc) => Array.from(Y.encodeStateVector(y));
const json = (y: Y.Doc) => JSON.stringify(exportBook(y));

describe('the list and its one-time offer', () => {
  it("signed out: says the themes are this device's; offers this book's themes once; 1.0's gallery reads as 1.0's", async () => {
    const { y, root } = open(styledBook());
    expect(root.querySelector('#mineThemesWhere')!.textContent).toBe(t('next.themes.deviceOnly'));
    expect(root.querySelector('#mineThemeGrid')!.textContent).toBe(t('next.themes.empty'));
    expect(root.querySelector('#mineThemesOffer')).not.toBeNull();
    // the keep buttons on 1.0's cards are icons: 1.0's gallery text is unchanged
    // (1.0's renderMyThemes fills the grid; the buttons follow it)
    const keeps = await vi.waitFor(() => {
      const k = Array.from(root.querySelectorAll('#myThemeGrid [data-mine-keep]'));
      expect(k.length).toBe(2);
      return k;
    });
    expect(keeps.map((b) => b.getAttribute('data-mine-keep'))).toEqual(['ctHarbour', 'ctPlain']);
    expect(keeps.every((b) => b.getAttribute('aria-label') === t('next.themes.keep') && b.textContent === '')).toBe(true);
    expect(root.querySelector('#myThemeGrid')!.textContent).not.toContain(t('next.themes.keep'));
    y.destroy();
  });

  it('declining writes nothing to the book and is never asked again for that book', async () => {
    const book = styledBook();
    const { y, root, unmount } = open(book);
    const before = sv(y), was = json(y);
    fireEvent.click(root.querySelector('#btnMineOfferNo')!);
    await vi.waitFor(() => expect(root.querySelector('#mineThemesOffer')).toBeNull());
    expect(sv(y)).toEqual(before);
    expect(json(y)).toBe(was);
    expect(mineList()).toEqual([]);
    const bookId = String((book.meta as Rec).bookId);
    expect(localStorage.getItem(offerKey(bookId))).toBe('declined');
    expect(Object.keys(localStorage).every((k) => k.startsWith('beuk.'))).toBe(true);
    unmount();
    styleRelease();
    const again = open(styledBook());
    expect(again.root.querySelector('#mineThemesOffer')).toBeNull();
    y.destroy();
    again.y.destroy();
  });

  it("accepting keeps every theme of the book's that is not kept yet; the book is not written", async () => {
    const { y, root } = open(styledBook());
    const before = sv(y);
    fireEvent.click(root.querySelector('#btnMineOfferYes')!);
    await vi.waitFor(() => expect(mineList().map((r) => r.key)).toEqual(['ctHarbour', 'ctPlain']));
    await vi.waitFor(() => expect(root.querySelectorAll('#mineThemeGrid [data-mine-key]').length).toBe(2));
    expect(root.querySelector('#mineThemesOffer')).toBeNull();
    expect(sv(y)).toEqual(before);
    y.destroy();
  });
});

describe('review round 2 (Minors a, b): a keep that fails says so; the offer is answered only when its keeps succeed', () => {
  /** This device's storage refusing (a private window, a full disk): the store cannot keep anything. */
  function storageRefuses(): () => void {
    const open = indexedDB.open.bind(indexedDB);
    mineReset();
    (indexedDB as unknown as { open: unknown }).open = () => {
      throw new Error('blocked');
    };
    return () => {
      (indexedDB as unknown as { open: unknown }).open = open;
    };
  }

  it('Keep on a card, storage refusing: the existing "Not saved" toast, nothing claimed kept', async () => {
    const { y, root } = open(styledBook());
    const btn = await vi.waitFor(() => {
      const el = root.querySelector('#myThemeGrid [data-mine-keep="ctHarbour"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    const undo = storageRefuses();
    try {
      fireEvent.click(btn);
      await vi.waitFor(() => expect(toasts).toContain(t('local.notSavedShort')));
      expect(toasts).not.toContain(t('next.themes.kept', { name: 'Harbour Lights' }));
    } finally {
      undo();
    }
    y.destroy();
  });

  it('Keep them, storage refusing: the offer stays unanswered (shown again), "Not saved" said', async () => {
    const book = styledBook();
    const { y, root } = open(book);
    await vi.waitFor(() => expect(root.querySelector('#btnMineOfferYes')).not.toBeNull());
    const undo = storageRefuses();
    try {
      fireEvent.click(root.querySelector('#btnMineOfferYes')!);
      await vi.waitFor(() => expect(toasts).toContain(t('local.notSavedShort')));
      expect(localStorage.getItem(offerKey(String((book.meta as Rec).bookId)))).toBeNull();
    } finally {
      undo();
    }
    y.destroy();
  });
});

describe('keep, apply, remove', () => {
  it("keep from a book theme's card (not applying it), then apply in another book, then remove: the book keeps the theme", async () => {
    const a = open(styledBook());
    const harbour = await vi.waitFor(() => {
      const el = a.root.querySelector('#myThemeGrid [data-mine-keep="ctHarbour"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    const activeBefore = (exportBook(a.y) as Rec).activePreset;
    fireEvent.click(harbour);
    await vi.waitFor(() => expect(mineList().map((r) => r.key)).toEqual(['ctHarbour']));
    expect((exportBook(a.y) as Rec).activePreset).toBe(activeBefore); // the card's own click (apply) did not run
    expect(toasts).toContain(t('next.themes.kept', { name: 'Harbour Lights' }));
    a.unmount();
    a.y.destroy();
    styleRelease();

    const b = open(LANTERN());
    const card = await vi.waitFor(() => {
      const el = b.root.querySelector('#mineThemeGrid [data-mine-key="ctHarbour"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(card.querySelector('.p-name')!.textContent).toBe('Harbour Lights');
    fireEvent.click(card);
    await vi.waitFor(() => expect((exportBook(b.y) as Rec).activePreset).toBe('custom:ctHarbour'));
    const out = exportBook(b.y) as Rec;
    expect((out.fonts as Rec[]).map((f) => f.family)).toEqual(['Writer Hand']);
    expect((out.customThemes as Rec[]).map((x) => x.id)).toContain('ctHarbour');
    const was = json(b.y);
    fireEvent.click(b.root.querySelector('#mineThemeGrid [data-mine-remove="ctHarbour"]')!);
    await vi.waitFor(() => expect(mineList()).toEqual([]));
    expect(json(b.y)).toBe(was);
    expect(toasts).toContain(t('next.themes.removed', { name: 'Harbour Lights' }));
    b.y.destroy();
  });

  it("the creator's Keep for every book: 1.0's Save into the book, then kept", async () => {
    const { y, root } = open(LANTERN());
    act(() => {
      fireEvent.click(root.querySelector('#btnNewTheme')!);
    });
    const name = root.querySelector('#tcName') as HTMLInputElement;
    act(() => {
      name.value = 'Creator Keep';
      fireEvent.input(name);
    });
    act(() => {
      fireEvent.click(root.querySelector('#btnTcKeep')!);
    });
    await vi.waitFor(() => expect(mineList().map((r) => r.name)).toEqual(['Creator Keep']));
    expect(((exportBook(y) as Rec).customThemes as Rec[]).map((x) => x.name)).toEqual(['Creator Keep']);
    y.destroy();
  });
});

describe('constraint 48: a hostile My theme is drawn as text, its fonts through the safe path', () => {
  it('no element, handler or remote address from its name or fonts', async () => {
    const data = ttfData(1600, 3);
    const bytes = new Map<string, Bytes>([[shaOfData(data), { mediaType: 'font/ttf', data }]]);
    await mineSave(
      {
        id: 'h1',
        name: '<img src=x onerror=alert(1)>',
        theme: { bodyFont: "x'); background:url(https://evil.example/a); font-family:('", headFont: 'Fine Face', header: { title: { font: '"><script>alert(1)</script>' } } },
        assets: [{ kind: 'font', sha256: shaOfData(data), mediaType: 'font/ttf', id: 'ff', name: 'fine.ttf', family: 'Fine Face', ext: 'ttf' }],
      },
      bytes,
    );
    const { y, root } = open(LANTERN());
    const card = await vi.waitFor(() => {
      const el = root.querySelector('#mineThemeGrid [data-mine-key="h1"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(card.querySelector('.p-name')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(card.querySelector('img, script')).toBeNull();
    const styles = Array.from(card.querySelectorAll('[style]')).map((el) => el.getAttribute('style') ?? '');
    expect(styles.join(' ')).not.toMatch(/url|evil|script/i);
    // the title's font named no face: it fell back to the theme's heading face (1.0's removeUploadedFont rule), its own
    expect(card.querySelector('.p-desc')!.textContent).toBe(t('themes.fontsLine', { num: 'Fine Face', title: 'Fine Face', sub: 'Fine Face' }));
    y.destroy();
  });
});

describe('signing in with device-only themes', () => {
  it('offers once to move them to the account; Move them moves them', async () => {
    await mineSave({ id: 'dv1', name: 'On This Device', theme: { bodyFont: 'EB Garamond' }, assets: [] }, new Map());
    cloudFacts.available = true;
    cloudFacts.user = { id: 'u7' };
    const sent: string[] = [];
    const held: Rec[] = [];
    setCovenantFetch((async (p: string, init?: RequestInit) => {
      sent.push((init?.method ?? 'GET') + ' ' + p);
      if (p === '/api/themes' && (!init?.method || init.method === 'GET')) return new Response(JSON.stringify({ themes: held }), { status: 200 });
      if (p.startsWith('/api/themes/') && init?.method === 'PUT') {
        const b = JSON.parse(String(init.body)) as Rec;
        const row = { key: (b.doc as Rec).id, name: b.name, revision: 1, updated_at: 'x', doc: b.doc };
        held.push(row);
        return new Response(JSON.stringify({ theme: row }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    await mineLoad();
    const { y, root } = open(LANTERN());
    expect(root.querySelector('#mineThemesWhere')!.textContent).toBe(t('next.themes.account'));
    await vi.waitFor(() => expect(root.querySelector('#mineThemesMove')).not.toBeNull());
    fireEvent.click(root.querySelector('#btnMineMoveYes')!);
    await vi.waitFor(() => expect(mineList().map((r) => [r.name, r.revision])).toEqual([['On This Device', 1]]));
    expect(localStorage.getItem(moveKey('u:u7'))).toBe('moved');
    expect(root.querySelector('#mineThemesMove')).toBeNull();
    expect(sent).toContain('PUT /api/themes/dv1');
    y.destroy();
  });
});
