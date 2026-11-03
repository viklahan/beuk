import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure, type StoreAudit } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { arriveForExport, exportReset, exportRun } from '../src/export/state';
import { styleRelease } from '../src/style/session';
import { hostileExportBook, hostileNonStringBook } from './export-fixture';
import { hazards } from './hazards';
import { PNG_1PX } from './style-fixture';

/* Wave 5d, task 1 — constraint 74 (review focus #4): safety, the store check's turn. Book values reach the audit's rows
   (a section's label, a picture's name, the title, the theme's faces) and so the modal's report (storeRowsHtml,
   renderStoreReport) and the downloaded report (buildStoreReportHtml); a server's answer would too (a font's name, a
   job's error, the footnote fallbacks' sections). 1.0 escapes every one of them (esc()), on its own state of a hostile
   book — no export correction in front — and on the export session's (corrected) state: parsed text/html and walked
   (test/hazards.ts), no script, handler or remote request; the hostile words are there, as text. */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
afterEach(() => {
  desk.ydoc = null;
  exportReset();
  styleRelease();
  document.body.innerHTML = '';
});
const tag = (n: number) => `<img src="https://evil.example/${n}.png" onerror="window.__pw=${n}">"'</style><script>window.__pw=${n}</script>`;
/** 5a's hostile book, with a low-resolution picture whose name is hostile placed in its hostile chapter (a DPI row names
 *  both), and a hostile body face. */
function hostileStoreBook(): Rec {
  const b = hostileExportBook() as Rec & { sections: Rec[]; images: Rec[]; theme: Rec };
  b.images.push({ id: 'hostname', name: 'Plate ' + tag(41), mediaType: 'image/png', ext: 'png', data: PNG_1PX });
  const s = b.sections.find((x) => String(x.title).startsWith('Chapter '))!;
  s.content = '![x](img:hostname)\n\n' + String(s.content);
  return b;
}
/** A server's answer carrying hostile words: a font's name, the footnote fallbacks, a press colour. */
function hostileServer(sig: string, ok: boolean): Rec {
  if (!ok) return { sig, at: new Date(), pdfx: { status: 'failed', result: { error: 'Boom ' + tag(50), cause: 'renderer' } }, epubcheck: { status: 'failed', result: { error: 'Boom ' + tag(51), cause: 'tool' } }, error: '' };
  return { sig, at: new Date(), error: '',
    pdfx: { status: 'done', result: {
      inspection: { pageCount: 120, fontsAllEmbedded: false, fonts: [{ name: 'ABCDEF+Face' + tag(52), embedded: false }],
        pdfx: { conformance: 'X' + tag(53), version: '', outputIntent: false, outputCondition: tag(54) }, rgb: { colourSpaceRefs: 1, rgbOperators: 0 },
        firstPage: { mediaBox: { w: 6, h: 9 }, trimBox: null } },
      footnotes: { placed: 1, kept: 2, fallbacks: [{ section: 'ps-1', reason: 'long' }, { section: 'Sec ' + tag(55), reason: 'Why ' + tag(56) }] },
      press: { text: { textShows: 10, kOnly: 4, otherColours: { ['C ' + tag(57)]: 6 }, kValues: { '100': 4 } }, ink: { maxTacPct: 320, dpi: 72, perPagePct: [320] } } } },
    epubcheck: { status: 'done', result: { passed: false, toolVersion: tag(58), counts: { fatal: 1, errors: 2, warnings: 0 } } } };
}
const COMBOS = [{ store: 'kdp', binding: 'paperback', ink: 'bw_white' }, { store: 'ingramspark', binding: 'paperback', ink: 'bw_cream' }, { store: 'kdp', binding: 'hardcover', ink: 'bw_cream' },
  { store: 'ingramspark', binding: 'hardcover', ink: 'premium_color' }];

/** The modal's report (1.0's renderStoreReport into #storeReport) and the downloaded report, for each combo and server
 *  state, on the closure's current state. */
function surfaces(cc: Closure): { where: string; html: string }[] {
  const out: { where: string; html: string }[] = [];
  const box = document.createElement('div');
  box.id = 'storeReport';
  document.body.appendChild(box);
  const ui = cc.api.storeUi;
  const st = cc.getState() as Rec;
  const keep = st.storeCheck;
  try {
    for (const server of [null, 'ok', 'failed'] as const) {
      ui.server = server ? hostileServer(cc.api.storeBookSig(), server === 'ok') : null;
      for (const sc of COMBOS) {
        st.storeCheck = { ...sc, attestSpine: false };
        cc.api.renderStoreReport();
        out.push({ where: `modal ${sc.store}/${sc.binding}/${sc.ink} server:${server}`, html: box.innerHTML });
        const a = cc.api.storeAudit(sc) as StoreAudit;
        out.push({ where: `report ${sc.store}/${sc.binding}/${sc.ink} server:${server}`, html: cc.api.buildStoreReportHtml(a) });
      }
    }
  } finally {
    st.storeCheck = keep;
    ui.server = null;
    ui.last = null;
    box.remove();
  }
  return out;
}

describe("wave 5d: the store check's report escapes the book (constraint 74)", () => {
  for (const [name, make] of [['the hostile book', hostileStoreBook], ['the hostile non-string book', hostileNonStringBook]] as const)
    it(`${name}: 1.0's own rendering on its own state (no correction in front) carries no script, handler or remote request; nor does the export session's`, () => {
      const y = new Y.Doc();
      importBook(make(), y);
      desk.ydoc = y;
      exportReset();
      const before = exportBook(y);
      // 1.0's own: applyBookDoc's state of the book, the export's corrections NOT applied
      const raw = arriveForExport(c, exportBook(y) as Rec);
      c.setState(raw);
      const own = surfaces(c);
      // the export session's (corrected)
      const sess = exportRun((cc) => surfaces(cc))!;
      const found: string[] = [];
      for (const s of [...own, ...sess]) found.push(...hazards(s.html, s.where));
      expect(found).toEqual([]);
      expect(own.length).toBe(24);
      if (name === 'the hostile book') {
        // the hostile words are there, as text: the title (report), a picture's name and its chapter (a DPI row), the
        // server's words (a font, an error, a footnote fallback, a colour, a tool version)
        const all = own.map((s) => s.html).join('\n');
        for (const n of [1, 3, 41, 50, 52, 55, 56, 57]) expect(all, `tag ${n}`).toContain(`window.__pw=${n}`);
      }
      expect(exportBook(y)).toEqual(before);
      y.destroy();
    });
});
