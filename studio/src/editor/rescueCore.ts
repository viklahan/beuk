import * as Y from 'yjs';
import { OBJ } from './textMatch';

// The keystroke rescue's pure core: what a transaction wrote, and the one function every remote update goes through.

export const textOf = (t: Y.XmlText): string => t.toDelta().map((o: { insert: unknown }) => (typeof o.insert === 'string' ? o.insert : OBJ)).join('');

/** `t` is `frag` or lies inside it. */
export const inside = (frag: Y.XmlFragment, t: Y.AbstractType<any>): boolean => t === frag || (t._item !== null && Y.isParentOf(frag, t._item));

/** `tr` changed something in `frag` (a change elsewhere in the book cannot move this editor's caret). */
export const touches = (tr: Y.Transaction, frag: Y.XmlFragment): boolean => {
  for (const t of tr.changed.keys()) if (inside(frag, t)) return true;
  return false;
};

/** What `tr` wrote inside `frag`: the XmlTexts it changed, plus every XmlText inside a block it created (an
 *  item is new when its clock is at or past the transaction's state vector for its client); and the empty
 *  blocks it created. An empty block holds no XmlText in Yjs (y-tiptap writes none), so it is searched as
 *  the empty text "": the empty-block rule of findInText. */
export function written(tr: Y.Transaction, frag: Y.XmlFragment): { texts: Y.XmlText[]; empties: Y.XmlElement[] } {
  const texts = new Set<Y.XmlText>();
  const empties = new Set<Y.XmlElement>();
  const isNew = (it: Y.Item) => it.id.clock >= (tr.beforeState.get(it.id.client) ?? 0);
  const add = (c: Y.AbstractType<any>) => {
    if (c instanceof Y.XmlText) texts.add(c);
    else if (c instanceof Y.XmlElement) {
      if (c.length === 0) empties.add(c);
      else all(c);
    }
  };
  const all = (t: Y.XmlFragment | Y.XmlElement) => {
    for (let it = t._start; it; it = it.right) {
      if (!it.deleted && it.content instanceof Y.ContentType) add(it.content.type);
    }
  };
  tr.changed.forEach((_k, t) => {
    if (!inside(frag, t) || t._item?.deleted) return;
    if (t instanceof Y.XmlText) {
      texts.add(t);
      return;
    }
    if (!(t instanceof Y.XmlFragment || t instanceof Y.XmlElement)) return;
    for (let it = t._start; it; it = it.right) {
      if (!it.deleted && isNew(it) && it.content instanceof Y.ContentType) add(it.content.type);
    }
  });
  return { texts: [...texts], empties: [...empties] };
}

/** The XmlTexts `tr` changed inside `frag`, plus every XmlText inside a block it created. */
export function writtenTexts(tr: Y.Transaction, frag: Y.XmlFragment): Y.XmlText[] {
  return written(tr, frag).texts;
}

// The bytes of the remote update being applied, for the duration of that one apply (V1 updates only: the
// store sends V1). A WeakMap keyed by doc, restored in finally, so a nested apply gives the outer bytes back
// and a throwing apply leaves none behind.
const incoming = new WeakMap<Y.Doc, Uint8Array>();

/** Apply a remote V1 update to `doc`; while it applies, `incomingUpdate(doc)` returns its bytes. */
export function applyRemoteUpdate(doc: Y.Doc, update: Uint8Array, origin: unknown): void {
  const prev = incoming.get(doc);
  incoming.set(doc, update);
  try {
    Y.applyUpdate(doc, update, origin);
  } finally {
    if (prev) incoming.set(doc, prev);
    else incoming.delete(doc);
  }
}

/** The bytes of the remote update being applied to `doc` right now, or null when none is. */
export function incomingUpdate(doc: Y.Doc): Uint8Array | null {
  return incoming.get(doc) ?? null;
}
