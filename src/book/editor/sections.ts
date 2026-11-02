import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { toDoc } from './convert.js';
import { between, isPosition, spread } from './order.js';

/* BEUK:sections — the one door to a book's sections (spec 2026-11-01-beuk-2-section-order, model v2).

   - `secs` (Y.Map): key -> one section, stored exactly as the v1 array held
     it (a Y.Map whose `body` is the chapter's Y.XmlFragment, keys escaped;
     an entry that is not an object stays its JSON value).
   - `order` (Y.Map): key -> the section's position (order.ts).
   - `layout.model` is 2. `sections` (the v1 Y.Array) is empty once migrated.

   The book order: every key in both maps, by (position, key); the key breaks
   ties, so two tabs inserting at one spot at once read the same order. A key
   in `secs` without a usable position (a broken write) goes last, by key; a
   position whose section is gone is ignored. A key is internal (random, 12
   characters), never a 1.0 id, and never leaves the Y.Doc.

   A move is one `order` write: the section's Y.Map, its fragment and every
   editor bound to them stay. Only this module touches `secs` and `order`.

   v1 (one Y.Array) stays readable, read only, until migrateSections runs (on
   open): its keys read as "m" + the index in 6 digits, the very keys the
   migration writes, so a key read before the migration names the same
   section after it. Any write through this door migrates first. */

export const SECTIONS = 'sections';
export const SECS = 'secs';
export const ORDER = 'order';
export const LAYOUT = 'layout';
export const BODY = 'body';
export const MODEL = 2;
/** The origin of the v1 -> v2 migration's one transaction (storage housekeeping, never a writer's edit). */
export const MIGRATE_ORIGIN = 'beuk-migrate';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The Y.Map key a section's book key is stored under ("body" and "~…" gain a leading "~"). */
export const escKey = (k: string): string => (k === BODY || k.startsWith('~') ? '~' + k : k);

const secsOf = (y: Y.Doc) => y.getMap<unknown>(SECS);
const orderOf = (y: Y.Doc) => y.getMap<unknown>(ORDER);
const arrOf = (y: Y.Doc) => y.getArray<unknown>(SECTIONS);
const migKey = (i: number): string => 'm' + String(i).padStart(6, '0');
const MIG_KEY = /^m(\d{6})$/;

/** True when the doc still holds its sections in the v1 array (not migrated yet). */
export function isV1(ydoc: Y.Doc): boolean {
  return ydoc.getMap<unknown>(LAYOUT).get('model') !== MODEL && arrOf(ydoc).length > 0;
}

/** The section keys, in book order. */
export function sectionKeys(ydoc: Y.Doc): string[] {
  if (isV1(ydoc)) return arrOf(ydoc).toArray().map((_s, i) => migKey(i));
  const order = orderOf(ydoc);
  const placed: [string, string][] = [];
  const loose: string[] = [];
  for (const k of secsOf(ydoc).keys()) {
    const p = order.get(k);
    if (isPosition(p)) placed.push([p, k]);
    else loose.push(k);
  }
  placed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  loose.sort();
  return [...placed.map((x) => x[1]), ...loose];
}

/** One section (its Y.Map, or the JSON value of an entry that is not an object), or undefined. */
export function sectionByKey(ydoc: Y.Doc, key: string): unknown {
  if (isV1(ydoc)) {
    const m = MIG_KEY.exec(key);
    const a = arrOf(ydoc);
    return m && Number(m[1]) < a.length ? a.get(Number(m[1])) : undefined;
  }
  return secsOf(ydoc).get(key);
}

/** The section at book index `i`, or undefined. */
export function sectionAt(ydoc: Y.Doc, i: number): unknown {
  const k = sectionKeys(ydoc)[i];
  return k === undefined ? undefined : sectionByKey(ydoc, k);
}

/** Every section, in book order. */
export function sectionList(ydoc: Y.Doc): unknown[] {
  if (isV1(ydoc)) return arrOf(ydoc).toArray();
  const secs = secsOf(ydoc);
  return sectionKeys(ydoc).map((k) => secs.get(k));
}

export function sectionsCount(ydoc: Y.Doc): number {
  return isV1(ydoc) ? arrOf(ydoc).length : sectionKeys(ydoc).length;
}

/** The key of the section whose 1.0 `id` is `id` (the first, in book order), or null. */
export function keyOfId(ydoc: Y.Doc, id: string): string | null {
  for (const k of sectionKeys(ydoc)) {
    const s = sectionByKey(ydoc, k);
    const v = s instanceof Y.Map ? s.get('id') : isRec(s) ? s.id : undefined;
    if (v === id) return k;
  }
  return null;
}

/** The Y types that hold the sections (an undo scope). */
export function sectionTypes(ydoc: Y.Doc): Y.AbstractType<unknown>[] {
  return [secsOf(ydoc), orderOf(ydoc), arrOf(ydoc)] as Y.AbstractType<unknown>[];
}

/* ---- writes ---- */

const KEY_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newKey(taken: Y.Map<unknown>): string {
  for (;;) {
    const b = new Uint8Array(12);
    globalThis.crypto.getRandomValues(b);
    let k = '';
    for (const x of b) k += KEY_DIGITS[x % 62];
    if (!taken.has(k)) return k;
  }
}

/** The v1 -> v2 migration: each array entry copied into `secs` under "m" + its index (6 digits), positions spread by
 *  index, layout.model = 2, the array emptied; ONE transaction (origin beuk-migrate). Deterministic, so two tabs
 *  migrating the same v1 book at once write the same keys and converge to one copy. False when there was nothing to do. */
export function migrateSections(ydoc: Y.Doc): boolean {
  if (!isV1(ydoc)) return false;
  ydoc.transact(() => {
    const arr = arrOf(ydoc), secs = secsOf(ydoc), order = orderOf(ydoc);
    const list = arr.toArray();
    const pos = spread(null, null, list.length);
    list.forEach((s, i) => {
      secs.set(migKey(i), s instanceof Y.AbstractType ? s.clone() : s);
      order.set(migKey(i), pos[i]!);
    });
    ydoc.getMap<unknown>(LAYOUT).set('model', MODEL);
    arr.delete(0, arr.length);
  }, MIGRATE_ORIGIN);
  return true;
}

/** Longest run of `keys` (in this order) whose current positions strictly increase: they keep their positions. */
function keepers(ydoc: Y.Doc, keys: string[]): Set<string> {
  const order = orderOf(ydoc);
  const tails: number[] = []; // index into keys of the smallest tail of each length
  const back: number[] = new Array(keys.length).fill(-1);
  const posOf = (i: number) => order.get(keys[i]!) as string;
  for (let i = 0; i < keys.length; i++) {
    const p = order.get(keys[i]!);
    if (!isPosition(p)) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (posOf(tails[m]!) < p) lo = m + 1;
      else hi = m;
    }
    back[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const keep = new Set<string>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = back[i]!) keep.add(keys[i]!);
  return keep;
}

/** Give `keys` (every section, in the wanted order) positions: those in the longest run already in order keep theirs,
 *  each other one gets a new position between its kept neighbours. Call inside a transaction. */
function place(ydoc: Y.Doc, keys: string[]): void {
  const order = orderOf(ydoc);
  const keep = keepers(ydoc, keys);
  let i = 0;
  while (i < keys.length) {
    if (keep.has(keys[i]!)) { i++; continue; }
    let j = i;
    while (j < keys.length && !keep.has(keys[j]!)) j++;
    const lo = i > 0 ? (order.get(keys[i - 1]!) as string) : null;
    const hi = j < keys.length ? (order.get(keys[j]!) as string) : null;
    const ps = spread(lo, hi, j - i);
    for (let k = i; k < j; k++) if (order.get(keys[k]!) !== ps[k - i]) order.set(keys[k]!, ps[k - i]!);
    i = j;
  }
}

/** A section as `secs` stores it: a Y.Map (its string `content` as a `body` fragment, filled once integrated), or the
 *  JSON value of an entry that is not an object. */
function store(secs: Y.Map<unknown>, key: string, s: unknown): void {
  if (!isRec(s)) { secs.set(key, s); return; }
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(s)) {
    if (k === 'content' && typeof v === 'string') m.set(BODY, new Y.XmlFragment());
    else m.set(escKey(k), v);
  }
  secs.set(key, m);
  if (typeof s.content === 'string') prosemirrorToYXmlFragment(toDoc(s.content), m.get(BODY) as Y.XmlFragment);
}

/** Insert book-format sections so the first stands at book index `index` (clamped). One transaction; returns their keys. */
export function insertSectionsAt(ydoc: Y.Doc, index: number, list: readonly unknown[]): string[] {
  migrateSections(ydoc);
  const out: string[] = [];
  ydoc.transact(() => {
    const secs = secsOf(ydoc);
    const keys = sectionKeys(ydoc);
    const at = Math.max(0, Math.min(index, keys.length));
    for (const s of list) {
      const k = newKey(secs);
      store(secs, k, s);
      out.push(k);
    }
    keys.splice(at, 0, ...out);
    place(ydoc, keys);
  });
  return out;
}

/** Remove one section (its entry and its position). One transaction. */
export function removeSection(ydoc: Y.Doc, key: string): void {
  migrateSections(ydoc);
  ydoc.transact(() => {
    secsOf(ydoc).delete(key);
    orderOf(ydoc).delete(key);
  });
}

/** Move a section so it stands at `toIndex` of the list without it (clamped): its position only. One transaction. */
export function moveSection(ydoc: Y.Doc, key: string, toIndex: number): void {
  migrateSections(ydoc);
  const keys = sectionKeys(ydoc);
  const from = keys.indexOf(key);
  if (from < 0) return;
  keys.splice(from, 1);
  keys.splice(Math.max(0, Math.min(toIndex, keys.length)), 0, key);
  ydoc.transact(() => place(ydoc, keys));
}

/** Put the sections in the order `keys` gives (normally every key of the book). A key named twice counts once, at its
 *  first place; a key of the book not named keeps its slot (its index) while the named ones fill the other slots in
 *  the order given. Only the sections whose place changed get a new position. One transaction. */
export function setSectionOrder(ydoc: Y.Doc, keys: readonly string[]): void {
  migrateSections(ydoc);
  const secs = secsOf(ydoc);
  const want = [...new Set(keys)].filter((k) => secs.has(k));
  const named = new Set(want);
  const all = sectionKeys(ydoc);
  // keys left out keep their slot; the named ones fill the remaining slots in the order given
  const full: string[] = [];
  let wi = 0;
  for (const k of all) {
    if (named.has(k)) full.push(want[wi++]!);
    else full.push(k);
  }
  ydoc.transact(() => place(ydoc, full));
}

/** Run `fn` when the sections change: their list, their order, or a section's own fields (a retype, the include eye);
 *  never on typing inside a chapter's text. Returns the unsubscribe. */
export function observeSections(ydoc: Y.Doc, fn: () => void): () => void {
  const secs = secsOf(ydoc), order = orderOf(ydoc), arr = arrOf(ydoc);
  const deep = (evs: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    if (evs.some((e) => e.target === secs || e.target === arr || (e.target instanceof Y.Map && (e.target.parent === secs || e.target.parent === arr)))) fn();
  };
  const on = () => fn();
  secs.observeDeep(deep);
  arr.observeDeep(deep);
  order.observe(on);
  return () => {
    secs.unobserveDeep(deep);
    arr.unobserveDeep(deep);
    order.unobserve(on);
  };
}

