# Beuk launch checklist — beuk.studio

Follow it top to bottom. Every command is meant to be copied as-is;
`<…>` marks the only things you fill in. Nothing secret belongs in this
file — secrets go in `.env` on the server and in your password manager.

**Where it comes from.** A full rehearsal on 2026-10-25/26: a fresh
Debian 12 machine (a privileged container running its own Docker
29.9.2 / Compose v5.6.1, installed with get.docker.com exactly as
`deploy/install.sh` does), a fresh `git clone`, `./deploy/install.sh`
with a production `.env` (`COOKIE_SECURE=true`, generated Postgres
password, `APP_BASE_URL=https://<domain>`), a mail sink for SMTP, and a
headless browser. The domain was `beuk.localhost`, so Caddy used its own
internal certificate authority instead of Let's Encrypt — that is the
one thing the rehearsal could not exercise (see step 7). The deploy bugs
it found are fixed on this branch; the evidence is kept outside the
repository (`launch-rehearsal.md`, round 6).

Legend: **[measured]** = seen in the rehearsal; **[estimate]** = a
judgement, not a measurement; **[owner]** = only you can do it.

---

## 1. Rent the server [owner]

| | Recommendation | Why |
|---|---|---|
| RAM | **4 GB** | [measured] the whole stack peaked at **1.9 GiB** while one EPUBCheck job and one PDF/X job ran (app container 1.5 GiB: Java + Ghostscript run inside it; renderer 483 MiB: headless Chromium; Postgres 100 MiB; Caddy 50 MiB). Idle it sits around 200–400 MiB. [estimate] 4 GB leaves room for the OS, Docker, image rebuilds during a redeploy and a second writer's job; 2 GB would be tight the moment two jobs overlap. |
| CPU | **2 vCPU** | [measured] the app container ran at ~100 % of one core during the PDF/X step; the renderer is capped at 1.5 CPUs in `deploy/docker-compose.tools.yml`. [estimate] 2 vCPU keeps the site responsive while a job runs. |
| Disk | **40 GB or more** | [measured] images 2.5 GB + build cache 2.7 GB + the repo 82 MB + volumes 188 MB after a day of rehearsal. Local backups are **never deleted automatically** and each one copies the whole export volume (two backups = 67 MB when exports were 26 MB). [estimate] 40 GB is a comfortable start; watch it (step 12). |
| OS | Debian 12 or Ubuntu 24.04, x86_64 | [measured] rehearsed on Debian 12 amd64 only. The Dockerfile pins restic for arm64 too, but an arm64 box was **not** rehearsed. |

Add a swap file if the provider's image has none [estimate: a cheap
safety net against an out-of-memory kill during a rebuild]:

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Firewall: SSH, 80 and 443 only [owner]

Caddy needs **80** (HTTP→HTTPS redirect and the Let's Encrypt HTTP
challenge) and **443** open to the internet
(https://caddyserver.com/docs/automatic-https). Nothing else is
published: Postgres, the app and the renderer have no host ports.

- If your provider has a firewall in its control panel, allow inbound
  TCP 22, 80, 443 there and nothing else.
- On the box:

```sh
apt-get update && apt-get install -y ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

Know this: ports that Docker publishes bypass ufw — "Packets are routed
before the firewall rules can be applied"
(https://docs.docker.com/engine/network/packet-filtering-firewalls/).
Here that only concerns 80/443, which are meant to be public. Never add
a `ports:` line to `db`, `app` or `renderer`.

## 3. DNS [owner]

At your registrar, for `beuk.studio`:

| Record | Name | Value |
|---|---|---|
| A | `beuk.studio` (`@`) | the server's IPv4 |
| AAAA | `beuk.studio` (`@`) | the server's IPv6 (only if the server has one) |
| A | `www` | the same IPv4 |
| AAAA | `www` | the same IPv6 (if any) |

`www` is redirected to the apex by Caddy (install.sh sets
`WWW_DOMAIN=www.beuk.studio`). If you do not want www, skip those two
records and run install with `DEPLOY_WWW=0`.

Email records — **these belong to your email provider; copy them from
its setup page, do not invent them**. Confirm each one exists before
launch:

- [ ] MX for `beuk.studio`
- [ ] SPF (a TXT record) that includes the provider you send through
- [ ] DKIM (the TXT/CNAME record(s) the provider gives you)
- [ ] DMARC (TXT at `_dmarc.beuk.studio`)

If password-reset mail goes through a different service than your
mailbox (a transactional SMTP provider), its SPF/DKIM must be added too.

Check before step 6 (from your laptop or the box):

```sh
dig +short beuk.studio A
dig +short www.beuk.studio A
```

Both must print the server's IP. Do not run install before they do:
Caddy would fail its certificate orders and back off (Let's Encrypt
allows 5 failed authorizations per hostname per account per hour, and
5 certificates for the same names per 7 days:
https://letsencrypt.org/docs/rate-limits/).

## 4. Prepare the box [owner]

```sh
ssh root@<server-ip>
apt-get update && apt-get upgrade -y
apt-get install -y git curl openssl unzip
git clone <your-git-remote-url> /opt/beuk
cd /opt/beuk
git log --oneline -1          # the SHA you are about to launch
```

Use a **fresh clone**. Do not copy your Windows project folder: it
carries `.env` (local values), `tools-bin/` and
`docker-compose.override.yml`, the dev file that moves Caddy to
`127.0.0.1:8090`. install.sh refuses to run when that override is
present on a real domain [measured: it stops with a red message].

## 5. Decide the `.env` values

install.sh writes `.env` from `.env.example` and fills in what it can.
You pass the rest as knobs on the install command (step 6) or edit
`.env` and re-run install. The file ends up `chmod 600`.

**Set by install.sh — leave alone:**

| Key | Value it writes |
|---|---|
| `POSTGRES_PASSWORD` | 48 hex characters from `openssl rand`. **Never change it afterwards**: the database volume was initialized with it. |
| `DOMAIN` | `beuk.studio` |
| `WWW_DOMAIN` | `www.beuk.studio` (empty with `DEPLOY_WWW=0`) |
| `COOKIE_SECURE` | `true` |
| `APP_BASE_URL` | `https://beuk.studio` — reset links are built from it [measured: the reset email linked to `https://<domain>/reset?token=…`] |
| `MAIL_LOG_LINKS` | `false` (reset links never go to the log) |
| `COMPOSE_PROJECT_NAME` | `beuk` |
| `COMPOSE_FILE` | `docker-compose.yml:deploy/docker-compose.tools.yml` |
| `GIT_SHA`, `BUILD_STAMP`, `APP_VERSION`, `TREE_CLEAN` | the deployed commit |

**Required for launch:**

| Key | What | Notes |
|---|---|---|
| `SMTP_URL` | your provider's SMTP, e.g. `smtps://<user>:<password>@<smtp-host>:465` or `smtp://<user>:<password>@<smtp-host>:587` | Without it **no password-reset email is sent** (the studio says so). URL-encode special characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`). |
| `MAIL_FROM` | e.g. `Beuk <no-reply@beuk.studio>` | An address your provider lets you send from, on a domain with SPF/DKIM. |

**Strongly recommended before real writers arrive:**

| Key | What |
|---|---|
| `OFFSITE_B2_KEY_ID`, `OFFSITE_B2_APPLICATION_KEY`, `OFFSITE_B2_BUCKET`, `OFFSITE_B2_ENDPOINT`, `RESTIC_PASSWORD` | Off-site encrypted backups to a private Backblaze B2 bucket. Setup steps: README → "Scheduled and off-site backups". Generate `RESTIC_PASSWORD` with `openssl rand -hex 32`, store it in your password manager **and on paper** — it is the only key to the off-site copies. Until all five are set, Housekeeping says **not configured** [measured], never green. |
| `SUPPORT_EMAIL` | The public support address on the Help pages — only once the mailbox really exists. Empty = no address shown anywhere. |
| `SUPPORT_NAME`, `SUPPORT_REPLY_PROMISE` | Optional; shown only with `SUPPORT_EMAIL`. |
| `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL` (or `SUPPORT_EMAIL`), `LEGAL_POSTAL_ADDRESS`, `LEGAL_JURISDICTION`, `LEGAL_HOSTING_LOCATION`, optional `LEGAL_EFFECTIVE_DATE` | The operator details on `/privacy` and `/terms`. Until each is set, the page says "This page is still being completed" and lists what is missing. All six are passed to the app in `docker-compose.yml` (`app: environment:`). Meanings: README, legal section. Have the two pages reviewed by a lawyer. |
| `APP_TIMEZONE` | e.g. `America/Los_Angeles` (default UTC). |

**Later (fine to leave empty at launch):**

| Key | Effect while empty |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `ENTITLEMENTS_FILE` | Billing endpoints answer 501 "not configured"; nothing is gated. README → "Billing". |
| `KOFI_URL` | No tip jar anywhere, and `/support` answers 404 [measured]. |
| `PEXELS_API_KEY` | Cover maker offers no stock-photo search. |

Tuning knobs with safe defaults (`MANUSCRIPT_MAX_BYTES`,
`JAVA_MAX_HEAP`, `JOB_MAX_ACTIVE_PER_USER`, `JOB_MAX_QUEUED`,
`PDFX_INK_DPI`, `BACKUP_INTERVAL_HOURS`, …) are explained in
`.env.example`. Leave them unless you have a reason.

## 6. Install

From `/opt/beuk` (single quotes keep `$` and `<` out of the shell's
hands; nothing here is printed back):

```sh
DEPLOY_DOMAIN=beuk.studio \
SMTP_URL='<smtp-url>' \
MAIL_FROM='Beuk <no-reply@beuk.studio>' \
APP_TIMEZONE='<zone, e.g. America/Los_Angeles>' \
./deploy/install.sh
```

Add `SUPPORT_EMAIL='<address>'` when the mailbox exists. B2 keys: edit
`.env` afterwards (`nano .env`) and re-run `./deploy/install.sh` (a
re-run keeps every value already in `.env`, including the domain).

The first install downloads several base images and builds three
(app, app + tools, renderer with Chromium and the book fonts); the
rehearsal did not time it [estimate: minutes, depending on the
server's bandwidth — let it finish]. It ends with:

```
== Health check
   app /api/health answered: {"ok":true,"db":"up"}
== Done — Beuk is up
```

and a summary saved to `deploy/last-install.txt` (no secrets). It must
say `tools: enabled` and `email: configured`.

Check the containers:

```sh
docker compose ps
```

[measured] four services, each `Up … (healthy)`: `db`, `app`,
`renderer`, `caddy`. All have `restart: unless-stopped` and came back
healthy on their own after the Docker daemon was stopped and started
again (a reboot stand-in).

## 7. TLS and headers

The rehearsal used Caddy's internal CA, so this is the first time a
real Let's Encrypt certificate is requested — check it:

```sh
curl -sI https://beuk.studio/ | head -n 20
curl -sI http://beuk.studio/help | grep -i '^location'      # → https://beuk.studio/help
curl -sI https://www.beuk.studio/help | grep -i '^location' # → https://beuk.studio/help
docker compose logs caddy | grep -i -E 'certificate obtained|error' | tail -n 20
```

Expect [measured on the rehearsal domain, same Caddyfile]: `HTTP/2
200`, `strict-transport-security: max-age=31536000`, the full
`content-security-policy` (enforced, not report-only),
`x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff`,
`referrer-policy: strict-origin-when-cross-origin`; port 80 answers
`308` to https; www answers `301` to the apex. If Caddy logs errors
instead of "certificate obtained", re-check DNS (step 3) and the
firewall (step 2).

## 8. First admin account [owner]

1. Open https://beuk.studio, sign up with your own email.
2. On the box, in `/opt/beuk`:

```sh
docker compose exec app node dist/admin-cli.js grant <your-email>
docker compose exec app node dist/admin-cli.js list
```

Admin can only be granted this way — there is no admin UI and nothing
over HTTP grants it. Housekeeping is an API; `deploy/hk.sh` calls it for
you (it asks for your password, signs in, runs one action, signs out):

```sh
./deploy/hk.sh <your-email> rehearse      # migrations + boot on a scratch DB → "pass": true
./deploy/hk.sh <your-email> self-checks   # → "overall":"pass"
./deploy/hk.sh <your-email> mail-test     # → "sent": true, and the email arrives
```

[measured] On the rehearsal box: rehearse `pass`; self-checks
`overall: pass` — 56 pass, 0 fail, 154 client-only, 2 not-configured
(`backup.offsite.fresh` and `backup.offsite.drill`, because B2 was not
set). With B2 configured those two must become `pass` after the first
off-site run and drill (step 9).

Check the mail-test message in your inbox **and its spam folder**; if
it lands in spam, fix SPF/DKIM/DMARC before launch.

## 9. First backup and a restore drill

Do this **before** real writers sign up — a restore replaces the live
data with the backup.

```sh
./deploy/hk.sh <your-email> backups                    # a "scheduled-…" backup exists (made ~30 s after boot)
./deploy/hk.sh <your-email> backup launch-day-0        # a named one now
# In the studio: open the sample book, let it reach "On your shelf ✓", then:
./deploy/hk.sh <your-email> restore-preview launch-day-0   # note the "previewId"
./deploy/hk.sh <your-email> restore launch-day-0 <previewId>
```

The book you shelved after the backup must be gone; a `pre-restore-…`
snapshot is taken automatically first, and the restore re-runs the
self-checks (`"overall":"pass"`). [measured: backup → add a book →
restore → the extra book was gone, sign-in still worked, self-checks
passed.]

Off-site (once the five B2 keys are in `.env` and install re-ran):

```sh
./deploy/hk.sh <your-email> offsite-run     # pushes the latest backup to B2
./deploy/hk.sh <your-email> offsite-drill   # restores it to a scratch dir and verifies it
./deploy/hk.sh <your-email> offsite         # both checks "pass"
```

[measured] Without B2: `offsite` lists the five missing keys and
`offsite-run` answers 409 "not configured". The B2 path itself was not
exercised in this rehearsal (no bucket); README "Scheduled and
off-site backups" records how it was proven earlier.

## 10. Smoke test after launch (and after every deploy)

On a phone and a laptop, signed out and signed in:

- [ ] https://beuk.studio loads the studio; the browser shows a valid lock.
- [ ] https://beuk.studio/studio shows the 2.0 studio and its address becomes `/studio/` (no redirect: the page tidies it); `/studio?signin` opens the sign-in dialog there.
- [ ] Sign up a second test account; sign out; sign in.
- [ ] "Forgot password" → the email arrives → the link opens `https://beuk.studio/reset?token=…` → new password works, old one does not.
- [ ] Load the sample book → "On your shelf ✓" in the sidebar.
- [ ] Reload → no conflict warning, the book is the same.
- [ ] Store-ready report → run the server checks → EPUBCheck passes and the PDF/X job finishes [measured: both `done`, EPUBCheck 5.2.1 with 0 errors / 0 warnings on the sample].
- [ ] https://beuk.studio/help, `/changelog`, `/roadmap`, `/thanks`, `/reset` open.
- [ ] `curl -s https://beuk.studio/api/status` → `"ok":true`, `"version"` and `"build"` = the SHA you deployed.
- [ ] `./deploy/hk.sh <your-email> self-checks` → `overall: pass`.

## 11. Deploy a new version, and roll back

Deploy:

```sh
cd /opt/beuk
./deploy/hk.sh <your-email> backup before-<new-sha>
git pull
./deploy/install.sh
```

Roll back to a previous commit:

```sh
cd /opt/beuk
git log --oneline -10                   # pick <good-sha>
git diff --stat <good-sha> HEAD -- migrations/
git checkout <good-sha>
./deploy/install.sh
curl -s https://beuk.studio/api/status  # "build" = <good-sha>
```

[measured] Checking out the previous SHA and re-running install
rebuilt the app on that commit and `/api/status` reported its build;
`git checkout <branch>` + install rolled forward again. When a deploy
changes the Caddyfile, install.sh restarts or reloads Caddy so the new
headers go live [measured: both cases].

Migrations only go forward. If `git diff --stat … -- migrations/`
listed files, the older code runs on the newer schema [estimate: fine
for added tables/columns, not for anything the older code chokes on].
For a true undo of the data, restore the `before-<new-sha>` backup
(step 9) after checking out the old commit. Return to normal updates
with `git checkout main && git pull && ./deploy/install.sh`.

### 11a. The studio switch: Beuk 2.0 at `/studio/` [owner]

The deploy that makes 2.0 the studio (spec
`docs/superpowers/specs/2026-11-12-studio-2-cutover-design.md`) ships
only with the full gate green, fast-forward only.

- [ ] Before: `./deploy/hk.sh <your-email> backup before-<new-sha>` (as
  above).
- [ ] Before: the release note asks writers to **close every open studio
  tab before the deploy** (see "Known and accepted at launch": a 1.0 tab
  left open can keep saving where 2.0 no longer looks).
- [ ] Deploy as above. Caddy reloads (the `/studio` routing moved from the
  static mount to the app; the security headers, CSP included, are
  unchanged).
- [ ] **After the deploy, take a fresh backup:**
  `./deploy/hk.sh <your-email> backup after-studio-2`.
- [ ] The smoke test (step 10), with the `/studio` line.
- [ ] On a browser that used 1.0 before: `/studio` opens 2.0, at the latest
  on the next reload, and a book that browser kept only on the device is
  there.

**Rollback, for emergencies only:** set `STUDIO_CLASSIC=true` in `.env`
and run `docker compose up -d app`. The app then serves 1.0 at `/studio`
again. Know the cost, both ways, before you flip it:
- words written in 2.0 on a device are **not** in 1.0's device store (a
  book on the cloud shelf opens in both; a device-only book opens in 1.0
  as 1.0 last saved it);
- words written in 1.0 on a device during the rollback **never reach
  2.0** after you flip back (2.0 imports 1.0's store once only). **Before
  flipping back, tell writers to put device-only books on the cloud shelf
  or export them;**
- 1.0 runs online only (its offline worker retires itself), and a
  browser that holds 2.0's worker opens **2.0's** cached studio at
  `/studio` when offline or while the app is down (its scope `/studio`
  covers that address); words written there are in 2.0's device store.
- `/studio/…` answers a 302 to `/studio` that is never stored
  (`no-store`), so neither direction of the flip can loop on a cached
  redirect.

Remove the setting (or set it to `false`) and run the same command to
return to 2.0. [estimate: the rollback is covered by the server tests
(`tests/studio.test.ts`), never flipped on the box.] README: "The front
door" has the details.

## 12. The first week — what to watch

- **Daily:** `./deploy/hk.sh <your-email> self-checks`. Any `fail` is
  real; `not-configured` is honest about something you have not set.
- **Disk:** `df -h /` and `docker system df`. Local backups are never
  deleted automatically and each copies the export volume. To list them:
  `./deploy/hk.sh <your-email> backups`. [estimate] At launch scale this
  is megabytes per day; it grows with exports.
- **Memory:** `docker stats --no-stream`. [measured] Idle roughly
  200–400 MiB in total (medians per container: app 49–221, renderer
  89–104, Postgres 44, Caddy 26–31 MiB); one EPUBCheck + one PDF/X job
  peaked at 1.9 GiB.
- **Logs:** `docker compose logs --since 24h app | grep -i -E 'error|fail' | tail -n 50`.
  Each container keeps at most 3 × 10 MB of logs (rotation is on
  [measured: `max-size 10m`, `max-file 3` on all four]).
- **CSP reports:** `docker compose logs --since 24h app | grep -i csp`
  — a report means a browser blocked something on a real page.
- **Email:** ask the first writers whether reset emails arrive; check
  your provider's sending dashboard for bounces.
- **Certificates:** Caddy renews them by itself; `docker compose logs
  caddy | grep -i error` should stay quiet.
- **Off-site:** after B2 is set, `offsite` should show a fresh backup
  every day and a drill every week.

## Known and accepted at launch

- HTTP/3 is not offered: Compose publishes 443/tcp only. Browsers use
  HTTP/2 [measured]. Not needed for launch.
- Unknown paths: since the 2.0 switch there is no SPA fallback. A
  missing path without an extension (`/.git/config`, an old link) answers
  a 302 to `/studio`; one with an extension (`/.env`, a missing script)
  a plain 404; `/index.html` a 308 to `/studio`. Never 1.0's page.
  [estimate: pinned as Caddyfile text by `tests/studio.test.ts`; not yet
  requested against a running Caddy. Before the switch the measured
  answer was the studio's HTML with 200 for every unknown path.]
- A browser that still holds 1.0's v22 worker and goes offline before
  its first online visit after the deploy opens the cached 1.0 page
  (only v22's own code runs there; nothing new can reach it). Its first
  online visit installs the retiring v23.
- **A 1.0 studio tab left open through the deploy.** 2.0 imports 1.0's
  device store (`beuk-local`) once only (`studio/src/book/store.ts`). A
  1.0 tab that stays open through the deploy, and never reloads, can keep
  saving to that store after 2.0 has imported it; those words don't
  appear in 2.0, and nothing in 2.0 shows the store again. What reloads
  such a tab (read in `client/index.html`, the `controllerchange`
  handler, and `client/sw.js` v23; not yet watched in a browser):
  - A tab that a worker (v22) **controlled** when it loaded reloads into
    2.0, after its device save (`localSaveBeforeReload`), when a new
    worker claims it. Which one depends on what else that browser did:
    - No 2.0 visit yet: v23 claims it on activation. v23 arrives only on
      the browser's next update check of `/sw.js`: a navigation anywhere
      on the site in any tab, or a request from the tab itself once the
      last check is more than 24 hours old (W3C Service Workers, Handle
      Fetch → Soft Update).
    - Once 2.0's `/studio` worker is registered in that browser (another
      tab opened the studio): that tab's `/studio` navigations no longer
      update-check `/sw.js` (the longest matching scope wins), and v23's
      `clients.claim()` skips a page under `/studio`. The reload then
      comes from 2.0's worker claiming the tab on its activation; only
      other site pages (`/`, `/account`, `/help`) still update-check
      `/sw.js`.
    1.0 never calls `reg.update()` itself, so a lone tab with none of
    these waits, still on 1.0.
  - A tab **no worker controlled** when it loaded (a hard reload, the
    first visit, service workers off) is never reloaded: 1.0 skips the
    reload when it had no controller (`swHadController`, BEUK:swfirst).
    It stays on 1.0 until the writer reloads it.
  Mitigation: the release note asks writers to close open studio tabs
  before the deploy (step 11a). [estimate: by reading; G5 in the final
  review measures it.]
- An existing installed app may keep opening at `/` until the browser
  applies 2.0's manifest (same id, start `/studio/`); offline, `/` then
  shows the browser's offline page. Reinstalling from `/studio/` fixes
  it (README, "The installed app").
