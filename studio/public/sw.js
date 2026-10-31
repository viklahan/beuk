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
     the network fails — so the studio opens offline.
   - The build's own files and the precached fonts: cache first.
   - Everything else: untouched.

   Updates: a new worker takes over at once (skipWaiting + claim). The
   2.0 shell has no lazy code that an old page could still ask for
   except the language packs, and those are in every build's cache.

   1.0's own worker (/sw.js, scope /) never sees /next/ pages once this
   one is installed: the browser picks the registration with the longest
   matching scope. */
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
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

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
          /* Online: make sure the precache is still whole. 1.0's worker
             deletes every cache but its own when IT updates; refill ours
             the next time the network answers. */
          event.waitUntil(ensurePrecache());
          return res;
        },
        () => caches.open(CACHE).then((cache) => cache.match(NEXT.shell)).then((hit) => hit || Response.error()),
      ),
    );
    return;
  }

  const path = url.pathname;
  if (NEXT.assets.includes(path) || NEXT.optional.includes(path)) {
    event.respondWith(
      caches.open(CACHE).then((cache) => cache.match(path).then((hit) => hit || fetch(req))),
    );
  }
});
