/* Wave 5a (constraint 53): what a hostile book could make an export carry — parsed, then walked. A document is read the
   lenient way a browser or a reading system's web view reads it (text/html), so markup that breaks out of an
   attribute or a tag is seen as the elements it makes. Reported:
   - an element that runs or embeds something: script, iframe, frame, object, embed, applet, base, form, portal, and
     svg's foreignObject / set / animate*, a meta refresh;
   - an attribute that is a handler (on*), or a javascript:/vbscript: address, or srcdoc;
   - a remote request: a loading attribute (src, srcset, poster, data, background, a stylesheet <link>'s href, svg's
     image / use / feImage href) that names another origin or a scheme, and CSS url() / @import of one (style
     attributes and <style> text). A hyperlink (<a href="https://…">) is a link out, not a request, and is allowed (as
     4b ruling 10 and 1.0's epubDetectProps hold it). data: addresses are the package's own bytes. */
const RUNS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'form', 'portal', 'foreignobject', 'set', 'animate', 'animatemotion', 'animatetransform']);
const LOADS: Record<string, string[]> = {
  img: ['src', 'srcset'], audio: ['src'], video: ['src', 'poster'], source: ['src', 'srcset'], track: ['src'], input: ['src'], image: ['href', 'xlink:href'],
  use: ['href', 'xlink:href'], feimage: ['href', 'xlink:href'], body: ['background'], table: ['background'], td: ['background'],
  // the package document: a manifest item or the NCX's content names a file the reading system loads
  item: ['href'], content: ['src'],
};
const remote = (v: string | null | undefined) => !!v && /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(v);
const scheme = (v: string | null | undefined) => !!v && /^\s*(?:javascript|vbscript)\s*:/i.test(v);
const cssRemote = (css: string) => {
  const c = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)|@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(c))) {
    const u = m[2] || m[4] || '';
    if (remote(u) || /^\s*(?:javascript|https?):/i.test(u)) return u;
  }
  return '';
};

export function hazards(text: string, where = ''): string[] {
  const out: string[] = [];
  const doc = new DOMParser().parseFromString(String(text), 'text/html');
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const name = el.localName.toLowerCase();
    if (RUNS.has(name)) out.push(`${where}: <${name}>`);
    if (name === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')) out.push(`${where}: meta refresh`);
    if (name === 'link' && /stylesheet|import|preload|prefetch/i.test(el.getAttribute('rel') || '') && remote(el.getAttribute('href'))) out.push(`${where}: remote <link> ${el.getAttribute('href')}`);
    for (const at of Array.from(el.attributes)) {
      const n = at.name.toLowerCase();
      if (n.startsWith('on')) out.push(`${where}: <${name} ${n}>`);
      if (n === 'srcdoc') out.push(`${where}: <${name} srcdoc>`);
      if (scheme(at.value)) out.push(`${where}: <${name} ${n}="${at.value.slice(0, 40)}">`);
      if (n === 'style' && cssRemote(at.value)) out.push(`${where}: <${name} style> url(${cssRemote(at.value)})`);
    }
    for (const a of LOADS[name] || []) {
      const v = el.getAttribute(a);
      if (a === 'srcset' ? String(v || '').split(',').some((p) => remote(p.trim().split(/\s+/)[0])) : remote(v)) out.push(`${where}: remote <${name} ${a}="${String(v).slice(0, 60)}">`);
    }
    if (name === 'style' && cssRemote(el.textContent || '')) out.push(`${where}: <style> url(${cssRemote(el.textContent || '')})`);
  }
  return out;
}

/** The same for a stylesheet's text. */
export function cssHazards(css: string, where = ''): string[] {
  const u = cssRemote(css);
  const out = u ? [`${where}: url(${u})`] : [];
  if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css)) out.push(`${where}: script in CSS`);
  return out;
}
