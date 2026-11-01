import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';

/* BEUK:editor-schema — the ProseMirror schema of a section's text in Beuk
   2.0. Framework-free: no DOM, no React, no TipTap. Part C wraps each node
   and mark as a TipTap extension under the SAME name.

   The dialect is 1.0's section `content` (client/index.html renders it:
   contentBlocksToHtml, inlineMd, parseContainers). Only the constructs the
   corpus survey ranked top ten are modelled (step-4 report, Task 1), plus
   headings, quotes and lists (step 5 wave 2a, B6); the rest are rawBlock
   (a block of source text, verbatim) or the rawInline mark (a span of
   source text, verbatim).

   Lossless rules every node keeps (convert.ts):
   - every block carries `pre` (the exact text between the previous block
     and this one: blank lines, a block's trimmed leading whitespace) and
     `post` (text after it; written for the last child only, since an editor
     split copies attrs). `pre: null` is the
     canonical separator: "" before the first block, "\n\n" before others;
   - a line break inside a block is a "\n" (or "\r\n") character in the
     text, never a node, so marks run across it and Yjs keeps it (marks on
     inline element nodes do not survive y-prosemirror);
   - paragraph and footnoteDef declare whitespace "pre", so prosemirror-view
     keeps a "
" on DOM read-back instead of folding it into a space;
   - footnote references are TEXT ("[^1]") under the footnoteRef mark, for
     the same reason: an emphasis that runs over a reference must survive
     the Yjs round trip. */

const blockAttrs = {
  pre: { default: null as string | null },
  post: { default: '' },
};

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  /** Running text: 1.0's paragraph (lines joined by "\n" in the text). */
  paragraph: { group: 'block', content: 'text*', marks: '_', whitespace: 'pre', attrs: { ...blockAttrs } },

  /** A note definition, "[^n]: text" or "[n]: text". `n` is the digits as written, `gap` the whitespace after the colon. */
  footnoteDef: {
    group: 'block', content: 'text*', marks: '_', whitespace: 'pre',
    attrs: { ...blockAttrs, n: { default: '1' }, caret: { default: true }, gap: { default: ' ' } },
  },

  /** A picture line, ![alt](img:id|full "caption"). `caption` null = no caption; capGap, q1, q2 are its exact spacing and quote marks. */
  image: {
    group: 'block', atom: true,
    attrs: {
      ...blockAttrs, alt: { default: '' }, id: { default: '' }, full: { default: false },
      caption: { default: null as string | null }, capGap: { default: ' ' }, q1: { default: '"' }, q2: { default: '"' },
    },
  },

  /** A scene break as written: "***", "❦", "⁂", or a form beautifyText turns into "***" ("###", "---", "___", "#"). */
  sceneBreak: { group: 'block', atom: true, attrs: { ...blockAttrs, raw: { default: '***' } } },

  /** A ":::" container whose content is ordinary blocks (v1: center and right). `open` is the opener line as written,
   *  `openEol` its line ending, `close` the closing line as written, or null when the container runs to the end.
   *  Every attr whose meaningful value can be null DEFAULTS to null: y-prosemirror never stores a null attr, so a
   *  non-null default would come back in its place (a new container sets close ":::" explicitly). */
  container: {
    group: 'block', content: 'block+',
    attrs: { ...blockAttrs, open: { default: '::: center' }, openEol: { default: '\n' }, close: { default: null as string | null } },
  },

  /** A heading block (1.0's emitText): "# " (level 1, 1.0's h2) or "## " (level 2, 1.0's h3) and the block's text. A
   *  line break inside stays a "\n" character, as in a paragraph. Wave 2a (B6). */
  heading: { group: 'block', content: 'text*', marks: '_', whitespace: 'pre', attrs: { ...blockAttrs, level: { default: 1 } } },

  /** A quotation block: every line starts with ">" (1.0's emitText). One quoteLine per line, joined by "\n". */
  quote: { group: 'block', content: 'quoteLine+', attrs: { ...blockAttrs } },
  /** One line of a quote: `prefix` is its ">" with the one whitespace character 1.0 strips after it (/^>\s?/), as
   *  written; the rest is the line's text (1.0 reads each line's inline marks on its own). */
  quoteLine: { content: 'text*', marks: '_', whitespace: 'pre', attrs: { prefix: { default: '> ' } } },

  /** A list block (1.0's listItemsOf): bulleted ("- ", "* ", "• ", at least two items) or numbered ("1. ", "1) ").
   *  One listItem per marked line, joined by "\n". */
  list: { group: 'block', content: 'listItem+', attrs: { ...blockAttrs } },
  /** One item: `marker` is the item's mark as written (LIST_BULLET / LIST_NUMBER with its spacing); the text runs on
   *  over the unmarked lines that continue it ("\n" characters in the text, as 1.0 joins them to the item). */
  listItem: { content: 'text*', marks: '_', whitespace: 'pre', attrs: { marker: { default: '- ' } } },

  /** Source text the converter does not model, verbatim. Edits as plain text. */
  rawBlock: { group: 'block', content: 'text*', marks: '', code: true, attrs: { ...blockAttrs } },

  text: { group: 'inline' },
};

const marks: Record<string, MarkSpec> = {
  /** [label](https://… | http://… | mailto:…), 1.0's mdLinkRe. The label may carry em and strong. */
  link: { attrs: { href: { default: '' } }, inclusive: false },
  /** *x*: 1.0 reads only the asterisk (inlineMd's emph); _x_ is plain text in 1.0. */
  em: {},
  /** **x** */
  strong: {},
  /** A footnote reference written as text, "[^n]" or "[n]"; the text is the source. */
  footnoteRef: { inclusive: false },
  /** A span of source the converter does not model (a redaction ||x||, a note link [x](note:slug)), verbatim. */
  rawInline: { inclusive: false },
};

export const bookSchema = new Schema({ nodes, marks });

/** The marks that write delimiters around their text, outermost first when two would open on the same span. */
export const DELIMITED_MARKS = ['link', 'em', 'strong'] as const;

/** Blocks whose children are LINES (textblocks written one per line, "\n" between them, each after its own prefix). */
export const LINE_BLOCKS: ReadonlySet<string> = new Set(['quote', 'list']);

/** The text a textblock writes before its inline content (convert.ts blockText): a note definition's "[^n]: ", a
 *  heading's "# ", a quote line's ">", a list item's marker. "" for the others. */
export function textblockPrefix(node: import('prosemirror-model').Node): string {
  const a = node.attrs;
  switch (node.type.name) {
    case 'footnoteDef': return '[' + (a.caret ? '^' : '') + String(a.n) + ']:' + String(a.gap);
    case 'heading': return (Number(a.level) === 2 ? '## ' : '# ');
    case 'quoteLine': return String(a.prefix);
    case 'listItem': return String(a.marker);
    default: return '';
  }
}
