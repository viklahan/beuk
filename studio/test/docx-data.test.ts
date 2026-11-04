import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, exportResume, exportRun, exportState, loadSerialize, volumeFromFile } from '../src/export/state';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';

/* Wave 5c, task 1 — constraints 65, 66 (review focus #2): THE SETTINGS ARE 1.0's DATA.
   - state.manuscript (the contact block, pen name, surname, paper, font, italics) and state.audio (the narrator, the
     format, the rights line, the sections switched on or off, the pronunciation guide, the dismissed words) are what
     1.0's applyBookDoc makes of the stored value (msNormalize, acxNormalize, 1.0's clamps) and are written back where
     serializeBook writes them, in its shape. Changed and put back, the book is as it was (constraint 68): a key the
     book never stored stays absent.
   - state.boxSetVolumes is 1.0's session-only list (serializeBook never writes it; applyBookDoc clears it when another
     book arrives): 2.0 keeps it for the open book across the session's rebuilds and never writes it into the book.
   - The builders and the ACX readiness checks write nothing. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let ser: (c: Closure) => Rec;
beforeAll(async () => {
  // wave 6: Add a Book's volumes are 1.0's own (src/import/import.ts importWire wires them)
  await (await import('../src/import/import')).importWire();
  c = await loadClosure();
  ser = await loadSerialize();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
});
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  exportReset();
  return y;
};
const want = (doc: Rec, out?: Rec) => {
  const r = readBook(doc);
  const w = JSON.parse(JSON.stringify(r.book)) as Rec & { meta: Rec };
  if (out && r.upgrades.includes('bookid-missing')) w.meta.bookId = (out.meta as Rec).bookId;
  return w;
};
const set = (fn: (st: Rec) => void) => exportRun((cc) => fn(cc.getState() as Rec));
const withSections = () => fixtures('all').filter((f) => Array.isArray(f.book.sections));
const sv = (y: Y.Doc) => Buffer.from(Y.encodeStateVector(y)).toString('base64');
const backupFile = (book: Rec, name: string) => new File([JSON.stringify({ format: 'beuk-backup', book })], name, { type: 'application/json' });

describe("wave 5c: the manuscript, the audio plan and the box set are 1.0's data (constraints 65, 66)", () => {
  it("on every fixture: state.manuscript and state.audio are serializeBook's, in its places", () => {
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      const one = exportRun((cc) => ser(cc))!;
      const st = exportState() as unknown as Rec;
      expect(c.api.msNormalize(st.manuscript), f.name).toEqual(one.manuscript);
      expect(c.api.acxNormalize(st.audio), f.name).toEqual(one.audio);
      expect(Object.keys(one).slice(-3), f.name).toEqual(['audio', 'manuscript', 'dictation']);
      y.destroy();
    }
  }, 240_000);

  it('a setting changed is written as serializeBook writes it, in its place, and 1.0 reads it back', () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = onDesk(structuredClone(f.book));
    const orig = exportBook(y) as Rec;
    set((st) => {
      st.manuscript = c.api.msNormalize(Object.assign({}, st.manuscript, { paper: 'a4', legalName: 'Ada Quill', italics: 'underline' }));
      (st.audio as Rec).narrator = 'Rae North';
      ((st.audio as Rec).include as Rec)['x1'] = false;
    });
    const out = exportBook(y) as Rec;
    expect(out.manuscript).toEqual(c.api.msNormalize({ ...(orig.manuscript as Rec), paper: 'a4', legalName: 'Ada Quill', italics: 'underline' }));
    expect((out.audio as Rec).narrator).toBe('Rae North');
    expect(((out.audio as Rec).include as Rec).x1).toBe(false);
    expect(Object.keys(out)).toEqual(Object.keys(orig));
    const back = arriveForExport(c, out) as Rec;
    expect([(back.manuscript as Rec).paper, (back.manuscript as Rec).legalName, (back.audio as Rec).narrator]).toEqual(['a4', 'Ada Quill', 'Rae North']);
    // 1.0's clamps hold on what 2.0 reads (msNormalize: 200 characters; acxNormalize: a duplicate word goes)
    const clamp = arriveForExport(c, { ...out, manuscript: { legalName: 'x'.repeat(300) }, audio: { pron: [{ word: 'Ys' }, { word: 'ys' }] } }) as Rec;
    expect(((clamp.manuscript as Rec).legalName as string).length).toBe(200);
    expect(((clamp.audio as Rec).pron as unknown[]).length).toBe(1);
    y.destroy();
  });

  it('on every fixture: the manuscript and the audio plan changed and put back give the book back exactly', () => {
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      const expected = want(f.book, exportBook(y) as Rec);
      let before: Rec = {};
      set((st) => {
        before = { manuscript: structuredClone(st.manuscript), audio: structuredClone(st.audio) };
        st.manuscript = c.api.msNormalize(Object.assign({}, st.manuscript, { font: 'courier', email: 'w@example.org' }));
        st.audio = c.api.acxNormalize(Object.assign({}, st.audio, { format: 'txt', rightsInClosing: true }));
      });
      expect((exportBook(y) as Rec).manuscript, f.name).not.toEqual(expected.manuscript);
      set((st) => {
        st.manuscript = structuredClone(before.manuscript);
        st.audio = structuredClone(before.audio);
      });
      const back = exportBook(y) as Rec;
      expect(back, `${f.name} put back`).toEqual(expected);
      expect(Object.keys(back), `${f.name} key order`).toEqual(Object.keys(expected));
      y.destroy();
    }
  }, 240_000);

  it('a book that never stored a manuscript block: a change writes it; put back, the key is gone again', () => {
    const f = fixtures('legacy').find((x) => x.name === 'legacy/print-defaults')!;
    const y = onDesk(structuredClone(f.book));
    y.getMap('meta').delete('manuscript');
    exportReset();
    const orig = exportBook(y) as Rec;
    expect('manuscript' in orig).toBe(false);
    set((st) => (st.manuscript = c.api.msNormalize({ ...(st.manuscript as Rec), paper: 'a4' })));
    expect(((exportBook(y) as Rec).manuscript as Rec).paper).toBe('a4');
    set((st) => (st.manuscript = c.api.msNormalize({ ...(st.manuscript as Rec), paper: 'letter' })));
    expect(exportBook(y)).toEqual(orig);
    y.destroy();
  });

  it('on every fixture: Word, the manuscript, the ACX plan and its readiness checks, and the box set write nothing', () => {
    const vol = fixtures('real').find((x) => x.name === 'real/reads-you')!.book;
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      const expected = want(f.book, exportBook(y) as Rec);
      exportRun(() => undefined);
      const at = sv(y);
      exportRun((cc) => {
        const a = cc.api;
        a.buildDocxFiles();
        a.msFiles(a.msPlan());
        const plan = a.acxBuildPlan();
        a.acxDetectCandidates(60);
        a.acxZipEntries(plan);
        (cc.getState() as Rec).boxSetVolumes = [a.bookDocToVolume(structuredClone(vol), 'reads-you.json')];
        a.boxSetFiles();
        a.boxSetPlan();
      });
      expect(sv(y), f.name).toBe(at);
      expect(exportBook(y), f.name).toEqual(expected);
      y.destroy();
    }
  }, 300_000);

  it("box-set volumes: a Beuk backup is added through 1.0's own reading, kept for the open book across the session's rebuilds, never written into it, and gone with another book", async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const vol = fixtures('real').find((x) => x.name === 'real/reads-you')!.book;
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    const v = (await volumeFromFile(backupFile(vol, 'reads-you.beuk-backup.json'))) as Rec & { meta: Rec };
    expect(v.meta.title).toBe((vol.meta as Rec).title);
    set((st) => (st.boxSetVolumes as unknown[]).push(v));
    // an edit of the book: the session's state is built again; the list stays
    y.getMap('meta').set('exportPlatform', 'kdp');
    const listed = exportRun((cc) => ((cc.getState() as Rec).boxSetVolumes as Rec[]).map((x) => x.id));
    expect(listed).toEqual([v.id]);
    expect(JSON.stringify(exportBook(y))).not.toContain(String(v.id));
    y.getMap('meta').set('exportPlatform', (expected as Rec).exportPlatform);
    expect(exportBook(y)).toEqual(expected);
    // another book on the desk starts with none (1.0's BEUK:metaleak)
    const y2 = onDesk(structuredClone(vol));
    expect(exportRun((cc) => ((cc.getState() as Rec).boxSetVolumes as unknown[]).length)).toBe(0);
    // a file that is not a Beuk backup: 1.0's own message
    await expect(volumeFromFile(new File(['{"x":1}'], 'notes.json'))).rejects.toThrow('this is not a Beuk backup file');
    y.destroy();
    y2.destroy();
  });
});

describe('review of 5c (Minor 3): what exportResume hands back is a real Promise', () => {
  it('it has catch and finally, a rejection reaches catch, and the continuation runs on the export state though another was set meanwhile', async () => {
    const f = fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
    const y = onDesk(structuredClone(f.book));
    const mine = exportRun((cc) => cc.getState())!;
    const p = exportRun(() => exportResume(Promise.reject(new Error('refused'))))!;
    expect(p).toBeInstanceOf(Promise);
    let caught = '', finished = false;
    await p.catch((e: Error) => (caught = e.message)).finally(() => (finished = true));
    expect([caught, finished]).toEqual(['refused', true]);
    const q = exportRun(() => exportResume(new Promise((r) => setTimeout(() => r(1), 5))))!;
    c.setState(arriveForExport(c, { meta: { title: 'Another state' } }) as never);
    const seen = await q.then(() => c.getState());
    expect(seen).toBe(mine);
    y.destroy();
  });
});
