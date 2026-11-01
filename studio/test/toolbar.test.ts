// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tbBestSplit, tbChoose, TB_MAX_FOLD } from '../src/editor/toolbarLayout';

/* Wave 1b, task 4: 1.0's toolbar layout (inventory A12, no tagged
   self-check). tbBestSplit and the plan choice are 1.0's arithmetic; the
   measuring pass runs in the browser (e2e: the toolbar's rows at two
   widths). */

describe('tbBestSplit (1.0)', () => {
  it('keeps everything on one row when it fits', () => {
    const s = tbBestSplit([100, 120, 80], [0, 10, 10], 4, 400);
    expect(s.fits).toBe(true);
    expect(s.rows).toEqual([[0, 1, 2]]);
    expect(s.widest).toBe(100 + 4 + 120 + 4 + 80);
  });
  it('breaks where the rows come out most even, a row-opening group dropping its divider', () => {
    // 4 groups of 100 (+10 divider each but the first), width 230: two rows of two
    const s = tbBestSplit([100, 110, 110, 110], [0, 10, 10, 10], 4, 230);
    expect(s.fits).toBe(true);
    expect(s.n).toBe(2);
    expect(s.rows).toEqual([[0, 1], [2, 3]]);
    expect(s.widest).toBe(100 + 4 + 110);
  });
  it('says when nothing fits, preferring fewer rows', () => {
    const s = tbBestSplit([300], [0], 4, 200);
    expect(s.fits).toBe(false);
    expect(s.n).toBe(1);
  });
});

describe('tbChoose (1.0)', () => {
  const split = (fits: boolean, n: number) => ({ rows: [], widest: 0, fits, n });
  it('the least folding that fits in two rows', () => {
    expect(tbChoose([{ level: 0, split: split(false, 3) }, { level: 1, split: split(true, 2) }, { level: 2, split: split(true, 1) }]).level).toBe(1);
  });
  it('else the fitting level with the fewest rows, else the last level', () => {
    expect(tbChoose([{ level: 0, split: split(true, 4) }, { level: 1, split: split(true, 3) }]).level).toBe(1);
    expect(tbChoose([{ level: 0, split: split(false, 3) }, { level: TB_MAX_FOLD, split: split(false, 3) }]).level).toBe(TB_MAX_FOLD);
  });
});
