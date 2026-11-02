import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/* 1.0's modal system (client/index.html: `.modal-back.open` dialogs, the
   document keydown that closes the top one on Escape, and cloudConfirm,
   the calm promise-based confirm), as React:

   - <Dialog> draws 1.0's markup: `div.modal-back.open#<id>` (with 1.0's
     inline z-index) around `div.modal[role=dialog][aria-modal=true]`,
     portalled to <body> like 1.0's modals (siblings of #app), so they take
     the page's direction from <html dir>, which LocaleProvider sets.
   - Escape closes ONLY the top dialog (1.0: the last open .modal-back in
     document order; here: the last one opened, which is the same thing
     for every dialog 1.0 stacks). The confirm answers "no" on Escape, as
     1.0's cloudConfirmDone(false).
   - A click on the backdrop closes, as 1.0's `e.target === back` handlers.
   - Added by the plan (1.0 has neither): focus moves into the dialog when it
     opens, Tab stays inside the top dialog, and focus returns to the
     element that opened it when it closes.

   useConfirm() is cloudConfirm: { title, body, yes, no, alt?, defaultNo? }
   → Promise<true | false | "alt">. "alt" resolves only when the caller
   offered it (BEUK:shelfguard). */

type Entry = { id: number; close: () => void; el: () => HTMLElement | null };
type Stack = { push: (e: Entry) => () => void };
const StackContext = createContext<Stack | null>(null);

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable controls inside a dialog, in tab order (hidden ones left out). */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true');
}

export function DialogStackProvider({ children }: { children: ReactNode }) {
  const stack = useRef<Entry[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = stack.current[stack.current.length - 1];
      if (!top) return;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return; // a tooltip took this Escape first (WCAG 1.4.13)
        e.preventDefault();
        top.close();
        return;
      }
      if (e.key !== 'Tab') return;
      const box = top.el();
      if (!box) return;
      const list = focusablesIn(box);
      if (!list.length) {
        e.preventDefault();
        box.focus();
        return;
      }
      const first = list[0]!, last = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !box.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const value = useMemo<Stack>(
    () => ({
      push: (e) => {
        stack.current = [...stack.current, e];
        return () => {
          stack.current = stack.current.filter((x) => x.id !== e.id);
        };
      },
    }),
    [],
  );
  return (
    <StackContext.Provider value={value}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </StackContext.Provider>
  );
}

let seq = 0;

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  /** 1.0's id of the `.modal-back` (modalSettings, modalHistory, modalConfirm, …). */
  id: string;
  /** 1.0's inline z-index of the back, where it had one (60 is the stylesheet's). */
  z?: number;
  labelledBy: string;
  /** 1.0's aria-describedby, where its dialog had one (wave 2b: #modalImgRemove). */
  describedBy?: string;
  /** 1.0's role, where it was not "dialog" (wave 2b: #modalImgRemove is an alertdialog). */
  role?: 'dialog' | 'alertdialog';
  /** Extra classes on `.modal` (1.0: "wide ins-modal", …). */
  className?: string;
  modalStyle?: CSSProperties;
  children: ReactNode;
};

export function Dialog(props: DialogProps) {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<DialogBody {...props} />, document.body);
}

/** Wave 4c: a modal whose markup 1.0's own code opens and closes (`.modal-back.open`: the cover maker) takes its place
 *  on the stack while it is open — Escape closes only the top one, Tab stays inside it, focus moves in and returns to
 *  the opener — exactly as a <Dialog>. Render it while the modal is open. */
export function StackEntry({ box, onClose }: { box: { current: HTMLElement | null }; onClose: () => void }) {
  useStackEntry(box, onClose);
  return null;
}

function useStackEntry(box: { current: HTMLElement | null }, onClose: () => void) {
  const stack = useContext(StackContext);
  if (!stack) throw new Error('<Dialog> outside <DialogStackProvider>');
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const pop = stack.push({ id: ++seq, close: () => close.current(), el: () => box.current });
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = focusablesIn(el)[0];
      try {
        (first ?? el).focus({ preventScroll: true });
      } catch {
        /* nothing focusable yet */
      }
    }
    return () => {
      pop();
      // back to the opener, unless focus has already moved on to something else outside the dialog
      const now = document.activeElement;
      const lost = !now || now === document.body || (el ? el.contains(now) || !now.isConnected : true);
      if (opener && opener.isConnected && lost) {
        try {
          opener.focus({ preventScroll: true });
        } catch {
          /* the opener went away */
        }
      }
    };
  }, [stack]);
}

function DialogBody({ onClose, id, z, labelledBy, describedBy, role = 'dialog', className, modalStyle, children }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useStackEntry(box, onClose);

  return (
    <div
      className="modal-back open"
      id={id}
      style={z === undefined ? undefined : { zIndex: z }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
    >
      <div className={'modal' + (className ? ' ' + className : '')} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1} ref={box} style={modalStyle}>
        {children}
      </div>
    </div>
  );
}

/* ---- the calm confirm (cloudConfirm) ---- */

export type ConfirmSpec = { title?: string; body?: string; yes?: string; no?: string; alt?: string; defaultNo?: boolean };
export type ConfirmResult = boolean | 'alt';
type ConfirmFn = (spec: ConfirmSpec) => Promise<ConfirmResult>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

function ConfirmProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const resolver = useRef<((v: ConfirmResult) => void) | null>(null);
  const offered = useRef(false);

  const done = useCallback((value: ConfirmResult) => {
    // BEUK:shelfguard — a two-choice caller written as `if (ok)` must never read a stray "alt" as yes
    const v = value === 'alt' && !offered.current ? false : value;
    const r = resolver.current;
    resolver.current = null;
    setSpec(null);
    if (r) r(v);
  }, []);

  const confirm = useCallback<ConfirmFn>((s) => {
    return new Promise<ConfirmResult>((resolve) => {
      // 1.0 replaces the pending resolver and leaves the earlier promise unsettled; here it answers "no" (see the report)
      const prev = resolver.current;
      resolver.current = resolve;
      offered.current = !!s.alt;
      setSpec({ ...s });
      if (prev) prev(false);
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={spec !== null} onClose={() => done(false)} id="modalConfirm" z={78} labelledBy="confirmTitle" modalStyle={{ maxWidth: 440 }}>
        {spec && <ConfirmBody spec={spec} done={done} />}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

function ConfirmBody({ spec, done }: { spec: ConfirmSpec; done: (v: ConfirmResult) => void }) {
  const no = useRef<HTMLButtonElement>(null);
  // BEUK:shelfguard — the safe choice holds the focus, so Enter keeps the writer's book
  useLayoutEffect(() => {
    if (spec.defaultNo) no.current?.focus({ preventScroll: true });
  }, [spec]);
  return (
    <>
      <h2>
        <Icon name="BookOpen" />
        <span id="confirmTitle">{spec.title || 'Are you sure?'}</span>
      </h2>
      <p className="m-sub" id="confirmBody">
        {spec.body || ''}
      </p>
      <div className={'modal-actions' + (spec.alt ? ' three' : '')}>
        <button className={'tb-btn' + (spec.defaultNo ? ' primary' : '')} id="btnConfirmNo" type="button" ref={no} onClick={() => done(false)}>
          {spec.no || 'Cancel'}
        </button>
        <button className="tb-btn" id="btnConfirmAlt" type="button" hidden={!spec.alt} onClick={() => done('alt')}>
          {spec.alt || ''}
        </button>
        <button className={'tb-btn' + (spec.defaultNo ? '' : ' primary')} id="btnConfirmYes" type="button" onClick={() => done(true)}>
          {spec.yes || 'Yes'}
        </button>
      </div>
    </>
  );
}

/** 1.0's cloudConfirm. */
export function useConfirm(): ConfirmFn {
  const v = useContext(ConfirmContext);
  if (!v) throw new Error('useConfirm() outside <DialogStackProvider>');
  return v;
}
