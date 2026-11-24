import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useProofPages } from './entitled';
import { hardcoverUsable, openHardcover } from './hardcover';
import { keyAction, startPager, type Pager, type PagerState } from './pages';
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
     closes, the export screen is opened again (onBack), so the writer ends where they started.

   The page-by-page views (V, 2026-11-24: "shouldn't we show them the actual book on full screen, like they can flip the
   entire book"; of which book: "Both"). For an account that has them (src/export/entitled.ts: signed in, and the
   server's answer does not lock 'proof.pages'), the same two buttons open:
   - the same frame of the same string, paged from this page (src/export/pages.ts): one page at a time, turned by the
     keys, a press on the page's outer thirds, a swipe, two buttons and a slider; a counter; links inside the book turn
     to the page that holds what they name; the dialog fills the window and can go full screen. A switch in the
     dialog's bar, Pages / Scroll, gives the one long scroll back in the same frame (this session's own addition, V's to
     overturn). The dialog's paragraph gains one sentence while the book is in pages: the page numbers are this
     window's.
   - 1.0's own Hardcover view, full screen, the book open at its first spread (src/export/hardcover.ts); the button
     then reads "Flip through the printed book". Where the preview pane is not on screen, the button is the one above.
   For everyone else nothing here is different: the same words, the same frame, the same dialog, and nothing near the
   buttons speaks of plans (V's decision). */

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

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => unknown };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => unknown };
/** Whether this browser can put an element full screen (as 1.0's fsNativeOk asks). */
function fullScreenCan(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc, el = document.documentElement as FsEl;
  const enabled = d.fullscreenEnabled != null ? d.fullscreenEnabled : !!d.webkitFullscreenEnabled;
  return typeof (el.requestFullscreen || el.webkitRequestFullscreen) === 'function' && !!enabled;
}
const fullScreenEl = (): Element | null => (document as FsDoc).fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
const proofBox = (): FsEl | null => document.querySelector<FsEl>('#modalProof .modal');

export function ExportProof({ onBack, closeExport, shown: screenOpen }: { onBack: () => void; closeExport: () => void; shown: boolean }) {
  const { t, dir } = useLocale();
  // this account has the page-by-page views (the server's answer, mirrored: src/export/entitled.ts)
  const pagesOk = useProofPages();
  const [open, setOpen] = useState(false);
  // what THIS opening of the dialog is: decided as it opens, and kept while it is open
  const [paged, setPaged] = useState(false);
  const [mode, setMode] = useState<'pages' | 'scroll'>('pages');
  const [pg, setPg] = useState<PagerState | null>(null);
  const [full, setFull] = useState(false);
  const pager = useRef<Pager | null>(null);
  const frameEl = useRef<HTMLIFrameElement | null>(null);
  const live = useRef({ paged: false, mode: 'pages' as 'pages' | 'scroll' });
  live.current = { paged, mode };
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
    pager.current = null;
    setPg(null);
    if (on) {
      setPaged(pagesOk);
      setMode('pages');
    }
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

  /* ---- full screen for the paged dialog: the browser's own, on the dialog's box; F toggles it ---- */
  const toggleFull = () => {
    const box = proofBox();
    if (!box || !fullScreenCan()) return;
    try {
      const r = fullScreenEl() === box ? (document.exitFullscreen ? document.exitFullscreen() : (document as FsDoc).webkitExitFullscreen?.()) : box.requestFullscreen ? box.requestFullscreen() : box.webkitRequestFullscreen?.();
      // refused (no fresh press, a policy): the dialog fills the window as it did
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => undefined);
    } catch {
      /* as above */
    }
  };
  const fullRef = useRef(toggleFull);
  fullRef.current = toggleFull;
  useEffect(() => {
    if (!open || !paged) return;
    const sync = () => setFull(!!proofBox() && fullScreenEl() === proofBox());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      setFull(false);
    };
  }, [open, paged]);

  /* ---- the book in pages (src/export/pages.ts) ---- */
  const startPages = (f: HTMLIFrameElement) => {
    let at = 0;
    const heard = (s: PagerState) => {
      // the line laid over the page's foot (a link out of the book was stopped) has been read once the reader turns on
      if (at && s.page !== at) setNotice(null);
      at = s.page;
      setPg(s);
    };
    const p = startPager(f, heard, () => fullRef.current());
    pager.current = p;
    setPg(p ? p.state() : null);
  };
  const choose = (m: 'pages' | 'scroll') => {
    if (m === mode) return;
    setMode(m);
    if (m === 'scroll') {
      pager.current?.stop();
      pager.current = null;
      setPg(null);
    } else if (frameEl.current && loads.current >= 1) startPages(frameEl.current);
  };
  // the keys, with the focus on the dialog itself (in the book they are heard in the frame's own document)
  useEffect(() => {
    if (!open || !paged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const box = proofBox();
      const at = e.target as HTMLElement | null;
      if (!box || !at || !(at === document.body || box.contains(at))) return;
      const tag = at.tagName || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; // the slider's keys are its own
      const act = keyAction(e, pager.current?.state().rtl ?? false);
      if (!act) return;
      if (act === 'full') {
        e.preventDefault();
        if (!e.repeat) fullRef.current();
        return;
      }
      if (!pager.current) return;
      if ((tag === 'BUTTON' || tag === 'A') && (e.key === ' ' || e.key === 'Spacebar')) return; // Space presses the button
      e.preventDefault();
      pager.current.turn(act);
    };
    // Escape in full screen, where the key reaches the page at all: it leaves full screen and closes nothing (heard
    // before the dialog stack's own listener, which would close the proof)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !proofBox() || fullScreenEl() !== proofBox()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fullRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onEsc, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open, paged]);
  // the e2e's seam: where the paged book stands
  useEffect(() => {
    const w = window as unknown as { beukProof?: unknown };
    const seam = { state: () => pager.current?.state() ?? null, mode: () => (live.current.paged ? live.current.mode : null) };
    w.beukProof = seam;
    return () => {
      if (w.beukProof === seam) delete w.beukProof;
    };
  }, []);

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
      // F with the book in its one long scroll (in pages the pager hears it): full screen, for the paged dialog only
      if (live.current.paged && !pager.current && (e.key === 'f' || e.key === 'F') && !e.defaultPrevented && !e.repeat && keyAction(e, false) === 'full') {
        e.preventDefault();
        fullRef.current();
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      // full screen: the first Escape only leaves it (a browser that keeps that key to itself has done so already and
      // this never hears it); the next one closes the proof
      if (live.current.paged && proofBox() && fullScreenEl() === proofBox()) {
        fullRef.current();
        return;
      }
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
    // the page-by-page view: after the listeners above, so a link out of the book is already stopped when it hears it
    if (live.current.paged && live.current.mode === 'pages') startPages(f);
  };
  const onLoad = (e: { currentTarget: HTMLIFrameElement }) => {
    loads.current++;
    if (loads.current < 2) {
      listen(e.currentTarget); // the book itself
      return;
    }
    // the frame loaded something else (nothing above stopped it): the book again, and the reason in words
    loads.current = 0;
    pager.current = null;
    setPg(null);
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

  /* ---- 1.0's Hardcover view, full screen (src/export/hardcover.ts), and the way back ---- */
  // the button's words follow what it will do: read as the export screen opens, and when the window changes size
  const [flipOk, setFlipOk] = useState(false);
  useEffect(() => {
    const read = () => setFlipOk(pagesOk && hardcoverUsable());
    read();
    if (!pagesOk || !screenOpen) return;
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [pagesOk, screenOpen]);
  const flip = () => {
    watching.current?.();
    watching.current = null;
    const stop = openHardcover(closeExport, () => {
      watching.current = null;
      back.current();
    });
    // the preview went out of sight since the words were read: the Print Interior View, as the words then said
    if (!stop) {
      setFlipOk(false);
      printPages();
      return;
    }
    watching.current = stop;
  };

  const inPages = paged && mode === 'pages';
  const page = pg?.page ?? 1, count = pg?.count ?? 1;
  const pageOf = t('preview.pageOf', { page, count });
  const title = (
    <h2>
      <Icon name="ScrollText" />
      <span id="proofH">{t('proof.title')}</span>
    </h2>
  );
  const close = (
    <div className="modal-actions">
      <button className="tb-btn" id="btnProofClose" type="button" onClick={() => show(false)}>
        {t('exp.close')}
      </button>
    </div>
  );
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
        <button className="tb-btn" id="btnProofPrint" type="button" onClick={flipOk ? flip : printPages}>
          <Icon name="BookOpen" />
          {t(flipOk ? 'proof.flip' : 'proof.print')}
        </button>
      </div>
      <Dialog open={open} onClose={() => show(false)} id="modalProof" z={70} labelledBy="proofH" describedBy="proofNote" className={'wide proof-modal' + (paged ? ' proof-paged is-' + mode : '')}>
        {paged ? (
          <div className="proof-head">
            {title}
            <div className="proof-bar">
              <div className="proof-view" role="group" aria-label={t('proof.view')}>
                <button className={'tb-btn' + (mode === 'pages' ? ' primary' : '')} id="btnProofPages" type="button" aria-pressed={mode === 'pages'} onClick={() => choose('pages')}>
                  <Icon name="BookOpen" />
                  {t('proof.viewPages')}
                </button>
                <button className={'tb-btn' + (mode === 'scroll' ? ' primary' : '')} id="btnProofScroll" type="button" aria-pressed={mode === 'scroll'} onClick={() => choose('scroll')}>
                  <Icon name="ScrollText" />
                  {t('proof.viewScroll')}
                </button>
              </div>
              {/* where the browser has no element full screen the dialog already fills the window: no button */}
              {fullScreenCan() ? (
                <button className="tb-btn" id="btnProofFull" type="button" aria-pressed={full} aria-keyshortcuts="F" aria-label={t(full ? 'fs.exit' : 'fs.enter')} title={t(full ? 'fs.exit' : 'fs.enter') + ' (F)'} onClick={toggleFull}>
                  <Icon name={full ? 'Minimize2' : 'Maximize2'} />
                  <span className="proof-lbl">{t(full ? 'fs.exit' : 'fs.enter')}</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          title
        )}
        <p className="m-sub" id="proofNote">
          {inPages ? t('proof.note') + ' ' + t('proof.pagesNote') : t('proof.note')}
        </p>
        {shown.kind === 'book' ? (
          <>
            {/* Tab stays in the dialog: the browser itself walks the Tab order through the frame's links, so Shift+Tab
                from the frame's first link would land on whatever stands before the frame in the page (the export
                screen, under this dialog). This stop takes that step and hands it to Close, the dialog's last control.
                It is not in the dialog stack's own list (aria-hidden), so Tab from Close still goes to the frame.
                (The paged dialog has controls of its own before the frame, so the step lands on one of them: no stop.) */}
            {paged ? null : <span className="proof-guard" tabIndex={0} aria-hidden="true" onFocus={() => document.getElementById('btnProofClose')?.focus()} />}
            {paged ? (
              <div className="proof-stage">
                <iframe key={frameNo} ref={frameEl} className="proof-frame" title={t('proof.frame')} sandbox="allow-same-origin" referrerPolicy="no-referrer" src={shown.url} tabIndex={0} onLoad={onLoad} />
                {/* in pages the line is laid over the page's foot and goes with the next turn: put under the frame it
                    would make the page shorter, and the whole book would be paged again for one sentence */}
                {inPages && notice ? (
                  <p className="proof-off proof-over" role="status">
                    {t(notice === 'off' ? 'proof.linkOff' : 'proof.linkBack')}
                  </p>
                ) : null}
              </div>
            ) : (
              <iframe key={frameNo} ref={frameEl} className="proof-frame" title={t('proof.frame')} sandbox="allow-same-origin" referrerPolicy="no-referrer" src={shown.url} tabIndex={0} onLoad={onLoad} />
            )}
          </>
        ) : (
          <p className="proof-state" role={shown.kind === 'failed' ? 'alert' : 'status'}>
            {shown.kind === 'preparing' ? t('proof.preparing') : shown.kind === 'empty' ? t('proof.empty') : t('proof.failed', { error: shown.error })}
          </p>
        )}
        {notice && !inPages ? (
          <p className="proof-off" role="status">
            {t(notice === 'off' ? 'proof.linkOff' : 'proof.linkBack')}
          </p>
        ) : null}
        {paged ? (
          <div className="proof-foot">
            {inPages && shown.kind === 'book' ? (
              // in the book's own direction: in a right-to-left book the next page, and its button, are on the left
              <div className="proof-pager" dir={pg?.rtl ? 'rtl' : 'ltr'}>
                <button className="tb-btn" id="btnProofPrev" type="button" aria-disabled={page <= 1} aria-label={t('proof.prev')} title={t('proof.prev')} onClick={() => pager.current?.turn('prev')}>
                  <Icon name={pg?.rtl ? 'ChevronRight' : 'ChevronLeft'} />
                  <span className="proof-lbl">{t('proof.prev')}</span>
                </button>
                <input className="proof-slider" id="proofSlider" type="range" min={1} max={count} step={1} value={page} aria-label={t('proof.slider')} aria-valuetext={pageOf} onChange={(e) => pager.current?.go(Number(e.currentTarget.value))} />
                <span className="proof-count" id="proofCount" role="status" aria-live="polite" dir={dir}>
                  {pageOf}
                </span>
                <button className="tb-btn" id="btnProofNext" type="button" aria-disabled={page >= count} aria-label={t('proof.next')} title={t('proof.next')} onClick={() => pager.current?.turn('next')}>
                  <span className="proof-lbl">{t('proof.next')}</span>
                  <Icon name={pg?.rtl ? 'ChevronLeft' : 'ChevronRight'} />
                </button>
              </div>
            ) : null}
            {close}
          </div>
        ) : (
          close
        )}
      </Dialog>
    </>
  );
}
