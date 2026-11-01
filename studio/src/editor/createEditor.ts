import { Editor } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import type * as Y from 'yjs';
import { BookBehaviour } from './behaviour';
import { bookExtensions } from './schema';

/* One TipTap editor on one chapter's Y fragment (one instance per open
   chapter, the spike's A1 shape). Collaboration binds it through
   @tiptap/y-tiptap; the book's own schema and behaviour do the rest.

   - No input or paste rules (they would rewrite what the writer types),
     and no injected <style> (the CSS is in styles/editor.css, same origin).
   - The editing surface carries the BOOK's direction and language. */

export type ChapterEditorOptions = {
  element: HTMLElement;
  fragment: Y.XmlFragment;
  dir: 'ltr' | 'rtl';
  lang: string;
  /** The section's name, read out as the text field's label. */
  label: string;
  /** A bold or italic the text cannot say back was refused. */
  onRefuse: () => void;
};

export function createChapterEditor(o: ChapterEditorOptions): Editor {
  return new Editor({
    element: o.element,
    extensions: [...bookExtensions(), Collaboration.configure({ fragment: o.fragment }), BookBehaviour.configure({ onRefuse: o.onRefuse })],
    injectCSS: false,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        class: 'ms-editor',
        dir: o.dir,
        lang: o.lang,
        spellcheck: 'true',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': o.label,
      },
    },
  });
}
