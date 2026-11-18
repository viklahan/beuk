import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { posToTextOffset } from '@book/editor/index.js';
import { toBook } from '../editor/bridge';
import { applyTextEdit, editorText } from '../editor/insert';

/* The ghost: a proposal shown where it would go, as a WIDGET DECORATION (the style of covenant/marks.ts) — never
   document content, so nothing reaches the Y.Doc, the undo history or the export until the writer presses Insert.
   The same spot also carries the pending note while a proposal is on its way, and the server's own words when it
   refused. The widget lives inside the editor's surface, so it takes the book's direction and language from it. */

export type GhostResolve = 'insert' | 'edit' | 'discard' | 'retry';
type OnResolve = (r: GhostResolve, text?: string) => void;
type Ghost =
  | { kind: 'proposal'; at: number; text: string; editing: boolean; onResolve: OnResolve; ver: number }
  | { kind: 'pending' | 'notice'; at: number; text: string; onResolve?: OnResolve; ver: number };
type Meta = { set: Ghost | null } | { editing: true };

export const ghostKey = new PluginKey<Ghost | null>('beukAiGhost');
let ver = 0;

function control(label: string, act: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('data-aris', 'control');
  // keep the editor's selection where it is: the press is the widget's, not the page's
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    act();
  });
  return b;
}

function render(editor: Editor, g: Ghost): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute('data-aris', 'ghost');
  el.className = 'aris-ghost aris-ghost--' + g.kind;
  el.contentEditable = 'false';
  const controls = document.createElement('span');
  controls.setAttribute('data-aris', 'controls');
  const dot = () => controls.appendChild(document.createTextNode(' · '));
  if (g.kind === 'proposal') {
    let area: HTMLTextAreaElement | null = null;
    if (g.editing) {
      area = document.createElement('textarea');
      area.setAttribute('data-aris', 'edit');
      area.value = g.text;
      area.rows = Math.min(12, Math.max(3, g.text.split('\n').length + 1));
      el.appendChild(area);
    } else {
      const t = document.createElement('span');
      t.setAttribute('data-aris', 'text');
      t.textContent = g.text;
      el.appendChild(t);
    }
    controls.appendChild(control('Insert', () => g.onResolve('insert', area ? area.value : g.text)));
    dot();
    controls.appendChild(control('Edit first', () => {
      editor.view.dispatch(editor.state.tr.setMeta(ghostKey, { editing: true } satisfies Meta));
      g.onResolve('edit');
    }));
    dot();
    controls.appendChild(control('Discard', () => {
      clearGhost(editor);
      g.onResolve('discard');
    }));
    dot();
    controls.appendChild(control('retry', () => g.onResolve('retry')));
  } else {
    const n = document.createElement('span');
    n.setAttribute('data-aris', 'notice');
    if (g.kind === 'pending') n.setAttribute('aria-busy', 'true');
    n.setAttribute('role', 'status');
    n.textContent = g.text;
    el.appendChild(n);
    if (g.kind === 'notice') {
      controls.appendChild(control('Discard', () => {
        clearGhost(editor);
        g.onResolve?.('discard');
      }));
      if (g.onResolve) {
        dot();
        controls.appendChild(control('retry', () => g.onResolve!('retry')));
      }
    }
  }
  if (controls.childNodes.length) el.appendChild(controls);
  return el;
}

export function ghostPlugin(editor: Editor): Plugin<Ghost | null> {
  return new Plugin<Ghost | null>({
    key: ghostKey,
    state: {
      init: () => null,
      apply(tr, g) {
        const m = tr.getMeta(ghostKey) as Meta | undefined;
        if (m && 'set' in m) return m.set;
        if (m && 'editing' in m && g?.kind === 'proposal') return { ...g, editing: true, ver: ++ver };
        if (!g || !tr.docChanged) return g;
        // a change in ANOTHER block (typing above it, a remote edit there) maps the ghost along. A change that covers its
        // spot ends it — and a Yjs-origin change replaces each block it touched whole (y-tiptap's replaceChangedChildren),
        // so a remote edit inside the ghost's own block drops it: fail-safe, it is never re-placed at a guessed spot
        // (test: 'a remote change in another block carries the ghost along; one in its own block drops it')
        const r = tr.mapping.mapResult(g.at, -1);
        return r.deleted ? null : { ...g, at: r.pos };
      },
    },
    props: {
      decorations(state) {
        const g = ghostKey.getState(state);
        if (!g) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(g.at, () => render(editor, g), { side: 1, key: 'ghost:' + g.ver, ignoreSelection: true, stopEvent: () => true }),
        ]);
      },
    },
  });
}

const setGhost = (editor: Editor, g: Ghost | null) => {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(ghostKey, { set: g } satisfies Meta));
};

/** The ghost now showing (its kind and where), or null. */
export const ghostAt = (state: EditorState): { kind: Ghost['kind']; at: number; ver: number } | null => {
  const g = ghostKey.getState(state);
  return g ? { kind: g.kind, at: g.at, ver: g.ver } : null;
};

/** Show `text` as a proposal at `at`, with Insert · Edit first · Discard · retry. Replaces whatever ghost was there. */
export function showGhost(editor: Editor, at: number, text: string, onResolve: OnResolve): number {
  const v = ++ver;
  setGhost(editor, { kind: 'proposal', at, text, editing: false, onResolve, ver: v });
  return v;
}

/** Show a note at `at`: 'pending' while a proposal is on its way, 'notice' for the server's own words (with Discard,
 *  and retry when `onResolve` is given). */
export function showNotice(editor: Editor, at: number, kind: 'pending' | 'notice', text: string, onResolve?: OnResolve): number {
  const v = ++ver;
  setGhost(editor, { kind, at, text, onResolve, ver: v });
  return v;
}

export function clearGhost(editor: Editor): void {
  if (!editor.isDestroyed && ghostKey.getState(editor.state)) setGhost(editor, null);
}

export type InsertFacts = { bytesBefore: number; bytesAfter: number; inserted: string };

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** Put `text` into the document at the ghost's spot and clear the ghost, in ONE transaction (one Yjs change, one undo
 *  step): the section's text with `text` spliced in at the ghost's text offset, written by applyTextEdit. The section's
 *  text is measured in UTF-8 bytes before and after. Null when no proposal ghost is showing. */
export function insertGhost(editor: Editor, text: string): InsertFacts | null {
  if (editor.isDestroyed) return null;
  const g = ghostKey.getState(editor.state);
  if (!g || g.kind !== 'proposal') return null;
  const before = editorText(editor).text;
  const at = posToTextOffset(toBook(editor.state.doc), g.at);
  const end = at + text.length;
  const next = before.slice(0, at) + text + before.slice(at);
  if (!applyTextEdit(editor, { text: next, start: end, end }, { meta: [ghostKey, { set: null } satisfies Meta] })) return null;
  return { bytesBefore: utf8(before), bytesAfter: utf8(editorText(editor).text), inserted: text };
}
