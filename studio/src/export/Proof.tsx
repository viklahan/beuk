import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { exportRun } from './state';

/* The proof (V, 2026-11-23: "Don't we need to show a complete book from start to end before exporting"): at the top of
   the export screen, under its title, the whole book is offered before any export. An OFFER, never a gate: nothing on
   the screen waits on it, nothing is disabled by it.

   - "Read the whole book on screen" opens a dialog on the dialog stack holding, in one scrolling frame, exactly what
     1.0's buildStandaloneHtml() returns for the open book (the page "Standalone HTML" downloads), built in the export
     session (src/export/state.ts) as every export is. The string is handed to the frame as it is: not parsed, not
     tidied, not drawn again. The frame is sandboxed with nothing allowed (no script, no same-origin) and is filled from
     a blob: address, which the served Content-Security-Policy allows for frames (Caddyfile: frame-src 'self' blob:).
     A blob: address and not srcdoc, measured in Chromium under that policy: in a sandboxed srcdoc frame a note's
     in-page link loads the studio's own address into the frame; from a blob: address the same link does nothing and the
     book stays.
     Links are therefore off in this view (the dialog says so). A link that leaves the book (an outside address) would
     put the browser's blocked page in the frame: the frame's second load is that, so the book is framed again and the
     dialog says why. Never a blank frame: while the page is built the dialog says so, a book with no section in it is
     said in words, and so is an error.
   - "Turn the print pages" is 1.0's own Print Interior View: a click on 1.0's #btnOpenSpreads, nothing new. 1.0 closes
     the export screen as the view opens (openPrintInteriorView), and that is unchanged; when the view opened from here
     closes, the export screen is opened again (onBack), so the writer ends where they started. */

type Shown = { kind: 'preparing' } | { kind: 'book'; url: string } | { kind: 'empty' } | { kind: 'failed'; error: string };
type Rec = Record<string, unknown>;

/** 1.0's standalone page for the open book, in the export session; null when no section is in the book. */
function buildProof(): string | null {
  const out = exportRun((c) => {
    const sections = (c.getState() as unknown as { sections?: Rec[] }).sections ?? [];
    // 1.0's own test of what is in the book (buildStandaloneHtml filters by it): included, and not an empty page
    if (!sections.some((s) => c.api.inBook(s))) return null;
    return String(c.api.buildStandaloneHtml());
  });
  return out ?? null;
}

/** After the browser has painted what was just committed (the "preparing" line), then `fn`. */
function afterPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  const later = () => {
    timer = setTimeout(fn, 0);
  };
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(later);
  else later();
  return () => {
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
  };
}

export function ExportProof({ onBack }: { onBack: () => void }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Shown>({ kind: 'preparing' });
  // a new number is a new frame element: the book framed again after the frame went somewhere else
  const [frameNo, setFrameNo] = useState(0);
  const [linkOff, setLinkOff] = useState(false);
  const loads = useRef(0);
  const url = useRef<string | null>(null);
  const release = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };

  /** Open or close the dialog; either way it starts from "preparing" (never yesterday's frame for a moment). */
  const show = (on: boolean) => {
    setShown({ kind: 'preparing' });
    setLinkOff(false);
    setOpen(on);
  };
  useEffect(() => {
    if (!open) return;
    loads.current = 0;
    const cancel = afterPaint(() => {
      try {
        const html = buildProof();
        if (html === null) {
          setShown({ kind: 'empty' });
          return;
        }
        url.current = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        setShown({ kind: 'book', url: url.current });
      } catch (e) {
        setShown({ kind: 'failed', error: e instanceof Error && e.message ? e.message : String(e) });
      }
    });
    return () => {
      cancel();
      release();
    };
  }, [open]);

  const onLoad = () => {
    loads.current++;
    if (loads.current < 2) return; // the book itself
    // the frame loaded something else (a link in the book was followed): the book again, and the reason in words
    loads.current = 0;
    setFrameNo((n) => n + 1);
    setLinkOff(true);
  };

  /* ---- 1.0's Print Interior View, and the way back ---- */
  const watching = useRef<(() => void) | null>(null);
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => () => watching.current?.(), []);
  const printPages = useCallback(() => {
    const opener = document.getElementById('btnOpenSpreads');
    const view = document.getElementById('modalPrintView');
    const screen = document.getElementById('modalExport');
    if (!opener) return;
    watching.current?.();
    // true while the click made here is being heard: 1.0's own button, pressed by the writer later, ends the watch
    let ours = false;
    if (view) {
      let seen = false;
      const off: (() => void)[] = [];
      const stop = () => {
        off.forEach((f) => f());
        watching.current = null;
      };
      const mo = new MutationObserver(() => {
        if (view.classList.contains('open')) seen = true;
        else if (seen) {
          stop();
          back.current();
        }
      });
      mo.observe(view, { attributes: true, attributeFilter: ['class'] });
      off.push(() => mo.disconnect());
      // the view never opened and the writer went on (the export screen opened again, or 1.0's own button was
      // pressed): this watch is over, so 1.0's button stays what it was
      if (screen) {
        const so = new MutationObserver(() => {
          if (!seen && screen.classList.contains('open') && !ours) stop();
        });
        so.observe(screen, { attributes: true, attributeFilter: ['class'] });
        off.push(() => so.disconnect());
      }
      const own = () => {
        if (!ours) stop();
      };
      opener.addEventListener('click', own, true);
      off.push(() => opener.removeEventListener('click', own, true));
      watching.current = stop;
    }
    ours = true;
    try {
      opener.click();
    } finally {
      // the click's own task: 1.0's listener closes the export screen now, or once its pictures are warm
      setTimeout(() => {
        ours = false;
      }, 0);
    }
  }, []);

  return (
    <>
      <div className="exp-proof-txt">
        <h3>
          <Icon name="Eye" />
          {t('proof.h')}
        </h3>
        <p>{t('proof.sub')}</p>
      </div>
      <div className="fmt-actions">
        <button className="tb-btn" id="btnProofRead" type="button" onClick={() => show(true)}>
          <Icon name="ScrollText" />
          {t('proof.read')}
        </button>
        <button className="tb-btn" id="btnProofPrint" type="button" onClick={printPages}>
          <Icon name="BookOpen" />
          {t('proof.print')}
        </button>
      </div>
      <Dialog open={open} onClose={() => show(false)} id="modalProof" z={70} labelledBy="proofH" describedBy="proofNote" className="wide proof-modal">
        <h2>
          <Icon name="ScrollText" />
          <span id="proofH">{t('proof.title')}</span>
        </h2>
        <p className="m-sub" id="proofNote">
          {t('proof.note')}
        </p>
        {shown.kind === 'book' ? (
          <iframe key={frameNo} className="proof-frame" title={t('proof.frame')} sandbox="" referrerPolicy="no-referrer" src={shown.url} tabIndex={0} onLoad={onLoad} />
        ) : (
          <p className="proof-state" role={shown.kind === 'failed' ? 'alert' : 'status'}>
            {shown.kind === 'preparing' ? t('proof.preparing') : shown.kind === 'empty' ? t('proof.empty') : t('proof.failed', { error: shown.error })}
          </p>
        )}
        {linkOff ? (
          <p className="proof-off" role="status">
            {t('proof.linkOff')}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="tb-btn" id="btnProofClose" type="button" onClick={() => show(false)}>
            {t('exp.close')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
