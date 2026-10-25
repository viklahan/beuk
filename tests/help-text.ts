/**
 * Visible text of an HTML fragment, for the H1 "copy stays verbatim"
 * proof: a tiny tag tokenizer that drops whole subtrees whose class
 * list contains one of `skipClasses` (page chrome and UI that is not
 * guide copy: kickers, the meta bar, "Show in …" buttons, code chips),
 * decodes entities, and collapses whitespace.
 */
const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'wbr']);

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function visibleText(html: string, skipClasses: string[] = []): string {
  const out: string[] = [];
  const stack: { tag: string; skip: boolean }[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const skipping = () => stack.some((s) => s.skip);
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) {
      if (!skipping()) out.push(decode(m[5]));
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      out.push(' ');
      continue;
    }
    if (tag === 'script' || tag === 'style') {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end + tag.length + 3;
      continue;
    }
    const cls = /\sclass="([^"]*)"/.exec(m[3])?.[1]?.split(/\s+/) ?? [];
    const skip = cls.some((c) => skipClasses.includes(c)) || /\shidden(\s|=|$)/.test(m[3]) && tag === 'button';
    if (!VOID.has(tag) && m[4] !== '/') stack.push({ tag, skip });
    out.push(' ');
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** The guide copy inside a pre-H1 static page: <main> minus the back link. */
export function oldGuideText(html: string): string {
  const main = /<main class="page">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
  return visibleText(main, ['back-link']);
}

/** The guide copy inside a new rendered guide page: the article minus UI. */
export function newGuideText(html: string): string {
  const art = /<article class="g-art">([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
  return visibleText(art, ['kicker', 'g-meta', 'see', 'code-chips', 'related', 'tech', 'num', 'new']);
}
