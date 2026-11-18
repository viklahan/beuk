import type { Editor } from '@tiptap/core';
import type { EditorExtra } from '../editor/extras';
import { caretOffset, activeEditor } from '../editor/active';
import { ghostAt, ghostPlugin, insertGhost, showGhost, showNotice } from './ghost';
import type { MenuChoice } from './menu';
import { apiFetch } from './net';
import { propose, type ProposeArgs } from './propose';
import { setInsertFailure } from './state';
import { summonPlugin } from './summon';

/* The flow from a menu choice to the audit row: propose → the ghost → Insert (or Edit first, Discard, retry) →
   POST /api/aris/insert with the facts the insert measured. */

/** Ask for a proposal with `args` and show it at `at` (the pending note first). A ghost replaced or discarded while
 *  the request was out drops its answer. */
async function ask(editor: Editor, at: number, args: ProposeArgs): Promise<void> {
  const mine = showNotice(editor, at, 'pending', 'drafting…');
  const r = await propose(args);
  if (editor.isDestroyed) return;
  const g = ghostAt(editor.state);
  if (!g || g.ver !== mine) return;
  const again = (res: string) => {
    if (res === 'retry') void ask(editor, ghostAt(editor.state)?.at ?? g.at, args);
  };
  if ('error' in r) {
    showNotice(editor, g.at, 'notice', r.error, again);
    return;
  }
  showGhost(editor, g.at, r.text, (res, text) => {
    if (res === 'insert') void insert(editor, r.token, r.text, text ?? r.text);
    else again(res);
  });
}

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

function chosen(editor: Editor, at: number, c: MenuChoice): void {
  const a = activeEditor();
  // the caret is on the summon spot when the menu was chosen; its offset is the section's, read now
  const cursorOffset = a && a.editor === editor ? caretOffset(a.section) : undefined;
  const args: ProposeArgs = { action: c.action };
  if (c.instruction !== undefined) args.instruction = c.instruction;
  if (cursorOffset !== undefined && cursorOffset >= 0) args.cursorOffset = cursorOffset;
  void ask(editor, at, args);
}

/** The editor behaviour the module registers: the summon menu and the ghost. */
export const editorExtra: EditorExtra = (editor) => [summonPlugin(editor, chosen), ghostPlugin(editor)];
