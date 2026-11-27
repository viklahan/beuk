import * as Y from 'yjs';
import { CTX, OBJ, findInText, mayHit, nearestOf } from './textMatch';

// The keystroke rescue's pure core: what a transaction wrote, and the one function every remote update goes through.

export const textOf = (t: Y.XmlText): string => t.toDelta().map((o: { insert: unknown }) => (typeof o.insert === 'string' ? o.insert : OBJ)).join('');

/** `t` is `frag` or lies inside it. */
export const inside = (frag: Y.XmlFragment, t: Y.AbstractType<any>): boolean => t === frag || (t._item !== null && Y.isParentOf(frag, t._item));

/** `tr` changed something in `frag` (a change elsewhere in the book cannot move this editor's caret). */
export const touches = (tr: Y.Transaction, frag: Y.XmlFragment): boolean => {
  for (const t of tr.changed.keys()) if (inside(frag, t)) return true;
  return false;
};

/** What `tr` wrote inside `frag`: the XmlTexts it changed, plus every XmlText inside a block it created (an
 *  item is new when its clock is at or past the transaction's state vector for its client); and the empty
 *  blocks it created. An empty block holds no XmlText in Yjs (y-tiptap writes none), so it is searched as
 *  the empty text "": the empty-block rule of findInText. */
export function written(tr: Y.Transaction, frag: Y.XmlFragment): { texts: Y.XmlText[]; empties: Y.XmlElement[] } {
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

// The bytes of the remote update being applied, for the duration of that one apply (V1 updates only: the
// store sends V1). A WeakMap keyed by doc, restored in finally, so a nested apply gives the outer bytes back
// and a throwing apply leaves none behind.
const incoming = new WeakMap<Y.Doc, Uint8Array>();

/** Apply a remote V1 update to `doc`; while it applies, `incomingUpdate(doc)` returns its bytes. */
export function applyRemoteUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
  const prev = incoming.get(doc);
  incoming.set(doc, update);
  try {
    Y.applyUpdate(doc, update, origin);
  } finally {
    if (prev) incoming.set(doc, prev);
    else incoming.delete(doc);
  }
}

/** The bytes of the remote update being applied to `doc` right now, or null when none is. */
export function incomingUpdate(doc: Y.Doc): Uint8Array | null {
  return incoming.get(doc) ?? null;
}

// ---- the plan, in Yjs terms ----------------------------------------------------------------------------

export type YPlace = { text: Y.XmlText; index: number }; // index in UTF-16 units, as Yjs counts
export type RescueOp =
  | { kind: 'insert'; letters: string; at: YPlace; last: Y.ID } // dead letters, back between their words
  // stranded letters; `from`: where they stand now, a Yjs place NOT checked against `rank`: it may not map to a
  // ProseMirror position, and the editor half must skip the op when it does not
  | { kind: 'move'; letters: string; from: YPlace; at: YPlace; last: Y.ID }
  // the C3 ruling. Paragraph ops are in document order; `index` is the live index in frag after tr; ops with
  // equal index are applied in array order, each after the previous
  | { kind: 'paragraph'; letters: string; index: number; last: Y.ID };
export type RescueCounts = { rescued: number; moved: number; restored: number; carried: number; vetoed: number; unplaced: number; unknown: number; uncounted: number; stayed: number };
export type RescuePlan = { ops: RescueOp[]; counts: RescueCounts };

/** Letters in code points. */
export const countLetters = (s: string): number => [...s].length;
/** The letters the writer is told about: the other writer had them and deleted them, or their words are gone. */
export const lettersLost = (c: RescueCounts): number => c.vetoed + c.unplaced;

type Kind = 'seen' | 'dead' | 'vetoed' | 'stranded';
type Ch = { ch: string; item: Y.Item; off: number; kind: Kind };
type Run = { t: Y.XmlText; chars: Ch[]; kind: Exclude<Kind, 'seen'>; pre: string; post: string; seen: string; nowIdx: number };

const strOf = (it: Y.Item): string | null => (it.content instanceof Y.ContentString ? (it.content as unknown as { str: string }).str : null);
const diedIn = (tr: Y.Transaction, it: Y.Item): boolean => it.deleted && Y.isDeleted(tr.deleteSet, it.id);

/** The topmost ancestor of `it` below `frag` whose block (or text) was deleted in `tr`; null when none was. */
function topDead(tr: Y.Transaction, frag: Y.XmlFragment, it: Y.Item): Y.AbstractType<any> | null {
  let top: Y.AbstractType<any> | null = null;
  let t = it.parent as Y.AbstractType<any> | null;
  while (t && t !== frag) {
    const ti = t._item;
    if (!ti) return null;
    if (diedIn(tr, ti)) top = t;
    t = ti.parent as Y.AbstractType<any>;
  }
  return t === frag ? top : null;
}

/** The text `t` held just before `tr` (items alive, or deleted by `tr`), one entry per UTF-16 unit. */
function beforeView(tr: Y.Transaction, t: Y.XmlText): Ch[] {
  const out: Ch[] = [];
  for (let it = t._start; it; it = it.right) {
    if (!it.countable) continue;
    if (it.id.clock >= (tr.beforeState.get(it.id.client) ?? 0)) continue; // written by tr itself
    if (it.deleted && !Y.isDeleted(tr.deleteSet, it.id)) continue; // invisible before tr
    const s = strOf(it) ?? OBJ.repeat(it.length);
    for (let j = 0; j < s.length; j++) out.push({ ch: s[j], item: it, off: j, kind: 'seen' });
  }
  return out;
}

/** The XmlTexts under `t`, in Yjs order (deleted ones included: they were deleted in this transaction). */
function textsUnder(t: Y.AbstractType<any>, out: Y.XmlText[] = []): Y.XmlText[] {
  if (t instanceof Y.XmlText) {
    out.push(t);
    return out;
  }
  for (let it = t._start; it; it = it.right) if (it.content instanceof Y.ContentType) textsUnder(it.content.type, out);
  return out;
}

/** For one remote transaction `tr` in `frag`: which of writer `me`'s own letters died (a block above them was
 *  deleted in it) or were stranded (alive, their neighbours on both sides deleted in it), and where their words
 *  stand again in what `tr` wrote. `update` is the incoming update's bytes (null: nothing is done, `unknown`);
 *  `rank` maps a place to a comparable number (null: not a place to write); `was` is where the caret was, in
 *  `rank`'s units. Null when `tr` deleted none of `me`'s letters this way. Reads only; writes nothing. */
export function planRescue(
  tr: Y.Transaction,
  frag: Y.XmlFragment,
  me: number,
  update: Uint8Array | null,
  rank: (p: YPlace) => number | null,
  was: number,
): RescuePlan | null {
  if (tr.deleteSet.clients.size === 0) return null; // a change that deleted nothing: nothing can be lost
  if (frag._item?.deleted) return null;

  // 1. dead: my own letters deleted in tr because a block above them was deleted in tr (item -> that block)
  const dead = new Map<Y.Item, Y.AbstractType<any>>();
  Y.iterateDeletedStructs(tr, tr.deleteSet, (s) => {
    if (!(s instanceof Y.Item) || s.id.client !== me || strOf(s) === null || s.parentSub !== null) return;
    if (!(s.parent instanceof Y.XmlText) || !inside(frag, s.parent)) return;
    const top = topDead(tr, frag, s);
    if (top) dead.set(s, top);
  });

  // the texts to read: each dead letter's old text, and every live text in frag that tr changed
  const texts = new Set<Y.XmlText>();
  for (const s of dead.keys()) texts.add(s.parent as Y.XmlText);
  tr.changed.forEach((_k, t) => {
    if (t instanceof Y.XmlText && t._item && !t._item.deleted && inside(frag, t)) texts.add(t);
  });

  // the knowledge gate, decoded only when a dead letter exists. Y.isDeleted binary-searches each client's
  // ranges, so the bytes' delete set is sorted and merged first (mergeDeleteSets returns a fresh, sorted
  // copy): the gate must not depend on how the sender ordered its ranges.
  let ds: ReturnType<typeof Y.decodeUpdate>['ds'] | null = null;
  const named = (id: Y.ID): boolean => {
    if (ds === null) ds = Y.mergeDeleteSets([Y.decodeUpdate(update!).ds]);
    return Y.isDeleted(ds, id);
  };

  const runs: Run[] = [];
  for (const t of texts) {
    const v = beforeView(tr, t);
    for (const c of v) {
      if (!dead.has(c.item)) continue;
      c.kind = update !== null && named(Y.createID(me, c.item.id.clock + c.off)) ? 'vetoed' : 'dead';
    }
    // 2. stranded: my own letters alive after tr whose neighbours on both sides died in tr (the split)
    if (!t._item?.deleted) {
      const mineAlive = (c: Ch) => c.kind === 'seen' && c.item.id.client === me && !c.item.deleted && strOf(c.item) !== null;
      for (let i = 0; i < v.length; ) {
        if (!mineAlive(v[i])) {
          i++;
          continue;
        }
        let j = i;
        while (j < v.length && mineAlive(v[j])) j++;
        const before = i > 0 ? v[i - 1] : null;
        const after = j < v.length ? v[j] : null;
        if (before && after && diedIn(tr, before.item) && diedIn(tr, after.item)) for (let k = i; k < j; k++) v[k].kind = 'stranded';
        i = j;
      }
    }
    // runs of one kind; pre/post: up to CTX of the seen and vetoed letters on each side (dead and stranded left out)
    const seen = v.filter((c) => c.kind === 'seen' || c.kind === 'vetoed').map((c) => c.ch).join('');
    let k = 0; // seen and vetoed letters before the current position
    for (let i = 0; i < v.length; ) {
      const kind = v[i].kind;
      if (kind === 'seen') {
        k++;
        i++;
        continue;
      }
      let j = i;
      while (j < v.length && v[j].kind === kind) j++;
      const chars = v.slice(i, j);
      const own = kind === 'vetoed' ? j - i : 0; // a vetoed run is part of `seen`: its sides lie around it
      let nowIdx = 0; // a stranded run's index in t as it is now
      if (kind === 'stranded') {
        for (let it = t._start; it && it !== chars[0].item; it = it.right) if (it.countable && !it.deleted) nowIdx += it.length;
        nowIdx += chars[0].off;
      }
      runs.push({ t, chars, kind, pre: seen.slice(Math.max(0, k - CTX), k), post: seen.slice(k + own, k + own + CTX), seen, nowIdx });
      k += own;
      i = j;
    }
  }
  if (!runs.length) return null;

  const counts: RescueCounts = { rescued: 0, moved: 0, restored: 0, carried: 0, vetoed: 0, unplaced: 0, unknown: 0, uncounted: 0, stayed: 0 };
  const lettersOf = (run: Run): string => run.chars.map((c) => c.ch).join('');
  // 3. no bytes: nothing done, every dead and stranded letter counted unknown
  if (update === null) {
    for (const run of runs) counts.unknown += countLetters(lettersOf(run));
    return { ops: [], counts };
  }

  // the place: the run's words in the text tr wrote (the keeper's rule), nearest where the caret was
  const wrote = written(tr, frag).texts.map((t) => ({ t, s: textOf(t) }));
  const find = (pre: string, post: string): YPlace | null => {
    const hits: { place: YPlace; r: number }[] = [];
    for (const w of wrote) {
      if (!mayHit(w.s, pre, post)) continue;
      for (const index of findInText(w.s, pre, post)) {
        const place = { text: w.t, index };
        const r = rank(place);
        if (r !== null) hits.push({ place, r });
      }
    }
    const best = nearestOf(hits.map((h) => h.r), was);
    return best === null ? null : hits.find((h) => h.r === best)!.place;
  };

  const ops: RescueOp[] = [];
  const paragraphs = new Map<Y.AbstractType<any>, Run[]>(); // the C3 ruling: candidate runs per deleted top block
  for (const run of runs) {
    const letters = lettersOf(run);
    const n = countLetters(letters);
    const lastC = run.chars[run.chars.length - 1];
    const last = Y.createID(me, lastC.item.id.clock + lastC.off);
    if (run.kind === 'dead') {
      if (find((run.pre + letters).slice(-CTX), run.post)) {
        counts.carried += n; // the change already holds these letters (copied)
        continue;
      }
      const at = find(run.pre, run.post);
      if (at) {
        ops.push({ kind: 'insert', letters, at, last });
        counts.rescued += n;
        continue;
      }
      const top = dead.get(run.chars[0].item)!;
      if (top._item?.parent === frag) {
        const list = paragraphs.get(top) ?? [];
        list.push(run);
        paragraphs.set(top, list);
      } else counts.unplaced += n;
    } else if (run.kind === 'stranded') {
      const at = find(run.pre, run.post);
      if (at) {
        ops.push({ kind: 'move', letters, from: { text: run.t, index: run.nowIdx }, at, last });
        counts.moved += n;
      } else counts.stayed += n; // alive where Yjs left it: not lost
    } else {
      // vetoed: the other writer had these letters
      const sides = [run.pre, run.post].filter((x) => x !== '');
      if (wrote.some((w) => w.s === run.seen)) counts.carried += n;
      else if (find(run.pre, (letters + run.post).slice(0, CTX)) && find((run.pre + letters).slice(-CTX), run.post)) counts.carried += n;
      else if (run.pre !== '' && run.post !== '' && find(run.pre, run.post)) counts.vetoed += n; // the words stand without them (C2)
      else if (sides.length > 0 && sides.every((x) => !wrote.some((w) => w.s.includes(x)))) counts.vetoed += n; // their words went too (C1)
      // what is left is uncounted, and nothing is told:
      // - some of their words stand in what the change wrote, and the letters do not stand where those words are
      //   (part kept, part not): no exact count;
      // - the run has no other writer's words beside it (a block of my own letters only), whether the change
      //   rebuilt it or deleted it outright. "Own" means every item this session's Y.Doc created, and that includes
      //   a book it imported or opened, so such a run cannot be told as "letters you typed": silence is the honest
      //   answer, not a false claim (ruling R6b, 2026-11-27).
      else counts.uncounted += n;
    }
  }

  // the C3 ruling: the candidate runs of one deleted top block, in before-view order, as their own paragraph
  // where that block stood (its live index: the children of frag alive after tr that stand before it). The
  // blocks in document order: their place among frag's children in Yjs order, deleted ones included.
  const blockAt = new Map<Y.Item, number>();
  if (paragraphs.size) {
    let i = 0;
    for (let it = frag._start; it; it = it.right) blockAt.set(it, i++);
  }
  const tops = [...paragraphs].sort((a, b) => blockAt.get(a[0]._item!)! - blockAt.get(b[0]._item!)!);
  for (const [top, group] of tops) {
    const order = textsUnder(top);
    const sorted = group.map((run, i) => ({ run, i })).sort((a, b) => order.indexOf(a.run.t) - order.indexOf(b.run.t) || a.i - b.i).map((x) => x.run);
    const letters = sorted.map(lettersOf).join('');
    const lastRun = sorted[sorted.length - 1];
    const lastC = lastRun.chars[lastRun.chars.length - 1];
    let index = 0;
    for (let it = frag._start; it && it !== top._item; it = it.right) if (!it.deleted && it.countable) index += it.length;
    ops.push({ kind: 'paragraph', letters, index, last: Y.createID(me, lastC.item.id.clock + lastC.off) });
    counts.restored += countLetters(letters);
  }
  return { ops, counts };
}
