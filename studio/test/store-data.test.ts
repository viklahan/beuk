import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { readBook } from '../../src/book/read';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, shelf, type Closure, type StoreAudit } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, exportRun, exportState, loadSerialize } from '../src/export/state';
import { styleRelease } from '../src/style/session';
import { fixtures } from './fixtures';

/* Wave 5d, task 1 — constraints 71, 72, 73 (review focus #1, #2): THE AUDIT IS 1.0's AND ITS ACTIONS ARE 1.0's EDITS.
   - On every fixture, every store, binding and paper, with the print settings that change the verdict, 1.0's storeAudit
     runs on the export session's state (1.0's applyBookDoc state of the open book) and writes nothing; the export's
     corrections (exportSafe) change no honest book's audit.
   - storeAct and the modal's selects change the book as 1.0 does: state.printTrim, state.storeCheck (ink, attestSpine,
     store, binding), state.coverRecipe.wrap (trim, pages, the custom factor), state.bookColour.printBlack — written as
     serializeBook writes them, in its places; 1.0's arrival reads them back; put back, the book is as it was.
   The real comparison with 1.0's own page (every fixture × store × setting, the report's bytes) is the e2e's
   (wave5dParity). */

type Rec = Record<string, unknown>;
type Audit = StoreAudit;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let ser: (c: Closure) => Rec;
beforeAll(async () => {
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
const sv = (y: Y.Doc) => Buffer.from(Y.encodeStateVector(y)).toString('base64');
const withSections = () => fixtures('all').filter((f) => Array.isArray(f.book.sections));
const LC = () => fixtures('real').find((x) => x.name === 'real/lantern-coast-book-one')!;
/** An audit as data: everything but its time. */
const plain = (a: Audit) => JSON.stringify({ sc: a.sc, ink: a.ink, facts: a.facts, groups: a.groups, verdict: a.verdict, blocking: a.blocking, unrun: a.unrun });
/** The print settings that change the verdict (trim, edition, bleed, margins). */
const SETTINGS: Rec[] = [{}, { printTrim: '8x8' }, { printTrim: '8.5x11' }, { printTrim: '5x8' }, { printLargePrint: true, printPictureBook: false }, { printBleed: true },
  { printMarginMode: 'custom', printCustomMargins: { inside: 0.2, outside: 0.2, top: 0.2, bottom: 0.2 } }];
/** Every store × binding × paper of 1.0's rules. */
function combos(): Rec[] {
  const R = c.api.STORE_RULES as Record<string, { inks: { id: string }[] }>;
  const out: Rec[] = [];
  for (const store of ['kdp', 'ingramspark']) for (const binding of ['paperback', 'hardcover']) for (const ink of R[store]!.inks) out.push({ store, binding, ink: ink.id });
  return out;
}
/** Run every combo × setting on the closure's current state, the settings put back after each. */
function auditAll(st: Rec): string[] {
  const out: string[] = [];
  for (const set of SETTINGS) {
    const keep = structuredClone(Object.fromEntries(Object.keys(set).map((k) => [k, st[k]])));
    Object.assign(st, structuredClone(set));
    try {
      for (const sc of combos()) out.push(plain(c.api.storeAudit(sc) as Audit));
    } finally {
      Object.assign(st, keep);
    }
  }
  return out;
}

describe("wave 5d: the store check runs 1.0's audit on 1.0's state and writes nothing (constraints 71, 73)", () => {
  it('on every fixture × store × binding × paper × print setting: the audit, its report and its rows write nothing; the corrections change no honest audit', () => {
    let audits = 0;
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      const expected = want(f.book, exportBook(y) as Rec);
      exportRun(() => undefined);
      const at = sv(y);
      const mine = exportRun((cc) => {
        const st = cc.getState() as Rec;
        const list = auditAll(st);
        const a = cc.api.storeAudit() as Audit;
        cc.api.buildStoreReportHtml(a);
        cc.api.storeRowsHtml(a.groups.interior!, true, new Set());
        cc.api.storeVerdictText(a);
        cc.api.storeFactsLine(a);
        return list;
      })!;
      audits += mine.length;
      expect(sv(y), f.name).toBe(at);
      expect(exportBook(y), f.name).toEqual(expected);
      // the same audits on 1.0's state without the export's corrections (an honest book: nothing corrected)
      const raw = arriveForExport(c, exportBook(y) as Rec) as unknown as Rec;
      c.setState(raw as never);
      const bare = auditAll(raw);
      exportReset();
      expect(bare.length, f.name).toBe(mine.length);
      const diff = bare.findIndex((x, i) => x !== mine[i]);
      expect(diff, `${f.name}: audit ${diff} differs`).toBe(-1);
      y.destroy();
    }
    expect(audits).toBe(withSections().length * SETTINGS.length * 24);
  }, 600_000);

  it('the verdict is never "ready" while a required check could not run (no server: fonts, PDF/X, size are "not checked")', () => {
    for (const f of withSections()) {
      const y = onDesk(structuredClone(f.book));
      exportRun((cc) => {
        for (const sc of combos()) {
          const a = cc.api.storeAudit(sc) as Audit;
          const fonts = a.groups.interior!.find((r) => r.id === 'fonts')!;
          expect(fonts.status, f.name).toBe('nc');
          expect(a.verdict, f.name).not.toBe('ready');
        }
      });
      y.destroy();
    }
  }, 240_000);
});

describe("wave 5d: the store check's actions are 1.0's edits (constraint 72)", () => {
  const roundTrip = (y: Y.Doc) => arriveForExport(c, exportBook(y) as Rec) as unknown as Rec;

  it('a trim fix writes printTrim where serializeBook writes it; 1.0 reads it back; set back, the book is as it was', () => {
    const f = LC();
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    const keys = Object.keys(exportBook(y));
    // 1.0's own route to the action: KDP does not print 8 × 8 in; its one-click fix is the nearest KDP trim
    const before = exportRun((cc) => {
      const st = cc.getState() as Rec;
      st.printTrim = '8x8';
      const row = (cc.api.storeAudit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }) as Audit).groups.interior!.find((r) => r.id === 'trim')!;
      return row;
    })!;
    expect(before.status).toBe('fail');
    expect(before.action!.kind).toBe('trim');
    exportRun((cc) => cc.api.storeAct(before.action));
    const out = exportBook(y) as Rec;
    expect(out.printTrim).toBe(before.action!.trim);
    expect(Object.keys(out)).toEqual(keys);
    expect(exportRun((cc) => ser(cc).printTrim)).toBe(out.printTrim);
    expect(roundTrip(y).printTrim).toBe(before.action!.trim);
    exportRun((cc) => ((cc.getState() as Rec).printTrim = (expected as Rec).printTrim));
    expect(exportBook(y)).toEqual(expected);
    y.destroy();
  });

  it("ink, attest and the selects write storeCheck in serializeBook's shape and place; 1.0's clamps hold; put back, the book is as it was", () => {
    const f = LC();
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    const keys = Object.keys(exportBook(y));
    exportRun((cc) => cc.api.storeAct({ kind: 'ink', ink: 'bw_cream' }));
    expect((exportBook(y) as Rec).storeCheck).toEqual({ store: 'kdp', binding: 'paperback', ink: 'bw_cream', attestSpine: false });
    // the selects (initStoreReady's listeners): IngramSpark resets the ink and the attestation, as 1.0's does
    exportRun((cc) => {
      const st = cc.getState() as Rec;
      st.storeCheck = cc.api.normalizeStoreCheck(Object.assign({}, st.storeCheck, { store: 'ingramspark', ink: '', attestSpine: false }));
    });
    exportRun((cc) => cc.api.storeAct({ kind: 'attest' }));
    const out = exportBook(y) as Rec;
    expect(out.storeCheck).toEqual({ store: 'ingramspark', binding: 'paperback', ink: '', attestSpine: true });
    expect(exportRun((cc) => ser(cc).storeCheck)).toEqual(out.storeCheck);
    expect(Object.keys(out)).toEqual(keys);
    expect(roundTrip(y).storeCheck).toEqual(out.storeCheck);
    // 1.0's clamps (normalizeStoreCheck): an unknown store, binding or ink and a non-true attestation are its defaults
    expect(c.api.normalizeStoreCheck({ store: 'lulu', binding: 'spiral', ink: 'gold', attestSpine: 'yes' })).toEqual({ store: 'kdp', binding: 'paperback', ink: '', attestSpine: false });
    expect(c.api.normalizeStoreCheck({ store: 'kdp', ink: 'bw_white70' })).toEqual({ store: 'kdp', binding: 'paperback', ink: '', attestSpine: false });
    exportRun((cc) => ((cc.getState() as Rec).storeCheck = cc.api.normalizeStoreCheck({ store: 'kdp' })));
    expect(exportBook(y)).toEqual(expected);
    y.destroy();
  });

  it('a book that never stored storeCheck: a change writes it; put back, the key is gone again', () => {
    const f = fixtures('legacy').find((x) => x.name === 'legacy/print-defaults')!;
    const y = onDesk(structuredClone(f.book));
    y.getMap('meta').delete('storeCheck');
    exportReset();
    const orig = exportBook(y) as Rec;
    expect('storeCheck' in orig).toBe(false);
    exportRun((cc) => ((cc.getState() as Rec).storeCheck = cc.api.normalizeStoreCheck({ store: 'ingramspark' })));
    expect(((exportBook(y) as Rec).storeCheck as Rec).store).toBe('ingramspark');
    exportRun((cc) => ((cc.getState() as Rec).storeCheck = cc.api.normalizeStoreCheck({ store: 'kdp' })));
    expect(exportBook(y)).toEqual(orig);
    y.destroy();
  });

  it("the wrap fixes write coverRecipe as serializeBook writes it (normalizeCoverRecipe), in its place; 1.0 reads them back; put back, the book is as it was", () => {
    const f = LC();
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    const keys = Object.keys(exportBook(y));
    // 1.0's spine row on Lantern Coast (Beuk's white factor against KDP's white): its fix is the store's factor
    const spine = exportRun((cc) => (cc.api.storeAudit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }) as Audit).groups.cover!.find((r) => r.id === 'spine')!)!;
    const acts: Rec[] = [{ kind: 'wrapTrim' }, { kind: 'wrapPages', pages: 212 }];
    if (spine.action && spine.action.kind === 'wrapFactor') acts.push(spine.action);
    else acts.push({ kind: 'wrapFactor', factor: 0.0025 });
    for (const act of acts) exportRun((cc) => cc.api.storeAct(act));
    const out = exportBook(y) as Rec;
    const w = (out.coverRecipe as Rec).wrap as Rec;
    expect([w.trim, w.pages, w.paper]).toEqual(['', 212, 'custom']);
    expect(w.customFactor).toBe((acts[2] as Rec).factor);
    expect(exportRun((cc) => ser(cc).coverRecipe)).toEqual(out.coverRecipe);
    expect(Object.keys(out)).toEqual(keys);
    expect(((roundTrip(y).coverRecipe as Rec).wrap as Rec).customFactor).toBe((acts[2] as Rec).factor);
    // after the factor fix the spine row passes (1.0's store.spine.wrap-matches-store-factor, here on Lantern Coast's own wrap)
    if (spine.action && spine.action.kind === 'wrapFactor') {
      exportRun((cc) => {
        const wr = ((cc.getState() as Rec).coverRecipe as Rec).wrap as Rec;
        wr.pages = 0;
      });
      const after = exportRun((cc) => (cc.api.storeAudit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }) as Audit).groups.cover!.find((r) => r.id === 'spine')!)!;
      expect(after.status).toBe('pass');
    }
    // put back: the wrap as it was
    exportRun((cc) => ((cc.getState() as Rec).coverRecipe = cc.api.normalizeCoverRecipe(structuredClone((expected as Rec).coverRecipe))));
    expect(exportBook(y)).toEqual(expected);
    y.destroy();
  });

  it("the accent fix (printBlack) writes colour as serializeBook writes it and marks the server's measurement out of date", () => {
    const f = fixtures('real').find((x) => x.name === 'real/reads-you')!;
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    const keys = Object.keys(exportBook(y));
    // 1.0's own "doneBad" server result (storeFixtureServer): text in a coloured accent
    const before = exportRun((cc) => {
      const ui = cc.api.storeUi as Rec;
      ui.server = { sig: cc.api.storeBookSig(), at: new Date(), error: '',
        pdfx: { status: 'done', result: {
          inspection: { pageCount: 0, fontsAllEmbedded: false, fonts: [{ name: 'SelfCheck-Regular', embedded: false }],
            pdfx: { conformance: '', version: '', outputIntent: false, outputCondition: '' }, rgb: { colourSpaceRefs: 3, rgbOperators: 0 },
            firstPage: { mediaBox: { w: 1, h: 1 }, trimBox: null } },
          press: { text: { textShows: 10, kOnly: 4, otherColours: { '0.2 0.9 0.8 0.1': 6 }, kValues: { '100': 4 } }, ink: { maxTacPct: 320, dpi: 72, perPagePct: [320] } } } },
        epubcheck: { status: 'done', result: { passed: false, counts: { fatal: 1, errors: 2, warnings: 0 } } } };
      return (cc.api.storeAudit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' }) as Audit).groups.interior!.find((r) => r.id === 'textK')!;
    })!;
    expect(before.status).toBe('warn');
    expect(before.action!.kind).toBe('printBlack');
    const after = exportRun((cc) => {
      cc.api.storeAct(before.action);
      return (cc.api.storeAudit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' }) as Audit).groups.interior!.find((r) => r.id === 'textK')!;
    })!;
    expect(after.status).toBe('nc');
    expect(after.action!.kind).toBe('runServer');
    const out = exportBook(y) as Rec;
    expect(out.colour).toEqual({ ...(expected.colour as Rec), printBlack: true });
    expect(exportRun((cc) => ser(cc).colour)).toEqual(out.colour);
    expect(Object.keys(out)).toEqual(keys);
    expect((roundTrip(y).bookColour as Rec).printBlack).toBe(true);
    exportRun((cc) => ((cc.getState() as Rec).bookColour = cc.api.bookColourNormalize(structuredClone(expected.colour))));
    expect(exportBook(y)).toEqual(expected);
    exportRun((cc) => ((cc.api.storeUi as Rec).server = null));
    y.destroy();
  });

  it('opening the check (openStoreReady\'s normalize) and the actions that only move the writer write nothing', () => {
    const f = LC();
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    exportRun((cc) => {
      const st = cc.getState() as Rec;
      st.storeCheck = cc.api.normalizeStoreCheck(st.storeCheck);
      cc.api.storeAudit();
    });
    expect(exportBook(y)).toEqual(expected);
    expect(exportState()).not.toBeNull();
    y.destroy();
  });
});

describe('wave 5d: the server half is shelf-gated (constraint 75)', () => {
  it('Run full server check, signed in: 1.0\'s storeRunServer asks the shelf seam once, gets { needShelf } and says store.serverNeedShelf on every server row; nothing else is asked', async () => {
    const f = LC();
    const y = onDesk(structuredClone(f.book));
    const expected = want(f.book, exportBook(y) as Rec);
    const cf = c.api as unknown as Rec;
    void cf;
    const { cloudFacts } = await import('../src/closure/index');
    const keep = { available: cloudFacts.available, user: cloudFacts.user };
    cloudFacts.available = true;
    cloudFacts.user = { id: 'u1' };
    const asked = shelf.asked;
    const refused = shelf.refused.length;
    const fetches: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((u: RequestInfo | URL) => {
      fetches.push(String(u));
      return Promise.reject(new Error('no network in this test'));
    }) as typeof fetch;
    try {
      await exportRun((cc) => cc.api.storeRunServer());
      const rows = exportRun((cc) => {
        const a = cc.api.storeAudit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' }) as Audit;
        return a.groups.interior!.concat(a.groups.cover!, a.groups.ebook!);
      })!;
      expect(shelf.asked).toBe(asked + 1);
      expect(shelf.refused.length).toBe(refused);
      expect(fetches).toEqual([]);
      const fonts = rows.find((r) => r.id === 'fonts')!;
      expect(fonts.status).toBe('nc');
      expect(fonts.evidence).toBe(t('store.nc.failed', { error: t('store.serverNeedShelf') }));
      expect(rows.find((r) => r.id === 'epubcheck')!.evidence).toBe(t('store.nc.failed', { error: t('store.serverNeedShelf') }));
      // Check again: nothing to re-read
      await exportRun((cc) => cc.api.storeRecheck());
      expect(shelf.refused.length).toBe(refused);
      expect(fetches).toEqual([]);
      expect(exportBook(y)).toEqual(expected);
    } finally {
      globalThis.fetch = realFetch;
      cloudFacts.available = keep.available;
      cloudFacts.user = keep.user;
      exportRun((cc) => ((cc.api.storeUi as Rec).server = null));
    }
    y.destroy();
  });

  it("offline and signed out: 1.0's own reasons (store.nc.local, store.nc.signin), and storeRunServer stays silent", async () => {
    const f = LC();
    const y = onDesk(structuredClone(f.book));
    const { cloudFacts } = await import('../src/closure/index');
    const keep = { available: cloudFacts.available, user: cloudFacts.user };
    const asked = shelf.asked;
    try {
      for (const [available, user, key] of [[false, null, 'store.nc.local'], [true, null, 'store.nc.signin']] as const) {
        cloudFacts.available = available;
        cloudFacts.user = user;
        await exportRun((cc) => cc.api.storeRunServer());
        const fonts = exportRun((cc) => (cc.api.storeAudit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }) as Audit).groups.interior!.find((r) => r.id === 'fonts')!)!;
        expect(fonts.evidence).toBe(t(key));
      }
      expect(shelf.asked).toBe(asked);
    } finally {
      cloudFacts.available = keep.available;
      cloudFacts.user = keep.user;
    }
    y.destroy();
  });
});
