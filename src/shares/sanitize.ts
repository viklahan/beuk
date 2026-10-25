/**
 * Allowlist HTML sanitizer for beta-reader share pages.
 *
 * The share renderer (render.ts) already escapes every piece of book
 * text, so its output is safe by construction. This is the second gate:
 * EVERY body of book HTML passes through here at share time AND again at
 * serve time, so even a tampered or legacy snapshot row cannot reach a
 * reader with live markup. Rules:
 *
 *   - Only the tags in ALLOWED_TAGS survive; any other tag is dropped
 *     (its text kept). script/style/iframe/object/… are dropped WITH
 *     their contents.
 *   - Only allowlisted attributes survive, each with a strict value
 *     pattern. No event handlers (on*), no style, no srcset, ever.
 *   - <a href> must be an in-page fragment (#id). No javascript:, no
 *     data:, no external links.
 *   - <img src> must be a same-origin share image (beuk-img:<id>,
 *     resolved by the caller to /read/<token>/img/<id>) or a data:
 *     URI of a raster image type. Anything else drops the image.
 *   - Comments, doctype and processing instructions are removed; a
 *     stray "<" or ">" in text is escaped.
 *
 * Not a general-purpose HTML sanitizer — it is sized to the markup the
 * share renderer emits, and refuses everything else. No dependency.
 */

const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'blockquote', 'br', 'em', 'strong', 'i', 'b',
  'sup', 'sub', 'a', 'span', 'figure', 'figcaption', 'img', 'div', 'section', 'hr',
]);

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'textarea', 'title', 'svg', 'math', 'frame', 'frameset', 'applet', 'xmp',
  'noembed', 'noframes', 'select', 'button', 'form', 'video', 'audio', 'canvas',
]);

const VOID_TAGS = new Set(['br', 'img', 'hr']);

const SAFE_CLASS = /^[A-Za-z0-9 _-]{1,200}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;
const SHARE_IMG = /^beuk-img:([A-Za-z0-9_-]{1,100})$/;

export interface SanitizeOptions {
  /** Map a share image id to its URL for this page. Return null to
   *  drop the image. Defaults to dropping beuk-img: references. */
  resolveImage?: (id: string) => string | null;
}

function esc(text: string): string {
  return text
    .replace(/&(?!(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Decode the entities a browser would, so a check like "starts with
 *  #" cannot be dodged by &#106;avascript: style encoding. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]{1,6});?/g, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d{1,7});?/g, (_m, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function cleanAttrs(tag: string, raw: string, opts: SanitizeOptions): string | null {
  const out: string[] = [];
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  let imgSrc: string | null = null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (name === 'class' && SAFE_CLASS.test(value)) out.push(`class="${escAttr(value)}"`);
    else if (name === 'id' && SAFE_ID.test(value)) out.push(`id="${escAttr(value)}"`);
    else if (name === 'data-p' && /^\d{1,6}$/.test(value)) out.push(`data-p="${value}"`);
    else if (name === 'data-s' && SAFE_ID.test(value)) out.push(`data-s="${escAttr(value)}"`);
    else if (name === 'lang' && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(value)) out.push(`lang="${value}"`);
    else if (name === 'dir' && /^(ltr|rtl|auto)$/.test(value)) out.push(`dir="${value}"`);
    else if (tag === 'a' && name === 'href' && /^#[A-Za-z0-9_-]{1,100}$/.test(value)) out.push(`href="${value}"`);
    else if (tag === 'img' && name === 'alt') out.push(`alt="${escAttr(value.slice(0, 1000))}"`);
    else if (tag === 'img' && name === 'src') {
      const shared = SHARE_IMG.exec(value);
      if (shared) imgSrc = opts.resolveImage ? opts.resolveImage(shared[1]) : null;
      else if (SAFE_DATA_IMAGE.test(value)) imgSrc = value.replace(/\s+/g, '');
      else imgSrc = null;
    }
    // Everything else (on*, style, srcset, formaction, xlink:href, …) is dropped.
  }
  if (tag === 'img') {
    if (!imgSrc) return null; // an image without a safe source is no image
    out.unshift(`src="${escAttr(imgSrc)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

export function sanitizeHtml(input: string, opts: SanitizeOptions = {}): string {
  const html = String(input ?? '');
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += esc(html.slice(i));
      break;
    }
    out += esc(html.slice(i, lt));
    // Comments, doctype, CDATA, processing instructions: drop.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const tagMatch = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt));
    if (!tagMatch) {
      // A lone "<" that does not open a tag: it is text.
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    const closing = tagMatch[1] === '/';
    const tag = tagMatch[2].toLowerCase();
    const rawAttrs = tagMatch[3];
    i = lt + tagMatch[0].length;
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(rawAttrs)) {
        const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
        const rest = html.slice(i);
        const cm = closeRe.exec(rest);
        i = cm ? i + cm.index + cm[0].length : html.length;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue; // drop the tag, keep its text
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    const attrs = cleanAttrs(tag, rawAttrs.replace(/\/\s*$/, ''), opts);
    if (attrs === null) continue;
    out += VOID_TAGS.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>`;
  }
  return out;
}
