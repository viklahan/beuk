import * as Y from 'yjs';
import { escKey, META, SECTIONS, unpackValue } from '@book/editor/index.js';
import type { BookImage, Closure } from '../closure/index';
import { repackHistory } from '../history/history';
import { setMeta } from '../book/hooks';

/* BEUK:pictures — the book's pictures in 2.0 (step 5 wave 2b: inventory A6,
   A7, A8). Where they live is where 1.0 keeps them (constraint 14): the
   book's `images` list (state.images, a `meta` value in 2.0; its bytes are
   stored once per content in the Y map `blobs` and named
   "beuk-pic:<sha256>" there, wave 1c fix round 1), a section's plateId /
   plateAlt / backdropId / backdropStrength / scenes keys, and the picture
   markers in its text.

   Every change to `images` goes through History's repackHistory (wave 1a
   ruling 2): History is packed against the book's pictures, so a snapshot
   keeps restoring the OLD picture after the library changes.

   Showing a picture (constraint 15): the book's picture data is untrusted.
   It reaches the page only as a data: URL 2.0 builds itself (the policy's
   img-src allows data:, not blob:, exactly as for 1.0, which shows its
   pictures as data: URLs too) and only after its bytes are checked here:
   canonical base64, the first bytes a JPEG, PNG, GIF, WebP or SVG file
   starts with, the URL typed by what the bytes are (never by the book's
   mediaType alone), and a raster picture's stated size under
   SHOW_MAX_PIXELS. An SVG is only ever an <img> (no script runs in an
   image), never markup. Anything else is not shown: the place says
   "missing", as 1.0's section card does for a picture it cannot find. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/* ---- checked bytes → a data: URL ---- */

export type PictureKind = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/svg+xml';
/** A raster picture stating more pixels than this is not decoded for a thumbnail (a "pixel bomb": a few kB that
 *  claim 30,000 × 30,000). 64 MP is beyond every camera photo a writer uploads (a 48 MP phone photo shows). */
export const SHOW_MAX_PIXELS = 64_000_000;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The first `n` bytes a base64 string holds (no more is decoded). */
function headBytes(data: string, n: number): Uint8Array {
  const take = Math.min(data.length, Math.ceil(n / 3) * 4);
  let bin = '';
  try {
    bin = atob(data.slice(0, take));
  } catch {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(Math.min(n, bin.length));
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const be32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** A raster picture's stated size (width × height) from its header, or null when the header does not say (JPEG: the
 *  first frame header within the first 64 kB). */
function statedPixels(kind: PictureKind, b: Uint8Array): number | null {
  if (kind === 'image/png') return b.length >= 24 ? be32(b, 16) * be32(b, 20) : null;
  if (kind === 'image/gif') return b.length >= 10 ? le16(b, 6) * le16(b, 8) : null;
  if (kind === 'image/webp') {
    const four = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (four === 'VP8X' && b.length >= 30) return (le24(b, 24) + 1) * (le24(b, 27) + 1);
    if (four === 'VP8 ' && b.length >= 30) return (le16(b, 26) & 0x3fff) * (le16(b, 28) & 0x3fff);
    if (four === 'VP8L' && b.length >= 25) {
      const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return ((v & 0x3fff) + 1) * (((v >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  if (kind === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = be16(b, i + 2);
      // SOF0..SOF15, less DHT (C4), JPG (C8), DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return be16(b, i + 5) * be16(b, i + 7);
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** What the bytes are, when they are one of the picture kinds 2.0 shows; null otherwise. */
export function sniffPicture(data: unknown, mediaType?: unknown): PictureKind | null {
  if (typeof data !== 'string' || data.length < 8 || data.length % 4 !== 0 || !B64.test(data)) return null;
  const b = headBytes(data, 64 * 1024);
  let kind: PictureKind | null = null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) kind = 'image/jpeg';
  else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) kind = 'image/png';
  else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) kind = 'image/gif';
  else if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') kind = 'image/webp';
  else if (mediaType === 'image/svg+xml') {
    // text: a BOM and white space, then an XML declaration, a comment, a doctype or the svg element itself
    const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 1024)).replace(/^﻿/, '').trimStart();
    if (/^(<\?xml|<!--|<!doctype svg|<svg[\s>])/i.test(head) && /<svg[\s>]/i.test(head + ' ')) kind = 'image/svg+xml';
  }
  if (!kind) return null;
  if (kind !== 'image/svg+xml') {
    const px = statedPixels(kind, b);
    if (px === null || !(px > 0) || px > SHOW_MAX_PIXELS) return null;
  }
  return kind;
}

/* One data: URL per picture content, built once (the thumbnails of a reopened library reuse it, never a fresh copy of
   the bytes). Bounded by the characters it holds. */
const urlMemo = new Map<string, { svg?: string | null; raster?: string | null }>();
let urlChars = 0;
const URL_MEMO_CHARS = 48 * 1024 * 1024;

/** The data: URL 2.0 shows a picture through, or null when its bytes are not a picture it shows. */
export function pictureSrc(im: unknown): string | null {
  if (!isRec(im) || typeof im.data !== 'string') return null;
  const data = im.data;
  const as = im.mediaType === 'image/svg+xml' ? 'svg' : 'raster'; // only the SVG test reads the stated type
  let hit = urlMemo.get(data); // keyed by the data string itself: no copy of the bytes is made for the key
  if (hit) {
    urlMemo.delete(data);
    urlMemo.set(data, hit); // most recent last
    if (hit[as] !== undefined) return hit[as]!;
  } else {
    hit = {};
    urlMemo.set(data, hit);
    urlChars += data.length;
  }
  const kind = sniffPicture(data, im.mediaType);
  const url = kind ? 'data:' + kind + ';base64,' + data : null;
  hit[as] = url;
  urlChars += url ? url.length : 0;
  while (urlChars > URL_MEMO_CHARS && urlMemo.size > 1) {
    const [k, v] = urlMemo.entries().next().value!;
    urlMemo.delete(k);
    urlChars -= k.length + (v.svg ? v.svg.length : 0) + (v.raster ? v.raster.length : 0);
  }
  return url;
}
/** Tests: how many pictures the memo holds. */
export const pictureMemoSize = (): number => urlMemo.size;

/* ---- a picture from a file (1.0's three upload inputs: the Insert Image dialog, a plate, a backdrop, a scene) ---- */

/** 1.0's file inputs' accept list. */
export const PICTURE_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';
/** 1.0's refusal (an English literal there, no key). */
export const PICTURE_TYPE_REFUSED = 'Images must be JPG or PNG';
/** 1.0's toast after an upload (an English literal there). */
export const PICTURE_ADDED = 'Image added to the book’s library';

/** Bytes → canonical base64 (what FileReader.readAsDataURL writes after its comma). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) out += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(out);
}

export type Upload = { ok: true; im: Omit<BookImage, 'id'> } | { ok: false; why: 'type' | 'read' };

/** 1.0's upload: the file's type must be JPG or PNG (1.0 tests file.type, /^image\/(jpeg|png)$/); the picture is
 *  { name, mediaType, ext, data } as 1.0 builds it (the id is the caller's uid()). 1.0 sets no size cap here. */
export async function readPictureFile(file: File): Promise<Upload> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) return { ok: false, why: 'type' };
  let data: string;
  try {
    data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, why: 'read' };
  }
  return { ok: true, im: { name: file.name, mediaType: file.type, ext: file.type === 'image/png' ? 'png' : 'jpg', data } };
}

/** 1.0's picture name made into words (the alt text it offers: "harbour-chart.png" → "harbour chart"). `dash`: the
 *  plate's and the scene's rule also takes the em dash. */
export const nameWords = (name: unknown, dash = false): string =>
  String(name || '').replace(/\.[^.]+$/, '').replace(dash ? /[-_—]+/g : /[-_]+/g, ' ');

/* ---- writing ---- */

/** The section's Y map, by its id (null when it is gone). */
export function sectionMapById(ydoc: Y.Doc, id: unknown): Y.Map<unknown> | null {
  for (const m of ydoc.getArray<unknown>(SECTIONS).toArray()) if (m instanceof Y.Map && m.get('id') === id) return m;
  return null;
}

/** A section key as book format (a plain copy). */
export function sectionKey(map: Y.Map<unknown> | null, key: string): unknown {
  if (!map) return undefined;
  const v = map.get(escKey(key));
  return v instanceof Y.AbstractType ? v.toJSON() : v === undefined ? undefined : structuredClone(v);
}

/** Set (or, with undefined, remove) keys of one section: new values, one transaction. Not pictures: no repack. */
export function setSectionKeys(ydoc: Y.Doc, id: unknown, patch: Rec): boolean {
  const m = sectionMapById(ydoc, id);
  if (!m) return false;
  ydoc.transact(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) m.delete(escKey(k));
      else m.set(escKey(k), structuredClone(v));
    }
  });
  return true;
}

/** The book's pictures as stored (each picture's data its name in the store: read-only, cheap). */
export function storedImages(ydoc: Y.Doc): Rec[] {
  const v = ydoc.getMap<unknown>(META).get('images');
  return Array.isArray(v) ? (v as Rec[]) : [];
}

/** Add one picture to the library (1.0: state.images.push(im)), and `also` in the same transaction (the plate or
 *  backdrop that takes it), with History repacked against the new library (constraint 14). */
export function addPicture(c: Closure, ydoc: Y.Doc, im: BookImage, also?: () => void): void {
  repackHistory(c, ydoc, () => {
    // the stored list keeps every other picture named, so only the new one's bytes are hashed and stored
    setMeta(ydoc, 'images', [...storedImages(ydoc), im] as never);
    also?.();
  });
}

/** One picture of the library with its bytes filled in (only that one is read from the store), or null. */
export function imageById(ydoc: Y.Doc, id: unknown): BookImage | null {
  if (typeof id !== 'string' || !id) return null;
  const im = storedImages(ydoc).find((x) => isRec(x) && x.id === id);
  return im ? (unpackValue(ydoc, structuredClone(im)) as BookImage) : null;
}

/** 1.0's pickerImages for the chapter-art pickers. It reads the library and, per section, the pictures its text, its
 *  scene breaks, its plate and its backdrop name — each looked up IN the library (imageById), so it can only ever list
 *  the library's own pictures: the sections are handed over without their text (reading every chapter's text would
 *  find nothing more). The pictures as stored (names, not bytes): the pickers show names. */
export function pickerList(c: Closure, ydoc: Y.Doc): { id: string; name: string }[] {
  const sections = ydoc.getArray<unknown>(SECTIONS).toArray().map((m) => (m instanceof Y.Map ? { plateId: m.get(escKey('plateId')), backdropId: m.get(escKey('backdropId')), scenes: m.get(escKey('scenes')) } : {}));
  c.setState({ images: storedImages(ydoc), sections, meta: {} } as never);
  return c.api.pickerImages() as unknown as { id: string; name: string }[];
}
