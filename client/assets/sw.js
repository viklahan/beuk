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
const BEUK_CACHE = "beuk-shell-v21"; /* v21: two v20s met in a merge, so the shell moves on once for both: the picture-hash worker (assets/pichash.js), precached, and the 2.0 studio at /next is left alone (never cached or served here; its beuk-next-* caches survive activate). v19: the Zen paintings (assets/zen/), precached. v18: the sample's pictures moved out of index.html into assets/sample/ (precached below). v17: submission manuscript, goals that plan, Outline (cards, status, tags, filters), Story Bible */
/* ==== BEUK:sound ==== The zen ambient recordings (assets/sound/*.mp3,
   up to ~1 MB each) are NOT precached — install stays small. Each is
   kept the first time it is played, in its own cache that a shell
   version bump does not retire, so a scene that has played once plays
   offline, also after the studio updates. Only complete 200 responses
   from this origin are stored. The sound cache is cache-first, so when
   a recording is REPLACED under the same file name this name must be
   bumped: activate then deletes every older beuk-sound-v<N> (v2: new
   rain and wind, round 6). */
const BEUK_SOUND_CACHE = "beuk-sound-v2";
/* ==== /BEUK:sound ==== */
const BEUK_SHELL = [
  "../",
  "../index.html",
  "./manifest.webmanifest",
  "./logo.webp",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  /* BEUK:local — the studio's libraries, vendored so the studio
     opens, imports .docx and exports offline (byte-identical to
     the pinned CDN releases; index.html pins them with SRI). */
  "./vendor/jszip.min.js",
  "./vendor/mammoth.browser.min.js",
  "./vendor/lucide.min.js",
  "./vendor/jspdf.umd.min.js",
  /* BEUK:zencalm — the Zen paintings (about 140 KB together), so Zen is whole offline */
  "./zen/bliss.webp",
  "./zen/calm.webp",
  "./zen/mind.webp",
  "./zen/sakura.webp",
  /* BEUK:localpics — hashes pictures off the main thread for the device save */
  "./pichash.js"
];

/* ==== BEUK:slim ==== The sample story's pictures, as files (they used
   to ride inside index.html as ~10 MB of base64), kept in the shell
   cache so the sample opens with its pictures offline after one visit;
   the page reads them from this cache before the network. Exactly the
   files in assets/sample/manifest.json (tests hold the two lists
   together). Precached right AFTER this worker controls the page, not
   during install: ~8 MB in install would hold back the first visit's
   takeover (and its one reload) by seconds, and inside activate it
   would hold every fetch. The page asks (BEUK_SAMPLE_CACHE) once it is
   controlled; the message's waitUntil keeps the worker alive for it,
   each file is added on its own, a file already cached is not fetched
   again, and the page is told when they are all in
   (BEUK_SAMPLE_READY). */
function precacheSample() {
  return caches.open(BEUK_CACHE).then((cache) => Promise.all(BEUK_SAMPLE.map((u) =>
    cache.match(u).then((hit) => hit || cache.add(u)).then(() => true, () => false)
  ))).then((done) => done.every(Boolean));
}
const BEUK_SAMPLE = [
  "./sample/sample-img-cover-art.jpg",
  "./sample/sample-img-chart.jpg",
  "./sample/sample-img-prologue-left.jpg",
  "./sample/sample-img-prologue-right.jpg",
  "./sample/sample-img-ferry-left.jpg",
  "./sample/sample-img-ferry-right.jpg",
  "./sample/sample-img-gull-terrace-left.jpg",
  "./sample/sample-img-gull-terrace-right.jpg",
  "./sample/sample-img-wrong-way-left.jpg",
  "./sample/sample-img-wrong-way-right.jpg",
  "./sample/sample-img-tide-table-left.jpg",
  "./sample/sample-img-tide-table-right.jpg",
  "./sample/sample-img-ledger-left.jpg",
  "./sample/sample-img-ledger-right.jpg",
  "./sample/sample-img-beacon-east-left.jpg",
  "./sample/sample-img-beacon-east-right.jpg",
  "./sample/sample-img-keepers-letter-left.jpg",
  "./sample/sample-img-keepers-letter-right.jpg",
  "./sample/sample-img-soundings-left.jpg",
  "./sample/sample-img-soundings-right.jpg",
  "./sample/sample-img-harrow-venn-left.jpg",
  "./sample/sample-img-harrow-venn-right.jpg",
  "./sample/sample-img-ferry-berth-left.jpg",
  "./sample/sample-img-ferry-berth-right.jpg",
  "./sample/sample-img-nell-left.jpg",
  "./sample/sample-img-nell-right.jpg",
  "./sample/sample-img-council-left.jpg",
  "./sample/sample-img-council-right.jpg",
  "./sample/sample-img-portrait.jpg",
  "./sample/sample-img-channel-east-left.jpg",
  "./sample/sample-img-channel-east-right.jpg",
  "./sample/sample-img-dedication.jpg",
  "./sample/sample-img-chart-cost-left.jpg",
  "./sample/sample-img-chart-cost-right.jpg",
  "./sample/sample-img-fair-sheet-left.jpg",
  "./sample/sample-img-fair-sheet-right.jpg",
  "./sample/sample-cover.jpg"
];
/* ==== /BEUK:slim ==== */

/* ==== BEUK:fonts ==== The web fonts for offline use. They are
   self-hosted under assets/fonts/ (same origin — no font request
   ever leaves it) and NOT precached: ~6 MB across 22 families and
   their script subsets would make install heavy, and a visit uses
   only a few files. The cache-first static rule below keeps every
   file a controlled page loads; for the first visit, before this
   worker controls the page, the page posts the URLs it actually
   loaded (BEUK_CACHE_URLS) and the worker keeps them. Only URLs
   under this deploy's assets/fonts/ are accepted. Faces the studio
   never displayed online are not cached and fall back to the
   system fonts offline. */
const BEUK_FONTS_DIR = new URL("./fonts/", self.location.href).href;
/* ==== /BEUK:fonts ==== */

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
      /* BEUK:next — the 2.0 studio's own worker (scope /next/) keeps its precache in beuk-next-* caches: never ours to delete. */
      .then((keys) => Promise.all(keys.filter((k) => k !== BEUK_CACHE && k !== BEUK_SOUND_CACHE && k.indexOf("beuk-next-") !== 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: "BEUK_SHELL_READY", cache: BEUK_CACHE })))
  );
});

/* ==== BEUK:branding ==== An OLDER studio page that is still open when
   this worker activates asks caches.open(<its own, older name>) once more
   (its shell check), which re-creates that old cache EMPTY right after
   activate retired it. Seen in the v2 -> v3 browser proof. So when an
   open page pings this worker, shell caches with a LOWER version number
   than this one are retired again. Only "beuk-shell-v<N>" names with
   N below ours are touched, never a newer worker's cache, never anything
   else (the writer's book lives in IndexedDB, not in Cache Storage). */
function retireOlderShells() {
  const mine = parseInt(BEUK_CACHE.replace("beuk-shell-v", ""), 10);
  /* BEUK:sound — older sound caches too: a replaced recording must never be
     served again from a cache this worker does not use. */
  const mySound = parseInt(BEUK_SOUND_CACHE.replace("beuk-sound-v", ""), 10);
  return caches.keys().then((keys) => Promise.all(keys.filter((k) => {
    const m = /^beuk-shell-v(\d+)$/.exec(k);
    const s = /^beuk-sound-v(\d+)$/.exec(k);
    return (!!m && parseInt(m[1], 10) < mine) || (!!s && parseInt(s[1], 10) < mySound);
  }).map((k) => caches.delete(k))));
}
/* ==== /BEUK:branding ==== */

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  /* BEUK:slim — the sample's pictures, on the page's word */
  if (event.data && event.data.type === "BEUK_SAMPLE_CACHE") {
    const src = event.source;
    event.waitUntil(precacheSample().then((ok) => { if (src) src.postMessage({ type: "BEUK_SAMPLE_READY", ok: ok, cache: BEUK_CACHE }); }).catch(() => {}));
  }
  if (event.data && event.data.type === "BEUK_PING") event.waitUntil(retireOlderShells().catch(() => {}));
  if (event.data && event.data.type === "BEUK_PING" && event.source)
    event.source.postMessage({ type: "BEUK_SHELL_READY", cache: BEUK_CACHE });
  if (event.data && event.data.type === "BEUK_CACHE_URLS" && Array.isArray(event.data.urls)) {
    const urls = event.data.urls.filter((u) => {
      try { return new URL(u).href.indexOf(BEUK_FONTS_DIR) === 0; } catch (e) { return false; } /* BEUK:fonts */
    }).slice(0, 200);
    event.waitUntil(caches.open(BEUK_CACHE).then((cache) =>
      Promise.all(urls.map((u) => cache.match(u).then((hit) => hit || cache.add(new Request(u, { credentials: "same-origin" })).catch(() => null))))
    ));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Beta-reader pages (/read/<token>, their pictures and comments)
     are not the studio: never cached, and never allowed to stand in
     for the cached shell — straight to the network, untouched. */
  if (url.pathname.indexOf("/read/") === 0) return;

  /* Help, support, thanks, changelog, roadmap, privacy and terms are server-rendered
     pages, not the studio, and are not precached: their HTML, CSS and
     scripts always go straight to the network, so a restyle reaches a
     returning visitor at once instead of waiting for a shell bump.
     BEUK:next — /next is the 2.0 studio, with its own worker: this one
     never caches or serves it (not even as the offline shell). */
  if (url.origin === self.location.origin && /^\/(help|support|thanks|changelog|roadmap|privacy|terms|site|robots\.txt|sitemap\.xml|account|status|features|ramp|compare|next)(\/|$)/.test(url.pathname)) return;

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
          /* ==== BEUK:auth ==== only the studio shell itself may refresh
             the cached shell — a /reset or /help page must never be
             stored as index.html (it would replace the offline studio). */
          const shellDir = new URL("../", self.location.href).pathname;
          /* On beuk.studio the root is the landing page (Caddy marks it
             X-Beuk-Page: landing) and the studio is /studio; on a host that
             serves only the studio, the root is the studio itself. */
          const isShell = url.pathname === shellDir || url.pathname === shellDir + "index.html" || url.pathname === shellDir + "studio";
          if (res.ok && isShell && res.headers.get("X-Beuk-Page") !== "landing") {
            const copy = res.clone();
            caches.open(BEUK_CACHE).then((cache) => cache.put("../index.html", copy)).catch(() => {});
          }
          /* ==== /BEUK:auth ==== */
          return res;
        })
        .catch(() => caches.match("../index.html", { ignoreSearch: true }))
    );
    return;
  }

  /* ==== BEUK:sound ==== zen recordings: cache-first from the sound
     cache, filled on first play. */
  if (url.origin === self.location.origin && url.pathname.indexOf("/assets/sound/") !== -1 && /.mp3$/.test(url.pathname)) {
    event.respondWith(
      caches.open(BEUK_SOUND_CACHE).then((cache) => cache.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
          return res;
        });
      }))
    );
    return;
  }
  /* ==== /BEUK:sound ==== */

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
