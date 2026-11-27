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
 *  (planRescue returned no plan). Paragraph ops (the C3 ruling) are not written here (Task 4): their counts
 *  stand as planned. */
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

  // every position taken on the doc as it is now, before the first step; mapped through the write when used
  type Write = { letters: string; at: number; from: number | null; last: Y.ID };
  const writes: Write[] = [];
  for (const op of plan.ops) {
    if (op.kind === 'paragraph') continue; // Task 4
    const n = countLetters(op.letters);
    const at = rank(op.at);
    if (op.kind === 'insert') {
      if (at === null) {
        counts.rescued -= n; // not a place to write after all: the letters' words gave no position
        counts.unplaced += n;
        continue;
      }
      writes.push({ letters: op.letters, at, from: null, last: op.last });
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
      writes.push({ letters: op.letters, at, from, last: op.last });
    }
  }

  let caretSet = false;
  if (writes.length) {
    const ptr = view.state.tr;
    let caretAt: { pos: number; step: number } | null = null;
    for (const w of writes) {
      if (w.from !== null) ptr.delete(ptr.mapping.map(w.from), ptr.mapping.map(w.from + w.letters.length, -1));
      const a = ptr.mapping.map(w.at);
      ptr.insert(a, view.state.schema.text(w.letters, ptr.doc.resolve(a).marks())); // the marks of the place
      if (caret && sameId(caret.item, w.last)) caretAt = { pos: a + w.letters.length, step: ptr.steps.length };
    }
    if (caretAt) {
      ptr.setSelection(TextSelection.create(ptr.doc, ptr.mapping.slice(caretAt.step).map(caretAt.pos)));
      caretSet = true;
    }
    view.dispatch(ptr);
  }
  return { ...counts, caret: caretSet, ms: performance.now() - t0 };
}
