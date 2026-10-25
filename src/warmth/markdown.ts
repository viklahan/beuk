/**
 * A deliberately small, safe Markdown → HTML renderer for Beuk's own
 * documents (CHANGELOG.md, docs/roadmap.md). It supports exactly what
 * those files use — headings, paragraphs, bullet/numbered lists,
 * blockquotes, horizontal rules, bold, italic, inline code and links —
 * and escapes all raw HTML first, so a document can never inject markup.
 * Not a general Markdown implementation; no new dependency on purpose.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSafeUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(url);
}

export function renderInline(escaped: string): string {
  // Inline code first (its contents take no further formatting).
  const parts = escaped.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      return part
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
          isSafeUrl(url) ? `<a href="${url}">${label}</a>` : label,
        )
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    })
    .join('');
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      out.push(
        `<${tag}>${list.items.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join('')}</${tag}>`,
      );
      list = null;
    }
  };
  const flushQuote = (): void => {
    if (quote.length) {
      out.push(`<blockquote><p>${renderInline(escapeHtml(quote.join(' ')))}</p></blockquote>`);
      quote = [];
    }
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll();
      out.push('<hr />');
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((unordered ?? ordered)![1]);
      continue;
    }
    const quoted = /^>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    if (line.trim() === '') {
      flushAll();
      continue;
    }
    // A wrapped (indented) continuation line of a list item belongs to
    // that item — our own documents wrap bullets this way.
    if (list && /^\s+\S/.test(rawLine) && list.items.length) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return out.join('\n');
}
