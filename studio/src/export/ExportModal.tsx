import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cloudIfLoaded } from '../cloud/cloud';
import { createPortal } from 'react-dom';
import { useBook } from '../book/BookProvider';
import { closureT, exportEnv, loadClosure, pageEnv, type Closure } from '../closure/index';
import { coverReady } from '../cover/cover';
import { coverOpen, translateCover } from '../cover/CoverMaker';
import markup from '../generated/export-markup.json';
import { useLocale } from '../i18n/LocaleProvider';
import { drawIcons } from '../insights/insights';
import { StackEntry } from '../shell/Dialog';
import { useToast } from '../shell/Toasts';
import { guardRoots } from '../style/session';
import { toastIcon } from '../style/StyleTab';
import { exportBegin, exportBody, exportLinger, exportReset, exportRun, exportUi, loadSerialize } from './state';
import { printWire } from '../print/print';
import { importUi, importWire } from '../import/import';

/* Step 5 wave 5a (inventory F1, F7, F8): 1.0's export modal and package inspector — their markup, verbatim
   (client/index.html #modalExport and #modalInspector, extracted at build time into src/generated/export-markup.json):
   the eleven platform presets and their detail, the package tree, the store-ready EPUB download, Inspect Package, the
   structural validator, the accessibility audit, the Markdown download and copy, the standalone HTML download.
   Nothing in it is React's: 1.0's own initExport wires it (its click on #btnExport — here the top bar's "Export book",
   exportOpen — runs 1.0's refreshExportTree and opens the modal), 1.0's handlers close it; React puts the markup in
   place, gives its words (1.0's setElText on every data-i18n), hides the sections of later waves, and puts each open
   dialog on the dialog stack (Escape closes only the top one, Tab stays inside it, focus returns to the opener).

   1.0's listeners run inside the export session (src/export/state.ts): every event on either dialog opens it before
   1.0's listener runs and the event's arrival back at the window closes it, so a handler runs on 1.0's (corrected)
   state of the open book and only a preset chosen is written. Every HTML string 1.0 writes into the dialogs goes
   through the Style session's cleaner (guardRoots). */

/** The modal's sections that belong to later waves (their buttons reach inert stand-ins): hidden. The archive (wave 7) is
 *  hidden by 1.0 itself until a shelf is linked. (Wave 5b: the print preflight and the print interior are 1.0's own now,
 *  src/print. Wave 5c: Word and the box set, the submission manuscript and the ACX script too. Wave 5d: the store-ready
 *  check, its entry where 1.0 has it.) */
export const LATER_WAVES: string[] = [];
function hideLater(root: HTMLElement): void {
  for (const id of LATER_WAVES) {
    const sec = root.querySelector('#' + id)?.closest<HTMLElement>('.fmt-sec');
    if (sec) sec.style.display = 'none';
  }
}

const EVENTS = ['click', 'change', 'input', 'keydown', 'pointerdown', 'pointerup'] as const;
/** Every event on `root` opens the export session before 1.0's listener runs; the event's arrival back at the window
 *  (or the next task) closes it, writing what changed (wave 5b: the print dialogs too, src/print/PrintModals.tsx). */
export function exportGuard(root: HTMLElement): () => void {
  const off: (() => void)[] = [];
  for (const type of EVENTS) {
    let end: (() => void) | null = null;
    const open = () => {
      end?.();
      end = exportBegin();
      const mine = end;
      setTimeout(() => {
        if (end === mine) {
          end = null;
          mine?.();
        }
      }, 0);
    };
    const close = () => {
      const e2 = end;
      end = null;
      if (!e2) return;
      e2();
      // wave 5c: what 1.0's listener continues with straight after the event (an async function's next step, before
      // anything it waits on is wrapped) still runs on the open book's state, until the next task
      exportLinger();
    };
    root.addEventListener(type, open, true);
    window.addEventListener(type, close);
    off.push(() => {
      root.removeEventListener(type, open, true);
      window.removeEventListener(type, close);
      close();
    });
  }
  return () => off.forEach((f) => f());
}

/** 1.0's vendored JSZip (client/assets/vendor/jszip.min.js, 1.0's integrity), as 1.0 links it: the browser's
 *  buildEpubBlob zips with it. */
let jszipLoad: Promise<void> | null = null;
export function loadJszip(): Promise<void> {
  if ((window as unknown as { JSZip?: unknown }).JSZip) return Promise.resolve();
  if (!jszipLoad) {
    jszipLoad = new Promise<void>((resolve) => {
      const s = document.createElement('script');
      s.src = '/assets/vendor/jszip.min.js';
      s.setAttribute('integrity', markup.jszipSri);
      s.onload = () => resolve();
      s.onerror = () => {
        jszipLoad = null; // 1.0's own check says "JSZip is still loading" where it reads window.JSZip
        resolve();
      };
      document.head.appendChild(s);
    });
  }
  return jszipLoad;
}

// wave 6: the import reads an EPUB, a zip and a .docx's parts with the same JSZip
importUi.jszip = loadJszip;

/** Whether the modal's markup is in place and wired (the top bar's opener waits for it). Announced on the window. */
let built = false;
let opener: HTMLButtonElement | null = null;
export const exportBuilt = (): boolean => built;
export const EXPORT_BUILT_EVENT = 'beuk:export';
function setBuilt(v: boolean): void {
  built = v;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EXPORT_BUILT_EVENT));
}

/** Open 1.0's export modal: 1.0's own #btnExport click (initExport), on the open book's state. Nothing before it is built. */
export function exportOpen(): void {
  if (!built || !opener) return;
  const b = opener;
  exportRun(() => b.click());
}

/** The dialogs this component puts in place (wave 5c: and 1.0's ACX script and submission manuscript dialogs; wave 5d:
 *  the store-ready check's). */
const DLGS = ['modal', 'insp', 'acx', 'ms', 'store'] as const;
type Dlg = (typeof DLGS)[number];
type Backs = Record<Dlg, HTMLElement | null>;
const NO_BACKS: Backs = { modal: null, insp: null, acx: null, ms: null, store: null };
const CLOSED: Record<Dlg, boolean> = { modal: false, insp: false, acx: false, ms: false, store: false };

export function ExportModal() {
  const { lang } = useLocale();
  const toast = useToast();
  const bk = useBook();
  const ydoc = bk.book?.ydoc ?? null;
  const host = useRef<HTMLDivElement | null>(null);
  const backs = useRef<Backs>(NO_BACKS);
  const closure = useRef<Closure | null>(null);
  const [open, setOpen] = useState<Record<Dlg, boolean>>(CLOSED);
  exportUi.toast = (msg, icon) => toast(msg, toastIcon(icon));
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div');
    host.current.className = 'ex-host';
  }

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !ydoc) return;
    document.body.appendChild(el);
    let alive = true;
    const off: (() => void)[] = [];
    void loadJszip(); // the browser's buildEpubBlob zips with it; nothing in the modal waits on it
    void Promise.all([loadClosure(), loadSerialize()])
      .then(([c]) => {
        if (!alive) return;
        // 1.0's downloadBlob and the page's fetch (held to the served policy), as the cover maker installs them
        coverReady(c);
        closure.current = c;
        // 1.0's own static markup (no script, no handler: the extractor checks), in 1.0's order: the ACX script's and the
        // submission manuscript's dialogs (wave 5c), the export modal, the store-ready check's (wave 5d), the package
        // inspector
        el.innerHTML = markup.acx + markup.ms + markup.modal + markup.store + markup.inspector;
        const modal = el.querySelector<HTMLElement>('#modalExport')!;
        const insp = el.querySelector<HTMLElement>('#modalInspector')!;
        const acx = el.querySelector<HTMLElement>('#modalAcx')!;
        const ms = el.querySelector<HTMLElement>('#modalManuscript')!;
        const store = el.querySelector<HTMLElement>('#modalStore')!;
        backs.current = { modal, insp, acx, ms, store };
        hideLater(modal);
        drawIcons(el);
        translateCover(c, el);
        const openNow = () => ({ modal: modal.classList.contains('open'), insp: insp.classList.contains('open'), acx: acx.classList.contains('open'), ms: ms.classList.contains('open'),
          store: store.classList.contains('open') });
        for (const r of [modal, insp, acx, ms, store]) {
          guardRoots.add(r);
          off.push(() => guardRoots.delete(r));
          off.push(exportGuard(r));
          const mo = new MutationObserver(() => setOpen(openNow()));
          mo.observe(r, { attributes: true, attributeFilter: ['class'] });
          off.push(() => mo.disconnect());
        }
        // 1.0's initExport, once on this markup; its #btnExport is the top bar's "Export book" (exportOpen)
        const page$ = pageEnv.$;
        const stub = document.createElement('button');
        pageEnv.$ = (id) => (id === 'btnExport' ? stub : page$(id));
        try {
          exportRun((cc) => {
            cc.vars.inspFilesCache = [];
            cc.vars.inspCurrent = '';
            cc.api.initExport();
            // wave 5c: 1.0's own msInit and acxInit (1.0 runs them at start-up, on the same page): the dialogs' buttons
            // and their bodies' listeners; #btnMsOpen and #btnAcxOpen are in the export modal
            cc.api.msInit();
            cc.api.acxInit();
            // wave 5d: 1.0's own initStoreReady (1.0 runs it at start-up): the export modal's #btnStoreReady opens the
            // check (openStoreReady), the selects, the server panel's buttons, Download report and Close; its "Open the
            // cover maker" is 2.0's opener (the maker on the Style session's state, as Project Settings opens it)
            cc.vars.openCoverMaker = () => coverOpen();
            cc.api.initStoreReady();
            // wave 7a: the sign-in dialog is 1.0's own (src/cloud): 1.0's storeAct, buildEpub and the print-ready panel close
            // the export modal and open it, as in 1.0 (5a's noOpen and 5d's stand-in, which kept both modals open, are gone)
            exportEnv.openAuth = () => cloudIfLoaded()?.api.openAuth();
            off.push(() => {
              exportEnv.openAuth = () => undefined;
            });
          });
        } finally {
          pageEnv.$ = page$;
        }
        opener = stub;
        (window as unknown as { beukExport?: unknown }).beukExport = exportSeam;
        // wave 5b: 1.0's initPrint and initPrintView on this markup (the print section) and the print dialogs
        // (src/print/print.ts); the modal is usable once they are wired
        // wave 6: 1.0's import around Add a Book (src/import/import.ts: its answers resume in the export session)
        return Promise.all([printWire(), importWire()]).then(() => {
          if (alive) setBuilt(true);
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (built) setBuilt(false);
      opener = null;
      off.forEach((f) => f());
      backs.current = NO_BACKS;
      setOpen(CLOSED);
      el.innerHTML = '';
      el.remove();
      exportReset();
    };
  }, [ydoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // a language change: 1.0's words again, and the presets 1.0 draws (their detail line and the download's label)
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    const c = closure.current, root = host.current;
    if (!c || !root || !backs.current.modal) return;
    translateCover(c, root);
    if (backs.current.modal.classList.contains('open')) exportRun((cc) => cc.api.renderPlatformPresets());
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = (k: Dlg) => ({ get current() { return backs.current[k]?.querySelector<HTMLElement>('.modal') ?? null; } });
  return (
    <>
      {DLGS.map((k) => {
        const back = backs.current[k];
        return open[k] && back ? createPortal(<StackEntry key={k} box={box(k)} onClose={() => backs.current[k]?.classList.remove('open')} />, back) : null;
      })}
    </>
  );
}

/** The test seam (e2e): 1.0's export code on the open book's (corrected) state, inside the export session. */
export const exportSeam = {
  run<T>(fn: (api: Closure['api'], c: Closure) => T): T | undefined {
    return exportRun((c) => fn(c.api, c));
  },
  /** The body 1.0's buildEpub posts for the open book (1.0's serializeBook on the export's state). */
  body: (lang: string) => exportBody(lang),
  ready: true,
};
