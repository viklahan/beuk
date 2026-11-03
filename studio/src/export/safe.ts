import type { Closure, State } from '../closure/index';
import { PICTURE_ID, sourceSafe } from '../style/session';

/* Step 5 wave 5a, constraint 53: safety, the export's turn.

   The export reaches the book's values as 1.0's code writes them into the package's XHTML, its OPF and navigation, the
   standalone HTML and the Markdown — and the book is untrusted. 1.0 writes some of them unescaped (reported to V, with
   a reproducing fixture: test/export-safe.test.ts), on the server's EPUB build too. So, in the export's state only
   (src/export/state.ts; the book itself is never changed):

   - the preview's corrections, the Style session's sourceSafe (4a, 4b, 4c): a picture whose data is not base64, whose
     media type is not plain or whose id is not plain is hidden; so is a font whose data is not base64 or whose family
     is not plain, and a cover whose data or media type is not plain; the theme's and the custom themes' font names,
     header style, indent and numbers, and the cover recipe's fonts and colours, are corrected to 1.0's defaults;
   - and what only the export writes unescaped:
     - a picture's file extension (imageFileName: the package's file names, the manifest's and the pages' hrefs) —
       not a plain one, the picture is hidden as sourceSafe hides one;
     - the cover's extension ("Images/cover." + ext, in the manifest and on the cover page) — not plain, no cover;
     - an uploaded font's id (the manifest's `id="font-…"`) — not plain, the font is hidden;
     - a section's type (its file name "Text/<type>.xhtml", in the manifest, the spine, the navigation, the NCX and
       the guide) and kind — not a plain word, 1.0's normalizeSection default ("chapter", "body").

   So the package the inspector shows, the files the validator and the audit read, the Markdown and HTML downloads and
   the book 2.0 sends to POST /api/epub carry no script, handler or remote request that 1.0's own escaping would not
   have kept out. An honest book passes unchanged (every fixture: the e2e compares the body byte for byte with 1.0's). */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A file extension as 1.0 writes them (jpg, png, gif, webp, svg, ttf, otf): letters and digits. */
export const PLAIN_EXT = /^[A-Za-z0-9]{1,10}$/;
/** A section type or kind as 1.0 names them (chapter, halftitle, aboutauthor, …): a lowercase word, digits and - allowed. */
export const PLAIN_TYPE = /^[a-z][a-z0-9-]{0,40}$/;

/** Review of 5c (Important 1): the code points XML 1.0 does not allow — C0 controls but tab, newline and carriage return,
 *  U+FFFE and U+FFFF, and a surrogate without its pair. 1.0's esc() passes them through, so one in a title or a chapter
 *  makes the EPUB's XHTML (the server's build of the body too), a Word part, the manuscript or an ACX script not
 *  well-formed. 1.0 takes the same set out of a PDF's text on import (pdfCleanText), not out of a backup. U+007F is
 *  legal XML and stays. */
export const XML_ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
/** Take them out of every string in `x` (objects and arrays walked in place; a string changed only where it carries
 *  one). Returns how many strings changed. */
export function stripXmlIllegal(x: unknown, seen: WeakSet<object> = new WeakSet()): number {
  if (!x || typeof x !== 'object' || seen.has(x)) return 0;
  seen.add(x);
  let n = 0;
  const keys = Array.isArray(x) ? x.keys() : Object.keys(x);
  for (const k of keys as Iterable<string | number>) {
    const v = (x as Record<string | number, unknown>)[k];
    if (typeof v === 'string') {
      XML_ILLEGAL.lastIndex = 0;
      if (XML_ILLEGAL.test(v)) {
        (x as Record<string | number, unknown>)[k] = v.replace(XML_ILLEGAL, '');
        n++;
      }
    } else if (v && typeof v === 'object') n += stripXmlIllegal(v, seen);
  }
  return n;
}

/** Correct the export's state in place (see above). Returns what was hidden or corrected, for the tests. */
export function exportSafe(c: Closure, st: State & Rec, book: Rec): { images: number; cover: boolean; fonts: number; sections: number; chars: number } {
  // review of 5c (Important 1): first, no XML-illegal code point in any value 1.0's builders write (the state, or a
  // volume, is the export's own copy: the book is not touched)
  const chars = stripXmlIllegal(st);
  // the preview's corrections first (they also give a font stored without an id its stable id)
  sourceSafe(c, st, book);
  const out = { images: 0, cover: false, fonts: 0, sections: 0, chars };
  if (Array.isArray(st.images))
    for (const [k, im] of st.images.entries()) {
      if (!isRec(im) || im.ext === undefined || im.ext === '' || (typeof im.ext === 'string' && PLAIN_EXT.test(im.ext))) continue;
      if (typeof im.id === 'string' && !PICTURE_ID.test(im.id)) im.id = 'hidden-picture-' + k;
      im.data = '';
      im.mediaType = 'application/octet-stream';
      im.ext = '';
      im.flourish = false;
      out.images++;
    }
  if (isRec(st.cover) && !(typeof st.cover.ext === 'string' && PLAIN_EXT.test(st.cover.ext))) {
    st.cover = null;
    out.cover = true;
  }
  if (Array.isArray(st.fonts))
    for (const f of st.fonts) {
      if (!isRec(f) || (typeof f.id === 'string' && PICTURE_ID.test(f.id))) continue;
      f.family = '';
      f.data = '';
      out.fonts++;
    }
  if (Array.isArray(st.sections))
    for (const s of st.sections) {
      if (!isRec(s)) continue;
      let hit = false;
      if (!(typeof s.type === 'string' && PLAIN_TYPE.test(s.type))) (s.type = 'chapter'), (hit = true);
      if (!(typeof s.kind === 'string' && PLAIN_TYPE.test(s.kind))) (s.kind = 'body'), (hit = true);
      if (hit) out.sections++;
    }
  return out;
}
