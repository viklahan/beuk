import { describe, expect, it } from 'vitest';
import { between, isPosition, spread } from '../../src/book/editor/order';

/* Section order (spec 2026-11-01): fractional positions — the midpoint, the ends, 1,000 inserts at one spot, length. */

const ok = (a: string | null, p: string, b: string | null) => {
  expect(isPosition(p), p).toBe(true);
  if (a !== null) expect(a < p, `${a} < ${p}`).toBe(true);
  if (b !== null) expect(p < b, `${p} < ${b}`).toBe(true);
};

describe('between', () => {
  it('a midpoint strictly between two positions, at both ends, and of an empty list', () => {
    ok(null, between(null, null), null);
    for (const [a, b] of [['1', '2'], ['V', 'W'], ['V', 'V1'], ['0V', '1'], ['zz', 'zzV'], ['A', 'z'], ['01', '02']] as const) ok(a, between(a, b), b);
    for (const a of ['1', 'V', 'z', 'zz', 'y', '0z']) ok(a, between(a, null), null);
    for (const b of ['1', 'V', '2', '01', '0001']) ok(null, between(null, b), b);
  });
  it('refuses positions out of order or malformed', () => {
    expect(() => between('V', 'V')).toThrow();
    expect(() => between('W', 'V')).toThrow();
    expect(() => between('V0', null)).toThrow();
    expect(() => between('', null)).toThrow();
  });
  it('1,000 inserts at the same spot (always right after the first) stay ordered', () => {
    const list = ['V', 'W'];
    for (let i = 0; i < 1000; i++) {
      const p = between(list[0]!, list[1]!);
      ok(list[0]!, p, list[1]!);
      list.splice(1, 0, p);
    }
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(list.length);
    // midpoints halve the gap: about one character per log2(62) ≈ 6 inserts
    expect(Math.max(...list.map((s) => s.length))).toBeLessThanOrEqual(200);
  });
  it('1,000 appends and 1,000 prepends keep positions short', () => {
    let p = between(null, null);
    let longest = 0;
    for (let i = 0; i < 1000; i++) {
      const n = between(p, null);
      ok(p, n, null);
      p = n;
      longest = Math.max(longest, n.length);
    }
    expect(longest).toBeLessThanOrEqual(40);
    p = between(null, null);
    longest = 0;
    for (let i = 0; i < 1000; i++) {
      const n = between(null, p);
      ok(null, n, p);
      p = n;
      longest = Math.max(longest, n.length);
    }
    expect(longest).toBeLessThanOrEqual(200);
  });
});

describe('spread', () => {
  it('n positions strictly increasing between the bounds; a fresh list is evenly spaced and short', () => {
    for (const n of [1, 2, 3, 10, 61, 62, 500, 5000]) {
      const s = spread(null, null, n);
      expect(s.length).toBe(n);
      s.forEach((p, i) => ok(i ? s[i - 1]! : null, p, null));
      expect(Math.max(...s.map((x) => x.length))).toBeLessThanOrEqual(3);
    }
    const s = spread('V', 'W', 100);
    s.forEach((p, i) => ok(i ? s[i - 1]! : 'V', p, 'W'));
    expect(Math.max(...s.map((x) => x.length))).toBeLessThanOrEqual(4);
    expect(spread('V', 'W', 0)).toEqual([]);
  });
});
