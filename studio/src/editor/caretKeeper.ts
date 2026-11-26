// The caret keeper: keeps a writer's caret where they put it when ANOTHER writer's change rebuilds
// their paragraph.
//
// Why it is needed: y-tiptap 3.1 and later persists no position migrations. When a remote edit deletes
// the characters a caret is anchored to (a paragraph turned into a heading, Enter pressed before the
// caret, a join with the block above) and writes the same text back as new Yjs items, the caret falls
// back to a heuristic and moves.
//
// The idea: nothing is stored or sent. Every client sees the whole change. Just before a remote
// transaction the keeper notes its caret as a Yjs position plus the words on either side of it. Just
// after, if the character the caret was anchored to died, it looks only in the text that transaction
// wrote for the same words around the same spot and puts the caret back between them.
//
// This file holds the matching rule, which is pure: no editor, no Yjs.

export const CTX = 24; // letters of context kept on each side of the caret
export const OBJ = '￼'; // an inline non-text node, so offsets match Yjs text indexes

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
// caret, `post` the text after (each at most CTX letters). Both sides must match in full, unless the
// block now begins (or ends) right at the caret: that is a split or a join, not a change of words.
// An empty block matches only a caret that stood in an empty block.
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
    if (l < pre.length && l < i) continue;
    const r = commonPrefix(post, s.slice(i, i + CTX));
    if (r < post.length && r < s.length - i) continue;
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
