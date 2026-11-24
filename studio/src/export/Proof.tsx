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
     tidied, not drawn again. The frame is filled from a blob: address, which the served Content-Security-Policy allows
     for frames (Caddyfile: frame-src 'self' blob:), and not from srcdoc: measured in Chromium under that policy, in a
     sandboxed srcdoc frame a note's in-page link loads the studio's own address into the frame.

     The frame is sandbox="allow-same-origin" and nothing more (decided in the session that built it, 2026-11-24, reversing that session's
     own first brief of "no same-origin"; not a ruling of V's, and his to overturn): no script runs in it, no form is sent, no pop-up opens, the page around it is never navigated.
     The reasoning: the book is already drawn in the studio's own page, on the studio's origin, by the preview, so a
     frame of the same book that runs no script adds no exposure; and the same origin is what makes the proof usable:
     - a link inside the book (a note and its way back, the contents list: an address that is the page's own plus
       "#...") is the browser's own in-page jump and lands on its target. With no same-origin the same press did
       nothing (Chromium: "Not allowed to load local resource").
     - the page can listen inside the frame. Keys pressed and links pressed in a frame never reach the page around it;
       a listener this page puts on frame.contentDocument does hear them, though the frame runs no script (measured,
       Chromium 149). So Escape with the focus in the book closes the proof, as it does anywhere else in the dialog;
       and a link that LEAVES the book (an outside address, a file beside it, a mail address; by the left button, the
       middle one, or Enter) is stopped before the browser follows it: the reader keeps their place, the dialog says
       links out of the book are off here, and nothing is asked of the network (no blocked-frame report either).
     - what still gets through (nothing known does; a refresh written into the page would) shows as the frame's second
       load: the book is framed again from its first page and the dialog says why. Never a blank frame: while the page
       is built the dialog says so, a book with no section in it is said in words, and so is an error.
   - "Turn the print pages" is 1.0's own Print Interior View: a click on 1.0's #btnOpenSpreads, nothing new. 1.0 closes
     the export screen as the view opens (openPrintInteriorView), and that is unchanged; when the view opened from here
     closes, the export screen is opened again (onBack), so the writer ends where they started. */

type Shown = { kind: 'preparing' } | { kind: 'book'; url: string } | { kind: 'empty' } | { kind: 'failed'; error: string };
/** What the dialog says under the frame: a link out of the book was stopped ("off": the reader is where they were), or
 *  the frame left the book and it was framed again ("back": from its first page). */
type Notice = null | 'off' | 'back';
type Rec = Record<string, unknown>;
const XLINK = 'http://www.w3.org/1999/xlink';

/** Whether the link `a`, pressed in the book's document, stays in the book: it has no address, or its address is the
 *  page's own with (or without) a "#..." part. Anything else leaves: another page, a file, a mail address. */
function staysInBook(a: Element, doc: Document): boolean {
  const raw = a.getAttribute('href') ?? a.getAttributeNS(XLINK, 'href');
  if (raw === null) return true;
  if (raw.trim().startsWith('#')) return true;
  try {
    const to = new URL(raw, doc.baseURI), here = new URL(doc.URL);
    to.hash = '';
    here.hash = '';
    return to.href === here.href;
  } catch {
    return false;
  }
}

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
  const [notice, setNotice] = useState<Notice>(null);
  const loads = useRef(0);
  const url = useRef<string | null>(null);
  const release = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };

  /** Open or close the dialog; either way it starts from "preparing" (never yesterday's frame for a moment). */
  const show = (on: boolean) => {
    setShown({ kind: 'preparing' });
    setNotice(null);
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

  /** The book has arrived in `f`: this page listens in the frame's own document (see the header). */
  const listen = (f: HTMLIFrameElement) => {
    let doc: Document | null = null;
    try {
      doc = f.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) return;
    const book = doc;
    // Escape with the focus in the book: the dialog stack's own listener is on this page's document and never hears it
    book.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      show(false);
    });
    // a link that leaves the book is stopped where it is pressed; one inside the book is the browser's own jump
    const onLink = (e: Event) => {
      const at = e.target as Element | null;
      const a = at && typeof at.closest === 'function' ? at.closest('a, area') : null;
      if (!a || staysInBook(a, book)) return;
      e.preventDefault();
      setNotice('off');
    };
    book.addEventListener('click', onLink);
    book.addEventListener('auxclick', onLink);
  };
  const onLoad = (e: { currentTarget: HTMLIFrameElement }) => {
    loads.current++;
    if (loads.current < 2) {
      listen(e.currentTarget); // the book itself
      return;
    }
    // the frame loaded something else (nothing above stopped it): the book again, and the reason in words
    loads.current = 0;
    setFrameNo((n) => n + 1);
    setNotice('back');
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
          <>
            {/* Tab stays in the dialog: the browser itself walks the Tab order through the frame's links, so Shift+Tab
                from the frame's first link would land on whatever stands before the frame in the page (the export
                screen, under this dialog). This stop takes that step and hands it to Close, the dialog's last control.
                It is not in the dialog stack's own list (aria-hidden), so Tab from Close still goes to the frame. */}
            <span className="proof-guard" tabIndex={0} aria-hidden="true" onFocus={() => document.getElementById('btnProofClose')?.focus()} />
            <iframe key={frameNo} className="proof-frame" title={t('proof.frame')} sandbox="allow-same-origin" referrerPolicy="no-referrer" src={shown.url} tabIndex={0} onLoad={onLoad} />
          </>
        ) : (
          <p className="proof-state" role={shown.kind === 'failed' ? 'alert' : 'status'}>
            {shown.kind === 'preparing' ? t('proof.preparing') : shown.kind === 'empty' ? t('proof.empty') : t('proof.failed', { error: shown.error })}
          </p>
        )}
        {notice ? (
          <p className="proof-off" role="status">
            {t(notice === 'off' ? 'proof.linkOff' : 'proof.linkBack')}
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
