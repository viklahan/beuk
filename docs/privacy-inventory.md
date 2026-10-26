# Privacy inventory — what Beuk actually stores and sends

Drafted from the code on 2026-10-25 (branch feat/legal-r6, from main
d2bcc11). This is the evidence the public /privacy and /terms pages
(content/legal/) were written from. Every row cites the file and line
that does it. **Not legal advice.** Have a lawyer review it, and update
it in the same commit as any change to what is stored.

Where this file says "no limit", the code really has no deletion rule.
That is a fact about the code, not a policy decision.

## 1. Server: database (Postgres)

| Data | What is stored | Evidence | How long |
|---|---|---|---|
| Account | email (trimmed, lower-cased), password **hash**, created_at | migrations/001_users_sessions.sql:2-7; src/routes/auth.ts:40,51-53 | Until the account is deleted. **No self-serve account deletion exists** (no DELETE route in src/routes/auth.ts or account.ts; route list: `grep -n "router\.\(get\|post\|put\|delete\)" src/routes/*.ts`). |
| Password hash | argon2id, the library's default parameters. The password itself is never stored. | src/password.ts:4-7 | Replaced when the password changes (src/routes/account.ts:212) |
| Plan / billing link | users.plan (display label, default 'free'), plan_updated_at, stripe_customer_id | migrations/005_user_billing.sql:5-8 | With the account |
| Admin flag | users.is_admin | migrations/006_housekeeping.sql:4 | With the account |
| Sessions | user_id, **SHA-256 hash** of the session token, created_at, expires_at. No IP, no user agent. | migrations/001_users_sessions.sql:9-15; src/auth.ts:35-46 | SESSION_TTL_DAYS (default 30, src/config.ts `sessionTtlDays`); expired rows are purged at boot and every SESSION_PURGE_INTERVAL_MS (default 1 h): src/index.ts:78-88, src/auth.ts:73. Sign-out deletes the row (src/auth.ts:65); "sign out everywhere" deletes all of them (src/routes/account.ts:252). |
| Manuscripts (the shelf) | the whole book as one JSON document (text, settings, pictures, snapshot history), title, revision, timestamps | migrations/002_manuscripts.sql:4-11, 009_manuscript_revision.sql:9 | Until the writer deletes it (src/routes/manuscripts.ts:176-179) or the account goes (on delete cascade) |
| Writing streak | the days the server saw activity, freeze ledger, freeze balance | migrations/003_streaks.sql:8-30; heartbeat every ≥10 min while signed in: client/index.html `cloudHeartbeat` (~27494) | No limit (with the account) |
| Export archive | metadata row (format, preset, filename, size, sha256, manuscript id) + the export **bytes** on the exportdata volume at EXPORT_DIR/<user_id>/<export_id> | migrations/004_exports.sql:1-17; src/routes/exports.ts:107; client uploads on export/store-check: client/index.html `storeUpload` (~26911) | Until the writer deletes it (src/routes/exports.ts:191-193). Survives deleting the manuscript (manuscript_id set null). |
| Server jobs (EPUBCheck, PDF/X) | kind, status, result JSON (tool output about the writer's own file), source/artifact export ids | migrations/008_jobs.sql:7-29 | No limit (with the account) |
| Jobs processing | EPUBCheck runs on the server (java + jar, src/config.ts `epubcheckJar`); PDF/X rendering runs in an isolated renderer container with no network egress, every outgoing request aborted (deploy/renderer/server.mjs:8-30,141-159; deploy/docker-compose.tools.yml:14,74-76) | — | — |
| Password reset | user_id, **SHA-256 hash** of the token, expires_at (60 min), used_at | migrations/010_password_resets.sql:5-12; src/routes/account.ts:35,128-131 | Rows older than expiry + 1 day are deleted on the next reset request (src/routes/account.ts:128). Excluded from backups (src/housekeeping/backup.ts:57-58) |
| Share links (beta readers) | owner, SHA-256 of the link token, title, a frozen sanitized copy of the book (snapshot + images), expiry, revoked_at, comment settings | migrations/011_shares.sql:5-28 | Until the writer deletes the share (src/routes/shares.ts:384-388). Revoking/expiry closes the link but keeps the row. |
| Reader comments | section id, paragraph index, the selected quote (≤500 chars), the comment (≤2000), the reader's name (≤60, may be required by the writer), created_at, resolved_at, **ip_hash = SHA-256(share id + client IP)** "for abuse review only" | migrations/011_shares.sql:30-45; src/routes/shares.ts:43-45,576-625 | Until the writer deletes the comment (src/routes/shares.ts:433) or the share |
| Comment visibility | **Anyone holding the link can read every comment on that copy, with the reader names** (GET /read/:token/comments is public to link holders) | src/routes/shares.ts:549-571; src/shares/reader.ts:114 | — |
| Reader count | share_readers: SHA-256(share id + an opaque random cookie value), first_seen_at | migrations/011_shares.sql:47-54; src/routes/shares.ts:493-506 | With the share |
| Founders' Shelf | name (≤80), email, "what do you write" (≤500), created_at. Public form on /help/. | migrations/007_founders.sql:5-11; src/routes/founders.ts:51-80; client/help/help.js:217 | **No limit and no deletion route** — removal only by the operator |
| Billing (only if Stripe is configured; it is NOT live today) | billing_events: Stripe event id, type, mode, object id, outcome (payloads NOT stored); billing_subscriptions: subscription id, customer id, status, price ids, period end | migrations/012_billing_state.sql:13-56 | No limit |
| Help search log | sha-256 of the normalised query, its **first 200 characters**, result count, the result clicked. **No user id, no IP** (confirmed: insert has only those columns) | migrations/013_help_search.sql:1-8,47-54; src/help/search.ts:310-311,320 | **No limit**. Excluded from backups (src/housekeeping/backup.ts:64) |
| Housekeeping audit | actor user id + **actor email** (admins only), action, params summary, result | migrations/006_housekeeping.sql:12-21 | No limit (append-only, excluded from backups and restore) |
| Self-check runs / sign-offs | build stamp, counts, results; sign-off user id + email + note (admins only) | migrations/006_housekeeping.sql:27-50 | No limit |
| help_docs | derived from content/help/ — no personal data | migrations/013_help_search.sql:21-33 | Rebuilt each boot |

## 2. Server: cookies

| Cookie | Set by | Flags | Lifetime | Purpose |
|---|---|---|---|---|
| `beuk_session` | src/auth.ts:5,49-57 | HttpOnly, SameSite=Lax, Path=/, Secure when COOKIE_SECURE=true | until expires_at (SESSION_TTL_DAYS, default 30) | keeps a signed-in writer signed in |
| `beuk_reader` | src/routes/shares.ts:462,494-503 | HttpOnly, SameSite=Lax, Path=/read, Secure when COOKIE_SECURE=true | 365 days | random value; counts distinct readers of a share (stored only hashed with the share id) |

No analytics, advertising or tracking cookies exist in the code (grep of
`res.cookie(` in src/: only the two above).

## 3. Server: in-memory only (lost on restart)

Rate limits keyed by client IP or user id: login/register token buckets
(src/routes/auth.ts:34; src/ratelimit.ts:27-28), forgot/reset per IP and
per email, password change per user (src/routes/account.ts:51-54,108-111),
Founders' form per IP (src/routes/founders.ts:28-49), help search per IP
(src/routes/help.ts:106,142), reader comments per IP and
per share (src/routes/shares.ts:63-66,606-607), stock search per user id
(src/routes/stock.ts:52-67). Not written to disk.

## 4. Server: logs

- **Caddy access log: off.** The Caddyfile has no `log` directive.
  Verified 2026-10-25 against caddy:2-alpine v2.11.7 with a minimal
  Caddyfile: a served request produced no access-log line.
- **Caddy error log: on (Caddy's default).** Verified the same day: a
  request that failed inside the proxy (upstream down → 502) wrote one
  `http.log.error` line holding the request's **remote_ip, client_ip,
  method, host, URI (with query) and request headers incl. User-Agent**.
  So an IP address is logged when a request errors at the proxy.
- **App log (stdout):** no request log. Lines written: startup, errors
  (`console.error(err)`, src/app.ts:158 — may hold request details of
  the failing call), "password reset requested but not emailed" with the
  reason only (src/routes/account.ts:139), one PII-free line per CSP
  report (src/routes/csp-report.ts:26-34,141), and — only when
  MAIL_LOG_LINKS is on (default off in production, src/config.ts
  `mailLogLinks`) — the would-be reset email including the link
  (src/mailer.ts:79-106).
- **Retention of container logs:** docker-compose.yml sets no `logging:`
  options, so Docker's json-file driver keeps them, and its `max-size`
  "Defaults to -1 (unlimited)"
  (https://docs.docker.com/engine/logging/drivers/json-file/). No limit
  unless the operator configures rotation.

## 5. CSP reports

POST /api/csp-report: nothing stored. One log line per report holding
disposition, directive, the blocked resource reduced to its origin, the
document path with tokens removed. No client address, no user agent, no
script sample (src/routes/csp-report.ts:26-34,56-90).

## 6. Backups

- **Local:** every BACKUP_INTERVAL_HOURS (default 24) a backup under
  BACKUP_DIR: a logical dump of BACKUP_TABLES (users incl. password
  hashes, manuscripts, streaks, exports, jobs, sessions,
  founders_applications, shares, share_comments, share_readers, billing)
  and a copy of the export files (src/housekeeping/backup.ts:1-55,221).
  **Local backups are never deleted automatically** (.env.example
  "Local backups are NEVER deleted automatically";
  src/housekeeping/offsite.ts:33). So data the writer deletes stays in
  older local backups with no limit.
- **Off-site (optional, only when all five OFFSITE_* settings are set):**
  restic to a private Backblaze B2 bucket, encrypted before it leaves the
  box (src/housekeeping/offsite.ts:7-21). Retention: restic forget
  --keep-daily 7 --keep-weekly 4 --keep-monthly 12 by default
  (.env.example RESTIC_KEEP_*; src/config.ts `keepDaily/keepWeekly/
  keepMonthly`), i.e. a deleted item can survive in off-site snapshots
  for about a year. The bucket region is whatever endpoint the operator
  configures (OFFSITE_B2_ENDPOINT).
- Excluded from backups: password_resets, housekeeping_*, help_docs,
  search_log, schema_migrations (src/housekeeping/backup.ts:56-65).

## 7. Email

Only password-reset emails (src/routes/account.ts:78-97) and the admin
test email (src/routes/housekeeping.ts:620-626). Sent through the SMTP
server the operator configures in SMTP_URL (src/config.ts `smtpUrl`;
src/mailer.ts). The provider is not named in the code. Nothing is sent
while SMTP_URL / MAIL_FROM are unset. No newsletters; the Founders' Shelf
sends no email (src/routes/founders.ts:9-10).

## 8. Third parties

| Party | Who contacts it | What it receives | Evidence |
|---|---|---|---|
| Google Fonts (fonts.googleapis.com, fonts.gstatic.com) | **the visitor's browser**, on every studio, help, warmth and legal page | the visitor's IP address, user agent and the page as referrer (per the Referrer-Policy strict-origin-when-cross-origin, only the origin) | client/index.html:31-34; src/help/render.ts:33-34,170-173; src/warmth/pages.ts:137-139; Caddyfile CSP style-src/font-src; client/sw.js BEUK_FONT_ORIGINS. **Not** on /read/ (font-src 'self', src/shares/reader.ts:27-36) |
| Pexels (api.pexels.com) | the **server**, for signed-in cover photo search, only when PEXELS_API_KEY is set | the search words and page size, with the server's key. No user id, no email | src/routes/stock.ts:69-100 |
| Pexels images (images.pexels.com) | the **visitor's browser** shows result thumbnails and downloads the chosen photo | the visitor's IP address | Caddyfile CSP img-src/connect-src; src/routes/stock.ts:118-127 |
| Openverse (api.openverse.org) | the **visitor's browser**, only when the studio cannot reach its own server (standalone/offline-from-server) | the search words, the visitor's IP | client/index.html `cmStockGate`/`stockDirectUrl` (~22423-22429) |
| Ko-fi | nobody automatically — a link only, rendered only when KOFI_URL is set | whatever the visitor gives Ko-fi after following the link | src/warmth/pages.ts:51-66 |
| Stripe | the **server**, only when billing is configured (it is not live) | the account email (customer_email) and user id (client_reference_id, metadata) when the writer starts a checkout; card details go to Stripe's checkout page, never to Beuk | src/billing.ts:237-256; src/routes/billing.ts:94-127 |
| SMTP provider | the server | the recipient address and the reset email | §7 |
| Backblaze B2 | the server, if off-site backups are configured | encrypted backup snapshots | §6 |
| CDN scripts | **none**: script-src is 'self' 'unsafe-inline'; the libraries are vendored under /assets/vendor/ | — | Caddyfile CSP comment + header; client/index.html:36-42 |

## 9. Client side (the browser)

- **IndexedDB "beuk-local"** (store "kv"): the open book ("book",
  "book-prev") and the shelf link. Stays on the device; reaches the
  server only when the writer is signed in and the book syncs to the
  shelf (client/index.html ~35134-35170).
- **localStorage** (all prefixed `beuk.`): theme.v1, uiLang.v1,
  sidebar.v1, streak.v1, writelog.v1, dictSeen.v1, zenScene.v1,
  zenSound.v1, and betaTokens.v1 — the share-link tokens the writer made,
  kept so the studio can show the links again (client/index.html:38224-38231).
- **Service worker caches**: beuk-shell-v5 (the app shell), beuk-sound-v1
  (ambient sound files), and the Google Fonts files (client/sw.js).
- **Backup files** (.beuk-backup.json) and exports are files the writer
  downloads; Beuk does not see where they go.

## 10. Not found in the code (so not claimed)

- No account-deletion endpoint; no self-serve deletion of Founders'
  Shelf entries.
- No analytics, ad trackers, fingerprinting, or third-party scripts.
- No email verification, no marketing email.
- No retention limit for: streak days, jobs, help search_log,
  founders_applications, housekeeping records, local backups, container
  logs.
