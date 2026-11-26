import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { yUndoPluginKey, ySyncPluginKey } from '@tiptap/y-tiptap';
import { positionMigrationStore } from '../src/editor/positionMigrations';
import { at, blockWith, bytesWithoutKeeper, cleanupPairs, listeners, pair, posOf, stubLayout, type Pair } from './caret-pair';

/* The caret keeper (Agora part 0A, task 3): writer B parks the caret at "bro|wn"; writer A changes the
   book; B's caret must still be at "bro|wn" (B types "#": "bro#wn"), A must see it there, and the
   keeper must have written nothing into the book. The cases are the spike's (tools/agora-spike/diag6.mjs),
   with Beuk's mark and node names (strong; heading, its level attribute). */

beforeAll(stubLayout);
afterEach(cleanupPairs);

const START = ['Opening line above.', 'The brown fox jumps over the dog.'];

const firstBlock = (a: Editor): { from: number; to: number } => {
  let r: { from: number; to: number } | null = null;
  a.state.doc.forEach((n, off, i) => {
    if (i === 0) r = { from: off, to: off + n.nodeSize };
  });
  return r!;
};

const CASES: [string, (a: Editor) => void][] = [
  ['type a word earlier in the paragraph', (a) => a.chain().setTextSelection(at(a, 'The ')).insertContent('quick ').run()],
  ['split before B', (a) => a.chain().setTextSelection(at(a, 'The ')).splitBlock().run()],
  ['split after B', (a) => a.chain().setTextSelection(at(a, 'The brown fox ')).splitBlock().run()],
  ['bold a word earlier', (a) => a.chain().setTextSelection({ from: at(a, ''), to: at(a, 'The') }).toggleMark('strong').run()],
  ["bold B's word", (a) => a.chain().setTextSelection({ from: at(a, 'The '), to: at(a, 'The brown') }).toggleMark('strong').run()],
  ['paragraph → heading', (a) => a.chain().setTextSelection(at(a, 'The ')).setNode('heading', { level: 2 }).run()],
  ['join with the paragraph above', (a) => a.chain().setTextSelection(at(a, '')).joinBackward().run()],
  ['delete the paragraph above', (a) => a.chain().deleteRange(firstBlock(a)).run()],
];

/** Where B's caret should be drawn in A: the block that now holds "brown" (it follows the edit), at "bro|wn". */
const broWnIn = (w: Pair): string | null => blockWith(w.edA, 'brown')?.replace('brown', 'bro|wn') ?? null;

describe('the caret keeper: another writer changes the paragraph B is in', () => {
  it.each(CASES)('%s: B types "#" at "bro|wn"', (_n, edit) => {
    const w = pair(START);
    w.parkB('brown', 3);
    edit(w.edA);
    const bytes = Y.encodeStateAsUpdate(w.docB); // before B types: the keeper has written nothing
    expect(bytes).toEqual(bytesWithoutKeeper(START, (v) => { v.parkB('brown', 3); edit(v.edA); }));
    expect(w.remoteCaretInA()).toBe(broWnIn(w));
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });

  it("Beuk's own Enter before B (a newline; the block splits when A's caret leaves): B keeps bro|wn", () => {
    const w = pair(START);
    w.parkB('brown', 3);
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).run();
    w.edA.commands.keyboardShortcut('Enter');
    w.edA.commands.keyboardShortcut('Enter');
    w.edA.commands.setTextSelection(posOf(w.edA, 'Opening', 2)); // A's caret leaves: the blank line splits the block
    expect(w.edA.state.doc.childCount).toBe(3);
    expect(w.remoteCaretInA()).toBe(broWnIn(w));
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });

  it('a real deletion around B: outcome lost, no throw, the "#" lands where it lands without the keeper', () => {
    const del = (a: Editor) => a.chain().deleteRange({ from: at(a, 'The '), to: at(a, 'The brown fox ') }).run();
    const ref = pair(START, { keeper: false });
    ref.parkB('brown', 3);
    del(ref.edA);
    ref.typeB('#');
    const w = pair(START);
    w.parkB('brown', 3);
    del(w.edA);
    expect(w.results.at(-1)?.outcome).toBe('lost');
    expect(w.keeperDispatches).toHaveLength(0);
    w.typeB('#');
    expect(w.textA()).toBe(ref.textA());
  });

  it('local typing in B produces no keeper result (own transactions are ignored)', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    const n = w.results.length;
    w.typeB('xyz');
    expect(w.results.length).toBe(n);
    expect(w.textA()).toContain('broxyzwn');
  });

  it("B's own undo after the migration hold engaged (undo inside the hold's outer transaction): no keeper result", () => {
    const w = pair(START);
    const store = positionMigrationStore(w.fragB)!;
    const held = store.set.bind(store);
    let tried = 0;
    store.set = ((k: string, v: unknown) => { tried++; return held(k, v); }) as typeof store.set;
    w.parkB('brown', 3);
    w.edB.chain().setNode('heading', { level: 2 }).run(); // a block rewrite: y-tiptap tries to write a record
    expect(tried).toBeGreaterThan(0); // so held.written: B's undo now runs in an outer transaction, origin the UndoManager
    expect(store.size).toBe(0);
    (yUndoPluginKey.getState(w.edB.state) as { undoManager: Y.UndoManager }).undoManager.stopCapturing();
    const n = w.results.length;
    w.edB.commands.undo();
    expect(w.edB.state.doc.child(1).type.name).toBe('paragraph');
    expect(w.results.length).toBe(n);
    expect(w.keeperDispatches).toHaveLength(0);
  });

  it("A's undo of a heading (A's own UndoManager, remote to B): B keeps bro|wn", () => {
    const w = pair(START);
    w.parkB('brown', 3);
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run();
    (yUndoPluginKey.getState(w.edA.state) as { undoManager: Y.UndoManager }).undoManager.stopCapturing();
    w.edA.commands.undo();
    expect(w.edA.state.doc.child(1).type.name).toBe('paragraph');
    expect(w.remoteCaretInA()).toBe('The bro|wn fox jumps over the dog.');
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });

  it('IME: while B\'s view is composing, a heading conversion records "composing" and dispatches nothing', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    Object.defineProperty(w.edB.view, 'composing', { get: () => true, configurable: true });
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run();
    expect(w.results.at(-1)?.outcome).toBe('composing');
    expect(w.keeperDispatches).toHaveLength(0);
  });

  it("empty paragraph turned into a heading: B's caret stays in that block", () => {
    const w = pair(START);
    w.edA.chain().setTextSelection(posOf(w.edA, 'above.', 6)).splitBlock().run(); // an empty paragraph after the first
    expect(w.edB.state.doc.child(1).content.size).toBe(0);
    const inEmpty = w.edB.state.doc.child(0).nodeSize + 1;
    w.selectB(inEmpty);
    w.edA.chain().setTextSelection(w.edA.state.doc.child(0).nodeSize + 1).setNode('heading', { level: 2 }).run();
    expect(w.edB.state.doc.child(1).type.name).toBe('heading');
    const $h = w.edB.state.selection.$head;
    expect($h.index(0)).toBe(1);
    expect($h.parent.type.name).toBe('heading');
    w.typeB('#');
    expect(w.textA().split('\n')).toEqual(['Opening line above.', '#', 'The brown fox jumps over the dog.']);
  });

  it('B at the very start of a paragraph A joins with the one above: B ends at the join point', () => {
    const w = pair(START);
    w.parkB('The', 0);
    w.edA.chain().setTextSelection(at(w.edA, '')).joinBackward().run();
    w.typeB('#');
    expect(w.textA()).toContain('above.#The brown');
  });

  it('range selection, head inside a rebuilt paragraph: anchor and head both kept', () => {
    const w = pair(START);
    w.selectB(posOf(w.edB, 'Opening', 3), posOf(w.edB, 'brown', 3));
    const selected = () => w.edB.state.doc.textBetween(w.edB.state.selection.from, w.edB.state.selection.to, '\n');
    const was = selected();
    expect(was).toBe('ning line above.\nThe bro');
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run();
    expect(w.edB.state.doc.child(1).type.name).toBe('heading');
    expect(selected()).toBe(was);
    expect(w.edB.state.selection.anchor).toBeLessThan(w.edB.state.selection.head);
    expect(w.remoteCaretInA()).toBe('The bro|wn fox jumps over the dog.');
  });

  it('section deleted / editor destroyed under a change: no throw, no dispatch, and destroy removes both doc listeners', () => {
    // the section B is editing is deleted by A
    const w = pair(START);
    w.parkB('brown', 3);
    expect(() => w.docA.getArray('sections').delete(0, 1)).not.toThrow();
    expect(w.keeperDispatches).toHaveLength(0);
    expect(w.results.at(-1)?.outcome).toBe('none');
    w.edB.destroy();
    expect(listeners(w.docB)).toEqual(w.listenersBeforeB);

    // B's editor is destroyed while a change from A is being applied (an earlier afterTransaction listener)
    let armed = false;
    let v: Pair | null = null;
    v = pair(START, { onDocB: (docB) => docB.on('afterTransaction', () => { if (armed && v && !v.edB.isDestroyed) v.edB.destroy(); }) });
    v.parkB('brown', 3);
    armed = true;
    expect(() => v!.edA.chain().setTextSelection(at(v!.edA, 'The ')).setNode('heading', { level: 2 }).run()).not.toThrow();
    expect(v.edB.isDestroyed).toBe(true);
    expect(v.keeperDispatches).toHaveLength(0);
    expect(v.results.at(-1)?.outcome).toBe('none');
    // the hook's own listener stays; the editor's are gone
    expect(listeners(v.docB)).toEqual(v.listenersBeforeB);
  });

  it("the note step throws: no throw into Yjs, the doc is not wedged (a later remote change lands, B's typing still sends)", () => {
    const w = pair(START);
    w.parkB('brown', 3);
    // once: the first resolve on B's current doc is the keeper's note, in docB's beforeTransaction
    const old = w.edB.state.doc as unknown as { resolve?: (p: number) => unknown };
    let threw = 0;
    old.resolve = () => {
      delete old.resolve;
      threw++;
      throw new Error('the note fails');
    };
    expect(() => w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run()).not.toThrow();
    expect(threw).toBe(1);
    expect(w.results).toHaveLength(0); // no note held: nothing kept for that change
    expect((w.docB as unknown as { _transaction: unknown })._transaction).toBeNull();
    expect(w.edB.state.doc.child(1).type.name).toBe('heading');
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).insertContent('quick ').run();
    expect(w.fragB.toString()).toContain('The quick brown');
    expect(w.edB.state.doc.child(1).textContent).toBe('The quick brown fox jumps over the dog.');
    let sent = 0;
    w.docB.on('update', (_u: Uint8Array, origin: unknown) => { if (origin === ySyncPluginKey) sent++; });
    w.typeB('#');
    expect(sent).toBeGreaterThan(0);
    expect(w.textA()).toContain('#');
  });

  it('the after step throws (here: the onResult callback): no throw into Yjs, and later changes are kept as usual', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    const push = w.results.push.bind(w.results);
    w.results.push = () => {
      w.results.push = push;
      throw new Error('onResult fails');
    };
    expect(() => w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run()).not.toThrow();
    expect((w.docB as unknown as { _transaction: unknown })._transaction).toBeNull();
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).insertContent('quick ').run();
    expect(w.edB.state.doc.child(1).textContent).toBe('The quick brown fox jumps over the dog.');
    expect(w.results.at(-1)?.outcome).toBe('alive');
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });

  it('a remote change elsewhere in the book (another chapter, the meta) produces no result', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    const storage = () => (w.edB.storage as unknown as { caretKeeper: { last: unknown } }).caretKeeper.last;
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run();
    expect(w.results).toHaveLength(1);
    const last = storage();
    // another chapter: a second section with its own body, then a write to that body
    const sec2 = new Y.Map<unknown>();
    w.docA.getArray<Y.Map<unknown>>('sections').push([sec2]);
    const other = new Y.XmlFragment();
    sec2.set('body', other);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Another chapter.')]);
    other.insert(0, [p]);
    (p.get(0) as Y.XmlText).insert(0, 'In ');
    w.docA.getMap('meta').set('title', 'A book');
    expect(w.docB.getArray<Y.Map<unknown>>('sections').get(1).get('body')!.toString()).toContain('In Another chapter.');
    expect(w.docB.getMap('meta').get('title')).toBe('A book');
    expect(w.results).toHaveLength(1);
    expect(storage()).toBe(last);
    // a change in B's own chapter still reports
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).insertContent('quick ').run();
    expect(w.results).toHaveLength(2);
    expect(storage()).toBe(w.results[1]);
  });

  it('the result lands in editor.storage.caretKeeper.last', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    w.edA.chain().setTextSelection(at(w.edA, 'The ')).setNode('heading', { level: 2 }).run();
    const last = (w.edB.storage as unknown as { caretKeeper: { last: unknown } }).caretKeeper.last;
    expect(last).toEqual(w.results.at(-1));
    expect(w.results.at(-1)).toMatchObject({ outcome: 'found', moved: true });
    expect(w.keeperDispatches).toHaveLength(1); // the dispatch filter can see a keeper dispatch: the "no dispatch" checks elsewhere can fail
    expect(w.results.at(-1)!.searched).toBeGreaterThan(0);
  });
});
