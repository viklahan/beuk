import type { Editor } from '@tiptap/core';
import type * as Y from 'yjs';
import { posToTextOffset } from '@book/editor/index.js';
import { flushNormalize } from './behaviour';
import { toBook } from './bridge';

/* The chapter editor open now (one at a time: the Desk mounts one), for the
   features that read the caret from outside it — 1.0's chopCaret
   (editorArea.selectionStart while the editor holds that section). */

type Active = { editor: Editor; section: number; sectionMap: Y.Map<unknown> | null };
let current: Active | null = null;

/** `sectionMap`: the section's own Y map, so a reader can ask which section the editor holds by the section itself
 *  (its 1.0 id), not by the index it was mounted with (a move shifts indexes; the Desk remounts on the next render). */
export function setActiveEditor(editor: Editor, section: number, sectionMap: Y.Map<unknown> | null = null): void {
  current = { editor, section, sectionMap };
}
export function clearActiveEditor(editor: Editor): void {
  if (current?.editor === editor) current = null;
}
export function activeEditor(): Active | null {
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

/** The 1.0 id of the section the open editor holds, read from the section itself (null: no editor, or a section
 *  stored without an id). */
export function activeEditorSectionId(): string | null {
  const a = activeEditor();
  const id = a?.sectionMap?.get('id');
  return typeof id === 'string' && id ? id : null;
}

/** Normalise whatever the open editor still holds pending (as closing the chapter does), so its text is settled. */
export function settleActiveEditor(): void {
  const a = activeEditor();
  if (a) flushNormalize(a.editor);
}
