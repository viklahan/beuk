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
import type { RescueReport } from '../src/editor/rescueEditor';
import { applyRemoteUpdate } from '../src/editor/rescueCore';

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
const FROM_S = Symbol('from the server writer');
const TO_S = Symbol('A to the server writer');

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
  /** Every report A's and B's keystroke rescue emitted, in order (B's stays empty when B has no keeper). */
  rescuesA: RescueReport[];
  rescuesB: RescueReport[];
  /** Every selection-only transaction dispatched in B outside y-tiptap's renders, marked not for history: the keeper's. */
  keeperDispatches: Transaction[];
  /** docB's beforeTransaction / afterTransaction / afterAllTransactions listener counts just before B's editor was mounted. */
  listenersBeforeB: { before: number; after: number; all: number };
  parkB: (word: string, k: number) => void;
  selectB: (anchor: number, head?: number) => void;
  typeB: (s: string) => void;
  textA: () => string;
  /** A's block text with "|" where A resolves B's head (what Part 1's awareness would draw), or null. */
  remoteCaretInA: () => string | null;
  /** The server writer S (client id 3): a third doc, no editor, linked to A (and so to B). It stands in for Part 1's openDirectConnection. */
  docS: Y.Doc;
  fragS: Y.XmlFragment;
  /** S turns the block whose text starts with `match` into a level-2 heading (a clone, then the original deleted). */
  serverHeading: (match: string) => void;
  /** S re-sends the whole chapter: every block replaced by a clone, `append` added to the first. */
  serverRewrite: (append: string) => void;
  /** Stop delivering updates to and from B. */
  offline: () => void;
  /** Deliver each side's missing state to the other as one update (a sync step). Returns the ms B's applyUpdate took. */
  online: () => number;
};

/** A copy of `el` as brand-new Yjs items (the server's rebuild). Clone BEFORE deleting: a deleted type's text reads as empty. */
export function cloneEl(el: Y.XmlElement, name: string = el.nodeName, attrs: Record<string, unknown> = el.getAttributes(), append = ''): Y.XmlElement {
  const n = new Y.XmlElement(name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v as string);
  n.insert(
    0,
    el.toArray().map((c) => {
      if (c instanceof Y.XmlText) {
        const t = new Y.XmlText();
        t.applyDelta([...c.toDelta(), ...(append ? [{ insert: append }] : [])]);
        return t;
      }
      return cloneEl(c as Y.XmlElement);
    }),
  );
  return n;
}

const plainText = (el: Y.XmlElement | Y.XmlText): string =>
  el instanceof Y.XmlText ? el.toDelta().map((o: { insert: string }) => o.insert).join('') : el.toArray().map((c) => plainText(c as Y.XmlElement | Y.XmlText)).join('');

export const listeners = (doc: Y.Doc): { before: number; after: number; all: number } => {
  const obs = (doc as unknown as { _observers: Map<string, Set<unknown>> })._observers;
  return { before: obs.get('beforeTransaction')?.size ?? 0, after: obs.get('afterTransaction')?.size ?? 0, all: obs.get('afterAllTransactions')?.size ?? 0 };
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
  const docS = new Y.Doc();
  docS.clientID = 3;
  Y.applyUpdate(docS, Y.encodeStateAsUpdate(docA), FROM_A);
  const fragS = docS.getArray<Y.Map<unknown>>('sections').get(0).get('body') as Y.XmlFragment;
  let bOffline = false;
  docA.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== FROM_B && !bOffline) applyRemoteUpdate(docB, u, FROM_A);
    if (origin !== FROM_S) applyRemoteUpdate(docS, u, TO_S);
  });
  docB.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== FROM_A && !bOffline) applyRemoteUpdate(docA, u, FROM_B);
  });
  docS.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== TO_S) applyRemoteUpdate(docA, u, FROM_S);
  });

  const results: KeeperResult[] = [];
  const rescuesA: RescueReport[] = [];
  const rescuesB: RescueReport[] = [];
  const keeperDispatches: Transaction[] = [];
  const opts = { dir: 'ltr' as const, lang: 'en', label: 'Chapter', onRefuse: () => undefined };
  const edA = createChapterEditor({ element: mountElement(), fragment: fragA, ...opts, onRescueResult: (r) => rescuesA.push(r) });
  editors.push(edA);
  o.onDocB?.(docB);
  const listenersBeforeB = listeners(docB);
  const edB = keeper
    ? createChapterEditor({ element: mountElement(), fragment: fragB, ...opts, onCaretResult: (r) => results.push(r), onRescueResult: (r) => rescuesB.push(r) })
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
    rescuesA,
    rescuesB,
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
    docS,
    fragS,
    serverHeading: (match) =>
      docS.transact(() => {
        const kids = fragS.toArray() as Y.XmlElement[];
        const i = kids.findIndex((k) => plainText(k).startsWith(match));
        if (i < 0) throw new Error(`no block starting "${match}"`);
        const h = cloneEl(kids[i], 'heading', { level: 2 });
        fragS.delete(i, 1);
        fragS.insert(i, [h]);
      }),
    serverRewrite: (append) =>
      docS.transact(() => {
        const copies = (fragS.toArray() as Y.XmlElement[]).map((k, i) => cloneEl(k, undefined, undefined, i === 0 ? append : ''));
        fragS.delete(0, fragS.length);
        fragS.insert(0, copies);
      }),
    offline: () => {
      bOffline = true;
    },
    online: () => {
      bOffline = false;
      const t0 = performance.now();
      applyRemoteUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)), FROM_A);
      const ms = performance.now() - t0;
      applyRemoteUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)), FROM_B);
      return ms;
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

// ---- the rescue's rig: B's link cut by hand, every update recorded and delivered with its bytes ----------
// (the spike's rig, _spike-rescue.test.ts:292-367, without its own rescue: the keeper's runs in both editors)

const A_TO_B = Symbol('A to B (rig)');
const B_TO_A = Symbol('B to A (rig)');

export type Rig = Pair & {
  /** Stop the live link to and from B; from now on each side's own updates are queued. */
  cut(): void;
  /** A's own updates (as A sent them) delivered to B, in order. */
  aToB(): void;
  /** B's own updates (as B sent them) delivered to A, in order. */
  bToA(): void;
  /** A one-shot full diff A -> B (a sync step 2: A's whole delete set); A's queue is dropped. */
  fullAToB(): void;
  fullBToA(): void;
  /** Reconnect: what is queued, both ways, then the pair's live link again (a full sync step). */
  join(): void;
  /** How often `s` occurs in A's text. */
  count(s: string): number;
  textB(): string;
};

export function rig(paras: string[]): Rig {
  const w = pair(paras);
  let isCut = false;
  let qA: Uint8Array[] = [];
  let qB: Uint8Array[] = [];
  w.docA.on('update', (u: Uint8Array, origin: unknown) => {
    if (isCut && origin !== B_TO_A) qA.push(u);
  });
  w.docB.on('update', (u: Uint8Array, origin: unknown) => {
    if (isCut && origin !== A_TO_B) qB.push(u);
  });
  const g: Rig = Object.assign(w, {
    cut: () => {
      w.offline();
      isCut = true;
    },
    aToB: () => {
      const q = qA;
      qA = [];
      for (const u of q) applyRemoteUpdate(w.docB, u, A_TO_B);
    },
    bToA: () => {
      const q = qB;
      qB = [];
      for (const u of q) applyRemoteUpdate(w.docA, u, B_TO_A);
    },
    fullAToB: () => {
      qA = [];
      applyRemoteUpdate(w.docB, Y.encodeStateAsUpdate(w.docA, Y.encodeStateVector(w.docB)), A_TO_B);
    },
    fullBToA: () => {
      qB = [];
      applyRemoteUpdate(w.docA, Y.encodeStateAsUpdate(w.docB, Y.encodeStateVector(w.docA)), B_TO_A);
    },
    join: () => {
      g.aToB();
      g.bToA();
      g.aToB();
      isCut = false;
      w.online();
    },
    count: (s: string) => w.textA().split(s).length - 1,
    textB: () => {
      const out: string[] = [];
      w.edB.state.doc.forEach((n) => void out.push(n.textContent));
      return out.join('\n');
    },
  });
  return g;
}
