import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { TextSelection } from '@tiptap/pm/state';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { toDoc } from '@book/editor/index.js';
import { createChapterEditor } from '../src/editor/createEditor';
import { bookExtensions } from '../src/editor/schema';
import { BookBehaviour } from '../src/editor/behaviour';
import { CovenantMarks } from '../src/covenant/marks';
import { applyTextEdit, editorText } from '../src/editor/insert';

/* Task 5, fix round 1 (review I-1): keeping undo flat must not move the caret.
   After Ctrl+Z / Ctrl+Y the caret must land where y-tiptap's own restore puts
   it on the code before task 5 (the reference editor below: the same
   extensions, without holdPositionMigrations), for a toolbar edit (caret and
   range), an Enter split, plain typing, and a chain of all of them undone and
   redone in turn. Both editors see the same steps on the same book. */

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
  document.body.replaceChildren();
});

const TEXT = 'Alpha beta gamma delta epsilon.\n\nZeta eta theta iota kappa lambda.\n\nMu nu xi omicron pi rho.\n\nSigma tau upsilon phi chi psi omega.';

function mount(reference: boolean): Editor {
  const doc = new Y.Doc();
  const sec = new Y.Map<unknown>();
  doc.getArray<Y.Map<unknown>>('sections').push([sec]);
  const frag = new Y.XmlFragment();
  sec.set('body', frag);
  ypPmToFrag(toDoc(TEXT), frag);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = reference
    ? new Editor({
        element,
        extensions: [...bookExtensions(), Collaboration.configure({ fragment: frag }), BookBehaviour.configure({ onRefuse: () => undefined }), CovenantMarks],
        injectCSS: false,
        enableInputRules: false,
        enablePasteRules: false,
      })
    : createChapterEditor({ element, fragment: frag, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
  editors.push(ed);
  return ed;
}

type Step = (ed: Editor) => void;
const select = (from: number, to = from): Step => (ed) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
/** A toolbar action's write: 1.0's function returns a new text and selection, applyTextEdit writes it. */
const toolbar = (at: number, ins: string, selectIt = false): Step => (ed) => {
  const t = editorText(ed);
  applyTextEdit(ed, { text: t.text.slice(0, at) + ins + t.text.slice(at), start: selectIt ? at : at + ins.length, end: at + ins.length });
};
/** The writer's Enter (behaviour.ts: a "
" into the text; two make a blank line, split once the caret leaves). */
const enter: Step = (ed) => void ed.commands.keyboardShortcut('Enter');
const split: Step = (ed) => void ed.commands.splitBlock();
const type = (s: string): Step => (ed) => ed.view.dispatch(ed.state.tr.insertText(s));
/** A pause in the writing: the next change is its own undo step (as after captureTimeout). */
const stop: Step = (ed) => (yUndoPluginKey.getState(ed.state) as { undoManager: { stopCapturing: () => void } }).undoManager.stopCapturing();
const caret = (ed: Editor) => `${ed.state.selection.from}-${ed.state.selection.to}`;

/** Run `steps`, then `undos` undos and as many redos, logging the caret and text after each. */
function trace(ed: Editor, steps: Step[], undos: number): string[] {
  const out: string[] = [];
  for (const s of steps) s(ed);
  out.push('after ' + caret(ed));
  for (let i = 0; i < undos; i++) {
    ed.commands.undo();
    out.push(`undo${i + 1} ${caret(ed)} ${editorText(ed).text.length}`);
  }
  for (let i = 0; i < undos; i++) {
    ed.commands.redo();
    out.push(`redo${i + 1} ${caret(ed)} ${editorText(ed).text.length}`);
  }
  return out;
}

/* The one known difference (fix round 1, written up in task-5-report.md): a ProseMirror splitBlock (not the writer's
   Enter: Beuk's Enter types "
", case above) at 40 leaves the caret at 42, the start of the new paragraph; redone,
   the code before task 5 puts the caret at 44 (two characters INTO the new paragraph: it resolves through the whole
   migration history), the fix at 40 (the split point, the end of the line before). Neither is 42. Pinned both ways,
   so a change on either side shows. */
const KNOWN: Record<string, Record<string, [string, string]>> = {
  'an Enter that splits a paragraph': { redo1: ['redo1 44-44 132', 'redo1 40-40 132'] },
};

const CASES: [string, Step[], number][] = [
  ['a toolbar edit at a caret', [select(40), toolbar(20, 'X ')], 1],
  ['a toolbar edit that selects what it wrote', [select(40, 45), toolbar(20, 'X ', true)], 1],
  ["the writer's Enter twice (a blank line), then the caret moves on and the block splits", [select(40), enter, enter, stop, select(5)], 1],
  ['an Enter that splits a paragraph', [select(40), split], 1],
  ['plain typing', [stop, select(40), type('abc')], 1],
  ['a chain: toolbar, Enter, typing, toolbar, each undone then redone', [select(40), toolbar(20, 'X '), stop, select(50), split, stop, select(70), type('abc'), stop, select(12), toolbar(80, 'Y ')], 4],
];

describe('the caret after undo and redo (task 5, fix round 1)', () => {
  for (const [name, steps, undos] of CASES) {
    it(`${name}: the caret lands where the code before task 5 puts it`, () => {
      const want = trace(mount(true), steps, undos);
      const got = trace(mount(false), steps, undos);
      console.log(`undo-caret ${name}: reference ${want.join(' | ')} || fixed ${got.join(' | ')}`);
      const known = KNOWN[name] ?? {};
      for (const [step, [ref, ours]] of Object.entries(known)) {
        expect(want.find((l) => l.startsWith(step + ' '))).toBe(ref);
        expect(got.find((l) => l.startsWith(step + ' '))).toBe(ours);
      }
      const same = (l: string) => !Object.keys(known).some((step) => l.startsWith(step + ' '));
      expect(got.filter(same)).toEqual(want.filter(same));
    });
  }
});
