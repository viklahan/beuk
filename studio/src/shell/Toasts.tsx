import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* 1.0's toast(msg, iconName, action): a dark pill at the foot of the
   screen that fades after 3.4 s (0.3 s fade), or after action.ms (6 s by
   default) when it carries an action button. While the pointer rests on
   an action toast or focus is inside it, it waits (WCAG 2.2.1), as in
   1.0. The live region is the container (#toasts aria-live="polite").
   Wave 1b (1.0's chopRun toasts): an action may ask for focus on its button
   (a keyboard pick), hand focus on when the toast leaves holding it
   (onGone), and carry a tag so a later event can take it down
   (useDismissToasts: 1.0's chopBookArrived removes the Undo toasts). */
export type ToastAction = { label: string; onClick: () => void; ms?: number; focus?: boolean; onGone?: () => void; tag?: string };
type Toast = { id: number; msg: string; icon: IconName; action?: ToastAction; fading: boolean };
type ToastFn = (msg: string, icon?: IconName, action?: ToastAction) => void;

const ToastContext = createContext<ToastFn | null>(null);
const DismissContext = createContext<((tag: string) => void) | null>(null);
export const TOAST_MS = 3400;
export const TOAST_ACTION_MS = 6000;
export const TOAST_FADE_MS = 320;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const els = useRef(new Map<number, HTMLDivElement>());
  const tags = useRef(new Map<number, string>());
  const gone = useRef(new Map<number, () => void>());
  const remove = useCallback((id: number) => {
    const el = els.current.get(id);
    const had = !!el && el.contains(document.activeElement);
    const cb = gone.current.get(id);
    tags.current.delete(id);
    gone.current.delete(id);
    setList((l) => l.filter((x) => x.id !== id));
    if (had && cb) queueMicrotask(cb);
  }, []);
  const dismiss = useCallback((tag: string) => {
    for (const [id, tg] of [...tags.current]) if (tg === tag) remove(id);
  }, [remove]);
  const toast = useCallback<ToastFn>(
    (msg, icon = 'Check', action) => {
      const id = ++seq.current;
      if (action?.tag) tags.current.set(id, action.tag);
      if (action?.onGone) gone.current.set(id, action.onGone);
      setList((l) => [...l, { id, msg, icon, action, fading: false }]);
      const fade = () => {
        const el = els.current.get(id);
        if (action && el && (el.matches(':hover') || el.contains(document.activeElement))) {
          setTimeout(fade, 800);
          return;
        }
        if (!els.current.has(id)) return; // already gone (its action ran, or it was dismissed)
        setList((l) => l.map((x) => (x.id === id ? { ...x, fading: true } : x)));
        setTimeout(() => remove(id), TOAST_FADE_MS);
      };
      setTimeout(fade, action ? (action.ms ?? TOAST_ACTION_MS) : TOAST_MS);
    },
    [remove],
  );
  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      <DismissContext.Provider value={dismiss}>
      {children}
      <div id="toasts" aria-live="polite">
        {list.map((x) => (
          <div
            key={x.id}
            className={x.fading ? 'toast fading' : 'toast'}
            ref={(el) => {
              if (el) els.current.set(x.id, el);
              else els.current.delete(x.id);
            }}
          >
            <Icon name={x.icon} />
            <span>{x.msg}</span>
            {x.action && (
              <button
                type="button"
                className="toast-action"
                ref={(b) => {
                  if (b && x.action!.focus && !b.dataset.focused) {
                    b.dataset.focused = '1';
                    b.focus();
                  }
                }}
                onClick={() => {
                  remove(x.id); // reads "focus was inside" before the toast goes, so onGone hands focus on
                  x.action!.onClick();
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      </DismissContext.Provider>
    </ToastContext.Provider>
  );
}

/** Take down every toast carrying `tag`. */
export function useDismissToasts(): (tag: string) => void {
  const v = useContext(DismissContext);
  if (!v) throw new Error('useDismissToasts() outside <ToastProvider>');
  return v;
}

export function useToast(): ToastFn {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast() outside <ToastProvider>');
  return v;
}
