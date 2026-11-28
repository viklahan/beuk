import { beforeAll, describe, expect, it } from 'vitest';
import { loadClosure, type Closure } from '../src/closure/index';

/* Across both pages — the one two-page crop (1.0's acrossCrop), reached through the closure. */
let c: Closure;
beforeAll(async () => {
  c = await loadClosure();
});

describe('acrossCrop', () => {
  it('a 1408 x 768 picture on 6 x 9, no bleed: crop 1024 x 768 centred, halves 512 wide meeting at x = 704', () => {
    const r = c.api.acrossCrop(1408, 768, { w: 6, h: 9 }, 0, false);
    expect(r.crop).toEqual({ x: 192, y: 0, w: 1024, h: 768 });
    expect(r.verso).toEqual({ x: 192, y: 0, w: 512, h: 768 });
    expect(r.recto).toEqual({ x: 704, y: 0, w: 512, h: 768 });
    expect(Math.round(r.ppi)).toBe(85);
  });
  it('with 0.125 in bleed the shape is 12.25 : 9.25', () => {
    const r = c.api.acrossCrop(2000, 1500, { w: 6, h: 9 }, 0.125, false);
    expect(Math.abs(r.crop.w / r.crop.h - 12.25 / 9.25) * r.crop.h).toBeLessThanOrEqual(1);
    expect(r.ppi).toBeCloseTo(r.crop.w / 12.25, 6);
  });
  it('RTL: verso is the right half', () => {
    const r = c.api.acrossCrop(1408, 768, { w: 6, h: 9 }, 0, true);
    expect(r.verso.x).toBe(r.crop.x + r.crop.w / 2);
    expect(r.recto.x).toBe(r.crop.x);
  });
  it('a picture taller than the spread shape is cropped top and bottom, centred', () => {
    const r = c.api.acrossCrop(1000, 2000, { w: 6, h: 9 }, 0, false);
    expect(r.crop.x).toBe(0);
    expect(r.crop.w).toBe(1000);
    expect(r.crop.y).toBe(Math.floor((2000 - r.crop.h) / 2));
    expect(r.crop.y).toBeGreaterThan(0);
  });
  it('rounding never makes the halves overlap or leave a gap: verso.w + recto.w === crop.w', () => {
    for (const [w, h, bleed, rtl] of [[1001, 600, 0, false], [1001, 600, 0.125, true], [999, 3000, 0.125, false], [1357, 701, 0, true]] as const) {
      const r = c.api.acrossCrop(w, h, { w: 6, h: 9 }, bleed, rtl);
      expect(r.verso.w + r.recto.w).toBe(r.crop.w);
      const [a, b] = rtl ? [r.recto, r.verso] : [r.verso, r.recto];
      expect(a.x + a.w).toBe(b.x);
      expect(a.x).toBe(r.crop.x);
      expect(b.x + b.w).toBe(r.crop.x + r.crop.w);
    }
  });
});
