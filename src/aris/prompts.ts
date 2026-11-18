import { loadPersona } from './persona.js';
import type { ArisMessage } from './providers.js';

/**
 * Draft-lens prompt contracts. One system message (the persona's Core,
 * never a voice modifier: prose must not catch Aris's accent) and one user
 * message holding the book's context and the task. The user message is
 * held to DRAFT_WINDOW_CHARS: the section text is windowed around the
 * cursor or the selection, and the prompt says nothing about the window.
 */
export const DRAFT_WINDOW_CHARS = 24_000;
/** Covenant entries are kept whole, in the order given, up to this many chars. */
export const COVENANT_MAX_CHARS = 6_000;

export type DraftAction = 'beat' | 'continue' | 'fill' | 'summarize' | 'rewrite' | 'expand' | 'condense';
export type CovenantEntry = { kind: string; name: string; note: string };
export type DraftPromptInput = {
  action: DraftAction;
  instruction?: string;
  sectionText: string;
  cursorOffset?: number;
  selection?: { text: string };
  bookTitle: string;
  covenants: CovenantEntry[];
};

const SELECTION_ACTIONS = new Set<DraftAction>(['rewrite', 'expand', 'condense']);

const TASKS: Record<DraftAction, string> = {
  beat:
    'Write the passage the beat describes, to stand at the cursor: it follows on from the last words of <text_before> and, if there is <text_after>, leads into its first words. Do not repeat either side.',
  continue:
    'Continue the story from the cursor. Pick up exactly where <text_before> stops, mid-sentence if it stops mid-sentence, and write until a natural pause: a few paragraphs at most. Do not repeat or rewrite <text_after>.',
  fill:
    'Write the passage that belongs at the cursor. It carries the story from the last words of <text_before> into the first words of <text_after> and stops where <text_after> begins. Do not repeat either side.',
  summarize:
    'Summarize <section> in plain prose: what happens, who is present, what changes. Use the book\'s names and tense. The summary only: no heading, no list, no opinion.',
  rewrite:
    'Rewrite <selection>. Keep its events, its meaning and its point of view; make it read better in this book\'s voice. Your passage replaces <selection> exactly, so it must join <text_before> and <text_after> without a seam.',
  expand:
    'Expand <selection>: the same events, given more room, with more of what is seen, heard and felt, in this book\'s voice. Add no new plot. Your passage replaces <selection> exactly, so it must join <text_before> and <text_after> without a seam.',
  condense:
    'Condense <selection> into fewer words. Keep every event and every line of dialogue that carries the story; drop what repeats. Your passage replaces <selection> exactly, so it must join <text_before> and <text_after> without a seam.',
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function covenantBlock(entries: CovenantEntry[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- ${oneLine(e.kind)} · ${oneLine(e.name)}: ${oneLine(e.note)}`;
    if (used + line.length + 1 > COVENANT_MAX_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Keep `rest` chars of context around [start, end): half each side, and a
 * side with less text than its half hands the remainder to the other.
 * Never splits a surrogate pair at the outer edges.
 */
export function windowAround(text: string, start: number, end: number, rest: number): { before: string; after: string } {
  const room = Math.max(0, rest);
  const beforeAvail = start;
  const afterAvail = text.length - end;
  let takeBefore = Math.min(beforeAvail, Math.max(Math.floor(room / 2), room - afterAvail));
  const takeAfter = Math.min(afterAvail, room - takeBefore);
  takeBefore = Math.min(beforeAvail, room - takeAfter);
  let from = start - takeBefore;
  let to = end + takeAfter;
  if (from > 0 && from < start && isLow(text.charCodeAt(from))) from += 1;
  if (to < text.length && to > end && isHigh(text.charCodeAt(to - 1))) to -= 1;
  return { before: text.slice(from, start), after: text.slice(end, to) };
}

/** The selection's position: the occurrence at/nearest the cursor, else the first. */
function locateSelection(text: string, sel: string, cursor: number | undefined): number {
  if (!sel) return -1;
  if (cursor === undefined) return text.indexOf(sel);
  if (text.startsWith(sel, cursor)) return cursor;
  let best = -1;
  for (let i = text.indexOf(sel); i !== -1; i = text.indexOf(sel, i + 1)) {
    if (best === -1 || Math.abs(i - cursor) < Math.abs(best - cursor)) best = i;
  }
  return best;
}

const tag = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`;

export function buildDraftPrompt(o: DraftPromptInput): ArisMessage[] {
  const text = o.sectionText;
  if (o.cursorOffset !== undefined && (!Number.isInteger(o.cursorOffset) || o.cursorOffset < 0 || o.cursorOffset > text.length)) {
    throw new RangeError(`cursorOffset ${o.cursorOffset} is outside the section (0..${text.length})`);
  }
  const instruction = o.instruction?.trim() ?? '';
  if (o.action === 'beat' && !instruction) throw new Error('beat needs an instruction: the beat to write');
  const selected = SELECTION_ACTIONS.has(o.action);
  const sel = o.selection?.text ?? '';
  if (selected && !sel.trim()) throw new Error(`${o.action} needs a selection`);

  // Where the window is anchored: the selection span, or the cursor (default: end of section).
  let start = o.cursorOffset ?? text.length;
  let end = start;
  if (selected) {
    const at = locateSelection(text, sel, o.cursorOffset);
    if (at !== -1) {
      start = at;
      end = at + sel.length;
    }
  }

  const covenants = covenantBlock(o.covenants);
  const head = [tag('book_title', oneLine(o.bookTitle)), covenants ? tag('covenant', covenants) : ''].filter(Boolean);
  const direction =
    o.action === 'beat' ? tag('beat', instruction) : instruction ? tag('writer_direction', instruction) : '';
  const tail = [direction, `Task: ${TASKS[o.action]}`].filter(Boolean);

  const assemble = (before: string, after: string): string => {
    const body =
      o.action === 'summarize'
        ? [tag('section', before + after)]
        : selected
          ? [tag('text_before', before), tag('selection', sel), tag('text_after', after)]
          : [tag('text_before', before), tag('text_after', after)];
    return [...head, ...body, ...tail].join('\n\n');
  };

  const frame = assemble('', '').length;
  const rest = DRAFT_WINDOW_CHARS - frame;
  if (rest < 0) {
    throw new RangeError(`draft request is ${frame} chars before any section text; the limit is ${DRAFT_WINDOW_CHARS}`);
  }
  const { before, after } = windowAround(text, start, end, rest);
  return [
    { role: 'system', content: loadPersona().core },
    { role: 'user', content: assemble(before, after) },
  ];
}
