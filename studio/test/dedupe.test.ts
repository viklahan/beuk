import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { Node as PMNode, Schema } from 'prosemirror-model';
import { Node as TTNode, Schema as TTSchema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { IndexeddbPersistence } from 'y-indexeddb';
import { bookSchema, importBook } from '@book/editor/index.js';
import { getSchema } from '@tiptap/core';
import { bookExtensions } from '../src/editor/schema';

/* Constraint 2: ONE yjs and one copy of each prosemirror package, for the
   book core (src/book), y-tiptap, y-indexeddb and TipTap alike. Two copies
   break instanceof checks and Yjs's "already imported" guard. */

const NM = path.join(import.meta.dirname, '..', 'node_modules');
const SINGLE = ['yjs', 'lib0', 'y-protocols', 'y-prosemirror', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-transform'];

/** Every installed copy of a package: node_modules/<name> at any depth. */
function copies(name: string, dir = NM, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (e.startsWith('@')) { copies(name, p, out); continue; }
    if (e === name && statSync(path.join(p, 'package.json'), { throwIfNoEntry: false })) out.push(p);
    const nested = path.join(p, 'node_modules');
    if (statSync(nested, { throwIfNoEntry: false })?.isDirectory()) copies(name, nested, out);
  }
  return out;
}

describe('one Yjs, one ProseMirror (constraint 2)', () => {
  it('node_modules holds exactly one copy of each, at the pinned versions', () => {
    const pins = (JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies;
    for (const name of SINGLE) {
      const found = copies(name);
      expect(found.map((p) => path.relative(NM, p)), name).toHaveLength(1);
      const v = (JSON.parse(readFileSync(path.join(found[0]!, 'package.json'), 'utf8')) as { version: string }).version;
      if (pins[name]) expect(v, name).toBe(pins[name]);
    }
  });

  it('at run time the book core, TipTap and the bindings share the classes', () => {
    const { ydoc } = importBook({ meta: { title: 'x' }, sections: [{ id: 'a', content: 'Hi *there*.' }] });
    expect(ydoc).toBeInstanceOf(Y.Doc);
    expect(ydoc.getArray('sections').get(0)).toBeInstanceOf(Y.Map);
    expect(bookSchema).toBeInstanceOf(Schema);
    expect(Schema).toBe(TTSchema);
    expect(PMNode).toBe(TTNode);
    const ttSchema = getSchema(bookExtensions());
    expect(ttSchema.node('paragraph')).toBeInstanceOf(PMNode);
    expect(EditorState.create({ schema: bookSchema }).doc).toBeInstanceOf(TTNode);
    // y-indexeddb and y-tiptap load against the same yjs (a second copy would warn "Yjs was already imported")
    const p = new IndexeddbPersistence('dedupe-probe', new Y.Doc());
    expect(p.doc).toBeInstanceOf(Y.Doc);
    void p.destroy().catch(() => undefined);
    expect(ySyncPluginKey).toBeDefined();
  });
});
