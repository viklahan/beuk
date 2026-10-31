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

/* ---- SVG pictures (fix round 1) ----
   The studio lets a writer choose an SVG flourish as cover art (the art
   grid offers every picture in the book), so the wrap paints SVGs too, on
   the server's terms:
   - the server never fetches or expands anything: a DOCTYPE or ENTITY,
     a script, an xml-stylesheet, an @import, or any href / url() whose
     target is not "#…" or an inline PNG/JPEG/WebP/GIF data URI is refused;
   - inline pictures inside the SVG are held to the same size fence;
   - the SVG's own size (root width/height in px or unitless, else the
     viewBox) is held to the same fence before anything is decoded. */

/** What the wrap makes of an SVG picture. */
export type SvgVerdict =
  | { ok: true; w: number; h: number; bytes: Buffer }
  | { ok: false; reason: 'unsupported' | 'too-large' };

/** The longest side an SVG is rasterised at when it is smaller (or has no size): it is vector, so a bigger raster loses nothing. */
export const SVG_RASTER_SIDE = 2000;

const SAFE_TARGET = /^\s*(#|data:image\/(png|jpeg|webp|gif)[;,])/i;

/** A length in px (or unitless), else null. */
function svgPx(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(px)?\s*$/i.exec(v);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Is this an SVG document (by its text, not its media type)? */
export function looksLikeSvg(b: Buffer): boolean {
  const head = b.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, '').trimStart();
  return head.startsWith('<') && /<svg[\s>/]/i.test(head);
}

/** Check an SVG picture and give back the bytes to decode: the same
 *  document with its root width/height set to the size it is rasterised
 *  at (its own size, scaled up to SVG_RASTER_SIDE on the longest side
 *  when smaller, the viewBox's aspect kept). */
export function checkSvg(b: Buffer): SvgVerdict {
  const text = b.toString('utf8').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY|<script|<\?xml-stylesheet|@import/i.test(text)) return { ok: false, reason: 'unsupported' };
  for (const m of text.matchAll(/(?:^|[\s"'])(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (!SAFE_TARGET.test(m[2]!)) return { ok: false, reason: 'unsupported' };
  }
  if (/(?:^|[\s"'])(?:xlink:)?href\s*=\s*[^\s"']/i.test(text)) return { ok: false, reason: 'unsupported' }; /* unquoted */
  for (const m of text.matchAll(/url\(\s*(["']?)([\s\S]*?)\1\s*\)/gi)) {
    if (!SAFE_TARGET.test(m[2]!)) return { ok: false, reason: 'unsupported' };
  }
  /* inline pictures: the same fence as any picture */
  for (const m of text.matchAll(/data:image\/(?:png|jpeg|webp|gif)[^,"')]*;base64,([A-Za-z0-9+/=\s]+)/gi)) {
    if (!pictureFits(imageSize(Buffer.from(m[1]!.replace(/\s/g, ''), 'base64')))) return { ok: false, reason: 'too-large' };
  }
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const root = /<svg\b([^>]*)>/i.exec(body);
  if (!root) return { ok: false, reason: 'unsupported' };
  const attrs: Record<string, string> = {};
  for (const a of root[1]!.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])([\s\S]*?)\2/g)) attrs[a[1]!.toLowerCase()] = a[3]!;
  const vb = (attrs.viewbox ?? '').trim().split(/[\s,]+/).map(Number);
  const vbOk = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0;
  let w = svgPx(attrs.width), h = svgPx(attrs.height);
  if (w && !h && vbOk) h = (w * vb[3]!) / vb[2]!;
  else if (h && !w && vbOk) w = (h * vb[2]!) / vb[3]!;
  else if (!w || !h) { w = vbOk ? vb[2]! : null; h = vbOk ? vb[3]! : null; }
  if (w && h) {
    if (!pictureFits({ w: Math.ceil(w), h: Math.ceil(h) })) return { ok: false, reason: 'too-large' };
  } else {
    w = SVG_RASTER_SIDE; h = SVG_RASTER_SIDE; /* no size at all: a square at the raster side */
  }
  const k = Math.max(1, SVG_RASTER_SIDE / Math.max(w, h));
  const rw = Math.max(1, Math.round(w * k)), rh = Math.max(1, Math.round(h * k));
  /* the viewBox keeps the drawing's aspect when the root had none of its own */
  const keep = root[0]!.replace(/\s(width|height)\s*=\s*(["'])[\s\S]*?\2/gi, '');
  const sized = keep.replace(/^<svg\b/i, `<svg width="${rw}" height="${rh}"` + (vbOk || !(svgPx(attrs.width) && svgPx(attrs.height)) ? '' : ` viewBox="0 0 ${svgPx(attrs.width)} ${svgPx(attrs.height)}"`));
  const out = body.slice(0, root.index) + sized + body.slice(root.index + root[0]!.length);
  return { ok: true, w: rw, h: rh, bytes: Buffer.from(out, 'utf8') };
}
