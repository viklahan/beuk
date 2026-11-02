import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { textOffsetToPos } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { toBook } from '../src/editor/bridge';
import { AUTO_FORMAT_CLEAN, AUTO_FORMAT_DONE } from '../src/editor/EditorToolbar';
import { editorText } from '../src/editor/insert';
import { LocaleProvider } from '../src/i18n/LocaleProvider';

/* Wave 2a in the studio: the insert toolbar (1.0's #insertToolbar: groups,
   data-insert kinds, keys) and its three dialogs (1.0's ids, keys, Enter /
   Ctrl+Enter / Escape), through the whole app: the text lands in the book,
   one Undo gives the export back exactly, a generated section refuses the
   dialogs, and Auto-Format shows 1.0's toasts. 1.0's self-checks
   editor.no-instruction-paragraph (toolbar half) and
   editor.toolbar.footnote-dialog-pair, through the dialog. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const BOOK = (first: Rec = {}): Rec => ({
  meta: { title: 'Toolbar Book', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 's1', kind: 'body', type: 'chapter', title: 'One', content: 'The chart was old.\n\nA second paragraph stands here.', ...first },
    { id: 's2', kind: 'body', type: 'chapter', title: 'Two', content: 'Intro.\n\n::: margin Ada\nfirst\n:::' },
  ],
});
const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-10-31T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
async function openStudio(book: Rec) {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
  // the editor's DOM lands inside ChapterEditor's effect; the toolbar gets the editor on the render its setEditor
  // schedules. A click before that render finds no editor and does nothing (seen in the container once 4b's preview
  // mounted beside it): let React commit first.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
const editor = () => (document.getElementById('manuscript') as HTMLElement & { beukEditor?: Editor }).beukEditor!;
const text = () => editorText(editor()).text;
function select(s: number, e = s) {
  const ed = editor();
  const d = toBook(ed.state.doc);
  act(() => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textOffsetToPos(d, s), textOffsetToPos(d, e))));
  });
}
const tool = (kind: string) => document.querySelector<HTMLButtonElement>(`#insertToolbar [data-insert="${kind}"]`)!;
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

describe("1.0's insert toolbar in the studio (A1–A4, A13)", () => {
  it('the groups, kinds, keys and fold levels of 1.0 (editor.no-instruction-paragraph: the toolbar half)', async () => {
    await openStudio(BOOK());
    const groups = [...document.querySelectorAll('#insertToolbar > .tool-group')].map((g) => g.getAttribute('data-tg'));
    expect(groups).toEqual(['format', 'structure', 'blocks', 'assist', 'focus']); // wave 3a: 1.0's Focus cluster (Read Aloud, Zen) is ported
    const kinds = [...document.querySelectorAll('#insertToolbar [data-insert]')].map((b) => b.getAttribute('data-insert'));
    expect(kinds).toEqual(['bold', 'italic', 'link', 'redact', 'blockquote', 'attribution', 'ul', 'ol', 'scenebreak', 'emdash', 'endnote',
      'columns', 'hanging', 'verse', 'center', 'right', 'texts', 'letter', 'transcript', 'log', 'insert', 'margin', 'sideways', 'upsidedown']);
    expect(tool('endnote').textContent).toBe(E['tool.footnote']);
    expect(tool('upsidedown').textContent).toBe(E['tool.upsideDown']);
    expect([...document.querySelectorAll('#insertToolbar [data-tg="format"] [data-insert]')].every((b) => b.getAttribute('data-collapse') === '1')).toBe(true);
    expect([...document.querySelectorAll('#insertToolbar [data-tg="blocks"] [data-insert]')].every((b) => b.getAttribute('data-collapse') === '2')).toBe(true);
    expect(document.getElementById('btnBeautify')!.textContent).toBe(E['tool.autoFormat']);
    // no syntax lecture on the writing surface
    expect(document.getElementById('editorHint')).toBeNull();
    expect(document.body.textContent).not.toContain('Write in plain paragraphs');
  });

  it("the footnote dialog places the pair; a second numbers itself 2 (editor.toolbar.footnote-dialog-pair); one Undo each", async () => {
    await openStudio(BOOK());
    const original = text();
    select('The chart was old.'.length);
    await click(tool('endnote'));
    expect(document.getElementById('fnTitle')!.textContent).toBe(E['fn.titleN']!.replace('{n}', '1'));
    expect(document.activeElement?.id).toBe('fnText');
    fireEvent.change(document.getElementById('fnText')!, { target: { value: 'Drawn in ink that never dried.' } });
    (document.getElementById('fnText') as HTMLTextAreaElement).value = 'Drawn in ink that never dried.';
    await click(document.getElementById('btnDoFootnote')!);
    expect(document.getElementById('modalFootnote')).toBeNull();
    expect(text()).toBe('The chart was old.[^1]\n\nA second paragraph stands here.\n\n[^1]: Drawn in ink that never dried.');
    select(5);
    await click(tool('endnote'));
    expect(document.getElementById('fnTitle')!.textContent).toBe(E['fn.titleN']!.replace('{n}', '2'));
    (document.getElementById('fnText') as HTMLTextAreaElement).value = 'A second note.';
    // Ctrl+Enter confirms, as in 1.0
    await act(async () => {
      fireEvent.keyDown(document.getElementById('fnText')!, { key: 'Enter', ctrlKey: true });
    });
    expect(text().indexOf('[^2]')).toBe(5);
    expect(text().endsWith('[^2]: A second note.')).toBe(true);
    act(() => {
      editor().commands.undo();
    });
    act(() => {
      editor().commands.undo();
    });
    expect(text()).toBe(original);
  });

  it("1.0's self-check editor.toolbar.bold-italic-wrap, the selection halves (the bare-caret half: Ruling 1)", async () => {
    await openStudio(BOOK({ content: 'The harbour was calm.' }));
    select(4, 11);
    await click(tool('bold'));
    expect(text()).toBe('The **harbour** was calm.');
    select(20, 24);
    await click(tool('italic'));
    expect(text()).toBe('The **harbour** was *calm*.');
    select(16, 19);
    act(() => {
      editor().commands.keyboardShortcut('Mod-b');
    });
    expect(text()).toBe('The **harbour** **was** *calm*.');
  });

  it('Escape and Cancel close a dialog and change nothing', async () => {
    await openStudio(BOOK());
    const original = text();
    select(3);
    await click(tool('endnote'));
    (document.getElementById('fnText') as HTMLTextAreaElement).value = 'never placed';
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(document.getElementById('modalFootnote')).toBeNull();
    await click(tool('link'));
    await click(document.getElementById('btnCancelLink')!);
    expect(document.getElementById('modalLink')).toBeNull();
    expect(text()).toBe(original);
  });

  it("the link dialog: the selection's words, 1.0's refusal of an address that can't be a link, then [words](address)", async () => {
    await openStudio(BOOK());
    select(4, 9); // "chart"
    await click(tool('link'));
    expect((document.getElementById('lnkText') as HTMLInputElement).value).toBe('chart');
    expect(document.activeElement?.id).toBe('lnkUrl');
    (document.getElementById('lnkUrl') as HTMLInputElement).value = 'javascript:alert(1)';
    await click(document.getElementById('btnDoLink')!);
    expect(document.getElementById('lnkHint')!.classList.contains('is-bad')).toBe(true);
    expect(document.getElementById('lnkHint')!.textContent).toBe(E['lnk.bad']);
    expect(text()).toBe('The chart was old.\n\nA second paragraph stands here.');
    (document.getElementById('lnkUrl') as HTMLInputElement).value = 'www.example.org';
    await act(async () => {
      fireEvent.keyDown(document.getElementById('lnkUrl')!, { key: 'Enter' });
    });
    expect(document.getElementById('modalLink')).toBeNull();
    expect(text()).toBe('The [chart](https://www.example.org) was old.\n\nA second paragraph stands here.');
    // the editor shows it as a link, its href through safeHref
    expect(document.querySelector('#manuscript a')!.getAttribute('href')).toBe('https://www.example.org');
  });

  it("the margin dialog offers the book's last margin name and places the note after the paragraph; no name is refused", async () => {
    await openStudio(BOOK());
    select(2);
    await click(tool('margin'));
    expect((document.getElementById('mnName') as HTMLInputElement).value).toBe('Ada');
    (document.getElementById('mnName') as HTMLInputElement).value = '  ';
    await click(document.getElementById('btnDoMargin')!);
    expect(document.getElementById('mnHint')!.textContent).toBe(E['mn.bad']);
    (document.getElementById('mnName') as HTMLInputElement).value = 'Bo';
    (document.getElementById('mnText') as HTMLTextAreaElement).value = 'A thought.';
    await click(document.getElementById('btnDoMargin')!);
    expect(text()).toBe('The chart was old.\n\n::: margin Bo\nA thought.\n:::\n\nA second paragraph stands here.');
  });

  it('a generated section (1.0 AUTO_TYPES) refuses the dialogs and Auto-Format, silently', async () => {
    // (the desk opens the first body section: a body section typed as 1.0's generated "toc" stands in for one)
    await openStudio(BOOK({ type: 'toc', title: 'Contents' }));
    const original = text();
    for (const k of ['endnote', 'link', 'margin']) {
      await click(tool(k));
      expect(document.querySelector('.modal-back.open')).toBeNull();
    }
    await click(document.getElementById('btnBeautify')!);
    expect(document.querySelector('#toasts')?.textContent ?? '').not.toContain(AUTO_FORMAT_DONE);
    expect(text()).toBe(original);
  });

  it("Auto-Format: 1.0's text and toasts; one Undo", async () => {
    await openStudio(BOOK({ content: 'He said "hi" -- then...' }));
    await click(document.getElementById('btnBeautify')!);
    // (the toolbar runs on the closure, loaded on first use: under load it lands after the click's act)
    await waitFor(() => expect(text()).toBe('He said “hi” — then…'), { timeout: 10_000 });
    await waitFor(() => expect(document.body.textContent).toContain(AUTO_FORMAT_DONE), { timeout: 10_000 });
    await click(document.getElementById('btnBeautify')!);
    await waitFor(() => expect(document.body.textContent).toContain(AUTO_FORMAT_CLEAN), { timeout: 10_000 });
    act(() => {
      editor().commands.undo();
    });
    expect(text()).toBe('He said "hi" -- then...');
  });

  it('a plain action (blockquote, a list, a container, a scene break) writes 1.0\'s text and the export carries it', async () => {
    await openStudio(BOOK());
    select(30);
    await click(tool('blockquote'));
    expect(text()).toBe('The chart was old.\n\n> A second paragraph stands here.');
    act(() => {
      editor().commands.undo();
    });
    select(2);
    await click(tool('ol'));
    expect(text()).toBe('1. The chart was old.\n\nA second paragraph stands here.');
    act(() => {
      editor().commands.undo();
    });
    select(2);
    await click(tool('verse'));
    expect(text()).toBe('::: verse\nThe chart was old.\n:::\n\nA second paragraph stands here.');
  });
});
