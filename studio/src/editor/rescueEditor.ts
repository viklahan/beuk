import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { relativePositionToAbsolutePosition, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { countLetters, incomingUpdate, planRescue, type RescueCounts, type YPlace } from './rescueCore';

// The keystroke rescue's editor half: turns planRescue's plan (Yjs places) into ProseMirror positions and
// writes it as ONE transaction in this writer's own editor, right after the caret keeper, inside the remote
// transaction's afterTransaction. The write is the writer's own edit (no addToHistory meta), so it joins
// their undo history and reaches the other writer as an ordinary change.

/** What the rescue did after one remote change (counts in code points); `caret`: the selection was put right
 *  after the rescued letters; `ms`: planning plus the write. */
export type RescueReport = RescueCounts & { caret: boolean; ms: number };

const sameId = (a: Y.ID | null, b: Y.ID): boolean => a !== null && a.client === b.client && a.clock === b.clock;

/** Rescue this writer's own letters `tr` killed or stranded in `frag`. `caret`: where the keeper noted the caret
 *  before `tr` (`item`: the Yjs character it hung on; null for a range). Null when there was nothing to rescue
 *  (planRescue returned no plan). A paragraph op (the C3 ruling) is written as a paragraph of its own before
 *  the top-level block at its index; when the editor does not hold exactly frag's live children, nothing is
 *  written for it and its letters count `unplaced`, not `restored`. */
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
  const counts = { ...plan.counts };

  // every position taken on the doc as it is now, before the first step; mapped through the write when used.
  // `block`: a paragraph of its own at `at`, a position between top-level blocks (the C3 ruling)
  type Write = { letters: string; at: number; from: number | null; last: Y.ID; block: boolean };
  const writes: Write[] = [];
  // the C3 ruling's index is a live index in frag: it is a ProseMirror child index only while the editor holds
  // exactly frag's live children
  let live = 0;
  for (let it = frag._start; it; it = it.right) if (!it.deleted && it.countable) live += it.length;
  for (const op of plan.ops) {
    const n = countLetters(op.letters);
    if (op.kind === 'paragraph') {
      if (pm.childCount !== live || op.index > pm.childCount) {
        counts.restored -= n; // nothing written for it
        counts.unplaced += n;
        continue;
      }
      let at = 0;
      for (let k = 0; k < op.index; k++) at += pm.child(k).nodeSize;
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
      const to = from === null ? -1 : from + op.letters.length;
      if (at === null || from === null || to > pm.content.size || !pm.resolve(from).sameParent(pm.resolve(to)) || pm.textBetween(from, to) !== op.letters) {
        counts.moved -= n;
        counts.stayed += n;
        continue;
      }
      writes.push({ letters: op.letters, at, from, last: op.last, block: false });
    }
  }

  let caretSet = false;
  if (writes.length) {
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
      if (caret && sameId(caret.item, w.last)) caretAt = { pos: end, step: ptr.steps.length };
    }
    if (caretAt) {
      ptr.setSelection(TextSelection.create(ptr.doc, ptr.mapping.slice(caretAt.step).map(caretAt.pos)));
      caretSet = true;
    }
    view.dispatch(ptr);
  }
  return { ...counts, caret: caretSet, ms: performance.now() - t0 };
}
