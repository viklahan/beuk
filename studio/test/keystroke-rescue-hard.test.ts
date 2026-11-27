import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { at, cleanupPairs, posOf, rig, stubLayout, type Rig } from './caret-pair';

/* The keystroke rescue's hard cases (Agora Part 0, item 9): nothing is written during an IME composition (the
   rescue waits for compositionend), the cost on a long chapter, and the review-focus inputs: a throw in the
   rescue, a surrogate pair, Arabic text, two runs in one paragraph.
   Two real TipTap chapter editors (caret-pair.ts), every update delivered through applyRemoteUpdate.
   Expected strings: the spike's run-3 log (_spike-rescue-out3.log) unless marked DERIVED. */

beforeAll(stubLayout);
afterEach(cleanupPairs);

const START = ['Opening line above.', 'The brown fox jumps over the dog.'];
const toHeading = (a: Editor, prefix = 'The '): void => void a.chain().setTextSelection(at(a, prefix)).setNode('heading', { level: 2 }).run();
const joinUp = (a: Editor): void => void a.chain().setTextSelection(at(a, '')).joinBackward().run();
/** The start of the second top-level block (for text that does not start "The"). */
const secondStart = (a: Editor): number => a.state.doc.child(0).nodeSize + 1;
const wedged = (g: Rig): unknown => (g.docB as unknown as { _transaction: unknown })._transaction;

/** B types "abc" (A sees it), the link is cut, A edits, B types `letter` into the old block, the updates meet, B types "xyz". */
function inFlight(edit: (g: Rig) => void, letter = 'n'): Rig {
  const g = rig(START);
  g.parkB('brown', 3);
  g.typeB('abc');
  g.cut();
  edit(g);
  g.typeB(letter);
  g.aToB();
  g.join();
  g.typeB('xyz');
  return g;
}

describe('keystroke rescue: an IME composition', () => {
  it('IME: while B composes, nothing is written; at compositionend the letter goes back', async () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.typeB('abc');
    g.cut();
    joinUp(g.edA);
    g.typeB('n');
    let composing = true;
    Object.defineProperty(g.edB.view, 'composing', { get: () => composing, configurable: true }); // as caret-keeper.test.ts:195
    g.aToB(); // A's join delivered while composing === true
    expect(g.textB()).toBe('Opening line above.The broabcwn fox jumps over the dog.'); // DERIVED: the join with "n" not yet back
    expect(g.rescuesB).toEqual([]);
    expect(g.results.at(-1)?.outcome).toBe('composing');
    composing = false;
    g.edB.view.dom.dispatchEvent(new Event('compositionend'));
    await new Promise((r) => setTimeout(r, 0));
    expect(g.textB()).toBe('Opening line above.The broabcnwn fox jumps over the dog.'); // DERIVED: the join case without "xyz"
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
    expect(g.edB.storage.caretKeeper.rescue).toEqual(g.rescuesB[0]);
    g.join();
    expect(g.textA()).toBe(g.textB()); // DERIVED: the rescue's write is an ordinary edit, it reaches A
  });

  /** B types "abc" (A sees it), the link is cut, A edits, B types "n", A's edit reaches B while B composes. */
  const composingWhile = (edit: (g: Rig) => void, typed = true) => {
    const g = rig(START);
    g.parkB('brown', 3);
    if (typed) g.typeB('abc');
    g.cut();
    edit(g);
    g.typeB('n');
    const state = { composing: true };
    Object.defineProperty(g.edB.view, 'composing', { get: () => state.composing, configurable: true });
    g.aToB();
    const end = async () => {
      state.composing = false;
      g.edB.view.dom.dispatchEvent(new Event('compositionend'));
      await new Promise((r) => setTimeout(r, 0));
    };
    return { g, end };
  };

  it('IME, split before B (a stranded move): nothing moved while composing; at compositionend "n" goes back', async () => {
    const { g, end } = composingWhile((x) => void x.edA.chain().setTextSelection(at(x.edA, 'The ')).splitBlock().run());
    expect(g.rescuesB).toEqual([]);
    expect(g.textB()).not.toContain('broabcnwn');
    await end();
    expect(g.textB()).toBe('Opening line above.\nThe \nbroabcnwn fox jumps over the dog.'); // DERIVED: the split case without "xyz"
    expect(g.rescuesB).toMatchObject([{ moved: 1, stayed: 0 }]);
  });

  it('IME, C3: the paragraph waits too, and comes back where the deleted one stood', async () => {
    const { g, end } = composingWhile((x) => {
      let r: { from: number; to: number } | null = null;
      x.edA.state.doc.forEach((n, off, i) => {
        if (i === 1) r = { from: off, to: off + n.nodeSize };
      });
      x.edA.chain().deleteRange(r!).run();
    }, false);
    expect(g.rescuesB).toEqual([]);
    expect(g.textB()).toBe('Opening line above.');
    await end();
    expect(g.textB()).toBe('Opening line above.\nn'); // DERIVED: the C3 ruling, as keystroke-rescue-controls.test.ts
    expect(g.rescuesB).toMatchObject([{ restored: 1, unplaced: 0 }]);
    g.join();
    expect(g.textA()).toBe(g.textB());
  });

  it('the composition ends without compositionend: the next local keystroke\'s update flushes on the next turn, never inside it', async () => {
    const { g } = composingWhile((x) => joinUp(x.edA));
    expect(g.rescuesB).toEqual([]);
    Object.defineProperty(g.edB.view, 'composing', { get: () => false, configurable: true }); // no compositionend event
    g.edB.view.dispatch(g.edB.state.tr.insertText('Z', posOf(g.edB, 'dog.', 4))); // one local keystroke in B
    expect(g.textB()).toBe('Opening line above.The broabcwn fox jumps over the dog.Z'); // DERIVED: deferred, "n" not back yet
    expect(g.rescuesB).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(g.textB()).toBe('Opening line above.The broabcnwn fox jumps over the dog.Z'); // DERIVED: the join case without "xyz", plus "Z"
    expect(g.rescuesB).toHaveLength(1);
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
    g.join();
    expect(g.textA()).toBe(g.textB());
  });

  it('three plans wait and the middle one throws at its write: the first and third are written and reported, the middle told unplaced', async () => {
    const FOUR = ['Opening line above.', 'The brown fox jumps over the dog.', 'A second paragraph here.', 'Last words of the chapter.'];
    const heading = (a: Editor, word: string): void => void a.chain().setTextSelection(posOf(a, word, 0)).setNode('heading', { level: 2 }).run();
    const g = rig(FOUR);
    g.cut();
    g.parkB('brown', 3);
    g.typeB('n');
    g.parkB('second', 3);
    g.typeB('p');
    g.parkB('chapter', 3);
    g.typeB('q');
    heading(g.edA, 'brown'); // three changes from A, three plans in B
    heading(g.edA, 'second');
    heading(g.edA, 'chapter');
    let composing = true;
    Object.defineProperty(g.edB.view, 'composing', { get: () => composing, configurable: true });
    g.aToB();
    expect(g.rescuesB).toEqual([]);
    const view = g.edB.view;
    const pass = view.dispatch;
    let calls = 0;
    view.dispatch = (tr) => {
      if (++calls === 2) throw new Error('the second write fails'); // before the editor takes it
      pass(tr);
    };
    composing = false;
    view.dom.dispatchEvent(new Event('compositionend'));
    await new Promise((r) => setTimeout(r, 0));
    view.dispatch = pass;
    expect(calls).toBe(3);
    expect(g.textB()).toBe('Opening line above.\nThe bronwn fox jumps over the dog.\nA second paragraph here.\nLast words of the chaqpter.'); // DERIVED: plans 1 and 3 written, 2 not
    expect(g.rescuesB).toMatchObject([
      { rescued: 1, unplaced: 0 },
      { rescued: 0, unplaced: 1 },
      { rescued: 1, unplaced: 0 },
    ]);
    g.join();
    expect(g.textA()).toBe(g.textB());
  });

  it('destroyed while a plan waits: every compositionend listener removed, the pending timer cleared, nothing reported', async () => {
    // record the compositionend listeners added to and removed from any element while the pair is made
    const added: { el: EventTarget; fn: unknown }[] = [];
    const removed: { el: EventTarget; fn: unknown }[] = [];
    const proto = EventTarget.prototype;
    const add = proto.addEventListener;
    const remove = proto.removeEventListener;
    proto.addEventListener = function (this: EventTarget, type: string, fn: never, o?: never) {
      if (type === 'compositionend') added.push({ el: this, fn });
      return add.call(this, type, fn, o);
    };
    proto.removeEventListener = function (this: EventTarget, type: string, fn: never, o?: never) {
      if (type === 'compositionend') removed.push({ el: this, fn });
      return remove.call(this, type, fn, o);
    };
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const { g } = composingWhile((x) => joinUp(x.edA));
      const dom = g.edB.view.dom;
      const mine = added.filter((a) => a.el === dom);
      expect(mine.length).toBeGreaterThan(0);
      Object.defineProperty(g.edB.view, 'composing', { get: () => false, configurable: true });
      const set = vi.spyOn(globalThis, 'setTimeout');
      dom.dispatchEvent(new Event('compositionend')); // the flush is now due on the next turn
      const due = set.mock.results.map((r) => r.value);
      set.mockRestore();
      expect(due).toHaveLength(1);
      const storage = g.edB.storage.caretKeeper; // the editor drops its storage on destroy
      clear.mockClear();
      g.edB.destroy();
      expect(clear.mock.calls.map((c) => c[0])).toContain(due[0]);
      for (const a of mine) expect(removed.some((r) => r.el === dom && r.fn === a.fn)).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(g.rescuesB).toEqual([]);
      expect(storage.rescue).toBeNull();
    } finally {
      proto.addEventListener = add;
      proto.removeEventListener = remove;
      clear.mockRestore();
    }
  });
});

describe('keystroke rescue: the cost', () => {
  // the spike's paragraphs (_spike-rescue.test.ts:618-619): 401 blocks, the caret in the first
  const lorem = (i: number) => `Paragraph ${i} lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua; ut enim ad minim veniam.`;
  const paras = ['The brown fox jumps over the dog.', ...Array.from({ length: 400 }, (_, i) => lorem(i))];

  it('cost: 200 remote keystrokes 400 paragraphs away: no rescue report', () => {
    const g = rig(paras);
    g.parkB('brown', 3);
    g.edA.commands.setTextSelection(g.edA.state.doc.content.size - 1);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) g.edA.commands.insertContent('x');
    const keys = performance.now() - t0;
    console.log(`[rescue-hard] cost: ${g.textA().length} chars; 200 remote keystrokes in ${keys.toFixed(1)} ms with ${g.rescuesB.length} rescue report(s) in B`);
    expect(g.rescuesB).toHaveLength(0);
  });

  it('cost: one whole-chapter rewrite with "n" in flight: "bronwn", one report each side, both ms printed', () => {
    const g = rig(paras);
    g.parkB('brown', 3);
    g.cut();
    g.typeB('n');
    g.serverRewrite(' Added.');
    const t1 = performance.now();
    g.aToB();
    const apply = performance.now() - t1;
    g.join();
    console.log(
      `[rescue-hard] cost: ${g.textA().length} chars; rewrite apply in B ${apply.toFixed(2)} ms; rescue in B ${g.rescuesB.at(-1)?.ms.toFixed(2)} ms ${JSON.stringify(g.rescuesB.at(-1))}; rescue in A ${g.rescuesA.at(-1)?.ms.toFixed(2)} ms ${JSON.stringify(g.rescuesA.at(-1))}`,
    );
    expect(g.textA()).toContain('bronwn');
    expect(g.textA()).toBe(g.textB());
    expect(g.rescuesB).toHaveLength(1);
    expect(g.rescuesA).toHaveLength(1);
    expect(g.rescuesB.at(-1)).toMatchObject({ rescued: 1 });
    expect(g.rescuesA.at(-1)).toMatchObject({ vetoed: 0 }); // DERIVED: A's own letters, carried by S's rewrite
  });
});

describe('keystroke rescue: the review-focus inputs', () => {
  it('a throw in the rescue (here: the onRescueResult callback): no throw into Yjs, the doc not wedged, the keeper still reported', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.cut();
    joinUp(g.edA);
    g.typeB('n');
    let threw = 0;
    g.rescuesB.push = () => {
      delete (g.rescuesB as { push?: unknown }).push; // once: the array's own push again
      threw++;
      throw new Error('onRescueResult fails');
    };
    const kept = g.results.length;
    expect(() => g.aToB()).not.toThrow();
    expect(threw).toBe(1);
    expect(wedged(g)).toBeNull();
    expect(g.results).toHaveLength(kept + 1); // the keeper reported for the join
    expect(g.textB()).toBe('Opening line above.The bronwn fox jumps over the dog.'); // DERIVED: the write came before the callback
    g.join();
    expect(g.textA()).toBe(g.textB());
    // a later in-flight heading is still rescued
    g.parkB('jumps', 2);
    g.cut();
    g.typeB('q');
    g.edA.chain().setTextSelection(posOf(g.edA, 'Opening', 0)).setNode('heading', { level: 2 }).run();
    g.aToB();
    g.join();
    expect(wedged(g)).toBeNull();
    expect(g.textA()).toBe('Opening line above.The bronwn fox juqmps over the dog.'); // DERIVED: "q" back between "ju" and "mps"
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
  });

  it('a surrogate pair: "😀" typed in flight goes back whole and counts as one letter', () => {
    const g = inFlight((x) => joinUp(x.edA), '😀');
    expect(g.textA()).toBe('Opening line above.The broabc😀xyzwn fox jumps over the dog.'); // DERIVED: the join string
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
  });

  it('Arabic: the letter goes back between its words in logical order', () => {
    // DERIVED: the join case with Arabic text; Yjs and ProseMirror hold the text in logical order
    const g = rig(['سطر في الأعلى.', 'الثعلب البني يقفز فوق الكلب.']);
    g.parkB('الثعلب البني', 9); // after 'الثعلب ال'
    g.cut();
    g.edA.chain().setTextSelection(secondStart(g.edA)).joinBackward().run();
    g.typeB('ن');
    g.aToB();
    g.join();
    expect(g.textA()).toBe('سطر في الأعلى.الثعلب النبني يقفز فوق الكلب.'); // DERIVED: the letter right after 'الثعلب ال'
    expect(g.textA()).toContain('الثعلب ال' + 'ن');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
  });

  it('two runs: "n" after "bro" and "q" after "jumps" typed in flight, A makes a heading: each back between its own words', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.cut();
    g.typeB('n');
    g.parkB('jumps', 5);
    g.typeB('q');
    toHeading(g.edA);
    g.aToB();
    g.join();
    expect(g.textA()).toBe('Opening line above.\nThe bronwn fox jumpsq over the dog.'); // DERIVED
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 2, caret: true }]); // DERIVED: the caret's note is on "q"
  });
});
