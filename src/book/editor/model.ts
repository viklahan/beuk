import * as Y from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { readBook, type ReadResult } from '../read.js';
import { toDoc, toText } from './convert.js';
import { bookSchema } from './schema.js';
import { sha256Hex } from './sha256.js';

/* BEUK:editor-model — a book as one Y.Doc (step 4 design, goal 5).

   Layout:
   - `meta` (Y.Map): every top-level field of the book except `sections`,
     each stored as a JSON value, untouched.
   - `sections` (Y.Array): one Y.Map per section. Every attribute is a JSON
     value (scenes included) except `content`, which lives as `body`, a
     Y.XmlFragment the chapter's editor binds to. A section whose content is
     not a string keeps it as a JSON `content`; an array entry that is not an
     object stays as its JSON value.
   - `layout` (Y.Map): `keys`, the book's top-level key order, so an export
     writes the keys where the book had them.
   - `blobs` (Y.Map, step 5 wave 1c fix round 1): the book's pictures, fonts,
     cover and research files, each distinct content ONCE, keyed by the
     SHA-256 of its bytes: { mediaType, data }. In `meta` such an object's
     `data` holds 1.0's own name for it, "beuk-pic:<sha256>" (1.0's packed
     device record, BEUK:localpics, f072a76), wherever it stands — images,
     cover, fonts, research, History and its pool. Without it, every
     rewrite of a value holding bytes (a research file added, a History
     snapshot) put all those bytes into the Y update log again, and
     y-indexeddb keeps each update until it compacts. 1.0's rule picks what
     is named (picObjects / localPackRecord): an object with a string
     mediaType and string data of at least 1,024 characters that is
     canonical base64; anything else stays inline. exportBook fills the names
     back in, so the exported book is exactly what was imported; `blobs` is
     never a field of the book.

   Section keys are stored as written except "body" and any key starting
   with "~", which gain a leading "~" (so a 1.0 section that happens to carry
   a "body" key can never collide with the fragment).

   importBook runs readBook (the one door every book goes through) and
   refuses a book readBook did not read as 'ok' ('newer' or 'failed' must
   never be saved). exportBook writes book-format v1 back: each fragment is
   read with y-prosemirror's own reader (the editor's path) and written as
   text with toText. Pure TypeScript: no DOM, runs in Node and the browser.

   The one normalisation: Yjs stores strings as UTF-8 (lib0), so a lone
   UTF-16 surrogate (half of an emoji, cut by some old tool) cannot survive
   it and would silently become U+FFFD. importBook does that replacement
   itself, before anything reaches the Y.Doc, in every string and key of the
   book (section content, meta, everything), and reports each one in
   `textWarnings` (path, section id, field, count) so the studio can tell
   the writer. Nothing else is ever changed. */

export const META = 'meta';
export const SECTIONS = 'sections';
export const LAYOUT = 'layout';
export const BODY = 'body';
export const BLOBS = 'blobs';
/** 1.0's PIC_REF / PIC_MIN (BEUK:pics, BEUK:localpics). */
export const PIC_REF = 'beuk-pic:';
export const PIC_MIN = 1024;
/** The transaction origin of 2.0's own storage housekeeping (packing, a blob let go): never a writer's edit. */
export const BLOB_ORIGIN = 'beuk-blobs';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Own data property, so a key such as "__proto__" is set as data, never as the prototype. */
const setOwn = (o: Rec, k: string, v: unknown): void => {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
};
/** The Y.Map key a section's book key is stored under ("body" and "~…" gain a leading "~"). */
export const escKey = (k: string): string => (k === BODY || k.startsWith('~') ? '~' + k : k);
const unescKey = (k: string): string => (k.startsWith('~') ? k.slice(1) : k);
const plain = (v: unknown): unknown => (v instanceof Y.AbstractType ? v.toJSON() : v === undefined ? v : structuredClone(v));

/** A string (or key) importBook had to change: lone surrogates replaced with U+FFFD. `sectionId` names the section when the
 *  string is inside one; `field` is the key holding it (for a renamed key, the key itself). */
export type TextWarning = { code: 'lone-surrogate'; path: string; sectionId: string | null; field: string; count: number };
export type ImportResult = Omit<ReadResult, 'book'> & { ydoc: Y.Doc; textWarnings: TextWarning[] };

const SURROGATE = /[\uD800-\uDFFF]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `v` with every lone surrogate in its strings and keys replaced by U+FFFD; each change is reported. */
function wellFormed(v: unknown, path: string, sectionId: string | null, field: string, out: TextWarning[]): unknown {
  if (typeof v === 'string') {
    if (!SURROGATE.test(v)) return v;
    let count = 0;
    const w = v.replace(LONE_SURROGATE, () => { count++; return '\uFFFD'; });
    if (count) out.push({ code: 'lone-surrogate', path, sectionId, field, count });
    return w;
  }
  if (Array.isArray(v)) {
    let changed = false;
    const a = v.map((x, i) => { const y = wellFormed(x, `${path}[${i}]`, sectionId, field, out); if (y !== x) changed = true; return y; });
    return changed ? a : v;
  }
  if (isRec(v)) {
    let changed = false;
    const o: Rec = {};
    for (const [k, x] of Object.entries(v)) {
      const nk = wellFormed(k, path ? `${path}.${k}` : k, sectionId, k, out) as string;
      const y = wellFormed(x, path ? `${path}.${nk}` : nk, sectionId, nk, out);
      if (nk !== k || y !== x) changed = true;
      setOwn(o, nk, y);
    }
    return changed ? o : v;
  }
  return v;
}

/** The read book made safe for Yjs (lone surrogates only), with the list of what changed. */
function forYjs(book: Rec): { book: Rec; textWarnings: TextWarning[] } {
  const textWarnings: TextWarning[] = [];
  const out: Rec = {};
  for (const [k, v] of Object.entries(book)) {
    if (k === 'sections' && Array.isArray(v)) {
      setOwn(out, k, v.map((sec, i) => wellFormed(sec, `sections[${i}]`, isRec(sec) && typeof sec.id === 'string' ? sec.id : null, 'sections', textWarnings)));
    } else {
      const nk = wellFormed(k, k, null, k, textWarnings) as string;
      setOwn(out, nk, wellFormed(v, nk, null, nk, textWarnings));
    }
  }
  return { book: out, textWarnings };
}

export class BookImportError extends Error {
  readonly read: ReadResult;
  constructor(read: ReadResult) {
    super(`this book cannot be opened for editing: readBook returned status '${read.status}'`);
    this.name = 'BookImportError';
    this.read = read;
  }
}

export class BookExportError extends Error {
  constructor(detail: string) {
    super(`this book cannot be exported: ${detail}`);
    this.name = 'BookExportError';
  }
}

/** A 1.0 backup file (`.beuk-backup.json`: { format: "beuk-backup", version, exportedAt, book }) -> its book; anything else as is. */
export function unwrapBackup(doc: unknown): unknown {
  return isRec(doc) && doc.format === 'beuk-backup' && Object.hasOwn(doc, 'book') ? doc.book : doc;
}

/** Open a book (or a backup file) into a fresh Y.Doc. Throws BookImportError unless readBook reads it as 'ok'. */
export function importBook(doc: unknown, ydoc: Y.Doc = new Y.Doc()): ImportResult {
  const read = readBook(unwrapBackup(doc));
  if (read.status !== 'ok') throw new BookImportError(read);
  const { book, textWarnings } = forYjs(read.book as unknown as Rec);
  const meta = ydoc.getMap<unknown>(META);
  const sections = ydoc.getArray<unknown>(SECTIONS);
  const layout = ydoc.getMap<unknown>(LAYOUT);
  ydoc.transact(() => {
    for (const [k, v] of Object.entries(book)) if (k !== 'sections') meta.set(k, packValue(ydoc, v, true));
    layout.set('keys', Object.keys(book));
    insertSections(sections, 0, Array.isArray(book.sections) ? book.sections : []);
  });
  const { book: _book, ...rest } = read;
  return { ...rest, ydoc, textWarnings };
}

const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/; // y-prosemirror's hashed name for a mark that may overlap itself

/** y-prosemirror's reader deletes, from the Y.Doc, any element or text it cannot build. Check first, so an export never edits the book. */
function assertKnown(t: Y.XmlFragment | Y.XmlElement, where: string, top = true): void {
  for (const c of t.toArray()) {
    if (c instanceof Y.XmlElement) {
      if (!bookSchema.nodes[c.nodeName]) throw new BookExportError(`${where}: unknown node "${c.nodeName}"`);
      assertKnown(c, where, false);
    } else if (c instanceof Y.XmlText) {
      if (top) throw new BookExportError(`${where}: text outside a block`);
      for (const op of c.toDelta() as { attributes?: Rec }[])
        for (const name of Object.keys(op.attributes ?? {})) {
          const mark = HASHED_MARK.exec(name)?.[1] ?? name;
          if (!bookSchema.marks[mark]) throw new BookExportError(`${where}: unknown mark "${mark}"`);
        }
    } else {
      throw new BookExportError(`${where}: unexpected ${c.constructor.name}`);
    }
  }
}

/** A section fragment's text, as 1.0's `content`. */
export function fragmentText(frag: Y.XmlFragment, where = 'section'): string {
  assertKnown(frag, where);
  return toText(yXmlFragmentToProseMirrorRootNode(frag, bookSchema));
}

/** Insert book-format sections into the `sections` Y.Array at `index`, exactly as importBook stores them (each section a
 *  Y.Map, its string `content` a `body` fragment). Each section is inserted and then filled, in order; call it inside a
 *  transaction to make the whole insert one change. */
export function insertSections(sections: Y.Array<unknown>, index: number, list: readonly unknown[]): void {
  let at = index;
  for (const s of list) {
    if (!isRec(s)) { sections.insert(at++, [s]); continue; }
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(s)) {
      if (k === 'content' && typeof v === 'string') m.set(BODY, new Y.XmlFragment());
      else m.set(escKey(k), v);
    }
    sections.insert(at++, [m]);
    if (typeof s.content === 'string') prosemirrorToYXmlFragment(toDoc(s.content), m.get(BODY) as Y.XmlFragment);
  }
}

/** One entry of the `sections` Y.Array as book-format v1 (what exportBook writes for it). */
export function sectionPlain(s: unknown, where = 'section'): unknown {
  if (!(s instanceof Y.Map)) return plain(s);
  const o: Rec = {};
  for (const [sk, v] of s.entries()) {
    if (sk === BODY && v instanceof Y.XmlFragment) setOwn(o, 'content', fragmentText(v, where));
    else setOwn(o, unescKey(sk), plain(v));
  }
  return o;
}

/** The Y.Doc -> a book-format v1 document (the `book` of a backup), keys in the order the book had them. */
export function exportBook(ydoc: Y.Doc): Rec {
  const meta = ydoc.getMap<unknown>(META);
  const sections = ydoc.getArray<unknown>(SECTIONS);
  const order = ydoc.getMap<unknown>(LAYOUT).get('keys');
  const keys = Array.isArray(order) ? order.filter((k): k is string => typeof k === 'string') : [];
  for (const k of meta.keys()) if (!keys.includes(k)) keys.push(k);
  if (!Array.isArray(order) && !keys.includes('sections')) keys.push('sections'); // a doc without a layout (not made by importBook)
  const out: Rec = {};
  for (const k of keys) {
    if (k === 'sections') {
      setOwn(out, k, sections.toArray().map((s, i) => sectionPlain(s, `sections[${i}]`)));
    } else if (meta.has(k)) {
      setOwn(out, k, unpackValue(ydoc, plain(meta.get(k))));
    }
  }
  return out;
}

/* ---- the content-addressed picture store (BLOBS) ---- */

/** 1.0's picIsRef. */
export const isPicRef = (v: unknown): v is string => typeof v === 'string' && v.length === 73 && v.startsWith(PIC_REF) && /^[0-9a-f]{64}$/.test(v.slice(9));

/** 1.0's picSwap: a copy of `v` with each picture-shaped object's `data` (a string beside a string `mediaType`) replaced
 *  by swap(data) when that returns a string; only the objects on the way to a change are copied. */
export function picSwapValue(v: unknown, swap: (data: string, owner: Rec) => string | null): unknown {
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const x = v[i], y = x && typeof x === 'object' ? picSwapValue(x, swap) : x;
      if (y !== x) {
        if (!out) out = v.slice();
        out[i] = y;
      }
    }
    return out || v;
  }
  if (!isRec(v)) return v;
  let out: Rec | null = null;
  for (const k of Object.keys(v)) {
    const x = v[k];
    let y = x;
    if (k === 'data' && typeof x === 'string' && typeof v.mediaType === 'string') {
      const r = swap(x, v);
      if (typeof r === 'string') y = r;
    } else if (x && typeof x === 'object') y = picSwapValue(x, swap);
    if (y !== x) {
      if (!out) out = { ...v };
      setOwn(out, k, y);
    }
  }
  return out || v;
}

const shaMemo = new Map<string, string>();
/** 1.0's picShaOf: the SHA-256 of the bytes a canonical base64 string holds, or "" (not canonical: stays inline). */
export function shaOfData(data: string): string {
  const hit = shaMemo.get(data);
  if (hit !== undefined) return hit;
  let sha = '';
  try {
    const bin = atob(data);
    if (btoa(bin) === data) {
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      sha = sha256Hex(b);
    }
  } catch {
    sha = '';
  }
  shaMemo.set(data, sha);
  while (shaMemo.size > 400) shaMemo.delete(shaMemo.keys().next().value!);
  return sha;
}

/** A value as `meta` holds it: each big picture's data named (1.0's localPackRecord rule). With `write`, a content not in
 *  `blobs` yet is added there (once: an existing entry is never set again). Call inside the write's transaction. */
export function packValue(ydoc: Y.Doc, v: unknown, write: boolean): unknown {
  if (!v || typeof v !== 'object') return v;
  const blobs = ydoc.getMap<unknown>(BLOBS);
  return picSwapValue(v, (data, owner) => {
    if (data.length < PIC_MIN || isPicRef(data)) return null;
    const sha = shaOfData(data);
    if (!sha) return null;
    if (write && !blobs.has(sha)) blobs.set(sha, { mediaType: String(owner.mediaType), data });
    return PIC_REF + sha;
  });
}

/** A stored value with its pictures' names filled back in from `blobs` (a name the store does not hold stays a name). */
export function unpackValue(ydoc: Y.Doc, v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const blobs = ydoc.getMap<unknown>(BLOBS);
  if (!blobs.size) return v;
  return picSwapValue(v, (x) => {
    if (!isPicRef(x)) return null;
    const b = blobs.get(x.slice(PIC_REF.length)) as { data?: unknown } | undefined;
    return b && typeof b.data === 'string' ? b.data : null;
  });
}

/** Set a top-level book value: a new value (structured clone), its pictures stored once in `blobs` and named. undefined
 *  removes the key. Make it part of the caller's transaction. */
export function setMetaValue(ydoc: Y.Doc, key: string, value: unknown): void {
  const meta = ydoc.getMap<unknown>(META);
  ydoc.transact(() => {
    if (value === undefined) meta.delete(key);
    else meta.set(key, packValue(ydoc, structuredClone(value), true));
  });
}

/** A top-level book value with its pictures filled in (a fresh copy), or undefined. */
export function getMetaValue(ydoc: Y.Doc, key: string): unknown {
  const meta = ydoc.getMap<unknown>(META);
  return meta.has(key) ? unpackValue(ydoc, plain(meta.get(key))) : undefined;
}

/** Every picture name the book's values hold (History and its pool included). */
export function picRefsInMeta(ydoc: Y.Doc): Set<string> {
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (isPicRef(v)) seen.add(v.slice(PIC_REF.length));
      return;
    }
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRec(v)) for (const k of Object.keys(v)) walk(v[k]);
  };
  for (const v of ydoc.getMap<unknown>(META).values()) walk(v);
  return seen;
}

/** Let go of every stored picture no value names any more; never one still named anywhere. Returns how many went. */
export function collectBlobs(ydoc: Y.Doc): number {
  const blobs = ydoc.getMap<unknown>(BLOBS);
  if (!blobs.size) return 0;
  const named = picRefsInMeta(ydoc);
  const gone = Array.from(blobs.keys()).filter((k) => !named.has(k));
  if (gone.length) ydoc.transact(() => gone.forEach((k) => blobs.delete(k)), BLOB_ORIGIN);
  return gone.length;
}

/** A book stored before `blobs` existed (2.0 waves 1a-1c held its pictures inline in `meta`): every value that holds a
 *  picture to name is stored again, packed, in ONE transaction. A storage change only: exportBook is the same before and
 *  after. Returns whether anything changed. */
export function packBlobs(ydoc: Y.Doc): boolean {
  const meta = ydoc.getMap<unknown>(META);
  const changed: [string, unknown][] = [];
  for (const [k, v] of meta.entries()) {
    const p = packValue(ydoc, v, false);
    if (p !== v) changed.push([k, v]);
  }
  if (!changed.length) return false;
  ydoc.transact(() => {
    for (const [k, v] of changed) meta.set(k, packValue(ydoc, structuredClone(v), true));
  }, BLOB_ORIGIN);
  return true;
}
