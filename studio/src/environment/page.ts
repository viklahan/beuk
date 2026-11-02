import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type * as Y from 'yjs';
import { textOffsetToPos } from '@book/editor/index.js';
import { bookState, closureIfLoaded, pageEnv, structEnv, writeEnv, type Closure } from '../closure/index';
import { getMeta, setMeta } from '../book/hooks';
import { placeKey } from '../notebook/notebook';
import { activeEditor } from '../editor/active';
import { toBook } from '../editor/bridge';
import { applyTextEdit, editorText, type TextEdit } from '../editor/insert';

/* Step 5 wave 3a, tasks 2 and 3: the page 1.0's Zen, Read Aloud and dictation code runs in.

   That code (lifted whole into the browser closure: setZenMode, zenBuildLayer, the day cycle, the sound, ra*, dict*,
   the language bar) reaches its page through `$` and a few page functions. 2.0 supplies them:
   - `$` is document.getElementById, except two ids whose 1.0 element 2.0 does not have:
     - #editorArea, 1.0's textarea: a stand-in over the open chapter's editor (value, selection, focus, and the
       "input" event that commits a change as ONE editor transaction through applyTextEdit — never a raw splice). A
       dictation session's rewrites of its own span merge into one undo step (1.0's textarea: one per phrase).
     - #panelContent, the content panel: 1.0 inserts Zen's stage and continue line around its textarea there, so the
       stand-in places them around the editor's page (#manuscript) and passes classes to the real panel.
   - activeSection: the open section in 1.0's state, which envRun builds from the book at the moment of the call.
   - setCenterTab: the Shell's centre tab (Zen is always the desk); selectSection: the Shell's select.
   - noteBookEdited: when 1.0 saves (langSetBookLanguage, dictSetLang), envRun writes what 1.0 changed — the book
     language keys of `meta` and `dictation` (as serializeBook writes it: dictNormalize) — and nothing else. */

type Desk = { ydoc: Y.Doc | null; active: number | null; select: (index: number) => void; setCenter: (tab: 'content' | 'outline') => void };
export const desk: Desk = { ydoc: null, active: null, select: () => undefined, setCenter: () => undefined };

/** 1.0's state for the open book with its open section active; `fn` runs on it; 1.0's own saves are written back. */
export function envRun<T>(fn: (c: Closure) => T): T | undefined {
  const c = closureIfLoaded();
  const done = envEnter();
  if (!c || !done) return undefined;
  try {
    return fn(c);
  } finally {
    done();
  }
}

/** The two halves of envRun, for 1.0's own listeners (the dictation popover's language buttons and select, which
 *  1.0's dictWireLangPicker wires to dictSetLang): 1.0's state is built from the book NOW and its saves are caught
 *  until the returned function runs. Null when no book or no closure. */
export function envEnter(): (() => void) | null {
  const c = envRefresh();
  const y = desk.ydoc;
  if (!c || !y) return null;
  let edited = false;
  const prev = writeEnv.noteBookEdited;
  writeEnv.noteBookEdited = () => {
    edited = true;
  };
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    writeEnv.noteBookEdited = prev;
    if (edited) writeLangBack(c, y);
  };
}

/** The section envRefresh last put on the desk (1.0's state of it), for activeSection() when another part of the
 *  studio has since set a lighter state of its own into the shared closure (the starter bar's meta-only state). */
let lastActive: { index: number; section: unknown } | null = null;

/** 1.0's state of the open book, built NOW and set into the closure, its open section active. Returns the closure. */
export function envRefresh(): Closure | null {
  const c = closureIfLoaded();
  const y = desk.ydoc;
  if (!c || !y) return null;
  const { state } = bookState(c, y);
  const sec = desk.active === null ? undefined : state.sections[desk.active];
  (state as Record<string, unknown>).activeId = sec ? sec.id : null;
  lastActive = desk.active === null || !sec ? null : { index: desk.active, section: sec };
  return c;
}

const LANG_KEYS = ['language', 'langSource', 'langGuess'] as const;
function writeLangBack(c: Closure, y: Y.Doc): void {
  const s = c.getState() as Record<string, unknown> & { meta: Record<string, unknown> };
  const stored = (getMeta(y, 'meta') ?? {}) as Record<string, unknown>;
  const nextMeta: Record<string, unknown> = { ...stored };
  let metaChanged = false;
  for (const k of LANG_KEYS) {
    const v = s.meta[k];
    if (v !== undefined && stored[k] !== v) {
      nextMeta[k] = v;
      metaChanged = true;
    }
  }
  const dict = c.api.dictNormalize(s.dictation);
  const storedDict = getMeta(y, 'dictation');
  const dictChanged = JSON.stringify(dict) !== JSON.stringify(c.api.dictNormalize(storedDict));
  if (!metaChanged && !dictChanged) return;
  y.transact(() => {
    if (metaChanged) setMeta(y, 'meta', nextMeta as never);
    if (dictChanged) {
      placeKey(y, 'dictation');
      setMeta(y, 'dictation', dict as never);
    }
  });
}

/* ---- 1.0's textarea, over the open editor ---- */

let lastSpan: { editor: Editor; start: number; gen: number } | null = null;
function areaStandIn(): Record<string, unknown> | null {
  const a = activeEditor();
  if (!a || a.editor.isDestroyed) return null;
  const ed = a.editor;
  let pending: TextEdit | null = null;
  const cur = () => pending ?? editorText(ed);
  const select = (s: number, e: number) => {
    const d = toBook(ed.state.doc);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textOffsetToPos(d, s), textOffsetToPos(d, e))));
  };
  return {
    nodeType: 0,
    disabled: false,
    scrollTop: 0,
    scrollLeft: 0,
    get value() {
      return cur().text;
    },
    set value(v: string) {
      const c0 = cur();
      pending = { text: String(v), start: Math.min(c0.start, String(v).length), end: Math.min(c0.end, String(v).length) };
    },
    get selectionStart() {
      return cur().start;
    },
    get selectionEnd() {
      return cur().end;
    },
    setSelectionRange(s: number, e: number) {
      if (pending) pending = { ...pending, start: s, end: e };
      else select(s, e);
    },
    focus() {
      ed.view.focus();
    },
    blur() {
      (ed.view.dom as HTMLElement).blur();
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(ev: Event) {
      if (ev.type !== 'input' || !pending) return true;
      const next = pending;
      pending = null;
      // dictation: one session span's rewrites are one undo step (dict.applying is set by 1.0 around them)
      const c = closureIfLoaded();
      const d = c?.api.dict as { applying: boolean; spanStart: number; gen: number } | undefined;
      let merge = false;
      if (d && d.applying && d.spanStart >= 0) {
        merge = !!lastSpan && lastSpan.editor === ed && lastSpan.start === d.spanStart && lastSpan.gen === d.gen;
        lastSpan = { editor: ed, start: d.spanStart, gen: d.gen };
      } else lastSpan = null;
      applyTextEdit(ed, next, { merge });
      return true;
    },
  };
}

/** #panelContent for Zen: its stage and continue line go around the editor's page; classes go to the real panel. */
function panelStandIn(): Record<string, unknown> | null {
  const panel = document.getElementById('panelContent');
  if (!panel) return null;
  const page = () => document.getElementById('manuscript');
  return {
    classList: panel.classList,
    get id() {
      return panel.id;
    },
    insertBefore(node: Node, ref: unknown) {
      const at = page();
      // 1.0: before its textarea (the stand-in); here: before the editor's page, in the desk
      if (at && at.parentNode && (ref === null || (ref as { nodeType?: number }).nodeType === 0)) return at.parentNode.insertBefore(node, at);
      if (ref instanceof Node && ref.parentNode) return ref.parentNode.insertBefore(node, ref);
      return panel.appendChild(node);
    },
    appendChild(node: Node) {
      const at = page();
      const host = at && at.parentNode ? at.parentNode : panel;
      return host.appendChild(node);
    },
    contains: (n: Node) => panel.contains(n),
    querySelector: (q: string) => panel.querySelector(q),
    getBoundingClientRect: () => panel.getBoundingClientRect(),
  };
}

/** 1.0's `$`, as the lifted code reaches the page. */
export function $(id: string): unknown {
  if (id === 'editorArea') return areaStandIn();
  if (id === 'panelContent') return panelStandIn();
  if (id === 'app') {
    // 1.0's #app is a child of <body> (zenBuildLayer puts the painting before it); 2.0's sits in React's root
    let el: HTMLElement | null = document.getElementById('app');
    while (el && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
    return el;
  }
  return document.getElementById(id);
}

/** 1.0's activeSection(): the desk's open section, in the closure's current state. 1.0's own timers and callbacks
 *  (Read Aloud's next chunk, Zen's redraws) run outside envRun, after other parts of the studio may have set a state
 *  of their own into the shared closure: the section is looked up, by the id envRefresh last saw at the desk's index,
 *  in whatever state stands (the counts' state is the whole book), else it is the one envRefresh last put there. */
export function activeSection(): unknown {
  if (desk.active === null) return null;
  const s = closureIfLoaded()?.getState() as { sections?: { id?: unknown }[] } | undefined;
  const secs = s && Array.isArray(s.sections) ? s.sections : [];
  if (lastActive && lastActive.index === desk.active) {
    const id = (lastActive.section as { id?: unknown }).id;
    return secs.find((x) => x && x.id === id) ?? lastActive.section;
  }
  return secs[desk.active] ?? null;
}

/** 1.0's dictation recogniser, made through this (dictCtorOverride): 1.0 reads the dictation language from its state
 *  right after making one (dictStartSession: dictLangInfo), and a restart after the browser's own end of a session
 *  runs on 1.0's timer, outside envRun; the state is rebuilt from the book first. */
export function envRecognition(Real: new () => unknown): new () => unknown {
  return class EnvRecognition {
    constructor() {
      envRefresh();
      return new Real() as EnvRecognition;
    }
  } as unknown as new () => unknown;
}

/** 1.0's selectSection(id), outside a structure call: the Shell selects that section. */
export function selectById(id: string): void {
  const s = closureIfLoaded()?.getState() as { sections?: { id?: unknown }[] } | undefined;
  const i = s && Array.isArray(s.sections) ? s.sections.findIndex((x) => x.id === id) : -1;
  if (i >= 0) desk.select(i);
}

pageEnv.$ = $;
pageEnv.activeSection = activeSection;
pageEnv.setCenterTab = (tab) => desk.setCenter(tab === 'outline' ? 'outline' : 'content');
structEnv.select = selectById;
