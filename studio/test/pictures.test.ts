import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BLOBS, collectBlobs, exportBook, importBook, META, SECTIONS } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { createOracle } from '../src/generated/closure-oracle.js';
import { closureShare, loadClosure, setClosureT, type Closure, type HistoryEntry } from '../src/closure/index';
import { live, restoreDoc, saveNamed } from '../src/history/history';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { textArea } from '../src/editor/insert';
import { addPicture, bytesToBase64, imageById, pickerList, pictureSrc, setSectionKeys, sniffPicture, SHOW_MAX_PIXELS } from '../src/pictures/pictures';
import { libraryView, removePictures, undoRemoval } from '../src/pictures/imagelib';
import {
  imageInsertText, libAltOffer, removeToken, sceneAltOffer, sceneBreakAt, sceneEntry, scenesWith, scenesWithout, stockPicture, stockUrls, suggestVerdict, updateToken,
} from '../src/pictures/scene';
import { allowedStockUrl } from '../src/pictures/stock';
import { setSampleRecord } from '../src/sample/sample';
import { fixtures } from './fixtures';

/* Wave 2b: pictures, below the UI. 1.0's image library self-checks
   (images.usage.finds-every-role, images.delete.unused-undo,
   images.delete.used-clears-roles, images.cleanup.unused-only,
   images.delete.leaves-serialized-book) on 1.0's own fixture book, on the
   Y.Doc; constraint 14 (History restores the OLD pictures); constraint 15
   (only checked bytes are shown); and every handler 2.0 ports by hand
   against 1.0's own function through the test-only oracle module. */

type Rec = Record<string, unknown>;
let c: Closure;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
});

/** 1.0's FAKE_PNG (its self-checks' picture): a 1 × 1 PNG. */
const FAKE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** A PNG-headed picture of `n` bytes (w × h stated in its IHDR), distinct per seed: big enough (≥ 1,024 base64
 *  characters) to be stored once in `blobs` and named. */
function png(seed: number, n = 3000, w = 40, h = 30): string {
  const b = new Uint8Array(n);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  let x = seed * 2654435761 >>> 0;
  for (let i = 24; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = x >>> 24;
  }
  return bytesToBase64(b);
}

/* ---- 1.0's own fixture book (imglibCheckFixture), built with 1.0's buildEmptyBook / mkSection ---- */
function fixtureBook(big = false): Rec & { sections: Rec[] } {
  const b = c.api.buildEmptyBook() as Rec & { sections: Rec[]; meta: Rec };
  b.history = [];
  b.meta.title = 'Image Library Fixture';
  b.meta.author = 'Fixture Author';
  let seed = 1;
  const mk = (id: string, extra?: Rec) => ({ id, name: id + '.png', mediaType: 'image/png', ext: 'png', data: big ? png(seed++) : FAKE_PNG, ...extra });
  b.images = [
    mk('ilA'), mk('ilB'), mk('ilC'), mk('ilD'), mk('ilE'), mk('ilF'), mk('ilG'),
    mk('ilH', { flourish: true }), mk('ilI', { flourish: true }), mk('ilJ', { flourish: true }),
    mk('ilK', { data: btoa('imglib-unused-K-' + c.api.uid()) }), mk('ilL', { data: btoa('imglib-unused-L-' + c.api.uid()) }),
    mk('sample-img-ilS'),
  ];
  const ch1 = c.api.mkSection('body', 'chapter', 'Chapter Three', { number: '3', content: 'The harbour woke.\n\n![The ferry](img:ilA)\n\nGulls rose.' });
  const ch2 = c.api.mkSection('body', 'chapter', 'Chapter Five', { number: '5', content: 'First words.\n\n***\n\nAfter the break.', plateId: 'ilC', plateAlt: 'The plate', backdropId: 'ilD', backdropStrength: 'whisper' });
  ch2.scenes = [{ at: 0, imageId: 'ilE', name: 'Break', caption: '', alt: 'A scene' }];
  const fi = c.api.mkSection('front', 'frontispiece', 'Frontispiece', { content: '![The chart](img:ilB)' });
  const at = b.sections.findIndex((s) => s.type === 'chapter');
  b.sections.splice(at, 0, ch1, ch2);
  b.sections.splice(1, 0, fi);
  b.activeId = ch1.id;
  const api = c.api as unknown as Record<string, (...a: unknown[]) => Rec>;
  c.setState(b as never); // 1.0's fixture runs on its desk (applyBookDoc): the cover recipe reads the book's theme
  b.coverRecipe = api.normalizeCoverRecipe!(Object.assign(api.defaultCoverRecipe!(), { bgType: 'image', bgImageId: 'ilF' }));
  (b.coverRecipe as Rec).wrap = Object.assign(api.wrapDefaults!(), { binding: 'jacket', flapPhotoId: 'ilG' });
  b.cover = { data: FAKE_PNG, mediaType: 'image/png', ext: 'png', name: 'Made cover.png' };
  b.theme = Object.assign({}, b.theme as Rec, { ornament: 'fl:ilH', headingFlourish: 'ilI' });
  b.customThemes = [{ id: 'ilTheme', name: 'Harbour Theme', theme: Object.assign({}, b.theme as Rec, { ornament: 'fl:ilJ', headingFlourish: '' }) }];
  return b;
}
function fixtureDoc(big = false, sample = true): { ydoc: Y.Doc; ids: { ch1: string; ch2: string; fi: string } } {
  const b = fixtureBook(big);
  const ydoc = new Y.Doc();
  const r = importBook(b, ydoc);
  expect(r.status).toBe('ok');
  if (sample) setSampleRecord(ydoc, null); // 1.0's checks hold sampleState.loaded = true
  const secs = b.sections;
  return { ydoc, ids: { ch1: String(secs.find((s) => s.title === 'Chapter Three')!.id), ch2: String(secs.find((s) => s.title === 'Chapter Five')!.id), fi: String(secs.find((s) => s.type === 'frontispiece')!.id) } };
}
const json = (v: unknown) => JSON.stringify(v);
/** 1.0's imglibDeskJson: the book less History and activeId. */
const deskJson = (ydoc: Y.Doc) => {
  const d = exportBook(ydoc);
  delete d.history;
  delete d.historyPool;
  delete d.activeId;
  return json(d);
};
const sec = (ydoc: Y.Doc, id: string) => (exportBook(ydoc).sections as Rec[]).find((s) => s.id === id)!;
const history = (ydoc: Y.Doc): HistoryEntry[] => live(c, ydoc).state.history;
const alive = () => true;

describe("the image library: 1.0's own functions on the Y.Doc (inventory A8)", () => {
  it('images.usage.finds-every-role', () => {
    const { ydoc } = fixtureDoc();
    const v = libraryView(c, ydoc);
    const want: Rec = {
      ilA: 'text:Chapter Three', ilB: 'frontispiece:Frontispiece', ilC: 'plate:Chapter Five', ilD: 'backdrop:Chapter Five', ilE: 'scene:Chapter Five',
      ilF: 'cover:' + t('imglib.where.cover'), ilG: 'flap:' + t('imglib.where.cover'), ilH: 'ornament:' + t('imglib.where.styling'),
      ilI: 'headingFlourish:' + t('imglib.where.styling'), ilJ: 'ornament:' + t('imglib.where.theme', { name: 'Harbour Theme' }),
    };
    for (const [id, w] of Object.entries(want)) expect((v.usage[id] ?? []).map((u) => u.role + ':' + u.where).join('|'), id).toBe(w);
    expect(v.unused.map((im) => im.id).join(',')).toBe('ilK,ilL');
    expect(c.api.imglibUseText(v.usage.ilA![0]!)).toBe(t('imglib.useItem', { where: '⁨Chapter Three⁩', role: t('imglib.role.text') }));
    expect([...v.sample]).toEqual(['sample-img-ilS']);
    // art behind a solid cover reads as kept in the maker
    const r = structuredClone(ydoc.getMap<unknown>(META).get('coverRecipe')) as Rec;
    r.bgType = 'solid';
    ydoc.getMap<unknown>(META).set('coverRecipe', r);
    expect(libraryView(c, ydoc).usage.ilF!.map((u) => u.role).join(',')).toBe('coverKept');
  });

  it('images.delete.unused-undo: History first ("Before removing a picture"), out of the library, Undo puts it back in its place', () => {
    const { ydoc } = fixtureDoc();
    const order = (exportBook(ydoc).images as Rec[]).map((im) => im.id).join(',');
    const before = json(exportBook(ydoc));
    const rec = removePictures(c, ydoc, ['ilK'])!;
    expect(rec.used).toBe(false);
    expect((exportBook(ydoc).images as Rec[]).some((im) => im.id === 'ilK')).toBe(false);
    const snap = history(ydoc)[0]!;
    expect(snap.auto).toBe('imgremove');
    expect((snap.doc.images as Rec[]).some((x) => x.id === 'ilK')).toBe(true);
    expect(undoRemoval(c, ydoc, rec, alive)).toBe(true);
    expect((exportBook(ydoc).images as Rec[]).map((im) => im.id).join(',')).toBe(order);
    // everything but History is back exactly
    const a = JSON.parse(before) as Rec, b = exportBook(ydoc);
    delete a.history; delete a.historyPool; delete b.history; delete b.historyPool;
    expect(json(b)).toBe(json(a));
    expect(undoRemoval(c, ydoc, rec, alive)).toBe(false); // spent
  });

  it('images.delete.used-clears-roles: every role cleared as 1.0 clears it; Undo restores the book byte for byte', () => {
    const { ydoc, ids } = fixtureDoc();
    const before = deskJson(ydoc);
    const recs = [removePictures(c, ydoc, ['ilA'])!];
    expect(sec(ydoc, ids.ch1).content).toBe('The harbour woke.\n\nGulls rose.');
    for (const id of ['ilB', 'ilC', 'ilD', 'ilE', 'ilG']) recs.push(removePictures(c, ydoc, [id])!);
    const ch2 = sec(ydoc, ids.ch2);
    expect(String(sec(ydoc, ids.fi).content)).not.toContain('img:ilB');
    expect(ch2.plateId).toBe(null);
    expect(ch2.plateAlt).toBe('The plate');
    expect(ch2.backdropId).toBe(null);
    expect((ch2.scenes as unknown[]).length).toBe(0);
    let b = exportBook(ydoc);
    expect(((b.coverRecipe as Rec).wrap as Rec).flapPhotoId).toBe(null);
    expect(b.cover).not.toBe(null);
    recs.push(removePictures(c, ydoc, ['ilF'])!);
    b = exportBook(ydoc);
    expect(b.cover).toBe(null);
    expect(b.coverRecipe).toBe(null);
    for (const id of ['ilH', 'ilI', 'ilJ']) recs.push(removePictures(c, ydoc, [id])!);
    b = exportBook(ydoc);
    expect((b.theme as Rec).ornament).toBe('fleuron');
    expect((b.theme as Rec).headingFlourish).toBe('');
    expect(((b.customThemes as Rec[])[0]!.theme as Rec).ornament).toBe('fleuron');
    const left = Object.keys(libraryView(c, ydoc).usage).filter((id) => /^il[A-J]$/.test(id));
    expect(left).toEqual([]);
    // ten removals in a row with nothing else between: one snapshot (1.0's run)
    expect(history(ydoc).filter((s) => s.auto === 'imgremove').length).toBe(1);
    recs.reverse().forEach((r) => expect(undoRemoval(c, ydoc, r, alive)).toBe(true));
    expect(deskJson(ydoc)).toBe(before);
  });

  it('images.cleanup.unused-only: exactly the pictures nothing uses, never the sample\'s while it is on the desk', () => {
    const { ydoc } = fixtureDoc();
    const v = libraryView(c, ydoc);
    const bytes = c.api.imglibBytes(v.images.find((x) => x.id === 'ilK')) + c.api.imglibBytes(v.images.find((x) => x.id === 'ilL'));
    expect(t('imglib.cleanup', { n: v.unused.length, size: c.api.imglibSize(bytes) })).toBe('Remove unused pictures (2 · ⁦' + c.api.fmtBytes(bytes) + '⁩)');
    const keep = v.images.map((im) => im.id).filter((id) => id !== 'ilK' && id !== 'ilL').join(',');
    const rec = removePictures(c, ydoc, v.unused.map((im) => im.id))!;
    expect((exportBook(ydoc).images as Rec[]).map((im) => im.id).join(',')).toBe(keep);
    expect(history(ydoc)[0]!.auto).toBe('imgremove');
    expect(libraryView(c, ydoc).unused).toEqual([]);
    // a book that is not the sample: its sample-named picture may go like any other
    ydoc.getMap('next.device').clear();
    expect(libraryView(c, ydoc).unused.map((im) => im.id)).toEqual(['sample-img-ilS']);
    expect(undoRemoval(c, ydoc, rec, alive)).toBe(true);
    expect(imageById(ydoc, 'ilK')).not.toBe(null);
    expect(imageById(ydoc, 'ilL')).not.toBe(null);
  });

  it('images.delete.leaves-serialized-book: gone from the book, held once by History; a run shares a snapshot; an edit between starts a new one', () => {
    const { ydoc, ids } = fixtureDoc(true);
    const data = imageById(ydoc, 'ilK')!.data;
    removePictures(c, ydoc, ['ilK']);
    const doc = exportBook(ydoc);
    expect((doc.images as Rec[]).some((im) => im.id === 'ilK')).toBe(false);
    const noHist = { ...doc };
    delete noHist.history;
    delete noHist.historyPool;
    expect(json(noHist).includes(data)).toBe(false);
    const holders = c.api.normalizeHistory(doc.history, doc.historyPool).filter((s) => (s.doc.images as Rec[]).some((im) => im.id === 'ilK' && im.data === data)).length;
    expect(holders).toBe(1);
    expect(json(doc).split(data).length - 1).toBe(1); // in historyPool, once
    removePictures(c, ydoc, ['ilL']);
    expect(history(ydoc).filter((s) => s.auto === 'imgremove').length).toBe(1);
    // an edit between removals starts a fresh snapshot holding it
    setSectionKeys(ydoc, ids.ch1, { title: 'Chapter Three, again' });
    removePictures(c, ydoc, ['ilA']);
    const h = history(ydoc);
    expect(h.filter((s) => s.auto === 'imgremove').length).toBe(2);
    expect((h[0]!.doc.sections as Rec[]).some((s) => s.title === 'Chapter Three, again')).toBe(true);
    // the store holds each picture's bytes once (wave 1c's rule); its GC keeps a removed picture History still names
    collectBlobs(ydoc);
    const blobs = ydoc.getMap(BLOBS);
    const dataA = (h[0]!.doc.images as Rec[]).find((im) => im.id === 'ilA')!.data;
    expect(String(dataA).length).toBeGreaterThan(1024);
    expect([...blobs.values()].filter((b) => (b as Rec).data === dataA).length).toBe(1);
  });

  it('a sample picture and an unknown id are never removed (nothing written)', () => {
    const { ydoc } = fixtureDoc();
    const before = json(exportBook(ydoc));
    expect(removePictures(c, ydoc, ['sample-img-ilS'])).toBe(null);
    expect(removePictures(c, ydoc, ['nope'])).toBe(null);
    expect(json(exportBook(ydoc))).toBe(before);
  });

  it('Undo refuses a record of another book, or of a generation no longer live', () => {
    const { ydoc } = fixtureDoc();
    const other = fixtureDoc().ydoc;
    const rec = removePictures(c, ydoc, ['ilK'])!;
    expect(undoRemoval(c, other, rec, alive)).toBe(false);
    expect(undoRemoval(c, ydoc, rec, () => false)).toBe(false);
    expect(undoRemoval(c, ydoc, rec, alive)).toBe(true);
  });
});

describe('constraint 14: History keeps restoring the OLD pictures', () => {
  it('snapshot, replace a picture, restore: the export equals the original, picture bytes included', () => {
    const { ydoc, ids } = fixtureDoc(true, false);
    const original = exportBook(ydoc);
    const snap = saveNamed(c, ydoc, 'Before the swap');
    // replace the chapter's picture: the old one out of the book (every use), a new upload placed where it stood
    const oldData = imageById(ydoc, 'ilA')!.data;
    removePictures(c, ydoc, ['ilA']);
    addPicture(c, ydoc, { id: 'ilA2', name: 'new.png', mediaType: 'image/png', ext: 'png', data: png(999) });
    setSectionKeys(ydoc, ids.ch2, { plateId: 'ilA2' });
    expect(imageById(ydoc, 'ilA')).toBe(null);
    // and a picture whose bytes change under the same id
    addPicture(c, ydoc, { id: 'tmp', name: 't.png', mediaType: 'image/png', ext: 'png', data: png(1001) });
    const restored = restoreDoc(c, ydoc, snap.id)!;
    expect(restored).not.toBe(null);
    const a = { ...original }, b = { ...restored };
    for (const k of ['history', 'historyPool', 'importReport']) {
      delete a[k];
      delete b[k];
    }
    expect(json(b)).toBe(json(a));
    expect((b.images as Rec[]).find((im) => im.id === 'ilA')!.data).toBe(oldData);
    // and opened as a book (the restore's new generation is an import of it), it exports the same
    const y2 = new Y.Doc();
    importBook(restored, y2);
    const e2 = exportBook(y2);
    for (const k of ['history', 'historyPool', 'importReport']) delete e2[k];
    expect(json(e2)).toBe(json(a));
  });

  it('a restore after the library cleanup brings back the removed pictures exactly', () => {
    const { ydoc } = fixtureDoc(true, false);
    const original = exportBook(ydoc);
    const unused = libraryView(c, ydoc).unused.map((im) => im.id);
    expect(unused.length).toBeGreaterThan(0);
    removePictures(c, ydoc, unused);
    const snap = history(ydoc).find((s) => s.auto === 'imgremove')!;
    const restored = restoreDoc(c, ydoc, snap.id)!;
    const a = { ...original }, b = { ...restored };
    for (const k of ['history', 'historyPool', 'importReport']) {
      delete a[k];
      delete b[k];
    }
    expect(json(b)).toBe(json(a));
  });

  it('the store: an added picture is stored once and named; the book exports byte-identical before and after a round trip', () => {
    const { ydoc } = fixtureDoc(true, false);
    const data = png(4242, 6000);
    addPicture(c, ydoc, { id: 'up1', name: 'up.png', mediaType: 'image/png', ext: 'png', data });
    const stored = (ydoc.getMap<unknown>(META).get('images') as Rec[]).find((im) => im.id === 'up1')!;
    expect(String(stored.data).startsWith('beuk-pic:')).toBe(true);
    expect(imageById(ydoc, 'up1')!.data).toBe(data);
    const out = exportBook(ydoc);
    const y2 = new Y.Doc();
    importBook(out, y2);
    expect(json(exportBook(y2))).toBe(json(out));
  });
});

describe('constraint 15: only bytes 2.0 has checked are shown', () => {
  const jpeg = (w: number, h: number) => {
    const b = new Uint8Array(64);
    b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    b.set([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3], 20);
    return bytesToBase64(b);
  };
  it('JPEG, PNG, GIF, WebP and SVG by their bytes; the URL is typed by the bytes, not the book', () => {
    expect(pictureSrc({ mediaType: 'image/png', data: FAKE_PNG })).toBe('data:image/png;base64,' + FAKE_PNG);
    expect(pictureSrc({ mediaType: 'image/jpeg', data: FAKE_PNG })).toBe('data:image/png;base64,' + FAKE_PNG); // a PNG called JPEG
    expect(sniffPicture(jpeg(640, 480))).toBe('image/jpeg');
    expect(sniffPicture(btoa('GIF89a\x10\x00\x10\x00' + '\0'.repeat(20)))).toBe('image/gif');
    const svg = btoa('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(pictureSrc({ mediaType: 'image/svg+xml', data: svg })).toBe('data:image/svg+xml;base64,' + svg);
    expect(pictureSrc({ mediaType: 'image/png', data: svg })).toBe(null); // SVG text is only read as SVG when the book says so
  });
  it('refused: malformed base64, HTML, text, an empty string, a pixel bomb', () => {
    expect(pictureSrc({ mediaType: 'image/png', data: 'not base64 at all!' })).toBe(null);
    expect(pictureSrc({ mediaType: 'image/png', data: FAKE_PNG.slice(0, -1) })).toBe(null);
    expect(pictureSrc({ mediaType: 'image/svg+xml', data: btoa('<html><body><script>alert(1)</script></body></html>') })).toBe(null);
    expect(pictureSrc({ mediaType: 'text/html', data: btoa('<img src=x onerror=alert(1)>') })).toBe(null);
    expect(pictureSrc({ mediaType: 'image/png', data: '' })).toBe(null);
    expect(pictureSrc({ mediaType: 'image/png', data: 42 })).toBe(null);
    expect(pictureSrc(null)).toBe(null);
    expect(sniffPicture(png(1, 200, 30000, 30000))).toBe(null);
    expect(sniffPicture(jpeg(20000, 20000))).toBe(null);
    expect(sniffPicture(png(1, 200, 8000, 8000))).toBe('image/png');
    expect(8000 * 8000).toBeLessThanOrEqual(SHOW_MAX_PIXELS);
  });
  it('fix round 1: a JPEG whose frame header lies past 64 kB (a big APP segment before it) is found, and the cap still holds', () => {
    const mk = (w: number, h: number, appBytes: number) => {
      // APP1 (EXIF-like) segments of at most 65,533 data bytes each, then the frame header, then the end
      const segs: number[] = [];
      for (let left = appBytes; left > 0; left -= 65533) segs.push(Math.min(left, 65533));
      const out = new Uint8Array(2 + segs.reduce((a, n) => a + 4 + n, 0) + 19 + 2);
      out.set([0xff, 0xd8], 0);
      let o = 2;
      for (const n of segs) {
        out.set([0xff, 0xe1, (n + 2) >> 8, (n + 2) & 255], o);
        o += 4 + n;
      }
      out.set([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3], o);
      out.set([0xff, 0xd9], o + 19);
      return bytesToBase64(out);
    };
    const far = mk(640, 480, 200_000);
    expect(far.length).toBeGreaterThan(4 * 64 * 1024 / 3);
    expect(sniffPicture(far)).toBe('image/jpeg');
    expect(sniffPicture(mk(20000, 20000, 200_000))).toBe(null);
    // a scan before any frame header, and a broken segment length: not a picture 2.0 shows
    const noSof = bytesToBase64(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, 0xff, 0xd9, 0, 0]));
    expect(sniffPicture(noSof)).toBe(null);
  });

  it('an oversized picture (30 MB of base64) is checked and shown without decoding it all', () => {
    const big = png(3, 22 * 1024 * 1024);
    const t0 = performance.now();
    expect(pictureSrc({ mediaType: 'image/png', data: big })).toBe('data:image/png;base64,' + big);
    const ms = performance.now() - t0;
    console.log(`pictureSrc on ${big.length} base64 characters: ${ms.toFixed(0)} ms`);
    // the second time is the memo's (no new copy of the bytes)
    expect(pictureSrc({ mediaType: 'image/png', data: big })).toBe(pictureSrc({ mediaType: 'image/png', data: big }));
  });
});

describe("the handlers 2.0 ports by hand equal 1.0's own (oracle module)", () => {
  type El = { id: string; value: string; textContent: string; innerHTML: string; placeholder: string; disabled: boolean; style: Rec; classList: { add: (x: string) => void; remove: (x: string) => void; contains: (x: string) => boolean }; focus: () => void; setAttribute: (k: string, v: string) => void; getAttribute: (k: string) => string | null; appendChild: () => void; querySelectorAll: () => unknown[] };
  function fakeEls() {
    const els: Record<string, El> = {};
    const el = (id: string): El => {
      if (!els[id]) {
        const cls = new Set<string>();
        const attrs: Record<string, string> = {};
        els[id] = { id, value: '', textContent: '', innerHTML: '', placeholder: '', disabled: false, style: {}, classList: { add: (x) => cls.add(x), remove: (x) => cls.delete(x), contains: (x) => cls.has(x) }, focus: () => undefined, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null, appendChild: () => undefined, querySelectorAll: () => [] };
      }
      return els[id]!;
    };
    return { els, el };
  }
  function oracle(state: Rec, active: Rec | null, area?: ReturnType<typeof textArea>) {
    const { el } = fakeEls();
    const prev = c.getState();
    c.setState(state as never);
    const toasts: string[] = [];
    const o = createOracle(closureShare()!, {
      $: (id: string) => (id === 'editorArea' && area ? area : el(id)),
      activeSection: () => active,
      editorViewSnapshot: () => null,
      editorViewRestore: () => undefined,
      icons: () => undefined,
      withEditorView: (fn: () => unknown) => fn(),
      updateStats: () => undefined,
      renderPreview: () => undefined,
      renderSectionImages: () => undefined,
      zenRenderSurface: () => undefined,
      updateSceneBar: () => undefined,
      refreshExportTree: () => undefined,
      renderSceneLib: () => undefined,
      renderImgLib: () => undefined,
      refreshImagePickers: () => undefined,
      document: { createElement: () => ({ appendChild: () => undefined, addEventListener: () => undefined }) },
    });
    return { o, el, toasts, done: () => c.setState(prev as never) };
  }

  const TEXTS = [
    'Opening words stand here.\n\n***\n\nMiddle words.\n\n***\n\nClosing.',
    '***',
    'a\n\n\n***\n\n\n#\n\n---\n\n___\n\n❦\n\n⁂\n\nend',
    'no breaks here at all',
    'x\n\n  ***  \n\ny\n\n* * *\n\nz',
    'one\r\n\r\n***\r\n\r\ntwo',
    '',
  ];
  it('sceneBreakAt equals sceneBreakAtCursor at every caret of every text', () => {
    let n = 0;
    for (const text of TEXTS) {
      for (let pos = 0; pos <= text.length; pos++) {
        const area = textArea(text, pos, pos);
        const sec = { id: 's', kind: 'body', type: 'chapter', content: text };
        const { o, done } = oracle({ meta: {}, sections: [sec] }, sec, Object.assign(area, { id: 'editorArea' }) as never);
        try {
          const want = o.sceneBreakAtCursor!() as { at: number; total: number } | null;
          const got = sceneBreakAt(c.api, text, pos);
          expect(got, JSON.stringify([text, pos])).toEqual(want ? { at: want.at, total: want.total } : null);
          n++;
        } finally {
          done();
        }
      }
    }
    expect(n).toBeGreaterThan(150);
  });

  const MARKED = [
    'The harbour woke.\n\n![The ferry](img:ilA)\n\nGulls rose.',
    '![a](img:x1)\n\n![b](img:x2|full "A cap")\n\ntext\n\n![c](img:x3 “curly”)',
    '  ![padded](img:p1)  \n\nafter',
    'start\n![inline line](img:q1)\nend',
    '![only](img:o1)',
  ];
  it('the section card: updateToken / removeToken equal 1.0\'s updateImageToken / removeImageToken', () => {
    const patches: Rec[] = [{ alt: 'New alt' }, { caption: 'A caption' }, { caption: '' }, { full: true }, { full: false }, { alt: '', caption: 'x "y" z' }];
    let n = 0;
    for (const text of MARKED) {
      const count = c.api.imageTokensIn(text).length;
      for (let i = 0; i < count; i++) {
        for (const patch of [...patches, null]) {
          const sec: Rec = { id: 's', kind: 'body', type: 'chapter', content: text };
          const area = Object.assign(textArea(text, 0, 0), { id: 'editorArea' });
          const { o, done } = oracle({ meta: {}, sections: [sec] }, sec, area as never);
          try {
            const p = patch ? { ...patch } : null;
            if (p && 'caption' in p) p.caption = c.api.cleanCaption(p.caption);
            if (p) o.updateImageToken!(i, p);
            else o.removeImageToken!(i);
            const got = p ? updateToken(c.api, text, i, p) : removeToken(c.api, text, i);
            expect(got, JSON.stringify([text, i, patch])).toBe(sec.content);
            n++;
          } finally {
            done();
          }
        }
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it('the scene picker: attach, replace, detach and the bar\'s Remove equal 1.0\'s handlers (state and text)', () => {
    const images = [
      { id: 'scimg1', name: 'First Bay.png', mediaType: 'image/png', ext: 'png', data: FAKE_PNG },
      { id: 'scimg2', name: 'Second_Bay—dusk.png', mediaType: 'image/png', ext: 'png', data: FAKE_PNG },
    ];
    const text = 'Opening.\n\n***\n\nMiddle.\n\n***\n\nClosing.';
    const cases: { at: number; img: string; name: string; alt: string; caption: string; pre?: Rec[] }[] = [
      { at: 0, img: 'scimg1', name: ' The First Bay ', alt: 'The first bay at dawn', caption: ' The first bay. ' },
      { at: 1, img: 'scimg2', name: '', alt: '  [odd] (alt)\n text ', caption: '', pre: [{ at: 0, imageId: 'scimg1', name: 'x', caption: '', alt: 'y' }] },
      { at: 0, img: 'scimg2', name: 'n', alt: 'replaced', caption: 'c', pre: [{ at: 0, imageId: 'scimg1', name: 'x', caption: '', alt: 'y' }, { at: 1, imageId: 'scimg2', name: '', caption: '', alt: 'z' }] },
      { at: 1, img: 'scimg1', name: '', alt: '   ', caption: '' }, // an empty alt: the picture's name is offered
    ];
    for (const k of cases) {
      const sec: Rec = { id: 'sx', kind: 'body', type: 'chapter', title: 'T', content: text, ...(k.pre ? { scenes: structuredClone(k.pre) } : {}) };
      const { o, el, done } = oracle({ meta: {}, images, sections: [sec] }, sec);
      try {
        o.openScenePicker!(k.at);
        el('sceneName').value = k.name;
        el('sceneAlt').value = k.alt;
        el('sceneCaption').value = k.caption;
        o.sceneSelectImage!(k.img);
        const want = sec.scenes;
        o.confirmSceneImage!();
        // 2.0's picker offers the alt the same way when the picture is chosen with the field empty (sceneSelectImage)
        const alt = k.alt.trim() ? k.alt : sceneAltOffer(c.api, images.find((im) => im.id === k.img)!.name);
        const entry = sceneEntry(c.api, k.at, k.img, { name: k.name, alt, caption: k.caption });
        const got = entry ? scenesWith(k.pre ? structuredClone(k.pre) : undefined, entry) : (want ?? undefined);
        expect(got, JSON.stringify(k)).toEqual(sec.scenes);
        expect(sec.content).toBe(text); // the manuscript text never changes
      } finally {
        done();
      }
    }
    // detach (the picker's Remove) and the bar's Remove
    for (const at of [0, 1, 2]) {
      const pre = [{ at: 0, imageId: 'scimg1', name: '', caption: '', alt: 'a' }, { at: 1, imageId: 'scimg2', name: '', caption: '', alt: 'b' }];
      const sec: Rec = { id: 'sx', kind: 'body', type: 'chapter', content: text, scenes: structuredClone(pre) };
      const { o, done } = oracle({ meta: {}, images, sections: [sec] }, sec);
      try {
        o.openScenePicker!(at);
        o.detachSceneImage!();
        expect(scenesWithout(c.api, { scenes: structuredClone(pre) }, at) ?? pre).toEqual(sec.scenes);
      } finally {
        done();
      }
      const sec2: Rec = { id: 'sx', kind: 'body', type: 'chapter', content: text, scenes: structuredClone(pre) };
      const pos = [text.indexOf('***'), text.lastIndexOf('***'), 0][at]!;
      const area = Object.assign(textArea(text, pos + 1, pos + 1), { id: 'editorArea' });
      const r2 = oracle({ meta: {}, images, sections: [sec2] }, sec2, area as never);
      try {
        r2.o.removeSceneAtCursor!();
        const info = sceneBreakAt(c.api, text, pos + 1);
        const mine = info ? scenesWithout(c.api, { scenes: structuredClone(pre) }, info.at) : null;
        expect(mine ?? pre).toEqual(sec2.scenes);
      } finally {
        r2.done();
      }
    }
  });

  it('the alt texts 1.0 offers when a picture is chosen (selectLibImage\'s placeholder, sceneSelectImage\'s value)', () => {
    const names = ['First Bay.png', 'harbour-chart_v2.jpeg', 'The—Long—Night.png', 'no extension', '', '[x](y).png', 'a.b.c.png'];
    for (const name of names) {
      const images = [{ id: 'i1', name, mediaType: 'image/png', data: FAKE_PNG }];
      const { o, el, done } = oracle({ meta: {}, images, sections: [] }, null);
      try {
        el('imgAlt').value = '';
        o.selectLibImage!('i1');
        expect(libAltOffer(name), name).toBe(el('imgAlt').placeholder);
        o.openScenePicker!(0); // activeSection null: 1.0 returns
      } finally {
        done();
      }
      for (const hint of [undefined, '', 'A stock photo’s own words', '  [b] (c) ']) {
        const sec = { id: 's', kind: 'body', type: 'chapter', content: '***' };
        const r = oracle({ meta: {}, images, sections: [sec] }, sec);
        try {
          r.o.openScenePicker!(0);
          r.el('sceneAlt').value = '';
          r.o.sceneSelectImage!('i1', hint);
          expect(sceneAltOffer(c.api, name, hint), JSON.stringify([name, hint])).toBe(r.el('sceneAlt').value);
        } finally {
          r.done();
        }
      }
    }
  });

  it('Suggest by name: the verdicts of sceneRenderSuggestResults, the stock picture of sceneStockLanded, the download order', () => {
    const answers: unknown[] = [null, { __status: 501, __error: 'x' }, { __error: 'boom', __status: 500 }, { photos: [] }, {}, { photos: [{ photographer: 'Ann', src: { medium: 'https://images.pexels.com/m.jpg' } }] }];
    for (const res of answers) {
      const { o, el, done } = oracle({ meta: {}, images: [], sections: [] }, null);
      try {
        const want = o.sceneRenderSuggestResults!(res);
        const got = suggestVerdict(res);
        expect(got.kind).toBe(want);
        expect(got.statusKey ? t(got.statusKey) : '').toBe(el('sceneSuggestStatus').textContent);
      } finally {
        done();
      }
    }
    const photos = [
      { photographer: 'Ann Lee', pageUrl: 'https://www.pexels.com/p/1', provider: 'Pexels', alt: 'Harbour', src: { original: 'https://images.pexels.com/o.jpg', large: 'https://images.pexels.com/l.jpg', medium: 'https://images.pexels.com/m.jpg' } },
      { photographerUrl: 'https://x.example/u', provider: 'Openverse', src: { original: 'https://x.example/full.jpg', large: 'https://x.example/full.jpg', medium: 'https://api.openverse.org/v1/images/1/thumb/' } },
      { src: {} },
    ];
    for (const ph of photos) {
      for (const type of ['image/png', 'image/jpeg', '']) {
        const sec = { id: 's', kind: 'body', type: 'chapter', content: '***' };
        const st: Rec = { meta: {}, images: [], sections: [sec] };
        const { o, done } = oracle(st, sec);
        try {
          o.openScenePicker!(0);
          const im = o.sceneStockLanded!(ph, { type }, FAKE_PNG) as Rec;
          expect(stockPicture(String(im.id), ph, type, FAKE_PNG)).toEqual(im);
          expect(st.images).toEqual([im]);
        } finally {
          done();
        }
      }
    }
    expect(stockUrls(photos[0]!)).toEqual(['https://images.pexels.com/o.jpg', 'https://images.pexels.com/l.jpg', 'https://images.pexels.com/m.jpg']);
    expect(stockUrls(photos[1]!).filter(allowedStockUrl)).toEqual(['https://api.openverse.org/v1/images/1/thumb/']);
    expect(allowedStockUrl('javascript:alert(1)')).toBe(false);
    expect(allowedStockUrl('http://images.pexels.com/x')).toBe(false);
  });

  it("Insert Image: the marker 1.0's button places (alt from the field, else the picture's name, else \"Image\")", () => {
    const cases: [Rec, { alt: string; caption: string; full: boolean }, string][] = [
      [{ id: 'a1', name: 'harbour-chart.png' }, { alt: '', caption: '', full: false }, '\n\n![harbour chart](img:a1)\n\n'],
      [{ id: 'a1', name: 'x.png' }, { alt: 'The [old] (chart)', caption: ' A "quoted" cap ', full: true }, '\n\n![The old chart](img:a1|full "A quoted cap")\n\n'],
      [{ id: 'a1', name: '' }, { alt: '  ', caption: '', full: false }, '\n\n![Image](img:a1)\n\n'],
    ];
    for (const [im, f, want] of cases) expect(imageInsertText(c.api, im as never, f)).toBe(want);
    // the marker reads back as one image node and round-trips
    const y = new Y.Doc();
    importBook({ sections: [{ id: 's', kind: 'body', type: 'chapter', content: 'a' + cases[1]![2] + 'b' }] }, y);
    expect((exportBook(y).sections as Rec[])[0]!.content).toBe('a' + cases[1]![2] + 'b');
  });
});

describe('the pickers and the no-edit rule', () => {
  it("pickerList equals 1.0's pickerImages on the whole book (text included), on every real fixture", () => {
    for (const f of fixtures('real')) {
      const y = new Y.Doc();
      importBook(f.book, y);
      const full = exportBook(y);
      c.setState(structuredClone(full) as never);
      const want = (c.api.pickerImages() as Rec[]).map((im) => im.id);
      expect(pickerList(c, y).map((im) => im.id), f.name).toEqual(want);
    }
  });

  it('reading the library and the pickers writes nothing (every real fixture)', () => {
    for (const f of fixtures('real')) {
      const y = new Y.Doc();
      importBook(f.book, y);
      const before = json(exportBook(y));
      const sv = Y.encodeStateVector(y);
      libraryView(c, y);
      pickerList(c, y);
      for (const im of (exportBook(y).images as Rec[]) ?? []) pictureSrc(im);
      expect(json(exportBook(y)), f.name).toBe(before);
      expect(Y.encodeStateVector(y), f.name).toEqual(sv);
    }
  });

  it('a book with a malformed, a hostile and an oversized picture opens, lists and removes without throwing', () => {
    const b = fixtureBook();
    (b.images as Rec[]).push(
      { id: 'bad1', name: 'bad.png', mediaType: 'image/png', data: '%%%not-base64%%%' },
      { id: 'bad2', name: 'evil.svg', mediaType: 'image/svg+xml', ext: 'svg', data: btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>') },
      { id: 'bad3', name: 'big.png', mediaType: 'image/png', data: png(7, 3 * 1024 * 1024) },
      { id: 'bad4', name: 'bomb.png', mediaType: 'image/png', data: png(8, 500, 50000, 50000) },
    );
    const y = new Y.Doc();
    expect(importBook(b, y).status).toBe('ok');
    const v = libraryView(c, y);
    expect(v.unused.map((im) => im.id)).toEqual(['ilK', 'ilL', 'sample-img-ilS', 'bad1', 'bad2', 'bad3', 'bad4']); // not the sample's desk
    expect(pictureSrc(imageById(y, 'bad1'))).toBe(null);
    expect(pictureSrc(imageById(y, 'bad2'))!.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(pictureSrc(imageById(y, 'bad4'))).toBe(null);
    const rec = removePictures(c, y, ['bad1', 'bad2', 'bad3', 'bad4'])!;
    expect(rec.ids.length).toBe(4);
    expect(undoRemoval(c, y, rec, alive)).toBe(true);
    expect((exportBook(y).images as Rec[]).map((im) => im.id).slice(-4)).toEqual(['bad1', 'bad2', 'bad3', 'bad4']);
    expect(y.getArray(SECTIONS).length).toBeGreaterThan(0);
  });
});
