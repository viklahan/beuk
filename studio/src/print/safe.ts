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
const scheme = (v: string): boolean => /^\s*(?:javascript|vbscript)\s*:/i.test(v.replace(/[\u0000- ]/g, ''));
/** CSS that names another origin (url(), @import) or runs script (expression(), -moz-binding, behavior). */
function cssForeign(css: string): boolean {
  const c = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@import|expression\s*\(|-moz-binding|behavior\s*:|javascript:/i.test(c)) return true;
  if (/\\/.test(c.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""'))) return true; // an escape outside a string can hide a url( or a scheme
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(c))) if (foreign(m[2])) return true;
  return false;
}
/** The CSS with every backslash outside a string taken out (strings kept as they are). */
const unescapedOutside = (css: string): string => String(css).replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\\/g, (all, str) => (str ? str : ''));
/** Every url() in the CSS that names another origin made none, @import and script in CSS taken out. */
const cssDefang = (css: string): string =>
  unescapedOutside(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(|-moz-binding|behavior\s*:|javascript:/gi, 'x-')
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (all, _q, u) => (foreign(u) ? 'none' : all));

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
        n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || n === 'action' || scheme(at.value) ||
        (n === 'style' && cssForeign(at.value)) ||
        ((LOADS[name] || []).includes(n) && (n === 'srcset' ? at.value.split(',').some((p) => foreign(p.trim().split(/\s+/)[0])) : foreign(at.value))) ||
        (n === 'href' && name === 'a' && foreign(at.value) && !/^https?:\/\//i.test(at.value.trim()));
      if (bad) {
        el.removeAttribute(at.name);
        removed++;
      }
    }
    if (name === 'style' && cssForeign(el.textContent || '')) {
      el.textContent = cssDefang(el.textContent || '');
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
