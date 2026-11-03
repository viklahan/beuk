import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadClosure, type Closure } from '../closure/index';
import { translateCover } from '../cover/CoverMaker';
import { exportGuard } from '../export/ExportModal';
import markup from '../generated/print-markup.json';
import { useLocale } from '../i18n/LocaleProvider';
import { drawIcons } from '../insights/insights';
import { StackEntry } from '../shell/Dialog';
import { guardRoots } from '../style/session';
import { loadPrint, printHost, printUnwire } from './print';

/* Step 5 wave 5b (inventory F2): 1.0's print view (#modalPrint: the paginated interior in a frame, the browser's own
   print) and Print Interior View (#modalPrintView: the facing-page spreads), with the view's measurer (#pivMeasure) —
   their markup, verbatim (client/index.html, extracted at build time into src/generated/print-markup.json), in place
   for the app's life, where 1.0 has them (the end of <body>). They are there before the preview starts, because the
   preview's own fsInit (1.0's, src/preview/preview.ts) wires their full-screen buttons and watches them close, as 1.0's
   does. Nothing in them is React's: 1.0's initPrint / initPrintView wire them (src/print/print.ts printWire, run by the
   export modal once it is built), 1.0's handlers open and close them; React gives their words (1.0's setElText on
   every data-i18n) and puts each open dialog on the dialog stack (Escape closes only the top one, focus returns to the
   opener). Events on either dialog run in the export session (exportGuard), so 1.0's listeners run on print's state
   and a setting changed is written back; every HTML string 1.0 writes into them goes through the Style session's
   cleaner (guardRoots). */
export function PrintModals() {
  const { lang } = useLocale();
  const host = useRef<HTMLDivElement | null>(null);
  const backs = useRef<{ print: HTMLElement | null; view: HTMLElement | null }>({ print: null, view: null });
  const closure = useRef<Closure | null>(null);
  const [open, setOpen] = useState({ print: false, view: false });
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div');
    host.current.className = 'pr-host';
  }

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    // 1.0's own static markup (no script, no handler: the extractor checks); the measurer only when the preview has not
    // made it already (it lays the open hardcover's pages out there)
    el.innerHTML = markup.print + markup.view + (document.getElementById('pivMeasure') ? '' : markup.measure);
    document.body.appendChild(el);
    printHost.el = el;
    const print = el.querySelector<HTMLElement>('#modalPrint')!;
    const view = el.querySelector<HTMLElement>('#modalPrintView')!;
    backs.current = { print, view };
    drawIcons(el);
    const off: (() => void)[] = [];
    for (const r of [print, view]) {
      guardRoots.add(r);
      off.push(() => guardRoots.delete(r));
      off.push(exportGuard(r));
      const mo = new MutationObserver(() => setOpen({ print: print.classList.contains('open'), view: view.classList.contains('open') }));
      mo.observe(r, { attributes: true, attributeFilter: ['class'] });
      off.push(() => mo.disconnect());
    }
    let alive = true;
    void Promise.all([loadClosure(), loadPrint()])
      .then(([c]) => {
        if (!alive) return;
        closure.current = c;
        translateCover(c, el);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off.forEach((f) => f());
      backs.current = { print: null, view: null };
      if (printHost.el === el) printHost.el = null;
      printUnwire(el);
      el.innerHTML = '';
      el.remove();
    };
  }, []);

  // a language change: 1.0's words again
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    const c = closure.current, root = host.current;
    if (c && root) translateCover(c, root);
  }, [lang]);

  const box = (k: 'print' | 'view') => ({ get current() { return backs.current[k]?.querySelector<HTMLElement>('.modal') ?? null; } });
  return (
    <>
      {open.print && backs.current.print ? createPortal(<StackEntry box={box('print')} onClose={() => backs.current.print?.classList.remove('open')} />, backs.current.print) : null}
      {open.view && backs.current.view ? createPortal(<StackEntry box={box('view')} onClose={() => backs.current.view?.classList.remove('open')} />, backs.current.view) : null}
    </>
  );
}
