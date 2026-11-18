import type { Editor } from '@tiptap/core';
import type { EditorExtra } from '../editor/extras';
import { posToTextOffset } from '@book/editor/index.js';
import { editorSection } from '../editor/active';
import { toBook } from '../editor/bridge';
import { cloudFacts } from '../closure/index';
import { editorText } from '../editor/insert';
import { ghostAt, ghostPlugin, insertGhost, rangeText, showGhost, showNotice, type Replace } from './ghost';
import type { MenuChoice } from './menu';
import { apiFetch } from './net';
import { propose, type ProposeAction, type ProposeArgs } from './propose';
import { selectionPlugin } from './selection';
import { setInsertFailure } from './state';
import { summonPlugin } from './summon';

/* The flow from a menu choice to the audit row: propose → the ghost → Insert (or Edit first, Discard, retry) →
   POST /api/aris/insert with the facts the insert measured. */

/** Ask for a proposal with `args` and show it at `at` (the pending note first). A ghost replaced or discarded while
 *  the request was out drops its answer. */
async function ask(editor: Editor, at: number, args: ProposeArgs, replace?: Replace): Promise<void> {
  const mine = showNotice(editor, at, 'pending', 'drafting…', undefined, replace);
  const r = await propose(args);
  if (editor.isDestroyed) return;
  const g = ghostAt(editor.state);
  if (!g || g.ver !== mine) return;
  const again = (res: string) => {
    if (res === 'retry') {
      const now = ghostAt(editor.state);
      void ask(editor, now?.at ?? g.at, args, now ? now.replace : g.replace);
    }
  };
  if ('error' in r) {
    showNotice(editor, g.at, 'notice', r.error, again, g.replace);
    return;
  }
  // line endings as the page holds them: an untouched proposal must never read as edited because of a carriage return
  const proposal = lf(r.text);
  showGhost(editor, g.at, proposal, (res, text) => {
    if (res === 'insert') void insert(editor, r.token, proposal, lf(text ?? proposal));
    else again(res);
  }, g.replace);
}

const lf = (s: string) => s.replace(/\r\n?/g, '\n');

async function insert(editor: Editor, token: string, proposal: string, text: string): Promise<void> {
  const facts = insertGhost(editor, text);
  if (!facts) return;
  const body = { token, bytesBefore: facts.bytesBefore, bytesAfter: facts.bytesAfter, writerEdited: text !== proposal };
  const r = await apiFetch('/api/aris/insert', { method: 'POST', body: JSON.stringify(body) });
  if (r && !('__error' in r)) {
    setInsertFailure(null);
    return;
  }
  // the writer's text stands; only the record failed — said quietly, never reverted
  const why = r ? String(r.__error) : 'Aris could not be reached';
  setInsertFailure(why);
  console.warn('[aris] the insert is in your text, but its record was not kept: ' + why);
}

/** A menu choice in `editor` at `at`: the request is fixed here — this editor's own book and section (never whichever
 *  editor is active by the time it is answered or retried) and the summon spot's offset in the section's text (where
 *  the ghost renders, not wherever the caret has gone). A retry reuses these args unchanged. */
function chosen(editor: Editor, at: number, c: MenuChoice): void {
  const own = editorSection(editor);
  const id = own?.sectionMap?.get('id');
  const args: ProposeArgs = {
    action: c.action,
    target: { manuscriptId: cloudFacts.linkedId, sectionId: typeof id === 'string' && id ? id : null },
    cursorOffset: posToTextOffset(toBook(editor.state.doc), at),
  };
  if (c.instruction !== undefined) args.instruction = c.instruction;
  void ask(editor, at, args);
}

/** A toolbar action on the selection [from, to) of `editor`: fixed as `chosen` fixes its own — this editor's book and
 *  section — plus the selected text (as the section's text holds it) and the range the ghost will replace. */
function chosenSelection(editor: Editor, from: number, to: number, action: ProposeAction): void {
  const own = editorSection(editor);
  const id = own?.sectionMap?.get('id');
  const book = toBook(editor.state.doc);
  const text = editorText(editor).text;
  const args: ProposeArgs = {
    action,
    target: { manuscriptId: cloudFacts.linkedId, sectionId: typeof id === 'string' && id ? id : null },
    selectionText: text.slice(posToTextOffset(book, from), posToTextOffset(book, to)),
  };
  void ask(editor, to, args, { from, to, orig: rangeText(editor.state.doc, from, to) });
}

/** The editor behaviour the module registers: the summon menu, the selection toolbar and the ghost. */
export const editorExtra: EditorExtra = (editor) => [summonPlugin(editor, chosen), selectionPlugin(editor, chosenSelection), ghostPlugin(editor)];
