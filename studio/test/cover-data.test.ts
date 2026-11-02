import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleRelease, styleReset, styleRun, styleState } from '../src/style/session';
import { coverClear, coverUpload } from '../src/cover/cover';
import { fixtures } from './fixtures';
import { PNG_1PX } from './style-fixture';

/* Wave 4c, task 1 — constraint 42 (review focus #2): the cover's data is 1.0's. `state.cover`, `state.coverRecipe` (with
   `.wrap`) and the pictures the maker adds live in the Y meta map / the picture store exactly as 1.0's serializeBook
   writes them: a session that only reads (every fixture) writes nothing; "Use as My Cover" (1.0's adoptCoverRecipe on
   its own state), an uploaded cover (1.0's #coverInput lines) and Remove (1.0's clearCover) write what 1.0 writes, and
   readBook reads it back; History is packed again when the cover changes (its snapshots name the live cover).
   Constraint 43 (review focus #3): the recipe on the safe path — font names, colours. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => styleRelease());
afterEach(() => {
  desk.ydoc = null;
});

const book = (name: string) => structuredClone(fixtures('all').find((f) => f.name === name)!.book) as Rec;
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  return y;
};
const want = (doc: Rec, out?: Rec) => {
  const r = readBook(doc);
  const w = JSON.parse(JSON.stringify(r.book)) as Rec & { meta: Rec };
  if (out && r.upgrades.includes('bookid-missing')) w.meta.bookId = (out.meta as Rec).bookId; // readBook mints one
  return w;
};
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==';
const fakeCanvas = () => ({ toDataURL: () => 'data:image/jpeg;base64,' + JPEG }) as unknown as HTMLCanvasElement;

describe("wave 4c: the cover's data is 1.0's (constraint 42)", () => {
  it('on every fixture a cover session that only reads (the maker opened, drawn, its recipe read) writes nothing', () => {
    for (const f of fixtures('all')) {
      if (!Array.isArray(f.book.sections)) continue;
      const y = onDesk(structuredClone(f.book));
      const before = Y.encodeStateVector(y);
      styleRun((cc) => {
        const s = cc.getState() as Rec;
        cc.vars.cmRecipe = s.coverRecipe ? cc.api.normalizeCoverRecipe(JSON.parse(JSON.stringify(s.coverRecipe))) : (cc.api as unknown as { defaultCoverRecipe: () => Rec }).defaultCoverRecipe();
        cc.api.imCoverFollowBook(cc.vars.cmRecipe);
        cc.api.wrapDims(cc.vars.cmRecipe);
        cc.api.wrapPictureIds(cc.vars.cmRecipe);
      });
      expect(Buffer.from(Y.encodeStateVector(y)).equals(Buffer.from(before)), f.name).toBe(true);
      const out = exportBook(y);
      expect(out, f.name).toEqual(want(f.book, out));
      y.destroy();
      styleRelease();
    }
  });

  it("Use as My Cover writes state.cover and state.coverRecipe as serializeBook writes them; readBook reads them back; History packed again", () => {
    const doc = book('real/lantern-coast-book-one');
    const y = onDesk(doc);
    const recipe = styleRun((cc) => {
      const s = cc.getState() as Rec;
      const r = cc.api.normalizeCoverRecipe(JSON.parse(JSON.stringify(s.coverRecipe))) as Rec & { wrap: Rec };
      r.title = 'A New Title';
      r.layout = 'banded';
      r.wrap.binding = 'jacket';
      r.wrap.flapFront = 'About the book';
      cc.api.adoptCoverRecipe(r, fakeCanvas());
      return r;
    })!;
    const out = exportBook(y);
    const s = styleState() as Rec;
    expect(out.cover).toEqual({ data: JPEG, mediaType: 'image/jpeg', ext: 'jpg', name: c.api.slug((doc.meta as Rec).title) + '-cover.jpg' });
    expect(out.coverRecipe).toEqual(JSON.parse(JSON.stringify(c.api.normalizeCoverRecipe(s.coverRecipe))));
    expect((out.coverRecipe as Rec).title).toBe('A New Title');
    expect(((out.coverRecipe as Rec).wrap as Rec).binding).toBe('jacket');
    expect((out.coverRecipe as Rec).bookText).toEqual(c.api.imBookCoverText());
    void recipe;
    const r = readBook(out);
    expect(r.status).toBe('ok');
    expect(JSON.parse(JSON.stringify(r.book))).toEqual(out);
    // the key order serializeBook writes: cover and coverRecipe where the book already had them
    expect(Object.keys(out)).toEqual(Object.keys(want(doc)));
    // History's snapshots name the live cover ({ ref: "cover" }): packed again with the new one, they still read
    const hist = c.api.normalizeHistory(out.history, out.historyPool);
    expect(hist.length).toBe(c.api.normalizeHistory(want(doc).history, want(doc).historyPool).length);
    y.destroy();
  });

  it("an uploaded cover (1.0's #coverInput) replaces the cover and supersedes the recipe; Remove (clearCover) takes both away", async () => {
    const doc = book('real/lantern-coast-book-one');
    const y = onDesk(doc);
    const toasts: string[] = [];
    const bytes = Uint8Array.from(atob(PNG_1PX), (ch) => ch.charCodeAt(0));
    await coverUpload(new File([bytes], 'my-cover.png', { type: 'image/png' }), (m) => toasts.push(m));
    let out = exportBook(y);
    expect(out.cover).toEqual({ data: PNG_1PX, mediaType: 'image/png', ext: 'png', name: 'my-cover.png' });
    expect(out.coverRecipe).toBeNull();
    expect(toasts).toEqual([t('toast.coverAdded')]);
    expect(readBook(out).status).toBe('ok');
    // a type 1.0 refuses: nothing written, 1.0's toast
    await coverUpload(new File([new Uint8Array([1, 2, 3])], 'x.gif', { type: 'image/gif' }), (m) => toasts.push(m));
    expect(exportBook(y).cover).toEqual(out.cover);
    expect(toasts[1]).toBe(t('toast.coverType'));
    coverClear((m) => toasts.push(m));
    out = exportBook(y);
    expect(out.cover).toBeNull();
    expect(out.coverRecipe).toBeNull();
    expect(toasts[2]).toBe(t('toast.coverRemoved'));
    expect(readBook(out).status).toBe('ok');
    y.destroy();
  });

  it('a cover hidden from 1.0 (not plain data) stays in the book through other edits; Remove still takes it away', () => {
    const doc = book('real/lantern-coast-book-one');
    const bad = { data: 'AAA" onerror="window.__x=1', mediaType: 'image/jpeg', ext: 'jpg', name: 'bad.jpg' };
    doc.cover = bad;
    const y = onDesk(doc);
    expect((styleRun((cc) => cc.getState()) as Rec).cover).toBeNull();
    styleRun((cc) => {
      (cc.getState() as unknown as Rec & { theme: Rec }).theme.fontSize = 19;
    });
    expect(exportBook(y).cover).toEqual(bad);
    coverClear(() => undefined);
    expect(exportBook(y).cover).toBeNull();
    y.destroy();
  });
});

describe('wave 4c: the recipe on the safe path (constraint 43)', () => {
  it("font names that are not a cover face or a shown upload become 1.0's defaults; colours that are not plain become the default recipe's; the book keeps what it stores", () => {
    const doc = book('real/lantern-coast-book-one');
    const evil = "EB Garamond'; } body { display: none } .x { font-family: '";
    doc.fonts = [{ id: 'fbad', name: 'b.ttf', family: evil, ext: 'ttf', mediaType: 'font/ttf', data: 'AAAA' }];
    const r = doc.coverRecipe as Rec & { elements: Record<string, Rec>; wrap: Rec };
    r.bgColor = 'red; background: url(https://evil.example/c.png)';
    r.bgColor2 = '#c9a959';
    r.elements.title!.font = evil;
    r.elements.title!.color = 'url(https://evil.example/t.png)';
    r.elements.author!.color = '#faf6ec';
    r.wrap = { ...r.wrap, spine: { font: evil, color: '#123456' }, back: { font: evil } };
    const y = onDesk(doc);
    const s = styleRun((cc) => cc.getState() as unknown as Rec & { coverRecipe: Rec & { elements: Record<string, Rec>; wrap: Rec & { spine: Rec; back: Rec } } })!;
    const d = styleRun((cc) => (cc.api as unknown as { defaultCoverRecipe: () => Rec & { elements: Record<string, Rec> } }).defaultCoverRecipe())!;
    expect(s.coverRecipe.elements.title!.font).toBe(d.elements.title!.font);
    expect(s.coverRecipe.elements.title!.color).toBe(d.elements.title!.color);
    expect(s.coverRecipe.elements.author!.color).toBe('#faf6ec');
    expect(s.coverRecipe.bgColor).toBe(d.bgColor);
    expect(s.coverRecipe.bgColor2).toBe('#c9a959');
    expect(s.coverRecipe.wrap.spine.font).toBe('');
    expect(s.coverRecipe.wrap.back.font).toBe('');
    expect(s.coverRecipe.wrap.spine.color).toBe('#123456');
    for (const k of c.api.CM_ELEMENTS) expect(c.api.COVER_FONTS.includes(String(s.coverRecipe.elements[k]!.font)), k).toBe(true);
    // read only: the book is unchanged
    expect(exportBook(y)).toEqual(want(doc));
    // the coverImgCache has no prototype (a picture id is a key: never Object.prototype's), as the server's
    expect(Object.getPrototypeOf(c.api.coverImgCache)).toBeNull();
    y.destroy();
  });
});
