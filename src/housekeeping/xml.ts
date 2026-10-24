/**
 * Minimal XML structural checks — enough to verify EPUB parts are
 * well-formed (balanced tags, quoted attributes, single root) without
 * pulling in a full XML parser. This is a structural check, not a
 * validating parser; Housekeeping says so wherever it reports it.
 */

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[\w:.-]/;

export function xmlWellFormed(xml: string): { ok: boolean; error?: string } {
  const stack: string[] = [];
  let roots = 0;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) return { ok: false, error: 'unterminated comment' };
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) return { ok: false, error: 'unterminated CDATA section' };
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) return { ok: false, error: 'unterminated processing instruction' };
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      // DOCTYPE or other declaration: skip to '>' (no internal subsets
      // in EPUB parts we generate or accept here).
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) return { ok: false, error: 'unterminated declaration' };
      i = end + 1;
      continue;
    }
    // A tag. Find its end, respecting quoted attribute values.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < n) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j += 1;
    }
    if (j >= n) return { ok: false, error: 'unterminated tag' };
    const inner = xml.slice(lt + 1, j).trim();
    i = j + 1;
    if (!inner) return { ok: false, error: 'empty tag' };
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().split(/\s/)[0];
      const open = stack.pop();
      if (open !== name) {
        return {
          ok: false,
          error: `closing </${name}> does not match ${open ? `<${open}>` : 'anything open'}`,
        };
      }
      continue;
    }
    const nameMatch = /^([^\s/>]+)/.exec(inner);
    if (!nameMatch || !NAME_START.test(nameMatch[1][0]) || ![...nameMatch[1]].every((c) => NAME_CHAR.test(c))) {
      return { ok: false, error: `invalid element name in <${inner.slice(0, 24)}…>` };
    }
    const name = nameMatch[1];
    const selfClosing = inner.endsWith('/');
    if (stack.length === 0) {
      roots += 1;
      if (roots > 1) return { ok: false, error: 'multiple root elements' };
    }
    if (!selfClosing) stack.push(name);
  }
  if (stack.length) {
    return { ok: false, error: `unclosed element(s): ${stack.join(', ')}` };
  }
  if (roots === 0) return { ok: false, error: 'no root element' };
  return { ok: true };
}

export interface XmlTag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
}

const TAG_RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;

/** Flat tag scan (no nesting semantics) for structural extraction:
 *  manifest items, spine refs, anchors, images. */
export function scanTags(xml: string): XmlTag[] {
  const tags: XmlTag[] = [];
  for (const match of xml.matchAll(TAG_RE)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[3] ?? '').matchAll(ATTR_RE)) {
      attrs[attr[1] ?? attr[3]] = attr[2] ?? attr[4] ?? '';
    }
    tags.push({
      name: match[2],
      attrs,
      closing: match[1] === '/',
      selfClosing: match[4] === '/',
    });
  }
  return tags;
}
