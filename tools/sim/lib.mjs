// Shared helpers for the Beuk simulation (plain Node ESM, no dependencies).
import { createHash } from 'node:crypto';

/** mulberry32: a small, well-known 32-bit PRNG. Same seed -> same sequence. */
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hash32(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; },
    sample: (arr, n) => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2.slice(0, n); },
  };
}
/** FNV-1a 32-bit. */
export function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** JSON with sorted keys: the byte form the world hash is taken over. */
export function stableJson(v, indent = 1) {
  const norm = (x) => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = norm(x[k]); return o; }
    return x;
  };
  return JSON.stringify(norm(v), null, indent) + '\n';
}
export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const WORD_NUMS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen'];
