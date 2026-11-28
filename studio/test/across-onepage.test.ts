import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { arriveForExport } from '../src/export/state';
import { exportSafe } from '../src/export/safe';
import { installStandIns, png, type Rec } from './across-fixture';

/* Across both pages, Task 5 — the e-reader and the one-page views. An "across" plate has no second page to
   continue on there, so EPUB, Zen and the standalone HTML show it whole, on its own page, with its alt text:
   exactly what "Show the whole picture" gives. "Fill the page" and "Show the whole picture" stay byte for byte
   what they were: their fingerprints below were taken from the code before this task. The chapter's stored
   backdrop is set aside on these views as in print (Task 8, fix round 1: backdropInEffect). */

const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const WIDE = png(1600, 1200);
let c: Closure;
let a: Rec;
beforeAll(async () => {
  installStandIns();
  c = await loadClosure();
  a = c.api as unknown as Rec;
  setClosureT(t);
  setClosureLang('en');
});
function book(fit: string | undefined): { st: Rec; ch: Rec } {
  const book0 = c.api.buildEmptyBook() as Rec;
  const st = arriveForExport(c, structuredClone(book0)) as unknown as Rec;
  exportSafe(c, st as never, book0);
  c.setState(st as never);
  st.images = [{ id: 'wide', name: 'Harbour at dusk', mediaType: 'image/png', ext: 'png', data: WIDE }];
  const ch = (st.sections as Rec[]).find((s) => s.kind === 'body' && s.type === 'chapter')!;
  ch.title = 'One';
  ch.content = 'The harbour bell rang over the water at first light.';
  Object.assign(ch, { plateId: 'wide', plateAlt: 'A harbour at dusk, wide' });
  if (fit) ch.plateFit = fit;
  st.printTrim = '6x9';
  return { st, ch };
}
/** What the three one-page views make of the book with its first chapter's plate set to `fit`. */
async function views(fit: string | undefined) {
  const { ch } = book(fit);
  const files = (a.epubFiles() as { path: string; content: unknown }[]);
  const plate = files.find((f) => /plate_\d+\.xhtml$/.test(f.path));
  const css = files.find((f) => /\.css$/.test(f.path));
  return {
    epubPlate: String(plate?.content ?? ''),
    epubCss: String(css?.content ?? ''),
    zen: String(a.plateHtml(ch, false, true, true)),
    page: String(a.plateHtml(ch, true, false, true)),
    standalone: String(a.buildStandaloneHtml()),
  };
}
/** The same book with a picture of its own in the library ('bdpic'); with `bd`, it is the chapter's stored backdrop (Whisper).
 *  What the EPUB (the chapter's own file, and whether the backdrop's file ships) and the standalone page make of it. */
function backdropViews(fit: string, bd: boolean) {
  const { st, ch } = book(fit);
  (st.images as Rec[]).push({ id: 'bdpic', name: 'Night harbour', mediaType: 'image/png', ext: 'png', data: png(300, 450) });
  if (bd) Object.assign(ch, { backdropId: 'bdpic', backdropStrength: 'whisper' });
  const files = (a.epubFiles() as { path: string; content: unknown }[]);
  const chapter = files.find((f) => /\.xhtml$/.test(f.path) && !/plate_/.test(f.path) && String(f.content).includes('over the water at first light'));
  expect(chapter, `the chapter's own file among ${files.map((f) => f.path).join(', ')}`).toBeTruthy();
  return {
    ch,
    chapter: String(chapter?.content ?? ''),
    shipped: files.some((f) => f.path.endsWith('-bdpic.png')),
    standalone: String(a.buildStandaloneHtml()),
  };
}
const FINGERPRINT: Record<string, Record<string, string>> = {
  fill: { epubPlate: '6722ec85487d1e26', epubCss: '4c82a0710e9e455c', zen: '3a61d99e8371bcf5', page: 'c662d11c5312fa58', standalone: 'aa551b4ed5f91e8e' },
  whole: { epubPlate: '4f62f83b001296c3', epubCss: '5ff87f3924b77d10', zen: '3a61d99e8371bcf5', page: '1c2f363d3ea87c77', standalone: 'bf9ebe11d273144f' },
};

describe('Across both pages on e-readers and one-page views (Task 5)', () => {
  it('EPUB: an across plate\'s own page equals the whole plate\'s page (plate-full plate-whole, same alt text), and its stylesheet carries the whole rules', async () => {
    const whole = await views('whole');
    const across = await views('across');
    expect(whole.epubPlate).toContain('<div class="plate-full plate-whole">');
    expect(whole.epubPlate).toContain('alt="A harbour at dusk, wide"');
    expect(across.epubPlate).toBe(whole.epubPlate);
    expect(across.page).toBe(whole.page);
    expect(across.epubCss).toBe(whole.epubCss);
    expect(across.epubCss).toContain('.plate-full.plate-whole img');
  });
  it('Zen and the standalone page show an across plate whole', async () => {
    const whole = await views('whole');
    const across = await views('across');
    expect(across.zen).toBe(whole.zen);
    expect(across.zen).toMatch(/^<div class="plate-full"><img /);
    expect(across.standalone).toBe(whole.standalone);
    expect(across.standalone).toContain('<figure class="plate-page plate-whole">');
    expect(across.standalone).not.toContain('plate-across');
  });
  it('the chapter\'s stored backdrop is set aside there too: no layer, its file not shipped, the stored keys untouched; at Fill it is drawn (the control)', () => {
    const fill = backdropViews('fill', true);
    expect(fill.chapter).toContain('<div class="bd-layer bd-whisper" style="background-image:url(../Images/night-harbour-bdpic.png)"');
    expect(fill.chapter).toContain('has-backdrop');
    expect(fill.shipped).toBe(true);
    expect(fill.standalone).toContain('class="bd-layer bd-whisper"');
    const across = backdropViews('across', true);
    expect(across.chapter).not.toContain('bd-layer');
    expect(across.chapter).not.toContain('has-backdrop');
    expect(across.shipped).toBe(false);
    expect(across.standalone).not.toContain('class="bd-layer');
    expect([across.ch.backdropId, across.ch.backdropStrength]).toEqual(['bdpic', 'whisper']);
    // byte for byte the whole plate's with no backdrop at all
    const bare = backdropViews('whole', false);
    expect(across.chapter).toBe(bare.chapter);
    expect(across.standalone).toBe(bare.standalone);
  });
  it('fill and whole stay byte for byte what they were', async () => {
    for (const fit of ['fill', 'whole']) {
      const v = await views(fit);
      const got = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, sha(s)]));
      expect(got, fit).toEqual(FINGERPRINT[fit]);
    }
  });
});
