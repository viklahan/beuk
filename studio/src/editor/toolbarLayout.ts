/* BEUK:toolbar — 1.0's editor toolbar layout (inventory A12;
   client/index.html tbBestSplit / tbApplyFold / tbLayout / tbLayoutInit):
   the toolbar is whole groups; a group never splits across rows. tbLayout
   measures the groups (a measuring pass, applied and removed inside one
   synchronous call, so it never paints) at each fold level, picks the row
   breaks that make the rows as even as the width allows, and folds the
   secondary labels to icons in up to three steps (data-collapse 1 → 3)
   when the labelled groups would need more than two rows. A folded label
   stays in the button as visually-hidden text, so the accessible name and
   the tooltip remain. Re-laid out when the toolbar's width changes, when
   its content changes (language, labels), and when Zen comes and goes.
   Left out: the Read Aloud panel's placement (tbPlaceRaPop) — read aloud is
   wave 3. */

export const TB_MAX_FOLD = 3;

export type Split = { rows: number[][]; widest: number; fits: boolean; n: number };

/** 1.0's tbBestSplit: widths[i] is group i with its divider, cost[i] what that divider adds (0 for the first group);
 *  brute force over the 2^(n-1) ways to break n groups into rows. */
export function tbBestSplit(widths: number[], cost: number[], gap: number, W: number): Split {
  const n = widths.length;
  let best: Split | null = null;
  for (let mask = 0; mask < 1 << Math.max(0, n - 1); mask++) {
    const rows: number[][] = [];
    let cur = [0];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) {
        rows.push(cur);
        cur = [i];
      } else cur.push(i);
    }
    rows.push(cur);
    let widest = 0;
    let fits = true;
    for (const r of rows) {
      let w = widths[r[0]!]! - cost[r[0]!]!;
      for (let k = 1; k < r.length; k++) w += gap + widths[r[k]!]!;
      widest = Math.max(widest, w);
      if (w > W + 0.5) fits = false;
    }
    const cand: Split = { rows, widest, fits, n: rows.length };
    if (!best || (cand.fits && !best.fits) || (cand.fits === best.fits && (cand.n < best.n || (cand.n === best.n && cand.widest < best.widest)))) best = cand;
  }
  return best!;
}

/** 1.0's plan choice: the least folding that fits in at most two rows; else, among the levels that fit (or the last
 *  level), the one with the fewest rows. */
export function tbChoose(plans: { level: number; split: Split }[]): { level: number; split: Split } {
  const two = plans.find((p) => p.split.fits && p.split.n <= 2);
  if (two) return two;
  const fitting = plans.filter((p) => p.split.fits);
  const pool = fitting.length ? fitting : plans.slice(-1);
  return pool.reduce((a, b) => (b.split.n < a.split.n ? b : a));
}

function groupsOf(tb: HTMLElement): HTMLElement[] {
  return Array.from(tb.children).filter((el): el is HTMLElement => el.classList.contains('tool-group') && getComputedStyle(el).display !== 'none');
}
function applyFold(tb: HTMLElement, level: number): void {
  tb.querySelectorAll('.tool-btn[data-collapse]').forEach((b) => b.classList.toggle('folded', Number(b.getAttribute('data-collapse')) <= level));
  tb.setAttribute('data-fold', String(level));
}
function contentWidth(tb: HTMLElement): number {
  const cs = getComputedStyle(tb);
  return tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

/** 1.0's tbLayout. Returns the width it laid out for ("" when it could not measure). */
export function tbLayout(tb: HTMLElement): string {
  const W = contentWidth(tb);
  if (!(W > 0)) return '';
  const groups = groupsOf(tb);
  if (!groups.length) return '';
  groups.forEach((g) => {
    if (!g.style.getPropertyValue('--tg-grow')) g.style.setProperty('--tg-grow', String(g.querySelectorAll(':scope > .tool-btn, :scope > .ra-wrap').length || 1));
  });
  const gap = parseFloat(getComputedStyle(tb).columnGap) || 0;
  tb.classList.add('tb-measure');
  const plans: { level: number; split: Split }[] = [];
  for (let level = 0; level <= TB_MAX_FOLD; level++) {
    applyFold(tb, level);
    const widths = groups.map((g) => g.getBoundingClientRect().width);
    const cost = groups.map((g, i) => {
      const sep = g.querySelector<HTMLElement>(':scope > .tool-sep');
      if (!sep || i === 0) return 0;
      const ss = getComputedStyle(sep);
      return sep.getBoundingClientRect().width + parseFloat(ss.marginLeft) + parseFloat(ss.marginRight) + (parseFloat(getComputedStyle(g).columnGap) || 0);
    });
    plans.push({ level, split: tbBestSplit(widths, cost, gap, W) });
  }
  tb.classList.remove('tb-measure');
  const plan = tbChoose(plans);
  applyFold(tb, plan.level);
  const starts = new Set(plan.split.rows.map((r) => r[0]!));
  groups.forEach((g, i) => g.classList.toggle('row-start', starts.has(i)));
  // a break stands just before each row-opening group but the first
  Array.from(tb.children).forEach((el) => {
    if (!el.classList.contains('tool-break')) return;
    let next = el.nextElementSibling;
    while (next && !(next.classList.contains('tool-group') && groups.includes(next as HTMLElement))) next = next.nextElementSibling;
    const gi = next ? groups.indexOf(next as HTMLElement) : -1;
    el.classList.toggle('on', gi > 0 && starts.has(gi));
  });
  tb.setAttribute('data-rows', String(plan.split.n));
  return String(W);
}

/** 1.0's tbLayoutInit for one toolbar: lay out now, and again on a width change, a content change, Zen in or out.
 *  Returns the cleanup. */
export function tbLayoutInit(tb: HTMLElement): () => void {
  let last = tbLayout(tb);
  let queued = 0;
  const queue = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      last = tbLayout(tb);
    });
  };
  const cleanups: (() => void)[] = [];
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (String(contentWidth(tb)) !== last) queue();
    });
    ro.observe(tb);
    cleanups.push(() => ro.disconnect());
  } else {
    window.addEventListener('resize', queue);
    cleanups.push(() => window.removeEventListener('resize', queue));
  }
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver((list) => {
      if (list.some((m) => !(m.target instanceof Element ? m.target : m.target.parentElement)?.closest('#raPop'))) queue();
    });
    mo.observe(tb, { childList: true, characterData: true, subtree: true });
    let wasZen = document.body.classList.contains('zen');
    const zo = new MutationObserver(() => {
      const z = document.body.classList.contains('zen');
      if (z !== wasZen) {
        wasZen = z;
        queue();
      }
    });
    zo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    cleanups.push(() => {
      mo.disconnect();
      zo.disconnect();
    });
  }
  return () => {
    if (queued) cancelAnimationFrame(queued);
    cleanups.forEach((f) => f());
  };
}
