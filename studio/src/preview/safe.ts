/* Step 5 wave 4b, constraint 36: the preview's two sinks for book-controlled content.

   1.0's preview writes the open section's typeset HTML (sectionHtml) into its page flow with innerHTML, and the
   book's stylesheet (buildBookCss / the print view's) into a <style> in the document head, scoped to the preview by
   its selectors alone (".fc-page …"). Both carry values from the book file, which is untrusted, and 1.0 leaves some
   of them unescaped (a theme's headerStyle becomes a class attribute; its indentDepth and every font name go into the
   CSS as they are). The Style session's safe path (src/style/session.ts sourceSafe) already corrects those values at
   the source; these two sinks are the second wall, at the point the page takes them:

   - cleanFlowHtml: the HTML parsed inert (a <template>: nothing loads, no handler runs), then every element that can
     run script, load a document or a remote resource, or submit (script, iframe, object, embed, link, meta, style,
     base, form and its fields, media, SVG use / animation / foreignObject) is removed with its content; every on*
     handler, srcset, srcdoc, ping, formaction is removed; an href stays only on a link and only as #…, http(s): or
     mailto:; a src only as a data: picture or a same-origin path; a style declaration that loads anything other than
     a data: picture (url(), image-set(), expression(), -moz-binding, behavior) is dropped.
   - cleanBookCss: the stylesheet parsed (a detached document: nothing applies, nothing loads) and every rule checked:
     a style rule only when each of its selectors starts at the preview's scope (after an optional :root / html
     attribute prefix) and reaches nothing outside it (no :has()); @media / @supports by their rules; @font-face only
     from data: or a same-origin path; @keyframes kept; anything else (@import, @namespace, @layer…) dropped; and no
     declaration loading a remote URL.

   For an honest book neither changes a byte (test/preview-safe.test.ts: every section of every fixture and every
   preset theme), so 1.0's pagination runs on exactly 1.0's markup and CSS. */

const DROP_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'style', 'base', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'noscript', 'template', 'portal', 'audio', 'video', 'source', 'track', 'use', 'animate', 'animatemotion', 'animatetransform',
  'set', 'foreignobject', 'image', 'feimage', 'math', 'dialog']);
const DROP_ATTRS = new Set(['srcset', 'srcdoc', 'ping', 'formaction', 'action', 'background', 'poster', 'lowsrc', 'dynsrc', 'xlink:href', 'data', 'codebase',
  'attributename', 'from', 'to', 'values', 'by', 'http-equiv']);
/** A data: picture, base64 (what 1.0's sectionHtml writes for every book picture). */
const DATA_PIC = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]*$/i;
/** A same-origin path (no scheme, no //host). */
const SAME_ORIGIN = /^(?![a-z][\w+.-]*:)(?!\s*[\\/]{2})[^\s]*$/i;
const LINK_HREF = /^(#|https?:|mailto:)/i;
/** Every url(…) / image-set(…) / src(…) argument in a CSS text. */
const URL_FN = /(?:url|src)\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const LOADERS = /expression\s*\(|-moz-binding|behavior\s*:|image-set\s*\(|@import/i;

/** A CSS text loads nothing but data: pictures (and, when `paths` is set, same-origin files). */
function cssLoadsOnlySafe(text: string, paths = false): boolean {
  if (LOADERS.test(text)) return false;
  for (const m of text.matchAll(URL_FN)) {
    const u = (m[2] ?? '').trim();
    if (DATA_PIC.test(u) || (/^data:/i.test(u) && paths)) continue;
    if (paths && SAME_ORIGIN.test(u)) continue;
    return false;
  }
  // a url( the pattern above could not read (a nested quote, a bracket) is not taken
  const opens = (text.match(/(?:url|src)\(/gi) || []).length;
  return opens === [...text.matchAll(URL_FN)].length;
}

/** A style attribute's declarations that load nothing remote; one with a backslash (an escape could spell url) goes. */
function cleanStyleAttr(v: string): string {
  return splitTop(v, ';')
    .filter((d) => d.trim() && !d.includes('\\') && cssLoadsOnlySafe(d))
    .join(';');
}

function cleanElement(el: Element): void {
  for (const at of Array.from(el.attributes)) {
    const n = at.name.toLowerCase();
    const v = at.value;
    if (n.startsWith('on') || DROP_ATTRS.has(n)) el.removeAttribute(at.name);
    else if (n === 'href') {
      const tag = el.tagName.toLowerCase();
      if (!((tag === 'a' || tag === 'area') && LINK_HREF.test(v.trim()))) el.removeAttribute(at.name);
    } else if (n === 'src') {
      if (!(DATA_PIC.test(v.trim()) || SAME_ORIGIN.test(v.trim()))) el.removeAttribute(at.name);
    } else if (n === 'style') {
      if (v.includes('\\') || !cssLoadsOnlySafe(v)) {
        const c = cleanStyleAttr(v);
        if (c) el.setAttribute('style', c);
        else el.removeAttribute('style');
      }
    }
  }
}

function cleanTree(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!el.isConnected && !root.contains(el)) continue; // removed with an ancestor
    if (DROP_TAGS.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    cleanElement(el);
  }
}

/** 1.0's HTML for a page flow, parsed inert and cleaned (see above). */
export function cleanFlowFragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  cleanTree(tpl.content);
  return tpl.content;
}
/** cleanFlowFragment, serialized (the tests compare it with the inert parse of 1.0's own HTML). */
export function cleanFlowHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.content.append(cleanFlowFragment(html));
  return tpl.innerHTML;
}

/* ---- the book's stylesheet ---- */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A selector whose subject is the scope or lies inside it: the scope's class stands at the top level (not inside a
 *  pseudo-class's parentheses), and the step right after its last such place is a descendant or child step (not ~ or +,
 *  which would reach the scope's siblings). Ancestors before it are free (1.0 writes [dir="rtl"] .fc-page …,
 *  .frame-phone .fc-page …). Nothing may use :has(). */
function selectorOk(sel: string, scope: string): boolean {
  const token = new RegExp('(?<![\\w-])' + esc(scope) + '(?![\\w-])', 'g');
  return splitTop(sel, ',').every((raw) => {
    const s = raw.trim();
    if (/:has\s*\(/i.test(s)) return false;
    // the top level of the selector: parentheses, brackets and quotes masked
    let depth = 0, quote = '', top = '';
    for (const ch of s) {
      if (quote) {
        if (ch === quote) quote = '';
        top += ' ';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        top += ' ';
      } else if (ch === '(' || ch === '[') {
        depth++;
        top += ' ';
      } else if (ch === ')' || ch === ']') {
        depth--;
        top += ' ';
      } else top += depth ? ' ' : ch;
    }
    let last = -1;
    for (const m of top.matchAll(token)) last = m.index! + m[0].length;
    if (last < 0) return false;
    // the step right after the scope's own compound: a sibling step (~, +) there leaves the scope
    const step = /^[^\s>~+]*([\s>~+]*)/.exec(top.slice(last))![1]!;
    return !/[~+]/.test(step);
  });
}
/** A list split at its top-level separators (none inside () or [] or quotes). */
function splitTop(sel: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', quote = '';
  for (const ch of sel) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/* Review round 2: what 1.0's honest stylesheets never write (checked on every fixture's preview and hardcover sheets
   and every preset: test/preview-safe.test.ts) and a book value could use to leave the page box or hide a load —
   position fixed or sticky (over the app), any z-index, a custom property (--x: a value read elsewhere with var(),
   where an escape could spell url), and a backslash outside a string (an escaped property or function name). */
const STR = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
function leavesPage(rule: RuleLike): boolean {
  const st = rule.style as (CSSStyleDeclaration & { cssText: string }) | undefined;
  const text = st?.cssText ?? rule.cssText;
  if (/\\/.test(text.replace(STR, '""'))) return true;
  if (/(^|[;{\s])--[\w-]*\s*:/.test(text)) return true;
  if (st && typeof st.getPropertyValue === 'function') {
    if (/^(fixed|sticky)$/i.test(st.getPropertyValue('position').trim())) return true;
    if (st.getPropertyValue('z-index').trim()) return true;
    for (let i = 0; i < (st.length ?? 0); i++) if (String(st[i]).startsWith('--')) return true;
  }
  return /position\s*:\s*(fixed|sticky)|z-index\s*:/i.test(text);
}

type RuleLike ={ type: number; cssText: string; selectorText?: string; cssRules?: ArrayLike<RuleLike>; conditionText?: string; media?: { mediaText: string }; style?: { cssText: string } };
/** Keep `rule` when it is safe; returns its kept text (null: dropped) and counts drops into `n`. */
function keep(rule: RuleLike, scope: string, n: { dropped: number; why: string[] }): string | null {
  const name = (rule as { constructor?: { name?: string } }).constructor?.name ?? '';
  const t = rule.type;
  if (t === 1 || name === 'CSSStyleRule') {
    // a nested rule (1.0 writes none) could reach out of the scope (& ~ *) or load (& { background: url() }): dropped
    const nested = !!rule.cssRules && rule.cssRules.length > 0;
    if (nested || leavesPage(rule) || !rule.selectorText || !selectorOk(rule.selectorText, scope) || !cssLoadsOnlySafe(rule.style?.cssText ?? rule.cssText)) {
      n.dropped++;
      n.why.push(rule.cssText.slice(0, 160));
      return null;
    }
    return rule.cssText;
  }
  if (t === 4 || t === 12 || name === 'CSSMediaRule' || name === 'CSSSupportsRule') {
    const kids = Array.from(rule.cssRules ?? []).map((r) => keep(r, scope, n)).filter((x): x is string => x !== null);
    const cond = t === 4 || name === 'CSSMediaRule' ? '@media ' + (rule.media?.mediaText ?? rule.conditionText ?? '') : '@supports ' + (rule.conditionText ?? '');
    return kids.length ? cond + ' { ' + kids.join(' ') + ' }' : null;
  }
  if (t === 5 || name === 'CSSFontFaceRule') {
    if (!cssLoadsOnlySafe(rule.style?.cssText ?? rule.cssText, true)) {
      n.dropped++;
      n.why.push(rule.cssText.slice(0, 160));
      return null;
    }
    return rule.cssText;
  }
  if (t === 7 || name === 'CSSKeyframesRule') {
    if (!cssLoadsOnlySafe(rule.cssText)) {
      n.dropped++;
      n.why.push(rule.cssText.slice(0, 160));
      return null;
    }
    return rule.cssText;
  }
  n.dropped++;
  n.why.push(rule.cssText.slice(0, 160));
  return null;
}

/** The book's CSS for `scope`, checked rule by rule (see above): unchanged when every rule is safe. Parsed as a
 *  constructed stylesheet (the page's own CSS parser; it applies to nothing and loads nothing). Fails closed: a text
 *  that cannot be parsed gives nothing, and an @import anywhere in the text (which a constructed sheet ignores but a
 *  <style> would load) counts as unsafe. */
export function cleanBookCss(css: string, scope: string): { css: string; dropped: number; why: string[] } {
  const text = String(css);
  const n = { dropped: /@import/i.test(text) ? 1 : 0, why: /@import/i.test(text) ? ['@import'] : [] };
  // a backslash outside a string (1.0 writes none): the text is not handed over as it is, only the parsed rules,
  // whose escapes the parser has resolved and whose resolved text is checked below
  if (/\\/.test(text.replace(STR, '""'))) {
    n.dropped++;
    n.why.push('a backslash outside a string');
  }
  let kept: string[];
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    kept = Array.from(sheet.cssRules as unknown as ArrayLike<RuleLike>)
      .map((r) => keep(r, scope, n))
      .filter((x): x is string => x !== null);
  } catch {
    return { css: '', dropped: 1, why: ['unparsable'] };
  }
  if (!n.dropped) return { css: text, dropped: 0, why: [] };
  return { css: kept.join('\n'), dropped: n.dropped, why: n.why };
}
