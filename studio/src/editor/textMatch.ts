// The caret keeper's matching rule: pure, no editor, no Yjs. Moved out of caretKeeper.ts unchanged.

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

// A cheap pre-check for findInText: false only where findInText(s, pre, post) is certainly empty. Every hit
// has a full, non-empty side (so that side occurs in s), except the empty block, which needs both sides
// empty and s empty.
export function mayHit(s: string, pre: string, post: string): boolean {
  if (pre === '' && post === '') return s === '';
  return (pre !== '' && s.includes(pre)) || (post !== '' && s.includes(post));
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
