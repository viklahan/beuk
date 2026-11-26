import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { positionMigrationStore } from '../src/editor/positionMigrations';
import { at, blockWith, bytesWithoutKeeper, cleanupPairs, pair, posOf, stubLayout, type Pair } from './caret-pair';

/* The caret keeper, the harder cases (Agora part 0A, task 4): undo, the server writer, offline catch-up,
   typing through a restructure, growth and cost. The cases are the spike's (diag6/diag7.mjs). Node + jsdom. */

beforeAll(stubLayout);
afterEach(cleanupPairs);

const START = ['Opening line above.', 'The brown fox jumps over the dog.'];
const BROWN = 'The bro|wn fox jumps over the dog.';

const toHeading = (a: Editor): void => void a.chain().setTextSelection(at(a, 'The ')).setNode('heading', { level: 2 }).run();
const undoOf = (a: Editor): Y.UndoManager => (yUndoPluginKey.getState(a.state) as { undoManager: Y.UndoManager }).undoManager;
const undo = (a: Editor): void => {
  undoOf(a).stopCapturing();
  a.commands.undo();
};

/** The five hard cases: each starts with B parked at "bro|wn" and leaves the book changed. */
const FIVE: [string, (w: Pair) => void][] = [
  [
    'heading, then A undoes it',
    (w) => {
      toHeading(w.edA);
      undo(w.edA);
      expect(w.edA.state.doc.child(1).type.name).toBe('paragraph');
    },
  ],
  [
    'split before B, then A joins it back',
    (w) => {
      w.edA.chain().setTextSelection(at(w.edA, 'The ')).splitBlock().run();
      expect(w.edA.state.doc.childCount).toBe(3);
      w.edA.chain().setTextSelection(posOf(w.edA, 'brown', 0)).joinBackward().run();
      expect(w.edA.state.doc.childCount).toBe(2);
    },
  ],
  [
    'the server writer turns it into a heading',
    (w) => {
      w.serverHeading('The brown');
      expect(w.edA.state.doc.child(1).type.name).toBe('heading');
    },
  ],
  [
    'the server writer re-sends the whole chapter with a word added above',
    (w) => {
      w.serverRewrite(' Added.');
      expect(w.edA.state.doc.child(0).textContent).toBe('Opening line above. Added.');
    },
  ],
  [
    'B offline while A makes it a heading; B comes back',
    (w) => {
      w.offline();
      toHeading(w.edA);
      expect(w.edB.state.doc.child(1).type.name).toBe('paragraph'); // B has not seen it
      w.online();
      expect(w.edB.state.doc.child(1).type.name).toBe('heading');
    },
  ],
];

describe('the caret keeper: the harder cases', () => {
  it.each(FIVE)('%s: B keeps bro|wn', (_n, change) => {
    const w = pair(START);
    w.parkB('brown', 3);
    change(w);
    expect(w.edB.state.doc.textBetween(w.edB.state.selection.head - 3, w.edB.state.selection.head)).toBe('bro');
    w.typeB('#');
    expect(w.textA()).toContain('The bro#wn fox');
  });

  it('in each of the five cases, A resolves B\'s caret to "bro|wn" before B types', () => {
    for (const [name, change] of FIVE) {
      cleanupPairs();
      const w = pair(START);
      w.parkB('brown', 3);
      change(w);
      expect(w.remoteCaretInA(), name).toBe(BROWN);
    }
  });

  it('the keeper covers the server\'s own writes and a catch-up after offline: each produced a "found" result', () => {
    const s = pair(START);
    s.parkB('brown', 3);
    s.serverHeading('The brown');
    expect(s.results.at(-1)?.outcome).toBe('found');
    const o = pair(START);
    o.parkB('brown', 3);
    o.offline();
    toHeading(o.edA);
    o.online();
    expect(o.results.at(-1)?.outcome).toBe('found');
  });

  it('typing through a heading: B types 24 letters, A converts after the 8th: "broabcdefghijklmnopqrstuvwxwn"', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    [...'abcdefghijklmnopqrstuvwx'].forEach((c, i) => {
      w.typeB(c);
      if (i === 7) toHeading(w.edA);
    });
    expect(w.edA.state.doc.child(1).type.name).toBe('heading');
    expect(w.textA()).toContain('broabcdefghijklmnopqrstuvwxwn');
    expect(w.textA()).toBe(w.edB.state.doc.textBetween(0, w.edB.state.doc.content.size, '\n'));
  });

  it('typing through a split then join (after the 8th and 16th letters): all 24 together', () => {
    const w = pair(START);
    w.parkB('brown', 3);
    [...'abcdefghijklmnopqrstuvwx'].forEach((c, i) => {
      w.typeB(c);
      if (i === 7) w.edA.chain().setTextSelection(at(w.edA, 'The ')).splitBlock().run();
      if (i === 15) {
        expect(w.edA.state.doc.childCount).toBe(3);
        w.edA.chain().setTextSelection(posOf(w.edA, 'broabc', 0)).joinBackward().run();
      }
    });
    expect(w.edA.state.doc.childCount).toBe(2);
    expect(blockWith(w.edA, 'broabc')).toContain('broabcdefghijklmnopqrstuvwxwn');
    expect(w.textA()).toBe(w.edB.state.doc.textBetween(0, w.edB.state.doc.content.size, '\n'));
  });

  it('100 heading + undo cycles by A: before B types, B\'s doc bytes equal a run without the keeper, every migration map empty; then B still keeps bro|wn', () => {
    const cycles = (w: Pair): void => {
      w.parkB('brown', 3);
      for (let i = 0; i < 100; i++) {
        toHeading(w.edA);
        undo(w.edA);
      }
    };
    const w = pair(START);
    cycles(w);
    const bytes = Y.encodeStateAsUpdate(w.docB);
    const bare = bytesWithoutKeeper(START, cycles);
    console.log(`[caret-keeper] growth after 100 heading+undo cycles: B ${bytes.length} bytes with the keeper, ${bare.length} without; migration maps A ${positionMigrationStore(w.fragA)?.size}, B ${positionMigrationStore(w.fragB)?.size}`);
    expect(bytes).toEqual(bare);
    expect(positionMigrationStore(w.fragB)).toBeTruthy();
    expect(positionMigrationStore(w.fragB)!.size).toBe(0);
    expect(positionMigrationStore(w.fragA)?.size ?? 0).toBe(0);
    expect(w.results.length).toBeGreaterThan(0);
    expect(w.remoteCaretInA()).toBe(BROWN);
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });
});

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis.';
const BIG = ['The brown fox jumps over the dog.', ...Array.from({ length: 400 }, (_, i) => `${i} ${LOREM}`)];
const chars = (w: Pair): number => w.textA().length;

describe('the caret keeper: cost on a 400-paragraph chapter', () => {
  it('cost: A types 200 letters 300 paragraphs below B in a 400-paragraph chapter: every result is "alive" with searched === 0', () => {
    const w = pair(BIG);
    w.parkB('brown', 3);
    let remote = 0;
    w.docB.on('afterTransaction', (t: Y.Transaction) => {
      if (!t.local) remote++;
    });
    const n0 = w.results.length;
    w.edA.commands.setTextSelection(posOf(w.edA, '300 Lorem', 0));
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) w.edA.view.dispatch(w.edA.state.tr.insertText('z'));
    const wall = performance.now() - t0;
    const got = w.results.slice(n0);
    expect(w.textA().match(/z/g)).toHaveLength(200);
    expect(remote).toBeGreaterThanOrEqual(200);
    expect(got).toHaveLength(remote);
    expect(got.every((r) => r.outcome === 'alive' && r.searched === 0)).toBe(true);
    const total = got.reduce((s, r) => s + r.ms, 0);
    console.log(`[caret-keeper] 200 keystrokes in a ${chars(w)}-char chapter (Node + jsdom): ${got.length} results, keeper ${total.toFixed(2)} ms in all (max ${Math.max(...got.map((r) => r.ms)).toFixed(2)} ms), whole run ${wall.toFixed(0)} ms`);
    expect(w.remoteCaretInA()).toBe(BROWN);
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });

  it('one server rewrite of the 400-paragraph chapter: outcome found; the keeper\'s ms is below the whole applyUpdate\'s ms; both printed', () => {
    const w = pair(BIG);
    w.parkB('brown', 3);
    const n0 = w.results.length;
    w.offline();
    w.serverRewrite(' Added.');
    const whole = w.online(); // one Y.applyUpdate delivers the rewrite to B
    const got = w.results.slice(n0);
    expect(got).toHaveLength(1);
    expect(got[0].outcome).toBe('found');
    console.log(`[caret-keeper] rewrite of ${chars(w)} chars (Node + jsdom): keeper ${got[0].ms.toFixed(2)} ms of ${whole.toFixed(2)} ms`);
    expect(got[0].ms).toBeLessThan(whole);
    expect(w.remoteCaretInA()).toBe(`${BROWN} Added.`); // the word was added to this chapter's first block, B's
    w.typeB('#');
    expect(w.textA()).toContain('bro#wn');
  });
});
