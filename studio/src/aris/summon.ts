import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { focusMenu, renderMenu, type MenuChoice } from './menu';
import { arisStatus } from './state';

/* The summon: "/" typed at the start of an EMPTY line (nothing before it on its line, nothing after it) opens the menu
   there. Input rules are off editor-wide, so this is handleTextInput. Anywhere else — mid-word, after a space, before
   text — "/" is just a character. While Aris is away (the desk toggle or /aris), the gesture is checked against the
   LIVE status, so sending Aris away silences it at once and summoning it back needs no editor rebuild.

   The "/" is held back while the menu is open (the document does not change). Choosing an action consumes it.
   Dismissing the menu — Escape, a press outside it, or going on typing — puts it back as typed text; Backspace takes
   it away, as it would have. */

type Summon = { at: number; ver: number } | null;
type Meta = { open: number } | { close: true };

export const summonKey = new PluginKey<Summon>('beukAiSummon');
let ver = 0;

/** Is an empty, collapsed selection at `pos` on an empty line of its text block? */
function onEmptyLine(state: EditorState, from: number, to: number): boolean {
  if (from !== to) return false;
  const $p = state.doc.resolve(from);
  const block = $p.parent;
  if (!block.isTextblock) return false;
  const o = $p.parentOffset;
  const before = block.textBetween(0, o, undefined, '￼');
  const after = block.textBetween(o, block.content.size, undefined, '￼');
  return (before === '' || before.endsWith('\n')) && (after === '' || after.startsWith('\n'));
}

/** Close the menu; `slash`: the "/" goes back into the text where it was typed. */
function close(view: EditorView, slash: boolean): void {
  const s = summonKey.getState(view.state);
  if (!s) return;
  const tr = view.state.tr.setMeta(summonKey, { close: true } satisfies Meta);
  if (slash) tr.insertText('/', s.at);
  view.dispatch(tr);
}

export function summonPlugin(editor: Editor, onChoose: (editor: Editor, at: number, c: MenuChoice) => void): Plugin<Summon> {
  return new Plugin<Summon>({
    key: summonKey,
    state: {
      init: () => null,
      apply(tr, s) {
        const m = tr.getMeta(summonKey) as Meta | undefined;
        if (m && 'open' in m) return { at: m.open, ver: ++ver };
        if (m && 'close' in m) return null;
        if (!s || !tr.docChanged) return s;
        // as the ghost: mapped through changes in other blocks; a change covering its spot (a Yjs-origin change replaces
        // each touched block whole) closes it, the held-back "/" with it
        const r = tr.mapping.mapResult(s.at, -1);
        return r.deleted ? null : { at: r.pos, ver: s.ver };
      },
    },
    view(view) {
      // a press anywhere outside the menu dismisses it, keeping the "/"
      const away = (e: MouseEvent) => {
        if (!summonKey.getState(view.state)) return;
        const menu = view.dom.querySelector('[data-aris="menu"]');
        if (menu && e.target instanceof Node && menu.contains(e.target)) return;
        close(view, true);
      };
      document.addEventListener('mousedown', away, true);
      return { destroy: () => document.removeEventListener('mousedown', away, true) };
    },
    props: {
      handleTextInput(view, from, to, text) {
        const s = summonKey.getState(view.state);
        if (s) {
          // going on typing: the "/" comes back, then what was typed
          const tr = view.state.tr.setMeta(summonKey, { close: true } satisfies Meta).insertText('/', s.at);
          tr.insertText(text, tr.mapping.map(from), tr.mapping.map(to));
          view.dispatch(tr);
          return true;
        }
        if (text !== '/' || !arisStatus()?.optedIn || !onEmptyLine(view.state, from, to)) return false;
        view.dispatch(view.state.tr.setMeta(summonKey, { open: from } satisfies Meta));
        // the keyboard goes to the menu: its first item
        focusMenu(view.dom.querySelector('[data-aris="menu"]'));
        return true;
      },
      handleKeyDown(view, e) {
        if (!summonKey.getState(view.state)) return false;
        if (e.key === 'Escape') {
          close(view, true);
          return true;
        }
        if (e.key === 'Backspace') {
          close(view, false);
          return true;
        }
        return false;
      },
      decorations(state) {
        const s = summonKey.getState(state);
        if (!s) return null;
        const at = s.at;
        const menu = () =>
          renderMenu(
            (c) => {
              const v = editor.view;
              const here = summonKey.getState(v.state)?.at ?? at; // the widget is reused while the spot moves
              v.dispatch(v.state.tr.setMeta(summonKey, { close: true } satisfies Meta));
              editor.view.focus(); // the menu is gone: the keyboard goes back to the page, at the summon spot
              onChoose(editor, here, c);
            },
            () => {
              close(editor.view, true);
              editor.view.focus();
            },
          );
        return DecorationSet.create(state.doc, [Decoration.widget(at, menu, { side: 1, key: 'summon:' + s.ver, ignoreSelection: true, stopEvent: () => true })]);
      },
    },
  });
}
