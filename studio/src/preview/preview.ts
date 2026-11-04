import type * as Y from 'yjs';
import { META, SECTIONS } from '@book/editor/index.js';
import { closureIfLoaded, closureLang, closureT, cloudFacts, fmtDateIntl, previewEnv, printEnv, stateFromBook, structEnv, untitledStrings, type DeskState, type State } from '../closure/index';
import { drawIcons } from '../insights/insights';
import { activeEditor, activeEditorSectionId } from '../editor/active';
import { editorText } from '../editor/insert';
import { desk, envRun } from '../environment/page';
import { styleEnter, styleState } from '../style/session';
import { cleanBookCss, cleanFlowFragment, cleanFlowHtml } from './safe';

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

/** What happened on the desk (1.0's statsPagesRefresh): the sidebar counts its pages again. */
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
export const previewSafety = {
  droppedRules: 0,
  cleanedFlows: 0,
  sheets: 0,
  reads: 0,
  /** 1.0's page-wide listeners the preview holds now (review round 2: taken away when the pane goes). */
  get listeners(): number {
    return tracked.length;
  },
};
/* ---- 1.0's page-wide listeners (document, window, document.fonts), recorded so the pane's end takes them away ---- */
type Tracked = { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions };
const tracked: Tracked[] = [];
function trackOn(target: EventTarget): EventTarget['addEventListener'] {
  return (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) => {
    if (!fn) return;
    target.addEventListener(type, fn, opts);
    tracked.push({ target, type, fn, opts });
  };
}
function untrackAll(): void {
  for (const x of tracked.splice(0)) x.target.removeEventListener(x.type, x.fn, x.opts);
  for (const o of observers.splice(0)) o.disconnect();
}
/* ---- wave 5b, constraint 63: 1.0's re-measures that outlive the pane ----
   1.0's preview code re-measures (measurePages, fitDeviceFrame) from continuations: its timers, its frames, a
   ResizeObserver on #frameZone (initPreview, hcInit) and document.fonts.ready. Each runs only while the pane that set it
   stands (`live`): set before the pane went, or by a continuation after it went, it does nothing. The observers are
   disconnected when the pane goes. */
const observers: ResizeObserver[] = [];
/** The epoch `at` is the pane's, and the pane stands. */
const live = (at: number): boolean => at === epoch && started;
/** 1.0's ResizeObserver for the preview's code: recorded, so the pane's end disconnects it. */
const previewResizeObserver = (): typeof ResizeObserver | undefined =>
  typeof ResizeObserver === 'undefined'
    ? undefined
    : (function PreviewResizeObserver(cb: ResizeObserverCallback) {
        const at = epoch;
        const ro = new ResizeObserver((entries, o) => {
          if (live(at)) cb(entries, o);
        });
        observers.push(ro);
        return ro;
      } as unknown as typeof ResizeObserver);
/** A promise whose continuations run only while the pane that asked for them stands. */
function liveThen<T>(p: Promise<T>): Promise<T> {
  const at = epoch;
  return {
    then(ok?: ((v: T) => unknown) | null, bad?: ((e: unknown) => unknown) | null) {
      return p.then(ok ? (v: T) => (live(at) ? ok(v) : undefined) : undefined, bad ? (e: unknown) => (live(at) ? bad(e) : undefined) : undefined);
    },
    catch(bad: (e: unknown) => unknown) {
      return p.catch((e) => (live(at) ? bad(e) : undefined));
    },
    finally(f: () => void) {
      return p.finally(f);
    },
    [Symbol.toStringTag]: 'Promise',
  } as Promise<T>;
}

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
export function guardSheet(el: Element, scope: string): Element {
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
          previewSafety.sheets++;
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
    trackOn(document)(type, (e: Event) => {
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
    if (k === 'addEventListener') return trackOn(t);
    if (k === 'fonts') return t.fonts ? tracking(t.fonts) : t.fonts;
    const v = Reflect.get(t, k, t);
    return typeof v === 'function' ? v.bind(t) : v;
  },
});
/** An event target (window, document.fonts) as the preview's code reaches it: its listeners recorded. */
const trackers = new WeakMap<object, unknown>();
function tracking<T extends object>(target: T): T {
  let p = trackers.get(target) as T | undefined;
  if (!p) {
    p = new Proxy(target, {
      get(t, k) {
        if (k === 'addEventListener') return trackOn(t as unknown as EventTarget);
        // wave 5b (constraint 63): document.fonts.ready's continuation (1.0's initPreview / hcInit re-measure) runs only
        // while the pane that asked stands
        if (k === 'ready') return liveThen(Reflect.get(t, k, t) as Promise<unknown>);
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    trackers.set(target, p);
  }
  return p;
}
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
        window: tracking(window),
        // 1.0's timers in the preview's code: a callback due after the pane went (a device switch's 330 ms re-measure,
        // a frame) does nothing — its elements are gone
        // (wave 5b, constraint 63: nor one set after the pane went, by a continuation that outlived it)
        setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
          const at = epoch;
          return setTimeout(() => {
            if (live(at)) fn(...args);
          }, ms);
        },
        requestAnimationFrame: (fn: FrameRequestCallback) => {
          const at = epoch;
          return requestAnimationFrame((t) => {
            if (live(at)) fn(t);
          });
        },
        ResizeObserver: previewResizeObserver(),
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
        // wave 5b: the Print Interior View's own (print's module), when full screen changes with it open
        renderPrintView: () => printEnv.renderView(),
        statsPagesRefresh: () => deskEvents.dispatchEvent(new Event('measured')),
        noteBookEdited: () => undefined,
        autoSnapshot: () => null,
        local: { editSeq: 0 },
        cloud: cloudFacts,
        refreshImagePickers: () => undefined,
        FileReader: undefined,
      }) as unknown as PreviewClosure;
      // the open hardcover's pages: 1.0's pivSectionFlow writes printUnlink(sectionHtml(…)) into elements it creates
      // (no `$` there): its HTML goes through the same flow sink (every page, note and sideways copy derives from it)
      const unlink = pc.vars.printUnlink as (html: string) => string;
      pc.vars.printUnlink = (html: string) => {
        previewSafety.cleanedFlows++;
        return cleanFlowHtml(unlink(html));
      };
      // a sideways block in print layout (the hardcover): 1.0 lays its HTML out in a host of its own on <body> first
      // (sidewaysPrintPages: host.innerHTML) — its input is cleaned before it gets there
      const sideways = pc.vars.sidewaysPrintPages as (inner: string) => string;
      pc.vars.sidewaysPrintPages = (inner: string) => {
        previewSafety.cleanedFlows++;
        return sideways(cleanFlowHtml(inner));
      };
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
/** The sections list the preview last pointed its reader into (a patch replaces it; see pvRefresh). */
let shownList: unknown = null;
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
  previewSafety.reads++;
  const prev = pc.getState() as (State & Rec) | null;
  if (prev) Object.assign(view, { device: prev.device ?? view.device, page: prev.page ?? view.page, pageCount: prev.pageCount ?? view.pageCount });
  const st = ((desk.ydoc && styleEnter() ? styleState() : null) ?? noBookState()) as (State & Rec) | null;
  if (!st) return false;
  // a typed section read again (the Style session's patch) keeps the state object but gives the section a new one
  if (st !== prev || st.sections !== shownList) {
    if (st !== prev) {
      st.device = view.device;
      st.page = view.page;
      st.pageCount = view.pageCount;
    }
    // the same book, read again: 1.0's reader keeps its place in a section it already shows (its section objects
    // persist in 1.0; here each read of the book makes new ones)
    const v = pc.vars as { pvShownId?: unknown; pvShownSec?: unknown };
    if (shownDoc === desk.ydoc && typeof v.pvShownId === 'string') {
      const again = st.sections.find((s) => s.id === v.pvShownId);
      if (again) v.pvShownSec = again;
    }
    shownDoc = desk.ydoc;
    shownList = st.sections;
    if (st !== prev) pc.setState(st);
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
previewEnv.device = () => String(loaded?.getState()?.device ?? view.device);
previewEnv.deskSignature = () => (loaded && loaded.getState() ? String(loaded.api.deskSignature()) : '');
previewEnv.desk = () => ((loaded?.api.deskState as unknown as DeskState) ?? { counts: {}, total: 0, sig: '', words: 0, run: null });

/* ---- the pane's life ---- */
let started = false;
/** Bumped when the pane goes: 1.0's timers set before it do nothing after. */
let epoch = 0;
let uninstall: (() => void) | null = null;
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
  // the print view's measurer, where 1.0 has it (the end of <body>): the hardcover's open book lays its pages out there
  if (!document.getElementById('pivMeasure')) {
    const m = document.createElement('div');
    m.className = 'piv-measure';
    m.id = 'pivMeasure';
    m.setAttribute('aria-hidden', 'true');
    document.body.appendChild(m);
  }
}
/** A key 1.0's preview acts on from anywhere in the page (← →, F), pressed outside a field: the preview's state is
 *  read again first. A key typed in the editor or a field never is (typing stays cheap: constraint 37). */
export function pageKeyReadsBook(e: { key: string; target: EventTarget | null }): boolean {
  if (!/^(ArrowLeft|ArrowRight|f|F)$/.test(e.key)) return false;
  const tg = e.target as HTMLElement | null;
  if (!tg) return true;
  const editable = tg.isContentEditable || (typeof tg.closest === 'function' && !!tg.closest('[contenteditable=""], [contenteditable="true"]'));
  return !(editable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || ''));
}
/** Before 1.0's own listeners in the pane (and its page keys) run, its state is the book as it stands. */
/** Installs the refreshes on `pane` (capture) and the window; returns the uninstaller. */
export function installRefresh(pane: HTMLElement | null): () => void {
  const onPane = () => void pvRefresh();
  const types = ['click', 'pointerdown', 'pointerup', 'keydown'];
  for (const type of types) pane?.addEventListener(type, onPane, true);
  // 1.0's page keys (← →, F) act only outside a field; a key typed in the editor or a field reads nothing (typing
  // stays cheap: constraint 37)
  const onKey = (e: KeyboardEvent) => {
    if (pageKeyReadsBook(e)) pvRefresh();
  };
  window.addEventListener('keydown', onKey, true);
  return () => {
    for (const type of types) pane?.removeEventListener(type, onPane, true);
    window.removeEventListener('keydown', onKey, true);
  };
}
/** 1.0's init: initPreview, hcInit, fsInit on the pane's markup, then the first render. */
export function startPreview(): void {
  const pc = loaded;
  if (!pc || started || !document.getElementById('pageFlow')) return;
  ensureSheets();
  if (!pvRefresh()) return;
  epoch++; // a continuation set while no pane stood never runs on this one
  uninstall = installRefresh(document.getElementById('pane-preview'));
  pc.api.initPreview();
  pc.api.hcInit();
  pc.api.fsInit();
  started = true;
  // the reader's seam, as 1.0 publishes window.beukReader: 1.0's preview functions on the book as it stands (the e2e
  // drives 2.0 with them exactly as it drives 1.0)
  (window as unknown as { beukPreview?: unknown }).beukPreview = {
    call: (name: string, ...args: unknown[]) => pvRun((p) => p.api[name]!(...args)),
    get: (name: string) => (loaded?.api as Rec | undefined)?.[name],
    // on the preview's state as it stands, not read again (the e2e puts values past the safe path to test the sinks)
    raw: (name: string, ...args: unknown[]) => loaded?.api[name]!(...args),
    state: () => loaded?.getState() ?? null,
    safety: previewSafety,
  };
  renderNow();
}
/** The pane goes (the Shell or the pane drawn anew, the app torn down): 1.0's page-wide listeners and the
 *  refreshes are taken away, the last book is let go, and the next pane starts the preview again on its markup. */
export function stopPreview(): void {
  epoch++;
  clearTimeout(typedTimer);
  untrackAll();
  uninstall?.();
  uninstall = null;
  started = false;
  shownDoc = null;
  shownList = null;
  shownOnPhone = false;
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
  const at = epoch;
  requestAnimationFrame(() =>
    live(at) &&
    pvRun((pc) => {
      pc.api.fitDeviceFrame();
      pc.api.pvResume();
      pc.api.scheduleDeskUpdate(60);
    }),
  );
}
