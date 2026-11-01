import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, MarkType } from '@tiptap/pm/model';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { LINE_BLOCKS, canApplyMark, normalizeBlock } from '@book/editor/index.js';
import { markToBook, toBook, toEditor } from './bridge';

/* How the book's text behaves in the editor (Part B's contract):

   - Enter and Shift-Enter insert "\n" into the text: a line break is a
     character, never a node (Part B rulings 1 and 2). Two of them make a
     blank line, which splits the block once it is normalised.
   - Normalising: Part B's normalizeBlock(parent, index) runs, in
     appendTransaction, on the blocks local edits touched, so the page always
     shows the form the text reads back as. It skips remote (ySync)
     transactions, and it NEVER touches the block that holds the selection
     while the writer is in it (trailing spaces, a half-typed "*" or blank
     line would jump): that block is normalised when the selection leaves it,
     and when the chapter closes (flushNormalize).
   - Bold and italic (strong, em) are toggled with canApplyMark: a mark the
     text cannot say back (an asterisk inside, a lone star next to it) is
     refused, and the editor's onRefuse shows a plain toast. */

export const normalizeKey = new PluginKey<{ dirty: number[] }>('beukNormalize');

const isRemote = (tr: Transaction): boolean => tr.getMeta(ySyncPluginKey) !== undefined;
const isLevel = (n: PMNode): boolean => n.type.name === 'doc' || n.type.name === 'container';

/** The start of the block (a child of the doc or of a container, never a container itself) at or around `p`. */
export function blockStartAt(doc: PMNode, p: number): number | null {
  const $p = doc.resolve(Math.max(0, Math.min(p, doc.content.size)));
  for (let d = $p.depth; d >= 1; d--) {
    if (isLevel($p.node(d - 1)) && $p.node(d).type.name !== 'container') return $p.before(d);
  }
  if (isLevel($p.parent)) {
    const after = $p.nodeAfter;
    const before = $p.nodeBefore;
    if (after && after.type.name !== 'container') return $p.pos;
    if (before && before.type.name !== 'container') return $p.pos - before.nodeSize;
    if (after) return blockStartAt(doc, $p.pos + 1); // the first block inside a container
  }
  return null;
}

/** The blocks a local transaction touched, as block starts in its final document. */
function touched(tr: Transaction): number[] {
  const out: number[] = [];
  const doc = tr.doc;
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_os, _oe, ns, ne) => {
      const a = Math.max(0, rest.map(ns, -1));
      const b = Math.min(doc.content.size, rest.map(ne, 1));
      for (const p of [a, b]) {
        const s = blockStartAt(doc, p);
        if (s !== null) out.push(s);
      }
      if (b > a) {
        doc.nodesBetween(a, b, (node, pos, parent) => {
          if (parent && isLevel(parent) && node.type.name !== 'container') {
            out.push(pos);
            return false;
          }
          return true;
        });
      }
    });
  });
  return out;
}

/** The start of the textblock holding the selection's head (the block the writer is in), or null. */
function heldStart(state: EditorState): number | null {
  const $h = state.selection.$head;
  if (!$h.parent.isTextblock || $h.depth < 1) return null;
  return blockStartAt(state.doc, $h.before($h.depth));
}

type Fix = { start: number; end: number; blocks: PMNode[] };

/** normalizeBlock for the block starting at `s`, as a document range, trimmed of the unchanged blocks at its edges. */
function fixAt(doc: PMNode, s: number, depth = 0): Fix | null {
  const $s = doc.resolve(s);
  if (!isLevel($s.parent) || depth > 4) return null;
  const parent = toBook($s.parent); // Part B compares bookSchema nodes (bridge.ts)
  const f = normalizeBlock(parent, $s.index());
  if (f === null) return null;
  if (f === 'up') return $s.depth >= 1 ? fixAt(doc, $s.before(), depth + 1) : null;
  let { from, to } = f;
  const blocks = f.blocks.slice();
  while (from < to && blocks.length && blocks[0]!.eq(parent.child(from))) {
    from++;
    blocks.shift();
  }
  while (from < to && blocks.length && blocks[blocks.length - 1]!.eq(parent.child(to - 1))) {
    to--;
    blocks.pop();
  }
  if (from === to && blocks.length === 0) return null;
  let start = $s.start();
  for (let i = 0; i < from; i++) start += parent.child(i).nodeSize;
  let end = start;
  for (let i = from; i < to; i++) end += parent.child(i).nodeSize;
  return { start, end, blocks: blocks.map((b) => toEditor(b, doc.type.schema)) };
}

const sameList = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function normalizePlugin(): Plugin {
  return new Plugin<{ dirty: number[] }>({
    key: normalizeKey,
    state: {
      init: () => ({ dirty: [] }),
      apply(tr, value) {
        const meta = tr.getMeta(normalizeKey) as { dirty?: number[] } | undefined;
        if (meta?.dirty) return { dirty: meta.dirty };
        if (!tr.docChanged) return value;
        const mapped = value.dirty.map((p) => tr.mapping.map(p, 1));
        const add = isRemote(tr) ? [] : touched(tr);
        return { dirty: [...new Set([...mapped, ...add])].sort((x, y) => x - y) };
      },
    },
    appendTransaction(trs, _old, state) {
      const dirty = normalizeKey.getState(state)?.dirty ?? [];
      if (!dirty.length || trs.some(isRemote)) return null;
      const flush = trs.some((t) => (t.getMeta(normalizeKey) as { flush?: boolean } | undefined)?.flush);
      const tr = state.tr;
      let held = flush ? null : heldStart(state);
      let pending = dirty.slice().sort((x, y) => y - x); // last first
      const keep: number[] = [];
      for (let guard = 0; pending.length && guard < 10_000; guard++) {
        const s = blockStartAt(tr.doc, pending.shift()!);
        if (s === null) continue;
        if (s === held) {
          keep.push(s);
          continue;
        }
        const fix = fixAt(tr.doc, s);
        if (!fix) continue;
        if (held !== null && held >= fix.start && held < fix.end) {
          keep.push(s);
          continue;
        }
        tr.replaceWith(fix.start, fix.end, fix.blocks);
        const map = tr.mapping.maps[tr.mapping.maps.length - 1]!;
        pending = pending.map((p) => map.map(p, 1));
        for (let i = 0; i < keep.length; i++) keep[i] = map.map(keep[i]!, 1);
        if (held !== null) held = map.map(held, 1);
      }
      const rest = [...new Set(keep)].sort((x, y) => x - y);
      if (!tr.docChanged && sameList(rest, dirty)) return null;
      tr.setMeta(normalizeKey, { dirty: rest });
      return tr;
    },
  });
}

/** Normalise every pending block, the one holding the selection included (the chapter is closing). */
export function flushNormalize(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(normalizeKey, { flush: true }));
}

/** The pending block starts (for tests). */
export const pendingBlocks = (state: EditorState): number[] => normalizeKey.getState(state)?.dirty ?? [];

/** em/strong over the selection: removed when the whole selection has it, else added where every touched block can say it back. */
export function toggleBookMark(editor: Editor, name: 'em' | 'strong', onRefuse: () => void): boolean {
  const { state, view } = editor;
  const type: MarkType | undefined = state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    if (!$from.parent.type.allowsMarkType(type)) {
      onRefuse();
      return false;
    }
    const has = !!type.isInSet(state.storedMarks ?? $from.marks());
    view.dispatch(has ? state.tr.removeStoredMark(type) : state.tr.addStoredMark(type.create()));
    return true;
  }
  let all = true;
  let any = false;
  let ok = true;
  state.doc.nodesBetween(from, to, (node, pos, parent, index) => {
    if (!node.isTextblock) return true;
    if (!node.type.allowsMarkType(type)) return false;
    const a = Math.max(from, pos + 1) - (pos + 1);
    const b = Math.min(to, pos + 1 + node.content.size) - (pos + 1);
    if (b <= a) return false;
    any = true;
    let covered = true;
    node.nodesBetween(a, b, (child) => {
      if (child.isText && !type.isInSet(child.marks)) covered = false;
      return true;
    });
    if (!covered) all = false;
    // a quote line or list item reads back with its whole block (wave 2a)
    const line = parent && LINE_BLOCKS.has(parent.type.name) ? { parent: toBook(parent), index } : undefined;
    if (!canApplyMark(toBook(node), a, b, markToBook(type.create()), line)) ok = false;
    return false;
  });
  if (!any) {
    onRefuse();
    return false;
  }
  if (all) {
    view.dispatch(state.tr.removeMark(from, to, type));
    return true;
  }
  if (!ok) {
    onRefuse();
    return false;
  }
  view.dispatch(state.tr.addMark(from, to, type.create()));
  return true;
}

/** Whether the selection (or the stored marks at the cursor) carries the mark: the toolbar's pressed state. */
export function markActive(state: EditorState, name: 'em' | 'strong'): boolean {
  const type = state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export type BehaviourOptions = { onRefuse: () => void };

/** Enter / Shift-Enter as "\n", Mod-b / Mod-i through toggleBookMark, and the normalising plugin. */
export const BookBehaviour = Extension.create<BehaviourOptions>({
  name: 'beukBehaviour',
  priority: 1100,
  addOptions: () => ({ onRefuse: () => undefined }),
  addKeyboardShortcuts() {
    const newline = (): boolean => {
      const { state, view } = this.editor;
      if (!state.selection.$from.parent.isTextblock) return false;
      view.dispatch(state.tr.insertText('\n').scrollIntoView());
      return true;
    };
    return {
      Enter: newline,
      'Shift-Enter': newline,
      'Mod-b': () => toggleBookMark(this.editor, 'strong', this.options.onRefuse) || true,
      'Mod-i': () => toggleBookMark(this.editor, 'em', this.options.onRefuse) || true,
    };
  },
  addProseMirrorPlugins: () => [normalizePlugin()],
});
