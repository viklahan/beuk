import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ghostKey } from './ghost';
import type { ProposeAction } from './propose';

/* The selection toolbar: a selection of FOUR OR MORE words inside a chapter editor raises rewrite · expand · condense
   beside it; three words or fewer, a collapsed selection, or a selection the writer dismissed raise none. Plain DOM in
   a widget decoration (as the summon menu): it lives inside the editor's surface, so it takes the book's direction.

   Escape dismisses it and the selection stays. It stays dismissed until the selection changes. While a proposal's
   ghost is showing the ghost has the spot, so the toolbar steps aside. */

type Choose = (editor: Editor, from: number, to: number, action: ProposeAction) => void;
type Dismissed = { from: number; to: number } | null;
type Meta = { dismiss: true };

const ITEMS: ProposeAction[] = ['rewrite', 'expand', 'condense'];
const MIN_WORDS = 4;

export const selectionKey = new PluginKey<Dismissed>('beukAiSelection');

/** Does the selection call for the toolbar right now? */
function wanted(state: EditorState): { from: number; to: number } | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || sel.empty) return null;
  if (ghostKey.getState(state)) return null;
  const d = selectionKey.getState(state);
  if (d && d.from === sel.from && d.to === sel.to) return null;
  const words = state.doc.textBetween(sel.from, sel.to, ' ', ' ').split(/\s+/).filter(Boolean);
  return words.length >= MIN_WORDS ? { from: sel.from, to: sel.to } : null;
}

function dismiss(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(selectionKey, { dismiss: true } satisfies Meta));
  editor.view.focus(); // the keyboard goes back to the page; the selection was never touched
}

function render(editor: Editor, choose: Choose): HTMLElement {
  // zero-width anchor at the selection's end; the bar floats above it
  const anchor = document.createElement('span');
  anchor.className = 'aris-toolbar-anchor';
  anchor.contentEditable = 'false';
  const bar = document.createElement('span');
  bar.setAttribute('data-aris', 'toolbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'rewrite the selection');
  bar.className = 'aris-toolbar';
  for (const action of ITEMS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    // keep the editor's selection where it is: the press is the widget's, not the page's
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const { from, to } = editor.state.selection;
      choose(editor, from, to, action);
    });
    bar.appendChild(b);
  }
  // the keyboard: arrows move through the items (wrapping), Enter runs the focused one, Escape dismisses
  bar.addEventListener('keydown', (e) => {
    const stops = [...bar.querySelectorAll<HTMLElement>('button')];
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const rtl = bar.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const next = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const prev = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (next || prev) {
      e.preventDefault();
      const n = stops.length;
      stops[i < 0 ? 0 : (i + (next ? 1 : n - 1)) % n].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target instanceof HTMLButtonElement) e.target.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismiss(editor);
    }
  });
  anchor.appendChild(bar);
  return anchor;
}

export function selectionPlugin(editor: Editor, choose: Choose): Plugin<Dismissed> {
  return new Plugin<Dismissed>({
    key: selectionKey,
    state: {
      init: () => null,
      apply(tr, d, _old, next) {
        if ((tr.getMeta(selectionKey) as Meta | undefined)?.dismiss) return { from: next.selection.from, to: next.selection.to };
        if (!d) return null;
        // dismissed until the selection is anything else
        return d.from === next.selection.from && d.to === next.selection.to ? d : null;
      },
    },
    props: {
      handleKeyDown(view, e) {
        if (e.key !== 'Escape' || !wanted(view.state)) return false;
        dismiss(editor);
        return true;
      },
      decorations(state) {
        const w = wanted(state);
        if (!w) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(w.to, () => render(editor, choose), { side: 1, key: `toolbar:${w.from}:${w.to}`, ignoreSelection: true, stopEvent: () => true }),
        ]);
      },
    },
  });
}
