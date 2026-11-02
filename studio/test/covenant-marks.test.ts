import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EditorState, TextSelection } from 'prosemirror-state';
import { bookSchema, exportBook, importBook, moveSection, sectionKeys, textOffsetToPos, toDoc, toText } from '../../src/book/editor/index';
import { loadClosure, setClosureLang, type BibleMatcher, type Closure } from '../src/closure/index';
import { desk } from '../src/environment/page';
import { covReset, covRun } from '../src/covenant/covenant';
import { covenantDesk, covenantPlugin, rangesFor, rangesOf, setMarksClosure } from '../src/covenant/marks';
// @ts-expect-error a plain .mjs module (the e2e's own), no types
import { covenantDumas } from '../e2e/covenant-fixture.mjs';
import { fixtures, DUMAS } from './fixtures';

/* Wave 3b, task 2: the marks are 1.0's (constraint 26, review focus 2). For every section of every fixture with a
   Covenant, and of Dumas with the generated full Covenant (constraint 27's fixture), the decorations the plugin draws
   cover exactly the spans 1.0's bibleScan finds in the section's text (1.0's desk: bibleDesk.hits) — and stay exactly
   that after edits, which only re-scan the runs they touched. The book's text never changes (no stored marks). */

type Rec = Record<string, unknown>;
type Hit = { s: number; e: number; id: string };
let c: Closure;

beforeAll(async () => {
  c = await loadClosure();
  setClosureLang('en');
  setMarksClosure(c);
});
beforeEach(() => {
  covReset();
  localStorage.clear();
});

/** The book on the desk, the marks' matcher read (1.0's bibleMatcherNow on it). */
function onDesk(book: Rec): { y: Y.Doc; m: BibleMatcher | null } {
  const y = new Y.Doc();
  importBook(book, y);
  desk.ydoc = y;
  desk.active = null;
  covReset();
  covenantDesk.refresh(true);
  const m = covRun((cc) => cc.api.bibleMatcherNow() as BibleMatcher | null) ?? null;
  return { y, m };
}
const stateOf = (text: string) => EditorState.create({ schema: bookSchema, doc: toDoc(text), plugins: [covenantPlugin()] });
const scan = (text: string, m: BibleMatcher | null): Hit[] => (m ? c.api.bibleScan(text, m).hits.map((h) => ({ s: h.s, e: h.e, id: h.id })) : []);

describe('the marks equal 1.0\'s spans', () => {
  const withCov = fixtures('real').filter((f) => f.book.bible);
  const dumas = fixtures('real').find((f) => f.name === DUMAS)!;
  const full = covenantDumas(dumas.book) as Rec & { bible: { entries: Rec[] } };

  it(`the generated Covenant on Dumas has at least 200 entries (${full.bible.entries.length})`, () => {
    expect(full.bible.entries.length).toBeGreaterThanOrEqual(200);
  });

  for (const f of [...withCov.map((x) => ({ name: x.name, book: x.book })), { name: DUMAS + ' + full Covenant', book: full as Rec }]) {
    it(`${f.name}: every section's decorations are bibleScan's hits on its text`, () => {
      const { m } = onDesk(f.book);
      expect(m).not.toBeNull();
      let hits = 0, secs = 0;
      for (const s of (f.book.sections as Rec[]).filter((x) => typeof x.content === 'string' && x.content)) {
        const text = s.content as string;
        const st = stateOf(text);
        expect(toText(st.doc)).toBe(text);
        const want = scan(text, m);
        expect(rangesOf(st), `${f.name} ${String(s.id)}`).toEqual(rangesFor(st.doc, want));
        hits += want.length;
        secs++;
      }
      expect(secs).toBeGreaterThan(0);
      if (f.name.includes('full')) expect(hits).toBeGreaterThan(1000);
    }, 240_000);
  }

  it('edits re-scan only what they touched and the marks stay exactly 1.0\'s: typing inside and next to a name, a name typed letter by letter, a paragraph split and joined, a line break inside a two-word name, a deletion across paragraphs', () => {
    const { m } = onDesk({
      meta: { title: 'Edits', language: 'en', langSource: 'manual' },
      sections: [{ id: 's1', kind: 'body', type: 'chapter', number: '1', title: 'One', subtitle: '', content: 'x' }],
      bible: { entries: [{ id: 'e1', type: 'character', name: 'Captain Hale', aliases: ['Hale'] }, { id: 'e2', type: 'character', name: 'Mara', exclude: ['Mara Road'] }, { id: 'e3', type: 'place', name: 'Gullwick' }] },
    });
    const text = 'At dawn Mara walked to the quay.\n\nCaptain Hale was waiting at Gullwick.\nMara Road was empty.\n\nHale said *Mara* twice: Mara.';
    let st = stateOf(text);
    const check = (why: string) => expect(rangesOf(st), why + ': ' + JSON.stringify(toText(st.doc))).toEqual(rangesFor(st.doc, scan(toText(st.doc), m)));
    check('start');
    // a place in the text, as the position a cursor there has (textOffsetToPos: 1.0's offsets onto the page)
    const at = (needle: string, k = 0) => {
      const i = toText(st.doc).indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return textOffsetToPos(st.doc, i + k);
    };
    const type = (pos: number, s: string) => {
      for (const ch of s) {
        st = st.apply(st.tr.insertText(ch, pos));
        pos++;
        check('typing ' + ch);
      }
    };
    type(at('walked'), 'Gull');
    check('a name typed letter by letter, glued to a word');
    type(at('wick.', 4), 'x');
    st = st.apply(st.tr.delete(at('wickx.', 1), at('wickx.', 3)));
    check('a deletion inside a name');
    type(at('quay.', 4), ' Mara');
    st = st.apply(st.tr.split(at('was waiting')));
    check('a paragraph split');
    st = st.apply(st.tr.join(at('was waiting') - 1));
    check('the paragraphs joined');
    const pos = at('Hale said');
    st = st.apply(st.tr.insertText('Captain\nHale ', pos));
    check('a line break inside a two-word name');
    const a = at('At dawn'), b = at('Hale was');
    st = st.apply(st.tr.delete(a + 3, b));
    check('a deletion across paragraphs');
    st = st.apply(st.tr.setSelection(TextSelection.create(st.doc, 1)));
    check('a selection');
  });

  it("a block's own spacing changed (pre: one line break becomes a blank line) re-scans the run it left: no half of a two-word name stays marked (review of wave 3b, nit 4)", () => {
    const { m } = onDesk({
      meta: { title: 'Pre', language: 'en', langSource: 'manual' },
      sections: [{ id: 's1', kind: 'body', type: 'chapter', number: '1', title: 'One', subtitle: '', content: 'x' }],
      bible: { entries: [{ id: 'e1', type: 'character', name: 'Captain Hale', aliases: ['Hale'] }] },
    });
    const NL = '\n';
    // two blocks, the second opened by a single line break (one run: 1.0 reads "Captain\nHale" as the name)
    const S = bookSchema;
    const doc = S.node('doc', null, [S.node('paragraph', { pre: null, post: '' }, [S.text('The tide came in. Captain')]), S.node('paragraph', { pre: NL, post: '' }, [S.text('Hale waited on the quay.')])]);
    let st = EditorState.create({ schema: S, doc, plugins: [covenantPlugin()] });
    expect(toText(st.doc)).toBe('The tide came in. Captain' + NL + 'Hale waited on the quay.');
    const check = (why: string) => expect(rangesOf(st), why + ': ' + JSON.stringify(toText(st.doc))).toEqual(rangesFor(st.doc, scan(toText(st.doc), m)));
    check('start');
    // the block that starts after the single line break
    let at = -1;
    st.doc.forEach((n, off, i) => {
      if (i > 0 && at < 0 && n.attrs && n.attrs.pre === NL) at = off;
    });
    if (at < 0) return expect.unreachable('the text has no block opened by a single line break: ' + JSON.stringify(st.doc.toJSON()));
    st = st.apply(st.tr.setNodeAttribute(at, 'pre', NL + NL));
    expect(toText(st.doc)).toBe('The tide came in. Captain' + NL + NL + 'Hale waited on the quay.');
    check('the line break became a blank line');
  });

  it('a move (section order v2) keeps the marks: the moved chapter draws the same marks; the export text never holds a mark', () => {
    const lantern = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!;
    const { y, m } = onDesk(lantern.book);
    const before = JSON.stringify(exportBook(y));
    const text = (i: number) => toText(toDoc(String((exportBook(y).sections as Rec[])[i]!.content)));
    const i = (exportBook(y).sections as Rec[]).findIndex((s) => s.kind === 'body' && String(s.content).length > 100);
    const id = (exportBook(y).sections as Rec[])[i]!.id;
    const want = scan(text(i), m);
    expect(want.length).toBeGreaterThan(0);
    moveSection(y, sectionKeys(y)[i]!, sectionKeys(y).length - 1);
    const j = (exportBook(y).sections as Rec[]).findIndex((s) => s.id === id);
    const moved = stateOf(text(j));
    expect(rangesOf(moved)).toEqual(rangesFor(moved.doc, want));
    expect(JSON.stringify(exportBook(y))).not.toContain('bib-id');
    expect(JSON.stringify(exportBook(y)).length).toBe(before.length);
  });
});

/* ---- the real editor: the plugin mounted on a chapter's fragment (constraint 28) ---- */
describe('the marks on a mounted chapter editor', () => {
  beforeAll(() => {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect as DOMRect;
    Element.prototype.scrollIntoView = () => undefined;
    document.elementFromPoint = () => null;
  });
  const mountOn = async (y: Y.Doc, key: string) => {
    const { createChapterEditor } = await import('../src/editor/createEditor');
    const { sectionByKey, BODY } = await import('../../src/book/editor/index');
    const sec = sectionByKey(y, key) as Y.Map<unknown>;
    const element = document.createElement('div');
    document.body.appendChild(element);
    return createChapterEditor({ element, fragment: sec.get(BODY) as Y.XmlFragment, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
  };

  it('draws 1.0\'s marks on mount; after this tab moves the chapter (a remount) and after another synced Y.Doc moves and retypes it, the marks are the same, as the same spans; typing in the page re-marks; the text holds no mark', async () => {
    const lantern = fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!;
    const { y, m } = onDesk(lantern.book);
    const keys = sectionKeys(y);
    const secs = exportBook(y).sections as Rec[];
    const i = secs.findIndex((s) => s.kind === 'body' && String(s.content).length > 100);
    const key = keys[i]!;
    const want = (st: EditorState) => rangesFor(st.doc, scan(toText(st.doc), m));
    let ed = await mountOn(y, key);
    expect(rangesOf(ed.state).length).toBeGreaterThan(0);
    expect(rangesOf(ed.state)).toEqual(want(ed.state));
    const first = JSON.stringify(rangesOf(ed.state));
    // this tab moves it to the end: the Desk remounts the editor (keyed by index), the fragment is the same
    moveSection(y, key, keys.length - 1);
    ed.destroy();
    ed = await mountOn(y, key);
    expect(JSON.stringify(rangesOf(ed.state))).toBe(first);
    // another Y.Doc, synced both ways, moves it back and retypes it (cross-tier): the open editor keeps its marks
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(y));
    other.on('update', (u: Uint8Array) => Y.applyUpdate(y, u));
    moveSection(other, key, 1);
    const { sectionByKey } = await import('../../src/book/editor/index');
    (sectionByKey(other, key) as Y.Map<unknown>).set('kind', 'back');
    expect(JSON.stringify(rangesOf(ed.state))).toBe(first);
    // typing a name re-marks it, through the editor's own transaction
    const end = ed.state.doc.content.size - 1;
    ed.commands.insertContentAt(end, ' Mara');
    expect(rangesOf(ed.state)).toEqual(want(ed.state));
    expect(JSON.stringify(exportBook(y))).not.toContain('data-bib');
    ed.destroy();
  });
});
