import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { toDoc } from '@book/editor/index.js';
import { createChapterEditor } from '../src/editor/createEditor';
import { editorText } from '../src/editor/insert';
import { clearActiveEditor, setActiveEditor } from '../src/editor/active';
import { resetEditorExtras } from '../src/editor/extras';
import { cloudFacts, resetCloudFacts } from '../src/closure/index';
import { mountAris } from '../src/aris/index';
import { setArisFetch } from '../src/aris/net';
import { setInsertRetryMs } from '../src/aris/flow';
import { insertFailure, resetArisState, setArisStatus } from '../src/aris/state';
import { DEFAULT_MODELS } from '../src/aris/propose';

/* Task 10: the summon menu, the ghost proposal, and the insert flow, on a real chapter editor (TipTap on a Y fragment)
   in jsdom, with the server answered by an injected fetch. */

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});

const MS = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
type Call = { path: string; body: Record<string, unknown> | null };
let calls: Call[];
let drafts: { status: number; body: unknown }[];
let insertReply: { status: number; body: unknown };

function fakeFetch(): typeof fetch {
  return (async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (path === '/api/aris/status') return json(200, { enabled: true, optedIn: true, voice: 'laconic', keys: [{ provider: 'anthropic', last4: 'abcd' }] });
    if (path === '/api/aris/draft') {
      const d = drafts.shift() ?? { status: 200, body: { proposal: { text: 'The rain came.', model: 'm', provider: 'anthropic', action: 'continue' }, token: 'tok-1' } };
      return json(d.status, d.body);
    }
    if (path === '/api/aris/insert') return json(insertReply.status, insertReply.body);
    return json(404, { error: 'nope' });
  }) as unknown as typeof fetch;
}

const editors: Editor[] = [];
beforeEach(() => {
  setInsertRetryMs(0);
  calls = [];
  drafts = [];
  insertReply = { status: 202, body: { recorded: true } };
  resetArisState();
  resetEditorExtras();
  resetCloudFacts();
  cloudFacts.linkedId = MS;
  setArisFetch(fakeFetch());
});
afterEach(() => {
  for (const e of editors.splice(0)) {
    clearActiveEditor(e);
    if (!e.isDestroyed) e.destroy();
  }
  setArisFetch(null);
  document.body.innerHTML = '';
});

/** A chapter editor on a fresh book holding `text` in section "sec-1", made the active editor. */
function mount(text: string, dir: 'ltr' | 'rtl' = 'ltr', sectionId = 'sec-1'): { ed: Editor; frag: Y.XmlFragment } {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('body');
  if (text) ypPmToFrag(toDoc(text), frag);
  const section = ydoc.getMap<unknown>('section');
  section.set('id', sectionId);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = createChapterEditor({ element, fragment: frag, dir, lang: dir === 'rtl' ? 'ar' : 'en', label: 'Chapter', onRefuse: () => undefined });
  editors.push(ed);
  setActiveEditor(ed, 0, section);
  return { ed, frag };
}

/** Type `text` as the browser would: the view's handleTextInput props first, else the default insert. */
function type(ed: Editor, text: string): void {
  const v = ed.view;
  const { from, to } = v.state.selection;
  const deflt = () => v.state.tr.insertText(text, from, to);
  if (!v.someProp('handleTextInput', (f) => f(v, from, to, text, deflt))) v.dispatch(deflt());
}
const key = (ed: Editor, k: string) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: k })));
const caretAt = (ed: Editor, pos: number) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
const caretEnd = (ed: Editor) => caretAt(ed, TextSelection.atEnd(ed.state.doc).from);
const menu = () => document.querySelector<HTMLElement>('[data-aris="menu"]');
const ghost = () => document.querySelector<HTMLElement>('[data-aris="ghost"]');
const button = (root: Element | null, label: string) => {
  const b = [...(root?.querySelectorAll('button') ?? [])].find((x) => x.textContent === label);
  if (!b) throw new Error('no button ' + label);
  return b as HTMLButtonElement;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const fragText = (frag: Y.XmlFragment) => frag.toString();
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const posted = (path: string) => calls.filter((c) => c.path === path);
/** The direction an element takes from its nearest dir. */
const effectiveDir = (el: Element) => el.closest('[dir]')?.getAttribute('dir');

/** Both ways the plugins reach an editor: at creation (module first) and live, by registerPlugin (editor first). */
const UNDO_ORDERS = ['module loaded first', 'editor made first'] as const;
async function mountIn(order: (typeof UNDO_ORDERS)[number], text: string) {
  if (order === 'module loaded first') {
    await mountAris(null);
    return mount(text);
  }
  const m = mount(text);
  await mountAris(null);
  return m;
}

/** Summon on an empty line and choose "continue the story"; wait for the ghost. */
async function summonContinue(ed: Editor): Promise<void> {
  type(ed, '/');
  button(menu(), 'continue the story').click();
  await settle();
  await settle();
}

describe('aris summon', () => {
  it('while Aris is away (the desk toggle), / is just a character; back on, it summons again', async () => {
    const { ed } = mount('Once');
    await mountAris(null);
    caretEnd(ed);
    ed.commands.enter();
    // sent away: the live status says not opted in — the summon stays silent, the / lands as typed
    setArisStatus({ enabled: true, optedIn: false, known: true, voice: 'laconic', keys: [] });
    const before = editorText(ed).text;
    type(ed, '/');
    expect(menu()).toBeNull();
    expect(editorText(ed).text).toBe(before + '/');
    // summoned back: the same empty-line gesture opens the menu
    setArisStatus({ enabled: true, optedIn: true, known: true, voice: 'laconic', keys: [] });
    ed.commands.enter();
    type(ed, '/');
    expect(menu()).not.toBeNull();
  });

  it('typing / on an empty line summons the menu, and only then', async () => {
    // the editor exists BEFORE the module loads: it still gains the summon behaviour
    const { ed } = mount('Once');
    await mountAris(null);
    caretEnd(ed);
    type(ed, '/');
    expect(menu()).toBeNull();
    expect(editorText(ed).text).toBe('Once/');
    // a new empty line: the / is consumed and the menu opens
    ed.commands.enter();
    const before = editorText(ed).text;
    type(ed, '/');
    expect(menu()).not.toBeNull();
    expect(editorText(ed).text).toBe(before);
    for (const label of ['beat', 'continue the story', 'fill this gap', 'summarize section']) expect(button(menu(), label)).toBeTruthy();
    // Escape: the menu goes and the / stays as typed text
    expect(key(ed, 'Escape')).toBe(true);
    expect(menu()).toBeNull();
    expect(editorText(ed).text).toBe(before + '/');
    // a / typed right after text on the same line (mid-line) does not summon
    type(ed, '/');
    expect(menu()).toBeNull();
  });

  it('click-away dismisses the menu and keeps the / as text', async () => {
    await mountAris(null);
    const { ed } = mount('');
    type(ed, '/');
    expect(menu()).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu()).toBeNull();
    expect(editorText(ed).text).toBe('/');
  });

  it('a proposal renders as a ghost decoration, not document text', async () => {
    await mountAris(null);
    const { ed, frag } = mount('');
    const yBefore = fragText(frag);
    await summonContinue(ed);
    const g = ghost();
    expect(g).not.toBeNull();
    expect(g!.textContent).toContain('The rain came.');
    expect(editorText(ed).text).toBe('');
    expect(fragText(frag)).toBe(yBefore);
    expect([...g!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Insert', 'Edit first', 'Discard', 'retry']);
    const d = posted('/api/aris/draft');
    expect(d).toHaveLength(1);
    expect(d[0].body).toEqual({ manuscriptId: MS, sectionId: 'sec-1', action: 'continue', cursorOffset: 0, provider: 'anthropic', model: DEFAULT_MODELS.anthropic });
  });

  it('insert lands the text, records the facts, and clears the ghost', async () => {
    await mountAris(null);
    const { ed, frag } = mount('Once upon a time.');
    caretEnd(ed);
    ed.commands.enter();
    const text = 'नमस्ते — the rain came.';
    drafts.push({ status: 200, body: { proposal: { text, model: 'm', provider: 'anthropic', action: 'continue' }, token: 'tok-9' } });
    const before = editorText(ed).text;
    await summonContinue(ed);
    let changes = 0;
    ed.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) changes++;
    });
    button(ghost(), 'Insert').click();
    await settle();
    const after = editorText(ed).text;
    expect(after).toBe(before + text);
    expect(changes).toBe(1);
    expect(ghost()).toBeNull();
    expect(fragText(frag)).toContain('rain came.');
    const ins = posted('/api/aris/insert');
    expect(ins).toHaveLength(1);
    expect(ins[0].body).toEqual({ token: 'tok-9', bytesBefore: utf8(before), bytesAfter: utf8(after), writerEdited: false });
    expect(utf8(after) - utf8(before)).toBe(utf8(text));
    expect(insertFailure()).toBeNull();
  });

  it('edit-then-insert flags writerEdited', async () => {
    await mountAris(null);
    const { ed } = mount('');
    await summonContinue(ed);
    button(ghost(), 'Edit first').click();
    const area = ghost()!.querySelector('textarea');
    expect(area).not.toBeNull();
    expect(area!.value).toBe('The rain came.');
    area!.value = 'The rain came down.';
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe('The rain came down.');
    const ins = posted('/api/aris/insert');
    expect(ins).toHaveLength(1);
    expect(ins[0].body).toMatchObject({ token: 'tok-1', bytesBefore: 0, bytesAfter: utf8('The rain came down.'), writerEdited: true });
  });

  it('discard leaves text and audit untouched', async () => {
    await mountAris(null);
    const { ed, frag } = mount('');
    const yBefore = fragText(frag);
    await summonContinue(ed);
    button(ghost(), 'Discard').click();
    await settle();
    expect(ghost()).toBeNull();
    expect(editorText(ed).text).toBe('');
    expect(fragText(frag)).toBe(yBefore);
    // nothing reached the document's history either
    ed.commands.undo();
    expect(editorText(ed).text).toBe('');
    expect(fragText(frag)).toBe(yBefore);
    expect(posted('/api/aris/insert')).toHaveLength(0);
  });

  it.each(UNDO_ORDERS)('undo after a discard takes back only what the writer typed; the proposal never appears (%s)', async (order) => {
    const { ed, frag } = await mountIn(order, 'Once');
    const yBefore = fragText(frag);
    caretEnd(ed);
    type(ed, ' more');
    ed.commands.enter();
    const typed = editorText(ed).text;
    expect(typed).toBe('Once more\n');
    await summonContinue(ed);
    expect(ghost()).not.toBeNull();
    button(ghost(), 'Discard').click();
    await settle();
    expect(editorText(ed).text).toBe(typed);
    expect(ed.commands.undo()).toBe(true);
    expect(editorText(ed).text).toBe('Once');
    expect(fragText(frag)).toBe(yBefore);
    expect(fragText(frag)).not.toContain('rain');
    // and nothing further to undo brings the proposal in: redo gives back exactly the typed text
    expect(ed.commands.redo()).toBe(true);
    expect(editorText(ed).text).toBe(typed);
  });

  it.each(UNDO_ORDERS)('one undo after Insert removes exactly the inserted text (%s)', async (order) => {
    const { ed, frag } = await mountIn(order, 'Once upon a time.');
    caretEnd(ed);
    ed.commands.enter();
    const before = editorText(ed).text;
    const yBefore = fragText(frag);
    await summonContinue(ed);
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe(before + 'The rain came.');
    expect(ed.commands.undo()).toBe(true);
    expect(editorText(ed).text).toBe(before);
    expect(fragText(frag)).toBe(yBefore);
  });

  it('a remote change in another block carries the ghost along; one in its own block drops it', async () => {
    await mountAris(null);
    const { ed, frag } = mount('First.\n\nOnce');
    caretEnd(ed);
    ed.commands.enter();
    await summonContinue(ed);
    expect(ghost()).not.toBeNull();
    const textOf = (i: number) => (frag.get(i) as Y.XmlElement).get(0) as Y.XmlText;
    // another tab edits the first paragraph (a Yjs change with a foreign origin)
    frag.doc!.transact(() => textOf(0).insert(0, 'Very '), 'remote');
    expect(editorText(ed).text.startsWith('Very First.')).toBe(true);
    expect(ghost()).not.toBeNull();
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe('Very First.\n\nOnce\nThe rain came.');
    // a second proposal, and this time the remote edit lands in the ghost's own block: the block is replaced and the
    // ghost dropped (fail-safe: never re-placed at a guessed spot)
    ed.commands.enter();
    await summonContinue(ed);
    expect(ghost()).not.toBeNull();
    frag.doc!.transact(() => textOf(1).insert(0, 'So '), 'remote');
    expect(ghost()).toBeNull();
  });

  it('retry asks again with the same request and replaces the ghost', async () => {
    await mountAris(null);
    const { ed } = mount('');
    await summonContinue(ed);
    drafts.push({ status: 200, body: { proposal: { text: 'A second try.', model: 'm', provider: 'anthropic', action: 'continue' }, token: 'tok-2' } });
    button(ghost(), 'retry').click();
    await settle();
    await settle();
    expect(document.querySelectorAll('[data-aris="ghost"]')).toHaveLength(1);
    expect(ghost()!.textContent).toContain('A second try.');
    expect(ghost()!.textContent).not.toContain('The rain came.');
    const d = posted('/api/aris/draft');
    expect(d).toHaveLength(2);
    expect(d[1].body).toEqual(d[0].body);
    button(ghost(), 'Insert').click();
    await settle();
    expect(posted('/api/aris/insert')[0].body).toMatchObject({ token: 'tok-2', writerEdited: false });
  });

  it('a beat carries its instruction', async () => {
    await mountAris(null);
    const { ed } = mount('');
    type(ed, '/');
    const input = menu()!.querySelector('input')!;
    input.value = 'she finds the letter';
    button(menu(), 'beat').click();
    await settle();
    await settle();
    expect(posted('/api/aris/draft')[0].body).toMatchObject({ action: 'beat', instruction: 'she finds the letter' });
  });

  it("the server's error copy shows verbatim, inline", async () => {
    await mountAris(null);
    const { ed } = mount('');
    drafts.push({ status: 400, body: { error: 'no anthropic key on your /aris page' } });
    await summonContinue(ed);
    const g = ghost();
    expect(g).not.toBeNull();
    expect(g!.querySelector('[data-aris="notice"]')!.textContent).toBe('no anthropic key on your /aris page');
    expect(editorText(ed).text).toBe('');
  });

  it('insert record: 500 then 202 on the retry shows no notice', async () => {
    await mountAris(null);
    const { ed } = mount('');
    const replies = [{ status: 500, body: { error: 'x' } }, { status: 202, body: { recorded: true } }];
    const f = fakeFetch();
    setArisFetch(((p: string, i?: RequestInit) => (p === '/api/aris/insert' ? (calls.push({ path: p, body: null }), Promise.resolve(new Response(JSON.stringify(replies[0].body), { status: replies.shift()!.status }))) : f(p, i))) as unknown as typeof fetch);
    await summonContinue(ed);
    button(ghost(), 'Insert').click();
    await settle();
    await settle();
    expect(posted('/api/aris/insert')).toHaveLength(2);
    expect(insertFailure()).toBeNull();
    expect(ghost()).toBeNull();
  });

  it('insert record: 500 then 409 on the retry is success, no notice', async () => {
    await mountAris(null);
    const { ed } = mount('');
    const replies = [500, 409];
    const f = fakeFetch();
    setArisFetch(((p: string, i?: RequestInit) => (p === '/api/aris/insert' ? (calls.push({ path: p, body: null }), Promise.resolve(new Response('{"error":"dup"}', { status: replies.shift()! }))) : f(p, i))) as unknown as typeof fetch);
    await summonContinue(ed);
    button(ghost(), 'Insert').click();
    await settle();
    await settle();
    expect(posted('/api/aris/insert')).toHaveLength(2);
    expect(insertFailure()).toBeNull();
    expect(ghost()).toBeNull();
  });

  it('insert record: both attempts fail shows a dismissible notice', async () => {
    await mountAris(null);
    const { ed } = mount('');
    insertReply = { status: 500, body: { error: 'down' } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await summonContinue(ed);
    button(ghost(), 'Insert').click();
    await settle();
    await settle();
    expect(posted('/api/aris/insert')).toHaveLength(2);
    expect(editorText(ed).text).toBe('The rain came.');
    expect(ghost()!.querySelector('[data-aris="notice"]')!.textContent).toMatch(/did not reach Beuk/);
    button(ghost(), 'Discard').click();
    expect(ghost()).toBeNull();
    warn.mockRestore();
  });

  it('a failed insert record keeps the writer’s text and says so quietly', async () => {
    await mountAris(null);
    const { ed } = mount('');
    insertReply = { status: 500, body: { error: 'the record store is down' } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await summonContinue(ed);
    button(ghost(), 'Insert').click();
    await settle();
    await settle();
    expect(editorText(ed).text).toBe('The rain came.');
    expect(insertFailure()).toBe('the record store is down');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a proposal and its retry are for the summoning editor's own section, whichever editor is active", async () => {
    await mountAris(null);
    const a = mount('', 'ltr', 'sec-A');
    const b = mount('', 'ltr', 'sec-B'); // mounted last: B is the active editor now
    type(a.ed, '/');
    button(menu(), 'continue the story').click();
    await settle();
    await settle();
    setActiveEditor(b.ed, 1, null);
    drafts.push({ status: 200, body: { proposal: { text: 'Again.', model: 'm', provider: 'anthropic', action: 'continue' }, token: 'tok-r' } });
    button(ghost(), 'retry').click();
    await settle();
    await settle();
    const d = posted('/api/aris/draft');
    expect(d.map((c) => c.body!.sectionId)).toEqual(['sec-A', 'sec-A']);
    expect(d[1].body).toEqual(d[0].body);
  });

  it('the menu works from the keyboard: focus on open, arrows move, Enter runs, Escape dismisses back to the page', async () => {
    await mountAris(null);
    const { ed } = mount('');
    const press = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    type(ed, '/');
    expect(menu()!.getAttribute('role')).toBe('menu');
    expect(document.activeElement?.textContent).toBe('beat');
    press('ArrowDown');
    expect(document.activeElement?.tagName).toBe('INPUT');
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('continue the story');
    press('ArrowUp');
    press('ArrowUp');
    press('ArrowUp'); // wraps from the first item to the last
    expect(document.activeElement?.textContent).toBe('summarize section');
    press('Escape');
    expect(menu()).toBeNull();
    expect(editorText(ed).text).toBe('/');
    expect(document.activeElement).toBe(ed.view.dom);
    // again, and Enter runs the focused item
    ed.commands.undo();
    caretAt(ed, 1);
    expect(editorText(ed).text).toBe('');
    type(ed, '/');
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    await settle();
    await settle();
    expect(menu()).toBeNull();
    expect(posted('/api/aris/draft')[0].body).toMatchObject({ action: 'continue' });
    expect(ghost()).not.toBeNull();
  });

  it('carriage returns never count as a writer edit', async () => {
    await mountAris(null);
    const { ed } = mount('');
    drafts.push({ status: 200, body: { proposal: { text: 'One.\r\nTwo.', model: 'm', provider: 'anthropic', action: 'continue' }, token: 'tok-cr' } });
    await summonContinue(ed);
    expect(ghost()!.textContent).not.toContain('\r');
    button(ghost(), 'Edit first').click();
    expect(ghost()!.querySelector('textarea')!.value).toBe('One.\nTwo.');
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe('One.\nTwo.');
    expect(posted('/api/aris/insert')[0].body).toMatchObject({ token: 'tok-cr', writerEdited: false });
  });

  it('the draft is asked for the summon spot, wherever the caret has gone', async () => {
    await mountAris(null);
    const { ed } = mount('Once');
    caretEnd(ed);
    ed.commands.enter();
    const spot = editorText(ed).start;
    expect(spot).toBe(5);
    type(ed, '/');
    caretAt(ed, 1);
    button(menu(), 'continue the story').click();
    await settle();
    await settle();
    expect(posted('/api/aris/draft')[0].body).toMatchObject({ cursorOffset: spot });
  });

  it('the ghost inherits rtl direction', async () => {
    await mountAris(null);
    const { ed } = mount('', 'rtl');
    type(ed, '/');
    expect(effectiveDir(menu()!)).toBe('rtl');
    expect(menu()!.hasAttribute('dir')).toBe(false);
    button(menu(), 'continue the story').click();
    await settle();
    await settle();
    expect(effectiveDir(ghost()!)).toBe('rtl');
    expect(ghost()!.hasAttribute('dir')).toBe(false);
    expect(ghost()!.closest('.ms-editor')).toBe(ed.view.dom);
  });
});
