import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { onlyPositionMigrations } from './positionMigrations';
import { CTX, OBJ, findInText, nearestOf } from './textMatch';
import { textOf, touches, written, writtenTexts } from './rescueCore';
import { dropRescue, flushRescue, rescueAfter, rescueWaiting, type RescueReport } from './rescueEditor';

// The caret keeper: keeps a writer's caret where they put it when ANOTHER writer's change rebuilds
// their paragraph.
//
// Why it is needed: when a remote change deletes the characters a caret is anchored to (a paragraph
// turned into a heading, Enter pressed before the caret, a join with the block above) and writes the
// same text back as new Yjs items, y-tiptap's own answer for the caret is a heuristic and the caret
// moves. Measured on y-tiptap 3.0.10 with the studio's position-migration hold (positionMigrations.ts):
// the same three of the spike's eight cases move as on 3.3.0 in the spike; test/caret-keeper.test.ts
// holds the cases.
//
// The idea: nothing is stored or sent. Every client sees the whole change. Just before a remote
// transaction the keeper notes its caret as a Yjs position plus the words on either side of it. Just
// after, if the character the caret was anchored to died, it looks only in the text that transaction
// wrote for the same words around the same spot and puts the caret back between them. So it covers
// another writer's edit and undo, catching up after being offline, and the server's own writes alike:
// it reads the change, not a hint.
//
// The cost: the search reads only the text the change wrote (nothing at all when the caret's character
// survived). The note, taken before every remote change (before it, the keeper cannot know what the
// change touches), walks the chapter's blocks from the first to the caret's
// (absolutePositionToRelativePosition), so it grows with how deep in the chapter the caret is: measured
// in test/caret-keeper-hard.test.ts with the caret in the first and in the last of 401 blocks.
//
// A side effect: when the keeper moves the caret it dispatches a selection-only transaction right after
// y-tiptap rendered the remote change (marked not for history), and y-tiptap's view update then calls the
// UndoManager's stopCapturing. So each keeper move is an undo boundary in the writer's own typing: the
// letters typed before it and after it are separate undo steps (test/caret-keeper.test.ts counts the call).
//
// The matching rule (findInText, nearestOf) is pure: no editor, no Yjs. The extension below it is wired
// into every chapter editor right after Collaboration (createEditor.ts).

export { CTX, OBJ, findInText, nearestOf, writtenTexts };

// ---- The extension -------------------------------------------------------------------------------

/** What the keeper did after one remote change:
 *  - alive: the caret's character survived, so Yjs's own answer is applied;
 *  - found: the character died and the words were found, so the caret is put between them;
 *  - lost: the character died and the words were not found, so y-tiptap's answer stands;
 *  - composing: an IME composition is open, so nothing is done;
 *  - none: there is nothing to keep (not in a textblock, no binding, the view destroyed, or the section deleted). */
export type KeeperOutcome = 'alive' | 'found' | 'lost' | 'composing' | 'none';
/** `moved`: the keeper set the selection. `ms`: its time, note and placing. `searched`: characters findInText read. */
export type KeeperResult = { outcome: KeeperOutcome; moved: boolean; ms: number; searched: number };

/** `onRescue`: the keystroke rescue's report after a remote change that killed or stranded this writer's own letters (rescueEditor.ts). */
export type CaretKeeperOptions = { fragment: Y.XmlFragment; onResult?: (r: KeeperResult) => void; onRescue?: (r: RescueReport) => void };
/** `rescue`: the keystroke rescue's last report (null until one). */
export type CaretKeeperStorage = { last: KeeperResult | null; rescue: RescueReport | null };

declare module '@tiptap/core' {
  interface Storage {
    caretKeeper: CaretKeeperStorage;
  }
}

/** One end of the selection, noted before a remote change: the Yjs position and the words either side. */
type CaretNote = { abs: number; rel: Y.RelativePosition; pre: string; post: string };

/** Is the Yjs character (or type) this position hangs on gone? An id Yjs cannot find counts as gone. */
function dead(doc: Y.Doc, rel: Y.RelativePosition): boolean {
  const id = rel.item ?? rel.type;
  if (!id) return false;
  try {
    return Y.getItem(doc.store, id).deleted;
  } catch {
    return true;
  }
}


/** This editor's own change: its binding's write, or its UndoManager's undo / redo (also when the migration
 *  hold runs that inside an outer transaction: that transaction's origin is the manager, and it is local). */
const own = (tr: Y.Transaction): boolean => tr.origin === ySyncPluginKey || (tr.origin instanceof Y.UndoManager && tr.local);

export const CaretKeeper = Extension.create<CaretKeeperOptions, CaretKeeperStorage>({
  name: 'caretKeeper',
  addOptions: () => ({ fragment: null as unknown as Y.XmlFragment, onResult: undefined, onRescue: undefined }),
  addStorage: () => ({ last: null, rescue: null }),
  addProseMirrorPlugins() {
    const frag = this.options.fragment;
    const onResult = this.options.onResult;
    const onRescue = this.options.onRescue;
    const storage = this.storage;
    const doc = frag.doc!;
    return [
      new Plugin({
        key: new PluginKey('caretKeeper'),
        view: (view: EditorView) => {
          const binding = (): ProsemirrorBinding | null => (ySyncPluginKey.getState(view.state) as { binding?: ProsemirrorBinding } | undefined)?.binding ?? null;
          // the remote transaction being kept, and the selection's two ends before it (head null for a caret)
          let held: { tr: Y.Transaction; anchor: CaretNote | null; head: CaretNote | null; caret: boolean; ms: number } | null = null;

          const note = (pos: number): CaretNote | null => {
            const b = binding();
            const $p = view.state.doc.resolve(pos);
            if (!b || !$p.parent.isTextblock) return null;
            const txt = $p.parent.textBetween(0, $p.parent.content.size, undefined, OBJ);
            const off = $p.parentOffset;
            return { abs: pos, rel: absolutePositionToRelativePosition(pos, frag, b.mapping), pre: txt.slice(Math.max(0, off - CTX), off), post: txt.slice(off, off + CTX) };
          };
          const report = (r: KeeperResult) => {
            storage.last = r;
            onResult?.(r);
          };

          const keepBefore = (tr: Y.Transaction) => {
            if (held || own(tr) || onlyPositionMigrations(tr) || view.isDestroyed) return;
            const t0 = performance.now();
            const sel = view.state.selection;
            const caret = sel.head === sel.anchor;
            const anchor = note(sel.anchor);
            const head = caret ? null : note(sel.head);
            held = { tr, anchor, head, caret, ms: performance.now() - t0 };
          };

          const keepAfter = (tr: Y.Transaction, was: NonNullable<typeof held>) => {
            if (onlyPositionMigrations(tr)) return; // a relayed clear of the migration maps: no fragment touched
            const gone = !!frag._item?.deleted;
            if (!gone && !touches(tr, frag)) return; // a change elsewhere in the book (another chapter, the meta): nothing to keep
            const t0 = performance.now();
            const done = (outcome: KeeperOutcome, moved = false, searched = 0) => report({ outcome, moved, ms: was.ms + performance.now() - t0, searched });
            if (view.composing) return done('composing');
            const b = binding();
            if (view.isDestroyed || gone || !b || (!was.anchor && !was.head)) return done('none');

            let wrote: { texts: Y.XmlText[]; empties: Y.XmlElement[] } | null = null;
            let searched = 0;
            let lost = false;
            let found = false;
            // where one end goes; null: y-tiptap's answer stands for it
            const place = (e: CaretNote | null): number | null => {
              if (!e) return null;
              if (!dead(doc, e.rel)) {
                const p = relativePositionToAbsolutePosition(doc, frag, e.rel, b.mapping); // Yjs's own answer
                if (p !== null) return p; // (alive but unresolvable: look for the words, as for a dead one)
              }
              wrote ??= written(tr, frag);
              const positions: number[] = [];
              const hit = (t: Y.XmlText | Y.XmlElement, i: number) => {
                const p = relativePositionToAbsolutePosition(doc, frag, Y.createRelativePositionFromTypeIndex(t, i, -1), b.mapping);
                if (p !== null && p >= 0 && p <= view.state.doc.content.size && view.state.doc.resolve(p).parent.isTextblock) positions.push(p);
              };
              for (const t of wrote.texts) {
                const s = textOf(t);
                searched += s.length;
                for (const i of findInText(s, e.pre, e.post)) hit(t, i);
              }
              for (const el of wrote.empties) for (const i of findInText('', e.pre, e.post)) hit(el, i);
              const p = nearestOf(positions, e.abs);
              if (p === null) lost = true;
              else found = true;
              return p;
            };
            const a = place(was.anchor);
            const h = was.caret ? a : place(was.head);
            const outcome: KeeperOutcome = lost ? 'lost' : found ? 'found' : 'alive';

            const sel = view.state.selection;
            const na = a ?? sel.anchor;
            const nh = was.caret ? na : (h ?? sel.head);
            const max = view.state.doc.content.size;
            if ((na === sel.anchor && nh === sel.head) || na < 0 || nh < 0 || na > max || nh > max) return done(outcome, false, searched);
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, na, nh)).setMeta('addToHistory', false));
            done(outcome, true, searched);
          };

          // the keystroke rescue, right after the keeper: this writer's own letters the change killed or stranded
          // go back between their words (rescueEditor.ts). The caret it may follow is the keeper's note: a caret's
          // Yjs character; for a range, only where its head was (nothing to follow). While the view composes,
          // rescueAfter only plans and the plan waits (flush below).
          const emit = (r: RescueReport) => {
            storage.rescue = r;
            onRescue?.(r);
          };
          const rescue = (tr: Y.Transaction, was: NonNullable<typeof held>) => {
            if (onlyPositionMigrations(tr) || view.isDestroyed) return;
            const b = binding();
            if (!b) return;
            const end = was.caret ? was.anchor : (was.head ?? was.anchor);
            const r = rescueAfter(view, b, frag, tr, end ? { abs: end.abs, item: was.caret ? end.rel.item : null } : null);
            if (r) emit(r);
          };

          // What waited for a composition's end is written once the view no longer composes, always on the next
          // turn (setTimeout(0)): scheduled from the plugin view's update and from a compositionend listener
          // (ProseMirror ends its own composition after that event). Never throws: a throw (or one in the callback) loses that report only.
          const flush = () => {
            try {
              if (view.isDestroyed || view.composing) return;
              const b = binding();
              if (!b) return;
              for (const r of flushRescue(view, b, frag)) {
                try {
                  emit(r);
                } catch {
                  // that report not delivered
                }
              }
            } catch {
              // nothing written
            }
          };
          let timer: ReturnType<typeof setTimeout> | null = null;
          const later = () => {
            if (timer === null)
              timer = setTimeout(() => {
                timer = null;
                flush();
              }, 0);
          };
          const onCompositionEnd = () => later();
          view.dom.addEventListener('compositionend', onCompositionEnd);

          // Yjs emits both events outside its own try: a throw in beforeTransaction leaves doc._transaction set
          // for good (every later change nests into the dead one, so nothing renders, syncs or saves), and a
          // throw in afterTransaction comes out of the remote apply. So neither ever throws: on an error the
          // keeper does nothing for that transaction (no note, no result, no dispatch; y-tiptap's answer stands).
          const onBefore = (tr: Y.Transaction) => {
            try {
              keepBefore(tr);
            } catch {
              held = null;
            }
          };
          const onAfter = (tr: Y.Transaction) => {
            if (!held || held.tr !== tr) return;
            const was = held;
            held = null;
            try {
              keepAfter(tr, was);
            } catch {
              // nothing kept
            }
            // its own try, so a throw in the keeper never skips the rescue and a throw in the rescue (or its
            // callback) is swallowed exactly like the keeper's
            try {
              rescue(tr, was);
            } catch {
              // nothing rescued
            }
          };

          // Yjs emits afterTransaction to its listeners in turn, and one that throws stops the rest: the keeper's
          // onAfter then never runs for that transaction and `held` would keep it, so keepBefore would skip every
          // later change. afterAllTransactions comes from Yjs's finally, after every afterTransaction of the batch
          // (transactions started by observers included), so `held` is dropped there in any case.
          const onAll = () => {
            held = null;
          };

          doc.on('beforeTransaction', onBefore);
          doc.on('afterTransaction', onAfter);
          doc.on('afterAllTransactions', onAll);
          return {
            update: () => {
              if (view.composing || !rescueWaiting(view)) return;
              // never a dispatch from inside ProseMirror's update: this update may be y-tiptap's render of a Yjs
              // change (inside its binding's mutex, where a write never reaches Yjs), and a remote transaction's
              // own rescue may not have run yet. The flush waits for the next turn, as after compositionend.
              later();
            },
            destroy: () => {
              doc.off('beforeTransaction', onBefore);
              doc.off('afterTransaction', onAfter);
              doc.off('afterAllTransactions', onAll);
              view.dom.removeEventListener('compositionend', onCompositionEnd);
              if (timer !== null) clearTimeout(timer);
              timer = null;
              dropRescue(view);
            },
          };
        },
      }),
    ];
  },
});
