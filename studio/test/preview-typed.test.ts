import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { exportBook, importBook } from '../../src/book/editor/index';
import { sectionAt, sectionsCount } from '../../src/book/editor/sections';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { bookState, loadClosure, setClosureLang, setClosureT, type Closure } from '../src/closure/index';
import { translate, type Pack, type PluralForms } from '../src/i18n/translate';
import { desk } from '../src/environment/page';
import { styleEnter, styleRelease, styleReset, styleStats } from '../src/style/session';
import { DUMAS, fixtures } from './fixtures';

/* The preview's redraw after typing (design 2026-11-04-beuk-2-preview-typed-section-design.md): a transaction that only
   changes text inside section bodies re-reads those sections, not the whole book; anything else rebuilds as before.
   The patched state's sections always equal a full rebuild's (minted ids aside). */

type Rec = Record<string, unknown>;
const t = (k: string, p?: Rec) => translate({ packs: { en: en as Pack }, pluralForms: meta.pluralForms as PluralForms }, 'en', k, p);
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
  setClosureT(t);
  setClosureLang('en');
});
beforeEach(() => {
  styleRelease();
  desk.ydoc = null;
});

const onDesk = (doc: Rec) => {
  const y = new Y.Doc();
  importBook(structuredClone(doc), y);
  desk.ydoc = y;
  desk.active = null;
  styleReset();
  return y;
};
const body = (y: Y.Doc, i: number) => (sectionAt(y, i) as Y.Map<unknown>).get('body') as Y.XmlFragment;
/** The first text node in a section's body (a paragraph's), or null for an empty body. */
function firstText(t: Y.XmlFragment | Y.XmlElement): Y.XmlText | null {
  for (const k of t.toArray()) {
    if (k instanceof Y.XmlText) return k;
    if (k instanceof Y.XmlElement) {
      const r = firstText(k);
      if (r) return r;
    }
  }
  return null;
}
/** The session's sections, with ids the book does not store replaced (normalizeSection mints them). */
const sectionsOf = (y: Y.Doc, st: Rec) => {
  const stored = new Set((exportBook(y).sections as Rec[]).map((s) => s.id).filter((x) => typeof x === 'string' && x));
  return JSON.parse(JSON.stringify((st.sections as Rec[]).map((s) => (stored.has(s.id) ? s : { ...s, id: '<minted>' }))));
};
/** A full rebuild of the book as it stands, the session's state put back after. */
function rebuilt(y: Y.Doc): Rec {
  const keep = c.getState();
  const st = bookState(c, y).state as unknown as Rec;
  c.setState(keep);
  return st;
}
const live = () => c.getState() as unknown as Rec;
const rest = (st: Rec) => {
  const { sections: _s, ...o } = st;
  return JSON.stringify(o);
};

describe('a keystroke re-reads only the typed section', () => {
  it('Dumas: typing, then styleEnter, rebuilds nothing and patches once', () => {
    const y = onDesk(fixtures('real').find((f) => f.name === DUMAS)!.book);
    expect(styleEnter()).toBeTruthy();
    const b0 = styleStats.builds, p0 = styleStats.patches;
    firstText(body(y, 12))!.insert(0, 'x');
    styleEnter();
    expect(styleStats.builds - b0).toBe(0);
    expect(styleStats.patches - p0).toBe(1);
    expect(styleStats.lastRead).toBe(1);
  });

  it('every fixture: typed, deleted, marked, split, two sections at once — the sections equal a full rebuild', () => {
    let ran = 0;
    for (const f of fixtures('all')) {
      const y = onDesk(f.book);
      if (!styleEnter()) continue;
      const n = sectionsCount(y);
      const texts = Array.from({ length: n }, (_, i) => i).filter((i) => firstText(body(y, i)));
      if (!texts.length) continue;
      ran++;
      const before = rest(live());
      const steps: Array<() => void> = [
        () => firstText(body(y, texts[0]!))!.insert(0, 'Typed '),
        () => {
          const tx = firstText(body(y, texts[0]!))!;
          if (tx.length > 2) tx.delete(0, 2);
        },
        () => {
          const tx = firstText(body(y, texts[texts.length - 1]!))!;
          tx.format(0, Math.min(3, tx.length), { em: {} });
        },
        () => {
          const frag = body(y, texts[0]!);
          const p = new Y.XmlElement('paragraph');
          p.insert(0, [new Y.XmlText('A new paragraph.')]);
          frag.insert(frag.length, [p]);
        },
        () =>
          y.transact(() => {
            for (const i of texts.slice(0, 2)) firstText(body(y, i))!.insert(0, 'Both ');
          }),
      ];
      for (const [k, step] of steps.entries()) {
        const b0 = styleStats.builds;
        step();
        styleEnter();
        expect(styleStats.builds - b0, `${f.name} step ${k}: patched, not rebuilt`).toBe(0);
        expect(sectionsOf(y, live()), `${f.name} step ${k}`).toEqual(sectionsOf(y, rebuilt(y)));
        expect(rest(live()), `${f.name} step ${k}: nothing outside the sections moved`).toBe(before);
      }
    }
    expect(ran).toBeGreaterThanOrEqual(20);
  }, 300_000);

  it('a section field, the order, or meta: the full rebuild, as before', () => {
    const y = onDesk(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book);
    styleEnter();
    const i = Array.from({ length: sectionsCount(y) }, (_, k) => k).find((k) => firstText(body(y, k)))!;
    const edits: Array<[string, () => void]> = [
      ['a title', () => (sectionAt(y, i) as Y.Map<unknown>).set('title', 'Retitled')],
      ['meta', () => y.getMap('meta').set('title', 'Another Title')],
      ['a body and a title together', () =>
        y.transact(() => {
          firstText(body(y, i))!.insert(0, 'x');
          (sectionAt(y, i + 1) as Y.Map<unknown>).set('title', 'Again');
        })],
    ];
    for (const [name, edit] of edits) {
      const b0 = styleStats.builds;
      edit();
      styleEnter();
      expect(styleStats.builds - b0, name).toBe(1);
      expect(sectionsOf(y, live()), name).toEqual(sectionsOf(y, rebuilt(y)));
    }
  });

  it('the patched section is a new object; the others are the same objects', () => {
    const y = onDesk(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book);
    styleEnter();
    const was = [...(live().sections as Rec[])];
    const i = (live().sections as Rec[]).findIndex((_, k) => firstText(body(y, k)));
    firstText(body(y, i))!.insert(0, 'x');
    styleEnter();
    const now = live().sections as Rec[];
    now.forEach((s, k) => (k === i ? expect(s).not.toBe(was[k]) : expect(s).toBe(was[k])));
  });
});
