import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { posToTextOffset, textOffsetToPos, toDoc, toText } from '@book/editor/index.js';
import { toBook, toEditor } from './bridge';

/* BEUK:insert — 1.0's insert toolbar, run on the book's TEXT (step 5 wave 2a,
   constraint 11: 1.0's insert functions are the oracle).

   1.0's toolbar functions (insertAtCursor, wrapSelection, redactSelection,
   applyList, applyContainer, applyBlockquote, applyAttribution, and the
   dialog handlers) all work on a textarea: its value and its selection.
   2.0 runs 1.0's OWN functions (the browser closure) on a stand-in for that
   textarea (textArea), holding the section's text — toText of the editor's
   document — and the selection as text offsets (positions.ts). What they
   leave in it is the new text and selection, exactly 1.0's.

   applyTextEdit then writes the new text into the editor:
   - the new text read as a document (toDoc), and only the top-level blocks
     that differ replaced, in ONE transaction: one Yjs change, one undo step
     (the Yjs undo manager stops capturing on both sides, so typing just
     before or after never merges into it);
   - the selection placed at 1.0's offsets (positions.ts textOffsetToPos;
     an offset no cursor can stand at floors to the nearest one below);
   - the view is not scrolled (1.0's insertAtCursor keeps scrollTop).
   The document after it reads back as exactly the new text (checked; a
   whole-document replace if it ever did not). */

/** 1.0's textarea, as far as its toolbar functions use it. */
export type Area = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  scrollLeft: number;
  focus: (o?: unknown) => void;
  setSelectionRange: (a: number, b: number) => void;
  dispatchEvent: (e: unknown) => boolean;
};

/** A stand-in textarea holding `value` with the selection [start, end). */
export function textArea(value: string, start: number, end: number): Area {
  const ta: Area = {
    value,
    selectionStart: start,
    selectionEnd: end,
    scrollTop: 0,
    scrollLeft: 0,
    focus: () => undefined,
    setSelectionRange(a: number, b: number) {
      ta.selectionStart = a;
      ta.selectionEnd = b;
    },
    dispatchEvent: () => true,
  };
  return ta;
}

/** A section's text and a selection in it, as text offsets. */
export type TextEdit = { text: string; start: number; end: number };

/** The open editor's text (toText of its document) and its selection as text offsets. */
export function editorText(editor: Editor): TextEdit {
  const doc = toBook(editor.state.doc);
  const { from, to } = editor.state.selection;
  return { text: toText(doc), start: posToTextOffset(doc, from), end: posToTextOffset(doc, to) };
}

/** Run a 1.0 textarea function on the editor's text and selection; null when it changed nothing. */
export function runOnText(cur: TextEdit, act: (ta: Area) => unknown): TextEdit | null {
  const ta = textArea(cur.text, cur.start, cur.end);
  act(ta);
  const next = { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
  return next.text === cur.text && next.start === cur.start && next.end === cur.end ? null : next;
}

/** The top-level blocks of `next` that differ from `old`: [from, to) of old's children to replace with next's [from, nTo). */
function changedRange(old: PMNode, next: PMNode): { pre: number; oldEnd: number; newEnd: number } {
  const a = old.childCount;
  const b = next.childCount;
  let pre = 0;
  while (pre < a && pre < b && old.child(pre).eq(next.child(pre))) pre++;
  let suf = 0;
  while (suf < a - pre && suf < b - pre && old.child(a - 1 - suf).eq(next.child(b - 1 - suf))) suf++;
  return { pre, oldEnd: a - suf, newEnd: b - suf };
}

const undoManager = (editor: Editor) => yUndoPluginKey.getState(editor.state)?.undoManager as { stopCapturing: () => void } | undefined;

/** Write `next` (a whole new text and its selection) into the editor: one transaction, one undo step. Returns false when
 *  the editor is gone. */
export function applyTextEdit(editor: Editor, next: TextEdit): boolean {
  if (editor.isDestroyed) return false;
  const { state } = editor;
  const old = toBook(state.doc);
  const tr = state.tr;
  if (toText(old) !== next.text) {
    const nd = toDoc(next.text);
    const r = changedRange(old, nd);
    let from = 0;
    for (let i = 0; i < r.pre; i++) from += old.child(i).nodeSize;
    let to = from;
    for (let i = r.pre; i < r.oldEnd; i++) to += old.child(i).nodeSize;
    const kids: PMNode[] = [];
    for (let i = r.pre; i < r.newEnd; i++) kids.push(toEditor(nd.child(i), state.schema));
    tr.step(new ReplaceStep(from, to, new Slice(Fragment.from(kids), 0, 0)));
    if (toText(toBook(tr.doc)) !== next.text) {
      // never expected (the blocks kept are equal to the new ones): fall back to the whole document
      const all: PMNode[] = [];
      nd.forEach((k) => {
        all.push(toEditor(k, state.schema));
      });
      tr.step(new ReplaceStep(0, tr.doc.content.size, new Slice(Fragment.from(all), 0, 0)));
    }
  }
  const nb = toBook(tr.doc);
  const len = next.text.length;
  const clamp = (o: number) => Math.max(0, Math.min(len, o));
  tr.setSelection(TextSelection.create(tr.doc, textOffsetToPos(nb, clamp(next.start)), textOffsetToPos(nb, clamp(next.end))));
  const um = undoManager(editor);
  um?.stopCapturing();
  editor.view.dispatch(tr);
  um?.stopCapturing();
  return true;
}
