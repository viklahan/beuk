import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { exportBook, importBook, sectionAt } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import ar from '../src/generated/packs/ar.json';
import meta from '../src/generated/strings-meta.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { importToDevice } from '../src/book/store';
import { loadClosure, setClosureLang, setClosureT, stateFromBook, type Closure, type EpubFile } from '../src/closure/index';
import { desk } from '../src/environment/page';
import { GenEditor } from '../src/editor/GenEditor';
import { arriveForExport, exportRun } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { loadPreview, type PreviewClosure } from '../src/preview/preview';
import { ToastProvider } from '../src/shell/Toasts';
import { styleReset } from '../src/style/session';
import { PNG_1PX } from './style-fixture';

/* Task 4 of "Beuk 2.0 becomes the studio": 1.0's generated-page editor, #genEditor (client/index.html: the markup
   between #starterBar and #editorArea; syncEditor shows it, renderGenEditor fills it for the half title, the cover, the
   title page, the copyright page and the contents, genCoverUpload / genCoverMake / genCoverRemove pressing Project
   Settings' own cover controls).
   1.0 self-checks re-expressed here:
   - generated.halftitle.editor: the fields seeded from the book title, no message card; untouched, the preview markup
     and the EPUB's halftitle.xhtml are the derived default exactly; an edit typesets on both and persists with the book;
     "Use the book title" restores the default byte for byte.
   - generated.cover.editor: the empty state carries Upload and Make a Cover (no Remove, no picture); the section's
     upload writes the one cover state (Project Settings agrees; the EPUB packages the cover with its page and
     landmark); Remove from the section clears it everywhere; the maker opens from the section.
   - generated.no-message-pages: every section type 1.0 offers shows a field, control or text editor on its own
     surface, and none is a card referring the writer to Project Settings; a copyright page with its own words keeps
     its text editor beside the imprint fields.
   (Those are every `feature: "generated"` check 1.0 has.) */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const A = ar as Record<string, string>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let pv: PreviewClosure;

/** A 2D context that takes every call: jsdom has no canvas, and the cover maker paints (as test/cover-ui.test.tsx). */
function fakeCtx(): unknown {
  const target: Rec = {
    measureText: (s: string) => ({ width: String(s).length * 10 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => ({}),
    canvas: null,
  };
  return new Proxy(target, {
    get: (o, k) => (k in o ? o[k as string] : () => undefined),
    set: (o, k, v) => ((o[k as string] = v), true),
  });
}

beforeAll(async () => {
  c = await loadClosure();
  pv = await loadPreview();
  setClosureT(t);
  setClosureLang('en');
  HTMLCanvasElement.prototype.getContext = function () {
    return fakeCtx() as never;
  } as never;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==';
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {};
  (window as unknown as { lucide: unknown }).lucide = { icons: {} };
  (globalThis as unknown as { Image: unknown }).Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 10;
    naturalHeight = 10;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('beuk.tour.v1', 'done');
  resetSidePrefsCache();
  styleReset();
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

const BOOK = (): Rec => ({
  meta: { title: 'The Fixture Meridian', author: 'Fixture Author', publisher: 'Harbour Press', isbn: '', year: '2026', language: 'en' },
  images: [],
  cover: null,
  sections: [
    { id: 'cv', kind: 'front', type: 'cover', title: 'Cover', content: '' },
    { id: 'ht', kind: 'front', type: 'halftitle', title: 'Half Title', content: '' },
    { id: 'tp', kind: 'front', type: 'titlepage', title: 'Title Page', content: '' },
    { id: 'cp', kind: 'front', type: 'copyright', title: 'Copyright', content: '' },
    { id: 'dd', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the ferrymen.' },
    { id: 'tc', kind: 'front', type: 'toc', title: 'Contents', content: '' },
    { id: 'p1', kind: 'body', type: 'part', number: 'One', title: 'The Harbour', content: '' },
    { id: 'c1', kind: 'body', type: 'chapter', number: '1', title: 'The Ferry Crossing', content: 'Opening words stand here.' },
    { id: 'ak', kind: 'back', type: 'acknowledgments', title: 'Acknowledgments', content: 'Thanks to the harbour master.' },
  ],
});
const onDoc = (book: Rec = BOOK()) => {
  const y = new Y.Doc();
  importBook(structuredClone(book), y);
  return y;
};
const $ = (id: string) => document.getElementById(id) as HTMLInputElement | null;
/** On the page and not inside anything hidden (1.0's syncEditor hides with style.display). */
function shown(id: string): boolean {
  let el = document.getElementById(id) as HTMLElement | null;
  if (!el) return false;
  for (; el; el = el.parentElement) if (el.style.display === 'none') return false;
  return true;
}
const secOut = (y: Y.Doc, i: number) => (exportBook(y).sections as Rec[])[i]!;
const metaOut = (y: Y.Doc) => exportBook(y).meta as Rec;
const typeIn = (id: string, value: string) =>
  act(() => {
    fireEvent.change($(id)!, { target: { value } });
  });
const press = (id: string) =>
  act(() => {
    fireEvent.click($(id)!);
  });

/** 1.0's preview markup of section i of the book as it stands (the preview module's own sectionHtml). */
const previewOf = (y: Y.Doc, i: number) => {
  const st = stateFromBook(c, exportBook(y)) as unknown as Rec & { sections: Rec[] };
  pv.setState(st);
  return String(pv.api.sectionHtml(st.sections[i]));
};
/** 1.0's EPUB package of the book as it stands (the export's arrival, then epubFiles). */
const epubOf = (y: Y.Doc): EpubFile[] => {
  const book = exportBook(y);
  const st = arriveForExport(c, structuredClone(book));
  exportSafe(c, st as never, book);
  return c.api.epubFiles('generic');
};
const fileText = (files: EpubFile[], p: string) => files.find((f) => f.path === p)?.content ?? '';

async function mountGen(y: Y.Doc, i: number, lang = 'en') {
  const section = sectionAt(y, i) as Y.Map<unknown>;
  const r = render(
    <LocaleProvider initial={lang}>
      <ToastProvider>
        <GenEditor ydoc={y} section={section} />
      </ToastProvider>
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.querySelector('#genEditor .gen-panel')).not.toBeNull(), { timeout: 10_000 });
  return r;
}

describe('generated.halftitle.editor', { timeout: 30_000 }, () => {
  it("the fields stand on the section seeded from the book title; an edit typesets in the preview and the EPUB and persists; 'Use the book title' restores the default byte for byte", async () => {
    const y = onDoc();
    await mountGen(y, 1);
    const DEFAULT_HTML = '<div class="halftitle"><p class="ht-title">The Fixture Meridian</p></div>';
    // seeded, the reset hidden, no message card
    expect($('genHt1')!.value).toBe('The Fixture Meridian');
    expect($('genHt2')!.value).toBe('');
    expect($('genHtReset')!.style.display).toBe('none');
    expect($('autoNote')).toBeNull();
    // untouched: the derived default on both surfaces
    expect(previewOf(y, 1)).toBe(DEFAULT_HTML);
    expect(fileText(epubOf(y), 'OEBPS/Text/halftitle.xhtml')).toContain(DEFAULT_HTML);
    // the edit
    typeIn('genHt1', 'The Fixture Meridian, Revisited');
    typeIn('genHt2', 'Being the second line');
    expect(secOut(y, 1).htLine1).toBe('The Fixture Meridian, Revisited');
    expect(secOut(y, 1).htLine2).toBe('Being the second line');
    const html = previewOf(y, 1);
    expect(html).toContain('<p class="ht-title">The Fixture Meridian, Revisited</p>');
    expect(html).toContain('<p class="ht-line2">Being the second line</p>');
    expect(fileText(epubOf(y), 'OEBPS/Text/halftitle.xhtml')).toContain('The Fixture Meridian, Revisited');
    expect($('genHtReset')!.style.display).toBe('');
    // 'Use the book title'
    press('genHtReset');
    expect(secOut(y, 1).htLine1).toBeNull();
    expect(secOut(y, 1).htLine2).toBe('');
    expect($('genHt1')!.value).toBe('The Fixture Meridian');
    expect($('genHt2')!.value).toBe('');
    expect($('genHtReset')!.style.display).toBe('none');
    expect(previewOf(y, 1)).toBe(DEFAULT_HTML);
  });

  it('typing the book title itself is no override (the line stays derived: a later retitle flows through)', async () => {
    const y = onDoc();
    await mountGen(y, 1);
    typeIn('genHt1', 'Something Else');
    typeIn('genHt1', 'The Fixture Meridian');
    expect(secOut(y, 1).htLine1).toBeNull();
    expect($('genHtReset')!.style.display).toBe('none');
    act(() => {
      const m = y.getMap('meta');
      m.set('meta', { ...(m.get('meta') as Rec), title: 'A New Title' });
    });
    expect($('genHt1')!.value).toBe('A New Title');
    expect(previewOf(y, 1)).toContain('<p class="ht-title">A New Title</p>');
  });

  it('a cleared line keeps its blank in the field while the page shows the book title (1.0: the derived default)', async () => {
    const y = onDoc();
    await mountGen(y, 1);
    typeIn('genHt1', '');
    expect($('genHt1')!.value).toBe('');
    expect(secOut(y, 1).htLine1).toBe('');
    expect(previewOf(y, 1)).toContain('<p class="ht-title">The Fixture Meridian</p>');
  });
});

describe("each generated kind shows 1.0's fields, in 1.0's order, and writes 1.0's values", { timeout: 30_000 }, () => {
  const labelOf = (id: string) => document.querySelector(`#genEditor label[for="${id}"]`)?.textContent;
  const ids = () => [...document.querySelectorAll('#genEditor input, #genEditor button')].map((x) => x.id);

  it('the half title: its two lines and the reset', async () => {
    await mountGen(onDoc(), 1);
    expect(ids()).toEqual(['genHt1', 'genHt2', 'genHtReset']);
    expect(labelOf('genHt1')).toBe(E['gen.htLine1']);
    expect(labelOf('genHt2')).toBe(E['gen.htLine2']);
    expect($('genHtReset')!.textContent).toBe(E['gen.htUseBookTitle']);
    expect($('genHtReset')!.className).toBe('gen-quiet');
    expect($('genHt1')!.closest('.meta-grid')!.closest('.gen-panel')).not.toBeNull();
    expect($('genHt1')!.parentElement!.className).toBe('wide');
  });

  it("the title page: the book's title, subtitle, author and publisher, edited in place (the credits become the writer's)", async () => {
    const y = onDoc();
    await mountGen(y, 2);
    expect(ids()).toEqual(['genTpTitle', 'genTpSubtitle', 'genTpAuthor', 'genTpPublisher']);
    expect(['genTpTitle', 'genTpSubtitle', 'genTpAuthor', 'genTpPublisher'].map(labelOf)).toEqual([E['set.bookTitle'], E['set.subtitle'], E['set.author'], E['set.publisher']]);
    expect([$('genTpTitle')!.value, $('genTpSubtitle')!.value, $('genTpAuthor')!.value, $('genTpPublisher')!.value]).toEqual(['The Fixture Meridian', '', 'Fixture Author', 'Harbour Press']);
    expect($('genTpTitle')!.parentElement!.className).toBe('wide');
    expect($('genTpAuthor')!.parentElement!.className).toBe('');
    typeIn('genTpTitle', 'The Second Meridian');
    typeIn('genTpSubtitle', 'A Novel');
    typeIn('genTpPublisher', 'Quay Books');
    const m = metaOut(y);
    expect([m.title, m.subtitle, m.publisher]).toEqual(['The Second Meridian', 'A Novel', 'Quay Books']);
    expect([m.titleSource, m.subtitleSource]).toEqual(['writer', 'writer']);
    expect('publisherSource' in m).toBe(false);
    // emptied here, the credit is open to the next import again
    typeIn('genTpSubtitle', '');
    expect('subtitleSource' in metaOut(y)).toBe(false);
    const html = previewOf(y, 2);
    expect(html).toContain('<h1 class="tp-title">The Second Meridian</h1>');
    expect(html).toContain('<p class="tp-publisher">Quay Books</p>');
    expect(fileText(epubOf(y), 'OEBPS/Text/titlepage.xhtml')).toContain('The Second Meridian');
  });

  it("the copyright page: author, publisher, ISBN, year and the rights line; a chosen licence is named, not typed", async () => {
    const y = onDoc();
    const r = await mountGen(y, 3);
    expect(ids()).toEqual(['genCpAuthor', 'genCpPublisher', 'genCpIsbn', 'genCpYear', 'genCpRights']);
    expect(['genCpAuthor', 'genCpPublisher', 'genCpIsbn', 'genCpYear', 'genCpRights'].map(labelOf)).toEqual([E['set.author'], E['set.publisher'], E['set.isbn'], E['set.year'], E['set.rights']]);
    typeIn('genCpIsbn', '978-0-00-000000-2');
    typeIn('genCpYear', '2027');
    typeIn('genCpRights', 'All rights kept by the harbour.');
    const m = metaOut(y);
    expect([m.isbn, m.year, m.rights]).toEqual(['978-0-00-000000-2', '2027', 'All rights kept by the harbour.']);
    const html = previewOf(y, 3);
    expect(html).toContain('978-0-00-000000-2');
    expect(html).toContain('All rights kept by the harbour.');
    r.unmount();
    // Public domain chosen in Project Settings: the note, no rights field
    act(() => {
      const mm = y.getMap('meta');
      mm.set('meta', { ...(mm.get('meta') as Rec), rightsMode: 'pd' });
    });
    await mountGen(y, 3);
    expect($('genCpRights')).toBeNull();
    expect($('genCpRightsNote')!.textContent).toBe(t('rights.inDetails', { choice: E['rights.pd'], where: E['set.title'] }));
  });

  it("the contents: its heading (\"Contents\" is the default, stored as none) and 1.0's entries", async () => {
    const y = onDoc();
    await mountGen(y, 5);
    expect(ids()).toEqual(['genTocHeading']);
    expect(labelOf('genTocHeading')).toBe(E['gen.tocHeading']);
    expect($('genTocHeading')!.value).toBe('Contents');
    expect(document.querySelector('#genEditor .field-lab:not(label)')!.textContent).toBe(E['gen.tocEntries']);
    // renderGenEditor's list: what is in the book (inBook: an empty generated page counts), less the contents, the half
    // title, the cover and a frontispiece, each named by sectionLabel
    expect([...document.querySelectorAll('#genEditor ol.gen-toc-list li')].map((x) => x.textContent)).toEqual([
      'Title Page', 'Copyright', 'Dedication', 'Part One · The Harbour', 'Chapter 1 · The Ferry Crossing', 'Acknowledgments',
    ]);
    typeIn('genTocHeading', 'Inhalt');
    expect(secOut(y, 5).tocHeading).toBe('Inhalt');
    expect(previewOf(y, 5)).toContain('<h1 class="toc-title">Inhalt</h1>');
    typeIn('genTocHeading', 'Contents');
    expect(secOut(y, 5).tocHeading).toBeNull();
    // a chapter retitled elsewhere: the entries follow
    act(() => {
      (sectionAt(y, 7) as Y.Map<unknown>).set('title', 'The Long Ferry');
    });
    expect(document.querySelector('#genEditor ol.gen-toc-list')!.textContent).toContain('Chapter 1 · The Long Ferry');
  });

  it('a section that is no generated page has no #genEditor content', async () => {
    const y = onDoc();
    render(
      <LocaleProvider initial="en">
        <ToastProvider>
          <GenEditor ydoc={y} section={sectionAt(y, 4) as Y.Map<unknown>} />
        </ToastProvider>
      </LocaleProvider>,
    );
    await new Promise((res) => setTimeout(res, 50));
    expect(document.querySelector('#genEditor input, #genEditor button')).toBeNull();
    expect(shown('genEditor')).toBe(false);
  });
});

describe('under ar, the editor mirrors', { timeout: 30_000 }, () => {
  it("it takes the page's right-to-left direction (no direction of its own) and speaks Arabic", async () => {
    await loadPack('ar');
    await mountGen(onDoc(), 1, 'ar');
    await waitFor(() => expect(document.documentElement.getAttribute('dir')).toBe('rtl'));
    const host = document.getElementById('genEditor')!;
    expect(host.closest('[dir]')).toBe(document.documentElement);
    expect(host.querySelectorAll('[dir]').length).toBe(0);
    expect(document.querySelector('label[for="genHt1"]')!.textContent).toBe(A['gen.htLine1']);
    expect(document.querySelector('label[for="genHt2"]')!.textContent).toBe(A['gen.htLine2']);
  });
});

/* ---- on the desk: the whole studio ---- */

async function studioWith(doc: Rec) {
  await importToDevice(doc);
  const r = render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.querySelector('#structureList .sec-item[data-index="0"]')).not.toBeNull(), { timeout: 20_000 });
  return r;
}
async function openSection(i: number) {
  await act(async () => {
    fireEvent.click(document.querySelector(`#structureList .sec-item[data-index="${i}"]`)!);
  });
  await waitFor(() => expect(document.querySelector(`#manuscript[data-section="${i}"] .ms-editor`)).not.toBeNull(), { timeout: 20_000 });
}
const textEditorShown = () => shown('manuscript') && shown('insertToolbar') && shown('editorWordBar') && document.querySelector('#manuscript .ms-editor')?.getAttribute('contenteditable') === 'true';
const genShown = () => shown('genEditor') && !!document.querySelector('#genEditor input, #genEditor select, #genEditor textarea, #genEditor button');

describe('generated.no-message-pages, on the desk', { timeout: 120_000 }, () => {
  it("a generated page shows #genEditor in the text editor's place; every other type its text editor; none is a referral card", async () => {
    const TYPES: [string, string][] = [['front', 'cover'], ['front', 'halftitle'], ['front', 'titlepage'], ['front', 'copyright'], ['front', 'dedication'], ['front', 'epigraph'], ['front', 'toc'], ['front', 'frontispiece'], ['body', 'prologue'], ['body', 'chapter'], ['body', 'epigraph'], ['body', 'epilogue'], ['back', 'acknowledgments'], ['back', 'aboutauthor'], ['back', 'alsoby'], ['back', 'colophon']];
    const sections = TYPES.map(([k, ty]) => c.api.mkSection(k, ty, c.api.TYPE_TITLES[ty] || ty, {}));
    await studioWith({ meta: { title: 'Surface Fixture', author: 'Fixture Author', language: 'en' }, images: [], sections });
    const failures: string[] = [];
    for (let i = 0; i < TYPES.length; i++) {
      await openSection(i);
      const ty = TYPES[i]![1];
      const auto = c.api.AUTO_TYPES.includes(ty);
      await waitFor(() => expect(genShown(), ty).toBe(auto));
      const ok = auto ? genShown() && !textEditorShown() : textEditorShown() && !genShown();
      const noCard = !$('autoNote') && !document.querySelector('.desk')!.textContent!.includes('Project Settings');
      if (!ok || !noCard) failures.push(ty);
    }
    expect(failures).toEqual([]);
    // #genEditor stands where 1.0 has it: after #starterBar, before the page
    await openSection(1);
    const gen = $('genEditor')!;
    expect(gen.compareDocumentPosition($('manuscript')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect($('insertToolbar')!.compareDocumentPosition(gen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a copyright page that brought its own words keeps its text editor beside the imprint fields', async () => {
    const doc = BOOK();
    (doc.sections as Rec[])[3]!.content = 'Copyright © the fixture. All rights reserved.';
    await studioWith(doc);
    await openSection(3);
    await waitFor(() => expect($('genCpIsbn')).not.toBeNull());
    expect(genShown()).toBe(true);
    expect(textEditorShown()).toBe(true);
  });

  it('an empty copyright page shows only the imprint fields', async () => {
    await studioWith(BOOK());
    await openSection(3);
    await waitFor(() => expect($('genCpIsbn')).not.toBeNull());
    expect(textEditorShown()).toBe(false);
  });

  it('retyping a generated page to a written one gives the text editor back (1.0: syncEditor after the retype)', async () => {
    await studioWith(BOOK());
    await openSection(1);
    await waitFor(() => expect(genShown()).toBe(true));
    act(() => {
      (sectionAt(desk.ydoc!, 1) as Y.Map<unknown>).set('type', 'epigraph');
    });
    await waitFor(() => expect(textEditorShown()).toBe(true));
    expect(genShown()).toBe(false);
  });
});

describe('generated.cover.editor, on the desk', { timeout: 120_000 }, () => {
  it('the empty state carries Upload and Make a Cover; the section upload writes the one cover (Settings agrees, the EPUB packages it); Remove clears it; Make opens the maker', async () => {
    await studioWith(BOOK());
    await waitFor(() => expect(document.querySelectorAll('#cmElFont option').length).toBeGreaterThan(10), { timeout: 20_000 });
    await openSection(0);
    await waitFor(() => expect($('genCoverUpload')).not.toBeNull());
    // the empty state
    expect($('genCoverMake')).not.toBeNull();
    expect($('genCoverRemove')).toBeNull();
    expect($('autoNote')).toBeNull();
    expect($('genCoverThumb')!.querySelector('img')).toBeNull();
    expect($('genCoverThumb')!.textContent).toBe(E['set.noCover']);
    expect($('genCoverUpload')!.textContent).toBe(E['set.uploadCover']);
    expect($('genCoverMake')!.textContent).toBe(E['covermk.make']);
    expect(textEditorShown()).toBe(false);
    // Upload opens the picker: a JPEG / PNG file input (1.0's #coverInput, through btnCoverUpload)
    const picked: HTMLInputElement[] = [];
    const real = HTMLInputElement.prototype.click;
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      if (this.type === 'file') picked.push(this);
      else real.call(this);
    });
    await press('genCoverUpload');
    expect(picked.length).toBe(1);
    const input = picked[0]!;
    expect(input.accept).toBe('image/jpeg,image/png,.jpg,.jpeg,.png');
    const bytes = Uint8Array.from(atob(PNG_1PX), (ch) => ch.charCodeAt(0));
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([bytes], 'Section Cover.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect((exportBook(desk.ydoc!).cover as Rec | null)?.name).toBe('Section Cover.png'));
    expect(exportBook(desk.ydoc!).coverRecipe ?? null).toBeNull();
    // the EPUB packages it, with its page and landmark
    const files = exportRun((cc) => cc.api.epubFiles('generic'))!;
    expect(files.some((f) => f.path === 'OEBPS/Images/cover.png')).toBe(true);
    expect(fileText(files, 'OEBPS/package.opf')).toContain('properties="cover-image"');
    expect(fileText(files, 'OEBPS/nav.xhtml')).toContain('epub:type="cover"');
    expect(fileText(files, 'OEBPS/Text/cover.xhtml')).toContain('src="../Images/cover.png"');
    // the section shows it, with Replace and Remove
    await waitFor(() => expect($('genCoverThumb')!.querySelector('img')).not.toBeNull());
    expect($('genCoverRemove')).not.toBeNull();
    expect($('genCoverUpload')!.textContent).toBe(E['gen.coverReplace']);
    expect(document.querySelector('#genEditor .cover-note')!.textContent).toBe('Section Cover.png · ' + c.api.fmtBytes(Math.round(PNG_1PX.length * 3 / 4)));
    // Project Settings agrees
    await press('btnSettings2');
    await waitFor(() => expect($('coverThumb')?.querySelector('img')).toBeTruthy(), { timeout: 10_000 });
    expect($('btnCoverRemove')!.style.display).not.toBe('none');
    await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }));
    await waitFor(() => expect($('modalSettings')).toBeNull());
    // Remove, from the section
    await press('genCoverRemove');
    await waitFor(() => expect(exportBook(desk.ydoc!).cover ?? null).toBeNull());
    expect(exportRun((cc) => cc.api.epubFiles('generic'))!.some((f) => f.path.includes('Images/cover'))).toBe(false);
    await waitFor(() => expect($('genCoverRemove')).toBeNull());
    expect($('genCoverThumb')!.querySelector('img')).toBeNull();
    // Make a Cover opens the maker
    await press('genCoverMake');
    await waitFor(() => expect($('modalCoverMaker')!.classList.contains('open')).toBe(true));
    await press('btnCmCancel');
    await waitFor(() => expect($('modalCoverMaker')!.classList.contains('open')).toBe(false));
  });
});
