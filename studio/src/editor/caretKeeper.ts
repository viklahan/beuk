import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { onlyPositionMigrations } from './positionMigrations';

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

export const CTX = 24; // letters of context kept on each side of the caret
export const OBJ = '\uFFFC'; // an inline non-text node, so offsets match Yjs text indexes

const commonSuffix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

// Every offset in `s` where the caret's words stand again, ascending. `pre` is the text before the
// caret, `post` the text after (each at most CTX letters). Both sides must match in full, or one side
// in full and not empty while the other matches only up to an edge of `s`: the block now begins (or
// ends) right at the caret, which is a split or a join, not a change of words. A side that is empty,
// or that matches only up to an edge, never carries a hit alone: one letter at an edge of the written
// text is not the caret's words. An empty block matches only a caret that stood in an empty block.
export function findInText(s: string, pre: string, post: string): number[] {
  // A hit has the full pre and post (so pre+post occurs there), or its pre match reaches the start of
  // s (so i <= CTX), or its post match reaches the end of s (so i >= s.length - CTX). These three
  // sets cover every hit, so the search never scans every offset.
  const cand = new Set<number>();
  const both = pre + post;
  if (both) for (let at = s.indexOf(both); at >= 0; at = s.indexOf(both, at + 1)) cand.add(at + pre.length);
  for (let i = 0; i <= Math.min(CTX, s.length); i++) cand.add(i);
  for (let i = Math.max(0, s.length - CTX); i <= s.length; i++) cand.add(i);

  const hits: number[] = [];
  for (const i of [...cand].sort((a, b) => a - b)) {
    const l = commonSuffix(pre, s.slice(Math.max(0, i - CTX), i));
    const r = commonPrefix(post, s.slice(i, i + CTX));
    const preFull = l === pre.length;
    const postFull = r === post.length;
    const preToStart = l === i; // the pre match runs up to the start of s
    const postToEnd = r === s.length - i; // the post match runs up to the end of s
    const ok = (preFull && postFull) || (preFull && pre.length > 0 && postToEnd) || (postFull && post.length > 0 && preToStart);
    if (!ok) continue;
    if (l + r === 0 && !(s.length === 0 && pre === '' && post === '')) continue;
    hits.push(i);
  }
  return hits;
}

// Of several equal matches, the one nearest where the caret was; on a tie the smaller. Null when none.
export function nearestOf(positions: number[], was: number): number | null {
  let best: number | null = null;
  for (const p of positions) {
    if (best === null) best = p;
    else {
      const d = Math.abs(p - was), bd = Math.abs(best - was);
      if (d < bd || (d === bd && p < best)) best = p;
    }
  }
  return best;
}

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

export type CaretKeeperOptions = { fragment: Y.XmlFragment; onResult?: (r: KeeperResult) => void };
export type CaretKeeperStorage = { last: KeeperResult | null };

declare module '@tiptap/core' {
  interface Storage {
    caretKeeper: CaretKeeperStorage;
  }
}

/** One end of the selection, noted before a remote change: the Yjs position and the words either side. */
type CaretNote = { abs: number; rel: Y.RelativePosition; pre: string; post: string };

const textOf = (t: Y.XmlText): string => t.toDelta().map((o: { insert: unknown }) => (typeof o.insert === 'string' ? o.insert : OBJ)).join('');

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

/** `t` is `frag` or lies inside it. */
const inside = (frag: Y.XmlFragment, t: Y.AbstractType<any>): boolean => t === frag || (t._item !== null && Y.isParentOf(frag, t._item));

/** `tr` changed something in `frag` (a change elsewhere in the book cannot move this editor's caret). */
const touches = (tr: Y.Transaction, frag: Y.XmlFragment): boolean => {
  for (const t of tr.changed.keys()) if (inside(frag, t)) return true;
  return false;
};

/** What `tr` wrote inside `frag`: the XmlTexts it changed, plus every XmlText inside a block it created (an
 *  item is new when its clock is at or past the transaction's state vector for its client); and the empty
 *  blocks it created. An empty block holds no XmlText in Yjs (y-tiptap writes none), so it is searched as
 *  the empty text "": the empty-block rule of findInText. */
function written(tr: Y.Transaction, frag: Y.XmlFragment): { texts: Y.XmlText[]; empties: Y.XmlElement[] } {
  const texts = new Set<Y.XmlText>();
  const empties = new Set<Y.XmlElement>();
  const isNew = (it: Y.Item) => it.id.clock >= (tr.beforeState.get(it.id.client) ?? 0);
  const add = (c: Y.AbstractType<any>) => {
    if (c instanceof Y.XmlText) texts.add(c);
    else if (c instanceof Y.XmlElement) {
      if (c.length === 0) empties.add(c);
      else all(c);
    }
  };
  const all = (t: Y.XmlFragment | Y.XmlElement) => {
    for (let it = t._start; it; it = it.right) {
      if (!it.deleted && it.content instanceof Y.ContentType) add(it.content.type);
    }
  };
  tr.changed.forEach((_k, t) => {
    if (!inside(frag, t) || t._item?.deleted) return;
    if (t instanceof Y.XmlText) {
      texts.add(t);
      return;
    }
    if (!(t instanceof Y.XmlFragment || t instanceof Y.XmlElement)) return;
    for (let it = t._start; it; it = it.right) {
      if (!it.deleted && isNew(it) && it.content instanceof Y.ContentType) add(it.content.type);
    }
  });
  return { texts: [...texts], empties: [...empties] };
}

/** The XmlTexts `tr` changed inside `frag`, plus every XmlText inside a block it created. */
export function writtenTexts(tr: Y.Transaction, frag: Y.XmlFragment): Y.XmlText[] {
  return written(tr, frag).texts;
}

/** This editor's own change: its binding's write, or its UndoManager's undo / redo (also when the migration
 *  hold runs that inside an outer transaction: that transaction's origin is the manager, and it is local). */
const own = (tr: Y.Transaction): boolean => tr.origin === ySyncPluginKey || (tr.origin instanceof Y.UndoManager && tr.local);

export const CaretKeeper = Extension.create<CaretKeeperOptions, CaretKeeperStorage>({
  name: 'caretKeeper',
  addOptions: () => ({ fragment: null as unknown as Y.XmlFragment, onResult: undefined }),
  addStorage: () => ({ last: null }),
  addProseMirrorPlugins() {
    const frag = this.options.fragment;
    const onResult = this.options.onResult;
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
            destroy: () => {
              doc.off('beforeTransaction', onBefore);
              doc.off('afterTransaction', onAfter);
              doc.off('afterAllTransactions', onAll);
            },
          };
        },
      }),
    ];
  },
});
