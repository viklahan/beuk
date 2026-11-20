/* The studio's service worker (public/sw.js, at the build's base: /studio/sw.js): production builds only, and
   only where the browser offers it (a secure context). Failure is quiet —
   the studio works online without it. Wave 7b (H5): the registration is
   handed to 1.0's update flow (src/cloud/platform.ts: wireUpdateFlow, the
   update bar); null when there is none.
   Its scope is the base WITHOUT its trailing slash (/studio): the app answers 2.0's page at /studio and at /studio/
   (final review C2 + I1; src/routes/studio.ts), and every 1.0 bookmark, link and installed shortcut names /studio,
   so the worker must cover both, offline too. A scope wider than the script's folder needs the app's
   Service-Worker-Allowed: /studio header on /studio/sw.js. The scope also matches any path that merely starts with
   /studio (/studiofoo): nothing else lives there, and the worker leaves those alone (public/sw.js). */
export const SW_SCOPE = import.meta.env.BASE_URL.replace(/\/$/, '');
let registration: Promise<ServiceWorkerRegistration | null> | null = null;
export function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  return registration ?? Promise.resolve(null);
}
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registration = new Promise((resolve) => {
    const register = () => {
      navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: SW_SCOPE }).then(resolve, () => resolve(null));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  });
}
