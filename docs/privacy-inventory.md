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
| Account | email (trimmed, lower-cased), password **hash**, created_at, email_confirmed_at (when the writer opened a confirmation link; null = not confirmed) | migrations/001_users_sessions.sql:2-7, 014_account_portal.sql; src/routes/auth.ts | Until the writer deletes the account on /account ("Delete my account": current password + typed phrase; src/routes/account-portal.ts `POST /delete`, src/account/data.ts `deleteAccount`), which removes in one transaction every row the account owns (sessions, reset and confirmation links, manuscripts, exports and their files on disk, jobs, streak, shares with their comments and reader counts, billing subscriptions) and the user row. Not removed: Founders' Shelf entries (no user id), admin Housekeeping records, billing_events (user id set null; event id kept as the webhook dedupe ledger), and a live Stripe subscription the server could not cancel (kept with user id null for the operator). When a Stripe key is configured, deletion first cancels the account's live subscriptions at Stripe immediately (src/account/plan.ts `cancelBillingForDeletedAccount`; BILLING_CANCEL_PRORATE decides whether Stripe credits unused time); without a key, or when Stripe refuses, they are left for the operator. Copies remain in backups (§6). |
| Email confirmations | user_id, purpose ('signup' or 'change'), the address the link went to (for a change: the NEW address, before it is confirmed), **SHA-256 hash** of the token, expires_at (48 h), used_at | migrations/014_account_portal.sql; src/account/confirm.ts | Rows older than expiry + 7 days are deleted when the next link is made (src/account/confirm.ts `issueConfirmation`). Deleted with the account. Excluded from backups (src/housekeeping/backup.ts EXCLUDED_TABLES) |
| Password hash | argon2id, the library's default parameters. The password itself is never stored. | src/password.ts:4-7 | Replaced when the password changes (src/routes/account.ts:214) |
| Plan / billing link | users.plan (display label, default 'free'), plan_updated_at, stripe_customer_id | migrations/005_user_billing.sql:5-8 | With the account |
| Free trial | users.trial_ends_at (sign-up + TRIAL_DAYS, default 7; accounts made before migration 016 got created_at + 7 days), users.trial_reminder_sent_at (when the one trial-ending email was accepted by the mail server; null = not sent) | migrations/016_trial.sql; src/routes/auth.ts; src/access.ts; src/trial-mail.ts | With the account; included in Download all my data whether or not billing is switched on (account.json `plan.trialEndsAt`, `plan.trialReminderSentAt`) |
| Admin flag | users.is_admin | migrations/006_housekeeping.sql:4 | With the account |
| Sessions | user_id, **SHA-256 hash** of the session token, created_at, expires_at. No IP, no user agent. | migrations/001_users_sessions.sql:9-15; src/auth.ts:35-46 | SESSION_TTL_DAYS (default 30, src/config.ts `sessionTtlDays`); expired rows are purged at boot and every SESSION_PURGE_INTERVAL_MS (default 1 h): src/index.ts:78-88, src/auth.ts:73. Sign-out deletes the row (src/auth.ts:65); "sign out everywhere" deletes all of them (src/routes/account.ts:254). |
| Manuscripts (the shelf) | the whole book as one JSON document (text, settings, snapshot history), title, revision, timestamps. Since migration 017 a book saved by the studio names each of its pictures ("beuk-pic:<sha256>") instead of carrying the bytes; an older doc, or one saved by an older studio, still carries them inline | migrations/002_manuscripts.sql:4-11, 009_manuscript_revision.sql:9 | Until the writer deletes it (src/routes/manuscripts.ts, DELETE) or the account goes (on delete cascade) |
| Shelf pictures | each picture a shelf book holds (images, cover, uploaded fonts, and the copies its History keeps), stored once per account: the account id, the SHA-256 of the bytes, media type, decoded size, the bytes (base64), created and last-touched times. Plus which shelf books name which picture (manuscript id, account id, hash). Per account only: two accounts with the same picture each hold their own row; another account's hash is answered "not found" | migrations/017_pictures.sql; src/pictures.ts; src/routes/pictures.ts | A picture is deleted as soon as no shelf book of that account names it and it has not been uploaded or asked about for PICTURE_GC_GRACE_SECONDS (default 1 hour): checked after every shelf save and book deletion (src/pictures.ts collectUnusedPictures). Deleting the account deletes them all (src/account/data.ts deleteAccount). Limits: PICTURE_MAX_BYTES per picture (default 32 MiB), PICTURE_QUOTA_BYTES per account (default 2 GiB) |
| Writing streak | the days the server saw activity, freeze ledger, freeze balance | migrations/003_streaks.sql:8-30; heartbeat every ≥10 min while signed in: client/index.html `cloudHeartbeat` (~27494) | No limit (with the account) |
| Beuk School progress | which School lessons the writer marked done (course slug, lesson slug, when). Signed-in writers only; nothing is stored for a visitor who is not signed in | migrations/018_school_progress.sql; src/routes/school.ts `POST /api/school/progress` | No limit (with the account); removed by "Delete my account", included in "Download all my data" as school.json |
| Export archive | metadata row (format, preset, filename, size, sha256, manuscript id) + the export **bytes** on the exportdata volume at EXPORT_DIR/<user_id>/<export_id> | migrations/004_exports.sql:1-17; src/routes/exports.ts:107; client uploads on export/store-check: client/index.html `storeUpload` (~26911) | Until the writer deletes it (src/routes/exports.ts:191-193). Survives deleting the manuscript (manuscript_id set null). |
| Server jobs (EPUBCheck, PDF/X) | kind, status, result JSON (tool output about the writer's own file), source/artifact export ids | migrations/008_jobs.sql:7-29 | No limit (with the account) |
| Jobs processing | EPUBCheck runs on the server (java + jar, src/config.ts `epubcheckJar`); PDF/X rendering runs in an isolated renderer container with no network egress, every outgoing request aborted (deploy/renderer/server.mjs:8-30,141-159; deploy/docker-compose.tools.yml:14,74-76) | — | — |
| Password reset | user_id, **SHA-256 hash** of the token, expires_at (60 min), used_at | migrations/010_password_resets.sql:5-12; src/routes/account.ts:36,129-132 | Rows older than expiry + 1 day are deleted on the next reset request (src/routes/account.ts:129). Excluded from backups (src/housekeeping/backup.ts:57-58) |
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
| Studio error reports | client_errors: the error **message** and **stack** (scrubbed: URL queries/fragments cut, `/read/<token>` → `/read/:token`, emails → [email], UUIDs → [id], 24+ char letter-and-digit runs → [token], a quoted book/picture file name of any length → "[file]", other quoted text over 24 chars → "[…]", book/picture file names → [file] together with up to five capitalised or numbered words before them; message ≤300 chars, stack ≤15 lines/2000 chars), the studio shell build (e.g. beuk-shell-v18), the server build stamp, UI language, device class (phone/tablet/desktop), kind, day, last hour seen, a count. **No user id, no IP, no user agent, no cookies** (sent with `credentials: 'omit'`) | migrations/015_ops.sql; src/ops/client-errors.ts; client/index.html `BEUK:errors` | Rows older than CLIENT_ERRORS_KEEP_DAYS (default **30**) are deleted (hourly on new reports, every scheduler tick, and on the Housekeeping read). Excluded from backups |
| Usage counts | usage_daily: day, counter name, a number, a final flag — **nothing else** (see §11) | migrations/015_ops.sql; src/ops/usage.ts | **No limit** (one row per day per counter). Excluded from backups |
| Backup alert state | ops_alerts: whether a backup incident is open, which self-check ids are red and their scrubbed detail, when the last alert went out and what each channel answered, whether the opening alert was delivered and how many attempts it took. ALERT_EMAIL (the operator's own address) is configuration, not stored here | migrations/015_ops.sql; src/ops/alerts.ts | One row, overwritten on each change. Excluded from backups |

## 2. Server: cookies

| Cookie | Set by | Flags | Lifetime | Purpose |
|---|---|---|---|---|
| `beuk_session` | src/auth.ts:5,49-57 | HttpOnly, SameSite=Lax, Path=/, Secure when COOKIE_SECURE=true | until expires_at (SESSION_TTL_DAYS, default 30) | keeps a signed-in writer signed in |
| `beuk_reader` | src/routes/shares.ts:462,494-503 | HttpOnly, SameSite=Lax, Path=/read, Secure when COOKIE_SECURE=true | 365 days | random value; counts distinct readers of a share (stored only hashed with the share id) |

No analytics, advertising or tracking cookies exist in the code (grep of
`res.cookie(` in src/: only the two above).

## 3. Server: in-memory only (lost on restart)

Rate limits keyed by client IP or user id: studio error reports per IP
(src/ops/client-errors.ts), login/register token buckets
(src/routes/auth.ts:34; src/ratelimit.ts:27-28), forgot/reset per IP and
per email, password change per user (src/routes/account.ts:52-55,109-112),
confirmation-link resend, email change, data download and account deletion per
user id, confirmation page per IP (src/routes/account-portal.ts `DEFAULT_PORTAL_LIMITS`),
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
  reason only (src/routes/account.ts:141), one PII-free line per CSP
  report (src/routes/csp-report.ts:26-34,141), and — only when
  MAIL_LOG_LINKS is on (default off in production, src/config.ts
  `mailLogLinks`) — the would-be reset email including the link
  (src/mailer.ts:92-120).
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
  hashes, manuscripts, shelf pictures and which books name them,
  streaks, School progress, exports, jobs, sessions,
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
  search_log, schema_migrations, client_errors, usage_daily, ops_alerts
  (src/housekeeping/backup.ts EXCLUDED_TABLES).
- **Local retention (optional):** BACKUP_KEEP_DAYS / BACKUP_KEEP_COUNT.
  **Unset (today) = keep everything**, as above. When set, older local
  backups are deleted (src/ops/retention.ts), never the newest complete
  one and never while a backup runs. Deleted data then leaves the box's
  local backups after that many days / backups; off-site snapshots keep
  their own restic retention.

## 7. Email

Password-reset emails (src/routes/account.ts `resetEmail`), the welcome
email sent once at sign-up when email is configured, which carries the
email-confirmation link (src/email/welcome.ts), the plain confirmation link
on "Send the link again" (and, while email is not configured, the would-be
sign-up confirmation, logged and never sent), and for a change of
address a confirmation link to the NEW address plus a short notice to the
OLD one (src/account/confirm.ts), and the admin test email
(src/routes/housekeeping.ts:623-630), and backup alerts to the
operator's own ALERT_EMAIL (src/ops/alerts.ts; no writer data: check
names and their scrubbed detail), and one trial-ending email per account,
TRIAL_REMINDER_DAYS (default 3) before the trial ends, only while billing
is switched on and the account has no plan (src/trial-mail.ts; it names
the end date, the account page link, and the price label only if V set
one). While email is not configured a change
of address is refused (src/routes/account-portal.ts `POST /email` → 501), so
an address never changes unconfirmed. Sent through the SMTP
server the operator configures in SMTP_URL (src/config.ts `smtpUrl`;
src/mailer.ts). The provider is not named in the code. Nothing is sent
while SMTP_URL / MAIL_FROM are unset. No newsletters; the Founders' Shelf
sends no email (src/routes/founders.ts:9-10).
Every email to a writer uses one layout (src/email/layout.ts): plain text
plus simple HTML, no images, no remote fonts, no tracking pixel, no link
rewriting by Beuk, and a footer saying why it was sent, the sender
(MAIL_FROM) and a link to /account. When SUPPORT_EMAIL is set, every
email carries it as the Reply-To address (src/mailer.ts `smtpMessage`), so
replies go to the support mailbox. Beuk keeps no record of which emails
were sent; the SMTP provider keeps its own delivery logs under its own
terms. Payment receipts are Stripe's, sent by Stripe when turned on in its
Dashboard; Beuk sends none. The full list of emails is in
docs/email-setup.md.

## 8. Third parties

| Party | Who contacts it | What it receives | Evidence |
|---|---|---|---|
| Google Fonts (fonts.googleapis.com, fonts.gstatic.com) | **the visitor's browser**, on every studio, help, warmth and legal page | the visitor's IP address, user agent and the page as referrer (per the Referrer-Policy strict-origin-when-cross-origin, only the origin) | client/index.html:31-34; src/help/render.ts:33-34,170-173; src/warmth/pages.ts:137-139; Caddyfile CSP style-src/font-src; client/sw.js BEUK_FONT_ORIGINS. **Not** on /read/ (font-src 'self', src/shares/reader.ts:27-36) |
| Pexels (api.pexels.com) | the **server**, for signed-in cover photo search, only when PEXELS_API_KEY is set | the search words and page size, with the server's key. No user id, no email | src/routes/stock.ts:69-100 |
| Pexels images (images.pexels.com) | the **visitor's browser** shows result thumbnails and downloads the chosen photo | the visitor's IP address | Caddyfile CSP img-src/connect-src; src/routes/stock.ts:118-127 |
| Openverse (api.openverse.org) | the **visitor's browser**, only when the studio cannot reach its own server (standalone/offline-from-server) | the search words, the visitor's IP | client/index.html `cmStockGate`/`stockDirectUrl` (~22423-22429) |
| Ko-fi | nobody automatically — a link only, rendered only when KOFI_URL is set | whatever the visitor gives Ko-fi after following the link | src/warmth/pages.ts:51-66 |
| Stripe | the **server**, only when billing is configured (it is not live) | the account email (customer_email) and user id (client_reference_id, metadata) when the writer starts a checkout; the stored Stripe customer id when the writer opens Manage billing (Customer Portal) and when a deleted account's subscription is cancelled; with BILLING_AUTOMATIC_TAX on, Stripe's checkout collects the billing address it needs for tax. Card details and addresses go to Stripe's pages, never to Beuk | src/billing.ts:237-256; src/routes/billing.ts:94-127 |
| SMTP provider | the server | the recipient address and the email (reset link, confirmation link, change-of-address notice) | §7 |
| Backblaze B2 | the server, if off-site backups are configured | encrypted backup snapshots | §6 |
| Alert webhook (e.g. Slack or Discord), only if ALERT_WEBHOOK_URL is set | the server, when a backup incident opens or closes, or on a test | the server's address (APP_BASE_URL), the time, the red backup check names and their scrubbed detail. No writer data | src/ops/alerts.ts |
| An outside uptime monitor (not set up; V's choice) | the monitor, on a timer | it fetches /api/health or /api/status/public: no writer data in either | docs/uptime-monitoring.md |
| CDN scripts | **none**: script-src is 'self' 'unsafe-inline'; the libraries are vendored under /assets/vendor/ | — | Caddyfile CSP comment + header; client/index.html:36-42 |

## 8b. "Download all my data"

GET /api/account/export (signed in, rate-limited per user) streams one ZIP
built on the fly and not stored: every shelf manuscript as a studio
backup file (.beuk-backup.json, its stored pictures filled back in, so the
file holds the whole book) with manuscripts/index.json for each
book's id, revision and dates (a stored doc with no readable chapters is
kept as plain .json and marked), every
archived export's bytes with exports/index.json, each share's settings,
frozen reading copy and comments (reader names and comment text, NOT the
comment ip_hash), streak days and freezes, School lessons marked done, server jobs and their results,
account.json and a README.txt. Password hash, sessions and link tokens
are left out (src/account/data.ts `writeAccountExport`).

## 9. Client side (the browser)

- **IndexedDB "beuk-local"** (store "kv"): the open book ("book",
  "book-prev") and the shelf link. Stays on the device; reaches the
  server only when the writer is signed in and the book syncs to the
  shelf (client/index.html ~35134-35170).
- **localStorage** (all prefixed `beuk.`): theme.v1, uiLang.v1,
  sidebar.v1, streak.v1, writelog.v1, dictSeen.v1, zenScene.v1,
  zenSound.v1, errors.v1 ("on" when the writer turns error reports on
  in Project Settings; absent = off), betaTokens.v1 — the share-link tokens the writer made,
  kept so the studio can show the links again (client/index.html:38224-38231) —
  and desk ("1" once the writer has written on this device, so the landing
  page at / sends them straight back to the studio; no content, no id),
  and tour.v1 ("done" or "skipped" once the first-run quick tour has
  ended, so it is not shown again; never sent to the server).
- **Service worker caches**: beuk-shell-v18 (the app shell), beuk-sound-v2
  (ambient sound files), and the self-hosted font files under assets/fonts/ (client/sw.js).
  The shell cache also holds the sample story's 37 pictures (client/assets/sample/*.jpg,
  ~8.0 MB, listed in client/assets/sample/manifest.json): Beuk's own bundled artwork, the
  same for every visitor, precached by the service worker once it controls the page, so the sample opens offline. They contain
  no writer data, are fetched only from the studio's own origin, and leave the device
  only as part of an export the writer makes of the sample. When the sample is on the
  desk its pictures are copied into the book (state.images / the cover) exactly as before,
  and saved with it in IndexedDB like any book picture.
- **Backup files** (.beuk-backup.json) and exports are files the writer
  downloads; Beuk does not see where they go.

## 10. Not found in the code (so not claimed)

- No self-serve deletion of Founders' Shelf entries (account deletion
  exists since migration 014: /account, "Delete my account").
- No third-party analytics, ad trackers, fingerprinting, or third-party
  scripts. Beuk's own usage counting is the daily aggregate in §11.
- The public status page (/status, /api/status/public) shows no writer
  data: component states, plain summaries, reading times.
- No marketing email. (Email confirmation exists since migration 014;
  it never blocks writing, saving, exporting or the trial.)
- No retention limit for: streak days, jobs, help search_log,
  founders_applications, housekeeping records, local backups (unless
  BACKUP_KEEP_* is set), usage counts, container logs.

## 11. Usage counts (src/ops/usage.ts, migration 015)

**What is stored:** one row per day per counter in `usage_daily`: the
day (APP_TIMEZONE), the counter's name, a number, and whether the day is
final. No cookies are set, and no IP address, user id, email, session,
user agent or per-event row is written anywhere for this.

**What is counted** (only when the server's answer was a success):

| Counter | Counted when |
|---|---|
| sign_ups | POST /api/auth/register answered 201 |
| sign_ins | POST /api/auth/login answered 200 (a wrong password is not counted) |
| first_shelf_saves | POST /api/manuscripts answered 201 and that account now has exactly one book on the shelf. To know that, the number of that account's manuscripts is read at that moment; the account is not written anywhere. An account that deletes all its books and saves again counts again |
| exports_archived | POST /api/exports answered 201 |
| epubcheck_runs | POST /api/jobs/epubcheck answered 2xx (a job was queued; whether EPUBCheck is installed is not part of it) |
| share_links_created | POST /api/shares answered 201 |
| came_back_after_7_days | computed from `streak_days` (already kept, §1): accounts with a writing day on that day whose previous writing day was 7 or more days earlier. Today is recomputed; a past day is computed one last time after it ends, then kept as it is |

**What is NOT counted:** page views, visits, the landing page, Help
reads, which features are used inside the studio, anything about books,
anything that happens on a device without the server (writing never
needs an account), failed requests.

Shown to admins in Housekeeping (`GET /api/housekeeping/usage`, last 30
days). No retention limit.

## 12. Studio error reports (src/ops/client-errors.ts, client/index.html BEUK:errors)

Off by default (opt-in): a writer turns them on in Project Settings, under "Beuk
on this device" ("Send error reports when something breaks"), stored on that device as
localStorage `beuk.errors.v1 = "on"`. They stay opt-in until the privacy page
(which says nothing is sent while signed out) is revised. When an uncaught error or an
unhandled promise rejection happens in the studio, it sends at most 5
reports per page load (each distinct error once) to POST
/api/client-errors, **without cookies**. What is sent and kept: §1
"Studio error reports". Scrubbing happens in the studio and again on the
server. It is pattern-based, so it is a strong filter, not a proof:

- a quoted file name is removed whole ("Failed to read 'The Lantern
  Coast.epub'" → "Failed to read '[file]'");
- an unquoted file name with spaces is removed with up to five words
  before it that start with a capital letter or a digit ("Could not open
  My Secret Novel.docx" → "Could not open [file]"), but a lower-case one
  keeps its first words ("open my secret novel.docx" → "open my secret
  [file]");
- an error message that quotes 24 characters of text or fewer, or that
  names a chapter or title without quotes ("Bad chapter: The Night My
  Father Left"), keeps that text.

The studio's settings note says this in plain words ("most file names",
"an error that quotes a few of your own words could still carry them")
rather than promising that no book text can ever be in a report. The
gaps matter for error messages that quote what they choked on (from the
browser, a library, or the studio itself); no audit of every error
message in the studio has been made. Admins see reports
grouped by message in Housekeeping (`GET /api/housekeeping/client-errors`).
Kept CLIENT_ERRORS_KEEP_DAYS days (default 30). The studio note does not
name a number ("kept for a limited time, then deleted"), so changing the
setting never makes it wrong; the privacy page should either not name a
number either or be updated when the setting changes.
