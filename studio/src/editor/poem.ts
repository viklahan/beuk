import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type * as Y from 'yjs';
import { escKey } from '@book/editor/index.js';

/* BEUK:poemmode — Poem Mode: a chapter the writer has marked as a poem.

   THE TEXT IS THE SOURCE OF TRUTH. Poem Mode is two optional fields on the
   section (docs/book-format.md): mode "verse", stored only for a poem
   (absent, or anything else, reads as prose), and verseAlign "left", stored
   only when the writer chose left (absent reads as centred). Nothing here
   ever writes the chapter's text: switching the mode on, off or on again
   changes those two keys and nothing else, so the stored text is the same
   characters before and after (test/poem-mode.test.tsx reads it).

   The typing model is the editor's own (behaviour.ts): Enter is a new line
   of the same block, a blank line starts a new block. In prose a single new
   line prints as a space; in a poem it prints as a line, and a block is a
   stanza. So Poem Mode needs no typing model of its own. The one key that
   differs is Shift-Enter: in prose it writes the book's mark of a line
   break the page keeps (a backslash before the new line); in a poem every
   new line is kept already, so it writes the plain new line (as it does in
   a heading, a list or a quotation), and no backslash can reach the poem's
   page. A mark already in the text (typed while the chapter was prose) is
   read as the end of its line and never printed (client/index.html,
   poemSeg).

   The starter lines of an empty poem are a DECORATION of the editor's view
   (a class and a data attribute on the one empty paragraph; the words are
   drawn by the stylesheet). They are not in the document, so nothing that
   reads the book can see them: not the stored text, not a count, not the
   preview, not an export. One character typed and the document is no
   longer empty, so they are gone. */

export type PoemAlign = 'center' | 'left';
export type PoemState = { on: boolean; ghost: string };

/** Poem Mode belongs to a body chapter (where the chapter's own switches show: EditorMeta), never to a Part and
 *  never to front or back matter. `kind` and `type` as 1.0's normalizeSection holds them (no kind is "body", no type
 *  is "chapter"). */
export function poemCan(section: Y.Map<unknown> | null): boolean {
  if (!section) return false;
  return (section.get(escKey('kind')) || 'body') === 'body' && (section.get(escKey('type')) || 'chapter') !== 'part';
}
/** The chapter is a poem: its mode is "verse" (and it is a chapter that can be one). */
export function poemOn(section: Y.Map<unknown> | null): boolean {
  return poemCan(section) && section!.get(escKey('mode')) === 'verse';
}
/** How the poem's lines are set: "left" only when stored so; anything else, or nothing, is centred. */
export function poemAlign(section: Y.Map<unknown> | null): PoemAlign {
  return section && section.get(escKey('verseAlign')) === 'left' ? 'left' : 'center';
}

/** Switch Poem Mode on or off: the section's `mode` key, in one transaction. Off removes the key; the alignment the
 *  writer chose stays where it is, so it is remembered. The text is not touched. */
export function setPoemOn(ydoc: Y.Doc, section: Y.Map<unknown>, on: boolean): void {
  if (!poemCan(section)) return;
  ydoc.transact(() => {
    if (on) section.set(escKey('mode'), 'verse');
    else section.delete(escKey('mode'));
  });
}
/** Choose how the lines are set: "left" is stored, centred is the absence of the key. One transaction. */
export function setPoemAlign(ydoc: Y.Doc, section: Y.Map<unknown>, align: PoemAlign): void {
  if (!poemCan(section)) return;
  ydoc.transact(() => {
    if (align === 'left') section.set(escKey('verseAlign'), 'left');
    else section.delete(escKey('verseAlign'));
  });
}

/* ---- the editor's side ---- */

export const poemKey = new PluginKey<PoemState>('beukPoem');
const OFF: PoemState = { on: false, ghost: '' };

/** A chapter with no text at all: one empty paragraph (what an empty section opens as). */
export function emptyDoc(doc: PMNode): boolean {
  const first = doc.firstChild;
  return doc.childCount === 1 && !!first && first.type.name === 'paragraph' && first.content.size === 0;
}

/** Whether the editor holds a poem (the plugin's state; false for an editor without the plugin). */
export function poemState(state: EditorState): PoemState {
  return poemKey.getState(state) ?? OFF;
}

/** Whether the starter lines are showing: Poem Mode on, words to show, and no text at all. */
export function ghostShown(state: EditorState): boolean {
  const p = poemState(state);
  return p.on && !!p.ghost && emptyDoc(state.doc);
}

export function poemPlugin(): Plugin {
  return new Plugin<PoemState>({
    key: poemKey,
    state: {
      init: () => OFF,
      apply(tr, value) {
        const meta = tr.getMeta(poemKey) as PoemState | undefined;
        return meta ? { on: !!meta.on, ghost: String(meta.ghost || '') } : value;
      },
    },
    props: {
      decorations(state) {
        if (!ghostShown(state)) return null;
        const ghost = poemState(state).ghost;
        return DecorationSet.create(state.doc, [Decoration.node(0, state.doc.firstChild!.nodeSize, { class: 'ms-poem-ghost', 'data-ghost': ghost })]);
      },
      // what a screen reader is told an empty field is for (the lines are drawn by the stylesheet, which it may not read)
      attributes(state): Record<string, string> {
        return ghostShown(state) ? { 'aria-placeholder': poemState(state).ghost.replace(/\n/g, ' ') } : {};
      },
    },
  });
}

/** Tell the editor whether its chapter is a poem, and the starter lines to show while it is empty. A view-only
 *  transaction: the document is not changed, so nothing is written to the book. */
export function setEditorPoem(editor: Editor, next: PoemState): void {
  if (editor.isDestroyed) return;
  const cur = poemState(editor.state);
  if (cur.on === next.on && cur.ghost === next.ghost) return;
  editor.view.dispatch(editor.state.tr.setMeta(poemKey, next).setMeta('addToHistory', false));
}
