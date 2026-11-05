/* The /next/ service worker (public/sw.js): production builds only, and
   only where the browser offers it (a secure context). Failure is quiet —
   the studio works online without it. Wave 7b (H5): the registration is
   handed to 1.0's update flow (src/cloud/platform.ts: wireUpdateFlow, the
   update bar); null when there is none. */
let registration: Promise<ServiceWorkerRegistration | null> | null = null;
export function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  return registration ?? Promise.resolve(null);
}
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registration = new Promise((resolve) => {
    const register = () => {
      navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL }).then(resolve, () => resolve(null));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  });
}
