// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CTX, findInText, nearestOf } from '../src/editor/caretKeeper';

// The spike's per-offset loop (tools/agora-spike/src/caretKeeper.ts `find`), plus the empty-block rule, with the
// final review's rule (2026-11-26): a side may match only up to an edge of s when the other side is non-empty
// and matched in full.
const commonSuffix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; };
const commonPrefix = (a: string, b: string) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
function referenceScan(s: string, pre: string, post: string): number[] {
  const hits: number[] = [];
  for (let i = 0; i <= s.length; i++) {
    const l = commonSuffix(pre, s.slice(Math.max(0, i - CTX), i));
    const r = commonPrefix(post, s.slice(i, i + CTX));
    const preFull = l === pre.length;
    const postFull = r === post.length;
    const preToStart = l === i;
    const postToEnd = r === s.length - i;
    if (!((preFull && postFull) || (preFull && pre.length > 0 && postToEnd) || (postFull && post.length > 0 && preToStart))) continue;
    if (l + r === 0 && !(s.length === 0 && pre === '' && post === '')) continue;
    hits.push(i);
  }
  return hits;
}

// mulberry32, seed 1: a failure reproduces
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomCases(n: number) {
  const rnd = mulberry32(1);
  const str = (len: number) => Array.from({ length: len }, () => 'ab '[Math.floor(rnd() * 3)]).join('');
  const out: { s: string; pre: string; post: string }[] = [];
  for (let k = 0; k < n; k++) {
    const s = str(Math.floor(rnd() * 61));
    const src = rnd() < 0.5 ? s : str(Math.floor(rnd() * 61)); // the caret's block: the same text, or an edited one
    const off = Math.floor(rnd() * (src.length + 1));
    out.push({ s, pre: src.slice(Math.max(0, off - CTX), off), post: src.slice(off, off + CTX) });
  }
  return out;
}

describe('findInText (the caret keeper\'s rule)', () => {
  it('finds the caret between its full words', () => {
    expect(findInText('The brown fox jumps.', 'The bro', 'wn fox jumps.')).toEqual([7]);
  });
  it('a block that now begins before the caret (a split there): a left match that reaches the start is enough', () => {
    expect(findInText('brown fox jumps.', 'Opening. The bro', 'wn fox jumps.')).toEqual([3]);
    expect(findInText('wn fox jumps.', 'The bro', 'wn fox jumps.')).toEqual([0]);
    expect(findInText('xbrown fox jumps.', 'The bro', 'wn fox jumps.')).toEqual([]); // a partial left that does not reach the start
  });
  it('a block that now ends at the caret needs only the left side', () => {
    expect(findInText('The bro', 'The bro', 'wn fox')).toEqual([7]);
  });
  it('a joined block: both sides in full, inside longer text', () => {
    expect(findInText('Opening line above.The brown fox.', 'The bro', 'wn fox.')).toEqual([26]);
  });
  it('really deleted words: no hit', () => {
    expect(findInText('The jumps over the dog.', 'The bro', 'wn fox jumps over the dog.')).toEqual([]);
  });
  it('one letter at an edge of the written text is not the caret\'s words (the final review\'s probes)', () => {
    // the caret stood at the end of a paragraph that is gone; the written text begins with the same quote mark
    expect(findInText('"Yes," she said.', 'id quietly, "No more."', '')).toEqual([]);
    // neither side in full: a partial left reaching the start and a partial right reaching the end
    expect(findInText('w', 'The bro', 'wn fox jumps')).toEqual([]);
    expect(findInText('ow', 'The bro', 'wn fox jumps')).toEqual([]);
  });
  it('the same words twice: both hits, nearestOf picks the closer, a tie the smaller', () => {
    expect(findInText('abcd abcd', 'ab', 'cd')).toEqual([2, 7]);
    expect(nearestOf([12, 40], 30)).toBe(40);
    expect(nearestOf([20, 40], 30)).toBe(20);
    expect(nearestOf([], 3)).toBeNull();
  });
  it('an empty block matches only a caret that stood in an empty block', () => {
    expect(findInText('', '', '')).toEqual([0]);
    expect(findInText('', 'x', '')).toEqual([]);
    expect(findInText('abc', '', '')).toEqual([]);
  });
  it('agrees with the spike\'s full scan on 2,000 random cases', () => {
    const cases = randomCases(2000);
    // not vacuous: most cases have hits to agree on (1,094 of the 2,000 with seed 1; 1,145 before the final
    // review's rule, which changed the hits of 98 cases)
    expect(cases.filter(({ s, pre, post }) => referenceScan(s, pre, post).length > 0).length).toBeGreaterThan(1000);
    const bad = cases.filter(({ s, pre, post }) => JSON.stringify(findInText(s, pre, post)) !== JSON.stringify(referenceScan(s, pre, post)));
    expect(bad).toEqual([]);
  });
});
