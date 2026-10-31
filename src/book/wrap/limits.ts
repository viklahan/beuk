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
