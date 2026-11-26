import type { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';

/* WHY THIS STAYS, AND WHY THE STUDIO STAYS ON y-tiptap 3.0.10 (Agora part 0A, task 1, 2026-11-26; measured in
   .superpowers/sdd/2026-11-26-agora-part-0a-caret/ytiptap-bisect-report.md).
   y-tiptap 3.1.0 and later write no position-migration records and clear old "__tiptap_position_migrations:" maps
   themselves (clearPositionMigrations; tiptap PR #8694). But on every version from 3.1.0 through 3.3.1, one undo of
   a toolbar edit leaves the wrong text: test/insert.test.ts has 4 reds (14 tests, 10 pass), for example
   "**strong word** here[^1].s" where "**strong words** here[^1]." was written. The cause is Yjs 13.6.33's
   UndoManager misplacing a character (https://github.com/yjs/yjs/issues/823, also #811 (inferred) and #806
   (inferred) as the same family; the fix PR https://github.com/yjs/yjs/pull/810 is unmerged), shown in plain
   Yjs without y-tiptap. y-tiptap up to 3.0.12 hid it: its syncPositionText rewrote the edited paragraph with
   fresh items, and 3.1.0 removed that rewrite. 3.0.11 and 3.0.12 are no way out: with this hold they give 4
   undo-caret reds. Of the versions tested (3.0.10–3.3.1), 3.0.10 is the only one green on insert, undo-storm,
   undo-caret and dedupe. So the studio stays on 3.0.10, which DOES write records, and this hold keeps them out
   of the book.
   THE UPGRADE GATE: a candidate y-tiptap is taken only when test/insert.test.ts, test/undo-storm.test.ts,
   test/undo-caret.test.ts, the caret-keeper*.test.ts suites and `E2E_ONLY=caret node e2e/book.mjs` are green
   on it, before merge — E2E_ONLY=caret green except the one documented known red ("typing through a split then
   join", docs/ENGINEERING.md), which stays red until the keystroke rescue lands. Watch yjs#810.

   Undo storms (studio-2 cutover, task 5): y-tiptap 3's "position migrations".

   THE GROWTH. Every edit y-tiptap cannot write as a plain text change (a
   toolbar action's block rewrite, a normalised block, an Enter that splits)
   makes its binding write a migration record into a Y.Map that lives IN THE
   BOOK'S Y.Doc ("__tiptap_position_migrations:<fragment>"; y-tiptap
   writePositionMigration, store.set). Once that map holds anything, every
   undo and redo (restorePositionHistory → restoreTransfers) walks every
   record and every redone struct of the document, and writes ANOTHER record
   re-listing every dead→live character it found: quadratic, persisted
   (IndexedDB), relayed to the other tabs. Measured (test/undo-storm.test.ts,
   2,000 words, toolbar edit + undo + redo): 240 records / 128,716 transfers
   after 80 cycles, undo 7.8 → 788 ms. Keeping only the newest record does not
   help (fix round 1: 139 → 787 ms over 120 cycles): the re-listing itself
   grows with the history. So the map is kept EMPTY: y-tiptap's writes to it
   are dropped, records an older build left are cleared on open, and records
   another tab's older build writes are cleared as they land.

   THE CARET (fix round 1, review I-1). y-tiptap restores the caret after an
   undo / redo from the selection the stack item saved, which reaches the
   binding in UndoManager's 'stack-item-popped'. While the map holds records
   y-tiptap runs the undo inside one outer transaction (restorePositionHistory),
   so that event fires BEFORE the transaction's observers render the change
   and restore the selection; with an empty map it calls manager.undo() bare,
   the event comes after the render, and the caret is restored from the
   previous step's selection (the start of the next paragraph).
   wrapUndoInTransaction puts back y-tiptap's own outer transaction, less
   restoreTransfers — and only once the binding has tried to write a record,
   exactly when y-tiptap itself would take that path (before that, as in
   y-tiptap, the bare call: a redo of plain typing lands differently on the
   two paths). test/undo-caret.test.ts checks the caret against the editor
   without any of this.

   Beuk does not use anything else the records serve (a remote collaborator's
   caret or a stored relative position inside a block y-tiptap re-created).
   The records are not needed for the writer's own caret: the caret keeper
   (caretKeeper.ts, added later in this branch) keeps it when others' changes
   rebuild a block.

   y-tiptap's key (getPositionMigrationStore, not exported): "item:<client>:<clock>"
   for a fragment inside a section's Y.Map, "root:<name>" for a root fragment. */

export const MIGRATIONS = '__tiptap_position_migrations:';
/** The origin of the clears below (cloud.ts: not a writer's edit). */
export const MIGRATIONS_CLEAR_ORIGIN = Symbol('beuk-position-migrations');

/** The migration map y-tiptap's binding uses for `fragment` (y-tiptap getPositionMigrationStore). */
export function positionMigrationStore(fragment: Y.XmlFragment): Y.Map<unknown> | null {
  const doc = fragment.doc;
  if (!doc) return null;
  const item = fragment._item;
  return doc.getMap(MIGRATIONS + (item ? `item:${item.id.client}:${item.id.clock}` : `root:${Y.findRootTypeKey(fragment)}`));
}

/** Every migration map in `doc`, whatever fragment it was for. */
export function migrationMaps(doc: Y.Doc): Y.Map<unknown>[] {
  return [...doc.share.keys()].filter((k) => k.startsWith(MIGRATIONS)).map((k) => doc.getMap(k));
}

/** True when `tr` changed nothing but migration maps (the clears below, here or relayed from another tab). */
export function onlyPositionMigrations(tr: Y.Transaction): boolean {
  if (tr.origin === MIGRATIONS_CLEAR_ORIGIN) return true;
  if (tr.changed.size === 0) return false;
  for (const t of tr.changed.keys()) {
    if (t._item !== null || !(t instanceof Y.Map) || !Y.findRootTypeKey(t).startsWith(MIGRATIONS)) return false;
  }
  return true;
}

const clearMap = (m: Y.Map<unknown>) => {
  if (m.size === 0 || !m.doc) return;
  m.doc.transact(() => {
    for (const k of [...m.keys()]) m.delete(k);
  }, MIGRATIONS_CLEAR_ORIGIN);
};

/** Per migration map: y-tiptap has tried to write a record into it (or one was there) in this session — from then
 *  on y-tiptap's own undo would take its outer-transaction path, for every editor on that fragment. */
const writtenTo = new WeakSet<Y.Map<unknown>>();

export type Held = { readonly written: boolean; release: () => void };

/** Keep `fragment`'s migration map empty while its editor lives, and clear what any other fragment's left behind (a
 *  section a move re-created; cleared when a chapter opens, not while one is open: nothing writes to those). The
 *  no-op `set` stays on the map for the Y.Doc's life (harmless: y-tiptap is its only writer, and two editors on one
 *  fragment during a remount would otherwise undo each other's patch); release removes the observer. */
export function holdPositionMigrations(fragment: Y.XmlFragment): Held {
  const doc = fragment.doc;
  const store = positionMigrationStore(fragment);
  if (!doc || !store) return { written: false, release: () => undefined };
  if (store.size > 0) writtenTo.add(store);
  // y-tiptap writes its records with store.set only (writePositionMigration): this map takes none
  (store as unknown as { set: (k: string, v: unknown) => unknown }).set = (_k, v) => {
    writtenTo.add(store);
    return v;
  };
  for (const m of migrationMaps(doc)) clearMap(m);
  const onChange = (_e: Y.YMapEvent<unknown>, tr: Y.Transaction) => {
    if (tr.origin === MIGRATIONS_CLEAR_ORIGIN) return;
    writtenTo.add(store);
    clearMap(store);
  };
  store.observe(onChange);
  return {
    get written() {
      return writtenTo.has(store);
    },
    release: () => store.unobserve(onChange),
  };
}

/** y-tiptap's restorePositionHistory, less restoreTransfers: once `held.written`, the UndoManager's undo / redo run
 *  inside one outer transaction (origin the manager, its undoing / redoing flag held to the end), so 'stack-item-popped'
 *  hands the binding the saved selection before the change is rendered. Before that, the bare call (as y-tiptap). */
export function wrapUndoInTransaction(editor: Editor, held: Held): void {
  const um = (yUndoPluginKey.getState(editor.state) as { undoManager?: Y.UndoManager } | undefined)?.undoManager;
  if (!um) return;
  for (const [action, flag] of [['undo', 'undoing'], ['redo', 'redoing']] as const) {
    const own = um[action].bind(um);
    um[action] = () => {
      if (!held.written) return own();
      let result: ReturnType<typeof own> = null;
      try {
        um.doc.transact(() => {
          result = own();
          um[flag] = true;
        }, um);
      } finally {
        um[flag] = false;
      }
      return result;
    };
  }
}
