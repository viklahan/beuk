import { Mark, Node, type AnyExtension, type Attributes } from '@tiptap/core';
import type { MarkSpec, NodeSpec, DOMOutputSpec, Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';
import { bookSchema } from '@book/editor/index.js';

/* The TipTap editor's schema, GENERATED from Part B's bookSchema
   (src/book/editor/schema.ts) so the two cannot drift: the same node and
   mark names, attribute names and defaults (null where null), content
   expressions, groups, `whitespace: 'pre'`, `code`, `atom`, `inclusive`.
   test/editor-schema.test.ts compares the resulting ProseMirror schema with
   bookSchema field by field.

   - Marks are `em` and `strong` (no StarterKit: its `italic`/`bold`/
     `hardBreak`/`blockquote` differ), no TrailingNode, and nothing that
     normalises a document when it opens.
   - Every block's `pre` and `post` are `keepOnSplit: false` (an editor
     split must not copy a separator), and no attribute is written to the DOM
     as is (`rendered: false`): toDOM below draws what the writer sees.
   - The DOM is for display only. The book's text lives in the Y fragment;
     y-tiptap never parses the DOM, and paste falls back to the defaults. */

const SEPARATORS = new Set(['pre', 'post']);

function attributesOf(spec: NodeSpec | MarkSpec): Attributes {
  const out: Attributes = {};
  for (const [name, a] of Object.entries(spec.attrs ?? {})) {
    out[name] = { default: (a as { default?: unknown }).default, rendered: false, keepOnSplit: !SEPARATORS.has(name) };
  }
  return out;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The href the PAGE gets for a link (display only: the stored attr, and so the book's text, is never touched).
 *  http, https, mailto and relative or fragment hrefs (resolved against the page) pass as written; anything else
 *  (javascript:, data:, vbscript:, file:, blob:, unparsable) becomes "#". ASCII control characters and whitespace
 *  are dropped before the check, because browsers ignore them inside a scheme ("java\tscript:"). */
export function safeHref(v: unknown): string {
  const raw = str(v);
  const probe = raw.replace(/[\u0000-\u0020\u007f]/g, '');
  let url: URL;
  try {
    url = new URL(probe, globalThis.location?.href ?? 'https://beuk.invalid/');
  } catch {
    return '#';
  }
  return SAFE_PROTOCOLS.has(url.protocol) ? raw : '#';
}

/** What each block looks like on the page. Leaf atoms show their source-ish text; nothing here is read back. */
const NODE_DOM: Record<string, (node: PMNode) => DOMOutputSpec> = {
  doc: () => ['div', 0],
  paragraph: () => ['p', 0],
  footnoteDef: (n) => ['p', { class: 'ms-fndef', 'data-n': str(n.attrs.n), 'data-caret': n.attrs.caret ? '^' : '' }, 0],
  image: (n) => ['figure', { class: 'ms-image', 'data-id': str(n.attrs.id), contenteditable: 'false' }, ['figcaption', {}, str(n.attrs.caption ?? n.attrs.alt) || str(n.attrs.id)]],
  sceneBreak: (n) => ['div', { class: 'ms-scene', contenteditable: 'false' }, str(n.attrs.raw)],
  container: (n) => ['div', { class: 'ms-container', 'data-open': str(n.attrs.open) }, 0],
  rawBlock: () => ['pre', { class: 'ms-raw' }, 0],
};

const MARK_DOM: Record<string, (mark: PMMark) => DOMOutputSpec> = {
  link: (m) => ['a', { href: safeHref(m.attrs.href), rel: 'noopener noreferrer nofollow', target: '_blank' }, 0],
  em: () => ['em', 0],
  strong: () => ['strong', 0],
  footnoteRef: () => ['span', { class: 'ms-fnref' }, 0],
  rawInline: () => ['span', { class: 'ms-rawinline' }, 0],
};

/** Paste: only the plain, unambiguous tags (everything else arrives as text and is normalised). */
const NODE_PARSE: Record<string, { tag: string; preserveWhitespace?: 'full' }[]> = {
  paragraph: [{ tag: 'p' }],
  rawBlock: [{ tag: 'pre', preserveWhitespace: 'full' }],
};
const MARK_PARSE: Record<string, { tag: string }[]> = {
  em: [{ tag: 'em' }, { tag: 'i' }],
  strong: [{ tag: 'strong' }, { tag: 'b' }],
};

function nodeExtension(name: string, spec: NodeSpec): AnyExtension {
  const dom = NODE_DOM[name];
  return Node.create({
    name,
    topNode: name === 'doc',
    ...(spec.group !== undefined && { group: spec.group }),
    ...(spec.content !== undefined && { content: spec.content }),
    ...(spec.marks !== undefined && { marks: spec.marks }),
    ...(spec.inline !== undefined && { inline: spec.inline }),
    ...(spec.atom !== undefined && { atom: spec.atom }),
    ...(spec.code !== undefined && { code: spec.code }),
    ...(spec.whitespace !== undefined && { whitespace: spec.whitespace }),
    addAttributes: () => attributesOf(spec),
    parseHTML: () => NODE_PARSE[name] ?? [],
    ...(dom && { renderHTML: ({ node }: { node: PMNode }) => dom(node) }),
  });
}

function markExtension(name: string, spec: MarkSpec): AnyExtension {
  const dom = MARK_DOM[name];
  if (!dom) throw new Error(`the editor has no DOM for the book mark "${name}"`);
  return Mark.create({
    name,
    ...(spec.inclusive !== undefined && { inclusive: spec.inclusive }),
    ...(spec.excludes !== undefined && { excludes: spec.excludes }),
    addAttributes: () => attributesOf(spec),
    parseHTML: () => MARK_PARSE[name] ?? [],
    renderHTML: ({ mark }: { mark: PMMark }) => dom(mark),
  });
}

/** One TipTap extension per node and mark of bookSchema, in its order. */
export function bookExtensions(): AnyExtension[] {
  const out: AnyExtension[] = [];
  bookSchema.spec.nodes.forEach((name, spec) => {
    if (name !== 'text' && !NODE_DOM[name]) throw new Error(`the editor has no DOM for the book node "${name}"`);
    out.push(nodeExtension(name, spec));
  });
  bookSchema.spec.marks.forEach((name, spec) => out.push(markExtension(name, spec)));
  return out;
}
