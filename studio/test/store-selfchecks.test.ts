import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, loadSample, setClosureLang, setClosureT, type Closure, type StoreAudit, type StoreRow } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { arriveForExport } from '../src/export/state';
import { exportSafe } from '../src/export/safe';

/* Wave 5d — 1.0's store-ready self-checks (client/index.html BEUK:store: the ten `id: "store.` checks, which 1.0 tags
   feature "print"; cover.store.spine-items; and the store halves 5b left of print.footnotes.report, print.bleed and
   print.press.store-rows), re-expressed on the main closure: the very functions 1.0's checks call, on 1.0's
   applyBookDoc state of 1.0's own sample (storeOnSample: the sample, trim 6 × 9, no server result), corrected as the
   export corrects it. 1.0's own test fixtures (storeFixtureStates / storeFixtureServer) are transcribed below as data. */

type Rec = Record<string, unknown>;
type Api = Closure['api'] & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
let a: Api;
let sampleBook: () => Rec;
beforeAll(async () => {
  c = await loadClosure();
  a = c.api as Api;
  setClosureT(t);
  setClosureLang('en');
  const s = await loadSample();
  sampleBook = () => s.buildSampleBook() as Rec;
});
/** 1.0's storeOnSample: the sample on the desk, trim 6 × 9, no server result. */
function onSample<T>(fn: (st: Rec) => T): T {
  // 1.0 builds its sample on a desk (buildSampleBook reads the state's theme): 1.0's empty book first
  c.setState(arriveForExport(c, a.buildEmptyBook() as Rec));
  const book = sampleBook();
  // the sample's pictures, as 1.0's samplePicsRequire brings them in (BEUK:slim: the files 1.0 ships, client/assets/sample)
  const files = new Map(a.SAMPLE_IMAGE_FILES.map((m) => [m.id, m.file]));
  for (const im of (book.images as Rec[]) || [])
    if (!im.data && files.has(im.id as string)) im.data = readFileSync(fileURLToPath(new URL('../../client/assets/sample/' + files.get(im.id as string), import.meta.url))).toString('base64');
  const st = arriveForExport(c, structuredClone(book)) as unknown as Rec;
  exportSafe(c, st as never, book);
  c.setState(st as never);
  st.printTrim = '6x9';
  a.storeUi.server = null;
  try {
    return fn(st);
  } finally {
    a.storeUi.server = null;
    a.storeUi.running = false;
  }
}
const storeRows = (x: StoreAudit) => x.groups.interior.concat(x.groups.cover, x.groups.ebook);
const audit = (sc: Rec) => a.storeAudit(sc) as StoreAudit;
/** 1.0's storeFixtureStates and storeFixtureServer (BEUK:store self-check fixtures), as data. */
const FIXTURE_STATES = [null, 'pending', 'stale', 'client', 'setup', 'timeout', 'interrupted', 'missing', 'renderer', 'tool', 'unknown', 'doneBad'] as const;
function fixtureServer(k: string | null): Rec | null {
  if (!k) return null;
  if (k === 'stale') return { sig: 'an earlier book', at: new Date(), pdfx: null, epubcheck: null, error: '' };
  if (k === 'pending') return { sig: a.storeBookSig(), at: new Date(), pdfx: { id: '', status: 'running' }, epubcheck: { id: '', status: 'queued' }, error: '' };
  if (k === 'doneBad')
    return { sig: a.storeBookSig(), at: new Date(), error: '',
      pdfx: { status: 'done', result: {
        inspection: { pageCount: 0, fontsAllEmbedded: false, fonts: [{ name: 'SelfCheck-Regular', embedded: false }],
          pdfx: { conformance: '', version: '', outputIntent: false, outputCondition: '' }, rgb: { colourSpaceRefs: 3, rgbOperators: 0 },
          firstPage: { mediaBox: { w: 1, h: 1 }, trimBox: null } },
        press: { text: { textShows: 10, kOnly: 4, otherColours: { '0.2 0.9 0.8 0.1': 6 }, kValues: { '100': 4 } }, ink: { maxTacPct: 320, dpi: 72, perPagePct: [320] } } } },
      epubcheck: { status: 'done', result: { passed: false, counts: { fatal: 1, errors: 2, warnings: 0 } } } };
  const job = { status: 'failed', result: Object.assign({ error: 'self-check: ' + k, cause: k }, k === 'setup' ? { configured: false } : {}) };
  return { sig: a.storeBookSig(), at: new Date(), pdfx: job, epubcheck: job, error: '' };
}

describe("1.0's store-ready self-checks, on the main closure", () => {
  it('store.rules.cited-data', () => {
    const k = a.STORE_RULES.kdp as Rec & { sources: string[]; inks: Rec[]; bindings: Record<string, { trims: unknown[] }> };
    const i = a.STORE_RULES.ingramspark as Rec & { sources: string[]; inks: Rec[]; bindings: Record<string, { trims: unknown[] }> };
    expect(k.sources.every((u) => u.indexOf('https://kdp.amazon.com/') === 0) && i.sources.every((u) => u.indexOf('https://www.ingramspark.com/') === 0)).toBe(true);
    const f = (id: string) => (k.inks.find((x) => x.id === id) || {}).spine;
    expect([f('bw_white'), f('bw_cream'), f('premium_color'), f('bw_groundwood')]).toEqual([0.002252, 0.0025, 0.002347, null]);
    expect(k.bindings.paperback!.trims.length).toBe(16);
    expect(k.bindings.hardcover!.trims.length).toBe(5);
    expect(i.bindings.paperback!.trims.length).toBeGreaterThan(30);
    expect(i.inks.every((x) => (x.ppi as number) > 0)).toBe(true);
  });

  it('store.verdict.never-green-unchecked', () => {
    onSample(() => {
      const x = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' });
      const fonts = x.groups.interior.find((r) => r.id === 'fonts')!;
      const size = x.groups.interior.find((r) => r.id === 'size')!;
      expect(fonts.status).toBe('nc');
      expect(fonts.evidence.length).toBeGreaterThan(20);
      expect(size.status).toBe('nc');
      expect(x.verdict).not.toBe('ready');
    });
  });

  it('store.dpi.sample-fails-honestly', () => {
    onSample(() => {
      const x = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' });
      const rows = x.groups.interior.filter((r) => r.id.indexOf('dpi.') === 0);
      const places = a.printPlacements().filter((p) => p.dpi < 300);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBe(places.length);
      for (const r of rows) {
        expect(r.status).toBe('fail');
        expect(r.required).toBe(true);
        expect(r.evidence).toMatch(/\d+ DPI/);
        expect(r.fix).toMatch(/\d/);
        expect(r.action!.kind).toBe('section');
      }
      places.forEach((p, i) => expect(rows[i]!.evidence).toContain(a.fmtNum(Math.round(p.dpi)) + ' DPI'));
      expect(x.verdict).toBe('notReady');
    });
  });

  it('store.trim.unsupported-fails', () => {
    onSample((st) => {
      st.printTrim = '8x8';
      const k = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'trim')!;
      const i = audit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'trim')!;
      expect(k.status).toBe('fail');
      expect(k.action!.kind).toBe('trim');
      expect((a.TRIM_SIZES as (Rec & { id: string })[]).some((x) => x.id === k.action!.trim && x.kdp)).toBe(true);
      expect(i.status).toBe('pass');
    });
  });

  it('store.trim.paper-matrix', () => {
    onSample((st) => {
      st.printTrim = '8.5x11';
      const trimOf = (ink: string) => audit({ store: 'ingramspark', binding: 'paperback', ink }).groups.interior.find((r) => r.id === 'trim')!;
      const w = trimOf('bw_white'), cr = trimOf('bw_cream'), g = trimOf('bw_groundwood');
      expect(w.status).toBe('pass');
      expect(cr.status).toBe('fail');
      expect(cr.action!.kind).toBe('trim');
      expect(g.status).toBe('nc');
      expect(audit({ store: 'ingramspark', binding: 'hardcover', ink: 'bw_cream' }).groups.interior.find((r) => r.id === 'trim')!.status).toBe('fail');
      const R = (a.STORE_RULES.ingramspark as unknown as Rec & { bindings: Record<string, Rec & { trims: unknown[]; pages: Record<string, number[]> }> }).bindings.paperback!;
      const land = a.storeMatchTrim(R.trims, { w: 11, h: 8.5 }) as unknown as Rec & { maxPages: number; avail: Record<string, boolean> };
      expect([land.maxPages, land.avail.premium_color, land.avail.std_color]).toEqual([400, true, false]);
      expect(R.pages.bw_cream![1]).toBe(1050);
    });
  });

  it('store.spine.wrap-matches-store-factor', () => {
    onSample((st) => {
      (st.coverRecipe as Rec).wrap = a.normalizeWrap({ trim: '', pages: 0, paper: 'white' });
      const before = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.cover.find((r) => r.id === 'spine')!;
      if (before.action) a.storeAct(before.action);
      const after = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.cover.find((r) => r.id === 'spine')!;
      expect(before.status).toBe('fail');
      expect(before.action!.kind).toBe('wrapFactor');
      expect(after.status).toBe('pass');
    });
  });

  it('cover.store.spine-items (jsdom draws no wrap: the clearance falls back to 1.0\'s estimate; the drawn-boxes half is the helper\'s, as 1.0 checks it)', () => {
    onSample((st) => {
      const meta0 = st.meta as Rec;
      meta0.language = 'fr';
      const setSpine = (sp: Rec, pages?: number) => {
        (st.coverRecipe as Rec).wrap = a.normalizeWrap({ trim: '6x9', pages: pages || 300, paper: 'cream', spine: sp });
      };
      const keepSecs = st.sections as unknown[];
      st.sections = keepSecs.slice(0, 2);
      const small = a.printPageEstimate();
      const row = (store: string, ink: string) => audit({ store, binding: 'paperback', ink }).groups.cover.find((r) => r.id === 'spinetext');
      setSpine({ iconTop: { kind: 'lucide', name: 'Feather' } });
      const kdpIcon = row('kdp', 'bw_cream')!;
      setSpine({});
      const kdpText = row('kdp', 'bw_cream')!;
      st.sections = keepSecs;
      const big = a.printPageEstimate();
      setSpine({ iconTop: { kind: 'lucide', name: 'Feather' }, iconBottom: { kind: 'lucide', name: 'Star' } });
      const kdpOk = row('kdp', 'bw_cream')!;
      const tight = a.storeSpineClearance([{ kind: 'text', part: 'title', x: 5.1, w: 0.6 }, { kind: 'icon', pos: 'top', x: 5.03, w: 0.74 }], 5.0, 0.8)!;
      const roomy = a.storeSpineClearance([{ kind: 'text', part: 'title', x: 5.1, w: 0.6 }], 5.0, 0.8)!;
      const none = a.storeSpineClearance([], 5.0, 0.8);
      expect(small).toBeLessThan(79);
      expect(big).toBeGreaterThanOrEqual(79);
      expect(kdpIcon.status).toBe('fail');
      expect(kdpIcon.evidence).toMatch(/icon/i);
      expect(kdpText.status).toBe('fail');
      expect(kdpOk.status).toBe('pass');
      expect(tight.kind).toBe('icon');
      expect(Math.abs(tight.clear - 0.03)).toBeLessThan(1e-9);
      expect(roomy.kind).toBe('text');
      expect(Math.abs(roomy.clear - 0.1)).toBeLessThan(1e-9);
      expect(none).toBeNull();
      expect(t('store.c.spinetext.failClearIcon', { clear: '0.03', need: '0.06', store: 'KDP' })).toMatch(/icon/i);
    });
  });

  it('store.report.download-carries-evidence', () => {
    onSample(() => {
      const x = audit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_cream' });
      const html = a.buildStoreReportHtml(x);
      for (const s of ['The Lantern Coast', 'IngramSpark', x.facts.trim, x.at.toISOString()]) expect(html).toContain(s);
      for (const r of storeRows(x)) expect(html, r.id).toContain(a.esc(r.evidence));
      for (const u of x.rules.sources) expect(html).toContain(u);
    });
  });

  it('store.fix.every-problem-has-a-way-out', () => {
    onSample((st) => {
      let n = 0, audits = 0, drawn = 0;
      const stuck: string[] = [];
      const look = (x: StoreAudit, where: string) => {
        audits++;
        storeRows(x).forEach((r: StoreRow) => {
          if (r.status === 'pass') return;
          n++;
          if (!(r.fix && r.fix.trim()) && !r.action) stuck.push(where + ' ' + r.id + ' (' + r.status + ')');
        });
      };
      const wrap = st.coverRecipe;
      for (const trim of ['6x9', '5x8', '8x8', '8.5x11', '11x8.5']) {
        st.printTrim = trim;
        for (const withWrap of [true, false]) {
          st.coverRecipe = withWrap ? wrap : null;
          for (const store of ['kdp', 'ingramspark'])
            for (const binding of ['paperback', 'hardcover'])
              for (const ink of (a.STORE_RULES[store] as Rec & { inks: { id: string }[] }).inks) {
                a.storeUi.server = null;
                look(audit({ store, binding, ink: ink.id }), store + '/' + binding + '/' + ink.id + '/' + trim + (withWrap ? '' : '/no-wrap'));
              }
        }
      }
      st.printTrim = '6x9';
      st.coverRecipe = wrap;
      for (const k of FIXTURE_STATES) {
        a.storeUi.server = fixtureServer(k);
        for (const store of ['kdp', 'ingramspark']) {
          const x = audit({ store, binding: 'paperback', ink: 'bw_white' });
          look(x, store + '/server:' + k);
          const seen = new Set<string>();
          const box = document.createElement('ul');
          box.innerHTML = (['interior', 'cover', 'ebook'] as const).map((g) => a.storeRowsHtml(x.groups[g], true, seen)).join('');
          box.querySelectorAll<HTMLElement>('.st-row').forEach((li) => {
            if (li.dataset.stStatus === 'pass') return;
            drawn++;
            if (!li.querySelector('.st-fix') && !li.querySelector('[data-st-act]')) stuck.push(store + '/server:' + k + ' drawn ' + li.dataset.stId);
          });
        }
      }
      expect(stuck).toEqual([]);
      expect(n).toBeGreaterThan(100);
      expect(drawn).toBeGreaterThan(0);
      expect(audits).toBe(5 * 2 * (2 * 5 + 2 * 7) + FIXTURE_STATES.length * 2);
    });
  });

  it('store.server.cause-remedies', () => {
    onSample(() => {
      const want: Record<string, string> = { setup: 'setup', timeout: 'timeout', interrupted: 'interrupted', missing: 'missing', client: 'client', renderer: 'retry', tool: 'retry', unknown: 'retry' };
      const bad: string[] = [];
      for (const k of Object.keys(want)) {
        a.storeUi.server = fixtureServer(k);
        const rows = storeRows(audit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' }));
        for (const id of ['fonts', 'pdfx', 'size', 'textK', 'tac', 'epubcheck']) {
          const r = rows.find((x) => x.id === id);
          const okFix = r && r.status === 'nc' && r.fix === t('store.fix.cause.' + want[k]);
          const okAct = k === 'setup' ? !r!.action : r!.action && r!.action.kind === 'runServer';
          if (!okFix || !okAct) bad.push(k + ':' + id);
        }
      }
      a.storeUi.server = fixtureServer('pending');
      const pend = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'fonts')!;
      a.storeUi.server = fixtureServer('stale');
      const stale = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'fonts')!;
      expect(bad).toEqual([]);
      expect(pend.action!.kind).toBe('recheck');
      expect(stale.action!.kind).toBe('runServer');
      expect(t('store.fix.cause.setup')).toMatch(/Print Previewer/);
      expect(t('store.fix.cause.setup')).toMatch(/IngramSpark/);
      expect(new Set(['setup', 'timeout', 'interrupted', 'missing', 'client', 'retry'].map((k) => t('store.fix.cause.' + k))).size).toBe(6);
    });
  });

  it('store.fix.accent-black-one-click', () => {
    onSample((st) => {
      st.bookColour = a.bookColourNormalize({ accent: '#7a1f2b' });
      a.storeUi.server = fixtureServer('doneBad');
      const sc = { store: 'ingramspark', binding: 'paperback', ink: 'bw_white' };
      const before = audit(sc).groups.interior.find((r) => r.id === 'textK')!;
      if (before.action) a.storeAct(before.action);
      const after = audit(sc).groups.interior.find((r) => r.id === 'textK')!;
      expect(before.status).toBe('warn');
      expect(before.action!.kind).toBe('printBlack');
      expect(a.bookColour().printBlack).toBe(true);
      expect(after.status).toBe('nc');
      expect(after.action!.kind).toBe('runServer');
    });
  });

  it('print.footnotes.report (the store half 5b left)', () => {
    onSample((st) => {
      st.printNotes = 'page';
      const insp = { pageCount: 120, firstPage: { mediaBox: { w: 6, h: 9 }, trimBox: { w: 6, h: 9 }, bleedBox: null }, pdfx: { version: 'PDF/X-1:2001', conformance: 'PDF/X-1a:2001', outputIntent: true, outputCondition: 'CGATS TR 003' },
        fonts: [{ name: 'AAAAAA+EBGaramond-Regular', subtype: 'Type1C', embedded: true }], fontsAllEmbedded: true, rgb: { colourSpaceRefs: 0, rgbOperators: 0 }, encrypted: false, notes: [] };
      const secs = (st.sections as Rec[]).filter((s) => s.included && s.type !== 'cover');
      const k = secs.findIndex((s) => s.kind === 'body');
      const label = a.sectionLabel(secs[k]) || secs[k]!.title;
      const rowWith = (footnotes: unknown) => {
        a.storeUi.server = { sig: a.storeBookSig(), at: new Date(), pdfx: { status: 'done', result: { inspection: insp, press: null, footnotes } }, epubcheck: null, error: '' };
        return audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'fnotes') || null;
      };
      const all = rowWith({ placed: 4, kept: 0, passes: 14, fallbacks: [] });
      const some = rowWith({ placed: 2, kept: 2, passes: 9, fallbacks: [{ section: 'ps-' + k, reason: 'long', notes: 2 }] });
      const none = rowWith(null);
      st.printNotes = 'end';
      const endMode = rowWith({ placed: 4, kept: 0, passes: 14, fallbacks: [] });
      expect(all!.status).toBe('pass');
      expect(all!.evidence).toContain('4');
      expect(some!.status).toBe('warn');
      expect(some!.evidence).toContain(String(label));
      expect(some!.evidence).toContain(t('store.c.fnotes.r.long'));
      expect(some!.fix).toBeTruthy();
      expect(none).toBeNull();
      expect(endMode).toBeNull();
    });
  });

  it('print.bleed (the store half 5b left: the row off, on, against a server PDF; KDP\'s 0.375 in)', () => {
    onSample((st) => {
      expect(a.printEdgeSections().length).toBeGreaterThan(0);
      const off = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'bleed')!;
      expect(off.status).toBe('fail');
      expect(off.action!.kind).toBe('print');
      st.printBleed = true;
      const rowWith = (insp: unknown) => {
        a.storeUi.server = insp ? { sig: a.storeBookSig(), at: new Date(), pdfx: { status: 'done', result: { inspection: insp, press: null } }, epubcheck: null, error: '' } : null;
        return audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior.find((r) => r.id === 'bleed')!;
      };
      const inspAt = (mw: number, mh: number, tw: number, th: number) => ({ pageCount: 120, firstPage: { mediaBox: { w: mw, h: mh }, trimBox: tw ? { w: tw, h: th } : null, bleedBox: tw ? { w: mw, h: mh } : null },
        pdfx: { version: 'PDF/X-1:2001', conformance: 'PDF/X-1a:2001', outputIntent: true, outputCondition: 'CGATS TR 003' },
        fonts: [], fontsAllEmbedded: true, rgb: { colourSpaceRefs: 0, rgbOperators: 0 }, encrypted: false, notes: [] });
      const onRow = rowWith(null), trimRow = rowWith(inspAt(6, 9, 0, 0)), bleedRow = rowWith(inspAt(6.125, 9.25, 6, 9));
      expect(onRow.status).toBe('pass');
      expect(onRow.evidence).toContain('6.125');
      expect(trimRow.status).toBe('fail');
      expect(bleedRow.status).toBe('pass');
      expect((a.STORE_RULES.kdp as Rec).edgeMinBleed).toBe(0.375);
    });
  });

  it('print.press.store-rows', () => {
    onSample(() => {
      const insp = { pageCount: 81, firstPage: { mediaBox: { w: 6, h: 9 }, trimBox: { w: 6, h: 9 }, bleedBox: null }, pdfx: { version: 'PDF/X-1:2001', conformance: 'PDF/X-1a:2001', outputIntent: true, outputCondition: 'CGATS TR 003' },
        fonts: [{ name: 'AAAAAA+EBGaramond-Regular', subtype: 'Type1C', embedded: true }], fontsAllEmbedded: true, rgb: { colourSpaceRefs: 0, rgbOperators: 0 }, encrypted: false, notes: [] };
      const rowsWith = (press: unknown) => {
        a.storeUi.server = { sig: a.storeBookSig(), at: new Date(), pdfx: { status: 'done', result: { inspection: insp, press } }, epubcheck: null, error: '' };
        const x = audit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' });
        const get = (id: string) => x.groups.interior.find((r) => r.id === id) || { status: 'absent', evidence: '' };
        return { textK: get('textK'), tac: get('tac') };
      };
      const clean = rowsWith({ text: { textShows: 900, kOnly: 900, kValues: { 100: 900 }, otherColours: {} }, ink: { maxTacPct: 212.5, perPagePct: [212.5, 10], dpi: 100 } });
      const tinted = rowsWith({ text: { textShows: 900, kOnly: 900, kValues: { 100: 850, 75: 50 }, otherColours: {} }, ink: { maxTacPct: 296.1, perPagePct: [296.1, 241, 12], dpi: 100 } });
      const unmeasured = rowsWith({ text: { error: 'no stream' }, ink: { error: 'Ghostscript rendered no pages' } });
      a.storeUi.server = null;
      const none = audit({ store: 'ingramspark', binding: 'paperback', ink: 'bw_white' }).groups.interior;
      const kdp = audit({ store: 'kdp', binding: 'paperback', ink: 'bw_white' }).groups.interior;
      expect([clean.textK.status, clean.tac.status]).toEqual(['pass', 'pass']);
      expect(clean.tac.evidence).toContain('212.5');
      expect(tinted.textK.status).toBe('warn');
      expect(tinted.textK.evidence).toContain('75');
      expect(tinted.tac.status).toBe('warn');
      expect(tinted.tac.evidence).toContain('296.1');
      expect([unmeasured.textK.status, unmeasured.tac.status]).toEqual(['nc', 'nc']);
      expect(unmeasured.tac.evidence).toContain('rendered no pages');
      expect(none.filter((r) => r.id === 'textK' || r.id === 'tac').every((r) => r.status === 'nc')).toBe(true);
      expect(kdp.some((r) => r.id === 'textK' || r.id === 'tac')).toBe(false);
    });
  });
});
