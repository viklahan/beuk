/* Beuk service worker — the app shell, cached so the studio opens
   instantly and opens OFFLINE. The cache is versioned: bump
   BEUK_CACHE and the old shell is retired on activate. A waiting
   worker never swaps in silently — the studio shows a calm
   "A new Beuk is ready" notice and reloads only when the writer
   asks (the page posts SKIP_WAITING).

   This copy lives under assets/ because the artifact hosting
   serves only index.html + assets/; its twin at the app root
   (../sw.js) is the same worker for deploys that serve the whole
   studio directory, where its scope covers the page itself. The
   studio registers the root copy first and falls back to this
   one. Paths below are relative to THIS file's location.

   Fetch rules, in order:
   - Anything under /api/ (the shelf) is NETWORK-FIRST and never
     cached: a cached manuscript is a stale manuscript. Offline,
     the request fails exactly as it would without a worker, and
     the studio's own local-first machinery takes over.
   - Navigations are network-first, falling back to the cached
     shell so the studio opens on the local book with no network.
   - Everything else (the shell's assets, the CDN libraries, the
     fonts) is cache-first, filled from the network on first use. */
const BEUK_CACHE = "beuk-shell-v1";
const BEUK_SHELL = [
  "../",
  "../index.html",
  "./manifest.webmanifest",
  "./logo.webp",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(BEUK_CACHE).then((cache) =>
      /* Per-file adds, not addAll: one missing optional file must
         never keep the whole shell from caching. */
      Promise.all(BEUK_SHELL.map((u) => cache.add(u).catch(() => null)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== BEUK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: "BEUK_SHELL_READY", cache: BEUK_CACHE })))
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "BEUK_PING" && event.source)
    event.source.postMessage({ type: "BEUK_SHELL_READY", cache: BEUK_CACHE });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* The shelf and its API: network-first, never cached. On failure
     the rejection propagates untouched — the page already knows how
     to be offline. */
  if (url.pathname.indexOf("/api/") !== -1) {
    event.respondWith(fetch(req));
    return;
  }

  /* Navigations: fresh page when the network answers, the cached
     shell when it doesn't. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(BEUK_CACHE).then((cache) => cache.put("../index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("../index.html", { ignoreSearch: true }))
    );
    return;
  }

  /* Static assets and cross-origin libraries/fonts: cache-first. */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(BEUK_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
