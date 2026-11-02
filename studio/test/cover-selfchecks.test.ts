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
import { styleRelease, styleReset, styleRun } from '../src/style/session';
import { fixtures } from './fixtures';

/* Wave 4c: 1.0's `cover` self-checks (client/index.html, feature "cover") that are arithmetic on the recipe and its
   wrap, re-expressed on the browser closure and, where they are round trips, through 2.0's own Y.Doc (import, a
   session write, export, readBook, import again): cover.wrap.spine-math, cover.hardcover.case-math,
   cover.hardcover.jacket-math, cover.hardcover.spine-source, cover.hardcover.trims, cover.wrap.spine-direction (the
   table half), cover.wrap.spine-back-normalize, cover.maker.ebook-render-dimensions and print-render-dimensions (the
   sizes; the canvases are the e2e's), cover.wrap.recipe-persists, cover.hardcover.recipe-persists,
   cover.maker.recipe-survives-roundtrip. Each test names its id. */

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
const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(doc, y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  return y;
};
const LANTERN = () => structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
type R = Rec & { wrap: Rec; title: string; author: string };
const run = <T>(fn: (a: Closure['api']) => T): T => styleRun((cc) => fn(cc.api))!;

describe("1.0's cover self-checks, re-expressed", () => {
  it('cover.wrap.spine-math', () => {
    onDesk(LANTERN());
    run((a) => {
      const mk = (pages: number, paper: string, cf?: number, trim?: string) => {
        const r = a.defaultCoverRecipe() as unknown as R;
        r.wrap = { trim: trim || '6x9', pages, paper, customFactor: cf || 0.0025, blurb: '', quote: '', imprint: '' };
        return a.wrapDims(r);
      };
      const white = mk(300, 'white'), cream = mk(300, 'cream'), custom = mk(200, 'custom', 0.003), small = mk(100, 'white', 0.0025, '5x8');
      expect([close(white.spine, 0.75), close(white.totalW, 13), close(white.totalH, 9.25)]).toEqual([true, true, true]);
      expect([close(cream.spine, 0.81), close(cream.totalW, 13.06), close(cream.totalH, 9.25)]).toEqual([true, true, true]);
      expect([close(custom.spine, 0.6), close(custom.totalW, 12.85)]).toEqual([true, true]);
      expect([close(small.spine, 0.25), close(small.totalW, 10.5), close(small.totalH, 8.25)]).toEqual([true, true, true]);
    });
  });

  it('cover.hardcover.case-math, cover.hardcover.jacket-math, cover.hardcover.spine-source, cover.hardcover.trims', () => {
    onDesk(LANTERN());
    run((a) => {
      const mk = (trim: string, spine: number) => {
        const r = a.defaultCoverRecipe() as unknown as R;
        r.wrap = Object.assign(a.wrapDefaults(), { trim, pages: 300, binding: 'case', hcSpine: spine });
        return a.wrapDims(r) as ReturnType<Closure['api']['wrapDims']> & { layout: { board: { w: number; h: number } }; spineSource: string };
      };
      const x = mk('6x9', 0.5), y = mk('8.5x11', 1.25);
      expect([close(x.layout.board.w, 5.815), close(x.layout.board.h, 9.25), close(x.totalW, 14.38), close(x.totalH, 10.5), x.spineSource]).toEqual([true, true, true, true, 'template']);
      expect([close(y.layout.board.w, 8.315), close(y.layout.board.h, 11.25), close(y.totalW, 0.625 * 2 + 0.5 * 2 + 8.315 * 2 + 1.25), close(y.totalH, 12.5)]).toEqual([true, true, true, true]);
      const rj = a.defaultCoverRecipe() as unknown as R;
      rj.wrap = Object.assign(a.wrapDefaults(), { trim: '6x9', pages: 300, binding: 'jacket', hcSpine: 0.5 });
      const d = a.wrapDims(rj) as ReturnType<Closure['api']['wrapDims']> & { layout: { flaps: Record<string, { x: number; w: number }> } };
      const fl = d.layout.flaps;
      expect([close(d.panel.w, 6.4375), close(d.panel.h, 9.25), close(d.totalW, 20.625), close(d.totalH, 9.5), close(fl.back!.x, 0.125), close(fl.back!.w, 3.25), close(fl.front!.x + fl.front!.w, d.totalW - 0.125), close(d.layout.frontX - d.layout.spineX, 0.5)])
        .toEqual(Array(8).fill(true));
      const rs = a.defaultCoverRecipe() as unknown as R;
      rs.wrap = Object.assign(a.wrapDefaults(), { trim: '6x9', pages: 300, paper: 'cream', binding: 'case', hcSpineAllow: 0.1 });
      const est = a.wrapDims(rs) as unknown as Rec & { spine: number; spineSource: string };
      (rs.wrap as Rec).hcSpine = 0.912;
      const tpl = a.wrapDims(rs) as unknown as Rec & { spine: number; spineSource: string };
      expect([est.spineSource, close(est.spine, 300 * 0.0027 + 0.1), tpl.spineSource, Math.abs(tpl.spine - 0.912) < 1e-12]).toEqual(['estimate', true, 'template', true]);
      expect(t('covermk.hc.spineSrcEstimate')).toContain('not checked');
      expect([a.hcTrimOffered('case', '6x9'), a.hcTrimOffered('jacket', '6x9'), a.hcTrimOffered('case', '7x10'), a.hcTrimOffered('jacket', '7x10'), a.hcTrimOffered('case', '4.25x7'), a.hcTrimOffered('jacket', '4.25x7'), a.hcTrimOffered('paperback', '4.25x7')])
        .toEqual([true, true, true, false, false, false, true]);
    });
  });

  it('cover.wrap.spine-direction (the table: languages, the writer\'s choice)', () => {
    const ttb = ['en', 'en-US', 'en-GB', 'en-AU', 'nl', 'sv', 'da', 'nb', 'nn', 'no', 'is', 'fi'], btt = ['fr', 'de', 'es', 'ru', 'it', 'pt', 'pl', 'el', 'xx', ''];
    expect(ttb.map((l) => c.api.spineDirection(l, 'auto'))).toEqual(ttb.map(() => 'ttb'));
    expect(btt.map((l) => c.api.spineDirection(l, 'auto'))).toEqual(btt.map(() => 'btt'));
    expect([c.api.spineDirection('en', 'btt'), c.api.spineDirection('fr', 'ttb')]).toEqual(['btt', 'ttb']);
  });

  it('cover.wrap.spine-back-normalize', () => {
    onDesk(LANTERN());
    run((a) => {
      type W = Rec & { spine: Rec & { bg: Rec; iconTop: Rec; iconBottom: Rec }; back: Rec & { bg: Rec } };
      const dflt = (w: W) => w.spine.bg.mode === 'front' && w.back.bg.mode === 'front' && w.spine.show === 'both' && w.spine.caps === true && w.spine.dir === 'auto' &&
        w.spine.iconTop.kind === 'none' && w.spine.iconBottom.kind === 'none' && w.spine.font === '' && w.spine.color === '' && w.spine.text === '' && w.back.font === '' && w.back.color === '';
      expect(dflt(a.normalizeWrap({}) as unknown as W)).toBe(true);
      expect(dflt(a.normalizeWrap(null) as unknown as W)).toBe(true);
      const junk = a.normalizeWrap({ spine: { bg: { mode: 'photo', color: 'red; x', dir: 'sideways', pattern: 'plaid' }, font: 'Comic Nope', color: 'red; x', show: 'all', dir: 'up',
        caps: 'yes', text: 42, iconTop: { kind: 'lucide', name: 'NoSuchIconAnywhere' }, iconBottom: { kind: 'upload', picId: 7 } },
        back: { bg: { mode: "gradient", color: "#12", color2: null }, font: {}, color: "javascript:1" } }) as unknown as W;
      expect(() => { a.normalizeWrap({ spine: 'x', back: [] }); a.normalizeWrap({ spine: { bg: 5, iconTop: 'star' } }); }).not.toThrow();
      expect([junk.spine.bg.mode, junk.spine.bg.color, junk.spine.bg.dir, junk.spine.bg.pattern, junk.spine.font, junk.spine.color, junk.spine.show, junk.spine.dir, junk.spine.caps, junk.spine.text,
        junk.spine.iconBottom.kind, junk.back.bg.mode, junk.back.bg.color, junk.back.bg.color2, junk.back.font, junk.back.color])
        .toEqual(['front', '#232a33', 'down', 'linen', '', '', 'both', 'auto', true, '', 'none', 'gradient', '#232a33', '#c9a959', '', '']);
      // the unknown Lucide name: none where Lucide is loaded (1.0's lucideKey checks window.lucide); kept as its key where it is not
      expect(['none', 'lucide']).toContain(junk.spine.iconTop.kind);
    });
  });

  it('cover.maker.ebook-render-dimensions, cover.maker.print-render-dimensions (the sizes)', () => {
    const doc = LANTERN();
    doc.printTrim = '6x9';
    onDesk(doc);
    expect([c.api.COVER_EBOOK_W, c.api.COVER_EBOOK_H]).toEqual([1600, 2560]);
    expect(run((a) => a.coverPrintSize())).toEqual({ w: 1800, h: 2700 });
  });

  it('cover.wrap.recipe-persists, cover.hardcover.recipe-persists, cover.maker.recipe-survives-roundtrip — through 2.0\'s Y.Doc and the export', () => {
    const y = onDesk(LANTERN());
    const wrapIn = run((a) => {
      const r = a.defaultCoverRecipe() as unknown as R;
      r.wrap = Object.assign(a.wrapDefaults(), { trim: '5.5x8.5', pages: 342, paper: 'custom', customFactor: 0.0031, blurb: 'Salt, storms and a stubborn harbourmaster.', quote: '“A triumph.”', imprint: 'Quiet Shelf Studio',
        binding: 'jacket', hcSpine: 0.874, hcSpineAllow: 0.05, flapFront: 'Front flap copy.', flapBack: 'Back flap bio.', flapPhotoId: 'sc-flap-photo',
        spine: { bg: { mode: 'solid', color: '#203040', color2: '#c9a959', dir: 'across', pattern: 'stripes' }, show: 'custom', text: 'BOOK II', caps: false, dir: 'ttb', iconTop: { kind: 'upload', picId: 'pic-1' }, color: '#f0e6d2' },
        back: { bg: { mode: 'pattern', color: '#304050', color2: '#c9a959', dir: 'down', pattern: 'grid' }, color: '#e8e0d0' } });
      r.title = 'Persisting Title';
      const s = (styleRun((cc) => cc.getState()) as unknown) as Rec;
      s.coverRecipe = a.normalizeCoverRecipe(r);
      return a.stableJson((s.coverRecipe as R).wrap);
    });
    const out = exportBook(y);
    expect(readBook(out).status).toBe('ok');
    const y2 = onDesk(JSON.parse(JSON.stringify(readBook(out).book)) as Rec);
    const back = run((a) => {
      const s = (styleRun((cc) => cc.getState()) as unknown) as Rec & { coverRecipe: R };
      return { wrap: a.stableJson(s.coverRecipe.wrap), title: s.coverRecipe.title };
    });
    expect(back.wrap).toBe(wrapIn);
    expect(back.title).toBe('Persisting Title');
    expect(exportBook(y2).coverRecipe).toEqual(out.coverRecipe);
    y.destroy();
    y2.destroy();
  });
});
