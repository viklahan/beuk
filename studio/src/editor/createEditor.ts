import { Editor } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import type * as Y from 'yjs';
import { BookBehaviour } from './behaviour';
import { bookExtensions } from './schema';
import { CovenantMarks } from '../covenant/marks';
import { attachEditorExtras } from './extras';
import { holdPositionMigrations, wrapUndoInTransaction } from './positionMigrations';
import { CaretKeeper, type KeeperResult } from './caretKeeper';
import type { RescueReport } from './rescueEditor';

export { positionMigrationStore } from './positionMigrations';

/* One TipTap editor on one chapter's Y fragment (one instance per open
   chapter, the spike's A1 shape). Collaboration binds it through
   @tiptap/y-tiptap; the book's own schema and behaviour do the rest.

   - No input or paste rules (they would rewrite what the writer types),
     and no injected <style> (the CSS is in styles/editor.css, same origin).
   - The editing surface carries the BOOK's direction and language.
   - The caret keeper (caretKeeper.ts) keeps the writer's caret where it was
     when another writer's change rebuilds the paragraph; right after it, the
     keystroke rescue (rescueEditor.ts) puts back the writer's own letters
     that change killed or stranded. */

export type ChapterEditorOptions = {
  element: HTMLElement;
  fragment: Y.XmlFragment;
  dir: 'ltr' | 'rtl';
  lang: string;
  /** The section's name, read out as the text field's label. */
  label: string;
  /** A bold or italic the text cannot say back was refused. */
  onRefuse: () => void;
  /** The caret keeper's result after each remote change (also in editor.storage.caretKeeper.last). */
  onCaretResult?: (r: KeeperResult) => void;
  /** The keystroke rescue's report after a remote change that killed or stranded this writer's letters (also in editor.storage.caretKeeper.rescue). */
  onRescueResult?: (r: RescueReport) => void;
};

export function createChapterEditor(o: ChapterEditorOptions): Editor {
  // undo storms (task 5): y-tiptap's position-migration records kept out of the book; the caret restore kept
  const held = holdPositionMigrations(o.fragment);
  const editor = new Editor({
    element: o.element,
    extensions: [...bookExtensions(), Collaboration.configure({ fragment: o.fragment }), CaretKeeper.configure({ fragment: o.fragment, onResult: o.onCaretResult, onRescue: o.onRescueResult }), BookBehaviour.configure({ onRefuse: o.onRefuse }), CovenantMarks],
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
  wrapUndoInTransaction(editor, held);
  editor.on('destroy', held.release);
  // behaviour registered by modules that load later (editor/extras.ts): this editor gets it now and as it arrives
  attachEditorExtras(editor);
  return editor;
}
