import { Editor } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { BookBehaviour } from './behaviour';
import { bookExtensions } from './schema';
import { CovenantMarks } from '../covenant/marks';

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
  const release = holdPositionMigrations(o.fragment);
  const editor = new Editor({
    element: o.element,
    extensions: [...bookExtensions(), Collaboration.configure({ fragment: o.fragment }), BookBehaviour.configure({ onRefuse: o.onRefuse }), CovenantMarks],
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
  editor.on('destroy', release);
  return editor;
}

/* Undo storms (studio-2 cutover, task 5): y-tiptap 3's "position migrations".

   Every edit y-tiptap cannot write as a plain text change (a toolbar action's
   block rewrite, a normalised block, an Enter that splits) makes its binding
   write a migration record into a Y.Map that lives IN THE BOOK'S Y.Doc
   ("__tiptap_position_migrations:<fragment>"): one entry per edit, holding a
   transfer per character of the rewritten blocks. And once that map holds
   anything, every undo and every redo (restorePositionHistory →
   restoreTransfers) walks every transfer of every entry plus every struct of
   the whole document, and writes ANOTHER entry re-listing every transfer it
   found — so the map grows each cycle, undo by undo, and is persisted
   (IndexedDB) and relayed to the other tabs. Measured (test/undo-storm.test.ts,
   2,000-word chapter, toolbar-style edit + undo + redo): 240 entries and
   128,716 transfers after 80 cycles, undo 7.8 ms → 788 ms; with the map kept
   empty, 0.5 ms flat. Wave 2a's tab crash at ~115 cycles is this growth.

   Beuk does not use what the records are for (keeping a remote collaborator's
   caret, or a stored relative position, inside a block y-tiptap re-created):
   one writer per editor, no stored positions. Undo's own selection restore
   still works without them (Yjs follows its redone items; y-tiptap falls back
   to the old absolute position — recoverSelectionEndpoint). So the map is
   kept empty: nothing is written to it, what an older build left in the book
   is cleared, and anything another tab's older build writes is cleared as it
   arrives. y-tiptap's own key (getPositionMigrationStore, not exported):
   "item:<client>:<clock>" for a fragment inside a section's Y.Map,
   "root:<name>" for a root fragment. */
const MIGRATIONS = '__tiptap_position_migrations:';
const CLEAR_ORIGIN = Symbol('beuk-position-migrations');

/** The migration map y-tiptap's binding uses for `fragment` (y-tiptap getPositionMigrationStore). */
export function positionMigrationStore(fragment: Y.XmlFragment): Y.Map<unknown> | null {
  const doc = fragment.doc;
  if (!doc) return null;
  const item = fragment._item;
  return doc.getMap(MIGRATIONS + (item ? `item:${item.id.client}:${item.id.clock}` : `root:${Y.findRootTypeKey(fragment)}`));
}

const clearMap = (m: Y.Map<unknown>) => {
  if (m.size === 0 || !m.doc) return;
  m.doc.transact(() => {
    for (const k of [...m.keys()]) m.delete(k);
  }, CLEAR_ORIGIN);
};

/** Keep `fragment`'s migration map empty while its editor lives (and clear what any other fragment's left behind,
 *  e.g. a section re-created by a move). Returns the release for the editor's destroy. */
export function holdPositionMigrations(fragment: Y.XmlFragment): () => void {
  const doc = fragment.doc;
  const store = positionMigrationStore(fragment);
  if (!doc || !store) return () => undefined;
  // y-tiptap writes its records with store.set only (writePositionMigration): this map takes none
  (store as unknown as { set: (k: string, v: unknown) => unknown }).set = (_k, v) => v;
  for (const k of [...doc.share.keys()]) if (k.startsWith(MIGRATIONS)) clearMap(doc.getMap(k));
  const onChange = (_e: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    if (tr.origin !== CLEAR_ORIGIN) clearMap(store);
  };
  store.observe(onChange);
  return () => store.unobserve(onChange);
}
