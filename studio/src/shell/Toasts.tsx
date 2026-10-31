import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* 1.0's toast(msg, iconName, action): a dark pill at the foot of the
   screen that fades after 3.4 s (0.3 s fade), or after action.ms (6 s by
   default) when it carries an action button. While the pointer rests on
   an action toast or focus is inside it, it waits (WCAG 2.2.1), as in
   1.0. The live region is the container (#toasts aria-live="polite"). */
export type ToastAction = { label: string; onClick: () => void; ms?: number };
type Toast = { id: number; msg: string; icon: IconName; action?: ToastAction; fading: boolean };
type ToastFn = (msg: string, icon?: IconName, action?: ToastAction) => void;

const ToastContext = createContext<ToastFn | null>(null);
export const TOAST_MS = 3400;
export const TOAST_ACTION_MS = 6000;
export const TOAST_FADE_MS = 320;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const els = useRef(new Map<number, HTMLDivElement>());
  const remove = useCallback((id: number) => setList((l) => l.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastFn>(
    (msg, icon = 'Check', action) => {
      const id = ++seq.current;
      setList((l) => [...l, { id, msg, icon, action, fading: false }]);
      const fade = () => {
        const el = els.current.get(id);
        if (action && el && (el.matches(':hover') || el.contains(document.activeElement))) {
          setTimeout(fade, 800);
          return;
        }
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
                onClick={() => {
                  x.action!.onClick();
                  remove(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast() outside <ToastProvider>');
  return v;
}
