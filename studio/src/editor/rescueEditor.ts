import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { countLetters, incomingUpdate, planRescue, type RescueCounts, type RescueOp, type YPlace } from './rescueCore';

// The keystroke rescue's editor half: turns planRescue's plan (Yjs places) into ProseMirror positions and
// writes it as ONE transaction in this writer's own editor, right after the caret keeper, inside the remote
// transaction's afterTransaction. The write is the writer's own edit (no addToHistory meta), so it joins
// their undo history and reaches the other writer as an ordinary change.
//
// During an IME composition nothing is written: the plan is made at once (the dead letters' text must be read
// now, Yjs collects deleted content after afterTransaction), kept on the view with every place as a
// Y.RelativePosition and every move's letters by their Yjs ids, and written by flushRescue once the
// composition has ended (caretKeeper.ts calls it).

/** What the rescue did after one remote change (counts in code points); `caret`: the selection was put right
 *  after the rescued letters; `ms`: planning plus the write. */
export type RescueReport = RescueCounts & { caret: boolean; ms: number };

const sameId = (a: Y.ID | null, b: Y.ID): boolean => a !== null && a.client === b.client && a.clock === b.clock;

// every position taken on the doc as it is now, before the first step; mapped through the write when used.
// `block`: a paragraph of its own at `at`, a position between top-level blocks (the C3 ruling)
type Write = { letters: string; at: number; from: number | null; last: Y.ID; block: boolean };

/** frag's live children: the C3 ruling's index is a ProseMirror child index only while the editor holds exactly these. */
const liveChildren = (frag: Y.XmlFragment): number => {
  let live = 0;
  for (let it = frag._start; it; it = it.right) if (!it.deleted && it.countable) live += it.length;
  return live;
};

/** The position before the top-level block at `index` (null when the editor does not hold exactly frag's live children). */
const blockStart = (view: EditorView, frag: Y.XmlFragment, index: number): number | null => {
  const pm = view.state.doc;
  if (pm.childCount !== liveChildren(frag) || index > pm.childCount) return null;
  let at = 0;
  for (let k = 0; k < index; k++) at += pm.child(k).nodeSize;
  return at;
};

/** A move's pre-check: the letters stand at `from` within one block. */
const standsAt = (view: EditorView, from: number, letters: string): boolean => {
  const pm = view.state.doc;
  const to = from + letters.length;
  return to <= pm.content.size && pm.resolve(from).sameParent(pm.resolve(to)) && pm.textBetween(from, to) === letters;
};

/** Write `writes` as one transaction; the caret goes right after the write whose `last` is `caret`. True when it was set. */
function write(view: EditorView, writes: Write[], caret: Y.ID | null): boolean {
  if (!writes.length) return false;
  const ptr = view.state.tr;
  let caretAt: { pos: number; step: number } | null = null;
  const schema = view.state.schema;
  for (const w of writes) {
    if (w.from !== null) ptr.delete(ptr.mapping.map(w.from), ptr.mapping.map(w.from + w.letters.length, -1));
    // mapped after what was written before (assoc 1): a paragraph at the same index goes after the previous one
    const a = ptr.mapping.map(w.at);
    if (w.block) ptr.insert(a, schema.nodes.paragraph.create(null, schema.text(w.letters)));
    else ptr.insert(a, schema.text(w.letters, ptr.doc.resolve(a).marks())); // the marks of the place
    const end = a + (w.block ? 1 : 0) + w.letters.length; // inside the new paragraph, after its letters
    if (sameId(caret, w.last)) caretAt = { pos: end, step: ptr.steps.length };
  }
  let set = false;
  if (caretAt) {
    ptr.setSelection(TextSelection.create(ptr.doc, ptr.mapping.slice(caretAt.step).map(caretAt.pos)));
    set = true;
  }
  view.dispatch(ptr);
  return set;
}

// ---- the wait for a composition's end ------------------------------------------------------------------

/** A plan op kept across a composition: no Yjs item or type held, only ids and relative positions. `ids`: a
 *  move's letters by their Yjs ids (null: they could not be read off the text at plan time). */
type WaitingOp =
  | { kind: 'insert'; letters: string; at: Y.RelativePosition; last: Y.ID }
  | { kind: 'move'; letters: string; ids: Y.ID[] | null; at: Y.RelativePosition; last: Y.ID }
  | { kind: 'paragraph'; letters: string; at: Y.RelativePosition; last: Y.ID };
/** `head`: the selection's head when the plan was queued (null for a range); the caret follows the letters at
 *  the flush only if the writer's caret is still there. */
type Waiting = { ops: WaitingOp[]; counts: RescueCounts; caret: Y.ID | null; head: Y.RelativePosition | null; ms: number };
const waiting = new WeakMap<EditorView, Waiting[]>();

/** A plan waits for this view's composition to end. */
export const rescueWaiting = (view: EditorView): boolean => (waiting.get(view)?.length ?? 0) > 0;
/** Drop what waits (the view is destroyed). */
export const dropRescue = (view: EditorView): void => void waiting.delete(view);

/** The ids of the `letters.length` UTF-16 units alive in `text` from `index` on; null unless they read `letters`. */
function idsAt(text: Y.XmlText, index: number, letters: string): Y.ID[] | null {
  let it = text._start;
  let k = index;
  for (; it; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (k < it.length) break;
    k -= it.length;
  }
  const ids: Y.ID[] = [];
  let s = '';
  for (; it && ids.length < letters.length; it = it.right) {
    if (it.deleted || !it.countable) continue;
    if (!(it.content instanceof Y.ContentString)) return null;
    const str = (it.content as unknown as { str: string }).str;
    for (let j = k; j < it.length && ids.length < letters.length; j++) {
      ids.push(Y.createID(it.id.client, it.id.clock + j));
      s += str[j];
    }
    k = 0;
  }
  return s === letters ? ids : null;
}

/** The Yjs character `id` is alive (an id Yjs cannot find counts as gone). */
function alive(doc: Y.Doc, id: Y.ID): boolean {
  try {
    const it = Y.getItem(doc.store, id);
    return it instanceof Y.Item && !it.deleted;
  } catch {
    return false;
  }
}

/** `t` and every block above it up to `frag` are alive. */
function aliveIn(frag: Y.XmlFragment, t: Y.AbstractType<any>): boolean {
  if (frag._item?.deleted) return false;
  for (let x: Y.AbstractType<any> = t; x !== frag; ) {
    const it = x._item;
    if (!it || it.deleted || !(it.parent instanceof Y.AbstractType)) return false;
    x = it.parent;
  }
  return true;
}

function queue(view: EditorView, b: ProsemirrorBinding, frag: Y.XmlFragment, ops: RescueOp[], counts: RescueCounts, caret: Y.ID | null, ms: number): void {
  const rel = (p: YPlace) => Y.createRelativePositionFromTypeIndex(p.text, p.index, -1);
  const kept: WaitingOp[] = ops.map((op) =>
    op.kind === 'insert'
      ? { kind: 'insert', letters: op.letters, at: rel(op.at), last: op.last }
      : op.kind === 'move'
        ? { kind: 'move', letters: op.letters, ids: idsAt(op.from.text, op.from.index, op.letters), at: rel(op.at), last: op.last }
        : // the C3 paragraph: where the deleted block stood, after the live block before it (assoc -1)
          { kind: 'paragraph', letters: op.letters, at: Y.createRelativePositionFromTypeIndex(frag, op.index, -1), last: op.last },
  );
  const sel = view.state.selection;
  const head = sel.empty ? absolutePositionToRelativePosition(sel.head, frag, b.mapping) : null;
  const list = waiting.get(view) ?? [];
  list.push({ ops: kept, counts: { ...counts }, caret, head, ms });
  waiting.set(view, list);
}

/** Write what waited for a composition to end: one transaction and one report per queued plan, in the order
 *  they were queued. Each place is resolved through Yjs now: a place whose character is no longer alive, or that
 *  does not resolve to a live text in frag, or not inside a textblock, leaves its letters `unplaced`; a move whose letters are no longer all alive
 *  (or no longer stand together in one block) is not written (`stayed`); a C3 paragraph is written only while
 *  the editor holds exactly frag's live children (else `unplaced`). Nothing while the view still composes. */
export function flushRescue(view: EditorView, b: ProsemirrorBinding, frag: Y.XmlFragment): RescueReport[] {
  const list = waiting.get(view);
  if (!list?.length || view.composing || view.isDestroyed) return [];
  waiting.delete(view);
  const doc = frag.doc!;
  const out: RescueReport[] = [];
  for (const w of list) {
    const t0 = performance.now();
    const pm = view.state.doc;
    const pos = (rel: Y.RelativePosition): number | null => {
      // the character the place hangs on must still be alive: Yjs resolves a deleted one to where it stood among
      // the live letters, a position the words no longer give
      if (rel.item && !alive(doc, rel.item)) return null;
      const abs = Y.createAbsolutePositionFromRelativePosition(rel, doc);
      if (!abs || !(abs.type instanceof Y.XmlText) || !aliveIn(frag, abs.type)) return null;
      const p = relativePositionToAbsolutePosition(doc, frag, rel, b.mapping);
      return p !== null && p >= 0 && p <= pm.content.size && pm.resolve(p).parent.isTextblock ? p : null;
    };
    const fromOf = (ids: Y.ID[] | null): number | null => {
      if (!ids?.length) return null;
      let text: Y.AbstractType<any> | null = null;
      for (const id of ids) {
        let it: Y.Item | Y.GC;
        try {
          it = Y.getItem(doc.store, id);
        } catch {
          return null;
        }
        if (!(it instanceof Y.Item) || it.deleted || !(it.content instanceof Y.ContentString)) return null;
        if (text === null) text = it.parent as Y.AbstractType<any>;
        else if (it.parent !== text) return null;
      }
      if (!(text instanceof Y.XmlText)) return null;
      const first = Y.getItem(doc.store, ids[0]) as Y.Item;
      let index = ids[0].clock - first.id.clock;
      for (let it = text._start; it && it !== first; it = it.right) if (!it.deleted && it.countable) index += it.length;
      return pos(Y.createRelativePositionFromTypeIndex(text, index, -1));
    };

    // its own try: a throw on one plan never costs another plan its write or its report
    const counts = { ...w.counts };
    try {
      const writes: Write[] = [];
      for (const op of w.ops) {
        const n = countLetters(op.letters);
        if (op.kind === 'paragraph') {
          const abs = Y.createAbsolutePositionFromRelativePosition(op.at, doc);
          const at = abs && abs.type === frag ? blockStart(view, frag, abs.index) : null;
          if (at === null) {
            counts.restored -= n;
            counts.unplaced += n;
            continue;
          }
          writes.push({ letters: op.letters, at, from: null, last: op.last, block: true });
        } else if (op.kind === 'insert') {
          const at = pos(op.at);
          if (at === null) {
            counts.rescued -= n;
            counts.unplaced += n;
            continue;
          }
          writes.push({ letters: op.letters, at, from: null, last: op.last, block: false });
        } else {
          const at = pos(op.at);
          const from = fromOf(op.ids);
          if (at === null || from === null || !standsAt(view, from, op.letters)) {
            counts.moved -= n;
            counts.stayed += n;
            continue;
          }
          writes.push({ letters: op.letters, at, from, last: op.last, block: false });
        }
      }
      // the caret follows the letters only if the writer has not moved it since the plan was queued
      const sel = view.state.selection;
      const still = w.head !== null && sel.empty && relativePositionToAbsolutePosition(doc, frag, w.head, b.mapping) === sel.head;
      const caret = write(view, writes, still ? w.caret : null);
      out.push({ ...counts, caret, ms: w.ms + performance.now() - t0 });
    } catch {
      try {
        // the write landed (the throw came after the editor took it): what was resolved stands. It did not:
        // nothing of this plan was written, so its letters that were to be written are told (`unplaced`),
        // and a move's letters, alive where Yjs left them, `stayed`
        const landed = view.state.doc !== pm;
        const c = landed
          ? counts
          : { ...w.counts, rescued: 0, restored: 0, moved: 0, unplaced: w.counts.unplaced + w.counts.rescued + w.counts.restored, stayed: w.counts.stayed + w.counts.moved };
        out.push({ ...c, caret: false, ms: w.ms + performance.now() - t0 });
      } catch {
        // no report could be built for it
      }
    }
  }
  return out;
}

// ---- the rescue after one remote transaction -----------------------------------------------------------

/** Rescue this writer's own letters `tr` killed or stranded in `frag`. `caret`: where the keeper noted the caret
 *  before `tr` (`item`: the Yjs character it hung on; null for a range). Null when there was nothing to rescue
 *  (planRescue returned no plan), and while the view composes (the plan then waits for flushRescue). A
 *  paragraph op (the C3 ruling) is written as a paragraph of its own before the top-level block at its index;
 *  when the editor does not hold exactly frag's live children, nothing is written for it and its letters count
 *  `unplaced`, not `restored`. */
export function rescueAfter(view: EditorView, b: ProsemirrorBinding, frag: Y.XmlFragment, tr: Y.Transaction, caret: { abs: number; item: Y.ID | null } | null): RescueReport | null {
  const t0 = performance.now();
  const doc = frag.doc!;
  const pm = view.state.doc;
  // a Yjs place as a ProseMirror position (the keeper's hit()): kept only within the doc and inside a textblock
  const rank = (p: YPlace): number | null => {
    const pos = relativePositionToAbsolutePosition(doc, frag, Y.createRelativePositionFromTypeIndex(p.text, p.index, -1), b.mapping);
    return pos !== null && pos >= 0 && pos <= pm.content.size && pm.resolve(pos).parent.isTextblock ? pos : null;
  };
  const plan = planRescue(tr, frag, doc.clientID, incomingUpdate(doc), rank, caret?.abs ?? view.state.selection.head);
  if (!plan) return null;
  if (view.composing) {
    queue(view, b, frag, plan.ops, plan.counts, caret?.item ?? null, performance.now() - t0);
    return null;
  }
  const counts = { ...plan.counts };

  const writes: Write[] = [];
  for (const op of plan.ops) {
    const n = countLetters(op.letters);
    if (op.kind === 'paragraph') {
      const at = blockStart(view, frag, op.index);
      if (at === null) {
        counts.restored -= n; // nothing written for it
        counts.unplaced += n;
        continue;
      }
      writes.push({ letters: op.letters, at, from: null, last: op.last, block: true });
      continue;
    }
    const at = rank(op.at);
    if (op.kind === 'insert') {
      if (at === null) {
        counts.rescued -= n; // not a place to write after all: the letters' words gave no position
        counts.unplaced += n;
        continue;
      }
      writes.push({ letters: op.letters, at, from: null, last: op.last, block: false });
    } else {
      const from = rank(op.from);
      // a move whose ends do not map, or whose letters do not stand at `from` within one block: nothing written,
      // they stay alive where Yjs left them
      if (at === null || from === null || !standsAt(view, from, op.letters)) {
        counts.moved -= n;
        counts.stayed += n;
        continue;
      }
      writes.push({ letters: op.letters, at, from, last: op.last, block: false });
    }
  }

  const caretSet = write(view, writes, caret?.item ?? null);
  return { ...counts, caret: caretSet, ms: performance.now() - t0 };
}
