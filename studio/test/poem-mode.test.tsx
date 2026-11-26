import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';
import { exportBook, fragmentText, toDoc } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { createChapterEditor } from '../src/editor/createEditor';
import { flushNormalize } from '../src/editor/behaviour';
import { ghostShown, poemState, setEditorPoem } from '../src/editor/poem';
import { LocaleProvider } from '../src/i18n/LocaleProvider';

/* BEUK:poemmode — Poem Mode on the writer's desk (src/editor/poem.ts,
   PoemMode.tsx, styles/poem.css), in jsdom.

   What is held here:
   - the P button and the Centred / Left choice write the section's two
     fields (mode, verseAlign) and NOTHING else: after on, off and on again
     the stored text is the same string, and after on and off the whole
     stored book is the same JSON it was (a hard text is used: a marked line
     break, indents, list-like, quote-like and heading-like lines, a verse
     fence, "--" and "...");
   - a new poem is centred; Left is stored and remembered through off / on;
   - aria-pressed says what is stored, on the P button and on both choices;
   - the starter lines of an empty poem are a decoration: they are not in
     the stored content, and one character typed removes them;
   - Shift-Enter writes the plain new line in a poem (the mark in prose);
   - the drop cap and small-caps switches are not shown for a poem and what
     they store is untouched; the Verse tool is off there;
   - the P button is offered on a body chapter only;
   - the words, in all 13 interface languages.

   Layout (the measure, the type size, the rule, the centring) needs a real
   browser: the acceptance walk measures it in Chromium, not this file. */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const BS = String.fromCharCode(92);

/* lines made up for this test */
const POEM = 'The tide comes in on quiet feet.\nIt counts the stones along the street.\n\nThe gulls wake up and start to call.\nThe morning light is on the wall.';
/* a text every tidier would love to touch */
const HARD = [
  'One line' + BS + '\nmarked while it was prose\n  an indented line\nand a line with two  spaces',
  '- a hyphen line\n- another',
  '> a quoted line',
  '# a hash line',
  '::: verse\n   kept\nlines\n:::',
  'A last line -- with "straight" marks...',
].join('\n\n');

const BOOK = (): Rec => ({
  meta: { title: 'Poem Book', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 's1', kind: 'body', type: 'chapter', number: '1', title: 'The Stone', content: POEM, dropCap: true, smallCaps: false },
    { id: 's2', kind: 'body', type: 'chapter', number: '2', title: 'Hard', content: HARD },
    { id: 's3', kind: 'body', type: 'chapter', number: '3', title: '', content: '' },
    { id: 's4', kind: 'body', type: 'part', number: 'One', title: 'A Part', content: '' },
    { id: 's5', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the keepers.' },
  ],
});

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

const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-11-24T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
async function openStudio(book: Rec, lang = 'en') {
  render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
  await settle();
}
async function openSection(i: number) {
  await act(async () => {
    fireEvent.click(document.querySelector(`#structureList .sec-item[data-index="${i}"]`)!);
  });
  await waitFor(() => expect(document.querySelector(`#manuscript[data-section="${i}"]`)).not.toBeNull());
  await settle();
}
const page = () => document.getElementById('manuscript') as HTMLElement & { beukEditor?: Editor };
const editor = () => page().beukEditor!;
/** The open book's own Y.Doc (the editor is bound to one of its fragments). */
function ydoc(): Y.Doc {
  const collab = editor().extensionManager.extensions.find((x) => x.name === 'collaboration')!;
  return (collab.options as { fragment: Y.XmlFragment }).fragment.doc!;
}
const stored = (): Rec => exportBook(ydoc());
const section = (id: string): Rec => (stored().sections as Rec[]).find((s) => s.id === id)!;
const P = () => document.getElementById('btnPoemMode') as HTMLButtonElement | null;
const choice = (a: 'center' | 'left') => document.querySelector<HTMLButtonElement>(`#segPoemAlign [data-poem-align="${a}"]`);
const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
  await settle();
};

describe('the P button flips a chapter between prose and a poem, and the text is not touched', () => {
  it('on, off, on again: the stored text is the same string each time; after on and off the stored book is the same JSON', async () => {
    await openStudio(BOOK());
    await openSection(1); // the hard text
    const before = JSON.stringify(stored());
    const text0 = section('s2').content;
    expect(text0).toBe(HARD);
    expect(P()!.getAttribute('aria-pressed')).toBe('false');
    expect(page().classList.contains('ms-poem')).toBe(false);
    expect(document.getElementById('poemStrip')).toBeNull();

    await click(P()!);
    expect(P()!.getAttribute('aria-pressed')).toBe('true');
    expect(section('s2').mode).toBe('verse');
    expect('verseAlign' in section('s2')).toBe(false); // a new poem is centred: nothing stored
    expect(section('s2').content).toBe(HARD);
    expect(page().className).toBe('ms-page ms-editing ms-poem ms-poem-center');
    const on = JSON.stringify(stored());
    // only the one key was added, to the one section
    const expectOn = JSON.parse(before) as { sections: Rec[] };
    expectOn.sections[1]!.mode = 'verse';
    expect(JSON.parse(on)).toEqual(expectOn);

    await click(P()!);
    expect(P()!.getAttribute('aria-pressed')).toBe('false');
    expect(section('s2').content).toBe(HARD);
    expect(JSON.stringify(stored())).toBe(before);
    expect(page().className).toBe('ms-page ms-editing');

    await click(P()!);
    expect(P()!.getAttribute('aria-pressed')).toBe('true');
    expect(section('s2').content).toBe(HARD);
    expect(JSON.stringify(stored())).toBe(on);
  });

  it('leaving the poem for another chapter and coming back (the editor closes and opens) leaves the stored book as it was', async () => {
    await openStudio(BOOK());
    await openSection(1);
    await click(P()!);
    await click(choice('left')!);
    const on = JSON.stringify(stored());
    await openSection(0);
    expect(P()!.getAttribute('aria-pressed')).toBe('false'); // the other chapter is prose: the mode is the chapter's
    await openSection(1);
    expect(P()!.getAttribute('aria-pressed')).toBe('true');
    expect(choice('left')!.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.stringify(stored())).toBe(on);
    expect(section('s2').content).toBe(HARD);
  });
});

describe('the strip: the label and Centred / Left', () => {
  it('shows only for a poem; a new poem is centred; Left is stored, and remembered while Poem Mode is off', async () => {
    await openStudio(BOOK());
    await openSection(0);
    expect(document.getElementById('poemStrip')).toBeNull();
    await click(P()!);
    const strip = document.getElementById('poemStrip')!;
    expect(strip).not.toBeNull();
    expect(document.getElementById('poemStripLab')!.textContent).toBe(E['poem.mode']);
    const seg = document.getElementById('segPoemAlign')!;
    expect(seg.getAttribute('role')).toBe('group');
    expect(seg.getAttribute('aria-label')).toBe(E['poem.alignAria']);
    expect([...seg.querySelectorAll('button')].map((b) => b.textContent)).toEqual([E['creator.alignCenter'], E['creator.alignLeft']]);
    expect(choice('center')!.getAttribute('aria-pressed')).toBe('true');
    expect(choice('left')!.getAttribute('aria-pressed')).toBe('false');
    // the strip comes after the toolbar and before the page: the next stops after the toolbar's own
    const order = [...document.querySelectorAll('#insertToolbar, #poemStrip, #manuscript')].map((x) => x.id);
    expect(order).toEqual(['insertToolbar', 'poemStrip', 'manuscript']);

    await click(choice('left')!);
    expect(section('s1').verseAlign).toBe('left');
    expect(choice('left')!.getAttribute('aria-pressed')).toBe('true');
    expect(choice('center')!.getAttribute('aria-pressed')).toBe('false');
    expect(choice('left')!.classList.contains('active')).toBe(true);
    expect(page().className).toBe('ms-page ms-editing ms-poem ms-poem-left');
    expect(section('s1').content).toBe(POEM);

    await click(choice('center')!);
    expect('verseAlign' in section('s1')).toBe(false);
    expect(page().className).toBe('ms-page ms-editing ms-poem ms-poem-center');

    await click(choice('left')!);
    await click(P()!); // off: the mode goes, the choice stays
    expect('mode' in section('s1')).toBe(false);
    expect(section('s1').verseAlign).toBe('left');
    expect(document.getElementById('poemStrip')).toBeNull();
    await click(P()!); // on again: left, as chosen
    expect(choice('left')!.getAttribute('aria-pressed')).toBe('true');
    expect(page().className).toBe('ms-page ms-editing ms-poem ms-poem-left');
    expect(section('s1').content).toBe(POEM);
  });

  it('in a right-to-left book the second choice is named Right (its lines range where they begin); what is stored is the same', async () => {
    const book = BOOK();
    (book.meta as Rec).language = 'ar';
    await openStudio(book);
    await openSection(0);
    await click(P()!);
    expect(page().getAttribute('dir')).toBe('rtl');
    expect(choice('left')!.textContent).toBe(E['creator.alignRight']);
    await click(choice('left')!);
    expect(section('s1').verseAlign).toBe('left');
  });
});

describe('the button names itself and is offered only where a poem can be', () => {
  it('a toggle button named "Poem Mode", first in the toolbar, with an italic P that is not its name', async () => {
    await openStudio(BOOK());
    await openSection(0);
    const b = P()!;
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('Poem Mode');
    expect(b.getAttribute('title')).toBe('Poem Mode');
    expect(b.querySelector('.poem-p')!.textContent).toBe('P');
    expect(b.querySelector('.poem-p')!.getAttribute('aria-hidden')).toBe('true');
    expect(b.tabIndex).toBe(0);
    expect(document.querySelector('#insertToolbar button')).toBe(b);
    expect(document.querySelector('#insertToolbar > .tool-group')!.getAttribute('data-tg')).toBe('mode');
  });

  it('a Part and front matter have no P button, and a stored mode on them is not read as a poem', async () => {
    const book = BOOK();
    (book.sections as Rec[])[3]!.mode = 'verse';
    (book.sections as Rec[])[4]!.mode = 'verse';
    await openStudio(book);
    for (const i of [3, 4]) {
      await openSection(i);
      expect(P()).toBeNull();
      expect(document.getElementById('poemStrip')).toBeNull();
      expect(page().classList.contains('ms-poem')).toBe(false);
      expect(document.querySelector('#insertToolbar > .tool-group')!.getAttribute('data-tg')).toBe('format');
    }
    await openSection(0);
    expect(P()).not.toBeNull();
  });
});

describe('what a poem does not take', () => {
  it('the drop cap and small-caps switches are not shown for a poem; what they store is untouched, and they are back when it is prose again', async () => {
    await openStudio(BOOK());
    await openSection(0);
    expect(document.getElementById('tglDropCap')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('tglSmallCaps')!.getAttribute('aria-pressed')).toBe('false');
    await click(P()!);
    expect(document.getElementById('tglDropCap')).toBeNull();
    expect(document.getElementById('tglSmallCaps')).toBeNull();
    expect(document.getElementById('bodyArtRows')).not.toBeNull(); // the chapter's pictures stay
    expect(section('s1').dropCap).toBe(true);
    expect(section('s1').smallCaps).toBe(false);
    await click(P()!);
    expect(document.getElementById('tglDropCap')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('tglSmallCaps')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the Verse tool is off in a poem (it says why) and does nothing there; it works again in prose', async () => {
    await openStudio(BOOK());
    await openSection(0);
    const verse = () => document.querySelector<HTMLButtonElement>('#insertToolbar [data-insert="verse"]')!;
    expect(verse().getAttribute('aria-disabled')).toBeNull();
    await click(P()!);
    expect(verse().getAttribute('aria-disabled')).toBe('true');
    expect(verse().getAttribute('title')).toBe(E['tool.verseInPoem']);
    await click(verse());
    expect(section('s1').content).toBe(POEM);
    await click(P()!);
    expect(verse().getAttribute('aria-disabled')).toBeNull();
    expect(verse().getAttribute('title')).toBe(E['tool.verseTitle']);
  });
});

describe('the starter lines of an empty poem', () => {
  const GHOST = [E['poem.ghost1'], E['poem.ghost2'], E['poem.ghost3']].join('\n');

  it('show only while a poem has no text; they are not in the stored content; one character typed and they are gone', async () => {
    await openStudio(BOOK());
    await openSection(2); // the empty chapter
    const title = () => document.getElementById('chTitle') as HTMLInputElement;
    const ghostEl = () => document.querySelector('#manuscript .ms-poem-ghost');
    expect(ghostEl()).toBeNull();
    expect(title().placeholder).toBe(E['editor.chTitlePh']);

    await click(P()!);
    expect(ghostShown(editor().state)).toBe(true);
    const g = ghostEl()!;
    expect(g.tagName).toBe('P');
    expect(g.getAttribute('data-ghost')).toBe(GHOST);
    expect(g.textContent).toBe(''); // the words are drawn by the stylesheet: the paragraph holds none
    expect(editor().view.dom.getAttribute('aria-placeholder')).toBe(GHOST.replace(/\n/g, ' '));
    expect(title().placeholder).toBe('Name your poem');
    expect(title().value).toBe('');
    // nothing was written: not the lines, not the title
    expect(section('s3').content).toBe('');
    expect(section('s3').title).toBe('');
    expect(editor().state.doc.textContent).toBe('');
    expect(JSON.stringify(stored())).not.toContain('Write your first line');
    expect(JSON.stringify(stored())).not.toContain('Name your poem');

    // the first character
    act(() => {
      editor().commands.insertContent('A');
    });
    await settle();
    expect(ghostShown(editor().state)).toBe(false);
    expect(ghostEl()).toBeNull();
    expect(editor().view.dom.hasAttribute('aria-placeholder')).toBe(false);
    expect(section('s3').content).toBe('A');
    await waitFor(() => expect(title().placeholder).toBe(E['editor.chTitlePh']));

    // emptied again: they are back; prose again: they are not
    act(() => {
      editor().commands.selectAll();
      editor().commands.deleteSelection();
    });
    await settle();
    expect(ghostEl()).not.toBeNull();
    expect(section('s3').content).toBe('');
    await click(P()!);
    expect(ghostEl()).toBeNull();
    expect(title().placeholder).toBe(E['editor.chTitlePh']);
  });

  it('a poem with text never shows them', async () => {
    await openStudio(BOOK());
    await openSection(0);
    await click(P()!);
    expect(document.querySelector('#manuscript .ms-poem-ghost')).toBeNull();
    expect((document.getElementById('chTitle') as HTMLInputElement).placeholder).toBe(E['editor.chTitlePh']);
  });
});

/* ---- the editor alone (no app): the typing model ---- */

describe('typing in a poem', () => {
  const editors: Editor[] = [];
  afterEach(() => {
    for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  });
  function mount(text: string): { ed: Editor; frag: Y.XmlFragment } {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment('body');
    prosemirrorToYXmlFragment(toDoc(text), frag);
    const element = document.createElement('div');
    document.body.appendChild(element);
    const ed = createChapterEditor({ element, fragment: frag, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
    editors.push(ed);
    return { ed, frag };
  }
  const read = (ed: Editor, frag: Y.XmlFragment) => {
    flushNormalize(ed);
    return fragmentText(frag);
  };

  it('telling the editor its chapter is a poem changes its state and not one character of the text', () => {
    const { ed, frag } = mount(HARD);
    expect(poemState(ed.state).on).toBe(false);
    const doc = ed.state.doc;
    setEditorPoem(ed, { on: true, ghost: 'x' });
    expect(poemState(ed.state)).toEqual({ on: true, ghost: 'x' });
    expect(ed.state.doc.eq(doc)).toBe(true);
    expect(fragmentText(frag)).toBe(HARD);
    setEditorPoem(ed, { on: false, ghost: '' });
    expect(ed.state.doc.eq(doc)).toBe(true);
    expect(read(ed, frag)).toBe(HARD);
  });

  it('Enter is a new line, a blank line a new stanza; Shift-Enter is the same plain new line in a poem (in prose it writes the mark)', () => {
    const { ed, frag } = mount('');
    setEditorPoem(ed, { on: true, ghost: 'g' });
    ed.commands.focus('end');
    ed.commands.insertContent('First line');
    ed.commands.keyboardShortcut('Enter');
    ed.commands.insertContent('second line');
    ed.commands.keyboardShortcut('Shift-Enter');
    ed.commands.insertContent('third line');
    ed.commands.keyboardShortcut('Enter');
    ed.commands.keyboardShortcut('Enter');
    ed.commands.insertContent('A new stanza');
    expect(read(ed, frag)).toBe('First line\nsecond line\nthird line\n\nA new stanza');
    expect(read(ed, frag)).not.toContain(BS);

    // the same keys in prose: Shift-Enter writes the book's mark of a kept line break
    const prose = mount('');
    prose.ed.commands.focus('end');
    prose.ed.commands.insertContent('One');
    prose.ed.commands.keyboardShortcut('Shift-Enter');
    prose.ed.commands.insertContent('two');
    expect(read(prose.ed, prose.frag)).toBe('One' + BS + '\ntwo');
  });

  it('the starter lines are a decoration: the document and the fragment hold nothing', () => {
    const { ed, frag } = mount('');
    setEditorPoem(ed, { on: true, ghost: 'a\nb\nc' });
    expect(ghostShown(ed.state)).toBe(true);
    expect(ed.view.dom.querySelector('.ms-poem-ghost')!.getAttribute('data-ghost')).toBe('a\nb\nc');
    expect(ed.state.doc.textContent).toBe('');
    expect(read(ed, frag)).toBe('');
    ed.commands.focus('end');
    ed.commands.keyboardShortcut('Enter'); // a new line is a character too
    expect(ghostShown(ed.state)).toBe(false);
    expect(ed.view.dom.querySelector('.ms-poem-ghost')).toBeNull();
  });
});

/* ---- the words ---- */

describe('the words, in every interface language', () => {
  const KEYS = ['poem.mode', 'poem.alignAria', 'poem.titlePh', 'poem.ghost1', 'poem.ghost2', 'poem.ghost3', 'tool.verseInPoem'];
  const dir = path.join(import.meta.dirname, '..', 'src', 'generated', 'packs');
  const packs = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ code: f.replace(/\.json$/, ''), pack: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Record<string, string> }));

  it('there are 7, all in the English pack, and nothing else is under poem.', () => {
    expect(Object.keys(E).filter((k) => k.startsWith('poem.') || k === 'tool.verseInPoem').sort()).toEqual([...KEYS].sort());
    expect(E['poem.mode']).toBe('Poem Mode');
    expect(E['poem.titlePh']).toBe('Name your poem');
    expect([E['poem.ghost1'], E['poem.ghost2'], E['poem.ghost3']]).toEqual(['Write your first line here…', '…press Enter for the next one…', '…and a blank line starts a new stanza.']);
  });

  it('all 13 packs carry them, with no exclamation mark and no placeholder; every other language says them in its own words', () => {
    expect(packs.length).toBe(13);
    for (const { code, pack } of packs) {
      for (const k of KEYS) {
        const v = pack[k];
        expect(typeof v === 'string' && v.trim().length > 0, `${code} ${k}`).toBe(true);
        expect(/[!！¡]/.test(v!), `${code} ${k}: no exclamation mark`).toBe(false);
        expect(/\{\w+\}/.test(v!), `${code} ${k}: no placeholder`).toBe(false);
        if (code !== 'en') expect(v, `${code} ${k} is still English`).not.toBe(E[k]);
      }
      // the three starter lines read on from one another, as the English does
      expect(pack['poem.ghost1']!.endsWith('…'), code).toBe(true);
      expect(pack['poem.ghost2']!.startsWith('…') && pack['poem.ghost2']!.endsWith('…'), code).toBe(true);
      expect(pack['poem.ghost3']!.startsWith('…'), code).toBe(true);
    }
  });
});
