import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import type { Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition, type ProsemirrorBinding } from '@tiptap/y-tiptap';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { toDoc } from '@book/editor/index.js';
import { createChapterEditor } from '../src/editor/createEditor';
import { bookExtensions } from '../src/editor/schema';
import { BookBehaviour } from '../src/editor/behaviour';
import { CovenantMarks } from '../src/covenant/marks';
import type { KeeperResult } from '../src/editor/caretKeeper';

/* Two writers on one book, for the caret keeper's tests (caret-keeper*.test.ts).
   A and B each hold the book in their own Y.Doc (fixed client ids 1 and 2, so the same
   steps write the same bytes); every update one writes is applied to the other at once.
   A is a chapter editor; B is a chapter editor too, or (keeper: false) a plain
   Collaboration editor with the same schema and behaviour, the code without the keeper. */

/** jsdom has no layout: ProseMirror's scrollIntoView asks for rects. Call in beforeAll. */
export function stubLayout(): void {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
}

const editors: Editor[] = [];
/** Destroy every editor the pairs made. Call in afterEach. */
export function cleanupPairs(): void {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  document.body.replaceChildren();
}

const FROM_A = Symbol('from A');
const FROM_B = Symbol('from B');

export const binding = (ed: Editor): ProsemirrorBinding => (ySyncPluginKey.getState(ed.state) as { binding: ProsemirrorBinding }).binding;

/** The position `k` letters into the first occurrence of `word` in `ed`'s text. */
export function posOf(ed: Editor, word: string, k: number): number {
  let t: number | null = null;
  ed.state.doc.descendants((n, pos) => {
    if (t === null && n.isText && n.text!.includes(word)) t = pos + n.text!.indexOf(word) + k;
  });
  if (t === null) throw new Error(`no "${word}" in the text`);
  return t;
}

/** The position just after `prefix` in the block whose text starts "The" (diag6.mjs's at()). */
export function at(ed: Editor, prefix: string): number {
  let t: number | null = null;
  ed.state.doc.descendants((n, pos) => {
    if (t === null && n.isText && n.text!.startsWith('The')) t = pos + prefix.length;
  });
  if (t === null) throw new Error('no block starting "The"');
  return t;
}

/** The text of the top-level block holding `word` (null when none does). */
export function blockWith(ed: Editor, word: string): string | null {
  let out: string | null = null;
  ed.state.doc.forEach((n) => {
    if (out === null && n.textContent.includes(word)) out = n.textContent;
  });
  return out;
}

export type Pair = {
  docA: Y.Doc;
  docB: Y.Doc;
  fragA: Y.XmlFragment;
  fragB: Y.XmlFragment;
  edA: Editor;
  edB: Editor;
  /** Every result B's keeper reported, in order. */
  results: KeeperResult[];
  /** Every selection-only transaction dispatched in B outside y-tiptap's renders, marked not for history: the keeper's. */
  keeperDispatches: Transaction[];
  /** docB's beforeTransaction / afterTransaction listener counts just before B's editor was mounted. */
  listenersBeforeB: { before: number; after: number };
  parkB: (word: string, k: number) => void;
  selectB: (anchor: number, head?: number) => void;
  typeB: (s: string) => void;
  textA: () => string;
  /** A's block text with "|" where A resolves B's head (what Part 1's awareness would draw), or null. */
  remoteCaretInA: () => string | null;
};

export const listeners = (doc: Y.Doc): { before: number; after: number } => {
  const obs = (doc as unknown as { _observers: Map<string, Set<unknown>> })._observers;
  return { before: obs.get('beforeTransaction')?.size ?? 0, after: obs.get('afterTransaction')?.size ?? 0 };
};

const mountElement = (): HTMLElement => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
};

export function pair(paras: string[], o: { keeper?: boolean; onDocB?: (docB: Y.Doc) => void } = {}): Pair {
  const keeper = o.keeper ?? true;
  const docA = new Y.Doc();
  docA.clientID = 1;
  const sec = new Y.Map<unknown>();
  docA.getArray<Y.Map<unknown>>('sections').push([sec]);
  const fragA = new Y.XmlFragment();
  sec.set('body', fragA);
  ypPmToFrag(toDoc(paras.join('\n\n')), fragA);

  const docB = new Y.Doc();
  docB.clientID = 2;
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), FROM_A);
  const fragB = docB.getArray<Y.Map<unknown>>('sections').get(0).get('body') as Y.XmlFragment;
  docA.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== FROM_B) Y.applyUpdate(docB, u, FROM_A);
  });
  docB.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== FROM_A) Y.applyUpdate(docA, u, FROM_B);
  });

  const results: KeeperResult[] = [];
  const keeperDispatches: Transaction[] = [];
  const opts = { dir: 'ltr' as const, lang: 'en', label: 'Chapter', onRefuse: () => undefined };
  const edA = createChapterEditor({ element: mountElement(), fragment: fragA, ...opts });
  editors.push(edA);
  o.onDocB?.(docB);
  const listenersBeforeB = listeners(docB);
  const edB = keeper
    ? createChapterEditor({ element: mountElement(), fragment: fragB, ...opts, onCaretResult: (r) => results.push(r) })
    : new Editor({
        element: mountElement(),
        extensions: [...bookExtensions(), Collaboration.configure({ fragment: fragB }), BookBehaviour.configure({ onRefuse: () => undefined }), CovenantMarks],
        injectCSS: false,
        enableInputRules: false,
        enablePasteRules: false,
      });
  editors.push(edB);
  const view = edB.view;
  const dispatch = view.dispatch.bind(view);
  view.dispatch = (tr: Transaction) => {
    if (tr.selectionSet && !tr.docChanged && tr.getMeta(ySyncPluginKey) === undefined && tr.getMeta('addToHistory') === false) keeperDispatches.push(tr);
    dispatch(tr);
  };

  const w: Pair = {
    docA,
    docB,
    fragA,
    fragB,
    edA,
    edB,
    results,
    keeperDispatches,
    listenersBeforeB,
    parkB: (word, k) => w.selectB(posOf(edB, word, k)),
    selectB: (anchor, head = anchor) => void edB.commands.setTextSelection({ from: anchor, to: head }),
    typeB: (s) => edB.view.dispatch(edB.state.tr.insertText(s)),
    textA: () => {
      const out: string[] = [];
      edA.state.doc.forEach((n) => void out.push(n.textContent));
      return out.join('\n');
    },
    remoteCaretInA: () => {
      const rel = absolutePositionToRelativePosition(edB.state.selection.head, fragB, binding(edB).mapping);
      const sent = Y.decodeRelativePosition(Y.encodeRelativePosition(rel));
      const pos = relativePositionToAbsolutePosition(docA, fragA, sent, binding(edA).mapping);
      if (pos === null) return null;
      const $p = edA.state.doc.resolve(pos);
      const t = $p.parent.textBetween(0, $p.parent.content.size, undefined, '\uFFFC');
      return t.slice(0, $p.parentOffset) + '|' + t.slice($p.parentOffset);
    },
  };
  return w;
}

/** B's state after the same `steps` on a pair whose B has no keeper (a plain Collaboration editor). */
export function bytesWithoutKeeper(paras: string[], steps: (w: Pair) => void): Uint8Array {
  const w = pair(paras, { keeper: false });
  steps(w);
  return Y.encodeStateAsUpdate(w.docB);
}
