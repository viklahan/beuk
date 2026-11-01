import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { prosemirrorToYXmlFragment as ytPmToFrag, yXmlFragmentToProseMirrorRootNode as ytFragToPm } from '@tiptap/y-tiptap';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { BODY, SECTIONS, bookSchema, exportBook, fragmentText, importBook, toDoc, toText } from '@book/editor/index.js';
import { readBook } from '@book/read.js';
import { createChapterEditor } from '../src/editor/createEditor';
import { flushNormalize, pendingBlocks, toggleBookMark } from '../src/editor/behaviour';
import { fixtures } from './fixtures';

/* The chapter editor against Part B's core:
   - constraint 2: what the y-tiptap binding writes, Part B's export reads
     back byte for byte (and the other way round);
   - review focus #1 in jsdom: mount every chapter, type nothing, export =
     the original;
   - constraints 3 and 4: Enter is "\n", normalising waits for the
     selection to leave the block, remote edits are never normalised;
   - the mark refusal. */

beforeAll(() => {
  // jsdom has no layout: ProseMirror's scrollIntoView asks for rects
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

function mount(fragment: Y.XmlFragment, onRefuse: () => void = () => undefined): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = createChapterEditor({ element, fragment, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse });
  editors.push(ed);
  return ed;
}

/** A fresh fragment holding `text`, written by Part B's writer (y-prosemirror), as importBook does. */
function fragOf(text: string): { doc: Y.Doc; frag: Y.XmlFragment } {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment('body');
  ypPmToFrag(toDoc(text), frag);
  return { doc, frag };
}

const SMALL = fixtures('all').filter((f) => !/dartagnan|valois|oz-14/.test(f.name));
const sectionTexts = (list = fixtures('all')) =>
  list.flatMap((f) => (Array.isArray(f.book.sections) ? (f.book.sections as { content?: unknown }[]) : []).filter((s) => typeof s.content === 'string').map((s, i) => ({ where: `${f.name}#${i}`, text: s.content as string })));

describe('y-tiptap and Part B write and read the same fragment (constraint 2)', () => {
  it('every section of every fixture: y-tiptap writes, exportBook\'s reader gives the text back byte for byte; Part B writes, y-tiptap reads the same document', () => {
    const all = sectionTexts();
    expect(all.length).toBeGreaterThan(300);
    for (const { where, text } of all) {
      const pm = toDoc(text);
      const d1 = new Y.Doc();
      const f1 = d1.getXmlFragment('body');
      ytPmToFrag(pm, f1);
      expect(fragmentText(f1, where), where).toBe(text);
      const { frag } = fragOf(text);
      expect(ytFragToPm(frag, bookSchema).eq(pm), where).toBe(true);
      // and the two writers produce the same Yjs content
      expect(JSON.stringify(f1.toJSON()), where).toBe(JSON.stringify(frag.toJSON()));
    }
  });

  it('through the live binding: an editor on an empty fragment, given a chapter, writes what exportBook reads back exactly', () => {
    for (const { where, text } of sectionTexts(SMALL)) {
      const doc = new Y.Doc();
      const frag = doc.getXmlFragment('body');
      const ed = mount(frag);
      const pm = ed.schema.nodeFromJSON(toDoc(text).toJSON());
      ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, pm.content));
      expect(fragmentText(frag, where), where).toBe(text);
      ed.destroy();
    }
  });

  it('typing through the binding: the fragment always reads back as the editor\'s own text', () => {
    const { frag } = fragOf('One *two* three.\n\nFour [^1] five.\n\n[^1]: A note.');
    const ed = mount(frag);
    ed.commands.setTextSelection(5); // after "One "
    for (const ch of 'abc *d* e') ed.view.dispatch(ed.state.tr.insertText(ch));
    expect(fragmentText(frag)).toBe(toText(bookSchema.nodeFromJSON(ed.state.doc.toJSON())));
    expect(fragmentText(frag).startsWith('One abc *d* e*two*')).toBe(true);
  });
});

describe('the no-edit gate with real editors (review focus #1, jsdom)', () => {
  it('every fixture but the three longest: open, mount every chapter\'s editor, type nothing, close, export = readBook\'s book', () => {
    expect(SMALL.length).toBeGreaterThanOrEqual(20);
    for (const f of SMALL) {
      const { ydoc } = importBook(f.book);
      const updates: Uint8Array[] = [];
      ydoc.on('update', (u: Uint8Array) => updates.push(u));
      const sections = ydoc.getArray<unknown>(SECTIONS).toArray();
      for (const s of sections) {
        if (!(s instanceof Y.Map) || !(s.get(BODY) instanceof Y.XmlFragment)) continue;
        const ed = mount(s.get(BODY) as Y.XmlFragment);
        flushNormalize(ed); // the chapter closes
        ed.destroy();
      }
      expect(updates.length, `${f.name}: mounting and closing editors wrote to the book`).toBe(0);
      const r = readBook(f.book);
      const out = exportBook(ydoc);
      const want = JSON.parse(JSON.stringify(r.book)) as Record<string, Record<string, unknown>>;
      if (r.upgrades.includes('bookid-missing')) want.meta!.bookId = (out.meta as Record<string, unknown>).bookId;
      expect(JSON.stringify(out), f.name).toBe(JSON.stringify(want));
    }
  }, 120_000);
});

describe('typing and normalising (constraints 3 and 4)', () => {
  const blockTexts = (ed: Editor) => {
    const out: string[] = [];
    ed.state.doc.forEach((b) => out.push(b.type.name + ':' + b.textContent));
    return out;
  };

  it('Enter and Shift-Enter insert "\\n" inside the paragraph; two make a blank line that splits the block once the selection leaves', () => {
    const { frag } = fragOf('First line\n\nSecond.');
    const ed = mount(frag);
    ed.commands.setTextSelection(1 + 'First line'.length);
    ed.commands.keyboardShortcut('Enter');
    ed.view.dispatch(ed.state.tr.insertText('next'));
    expect(blockTexts(ed)).toEqual(['paragraph:First line\nnext', 'paragraph:Second.']);
    ed.commands.keyboardShortcut('Shift-Enter');
    ed.commands.keyboardShortcut('Enter');
    ed.view.dispatch(ed.state.tr.insertText('third'));
    // still one block while the writer is in it
    expect(blockTexts(ed)).toEqual(['paragraph:First line\nnext\n\nthird', 'paragraph:Second.']);
    expect(fragmentText(frag)).toBe('First line\nnext\n\nthird\n\nSecond.');
    // the selection leaves: the blank line now splits it, and the text is unchanged
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));
    expect(blockTexts(ed)).toEqual(['paragraph:First line\nnext', 'paragraph:third', 'paragraph:Second.']);
    expect(fragmentText(frag)).toBe('First line\nnext\n\nthird\n\nSecond.');
  });

  it('typing "2*3 and 4*5" does not jump while typing; it normalises (to em) after the selection leaves', () => {
    const { frag } = fragOf('Sum: \n\nNext paragraph.');
    const ed = mount(frag);
    // "Sum:" — the trailing space is the block's post; put the cursor after "Sum:"
    ed.commands.setTextSelection(1 + 'Sum:'.length);
    const typed = ' 2*3 and 4*5';
    let sofar = 'Sum:';
    for (const ch of typed) {
      ed.view.dispatch(ed.state.tr.insertText(ch));
      sofar += ch;
      const first = ed.state.doc.firstChild!;
      expect(first.textContent, `after "${sofar}"`).toBe(sofar);
      expect(first.content.content.every((n) => n.marks.length === 0), `no mark yet after "${sofar}"`).toBe(true);
      expect(ed.state.selection.from, 'the cursor stays where the writer types').toBe(1 + sofar.length);
    }
    expect(pendingBlocks(ed.state)).toEqual([0]);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));
    const first = ed.state.doc.firstChild!;
    expect(first.textContent).toBe('Sum: 23 and 45');
    const em: string[] = [];
    first.forEach((n) => { if (n.marks.some((m) => m.type.name === 'em')) em.push(n.text!); });
    expect(em).toEqual(['3 and 4']);
    expect(pendingBlocks(ed.state)).toEqual([]);
    // the space that followed "Sum:" is the next block's separator, as before
    expect(fragmentText(frag)).toBe('Sum: 2*3 and 4*5 \n\nNext paragraph.');
  });

  it('trailing spaces in the block being typed in stay until the selection leaves; closing the chapter normalises the held block', () => {
    const { frag } = fragOf('Alpha\n\nBeta');
    const ed = mount(frag);
    ed.commands.setTextSelection(1 + 'Alpha'.length);
    ed.view.dispatch(ed.state.tr.insertText('  '));
    expect(ed.state.doc.firstChild!.textContent).toBe('Alpha  ');
    flushNormalize(ed);
    expect(ed.state.doc.firstChild!.textContent).toBe('Alpha');
    expect(ed.state.doc.firstChild!.attrs.post).toBe('');
    expect(fragmentText(frag)).toBe('Alpha  \n\nBeta');
  });

  it('remote (Yjs) changes are never normalised', () => {
    const { doc, frag } = fragOf('One\n\nTwo');
    const ed = mount(frag);
    // another tab writes a block whose text holds a blank line (not normal: it reads back as two blocks)
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const ofrag = other.getXmlFragment('body');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('a\n\nb')]);
    ofrag.insert(ofrag.length, [p]);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
    expect(ed.state.doc.childCount).toBe(3);
    expect(ed.state.doc.lastChild!.textContent).toBe('a\n\nb');
    expect(pendingBlocks(ed.state)).toEqual([]);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atStart(ed.state.doc)));
    expect(ed.state.doc.childCount).toBe(3);
  });

  it('nothing is normalised when nothing was typed: selection moves alone never change the document', () => {
    const text = 'Indented first line?\n\n  Leading spaces kept.\n\n*a**b*\n\n';
    const { doc, frag } = fragOf(text);
    const ed = mount(frag);
    const before = Y.encodeStateVector(doc);
    for (let p = 1; p < ed.state.doc.content.size; p += 3) ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(p))));
    flushNormalize(ed);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(fragmentText(frag)).toBe(text);
  });
});

describe('bold and italic (constraint 4: canApplyMark)', () => {
  it('a clean selection takes the mark; the text writes the asterisks back', () => {
    const { frag } = fragOf('A plain word here.');
    const ed = mount(frag);
    let refused = 0;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1 + 'A plain '.length, 1 + 'A plain word'.length)));
    expect(toggleBookMark(ed, 'em', () => refused++)).toBe(true);
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe('A plain *word* here.');
    expect(toggleBookMark(ed, 'strong', () => refused++)).toBe(true);
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe('A plain ***word*** here.');
    // toggling again removes it
    expect(toggleBookMark(ed, 'strong', () => refused++)).toBe(true);
    expect(toggleBookMark(ed, 'em', () => refused++)).toBe(true);
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe('A plain word here.');
    expect(refused).toBe(0);
  });

  it('a selection the text cannot say back (an asterisk inside) is refused with the toast callback, and nothing changes', () => {
    const { frag } = fragOf('Price 2*3 today.');
    const ed = mount(frag);
    let refused = 0;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1 + 'Price '.length, 1 + 'Price 2*3'.length)));
    expect(toggleBookMark(ed, 'em', () => refused++)).toBe(false);
    expect(refused).toBe(1);
    expect(fragmentText(frag)).toBe('Price 2*3 today.');
  });

  it('a raw block takes no marks: refused', () => {
    const { frag } = fragOf('> a quote line\n> another');
    const ed = mount(frag);
    expect(ed.state.doc.firstChild!.type.name).toBe('rawBlock');
    let refused = 0;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 3, 8)));
    expect(toggleBookMark(ed, 'strong', () => refused++)).toBe(false);
    ed.commands.setTextSelection(4);
    expect(toggleBookMark(ed, 'strong', () => refused++)).toBe(false);
    expect(refused).toBe(2);
    expect(fragmentText(frag)).toBe('> a quote line\n> another');
  });

  it('Mod-b and Mod-i run the same commands', () => {
    const { frag } = fragOf('Make this bold.');
    const ed = mount(frag);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1 + 'Make '.length, 1 + 'Make this'.length)));
    ed.commands.keyboardShortcut('Mod-b');
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe('Make **this** bold.');
  });
});

describe('the schema bridge (TipTap\'s Schema instance is not bookSchema\'s)', () => {
  it('toBook / toEditor translate node for node, and toBook reuses unchanged blocks', async () => {
    const { toBook, toEditor } = await import('../src/editor/bridge');
    const { frag } = fragOf('One *two* [^1].\n\n::: center\nMid\n:::\n\n***\n\n> raw\n\n[^1]: Note.');
    const ed = mount(frag);
    const bookDoc = toBook(ed.state.doc);
    expect(bookDoc.type.schema).toBe(bookSchema);
    expect(bookDoc.eq(toDoc(fragmentText(frag)))).toBe(true);
    const back = toEditor(bookDoc, ed.schema);
    expect(back.eq(ed.state.doc)).toBe(true);
    // a second translation after an edit in block 0 reuses the other blocks' copies
    ed.commands.setTextSelection(2);
    ed.view.dispatch(ed.state.tr.insertText('x'));
    const again = toBook(ed.state.doc);
    expect(again.child(0)).not.toBe(bookDoc.child(0));
    for (let i = 1; i < again.childCount; i++) expect(again.child(i)).toBe(bookDoc.child(i));
  });

  it('typing then deleting the same character in a block leaves it exactly as it was after the selection leaves', () => {
    const text = 'Keep *this* as is.\n\nAnd this.';
    const { frag } = fragOf(text);
    const ed = mount(frag);
    const before = ed.state.doc;
    ed.commands.setTextSelection(3);
    ed.view.dispatch(ed.state.tr.insertText('z'));
    ed.view.dispatch(ed.state.tr.delete(3, 4));
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.atEnd(ed.state.doc)));
    expect(ed.state.doc.eq(before)).toBe(true);
    expect(fragmentText(frag)).toBe(text);
  });
});

describe('link hrefs on the page are sanitised (display only)', () => {
  it('toDOM: javascript:, data: and friends render as "#"; http(s), mailto and relative/fragment hrefs pass as written', async () => {
    const { safeHref } = await import('../src/editor/schema');
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:x', 'java\tscript:x', 'java\nscript:x', '\u0001javascript:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'blob:https://a.b/x', 'http://[bad'])
      expect(safeHref(bad), JSON.stringify(bad)).toBe('#');
    for (const good of ['https://a.b', 'http://a.b/c?d#e', 'mailto:a@b.c', '#fn1', 'chapter-2', '/x/y'])
      expect(safeHref(good), good).toBe(good);
  });

  it('a javascript: link in the fragment renders href="#" in the editor, and the text still exports byte for byte', () => {
    const doc = bookSchema.node('doc', null, [
      bookSchema.node('paragraph', null, [bookSchema.text('see '), bookSchema.text('here', [bookSchema.mark('link', { href: 'javascript:alert(1)' })]), bookSchema.text(' and '), bookSchema.text('there', [bookSchema.mark('link', { href: 'https://a.b' })])]),
    ]);
    const y = new Y.Doc();
    const frag = y.getXmlFragment('body');
    ypPmToFrag(doc, frag);
    const ed = mount(frag);
    const hrefs = Array.from(ed.view.dom.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#', 'https://a.b']);
    expect(ed.state.doc.firstChild!.child(1).marks[0]!.attrs.href).toBe('javascript:alert(1)'); // the stored attr is untouched
    flushNormalize(ed);
    expect(fragmentText(frag)).toBe(toText(doc));
    expect(fragmentText(frag)).toBe('see [here](javascript:alert(1)) and [there](https://a.b)');
  });
});
