import { cleanFlowHtml } from '../preview/safe';

/* Step 5 wave 5b, constraint 59: safety, print's turn.

   The print interior (1.0's buildPrintHtml) is a whole document: the writer opens the downloaded file locally, and the
   print view shows it in a same-origin frame (its srcdoc), which inherits the page's policy — and that policy allows
   inline script ('unsafe-inline', for 1.0's own page). The book's values reach the document as markup (the sections,
   the title) and as CSS (the book stylesheet's fonts and theme numbers). So:

   1. at the source, the export's corrections (src/export/safe.ts: the preview's sourceSafe and the export's own) are
      in the state before 1.0's code builds the document — as for the EPUB, Markdown and standalone HTML (5a);
   2. at the sinks, every section's HTML goes through the preview's flow cleaner (printUnlink, wrapped: the print
      document's sections, the Print Interior View's pages and sideways copies derive from it), as the preview's do;
   3. and the document as a whole, here: parsed (text/html, as the frame and a browser read it) and walked. A document
      with nothing that runs, embeds or loads from elsewhere is handed over EXACTLY as 1.0 built it (byte for byte: an
      honest book's file equals 1.0's). Otherwise what would run or load is taken out — script and embedding elements,
      handler and srcdoc attributes, javascript: addresses, remote sources, CSS url()/@import of another origin — and
      the document is serialised again. */

const RUNS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'form', 'portal', 'foreignobject', 'set', 'animate', 'animatemotion', 'animatetransform', 'noscript', 'template']);
const LOADS: Record<string, string[]> = {
  img: ['src', 'srcset'], audio: ['src'], video: ['src', 'poster'], source: ['src', 'srcset'], track: ['src'], input: ['src'], image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'], feimage: ['href', 'xlink:href'], body: ['background'], table: ['background'], td: ['background'], link: ['href'],
};
/** An address that names another origin, or any scheme but data: (the document's own bytes) and a fragment. */
const foreign = (v: string | null | undefined): boolean => {
  const s = String(v ?? '').trim();
  if (!s || s.startsWith('#')) return false;
  if (/^data:/i.test(s)) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || /[\\\u0000-\u001f]/.test(s);
};
/** The attributes whose value is text, the book's words (an alt "JavaScript: The Good Parts"): a javascript: or
 *  vbscript: scheme is looked for in every other attribute (the coordinator's note: not only the address ones). */
const isTextAttr = (n: string): boolean => n === 'alt' || n === 'title' || n === 'placeholder' || n === 'content' || n.startsWith('aria-');
const scheme = (v: string): boolean => /^\s*(?:javascript|vbscript)\s*:/i.test(v.replace(/[\u0000- ]/g, ''));
/** A CSS string literal as a browser reads it: a raw newline (\n, \r, \f) ends it (a "bad string"). 1.0's cssStr
 *  escapes \ and " only, so a newline in the title or author ends the running head's string there (second review,
 *  Important 1): what follows is CSS, and is read here as CSS. */
const CSS_STR = /"(?:[^"\\\n\r\f]|\\[\s\S])*"|'(?:[^'\\\n\r\f]|\\[\s\S])*'/g;
/** The quoted runs a raw newline breaks, read left to right as a browser does (a bad string): each span from its
 *  quote to the next same quote (as a looser reading would take it for one string). */
function brokenRuns(c: string): [number, number][] {
  const broken: [number, number][] = [];
  for (let i = 0; i < c.length; i++) {
    const q = c[i];
    if (q !== '"' && q !== "'") continue;
    let j = i + 1, bad = false;
    for (; j < c.length && c[j] !== q; j++) {
      if (c[j] === '\\') j++;
      else if (c[j] === '\n' || c[j] === '\r' || c[j] === '\f') bad = true;
    }
    if (bad) broken.push([i, Math.min(j + 1, c.length)]);
    i = j;
  }
  return broken;
}
/** Each quoted run a raw newline breaks, its newlines made spaces (one string again: the book's words). */
const mendRuns = (css: string): string => {
  let out = css;
  for (const [a, b] of brokenRuns(css).reverse()) out = out.slice(0, a) + out.slice(a, b).replace(/[\n\r\f]/g, ' ') + out.slice(b);
  return out;
};
const unquote = (s: string): string => s.slice(1, -1);
/** image-set() / -webkit-image-set(): their strings are addresses the browser loads (no url() needed). */
const IMAGE_SET = /(?:-webkit-)?image-set\s*\(((?:"(?:[^"\\\n\r\f]|\\[\s\S])*"|'(?:[^'\\\n\r\f]|\\[\s\S])*'|\([^()]*\)|[^'"()])*)\)/gi;
/** url(): its argument quoted (a ')' inside the quotes included) or bare. */
const URL_FN = /url\(\s*(?:"((?:[^"\\\n\r\f]|\\[\s\S])*)"|'((?:[^'\\\n\r\f]|\\[\s\S])*)'|([^'"()\s]*))\s*\)/gi;
const imageSetForeign = (args: string): boolean => (args.match(CSS_STR) || []).some((s) => foreign(unquote(s)));
/** The spans of the CSS's strings. */
const stringSpans = (c: string): [number, number][] => [...c.matchAll(CSS_STR)].map((m) => [m.index!, m.index! + m[0].length]);
const inSpans = (i: number, spans: [number, number][]): boolean => spans.some(([a, b]) => i > a && i < b);
/** CSS that names another origin (url(), image-set(), @import) or runs script (expression(), -moz-binding, behavior,
 *  javascript:) — the keywords looked for outside the stylesheet's strings: the running head is the book's title and
 *  author as a CSS string, and "Behavior: …" there is the book's words (review, Critical 1). Fail closed (second
 *  review, Important 1): a quoted run a raw newline breaks, or a url( that no url() reading accounts for, is foreign. */
function cssForeign(css: string): boolean {
  const c = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (brokenRuns(c).length) return true;
  const outside = c.replace(CSS_STR, '""');
  if (/@import|expression\s*\(|-moz-binding|behavior\s*:|javascript:/i.test(outside)) return true;
  if (/\\/.test(outside)) return true; // an escape outside a string can hide a url( or a scheme
  const spans = stringSpans(c);
  let parsed = 0;
  for (const m of c.matchAll(URL_FN)) {
    if (inSpans(m.index!, spans)) continue;
    parsed++;
    if (foreign(m[1] ?? m[2] ?? m[3] ?? '')) return true;
  }
  // every url( read as CSS (outside the strings) is one of the url() read above, or the CSS is not trusted
  if ((outside.match(/url\(/gi) || []).length !== parsed) return true;
  for (const m of c.matchAll(IMAGE_SET)) if (imageSetForeign(m[1] || '')) return true;
  return false;
}
/** `fn` on the CSS outside its strings (the strings kept as they are). */
const outsideStrings = (css: string, fn: (part: string) => string): string => {
  let out = '', at = 0, m: RegExpExecArray | null;
  const re = new RegExp(CSS_STR.source, 'g');
  while ((m = re.exec(css))) {
    out += fn(css.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + fn(css.slice(at));
};
/** A url() or image-set() that names another origin made none; @import, script in CSS and escapes outside a string
 *  taken out (the strings — the book's words — kept). */
const cssDefang = (css: string): string =>
  outsideStrings(mendRuns(String(css)), (p) => p.replace(/\\/g, '').replace(/@import[^;]*;?/gi, '').replace(/expression\s*\(|-moz-binding|behavior\s*:|javascript:/gi, 'x-'))
    .replace(IMAGE_SET, (all, args: string) => (imageSetForeign(args || '') ? 'none' : all))
    .replace(URL_FN, (all: string, a?: string, b?: string, d?: string) => (foreign(a ?? b ?? d ?? '') ? 'none' : all));

/** What the walk took out (0 for an honest book), for the tests and the e2e. */
export const printSafety = { docs: 0, cleaned: 0, removed: 0, flowsCleaned: 0 };

/** 1.0's print document, as the frame or a file may take it (see above). */
export function cleanPrintDoc(html: string): string {
  printSafety.docs++;
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  let removed = 0;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (!el.isConnected) continue;
    const name = el.localName.toLowerCase();
    if (RUNS.has(name) || (name === 'meta' && el.hasAttribute('http-equiv'))) {
      el.remove();
      removed++;
      continue;
    }
    if (name === 'link' && !(el.getAttribute('rel') || '').split(/\s+/).every((r) => r === '' || r === 'stylesheet') ) {
      el.remove();
      removed++;
      continue;
    }
    for (const at of Array.from(el.attributes)) {
      const n = at.name.toLowerCase();
      const bad =
        n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || n === 'action' || (!isTextAttr(n) && scheme(at.value)) ||
        (n === 'style' && cssForeign(at.value)) ||
        ((LOADS[name] || []).includes(n) && (n === 'srcset' ? at.value.split(',').some((p) => foreign(p.trim().split(/\s+/)[0])) : foreign(at.value))) ||
        (n === 'href' && name === 'a' && foreign(at.value) && !/^https?:\/\//i.test(at.value.trim()));
      if (bad) {
        el.removeAttribute(at.name);
        removed++;
      }
    }
    if (name === 'style' && cssForeign(el.textContent || '')) {
      const css = cssDefang(el.textContent || '');
      // fail closed: what the defanging could not make safe is not kept at all
      el.textContent = cssForeign(css) ? '' : css;
      removed++;
    }
  }
  if (!removed) return html;
  printSafety.cleaned++;
  printSafety.removed += removed;
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

/** The preview's flow cleaner (src/preview/safe.ts), for a section of the print document: what it would keep is
 *  compared with the inert parse of 1.0's own HTML; when nothing was taken out, 1.0's string is handed on as it is
 *  (the file is bytes: the parse would re-serialise an honest `<img … />` as `<img …>`), else the cleaned HTML. */
export function printFlowSink(html: string): string {
  const clean = cleanFlowHtml(html);
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  if (tpl.innerHTML === clean) return html;
  printSafety.flowsCleaned++;
  return clean;
}
