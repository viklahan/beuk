import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { toDoc } from '@book/editor/index.js';
import { createChapterEditor, positionMigrationStore } from '../src/editor/createEditor';
import { applyTextEdit, editorText } from '../src/editor/insert';

/* Task 5 (studio-2 cutover): undo storms never crash or slow down.

   Wave 2a measured ~239 ms per undo after 100 cycles and a tab crash at ~115.
   Reproduced here: a plain insertText + undo + redo stays flat (0.2-0.5 ms),
   but an edit y-tiptap writes as a block rewrite (every toolbar action goes
   through applyTextEdit; a normalised block; an Enter that splits) makes the
   binding write "position migration" records into the book's Y.Doc, and every
   undo and redo then walks and re-copies all of them: undo 7.8 ms → 788 ms in
   80 cycles. Once one such record exists, even plain typing grows (3 → 35 ms
   in 80 cycles). See createEditor.ts (holdPositionMigrations) and the report.

   The cycle here: a toolbar-style edit (one word, through applyTextEdit, as
   1.0's textarea functions do), undo, redo; 300 times, on a 2,000-word chapter
   held the way the studio holds it (a fragment inside a section's Y.Map). */

beforeAll(() => {
  // jsdom has no layout: ProseMirror's scrollIntoView asks for rects
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while rain falls softly on old roofs'.split(' ');
/** A typical chapter: `words` words in paragraphs of 100. */
function chapter(words: number): string {
  const paras: string[] = [];
  let n = 0;
  while (n < words) {
    const p: string[] = [];
    for (let i = 0; i < 100 && n < words; i++, n++) p.push(WORDS[(n * 7) % WORDS.length]!);
    paras.push(p.join(' ') + '.');
  }
  return paras.join('\n\n');
}

/** A book-like Y.Doc: the chapter's fragment inside a section's Y.Map (as sections.ts holds it). */
function mount(text: string): { ed: Editor; doc: Y.Doc; frag: Y.XmlFragment } {
  const doc = new Y.Doc();
  const sections = doc.getArray<Y.Map<unknown>>('sections');
  const sec = new Y.Map<unknown>();
  sections.push([sec]);
  const frag = new Y.XmlFragment();
  sec.set('body', frag);
  ypPmToFrag(toDoc(text), frag);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = createChapterEditor({ element, fragment: frag, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
  editors.push(ed);
  return { ed, doc, frag };
}

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
const undoManager = (ed: Editor) => (yUndoPluginKey.getState(ed.state) as { undoManager: Y.UndoManager }).undoManager;

describe('undo storms (task 5)', () => {
  it('300 cycles of type, undo, redo on a 2,000-word chapter: no throw, and the p95 of the last 100 undos is no more than 2x the p95 of the first 100', () => {
    const { ed, frag } = mount(chapter(2000));
    const times: number[] = [];
    expect(() => {
      for (let i = 0; i < 300; i++) {
        const cur = editorText(ed);
        const at = Math.floor(cur.text.length / 2);
        const typed = cur.text.slice(0, at) + ' storm' + i + cur.text.slice(at);
        applyTextEdit(ed, { text: typed, start: at + 6, end: at + 6 });
        const t0 = performance.now();
        ed.commands.undo();
        times.push(performance.now() - t0);
        if (editorText(ed).text !== cur.text) throw new Error(`cycle ${i}: the undo did not give back the text before the edit`);
        ed.commands.redo();
        if (editorText(ed).text !== typed) throw new Error(`cycle ${i}: the redo did not give back the edited text`);
      }
    }).not.toThrow();
    const first = p95(times.slice(0, 100));
    const last = p95(times.slice(-100));
    console.log(`undo-storm: p95 first 100 = ${first.toFixed(2)} ms, last 100 = ${last.toFixed(2)} ms, max = ${Math.max(...times).toFixed(2)} ms`);
    expect(last).toBeLessThanOrEqual(2 * first);
    // the cause, held: y-tiptap's position-migration map for this chapter stays empty (no records in the book)
    expect(positionMigrationStore(frag)!.size).toBe(0);
    // every cycle is its own undo step, and the stack still reaches back to the first (nothing was capped)
    expect(undoManager(ed).undoStack.length).toBe(300);
  }, 120_000); // ~6 s here once fixed; before the fix the cycles grow quadratically and never finish in time

  it('records an older build left in the book are cleared when the chapter opens, and records arriving from another tab are cleared as they land', () => {
    const doc = new Y.Doc();
    const sections = doc.getArray<Y.Map<unknown>>('sections');
    const sec = new Y.Map<unknown>();
    sections.push([sec]);
    const frag = new Y.XmlFragment();
    sec.set('body', frag);
    ypPmToFrag(toDoc(chapter(200)), frag);
    const store = positionMigrationStore(frag)!;
    store.set('1:1', { version: 1, transfers: [] });
    const orphan = doc.getMap('__tiptap_position_migrations:item:9:9'); // a section a move re-created
    orphan.set('2:2', { version: 1, transfers: [] });
    const before = Y.encodeStateAsUpdate(doc);
    const element = document.createElement('div');
    document.body.appendChild(element);
    const ed = createChapterEditor({ element, fragment: frag, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
    editors.push(ed);
    expect(store.size).toBe(0);
    expect(orphan.size).toBe(0);
    // another tab (an older build) writes a record: it arrives as an update and is cleared
    const other = new Y.Doc();
    Y.applyUpdate(other, before);
    const otherSec = other.getArray<Y.Map<unknown>>('sections').get(0);
    const otherFrag = otherSec.get('body') as Y.XmlFragment;
    const otherStore = other.getMap('__tiptap_position_migrations:item:' + otherFrag._item!.id.client + ':' + otherFrag._item!.id.clock);
    const sv = Y.encodeStateVector(other);
    otherStore.set('3:3', { version: 1, transfers: [] });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, sv));
    expect(store.size).toBe(0);
    // the text is untouched by any of it
    expect(editorText(ed).text).toBe(chapter(200));
  });
});
