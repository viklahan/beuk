import type { Editor } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';

/* A general seam for editor behaviour that arrives later than the editor itself (a lazily loaded module): a
   registered extra is a factory of ProseMirror plugins, built once per chapter editor.

   Why plugins, registered live, rather than TipTap extensions passed at creation: a module loading after a chapter
   editor already exists must still reach that editor. Recreating the editor to add an extension would run its whole
   teardown (the reading and dictation session leaving the section, the pending block normalised, the active editor
   cleared, the caret lost) in the middle of the writer's work. Editor.registerPlugin adds a plugin to the live state
   instead: nothing is torn down, and an editor made afterwards gets the same plugins at creation. */

export type EditorExtra = (editor: Editor) => Plugin[];

const extras: EditorExtra[] = [];
const listeners = new Set<(x: EditorExtra) => void>();

/** Add extras to every chapter editor: the open ones now, every later one at creation. A factory already registered is
 *  not added twice. */
export function registerEditorExtras(list: EditorExtra[]): void {
  for (const x of list) {
    if (extras.includes(x)) continue;
    extras.push(x);
    for (const l of [...listeners]) l(x);
  }
}

/** The extras registered so far. */
export const getEditorExtras = (): readonly EditorExtra[] => extras;

/** Give `editor` every extra registered so far, and each one registered while it lives. */
export function attachEditorExtras(editor: Editor): void {
  const add = (x: EditorExtra) => {
    if (editor.isDestroyed) return;
    // ahead of the editor's own plugins: an extra that claims a key or a typed character sees it first
    for (const p of x(editor)) editor.registerPlugin(p, (np, ps) => [np, ...ps]);
  };
  for (const x of extras) add(x);
  listeners.add(add);
  editor.on('destroy', () => {
    listeners.delete(add);
  });
}

/** Tests: forget every extra. */
export function resetEditorExtras(): void {
  extras.length = 0;
  listeners.clear();
}
