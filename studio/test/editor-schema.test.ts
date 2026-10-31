// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getAttributesFromExtensions, getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { bookSchema } from '@book/editor/index.js';
import { bookExtensions } from '../src/editor/schema';

/* Constraint 1: the TipTap editor's schema is bookSchema, exactly — the
   same node and mark names, attribute names and defaults, content
   expressions, groups, whitespace, code, atom and inclusive. */

const editorSchema: Schema = getSchema(bookExtensions());

const attrsOf = (spec: { attrs?: Record<string, { default?: unknown }> | null }) =>
  Object.fromEntries(Object.entries(spec.attrs ?? {}).map(([k, a]) => [k, Object.hasOwn(a, 'default') ? { default: a.default } : {}]));

describe('the editor schema is bookSchema', () => {
  it('the same nodes, in the same order, with the same spec fields and attributes', () => {
    expect(Object.keys(editorSchema.nodes)).toEqual(Object.keys(bookSchema.nodes));
    for (const name of Object.keys(bookSchema.nodes)) {
      const a = bookSchema.nodes[name]!, b = editorSchema.nodes[name]!;
      for (const f of ['content', 'group', 'marks', 'whitespace', 'code', 'atom', 'inline'] as const) {
        expect(b.spec[f], `${name}.${f}`).toEqual(a.spec[f]);
      }
      expect(attrsOf(b.spec), `${name} attrs`).toEqual(attrsOf(a.spec));
      // what ProseMirror derives from them
      expect(b.isTextblock, `${name} isTextblock`).toBe(a.isTextblock);
      expect(b.isAtom, `${name} isAtom`).toBe(a.isAtom);
      expect(b.spec.code ?? false, `${name} code`).toBe(a.spec.code ?? false);
      expect(b.whitespace, `${name} whitespace`).toBe(a.whitespace);
      expect(b.contentMatch.defaultType?.name, `${name} default child`).toBe(a.contentMatch.defaultType?.name);
    }
    expect(editorSchema.topNodeType.name).toBe('doc');
  });

  it('the same marks: em and strong (never italic/bold), link, footnoteRef, rawInline, with the same attrs, inclusive and excludes', () => {
    expect(Object.keys(editorSchema.marks)).toEqual(Object.keys(bookSchema.marks));
    expect(Object.keys(editorSchema.marks)).toEqual(expect.arrayContaining(['em', 'strong']));
    for (const banned of ['italic', 'bold', 'hardBreak', 'blockquote', 'heading', 'bulletList']) {
      expect(editorSchema.nodes[banned] ?? editorSchema.marks[banned], banned).toBeUndefined();
    }
    for (const name of Object.keys(bookSchema.marks)) {
      const a = bookSchema.marks[name]!, b = editorSchema.marks[name]!;
      expect(attrsOf(b.spec), `${name} attrs`).toEqual(attrsOf(a.spec));
      expect(b.spec.inclusive, `${name} inclusive`).toBe(a.spec.inclusive);
      expect(b.excludes(b), `${name} excludes itself`).toBe(a.excludes(a));
      for (const other of Object.keys(bookSchema.marks)) {
        expect(b.excludes(editorSchema.marks[other]!), `${name} excludes ${other}`).toBe(a.excludes(bookSchema.marks[other]!));
      }
    }
  });

  it('pre and post never travel with a split (keepOnSplit: false); every other attribute does; none is written to the DOM as is', () => {
    const attrs = getAttributesFromExtensions(bookExtensions());
    expect(attrs.length).toBeGreaterThan(0);
    for (const a of attrs) {
      expect(a.attribute.keepOnSplit, `${a.type}.${a.name}`).toBe(!(a.name === 'pre' || a.name === 'post'));
      expect(a.attribute.rendered, `${a.type}.${a.name}`).toBe(false);
    }
    const blocks = Object.values(bookSchema.nodes).filter((n) => n.isBlock && n.name !== 'doc').map((n) => n.name).sort();
    expect(attrs.filter((a) => a.name === 'pre').map((a) => a.type).sort()).toEqual(blocks);
  });

  it('a document Part B builds is valid in the editor schema, node for node', () => {
    const json = bookSchema.node('doc', null, [
      bookSchema.node('paragraph', { pre: null }, [bookSchema.text('a '), bookSchema.text('b', [bookSchema.mark('em')])]),
      bookSchema.node('container', { open: '::: center', close: ':::' }, [bookSchema.node('paragraph', null, [bookSchema.text('c')])]),
      bookSchema.node('sceneBreak', { raw: '❦' }),
      bookSchema.node('rawBlock', null, [bookSchema.text('> q')]),
    ]).toJSON();
    const doc = editorSchema.nodeFromJSON(json);
    doc.check();
    expect(doc.toJSON()).toEqual(json);
  });
});
