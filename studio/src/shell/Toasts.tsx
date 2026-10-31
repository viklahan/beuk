import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* 1.0's toast(msg, iconName): a dark pill at the foot of the screen that
   fades after 3.4 s (0.3 s fade). The live region is the container, as
   in 1.0 (#toasts aria-live="polite"). */
type Toast = { id: number; msg: string; icon: IconName; fading: boolean };
type ToastFn = (msg: string, icon?: IconName) => void;

const ToastContext = createContext<ToastFn | null>(null);
export const TOAST_MS = 3400;
export const TOAST_FADE_MS = 320;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback<ToastFn>((msg, icon = 'Check') => {
    const id = ++seq.current;
    setList((l) => [...l, { id, msg, icon, fading: false }]);
    setTimeout(() => {
      setList((l) => l.map((x) => (x.id === id ? { ...x, fading: true } : x)));
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), TOAST_FADE_MS);
    }, TOAST_MS);
  }, []);
  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div id="toasts" aria-live="polite">
        {list.map((x) => (
          <div key={x.id} className={x.fading ? 'toast fading' : 'toast'}>
            <Icon name={x.icon} />
            <span>{x.msg}</span>
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
