// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyRemoteUpdate, countLetters, incomingUpdate, lettersLost, planRescue, type RescueCounts, type RescuePlan } from '../src/editor/rescueCore';
import { cloneEl } from './caret-pair';

const SRC = path.join(__dirname, '..', 'src');

describe('the rescue core (pure modules and the one apply function)', () => {
  it('the core is pure: rescueCore.ts imports only yjs and ./textMatch; textMatch.ts imports nothing', () => {
    const imports = (f: string) => [...readFileSync(path.join(SRC, 'editor', f), 'utf8').matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports('rescueCore.ts').sort()).toEqual(['./textMatch', 'yjs']);
    expect(imports('textMatch.ts')).toEqual([]);
  });

  it('applyRemoteUpdate: the bytes are known for exactly that apply, and gone after', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    let u: Uint8Array | null = null;
    a.on('update', (x: Uint8Array) => { u = x; });
    a.getText('t').insert(0, 'hello');
    const seen: (Uint8Array | null)[] = [];
    b.on('afterTransaction', () => void seen.push(incomingUpdate(b)));
    applyRemoteUpdate(b, u!, 'test');
    expect(seen).toEqual([u]);
    expect(incomingUpdate(b)).toBeNull();
    expect(b.getText('t').toString()).toBe('hello');
  });

  it('applyRemoteUpdate: a nested apply restores the outer bytes; a throwing apply leaves none behind', () => {
    const mk = (text: string) => {
      const d = new Y.Doc();
      let u: Uint8Array | null = null;
      d.on('update', (x: Uint8Array) => { u = x; });
      d.getText('t').insert(0, text);
      return u!;
    };
    const outer = mk('outer');
    const other = mk('other');
    const b = new Y.Doc();
    const afterNested: (Uint8Array | null)[] = [];
    let nested = false;
    b.on('afterTransaction', () => {
      if (nested) return;
      nested = true;
      applyRemoteUpdate(b, other, 'nested');
      afterNested.push(incomingUpdate(b));
    });
    applyRemoteUpdate(b, outer, 'outer');
    expect(afterNested).toEqual([outer]);
    expect(incomingUpdate(b)).toBeNull();

    const c = new Y.Doc();
    expect(() => applyRemoteUpdate(c, new Uint8Array([255]), 'bad')).toThrow();
    expect(incomingUpdate(c)).toBeNull();
  });

  it("store.ts applies a tab's update through applyRemoteUpdate only", () => {
    const src = readFileSync(path.join(SRC, 'book', 'store.ts'), 'utf8');
    expect(src).not.toMatch(/Y\.applyUpdate\(/);
    expect(src.match(/applyRemoteUpdate\(/g)).toHaveLength(1);
  });
});

// ---- planRescue: pure Yjs, two docs (A = client 1, B = client 2) -----------------------------------------

const START = ['Opening line above.', 'The brown fox jumps over the dog.'];
const ZERO: RescueCounts = { rescued: 0, moved: 0, restored: 0, carried: 0, vetoed: 0, unplaced: 0, unknown: 0, uncounted: 0, stayed: 0 };

/** A block of `name` holding one XmlText of `s` (y-tiptap's shape for a textblock). */
const para = (s: string, name = 'paragraph'): Y.XmlElement => {
  const el = new Y.XmlElement(name);
  const t = new Y.XmlText();
  t.insert(0, s);
  el.insert(0, [t]);
  return el;
};
/** The XmlText of the textblock at `path` (child indexes from the fragment down). */
const textAt = (frag: Y.XmlFragment, ...path: number[]): Y.XmlText => {
  let n: Y.XmlFragment | Y.XmlElement = frag;
  for (const i of path) n = n.get(i) as Y.XmlElement;
  return n.get(0) as Y.XmlText;
};

type World = { docA: Y.Doc; docB: Y.Doc; fragA: Y.XmlFragment; fragB: Y.XmlFragment };
/** A writes the starting blocks; B starts from A's state. */
function world(build: (f: Y.XmlFragment) => void = (f) => f.insert(0, START.map((s) => para(s)))): World {
  const docA = new Y.Doc();
  docA.clientID = 1;
  const fragA = docA.getXmlFragment('body');
  docA.transact(() => build(fragA));
  const docB = new Y.Doc();
  docB.clientID = 2;
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  return { docA, docB, fragA, fragB: docB.getXmlFragment('body') };
}
/** B types "n" at "The bro|wn" of `t`; the ID of that letter. */
const typeN = (w: World, t: Y.XmlText = textAt(w.fragB, 1)): Y.ID => {
  const id = Y.createID(2, Y.getState(w.docB.store, 2));
  t.insert(7, 'n');
  return id;
};
/** A receives everything B has (A has seen B's letters). */
const aSeesB = (w: World): void => Y.applyUpdate(w.docA, Y.encodeStateAsUpdate(w.docB, Y.encodeStateVector(w.docA)));
/** The server's rebuild of block `i` as a heading (a new element, cloned before the old one is deleted). */
const toHeading = (f: Y.XmlFragment, i: number): void => {
  const h = cloneEl(f.get(i) as Y.XmlElement, 'heading', { level: 2 });
  f.delete(i, 1);
  f.insert(i, [h]);
};
/** A makes `edit` in one transaction; its update reaches B (with its bytes known, or by plain Y.applyUpdate);
 *  B's afterTransaction plans the rescue. The one plan. `remake` turns A's bytes into the bytes B receives. */
function change(w: World, edit: (f: Y.XmlFragment) => void, how: 'bytes' | 'plain' = 'bytes', remake: (u: Uint8Array) => Uint8Array = (u) => u): RescuePlan | null {
  const us: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => void us.push(remake(u));
  w.docA.on('update', onUpdate);
  w.docA.transact(() => edit(w.fragA));
  w.docA.off('update', onUpdate);
  const plans: (RescuePlan | null)[] = [];
  const onAfter = (tr: Y.Transaction) => void plans.push(planRescue(tr, w.fragB, 2, incomingUpdate(w.docB), (p) => p.index, 7));
  w.docB.on('afterTransaction', onAfter);
  for (const u of us) {
    if (how === 'bytes') applyRemoteUpdate(w.docB, u, 'A');
    else Y.applyUpdate(w.docB, u, 'A');
  }
  w.docB.off('afterTransaction', onAfter);
  expect(us).toHaveLength(1);
  expect(plans).toHaveLength(1);
  return plans[0];
}

describe('planRescue: which of my letters died or were stranded, and where their words stand again', () => {
  it('1. a change that deleted nothing: null', () => {
    const w = world();
    typeN(w);
    // DERIVED: the brief's test 1 (any insert that deletes nothing).
    expect(change(w, (f) => textAt(f, 1).insert(4, 'quick '))).toBeNull();
  });

  it('2. no bytes (Y.applyUpdate): nothing done, counted unknown', () => {
    const w = world();
    typeN(w);
    expect(change(w, (f) => toHeading(f, 1), 'plain')).toEqual({ ops: [], counts: { ...ZERO, unknown: 1 } });
  });

  it('3. server-shaped heading, "n" unseen: one insert at "The bro|wn" of the heading', () => {
    const w = world();
    const n = typeN(w);
    const plan = change(w, (f) => toHeading(f, 1))!;
    const heading = textAt(w.fragB, 1);
    expect((w.fragB.get(1) as Y.XmlElement).nodeName).toBe('heading');
    expect(plan.counts).toEqual({ ...ZERO, rescued: 1 });
    expect(plan.ops).toHaveLength(1);
    const op = plan.ops[0];
    expect(op.kind).toBe('insert');
    if (op.kind !== 'insert') return;
    expect(op.letters).toBe('n');
    expect(op.at.text === heading).toBe(true);
    expect(op.at.index).toBe(7);
    expect(op.last).toEqual(n);
  });

  it('4. the same heading after A had "n": carried, nothing to write, nothing lost', () => {
    const w = world();
    typeN(w);
    aSeesB(w);
    const plan = change(w, (f) => toHeading(f, 1))!;
    expect(plan).toEqual({ ops: [], counts: { ...ZERO, carried: 1 } });
    expect(plan.counts.vetoed).toBe(0);
  });

  it('5. C2 shape: A had "n", deletes it and rebuilds in one transaction: vetoed 1', () => {
    const w = world();
    typeN(w);
    aSeesB(w);
    const plan = change(w, (f) => {
      textAt(f, 1).delete(7, 1); // the "n" of "bronwn"
      toHeading(f, 1);
    })!;
    expect(plan).toEqual({ ops: [], counts: { ...ZERO, vetoed: 1 } });
    expect(lettersLost(plan.counts)).toBe(1);
  });

  it('6. C1 shape: A had "n" and deletes the whole paragraph: vetoed 1', () => {
    const w = world();
    typeN(w);
    aSeesB(w);
    const plan = change(w, (f) => f.delete(1, 1))!;
    expect(plan).toEqual({ ops: [], counts: { ...ZERO, vetoed: 1 } });
    expect(lettersLost(plan.counts)).toBe(1);
  });

  it('7. C3 shape: "n" unseen, A deletes the whole paragraph: one paragraph op at live index 1', () => {
    const w = world();
    const n = typeN(w);
    const plan = change(w, (f) => f.delete(1, 1))!;
    expect(plan).toEqual({ ops: [{ kind: 'paragraph', letters: 'n', index: 1, last: n }], counts: { ...ZERO, restored: 1 } });
    expect(lettersLost(plan.counts)).toBe(0);
  });

  it('8. C3 shape inside a list (n in a listItem A deletes, its list stays): unplaced 1, no op', () => {
    // DERIVED: element names are the schema's list nodes; the items hold the starting paragraphs.
    const w = world((f) => {
      const list = new Y.XmlElement('bulletList');
      list.insert(0, START.map((s) => {
        const li = new Y.XmlElement('listItem');
        li.insert(0, [para(s)]);
        return li;
      }));
      f.insert(0, [list]);
    });
    typeN(w, textAt(w.fragB, 0, 1, 0));
    const plan = change(w, (f) => (f.get(0) as Y.XmlElement).delete(1, 1))!;
    expect(w.fragB.length).toBe(1);
    expect(plan).toEqual({ ops: [], counts: { ...ZERO, unplaced: 1 } });
    expect(lettersLost(plan.counts)).toBe(1);
  });

  it('9. split shape: A trims the old text after "The " and writes "brown fox jumps over the dog." as a new paragraph: one move', () => {
    const w = world();
    const n = typeN(w);
    const plan = change(w, (f) => {
      const t = textAt(f, 1);
      t.delete(4, t.length - 4);
      f.insert(2, [para(START[1].slice('The '.length))]);
    })!;
    const old = textAt(w.fragB, 1);
    const second = textAt(w.fragB, 2);
    expect(old.toString()).toBe('The n'); // stranded where Yjs left it
    expect(plan.counts).toEqual({ ...ZERO, moved: 1 });
    expect(plan.ops).toHaveLength(1);
    const op = plan.ops[0];
    expect(op.kind).toBe('move');
    if (op.kind !== 'move') return;
    expect(op.letters).toBe('n');
    expect(op.from.text === old).toBe(true);
    expect(op.from.index).toBe(4);
    expect(op.at.text === second).toBe(true);
    expect(op.at.index).toBe(3);
    expect(op.last).toEqual(n);
  });

  it('10. B wrote the whole paragraph; A, having it, rebuilds it as a heading without one of its letters: uncounted, not told', () => {
    const w = world();
    const mine = 'Last words of the chapter.';
    w.fragB.insert(2, [para(mine)]);
    aSeesB(w);
    const plan = change(w, (f) => {
      textAt(f, 2).delete(7, 1); // the "r" of "words"
      toHeading(f, 2);
    })!;
    expect(plan.ops).toEqual([]);
    expect(plan.counts.uncounted).toBe(countLetters(mine));
    expect(plan.counts.vetoed).toBe(0);
    expect(lettersLost(plan.counts)).toBe(0);
  });

  it('11. countLetters counts code points', () => expect(countLetters('a\u{1F600}b')).toBe(3));

  it('12. C3 shape, two deleted blocks, typed later block first: paragraph ops in document order, both at live index 1', () => {
    // DERIVED: the C3 ruling + document order. The third paragraph is the spike's FOUR[2]; "x" is any letter.
    const w = world((f) => f.insert(0, [...START, 'A second paragraph here.'].map((s) => para(s))));
    const x = Y.createID(2, Y.getState(w.docB.store, 2));
    textAt(w.fragB, 2).insert(2, 'x'); // "A x|second": the later block, typed first
    const n = typeN(w); // then "The bron|wn": the earlier block
    const plan = change(w, (f) => f.delete(1, 2))!;
    expect(plan).toEqual({
      ops: [
        { kind: 'paragraph', letters: 'n', index: 1, last: n },
        { kind: 'paragraph', letters: 'x', index: 1, last: x },
      ],
      counts: { ...ZERO, restored: 2 },
    });
  });

  it('13. the knowledge gate holds when the bytes carry an unsorted delete set', () => {
    // DERIVED: the knowledge gate ruling (it never puts back a letter the deleter had). B's letters get clocks
    // 0, 1, 2: "n" and "y" in the paragraph A deletes, "x" in the first one, so A's delete set names B's
    // clocks as two ranges, [0,1) and [2,3). The bytes B receives carry them in reverse order.
    const w = world();
    const n = typeN(w); // clock 0
    textAt(w.fragB, 0).insert(0, 'x'); // clock 1
    const t1 = textAt(w.fragB, 1);
    t1.insert(t1.length, 'y'); // clock 2
    expect(n).toEqual(Y.createID(2, 0));
    aSeesB(w);
    let sent: Uint8Array | null = null;
    const reversed = (u: Uint8Array): Uint8Array => {
      const { structs, ds } = Y.decodeUpdate(u);
      expect(structs).toHaveLength(0); // a pure deletion: the bytes are its delete set alone
      const bytes: number[] = [];
      const varUint = (v: number) => {
        while (v > 0x7f) {
          bytes.push(0x80 | (v & 0x7f));
          v >>>= 7;
        }
        bytes.push(v);
      };
      varUint(0); // no struct clients
      varUint(ds.clients.size);
      for (const [client, ranges] of ds.clients) {
        varUint(client);
        varUint(ranges.length);
        for (const r of [...ranges].reverse()) {
          varUint(r.clock);
          varUint(r.len);
        }
      }
      sent = new Uint8Array(bytes);
      return sent;
    };
    const plan = change(w, (f) => f.delete(1, 1), 'bytes', reversed)!;
    // the bytes really are unsorted, and a binary search on them misses B's clock 0
    const got = Y.decodeUpdate(sent!).ds.clients.get(2)!.map((r) => [r.clock, r.len]);
    expect(got).toEqual([[2, 1], [0, 1]]);
    expect(Y.isDeleted(Y.decodeUpdate(sent!).ds, n)).toBe(false);
    expect(w.fragB.length).toBe(1);
    expect(plan).toEqual({ ops: [], counts: { ...ZERO, vetoed: 2 } });
  });

  it('14. B wrote the whole paragraph; A, having it, deletes that paragraph outright, writing nothing: vetoed, and told', () => {
    const w = world();
    const mine = 'Last words of the chapter.';
    w.fragB.insert(2, [para(mine)]);
    aSeesB(w);
    const plan = change(w, (f) => f.delete(2, 1))!;
    expect(w.fragB.length).toBe(2);
    // DERIVED: Task 6 ruling (all-own paragraph deleted outright → vetoed)
    expect(plan).toEqual({ ops: [], counts: { ...ZERO, vetoed: countLetters(mine) } });
    expect(plan.counts.uncounted).toBe(0);
    expect(lettersLost(plan.counts)).toBe(countLetters(mine));
  });
});
