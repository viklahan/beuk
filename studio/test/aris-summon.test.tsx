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
import { insertFailure, resetArisState } from '../src/aris/state';
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
function mount(text: string, dir: 'ltr' | 'rtl' = 'ltr'): { ed: Editor; frag: Y.XmlFragment } {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('body');
  if (text) ypPmToFrag(toDoc(text), frag);
  const section = ydoc.getMap<unknown>('section');
  section.set('id', 'sec-1');
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

/** Summon on an empty line and choose "continue the story"; wait for the ghost. */
async function summonContinue(ed: Editor): Promise<void> {
  type(ed, '/');
  button(menu(), 'continue the story').click();
  await settle();
  await settle();
}

describe('aris summon', () => {
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

  it('a failed insert record keeps the writer’s text and says so quietly', async () => {
    await mountAris(null);
    const { ed } = mount('');
    insertReply = { status: 409, body: { error: 'this proposal is already recorded' } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await summonContinue(ed);
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe('The rain came.');
    expect(insertFailure()).toBe('this proposal is already recorded');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
