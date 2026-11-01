import type { Editor } from '@tiptap/core';
import { posToTextOffset } from '@book/editor/index.js';
import { flushNormalize } from './behaviour';
import { toBook } from './bridge';

/* The chapter editor open now (one at a time: the Desk mounts one), for the
   features that read the caret from outside it — 1.0's chopCaret
   (editorArea.selectionStart while the editor holds that section). */

let current: { editor: Editor; section: number } | null = null;

export function setActiveEditor(editor: Editor, section: number): void {
  current = { editor, section };
}
export function clearActiveEditor(editor: Editor): void {
  if (current?.editor === editor) current = null;
}
export function activeEditor(): { editor: Editor; section: number } | null {
  return current && !current.editor.isDestroyed ? current : null;
}

/** 1.0's chopCaret: the caret's offset in the TEXT of section `index` (its book-format content), or -1 when that
 *  section is not the one open. The selection's start, mapped by src/book/editor/positions.ts. */
export function caretOffset(index: number): number {
  const a = activeEditor();
  if (!a || a.section !== index) return -1;
  const { state } = a.editor;
  return posToTextOffset(toBook(state.doc), state.selection.from);
}

/** Normalise whatever the open editor still holds pending (as closing the chapter does), so its text is settled. */
export function settleActiveEditor(): void {
  const a = activeEditor();
  if (a) flushNormalize(a.editor);
}
