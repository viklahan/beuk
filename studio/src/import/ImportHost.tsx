import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBook } from '../book/BookProvider';
import { closureIfLoaded, pageToast, type Closure } from '../closure/index';
import { useToast } from '../shell/Toasts';
import { toastIcon } from '../style/StyleTab';
import { translateCover } from '../cover/CoverMaker';
import markup from '../generated/import-markup.json';
import { useLocale } from '../i18n/LocaleProvider';
import { drawIcons } from '../insights/insights';
import { setSampleRecord, sampleSigOf } from '../sample/sample';
import { StackEntry, useConfirm } from '../shell/Dialog';
import { guardRoots } from '../style/session';
import { importBegin, importPending, importRun, importUi, importWire } from './import';

/* Step 5 wave 6 (G1, G2): 1.0's import in the studio — its markup, verbatim (client/index.html #importSummary and #irReopen
   under the Import button, #modalImportReport, #fileInput; extracted at build time into src/generated/import-markup.json),
   wired by 1.0's own initImport (its #btnImport is the sidebar's Import Document) and initImportReport. Nothing in it is
   React's: React puts the markup in place once (outside the book's generations: an import opens a new one, and the
   summary and the report stay over it), gives its words (1.0's data-i18n), puts the open report on the dialog stack,
   and runs every event on the report and the summary in an import session (src/import/import.ts). Every HTML string
   1.0 writes into them goes through the Style session's cleaner (guardRoots). */

/** 1.0's listeners on the report and the summary are all click listeners (initImport, initImportReport). */
const EVENTS = ['click'] as const;
/** Every event on `root` opens an import session before 1.0's listener runs; the event's arrival back at the window (or
 *  the next task) closes it, writing what changed. While a whole-book write is in flight (an import, Undo the whole
 *  import), the report's buttons wait: the event is held back (the book they would act on is being replaced). */
function importGuard(root: HTMLElement): () => void {
  const off: (() => void)[] = [];
  for (const type of EVENTS) {
    let end: (() => void) | null = null;
    const open = (e: Event) => {
      if (importPending()) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      end?.();
      end = importBegin();
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

let built = false;
export const IMPORT_BUILT_EVENT = 'beuk:import';
/** Whether 1.0's Import button is wired (the sidebar's button and the tour's last step wait for it). */
export const importBuilt = (): boolean => built;
function setBuilt(v: boolean): void {
  built = v;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(IMPORT_BUILT_EVENT));
}

/** The sidebar's slot (right under the Import button): 1.0's #importSummary and #irReopen go in it. */
export const IMPORT_SLOT = 'importSlot';

export function ImportHost() {
  const { lang } = useLocale();
  const bk = useBook();
  const confirm = useConfirm();
  const toast = useToast();
  // 1.0's import toasts outside any part's call (its refusals, "Imported …") reach the page's toaster — also on a device
  // with no book yet, where nothing else has set it (the cover maker sets the same toaster once a book is open)
  pageToast.fn = (msg, icon) => toast(msg, toastIcon(icon));
  const host = useRef<HTMLDivElement | null>(null);
  const back = useRef<HTMLElement | null>(null);
  const closure = useRef<Closure | null>(null);
  const [open, setOpen] = useState(false);
  const live = useRef(bk);
  live.current = bk;
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div');
    host.current.className = 'im-host';
  }
  importUi.confirm = (o) => confirm(o as never);
  importUi.replace = async (doc, from) => {
    const b = await live.current.replaceWith(doc, from);
    return b ? b.ydoc : null;
  };
  importUi.sampleArrived = (ydoc) => {
    const c = closureIfLoaded();
    let sig: string | null = null;
    try {
      sig = c ? sampleSigOf(c, ydoc) : null;
    } catch {
      sig = null; // unknown: the sample reads as edited (wave 1c's fail-safe)
    }
    setSampleRecord(ydoc, sig);
  };

  // wired once the desk has started (with a book, or none yet: an import onto the empty desk opens the first one)
  const bookOpen = bk.phase !== 'starting';
  useLayoutEffect(() => {
    const el = host.current;
    const slot = document.getElementById(IMPORT_SLOT);
    if (!el || !slot || !bookOpen) return;
    document.body.appendChild(el);
    let alive = true;
    const off: (() => void)[] = [];
    void importWire()
      .then((c) => {
        if (!alive) return;
        closure.current = c;
        // 1.0's import opens a zip and an EPUB with JSZip (1.0 loads it with the page; 5a loads it when a book opens, and
        // a device with no book yet has none open)
        void importUi.jszip();
        // 1.0's own static markup (no script, no handler: the extractor checks): the summary and the reopen button under
        // the Import button, as 1.0 has them; the report and the file input at the end of the page
        slot.innerHTML = markup.summary + markup.reopen;
        el.innerHTML = markup.report + markup.fileInput;
        const modal = el.querySelector<HTMLElement>('#modalImportReport')!;
        back.current = modal;
        drawIcons(slot);
        drawIcons(el);
        translateCover(c, slot);
        translateCover(c, el);
        for (const r of [modal, slot]) {
          guardRoots.add(r);
          off.push(() => guardRoots.delete(r));
          off.push(importGuard(r));
        }
        const mo = new MutationObserver(() => setOpen(modal.classList.contains('open')));
        mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
        off.push(() => mo.disconnect());
        // 1.0's initImport (the Import button opens #fileInput; a file chosen is handleImportFile's) and initImportReport,
        // once on this markup
        // (the desk's Y.Doc is set by EnvironmentHost's effect: until 1.0's code runs, the next task tries again)
        const init = () => {
          if (!alive) return;
          const ran = importRun((cc) => {
            cc.api.initImport();
            cc.api.initImportReport();
            return true;
          });
          if (ran) {
            setBuilt(true);
            // the test seam (e2e): is a whole-book write still in flight
            (window as unknown as { beukImport?: unknown }).beukImport = { pending: () => !!importPending(), ready: true };
          }
          else setTimeout(init, 20);
        };
        init();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (built) setBuilt(false);
      off.forEach((f) => f());
      back.current = null;
      setOpen(false);
      slot.innerHTML = '';
      el.innerHTML = '';
      el.remove();
    };
  }, [bookOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // another book on the desk (1.0's applyBookDoc): the summary is hidden, and the reopen button follows the book's own
  // report. The generation an import opened is not another book: its summary stays.
  const ydoc = bk.book?.ydoc ?? null;
  useEffect(() => {
    if (!ydoc || !closure.current) return;
    // (a whole-book write of the import in flight: the generation it opens is the import's own)
    if (importUi.ownArrival !== ydoc && !importPending()) {
      const box = document.getElementById('importSummary');
      if (box) box.style.display = 'none';
    }
    if (!importPending()) importRun((cc) => cc.api.irSyncReopen());
  }, [ydoc]);

  // a language change: 1.0's words again (irOnLangChange: the reopen button, and the report if it is open)
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    const c = closure.current;
    const slot = document.getElementById(IMPORT_SLOT);
    if (!c || !host.current || !slot) return;
    translateCover(c, slot);
    translateCover(c, host.current);
    importRun((cc) => cc.api.irOnLangChange());
  }, [lang]);

  const box = { get current() { return back.current?.querySelector<HTMLElement>('.modal') ?? null; } };
  return open && back.current ? createPortal(<StackEntry box={box} onClose={() => importRun((cc) => cc.api.irCloseReport())} />, back.current) : null;
}
