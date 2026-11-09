import { useEffect, useState } from 'react';
import { StackEntry } from './Dialog';

/* A `.modal-back` that 1.0's own code puts on <body> — made on first use or afresh for each opening, opened with its
   "open" class, closed by removing the class or the element — takes its place on the dialog stack while it is open, as
   the export modal's dialogs do: Tab stays inside it, Escape closes only the top one (the stack's close is the dialog's
   own close button: closed, and emptied where 1.0 empties it), focus returns to the opener. Users: the print-ready PDF's
   lock (#modalLockPdf, ExportModal), the locked backup's password and the authorship record (#modalBackupPw,
   #modalAuthorship, LocalPill). `opener` names where focus returns when 1.0's code has already moved focus inside the
   dialog as it opened. */
const backKeys = new WeakMap<HTMLElement, number>();
let backSeq = 0;

export function BodyModalStack({ id, closeSel, opener }: { id: string; closeSel: string; opener?: () => HTMLElement | null }) {
  const [back, setBack] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let watched: HTMLElement | null = null;
    let mo: MutationObserver | null = null;
    const sync = () => {
      const el = document.getElementById(id);
      if (el !== watched) {
        mo?.disconnect();
        mo = null;
        watched = el;
        // a new element (1.0 makes the password dialog afresh for each ask) is a new stack entry
        if (el && !backKeys.has(el)) backKeys.set(el, ++backSeq);
        setBack(el);
        if (el) {
          mo = new MutationObserver(() => setOpen(el.classList.contains('open')));
          mo.observe(el, { attributes: true, attributeFilter: ['class'] });
        }
      }
      setOpen(!!el && el.classList.contains('open'));
    };
    const body = new MutationObserver(sync);
    body.observe(document.body, { childList: true });
    sync();
    return () => {
      body.disconnect();
      mo?.disconnect();
    };
  }, [id]);
  if (!open || !back || !back.isConnected) return null;
  return (
    <StackEntry
      key={backKeys.get(back)}
      box={{
        get current() {
          return back.querySelector<HTMLElement>('.modal');
        },
      }}
      onClose={() => back.querySelector<HTMLElement>(closeSel)?.click()}
      opener={opener}
    />
  );
}
