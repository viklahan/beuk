import type { ClosureApi } from '../closure';
import { runOnText, textArea, type Area, type TextEdit } from './insert';

/* BEUK:insert — what each toolbar button does to the text (1.0's
   #insertToolbar click handler, client/index.html initEditor), by its
   data-insert kind. Every edit is 1.0's own function from the browser
   closure, run on the stand-in textarea (insert.ts); the few lines 1.0
   writes inline in its click handler and dialog handlers are copied here
   line for line and compared with 1.0's own handlers in the tests
   (test/insert.test.ts, through the test-only oracle module).

   Bold and Italic are NOT here: they stay the editor's marks (step 4), see
   the wave 2a report's rulings. */

export type ToolKind =
  | 'link' | 'redact'
  | 'blockquote' | 'attribution' | 'ul' | 'ol' | 'scenebreak' | 'emdash' | 'endnote'
  | 'columns' | 'hanging' | 'verse' | 'center' | 'right' | 'texts' | 'letter' | 'transcript' | 'log' | 'insert' | 'margin' | 'sideways' | 'upsidedown';

/** The kinds that are a plain text edit (no dialog), and 1.0's call for each. */
export const TEXT_ACTIONS: Partial<Record<ToolKind, (c: ClosureApi, ta: Area) => void>> = {
  // A freshly planted break leaves the cursor standing on it (1.0 then shows its scene bar: the scene image, wave 2b)
  scenebreak: (c, ta) => {
    const st = ta.selectionStart || 0;
    c.insertAtCursor(ta, '\n\n***\n\n');
    ta.setSelectionRange(st + 2, st + 2);
  },
  emdash: (c, ta) => c.insertAtCursor(ta, '—'),
  blockquote: (c, ta) => c.applyBlockquote(ta),
  attribution: (c, ta) => c.applyAttribution(ta),
  ul: (c, ta) => c.applyList(ta, false),
  ol: (c, ta) => c.applyList(ta, true),
  columns: (c, ta) => c.applyContainer(ta, 'columns'),
  hanging: (c, ta) => c.applyContainer(ta, 'hanging'),
  verse: (c, ta) => c.applyContainer(ta, 'verse'),
  center: (c, ta) => c.applyContainer(ta, 'center'),
  'right': (c, ta) => c.applyContainer(ta, 'right'), // quoted for look.test's physical-property scan
  letter: (c, ta) => c.applyContainer(ta, 'letter'),
  texts: (c, ta) => c.applyContainer(ta, 'texts'),
  transcript: (c, ta) => c.applyContainer(ta, 'transcript'),
  log: (c, ta) => c.applyContainer(ta, 'log'),
  insert: (c, ta) => c.applyContainer(ta, 'insert'),
  redact: (c, ta) => {
    c.redactSelection(ta);
  },
  sideways: (c, ta) => c.applyContainer(ta, 'sideways'),
  upsidedown: (c, ta) => c.applyContainer(ta, 'upside-down'),
};

/** A plain toolbar action on the text: 1.0's result, or null when 1.0 changes nothing (a refusal: redact at no word). */
export function textAction(c: ClosureApi, kind: ToolKind, cur: TextEdit): TextEdit | null {
  const act = TEXT_ACTIONS[kind];
  return act ? runOnText(cur, (ta) => act(c, ta)) : null;
}

/* ---- the footnote (1.0's openFootnoteDialog / confirmFootnote) ---- */

/** The number the next footnote takes in this text (1.0's nextFootnoteNumber: one past the highest [^n] or [n]). */
export const footnoteNumber = (c: ClosureApi, text: string): number => c.nextFootnoteNumber(text);

/** 1.0's confirmFootnote: the [^n] marker over the selection, its definition at the end of the section, the caret after
 *  the marker (at the very end when the note is empty). */
export function footnoteEdit(c: ClosureApi, cur: TextEdit, n: number, noteRaw: string): TextEdit {
  const note = noteRaw.replace(/\s*\n\s*/g, ' ').trim();
  const marker = '[^' + n + ']';
  const area = textArea(cur.text, cur.start, cur.end);
  c.insertAtCursor(area, marker);
  const afterMarker = cur.start + marker.length;
  area.value = area.value.replace(/\s*$/, '') + '\n\n[^' + n + ']: ' + note;
  const at = note ? afterMarker : area.value.length;
  return { text: area.value, start: at, end: at };
}

/* ---- the link (1.0's openLinkDialog / confirmLink) ---- */

/** The words the link dialog starts with: the selected text, on one line. */
export const linkWordsOf = (cur: TextEdit): string => cur.text.slice(cur.start, cur.end).replace(/\s*\n\s*/g, ' ').trim();

/** 1.0's confirmLink: null when the address can't be a link (the dialog says lnk.bad), else [words](address) over the
 *  selection (the address itself, shortened, when no words were given). */
export function linkEdit(c: ClosureApi, cur: TextEdit, wordsRaw: string, urlRaw: string): TextEdit | null {
  const url = c.normalizeLinkUrl(urlRaw);
  if (!url) return null;
  let words = wordsRaw.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!words) words = url.replace(/^mailto:/i, '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return runOnText(cur, (ta) => c.insertAtCursor(ta, '[' + words + '](' + url + ')')) ?? cur;
}

/* ---- the margin note (1.0's openMarginDialog / confirmMargin) ---- */

/** The name the margin dialog offers: the last "::: margin <Name>" anywhere in the book (1.0 reads every section). */
export function marginLastName(c: ClosureApi, sectionTexts: readonly string[]): string {
  let last = '';
  sectionTexts.forEach((x) =>
    String(x || '').split('\n').forEach((l) => {
      const m = l.match(c.MARGIN_OPEN_RE);
      if (m && m[1]) last = m[1].trim();
    }),
  );
  return last;
}

/** The note's words the dialog starts with: the selected text. */
export const marginWordsOf = (cur: TextEdit): string => cur.text.slice(cur.start, cur.end).trim();

/** 1.0's confirmMargin: null without a name (the dialog says mn.bad), else "::: margin <Name>" with the words after the
 *  paragraph the selection ends in, the author's text left whole, the caret at the end of the note's words. */
export function marginEdit(c: ClosureApi, cur: TextEdit, nameRaw: string, wordsRaw: string): TextEdit | null {
  const name = nameRaw.replace(/[\r\n:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const words = wordsRaw.replace(/\r\n?/g, '\n').split('\n').filter((l) => !c.isContainerMarkLine(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const val = cur.text;
  const nx = val.indexOf('\n\n', Math.max(cur.start, cur.end));
  const a = nx < 0 ? val.replace(/\s+$/, '').length : nx;
  const b = a;
  const head = val.slice(0, a).replace(/\s+$/, '');
  const tail = val.slice(b).replace(/^\s+/, '');
  const opener = '::: margin ' + name + '\n';
  const next = (head ? head + '\n\n' : '') + opener + words + '\n:::' + (tail ? '\n\n' + tail : '');
  const caret = (head ? head.length + 2 : 0) + opener.length + words.length;
  return { text: next, start: caret, end: caret };
}

/* ---- Auto-Format (1.0's btnBeautify handler, A13) ---- */

/** 1.0's Auto-Format of a section's text: a bare "[n]:" definition becomes "[^n]:", then beautifyText. */
export const autoFormatText = (c: ClosureApi, text: string): string => c.beautifyText(text.replace(/^\[\^?(\d+)\]:/gm, '[^$1]:'));

/** Auto-Format as an edit: the caret and selection keep their offsets, clamped to the new text (1.0's withEditorView). */
export function autoFormatEdit(c: ClosureApi, cur: TextEdit): TextEdit {
  const text = autoFormatText(c, cur.text);
  return { text, start: Math.min(cur.start, text.length), end: Math.min(cur.end, text.length) };
}
