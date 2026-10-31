import { XMLSerializer } from '@xmldom/xmldom';
import { StrictDomParser } from '../epub/sandbox.js';

/* BEUK:wrap-server — the wrap's size fence. The 300-DPI canvas and every
   decoded picture live in Skia's native memory, outside the worker's heap
   cap, and running out there takes the whole server down. So the worker
   checks sizes before it allocates anything big: the wrap's own pixel
   count from wrapDims, and each picture's width and height read from its
   file header, before it is decoded. A real dust jacket is about 20 MP,
   a case laminate about 28 MP. */

/** Most pixels a wrap canvas or a picture may have. */
export const MAX_WRAP_PIXELS = 40_000_000;
/** Longest side a picture may have, px. */
export const MAX_PICTURE_SIDE = 20_000;

/** Picture ids the wrap will look up: the shapes the studio makes (uid()
 *  "s…", "sample-img-…", "sc-…"). Never "__proto__" or anything with
 *  punctuation beyond - and _. */
export const PICTURE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Width and height from an image's header (PNG, JPEG, GIF, WebP), or
 *  null when the format is not one of those or the header is cut short. */
export function imageSize(b: Buffer): { w: number; h: number } | null {
  try {
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') {
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const chunk = b.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L' && b[20] === 0x2f) {
        const b1 = b[22]!, b2 = b[23]!, b3 = b[24]!;
        return { w: 1 + (((b1 & 0x3f) << 8) | b[21]!), h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      return null;
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 4 <= b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1]!;
        if (m === 0xff) { i++; continue; } /* fill byte */
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } /* no length */
        if (m === 0xd9 || m === 0xda) return null; /* end of image / scan before any frame header */
        const len = b.readUInt16BE(i + 2);
        if (SOF.has(m)) return i + 9 <= b.length ? { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) } : null;
        if (len < 2) return null;
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Is this picture small enough to decode? */
export function pictureFits(size: { w: number; h: number } | null): boolean {
  return !!size && size.w > 0 && size.h > 0 && size.w <= MAX_PICTURE_SIDE && size.h <= MAX_PICTURE_SIDE && size.w * size.h <= MAX_WRAP_PIXELS;
}

/* ---- SVG pictures (fix rounds 1 and 2) ----
   The studio lets a writer choose an SVG flourish as cover art (the art
   grid offers every picture in the book), so the wrap paints SVGs too, on
   the server's terms. The SVG is PARSED (xmldom, with part 3's strict
   posture: any parse error refuses it, so an undeclared entity does too),
   checked node by node, sized on the DOM, its comments dropped, and
   serialised again. A root written without xmlns is put in the SVG
   namespace by the parser (xmldom, for image/svg+xml). Only that
   serialisation is ever decoded, never the writer's text.
   - Refused (unsupported): a doctype; any processing instruction but the
     XML declaration; a root that is not <svg> in the SVG namespace;
     script, foreignObject, iframe, object, embed, audio, video, link,
     meta, handler and listener elements; on* attributes; xml:base; any
     href or src (any prefix, any namespace) that is not "#id" or an
     inline PNG/JPEG/WebP/GIF data URI; url() reaching anything else in
     any attribute or <style>; image-set(); @import; a backslash in an
     attribute value or <style> (a CSS escape could spell url( another way).
   - Inline pictures and the SVG's own size (root width/height in px or
     unitless, else the viewBox) are held to the same fence as any
     picture (too-large). */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What the wrap makes of an SVG picture. */
export type SvgVerdict =
  | { ok: true; w: number; h: number; bytes: Buffer }
  | { ok: false; reason: 'unsupported' | 'too-large'; why: string };

/** The longest side an SVG is rasterised at when it is smaller (or has no size): it is vector, so a bigger raster loses nothing. */
export const SVG_RASTER_SIDE = 2000;

const FORBIDDEN_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'link', 'meta', 'handler', 'listener']);
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]*)$/i;
const ID_REF = /^#[^\s#]*$/;
const URL_FN = /url\s*\(\s*(["']?)([^"')]*)\1\s*\)/gi;

/** A length in px (or unitless), else null. */
function svgPx(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(px)?\s*$/i.exec(v);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Is this an SVG document (by its text, not its media type)? It only picks the path; checkSvg decides. */
export function looksLikeSvg(b: Buffer): boolean {
  const head = b.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').trimStart();
  return head.startsWith('<') && /<svg[\s>/]/i.test(head);
}

type Refusal = { reason: 'unsupported' | 'too-large'; why: string };

/** A reference target the server allows: "#id", or an inline picture within the fence. */
function target(raw: string): Refusal | null {
  const v = raw.trim();
  if (ID_REF.test(v)) return null;
  const m = DATA_IMAGE.exec(v);
  if (!m) return { reason: 'unsupported', why: `a reference to ${JSON.stringify(v.slice(0, 40))}` };
  return pictureFits(imageSize(Buffer.from(m[2]!.replace(/\s/g, ''), 'base64'))) ? null : { reason: 'too-large', why: 'an inline picture over the size fence' };
}

/** CSS (an attribute value or <style> text): every url() must reach an allowed target. */
function cssRefs(text: string): Refusal | null {
  if (text.includes('\\')) return { reason: 'unsupported', why: 'a backslash (CSS escape)' };
  if (/@import/i.test(text)) return { reason: 'unsupported', why: '@import' };
  if (/image-set\s*\(/i.test(text)) return { reason: 'unsupported', why: 'image-set()' };
  const found = [...text.matchAll(URL_FN)];
  /* every url( must be one the pattern read whole */
  if ((text.match(/url\s*\(/gi) ?? []).length !== found.length) return { reason: 'unsupported', why: 'a url( that could not be read' };
  for (const m of found) {
    const bad = target(m[2]!);
    if (bad) return bad;
  }
  return null;
}

type XAttr = { localName?: string | null; name: string; value: string };
type XNode = {
  nodeType: number; nodeName: string; localName?: string | null; namespaceURI?: string | null;
  childNodes?: ArrayLike<XNode>; attributes?: ArrayLike<XAttr>; textContent?: string | null;
};
type XElement = XNode & { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void };

/** Walk the parsed SVG: the first reason to refuse it, or null. */
function walk(node: XNode): Refusal | null {
  if (node.nodeType === 10) return { reason: 'unsupported', why: 'a doctype' };
  if (node.nodeType === 7 && node.nodeName.toLowerCase() !== 'xml') return { reason: 'unsupported', why: `a processing instruction (${node.nodeName})` };
  if (node.nodeType === 5 || node.nodeType === 6) return { reason: 'unsupported', why: 'an entity' };
  if (node.nodeType === 1) {
    const name = String(node.localName ?? node.nodeName).toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(name)) return { reason: 'unsupported', why: `a <${name}> element` };
    const attrs = node.attributes ?? [];
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]!;
      /* by local name, whatever the prefix or namespace (a:href bound to xlink is an href) */
      const local = String(a.localName ?? a.name.replace(/^.*:/, '')).toLowerCase();
      if (local.startsWith('on')) return { reason: 'unsupported', why: `an event attribute (${a.name})` };
      if (local === 'base' && a.name.includes(':')) return { reason: 'unsupported', why: `${a.name}` };
      if (local === 'href' || local === 'src') {
        const bad = target(a.value);
        if (bad) return bad;
      }
      const css = cssRefs(a.value);
      if (css) return css;
    }
    if (name === 'style') {
      const css = cssRefs(String(node.textContent ?? ''));
      if (css) return css;
    }
  }
  const kids = node.childNodes ?? [];
  for (let i = 0; i < kids.length; i++) {
    const bad = walk(kids[i]!);
    if (bad) return bad;
  }
  return null;
}

/** Check an SVG picture and give back the bytes to decode: the parsed
 *  document, checked, with its root width/height set to the size it is
 *  rasterised at (its own size, scaled up to SVG_RASTER_SIDE on the
 *  longest side when smaller, the aspect kept), serialised again. */
export function checkSvg(b: Buffer): SvgVerdict {
  const text = b.toString('utf8').replace(/^﻿/, '');
  let doc: XNode & { documentElement: XElement | null };
  try {
    doc = new StrictDomParser().parseFromString(text, 'image/svg+xml') as typeof doc;
  } catch (e) {
    return { ok: false, reason: 'unsupported', why: `it does not parse (${e instanceof Error ? e.message.slice(0, 80) : 'error'})` };
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return { ok: false, reason: 'unsupported', why: 'the root is not <svg> in the SVG namespace' };
  const bad = walk(doc);
  if (bad) return { ok: false, ...bad };

  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const vbOk = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0;
  const pw = svgPx(root.getAttribute('width')), ph = svgPx(root.getAttribute('height'));
  let w = pw, h = ph;
  if (w && !h && vbOk) h = (w * vb[3]!) / vb[2]!;
  else if (h && !w && vbOk) w = (h * vb[2]!) / vb[3]!;
  else if (!w || !h) { w = vbOk ? vb[2]! : null; h = vbOk ? vb[3]! : null; }
  if (w && h) {
    if (!pictureFits({ w: Math.ceil(w), h: Math.ceil(h) })) return { ok: false, reason: 'too-large', why: `it declares ${w} x ${h}` };
  } else {
    w = SVG_RASTER_SIDE; h = SVG_RASTER_SIDE; /* no size at all: a square at the raster side */
  }
  const k = Math.max(1, SVG_RASTER_SIDE / Math.max(w, h));
  const rw = Math.max(1, Math.round(w * k)), rh = Math.max(1, Math.round(h * k));
  /* comments carry nothing to the renderer: they are dropped, so the serialisation holds only what was checked */
  type Parent = XNode & { removeChild?: (c: XNode) => void };
  const dropComments = (n: Parent): void => {
    for (const k of Array.from(n.childNodes ?? []) as Parent[]) {
      if (k.nodeType === 8) n.removeChild!(k);
      else dropComments(k);
    }
  };
  dropComments(doc);
  /* the drawing scales with the raster: a root sized in px without a viewBox gets one */
  if (!vbOk && pw && ph) root.setAttribute('viewBox', `0 0 ${pw} ${ph}`);
  root.setAttribute('width', String(rw));
  root.setAttribute('height', String(rh));
  const out = new XMLSerializer().serializeToString(doc as never);
  return { ok: true, w: rw, h: rh, bytes: Buffer.from(out, 'utf8') };
}
