import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { prosemirrorToYXmlFragment as ypPmToFrag } from 'y-prosemirror';
import { fragmentText, posToTextOffset, textOffsetToPos, toDoc } from '@book/editor/index.js';
import { createOracle } from '../src/generated/closure-oracle.js';
import { closureShare, loadClosure, stateFromBook, type Closure, type ClosureApi } from '../src/closure/index';
import { toBook } from '../src/editor/bridge';
import { createChapterEditor } from '../src/editor/createEditor';
import { applyTextEdit, editorText, textArea, type Area, type TextEdit } from '../src/editor/insert';
import {
  autoFormatEdit, footnoteEdit, footnoteNumber, linkEdit, linkWordsOf, marginEdit, marginLastName, marginWordsOf, TEXT_ACTIONS, textAction, type ToolKind,
} from '../src/editor/tools';
import { fixtures } from './fixtures';

/* Wave 2a, constraint 11: 1.0's insert functions are the oracle.

   - Every toolbar action, applied in the editor to a text with a selection
     (as text offsets), leaves exactly the text 1.0's own function leaves in
     a textarea holding that text and selection, and the caret where 1.0
     puts it (floored to a cursor position, positions.ts). Selections: a
     collapsed caret, inside emphasis, across two paragraphs, inside a raw
     block, inside a container, at the start and end; and fixture sections.
   - Each action is ONE undo step: undo gives the original text back.
   - The dialog handlers (footnote, link, margin note): 2.0's text logic
     equals 1.0's own openXDialog + confirmX, run through the test-only
     oracle module (closure-oracle.js) with a stand-in `$` and textarea.
   - Auto-Format equals 1.0's beautifyText on every fixture section. */

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
  document.body.innerHTML = '';
});

function mount(text: string): { ed: Editor; frag: Y.XmlFragment } {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment('body');
  ypPmToFrag(toDoc(text), frag);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const ed = createChapterEditor({ element, fragment: frag, dir: 'ltr', lang: 'en', label: 'Chapter', onRefuse: () => undefined });
  editors.push(ed);
  return { ed, frag };
}

/** Put the editor's selection at text offsets (floored to cursor positions); returns the offsets it stands at. */
function select(ed: Editor, s: number, e: number): TextEdit {
  const doc = toBook(ed.state.doc);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textOffsetToPos(doc, s), textOffsetToPos(doc, e))));
  return editorText(ed);
}
/** An offset of `text` as the editor can hold it (positions.ts floor). */
const floorIn = (text: string, o: number): number => {
  const d = toDoc(text);
  return posToTextOffset(d, textOffsetToPos(d, o));
};

const TEXTS = [
  'First paragraph stands.\n\nA quoted line\nspanning two lines.\n\nLast paragraph rests.',
  'a *b c* d and **strong words** here[^1].\n\nSecond *em\nacross* lines.\n\n[^1]: The note.',
  '::: verse\nline one\n  line two\n:::\n\nAfter the verse.',
  '::: center\nCentred words.\n\nStill centred.\n:::\n\nTail words.',
  '> quoted\n> more\n\n- one\n- two\n\n# Head line\n\nBody.',
  'Name: hello there\nOther: hi\n\nMe: and so on',
  'word',
  '',
  '1. step\n2. next\n\nplain *x* [link](https://example.com/a) end\n\n***\n\nAfter.',
];
/** Selections over a text: carets at the start, the end, and spread through; ranges over words, across blocks, all. */
function selections(text: string): [number, number][] {
  const n = text.length;
  const out: [number, number][] = [[0, 0], [n, n], [0, n]];
  for (let k = 1; k < 6; k++) out.push([Math.floor((n * k) / 6), Math.floor((n * k) / 6)]);
  for (let k = 0; k < 4; k++) {
    const a = Math.floor((n * k) / 5);
    out.push([a, Math.min(n, a + 7)]);
  }
  const p2 = text.indexOf('\n\n');
  if (p2 > 2) out.push([p2 - 3, Math.min(n, p2 + 5)]); // across two blocks
  for (const w of ['b c', 'strong', 'line one', 'Centred', 'quoted', 'hello', 'step', 'x']) {
    const i = text.indexOf(w);
    if (i >= 0) out.push([i, i + w.length], [i + 1, i + 1]);
  }
  return out;
}

let C: Closure;
let c: ClosureApi;
beforeAll(async () => {
  C = await loadClosure();
  c = C.api;
});

const KINDS = Object.keys(TEXT_ACTIONS) as ToolKind[];

/** 1.0's own action on a textarea holding the text and selection (its click handler: the scene break's two lines are
 *  its inline code, everything else one call of its own function). */
function oracle(kind: ToolKind, cur: TextEdit): Area {
  const ta = textArea(cur.text, cur.start, cur.end);
  switch (kind) {
    case 'scenebreak': {
      const st = ta.selectionStart || 0;
      c.insertAtCursor(ta, '\n\n***\n\n');
      ta.setSelectionRange(st + 2, st + 2);
      break;
    }
    case 'emdash': c.insertAtCursor(ta, '—'); break;
    case 'blockquote': c.applyBlockquote(ta); break;
    case 'attribution': c.applyAttribution(ta); break;
    case 'ul': case 'ol': c.applyList(ta, kind === 'ol'); break;
    case 'redact': c.redactSelection(ta); break;
    case 'sideways': c.applyContainer(ta, 'sideways'); break;
    case 'upsidedown': c.applyContainer(ta, 'upside-down'); break;
    default: c.applyContainer(ta, kind);
  }
  return ta;
}

/** Apply `kind` in the editor at [s, e) and check it against 1.0, then undo. Returns whether the text changed. */
function check(ed: Editor, frag: Y.XmlFragment, text: string, kind: ToolKind, s: number, e: number, where: string): boolean {
  const cur = select(ed, s, e);
  expect(cur.text, where).toBe(text);
  const want = oracle(kind, cur);
  const next = textAction(c, kind, cur);
  if (want.value === text) {
    // 1.0 changed nothing (redact with no word under the caret): 2.0 writes nothing either
    expect(next === null || next.text === text, where).toBe(true);
    return false;
  }
  expect(next, where).not.toBeNull();
  applyTextEdit(ed, next!);
  expect(fragmentText(frag), `${where}: text`).toBe(want.value);
  const sel = editorText(ed);
  expect([sel.start, sel.end], `${where}: selection`).toEqual([floorIn(want.value, want.selectionStart), floorIn(want.value, want.selectionEnd)]);
  ed.commands.undo();
  expect(fragmentText(frag), `${where}: one undo gives the original back`).toBe(text);
  return true;
}

describe("every toolbar action equals 1.0's own function (constraint 11, review focus 1 and 2)", () => {
  it('the review texts: every kind, every selection shape; one undo step each', () => {
    let changed = 0, cases = 0;
    for (const text of TEXTS) {
      for (const [s, e] of selections(text)) {
        // a fresh editor per selection: Yjs's undo grows slower with every undo on one document (see the report)
        const { ed, frag } = mount(text);
        for (const kind of KINDS) {
          cases++;
          if (check(ed, frag, text, kind, s, e, `${kind} on ${JSON.stringify(text.slice(0, 30))} [${s},${e}]`)) changed++;
        }
        ed.destroy();
      }
    }
    expect(cases).toBeGreaterThan(1500);
    expect(changed).toBeGreaterThan(1200);
  }, 120_000);

  it('fixture sections: every kind at a caret and over a range', () => {
    const texts = fixtures('real')
      .filter((f) => !/dartagnan|valois|oz-14/.test(f.name))
      .flatMap((f) => (Array.isArray(f.book.sections) ? (f.book.sections as { content?: unknown }[]) : []).map((s) => s.content))
      .filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length < 6000)
      .slice(0, 16);
    expect(texts.length).toBe(16);
    for (const [i, text] of texts.entries()) {
      const n = text.length;
      for (const [s, e] of [[Math.floor(n / 3), Math.floor(n / 3)], [Math.floor(n / 2), Math.min(n, Math.floor(n / 2) + 40)]] as [number, number][]) {
        const { ed, frag } = mount(text);
        for (const kind of KINDS) check(ed, frag, text, kind, s, e, `${kind} on fixture section ${i} [${s},${e}]`);
        ed.destroy();
      }
    }
  }, 120_000);

  it("1.0's self-check editor.toolbar.blockquote-scenebreak: the cursor's paragraph quoted line by line, *** on its own line", () => {
    const text = 'First paragraph stands.\n\nA quoted line\nspanning two lines.\n\nLast paragraph rests.';
    const { ed, frag } = mount(text);
    const pos = text.indexOf('spanning');
    applyTextEdit(ed, textAction(c, 'blockquote', select(ed, pos, pos))!);
    expect(fragmentText(frag)).toBe('First paragraph stands.\n\n> A quoted line\n> spanning two lines.\n\nLast paragraph rests.');
    // it parses as a real quote (wave 2a: a quote node)
    expect(ed.state.doc.child(1).type.name).toBe('quote');
    const end = fragmentText(frag).length;
    applyTextEdit(ed, textAction(c, 'scenebreak', select(ed, end, end))!);
    expect(fragmentText(frag).split('\n')).toContain('***');
    expect(ed.state.doc.lastChild!.type.name === 'sceneBreak' || ed.state.doc.child(ed.state.doc.childCount - 1).type.name === 'paragraph').toBe(true);
    let breaks = 0;
    ed.state.doc.forEach((b) => {
      if (b.type.name === 'sceneBreak') breaks++;
    });
    expect(breaks).toBe(1);
  });
});

/* ---- the dialog handlers, against 1.0's own (the oracle module) ---- */

type FakeEl = { id: string; value: string; textContent: string; classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean }; focus: () => void; addEventListener: () => void };
function fakeEls() {
  const els: Record<string, FakeEl> = {};
  const el = (id: string): FakeEl => {
    if (!els[id]) {
      const cls = new Set<string>();
      els[id] = { id, value: '', textContent: '', classList: { add: (x) => cls.add(x), remove: (x) => cls.delete(x), contains: (x) => cls.has(x) }, focus: () => undefined, addEventListener: () => undefined };
    }
    return els[id]!;
  };
  return { els, el };
}
/** 1.0's dialog: open it on a textarea holding the text and selection, fill its fields, confirm. */
function oracleDialog(which: 'Footnote' | 'Link' | 'Margin', cur: TextEdit, fill: (el: (id: string) => FakeEl) => void, sections: string[] = [cur.text]) {
  const area = Object.assign(textArea(cur.text, cur.start, cur.end), { id: 'editorArea' });
  const { el } = fakeEls();
  const prev = C.getState();
  C.setState({ ...(prev ?? {}), meta: {}, sections: sections.map((content) => ({ content })) } as never);
  try {
    const o = createOracle(closureShare()!, {
      $: (id: string) => (id === 'editorArea' ? area : el(id)),
      activeSection: () => ({ type: 'chapter', kind: 'body' }),
      editorViewSnapshot: () => null,
      editorViewRestore: () => undefined,
      icons: () => undefined,
    });
    o['open' + which + 'Dialog']!();
    const opened = { fnTitle: el('fnTitle').textContent, lnkText: el('lnkText').value, mnName: el('mnName').value, mnText: el('mnText').value };
    fill(el);
    o['confirm' + which]!();
    return { text: area.value, start: area.selectionStart, end: area.selectionEnd, opened, open: el('modal' + which).classList.contains('open'), hintBad: el(which === 'Link' ? 'lnkHint' : 'mnHint').classList.contains('is-bad') };
  } finally {
    C.setState(prev as never);
  }
}

describe("the dialog handlers equal 1.0's own (constraint 11; 12 and 13)", () => {
  const SEL = (text: string): TextEdit[] => selections(text).map(([s, e]) => ({ text, start: Math.min(s, e), end: Math.max(s, e) }));

  it('footnote: the number, the marker at the selection and the definition at the end, as 1.0 places them', () => {
    const notes = ['Drawn in ink that never dried.', '', '  two\n lines \n', 'x'];
    const texts = [...TEXTS, 'Text[^1] and [2] and [^12].\n\n[^1]: one\n\n[2]: two\n\n[^12]: twelve', 'trailing spaces   \n\n'];
    let n = 0;
    for (const text of texts) {
      for (const cur of SEL(text)) {
        for (const note of notes) {
          const want = oracleDialog('Footnote', cur, (el) => {
            el('fnText').value = note;
          });
          const num = footnoteNumber(c, text);
          expect(want.opened.fnTitle).toBe('fn.titleN'); // the closure's t() here is the key: the number is checked below
          expect(footnoteEdit(c, cur, num, note), JSON.stringify([text.slice(0, 20), cur.start, cur.end, note])).toEqual({ text: want.text, start: want.start, end: want.end });
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(300);
    // 1.0's numbering: one past the highest [^n] or [n] anywhere in the section
    expect(footnoteNumber(c, 'a[^1] b[3] c\n\n[^1]: x')).toBe(4);
    expect(footnoteNumber(c, 'none')).toBe(1);
  });

  it("1.0's self-check editor.toolbar.footnote-dialog-pair: a numbered pair, then a second numbered 2 against the first", () => {
    let cur: TextEdit = { text: 'The chart was old.', start: 18, end: 18 };
    expect(footnoteNumber(c, cur.text)).toBe(1);
    cur = footnoteEdit(c, cur, 1, 'Drawn in ink that never dried.');
    expect(cur.text).toBe('The chart was old.[^1]\n\n[^1]: Drawn in ink that never dried.');
    expect(footnoteNumber(c, cur.text)).toBe(2);
    const second = footnoteEdit(c, { ...cur, start: 5, end: 5 }, 2, 'A second note.');
    expect(second.text.indexOf('[^2]')).toBe(5);
    expect(second.text.endsWith('[^2]: A second note.')).toBe(true);
    expect(second.text.includes('[^1]: Drawn in ink that never dried.')).toBe(true);
  });

  it('constraint 13: deleting a reference renumbers nothing, as in 1.0 (no renumbering exists there); the next note is one past the highest', () => {
    let cur: TextEdit = { text: 'One. Two. Three.', start: 4, end: 4 };
    cur = footnoteEdit(c, cur, footnoteNumber(c, cur.text), 'first');
    cur = footnoteEdit(c, { ...cur, start: cur.text.indexOf('Two.') + 4, end: cur.text.indexOf('Two.') + 4 }, footnoteNumber(c, cur.text), 'second');
    cur = footnoteEdit(c, { ...cur, start: cur.text.indexOf('Three.') + 6, end: cur.text.indexOf('Three.') + 6 }, footnoteNumber(c, cur.text), 'third');
    expect(cur.text).toBe('One.[^1] Two.[^2] Three.[^3]\n\n[^1]: first\n\n[^2]: second\n\n[^3]: third');
    // the writer deletes the first reference: in 1.0 the text is simply the text — every later note keeps its number
    const { ed, frag } = mount(cur.text);
    const at = cur.text.indexOf('[^1]');
    ed.view.dispatch(ed.state.tr.delete(textOffsetToPos(toBook(ed.state.doc), at), textOffsetToPos(toBook(ed.state.doc), at + 4)));
    expect(fragmentText(frag)).toBe('One. Two.[^2] Three.[^3]\n\n[^1]: first\n\n[^2]: second\n\n[^3]: third');
    expect(footnoteNumber(c, fragmentText(frag))).toBe(4);
  });

  it('link: the starting words, the address rules (normalizeLinkUrl from 1.0), and [words](address) over the selection', () => {
    const urls = ['example.com', 'www.example.org/a(b)c', 'reader@example.com', 'https://x.example/z_(y)', 'javascript:alert(1)', 'ftp://x.example', '', '  https://ok.example/  ', 'http://a b', 'mailto:a@b.c', 'data:text/html,x'];
    const words = ['', 'the [odd] words', '  spaced   out  '];
    let n = 0;
    for (const text of TEXTS) {
      for (const cur of SEL(text).slice(0, 12)) {
        for (const url of urls) {
          for (const w of words) {
            const want = oracleDialog('Link', cur, (el) => {
              if (w) el('lnkText').value = w;
              el('lnkUrl').value = url;
            });
            expect(linkWordsOf(cur)).toBe(want.opened.lnkText);
            const typed = w || linkWordsOf(cur);
            const got = linkEdit(c, cur, typed, url);
            if (want.open) {
              // 1.0 refused the address: the dialog stays open and says lnk.bad
              expect(want.hintBad).toBe(true);
              expect(got).toBeNull();
            } else expect(got, JSON.stringify([cur.start, cur.end, url, w])).toEqual({ text: want.text, start: want.start, end: want.end });
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(2000);
    // refused, never written into the text: javascript:, data:, ftp:
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example']) expect(c.normalizeLinkUrl(bad)).toBeNull();
  });

  it("margin note: the book's last margin name offered, the note after the selection's paragraph, as 1.0 places it", () => {
    const book = ['Intro.\n\n::: margin Ada\nfirst\n:::', 'Middle.', '::: margin  B. K. \nx\n:::\n\nEnd.'];
    const names = ['', 'M.', 'Ann: B\nC', '  Lee  '];
    const wordsList = ['', 'a word', '::: center\nkept line\n:::\n\n\n\nafter', '  spaced  '];
    let n = 0;
    for (const text of TEXTS) {
      for (const cur of SEL(text).slice(0, 10)) {
        for (const name of names) {
          for (const w of wordsList) {
            const want = oracleDialog('Margin', cur, (el) => {
              el('mnName').value = name;
              el('mnText').value = w;
            }, [...book, text]);
            expect(marginLastName(c, [...book, text])).toBe(want.opened.mnName);
            expect(marginWordsOf(cur)).toBe(want.opened.mnText);
            const got = marginEdit(c, cur, name, w);
            if (want.open) {
              expect(want.hintBad).toBe(true);
              expect(got).toBeNull();
            } else expect(got, JSON.stringify([cur.start, cur.end, name, w])).toEqual({ text: want.text, start: want.start, end: want.end });
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(marginLastName(c, book)).toBe('B. K.');
  });
});

describe("Auto-Format equals 1.0's beautifyText (A13, review focus 4)", () => {
  it('every fixture section: the editor gets exactly 1.0\'s text, one undo step, the caret kept at its offset', () => {
    // 1.0's quotes follow the book's language (curlify reads bookLang()): each book's own state
    const texts: string[] = [];
    let changed = 0;
    for (const f of fixtures('real')) {
      stateFromBook(C, structuredClone(f.book));
      const own = (Array.isArray(f.book.sections) ? (f.book.sections as { content?: unknown }[]) : []).map((s) => s.content).filter((t): t is string => typeof t === 'string');
      for (const text of own) {
        const want = c.beautifyText(text.replace(/^\[\^?(\d+)\]:/gm, '[^$1]:'));
        expect(autoFormatEdit(c, { text, start: 0, end: 0 }).text).toBe(want);
        if (want !== text) changed++;
      }
      if (f.name.includes('lunas') || f.name.includes('salt-road') || f.name.includes('four-kitchens')) texts.push(...own);
    }
    expect(changed).toBeGreaterThan(10);
    // in the editor, on small fixtures (the big books' chapters are covered by the text test above)
    for (const text of texts.filter((t) => t.length < 8000).slice(0, 40)) {
      const { ed, frag } = mount(text);
      const mid = Math.floor(text.length / 2);
      const cur = select(ed, mid, mid);
      const next = autoFormatEdit(c, cur);
      if (next.text === text) continue;
      applyTextEdit(ed, next);
      expect(fragmentText(frag)).toBe(next.text);
      expect(editorText(ed).start).toBe(floorIn(next.text, Math.min(cur.start, next.text.length)));
      ed.commands.undo();
      expect(fragmentText(frag)).toBe(text);
    }
  });

  it('a raw block is left alone wherever 1.0 leaves its text alone (a log keeps its lines; a verse keeps its quotes straight)', () => {
    stateFromBook(C, { meta: { title: 'x', language: 'en' }, sections: [] });
    const text = 'He said "hi" -- then...\n\n::: log\n12:00 "raw" -- kept...\n:::\n\nAfter "this".';
    const out = autoFormatEdit(c, { text, start: 0, end: 0 }).text;
    expect(out).toBe(c.beautifyText(text));
    expect(out).toContain('::: log\n12:00 "raw" -- kept...\n:::');
    expect(out.startsWith('He said “hi” — then…')).toBe(true);
  });
});
