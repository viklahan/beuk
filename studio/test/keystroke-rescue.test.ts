import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { at, cleanupPairs, posOf, rig, stubLayout, type Rig } from './caret-pair';

/* The keystroke rescue, the editor half (Agora Part 0, item 9): a letter B types into a block at the very
   moment A's change rebuilds it goes back between its words, once, and B's next letters follow it.
   Two real TipTap chapter editors (caret-pair.ts), every update delivered through applyRemoteUpdate.
   Expected strings: the spike's run-3 log (_spike-rescue-out3.log) unless marked DERIVED. */

beforeAll(stubLayout);
afterEach(cleanupPairs);

const START = ['Opening line above.', 'The brown fox jumps over the dog.'];
const toHeading = (a: Editor, prefix = 'The '): void => void a.chain().setTextSelection(at(a, prefix)).setNode('heading', { level: 2 }).run();
const split = (a: Editor): void => void a.chain().setTextSelection(at(a, 'The ')).splitBlock().run();
const joinUp = (a: Editor): void => void a.chain().setTextSelection(at(a, '')).joinBackward().run();
const shapes = (e: Editor): string => {
  const s: string[] = [];
  e.state.doc.forEach((n) => void s.push(n.type.name));
  return s.join(',');
};

/** B types "abc" (A sees it), the link is cut, A edits, B types "n" into the old block, the updates meet, B types "xyz". */
function inFlight(edit: (g: Rig) => void, how: 'own' | 'full' = 'own'): Rig {
  const g = rig(START);
  g.parkB('brown', 3);
  g.typeB('abc');
  g.cut();
  edit(g);
  g.typeB('n');
  if (how === 'own') g.aToB();
  else g.fullAToB();
  g.join();
  g.typeB('xyz');
  return g;
}

/** The marks on the text node of `ed` holding `word`. */
const marksAt = (ed: Editor, word: string): string[] => {
  let out: string[] | null = null;
  ed.state.doc.descendants((n) => {
    if (out === null && n.isText && n.text!.includes(word)) out = n.marks.map((m) => m.type.name);
  });
  if (out === null) throw new Error(`no "${word}" in the text`);
  return out;
};

describe('keystroke rescue: a letter in flight while another writer rebuilds the block', () => {
  it('join: "n" back once, the next letters follow it', () => {
    const g = inFlight((x) => joinUp(x.edA));
    expect(g.textA()).toBe('Opening line above.The broabcnxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1, carried: 3, vetoed: 0, caret: true }]); // DERIVED: the spike's vetoed "abc", carried by A's join
    expect(g.rescuesA).toEqual([]);
  });

  it('heading', () => {
    const g = inFlight((x) => toHeading(x.edA));
    expect(g.textA()).toBe('Opening line above.\nThe broabcnxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
    expect(shapes(g.edA)).toBe('paragraph,heading');
    expect(shapes(g.edB)).toBe('paragraph,heading');
    expect(g.rescuesB).toMatchObject([{ rescued: 1, carried: 3 }]); // DERIVED: as the join
  });

  it('split before B (stranded)', () => {
    const g = inFlight((x) => split(x.edA));
    expect(g.textA()).toBe('Opening line above.\nThe \nbroabcnxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
    expect(g.textA()).not.toMatch(/The n/);
    expect(g.rescuesB).toMatchObject([{ moved: 1, caret: true }]);
  });

  it('the server writer makes it a heading (S to A to B)', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.cut();
    g.typeB('n');
    g.serverHeading('The ');
    g.aToB();
    g.join();
    g.typeB('xyz');
    expect(g.textA()).toBe('Opening line above.\nThe bronxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
    expect(g.rescuesA).toMatchObject([{ carried: 33, vetoed: 0, uncounted: 0 }]); // DERIVED: A wrote the 33 letters; S's change carried them
  });

  it('the server writer re-sends the whole chapter', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.cut();
    g.typeB('n');
    g.serverRewrite(' Added.');
    g.aToB();
    g.join();
    g.typeB('xyz');
    expect(g.textA()).toBe('Opening line above. Added.\nThe bronxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
    expect(g.rescuesA).toMatchObject([{ carried: 52, vetoed: 0 }]); // DERIVED, as above: 19 + 33
  });

  it('offline catch-up as one full diff (sync step 2), heading', () => {
    const g = inFlight((x) => toHeading(x.edA), 'full');
    expect(g.textA()).toBe('Opening line above.\nThe broabcnxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
    expect(shapes(g.edA)).toBe('paragraph,heading');
  });

  it('undo after the rescue: one undo takes "n" and "xyz", "abc" stays', () => {
    const g = inFlight((x) => joinUp(x.edA));
    g.edB.commands.undo();
    expect(g.textA()).toBe('Opening line above.The broabcwn fox jumps over the dog.'); // run-3 log, "B's undo after the rescue"
    expect(g.textB()).toBe(g.textA());
  });

  it('the rescued letter takes the marks of the place', () => {
    // DERIVED (design, "The write"): "brown" bold in A before the cut; after the join the "n" between "bro" and "wn" carries strong
    const g = rig(START);
    g.edA.chain().setTextSelection({ from: posOf(g.edA, 'brown', 0), to: posOf(g.edA, 'brown', 5) }).setMark('strong').run();
    expect(marksAt(g.edB, 'brown')).toEqual(['strong']);
    g.parkB('brown', 3);
    g.cut();
    joinUp(g.edA);
    g.typeB('n');
    g.aToB();
    g.join();
    expect(g.textA()).toBe('Opening line above.The bronwn fox jumps over the dog.'); // DERIVED: the join case without "abc" and "xyz"
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
    expect(marksAt(g.edB, 'bronwn')).toEqual(['strong']);
    expect(marksAt(g.edA, 'bronwn')).toEqual(['strong']);
  });

  it('the report is in editor.storage.caretKeeper.rescue', () => {
    const fresh = rig(START);
    expect(fresh.edB.storage.caretKeeper.rescue).toBeNull();
    cleanupPairs();
    const g = inFlight((x) => joinUp(x.edA));
    expect(g.rescuesB).toHaveLength(1);
    expect(g.edB.storage.caretKeeper.rescue).toEqual(g.rescuesB[0]);
    expect(g.edB.storage.caretKeeper.rescue?.ms).toBeGreaterThanOrEqual(0);
  });
});
