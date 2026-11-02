/* BEUK:section-order — positions for the book's section order (spec 2026-11-01-beuk-2-section-order).

   A position is a fraction 0.d1d2d3… written in base 62 ("0-9A-Za-z", in
   ASCII order) without its trailing zeros, so the plain string order is the
   numeric order. between(a, b) gives a position strictly between two (null:
   the start / the end of the book); spread(a, b, n) gives n of them, evenly
   bisected so their length grows with log(n). Appending (b null) and
   prepending (a null) step one digit, so a book grown one chapter at a time
   keeps short positions. Pure, no dependency. */

export const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const ZERO = DIGITS[0]!;
const dig = (ch: string | undefined): number => (ch === undefined ? 0 : DIGITS.indexOf(ch));

/** True when `p` is a usable position: non-empty, base-62 digits only, no trailing zero. */
export const isPosition = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && /^[0-9A-Za-z]+$/.test(p) && !p.endsWith(ZERO);

/** The midpoint of two fractions given as digit strings (a may be "", b null = 1). */
function mid(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n));
  }
  const da = a ? dig(a[0]) : 0;
  const db = b !== null ? dig(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da]! + mid(a.slice(1), null);
}

/** A position strictly between `a` and `b` (null: the start, the end). Throws unless a < b. */
export function between(a: string | null, b: string | null): string {
  if (a !== null && !isPosition(a)) throw new Error(`bad position "${a}"`);
  if (b !== null && !isPosition(b)) throw new Error(`bad position "${b}"`);
  if (a !== null && b !== null && a >= b) throw new Error(`positions out of order: "${a}" >= "${b}"`);
  if (a !== null && b === null) {
    // append: the first digit that can step up does (a + one step < 1, and no trailing zero)
    for (let i = 0; i < a.length; i++) {
      const d = dig(a[i]);
      if (d < BASE - 1) return a.slice(0, i) + DIGITS[d + 1];
    }
    return a + mid('', null);
  }
  if (a === null && b !== null) {
    // prepend: step the first digit down when it stays above zero
    const d = dig(b[0]);
    if (d > 1) return DIGITS[d - 1]!;
    return mid('', b);
  }
  return mid(a ?? '', b);
}

/** `n` positions strictly between `a` and `b`, in increasing order. */
export function spread(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (a === null && b === null) {
    // a fresh list: evenly spaced, as short as n allows
    let len = 1;
    while (BASE ** len <= n * 2) len++;
    const span = BASE ** len;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      let v = Math.round(((i + 1) * span) / (n + 1));
      let s = '';
      for (let k = 0; k < len; k++) {
        s = DIGITS[v % BASE]! + s;
        v = Math.floor(v / BASE);
      }
      out.push(s.replace(/0+$/, ''));
    }
    return out;
  }
  const m = between(a, b);
  if (n === 1) return [m];
  const left = Math.floor((n - 1) / 2);
  return [...spread(a, m, left), m, ...spread(m, b, n - 1 - left)];
}
