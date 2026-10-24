# client/ — static mount point

Caddy serves this directory at the site root (see `Caddyfile` and the
`caddy` service in `docker-compose.yml`). `index.html` is the wired Beuk
studio client — a single self-contained HTML export of the studio app
(exported 2026-10-22, after the SaaS wiring pass: it probes `/api/health`,
signs in, syncs to the shelf, archives exports, and runs EPUBCheck jobs
against this server, and falls back to local-only mode when the API is
unreachable). To refresh it after future studio changes, re-export the
studio app and replace this file — no server changes needed.

## Warmth pages (M4)

Two subtrees are NOT served raw by Caddy — Caddy proxies their paths
to the app, which reads these files and fills their config slots
(support contact, Ko-fi tip jar) per request:

- `help/` — the help reading room: `index.html` plus the task guides,
  the EPUB error decoder, and the shared Paper stylesheet
  (`warmth.css`). Plain HTML/CSS, no build step. Pages may use the
  slots `{{SUPPORT_EMAIL}}`, `{{SUPPORT_NAME}}`,
  `{{SUPPORT_REPLY_PROMISE}}` and `<!--BEUK_KOFI_JAR-->`; the app
  substitutes them (the jar only when `KOFI_URL` is set).
- `thanks/` — the post-export landing page the app links to after a
  successful export.

The changelog and roadmap pages have no files here: the app renders
them from `CHANGELOG.md` (repo root) and `docs/roadmap.md`.
