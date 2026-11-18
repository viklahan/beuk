import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { resetArisState } from '../src/aris/state';
import { DEFAULT_MODELS } from '../src/aris/propose';

/* Task 11: the selection toolbar (rewrite, expand, condense) on a real chapter editor in jsdom, the server answered
   by an injected fetch (the shape of aris-summon.test.tsx). */

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

function fakeFetch(): typeof fetch {
  return (async (path: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (path === '/api/aris/status') return json(200, { enabled: true, optedIn: true, voice: 'laconic', keys: [{ provider: 'anthropic', last4: 'abcd' }] });
    if (path === '/api/aris/draft') {
      const d = drafts.shift() ?? { status: 200, body: { proposal: { text: 'Short.', model: 'm', provider: 'anthropic', action: 'condense' }, token: 'tok-1' } };
      return json(d.status, d.body);
    }
    if (path === '/api/aris/insert') return json(202, { recorded: true });
    return json(404, { error: 'nope' });
  }) as unknown as typeof fetch;
}

const editors: Editor[] = [];
beforeEach(() => {
  calls = [];
  drafts = [];
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

const toolbar = () => document.querySelector<HTMLElement>('[data-aris="toolbar"]');
const ghost = () => document.querySelector<HTMLElement>('[data-aris="ghost"]');
const button = (root: Element | null, label: string) => {
  const b = [...(root?.querySelectorAll('button') ?? [])].find((x) => x.textContent === label);
  if (!b) throw new Error('no button ' + label);
  return b as HTMLButtonElement;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const posted = (path: string) => calls.filter((c) => c.path === path);
/** Select the first occurrence of `phrase` inside one text node. */
function select(ed: Editor, phrase: string): { from: number; to: number } {
  let from = -1;
  ed.state.doc.descendants((n, pos) => {
    if (from < 0 && n.isText) {
      const i = n.text!.indexOf(phrase);
      if (i >= 0) from = pos + i;
    }
  });
  if (from < 0) throw new Error('no phrase ' + phrase);
  const to = from + phrase.length;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
  return { from, to };
}
const collapse = (ed: Editor) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2)));
const keydown = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

const DOC = 'Before it all. The old house stood on the hill. After it all.';
const PHRASE = 'The old house stood on the hill.';

describe('aris selection toolbar', () => {
  it('three selected words raise no toolbar, four do', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, 'The old house');
    expect(toolbar()).toBeNull();
    select(ed, 'The old house stood');
    const t = toolbar();
    expect(t).not.toBeNull();
    expect([...t!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['rewrite', 'expand', 'condense']);
    expect(t!.getAttribute('role')).toBe('toolbar');
    // spaces around words do not count as words
    select(ed, ' old house stood ');
    expect(toolbar()).toBeNull();
  });

  it('deselect dismisses the toolbar', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, PHRASE);
    expect(toolbar()).not.toBeNull();
    collapse(ed);
    expect(toolbar()).toBeNull();
  });

  it('condense proposes against the selection and insert replaces exactly the selected range', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, PHRASE);
    button(toolbar(), 'condense').click();
    await settle();
    await settle();
    const d = posted('/api/aris/draft');
    expect(d).toHaveLength(1);
    expect(d[0].body).toEqual({ manuscriptId: MS, sectionId: 'sec-1', action: 'condense', selection: { text: PHRASE }, provider: 'anthropic', model: DEFAULT_MODELS.anthropic });
    expect(ghost()!.textContent).toContain('Short.');
    expect(toolbar()).toBeNull(); // the ghost has the spot now
    expect([...ghost()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Insert', 'Edit first', 'Discard', 'retry']);
    expect(editorText(ed).text).toBe(DOC);
    const before = editorText(ed).text;
    button(ghost(), 'Insert').click();
    await settle();
    const after = editorText(ed).text;
    expect(after).toBe('Before it all. Short. After it all.');
    expect(ghost()).toBeNull();
    expect(posted('/api/aris/insert')[0].body).toEqual({ token: 'tok-1', bytesBefore: utf8(before), bytesAfter: utf8(after), writerEdited: false });
  });

  it('a change elsewhere while the ghost shows moves the replace range with it', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, PHRASE);
    button(toolbar(), 'rewrite').click();
    await settle();
    await settle();
    expect(ghost()).not.toBeNull();
    ed.view.dispatch(ed.state.tr.insertText('Well. ', 1)); // typed before the selection
    expect(ghost()).not.toBeNull();
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe('Well. Before it all. Short. After it all.');
  });

  it('an edit inside the selected range while the ghost shows drops the ghost, and nothing replaces moved text', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    const { from } = select(ed, PHRASE);
    button(toolbar(), 'expand').click();
    await settle();
    await settle();
    expect(ghost()).not.toBeNull();
    ed.view.dispatch(ed.state.tr.insertText('very ', from + 4));
    expect(ghost()).toBeNull();
    expect(editorText(ed).text).toBe('Before it all. The very old house stood on the hill. After it all.');
    expect(posted('/api/aris/insert')).toHaveLength(0);
  });

  it('a pending request whose range was edited drops its answer instead of showing it', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    const { from } = select(ed, PHRASE);
    button(toolbar(), 'expand').click();
    ed.view.dispatch(ed.state.tr.insertText('very ', from + 4)); // while the request is out
    await settle();
    await settle();
    expect(ghost()).toBeNull();
    expect(editorText(ed).text).toBe('Before it all. The very old house stood on the hill. After it all.');
  });

  it('retry reuses the captured request; Edit first flags writerEdited', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, PHRASE);
    button(toolbar(), 'rewrite').click();
    await settle();
    await settle();
    drafts.push({ status: 200, body: { proposal: { text: 'Second.', model: 'm', provider: 'anthropic', action: 'rewrite' }, token: 'tok-2' } });
    button(ghost(), 'retry').click();
    await settle();
    await settle();
    expect(ghost()!.textContent).toContain('Second.');
    const d = posted('/api/aris/draft');
    expect(d).toHaveLength(2);
    expect(d[1].body).toEqual(d[0].body);
    button(ghost(), 'Edit first').click();
    ghost()!.querySelector('textarea')!.value = 'Second, edited.';
    button(ghost(), 'Insert').click();
    await settle();
    expect(editorText(ed).text).toBe('Before it all. Second, edited. After it all.');
    expect(posted('/api/aris/insert')[0].body).toMatchObject({ token: 'tok-2', writerEdited: true });
  });

  it('Discard leaves the text and the audit untouched', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, PHRASE);
    button(toolbar(), 'condense').click();
    await settle();
    await settle();
    button(ghost(), 'Discard').click();
    await settle();
    expect(ghost()).toBeNull();
    expect(editorText(ed).text).toBe(DOC);
    expect(posted('/api/aris/insert')).toHaveLength(0);
  });

  it('Escape dismisses the toolbar and keeps the selection; a new selection raises it again', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    const { from, to } = select(ed, PHRASE);
    // from the page
    expect(ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Escape' })))).toBe(true);
    expect(toolbar()).toBeNull();
    expect([ed.state.selection.from, ed.state.selection.to]).toEqual([from, to]);
    select(ed, 'The old house stood');
    expect(toolbar()).not.toBeNull();
    // from the toolbar itself
    button(toolbar(), 'rewrite').focus();
    keydown(button(toolbar(), 'rewrite'), 'Escape');
    expect(toolbar()).toBeNull();
    expect(ed.state.selection.to - ed.state.selection.from).toBe('The old house stood'.length);
    expect(document.activeElement).toBe(ed.view.dom);
  });

  it('the toolbar works from the keyboard: items are focusable, arrows move, Enter runs', async () => {
    await mountAris(null);
    const { ed } = mount(DOC);
    select(ed, PHRASE);
    const items = [...toolbar()!.querySelectorAll('button')];
    items[0].focus();
    expect(document.activeElement).toBe(items[0]);
    keydown(document.activeElement!, 'ArrowRight');
    expect(document.activeElement?.textContent).toBe('expand');
    keydown(document.activeElement!, 'ArrowLeft');
    keydown(document.activeElement!, 'ArrowLeft'); // wraps
    expect(document.activeElement?.textContent).toBe('condense');
    keydown(document.activeElement!, 'Enter');
    await settle();
    await settle();
    expect(posted('/api/aris/draft')[0].body).toMatchObject({ action: 'condense' });
  });

  it("a toolbar action is for the owning editor's section, whichever editor is active", async () => {
    await mountAris(null);
    const a = mount(DOC, 'ltr', 'sec-A');
    const b = mount('Other text.', 'ltr', 'sec-B'); // mounted last: B is active
    select(a.ed, PHRASE);
    setActiveEditor(b.ed, 1, null);
    button(toolbar(), 'rewrite').click();
    await settle();
    await settle();
    expect(posted('/api/aris/draft')[0].body).toMatchObject({ sectionId: 'sec-A', selection: { text: PHRASE } });
  });

  it('the toolbar sits inside the editor surface, so it takes its direction', async () => {
    await mountAris(null);
    const { ed } = mount('أحد عشر كوكبا في سماء الليل', 'rtl');
    select(ed, 'أحد عشر كوكبا في');
    const t = toolbar();
    expect(t).not.toBeNull();
    expect(t!.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
  });
});
