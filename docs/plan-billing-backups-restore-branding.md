# Beuk plan: billing, off-machine backups, restore fixes, branding

_Read-only investigation of `beuk-saas` @ `163a1de` (main). No edits, commits or containers. I read every file:line cited below. I did not run the test suite for this plan. Where something is my inference and not a direct reading, it is marked **LEAD** and comes with the test that would settle it._

---

## TL;DR: the order I'd do it in

| Phase | What | Why first | Effort | Depends on pricing? |
|---|---|---|---|---|
| **0** | **Restore data-loss fix.** Today's restore permanently deletes every share, comment, reader record and job. | Live landmine. Nobody should press Restore until this lands. | S–M | No |
| **1** | Consistent and scheduled local backups, then **encrypted off-site copies (restic)** plus freshness monitoring | Today a lost box means everything is gone | M | No |
| **2** | Billing plumbing: event dedupe, payment_status, state machine, entitlements as data | Must be correct before V turns keys on | M–L | **No.** Built so any pricing structure drops in as data |
| **3** | Restore hardening: schema-version gate, dry-run, maintenance mode, automated restore drill, optional per-writer restore | Makes restore something you can trust | M | No |
| **4** | Branding sweep (mechanical once V decides) | Blocked on V's decisions | S–M | Partly ("free" wording) |

---

## 1. Restore fixes (Phase 0 + Phase 3)

### 1.1 Verified current state

- **Backed-up tables** are fixed in `src/housekeeping/backup.ts:24-33`: `users, manuscripts, streak_state, streak_days, streak_freezes, exports, sessions, founders_applications`.
- **Missing from that list:**
  - `jobs` (migrations/008)
  - `password_resets` (010)
  - `shares`, `share_comments`, `share_readers` (011)
- **On "password_resets intentionally excluded":** I found nothing in the code that says so. The manifest's `excluded` list (`backup.ts:177-181`) names only the secrets, the three housekeeping evidence tables and `schema_migrations`. The exclusion is undocumented. Whether it was intended is unknown.
- **How restore runs** (`backup.ts:258-303`):
  1. Snapshots current state with the same incomplete table list.
  2. In one transaction, runs `delete from <table>` for each table in reverse order, ending with `delete from users`.
  3. Re-inserts the rows from the backup.
  4. After the commit, `rm -rf` the export volume and copies in the backup's `files/`.
- **Foreign-key cascades on `delete from users`:**
  - `jobs.user_id … on delete cascade` (008:9)
  - `password_resets.user_id … on delete cascade` (010:7)
  - `shares.owner_id … on delete cascade` (011:7). That in turn cascades `share_comments.share_id` (011:33) and `share_readers.share_id` (011:53).

> **CONFIRMED by reading (not yet by test): a restore today deletes every share link, every reader comment, every reader record and every job.** The `pre-restore-…` snapshot uses the same table list, so **that data cannot be recovered** from it either. For a writer, this means beta readers' comments vanish and share links stop working.

- **Route** (`src/routes/housekeeping.ts:304-345`): you need a preview id plus `confirmed: true`; it runs under the housekeeping lock (`mutate`, :96-116) and re-runs self-checks afterwards.
- **What `previewRestore` reports** (`backup.ts:229-252`): row counts per table only.
- **Existing test** (`tests/housekeeping.test.ts:280-329`): asserts only on `manuscripts`. It never creates a share, so it cannot catch the cascade.
- **Dump consistency** (`dumpTables`, `backup.ts:75-82`): it runs one `select *` after another with **no transaction / no REPEATABLE READ**. Writes landing during a backup can produce a dump that is inconsistent across tables (for example, a manuscript row without its export rows).
- **Schema version:** the manifest records `buildStamp` but **not which migrations were applied** (`backup.ts:168-182`). Restoring a backup taken under a newer schema fails mid-transaction. The rollback makes that safe, but the error is unfriendly. Restoring an older backup silently picks up column defaults (for example, `manuscripts.revision` becomes 1, from 009).
- **The file swap is not atomic.** The database commits first, then `rm` and `cp` of the export volume run (`backup.ts:293-300`). If the copy fails partway, the `exports` rows point at missing files.
- **No maintenance mode.** The app keeps serving and the job runner keeps running during a restore. Anything written between the snapshot and the delete is lost. The admin's own session row is replaced by the backup's `sessions` table, so the admin may be logged out right after the restore.
- **LEAD: jsonb arrays.** Re-insert passes raw JS values as parameters (`backup.ts:282-287`). node-pg converts JS arrays into a Postgres array literal, not JSON. A jsonb column whose top-level value is an array would fail or mis-insert. The jsonb columns involved are `manuscripts.doc`, `jobs.result`, `shares.snapshot`, `shares.images`. Proof: a test that backs up and restores a row where `jobs.result = '[1,2]'::jsonb`.
- **Backups never get pruned.** Each backup copies the **entire** export volume (`copyExportVolume`, `backup.ts:105-129`), and nothing deletes old backups. On-box disk usage grows without limit.
- **No scheduled backups.** The only timer in `src/` is the session purge (`src/index.ts:73`). Backups exist only when an admin clicks.

### 1.2 Proposed changes

**Phase 0 (S–M):**
1. Add `jobs`, `shares`, `share_comments`, `share_readers` to `BACKUP_TABLES` in foreign-key order: `… exports, jobs, sessions, founders_applications, shares, share_comments, share_readers`.
2. `password_resets`: keep it excluded, but **on purpose**:
   - Delete the table explicitly during restore. Old reset tokens should die on a restore.
   - Add it to the manifest's `excluded` list with the reason.
3. **Completeness guard (stops this happening again):** add `EXCLUDED_TABLES = {table: reason}` in `backup.ts`. Then add:
   - A **server test** asserting that every `information_schema.tables` row in `public` falls in exactly one of `BACKUP_TABLES` / `EXCLUDED_TABLES`.
   - A **housekeeping self-check** in `src/housekeeping/registry.ts` with the same assertion. It fails honestly the day migration 012 adds a table and nobody classifies it.
4. Take the dump inside `begin isolation level repeatable read read only`.
5. Encode jsonb explicitly on restore: look up jsonb columns from `information_schema.columns` and pass `JSON.stringify(value)` with a `::jsonb` cast.

**Phase 3 (M):**
1. **Schema gate:** write `migrations: [names]` into the manifest.
   - Preview shows the difference.
   - Restore **refuses** a backup that has migrations the server doesn't, with a named reason.
   - An older backup is allowed, and the preview lists the columns that will be filled with defaults.
2. **Dry-run:** `POST /restore/preview?dryRun=1` runs the full delete and insert inside a transaction, then `ROLLBACK`. It reports per-table added, removed and changed counts by primary key, plus any insert errors. Preview then means "this will work", not just a row count.
3. **Atomic files:**
   - Copy the backup's `files/` into `exportDir.restore-staging` before the transaction.
   - After the commit, swap with a rename (`exportDir` to `exportDir.old`, staging to `exportDir`), then delete the old one.
   - If the transaction fails, delete the staging directory.
4. **Maintenance mode** while a restore runs:
   - A flag in the housekeeping context.
   - Non-housekeeping write routes answer 503 `{"error":"maintenance"}`.
   - The job runner pauses claiming new work.
   - Keep the acting admin's session row across the restore.
5. **Retention for local backups:** keep the last N and every `pre-restore-*` from the last 30 days (N is V's call). Use a housekeeping action, not silent deletion. Each prune is audited.
6. **Optional, decision R2 below: per-writer restore.** Restore just one user's manuscripts, exports and shares from a backup. It covers the real support request "I deleted my book" without rolling back every other writer.

### 1.3 Tests and proofs
- **Server test (fails on main today, passes after Phase 0):**
  1. Create a share with 2 comments, 1 reader and 1 job.
  2. Take a backup.
  3. Mutate the data.
  4. Restore.
  5. Assert the share, comments, reader and job all came back.
  6. Assert the `pre-restore` snapshot also contains them.
- **Server test:** table-completeness assertion (above).
- **Server test:** jsonb array round-trip (settles the LEAD).
- **Server test:** a backup whose manifest lists a migration the server doesn't have is refused by name.
- **Server test:** dry-run leaves row counts identical before and after, and reports insert errors.
- **Server test:** a simulated copy failure (missing `files/` entry) leaves the export volume unchanged.
- The existing suite (123/123 baseline on main) stays green.

### 1.4 Decisions for V
| # | Decision | Recommended | Why |
|---|---|---|---|
| R1 | Until Phase 0 lands, should the Restore button be **disabled** with a named reason? | **Yes.** A one-line refusal in the route: "restore disabled: shares/jobs not yet covered" | It's the honest status; the alternative is a silent data-loss path |
| R2 | Per-writer restore, now or later? | **Later (Phase 3b)** | Full restore must be correct first; per-writer has its own conflict rules |
| R3 | How many local backups to keep | Last 14 plus all `pre-restore-*` from 30 days | Each one copies the export volume; disk is finite on one Hetzner box |

---

## 2. Off-machine backups (Phase 1)

### 2.1 Verified current state
- Backups are written to `BACKUP_DIR=/data/backups` on the **`backupdata` Docker volume on the same host** (`docker-compose.yml:50, 99, 152`).
- The export volume **is** included: it is copied into each backup's `files/` (`backup.ts:105-129, 156`). So exports are backed up, but only on the same box.
- Nothing leaves the machine. README step 5 (`README.md:965-968`) tells the operator to "keep volume-level snapshots … as the outer safety net". The repo doesn't automate that.
- Backups are **unencrypted** JSON plus files. Secrets are excluded by name (`SECRET_CONFIG_KEYS`, `backup.ts:36-42`), and a canary test proves no leak (`tests/housekeeping.test.ts:240-271`).
- No schedule, no retention and no failure alerting exist (see 1.1).
- **What a lost or compromised Hetzner box costs today:** every writer's server-side manuscripts, every share and comment, every export, all accounts. Writers keep their local IndexedDB copies, which the studio can export as `.beuk-backup.json` (`README.md:129-145`). Server-only data (shares, comments, export archive, streaks) is gone.

### 2.2 Proposed changes
1. **Scheduled local backup.** An in-app timer (same pattern as the session purge in `src/index.ts:73`, interval `BACKUP_INTERVAL_HOURS`, default 24) calls `createBackup` with `createdBy: 'scheduler'` under the housekeeping lock. Every run is audited. A failure is recorded as `error`, never swallowed.
2. **Also take a `pg_dump -Fc`** next to the app's logical `db.json`. That way off-site recovery doesn't depend on the app's own restore code being correct. Today neither `Dockerfile` nor `deploy/Dockerfile.tools` installs a Postgres client (my grep for `pg_dump|postgresql-client` returned nothing). Run it from the `postgres:16-alpine` `db` service image instead (it ships `pg_dump`), via a sidecar.
3. **Off-site with restic.** A new compose service `backup` (official restic image, pinned version) runs on a schedule:
   - `restic backup /data/backups /data/pgdump`
   - `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune`
   - `restic check --read-data-subset=5%`

   The retention numbers are a proposal (decision B2).
   - Restic encrypts data before upload. Its README: _"Restic uses cryptography to guarantee confidentiality and integrity of your data"_ and _"The location the backup data is stored is assumed not to be a trusted environment"_ (https://github.com/restic/restic, BSD-2-Clause).
   - Supported backends include SFTP, S3-compatible, B2 and rclone (https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html). The same page warns that **losing the repo password makes the data irrecoverable**.
4. **Secrets:**
   - `RESTIC_PASSWORD`, `RESTIC_REPOSITORY` and the target credentials go only in `.env`, added to `SECRET_CONFIG_KEYS` (so the canary test covers them) and to the `.env.example` comments.
   - V keeps a copy of the restic password **off the box** (password manager). Otherwise the off-site copy is useless exactly when it's needed.
5. **Monitoring that tells the truth:**
   - After each run, the backup sidecar writes `/data/backups/.offsite-status.json` (`{lastSuccessAt, snapshotId, bytes, error}`).
   - A new housekeeping self-check **fails** when the last success is older than 26 h, or when the file is missing and off-site is configured.
   - When off-site isn't configured, the self-check reports **"not configured"**. It never shows pass.
   - If SMTP is configured (`src/mailer.ts`), email the admin on failure.
   - _Optional external dead-man's-switch (e.g. healthchecks.io): **not researched, unverified**._
6. **Automated restore drill (weekly; ties into Phase 3):**
   1. A script under `deploy/` runs `restic restore latest` into a temp directory.
   2. It starts a **throwaway compose project** with no published ports and loads the `pg_dump` into it.
   3. It runs migrations, then housekeeping self-checks.
   4. It compares row counts against the manifest.
   5. It writes `.drill-status.json`, and a self-check reports that file's age and result.

   A backup that has never been restored doesn't count as verified, and the UI must not say it is.

### 2.3 Cost (researched 2026-10-24; data is tiny today)
| Target | Price | Source | Notes |
|---|---|---|---|
| **Backblaze B2** | $6.95 / TB / month; first 10 GB free; egress free up to 3× stored, then $0.01/GB; Class A/B/C calls free, Class D $0.004 per 10k (first 2,500/day free) | https://www.backblaze.com/cloud-storage/pricing | Different provider from Hetzner, so it survives a Hetzner account or region problem. At current scale it is likely within the 10 GB free tier (**LEAD**: actual size not measured) |
| **Hetzner Storage Box BX11** | €3.20 / month excl. VAT, 1 TB, 10 snapshots; protocols include SFTP, BorgBackup, Restic, Rclone | https://www.hetzner.com/storage/storage-box/ | Cheap and fast, but **same provider** as the app box |

### 2.4 Tests and proofs
- **Server test:** the scheduler creates a backup and audits it. A forced failure (unwritable `BACKUP_DIR`) is audited as `error`, not as success.
- **Server test:** the off-site self-check gives fail when status is stale, not-configured when there's no config, and pass only with a fresh success.
- **Server test:** the canary leak test is extended to the restic keys.
- **Full-stack proof** (unique compose project, no host ports, torn down after):
  1. Back up to a local restic repo (or a MinIO container standing in for S3).
  2. Delete the stack's volumes.
  3. Run the drill script.
  4. Self-checks pass on the restored database.
  5. Row counts match.

### 2.5 Decisions for V
| # | Decision | Recommended | Why |
|---|---|---|---|
| B1 | Off-site target | **Backblaze B2** (optionally plus Storage Box) | Provider diversity is the point of "off-site"; likely free at current size |
| B2 | Retention | 7 daily / 4 weekly / 12 monthly | Covers "I noticed last month" without paying for years |
| B3 | Where the restic password lives | Password manager, plus a printed copy | Lose it and every off-site backup is gone (restic docs) |
| B4 | Backup and drill frequency | Daily backup, weekly drill | A drill costs a few minutes of CPU |

---

## 3. Billing correctness (Phase 2). Pricing is parked; this is plumbing only

### 3.1 Verified current state
- **Plan column:** `plan text … check (plan in ('free','pro'))`, plus `plan_updated_at` and `stripe_customer_id unique` (`migrations/005_user_billing.sql`).
- **Signature verification** (`src/billing.ts:183-227`) matches Stripe's manual-verification spec:
  - HMAC-SHA256 over `"<t>.<raw body>"`
  - Only the `v1` scheme
  - Constant-time compare
  - A 300 s tolerance (Stripe's library default is 5 minutes)
  - Raw body mounted first (`src/app.ts:66`)

  Spec: https://docs.stripe.com/webhooks#verify-manually and #preventing-replay-attacks. **This part is good.**
- **Event mapping** (`billing.ts:143-164`):
  - `checkout.session.completed` always gives `pro`. **It never checks `payment_status` or `mode`.** Stripe's fulfillment guide says to "Check the payment_status property to determine if it requires fulfillment" and to make fulfillment "safe to run multiple times, even concurrently" (https://docs.stripe.com/checkout/fulfillment). A delayed-payment checkout (bank debit) would grant `pro` before the money arrives. `checkout.session.async_payment_succeeded` and `async_payment_failed` are not handled.
  - `customer.subscription.updated` gives `pro` if the status is `active` or `trialing`, otherwise `free`. So `past_due` drops to free immediately, with no grace period.
  - `customer.subscription.deleted` gives `free`.
  - Everything else is ignored, including `invoice.payment_failed`, `invoice.paid`, `charge.refunded`, `charge.dispute.created`, `customer.subscription.paused` and `resumed`.
- **No event-id dedupe and no ordering protection** (`src/routes/billing.ts:39-92`). Each delivery directly runs `update users set plan = …`.
  - Stripe: "Webhook endpoints might occasionally receive the same event more than once … logging the event IDs you've processed".
  - Stripe: "Stripe doesn't guarantee the delivery of events in the order that they're generated … Don't use `created` to determine event order" (https://docs.stripe.com/webhooks#handle-duplicate-events, #event-ordering).
  - **Failure case:** a late-delivered `subscription.updated` (status `active`) arriving after `subscription.deleted` grants `pro` back to a cancelled customer.
- **User attribution** (`routes/billing.ts:56-77`) tries user id, then customer id, then **email** as a fallback. A subscription created outside this checkout (Dashboard, Payment Link) can be attached to whoever owns that email. The risk is low, but it is still a guess.
- **Unique-constraint retry loop:** `stripe_customer_id = coalesce($3, …)` against a `unique` column. If a second user ever resolves to the same customer id, the update throws, the route returns 500, and Stripe retries for 3 days in live mode (https://docs.stripe.com/webhooks#automatic-retries).
- **Checkout** (`billing.ts:229-255`):
  - It sends `customer_email` instead of an existing `customer`, so every checkout can create a **new** Stripe customer.
  - No guard stops a user who is already `pro` from starting a **second subscription**.
  - `success_url` has no `{CHECKOUT_SESSION_ID}`.
  - It uses one global `STRIPE_PRICE_ID` (`src/config.ts:147-149`).
- **Test vs live mode:** there is no check on `livemode`. Stripe issues different signing secrets for test and live endpoints (https://docs.stripe.com/webhooks#verify-events), so a test-mode `whsec_` left in production would accept test events and flip real accounts.
- **Plan enforcement: nothing enforces it.** `grep` for `.plan`, `'pro'` and `plan:` across `src/` outside the two billing files finds nothing. `/api/auth/me` returns only `{id, email}` (`src/auth.ts:88`, `src/routes/auth.ts:110-112`). The client has no billing or checkout UI (grep of `client/index.html` for `billing|checkout|/api/billing` finds nothing). **Today `pro` changes nothing a user can see or use.**
- **Cancel, portal, refund:** no routes exist.
- **Tests** (`tests/billing.test.ts`, 5 tests): 501 when unconfigured, signed checkout gives pro, bad signatures rejected, lifecycle by customer id, irrelevant or unattributable events ignored. **There are no duplicate, out-of-order, payment_status or livemode tests.**
- **README** (`README.md:440-466, 1033`) describes the behaviour above accurately. Line 758 says pricing and checkout surfaces are "none in this codebase", which stops being true once pricing ships.

### 3.2 Proposed design (works for any pricing V picks)
**Principle: store what Stripe says, derive access from data. Never hard-code plan names.**

1. **Migration `012_billing_state.sql`** (012 is the next free number; 001–011 exist):
   - `billing_events(event_id text primary key, type, livemode bool, received_at, processed_at, outcome text, error text)`. This is the dedupe ledger and the audit trail. Payloads are not stored, only ids, type and the object id.
   - `subscriptions(stripe_subscription_id pk, user_id fk on delete set null, stripe_customer_id, status, price_ids text[], current_period_end, cancel_at_period_end bool, updated_at, last_event_id)`.
   - Relax `users.plan`: either drop the `check (plan in ('free','pro'))` constraint or replace the column with a derived view. Decision P1.
2. **Webhook flow** (per Stripe's "quickly return 2xx" and "fetch the latest object" guidance):
   1. Verify the signature (existing code).
   2. **Reject an event whose `livemode` doesn't match `STRIPE_MODE`** (a new config value). Record it as `ignored-wrong-mode`.
   3. `insert into billing_events … on conflict do nothing`. If the row already existed, return 200 with `{duplicate:true}`.
   4. For subscription-affecting events (`checkout.session.completed`, `async_payment_succeeded` and `async_payment_failed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`), **retrieve the current Subscription from the Stripe API** and upsert `subscriptions` from it.

   Fetching the current Subscription makes ordering irrelevant: the newest state always wins, whichever event arrives first. It also follows Stripe's guidance "retrieve the associated subscription and confirm that its status is active before extending … access" (https://docs.stripe.com/billing/subscriptions/webhooks#track-active-subscriptions). Checkout events only grant access when `payment_status != 'unpaid'` (fulfillment guide).
3. **Attribution:** use `client_reference_id` / `metadata.userId`, then a stored `stripe_customer_id`. **Drop the email fallback.** Unattributable events are recorded as `unattributed` in `billing_events` and shown to the admin in housekeeping, never guessed.
4. **Entitlements as data.** A config file (`ENTITLEMENTS_FILE`, JSON) maps `price_id` to a list of entitlements (e.g. `["pdfx","shares.unlimited"]`), with a status policy:
   - `active` and `trialing` grant access.
   - `past_due` grants access for `GRACE_DAYS` (V decides).
   - `canceled`, `unpaid`, `incomplete_expired` and `paused` revoke access. This matches Stripe's "When a subscription changes to canceled or unpaid, revoke access" (subscriptions webhooks page).

   One function, `entitlementsFor(userId)`, is the **only** place access is decided, and it is unit-tested. V's pricing then becomes a JSON file plus Stripe Dashboard setup, with no code change.
5. **Checkout fixes:**
   - Reuse the stored `customer`.
   - Refuse with 409 when the user already has a non-terminal subscription.
   - Accept a `priceId` only from the entitlements allow-list.
   - Put `{CHECKOUT_SESSION_ID}` in `success_url`. The landing page can show "confirming…" while the webhook catches up. It never shows "you're Pro" until the server says so.
6. **Cancel and payment-method changes:** `POST /api/billing/portal` creates a Stripe Customer Portal session. _Customer Portal docs were **not fetched** for this plan; research and cite them before building._
7. **Honest exposure:** `/api/auth/me` (or `/api/billing/status`) returns `{status, entitlements, renewsAt, cancelAtPeriodEnd, mode}`. The UI shows exactly that:
   - "Payment failed — update card" when `past_due`.
   - "Ends on <date>" when `cancel_at_period_end`.
   - A visible **TEST MODE** badge whenever `STRIPE_MODE=test`.
8. **Enforcement:** apply `requireEntitlement('x')` middleware only on the routes V's pricing actually gates. **None are gated until V decides.** Until then the middleware is in place but not applied, and README says so.
9. **Housekeeping self-checks:**
   - "billing mode matches key prefix" (`sk_test_` vs `sk_live_`)
   - "no unprocessed billing_events older than 1 h"
   - "unattributed events count"

### 3.3 Tests and proofs
All server tests run in PGlite with a stubbed provider (no real Stripe calls, same as today):
- The same event delivered twice changes state once; the second response is `duplicate`.
- `subscription.deleted` delivered **before** a stale `subscription.updated(active)`: the final state is canceled (with the stub returning the canceled Subscription).
- `checkout.session.completed` with `payment_status: 'unpaid'` grants nothing; a later `async_payment_succeeded` grants access.
- A `livemode: true` event against `STRIPE_MODE=test` is rejected and recorded.
- `past_due` inside grace keeps access; past grace revokes it. `unpaid` and `canceled` revoke immediately.
- `charge.refunded` and `charge.dispute.created` refetch the subscription and apply its status (the revoke-on-refund policy is decision P3).
- A second checkout while subscribed returns 409. Checkout reuses the stored customer id.
- `entitlementsFor` is table-tested against a sample entitlements file (fixture, not real prices).
- Manual sandbox proof before going live: `stripe listen --forward-to …` plus `stripe trigger` for each handled event type (https://docs.stripe.com/webhooks#test-webhook), recorded in housekeeping.

### 3.4 Decisions for V
| # | Decision | Recommended | Why |
|---|---|---|---|
| P1 | Keep `users.plan` free/pro or move to entitlements | **Entitlements from data**; keep `plan` only as a cached display label | Doesn't presume V's structure |
| P2 | Grace period on `past_due` | 7 days (configurable) | Stripe retries cards while past_due; cutting writers off on the first decline is harsh |
| P3 | Refund or dispute: revoke immediately? | Follow the subscription's status (Stripe-driven); manual refunds also cancel the subscription in the Dashboard | One source of truth |
| P4 | What a lapsed writer loses | **Nothing they wrote.** Only gated features stop; books, exports and shares stay readable and exportable | Holding a writer's book hostage would be the worst trust failure |
| P5 | Email-based attribution | **Drop it** | It's a guess; unattributed events show up in housekeeping instead |

---

## 4. Branding

### 4.1 Verified occurrences (grep -c per file, excluding node_modules, tools-bin and .git)

**`quietshelf.studio` (17 files):**
- `client/index.html` ×3:
  - :15 `<title>Beuk — quietshelf.studio</title>`
  - :1588 `<div class="brand-sub">quietshelf.studio</div>`
  - :29364 the self-check `ui.tagline.present` description
- The 12 help pages under `client/help/*.html` ×1 each (sub-brand span, e.g. `help/index.html:12`)
- `client/reset/index.html:30`, `client/support/index.html:337`, `client/thanks/index.html:12`
- `src/warmth/pages.ts:109`

**`Quiet Shelf`:**
- Footer line `Beuk — a typesetting studio for writers, from Quiet Shelf.`: 12 help pages, `reset/:54`, `support/:443`, `thanks/:38`, `src/warmth/pages.ts:122`
- `client/index.html` ×18:
  - The `covermk.wrap.imprintPh` placeholder "Quiet Shelf Studio" in **13 locales** (:6316–6580)
  - Sample-book data: `publisher` at :13394, `imprint` at :20126, :26447, :26476
  - **The in-studio self-check at :26485 asserts `w.imprint === "Quiet Shelf Studio"`**, so changing the sample data means changing that assertion in the same commit

**"free & open-source" / "open source":**
- `brand.tagline` in **all 13 locales**, `client/index.html:6256-6268` ("your free & open-source EPUB converter", "de código abierto", "quelloffener", 开源, etc.)
- Static fallback at `:1590`
- `client/assets/manifest.webmanifest` `description`
- `src/housekeeping/registry.ts:1427` (quotes the tagline)
- The self-check `ui.tagline.present` (:29371-29388) compares against the string table, not a literal, so it survives a rewording

**Production domain `beuk.studio`:**
- `Caddyfile:3` comment
- `README.md` ×6 (e.g. :459 webhook URL, :751 `support@beuk.studio`, :961 `DOMAIN=beuk.studio`)
- `.env.example` ×4 (e.g. :76 `SUPPORT_EMAIL=support@beuk.studio`, :155 `MAIL_FROM` example)
- `deploy/install.sh` ×4, `docker-compose.yml` ×1, `src/config.ts` ×1

**Ko-fi / tip copy:**
- `src/warmth/pages.ts:37-58`: "Leave a tip on Ko-fi", "thank-you tin by the door". Rendered **only** when `KOFI_URL` is set.
- `client/support/index.html:403-410` ("Buy me a coffee on Ko-fi"), :435 "Other ways to help (all free)"
- `src/routes/public.ts:95`, `src/config.ts:48-50, 165`, `README.md` ×4 (:754-759), `tests/warmth.test.ts` ×6, `docs/*`, `CHANGELOG.md`
- The local `.env` sets `KOFI_URL` to a Quiet Shelf-named Ko-fi page (key name confirmed; value not printed)

**Product name "Beuk"** is everywhere: `client/index.html` ×977, both `sw.js` files ×22 each (cache names, so renaming would wipe every user's offline cache), `package.json`, compose and Docker files, tests. A product rename would be **L** and is out of scope unless V asks.

**Licence: there is no `LICENSE` or `COPYING` file, and `package.json` is `"private": true` with no `"license"` field.** Every "open-source" claim in 13 languages plus the manifest is therefore **unsupported by the repo**. Once paid plans exist, "free" also needs qualifying.

**Context from V's own notes (not the repo):** Quiet Shelf is listed as a separate project of V's (a manuscript-to-sellable-artifacts toolkit). Whether Beuk is "from Quiet Shelf" is V's brand call.

### 4.2 Decisions for V
| # | Decision | Recommended | Why |
|---|---|---|---|
| D1 | Sub-brand line: `quietshelf.studio`, `beuk.studio`, or none | Match the **production domain** (`beuk.studio` per Caddyfile/README) **unless** Quiet Shelf is the umbrella brand you want | A sub-brand that differs from the URL writers type looks like phishing |
| D2 | Is Beuk open source? | **Remove the claim now.** Re-add it only after a real LICENSE is committed (if you want it: AGPL-3.0 protects a hosted SaaS, MIT/Apache don't; that's your call) | No licence exists; the claim is false today, in 13 languages |
| D3 | Tagline wording once paid tiers exist | e.g. "your EPUB & print studio": no "free", no "open-source" | Survives any pricing structure |
| D4 | Ko-fi tip jar alongside paid plans | Keep it only while there is no paid tier; remove it when billing goes live | "Buy me a coffee" next to a subscription reads oddly. README:758 already promises it never sits on pricing surfaces |
| D5 | Sample imprint "Quiet Shelf Studio" in demo data and placeholders | Neutral fictional imprint (e.g. "Harbour Lane Press") | Demo data shouldn't advertise a different brand |
| D6 | Footer "from Quiet Shelf" | Follows D1 | — |

### 4.3 Mechanical change list (after V decides; effort S–M, about one unit)
1. `client/index.html`:
   - :15 title
   - :1588 sub-brand
   - :1590 fallback tagline
   - :6256-6268 `brand.tagline` ×13 (new text needs all 13 locales and gets flagged for native review like the rest)
   - :6316-6580 imprint placeholder ×13
   - :13394, :20126, :26447, :26476 sample data, **plus the :26485 assertion in the same commit**
   - :29364 check description
2. The 12 help pages, plus `reset/`, `support/`, `thanks/` and `src/warmth/pages.ts`: sub-brand span and footer line. Better: put both in one shared constant in `pages.ts` and inject a `{{SUBBRAND}}` placeholder into the static pages, as already done for `{{KOFI_URL}}`.
3. `client/assets/manifest.webmanifest` description. `src/housekeeping/registry.ts:1427` text.
4. If D4 means removal:
   - `pages.ts` jar block, `support/index.html:400-440`, `public.ts:95`, config `kofiUrl`
   - `tests/warmth.test.ts` (6 tests asserting the jar renders): **update their intent, not just delete them**
   - README :754-759, `.env.example` :79-83, `docs/*`
5. README: update the branding and licence lines, and :758 once pricing exists.
6. `client/sw.js` and `client/assets/sw.js`: bump the cache version so returning users get the new copy. Don't rename cache keys.
7. **Proof:**
   - A Playwright run of studio, help, support and thanks screenshots with zero hits for the retired strings (grep the rendered DOM).
   - `runSelfChecks` all pass, including `ui.tagline.present` and the cover-wrap check at :26485.
   - Server suite green.

---

## 5. Risks if nothing is done
- **Restore** deletes every share, comment and job, with no way back. That is the worst item in this list.
- **No off-site copy:** one disk, account or region failure takes every writer's server-side work.
- **Billing, if keys were switched on today:** unpaid async checkouts grant access, replayed or out-of-order events can re-grant cancelled users, test events could flip live accounts, and duplicate subscriptions are possible. **Don't set the Stripe keys before Phase 2.**
- **Branding:** a public "open-source" claim with no licence, in 13 languages.

## 6. Not done / not verified in this plan
- I did not run the server tests. Every finding above comes from reading the code. The restore cascade loss is certain from the schema and the delete order, but **not yet shown by a test**; the first Phase 0 test is that proof.
- The jsonb-array restore issue is a **LEAD**, untested.
- Stripe Customer Portal docs were not fetched. External alerting (healthchecks.io) was not researched.
- Current backup and export volume size was not measured, so the B2 free-tier fit is a LEAD.
- Third-party price aggregators disagreed on B2 fees; I used only Backblaze's own pricing page.

**Sources:**
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
- [Hetzner Storage Box](https://www.hetzner.com/storage/storage-box/)
- [restic repository backends](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)
- [restic README](https://github.com/restic/restic)