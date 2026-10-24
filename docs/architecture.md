# Beuk SaaS — Architecture

The server side of Beuk (the browser-based EPUB typesetting studio), a
single Docker Compose stack shaped for self-hosting on Hetzner Cloud:
Caddy terminates TLS and serves the static client; the app service is
the only API; Postgres holds everything else.

## Services

| Service | What it is |
|---|---|
| `caddy` | Reverse proxy + automatic HTTPS; serves `client/` at the site root, proxies `/api/*` to the app. Config: `Caddyfile`. |
| `app` | Node 24 + TypeScript, Express, `pg`, argon2id password hashing. Source: `src/`; compiled output: `dist/`. |
| `db` | Postgres 16. Data in the `pgdata` volume. |

## App layout (real paths)

- `src/index.ts` — entrypoint: load config, run migrations, listen.
- `src/admin-cli.ts` — out-of-band Housekeeping admin grant/revoke/list
  (the only way to become admin; nothing over HTTP can).
- `src/config.ts` — env → typed config (incl. Housekeeping:
  `BACKUP_DIR`, `BUILD_STAMP`/`GIT_SHA`, `TREE_CLEAN`, `PROMOTION_MANIFEST_PATH`).
- `src/db.ts` — the `Db` interface (pg Pool in production, PGlite in
  tests), plus the migration runner: plain SQL files in `migrations/`,
  applied in filename order, tracked in `schema_migrations`.
- `src/auth.ts` — server-side sessions (SHA-256-hashed tokens, http-only
  cookie), `requireAuth`.
- `src/password.ts` — argon2id hashing.
- `src/streak.ts` — server-stamped writing streak: `streak_days` (activity),
  `streak_freezes` (repair/pause/grant ledger), `streak_state` (freeze balance).
- `src/billing.ts` — billing provider interface + Stripe implementation
  (signature-verified webhooks are the ONLY way a plan changes; inert
  until keys are configured, endpoints answer 501).
- `src/routes/` — `auth.ts`, `manuscripts.ts`, `streak.ts`, `exports.ts`,
  `billing.ts`, `housekeeping.ts`, and (M4) `public.ts`, `founders.ts`,
  `warmth.ts`.
- `src/housekeeping/` — the Housekeeping surface (see below).
- `src/warmth/` — (M4) the warmth pages: `pages.ts` (page chrome,
  config-slot filling, the Ko-fi jar block) and `markdown.ts` (the
  small safe renderer behind the changelog/roadmap pages).

## Data

- Manuscripts: one JSON document per book in `manuscripts.doc`, every
  query owner-scoped (another user's row is a 404, never a 403).
- Export archive: metadata in `exports` (format, preset, filename, byte
  size, SHA-256); bytes as files at `EXPORT_DIR/<user_id>/<export_id>`
  on the `exportdata` volume.
- Housekeeping evidence: `housekeeping_audit` (one row per action),
  `housekeeping_check_runs` (Self-checks results stamped with the build
  stamp), `housekeeping_signoffs` (promotion sign-offs per build stamp).
- Founders' Shelf: `founders_applications` (M4) — public intake via
  `POST /api/founders/apply`, readable only via Housekeeping's
  `founders.list`; part of Housekeeping backups like every data table.

## Housekeeping (M3)

All routes under `/api/housekeeping/*` sit behind an admin gate that
answers 404 to everyone else. Fixed named actions only — no shell, no
arbitrary commands, no free-form paths. Mutating actions take ONE
global lock (a concurrent attempt gets 409). Every response and
generated manifest passes the secret scrubber (`src/housekeeping/scrub.ts`).
Pillars:

- **Self-checks** — `src/housekeeping/registry.ts`: infra checks, data
  invariants, and package assertions over fixture EPUBs
  (`src/housekeeping/fixtures.ts`, `packages.ts`); client-only cases
  are registered with their reason, never faked.
- **Evidence** — `src/housekeeping/backup.ts`: named backups (DB dump +
  settings with secrets excluded by name + a copy of the export volume)
  under `BACKUP_DIR`; restore is preview → `confirmed: true`, snapshots
  current state first, then verifies by re-running Self-checks.
- **Rehearse** — migrations + a boot/health check against a scratch
  database (`src/housekeeping/scratch.ts`); production data untouched.
- **Reference** — this doc and `docs/roadmap.md`, served read-only.
- **Promotion** — refuses unless the tree is marked clean, Self-checks
  passed on the current build stamp, and a human sign-off exists;
  writes `PROMOTION_MANIFEST.json` (scrubbed, atomic write).

## Warmth surfaces (M4)

The public, unauthenticated warmth pages are served by the app (Caddy
proxies `/help*`, `/thanks*`, `/changelog`, `/roadmap` to it) because
two of their slots depend on server config: the support block
(`SUPPORT_EMAIL` / `SUPPORT_NAME` / `SUPPORT_REPLY_PROMISE`) and the
Ko-fi tip jar (`KOFI_URL` — rendered only when set). Guide content is
plain static HTML in `client/help/`; the changelog renders
`CHANGELOG.md` (repo root) and the roadmap renders `docs/roadmap.md`,
the same source as Housekeeping's Reference. `GET /api/status` is the
scrubbed public health summary the Help page shows as its status line;
`GET /api/config/public` exposes only the support contact and the jar
URL.

## Deliberate limits

- The client validator is structural only; server EPUBCheck and PDF/X
  jobs are M5.
- Backups are logical (JSON dumps + file copies), sized for a single
  Hetzner box — not a PITR/WAL story.
