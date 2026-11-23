import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { bookSchema as S, fragmentText, toDoc } from '@book/editor/index.js';
import { createChapterEditor } from '../src/editor/createEditor';
import { flushNormalize } from '../src/editor/behaviour';

/* The 2.0 editor shows a list as the book stores it (BEUK:listmarksgiven, BEUK:looselists).

   Measured in a real browser before this: a list stored "3. the morning watch" / "7. the first dog watch" / "9. the
   first watch" was drawn <ol start="3"> over three plain <li> (so 3, 4, 5), where the typeset page drew the same
   block with value="7" and value="9"; and a list whose items the writer parted with blank lines (three stored
   blocks "* a lantern", "* a chart case", "* two letters") was one <ul> on the typeset page and three paragraphs
   opening on an asterisk in the editor.

   Now each numbered item carries its stored number (<li value>), and the editor reads a run of blocks that open on a
   list's mark of one kind as the one list 1.0 reads (convert.ts looseLists). Nothing new is stored: opening such a
   list, typing one character in one item and closing the chapter writes back the stored text with that one
   character more, every blank line, indent and mark of the other items as they were. Every text here is made up. */

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  document.body.innerHTML = '';
});
function mount(fragment: Y.XmlFragment): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = createChapterEditor({ element, fragment, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
  editors.push(ed);
  return ed;
}
/** A fresh fragment holding `text` as the import stores it (toDoc). */
function fragOf(text: string): Y.XmlFragment {
  const frag = new Y.Doc().getXmlFragment('body');
  ypPmToFrag(toDoc(text), frag);
  return frag;
}
/** The lists the editor draws: each as its tag, its start, and each item's value and text. */
const drawn = (ed: Editor) => Array.from(ed.view.dom.querySelectorAll('ol, ul')).map((l) => ({ tag: l.tagName.toLowerCase(), start: l.getAttribute('start'), items: Array.from(l.querySelectorAll('li')).map((li) => [li.getAttribute('value'), li.textContent]) }));
/** Type `ch` at the end of the text that reads `at` (the first textblock holding it). */
function typeAfter(ed: Editor, at: string, ch: string): void {
  let pos = -1;
  ed.state.doc.descendants((n, p) => { if (pos < 0 && n.isTextblock && n.textContent.indexOf(at) !== -1) pos = p + 1 + n.textContent.indexOf(at) + at.length; return pos < 0; });
  expect(pos, 'the text "' + at + '" is in the editor').toBeGreaterThan(0);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
  ed.view.dispatch(ed.state.tr.insertText(ch));
}

const NUMBERS = 'The watches ran so:\n\n3. the morning watch\n7. the first dog watch\n9. the first watch\n\nAnd no others.';
const LOOSE = 'He packed:\n\n* a lantern\n\n* a chart case\n\n* two letters\n\nThen he left.';
const LOOSE_NUMBERS = '1. first the quay\n\n2. then the pans\n\n4. then home';
const PLAIN_TEXT = 'He packed, and the list was short\nand it ran so:\n * a lantern\n\n * a coil of rope\n\n * the ledger that he would\nnot leave behind\n\nThen he left.';

describe('the editor draws a list as the book stores it', () => {
  it('each numbered item is drawn under its stored number: 3. 7. 9. is 3, 7, 9', () => {
    const ed = mount(fragOf(NUMBERS));
    expect(drawn(ed)).toEqual([{ tag: 'ol', start: '3', items: [['3', 'the morning watch'], ['7', 'the first dog watch'], ['9', 'the first watch']] }]);
  });

  it('a list numbered on in steps of one is drawn as it was, each item under its own number; a bulleted one carries no number', () => {
    const ed = mount(fragOf('1. one\n2) two\n3. three\n\n- a\n- b'));
    expect(drawn(ed)).toEqual([{ tag: 'ol', start: null, items: [['1', 'one'], ['2', 'two'], ['3', 'three']] }, { tag: 'ul', start: null, items: [[null, 'a'], [null, 'b']] }]);
  });

  it('a list whose items are parted by blank lines is drawn as one list, not as paragraphs that open on an asterisk', () => {
    const ed = mount(fragOf(LOOSE));
    expect(drawn(ed)).toEqual([{ tag: 'ul', start: null, items: [[null, 'a lantern'], [null, 'a chart case'], [null, 'two letters']] }]);
    expect(Array.from(ed.view.dom.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['He packed:', 'Then he left.']);
    const ed2 = mount(fragOf(LOOSE_NUMBERS));
    expect(drawn(ed2)).toEqual([{ tag: 'ol', start: null, items: [['1', 'first the quay'], ['2', 'then the pans'], ['4', 'then home']] }]);
  });

  it('the plain-text shape: the lines over the first item are their paragraph, the items one list', () => {
    const ed = mount(fragOf(PLAIN_TEXT));
    expect(drawn(ed)).toEqual([{ tag: 'ul', start: null, items: [[null, 'a lantern'], [null, 'a coil of rope'], [null, 'the ledger that he would\nnot leave behind']] }]);
    expect(ed.view.dom.querySelector('p')!.textContent).toBe('He packed, and the list was short\nand it ran so:');
  });
});

describe('the editor draws an item under the mark the writer typed (BEUK:listmarkstyped)', () => {
  const marks = (ed: Editor) => Array.from(ed.view.dom.querySelectorAll('ol, ul')).map((l) => l.tagName.toLowerCase() + ' ' + Array.from(l.querySelectorAll('li')).map((x) => (x.getAttribute('data-mark') ?? '') + (x.getAttribute('value') ? '=' + x.getAttribute('value') : '')).join(' '));
  it('a letter, a Roman numeral, a mark in brackets, a number closed with a bracket, a bullet of the writer\'s own: each item carries its mark; the book\'s own number and disc are drawn as they were', () => {
    const ed = mount(fragOf('a. one\nb. two\n\niv. one\nv. two\n\n(1) one\n(2) two\n\n2) one\n3) two\n\n+ one\n+ two\n\n5. one\n9. two\n\n◆ one\n- two\n● three\n\nThen.\n\n* one\n* two'));
    expect(marks(ed)).toEqual(['ol a. b.', 'ol iv. v.', 'ol (1) (2)', 'ol 2)=2 3)=3', 'ul + +', 'ol =5 =9', 'ul ◆  ●', 'ul  ']);
    expect(ed.view.dom.querySelectorAll('li.ms-li-typed').length).toBe(12);
    expect(Array.from(ed.view.dom.querySelectorAll('p')).map((p) => p.textContent), 'none of the lists is a paragraph').toEqual(['Then.']);
  });
  it('a name, and letters that do not climb, stay paragraphs', () => {
    const ed = mount(fragOf('A. Conan Doyle wrote of a hound.\n\nQ. What did the clerk see?\nA. Nothing at all.'));
    expect(ed.view.dom.querySelectorAll('li').length).toBe(0);
    expect(ed.view.dom.querySelectorAll('p').length).toBe(2);
  });
  it('open, type one character in one item, close the chapter: the marks and the other items are as stored', () => {
    const stored = 'They came so:\n\niv. the pilot\nv. the clerk\nvii. the boy\n\n◆ a lantern\n\n◆ a chart case\n\n(a) first\n(b) then';
    const frag = fragOf(stored);
    const ed = mount(frag);
    expect(marks(ed)).toEqual(['ol iv. v. vii.', 'ul ◆ ◆', 'ol (a) (b)']);
    typeAfter(ed, 'the clerk', 'x');
    typeAfter(ed, 'chart case', 'x');
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe(stored.replace('the clerk', 'the clerkx').replace('chart case', 'chart casex'));
    expect(marks(ed)).toEqual(['ol iv. v. vii.', 'ul ◆ ◆', 'ol (a) (b)']);
  });
});

describe('editing one item of such a list writes back exactly what was stored for the others', () => {
  const cases: [string, string, string, string][] = [
    ['stored numbers', NUMBERS, 'first dog watch', NUMBERS.replace('first dog watch', 'first dog watchx')],
    ['items parted by blank lines', LOOSE, 'chart case', LOOSE.replace('chart case', 'chart casex')],
    ['numbered items parted by blank lines', LOOSE_NUMBERS, 'the pans', LOOSE_NUMBERS.replace('the pans', 'the pansx')],
    ['the plain-text shape', PLAIN_TEXT, 'coil of rope', PLAIN_TEXT.replace('coil of rope', 'coil of ropex')],
    ['blank lines of several kinds and an indent', '* a  \n\n\n* b\n \t \n   * c\n\nEnd.', 'b', '* a  \n\n\n* bx\n \t \n   * c\n\nEnd.'],
  ];
  for (const [what, stored, at, want] of cases) {
    it(what + ': open, type one character in one item, close the chapter', () => {
      const frag = fragOf(stored);
      expect(fragmentText(frag), 'opened and not touched, the text is the stored text').toBe(stored);
      const ed = mount(frag);
      expect(fragmentText(frag), 'mounted and not touched').toBe(stored);
      typeAfter(ed, at, 'x');
      flushNormalize(ed);
      expect(fragmentText(frag)).toBe(want);
      /* and it is still drawn as the list it is */
      expect(ed.view.dom.querySelectorAll('li').length).toBe(3);
    });
  }
});

describe('a book stored before this reading', () => {
  it('opens with the text it had; its item blocks are read as the list they are once one of them is edited, the text unchanged but for the edit', () => {
    /* as an older build stored it: each item a paragraph of its own */
    const stored = 'He packed:\n\n* a lantern\n\n* a chart case\n\n* two letters\n\n* a compass\n\nThen he left.';
    const frag = new Y.Doc().getXmlFragment('body');
    ypPmToFrag(S.node('doc', null, stored.split('\n\n').map((x) => S.node('paragraph', null, [S.text(x)]))), frag);
    const ed = mount(frag);
    expect(fragmentText(frag)).toBe(stored);
    expect(ed.view.dom.querySelectorAll('li').length, 'not touched, the stored blocks are as they were (opening writes nothing)').toBe(0);
    typeAfter(ed, 'chart case', 'x');
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe(stored.replace('chart case', 'chart casex'));
    expect(drawn(ed)).toEqual([{ tag: 'ul', start: null, items: [[null, 'a lantern'], [null, 'a chart casex'], [null, 'two letters'], [null, 'a compass']] }]);
  });
});
