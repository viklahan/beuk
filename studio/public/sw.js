/* Beuk 2.0 studio — service worker, scope /next/ (hand-written, no plugin).
   The precache list comes from the build: sw-precache.js beside this file
   (written by vite.config.ts from Vite's build manifest) sets
   self.BEUK_NEXT = { cache, shell, assets, optional }. Its cache name
   carries a hash of the build, so every build gets a fresh cache and the
   old one is deleted on activate.

   Fetch rules, in order (only GETs from pages under /next/ reach here):
   - /api/ and anything cross-origin: untouched (straight to the network;
     a cached manuscript is a stale manuscript, as in 1.0's sw.js).
   - Navigations under /next/: network first, the precached shell when
     the network fails or answers a server error (5xx: the app down
     during a deploy) — so the studio opens offline and through a deploy.
   - The build's own (hashed) files: cache first.
   - 1.0's fonts and icon (same name when they change): stale-while-revalidate.
   - Everything else: untouched.

   Updates (wave 7b, H5, as 1.0's worker): a new worker WAITS. The page
   shows 1.0's update bar ("A new Beuk is ready" · Reload · Later); Reload
   posts SKIP_WAITING, the new worker takes over (claim) and deletes the
   old build's cache, and the tab that asked reloads. No page is reloaded
   by itself (src/cloud/platform.ts). The first install has nothing to
   wait for and activates at once. A page still running an OLD build after
   another tab took the update can fail to load a language pack it had not
   loaded yet (its old hashed chunk is gone); it catches that and offers a
   reload (src/shell/LangMenu.tsx). BEUK_PING is answered with the cache
   name (BEUK_SHELL_READY), which 1.0's error report names as the build.

   1.0's own worker (/sw.js, scope /) never sees /next/ pages once this
   one is installed (the longest matching scope wins), and since shell
   v20 it passes /next through and keeps beuk-next-* caches anyway. */
importScripts('./sw-precache.js');

const NEXT = self.BEUK_NEXT;
const CACHE = NEXT.cache;
const PREFIX = 'beuk-next-';

/* The build must be whole: one missing file fails it (on install, the
   old worker keeps serving). Fonts are optional, one by one. */
function precache() {
  return caches.open(CACHE).then((cache) =>
    cache.addAll([NEXT.shell, ...NEXT.assets]).then(() =>
      Promise.all(NEXT.optional.map((u) => cache.add(u).catch(() => null))),
    ),
  );
}

function ensurePrecache() {
  return caches
    .open(CACHE)
    .then((cache) => cache.match(NEXT.shell))
    .then((hit) => (hit ? null : precache()))
    .catch(() => null);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d && d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d && d.type === 'BEUK_PING' && event.source) event.source.postMessage({ type: 'BEUK_SHELL_READY', cache: CACHE });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const shellFromCache = () => caches.open(CACHE).then((cache) => cache.match(NEXT.shell));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    if (!url.pathname.startsWith('/next/')) return;
    event.respondWith(
      fetch(req).then(
        (res) => {
          /* A server error (the app container down during a deploy:
             Caddy answers 502) is no studio: the cached shell is. */
          if (res.status >= 500) return shellFromCache().then((hit) => hit || res);
          /* Online: make sure the precache is still whole (it may have
             been cleared by the browser, or by an older 1.0 worker that
             deleted every cache but its own); refill it if not. */
          event.waitUntil(ensurePrecache());
          return res;
        },
        () => shellFromCache().then((hit) => hit || Response.error()),
      ),
    );
    return;
  }

  const path = url.pathname;
  /* The build's hashed files never change under their name: cache first. */
  if (NEXT.assets.includes(path)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(path).then((hit) => hit || fetch(req))));
    return;
  }
  /* 1.0's fonts and icon keep their names when they change: answer from
     the cache at once, and refresh the copy from the network behind it
     (stale-while-revalidate). */
  if (NEXT.optional.includes(path)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(path).then((hit) => {
          const fresh = fetch(req).then((res) => {
            if (res && res.status === 200 && res.type === 'basic') return cache.put(path, res.clone()).then(() => res);
            return res;
          });
          if (hit) {
            event.waitUntil(fresh.catch(() => null));
            return hit;
          }
          return fresh;
        }),
      ),
    );
  }
});
