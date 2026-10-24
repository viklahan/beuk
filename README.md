# Beuk SaaS — server

The server side of Beuk (the browser-based EPUB typesetting studio),
built milestone by milestone per `../goals/beuk-saas-launch/files/phase-two-saas-plan.md`.

**Milestones M1–M5 (this code): accounts + cloud manuscripts +
server-verified streak (M1); per-user export archive + billing hooks (M2);
the Housekeeping admin surface (M3); the Warmth Phase 0 surfaces (M4);
server EPUBCheck + PDF/X jobs (M5)**,
on a Docker Compose stack shaped for self-hosting on Hetzner Cloud.

## Stack

- **app** — Node 24 + TypeScript, Express, `pg`, argon2id password hashing.
- **db** — Postgres 16.
- **caddy** — reverse proxy; automatic HTTPS (Let's Encrypt for `beuk.studio`,
  internal CA for `localhost` in dev). Also serves the static web client.
- Migrations are plain SQL files in `migrations/`, applied automatically on
  app boot (tracked in `schema_migrations`, safe to re-run).

## Run it locally

**Windows one-liner:** `.\start-local.ps1` stops stray Beuk dev servers
from any copy of the project, frees port 8090, builds and starts the
stack (with the tools overlay when `tools-bin/epubcheck.jar` exists),
and waits for `/api/health` → http://localhost:8090. `-Down` stops it,
`-NoBuild` restarts without rebuilding.

Or by hand:

```bash
cp .env.example .env        # placeholder values are fine for local dev
docker compose up -d --build
```

Then:

- Site (placeholder client): https://localhost — your browser will warn about
  Caddy's internal CA in dev; that's expected for `DOMAIN=localhost`.
- API health: https://localhost/api/health → `{"ok":true,"db":"up"}`

No Docker handy? The API alone can run against any Postgres:

```bash
npm install
DATABASE_URL=postgres://beuk:secret@localhost:5432/beuk npm run dev   # tsx watch
npm run migrate   # optional: apply migrations without booting the server
```

## API (M1–M5)

All JSON. Auth is an http-only session cookie (`beuk_session`); the token is
stored server-side as a SHA-256 hash.

| Endpoint | What |
|---|---|
| `POST /api/auth/register` | `{email, password}` (password ≥ 8 chars) → creates the account, starts a session |
| `POST /api/auth/login` | → new session cookie; 401 for wrong password or unknown email (same message) |
| `POST /api/auth/logout` | destroys the session, clears the cookie |
| `GET /api/auth/me` | current user, or 401 |
| `GET /api/manuscripts` | caller's manuscripts (metadata only) |
| `POST /api/manuscripts` | `{doc, title?}` — `doc` is the whole book JSON (metadata + settings + front/body/back-matter sections); title lifts from `doc.title` if not given |
| `GET /api/manuscripts/:id` | full manuscript incl. `doc` |
| `PUT /api/manuscripts/:id` | `{doc?, title?}` |
| `DELETE /api/manuscripts/:id` | |
| `GET /api/streak` | current streak state — incl. `freezesAvailable`, `pauseDays` (planned days off, today onward) and `pausedToday` |
| `POST /api/streak/heartbeat` | the client pings on activity; **the server stamps its own date** (in `APP_TIMEZONE`) and computes the streak |
| `POST /api/streak/pause` | `{start: "YYYY-MM-DD", days: 1..30}` — pre-covers planned days off |
| `GET /api/exports` | caller's export archive (metadata only, newest first) |
| `POST /api/exports?manuscriptId=…&format=…&filename=…&preset=…` | raw body = the export bytes (`application/octet-stream`); `format` ∈ `epub, markdown, html, print-html, docx`; `preset` optional. 413 over the upload cap (50 MiB default) |
| `GET /api/exports/:id/download` | streams the bytes back with the format's content type and the stored filename |
| `DELETE /api/exports/:id` | removes metadata + stored bytes |
| `POST /api/jobs/epubcheck` | `{exportId}` — queue an EPUBCheck job over one of the caller's own `epub` exports → `201 {job}` (see Jobs) |
| `POST /api/jobs/pdfx` | `{exportId}` — queue a PDF/X conversion job over one of the caller's own `print-html` exports → `201 {job}` |
| `GET /api/jobs` · `GET /api/jobs/:id` | the caller's jobs with status + parsed results; another user's job is a 404 |
| `POST /api/billing/checkout` | starts a subscription checkout → `{url}`; **501 `billing not configured`** until Stripe keys + price are set |
| `GET /api/stock/search?q=…&per_page=…` | signed-in only; Pexels stock-photo search for cover-maker backgrounds → `{photos}` (id, dimensions, photographer + page links, `src` sizes); **501 `stock photos not configured`** until `PEXELS_API_KEY` is set (see Stock photos) |
| `POST /api/billing/webhook` | Stripe webhook; signature-verified events are the ONLY way a plan changes (see Billing) |
| `/api/housekeeping/*` | the admin surface — **404 to everyone who is not a signed-in admin** (see Housekeeping) |
| `GET /api/health` | `{ok, db}` liveness |
| `GET /api/status` | public, scrubbed health summary: app, version, build stamp, db up/down, latest Self-checks outcome (see Warmth) |
| `GET /api/config/public` | public config for pages/clients: support contact + Ko-fi jar URL (or `null`) |
| `POST /api/founders/apply` | public Founders' Shelf application `{name, email, about}`; validated, per-IP throttled |

**Owner isolation:** every manuscript query is scoped by the session's
`user_id`; another user's manuscript returns 404, never 403, so existence
isn't leaked. The export archive follows the identical rule: list,
download and delete are owner-scoped, and an export can only be attached
to a manuscript the caller owns (someone else's manuscript id → 404).

## Export archive storage (M2)

Bytes are files, metadata is Postgres (`exports` table: format, optional
platform preset label, filename, byte size, **SHA-256**, timestamps).
On disk:

```
EXPORT_DIR/            (Compose: the `exportdata` volume at /data/exports)
  <user_id>/
    <export_id>        (the raw bytes, no extension — served per metadata)
```

Deleting an export removes both the row and the file. Deleting a
manuscript keeps its exports (the link is set null) — the archive is the
user's permanent copy, the manuscript is the working document.

## Jobs (M5) — server EPUBCheck + PDF/X

The two capabilities the browser build honestly defers — real
EPUBCheck validation and true PDF/X conversion — run here as
background **jobs** over exports already in the user's archive
(`jobs` table: owner, kind, source export, status
`queued → running → done|failed`, parsed result JSON, optional
artifact export, timestamps). Creating a job validates ownership and
format (someone else's export → 404; an `epubcheck` job needs an
`epub` export, a `pdfx` job a `print-html` one → 400) and returns
immediately; a simple in-process worker drains the queue **one job
at a time** (one Hetzner box; the tools are heavy) with a per-job
timeout (`JOB_TIMEOUT_MS`, default 2 minutes — an overrun is killed,
process group and all, and fails with the timeout stated). On boot,
jobs a dead process left `running` are failed honestly and `queued`
ones are picked up again.

- **EPUBCheck** runs as `java -jar $EPUBCHECK_JAR <file> --json <report>`
  and the JSON report is parsed into counts (fatal / error / warning /
  info / usage) plus the message list (code, severity, message,
  location) stored on the job. A book WITH findings is a `done` job
  whose result says `passed: false` — the job succeeded, the book
  didn't, and the result never blurs the two.
- **PDF/X** runs Ghostscript with the PDF/X-1a recipe in
  `src/jobs/tools.ts` (`-dPDFX`, prepress settings, everything
  converted to DeviceCMYK) fed the definition file
  `tools/PDFX_def.ps`, which declares the `GTS_PDFX` OutputIntent and
  embeds the CMYK ICC profile it points at. On success the converted
  PDF is stored back into the user's archive as a new export
  (format `pdfx`, filename `…-pdfx.pdf`, linked to the source's
  manuscript) and the job's `artifactExportId` points at it.

**Tool gating is honest, in the M2-billing tradition.** Availability
is checked when the job runs: if EPUBCheck's jar is unset/missing,
or Ghostscript isn't configured/runnable, or the PDF/X definition
file is absent, the job still completes — as **failed**, with
"not configured on this server" and the specifics in its result.
No pass is ever fabricated, no result is ever invented; a tool that
runs is believed exactly as far as its own output (Ghostscript must
exit 0 AND leave a non-empty file).

**Production setup (on the Hetzner box, once):**

1. Install a JRE, Ghostscript, and a headless Chromium, e.g.
   `apt-get install -y default-jre-headless ghostscript chromium`
   (or extend the app image the same way — the tools overlay does
   exactly this). The stock Compose image deliberately does not
   carry them yet.
2. Download the EPUBCheck release zip from
   <https://github.com/w3c/epubcheck/releases>, unpack it somewhere
   the app can read, and set `EPUBCHECK_JAR` to its `epubcheck.jar`
   (mount the directory into the app container if it lives on the
   host; `JAVA_BIN` only if `java` isn't on the PATH).
3. Set `GS_BIN=/usr/bin/gs` in `.env`.
4. Set `HTML_PDF_BIN=/usr/bin/chromium` in `.env` — the
   headless-Chromium-compatible binary the pdfx job uses to render a
   print-html interior to PDF before Ghostscript converts it. (The
   tools overlay sets this for you.)
5. **ICC profile (required for real PDF/X-1a):** install a CMYK
   press profile (e.g. the `icc-profiles-free` package) and edit the
   `BeukICCPath` line in `tools/PDFX_def.ps` to point at it. With
   the placeholder path left in place, Ghostscript errors out and
   the job fails with that error — by design.
6. Restart the app. Until steps 1–5 are done, jobs answer with the
   not-configured failure above; the moment they are, the same jobs
   run for real with no code change.

Two residual limits, stated plainly. First, **the real binaries have
never executed in the build sandbox** (no JRE/Ghostscript/Chromium
there): the pipeline around them — gating, queueing, the
HTML → PDF rendition, timeouts, report parsing, archive storage —
is fully tested with stub tools wired through the same
`JAVA_BIN`/`GS_BIN`/`HTML_PDF_BIN` settings, and the Hetzner box is
where EPUBCheck, the renderer, and Ghostscript first run for real.
Second, **Ghostscript converts PDF input**: a pdfx job first renders
the archived print-html interior to PDF with the configured
renderer, then converts that PDF to PDF/X-1a. If the renderer is
not configured, the job fails honestly as "not configured" before
Ghostscript ever runs — raw HTML is never fed to Ghostscript.

## Billing hooks (M2)

Users carry `plan` (`free` | `pro`), `plan_updated_at`, and a stored
Stripe customer id. **A plan changes only from a signature-verified
webhook event** — no client request can flip one:

- `checkout.session.completed` → `pro`
- `customer.subscription.updated` → `pro` while `active`/`trialing`, else `free`
- `customer.subscription.deleted` → `free`

The webhook verifies the `Stripe-Signature` header (HMAC-SHA256 over the
raw body, 5-minute replay window) whenever `STRIPE_WEBHOOK_SECRET` is
set; unsigned or unverifiable deliveries get a 400 and change nothing.
Billing sits behind a provider interface (`src/billing.ts`) so the routes
never talk to Stripe directly.

**Enabling billing later (Vik's step, price + keys are his):**

1. In Stripe: create the Pro product and its recurring price; register
   the webhook endpoint `https://beuk.studio/api/billing/webhook` for the
   three event types above.
2. In the server's `.env` only: set `STRIPE_PRICE_ID` (`price_…`),
   `STRIPE_SECRET_KEY` (`sk_…`), `STRIPE_WEBHOOK_SECRET` (`whsec_…`),
   and `APP_BASE_URL` (public site origin, for checkout redirects).
3. Restart the app. Until all of that is set, `POST /api/billing/checkout`
   answers a clean **501 `billing not configured`** — no error, no fake
   success — and the webhook refuses everything.

## Stock photos (cover maker)

`GET /api/stock/search?q=…&per_page=…` is a thin, signed-in-only proxy
over the Pexels search API, so the client's cover maker can offer
stock backgrounds without the Pexels API key ever reaching a browser.
The key lives only in the server's `.env` (`PEXELS_API_KEY`), is sent
to Pexels as the `Authorization` header, and appears in no response,
log line or error — upstream bodies are never forwarded, only fixed
plain messages. Responses are normalized to
`{photos: [{id, width, height, photographer, photographerUrl, pageUrl, src: {large, medium, original}}]}`;
`per_page` defaults to 24 and clamps at 40. A light in-memory
per-user throttle (30 searches/minute) protects the shared quota.

**Enabling it later (Vik's step, the key is his):** create a free
Pexels API key, set `PEXELS_API_KEY` in the server's `.env` only, and
restart the app. Until then the endpoint answers a clean **501 `stock
photos not configured`** and the cover maker simply offers no stock
search. (`PEXELS_API_BASE` overrides the API base URL; tests point it
at a stub.)

## Housekeeping (M3)

The admin surface for the app itself — never customer-facing, and it
does not reveal itself: every route under `/api/housekeeping/*` answers
**404** to anonymous callers and ordinary users alike. Fixed named
actions only — no shell, no arbitrary commands, no free-form paths.
Mutating actions take **one global lock** (a concurrent attempt gets
**409**), every action writes an **audit row**, and every output —
responses, audit summaries, generated manifests — passes through a
**secret scrubber** that redacts the configured secret values
(database URL/password, Stripe keys).

**Granting admin:** out-of-band only. Register the account in the app,
then on the server run
`docker compose exec app node dist/admin-cli.js grant you@example.com`
(also `revoke <email>` and `list`; each change writes an audit row).
The gate reads `users.is_admin` live on every request, so a revoke is
immediate. Registration, login and email addresses confer nothing:
there is no admin UI and no way to become admin via the API.
(`ADMIN_EMAILS` is no longer read; the app warns at boot if it is set.)

**The named actions** (`GET /api/housekeeping/actions` returns the
catalogue to an admin):

| Pillar | Actions |
|---|---|
| Self-checks | `POST /self-checks/run` — execute the registry, store the run stamped with the build (`BUILD_STAMP`/`GIT_SHA`); `GET /self-checks/runs[/:id]` |
| Evidence | `POST /backups` + `GET /backups[/:name]` — named backups; `POST /restore/preview` → `POST /restore` with `confirmed: true` |
| Rehearse | `POST /rehearse` — migrations + boot/health check against a scratch database; production data untouched |
| Reference | `GET /reference/architecture`, `GET /reference/roadmap` — rendered from `docs/architecture.md` / `docs/roadmap.md` in the repo |
| Promotion | `POST /promote/sign-off`, then `POST /promote` (the gate, below) |
| Evidence | `GET /audit` — recent audit rows |
| Founders' Shelf | `GET /founders` — the M4 seed-list applications (read-only, audited) |

**Self-checks registry:** 118 cases ported from the coverage registry.
**31 execute server-side** — infra (DB reachable, migrations current,
export volume writable), data invariants (no orphaned export
files/rows, archive SHA-256 re-verification, streak ledger
consistency), and package assertions over fixture EPUBs (cover /
preset / landmark / alt-text style checks, box-set and DOCX structure,
and the validator cases run against deliberately damaged packages).
**87 are registered as `client-only`** with a one-line reason each
(theme application, print CSS, word counts — inherently client-UI
state): reported in every run, never silently dropped, never faked
as passing. Runs are stored in `housekeeping_check_runs`.

**Backups** live under `BACKUP_DIR` (Compose: the `backupdata` volume),
one directory per named backup: `manifest.json` (contents + hashes),
`db.json` (logical dump of the data tables), `settings.json`
(non-secret config — **secrets are excluded by name**, listed in the
manifest), and `files/` (a copy of the export volume). The audit and
check-run tables are NOT backed up: evidence is append-only and a
restore must not rewrite it. All file writes are atomic (temp + rename).

**Restore is two-step:** `POST /restore/preview` returns a per-table
diff summary and a short-lived preview id; `POST /restore` requires
that preview id **and** `confirmed: true`. It snapshots the current
state first (a `pre-restore-…` backup), restores, then verifies by
re-running Self-checks and reports the result.

**Promotion flow:** the deploy marks the working tree clean
(`TREE_CLEAN=true` or a `.tree-clean` marker file — see `.env.example`).
An admin then: (1) runs Self-checks on the current build stamp,
(2) records a human sign-off (`POST /promote/sign-off`), (3) calls
`POST /promote`. The gate refuses with named reasons unless all three
preconditions hold for the **current** build stamp; on success it
writes `PROMOTION_MANIFEST.json` (scrubbed, atomic) and an audit row.

**The streak is forgiving, by design.** Days are server-stamped
(`streak_days`). A ledger (`streak_freezes`) records days covered without
activity: `pause` (planned ahead, free) and `repair` (auto-applied by the
heartbeat after a missed day, consuming the user's freeze balance —
new accounts start with 1). Current/longest streaks are computed server-side
from activity + freeze days.

## Warmth Phase 0 (M4)

The public surfaces that make Beuk feel like a place rather than a
checkout. All of it is unauthenticated and read-only except the
Founders' Shelf application; none of it touches pricing or checkout.

- **Help reading room** — `/help/` plus ten task guides and an EPUB
  error decoder, served by the app from plain static HTML in
  `client/help/` (Paper style, no build step). Caddy proxies `/help*`,
  `/thanks*`, `/changelog` and `/roadmap` to the app because two slots
  depend on server config (below); everything else at the site root is
  still Caddy's static mount.
- **Support block** — the Help index names a human and a reply-time
  promise. Set them in `.env`: `SUPPORT_EMAIL` (the official support
  channel — placeholder `support@beuk.studio` until Vik sets the real
  address), `SUPPORT_NAME`, `SUPPORT_REPLY_PROMISE` (default: "a human
  replies within two working days").
- **Ko-fi tip jar** — set `KOFI_URL` in `.env` and a "Support the
  maker" jar appears at the foot of the Help pages and on `/thanks`
  (the post-export landing). **While `KOFI_URL` is unset, no jar is
  rendered anywhere** — no placeholder, no dead link. It is never
  called a donation and never appears on a pricing or checkout surface
  (there are none in this codebase).
- **Changelog & roadmap** — `/changelog` renders `CHANGELOG.md` (repo
  root; entries credit the writers who asked), `/roadmap` renders
  `docs/roadmap.md` — the same file Housekeeping's Reference pillar
  serves — in the Now/Next/Later shape. Edit the Markdown, the pages
  follow; there are no other copies to keep in sync.
- **Status line** — `GET /api/status` returns a scrubbed public
  summary (app, version, build stamp, db up/down, latest Self-checks
  outcome + when); the Help index fetches it and shows "All's well on
  the shelf" in plain words. `GET /api/config/public` exposes just the
  support contact and jar URL for pages and the future client.
- **Founders' Shelf** — `POST /api/founders/apply` (public) takes a
  name, an email, and one line about what they write; validated and
  throttled per IP (in memory — proportional for a single-process
  deploy). Applications land in `founders_applications`; the only read
  path is Housekeeping's audited `founders.list` action. No emails are
  sent in this milestone.
- **Streak forgiveness, surfaced** — the streak API now also returns
  `freezesAvailable`, the upcoming `pauseDays`, and `pausedToday`, so
  the client can show the forgiving parts (repair balance, planned
  time off) instead of just a number.

## Tests

```bash
npm test
```

Runs the full suite (node:test) against a real Postgres engine in-process
(PGlite — the same migration SQL and queries as production, no Docker or
database server needed). Covers: register/login/logout, duplicate and
invalid credentials, manuscript CRUD, **owner isolation** (user B gets 404 on
read/update/delete and an empty list), streak building across day
boundaries, a missed day **with** a freeze (repaired, streak kept) and
**without** (streak restarts, longest remembered), pause behaviour and
validation, and auth requirements on every protected route. M2 adds:
export save → list → download round-trip with SHA-256 integrity, all five
formats, export owner isolation, manuscript-link validation, the upload
cap (413), the webhook accepting a correctly-signed event and flipping
the plan (and reverting on subscription end), forged/unsigned webhooks
changing nothing, and checkout/webhook returning a clean 501 while
billing is unconfigured. No real Stripe calls anywhere in the suite.
M3 adds: 404 for anonymous and non-admin callers on **every**
Housekeeping route, admin granted only by the CLI (never by registering
or logging in) with immediate revoke, a healthy
Self-checks run (client-only cases reported with reasons, the run
stored), loud failure on a corrupted archive file, the 409 lock
conflict, a canary secret appearing in **no** Housekeeping output
(API responses, backup manifest/settings/dump, promotion manifest),
the restore preview → confirm flow on the test database, Rehearse
against a PGlite scratch database, and the promotion gate refusing
each missing precondition before succeeding with all of them.
M4 adds: every help page, the decoder, and the thanks page serving
200 through the app; the tip jar present in the served HTML when
`KOFI_URL` is set and entirely absent (with the word "donation"
nowhere) when it isn't; the support block carrying the configured
human + promise; `/api/status` shape with a canary secret nowhere in
it and the latest Self-checks run summarised; the changelog/roadmap
pages rendering their seeded sources; Founders' Shelf apply →
validation → 429 throttle → admin-only audited listing (404 for
everyone else); and the streak response's freeze/pause surfacing.
M5 adds: the jobs pipeline end-to-end through the real adapters with
**stub tools** (a fake `java` script emitting a canned EPUBCheck
JSON report, a fake `gs` copying its input) — an epubcheck job on an
own export finishing `done` with the parsed counts/messages stored
(`passed: false` when the report has errors), cross-user 404s on
both job creation and job reads, wrong-format sources rejected per
kind, a pdfx job archiving its output as a `pdfx` export linked to
the source's manuscript, the unconfigured-tool path completing
**failed** with "not configured" (never a pass), and a runaway tool
killed by the per-job timeout. The real EPUBCheck/Ghostscript
binaries cannot run in the test sandbox — the stubs prove the
pipeline around them (see Jobs, residual limits).

## Deploy to Hetzner (outline)

**Fast path:** copy this directory to the box, point DNS at it, then run
`DEPLOY_DOMAIN=beuk.studio ./deploy/install.sh`.
The script installs Docker if needed, writes a real `.env` (generating
the Postgres password — it never overwrites an existing `.env` or
rotates an existing password), stamps the build, builds and starts the
stack, verifies `/api/health`, and — unless `INSTALL_TOOLS=0` — adds
the EPUBCheck/Ghostscript tools image described under "Jobs —
Production setup". The manual outline below is the reference for
everything it does.

1. Point DNS: `beuk.studio` (and `www` if wanted) A/AAAA records at the
   Hetzner box.
2. On the box: install Docker + Compose plugin, clone/copy this directory.
3. `cp .env.example .env` and set real values **on the server only**:
   `DOMAIN=beuk.studio`, a strong `POSTGRES_PASSWORD`, `COOKIE_SECURE=true`.
   Never commit `.env`.
4. `docker compose up -d --build`. Caddy fetches the Let's Encrypt
   certificate automatically; the app runs migrations on boot.
5. Backups are owned by Housekeeping's Evidence pillar (named backups
   of the DB + settings + export volume, restore rehearsed) — still
   keep volume-level snapshots of `pgdata`, `exportdata` and
   `backupdata` as the outer safety net.
6. After first boot, register your account in the app and grant it
   admin: `docker compose exec app node dist/admin-cli.js grant <email>`.
   Set `BUILD_STAMP` (or `GIT_SHA`)
   per deploy so Self-checks runs and sign-offs stamp the right build.
7. Warmth (M4, all in `.env`, all optional): set `SUPPORT_EMAIL` to the
   real support address (the Help page shows a placeholder until you
   do), `SUPPORT_NAME` / `SUPPORT_REPLY_PROMISE` if the defaults don't
   fit, and `KOFI_URL` when a Ko-fi page exists — until then no tip
   jar is rendered anywhere.
8. Jobs (M5, optional, any time): install the JRE + EPUBCheck jar +
   Ghostscript, set `EPUBCHECK_JAR` / `GS_BIN` in `.env`, and point
   `tools/PDFX_def.ps` at a real CMYK ICC profile — the five steps
   under "Jobs — Production setup" above. Until then, EPUBCheck and
   PDF/X jobs complete as honest "not configured" failures.

The same Compose file runs locally — only `.env` differs.

## The static client mount point

`client/` is bind-mounted into Caddy at `/srv/client` and served at the
site root with SPA fallback; `/api/*` is proxied to the app. It holds a
placeholder page for the app itself, plus the M4 warmth pages under
`client/help/` and `client/thanks/` — those paths are proxied to the
app instead (see the Caddyfile), which fills their config slots. The
existing Beuk web client drops its built files in here in a later
milestone — no server changes needed.

## Studio: the Word import report

After every import (`.docx`, `.md`, `.txt`) the studio opens a
**"Here's what we changed"** report, grouped and counted, with
before/after snippets. It records chapter splits (and the heading or
line each came from — Heading 2 is reported as promoted, Heading 3–6
as demoted to body text), front matter carved out by shape (copyright,
epigraph, dedication, title-page lines), scene breaks (including spaced
markers such as `* * *`, now read as breaks), smartened quotes/dashes/
ellipses per section, footnotes (Word notes are linked as Beuk `[^n]`
notes in the section that cites them; unmatched ones are reported as
orphaned), JPG/PNG images (imported into the image library, with their
alt-text status), the language detected and any book details taken from
the manuscript. What the import **drops** is listed first and
prominently: tables, unsupported image formats, Word comments, tracked
changes (imported as if accepted), text boxes (text kept inline), page
headers/footers, list formatting, link addresses, italic/bold, and every
Mammoth.js warning verbatim. The Word behaviours are those of
Mammoth.js 1.6.0, verified in its source (cited in the client code).

Each reversible change has a real **Undo this** that acts on the book as
it stands now (it refuses, and says why, if the text has since changed);
a change that cannot be reverted alone says so instead of offering a
button. **Undo the whole import** restores the pre-import book from the
History snapshot the import takes. The report is stored with the book
(`importReport` in the book JSON, not in History snapshots) and stays
reachable from the import area until dismissed. This is the studio's
main import only; Box Set volume import and Bulk import still use the
plain converter without a report.

## What is deliberately NOT here yet

- **Live billing** — M2 ships the hooks only (plan column, verified
  webhooks, checkout endpoint). It activates when Vik sets a price and
  keys in `.env`; until then the endpoints answer 501.
- **Warmth Phases 1 and 2** — the Made-with-Beuk gallery, template
  sharing, seasonal challenges and spotlights (Phase 1, ~100–500
  users), and a real community (Phase 2, Discourse, on its trigger).
  Phase 0 shipped in M4; the later phases wait for their triggers.
- The web client wired to this API, first-login import of local
  manuscripts, and email verification / password reset — later work.

## Layout

```
src/
  index.ts        entrypoint: migrate, then listen
  migrate.ts      `npm run migrate`
  app.ts          buildApp() — express app (injectable clock for tests)
  config.ts       env → config
  db.ts           Db interface, pg pool impl, migration runner
  password.ts     argon2id hash/verify
  auth.ts         sessions (hashed tokens), cookie helpers, requireAuth
  streak.ts       day math + streak computation + heartbeat repair/pause
  billing.ts      billing provider interface + Stripe (signature verify,
                  event→plan mapping, checkout session) — inert w/o keys
  jobs/           M5: tools.ts (EPUBCheck/Ghostscript adapters,
                  availability gating, report parsing) · runner.ts
                  (sequential in-process worker, per-job timeout,
                  boot recovery, PDF/X output back into the archive)
  housekeeping/   the M3 admin surface: admin.ts (gate) · scrub.ts
                  (secret scrubber) · lock.ts (one global lock) ·
                  registry.ts (Self-checks) · packages.ts + fixtures.ts
                  (zip/EPUB structural checks + fixture packages) ·
                  backup.ts (Evidence: backup/restore) · scratch.ts
                  (Rehearse scratch DBs) · reference.ts (docs reader) ·
                  context.ts · fsutil.ts · xml.ts
  routes/         auth.ts · manuscripts.ts · streak.ts · exports.ts ·
                  billing.ts · housekeeping.ts · public.ts (M4 status +
                  public config) · founders.ts (M4) · warmth.ts (M4 pages)
                  · jobs.ts (M5)
  warmth/         M4 page machinery: pages.ts (chrome, config slots,
                  Ko-fi jar) · markdown.ts (safe md→HTML for the
                  changelog/roadmap pages)
docs/             architecture.md + roadmap.md (Housekeeping Reference
                  renders these files; the public roadmap page renders
                  roadmap.md too)
tools/            PDFX_def.ps — the PDF/X-1a definition file the
                  pdfx job hands to Ghostscript (edit its ICC path)
migrations/       001 users+sessions · 002 manuscripts · 003 streaks ·
                  004 exports · 005 user plan/billing · 006 housekeeping
                  · 007 founders (M4) · 008 jobs (M5)
tests/            node:test suite (PGlite-backed)
client/           static mount point (app placeholder + M4 warmth
                  pages under help/ and thanks/)
CHANGELOG.md      the public changelog source (/changelog renders it)
docker-compose.yml · Dockerfile · Caddyfile · .env.example
```
