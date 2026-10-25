# Beuk 
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
| `POST /api/auth/register` | `{email, password}` (password ≥ 8 chars) → creates the account, starts a session; 409 for an existing email (also when two sign-ups race); 429 + `Retry-After` past the per-IP rate limit |
| `POST /api/auth/login` | → new session cookie; 401 for wrong password or unknown email (same message, same argon2 work); 429 + `Retry-After` past the per-IP rate limit |
| `POST /api/auth/logout` | destroys the session, clears the cookie |
| `GET /api/auth/me` | current user, or 401 |
| `POST /api/auth/forgot` | `{email}` → **always the same 200** `{ok, message, emailDelivery}` for any well-formed address, account or not (no enumeration); per-IP 429, silent per-address limit (see Account basics) |
| `POST /api/auth/reset` | `{token, password}` → consumes a single-use, 60-minute token; new argon2id hash; **every session of that user is revoked**; 400 for an invalid/used/expired token |
| `POST /api/auth/password` | signed in; `{currentPassword, newPassword}` → 403 for a wrong current password; on success the user's **other** sessions are revoked (this one stays) |
| `POST /api/auth/sessions/revoke-all` | signed in; "sign out everywhere" — revokes every session including this one → `{ok, revoked}` |
| `GET /reset?token=…` | the "choose a new password" page the reset email links to (served by the app; `no-store`, `no-referrer`) |
| `GET /api/manuscripts` | caller's manuscripts (metadata only, incl. `revision`) |
| `POST /api/manuscripts` | `{doc, title?}` — `doc` is the whole book JSON (metadata + settings + front/body/back-matter sections); title lifts from `doc.title` if not given |
| `GET /api/manuscripts/:id` | full manuscript incl. `doc` and `revision`; `ETag: "<revision>"` |
| `PUT /api/manuscripts/:id` | `{doc?, title?}` + the base revision as `If-Match: "<revision>"` (or `body.revision`). Stale base → **409** `{error, manuscript}` (the current shelf copy, `doc` included); no base → **428** with the same copy; malformed → 400. Success bumps `revision` (see Optimistic concurrency) |
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
| `POST /api/billing/checkout` | `{priceId?}` (allow-listed prices only) — starts a subscription checkout → `{url}`; **501 `billing not configured`** until Stripe keys + price are set; **409** while the caller already has a subscription that has not ended |
| `GET /api/billing/status` | public: `{live, configured, mode, checkout, graceDays}`; signed in, also `account: {status, granted, entitlements, label, renewsAt, cancelAtPeriodEnd, graceEndsAt}` (see Billing) |
| `GET /api/stock/search?q=…&per_page=…` | signed-in only; Pexels stock-photo search for cover-maker backgrounds → `{photos}` (id, dimensions, photographer + page links, `src` sizes); **501 `stock photos not configured`** until `PEXELS_API_KEY` is set (see Stock photos) |
| `POST /api/billing/webhook` | Stripe webhook; signature-verified, deduplicated by event id, mode-checked; the ONLY way billing state changes (see Billing) |
| `/api/housekeeping/*` | the admin surface — **404 to everyone who is not a signed-in admin** (see Housekeeping) |
| `GET /api/health` | `{ok, db}` liveness |
| `GET /api/status` | public, scrubbed health summary: app, version, build stamp, db up/down, latest Self-checks outcome (see Warmth) |
| `GET /api/config/public` | public config for pages/clients: support contact + Ko-fi jar URL (or `null`) |
| `POST /api/founders/apply` | public Founders' Shelf application `{name, email, about}`; validated, per-IP throttled (429 + `Retry-After`) |
| `/api/shares/*` | signed-in: beta-reader share links — create from a shelf manuscript (token returned **once**), list, republish, revoke, expiry, comments, resolve (see Beta-reader share links) |
| `GET /read/:token` · `/read/:token/comments` | public (no account): the read-only reader page and its comment API; **410** once revoked or expired |

Any `:id` (and `manuscriptId` / `exportId` in a query or body) that is
not a UUID answers **404** — it can never name a row — instead of
reaching Postgres and coming back as a 500.

**Owner isolation:** every manuscript query is scoped by the session's
`user_id`; another user's manuscript returns 404, never 403, so existence
isn't leaked. The export archive follows the identical rule: list,
download and delete are owner-scoped, and an export can only be attached
to a manuscript the caller owns (someone else's manuscript id → 404).

**Optimistic concurrency (migration 009):** every manuscript carries a
`revision` (starts at 1, +1 on every successful PUT), returned as a
field and as a strong `ETag`. A PUT must name the revision it was based
on; the check and the write are a single `UPDATE … WHERE revision = $n`,
so two devices racing can never both land. A stale base gets 409 with the
current shelf copy, which the studio routes into its conflict notice
(Keep mine / Use the shelf copy / Keep both) — never a silent overwrite.
`If-Match: *` (RFC 9110) skips the check; the studio never sends it.
The studio sends one shelf save at a time per tab: a save that comes due
while an upload is still in flight waits and runs once afterwards, on the
revision that upload returned — so a slow uplink never trips a 409 against
the device's own previous save. (Two tabs of the same book on one device
are not coordinated and can still meet as a conflict.)
Tests: `tests/manuscripts.test.ts`.

## Local-first saving (studio)

The studio saves the open book **on the device first**, signed in or
not, online or not:

- **IndexedDB** (`beuk-local` → store `kv`): the whole `serializeBook()`
  document — text, settings, cover, images and uploaded fonts (base64
  inside the document), History snapshots — plus the sample-story
  bookkeeping and the shelf link. Written ~800 ms after the writer
  pauses and again on `visibilitychange → hidden` / `pagehide`, in one
  `durability: "strict"` transaction that moves the previous record to
  `book-prev` first; a record that fails to parse falls back to it.
- **Boot restore** happens before the desk is shown. Signed in, the
  device copy is reconciled with the shelf: only the shelf moved → the
  shelf copy opens; only the device moved → it is pushed; both moved →
  the conflict notice. Removing the sample story clears the saved desk
  too, so it never comes back on reload.
- **Header indicator:** `Saving…` / `Saved on this device ✓` / honest
  failures (`Not saved — this browser is blocking storage`, `… storage
  is full`, other errors by name), with **Export a backup** (a
  `.beuk-backup.json` file the indicator can also open again). The
  studio calls `navigator.storage.persist()`; when the browser declines,
  the indicator says the copy may be cleared under storage pressure.
- A `beforeunload` prompt is attached **only** while a device save is
  pending or failing.
- **Limits, stated plainly:** writing typed in the last ~0.8 s before a
  hard crash (no `pagehide`) may be lost; a private window's storage
  ends with the window; the browser can still evict the copy if it did
  not grant lasting storage — export a backup now and then.

**Offline completeness:** JSZip 3.10.1, mammoth 1.6.0, lucide 0.469.0
and jsPDF 2.5.2 are vendored in `client/assets/vendor/` (byte-identical
to the CDN releases, pinned with SRI; the Housekeeping case
`infra.deploy.vendored-libraries` re-hashes them) and precached by the
service worker (cache `beuk-shell-v2`; both `client/sw.js` and
`client/assets/sw.js`). Google Fonts are browser-specific and cannot be
precached ahead of time: the page hands the worker the stylesheet and
the font files it actually loaded, so faces the studio has displayed
online open offline; any other face falls back to the system fonts in
its stack.

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
at a time** (one Hetzner box; the tools are heavy) with a per-step
timeout — an overrun is killed, process group and all, and fails
with the timeout stated: `JOB_TIMEOUT_MS` (default 2 minutes) for
EPUBCheck and for the pdfx job's renderer request, and
`PDFX_TIMEOUT_MS` (default 15 minutes) for the pdfx job's Ghostscript
step. The split is measured: on the bundled 81-page / 7.5 MB sample
(2026-10-24, beuk-icc stack) the whole job took 99 s, of which the
renderer was ~6 s (timed on its own) and Ghostscript the rest, because PDF/X-1a forbids transparency and Ghostscript flattens
every page that has any by rendering the whole page to a 300 ppi
image (70 of the sample's 81 pages). 15 minutes is an operational
allowance for longer, picture-heavier books, not a measured limit. On boot,
jobs a dead process left `running` are failed honestly and `queued`
ones are picked up again.

Admission is capped so one account can't flood that single worker:
a user may hold at most `JOB_MAX_ACTIVE_PER_USER` jobs (default 2)
queued or running at once — the next create answers **429** with the
reason — and the whole server at most `JOB_MAX_QUEUED` (default 20) —
the next answers **503**. Refused requests create no job. The counts
are taken under a Postgres advisory lock, so simultaneous requests
can't both slip past a cap. These caps apply to every job kind (they
share the one worker), EPUBCheck and PDF/X alike.

- **EPUBCheck** runs as `java -Xmx$JAVA_MAX_HEAP -jar $EPUBCHECK_JAR <file> --json <report>`
  (`JAVA_MAX_HEAP` defaults to `512m`; only `<digits>[k|m|g]` is
  accepted, anything else falls back to the default, so the setting
  can't smuggle in other JVM flags). A book that needs more heap fails
  with the JVM's OutOfMemoryError in its result instead of starving
  the box. 512m is an operational default, not a measured EPUBCheck
  requirement — raise it if large books hit it.
  and the JSON report is parsed into counts (fatal / error / warning /
  info / usage) plus the message list (code, severity, message,
  location) stored on the job. A book WITH findings is a `done` job
  whose result says `passed: false` — the job succeeded, the book
  didn't, and the result never blurs the two.
- **PDF/X** first renders the print-html interior to PDF in the
  isolated **renderer** service (below), then runs Ghostscript with
  the PDF/X-1a recipe in `src/jobs/tools.ts` (`-dSAFER`, `-dPDFX`,
  prepress settings, everything converted to DeviceCMYK) fed the
  definition file
  `tools/PDFX_def.ps`, which declares the `GTS_PDFX` OutputIntent and
  embeds the CMYK ICC profile it points at. On success the converted
  PDF is stored back into the user's archive as a new export
  (format `pdfx`, filename `…-pdfx.pdf`, linked to the source's
  manuscript) and the job's `artifactExportId` points at it.
  Ghostscript 9.50+ runs with `-dSAFER` on by default, which refuses
  the definition file's read of its ICC profile (`/invalidfileaccess`,
  observed on Ghostscript 10.00.0), so the job passes
  `--permit-file-read=<that one profile>` — read from the
  `/BeukICCPath` line — and keeps SAFER on for everything else. The
  definition file declares both `GTS_PDFXVersion (PDF/X-1:2001)` and
  `GTS_PDFXConformance (PDF/X-1a:2001)`; without the second key a file
  only claims PDF/X-1:2001.
  Chromium writes the book's links as Link annotations, which PDF/X
  forbids; Ghostscript 10.00.0 then prints "…not permitted in PDF/X,
  reverting to normal PDF output" and exits 0 while the definition file
  has already stamped the PDF/X keys — a file that *claims* PDF/X-1a
  and is not (seen on the sample: its pages lost their TrimBox). The
  job therefore passes `-dShowAnnots=false -dPreserveAnnots=false`
  (links mean nothing on paper), and any such revert notice fails the
  job with Ghostscript's own words instead of archiving the file.
- **PDF/X inspection (Store-ready tie-in).** After conversion the job
  reads the converted file itself (`src/jobs/pdfinspect.ts`, no
  dependencies) and stores the facts on the result as `inspection`:
  page count, the first page's MediaBox/TrimBox/BleedBox in inches,
  the declared `GTS_PDFXVersion` / `GTS_PDFXConformance` and whether a
  `GTS_PDFX` OutputIntent is present, every font with an `embedded`
  flag (a FontDescriptor carrying `/FontFile`, `/FontFile2` or
  `/FontFile3`; Type 3 fonts count as embedded), and how many RGB
  colour references remain. It reports what the file *declares and
  contains* — it is not a PDF/X validator, and anything it cannot read
  stays `null`, never a pass.

**Tool gating is honest, in the M2-billing tradition.** Availability
is checked when the job runs: if EPUBCheck's jar is unset/missing,
or Ghostscript isn't configured/runnable, or the PDF/X definition
file is absent, the job still completes — as **failed**, with
"not configured on this server" and the specifics in its result.
No pass is ever fabricated, no result is ever invented; a tool that
runs is believed exactly as far as its own output (Ghostscript must
exit 0 AND leave a non-empty file).

### The renderer sandbox (print-html → PDF)

A print interior is **user-supplied HTML**, so the browser that
prints it never runs in the app container (which holds
`DATABASE_URL`, the Stripe keys, and the export/backup volumes, and
can reach the database). It runs in its own service, `renderer`
(`deploy/renderer/`: `node:24-slim` + Debian's `chromium` +
`puppeteer-core`, nothing else), wired in by the tools overlay. The
app POSTs the HTML to `RENDERER_URL` (`http://renderer:3100/render`)
and gets the PDF back. Container fences (`deploy/docker-compose.tools.yml`):

- its only network is `render`, declared `internal: true` and shared
  with the app alone — no route off the host, and the database is not
  on it;
- no volumes; read-only root filesystem with a 512 MB tmpfs `/tmp`;
- `cap_drop: [ALL]`, `no-new-privileges`, runs as `node`;
- `mem_limit` 1536m, `cpus` 1.5, `pids_limit` 256;
- no secrets in its environment.

In-browser fences (`deploy/renderer/server.mjs`): every request the
page makes is intercepted and aborted except the one navigation that
delivers the document itself (`data:` URIs — the interior's images
and uploaded fonts — never touch the network); the document is served
with a CSP that forbids scripts, frames, objects and connections;
JavaScript is disabled (the studio's `buildPrintHtml` emits CSS and
markup only); Chromium's resolver maps every host to NOTFOUND and all
traffic goes to a dead proxy; each job gets a fresh browser and
profile in tmpfs, a hard timeout (`RENDER_TIMEOUT_MS`, default 90 s,
then SIGKILL), an input cap (`RENDER_MAX_BYTES`, defaults to
`EXPORT_MAX_BYTES`), and one render at a time. Chromium runs with
`--no-sandbox` because its own sandbox needs user namespaces or a
setuid helper, which Docker's default seccomp profile plus
`cap_drop: ALL` forbid — the container is the sandbox boundary. The
print parameters match the old in-app `--print-to-pdf` call
(`printBackground` and `preferCSSPageSize` on, tagged PDF, no
header/footer).

One residual, stated plainly: the renderer **container** can open a
TCP connection to `app:3000` on the shared internal network (the same
public API Caddy already serves). The browser inside it cannot — the
interception, resolver and proxy fences stop it, and the proof below
checks exactly that.

`HTML_PDF_BIN` (Chromium inside the app container) is **retired**: if
it is still set and `RENDERER_URL` is not, pdfx jobs fail as "not
configured" and the message says `HTML_PDF_BIN` is ignored and why.

**Prove it:** `./deploy/renderer-attack.sh` builds an isolated copy of
the tools stack (own compose project and image names, no Caddy, no
host ports), plants canary secrets in the app's environment and
canary files on its volumes, submits `deploy/renderer-attack/attack-print.html`
(iframes/objects/images/CSS imports/scripts aimed at
`file:///proc/1/environ`, `/data/exports`, `/data/backups`,
`http://db:5432`, `http://app:3000/api/health`, the renderer's own
port, cloud metadata and `https://example.com`) plus a legitimate
interior through the real API, extracts the PDFs' text with
`pdftotext`, and fails on any leak. It also checks the renderer
container's env, mounts, capabilities and network reach, and renders
the same hostile page the old way as a control, to show the fixture
does catch a leak when one is possible. `STUDIO_HTML=<file>` also
renders a real studio interior; `KEEP=1` leaves the stack up.

**Production setup (on the Hetzner box, once):**

1. Use the tools overlay (`deploy/install.sh` does): it extends the
   app image with a JRE, Ghostscript and ICC profiles, and builds and
   starts the isolated `renderer` service. The stock Compose image
   deliberately does not carry them.
2. Download the EPUBCheck release zip from
   <https://github.com/w3c/epubcheck/releases>, unpack it somewhere
   the app can read, and set `EPUBCHECK_JAR` to its `epubcheck.jar`
   (mount the directory into the app container if it lives on the
   host; `JAVA_BIN` only if `java` isn't on the PATH).
3. Set `GS_BIN=/usr/bin/gs` in `.env`.
4. `RENDERER_URL` points the pdfx job at the renderer service (the
   tools overlay sets `http://renderer:3100/render` for you). Do not
   install Chromium into the app image instead — see the renderer
   sandbox above.
5. **ICC profile (installed by the tools overlay):**
   `deploy/Dockerfile.tools` downloads IDEAlliance's
   `SWOP2006_Coated3v2.icc` from the ICC Profile Registry
   (<https://registry.color.org/profile-registry/SWOP2006_Coated3v2>) to
   `/usr/share/color/icc/beuk/` and refuses any bytes but sha256
   `27dc90db…15e3b` (its ICC profile ID equals the registry's,
   `f7b89b04…a98`). `tools/PDFX_def.ps` embeds it as the OutputIntent's
   DestOutputProfile with `OutputConditionIdentifier (CGATS TR 003)` and
   `RegistryName (http://www.color.org)` — the registry's reference name
   for "SWOP proofing and printing on U.S. Grade 3 coated publication
   paper" (<https://registry.color.org/cmyk-registry/cgats_tr_003>).
   **Why this one:** IngramSpark's File Creation Guide requires
   PDF/X-1a:2001 or PDF/X-3:2002 and total ink ≤ 240% but names no press
   condition; KDP asks for CMYK and names none either; the only named
   profile found is second-hand (a forum quote of IngramSpark's FAQ:
   "U.S. Web Coated (SWOP) v2"), and Adobe's licence forbids bundling that
   one with software. The IDEAlliance profile is the redistributable US
   SWOP profile ("may be used, embedded, exchanged, and shared without
   restriction"; not altered or sold) — attribution in
   `tools/icc/LICENSE-SWOP2006_Coated3v2.txt`, copied into the image.
   Housekeeping's `jobs.pdfx.icc-profile-matches-def` check verifies the
   definition file, the installed file's hash and its profile ID agree
   (the file itself only when `GS_BIN` is set or the file is present —
   otherwise its detail says it was not checked). Outside the tools
   image, put that exact file at that path. Debian's `icc-profiles-free`
   has no CMYK press profile, and non-free `icc-profiles` 2.1-2 ships an
   older `SWOP2006_Coated3v2.icc` build whose profile ID does not match
   the registry's, so neither is used.
6. Restart the app. Until steps 1–5 are done, jobs answer with the
   not-configured failure above; the moment they are, the same jobs
   run for real with no code change.

Residual limits, stated plainly. First, the unit tests run the
pipeline around the tools — gating, queueing, admission caps, the
HTTP rendition call, timeouts, report parsing, archive storage, the
PDF/X-revert failure — with stubs wired through the same
`JAVA_BIN`/`GS_BIN`/`RENDERER_URL` settings. The real binaries run in
`deploy/renderer-attack.sh` (EPUBCheck 5.2.1 under `-Xmx`, the
renderer's Chromium, Ghostscript 10.00.0). **Real run through the
renderer service (2026-10-24, compose project `beuk-icc`, tools image
built from `deploy/Dockerfile.tools`):** the bundled sample's 6 × 9 in
print interior (7 571 328 bytes of HTML) went through `POST
/api/jobs/pdfx` and finished `done` in 99 s — 81 pages, MediaBox =
TrimBox = BleedBox = 6 × 9 in, declared `PDF/X-1:2001` +
`PDF/X-1a:2001`, one GTS_PDFX OutputIntent `CGATS TR 003` whose
embedded DestOutputProfile is byte-identical to the pinned profile
(same sha256), both fonts embedded (pdffonts: emb yes), no
annotations, no transparency, no RGB colour spaces, `qpdf --check`
clean, PDF 1.3. An old open-source checker (the `preflight` 0.3.0 Ruby
gem's PDF/X-1a profile) reported 0 issues on it, against 2 418 on the
Chromium PDF and 81 (no TrimBox) on the output of the previous flags,
which had silently reverted to plain PDF. That gem is far narrower than
a commercial preflight (Acrobat, PitStop, callas): **the file is not
independently validated as PDF/X-1a.** Known gaps in that file:
**111 MB** (70 of 81 pages are flattened to 300 ppi page images,
*including their text*, because Chromium writes opacity — ornaments at
`opacity=".8"`, captions and kickers at 0.75–0.88 — and alpha images);
body text comes out **4-colour rich black, ~68/66/70/80 = 284% total
ink** (measured from the rendered CMYK), where IngramSpark asks for
100% K text and ≤ 240% total ink; the CMYK numbers come from
Ghostscript's built-in conversion — `-sOutputICCProfile` (the SWOP
profile or Ghostscript's `ps_cmyk.icc`) changed not one value on
pdfwrite 10.00.0 in our probe — so they are **not** computed through the
SWOP TR 003 profile the OutputIntent declares; and the interior is **set
in DejaVu Serif, not the book's faces** (the print-html names its fonts
but does not carry the studio's Google web fonts; the Store-ready report
flags that as an advisory row). Second, **Ghostscript converts PDF
input**: a pdfx job first renders the archived print-html interior to
PDF in the renderer, then converts that PDF to PDF/X-1a. If the
renderer is not configured, the job fails honestly as "not configured"
before Ghostscript ever runs — raw HTML is never fed to Ghostscript.
Third, **the ICC profile**: Ghostscript (≥ 9.50) runs SAFER by
default, so `PDFX_def.ps` may read its ICC profile only when that file
is explicitly permitted — the job passes `--permit-file-read=` for
exactly the `BeukICCPath` file (without it every pdfx job failed with
`/invalidfileaccess`). If the profile is missing (no tools image),
pdfx jobs fail as "not configured", never a fake pass.

## Store-ready? report (studio + jobs)

The studio's Export dialog opens with a **Store-ready?** button: one
pass/fail report for **Amazon KDP** or **IngramSpark**, paperback or
hardcover, for the chosen ink and paper. The rules are data
(`STORE_RULES` in `client/index.html`), each table citing the store's
own guide: KDP's trim/page-range/margin table, cover-calculator spine
factors, file-format and barcode help pages, and IngramSpark's File
Creation Guide (rev. 8.24.26) plus its Paper Specifications sheet.
Every row is **pass / fail / warn / not checked**, with what was
measured and, for failures, a concrete fix (one click where the
studio can make it: switch trim, follow the book's trim or page
count, use the store's spine factor; otherwise a jump to the
chapter, the print settings or the cover maker).

- Checked in the browser: trim against the store's list for the
  chosen paper (IngramSpark's Trim Size Matrix marks each trim per
  paper: a trim listed but blank for that paper is "not checked" when
  it fits the custom-trim range — the matrix only says such sizes *may*
  be available — and a fail when it doesn't; colour papers have no
  published custom range, so off-matrix colour trims are "not
  checked"), page count against the range for that trim + ink + paper
  (IngramSpark: the matrix's per-paper range, e.g. crème 18–1,050,
  50# white 18–1,200, 11 × 8.5 capped at 400), margins/gutter (KDP minimums; IngramSpark's
  0.5 in recommendation is advisory), every placed picture's DPI at its
  printed size, bleed (full-page plates and chapter backdrops reach the
  trim edge, and Beuk's interior has no bleed — so they fail), and the
  wrap: same trim and page count as the interior, spine = pages × the
  store's published factor, spine-text rules, barcode area (drawn and
  measured, text overlap tested), cover artwork DPI, bleed, RGB colour
  (advisory), and IngramSpark's PDF/X requirement for cover files.
- Checked by the server ("Run full server check", signed in): the
  studio archives the print interior and the EPUB, runs the existing
  `pdfx` and `epubcheck` jobs, and folds in the pdfx job's
  `inspection` — fonts embedded, declared PDF/X + OutputIntent + no
  RGB, the real page count and page size — and EPUBCheck's result.
  Signed out, local-only, tools unconfigured, still running or stale
  (the book changed since), those rows say **not checked** and why.
- **The verdict is "Ready for <store>" only when every required row
  passed.** Any required failure → "Not ready — N blocking issues";
  otherwise any required row that couldn't run → "Can't confirm —
  M checks couldn't run". Advisory rows never decide it. Unverifiable
  numbers are not invented: KDP publishes no groundwood spine factor
  (spine "not checked"), IngramSpark's exact spine exists only in its
  per-book cover template (the paper-bulk estimate is shown; the writer
  can confirm against their template), and total ink coverage (240%)
  is never measured.
- **Download report** saves a self-contained HTML file: book title,
  store, binding, ink/paper, trim, page count (estimated or counted),
  ISO timestamp, the verdict, every row with its evidence and fix, and
  the source URLs.
- Hardcover covers (case laminate / dust jacket) are "not checked":
  Beuk's wrap is a paperback wrap.

## Billing

Pricing is **parked**; this is plumbing that works for any pricing V
picks. Nothing is live until the keys, a price and an entitlements file
are set, and **no route is gated yet**.

**Principle: store what Stripe says, derive access from data.**

- **Webhook** (`POST /api/billing/webhook`) verifies `Stripe-Signature`
  (HMAC-SHA256 over the raw body, `v1` only, 5-minute replay window), then:
  1. **Mode check.** The server's mode comes from the API key prefix
     (`sk_test_`/`rk_test_` = test, `sk_live_`/`rk_live_` = live; an
     optional `STRIPE_MODE` must agree or billing refuses to run). An
     event whose `livemode` differs is recorded as `ignored-wrong-mode`
     and changes nothing, so a test `whsec_` left on a live server cannot
     flip real accounts.
  2. **Dedupe.** Every event id goes into `billing_events`; a redelivery
     of a processed event answers `{duplicate:true}` and does nothing. A
     delivery whose handling failed answers 500, stays unprocessed, and
     Stripe's retry is processed normally.
  3. **Retrieve, don't trust the body.** The event only says which object
     changed; the server retrieves the current Subscription from the
     Stripe API (under a per-subscription lock) and stores that in
     `billing_subscriptions`. Delivery order therefore does not matter: a
     late "updated(active)" after "deleted" cannot re-grant anyone.
- **Handled events** (register these on the endpoint):
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `customer.subscription.created`,
  `.updated`, `.deleted`, `.paused`, `.resumed`, `invoice.paid`,
  `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.
  Anything else is acknowledged as `ignored-type`.
- **Async payments.** A completed checkout with `payment_status: unpaid`
  (bank debits) grants nothing (`awaiting-payment`); access comes with
  `async_payment_succeeded` or a subscription Stripe reports as active.
- **Attribution, no guessing.** Our user id (checkout
  `client_reference_id` / metadata, copied onto the subscription's
  metadata), then the stored Stripe customer id. **Never the email.** A
  subscription that cannot be attributed is stored with no account and
  the Housekeeping self-check `billing.subscriptions.attributed` fails,
  listing it.
- **Status policy** (`src/entitlements.ts`; `entitlementsFor` is the only
  place access is decided): `active`/`trialing` grant; `past_due` grants
  for `BILLING_GRACE_DAYS` (default **7**), counted from when this server
  first saw `past_due`; `canceled`, `unpaid`, `incomplete`,
  `incomplete_expired` and `paused` grant nothing. Refunds and disputes
  re-sync the customer's subscriptions and **follow the status Stripe
  reports**: cancel the subscription in the Dashboard to end access.
  Only subscriptions in the server's own mode count.
- **Entitlements are data** (`ENTITLEMENTS_FILE`):

  ```json
  { "prices": { "price_REPLACE_ME": { "label": "REPLACE_ME", "entitlements": ["replace.me"] } } }
  ```

  A price not in the file grants nothing. `users.plan` is now only a
  cached display label (the file's `label`, else `pro` while granted,
  `free` otherwise). It can lag after a grace period ends;
  `/api/billing/status` is computed live.
- **A lapsed writer loses nothing they wrote.** Books, saving, exports and
  beta-reader links never check billing (tested). `requireEntitlement()`
  exists but is applied to **no route** until V's pricing names a gated
  feature, and it must never wrap reading, listing, exporting or sharing
  a writer's own work.
- **Checkout** reuses the writer's stored Stripe customer, accepts only
  allow-listed prices (the entitlements file plus `STRIPE_PRICE_ID`),
  refuses a second subscription (409), and its `success_url` carries
  `{CHECKOUT_SESSION_ID}`. A landing page must wait for
  `/api/billing/status`, never claim access from the redirect.
- **`GET /api/billing/status`**: `live` is true only when billing is fully
  configured (keys + price, consistent mode, valid entitlements file)
  **and** in live mode. Test-mode keys give `configured: true, live:
  false` (show a TEST MODE badge; the Ko-fi jar stays).
- **Housekeeping self-checks**: `billing.mode.matches-key`,
  `billing.entitlements.file-valid`, `billing.events.none-stuck` (nothing
  unprocessed for over an hour), `billing.subscriptions.attributed`.
- **Not built yet**: a Customer Portal route (cancel / update card) and
  any studio billing UI. Until then cancellations and card changes
  happen in the Stripe Dashboard.

**Enabling billing (V's step; prices and keys are his):**

1. In Stripe: create the product(s) and recurring price(s); register the
   webhook endpoint `https://beuk.studio/api/billing/webhook` for the
   event types above (test and live endpoints have different secrets).
2. Write the entitlements file and mount it read-only into the app
   container (for example a compose-override `volumes:` line
   `./entitlements.json:/app/config/entitlements.json:ro`); set
   `ENTITLEMENTS_FILE` to the in-container path.
3. In the server's `.env` only: `STRIPE_PRICE_ID` (`price_…`),
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (`whsec_…`) and
   `APP_BASE_URL`; optionally `STRIPE_MODE` and `BILLING_GRACE_DAYS`.
4. Restart, run Self-checks, then prove it in a sandbox with
   `stripe listen --forward-to …` plus `stripe trigger <event>` for each
   handled type before switching to live keys. Until all of that is set,
   checkout and the webhook answer a clean **501 `billing not configured`**.

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

## Account basics: password reset + email

There is now a way back into an account: **forgot password → emailed
link → new password**, plus **change password** and **sign out
everywhere** for a signed-in writer (studio: the sign-in dialog's
"Forgot password?" and the shelf dialog's "Account & security").
Email verification on signup is **not** implemented.

**Mail (`src/mailer.ts`).** Outgoing mail goes through nodemailer over
`SMTP_URL` (a nodemailer connection URL: `smtp://user:pass@host:587`
upgrades with STARTTLS when the server offers it; `smtps://…:465` is
implicit TLS) from `MAIL_FROM`. A message counts as sent only when the
SMTP server accepted it. **Until both are set, no email is sent and
none is ever reported as sent:** Housekeeping says "email not
configured", the forgot-password response carries
`emailDelivery: "not-configured"` (the same for every address — it is
a server-wide fact), and the studio tells the writer no message will
arrive. With `MAIL_LOG_LINKS=true` (default whenever `NODE_ENV` is not
`production`; the Docker image runs `production`, so set it explicitly
for a local stack) the would-be message, reset link included, is
written to the app log instead — for local use only, since the link
is a live credential.

**Reset tokens** are 32 random bytes in the link only; the database
(`password_resets`, migration 010) keeps their SHA-256 hash, an
`expires_at` of now + 60 minutes and a `used_at` stamp. Consuming one
is a single atomic `update … where used_at is null and expires_at >
now()`; success sets the new argon2id hash, deletes every session of
the user, and spends any other outstanding links. A too-short new
password is refused before the token is touched. Changing the
password while signed in also spends outstanding links.

**No account enumeration.** `/forgot` answers before it looks anything
up (the token + email work runs after the response), so known and
unknown addresses get the same status, body and timing. Limits, per
app instance (in memory): 10 forgot requests per IP per 15 minutes
(then **429** with `Retry-After`), 3 per address per hour (beyond that
the same 200 is returned but nothing is sent — no mail-bombing an
inbox), 20 reset attempts per IP per 15 minutes, 10 change-password
attempts per user per 15 minutes. Per-IP limits need the real client
IP behind Caddy: the app sets Express `trust proxy` from
`TRUST_PROXY_HOPS` (default 1 = Caddy; see Hardening).
This also makes the Founders' Shelf per-IP throttle per real client.

**Enabling email (Vik's step, the credentials are his):** set
`SMTP_URL` and `MAIL_FROM` in `.env` (any SMTP provider; the From
domain should be one the provider is allowed to send for), restart,
then in Housekeeping run `POST /api/housekeeping/mail/test` (sends one
message to your own address and reports what the SMTP server said) and
a Self-checks run (`auth.mail.delivery-state-honest` connects and
authenticates). `SMTP_URL` is treated as a secret: scrubbed from every
Housekeeping output and excluded from backups by name.

## Beta-reader share links

A signed-in writer shares a **frozen, read-only copy** of a shelf
manuscript with beta readers, who read it in the browser and comment
without an account. Migration `011_shares.sql` adds `shares`,
`share_comments` and `share_readers`.

**Owner API** (signed in; every query owner-scoped — another writer's
share or comment is a 404, never a 403):

| Endpoint | What |
|---|---|
| `POST /api/shares` | `{manuscriptId, title?, expiresAt?\|expiresInDays?, allowComments?, readerNameRequired?}` → `201 {share, token, path}`. The token (32 url-safe chars, 192 random bits) is returned **this once**; only its SHA-256 is stored, like session tokens |
| `GET /api/shares[?manuscriptId=]` | the caller's links: `status` (`active` / `revoked` / `expired`), `readerCount`, `commentCount`, `openCommentCount`, `sectionCount`, dates — never the token |
| `PUT /api/shares/:id` | `{expiresAt: ISO\|null, expiresInDays?, allowComments?, readerNameRequired?, title?}` — a past expiry is a 400; `null` clears it |
| `POST /api/shares/:id/republish` | re-renders the copy from the shelf manuscript's current text (409 if revoked, or if the manuscript was deleted) |
| `POST /api/shares/:id/revoke` · `DELETE /api/shares/:id` | close the link (410 from then on) · remove it and its comments |
| `GET /api/shares/:id/comments` · `GET /api/shares/comments?manuscriptId=` | comments on one link · on every link of one manuscript (the studio's panel) |
| `POST /api/shares/:id/comments/:cid/resolve` · `…/unresolve` · `DELETE …/:cid` | |

**The frozen copy.** At share time (and on every republish) the server
renders the studio's book JSON into one HTML body per readable section
(`src/shares/render.ts` — a port of the studio's own text format:
paragraphs, `#`/`##` headings, `>` quotes, scene breaks, `img:` pictures,
`[^n]` notes, `*em*`/`**strong**`). Every piece of book text is
HTML-escaped before markup is added, and the result then passes an
allowlist sanitizer (`src/shares/sanitize.ts`) — at share time **and
again at serve time**: no `<script>`, no `on*` handlers, no `style`, links
only to in-page `#` anchors, images only from the share itself
(`/read/<token>/img/<id>`, raster types only — SVG never ships) or
`data:image/(png|jpeg|gif|webp)`. Cover, contents and title pages are
replaced by the reader's own header; excluded sections are left out.
Each block carries `data-p` = its block index in the section's text
(the studio's blank-line split), which is how a comment anchors back to
its paragraph.

**The reader** (`GET /read/:token[?c=n]`, `src/shares/reader.ts`): the
Paper look of the help pages (`/help/warmth.css`), chapter navigation
that works without JavaScript, mobile-first. Security headers: a CSP of
`default-src 'none'` with a per-response nonce for the one small comment
script and its stylesheet (no inline handlers anywhere),
`Referrer-Policy: no-referrer` (the token is in the URL),
`X-Frame-Options: DENY`, `nosniff`, `noindex`, `no-store`. The owner's
email and account id are never rendered. A revoked or expired link gets
a calm **410** page; an unknown token a calm 404. Caddy proxies `/read*`
to the app, and both studio service workers leave `/read/` uncached.

**Comments** (`GET|POST /read/:token/comments`): select a passage → a
"Comment on this" button anchors the comment to section + paragraph +
quoted text; or comment on the chapter as a whole. Caps: body 2000
chars, name 60, quote 500. A hidden honeypot field (`website`) gets an
ordinary-looking 202 and nothing is stored. Rate limits (in-memory, per
app instance): **10 comments per IP per share per 10 minutes** and **200
per share per hour** → 429. The client IP is the last
`X-Forwarded-For` entry — Caddy, with no `trusted_proxies`, ignores
client-sent values and sets it itself
(<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults>);
direct connections use the socket address. Stored per comment: an
`ip_hash` (SHA-256 of share id + IP) for abuse review — an IPv4 hash is
brute-forceable, so this is abuse control, not anonymity. The public
comment list carries reader name, text, quote and time only (no IP hash,
no resolved state), and is visible to everyone holding the link.

**Reader count** = distinct browsers that opened the link: an opaque
`beuk_reader` cookie (path `/read`, http-only), stored only hashed with
the share id.

**Studio.** Export → *Share with beta readers*: create a link (expiry,
comments on/off, ask for names) with a copy button; this book's links
with status, reader and comment counts; republish; revoke. Signed out,
or with no server, the section says why and makes no calls. Because the
server keeps only a hash, the studio remembers the tokens it created in
this browser (`localStorage`, a convenience) — on another device a link
can't be copied again; create a new one. The sidebar's *Reader
comments* lists comments grouped by section in book order, jumps to the
quoted passage in the editor (falling back to the paragraph, and saying
so when the passage has changed), and resolves/reopens. Reader-page
wording is English only for now; the studio surfaces carry all 13 UI
locales.

## Housekeeping (M3)

The admin surface for the app itself — never customer-facing, and it
does not reveal itself: every route under `/api/housekeeping/*` answers
**404** to anonymous callers and ordinary users alike. Fixed named
actions only — no shell, no arbitrary commands, no free-form paths.
Mutating actions take **one global lock** (a concurrent attempt gets
**409**), every action writes an **audit row**, and every output —
responses, audit summaries, generated manifests — passes through a
**secret scrubber** that redacts the configured secret values
(database URL/password, Stripe keys, SMTP URL/password).

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
| Evidence | `GET /offsite` — scheduled, off-site (restic → B2) and drill status, "not configured" until set; `POST /offsite/run` — back up now and copy off-site; `POST /offsite/drill` — restore drill of the latest off-site snapshot (both 409 when not configured) |
| Evidence | `GET /audit` — recent audit rows |
| Founders' Shelf | `GET /founders` — the M4 seed-list applications (read-only, audited) |
| Mail | `GET /mail` — whether email can be sent ("email not configured" until `SMTP_URL` + `MAIL_FROM`; credentials never shown); `POST /mail/test` — one test message to the admin's own address, 409 when not configured, 502 when the SMTP server refuses |

**Self-checks registry:** cases ported from the coverage registry,
plus later additions (`GET /api/housekeeping/actions` reports the live
totals: `cases`, `server`, `clientOnly`). The server-side cases cover
infra (DB reachable, migrations current,
export volume writable), data invariants (no orphaned export
files/rows, archive SHA-256 re-verification, streak ledger
consistency), and package assertions over fixture EPUBs (cover /
preset / landmark / alt-text style checks, box-set and DOCX structure,
and the validator cases run against deliberately damaged packages),
plus account basics (mail delivery state, the `/reset` page in the
deploy tree, reset-token schema). The rest are registered as
**`client-only`** with a one-line reason each
(theme application, print CSS, word counts, the ACX audio script — inherently client-UI
state): reported in every run, never silently dropped, never faked
as passing. A case whose feature is switched off on this server
(scheduled backups, the off-site copy and its drill) reports
**`not-configured`** with the missing setting names: never a pass, and
it does not fail the run (`counts.notConfigured`). Runs are stored in
`housekeeping_check_runs`.

**Backups** live under `BACKUP_DIR` (Compose: the `backupdata` volume),
one directory per named backup: `manifest.json` (contents + hashes),
`db.json` (logical dump of the data tables), `settings.json`
(non-secret config — **secrets are excluded by name**, listed in the
manifest), and `files/` (a copy of the export volume). Every table is
classified in `src/housekeeping/backup.ts`: `BACKUP_TABLES` (users,
manuscripts, streaks, exports, jobs, sessions, Founders' Shelf
applications, share links, reader comments and reader records, billing
subscriptions and the billing webhook event ledger) or
`EXCLUDED_TABLES`, each with its reason, also written into every
manifest: the audit, check-run and sign-off tables (evidence is
append-only and a restore must not rewrite it), `schema_migrations`
(owned by the migration runner) and `password_resets` (live reset
tokens: a restore **deletes** them all, so no link issued before the
restore keeps working). The self-check `data.backup.tables-classified`
and a server test fail the day a migration adds a table that is in
neither list. The dump is read inside one `REPEATABLE READ READ ONLY`
transaction, so it is one consistent snapshot across tables; the
manifest's `consistency` field records the mode Postgres reported.
All file writes are atomic (temp + rename).

**Restore is on** (`RESTORE_ENABLED`, default `true`). Set
`RESTORE_ENABLED=false` to turn it off: `POST /restore` then answers 503
with the reason and touches nothing. Restore puts back every table in
`BACKUP_TABLES`, share links, comments, readers and jobs included
(proven by `tests/restore-coverage.test.ts`: a share with two comments,
a reader and a job survive backup → change → restore, and the
`pre-restore-…` snapshot carries them too). `jsonb` values are
re-inserted as JSON text with an explicit cast; before that fix a job
result or share snapshot whose top-level value was an array made the
whole restore fail on real Postgres ("invalid input syntax for type
json"; the transaction rolled back). A backup taken before shares and
jobs were backed up is **refused by name** (409): restoring it would
delete every row of those tables. Still not done (plan Phase 3): no
schema-version gate, no dry-run, the export-volume swap is not atomic,
and the app keeps serving during a restore.

**Restore is two-step:** `POST /restore/preview` returns a per-table
diff summary and a short-lived preview id; `POST /restore` requires
that preview id **and** `confirmed: true`. It snapshots the current
state first (a `pre-restore-…` backup), restores, then verifies by
re-running Self-checks and reports the result. The export directory
is emptied and refilled, never removed (in Compose it is a volume mount
point; removing it failed with EBUSY after the database had already
been restored).

### Scheduled and off-site backups

**Scheduled local backups.** The app makes one named backup
(`scheduled-<timestamp>`) every `BACKUP_INTERVAL_HOURS` (default 24;
`0` turns the schedule off). A cheap due-check runs 30 s after boot and
then every 15 minutes; the backup itself runs under the Housekeeping
lock (it waits for a running restore or rehearsal) and every step is an
audit row with actor `scheduler` (`backups.scheduled`, `offsite.backup`,
`offsite.drill`). A failed backup is audited as `error`, retried hourly,
and turns the self-check `backup.schedule.running` red. **Local backups
are never deleted automatically**: how many to keep on the box is not
decided yet, so watch the `backupdata` volume's disk use (each backup
copies the whole export volume).

**Off-site copies (restic → Backblaze B2).** After each scheduled
backup, and on `POST /api/housekeeping/offsite/run`, the app copies that
backup directory into a restic repository in a private B2 bucket, then
applies retention with `restic forget --group-by host,tags --keep-daily 7
--keep-weekly 4 --keep-monthly 12 --prune` (`RESTIC_KEEP_*`). Why these
choices:

- **S3-compatible API, not restic's `b2:` backend.** restic's own docs:
  "Due to issues with error handling in the current B2 library that
  restic uses, the recommended way to utilize Backblaze B2 is by using
  its S3-compatible API"
  (https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).
  Backblaze's restic guide uses the same S3 form
  (https://www.backblaze.com/docs/cloud-storage-integrate-restic-with-backblaze-b2).
  The app builds `RESTIC_REPOSITORY=s3:<endpoint>/<bucket>/<prefix>`.
- **Encrypted before upload.** restic encrypts every pack, index and
  snapshot with the repository password; the bucket never sees
  plaintext (proven below).
- **`--group-by host,tags`.** restic groups snapshots by host and paths
  by default (https://restic.readthedocs.io/en/stable/060_forget.html);
  every backup here has its own directory name, so with the default
  nothing would ever be forgotten.
- **restic 0.19.1, pinned.** The `Dockerfile` downloads the release
  from GitHub and checks the sha256 published in its `SHA256SUMS`
  (amd64 and arm64); any other bytes fail the build. It also copies a
  CA bundle into the image (`node:24-slim` has none; restic needs it
  for B2's TLS).
- **Credentials only via env.** The five settings below go in `.env`.
  Each restic call gets a minimal environment (repository, password,
  the two S3 keys, a cache dir): the database URL, Stripe and SMTP
  secrets never reach it, nothing secret is on its command line, and
  the restic password and both B2 key values are added to the secret
  scrubber, so no Housekeeping response, audit row or status file can
  carry them.
- **A wrong key fails fast and by name.** restic 0.19.1 does not exit
  on a bad key or a missing bucket; it keeps retrying with backoff
  (seen against MinIO: `Stat: The request signature we calculated does
  not match…`, retried for minutes). The first call of each run (`restic
  cat config`) is therefore cut off after `OFFSITE_PROBE_TIMEOUT_MS`
  (default 2 min) and the error restic kept retrying on is recorded.
  Exit code 10 ("repository does not exist", restic ≥ 0.17.0,
  https://restic.readthedocs.io/en/stable/075_scripting.html) makes
  the app run `restic init` once.

**Not configured is never green.** Until all five of
`OFFSITE_B2_KEY_ID`, `OFFSITE_B2_APPLICATION_KEY`, `OFFSITE_B2_BUCKET`,
`OFFSITE_B2_ENDPOINT` and `RESTIC_PASSWORD` are set, the self-checks
`backup.offsite.fresh` and `backup.offsite.drill` report
**`not-configured`** (a status of its own: never counted as a pass, and
it does not fail the run), `GET /api/housekeeping/offsite` lists the
missing names, and `POST /offsite/run` / `/offsite/drill` answer 409.

**Freshness.** `backup.offsite.fresh` fails when the last run failed
(with restic's error), when no off-site backup has run yet, or when the
last success is older than `OFFSITE_MAX_AGE_HOURS` (default 36).

**Restore drill.** Weekly (`OFFSITE_DRILL_INTERVAL_HOURS`, default
168; also on `POST /offsite/drill`) the app restores the latest restic
snapshot into a fresh temporary directory and checks it against its own
manifest: the sha256 of `db.json` and `settings.json`, the row count of
every table in `db.json`, the export file count and bytes, and that the
manifest is byte-identical to the local copy when that still exists.
The temp directory is then removed. Production data is never touched.
`backup.offsite.drill` fails when the last drill failed, when none has
run, or when the last one is older than `OFFSITE_DRILL_MAX_AGE_HOURS`
(default 192). The drill checks the restored files; it does not load
them into a database (that is the plan's Phase 3 throwaway-stack drill).

**Setup (V, once):**

1. In the Backblaze console, **B2 Cloud Storage → Buckets → Create a
   Bucket**: a new name, privacy **Private**. Note the **Endpoint**
   shown on the bucket's details (for example
   `s3.us-west-004.backblazeb2.com`).
2. **Application Keys → Add a New Application Key**: allow access to
   **that bucket only**, type **Read and Write**. Copy the `keyID` and
   the `applicationKey` immediately: B2 shows the application key once.
3. Make a long random restic password (a password manager's generator
   is fine). **Store it in your password manager AND on paper** kept
   somewhere safe off the server. restic: "Losing your password means
   that your data is irrecoverably lost"
   (https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html).
   The server cannot help you here: the password is the only key.
4. On the server, in `.env`:
   `OFFSITE_B2_KEY_ID=<keyID>`, `OFFSITE_B2_APPLICATION_KEY=<applicationKey>`,
   `OFFSITE_B2_BUCKET=<bucket name>`,
   `OFFSITE_B2_ENDPOINT=https://<endpoint from step 1>`,
   `RESTIC_PASSWORD=<password from step 3>`. Then
   `docker compose up -d --build app`.
5. As admin: `POST /api/housekeeping/offsite/run` (creates the restic
   repository on first use and uploads the first backup), then
   `POST /api/housekeeping/offsite/drill`, then
   `POST /api/housekeeping/self-checks/run`: `backup.offsite.fresh` and
   `backup.offsite.drill` should both pass. From then on the schedule
   does it by itself.

Not verified against real B2: this was proven against MinIO's S3 API
(below), not a Backblaze account; whether a bucket-restricted key is
enough for restic's first `init` against B2 is confirmed only by step 5
on the real bucket. External alerting (email or a dead-man's switch
when a check goes red) is not built: the red self-check is the alarm,
so someone has to look.

**How it was proven** (2026-10-25, throwaway compose project
`beuk-backup`, no published host ports: app built from this tree, the
`postgres:16-alpine` db, and MinIO
`cgr.dev/chainguard/minio@sha256:268d68a2…` standing in for B2's S3
API):

- The **scheduler** fired by itself 30 s after boot:
  `backups.scheduled created` → `offsite.backup pushed` ("initialised
  repository") → `offsite.drill pass`, with a share, two comments, a
  reader and a job in the backup.
- **Encrypted at rest:** the bucket held only restic's layout
  (`config`, `keys/…`, `index/…`, `snapshots/…`, `data/xx/…`). A byte
  grep of the whole MinIO volume for the manuscript title, a comment
  and the admin email found **0** hits; the same grep finds them in the
  local backups' `db.json` (positive control).
- **Retention ran:** after four backups on one day, `forget --prune`
  removed two snapshots and their packs; `restic snapshots` listed the
  two that restic 0.19.1's policy keeps (the newest daily, and the
  oldest as "oldest daily/weekly/monthly snapshot").
- **Drill passed:** file hashes matched, every table's row count
  matched the manifest (`shares=1 share_comments=2 share_readers=1
  jobs=1` …), manifest identical to the local copy.
- **Restore on real Postgres:** after deleting a comment and the job
  and revoking the share, restore through `POST /restore` brought all
  of it back (job result `[1, 2]` and the share's array snapshot
  intact) and its verification run passed. This run also caught that
  restore removed the export directory itself, which in Compose is a
  volume mount point: `EBUSY: resource busy or locked, rmdir
  '/data/exports'` after the database had committed. Restore now
  empties the directory instead.
- **Broken credential:** with a deliberately wrong application key,
  `POST /offsite/run` answered 502 and `backup.offsite.fresh` went red
  with restic's own error ("…The request signature we calculated does
  not match the signature you provided. Check your key and signing
  method."); the wrong key appears nowhere in the status file.

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

## Studio: ACX audio script export (client-only)

Export → **Audio Script for ACX (Audible)** opens a summary screen and
downloads `<title>-audio-script.zip`, built entirely in the browser
(JSZip; no server call, no audio recorded):

- `DOCX/` and/or `TXT/` narrator scripts, one per file in ACX order —
  `00 Opening Credits`, one file per narrated section (each opening with
  its spoken section header), `NN Closing Credits`. Credits are filled
  from the book's title, subtitle and author plus a narrator name field.
- Footnotes become `[NARRATOR DECISION — footnote n: …]` notes, pictures
  `[IMAGE: alt text]`, scene breaks `[PAUSE — scene break]`. The table of
  contents, title-page family, copyright, frontispiece and colophon are
  left out by default (each can be switched back on); part dividers are
  read at the top of the next file.
- `Pronunciation Guide` — candidates are auto-detected (capitalised
  names used mid-sentence that never appear in lower case, accented and
  italicised words; Beuk has no dictionary, so they are labelled
  guesses). The author's "sounds like" / IPA entries are saved with the
  book (`serializeBook().audio`) and noted inline at first occurrence.
  "Listen" previews an entry with the browser's own speech voice.
- `Retail Sample - suggestion.txt` and `Audio Script Summary.txt` (per-file
  words and estimated minutes, the words ÷ 9,300 math, warnings, sources).

Rules come from ACX's help pages, cited in the code next to each
constant: [submission requirements](https://help.acx.com/s/article/acx-audio-submission-requirements)
(one file per section, separate credit files, ≤120 min per file, retail
sample ≤5 min from the first five minutes, credit wording),
[9,300 words per hour](https://help.acx.com/s/article/how-long-will-my-narrated-audiobook-be)
(an average — every length shown is an estimate), and
[no table of contents](https://help.acx.com/s/article/producing-and-recording-your-audiobook).
ACX's pages give no rule for footnotes, pictures or the copyright page,
so the scripts leave those calls to the author/narrator. Audio specs
(bit rate, levels, room tone) apply to recordings and are reported as
not checked.

## Studio: dictation language (client-only)

**The browser cannot detect which language is being spoken.** The Web
Speech API's `SpeechRecognition.lang` takes a single BCP 47 tag and, when
unset, falls back to the page's `<html lang>`; the spec defines no
spoken-language detection and no multi-language session
([W3C Web Speech API](https://webaudio.github.io/web-speech-api/#dom-speechrecognition-lang),
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/lang)).
Spanish speech heard as English comes out as English-shaped words. So the
studio never claims to auto-detect speech; instead:

- **Picker.** Right-click (or long-press) either mic — or tap *Change
  language* on the bar shown while listening — to choose the dictation
  language: the book's language (default), recent picks first, then every
  language Beuk has a recognition code for. The pick is saved with the
  book (`serializeBook().dictation = { lang, recent }`; `lang: ""` means
  "follow the book's language"). Switching mid-session aborts the old
  recogniser and starts a fresh one in the new language; words already
  final stay in the text, the unfinalised tail (heard in the old
  language) is dropped.
- **Suggestions from the text, never automatic.** For a writer who
  dictates (the mic exists in this browser and has been used), the bar
  under the toolbar reads the last ~1,500 characters of the open section
  with the same detector the importer uses (`detectLanguageInText`,
  confident results only). If it reads as another language than the
  dictation language: *"This section looks Spanish — dictate in Spanish?"*
  If the whole manuscript reads as another language than the book's, it
  offers to fix the book language (which also drives hyphenation, quotes
  and Read Aloud) and records that as a hand choice. Nothing changes
  until the writer taps; *Not now* dismisses it for that section/book.
- **Read Aloud** offers the matching voice when the open section reads as
  another language than the book; the switch applies to that section only
  and lasts for the session (voices are the device's — if none is
  installed for that language the popover says so).

Self-checks: `dictation.language-picker`, `dictation.language-suggest`,
`readaloud.section-language` (stubbed recogniser; client-only in the
server registry). The 12 non-English translations of these strings were
written by an agent and have not yet been reviewed by native speakers.

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

## Hardening (abuse, crashes, shutdown, headers)

- **Rate limiting.** `POST /api/auth/login` and `POST /api/auth/register`
  each have an in-memory per-client-IP token bucket (separate buckets):
  `AUTH_RATE_BURST` attempts (default 10), then one more every
  `AUTH_RATE_REFILL_MS` (default 60000). Over the limit → `429` with
  `Retry-After` (seconds). In-memory means per process and reset on
  restart — proportional for the single-node deploy, not for replicas.
  Forgot / reset / change-password have their own limits (see the
  account-basics section).
- **Real client IP.** Express `trust proxy` is set to `TRUST_PROXY_HOPS`
  (default **1** — Caddy). Caddy ignores any client-sent
  `X-Forwarded-For` and sets its own, so `req.ip` is the address Caddy
  saw; a spoofed `X-Forwarded-For` does not buy a new bucket (verified
  live through Caddy). The Founders' Shelf throttle uses the same
  corrected `req.ip` (before this, every request looked like it came
  from Caddy, so one busy visitor throttled everyone). **If you run the
  app without a proxy in front, set `TRUST_PROXY_HOPS=0`**, or clients
  can pick their own IP.
- **No login timing oracle.** An unknown email still spends one argon2id
  verify against a per-process dummy hash, so response time does not
  reveal which emails have accounts.
- **Crash-proofing.** A download whose stored file vanishes or can't be
  read after the existence check answers `500 {"error": "export file is
  missing from storage"}` instead of killing Node (unhandled stream
  error). The pg pool has an `error` listener: a Postgres restart drops
  idle connections, gets logged, and the next query reconnects
  (verified live with `docker compose restart db`).
- **Graceful shutdown.** On SIGTERM/SIGINT the server stops accepting
  connections, lets in-flight requests finish, gives a running job up
  to `SHUTDOWN_GRACE_MS` (default 20000) and otherwise marks it
  **failed** with "the server was shutting down" (queued jobs stay
  queued and re-run at next boot), closes the pool and exits 0 (1 if
  requests had to be cut). Compose runs the app with `init: true`
  (Docker's tini as PID 1) and `stop_grace_period: 30s`.
- **Expired sessions** are deleted at boot and every
  `SESSION_PURGE_INTERVAL_MS` (default 1 h).
- **Healthchecks.** `app` probes `/api/health` with node's `fetch` (the
  image has no curl); `caddy` probes its admin API on `localhost:2019`
  (independent of DOMAIN/TLS mode) and only starts once `app` is
  healthy.

### Security headers (Caddyfile)

Every response carries `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: SAMEORIGIN` and an **enforced**
`Content-Security-Policy` (the `/read` reader sends its own, stricter
policy instead; every other page — studio, help, thanks, support,
changelog, roadmap, `/reset` — gets this one):

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: https://images.pexels.com https://api.openverse.org;
connect-src 'self' https://images.pexels.com https://api.openverse.org
            https://fonts.googleapis.com https://fonts.gstatic.com;
worker-src 'self'; manifest-src 'self'; frame-src 'self';
form-action 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self';
report-uri /api/csp-report; report-to csp
```

What is still allowed, and why — honestly:

- **`'unsafe-inline'` for scripts and styles.** The studio is one
  self-contained `index.html` whose code lives in inline `<script>`
  blocks and whose markup uses inline styles; the help index, support and `/reset` pages
  carry small inline scripts too. So the CSP does
  **not** stop an injected inline script — it stops scripts from any
  other origin, plugins, `<base>` hijacks, foreign form targets and
  framing. Moving the studio to nonces/hashes would be the next step.
- **No third-party script host.** JSZip, mammoth, lucide and jsPDF are
  vendored under `client/assets/vendor/` (with SRI), so `script-src` names
  no CDN. `'unsafe-eval'` is **not** granted.
- **Google Fonts** — the stylesheet on `fonts.googleapis.com`, the files
  on `fonts.gstatic.com`; both are also in `connect-src` because the
  service worker re-fetches them for offline use (a worker's `fetch()` is
  governed by `connect-src`).
- **`images.pexels.com`** — signed-in cover and scene photo search goes
  through `/api/stock` (Pexels); every Pexels photo URL is on this host
  ([Pexels API docs](https://www.pexels.com/api/documentation/)).
- **`api.openverse.org`** — when no shelf answers, photo search queries
  Openverse straight from the browser and shows its thumbnails
  (`/v1/images/{identifier}/thumb/`,
  [schema](https://api.openverse.org/v1/schema/)). Openverse *originals*
  live on each photographer's own host (Flickr, Wikimedia, …) and are
  **not** allowed: in that offline-from-the-server mode, picking a photo
  fetches the original first, the CSP refuses it (one `connect-src`
  violation), and the studio falls back to Openverse's thumbnail — a
  smaller picture. Signed-in Pexels search is unaffected.
- **`data:`** for images and fonts (book pictures, covers, uploaded fonts
  are data URIs). `blob:` is not needed and not allowed.

**Violation reports** go to `POST /api/csp-report`
(`src/routes/csp-report.ts`): both the legacy `report-uri` format
(`application/csp-report`) and the Reporting API (`report-to csp` +
`Reporting-Endpoints: csp="/api/csp-report"`, `application/reports+json`).
Per client IP it is rate-limited (token bucket, 30 burst, 1 per 2 s →
429), bodies over 16 KiB are refused (413), at most 20 reports per POST
are read, and each report becomes **one log line** — disposition,
directive, the blocked resource reduced to its origin or keyword, and the
document/source reduced to a path with queries and share/reset tokens cut
(`/read/:token`, `/reset`). No IP, user agent, referrer or script sample
is logged, and nothing is stored. Browsers that support `report-to`
ignore `report-uri`; the Reporting API only delivers over HTTPS or
localhost, with a delay of up to a minute.

`Strict-Transport-Security: max-age=31536000` is sent only over HTTPS
on a host other than `localhost`/`127.0.0.1`, so local mode
(`http://localhost:8090`, or `https://localhost`) is never pinned.

**How the allow-list was proven** (throwaway compose project
`beuk-csp`, no published ports, Playwright inside Caddy's network
namespace on `http://localhost`): a Playwright click-through of every
studio feature — load, sample book, typing, every toolbar button,
uploads (picture, font, flourish, cover, cover art), dictation (stub
recogniser), Read Aloud (stub voice), all 10 device previews incl. the
hardcover mini-book, cover maker, case-laminate wrap + dust-jacket PDF,
EPUB/DOCX/Markdown/HTML/ACX downloads, inspector/validate/a11y/preflight,
print preview + spreads, Store-ready report, DOCX/Markdown/TXT import +
import report, register / change password / sign out / sign in /
forgot / reset with a real emailed token, shelf save + open, export
archive saves, beta share link + `/read` + comment + comment in the
studio, Pexels cover and scene photo search, every help page, thanks,
support, changelog, roadmap, language switch to Arabic and Japanese,
service worker + offline reload, and the in-studio self-checks — with a
`securitypolicyviolation` listener in every frame, the console scanned
for CSP messages, and the app log watched for `/api/csp-report` lines
(the test stack's Caddyfile drops `report-to`, because headless Chromium
registered the `csp` endpoint but never uploaded a `report-to` report in
100 s, while it does send `report-uri` reports; a violation inside the
service worker's own context would only show up there, and none did).
Run first against the policy as report-only, then **enforced**: zero
violations and zero uncaught page errors, apart from the documented
Openverse-original case above. A positive control (a foreign
`<script>`, `fetch`, `<img>` and `<object>`) is refused and all four
reach `/api/csp-report`. Note: Chromium does not apply `'unsafe-eval'`
checks while DevTools/Playwright is attached, so the click-through wraps
`eval`, `Function` and string timers in a tripwire instead; a plain
headless Chrome (no DevTools) confirms `eval` and `new Function` throw
`EvalError` under this policy.

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
forged/unsigned webhooks changing nothing, and checkout/webhook
returning a clean 501 while billing is unconfigured. The billing
plumbing adds, against a local fake Stripe API (no real Stripe calls
anywhere in the suite): duplicate delivery processed once, a failed
delivery retried rather than skipped, unpaid async checkouts granting
nothing until `async_payment_succeeded`, out-of-order delivery (a stale
"active" after "deleted"), past_due grace (kept inside 7 days, gone
after; unpaid at once), refunds and disputes following the retrieved
status, test events never granting on a live server, no email
attribution (unattributed subscriptions fail the Housekeeping check),
checkout customer reuse, price allow-list and 409, and a lapsed writer
still listing, reading, saving and exporting books with share links
working.
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
Backups add (`tests/restore-coverage.test.ts`, `tests/offsite.test.ts`):
a share with two comments, a reader and a job surviving backup →
change → restore (and present in the `pre-restore-…` snapshot), jsonb
array round-trips under node-pg's parameter encoding, the table
completeness guard, the repeatable-read dump, password-reset tokens
emptied on restore, an old-format backup refused by name, and, against
a fake restic, the scheduler (backup, push, retention arguments, drill,
audit, lock), not-configured reporting, a broken credential and a
retrying probe turning freshness red with the real error, a tampered
snapshot failing the drill, and no restic or B2 secret in any output.
Real restic against an S3 server is the full-stack proof under
"Scheduled and off-site backups". The suite runs node's default
concurrency; on a small Docker VM, `node --import tsx --test
--test-concurrency=4 "tests/*.test.ts"` is the same suite with fewer
PGlite processes at once.
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
Hardening adds (`tests/hardening.test.ts`): the token bucket's burst /
refill / retry-after maths, login and register 429 + `Retry-After` per
client IP (a spoofed left-most `X-Forwarded-For` entry doesn't escape
it; another IP is unaffected), the founders throttle keyed on the
corrected IP, unknown-email login costing comparable time to a wrong
password, concurrent duplicate register → one 201 + one 409, non-UUID
ids → 404 on every `:id` route and id-bearing body, a download whose
file became unreadable after the stat → 500 JSON with the server still
up, the pg pool surviving an `error` event, expired-session purge,
graceful shutdown (in-flight request finishes, new connections refused,
pool closed, exit 0), and a job outliving the shutdown grace marked
failed while queued jobs stay queued.
Account basics add (`tests/account.test.ts`): forgot-password giving
the identical status/body/headers for a known and an unknown address
(and mail only for the real one), the token stored only as a hash,
reset setting an argon2id hash and revoking every session, token reuse
rejected, expiry after 60 minutes, a short password not burning the
token, one link spending the others, change password (403 on a wrong
current password, other sessions revoked, this one kept), sign out
everywhere, the per-IP 429 and silent per-address limit, the
unconfigured path (`emailDelivery: "not-configured"`, link only in the
console log, nothing logged with `MAIL_LOG_LINKS` off), a real
nodemailer hand-off to an in-process SMTP stub (and an honest failure
when nothing listens), the `/reset` page headers, and Housekeeping's
mail status / test send / self-checks with SMTP credentials scrubbed.
The Store-ready tie-in adds: the PDF inspector over hand-built PDFs
(PDF/X-shaped file with inherited MediaBox, TrimBox, declaration,
OutputIntent and embedded fonts; an unembedded font plus RGB in a
Flate-compressed content stream; objects packed in a compressed object
stream with a UTF-16 hex string; files with no fonts or no PDF at all
staying unknown), the pdfx job carrying `inspection` on its result, and the
Ghostscript arguments permitting exactly the ICC profile the definition
file names (with `-dSAFER` kept first).
Share links add (`tests/shares.test.ts`): create → list → read with the
token returned once and stored only hashed; the frozen copy unchanged
until republish; revoke → 410 (page and comment API); expiry → 410 and
re-opened by clearing it; comment validation, honeypot and
resolve/unresolve/delete; **IDOR** — another writer gets 404 on every
owner route, including mixing their own share id with someone else's
comment id; **XSS** — a manuscript carrying `<script>`, `onerror=`,
`javascript:` links and SVG/HTML "images" renders inert (the only script
on the page is the nonce'd helper); the per-IP and per-share comment
limits; and the owner's email absent from every public page and the
public comment API.

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
5. Backups are owned by Housekeeping's Evidence pillar: a scheduled
   local backup every 24 h (DB + settings + export volume) and, once
   the five off-site settings are in `.env`, an encrypted restic copy
   in a private Backblaze B2 bucket with a weekly restore drill (setup
   steps: Housekeeping → "Scheduled and off-site backups"). Local
   backups are never pruned automatically; watch the `backupdata`
   volume. Volume-level snapshots of `pgdata`, `exportdata` and
   `backupdata` remain a useful outer net.
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
   the tools overlay installs the pinned CMYK press profile that
   `tools/PDFX_def.ps` names — the five steps under "Jobs — Production
   setup" above. Until then, EPUBCheck and
   PDF/X jobs complete as honest "not configured" failures.
9. Email (password reset): set `SMTP_URL` + `MAIL_FROM` in `.env`
   (or pass them to `install.sh`), then use Housekeeping's mail test.
   Until then no reset email is sent and the studio says so.

The same Compose file runs locally — only `.env` differs.

## The static client mount point

`client/` is bind-mounted into Caddy at `/srv/client` and served at the
site root with SPA fallback; `/api/*` is proxied to the app. It holds a
placeholder page for the app itself, plus the M4 warmth pages under
`client/help/`, `client/thanks/` and `client/reset/` — those paths are proxied to the
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
alt-text status — including pictures inside headings, list items and
quotes; every picture in the file is counted, and any the import cannot
hold, such as one inside a footnote, is listed as left out), the language detected and any book details taken from
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

- **Live billing** — the plumbing is here (verified, deduplicated,
  order-safe webhooks; entitlements as data; checkout), but pricing is
  parked, no route is gated, and there is no Customer Portal route or
  studio billing UI. It activates when V sets prices, keys and the
  entitlements file; until then the endpoints answer 501.
- **Local backup retention and backup alerting** — local backups are
  never pruned (the number to keep is undecided), and a red backup
  self-check sends no email or ping by itself. Restore still lacks the
  plan's Phase 3 items (schema gate, dry-run, atomic file swap,
  maintenance mode).
- **Warmth Phases 1 and 2** — the Made-with-Beuk gallery, template
  sharing, seasonal challenges and spotlights (Phase 1, ~100–500
  users), and a real community (Phase 2, Discourse, on its trigger).
  Phase 0 shipped in M4; the later phases wait for their triggers.
- The web client wired to this API, first-login import of local
  manuscripts, and email verification on signup — later work.
  (Password reset, change password and sign out everywhere shipped:
  see Account basics.)

## Layout

```
src/
  index.ts        entrypoint: migrate, then listen; session purge timer,
                  SIGTERM/SIGINT → graceful shutdown
  shutdown.ts     graceful shutdown sequence (requests, jobs, pool)
  ratelimit.ts    in-memory per-IP token bucket + 429 middleware
  ids.ts          UUID validation (non-UUID ids → 404)
  migrate.ts      `npm run migrate`
  app.ts          buildApp() — express app (injectable clock for tests)
  config.ts       env → config
  db.ts           Db interface, pg pool impl, migration runner
  password.ts     argon2id hash/verify
  auth.ts         sessions (hashed tokens), cookie helpers, requireAuth
  streak.ts       day math + streak computation + heartbeat repair/pause
  billing.ts      billing provider interface + Stripe (signature verify,
                  retrieve subscription/charge, checkout) — inert w/o keys
  billing-sync.ts webhook pipeline: dedupe ledger, mode check, retrieve +
                  store subscription state, attribution (no email)
  entitlements.ts entitlements file, status policy, entitlementsFor,
                  requireEntitlement (applied to no route yet)
  jobs/           M5: tools.ts (EPUBCheck/Ghostscript adapters,
                  availability gating, report parsing) · runner.ts
                  (sequential in-process worker, per-job timeout,
                  boot recovery, PDF/X output back into the archive)
                  · pdfinspect.ts (reads the converted PDF: pages, page
                  box, PDF/X declaration, font embedding, RGB left)
  housekeeping/   the M3 admin surface: admin.ts (gate) · scrub.ts
                  (secret scrubber) · lock.ts (one global lock) ·
                  registry.ts (Self-checks) · packages.ts + fixtures.ts
                  (zip/EPUB structural checks + fixture packages) ·
                  backup.ts (Evidence: backup/restore) · offsite.ts
                  (backup schedule, restic off-site copy, drill) · scratch.ts
                  (Rehearse scratch DBs) · reference.ts (docs reader) ·
                  context.ts · fsutil.ts · xml.ts
  routes/         auth.ts · manuscripts.ts · streak.ts · exports.ts ·
                  billing.ts · housekeeping.ts · public.ts (M4 status +
                  public config) · founders.ts (M4) · warmth.ts (M4 pages)
                  · jobs.ts (M5) · shares.ts (beta-reader links:
                  owner API + public /read reader)
  shares/         render.ts (book JSON → frozen sanitized copy) ·
                  sanitize.ts (allowlist HTML sanitizer) · reader.ts
                  (reader / 410 / 404 pages, CSP headers)
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
                  · 007 founders (M4) · 008 jobs (M5) · 009 manuscript
                  revision (optimistic concurrency) · 010 password
                  resets · 011 shares · 012 billing state (events
                  ledger, subscriptions; users.plan = display label)
tests/            node:test suite (PGlite-backed)
client/           static mount point (app placeholder + M4 warmth
                  pages under help/ and thanks/)
CHANGELOG.md      the public changelog source (/changelog renders it)
docker-compose.yml · Dockerfile · Caddyfile · .env.example
```
