/* Beuk 1.0's root service worker (scope /), v23: it RETIRES ITSELF.

   The studio is Beuk 2.0 at /studio/ now (spec 2026-11-12-studio-2-cutover,
   D4), with its own worker (/studio/sw.js, scope /studio/, caches named
   beuk-next-*). Up to v22 this file cached 1.0's shell (beuk-shell-v22) and
   answered navigations with it when the network failed, so a browser that
   still held it could open the cached 1.0 page. A browser holding v22
   fetches these bytes on its next update check (any navigation in scope /),
   and this worker then:
   - install: skipWaiting at once (no "A new Beuk is ready" bar: there is
     nothing to wait for);
   - activate: deletes 1.0's own caches, beuk-shell-* and its sound cache
     beuk-sound-*, and nothing else (every beuk-next-* cache is 2.0's,
     already warm); claims the open pages (an open 1.0 tab reloads, after
     its device save, and lands on 2.0), then unregisters, so no worker of
     1.0's is left at the root;
   - fetch: answers nothing. Every request goes to the network, so the cached
     1.0 page is never served again.
   Messages an open 1.0 page still posts (SKIP_WAITING, BEUK_PING,
   BEUK_SAMPLE_CACHE, BEUK_CACHE_URLS) are ignored: no cache is opened or
   re-created.

   STUDIO_CLASSIC=true (the rollback, D3) serves 1.0 at /studio again; 1.0
   then registers this file, which retires itself once more, so 1.0 runs
   online only, without its offline shell (documented in the README). The
   writer's books live in IndexedDB (beuk-local, 2.0's own databases) and the
   cloud shelf, never in Cache Storage: nothing here touches them.

   client/assets/sw.js is 1.0's fallback copy (scope /assets/, registered only
   where this root copy cannot be: it controls no studio page) and is left as
   it was. */
const BEUK_CACHE = "beuk-shell-v23"; /* v23: retires itself (see above). v22: the research reader for Word documents and saved web pages (assets/rsdoc.js), precached. v21: the picture-hash worker; the 2.0 studio at /next left alone. v19: Zen paintings. v18: the sample's pictures. v17: submission manuscript, goals, Outline, Story Bible */

/** 1.0's caches: every shell version (beuk-shell-v<N>) and every sound cache (beuk-sound-v<N>). */
function isOneCache(name) {
  return /^beuk-shell-/.test(name) || /^beuk-sound-/.test(name);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(isOneCache).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
      .catch(() => self.registration.unregister())
  );
});

/* Passes everything to the network: no respondWith, ever. */
self.addEventListener("fetch", () => {});
