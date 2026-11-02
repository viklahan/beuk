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
  // A real textarea's value never holds a "\r": the browser turns "\r\n" and a lone "\r" into "\n" when the value is
  // set (1.0's area.value = section.content). The stand-in does the same, the selection moved with the text, so 1.0's
  // "\n\n" searches find their paragraphs (fix round 1). Its result is what 1.0 would write back.
  const norm = (s: string) => s.replace(/\r\n?/g, '\n');
  const ta: Area = {
    value: norm(value),
    selectionStart: norm(value.slice(0, start)).length,
    selectionEnd: norm(value.slice(0, end)).length,
    scrollTop: 0,
    scrollLeft: 0,
    focus: () => undefined,
    setSelectionRange(a: number, b: number) {
      // a real textarea clamps both ends to its length, and a start past the end to the end (HTML setSelectionRange):
      // 1.0's applyBlockquote at the end of a quoted paragraph asks for start + 2
      const len = ta.value.length;
      const end = Math.max(0, Math.min(len, b));
      ta.selectionStart = Math.min(Math.max(0, Math.min(len, a)), end);
      ta.selectionEnd = end;
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
  const text = toText(doc);
  // 1.0's own selection from the last edit, while the editor still holds exactly what that edit left (fix round 1):
  // applyList / applyContainer select the whole rewritten block FROM its marker or "::: kind" line, and that selection
  // is what makes a second press take the markup away. No cursor stands inside a marker or an opener line, so the
  // editor's selection alone would floor the start back (positions.ts) and the second press would add markup again.
  const last = lastEdit.get(editor);
  if (last && last.doc === editor.state.doc && last.from === from && last.to === to && last.text === text) return { text, start: last.start, end: last.end };
  return { text, start: posToTextOffset(doc, from), end: posToTextOffset(doc, to) };
}

/** Per editor: the document and selection the last applyTextEdit left, and 1.0's text selection that went with them. */
const lastEdit = new WeakMap<Editor, { doc: PMNode; from: number; to: number; text: string; start: number; end: number }>();

/** Run a 1.0 textarea function on the editor's text and selection; null when it changed nothing. */
export function runOnText(cur: TextEdit, act: (ta: Area) => unknown): TextEdit | null {
  const ta = textArea(cur.text, cur.start, cur.end);
  const before = { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
  act(ta);
  const next = { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
  // unchanged from the textarea's own starting state: 1.0 did nothing (its "\r\n" → "\n" alone is never written)
  return next.text === before.text && next.start === before.start && next.end === before.end ? null : next;
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

const undoManager = (editor: Editor) => yUndoPluginKey.getState(editor.state)?.undoManager as { stopCapturing: () => void; lastChange: number } | undefined;

/** Write `next` (a whole new text and its selection) into the editor: one transaction, one undo step. Returns false when
 *  the editor is gone. */
/** `merge` (wave 3a, dictation): this edit joins the undo step of the edit before it — a phrase's interim rewrites
 *  and its final are ONE undo step; environment/page.ts decides where a phrase ends. */
export function applyTextEdit(editor: Editor, next: TextEdit, opts: { merge?: boolean } = {}): boolean {
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
  if (opts.merge && um) um.lastChange = Date.now();
  else um?.stopCapturing();
  editor.view.dispatch(tr);
  um?.stopCapturing();
  const st = editor.state; // after the dispatch (and anything appended to it)
  lastEdit.set(editor, { doc: st.doc, from: st.selection.from, to: st.selection.to, text: next.text, start: clamp(next.start), end: clamp(next.end) });
  return true;
}
