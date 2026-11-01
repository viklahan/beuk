import type { Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import { bookSchema } from '@book/editor/index.js';

/* TipTap builds its own Schema object from the extensions. It is the same
   schema as bookSchema field for field (test/editor-schema.test.ts), but a
   different instance, and ProseMirror compares node and mark TYPES by
   identity: a bookSchema node is not "equal" to the editor's node with the
   same name and attrs, and a bookSchema node placed into the editor's
   document does not fit its content expressions.

   Part B's normalizeBlock and canApplyMark build and compare bookSchema
   nodes, so the editor hands them bookSchema copies (toBook) and takes their
   blocks back as editor nodes (toEditor). ProseMirror nodes are immutable
   and shared between states, so toBook caches by node: a chapter's
   unchanged blocks are translated once, and each normalisation costs only
   what changed. */

const bookCopies = new WeakMap<PMNode, PMNode>();

const marksIn = (marks: readonly Mark[], schema: Schema): Mark[] => marks.map((m) => schema.mark(m.type.name, m.attrs));

function copy(node: PMNode, schema: Schema, cache: WeakMap<PMNode, PMNode> | null): PMNode {
  if (node.type.schema === schema) return node;
  const hit = cache?.get(node);
  if (hit) return hit;
  let out: PMNode;
  if (node.isText) {
    out = schema.text(node.text!, marksIn(node.marks, schema));
  } else {
    const kids: PMNode[] = [];
    node.forEach((k) => kids.push(copy(k, schema, cache)));
    out = schema.nodes[node.type.name]!.create(node.attrs, kids, marksIn(node.marks, schema));
  }
  cache?.set(node, out);
  return out;
}

/** The same node in bookSchema (cached per node). */
export const toBook = (node: PMNode): PMNode => copy(node, bookSchema, bookCopies);

/** A bookSchema node as a node of the editor's schema. */
export const toEditor = (node: PMNode, schema: Schema): PMNode => copy(node, schema, null);

/** A mark of the editor's schema as the same mark in bookSchema. */
export const markToBook = (mark: Mark): Mark => bookSchema.mark(mark.type.name, mark.attrs);
