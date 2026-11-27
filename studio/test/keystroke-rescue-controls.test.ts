import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { at, cleanupPairs, cloneEl, posOf, rig, stubLayout } from './caret-pair';
import { applyRemoteUpdate, lettersLost } from '../src/editor/rescueCore';

/* The keystroke rescue's controls and limits (Agora Part 0, item 9): what the other writer deleted having seen
   it stays deleted; letters typed into a paragraph the other writer deleted whole, never having seen them, come
   back as a paragraph of their own where it stood (V's C3 ruling); both writers at once; the stated limits.
   Two real TipTap chapter editors (caret-pair.ts), every update delivered through applyRemoteUpdate.
   Expected strings: the spike's run-3 log (_spike-rescue-out3.log) unless marked DERIVED. */

beforeAll(stubLayout);
afterEach(cleanupPairs);

const START = ['Opening line above.', 'The brown fox jumps over the dog.'];
const FOUR = ['Opening line above.', 'The brown fox jumps over the dog.', 'A second paragraph here.', 'Last words of the chapter.'];
const toHeading = (a: Editor, prefix = 'The '): void => void a.chain().setTextSelection(at(a, prefix)).setNode('heading', { level: 2 }).run();
const blockRange = (a: Editor, idx: number): { from: number; to: number } => {
  let r: { from: number; to: number } | null = null;
  a.state.doc.forEach((n, off, i) => {
    if (i === idx) r = { from: off, to: off + n.nodeSize };
  });
  return r!;
};
const shapes = (e: Editor): string => {
  const s: string[] = [];
  e.state.doc.forEach((n) => void s.push(n.type.name));
  return s.join(',');
};

describe('keystroke rescue: the controls (deliberate deletions) and the C3 paragraph', () => {
  it('C1: A deletes the whole paragraph having seen "n": it stays deleted (vetoed)', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.typeB('n'); // A sees it
    g.cut();
    g.edA.chain().deleteRange(blockRange(g.edA, 1)).run();
    g.aToB();
    g.join();
    expect(g.textA()).toBe('Opening line above.');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ vetoed: 1, rescued: 0, restored: 0 }]);
    expect(lettersLost(g.rescuesB[0])).toBe(1);
  });

  it('C2: A, having seen "n", deletes it and makes a heading in one step: it stays deleted (vetoed)', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.typeB('n'); // A sees "bronwn"
    g.cut();
    const p = posOf(g.edA, 'bronwn', 3);
    g.edA.chain().setTextSelection(at(g.edA, 'The ')).deleteRange({ from: p, to: p + 1 }).setNode('heading', { level: 2 }).run();
    g.aToB();
    g.join();
    expect(shapes(g.edA)).toBe('paragraph,heading');
    expect(g.textA()).toBe('Opening line above.\nThe brown fox jumps over the dog.');
    expect(g.textA()).not.toContain('bron');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ vetoed: 1 }]);
  });

  it('C3 (V\'s ruling): A deletes the whole paragraph while "n" is in flight: "n" comes back as its own paragraph where the deleted one stood', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    g.cut();
    g.typeB('n');
    g.edA.chain().deleteRange(blockRange(g.edA, 1)).run();
    g.aToB();
    g.join();
    expect(g.textA()).toBe('Opening line above.\nn'); // DERIVED: the C3 ruling (the spike's run 3 had 'Opening line above.', reported unplaced)
    expect(shapes(g.edA)).toBe('paragraph,paragraph');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ restored: 1, unplaced: 0, vetoed: 0, caret: true }]);
    g.typeB('xyz');
    expect(g.textA()).toBe('Opening line above.\nnxyz'); // DERIVED: the caret rule
  });

  it('C3, two paragraphs deleted in one step: each one\'s letters come back as a paragraph, in document order', () => {
    const g = rig(FOUR);
    g.cut();
    g.parkB('brown', 3);
    g.typeB('n');
    g.parkB('second', 3);
    g.typeB('p');
    // A, never having seen "n" or "p", deletes "The brown…" and "A second…" in one step
    g.edA.chain().deleteRange({ from: blockRange(g.edA, 1).from, to: blockRange(g.edA, 2).to }).run();
    g.aToB();
    g.join();
    expect(g.textA()).toBe('Opening line above.\nn\np\nLast words of the chapter.'); // DERIVED: the C3 ruling + document order
    expect(shapes(g.edA)).toBe('paragraph,paragraph,paragraph,paragraph');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ restored: 2, unplaced: 0, vetoed: 0, caret: true }]);
    g.typeB('xyz');
    expect(g.textA()).toBe('Opening line above.\nn\npxyz\nLast words of the chapter.'); // DERIVED: the C3 ruling + document order; the caret rule
  });
});

describe('keystroke rescue: both writers at once', () => {
  /** A types "p" in "Last words" and makes "The brown" a heading; B types "n" in "The brown" and makes "Last words" a heading (the spike's :549-566). */
  const both = (how: 'own' | 'full') => {
    const g = rig(FOUR);
    g.parkB('brown', 3);
    g.cut();
    g.edA.chain().setTextSelection(posOf(g.edA, 'words', 2)).insertContent('p').run();
    toHeading(g.edA);
    g.typeB('n');
    const keep = g.edB.state.selection.head;
    g.edB.chain().setTextSelection(posOf(g.edB, 'Last', 1)).setNode('heading', { level: 2 }).setTextSelection(keep).run();
    if (how === 'own') {
      g.aToB();
      g.bToA();
    } else {
      g.fullAToB();
      g.fullBToA();
    }
    g.join();
    return g;
  };

  it('BOTH, each writer\'s own updates: "n" once and "p" once', () => {
    const g = both('own');
    expect(g.textA()).toBe('Opening line above.\nThe bronwn fox jumps over the dog.\nA second paragraph here.\nLast woprds of the chapter.');
    expect(g.textB()).toBe(g.textA());
    expect(shapes(g.edA)).toBe('paragraph,heading,paragraph,heading');
    expect(g.rescuesB).toMatchObject([{ rescued: 1 }]);
    expect(g.rescuesA).toMatchObject([{ rescued: 1, carried: 26, vetoed: 0 }]); // DERIVED: the spike's vetoed 26, carried
  });

  it('LIMIT (stated): BOTH as full diffs: "p" is lost, and A is not told (no exact count)', () => {
    const g = both('full');
    expect(g.textA()).toBe('Opening line above.\nThe bronwn fox jumps over the dog.\nA second paragraph here.\nLast words of the chapter.');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesA).toMatchObject([{ uncounted: 27, vetoed: 0, rescued: 0 }]); // DERIVED: Task 2 rule 9
    expect(lettersLost(g.rescuesA[0])).toBe(0);
  });
});

describe('keystroke rescue: the stated limits', () => {
  /** The deleter C never saw "n", but the relay A held it when C's heading arrived (the spike's :512-541). */
  const relayed = (path: 'relay' | 'original') => {
    const g = rig(START);
    g.parkB('brown', 3);
    const docC = new Y.Doc();
    docC.clientID = 4;
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(g.docA));
    const qC: Uint8Array[] = [];
    docC.on('update', (u: Uint8Array) => void qC.push(u));
    g.typeB('n'); // reaches A (the relay) at once; C is not linked yet
    g.cut();
    const fragC = docC.getArray<Y.Map<unknown>>('sections').get(0).get('body') as Y.XmlFragment;
    docC.transact(() => {
      const kids = fragC.toArray() as Y.XmlElement[];
      const h = cloneEl(kids[1], 'heading', { level: 2 });
      fragC.delete(1, 1);
      fragC.insert(1, [h]);
    });
    if (path === 'relay') {
      for (const u of qC) applyRemoteUpdate(g.docA, u, 'C'); // A re-encodes it (A's own transaction, A's cascade)
      g.aToB();
    } else {
      for (const u of qC) applyRemoteUpdate(g.docB, u, 'C'); // C's own bytes reach B (a relay that forwards what it got)
      for (const u of qC) Y.applyUpdate(g.docA, u, 'C'); // as the spike: A applies them without handing over the bytes
    }
    g.join();
    g.typeB('xyz');
    return g;
  };

  it('LIMIT (stated): a relay that held "n" re-encodes C\'s heading: "n" is lost and B is told 1', () => {
    const g = relayed('relay');
    expect(g.textA()).toBe('Opening line above.\nThe brown fox jumps over the dog.xyz');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ vetoed: 1 }]);
  });

  it('the same with C\'s own bytes reaching B: "n" kept', () => {
    const g = relayed('original');
    expect(g.textA()).toBe('Opening line above.\nThe bronxyzwn fox jumps over the dog.');
    expect(g.textB()).toBe(g.textA());
  });

  it('LIMIT until landing step 3: A undoes its heading after B typed "XYZ" in it: "XYZ" is lost and B is told 3', () => {
    const g = rig(START);
    g.parkB('brown', 3);
    toHeading(g.edA);
    g.typeB('XYZ'); // delivered live: A has it
    g.cut();
    g.edA.commands.undo();
    g.aToB();
    g.join();
    expect(g.textA()).toBe('Opening line above.\nThe brown fox jumps over the dog.');
    expect(shapes(g.edA)).toBe('paragraph,paragraph');
    expect(g.textB()).toBe(g.textA());
    expect(g.rescuesB).toMatchObject([{ vetoed: 3 }]);
  });
});
