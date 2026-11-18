# Task 12 report: the /aris page

## Implemented
- src/routes/aris-page.ts: arisPageRoutes(db, config). GET /aris (+ /aris/) = chrome() around renderMarkdown(loadPersona().page) + controls section. GET /aris/aris.js and /aris/aris.css. All fall through (next()) to the site 404 when !config.arisEnabled.
- client/aris/aris.js (vanilla IIFE): GET /api/aris/status; 200 => opt-in checkbox, Laconic/Homeric radios, key list (provider + last4 + Delete), add-key form (provider select, password field, base URL shown only for openai-compat, show-last4 on save). Non-200 (401 signed out) => quiet line with /account link stays. Errors show common() 0/429/401 words, else the API's own `error`.
- client/aris/aris.css: small control styles.
- Registries: Caddyfile `handle /aris*`; sitemap in site.ts; both sw.js regexes; app.ts mount after warmthRoutes (after /api catch-all).

## Deviations (deliberate, with reasons)
1. Script path: mirrored the account page exactly (app-served client/aris/aris.js at /aris/aris.js, Caddy `/aris*`), not client/assets/aris-page.js from the brief, per the task's "mirror exactly" rule.
2. Sitemap: '/aris' is added only when config.arisEnabled (the /support pattern), so a disabled deployment never lists a 404.
3. Ledger (l10n-english-only.json): NOT edited. The scan only lists files containing `<!doctype html`; aris-page.ts reuses chrome() and has none, and adding an entry fails the "stale ledger entry" assertion. localization.test.ts is green without it.

## TDD
RED: sitemap assertion failed (no /aris) before wiring (the route/page tests failed with 404 as the module did not exist yet). GREEN after implementation.

## Tests
aris-page (3) + localization + site-pages: 28 pass, 0 fail. tsc --noEmit clean. Full suite not run (per brief).

## Self-review
404 when off (page, js, css); signed-out = quiet line only; no persona text in the route; no new deps.
Concern: no browser-run of aris.js (only served + string-checked); first manual check on rocket recommended.
