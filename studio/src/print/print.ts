import { closureLang, closureT, cloudFacts, coverEnv, exportEnv, fmtDateIntl, pageEnv, printEnv, untitledStrings, type State } from '../closure/index';
import { exportRun, exportStateListeners, exportUi } from '../export/state';
import { drawIcons } from '../insights/insights';
import { guardSheet } from '../preview/preview';
import { cleanPrintDoc, printFlowSink } from './safe';

/* Step 5 wave 5b (inventory F2, F9): print — 1.0's own code, lifted whole into its own module
   (src/generated/closure-print.js, scripts/extract-closure.mjs PRINT_ROOTS): the export modal's print section
   (initPrint, renderPrintControls: the trims, margins, running heads and folios, notes, large print, picture book,
   bleed and the omit toggles), the print view and its frame (openPrintView, the browser's own print: #btnDoPrint),
   Download Print HTML (buildPrintHtml, printFilename, preparePrintPress), the print-ready PDF's button and panel
   (printReadyPdf), the Print Interior View (initPrintView, buildPrintViewModel, renderPrintView: "NOT a second
   typesetter — it paginates the very same section HTML") and the print preflight (auditPrintInterior,
   runPrintPreflight, preflightJumpTo). Nothing of it is re-implemented: 1.0's code typesets and measures 2.0's DOM.

   The module's `state` is the export session's (src/export/state.ts): 1.0's applyBookDoc state of the open book,
   corrected (src/export/safe.ts) — set here each time a call enters that session (exportStateListeners). So the print
   document is built from the very state 1.0 builds it from (constraint 57), its continuations (the press bake's
   decodes, the interior view's font reload and resize) run on it, and a print setting changed is written back by the
   session (constraint 58: exportFlush). 1.0's page, as its code reaches it (`$`): the page's own elements, through the
   Style session's cleaner where 1.0 writes HTML into a dialog (pageEnv.$: the export modal and the print dialogs are
   guardRoots); the Print Interior View's stylesheet (#pivBookStyle) through the preview's CSS sink; the sections'
   HTML through the preview's flow cleaner (printUnlink, sidewaysPrintPages); and the whole print document through
   cleanPrintDoc before the frame or a file gets it (constraint 59).

   The print-ready PDF stays shelf-gated (wave 7): 1.0 makes its job from the book's shelf copy (storeMakePrintJob →
   /api/exports + /api/jobs/pdfx). 2.0 has no shelf copy before wave 7, so where 1.0 would need the shelf, the panel
   says 1.0's own words for it (store.serverNeedShelf; offline store.nc.local; signed out pr.signin) and nothing is
   uploaded: storeMakePrintJob is 2.0's, answering { needShelf: true } without a request. */

type Rec = Record<string, unknown>;
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- 1.0's untyped functions */
type Fn = (...args: any[]) => any;
export type PrintClosure = { api: Record<string, Fn> & Rec; vars: Rec & { buildPrintHtml: () => string }; setState: (s: unknown) => void; getState: () => (State & Rec) | null };

/** The print dialogs' host (src/print/PrintModals.tsx: 1.0's #modalPrint, #modalPrintView and #pivMeasure, in place
 *  for the app's life; the preview's full screen wires their buttons when it starts). */
export const printHost: { el: HTMLElement | null } = { el: null };

/* ---- 1.0's page, for print's code ---- */
/** While 1.0's initPrint / initPrintView wire a NEW export modal (another book: its markup is new): the print dialogs
 *  were wired by the first pass and keep those listeners, so their elements are handed out as throwaways now (a
 *  second listener on #btnDoPrint would print twice). */
let rewiring = false;
const throwaways = new Map<string, HTMLElement>();
export function print$(id: string): unknown {
  if (id === 'pivBookStyle') {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    return guardSheet(el, '.piv-book');
  }
  const raw = document.getElementById(id);
  if (rewiring && raw && printHost.el && printHost.el.contains(raw)) {
    let t = throwaways.get(id);
    if (!t) throwaways.set(id, (t = document.createElement(raw.tagName)));
    return t;
  }
  return pageEnv.$(id);
}
/** 1.0's window for print's code: the listeners it adds while wiring (the interior view's resize) are recorded, so a
 *  later wiring pass replaces them rather than adding more. */
type Tracked = { type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions };
let tracked: Tracked[] = [];
const printWindow: Window = new Proxy(window, {
  get(t, k) {
    if (k === 'addEventListener')
      return (type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
        t.addEventListener(type, fn, opts);
        tracked.push({ type, fn, opts });
      };
    const v = Reflect.get(t, k, t);
    return typeof v === 'function' ? v.bind(t) : v;
  },
});
/** The listeners print's code holds on the window (the tests read it). */
export const printListeners = (): number => tracked.length;

/* ---- the module ---- */
let loading: Promise<PrintClosure> | null = null;
let loaded: PrintClosure | null = null;
export const printIfLoaded = (): PrintClosure | null => loaded;
const uiLangLive = { toString: () => closureLang(), valueOf: () => closureLang() };
/** The sinks (see loadPrint); a test turns them off to see 1.0's own output. */
export const printSinks = { on: true };
/** The print-ready PDF's job: 1.0 makes it from the book's shelf copy; 2.0 has none before wave 7 (see above). */
export const printJobs = { made: 0 };

export function loadPrint(): Promise<PrintClosure> {
  if (!loading) {
    loading = import('../generated/closure-print.js').then((m) => {
      const pc = m.createPrintClosure({
        state: null,
        toast: (msg: string, icon?: string) => exportUi.toast(msg, icon),
        samplePicsRequire: async () => undefined,
        JSZip: undefined,
        t: (k: string, p?: Rec) => closureT()(k, p),
        UI_STRINGS: untitledStrings(),
        getUiLang: () => closureLang(),
        uiLangState: uiLangLive,
        fmtDateIntl,
        icons: () => drawIcons(document),
        $: print$,
        document,
        window: printWindow,
        setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => setTimeout(fn, ms, ...args),
        requestAnimationFrame: (fn: FrameRequestCallback) => requestAnimationFrame(fn),
        ResizeObserver: typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver,
        Image: globalThis.Image,
        downloadBlob: (blob: Blob, name: string) => coverEnv.downloadBlob(blob, name),
        // 2.0's sample keeps its pictures on the desk (4c: 1.0's samplePicsHold never holds here)
        samplePicsHold: () => false,
        samplePicsReady: async () => true,
        // the main closure's, in the export session: preflight's section jumps are the accessibility audit's
        a11yJumpTo: (jump: unknown) => exportRun((c) => c.api.a11yJumpTo(jump)),
        openAuth: () => exportEnv.openAuth(),
        cloud: cloudFacts,
        storeMakePrintJob: async () => {
          printJobs.made++;
          return { needShelf: true };
        },
        storeRefreshJobs: async () => true,
        cloudLoadArchive: () => undefined,
        noteBookEdited: () => undefined,
        autoSnapshot: () => null,
        local: { editSeq: 0 },
        refreshImagePickers: () => undefined,
        FileReader: undefined,
      }) as unknown as PrintClosure;
      // the sinks (constraint 59): every section's HTML (the print document's, the interior view's pages) through the
      // preview's flow cleaner; a sideways block's raw HTML before 1.0 lays it out on <body>; and the document whole
      const unlink = pc.vars.printUnlink as (html: string) => string;
      pc.vars.printUnlink = (html: string) => (printSinks.on ? printFlowSink(unlink(html)) : unlink(html));
      const sideways = pc.vars.sidewaysPrintPages as (inner: string) => string;
      pc.vars.sidewaysPrintPages = (inner: string) => sideways(printSinks.on ? printFlowSink(inner) : inner);
      const build = pc.vars.buildPrintHtml as () => string;
      pc.vars.buildPrintHtml = () => (printSinks.on ? cleanPrintDoc(build()) : build());
      loaded = pc;
      // the main closure's initExport calls these two; the preview's full screen the third
      printEnv.controls = () => void pc.api.renderPrintControls();
      printEnv.preflight = () => void pc.api.runPrintPreflight();
      printEnv.renderView = () => void pc.api.renderPrintView();
      return pc;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
// the export session's state is print's (each time a call enters it)
exportStateListeners.add((st) => loaded?.setState(st));

let wiredOnce = false;
/** 1.0's initPrint and initPrintView, on a newly built export modal (ExportModal, once per book), inside the export
 *  session: the export modal's print section is wired every time (its markup is new), the print dialogs the first
 *  time only (see print$). 1.0's own switch keeps the modal open when the print-ready PDF asks for a sign-in (2.0 has
 *  no sign-in dialog before wave 7), as buildEpub.noOpen does. */
export async function printWire(): Promise<void> {
  const pc = await loadPrint();
  if (!printHost.el || !document.getElementById('btnOpenPrintView')) return;
  for (const x of tracked.splice(0)) window.removeEventListener(x.type, x.fn, x.opts);
  rewiring = wiredOnce;
  try {
    exportRun(() => {
      pc.api.initPrint();
      pc.api.initPrintView();
      (pc.api.printReadyUi as unknown as { noOpen: boolean }).noOpen = true;
    });
  } finally {
    rewiring = false;
  }
  wiredOnce = true;
}

/** Print's code on the open book's export state (the tests and the e2e). */
export function printRun<T>(fn: (pc: PrintClosure) => T): T | undefined {
  const pc = loaded;
  if (!pc) return undefined;
  return exportRun(() => fn(pc));
}
