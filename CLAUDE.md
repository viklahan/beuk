# CLAUDE.md — beuk-saas session rules

Beuk SaaS server + studio. Overview: `docs/architecture.md`. Deep reference:
`docs/ENGINEERING.md`. History: `CHANGELOG.md`.

## The one law

We do not assume, infer, or conclude — we validate and report. Never
fabricate. Unsure = say so and go get the data. Honest status vocabulary
everywhere: a skip states its reason; fake-green is forbidden.

## Tests — read before running anything

- On Windows / 16 GB benches run `npm run test:bench`, never bare `npm test`.
  The default runner spawns one process per test file and every file embeds a
  PGlite (WASM Postgres); the unconstrained fan-out OOM-kills whole files at
  random ("FATAL ERROR: Zone Allocation failed") and paints phantom reds.
  `test:bench` caps `--test-concurrency=2` and is deterministic. Plain
  `npm test` is fine on roomy Linux/CI.
- The suite consumes controlled fakes, never real tools. Tool locations are
  env seams (`EPUBCHECK_JAR`, `GS_BIN`, `RESTIC_BIN`, `RENDERER_URL`) and
  `tests/helpers.ts` defaults them off; the jobs/hardening fakes
  (`fake-java.sh`, `fake-gs.sh`, sleepy variants) are POSIX shell scripts the
  server spawns as executables. Installing real tools never greens a red —
  a red here is a code or classification problem.
- On win32 the shell-stub tests condition-skip with the reason stated
  (Windows cannot exec shebang scripts; Node refuses `.bat`/`.cmd` without a
  shell). They run unchanged on Linux.
- Baseline (2026-11-17): Windows 1017 tests / 1001 pass / 0 fail / 16 skip;
  Linux 1017 / 1012 / 0 / 5. Compare failures against this before claiming a
  regression.

## The page's own self-checks — neither suite runs them

`client/index.html` carries about 500 self-checks. The suites re-express some
of them; the rest run only in a browser, so they can fail unseen (on
2026-11-22 a first full run found 36 failing on main, one of them a real
defect in box-set export). After any change to `client/index.html`, run

    node tools/page-selfchecks/run.mjs

(needs `PLAYWRIGHT_CORE` and optionally `CHROMIUM`, as the header says). It
passes only when the result is exactly what
`tools/page-selfchecks/known-not-passing.json` says. That ledger is not a
pass list: each entry is a red, stated with its reason and with what was and
was not verified. A new failure is fixed or explained there; never add an
entry to get a green.

## Completeness guards — reds by design

Adding a table or page trips self-checks until it is classified:

- New table → `BACKUP_TABLES`/`EXCLUDED_TABLES` in
  `src/housekeeping/backup.ts`, and, if it has an FK to users,
  `ACCOUNT_DELETED_TABLES`/`ACCOUNT_DETACHED_TABLES` in
  `src/account/data.ts`.
- New server-rendered page → the `tests/fixtures/l10n-english-only.json`
  ledger, with a reason.

One missed classification cascades reds across the restore, promotion-gate
and off-site suites from that single cause. Classify first, then run tests.
Never "fix" the guards.

## Prod

Prod runs on V's own box behind a Cloudflare tunnel. Deploys are V-driven —
never deploy from a session unprompted. Ship changes as a branch + PR for
V's merge.
