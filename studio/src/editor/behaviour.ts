import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, MarkType } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { LINE_BLOCKS, canApplyMark, normalizeBlock } from '@book/editor/index.js';
import { markToBook, toBook, toEditor } from './bridge';

/* How the book's text behaves in the editor (Part B's contract):

   - Enter inserts "\n" into the text: a line break is a character, never a
     node (Part B rulings 1 and 2). Two of them make a blank line, which
     splits the block once it is normalised. One alone is a new line of the
     same paragraph in the editor and a space on the page, as it always was
     (a paragraph may be typed on several lines).
   - BEUK:breaksshown — Shift-Enter in a paragraph is a line break the
     writer MAKES: it inserts the book's mark of one, a backslash straight
     before the "\n" (Markdown's own spelling; still characters, never a
     node). Every surface sets that as a line break and shows no backslash
     (client/index.html, BEUK:breaksshown). The editor shows the backslash,
     dimmed (.ms-brmark), so the writer can see which of a paragraph's new
     lines the page will keep, and take one back: Backspace straight after
     a mark removes the mark and its new line together. In any other block
     (a heading, a list's item, a quotation's line, a note) Shift-Enter is
     the plain "\n" it was: the page reads no mark there, and would show
     the backslash.
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

/* BEUK:breaksshown — the book's mark of a line break the writer made: a backslash straight before the newline. */
export const LINE_BREAK = '\\\n';
export const breakMarkKey = new PluginKey<DecorationSet>('beukBreakMarks');

/** Each mark's backslash in a paragraph, as an inline decoration (the document itself is not touched). */
function breakMarks(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'quote') { // a quotation's line that another follows: a backslash at its end is the mark
      node.forEach((line, off, i) => {
        const end = pos + 2 + off + line.content.size;
        if (i < node.childCount - 1 && line.textContent.endsWith('\\')) out.push(Decoration.inline(end - 1, end, { class: 'ms-brmark' }));
      });
      return false;
    }
    if (node.type.name !== 'paragraph') return isLevel(node);
    const text = node.textContent; // a paragraph holds text only, so an offset in it is a position
    for (let at = text.indexOf(LINE_BREAK); at !== -1; at = text.indexOf(LINE_BREAK, at + LINE_BREAK.length)) {
      out.push(Decoration.inline(pos + 1 + at, pos + 2 + at, { class: 'ms-brmark' }));
    }
    return false;
  });
  return out.length ? DecorationSet.create(doc, out) : DecorationSet.empty;
}

export function breakMarkPlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key: breakMarkKey,
    state: {
      init: (_config, state) => breakMarks(state.doc),
      apply: (tr, set) => (tr.docChanged ? breakMarks(tr.doc) : set),
    },
    props: { decorations: (state) => breakMarkKey.getState(state) },
  });
}

/** Enter as "\n", Shift-Enter as a marked line break in a paragraph, Mod-b / Mod-i through toggleBookMark, and the normalising plugin. */
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
    const lineBreak = (): boolean => {
      const { state, view } = this.editor;
      const parent = state.selection.$from.parent;
      if (!parent.isTextblock) return false;
      view.dispatch(state.tr.insertText(parent.type.name === 'paragraph' ? LINE_BREAK : '\n').scrollIntoView());
      return true;
    };
    /* straight after a mark: the mark and its new line go together (one alone would leave a backslash on the page) */
    const unbreak = (): boolean => {
      const { state, view } = this.editor;
      const { empty, $from } = state.selection;
      const at = $from.parentOffset;
      if (!empty || $from.parent.type.name !== 'paragraph' || at < LINE_BREAK.length) return false;
      if ($from.parent.textBetween(at - LINE_BREAK.length, at) !== LINE_BREAK) return false;
      view.dispatch(state.tr.delete($from.pos - LINE_BREAK.length, $from.pos).scrollIntoView());
      return true;
    };
    return {
      Enter: newline,
      'Shift-Enter': lineBreak,
      Backspace: unbreak,
      'Mod-b': () => toggleBookMark(this.editor, 'strong', this.options.onRefuse) || true,
      'Mod-i': () => toggleBookMark(this.editor, 'em', this.options.onRefuse) || true,
    };
  },
  addProseMirrorPlugins: () => [normalizePlugin(), breakMarkPlugin()],
});
