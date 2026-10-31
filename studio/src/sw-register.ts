/* The /next/ service worker (public/sw.js): production builds only, and
   only where the browser offers it (a secure context). Failure is quiet —
   the studio works online without it. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL }).catch(() => undefined);
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
