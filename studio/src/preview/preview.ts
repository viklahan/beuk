import type * as Y from 'yjs';
import { META, SECTIONS } from '@book/editor/index.js';
import { closureIfLoaded, closureLang, closureT, cloudFacts, fmtDateIntl, previewEnv, stateFromBook, structEnv, untitledStrings, type DeskState, type State } from '../closure/index';
import { drawIcons } from '../insights/insights';
import { activeEditor, activeEditorSectionId } from '../editor/active';
import { editorText } from '../editor/insert';
import { desk, envRun } from '../environment/page';
import { styleEnter, styleState } from '../style/session';
import { cleanBookCss, cleanFlowFragment } from './safe';

/* Step 5 wave 4b (inventory E1, E2): the preview — 1.0's own code, lifted whole into its own module
   (src/generated/closure-preview.js, scripts/extract-closure.mjs PREVIEW_ROOTS): the pane's device profiles and
   frames, the paginated page flow (measurePages, keepOrnamentsWithText, the reader's place, BEUK:reader), the reading
   desk and its page counts (BEUK:pagecount), the device truth notes, the hardcover (BEUK:hcpreview) and full screen.
   Nothing of the pagination is re-implemented: 1.0's code measures 2.0's real DOM.

   The preview module has its own `state`, which only this file sets: the open book as the Style session reads it
   (styleEnter: src/style/session.ts, the 4a safe path — the values 1.0's code takes unescaped, corrected or hidden),
   plus 1.0's session-only view fields (device, page, pageCount: never in the book, never in storage, as in 1.0) and
   the open section (activeId). 1.0's own timers in that code therefore always run on the preview's state.

   1.0's page, as its code reaches it (`$`):
   - the preview's own ids are the pane's elements (src/preview/PreviewPane.tsx: 1.0's markup);
   - the page flows (#pageFlow, #deskFlow) take HTML only through cleanFlowFragment, and the book stylesheets
     (#bookStyle, #pivBookStyle) only through cleanBookCss (src/preview/safe.ts, constraint 36);
   - #editorArea (1.0's textarea: the reader follows the caret, pvCaretAnchor) is a read-only view of the open editor;
   - the print view's dialogs (#modalPrintView, #modalPrint and their boxes: wave 5) are inert stand-ins, never open. */

type Rec = Record<string, unknown>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- 1.0's untyped functions */
type Fn = (...args: any[]) => any;
export type PreviewClosure = { api: Record<string, Fn>; vars: Rec; setState: (s: unknown) => void; getState: () => State & Rec };

/** What happened on the desk (1.0's statsPagesRefresh / insGlancePagesRefresh): the sidebar and Insights redraw. */
export const deskEvents = new EventTarget();

/** 1.0's preview view, kept across books (state.device, page, pageCount: 1.0 keeps the device over applyBookDoc). */
const view = { device: 'kindle', page: 1, pageCount: 1 };

/* ---- 1.0's page, for the preview module ---- */
const FLOWS = new Set(['pageFlow', 'deskFlow']);
const SHEETS: Record<string, string> = { bookStyle: '.fc-page', pivBookStyle: '.piv-book' };
/** The print view's dialogs (wave 5): what fsChanged / fsKeyTarget read of them, never open. */
const INERT = new Set(['modalPrintView', 'modalPrint', 'pivModalBox', 'printModalBox']);
const inert = new Map<string, HTMLElement>();
const proxies = new WeakMap<Element, Element>();
/** The CSS rules cleanBookCss dropped (0 for an honest book: the e2e reads it). */
export const previewSafety = { droppedRules: 0, cleanedFlows: 0 };

function guardFlow(el: Element): Element {
  let p = proxies.get(el);
  if (!p) {
    p = new Proxy(el, {
      get(t, k) {
        if (k === 'insertAdjacentHTML') return (pos: string, html: string) => t.insertAdjacentElement(pos as InsertPosition, wrap(cleanFlowFragment(html)));
        if (k === 'setHTMLUnsafe' || k === 'setHTML') return (html: string) => t.replaceChildren(cleanFlowFragment(html));
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (k === 'innerHTML') t.replaceChildren(cleanFlowFragment(String(v)));
        else if (k === 'outerHTML') t.replaceWith(cleanFlowFragment(String(v)));
        else Reflect.set(t, k, v, t);
        return true;
      },
    });
    proxies.set(el, p);
  }
  return p;
}
function wrap(frag: DocumentFragment): Element {
  const span = document.createElement('span');
  span.append(frag);
  return span;
}
function guardSheet(el: Element, scope: string): Element {
  let p = proxies.get(el);
  if (!p) {
    p = new Proxy(el, {
      get(t, k) {
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (k === 'textContent' || k === 'innerHTML' || k === 'innerText') {
          const r = cleanBookCss(String(v ?? ''), scope);
          previewSafety.droppedRules += r.dropped;
          t.textContent = r.css;
        } else Reflect.set(t, k, v, t);
        return true;
      },
    });
    proxies.set(el, p);
  }
  return p;
}
/** 1.0's #editorArea as the reader reads it: the open chapter's text and caret (book format), and its listeners on
 *  the editor's page. */
const editorArea = {
  get value(): string {
    const a = activeEditor();
    return a ? editorText(a.editor).text : '';
  },
  get selectionStart(): number {
    const a = activeEditor();
    return a ? editorText(a.editor).start : 0;
  },
  get selectionEnd(): number {
    const a = activeEditor();
    return a ? editorText(a.editor).end : 0;
  },
  addEventListener(type: string, fn: (e: Event) => void): void {
    document.addEventListener(type, (e) => {
      const tg = e.target as Element | null;
      if (tg && typeof tg.closest === 'function' && tg.closest('#manuscript')) fn(e);
    });
  },
  removeEventListener(): void {
    /* 1.0's preview never removes them */
  },
};
/** 1.0's `document`, as the preview's code reads it: the page's own, except that focus in the open editor reads as
 *  1.0's textarea (#editorArea). 1.0's page-turning keys (initPreview, pvInit, hcKey, fsInit) leave a key typed in
 *  the editor alone by its tag; 2.0's editor is a contenteditable page, not a TEXTAREA. */
const editorFocus = { tagName: 'TEXTAREA', nodeName: 'TEXTAREA', isContentEditable: false, closest: () => null, contains: () => false };
export const previewDocument: Document = new Proxy(document, {
  get(t, k) {
    if (k === 'activeElement') {
      const a = t.activeElement;
      return a && typeof a.closest === 'function' && a.closest('#manuscript') ? editorFocus : a;
    }
    const v = Reflect.get(t, k, t);
    return typeof v === 'function' ? v.bind(t) : v;
  },
});
export function preview$(id: string): unknown {
  if (id === 'editorArea') return editorArea;
  const el = document.getElementById(id);
  if (!el) {
    if (!INERT.has(id)) return null;
    let e = inert.get(id);
    if (!e) inert.set(id, (e = document.createElement('div')));
    return e;
  }
  if (FLOWS.has(id)) return guardFlow(el);
  if (SHEETS[id]) return guardSheet(el, SHEETS[id]!);
  return el;
}

/* ---- the module ---- */
let loading: Promise<PreviewClosure> | null = null;
let loaded: PreviewClosure | null = null;
export const previewIfLoaded = (): PreviewClosure | null => loaded;

const uiLangLive = { toString: () => closureLang(), valueOf: () => closureLang() };
const activeSection = (): unknown => {
  const st = loaded?.getState();
  return st && Array.isArray(st.sections) ? (st.sections.find((s) => s.id === st.activeId) ?? null) : null;
};

export function loadPreview(): Promise<PreviewClosure> {
  if (!loading) {
    loading = import('../generated/closure-preview.js').then((m) => {
      const pc = m.createPreviewClosure({
        state: null,
        toast: (msg: string, icon?: string, action?: { label: string; ms?: number; onClick: () => void }) => structEnv.toast(msg, icon, action),
        samplePicsRequire: async () => undefined,
        JSZip: undefined,
        t: (k: string, p?: Rec) => closureT()(k, p),
        UI_STRINGS: untitledStrings(),
        getUiLang: () => closureLang(),
        uiLangState: uiLangLive,
        fmtDateIntl,
        icons: () => drawIcons(document),
        $: preview$,
        document: previewDocument,
        activeSection,
        // 1.0's deskGoToSection set state.activeId: the studio opens that section (its editor follows)
        renderSidebar: () => undefined,
        syncEditor: () => {
          const st = loaded?.getState();
          if (!st || typeof st.activeId !== 'string') return;
          const i = st.sections.findIndex((s) => s.id === st.activeId);
          if (i >= 0 && i !== desk.active) desk.select(i);
        },
        raStop: () => envRun((c) => (c.api as unknown as { raStop?: () => void }).raStop?.()),
        dictDiscard: () => envRun((c) => (c.api as unknown as { dictDiscard?: () => void }).dictDiscard?.()),
        renderPrintView: () => undefined,
        statsPagesRefresh: () => deskEvents.dispatchEvent(new Event('measured')),
        insGlancePagesRefresh: () => deskEvents.dispatchEvent(new Event('measured')),
        noteBookEdited: () => undefined,
        autoSnapshot: () => null,
        local: { editSeq: 0 },
        cloud: cloudFacts,
        refreshImagePickers: () => undefined,
        FileReader: undefined,
      }) as unknown as PreviewClosure;
      loaded = pc;
      return pc;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/* ---- the preview's state ---- */
let shownDoc: Y.Doc | null = null;
/** 1.0 always holds a book (an empty desk at least): the preview's state with no book open is 1.0's blank book. */
let emptyState: State | null = null;
function noBookState(): State | null {
  const c = closureIfLoaded();
  if (!c) return null;
  emptyState ??= stateFromBook(c, c.api.buildEmptyBook());
  return emptyState;
}
/** The preview module's state, current: the Style session's state of the open book, with 1.0's view fields and the
 *  open section. False without a book, a closure or the preview module. */
export function pvRefresh(): boolean {
  const pc = loaded;
  if (!pc) return false;
  const prev = pc.getState() as (State & Rec) | null;
  if (prev) Object.assign(view, { device: prev.device ?? view.device, page: prev.page ?? view.page, pageCount: prev.pageCount ?? view.pageCount });
  const st = ((desk.ydoc && styleEnter() ? styleState() : null) ?? noBookState()) as (State & Rec) | null;
  if (!st) return false;
  if (st !== prev) {
    st.device = view.device;
    st.page = view.page;
    st.pageCount = view.pageCount;
    // the same book, read again: 1.0's reader keeps its place in a section it already shows (its section objects
    // persist in 1.0; here each read of the book makes new ones)
    const v = pc.vars as { pvShownId?: unknown; pvShownSec?: unknown };
    if (shownDoc === desk.ydoc && typeof v.pvShownId === 'string') {
      const again = st.sections.find((s) => s.id === v.pvShownId);
      if (again) v.pvShownSec = again;
    }
    shownDoc = desk.ydoc;
    pc.setState(st);
  }
  const sec = desk.active === null ? undefined : st.sections[desk.active];
  st.activeId = sec ? sec.id : null;
  pc.vars.editorSyncedSectionId = activeEditorSectionId();
  return true;
}
/** Run 1.0's preview code on the preview's current state. */
export function pvRun<T>(fn: (pc: PreviewClosure) => T): T | undefined {
  if (!pvRefresh()) return undefined;
  return fn(loaded!);
}

/* ---- the main closure's view of the preview (its renderPreview, deskState, deskSignature) ---- */
let renderQueued = false;
/** 1.0's renderPreview, asked for by 1.0's code elsewhere (the Style tab): drawn once the call that asked has written
 *  its change (a microtask later). */
export function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    if (previewMounted()) renderNow();
  });
}
const mounted = { on: false };
export const previewMounted = (): boolean => mounted.on && !!document.getElementById('pageFlow');
export function setPreviewMounted(on: boolean): void {
  mounted.on = on;
}
previewEnv.render = requestRender;
previewEnv.deskSignature = () => (loaded && loaded.getState() ? String(loaded.api.deskSignature()) : '');
previewEnv.desk = () => ((loaded?.api.deskState as unknown as DeskState) ?? { counts: {}, total: 0, sig: '', words: 0, run: null });

/* ---- the pane's life ---- */
let started = false;
export const previewStarted = (): boolean => started;
/** The two book stylesheets 1.0 creates in the head on first use, made here first (so 1.0's code reaches them only
 *  through the sink, preview$). */
function ensureSheets(): void {
  for (const id of Object.keys(SHEETS)) {
    if (document.getElementById(id)) continue;
    const el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
}
/** Before 1.0's own listeners in the pane (and its page keys) run, its state is the book as it stands. */
function installRefresh(): void {
  const pane = document.getElementById('pane-preview');
  for (const type of ['click', 'pointerdown', 'pointerup', 'keydown']) pane?.addEventListener(type, () => void pvRefresh(), true);
  window.addEventListener(
    'keydown',
    (e) => {
      if (/^(ArrowLeft|ArrowRight|f|F|Escape|Enter| )$/.test(e.key)) pvRefresh();
    },
    true,
  );
}
/** 1.0's init: initPreview, hcInit, fsInit on the pane's markup, then the first render. */
export function startPreview(): void {
  const pc = loaded;
  if (!pc || started || !document.getElementById('pageFlow')) return;
  ensureSheets();
  if (!pvRefresh()) return;
  installRefresh();
  pc.api.initPreview();
  pc.api.hcInit();
  pc.api.fsInit();
  started = true;
  renderNow();
}
/** 1.0's renderPreview now, on the book as it stands. With no book open, the page is empty (1.0's empty desk). */
export function renderNow(): void {
  if (!started) return;
  clearTimeout(typedTimer);
  pvRun((pc) => {
    if (!activeSection()) {
      for (const id of ['pageFlow', 'rhBook', 'rhChapter', 'previewSectionName']) document.getElementById(id)?.replaceChildren();
      pc.api.scheduleDeskUpdate(60);
      return;
    }
    pc.api.renderPreview();
    pc.api.syncFsButtons();
  });
}
/* 1.0's own timer for the preview after typing: queuePreview, 120 ms after the last keystroke; every other change
   (a style, a structure edit, a setting) draws at once, as 1.0's handlers call renderPreview. 1.0's queuePreview is
   not used as it is: its timer would draw the state of the moment it was set, so 2.0 keeps the same 120 ms and reads
   the book when it fires. */
export const PREVIEW_TYPING_MS = 120;
let typedTimer: ReturnType<typeof setTimeout> | undefined;
/** Watch the open book: a keystroke queues the preview (and marks 1.0's editorTypedAt, which the desk's measuring
 *  yields to), anything else draws at once. Returns the unwatcher. */
export function queueTyped(ydoc: Y.Doc): () => void {
  const meta = ydoc.getMap(META) as unknown as never;
  const secs = ydoc.getArray(SECTIONS) as unknown as never;
  const on = (tr: Y.Transaction) => {
    if (!started || !tr.changed.size) return;
    if (tr.changed.has(meta) || tr.changed.has(secs)) {
      requestRender();
      return;
    }
    if (loaded) loaded.vars.editorTypedAt = performance.now();
    clearTimeout(typedTimer);
    typedTimer = setTimeout(renderNow, PREVIEW_TYPING_MS);
  };
  ydoc.on('afterTransaction', on);
  return () => {
    ydoc.off('afterTransaction', on);
    clearTimeout(typedTimer);
  };
}
let shownOnPhone = false;
/** 1.0's setMobilePane for the preview: leaving keeps the page being read; coming back makes the owed turn. */
export function pvMobile(on: boolean): void {
  if (!started || on === shownOnPhone) return;
  shownOnPhone = on;
  if (!on) {
    pvRun((pc) => pc.api.pvLeaving());
    return;
  }
  requestAnimationFrame(() =>
    pvRun((pc) => {
      pc.api.fitDeviceFrame();
      pc.api.pvResume();
      pc.api.scheduleDeskUpdate(60);
    }),
  );
}
