import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBook } from '../book/BookProvider';
import { closureT, loadClosure, pageEnv, type Closure } from '../closure/index';
import markup from '../generated/cover-markup.json';
import { useLocale } from '../i18n/LocaleProvider';
import { drawIcons } from '../insights/insights';
import { StackEntry } from '../shell/Dialog';
import { useToast } from '../shell/Toasts';
import { guardRoots, styleBegin, styleRun, styleSettle } from '../style/session';
import { toastIcon } from '../style/StyleTab';
import { coverReady, coverUi } from './cover';

/* Step 5 wave 4c (inventory D3, D4): 1.0's cover maker — its dialog's markup, verbatim (client/index.html
   #modalCoverMaker, extracted at build time into src/generated/cover-markup.json): the cover preview and its layouts,
   the words, the backgrounds (solid, gradient, texture, the writer's art, duotone, stock photos), the text elements and
   their free placement, the print wrap with its guides, the hardcover's binding, flaps and photo, the spine and back
   cover, the book on the stand, the downloads and "Use as My Cover". Nothing in it is React's: 1.0's own
   initCoverMaker wires it, 1.0's openCoverMaker opens it (its `.open` class), 1.0's own handlers close it; React only
   puts the markup in place, gives its words (1.0's setElText on every data-i18n), and puts the open dialog on the
   dialog stack (Escape closes only it, Tab stays inside it, focus returns to the opener).

   1.0's listeners run inside the Style session (src/style/session.ts), as the Style tab's do: every event on the
   dialog opens it before 1.0's listener runs and the event's arrival back at the window closes it, so a handler runs
   on 1.0's state of the open book and only what it changed is written ("Use as My Cover", a picture added). Every HTML
   string 1.0 writes into the dialog goes through the session's cleaner (guardRoots). */

const EVENTS = ['click', 'change', 'input', 'keydown', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
function guard(root: HTMLElement): () => void {
  const off: (() => void)[] = [];
  for (const type of EVENTS) {
    let end: (() => void) | null = null;
    const open = () => {
      end?.();
      end = styleBegin(type === 'input');
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
      e2?.();
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

/** 1.0's applyUiLang over the dialog: each data-i18n's words (setElText), and its placeholders, titles and labels. */
export function translateCover(c: Closure, root: ParentNode): void {
  const t = closureT();
  root.querySelectorAll('[data-i18n]').forEach((el) => c.api.setElText(el, t(el.getAttribute('data-i18n')!)));
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')!)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.getAttribute('data-i18n-title')!)));
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')!)));
}

/** The Lucide build 1.0 links (same file, same integrity): 1.0's spine icons and the icon grids read window.lucide. */
let lucideLoad: Promise<void> | null = null;
export function loadLucide(): Promise<void> {
  if ((window as unknown as { lucide?: unknown }).lucide) return Promise.resolve();
  if (!lucideLoad) {
    lucideLoad = new Promise<void>((resolve) => {
      const s = document.createElement('script');
      s.src = '/assets/vendor/lucide.min.js';
      s.integrity = markup.lucideSri;
      s.onload = () => resolve();
      s.onerror = () => resolve(); // no icons: 1.0's sbLib() is then {} and its icon grids stay empty
      document.head.appendChild(s);
    });
  }
  return lucideLoad;
}

/** Open 1.0's cover maker (Project Settings' "Make a Cover", 1.0's #btnCoverMake). */
export function coverOpen(): void {
  styleRun((c) => c.api.openCoverMaker());
}

export function CoverMaker() {
  const { lang } = useLocale();
  const toast = useToast();
  const bk = useBook();
  const ydoc = bk.book?.ydoc ?? null;
  const host = useRef<HTMLDivElement | null>(null);
  const back = useRef<HTMLElement | null>(null);
  const closure = useRef<Closure | null>(null);
  const [open, setOpen] = useState(false);
  coverUi.toast = (msg, icon) => toast(msg, toastIcon(icon));
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div');
    host.current.className = 'cm-host';
  }

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !ydoc) return;
    document.body.appendChild(el);
    let alive = true;
    let unguard: (() => void) | null = null;
    let mo: MutationObserver | null = null;
    void Promise.all([loadClosure(), loadLucide()])
      .then(([c]) => {
        if (!alive) return;
        coverReady(c);
        closure.current = c;
        el.innerHTML = markup.maker; // 1.0's own static markup (no script, no handler: the extractor checks)
        drawIcons(el);
        const b = el.querySelector<HTMLElement>('#modalCoverMaker')!;
        back.current = b;
        translateCover(c, b);
        guardRoots.add(b);
        unguard = guard(b);
        mo = new MutationObserver(() => setOpen(b.classList.contains('open')));
        mo.observe(b, { attributes: true, attributeFilter: ['class'] });
        // 1.0's initCoverMaker, once on this markup; its #btnCoverMake is Project Settings' (wired there: coverOpen)
        const page$ = pageEnv.$;
        const stub = document.createElement('button');
        pageEnv.$ = (id) => (id === 'btnCoverMake' ? stub : page$(id));
        try {
          c.vars.cmRecipe = null;
          styleRun((cc) => cc.api.initCoverMaker());
        } finally {
          pageEnv.$ = page$;
        }
        (window as unknown as { beukCover?: unknown }).beukCover = coverSeam;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      styleSettle();
      unguard?.();
      mo?.disconnect();
      if (back.current) guardRoots.delete(back.current);
      back.current = null;
      setOpen(false);
      el.innerHTML = '';
      el.remove();
      if (closure.current) closure.current.vars.cmRecipe = null;
    };
  }, [ydoc]); // eslint-disable-line react-hooks/exhaustive-deps

  // a language change: 1.0's words again, and the parts 1.0 draws from t() (its layout grid, the wrap's lines)
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    const c = closure.current, b = back.current;
    if (!c || !b) return;
    translateCover(c, b);
    if (b.classList.contains('open')) styleRun((cc) => {
      cc.api.syncMakerControls();
      cc.api.syncWrapControls();
    });
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = { get current() { return back.current?.querySelector<HTMLElement>('.modal') ?? null; } };
  return open && back.current ? createPortal(<StackEntry box={box} onClose={() => back.current?.classList.remove('open')} />, back.current) : null;
}

/** The test seam (e2e): 1.0's cover code on the open book's state, inside the Style session. */
export const coverSeam = {
  run<T>(fn: (api: Closure['api'], c: Closure) => T): T | undefined {
    return styleRun((c) => fn(c.api, c));
  },
  ready: true,
};
